# Oracle Baseline Sync Encryption (VYR-032)

**Story ID:** VYR-032
**Epic:** EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
**Branch Applicability:** Both (standard-veyra-application-dev & veyra-application-dev)

## 1. Objective

Route every raw-table write path in the full Oracle baseline synchronization
(`runFullSync` and its per-domain services) through the VYR-028/029 encryption
contract, so classified raw JSON payloads are stored as AES-256-GCM
`EncryptedPayload` containers with envelope DEKs instead of plaintext JSONB.

## 2. Rollout Switch

`VEYRA_RAW_ENCRYPTION` environment variable controls encryption at write time:

| Value | Behavior |
|---|---|
| unset / `false` (default) | Legacy plaintext writes; rows remain dual-mode readable |
| `true` | Every raw write encrypts its classified payload; encryption failure fails closed |

It is **disabled by default** because the read paths (dashboard filters, reports,
investigations) still query raw JSON with SQL JSONB operators (`raw_user->>'…'`,
`raw_payload->>'…'`, `raw_incidents` array expansion, etc.). Enabling encryption
before those queries are migrated (VYR-035, authorized Node.js decryption) would
silently empty dashboards. Enable the flag only after the read-side migration is
deployed; legacy plaintext rows remain readable in dual mode throughout.

## 3. What Gets Encrypted

The classified raw JSON column per table (per `dataClassification.ts`):

| Table | Raw column | Write site |
|---|---|---|
| `oracle_raw_roles` | `raw_role` | `userRoleRawDbService.saveRawRole`, `saveRawRolesBatch` |
| `oracle_raw_users` | `raw_user` | `userRoleRawDbService.saveRawUser`, `saveRawUsersBatch` |
| `oracle_raw_role_hierarchy` | `raw_record` | `roleHierarchyService.persistItemsToDatabase`, `seedDatabaseIfEmpty` |
| `oracle_raw_audit_records` | `raw_payload` | `auditRawDbService.saveRawAuditRecords` |
| `oracle_raw_controls` | `raw_payload` | `controlRawDbService.saveRawControl` |
| `oracle_control_incidents` | `raw_incidents` | `controlRawDbService.saveControlRawIncidents` |
| `oracle_incident_rows` | `raw` | `controlRawDbService.syncSingleControlRowsFromDb` |
| `oracle_raw_user_access` | `raw_payload` | `userAccessReportService.persistToDatabase` (PII snapshot) |

Relational/derived columns (usernames, control names, incident status counts,
breakdown counters) stay plaintext and queryable, matching the VYR-027
classification: only the whole-record raw payload is restricted.

## 4. Integration Point

`backend/src/security/encryptedRecordWriter.ts` is the single seam between the
sync services and the encryption stack:

- `isRawEncryptionEnabled()` — reads `VEYRA_RAW_ENCRYPTION`.
- `encryptRawField(table, record, rawObject, host)` — returns either the legacy
  value (flag off) or an `EncryptedPayload` bound to the record's AAD
  (`tenant|table|id|v` via `buildTableRecordAad`). Throws before the INSERT when
  encryption fails, so no plaintext row can be persisted.
- `trackingColumns(write)` — values for `is_encrypted`,
  `encryption_format_version`, `encryption_key_id`, `encrypted_at`
  (migration 0021 columns).
- `decryptRawField(table, record, rawColumnValue, host)` — dual-mode read-side
  helper for VYR-035: legacy payloads pass through, containers are decrypted and
  AAD-verified.

## 5. Derived-Row Rebuild (CTE → Node.js)

`oracle_incident_rows` was previously derived with a SQL CTE that expanded
`t.raw_incidents` with `jsonb_array_elements`. That cell is now an encrypted
container, so `syncSingleControlRowsFromDb`:

1. Fetches the incident cell for the control.
2. Decrypts it in Node.js (`decryptRawField`, dual-mode).
3. Maps each element's flat columns and lifecycle status in JS (same CASE
   semantics: ACCEPTED / REMEDIATE / RESOLVED / ASSIGNED).
4. Batch-inserts the derived rows, encrypting each row's `raw` element with its
   own AAD (`control_id` + `ord`).

The boot-time backfill predicate in `ensureIncidentRowsInitialized` accepts both
legacy arrays and encrypted containers (`is_encrypted = true`).

## 6. Upsert Semantics

Every `ON CONFLICT DO UPDATE` also updates the four tracking columns, so a row
can never end up flagged encrypted while holding plaintext (or vice versa) after
a re-sync.

## 7. Verification

`npm run test:vyr32` (82 checks) against PostgreSQL:

- Helper contract: flag default off, container shape, key id, round-trip,
  tamper-throws, tracking-column order.
- Flag-off regression: legacy plaintext writes unchanged.
- Flag-on: all 8 raw tables + derived rows store containers, tracking columns
  populated, zero plaintext sentinel leakage in the DB.
- Round-trip decryption of stored rows.
- Fail-closed: KMS failure surfaces before any row is written.
- Tamper at rest fails closed on decryption.

## 8. Test Tenant Isolation

The suite runs against `vyr032-test.oraclecloud.com` (via `FUSION_HOST`) and
deletes all its rows before and after, so real synced data is never touched.
