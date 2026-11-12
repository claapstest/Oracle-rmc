# PostgreSQL Encrypted Payload Schema & Migration Support (VYR-031)

## Executive Summary & Metadata
- **Story ID:** VYR-031
- **Story Title:** Implement PostgreSQL encrypted payload schema and migration support
- **Epic:** EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
- **Branch Applicability:** Both (`standard-veyra-application-dev` & `veyra-application-dev`)
- **Status:** Complete / Production-Ready
- **Dependencies:** VYR-028 (Design encryption contract, AAD and storage schema)

---

## 1. Problem Statement & Architecture Goals
In Epic 4, sensitive Oracle Fusion enterprise data must be encrypted at rest in PostgreSQL such that only authorized Node.js processes can decrypt it. However:
1. **Reporting Query Preservation:** Dashboards, analytics, and operational reports rely on filtering by tenant, username, role, lifecycle, and dates. If these queryable columns were encrypted, high-performance database filtering would break or require expensive full-table scans.
2. **Zero-Downtime Migration:** Existing environments have thousands of legacy plaintext records. The database schema must gracefully support both legacy plaintext rows and new encrypted payloads side-by-side during rolling migrations.
3. **Auditability & Observability:** SRE teams need clear visibility into encryption progress across all raw tables without exposing cryptographic keys or sensitive plaintext in logs.

---

## 2. PostgreSQL Storage Schema Architecture

```
+---------------------------------------------------------------------------------------------------------+
|                                    Raw Oracle Fusion Table Schema                                       |
+---------------------------------------------------------------------------------------------------------+
| Queryable Relational Columns (Unencrypted, Indexed):                                                    |
|   - environment_host VARCHAR(255)       -> Multi-tenant boundary                                        |
|   - username / role_code / control_id   -> Natural entity identifiers                                   |
|   - status / lifecycle / priority       -> Dashboard and filter dimensions                              |
|   - event_timestamp / last_synced_at    -> Time-window and incremental sync watermarks                  |
+---------------------------------------------------------------------------------------------------------+
| Encryption Tracking Columns (Added in Migration 21):                                                    |
|   - is_encrypted BOOLEAN NOT NULL DEFAULT FALSE                                                         |
|   - encryption_format_version INTEGER DEFAULT NULL (e.g. 1)                                            |
|   - encryption_key_id VARCHAR(128) DEFAULT NULL (e.g. "veyra-kms-k1-2026")                           |
|   - encrypted_at TIMESTAMPTZ DEFAULT NULL                                                               |
|   - INDEX: ix_<table_name>_enc_status ON (environment_host, is_encrypted)                              |
+---------------------------------------------------------------------------------------------------------+
| Raw Payload Blob Column (JSONB):                                                                        |
|   When is_encrypted = FALSE: Stores legacy plaintext JSON (e.g. { "userName": "alice", ... })           |
|   When is_encrypted = TRUE:  Stores EncryptedPayload container:                                         |
|     {                                                                                                   |
|       "formatVersion": 1,                                                                               |
|       "algorithm": "AES-256-GCM",                                                                       |
|       "keyId": "veyra-kms-k1-2026",                                                                     |
|       "encryptedDek": "B64WrappedDek...",                                                               |
|       "nonce": "B64Nonce12B...",                                                                        |
|       "authTag": "B64Tag16B...",                                                                        |
|       "ciphertext": "B64Ciphertext...",                                                                 |
|       "aad": "table=oracle_raw_users|id=alice|ts=...",                                                  |
|       "createdAt": "2026-11-12T17:00:00.000Z"                                                           |
|     }                                                                                                   |
+---------------------------------------------------------------------------------------------------------+
```

---

## 3. 10 Raw Oracle Persistence Tables Inventory

| Table Name | Raw Column | Primary Key | Queryable Metadata Columns |
|---|---|---|---|
| `oracle_raw_audit_records` | `raw_payload` | `id` | `environment_host`, `event_id`, `event_timestamp`, `user_name`, `action_type`, `business_object` |
| `oracle_raw_users` | `raw_user` | `environment_host`, `username` | `environment_host`, `username`, `display_name`, `email`, `is_active`, `user_category` |
| `oracle_raw_roles` | `raw_role` | `environment_host`, `role_code` | `environment_host`, `role_code`, `role_name`, `category`, `is_custom`, `member_count` |
| `oracle_raw_role_hierarchy` | `raw_record` | `environment_host`, `parent_role_name`, `child_role_name` | `environment_host`, `parent_role_name`, `child_role_name` |
| `oracle_raw_controls` | `raw_payload` | `environment_host`, `control_id` | `environment_host`, `control_id`, `control_name`, `control_type`, `risk_level`, `status` |
| `oracle_control_incidents` | `raw_incidents` | `environment_host`, `control_id` | `environment_host`, `control_id`, `control_name`, `total_incidents`, `assigned_incidents` |
| `oracle_incident_rows` | `raw` | `environment_host`, `control_id`, `ord` | `environment_host`, `control_id`, `ord`, `result_id`, `status`, `lifecycle`, `priority` |
| `oracle_raw_access_certifications` | `raw_data` | `environment_host`, `certification_id` | `environment_host`, `certification_id`, `name`, `status`, `due_date` |
| `oracle_raw_certifier_worksheets` | `raw_data` | `environment_host`, `certification_id`, `id` | `environment_host`, `certification_id`, `id`, `certifier_name`, `status` |
| `oracle_raw_user_access` | `raw_payload` | `id` | `environment_host`, `username`, `role_name`, `role_code`, `department`, `job`, `manager` |

---

## 4. Encryption Migration Tracking Ledger

Migration 21 creates `oracle_encryption_migration_ledger`:
```sql
CREATE TABLE IF NOT EXISTS oracle_encryption_migration_ledger (
  id SERIAL PRIMARY KEY,
  table_name VARCHAR(128) NOT NULL,
  environment_host VARCHAR(255) NOT NULL,
  total_records INT NOT NULL DEFAULT 0,
  encrypted_records INT NOT NULL DEFAULT 0,
  plaintext_records INT NOT NULL DEFAULT 0,
  last_migrated_id TEXT DEFAULT NULL,
  batch_size INT NOT NULL DEFAULT 100,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  last_error TEXT DEFAULT NULL,
  started_at TIMESTAMPTZ DEFAULT NULL,
  completed_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_enc_migration_ledger UNIQUE (table_name, environment_host)
);
```

### 4.1 State Machine
- `PENDING`: Table identified for backfill; zero batches processed.
- `IN_PROGRESS`: Batches currently encrypting; `last_migrated_id` tracks resume cursor.
- `COMPLETED`: 100% of records encrypted; `completed_at` recorded.
- `FAILED`: Batch encountered error; `last_error` recorded (sanitized), fails closed.

---

## 5. Security & Privacy Guarantees

### 5.1 Zero Key Material in Database
- **No KEKs in Database:** Master keys reside strictly within KMS / Key Vault.
- **Wrapped DEKs Only:** The DEK is stored exclusively in encrypted envelope format (`encryptedDek`).
- **No Plaintext in New Columns:** The added columns (`is_encrypted`, `encryption_format_version`, `encryption_key_id`, `encrypted_at`) store only non-sensitive structural metadata.

### 5.2 Safe Logging & Debug Serializers
The `EncryptionMigrationService.sanitizeForLogging()` utility scrubs encrypted payloads and sensitive data before logging:
- `ciphertext` is replaced with `[REDACTED_CIPHERTEXT:<length>B]`.
- `authTag`, `nonce`, and `encryptedDek` are replaced with redaction placeholders.
- PII fields (`password`, `secret`, `token`, `ssn`) are replaced with `[REDACTED_SENSITIVE]`.

---

## 6. Migration Rollback Strategy
The `down` migration in `1711000000021_create_oracle_raw_encrypted_payloads_and_columns.cjs`:
1. Safely drops `oracle_encryption_migration_ledger`.
2. Drops indexes `ix_<table_name>_enc_status`.
3. Drops the added columns (`is_encrypted`, `encryption_format_version`, `encryption_key_id`, `encrypted_at`) from all 10 raw tables.
4. Uses `IF EXISTS` constructs to ensure idempotent execution without data loss on unmanaged columns.

