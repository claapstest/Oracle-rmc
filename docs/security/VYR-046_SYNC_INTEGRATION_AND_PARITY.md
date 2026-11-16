# VYR-046: Test Scheduled and Manual Sync Across Oracle Data Domains

## Document Information
- **Story ID**: VYR-046
- **Epic**: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
- **Branch Applicability**: Both (`standard-veyra-application-dev` & `veyra-application-dev`)
- **Author**: Srikar Balemarthy (`srikar.balemarthy@claaps.com`)
- **Status**: Implemented & Verified
- **Dependencies**: VYR-039 through VYR-045

---

## 1. Executive Summary & Objective

Story **VYR-046** represents the capstone integration and validation phase for **EPIC 5**. It validates that every ingestion trigger—whether invoked on-demand by an administrator via REST API (`POST /api/admin/sync/full`, `POST /api/audit/sync`), scheduled as an off-peak background batch (`scheduledSyncService` with `SCHEDULED_OFFPEAK_CRON`), triggered per product policy (`POST /sync/policies/:productCode/run`), or run per domain (`ingestionPipeline.runDomain`)—exhibits complete architectural parity, strict mutual exclusion, fail-closed encryption, resilient failure recovery, and accurate operational monitoring.

---

## 2. Ingestion Trigger Parity & Architecture

All ingestion triggers in the system have been unified to execute through the shared **Ingestion Pipeline** (`ingestionPipelineService.ts`), eliminating divergent code paths and ensuring complete behavioral parity.

```
                          INGESTION TRIGGERS
     ┌────────────────────────┬──────────────────────┬──────────────────────┐
     │ Manual Baseline Sync   │ Nightly Off-Peak     │ Domain / Product     │
     │ /api/admin/sync/full   │ scheduledSyncService │ /api/audit/sync      │
     │ Trigger: ADMIN         │ Trigger: CRON        │ Trigger: DOMAIN      │
     └───────────┬────────────┴──────────┬───────────┴──────────┬───────────┘
                 │                       │                      │
                 ▼                       ▼                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │                 SHARED INGESTION PIPELINE (VYR-040)                    │
  │                                                                        │
  │ 1. Distributed Mutual Exclusion (VYR-043):                             │
  │    - Local mutex check + PostgreSQL Session Advisory Lock              │
  │    - Table: veyra_distributed_locks                                    │
  │                                                                        │
  │ 2. Service Identity & Credential Context (VYR-042):                    │
  │    - Non-interactive jobs run as 'veyra-sync-worker'                   │
  │    - Manual runs preserve authenticated admin email audit context      │
  │                                                                        │
  │ 3. Encryption Preflight & Guard Boundary (VYR-041):                   │
  │    - Preflight KMS check verifies key availability & policy compliance │
  │    - Fails closed before any DB write if KMS is unreachable           │
  │                                                                        │
  │ 4. Domain Runner Execution with Resilience (VYR-044):                  │
  │    - Controls -> Role Hierarchy -> Audit -> Users & Roles -> Access    │
  │    - Bounded exponential backoff + jitter for transient errors (429/5xx│
  │    - Immediate fast-fail for permanent client errors (400, 401, 403)   │
  │    - SHA-256 hash deduplication ensures batch reprocessing idempotency │
  │    - Checkpoint watermark advances ONLY after DB persistence           │
  │    - Malformed records routed to Dead-Letter Queue (Quarantine)        │
  │                                                                        │
  │ 5. Operational Telemetry & Monitoring (VYR-045):                       │
  │    - Audit event recorded to veyra_sync_audit_event                    │
  │    - Alerts recorded to veyra_sync_alerts (Stale, Failure, Contention) │
  │    - Health status exposed via /security/sync-monitor                  │
  └────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Resilience, Idempotency & Failure Modes Analysis

| Failure Scenario | Ingestion Behavior | Verification & Guarantee |
|---|---|---|
| **Transient Oracle Rate Limit (HTTP 429)** | Extracts `Retry-After` header; applies bounded exponential backoff with full jitter; retries operation up to `maxAttempts`. | Avoids thundering herds; resumes automatically when rate limit lifts. |
| **Transient Oracle 500-504 Gateway Errors** | Retries with exponential backoff (`baseDelayMs * (multiplier ^ attempt) + jitter`). | Recovers seamlessly from transient cloud blips without human intervention. |
| **Permanent Oracle Error (HTTP 400, 401, 403, 404)** | Fast-fails immediately without retrying (attempt count = 1). | Prevents hammering API endpoints on expired credentials or bad requests. |
| **KMS / Encryption Outage** | Encryption preflight check fails; pipeline aborts immediately with `ENCRYPTION_PREFLIGHT_FAILED` before any DB write. | **Zero plaintext rows persisted**; fail-closed guarantee enforced. |
| **Partial Batch Failure / Malformed Data** | Corrupted records failing schema validation are routed to Dead-Letter Queue (`veyra_sync_quarantine`), while valid records persist. | Partial failure visibility; sync cycle continues without crashing. |
| **Worker Crash / Sudden Restart** | Checkpoint watermark remains at the last successfully persisted batch; distributed locks with expired TTLs are recovered via `recoverStaleLocks`. | Sync restarts safely from last watermark without data loss or duplication. |
| **Duplicate Records / Overlapping Pages** | Deterministic SHA-256 hash deduction (`deduplicateBatch`) deduplicates records in-memory before database insertion. | Reprocessing a batch is strictly idempotent; 0 duplicate DB rows. |

---

## 4. Encryption & PostgreSQL Storage Inspection (AC 2)

When `RAW_DATA_ENCRYPTION_ENABLED=true`:
1. All 8 raw database tables store ciphertext-only containers in their raw payload columns:
   - `oracle_raw_roles` (`raw_role`)
   - `oracle_raw_users` (`raw_user`)
   - `oracle_raw_role_hierarchy` (`raw_hierarchy`)
   - `oracle_raw_audit_records` (`raw_audit`)
   - `oracle_raw_controls` (`raw_control`)
   - `oracle_control_incidents` (`raw_incident`)
   - `oracle_incident_rows` (`raw_row`)
   - `oracle_raw_user_access` (`raw_user_access`)
2. Each encrypted payload matches the specification:
   ```json
   {
     "ciphertext": "<base64>",
     "iv": "<base64>",
     "tag": "<base64>",
     "keyId": "<kek-identifier>",
     "version": 1,
     "algorithm": "AES-256-GCM"
   }
   ```
3. Plaintext sentinels (e.g. employee names, emails, audit descriptions, control incident details) are strictly absent from raw payload storage.
4. Tracking columns (`is_encrypted = true`, `encryption_key_id`, `encryption_version`, `encrypted_at`) accompany every row.
5. Decryption is restricted to Node.js backend using `decryptRawField()` with authenticated AAD and fails closed on tampering.

---

## 5. Operational State & Monitoring Parity (AC 3)

1. **Dashboard Aggregates**:
   - `GET /api/admin/sync/status`: Reflects real-time sync state (`isSyncing`, `currentTask`, `startedAt`, `lastCompletedAt`, `lastStatus`).
   - `GET /security/sync-monitor`: Returns unified health status (`HEALTHY`, `DEGRADED`, `CRITICAL`), active alerts, and last successful sync timestamps.
2. **Operational Audit Events (`veyra_sync_audit_event`)**:
   - Every execution records: `job_id`, `tenant_id`, `triggered_by`, `service_identity`, `outcome` (`SUCCESS`, `PARTIAL`, `FAILED`, `ABORTED`, `LOCK_CONTENTION`), `started_at`, `completed_at`, `duration_ms`, `domain_results`, `correlation_id`.
   - Error messages are sanitized through `maskSensitive()` to prevent secret or key leakage into audit trails.
3. **Alert Lifecycle (`veyra_sync_alerts`)**:
   - Detects repeated failures, stale synchronization windows (>26h), lock contention spikes, and encryption faults.
   - Evaluates severity (`WARNING`, `CRITICAL`) and enables admin resolution via `POST /security/sync-alerts/:id/resolve`.
