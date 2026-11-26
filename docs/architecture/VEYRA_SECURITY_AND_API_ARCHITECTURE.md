# VEYRA Security & API Architecture (VYR-064)

- **Story ID:** `VYR-064` (`EPIC 7 — Security, branch, regression and release testing`)
- **Branches Covered:**
  - `standard-veyra-application-dev` (AI-Free variant — no AskVeyra UI/routes/LLM dependencies)
  - `veyra-application-dev` (AI-Enabled variant — retains AskVeyra gated by `requireAskVeyra`)
- **Contract Version:** `v2.0.0` (Epics 1–7 Delivered Baseline)
- **Related Specifications:**
  - [VYR-061_CORE_REGRESSION_AND_API_CONTRACTS.md](../security/VYR-061_CORE_REGRESSION_AND_API_CONTRACTS.md)
  - [VYR-062_BUILD_AND_ARTIFACT_VALIDATION.md](../security/VYR-062_BUILD_AND_ARTIFACT_VALIDATION.md)
  - [VYR-063_SECURITY_ASSESSMENT_AND_REMEDIATION_REPORT.md](../security/VYR-063_SECURITY_ASSESSMENT_AND_REMEDIATION_REPORT.md)

---

## 1. End-to-End Security & Deployment Architecture

Veyra runs as a containerized Node.js 20 application (`Dockerfile` -> `npm run start:migrate` -> `node index.js` -> `backend/dist/index.js`) behind Railway / container TLS termination, serving the compiled React SPA (`frontend/dist`) and REST API (`/api/*`) from a single service while isolating PostgreSQL storage, KMS master keys, and Oracle Fusion integration boundaries.

```mermaid
flowchart TB
    Client["Browser Client<br/>frontend/dist SPA<br/>sessionStorage JWT"] -->|"HTTPS / TLS"| Edge

    subgraph Edge["Express Security Perimeter (backend/src/index.ts & security/)"]
        Headers["securityHeadersMiddleware<br/>Helmet CSP, HSTS, X-Frame-Options: DENY<br/>X-Powered-By stripped, strict CORS"]
        RateLimit["rateLimitService<br/>auth / sessionRefresh / sensitiveAdmin / api / tenant tiers<br/>veyra_account_lockouts + veyra_rate_limit_events"]
        Validation["requestValidationService<br/>2MB global cap, enforceContentType<br/>per-route limits, Zod .strict() DTO validation"]
        ErrorGuard["Global 4-arg Error Handler<br/>400 / 403 / 413 / 500 JSON (zero stack trace)"]
    end

    Edge --> AuthBoundary

    subgraph AuthBoundary["Authentication, JWT & Authorization (Epics 2–3)"]
        AuthRoutes["/api/auth/* & /.well-known/jwks.json<br/>LOCAL (LocalAuthenticationProvider)<br/>ENTRA (EntraAuthenticationProvider OIDC PKCE)"]
        JwtGuard["jwtAuthMiddleware (requireAuth)<br/>RS256 JWS via jose (zero PII claims)<br/>typ=at+jwt, iss/aud/kid/sid check"]
        SessionDB["authService + veyra_session<br/>Single active session, 15m sliding timeout<br/>immediate logout revocation & DISABLED check"]
        RBAC["requirePrivilege / requireAdmin / enforceTenantIsolation<br/>isInvestigationAuthorized (owner or SITE_ADMIN)<br/>requireAskVeyra (AI-enabled branch only)"]
    end

    AuthBoundary --> AppCore

    subgraph AppCore["Domain Services & Crypto Boundary (Epics 4–6)"]
        Reader["decryptedRecordReader<br/>decryptRawRows / decryptSingleRawField<br/>Authorizes before Node.js decrypt"]
        Writer["encryptedRecordWriter & ingestionEncryptionGuard<br/>encryptRawField + assertEncryptedRawWrite<br/>AES-256-GCM payload + canonical AAD"]
        CryptoSvc["encryptionService / KeyLifecycleRegistry / kmsProvider<br/>LocalKmsProvider | AwsKmsProvider | AzureKeyVaultProvider<br/>256-bit ephemeral DEK zeroed after wrap/unwrap"]
        Secrets["SecretsManager & validateStartupConfig<br/>Workload Identity (IRSA / Azure Federated / K8s)<br/>Config AES-256-GCM (v2:...)"]
        Audit["securityEventLogger & cryptoAuditService<br/>veyra_audit_event (SHA-256 chain) + veyra_crypto_audit_event"]
    end

    Writer -->|"EncryptedPayload v1 + 4 tracking cols"| PG
    Reader -->|"Read raw ciphertext + metadata"| PG

    subgraph PG["PostgreSQL Storage"]
        RawTables["10 Oracle Raw Tables<br/>is_encrypted, encryption_format_version,<br/>encryption_key_id, encrypted_at"]
        OpsTables["Operational & Security Tables<br/>veyra_session, veyra_user_identity_mapping,<br/>oracle_encryption_migration_ledger, veyra_distributed_locks,<br/>veyra_sync_checkpoints, veyra_sync_quarantine,<br/>veyra_sync_audit_event, veyra_sync_alerts,<br/>veyra_audit_event, veyra_crypto_audit_event,<br/>veyra_account_lockouts, veyra_rate_limit_events"]
    end

    subgraph SyncWorkers["Ingestion & Recovery Pipeline (Epic 5)"]
        Scheduler["scheduledSyncService (off-peak 23:00 daily)<br/>+ POST /api/admin/sync/full"]
        Pipeline["ingestionPipelineService & oracleSyncService<br/>distributedLockService (pg_try_advisory_lock + TTL)<br/>syncCheckpointService (watermark & quarantine)"]
        OracleClient["serviceIdentityRegistry (veyra-sync-worker)<br/>resilienceService + urlPolicy (SSRF block)"]
    end

    Scheduler --> Pipeline
    Pipeline --> OracleClient
    OracleClient -->|"HTTPS (SSRF-validated)"| OracleFusion["Oracle Fusion Cloud REST & BI Publisher"]
    Pipeline --> Writer
    Pipeline --> Audit
```

---

## 2. Dual-Branch Variant Split (`standard-veyra-application-dev` vs `veyra-application-dev`)

Both branches share the exact security, authentication, encryption, ingestion, and OWASP ASVS L2 codebase while strictly separating generative-AI surface area:

| Architectural Layer | `standard-veyra-application-dev` (AI-Free) | `veyra-application-dev` (AI-Enabled) |
| :--- | :--- | :--- |
| **Frontend UI (`frontend/src`)** | Zero AskVeyra UI (`Assistant.tsx` removed), zero chat triggers, zero LLM endpoints in compiled JS bundle (`frontend/dist`) | Retains `Assistant.tsx` and conversational dashboard shortcuts |
| **API Routes (`backend/src/routes/api.ts`)** | `/api/chat`, `/api/ai/*`, and `/api/database/*` absent (**404 Not Found**) | `POST /api/chat` and AI routes active, guarded by `requireAuth` + `requireAskVeyra` (`AUDIT_SUPERVISOR` blocked with **403**) |
| **Backend Modules (`backend/src`)** | `backend/src/ai/` and `backend/src/tools/` absent | `backend/src/ai/orchestrator.ts`, `responseComposer.ts`, `backend/src/tools/index.ts` present |
| **Dependencies (`backend/package.json`)** | No LLM SDKs or `node-sql-parser` | Retains `@google/generative-ai` and `node-sql-parser` |
| **Startup Config (`configValidator.ts`)** | Boots with zero AI environment variables (`TOGETHER_API_KEY`, `GROQ_API_KEY` unnecessary) | Uses configured LLM keys or deterministic local NLU fallback |
| **Deployment Unit** | Standalone `Dockerfile` / `node index.js` | Standalone `Dockerfile` / `node index.js` |

---

## 3. Core Security Runtime Sequences

### 3.1 Dual-Provider Authentication & RS256 Token Cutover

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant SPA as React SPA
    participant API as Express /api/auth/*
    participant Provider as LOCAL / ENTRA Provider
    participant KMS as tokenService (RS256 KeyManager)
    participant DB as PostgreSQL (veyra_user / veyra_session)

    User->>SPA: Sign in (Local credentials or Entra OIDC PKCE)
    SPA->>API: POST /api/auth/login (or /auth/entra/callback)
    API->>Provider: Validate credentials or exchange PKCE code
    Provider->>DB: Verify status=ACTIVE, single-session policy (409 conflict unless forceLogin)
    API->>KMS: issueAccessToken(userId, sessionId) [alg=RS256, typ=at+jwt, kid]
    Note over KMS: Minimal claims only: iss, sub, aud, sid, jti, iat, nbf, exp (Zero PII)
    KMS-->>API: Signed RS256 JWS
    API->>DB: Record ACTIVE row in veyra_session + LOGIN_SUCCESS in veyra_audit_event
    API-->>SPA: 200 OK { token, accessToken, sessionId, authProvider }

    SPA->>API: GET /api/* with Authorization: Bearer <JWT>
    API->>API: requireAuth verifies RS256 signature via JWKS + forbidden PII claim check
    API->>DB: Re-verify veyra_session status=ACTIVE and veyra_user status!=DISABLED
    alt Logout or Force-Login Revoked Session
        DB-->>API: status != ACTIVE
        API-->>SPA: 401 INVALID_TOKEN / SESSION_EXPIRED
    else Active Session & RBAC Authorized
        API-->>SPA: 200 OK (Cache-Control: no-store)
    end
```

### 3.2 Node.js-Only Envelope Encryption & Authorized Decryption Flow

```mermaid
sequenceDiagram
    autonumber
    participant Sync as Ingestion / Migration Worker
    participant Guard as ingestionEncryptionGuard / encryptedRecordWriter
    participant KMS as kmsProvider / KeyLifecycleRegistry
    participant PG as PostgreSQL Raw Table
    participant Reader as decryptedRecordReader
    participant Audit as cryptoAuditService

    Sync->>Guard: Persist raw Oracle record (VEYRA_RAW_ENCRYPTION=true)
    Guard->>Guard: Validate canonical AAD (tenant|table|id|v)
    Guard->>KMS: generateDataKey(ACTIVE keyId)
    Note over Guard,KMS: KMS wraps 256-bit random DEK; AES-256-GCM encrypts payload; DEK buffer zeroed
    KMS-->>Guard: encryptedDek + ACTIVE keyId
    Guard->>PG: Write EncryptedPayload JSON + is_encrypted=true, key_id, format_version, encrypted_at

    Note over Reader,PG: On authorized API request (after RBAC & tenant check)
    Reader->>PG: SELECT raw_payload + tracking cols + metadata cols
    Reader->>KMS: unwrapDek(encryptedDek, keyId) [allows ACTIVE, RETIRING, COMPROMISED]
    KMS-->>Reader: Plaintext DEK (fails closed if RETIRED or KMS unavailable)
    Reader->>Reader: AES-256-GCM verify authTag + AAD match -> JSON.parse -> zero DEK
    alt Tampering, AAD mismatch, or KMS outage
        Reader->>Audit: recordFailure(category, incidentId) [no plaintext/key logged]
        Reader-->>Sync: Throw ProtectedDataError (fail closed, zero plaintext fallback)
    else Verified
        Reader->>Audit: Aggregated DECRYPT SUCCESS telemetry (record_count, table)
        Reader-->>Sync: Plaintext object for DTO mapping (cipher fields stripped)
    end
```

### 3.3 Distributed Sync, Locking & Checkpoint Lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant Trigger as scheduledSyncService (23:00) or Admin API
    participant Pipeline as ingestionPipelineService
    participant Lock as distributedLockService (veyra_distributed_locks)
    participant Ckpt as syncCheckpointService (veyra_sync_checkpoints)
    participant Oracle as Oracle Fusion (resilienceService)
    participant Monitor as syncMonitorService (veyra_sync_audit_event / alerts)

    Trigger->>Pipeline: runFullSync(oracleService, trigger)
    Pipeline->>Lock: acquireLock(__GLOBAL__:full) -> pg_try_advisory_lock + lease row
    alt Held by another replica (not expired)
        Lock-->>Pipeline: LOCK_CONTENTION
        Pipeline->>Monitor: Record LOCK_CONTENTION telemetry
        Pipeline-->>Trigger: Scheduled run skips cleanly / Manual API returns 409 SYNC_IN_PROGRESS
    else Lock Acquired
        Pipeline->>Oracle: Fetch domains via bounded exponential backoff (HTTP 429/5xx retry)
        alt Malformed record
            Pipeline->>Ckpt: quarantineRecord() -> veyra_sync_quarantine
        else Valid batch persisted encrypted
            Pipeline->>Ckpt: Advance watermark ONLY after DB commit
        end
        Pipeline->>Monitor: Record outcome (raise alert on failures >= 3 or ENCRYPTION_FAILURE)
        Pipeline->>Lock: Release advisory lock + delete lease row
    end
```

---

## 4. Delivered Security, Operations & Compliance API Reference

All endpoints below reflect exact paths and middleware guards verified in `backend/src/index.ts` and `backend/src/routes/api.ts`:

| Area | Endpoint | Auth / Guard | Purpose |
| :--- | :--- | :--- | :--- |
| **Health & Discovery** | `GET /health`, `GET /api/health` | Public (`helmet`) | Container liveness & Railway health check (`120s` timeout) |
| **JWKS Public Keys** | `GET /.well-known/jwks.json`, `GET /api/.well-known/jwks.json` | Public | RFC 7517 RSA public keys (`active` + `JWT_PREVIOUS_KEY_ID` during rollover) |
| **Auth Config & Login** | `GET /api/auth/provider`, `GET /api/auth/config`, `GET /api/auth/entra/start`, `POST /api/auth/entra/callback`, `POST /api/auth/login` | Public + `authRateLimiter` + `validateBody` | Discovery, OIDC PKCE callback, Local login returning RS256 JWS |
| **Session Lifecycle** | `GET /api/auth/status`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `POST /api/auth/reset-password` | `requireAuth` / `sessionRefreshRateLimiter` / `authRateLimiter` | Session check, sliding JWT rotation (upgrading legacy tokens in Phase 2), revocation, password reset |
| **Investigations** | `POST /api/investigations`, `GET /api/investigations/:id` | `requireAuth` + `isInvestigationAuthorized` | Owner or `SITE_ADMIN` scoped snapshot store (`403` + `PRIVILEGED_DATA_ACCESS` audit on IDOR) |
| **Crypto & Sync Health** | `GET /api/security/crypto-health`, `GET /api/security/ingestion-status`, `GET /api/security/sync-monitor`, `GET /api/security/sync-history`, `GET /api/security/sync-alerts` | `requireAdmin` | Crypto failure counters/503 status, ingestion metrics, sync monitor alerts & history |
| **Sync & Lock Recovery** | `GET /api/admin/sync/status`, `POST /api/admin/sync/full`, `GET /api/admin/locks`, `POST /api/admin/locks/recover-stale`, `POST /api/admin/locks/force-release` | `requireAuth` (status) / `requireAdmin` + `sensitiveAdminRateLimiter` | Inspect/trigger baseline sync and recover stale or stuck distributed locks |
| **Checkpoints & Quarantine** | `GET /api/admin/sync/checkpoints`, `GET /api/admin/sync/quarantine`, `POST /api/admin/sync/quarantine/:id/resolve` | `requireAdmin` | Inspect watermarks and triage or resolve dead-lettered records |
| **Secrets & Credential Rotation** | `GET /api/admin/security/secrets-status`, `POST /api/admin/security/rotate-secret`, `GET /api/admin/credentials/health`, `POST /api/admin/credentials/rotate` | `requireAdmin` + `sensitiveAdminRateLimiter` | Non-secret fingerprint/validation report and hot rotation for `oracle`, `jwt`, `kms`, `database` |
| **Abuse & Session Admin** | `POST /api/admin/sessions/cleanup`, `GET /api/admin/security/rate-limits`, `POST /api/admin/users/:email/unlock`, `POST /api/admin/security/rate-limits/reset` | `requireAdmin` | Expired session cleanup, brute-force account unlock, rate-limit diagnostics |
