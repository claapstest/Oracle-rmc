# VYR-047 — OWASP ASVS / API Security Gap Assessment

**Epic**: EPIC 6 — OWASP Application and API Security Hardening  
**Story**: VYR-047 — Perform OWASP ASVS/API Security gap assessment  
**Verification Target**: OWASP ASVS Level 2  
**Date**: 2026-11-16  
**Assessed By**: Sravanth-sowri  
**Scope**: Full-stack — Express.js backend, React frontend, PostgreSQL data stores, Oracle Fusion integration  

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 4 |
| HIGH     | 8 |
| MEDIUM   | 8 |
| LOW      | 5 |
| **TOTAL** | **25** |

---

## Gap Register

The table below contains each finding with: ID, OWASP category, severity, affected component, finding description, remediation, and verification evidence required.

---

### CRITICAL Findings

| ID | OWASP Category | ASVS Section | Severity | Affected Component | Finding | Remediation | Verification Evidence |
|----|---------------|--------------|----------|-------------------|---------|-------------|----------------------|
| GAP-001 | A03:2021 Injection / API8 Security Misconfiguration | V5.3 | CRITICAL | `backend/src/routes/api.ts` lines 2041-2045 | **SQL Injection via AI-generated query interpolation.** The AskVeyra AI intent handler constructs SQL queries by interpolating `aiResponse.parameters` directly into SQL strings (e.g., `certificationId`, `controlId`, `controlName`, `limit`). Although the SQL validator service exists for the chatbot path, these fallback queries in api.ts bypass it entirely. An attacker controlling AI parameters could inject arbitrary SQL. | Replace all string interpolation with parameterized queries (`$1`, `$2`, etc.) or route all generated SQL through `sqlValidatorService.validateAndSanitizeSql()` before execution. | Run SAST scan confirming zero unparameterized SQL in api.ts; manual pentest with crafted certificationId/controlName payloads returns sanitized results only. |
| GAP-002 | A07:2021 Identification & Auth Failures | V2.2 | CRITICAL | `backend/src/services/authService.ts`, `backend/src/routes/api.ts` login endpoints | **No account lockout or login rate limiting.** There is no failed-login counter, no account lockout after N attempts, and no rate limiter on `/api/auth/login` or `/api/auth/entra/callback`. The `express-rate-limit` package is not installed. This allows unlimited brute-force password attacks. | Install `express-rate-limit`; apply a rate limiter to auth endpoints (e.g., 5 attempts per IP per 15 minutes). Implement account lockout after 5 consecutive failures with exponential backoff and admin unlock. | Automated test proving 6th login attempt within 15 min returns 429; account shows LOCKED status in DB; admin can unlock. |
| GAP-003 | A05:2021 Security Misconfiguration | V14.4 | CRITICAL | `backend/src/index.ts` line 26-29 | **CORS allows all origins.** The CORS configuration uses `origin: true` with `credentials: true`, which reflects any requesting origin back in `Access-Control-Allow-Origin`. This allows any website to make authenticated cross-origin requests and read the responses (credential theft, data exfiltration). | Restrict `origin` to a strict allowlist: `[process.env.FRONTEND_URL]` or a specific list of production/staging origins. Never use `origin: true` with `credentials: true`. | Browser-based CORS test from unauthorized origin returns no `Access-Control-Allow-Origin` header. |
| GAP-004 | A02:2021 Cryptographic Failures | V6.2 | CRITICAL | `backend/src/config.ts` line 89 | **Hardcoded fallback encryption key for Oracle credential storage.** `ENCRYPTION_KEY_RAW` falls back to a hardcoded string literal when `ORACLE_ENCRYPTION_KEY` env var is unset. In production, if the env var is accidentally missing, all Oracle credentials are encrypted with a publicly known key. | Remove the hardcoded fallback. Fail startup with a clear error if `ORACLE_ENCRYPTION_KEY` is not set in production (`NODE_ENV=production`). Log a warning in development. | Production startup with missing `ORACLE_ENCRYPTION_KEY` returns non-zero exit code; dev startup logs warning and generates ephemeral key. |

---

### HIGH Findings

| ID | OWASP Category | ASVS Section | Severity | Affected Component | Finding | Remediation | Verification Evidence |
|----|---------------|--------------|----------|-------------------|---------|-------------|----------------------|
| GAP-005 | A05:2021 Security Misconfiguration | V14.4 | HIGH | `backend/src/index.ts` | **No security HTTP headers (Helmet).** The `helmet` package is not installed or used. Missing headers: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, `Referrer-Policy`, `Permissions-Policy`. This exposes the app to clickjacking, MIME-type sniffing, and missing HSTS. | Install `helmet` and apply `app.use(helmet())` with a tuned CSP policy before route registration. | Response headers inspection confirms all OWASP-recommended security headers are present. |
| GAP-006 | A01:2021 Broken Access Control / API1 Broken Object Level Auth | V4.1 | HIGH | `backend/src/routes/api.ts` lines 751, 775 | **No object-level authorization on investigations.** `POST /investigations` and `GET /investigations/:id` use `requireAuth` but do not verify that the requesting user owns or has access to the specific investigation. Any authenticated user can read any investigation by ID. | Add ownership check: `if (investigation.userId !== res.locals.userId && !res.locals.isAdmin)` return 403. | Pentest: User A creates investigation; User B (non-admin) requests it by ID — receives 403. |
| GAP-007 | A08:2021 Software & Data Integrity | V1.14 | HIGH | `backend/src/index.ts` line 62 | **Request body size limit too large (50MB).** `express.json({ limit: '50mb' })` and `express.urlencoded({ limit: '50mb' })` allow extremely large payloads. This enables denial-of-service via memory exhaustion and payload-based attacks. | Reduce to a sensible default (e.g., `1mb` or `5mb` for general routes). If specific routes need larger payloads (file upload), apply per-route limits using middleware. | Load test: 50MB POST to a standard endpoint returns 413; file-upload route still accepts valid sizes. |
| GAP-008 | A04:2021 Insecure Design | V3.5 | HIGH | `backend/src/services/authService.ts` line 89 | **Sessions stored only in-memory.** `activeSessions` is a plain `Map`. Server restart loses all sessions (users forced to re-login). In a multi-replica deployment, sessions are not shared — a user authenticated on replica A gets 401 on replica B. | Migrate session storage to PostgreSQL or Redis with TTL-based cleanup. Consider using JWT-only stateless auth (already partially implemented). | Multi-replica test: login on replica A, request to replica B succeeds; server restart preserves sessions. |
| GAP-009 | A09:2021 Security Logging & Monitoring | V7.1 | HIGH | `backend/src/routes/api.ts` lines 680, 693, 797, 818 | **Internal error messages exposed to clients.** Multiple catch blocks return `err.message` directly in JSON responses (e.g., `Failed to retrieve sync history: ${err.message}`). Internal error details (DB connection strings, file paths, stack info) can leak to attackers. | Return generic error messages to clients. Log full error details server-side only. Use error codes for client-facing responses. | Forced DB error returns generic `"Internal server error"` to client; full details appear only in server logs. |
| GAP-010 | A07:2021 Identification & Auth Failures | V2.1 | HIGH | `backend/src/services/authService.ts` line 510, `localUserProvisioningService.ts` line 158 | **Hardcoded default passwords in provisioning.** Admin seeding falls back to a well-known weak default and dev seed uses another common default. If seed scripts run in production without overriding, all accounts have known passwords. | Require passwords via environment variables in production. Fail seed scripts if no password is provided when `NODE_ENV=production`. Generate random strong passwords for dev/test environments. | Production seed without `ADMIN_PASSWORD` env var fails with error; dev seed generates unique random password per run. |
| GAP-011 | A01:2021 Broken Access Control / API5 Broken Function Level Auth | V4.2 | HIGH | `backend/src/routes/api.ts` | **Inconsistent privilege checks across routes.** Some admin routes use `requireAdmin`, others use `requirePrivilege('USER_MANAGEMENT')`, and role-based access is hardcoded in inline middleware (e.g., checking `userRole === 'AUDIT_MANAGER'` directly). No centralized RBAC policy engine. Privilege escalation risk if role names change. | Centralize authorization into a policy engine or middleware factory that maps routes to required privileges from a config file. Eliminate inline role-name string comparisons. | All routes verified against a privilege matrix; no route is accessible without correct privilege. |
| GAP-012 | A02:2021 Cryptographic Failures | V6.1 | HIGH | `backend/src/config.ts` lines 88-99 | **AES-256-CBC without HMAC authentication.** Oracle credential encryption uses AES-256-CBC without an authentication tag (no HMAC-then-encrypt or GCM). This is vulnerable to padding oracle attacks — an attacker who can observe or modify ciphertext can potentially decrypt it. | Migrate to AES-256-GCM (already used by the KMS provider in `kmsProvider.ts`). Apply the same authenticated encryption pattern to the config credential store. | Unit test: tampered ciphertext (flipped byte) throws authentication error instead of decrypting to garbage. |

---

### MEDIUM Findings

| ID | OWASP Category | ASVS Section | Severity | Affected Component | Finding | Remediation | Verification Evidence |
|----|---------------|--------------|----------|-------------------|---------|-------------|----------------------|
| GAP-013 | A08:2021 Software Integrity | V14.2 | MEDIUM | `backend/package.json` | **No input validation library installed.** No `express-validator`, `joi`, `zod`, or `ajv` in dependencies. Request body validation is ad-hoc (manual `if (!field)` checks). This increases risk of type confusion, mass assignment, and missing validation on new endpoints. | Install `zod` or `express-validator`. Create validation middleware for all POST/PUT/PATCH endpoints. | Every POST endpoint has a validation schema; invalid payloads return 422 with structured error. |
| GAP-014 | A05:2021 Security Misconfiguration | V14.3 | MEDIUM | `backend/src/routes/api.ts` ENTRA callback | **CSRF protection only for Entra flow, not general forms.** The Entra OIDC callback uses a state cookie for CSRF protection, but no general CSRF middleware exists for other state-changing POST endpoints. Token-based auth mitigates browser-form CSRF, but any route that also accepts cookie auth is vulnerable. | Add CSRF token middleware for any route accessible via browser session/cookie. Since JWT Bearer is the primary auth, document this as an accepted residual risk if cookies are never used for auth. | Security review confirms no cookie-based auth is used for state-changing routes; documented in risk register. |
| GAP-015 | API3:2023 Broken Object Property Level Auth | V4.3 | MEDIUM | `backend/src/routes/api.ts` user management routes | **Mass assignment risk on user update endpoints.** `POST /admin/users/toggle-status` and user update routes accept `req.body` fields without an explicit allowlist. If the handler passes the body directly to a DB update, an attacker could modify unintended fields (e.g., `isAdmin`, `role`). | Destructure only allowed fields from `req.body`. Use a validation schema that whitelists permitted properties. | Pentest: POST with `{isAdmin: true}` alongside valid fields — `isAdmin` field is ignored. |
| GAP-016 | A09:2021 Security Logging | V7.3 | MEDIUM | `backend/src/index.ts` logger middleware | **Request body logging may capture sensitive data.** The logger middleware masks `password` and `token` fields but does not mask other sensitive fields (e.g., `resetCode`, `newPassword`, `creditCard`, `ssn`). Custom payloads with sensitive data in non-standard field names are logged in plaintext. | Extend the mask list to include all known sensitive fields. Consider logging only request method, path, status, and duration — never body content in production. | Audit: no sensitive field values appear in production logs after remediation. |
| GAP-017 | API4:2023 Unrestricted Resource Consumption | V11.1 | MEDIUM | All API endpoints | **No API rate limiting on any endpoint.** Beyond the login rate limiting gap (GAP-002), no rate limiting exists on any API endpoint. High-volume automated requests can cause DoS, data scraping, or abuse of the AI chatbot. | Install `express-rate-limit` with tiered limits: strict on auth endpoints (5/15min), moderate on API (100/min), relaxed on read-only health endpoints. | Load test: 101st request in 60 seconds to a protected endpoint returns 429 Too Many Requests. |
| GAP-018 | A06:2021 Vulnerable Components | V14.2 | MEDIUM | `backend/package.json`, `frontend/package.json` | **No automated dependency vulnerability scanning.** No `npm audit`, Snyk, or Dependabot configured in CI. Vulnerable transitive dependencies may exist undetected. | Add `npm audit --audit-level=high` to CI pipeline. Configure Dependabot or Snyk for automated PR-based updates. | CI pipeline fails on HIGH+ vulnerability; Dependabot PRs are visible in GitHub. |
| GAP-019 | A05:2021 Security Misconfiguration | V14.1 | MEDIUM | `backend/src/index.ts` | **No global error handler.** Express has no `app.use((err, req, res, next) => ...)` error-handling middleware. Unhandled errors in async routes may crash the process or return Express default HTML error pages (leaking framework info). | Add a global Express error handler that catches all unhandled errors, logs them, and returns a generic JSON response. | Forced unhandled async error in a route returns JSON `{success: false, message: "Internal server error"}` with 500 status. |
| GAP-020 | A01:2021 Broken Access Control | V4.1 | MEDIUM | Frontend auth token storage | **Auth token stored in sessionStorage.** `frontend/src/services/api.ts` stores JWT in `sessionStorage.getItem('authToken')`. While safer than `localStorage` (cleared on tab close), it is still accessible to any XSS attack. The tab-transfer bridge also briefly stores the token in `localStorage`. | If XSS is fully mitigated (no `dangerouslySetInnerHTML`, strict CSP), this is acceptable for SPA. Document as accepted risk. If higher security needed, use httpOnly cookies for token transport. | XSS audit confirms zero `dangerouslySetInnerHTML`/`innerHTML` usage; CSP blocks inline scripts. |

---

### LOW Findings

| ID | OWASP Category | ASVS Section | Severity | Affected Component | Finding | Remediation | Verification Evidence |
|----|---------------|--------------|----------|-------------------|---------|-------------|----------------------|
| GAP-021 | A05:2021 Security Misconfiguration | V14.4 | LOW | `backend/src/index.ts` JWKS endpoint | **JWKS cache header allows public caching.** `Cache-Control: public, max-age=300` on `/.well-known/jwks.json`. While standard, if a CDN or proxy caches the JWKS, key revocation may take up to 5 minutes to propagate. | Reduce `max-age` to 60 in production or use `private` caching with `s-maxage` for CDNs. | JWKS response header shows tuned cache policy; key revocation test shows propagation within 60s. |
| GAP-022 | A02:2021 Cryptographic Failures | V6.4 | LOW | `backend/src/auth/keyManager.ts` | **Ephemeral RSA keys in development.** When no RSA keys are configured, the key manager generates ephemeral 2048-bit keys at startup. This is fine for dev but means all sessions are lost on restart and tokens cannot be verified across processes. | Add startup warning in non-development environments. Fail in production if no keys are configured. | Production startup without RSA keys exits with error; development logs visible warning. |
| GAP-023 | A04:2021 Insecure Design | V2.5 | LOW | `backend/src/services/authService.ts` | **Password policy has no breach/dictionary check.** Password validation checks length, uppercase, lowercase, number, and special character — but does not check against breached password databases (e.g., Have I Been Pwned API) or common password dictionaries. | Integrate `hibp` npm package or a local dictionary check to reject known-breached passwords. | Password reset with `Password1!` (common breached password) is rejected. |
| GAP-024 | A09:2021 Security Logging | V7.2 | LOW | General | **No structured logging framework.** All logging uses `console.log`/`console.error`/`console.warn`. No structured format (JSON), no log levels, no correlation IDs in general request flow (only in sync monitoring). Hard to aggregate, search, and alert on in production. | Adopt `pino` or `winston` for structured JSON logging with configurable levels. Add request correlation IDs via middleware. | All log output is valid JSON with timestamp, level, correlationId; `grep` for a specific request ID returns full trace. |
| GAP-025 | A05:2021 Security Misconfiguration | V14.5 | LOW | Frontend build serving | **Static file serving has no cache-busting headers.** `express.static(frontendDistPath)` uses default caching. Updated frontend builds may be served stale from browser cache. | Add `Cache-Control: no-cache` for `index.html` and long-lived immutable caching for hashed assets (`/assets/*`). | Browser cache test: updated deployment serves new HTML immediately; hashed JS/CSS files have `immutable` cache headers. |

---

## Strengths (Controls Already in Place)

| Control | Evidence |
|---------|----------|
| RS256 JWT with strict contract (VYR-019/020) | `jwtContract.ts` — required claims, forbidden claims (no PII), 15-min lifetime, JWKS publication |
| Forbidden claim enforcement | `tokenService.ts` — rejects tokens containing email, password, roles, etc. |
| JWT cryptographic verification | `tokenService.ts` — RS256 signature verification against JWKS, algorithm pinning |
| Session re-validation on every request | `jwtAuthMiddleware.ts` — validates JWT + session + account status per request |
| Key rotation support with revocation | `keyManager.ts` — supports rotated keys in JWKS, emergency revocation via env var |
| Password hashing with bcrypt | `LocalAuthenticationProvider.ts` — bcrypt with salt rounds 10-12 |
| Password complexity policy | `authService.ts` — 8+ chars, upper, lower, number, special character |
| Encrypted Oracle credential storage | `config.ts` — AES-256-CBC encryption for persisted Oracle credentials |
| SQL validator for AI chatbot queries | `sqlValidatorService.ts` — AST parsing, destructive keyword blocking, statement stacking prevention |
| Sensitive field masking in logs | `index.ts` — password/token masking in request logger |
| Crypto audit trail (VYR-038) | `cryptoAuditService.ts` — tracks all encryption/decryption operations with alerting |
| Encryption preflight guard (VYR-041) | `ingestionEncryptionGuard.ts` — blocks sync if encryption subsystem is unhealthy |
| Service identity for non-interactive operations (VYR-042) | `serviceIdentity.ts` — dedicated workload identities, no human JWT reuse |
| Distributed locking (VYR-043) | `distributedLockService.ts` — prevents concurrent sync across replicas |
| Sync monitoring and alerting (VYR-045) | `syncMonitorService.ts` — operational audit events, failure/staleness/contention alerts |
| No `dangerouslySetInnerHTML` in React | Grep confirms zero usage — XSS via React rendering is mitigated |
| Entra OIDC state cookie with httpOnly + sameSite | `api.ts` — CSRF protection on Entra callback flow |
| Audit event recording | `auditService.ts` — login, session, admin actions recorded |

---

## Remediation Priority Matrix

| Priority | Findings | Target Sprint |
|----------|----------|---------------|
| P0 — Fix immediately | GAP-001 (SQL injection), GAP-002 (brute force), GAP-003 (CORS), GAP-004 (hardcoded key) | VYR-048/049 |
| P1 — Fix this epic | GAP-005 (Helmet), GAP-007 (body size), GAP-009 (error leakage), GAP-010 (default passwords), GAP-012 (CBC→GCM) | VYR-048–052 |
| P2 — Fix next epic | GAP-006 (object auth), GAP-008 (session store), GAP-011 (RBAC centralization), GAP-013 (validation lib), GAP-017 (rate limiting) | EPIC 7 |
| P3 — Planned improvement | GAP-014–016, GAP-018–025 | Backlog |

---

## Approval

| Role | Name | Date | Decision |
|------|------|------|----------|
| Security Lead | ___________________ | __________ | ASVS Level 2 target approved / not approved |
| Product Owner | ___________________ | __________ | Remediation priorities approved / adjusted |
| Engineering Lead | ___________________ | __________ | Implementation timeline agreed |

---

*This assessment uses OWASP ASVS v4.0.3 Level 2 as the verification standard and OWASP Top 10:2021 + OWASP API Security Top 10:2023 as the risk classification frameworks.*
