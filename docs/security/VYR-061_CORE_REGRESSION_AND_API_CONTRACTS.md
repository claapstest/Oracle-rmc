# VYR-061: Core Module Regression & API Contract Comparison

- **Story ID:** `VYR-061`
- **Epic:** `EPIC 7 — Security, branch, regression and release testing`
- **Contract Baseline Version:** `v2.0.0` (Post-Epics 1–6 Security & Encryption Hardening)
- **Previous Baseline Version:** `v1.0.0` (Pre-Security Programme Baseline)
- **Branches Covered:**
  - `standard-veyra-application-dev` (AI-Free variant)
  - `veyra-application-dev` (AI-Enabled variant)
- **Verification Script:** `backend/scripts/test_story_061_core_regression_and_contracts.cjs` (`npm --prefix backend run test:vyr61`)

---

## 1. Purpose & Scope

This document satisfies **VYR-061** Acceptance Criteria:
1. All in-scope core Veyra business workflows pass in both AI-free and AI-enabled branches.
2. No unauthorized data exposure (plaintext credentials, DEKs, ciphertexts, nonces, authTags, PII JWT claims, or cross-tenant records) or material API regression occurs.
3. Every API contract change introduced across Epics 1–6 (branch split, configurable auth providers, RS256 JWT/JWS, AES-256-GCM envelope encryption, scheduled ingestion, and OWASP ASVS hardening) is explicitly documented and versioned.

### In-Scope Functional Modules
1. **Authentication, JWT & Session Lifecycle** (`/api/auth/*`, `/api/.well-known/jwks.json`, `/api/capabilities`)
2. **Dashboards & Role Scoping** (`/api/dashboard/admin`, `/api/dashboard/audit-manager`, `/api/dashboard/audit-supervisor`, `/api/dashboard/reports-only`, `/api/dashboard/*/db/*`, `/api/overview/stats`)
3. **Users Management** (`/api/users`, `/api/users/:id`, `/api/users/:id/scopes`, `/api/admin/users/*`)
4. **Roles, Privileges & Entitlement Catalog** (`/api/roles`, `/api/roles/*`, `/api/privileges`, `/api/catalog/*`, `/api/privilege-roles/*`)
5. **Audit Trail** (`/api/audit/products`, `/api/audit`, `/api/audit/query`, `/api/audit/sync`, `/api/audit/sync/product`)
6. **Advanced Controls, Incidents, SoD & Access Certifications** (`/api/risk/controls*`, `/api/risk/incidents*`, `/api/risk/sod`, `/api/risk/access-requests*`, `/api/sync/policies*`, `/api/access-certifications*`, `/api/risk/certifications`)
7. **Reports** (`/api/reports`, `/api/reports/db*`, `/api/reports/:id`, `/api/reports/:id/download`, `/api/reports/role-hierarchy`, `/api/reports/user-access`, `/api/reports/role-privilege-summary`, `/api/risk/reports/control-summary*`)
8. **Oracle Settings & API Command Center** (`/api/settings*`, `/api/admin/oracle/*`, `/api/command-center/*`)
9. **Investigation Workflows** (`POST /api/investigations`, `GET /api/investigations/:id`)

---

## 2. Pre- vs Post-Encryption API DTO Comparison

Across **Epic 4 (VYR-027–VYR-038)** and **Epic 5 (VYR-039–VYR-046)**, raw Oracle Fusion payloads in PostgreSQL (`oracle_raw_users`, `oracle_raw_roles`, `oracle_raw_role_hierarchy`, `oracle_raw_audit_records`, `oracle_raw_controls`, `oracle_control_incidents`, `oracle_incident_rows`, `oracle_raw_access_certifications`, `oracle_raw_certifier_worksheets`, `oracle_raw_user_access`) are encrypted at rest using **AES-256-GCM** envelope encryption (`EncryptedPayload` v1 with canonical AAD `tenant=<host>|table=<table>|id=<recordId>|v=v1`).

All authorized backend read paths route rows through `decryptedRecordReader.ts` (`decryptRawRows` / `decryptSingleRawField`) in Node.js **after** authentication, RBAC, and tenant checks. Consequently, HTTP response DTOs remain **structurally unchanged** for React consumers:

| Domain / Service | Encrypted DB Column | Read Decryption Path | HTTP DTO Contract Change? | Forbidden Fields Verified Absent from HTTP DTOs |
| :--- | :--- | :--- | :--- | :--- |
| **Users Directory** (`userRoleRawDbService`) | `oracle_raw_users.raw_user` | `decryptRawRows` / `decryptSingleRawField` | **None** (identical `username`, `email`, `displayName`, `roles`, `active` DTO) | `encryptedDek`, `ciphertext`, `authTag`, `nonce`, `passwordHash`, `resetCode` |
| **Roles Catalog** (`userRoleRawDbService`) | `oracle_raw_roles.raw_role` | `decryptRawRows` / `decryptSingleRawField` | **None** (identical `roleCode`, `displayName`, `category`, `module` DTO) | `encryptedDek`, `ciphertext`, `authTag`, `nonce` |
| **Audit Trail** (`auditRawDbService`) | `oracle_raw_audit_records.raw_payload` | `decryptRawRows` | **None** (identical `logs[]` with `username`, `action`, `details`, `timestamp`) | `encryptedDek`, `ciphertext`, `authTag`, `nonce` |
| **Advanced Controls & Incidents** (`controlRawDbService`) | `oracle_raw_controls.raw_payload`, `oracle_control_incidents.raw_incidents`, `oracle_incident_rows.raw` | `decryptRawRows` / `decryptSingleRawField` | **None** (identical control & incident page DTOs) | `encryptedDek`, `ciphertext`, `authTag`, `nonce` |
| **Access Certifications** (`accessCertRawDbService`) | `oracle_raw_access_certifications.raw_data`, `oracle_raw_certifier_worksheets.raw_data` | `decryptSingleRawField` | **None** (identical campaign summary & worksheet row DTOs) | `encryptedDek`, `ciphertext`, `authTag`, `nonce` |

> **Fail-Closed Guarantee (VYR-038):** If ciphertext, nonce, authTag, or AAD is tampered with, decryption throws `ProtectedDataError` and never falls back to returning encrypted wrapper fields or plaintext fallback blobs to the client.

---

## 3. Versioned API Contract Changelog (`v1.0.0` -> `v2.0.0`)

The following intentional security and variant contract changes were introduced in Epics 1–6 and verified in `test:vyr61`:

### 3.1 Authentication & Token Contract (`v2.0.0` — Epics 2 & 3)
| Endpoint | `v1.0.0` Behavior | `v2.0.0` Behavior | Story Ref |
| :--- | :--- | :--- | :--- |
| `GET /api/auth/provider`, `GET /api/auth/config` | Not present (implicit local login) | Exposes active `AUTH_PROVIDER` (`LOCAL` or `ENTRA`), non-secret Entra metadata, and `sessionTimeoutMinutes`. | VYR-010, VYR-016 |
| `GET /.well-known/jwks.json`, `GET /api/.well-known/jwks.json` | Not present | Publishes RFC 7517 RSA public keys for `RS256` token verification and key rollover. | VYR-020, VYR-022 |
| `POST /api/auth/login` | Issued opaque session string in `token`; ignored `provider` field. | Issues signed `RS256` JWS (`typ: at+jwt`, `kid`, minimal claims `iss`, `sub`, `aud`, `sid`, `jti`, `iat`, `nbf`, `exp`; zero PII/roles). Returns `token`, `accessToken`, `sessionId`, `authProvider`. Rejects client `provider` override with **400 `PROVIDER_OVERRIDE_REJECTED`**. | VYR-016, VYR-019, VYR-020 |
| `POST /api/auth/refresh` | Extended opaque session expiry only. | Rotates and returns a fresh short-lived `RS256` JWT (`token`, `accessToken`, `sessionId`, `lastActivityAt`, `expiresAt`); fails closed on revoked sessions (**401**). | VYR-024 |
| `POST /api/auth/logout` | Local session deletion. | Immediately revokes `veyra_session` (rejecting subsequent JWT use with **401**) and returns `{ success, localLogout, sessionInvalidated, authProvider, upstreamSignoutSupported, upstreamLogoutUrl }`. | VYR-017, VYR-024 |
| `GET /api/auth/entra/start`, `POST /api/auth/entra/callback` | Not present | BFF Authorization Code + PKCE flow (`ENTRA` mode); returns **404 `ENTRA_NOT_CONFIGURED`** when `AUTH_PROVIDER=LOCAL`. | VYR-011 |

### 3.2 Request Validation, Rate Limiting, Headers & Tenant Isolation (`v2.0.0` — Epic 6)
| Control / Endpoint Group | `v1.0.0` Behavior | `v2.0.0` Behavior | Story Ref |
| :--- | :--- | :--- | :--- |
| Zod Schema Validation (`validateBody`) | Ad-hoc `400` checks; unrecognized fields ignored. | Strict/allowlisted Zod DTO validation; invalid types/missing required schema fields/extra `.strict()` properties return **422 `VALIDATION_ERROR`** with structured `errors[]`. | VYR-049 |
| Content-Type & Body Limits | Global `50mb` JSON limit; no content-type allowlist. | Global `2mb` limit + per-route `enforceBodySizeLimit` (**413 `PAYLOAD_TOO_LARGE`**) + `enforceContentType` (**415 `UNSUPPORTED_MEDIA_TYPE`**). | VYR-049 |
| Rate Limiting & Lockout | Unthrottled login and admin endpoints. | Tiered sliding-window limiters (`auth`, `session-refresh`, `admin`, `api`, `tenant`) returning **429 `RATE_LIMIT_EXCEEDED`** / **`ACCOUNT_LOCKED`** with `Retry-After`. | VYR-048 |
| Security Headers & Cache | Basic CORS. | Helmet CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, strict CORS allowlist, and `Cache-Control: no-store` on `/api/*`. | VYR-050 |
| SSRF URL Policy (`validateAndNormalizeUrl`) | Accepted arbitrary `baseUrl` / Command Center URLs. | Blocks loopback, link-local metadata (`169.254.169.254`), and private RFC1918 targets with **400**. | VYR-051 |
| Tenant & Privilege Guards | Implicit tenant / ad-hoc admin checks. | `enforceTenantIsolation` rejects mismatched `tenantId`/`environment_host` with **403 `TENANT_MISMATCH`**; `preventPrivilegeEscalation` & `preventSelfModification` return **403**. | VYR-052 |
| Settings Sanitization (`sanitizeSettingsResponse`) | Returned raw fields or partial masks. | Strips `password`, `token`, `clientSecret`, `privateKey`, `secret`, `encryptionKey`, and AI credentials from `/api/settings` and `/api/admin/oracle/integration`. | VYR-055 |

### 3.3 Branch Variant Contract Split (`v2.0.0` — Epic 1)
| Endpoint / Field | AI-Enabled (`veyra-application-dev`) | AI-Free (`standard-veyra-application-dev`) |
| :--- | :--- | :--- |
| `POST /api/chat` | Registered with `requireAskVeyra` (`SITE_ADMIN`/`AUDIT_MANAGER` allowed; `AUDIT_SUPERVISOR`/`AUDIT_USER` -> **403**). | Unregistered -> **404 Not Found** for all roles. |
| `POST /api/ai/universal-query`, `GET /api/ai/universal-traces`, `GET /api/database/schema*` | Registered with `requireAuth` / `requireAdmin` (VYR-052). | Unregistered -> **404 Not Found**. |
| `userScope.hasAskVeyraAccess` & `userScope.features.askVeyra` | `true` for `SITE_ADMIN`/`AUDIT_MANAGER`; `false` for `AUDIT_SUPERVISOR`/`AUDIT_USER`. | Retained as `false` for API schema compatibility; `AI_ASSISTANT` omitted from `authorizedModules`. |
| `GET /api/settings`, `GET /api/admin/oracle/integration` | Retains non-secret AI metadata (`hasGeminiKey` boolean, `groqModel`), while stripping raw API keys. | Removes `hasGeminiKey`, `groqModel`, and `togetherModel` completely. |

---

## 4. Verification Execution Record

Executed via `npm --prefix backend run test:vyr61` (`test_story_061_core_regression_and_contracts.cjs`) against live Express + PostgreSQL runtime on both branches:

| Check | `standard-veyra-application-dev` (AI-Free) | `veyra-application-dev` (AI-Enabled) |
| :--- | :--- | :--- |
| Backend TypeScript Build (`tsc`) | **PASS** (0 errors) | **PASS** (0 errors) |
| Frontend Build (`tsc -b && vite build`) | **PASS** (0 errors, 1,520 modules) | **FAIL** (pre-existing TS2339 in `frontend/src/components/AdvancedControlsModule.tsx:2093` — `Property 'creationDate' does not exist on type 'AdvancedControlRecord'`) |
| Core Regression & API Contract Suite (`VYR-061`) | **PASS** (158/158 passed, 0 failed) | **PASS** (157/157 passed, 0 failed) |
