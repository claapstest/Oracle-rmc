# Key Rotation and Encrypted-Record Version Compatibility (VYR-036)

Epic 4: Oracle raw-data encryption and Node.js-only decryption. Applies to both branches.

## What is stored per record

Every encrypted raw row carries, in both the payload and tracking columns:

| Field | Where | Purpose |
|---|---|---|
| `keyId` | payload + `encryption_key_id` column | Which KEK wrapped this record's DEK |
| `formatVersion` | payload + `encryption_format_version` column | Container layout version |
| `encryptedDek` | payload | The record's DEK, wrapped by the KEK |
| `ciphertext`, `nonce`, `authTag`, `aad` | payload | The data itself; never changed by rotation |

`SUPPORTED_ENCRYPTION_FORMAT_VERSIONS` (`encryptionContract.ts`) lists the format versions this build can read. Any other version fails closed with `UNSUPPORTED_FORMAT_VERSION`. A new format version is added to that list *before* any writer emits it, and removed only after `getKeyUsage()` shows no record still uses it.

## Key lifecycle

`KeyLifecycleRegistry` (`encryptionService.ts`) wraps the KMS/key provider and enforces status on every wrap and unwrap. Keys the registry does not know are refused.

| Status | Wraps new DEKs | Unwraps existing DEKs | Meaning |
|---|---|---|---|
| `PENDING` | no | no | Registered, not yet in use |
| `ACTIVE` | **yes** (only one) | yes | Current key |
| `RETIRING` | no | yes | Approved legacy key during transition |
| `COMPROMISED` | no | yes | Readable only so data can be moved off it |
| `RETIRED` | no | no | Allowed only when zero records depend on it |

### Configuration

`VEYRA_KEY_RING` is a JSON array. Secrets are referenced by environment variable name and never inlined:

```json
[
  { "keyId": "veyra-kms-k1-2026", "secretEnv": "VEYRA_KEK_K1", "status": "RETIRING" },
  { "keyId": "veyra-kms-k2-2027", "secretEnv": "VEYRA_KEK_K2", "status": "ACTIVE" }
]
```

Exactly one entry must be `ACTIVE`. A malformed ring, a second `ACTIVE`, or a missing secret stops the service at startup (fail closed). If the ring is unset, the provider's default key is the single `ACTIVE` key, which matches pre-VYR-036 behavior. If the ring does not list the provider's bootstrap key, that key is kept as `RETIRING` so records written under it stay readable.

## Rotation process (planned)

Rotation rewraps DEKs only (`EncryptionService.rewrapPayloadDek`): the record's DEK is unwrapped with the old KEK and wrapped with the new one. Ciphertext, nonce, authTag, AAD, `createdAt`, row IDs, metadata columns and `encrypted_at` stay unchanged.

1. **Provision** the new KEK in the KMS and expose its secret or reference to the service.
2. **Configure** the ring: new key `ACTIVE`, previous key `RETIRING`. Deploy. New writes now use the new key, and old records stay readable.
3. **Inventory**: run `getKeyUsage(pool)` for per-table counts by key ID and format version.
4. **Dry run**: `rewrapAll(pool, { dryRun: true })` reports candidate counts and changes nothing.
5. **Rewrap**: `rewrapAll(pool, { batchSize, maxBatches? })`. For each row the job:
   - rewraps the DEK under the `ACTIVE` key (any other target is refused),
   - verifies the new payload decrypts against its AAD before writing,
   - updates the row only if its `encryption_key_id` and ciphertext are unchanged since it was read. If a concurrent sync rewrote the row, the update is skipped and counted in `skipped`, because that row was already written under the active key.

   The job is **restartable and idempotent**: rewrapped rows leave the candidate set, so a stopped or `maxBatches`-limited run continues on the next invocation, and a completed run is a no-op. Rows that cannot be rewrapped are reported in `failures` (record key and error code, never key material) and left untouched.
6. **Reconcile**: re-run `getKeyUsage()` and expect zero records on the old key. Investigate any `failures`.
7. **Retire**: `retireKey(pool, oldKeyId)` counts dependent records across all tenants, by tracking column *and* by `keyId` inside the payload. It refuses with `KEY_IN_USE` while any remain. Set the key to `RETIRED` in the ring and only then destroy it in the KMS.

## Rollback

- **Before retirement**: the previous key is still `RETIRING`. Set it back to `ACTIVE` in the ring (in code, `registry.activate(oldKeyId)`), and the new key becomes `RETIRING`. Records rewrapped under the new key remain readable. Optionally run `rewrapAll({ toKeyId: oldKeyId })` to move them back.
- **After retirement**: retirement happens only once nothing depends on the key, so no record can be stranded. Re-adding a retired key requires its original secret from KMS backup.
- **Failed rewrap batch**: no rollback is needed. Each row update is atomic and verified, and unconverted rows simply stay on the old key.

## Emergency key compromise

`emergencyRotate(pool, { compromisedKeyId, replacementKeyId, replacementSecret })`:

1. Adds the replacement key, if new, and activates it.
2. Marks the compromised key `COMPROMISED`, so it stops wrapping immediately.
3. Rewraps every record still under the compromised key onto the replacement.
4. Returns the same per-table report as a normal rewrap.

Then update `VEYRA_KEY_RING` to match: replacement `ACTIVE`, compromised `COMPROMISED`. Redeploy so all instances agree, and retire the compromised key once `retireKey` shows zero dependents. If the KEK was exposed together with stored wrapped DEKs, the DEKs themselves must be treated as exposed. In that case re-encrypt the data with `rotatePayloadKey` (fresh DEK) rather than only rewrapping.

## Code

- `backend/src/security/encryptionContract.ts`: `SUPPORTED_ENCRYPTION_FORMAT_VERSIONS`
- `backend/src/security/encryptionService.ts`: `KeyLifecycleRegistry`, `rewrapPayloadDek`, the `keyRegistry` / `encryptionService` singletons
- `backend/src/security/keyRotationService.ts`: `getKeyUsage`, `rewrapTable`, `rewrapAll`, `retireKey`, `emergencyRotate`
- Tests: `backend/scripts/test_story_036_key_rotation.cjs` (`npm run test:vyr36`)
