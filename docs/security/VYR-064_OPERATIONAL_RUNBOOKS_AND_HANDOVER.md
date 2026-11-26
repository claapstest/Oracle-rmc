# VYR-064: Operational Runbooks & Production Support Handover

- **Story ID:** `VYR-064` (`EPIC 7 — Security, branch, regression and release testing`)
- **Branches Covered:** Both `standard-veyra-application-dev` (AI-Free) & `veyra-application-dev` (AI-Enabled)
- **Prerequisite Reference:** [VYR-055_secrets_management_and_rotation_runbook.md](VYR-055_secrets_management_and_rotation_runbook.md) · [VYR-053_audit_log_policy.md](VYR-053_audit_log_policy.md)

---

## 1. Monitoring Signals, Alert Thresholds & Ownership Matrix

| Subsystem | Telemetry Endpoint (Admin JWT) | Persistent Store / Log Signal | Alert Condition / Threshold | Primary Owner | Escalation Owner |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **App Liveness** | `GET /health` | Container stdout / Railway probe | Healthcheck fails (>120s timeout / 5xx) | Platform / DevOps | Engineering Lead |
| **Crypto & KMS Health** | `GET /api/security/crypto-health` | `veyra_crypto_audit_event` + `[VEYRA SECURITY ALERT]` | HTTP `503`, `status === 'CRITICAL'`, or `KMS_UNAVAILABLE` / `AUTH_FAILED` burst | Security Operations | Engineering Lead |
| **Sync & Scheduler Health** | `GET /api/security/sync-monitor`, `GET /api/security/sync-alerts` | `veyra_sync_audit_event`, `veyra_sync_alerts` | `REPEATED_SYNC_FAILURES` (>=3, configurable via `VEYRA_SYNC_FAILURE_ALERT_THRESHOLD`), `STALE_LAST_SYNC` (>26h, `VEYRA_STALE_SYNC_HOURS`), `LOCK_CONTENTION` (>=5), `ENCRYPTION_FAILURE` | Integration Ops | Backend Lead |
| **Locks, Checkpoints & DLQ** | `GET /api/admin/locks`, `GET /api/admin/sync/checkpoints`, `GET /api/admin/sync/quarantine` | `veyra_distributed_locks`, `veyra_sync_checkpoints`, `veyra_sync_quarantine` | Expired/stuck lock > lease TTL, `QUARANTINED` rows growing | Integration Ops | Backend Lead |
| **Brute Force & Rate Limits** | `GET /api/admin/security/rate-limits` | `veyra_account_lockouts`, `veyra_rate_limit_events` | Spike in `429` `RATE_LIMIT_EXCEEDED` / locked admin accounts | Security Operations | Site Admin |
| **Secrets & Startup Gate** | `GET /api/admin/security/secrets-status` | `SecretsManager` fingerprints + `AUDIT_LOG` | `validationReport.valid === false` or `SECRET_ACCESS_DENIED` | Platform / DevOps | Security Lead |
| **Oracle Service Identity** | `GET /api/admin/credentials/health` | `serviceIdentityRegistry` telemetry | Oracle connection failure or credential expiry | Integration Ops | Oracle Fusion Admin |

---

## 2. Runbook A — Cryptographic Key Rotation (JWT & KMS KEK)

### A.1 Routine JWT Signing Key Rollover (`VYR-022`)
- **Owner:** Security Operations & Platform Owner | **Cadence:** Every 180 days | **Downtime:** 0 minutes
1. Generate a new 2048/4096-bit RSA key pair in KMS / Secret Store.
2. Promote current active public key to previous slot so existing tokens continue verifying across the dual-key window:
   - `JWT_PREVIOUS_KEY_ID=<old-kid>`
   - `JWT_PREVIOUS_PUBLIC_KEY=<old-public-pem>`
3. Install new signing key: `JWT_KEY_ID=<new-kid>`, `JWT_PRIVATE_KEY` (or `JWT_PRIVATE_KEY_PATH`).
4. Trigger rolling restart or call `POST /api/admin/security/rotate-secret` with `{ "target": "jwt" }`.
5. **Verify:** `GET /.well-known/jwks.json` publishes both `<new-kid>` and `<old-kid>`.
6. **Clean Up:** After session lifetime + margin (>= 24 hours), remove `JWT_PREVIOUS_*` variables.

### A.2 Routine KMS Master Key (KEK) Rotation & DEK Rewrap (`VYR-036`)
- **Owner:** Security Lead & DBA | **Cadence:** Annually | **Downtime:** 0 minutes
1. Provision new KEK secret in Cloud KMS / Vault and update `VEYRA_KEY_RING`:
   - New key set to `"status": "ACTIVE"`, previous key transitioned to `"status": "RETIRING"`.
2. Deploy updated ring so all new sync writes wrap DEKs under the new `ACTIVE` key while old rows remain readable via `RETIRING`.
3. Inspect key inventory and dry-run rewrap (`keyRotationService.ts`):
   - `getKeyUsage(pool)` -> inspect counts per table and `encryption_key_id`.
   - `rewrapAll(pool, { dryRun: true })` -> confirm candidate counts.
4. Execute restartable DEK rewrap (`rewrapAll(pool, { batchSize: 200 })`) — ciphertext, nonce, authTag, and AAD stay untouched; rows are verified before commit.
5. Re-run `getKeyUsage(pool)` until zero records depend on the old `keyId`, then call `retireKey(pool, oldKeyId)` (enforces zero dependents) before destroying the old KEK in KMS.
6. **Rollback:** If issues appear before retirement, re-activate the previous `RETIRING` key (`registry.activate(oldKeyId)` / swap `ACTIVE` status in `VEYRA_KEY_RING`); both keys remain valid for reads.

---

## 3. Runbook B — KMS / Key Vault Outage Response

- **Owner:** Platform / DevOps (Primary), Security Lead (Escalation)
- **RTO:** 15 minutes | **Security Posture:** **Fail-Closed** (Zero plaintext fallback)
- **Trigger Alerts:**
  - `GET /api/security/crypto-health` returns HTTP `503` (`status: 'CRITICAL'`) with `KMS_UNAVAILABLE` or `KEY_NOT_FOUND` failures.
  - `GET /api/security/sync-monitor` raises `ENCRYPTION_FAILURE` alert (`type: 'ENCRYPTION_FAILURE'`).
  - Backend logs show `[VEYRA SECURITY ALERT]` or `ProtectedDataError`.

### Recovery Steps
1. **Confirm Fail-Closed Containment:** Verify no raw payloads are exposed in HTTP responses or logs (`test:vyr38` invariant); query `GET /api/security/crypto-health`.
2. **Isolate Root Cause:**
   - **AWS KMS (`AwsKmsProvider`):** Check IAM IRSA token expiry (`AWS_ROLE_ARN`, `AWS_WEB_IDENTITY_TOKEN_FILE`), KMS key state (Enabled vs PendingDeletion/Disabled), region connectivity (`AWS_REGION`), and `kms:GenerateDataKey`/`Encrypt`/`Decrypt` IAM denials.
   - **Azure Key Vault (`AzureKeyVaultProvider`):** Check Azure Managed Identity (`AZURE_FEDERATED_TOKEN_FILE`, `AZURE_CLIENT_ID`), Key Vault firewall/RBAC (`Key Vault Crypto Service Encryption User`), and `AZURE_KEY_VAULT_URL` DNS resolution.
   - **Local Vault / Key Ring (`LocalKmsProvider`):** Verify `ORACLE_ENCRYPTION_KEY`, `VEYRA_KMS_MASTER_KEY`, or `VEYRA_KEY_RING` referenced env vars were not dropped during a deployment.
3. **Restore KMS Access:** Re-enable KMS key / fix IAM role / restore vault secret or network egress, then restart affected backend replicas if credentials cached stale cloud IAM tokens.
4. **Verify Crypto Recovery:**
   - Confirm `GET /api/security/crypto-health` returns `200` with stabilizing failure rate.
   - Trigger read smoke test (e.g. `GET /api/users` or `GET /api/audit`) and confirm decrypted DTOs load cleanly.
5. **Backfill Missed Syncs:** Run **Runbook C** to clear any stalled sync state and trigger catch-up ingestion.

---

## 4. Runbook C — Scheduler, Distributed Lock & Ingestion Recovery

- **Owner:** Integration Operations | **Escalation:** Backend Lead | **SLA:** 30 minutes
- **Trigger Alerts:**
  - `STALE_LAST_SYNC` alert in `GET /api/security/sync-alerts` (no successful sync within `VEYRA_STALE_SYNC_HOURS`, default 26h).
  - `REPEATED_SYNC_FAILURES` alert (>= 3 consecutive failures).
  - `LOCK_CONTENTION` alert or manual syncs blocked with HTTP `409 SYNC_IN_PROGRESS`.

### Recovery Steps
1. **Inspect Sync State & Checkpoints:**
   ```bash
   curl -H "Authorization: Bearer $ADMIN_JWT" https://<host>/api/security/sync-monitor
   curl -H "Authorization: Bearer $ADMIN_JWT" https://<host>/api/admin/sync/checkpoints
   curl -H "Authorization: Bearer $ADMIN_JWT" https://<host>/api/admin/locks
   ```
2. **Recover Expired / Crashed Worker Locks:**
   - If a replica crashed mid-sync leaving an expired lease in `veyra_distributed_locks`:
     ```bash
     curl -X POST -H "Authorization: Bearer $ADMIN_JWT" https://<host>/api/admin/locks/recover-stale
     ```
   - Only if verified no worker process is actively executing a sync and the lock lease has not yet reached TTL, force-release the lock:
     ```bash
     curl -X POST -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
       -d '{"lockKey":"__GLOBAL__:full"}' https://<host>/api/admin/locks/force-release
     ```
3. **Triage Quarantined Records (`veyra_sync_quarantine`):**
   - Inspect dead-lettered items (`GET /api/admin/sync/quarantine?status=QUARANTINED`).
   - Remediate upstream malformed source record in Oracle Fusion (or schema mapping), then resolve:
     ```bash
     curl -X POST -H "Authorization: Bearer $ADMIN_JWT" https://<host>/api/admin/sync/quarantine/<id>/resolve
     ```
4. **Verify Oracle Service Identity & Execute Catch-Up Sync:**
   - Check `GET /api/admin/credentials/health`; rotate Oracle credentials if expired (`POST /api/admin/credentials/rotate`).
   - Trigger controlled catch-up sync (`POST /api/admin/sync/full`). Note: checkpoints only advance after DB commit, so catch-up safely resumes without duplicating records.
   - Verify `GET /api/security/sync-monitor` returns `status: 'HEALTHY'` and `GET /api/security/crypto-health` reports zero new failures.

---

## 5. Runbook D — Security Incident Response

- **Owner:** Security Lead (Incident Commander) | **Containment SLA:** < 15 minutes

### D.1 Suspected Key, JWT, DB, or Oracle Credential Compromise
1. **Contain Immediately:**
   - **JWT key compromise:** Generate new RSA keypair, remove compromised `kid` (do *not* keep compromised `JWT_PRIVATE_KEY` or `JWT_PREVIOUS_PUBLIC_KEY`), update `JWT_KEY_ID`/`JWT_PRIVATE_KEY`, call `POST /api/admin/sessions/cleanup`, and invalidate all rows in `veyra_session` (force re-login for all users).
   - **KMS KEK compromise:** Invoke `emergencyRotate(pool, { compromisedKeyId, replacementKeyId, replacementSecret })` (marks old key `COMPROMISED`, stops new wrapping immediately, rewraps records onto replacement key). If wrapped DEKs were exposed together with the KEK, re-encrypt records with fresh DEKs (`rotatePayloadKey`).
   - **Oracle / DB credential compromise:** Rotate credential upstream (Oracle Cloud / PostgreSQL), update secret manager, and trigger `POST /api/admin/security/rotate-secret` (`oracle` or `database`) or `POST /api/admin/credentials/rotate`.
2. **Preserve Forensic Evidence:** Query immutable audit trails (`veyra_audit_event` with SHA-256 `event_hash`, `veyra_crypto_audit_event`, and `veyra_rate_limit_events`):
   ```sql
   SELECT created_at, event_type, actor_email, service_identity, tenant, result, correlation_id
   FROM veyra_audit_event
   ORDER BY created_at DESC LIMIT 200;
   ```
   ```sql
   SELECT occurred_at, operation, outcome, actor_type, user_email, service_name, table_name, error_category, incident_id
   FROM veyra_crypto_audit_event
   WHERE outcome IN ('FAILURE', 'RAISED')
   ORDER BY occurred_at DESC LIMIT 200;
   ```

### D.2 Brute-Force Lockout or Unauthorized Access Burst
1. Inspect active lockouts and offending IPs via `GET /api/admin/security/rate-limits`.
2. Confirm legitimate user identity out-of-band before unlocking:
   ```bash
   curl -X POST -H "Authorization: Bearer $ADMIN_JWT" https://<host>/api/admin/users/<email>/unlock
   ```
3. Audit `PRIVILEGED_DATA_ACCESS` (`result = 'DENIED'`) events in `veyra_audit_event` for repeated IDOR or escalation probes.

---

## 6. Operational Support Handover Checklist

| Handover Domain | Artifact / Control | Routine Cadence | Accountable Role |
| :--- | :--- | :--- | :--- |
| **Daily Health Review** | Inspect `/health`, `/api/security/sync-monitor`, `/api/security/crypto-health` | Daily (09:00 post-nightly sync) | Integration Ops / L1 Support |
| **Weekly Security Audit** | Review `veyra_rate_limit_events`, `veyra_sync_quarantine`, CI workflows (`.github/workflows/dependency-scan.yml`, `secret-scan.yml`) | Weekly | Security Operations / L2 |
| **Quarterly Secret Rotation** | Rotate `ORACLE_PASSWORD`/`TOKEN`, `POSTGRES_PASSWORD`, and Entra `ENTRA_CLIENT_SECRET` (`VYR-055`) | Every 90 days | Platform / DevOps |
| **Biannual / Annual Key Rotation** | Rotate JWT RSA keys (`180d`, JWKS window) and KMS KEK (`365d`, `rewrapAll` + `retireKey`) | 180d / 365d | Security Lead & DBA |
| **Residual Risk Re-Review** | Re-assess `RR-001` (`xlsx`, expiry `2026-12-26`) through `RR-005` in [VYR-063 report](VYR-063_SECURITY_ASSESSMENT_AND_REMEDIATION_REPORT.md) | Before each expiry date | Engineering Lead & Security Lead |
| **Release & Rollback Verification** | Re-run `test:vyr61`, `test:vyr62`, `test:vyr63`, `test:vyr64` prior to tagging release | Every release candidate | Release Manager |
