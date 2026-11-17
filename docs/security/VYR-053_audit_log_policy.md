# VYR-053 — Security Audit Logging & Sensitive-Data Masking Policy

**Epic:** EPIC 6 — OWASP application and API security hardening
**Applies to:** both branches (`veyra-application-dev`, `standard-veyra-application-dev`)
**Depends on:** VYR-047 (OWASP gap register), VYR-038 (crypto audit trail)

## 1. Standardized event schema

All security events are written to `veyra_audit_event` via `AuditService.recordAuditEvent`
(or the `SecurityEventLogger` facade, `backend/src/security/securityEventLogger.ts`)
with these fields:

| Field | Meaning |
|---|---|
| `event_type` | Allowlisted type (see below) |
| `user_id` | Acting user (UUID, when interactive) |
| `service_identity` | `veyra-backend:<service>` for background operations, `USER:<email>` for interactive ones |
| `tenant` | Tenant scope the action applies to |
| `result` | `SUCCESS` / `FAILURE` / `DENIED` |
| `correlation_id` | Groups related events; falls back to the hashed session ref from the crypto-audit context, else a fresh UUID |
| `target_type` / `target_id` | What the action acted on |
| `details` | Sanitized JSONB metadata (sensitive keys stripped) |
| `event_hash` | SHA-256 tamper-evidence chain link (see §3) |

Allowed event types:
`LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGIN_REJECTED_ACTIVE_SESSION`, `LOGOUT`,
`SESSION_EXPIRED`, `USER_CREATED`, `USER_UPDATED`, `USER_DELETED`,
`ROLE_ASSIGNED`, `ROLE_REMOVED`, `PRIVILEGE_CHANGED` (existing) plus
`CONFIG_CHANGED`, `PRIVILEGED_DATA_ACCESS`, `DECRYPTION_ACCESS`, `AUDIT_LOG_ACCESS` (VYR-053).

`DECRYPTION_ACCESS` is available for future callers; ciphertext decryption is
already recorded per-operation in `veyra_crypto_audit_event` (VYR-038) with
actor, service, purpose, tenant and hashed session — that table remains the
source of truth for decryption events to avoid double-logging.

## 2. Where events are recorded

- **Config changes** — both configuration-save routes record `CONFIG_CHANGED`
  with only what changed (URL/auth booleans, credential presence as booleans —
  never credential values).
- **Report downloads** — the report download route records
  `PRIVILEGED_DATA_ACCESS` with report id, format and size.
- **Audit trail reads** — the supervisor audit-events read route records
  `AUDIT_LOG_ACCESS` (returned count only, no queried values echoed back).

## 3. Tamper evidence & verification

Every event is hash-chained: `event_hash = sha256(prev_hash | time | type |
user | service | tenant | result | target | details)`.
`AuditService.verifyAuditChain()` walks the chain and reports the first broken
link (modified content or stripped hash). Run it periodically or on demand:

```ts
const { valid, eventsChecked, brokenEventId, reason } = await auditService.verifyAuditChain();
```

> shortcut: concurrent writes can interleave the prev-hash lookup under high
> load; if the chain ever shows a false break at a concurrency spike, move
> hash computation into a serialised writer or a DB trigger.

## 4. Sensitive-data masking

Two layers, defense in depth:

1. **Structured `details`** — `sanitizeAuditDetails()` drops any key matching
   the forbidden patterns (password/token/secret/apikey/authorization/cookie…)
   and redacts bearer tokens and JWTs found in string values.
2. **Free-form strings** — the file logger `logAudit()` runs every detail
   string through `maskSensitive()` (`security/cryptoFailure.ts`), which
   redacts `Bearer …` headers, JWTs, PEM blocks, hex secrets, base64 blobs and
   `password=…`/`token=…` assignments before writing to `oracle_audit.log`
   or the in-memory trail.

## 5. Access control on audit logs

- Database trail: `GET /api/dashboard/audit-supervisor/db/audit-events` is
  gated by `requireAuditSupervisorDashboard` (Audit Supervisor role only).
- File log (`oracle_audit.log`): written with mode `0600` (owner read/write
  only), located beside the backend package root.
- Audit-log *reads* themselves are recorded (`AUDIT_LOG_ACCESS`).

## 6. Retention

| Store | Retention | Rationale |
|---|---|---|
| `veyra_audit_event` | 24 months (DBA-managed; no automated purge shipped) | Security investigations & compliance reviews |
| `veyra_crypto_audit_event` | 24 months, aligned with encrypted-record lifetime | Decryption attribution |
| `oracle_audit.log` (file) | Rotated/deleted per host log policy; recommended 90 days, max 500 MB | Operational trail; duplicate of DB trail for admin actions |
| `mockAuditTrail` (in-memory) | Process lifetime only | UI convenience, not an audit system of record |

Retention periods are recommendations to be confirmed against the
organization's records-retention schedule; automated purge jobs were not part
of this story.
