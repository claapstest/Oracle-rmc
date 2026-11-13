# Raw-Data Write Boundary & Encryption Enforcement (VYR-034)

**Story ID:** VYR-034
**Epic:** EPIC 4 ??? Oracle raw-data encryption and Node.js-only decryption
**Branch Applicability:** Both (standard-veyra-application-dev & veyra-application-dev)

## 1. Objective

Make plaintext writes to raw Oracle payload columns structurally difficult:
every INSERT/UPDATE that touches a raw JSON payload column must go through the
secured write boundary in `backend/src/security/encryptedRecordWriter.ts`, and
while encryption is enforced, plaintext writes are rejected before any SQL runs.

## 2. The Secured Write Boundary

`encryptedRecordWriter.ts` is the only sanctioned way to persist a raw payload:

| Function | Purpose |
|---|---|
| `encryptRawField(table, record, rawObject, host)` | Encrypts the classified payload with the record's AAD (tenant/table/id). Returns the legacy value untouched while `VEYRA_RAW_ENCRYPTION` is off. Validates the encryption result ??? a degraded KMS returning plaintext is rejected before SQL. |
| `assertEncryptedRawWrite(table, write)` | Last-line guard for code assembling writes manually: while encryption is on, rejects any write whose value is not a genuine `EncryptedPayload`. |
| `trackingColumns(write)` | Values for `is_encrypted`, `encryption_format_version`, `encryption_key_id`, `encrypted_at`. |
| `decryptRawField(table, record, rawColumnValue, host)` | Dual-mode read helper (legacy plaintext passes through; containers are decrypted and AAD-verified). |

Fail-closed semantics: encryption failure, an invalid container result, or a
plaintext write under enforcement all throw **before** the INSERT ??? no
plaintext row can be persisted through the boundary.

## 3. AAD Natural-ID Conventions

Every encrypted payload is bound to `tenant|table|id`. The id per table is
defined in `encryptionContract.getRecordNaturalId`. One special convention:

- **`oracle_raw_certifier_worksheets`** rows have no business key ??? the row id
  is a serial assigned at INSERT. The write site reserves the id with
  `nextval(pg_get_serial_sequence('oracle_raw_certifier_worksheets','id'))`
  before encrypting, so the AAD binds to the same id the stored row carries.
  Read-side decryption must pass `{ certification_id, id: <row id> }`.

## 4. Coverage

All raw-table write sites are wired (VYR-032/033/034): users, roles, role
hierarchy, audit records, controls, control incidents, derived incident rows,
user access snapshots, access certifications and certifier worksheets.

Statements that match a raw-table name but provably do not write a raw column
(counter updates, the sync watermark) are documented in the static-scan test
whitelist (`test_story_034_write_boundary.cjs`).

## 5. Code Review Checklist ??? Any New Ingestion Path

When adding a new sync service, endpoint, script, or column that persists raw
Oracle data:

- [ ] The raw payload goes through `encryptRawField()` ??? never `JSON.stringify`
      into a raw column directly.
- [ ] The INSERT/UPDATE carries the four tracking columns and its
      `ON CONFLICT DO UPDATE` refreshes them (a row can never be flagged
      encrypted while holding plaintext, or vice versa).
- [ ] If the natural id is not known before INSERT, reserve it from the
      sequence first so the AAD matches the stored row (see worksheets).
- [ ] The write respects `isRawEncryptionEnabled()` / fails closed under
      enforcement ??? never silently falls back to plaintext.
- [ ] No log statement prints the raw payload.
- [ ] Extend `test_story_034_write_boundary.cjs` if the new path introduces a
      new table or a new whitelist entry, with the reason documented.

## 6. Verification

`npm run test:vyr34`:

- Static scan across `backend/src`: every raw-table write site belongs to a
  service using the secured boundary (zero unsecured sites).
- Boundary guard: plaintext write rejected, encrypted write accepted, degraded
  provider rejected ??? all while enforcement is on.
- Certification tables (last plaintext gaps) persist encrypted and round-trip.
- Flag-off dual-mode regression.
