# VYR-055: Secrets Management, Workload Identity & Rotation Runbook

- **Story ID**: VYR-055
- **Story Title**: Harden environment configuration and secrets management
- **Epic**: EPIC 6 — OWASP application and API security hardening
- **Branch Applicability**: Both (`standard-veyra-application-dev` & `veyra-application-dev`)
- **Status**: Implemented / Active
- **Classification**: Confidential — Internal Security & Operations Policy

---

## 1. Executive Summary & Objective

Story **VYR-055** hardens Veyra's environment configuration and secrets management across all deployment environments. It decouples credentials from application source and static configuration, moves database, Oracle Fusion, JWT signing, and KMS master keys into an approved secrets manager abstraction, leverages workload/managed identities where supported, enforces least-privilege scoping across backend services, strictly separates environments (`development`, `test`, `staging`, `production`), and provides a deterministic, tested procedure for routine key rotation and emergency incident response.

---

## 2. Secrets Taxonomy & Storage Architecture

Veyra categorizes application secrets into six strictly isolated domains:

| Category | Typical Variables | Secret Manager Target | Scope / Consumer |
| :--- | :--- | :--- | :--- |
| **DB_CREDENTIALS** | `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB` | AWS Secrets Manager / Azure Key Vault / File mount (`/run/secrets/db_password`) | `database`, `admin` |
| **ORACLE_CREDENTIALS** | `ORACLE_USERNAME`, `ORACLE_PASSWORD`, `ORACLE_TOKEN`, `ORACLE_FUSION_BASE_URL`, `ORACLE_AUTH_TYPE` | Secret Store / Dynamic Vault / File mount | `oracle_sync`, `admin` |
| **JWT_KEYS** | `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KEY_ID`, `JWT_PREVIOUS_KEY_ID`, `JWT_PREVIOUS_PUBLIC_KEY` | AWS Secrets Manager / Azure Key Vault / Protected HSM | `auth`, `admin` |
| **KMS_KEYS** | `ORACLE_ENCRYPTION_KEY`, `AWS_KMS_KEY_ARN`, `AZURE_KEY_VAULT_URL`, `VEYRA_KMS_KEY_ID` | AWS KMS / Azure Key Vault / Hardware KMS | `encryption`, `admin` |
| **ENTRA_CREDENTIALS** | `ENTRA_CLIENT_SECRET`, `ENTRA_CLIENT_ID`, `ENTRA_TENANT_ID`, `ENTRA_REDIRECT_URI` | Azure Key Vault / Managed Identity / Secret Store | `auth`, `admin` |
| **AI_KEYS** | `TOGETHER_API_KEY`, `GROQ_API_KEY` (AI-enabled variant only) | Secret Manager / Deployment Manifest | `admin` |

### Storage Backends Supported

1. **LocalEnvSecretBackend**:
   - Used for local development and non-production testing.
   - Supports environment profile prefix namespacing: `VEYRA_PRODUCTION_*`, `VEYRA_DEV_*`, etc.
2. **FileSecretBackend**:
   - Reads secrets from designated volumes mounted with POSIX permissions `0600` (e.g. `/run/secrets/` in Kubernetes / Docker Swarm).
   - Validates that files are not world-readable (`0777` or `0664` triggers security warnings).
3. **VaultSecretBackend / Cloud Secret Manager**:
   - Interfaces with HashiCorp Vault, AWS Secrets Manager, or Azure Key Vault via REST APIs and cloud client SDKs.
   - Binds directly to container and cloud workload identities without static master passwords.

---

## 3. Workload Identity & Managed Identity Integration

Static long-lived cloud credentials (such as AWS access key pairs or Azure client secrets) introduce substantial risk of credential leakage. Veyra eliminates static cloud keys by supporting federated **Workload Identities**:

```
+-------------------------------------------------------+
|                 Container / Pod                       |
|                                                       |
|  [ Veyra Backend (Node.js) ]                          |
|         │                                             |
|         ▼ (Federated token mount / Metadata endpoint) |
|  [ Workload Identity Token: /var/run/secrets/... ]    |
+──────────────────────────┬────────────────────────────+
                           │
                           ▼
   +──────────────────────────────────────────────────+
   | Cloud IAM / Identity Provider (STS / Entra ID)   |
   |                                                  |
   |  - AWS IRSA: AssumeRoleWithWebIdentity           |
   |  - Azure Managed Identity / AKS Workload Identity|
   |  - Kubernetes ServiceAccount Token Projection    |
   +───────────────────────┬──────────────────────────+
                           │
                           ▼ Short-lived IAM Session Token
   +──────────────────────────────────────────────────+
   | Key Management & Secret Stores                   |
   |  - AWS KMS / AWS Secrets Manager                 |
   |  - Azure Key Vault (Keys & Secrets)              |
   +──────────────────────────────────────────────────+
```

### Supported Identity Types

1. **AWS IAM Roles for Service Accounts (IRSA)**:
   - Detected via `AWS_ROLE_ARN` and `AWS_WEB_IDENTITY_TOKEN_FILE`.
   - Exchanges the projected Kubernetes service account OIDC token with AWS STS for a short-lived role session.
2. **Azure Managed Identity / AKS Workload Identity**:
   - Detected via `AZURE_FEDERATED_TOKEN_FILE` and `AZURE_CLIENT_ID`.
   - Authenticates against Azure AD token endpoints without requiring an `ENTRA_CLIENT_SECRET`.
3. **Kubernetes ServiceAccount Projection**:
   - Detected via `/var/run/secrets/kubernetes.io/serviceaccount/token`.
   - Scopes permissions to the local pod namespace and cluster RBAC policies.
4. **Local Host Process**:
   - Fallback mode for offline development and unit tests.

---

## 4. Least-Privilege Access Control Policy

Veyra enforces **least privilege** at the secret retrieval layer. A backend service may only access the secret categories strictly necessary for its operational function:

| Service Role | Allowed Secret Categories | Forbidden Secret Categories |
| :--- | :--- | :--- |
| **`database`** | `DB_CREDENTIALS` | `ORACLE_CREDENTIALS`, `JWT_KEYS`, `KMS_KEYS`, `ENTRA_CREDENTIALS` |
| **`oracle_sync`** | `ORACLE_CREDENTIALS` | `DB_CREDENTIALS`, `JWT_KEYS`, `KMS_KEYS`, `ENTRA_CREDENTIALS` |
| **`auth`** | `JWT_KEYS`, `ENTRA_CREDENTIALS` | `DB_CREDENTIALS`, `ORACLE_CREDENTIALS`, `KMS_KEYS` |
| **`encryption`** | `KMS_KEYS` | `DB_CREDENTIALS`, `ORACLE_CREDENTIALS`, `JWT_KEYS`, `ENTRA_CREDENTIALS` |
| **`admin`** | All categories (Administrative & Rotation Only) | None |

> [!CAUTION]
> If a service requests an unauthorized secret (for example, the `oracle_sync` worker attempting to fetch `JWT_PRIVATE_KEY` or the `auth` controller requesting `POSTGRES_PASSWORD`), `SecretsManager.getSecret()` throws `UnauthorizedSecretAccessError` and records an attributable `CONFIG_CHANGED` audit record with `result: 'DENIED'` and `details: { action: 'SECRET_ACCESS_DENIED' }`.

---

## 5. Environment Segregation & Production Gates

Veyra distinguishes between four deployment profiles: `development`, `test`, `staging`, and `production`.

### Strict Production Gates

When `NODE_ENV === 'production'` or `strict: true`:
1. **No Insecure Fallback Keys**:
   - `ORACLE_ENCRYPTION_KEY` matching `'default-fallback-security-key-oracle-fusion'` is **strictly prohibited**.
   - If detected during boot, application startup immediately terminates with a fail-closed exception.
2. **No Default Database Credentials**:
   - Passwords such as `'postgres'`, `'admin'`, or `'password'` on non-localhost database hosts are rejected.
3. **Explicit JWT RSA Signing Keys**:
   - Development ephemeral key generation is disabled; valid PEM/file path must be provided.
4. **Mandatory Secret Fingerprinting**:
   - All loaded secrets are fingerprinted with SHA-256 (`fp:a1b2c3d4e5f6`) to ensure audit traceability without leaking sensitive key material.

---

## 6. Secret Rotation Runbooks

### 6.1 Oracle Fusion Integration Credentials Rotation

- **Cadence**: Every 90 days or immediately upon suspected operator compromise.
- **Downtime**: 0 minutes (Zero Downtime).
- **Procedure**:
  1. Generate updated service account password or OAuth bearer token in Oracle Cloud Security Console.
  2. In Azure Key Vault or AWS Secrets Manager, update secret `ORACLE_PASSWORD` or `ORACLE_TOKEN`.
  3. Trigger automated rotation via administrative endpoint:
     ```bash
     curl -X POST https://api.veyra.corp/api/admin/security/rotate-secret \
       -H "Authorization: Bearer $ADMIN_JWT" \
       -H "Content-Type: application/json" \
       -d '{"target": "oracle", "payload": {"password": "NewSecretPassword123!"}}'
     ```
  4. The `SecretsManager` notifies `OracleCredentialProvider` and re-establishes the Oracle client connection pool.
  5. Inspect audit log to confirm `SECRET_ROTATED` event with before/after fingerprints.

### 6.2 JWT RSA Signing Key Rollover (RFC 7517 JWKS Dual-Key Window)

- **Cadence**: Every 180 days.
- **Downtime**: 0 minutes (Zero Downtime).
- **Procedure**:
  1. Generate new 2048-bit or 4096-bit RSA key pair:
     ```bash
     openssl genrsa -out veyra-jwt-key-2.pem 2048
     openssl rsa -in veyra-jwt-key-2.pem -pubout -out veyra-jwt-key-2.pub
     ```
  2. Set `JWT_PREVIOUS_KEY_ID` to current active `keyId`, and `JWT_PREVIOUS_PUBLIC_KEY` to current public key.
  3. Load the new key pair with `JWT_KEY_ID=veyra-jwt-key-2`.
  4. Both public keys are published at `GET /.well-known/jwks.json`, allowing in-flight tokens signed by the retiring key to validate seamlessly until their expiration window expires.
  5. After all old tokens expire (e.g. 24 hours), retire the previous public key.

### 6.3 KMS Master Key (KEK) Rotation & DEK Re-Wrapping

- **Cadence**: Annually (or per compliance requirement).
- **Procedure**:
  1. In AWS KMS or Azure Key Vault, enable automatic annual key rotation on the customer-managed key (CMK/KEK), or create a new key version (`veyra-kms-k2-2027`).
  2. Execute Veyra's Key Rotation Service:
     ```bash
     npm run test:vyr36 --prefix backend
     ```
  3. `keyRotationService` reads existing database records, un-wraps DEKs using the retiring key version, and re-wraps DEKs with the new active KEK.

### 6.4 PostgreSQL Database Password Rotation

- **Cadence**: Every 90 days.
- **Procedure**:
  1. In PostgreSQL, configure dual-credential access or update the service account password.
  2. Update `DATABASE_URL` or `POSTGRES_PASSWORD` in the secret manager.
  3. Call `/api/admin/security/rotate-secret` with target `database`.
  4. Connection pool gracefully establishes new worker connections with the updated credentials.

---

## 7. Incident Response & Secret Compromise Runbook

### Emergency Response SLA: < 15 Minutes

```
[ Compromise Suspected ]
         │
         ▼
[ Step 1: Emergency Revocation ] ────► Invalidate cache & revoke secret
         │
         ▼
[ Step 2: Emergency Key Rollover ] ──► Issue new credentials in Secret Store
         │
         ▼
[ Step 3: Session Invalidation ] ────► Terminate active JWT user sessions
         │
         ▼
[ Step 4: Forensic Audit Review ] ───► Verify unauthorized access in Audit Logs
```

### Step 1: Immediate Containment & Eviction
Execute immediate secret revocation via `SecretsManager.revokeSecret(key, reason)`.
This invalidates all in-memory caches and logs an emergency `SECURITY_INCIDENT_TRIGGERED` event.

### Step 2: Force Session Invalidation
If the compromised secret is a JWT private key or database password:
1. Revoke all active sessions in `veyra_session` via `POST /api/admin/sessions/cleanup`.
2. Cycle the JWT signing key ID (`keyId`), forcing all clients to re-authenticate.

### Step 3: Forensic Inspection
Query the immutable security audit log for the compromised secret's fingerprint:
```sql
SELECT timestamp, event_type, user_id, service_identity, result, details
FROM veyra_security_audit_events
WHERE details->>'secretKey' = 'ORACLE_PASSWORD'
   OR details->>'action' = 'SECRET_ACCESS_DENIED'
ORDER BY timestamp DESC;
```

---

## 8. Verification & Acceptance Evidence

- **AC 1 (No Production Secrets in Source Control or Bundle)**:
  - `.gitignore` strictly blocks all `.env*` files, `.pem` files, `.key` files, and JSON credentials.
  - React production build output (`frontend/dist/assets/*.js`) contains 0 credentials or secret tokens.
- **AC 2 (Least Privilege Enforced)**:
  - `SecretsManager` verifies service permissions before returning values.
  - Out-of-scope calls fail closed with `UnauthorizedSecretAccessError`.
- **AC 3 (Secret Rotation Procedure Tested)**:
  - Automated rotation suite (`test_story_055_secrets_management.cjs`) exercises rotation for Oracle, JWT, KMS, and DB credentials with full continuity verification.
