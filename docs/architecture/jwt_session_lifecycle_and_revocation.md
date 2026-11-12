# Veyra JWT Session Refresh, Logout & Revocation Lifecycle (VYR-024)

## 1. Scope & Traceability

**Epic 3: JWT/JWS issuance, verification and session integration**  
**Story ID:** `VYR-024`  
**Story Title:** Refactor session refresh, logout, single-session and revocation for JWT  
**Branch Applicability:** Both (`standard-veyra-application-dev` & `veyra-application-dev`)  
**Dependencies:** VYR-019 (JWT Contract), VYR-020 (JWT Issuance), VYR-021 (Verification Middleware), VYR-022 (Key Rotation & JWKS), VYR-023 (JWT RBAC Integration)

---

## 2. Architecture & Design Principles

Veyra enforces a hybrid architecture that pairs **cryptographically signed RS256 JWT access tokens** (RFC 9068) with **stateful session lifecycle controls** in PostgreSQL (`veyra_session`).

```
 +-----------------------------------------------------------------------------------+
 |                             CLIENT APPLICATION                                    |
 +-----------------------------------------------------------------------------------+
          │                                  │                               │
   POST /api/auth/login             GET /api/protected              POST /api/auth/refresh
  (with optional force: true)      (Bearer <RS256 JWT>)            (Bearer <RS256 JWT>)
          │                                  │                               │
          ▼                                  ▼                               ▼
 +─────────────────────+           +───────────────────+           +───────────────────+
 |   Local / Entra ID  |           | jwtAuthMiddleware |           |   authService     |
 |    Authentication   |           |  Verification     |           |  Refresh Handler  |
 +─────────────────────+           +───────────────────+           +───────────────────+
          │                                  │                               │
          ▼                                  ▼                               ▼
 [Check Active Session]            [1. RS256 Sig & exp]           [1. Verify RS256 JWT]
  ├── Exists & !force ─► 409        ├── Invalid ───────► 401       ├── Invalid ───────► 401
  └── Force / Fresh ───► Issue sid  └── Valid ─────────► Check DB  └── Valid ─────────► Check DB
          │                                  │                               │
          ▼                                  ▼                               ▼
 [DB: veyra_session]              [2. Authoritative DB State]     [2. Authoritative DB State]
  ├── Status: ACTIVE               ├── Status !== ACTIVE ─► 401    ├── Status !== ACTIVE ─► 401
  ├── uq_user_active index         ├── Inactive > 15m ────► 401    ├── Inactive > 15m ────► 401
  └── Issue 15m RS256 JWT          └── Account DISABLED ──► 403    └── Account DISABLED ──► 403
                                             │                               │
                                             ▼                               ▼
                                  [Authorize Request]             [Slide Expiration & Issue]
                                  (Attach res.locals &            (Issue Fresh RS256 JWT,
                                   proceed to RBAC)                update lastActivityAt)
```

### Key Tenets
1. **Zero Credential / Zero PII in JWT**: JWT access tokens carry strictly `sub` (`userId`), `sid` (`sessionId`), `jti`, `iss`, `aud`, `iat`, `nbf`, and `exp`.
2. **Database Authoritative State**: PostgreSQL table `veyra_session` is the single source of truth for session status (`ACTIVE`, `LOGGED_OUT`, `EXPIRED`, `REJECTED`). In-memory cache must never resurrect a revoked or expired session.
3. **Single Active Session Per User**: Enforced at the database layer via partial unique index `uq_veyra_session_user_active ON veyra_session(user_id) WHERE status = 'ACTIVE'`. Concurrent logins without `force: true` return `HTTP 409 ACTIVE_SESSION_EXISTS`.
4. **Immediate Revocation**: Logout and force-login revoke sessions instantaneously across in-memory cache and PostgreSQL.
5. **Fresh Token Issuance on Refresh**: Because RS256 tokens carry cryptographic expiration timestamps (`exp`), `POST /api/auth/refresh` renews the session sliding window and issues a brand-new RS256 JWT access token bound to the existing `sid`.

---

## 3. Session Lifecycle State Machine

```
                  ┌────────────────┐
                  │  USER LOGIN    │
                  └───────┬────────┘
                          │
                          ▼
                  ┌────────────────┐
                  │     ACTIVE     │◄───────────────────┐
                  └───────┬────────┘                    │
                          │                             │
         ┌────────────────┼────────────────┐            │ POST /api/auth/refresh
         │                │                │            │ (Issues fresh RS256 JWT)
         ▼                ▼                ▼            │
 ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │
 │  LOGGED_OUT  │ │   EXPIRED    │ │   REJECTED   │     │
 │ (POST logout)│ │(Inactivity / │ │(Force-login /│     │
 │              │ │ 15m timeout) │ │ Admin purge) │     │
 └──────────────┘ └──────────────┘ └──────────────┘     │
         │                │                │            │
         └────────────────┴────────────────┴────────────┘
                         │
                         ▼
             [ Permanently Revoked ]
         (Cannot be refreshed or reused)
```

### State Transitions & HTTP Responses

| State Transition | Trigger | veyra_session DB | In-Memory Cache | Subsequent Request Result |
|---|---|---|---|---|
| `LOGIN` | `POST /api/auth/login` | Insert `ACTIVE` | Set `sessionId` & `jwt` | 200 OK with RS256 JWT & `sessionId` |
| `CONFLICT` | Concurrent login without `force` | Unchanged | Unchanged | 409 Conflict (`ACTIVE_SESSION_EXISTS`) |
| `SUPERSEDE` | `POST /api/auth/login` (`force: true`) | Prior -> `EXPIRED`, New -> `ACTIVE` | Purge prior tokens, cache new | Prior JWT -> 401; New JWT -> 200 OK |
| `REFRESH` | `POST /api/auth/refresh` | `last_activity_at` updated, `expires_at` extended | Sliding timer updated, cache new JWT | 200 OK with fresh RS256 JWT |
| `LOGOUT` | `POST /api/auth/logout` | Status -> `LOGGED_OUT`, `logged_out_at` set | Purged from `activeSessions` | 401 Unauthorized (`INVALID_TOKEN`) |
| `INACTIVITY` | Request after 15m no activity | Status -> `EXPIRED` | Purged from `activeSessions` | 401 Unauthorized (`SESSION_EXPIRED`) |

---

## 4. Acceptance Criteria Verification

### AC1: Immediate Revocation on Logout & Force-Login
- When a user logs out (`POST /api/auth/logout`) or is superseded by a force-login (`POST /api/auth/login` with `force: true`), the prior session is immediately marked `LOGGED_OUT` or `EXPIRED` in PostgreSQL.
- In-memory entries in `activeSessions` for both the session ID and any issued access tokens are purged.
- Any subsequent HTTP request carrying the revoked JWT fails immediately with `HTTP 401 Unauthorized` (`INVALID_TOKEN` or `SESSION_EXPIRED`).

### AC2: Single-Active-Session Enforcement
- PostgreSQL enforces single active session semantics via `uq_veyra_session_user_active`.
- If an active session already exists:
  - Without `force: true`: Returns `HTTP 409 Conflict` with error code `ACTIVE_SESSION_EXISTS`. Existing session remains intact.
  - With `force: true`: Automatically revokes existing session(s), sets their status to `EXPIRED`, and establishes the new active session.

### AC3: 15-Minute Sliding Inactivity Expiry
- Session inactivity window defaults to 15 minutes (`SESSION_INACTIVITY_TIMEOUT_MINUTES=15`).
- On every protected API call, `authService.validateSession` verifies that `now - session.lastActivityAt < inactivityTimeout`.
- Requests exceeding the inactivity window are rejected with `HTTP 401 SESSION_EXPIRED`, and the database session is transitioned to `EXPIRED`.

### AC4: Refresh Authorization & Guard Rails
- `POST /api/auth/refresh` is protected by `requireAuth` and validates:
  1. Cryptographic RS256 signature against current JWKS.
  2. Authoritative PostgreSQL status: must be `status = 'ACTIVE'`.
  3. Continuous inactivity window: must not have elapsed.
  4. User account status: must not be deactivated, suspended, or deprovisioned (`USER_DISABLED` -> `HTTP 403`).
- Refresh cannot be abused to resurrect a revoked, expired, or logged-out session.
- Upon successful validation, issues a brand-new RS256 JWT access token bound to the existing `sessionId` and returns:
  - `token` / `accessToken`: Fresh short-lived RS256 JWT
  - `sessionId`: Session UUID/hash
  - `lastActivityAt`: Epoch millisecond timestamp
  - `expiresAt`: Extended expiration timestamp (now + 15 minutes)

---

## 5. Security & Audit Logging

All session lifecycle events are immutably recorded via `auditService.recordAuditEvent`:
- `USER_LOGIN`: Recorded on successful authentication (provider logged, never credentials).
- `LOGIN_REJECTED`: Recorded with 409 Conflict when concurrent login is blocked.
- `USER_LOGOUT`: Recorded with IP address, user agent, and session ID.
- `SESSION_REFRESH`: Recorded when keep-alive / refresh is invoked.
- `SESSION_EXPIRED`: Recorded when session times out due to inactivity.
