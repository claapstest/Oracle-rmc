# Migrating Existing Plaintext Oracle Records to Encrypted Storage (VYR-037)

Epic 4: Oracle raw-data encryption and Node.js-only decryption. Applies to both branches.

Rows written before `VEYRA_RAW_ENCRYPTION=true` still hold plaintext raw JSON. This migration converts them in place, per raw table and per tenant (`environment_host`), through the same `encryptRawField()` boundary the sync pipeline uses. The AAD is built from the stored row exactly as the read path (`decryptRawRows`) builds it.

## Guarantees

| Requirement | How it is met |
|---|---|
| Restartable, batched, checkpointed | Keyset batches by `id` (or primary key). After each batch the last key and the counts are written to `oracle_encryption_migration_ledger` (`status = IN_PROGRESS`, `last_migrated_id`). The next run resumes from that checkpoint. |
| Idempotent | Only rows with `is_encrypted IS NOT TRUE` and a non-NULL payload are candidates. Encrypted rows are never touched again, and a completed run is a no-op. |
| Atomic update | One `UPDATE` per row writes the payload and all four tracking columns together, inside a transaction. |
| Plaintext removed only after a verified write | 1) Encrypt. 2) Decrypt and compare with the original. 3) `UPDATE … RETURNING` the stored value. 4) Decrypt that and compare again. 5) `COMMIT`. Any mismatch rolls back, leaving the plaintext row as it was. |
| IDs, hashes, timestamps and metadata preserved | Only the raw column and the tracking columns change. `id`, `record_unique_hash`, `created_at`, `updated_at`, `last_synced_at` and all metadata columns are left alone. |
| No sync race | 1) The migration refuses to run unless `VEYRA_RAW_ENCRYPTION=true`, so the sync can only write encrypted rows meanwhile. 2) Each `UPDATE` is guarded by `md5(raw::text)` of the row as read, so a row the sync rewrote is skipped (counted in `skipped`), never overwritten. 3) A Postgres advisory lock per table and tenant allows one migrator or rollback at a time. |
| No double encryption | A row flagged plaintext that already holds an encrypted container fails with `FLAG_MISMATCH` and is reported, not re-encrypted. |
| Counts reconcile | Each run records counts before and after: total, encrypted, plaintext, NULL payloads. It reconciles when no rows were lost (`lost <= 0`), encrypted rose by at least the number migrated, and plaintext fell by at least that number. Concurrent sync inserts are tolerated. |

Failures are reported with the record key and an error code only, never with payload or key material. Failed rows stay plaintext, and the ledger is marked `FAILED` with a sanitized summary.

## Runbook

All commands are run from `backend/` after `npm run build`, with `DATABASE_URL` set.

1. **Back up** the raw tables for the tenant:
   ```bash
   pg_dump "$DATABASE_URL" --data-only -t 'oracle_raw_*' -t oracle_control_incidents -t oracle_incident_rows -Fc -f pre_vyr037.dump
   ```
   The dump contains plaintext. Store it encrypted with restricted access, and destroy it once step 6 has passed and the agreed retention window has ended.
2. **Turn encryption on** (`VEYRA_RAW_ENCRYPTION=true`) and deploy, so all new syncs write encrypted rows.
3. **Dry run**. This reports counts and candidates and changes nothing:
   ```bash
   node scripts/migrate_plaintext_to_encrypted.cjs --host <tenant-host> --dry-run
   ```
4. **Migrate**, optionally one table at a time or in limited chunks. If interrupted, just re-run the same command; it resumes from the checkpoint:
   ```bash
   node scripts/migrate_plaintext_to_encrypted.cjs --host <tenant-host> [--table oracle_raw_users] [--batch-size 200] [--max-batches 50]
   ```
   The exit code is non-zero if any row failed or a table did not reconcile.
5. **Handle failures**. Investigate the listed record keys, fix the cause, and re-run. Use `--no-resume` to rescan from the start rather than from the checkpoint.
6. **Verify**. Every table's ledger row should be `COMPLETED` with `plaintext_records = 0`, apart from rows with a NULL payload. Check that a direct query no longer shows readable payloads (full scan: VYR-059). Then spot-check dashboards and reports.

## Rollback and recovery

- **Decrypt-back rollback** (per table and tenant). This writes plaintext, so it requires encryption to be **off** and an explicit confirmation:
  ```bash
  node scripts/migrate_plaintext_to_encrypted.cjs --host <tenant-host> --table <raw_table> --rollback --confirm DECRYPT_TO_PLAINTEXT
  ```
  It decrypts each encrypted row, clears the tracking columns under the same hash guard and lock, and marks the ledger `ROLLED_BACK`.
- **Restore from backup**: if data is damaged, restore the step 1 dump (`pg_restore --data-only`) into the affected tables, then repeat steps 3–6.
- **Partial failure**: there is nothing to undo. Each row commits independently, and unconverted rows remain readable plaintext, because the read path is dual-mode.
- **Keys**: rows are encrypted under the ACTIVE key from the VYR-036 key ring. That key and any RETIRING keys must stay available for both reads and rollback (see `key_rotation_and_version_compatibility.md`).

## Code

- `backend/src/security/plaintextMigrationService.ts`: `migrateTable`, `migrateAll`, `rollbackTable`, `migrationLockKey`
- `backend/scripts/migrate_plaintext_to_encrypted.cjs`: operator CLI
- Tests: `backend/scripts/test_story_037_plaintext_migration.cjs` (`npm run test:vyr37`)
