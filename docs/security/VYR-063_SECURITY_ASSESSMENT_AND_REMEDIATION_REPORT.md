# VYR-063: Security Assessment, Penetration Test & Remediation Report

- **Story ID:** `VYR-063`
- **Epic:** `EPIC 7 — Security, branch, regression and release testing`
- **Baseline Standard:** OWASP ASVS v4.0.3 Level 2, OWASP Top 10:2021, OWASP API Security Top 10:2023
- **Reference Register:** [VYR-047_OWASP_ASVS_GAP_REGISTER.md](VYR-047_OWASP_ASVS_GAP_REGISTER.md)
- **Automated Verification Suite:** `backend/scripts/test_story_063_security_assessment_and_pentest.cjs` (`npm --prefix backend run test:vyr63`)

---

## 1. Executive Summary

A full-stack security assessment (SAST, SCA, secret scanning, DAST, and targeted penetration testing) was executed against the hardened Veyra application stack. Four remaining open findings from the VYR-047 gap register (`GAP-006`, `GAP-012`, `GAP-016`, `GAP-019`) were remediated directly in code and retested.

- **Unresolved Critical Findings:** **0**
- **Unresolved High Findings without Risk Acceptance:** **0** (`xlsx` upstream advisories are formally mitigated and risk-accepted with owner & expiry below).

---

## 2. Assessment Methodology & Tooling

| Activity | Scope & Tooling | Coverage |
| :--- | :--- | :--- |
| **SAST** | Static AST/regex scans + GitHub CodeQL workflow (`.github/workflows/dependency-scan.yml`) | XSS sinks (`dangerouslySetInnerHTML`, `innerHTML`, `eval`), SQL template interpolation, embedded keys, error handler & crypto algorithms |
| **SCA** | `npm audit --omit=dev --json` across `root`, `backend/`, `frontend/` | Direct and transitive production dependency advisories |
| **Secret Scanning** | Gitleaks CI workflow (`.github/workflows/secret-scan.yml`, `.gitleaks.toml`) & `.gitignore` hardening | Private keys, `.env*`, cloud KMS/Oracle/JWT/Entra credentials |
| **DAST & Pentest** | Live Express + PostgreSQL test harness (`test:vyr63`) | Auth bypass, `alg:none` & `HS256` JWT forgery, session replay after logout, brute-force 429 lockout, object/tenant IDOR, vertical privilege escalation, mass assignment, SQLi, XSS/CSP, CORS/CSRF, SSRF, malformed JSON error handling |

---

## 3. Remediated Findings (Verified in `test:vyr63`)

| Finding ID | Severity | Affected File | Vulnerability Description | Remediation Implemented | Retest Result |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **GAP-006** | **HIGH** | `backend/src/routes/api.ts` (`POST /investigations`, `GET /investigations/:id`) | Broken Object-Level Authorization (IDOR): any authenticated user could read or overwrite another user's investigation snapshot by ID. | Bound snapshots to `userId` + `user` email; added `isInvestigationAuthorized()` enforcing owner or `SITE_ADMIN` access; logs `PRIVILEGED_DATA_ACCESS` (`result: 'DENIED'`) security event and returns `403 FORBIDDEN`. | **PASS** (non-owner `AUDIT_USER` and `AUDIT_SUPERVISOR` blocked with `403`; owner & `SITE_ADMIN` `200`). |
| **GAP-012** | **HIGH** | `backend/src/config.ts` (`encrypt`, `decrypt`) | Persisted Oracle config credentials used unauthenticated `aes-256-cbc` and returned raw string on decrypt error. | Upgraded `encrypt()` to authenticated **AES-256-GCM** (`v2:<iv>:<authTag>:<ciphertext>`); `decrypt()` verifies GCM auth tag and fails closed on tampering while keeping backward-compatible legacy CBC reads. | **PASS** (tampered `v2:` ciphertext throws error; round-trip verified). |
| **GAP-019** | **HIGH/MED** | `backend/src/index.ts` | Missing global Express 4-argument error handler; malformed JSON or unhandled errors could render Express default HTML stack traces. | Added global `(err, req, res, next)` error middleware returning safe JSON (`400 INVALID_JSON`, `413 PAYLOAD_TOO_LARGE`, `403 CORS_FORBIDDEN`, `500 INTERNAL_ERROR`) without stack traces. | **PASS** (malformed JSON returns `400 INVALID_JSON` JSON with zero stack trace). |
| **GAP-016** | **MEDIUM** | `backend/src/index.ts` (request logger) & `backend/src/security/cryptoFailure.ts` (`maskSensitive`) | Request logger masked only `password` and `token`, and `maskSensitive()` did not match quoted JSON keys (`"password":"..."`) or `newPassword`/`resetCode`. | Extended sensitive field mask list (`newPassword`, `currentPassword`, `resetCode`, `accessToken`, `refreshToken`, `clientSecret`, `privateKey`, `secret`, `encryptionKey`, `code`, `authorization`) and updated `SENSITIVE_ASSIGNMENT` regex in `maskSensitive()` to redact quoted JSON key-value pairs. | **PASS** (JSON `password`, `newPassword`, `resetCode`, and JWTs scrubbed cleanly). |
| **GAP-005b** | **LOW** | `backend/src/security/securityHeadersService.ts` & `backend/src/index.ts` | Helmet v8 `xPoweredBy: false` disabled `hidePoweredBy`, leaving `X-Powered-By: Express` header present on responses. | Added `res.removeHeader('X-Powered-By')` in `securityHeadersMiddleware` wrapper and `app.disable('x-powered-by')` in `index.ts`. | **PASS** (`X-Powered-By` header absent on API responses). |

*Prior Epic 6 remediations also verified in `test:vyr63`: `GAP-001` (SQLi parameterization & AST validator), `GAP-002`/`GAP-017` (tiered rate limiting & lockout), `GAP-003` (strict CORS allowlist), `GAP-005` (Helmet CSP/headers), `GAP-007`/`GAP-013`/`GAP-015` (2MB limit, per-route limits, strict Zod DTO validation), `GAP-008` (PostgreSQL `veyra_session` persistence), and `VYR-051` SSRF URL policy.*

---

## 4. Accepted Residual Risks Register

| Risk ID | Source / Advisory | Severity | Compensating Controls & Mitigation | Owner | Expiry / Re-Review Date |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **RR-001** | `xlsx` (`GHSA-4r6h-8v6p-xvw6` Prototype Pollution, `GHSA-5pgg-2g8v-p4x9` ReDoS — no upstream npm fix) | **High** | Exports/imports restricted to authenticated users; global request body capped at 2MB (`VYR-049`); no untrusted public uploads. Evaluate migration to `exceljs` before expiry. | Engineering Lead & Security Lead | `2026-12-26` (30 days) |
| **RR-002** | `qs` via `express@4.x` (`GHSA-4mjr-xmp4-gh2g`, `GHSA-6pq8-jhm2-2vcw`) | **Moderate** | Express `urlencoded` depth/size capped (`2mb`); mutation routes use `application/json` with strict Zod validation. Scheduled for Express 5 / `qs` update. | Engineering Lead | `2027-01-26` (60 days) |
| **RR-003** | `react-router` / `react-router-dom@6.x` (`GHSA-wrjc-x8rr-h8h6`, `GHSA-337j-9hxr-rhxg`) | **Moderate** | Application is a client-only Vite SPA (SSR `deserializeErrors` unused); navigation uses static internal route IDs rather than untrusted user URLs. Scheduled for React Router v7 upgrade. | Frontend Lead | `2027-01-26` (60 days) |
| **RR-004** | `GAP-020`: JWT stored in browser `sessionStorage` | **Medium** | Strict Helmet CSP (`script-src 'self'`), zero `dangerouslySetInnerHTML`/`innerHTML`/`eval` sinks, 15-min sliding inactivity timeout, and server-side `veyra_session` revocation on logout/force-login. | Security Lead | `2027-02-26` (90 days) |
| **RR-005** | `GAP-004` / `GAP-022`: Dev fallback keys when `STRICT_CONFIG_VALIDATION` is false | **Low** (Prod gated) | `validateStartupConfig` rejects default `ORACLE_ENCRYPTION_KEY`, default DB passwords, and missing RSA keys when `STRICT_CONFIG_VALIDATION=true`; production runbooks require KMS/Key Vault & dedicated secret manager (`VYR-055`). | Platform / DevOps Owner | `2027-02-26` (90 days) |

---

## 5. Verification Execution Evidence

All checks executed on `standard-veyra-application-dev` after final code remediations and clean TypeScript build (`npm --prefix backend run build`):

| Suite | Command | Passed | Failed | Skipped |
| :--- | :--- | :---: | :---: | :---: |
| **VYR-063** Security Assessment & Pentest | `npm --prefix backend run test:vyr63` | 53 | 0 | 0 |
| **VYR-050** Security Headers & CORS | `npm --prefix backend run test:vyr50` | 20 | 0 | 0 |
| **VYR-053** Security Audit Logging & Masking | `npm --prefix backend run test:vyr53` | 30 | 0 | 0 |
| **VYR-038** Crypto Failure & Audit | `npm --prefix backend run test:vyr38` | 62 | 0 | 0 |
| **VYR-051** Injection, XSS, CSRF & SSRF | `npm --prefix backend run test:vyr51` | 30 | 0 | 0 |
| **VYR-055** Secrets Management | `npm --prefix backend run test:vyr55` | 20 | 0 | 0 |
| **VYR-061** Core Module Regression | `npm --prefix backend run test:vyr61` | 158 | 0 | 0 |
