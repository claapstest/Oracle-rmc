# React API Client & Authentication Lifecycle (VYR-025)

## 1. Scope & Traceability

**Epic 3: JWT/JWS issuance, verification and session integration**  
**Story ID:** `VYR-025`  
**Story Title:** Update React API client and authentication lifecycle  
**Branch Applicability:** Both (`standard-veyra-application-dev` & `veyra-application-dev`)  
**Dependencies:** VYR-019 (JWT Contract), VYR-020 (JWT Issuance), VYR-021 (Verification Middleware), VYR-022 (Key Rotation & JWKS), VYR-023 (JWT RBAC Integration), VYR-024 (Session Refresh, Logout, Revocation)

---

## 2. Architecture Overview & Request Flow

The Veyra React frontend interacts with the backend using cryptographically signed RS256 JWT access tokens conforming to RFC 9068.

```
+───────────────────────────────────────────────────────────────────────────────────+
|                                REACT CLIENT (Browser)                             |
+───────────────────────────────────────────────────────────────────────────────────+
  │
  ├─ 1. User Interaction / API Call
  │     └─ apiRequest(endpoint, options)
  │
  ├─ 2. Token Injection
  │     └─ Authorization: Bearer <sessionStorage:authToken>
  │
  ├─ 3. Backend Verification (POST / GET / PUT / DELETE)
  │     ├── [HTTP 200 OK] ─────────────► Return Data & Cache
  │     │
  │     └── [HTTP 401 Unauthorized] (Token Expired)
  │           │
  │           ▼
  │     [Is endpoint an auth route or already a retry?]
  │           ├── Yes ─────────────────► Fail Closed: clearActiveAuthSession() -> auth:expired
  │           └── No
  │                 │
  │                 ▼
  │           [Silent Token Renewal: POST /api/auth/refresh]
  │                 ├── Success (200) ──► updateActiveAuthToken(newToken)
  │                 │                    Retry original request with _isRetry: true
  │                 │
  │                 └── Failed (401/403) ► Fail Closed: clearActiveAuthSession() -> auth:expired
```

---

## 3. Core Lifecycle Controls

### 3.1 Authorization Header Injection
Every outbound HTTP request initiated through `apiRequest` in `frontend/src/services/api.ts` retrieves the current token via `getActiveAuthToken()` and injects it as:
```http
Authorization: Bearer <RS256_JWT_ACCESS_TOKEN>
```
If no token is present (e.g. unauthenticated public routes), the `Authorization` header is omitted or sent empty.

### 3.2 Transparent Token Renewal (Anti-Loop Guarantee)
RS256 JWT access tokens carry a 15-minute cryptographic lifetime (`exp = iat + 900`). In prolonged active user sessions:
1. When an API call returns `HTTP 401 Unauthorized` with code `INVALID_TOKEN` or `SESSION_EXPIRED`, `apiRequest` intercepts the failure.
2. If the failed endpoint is not an authentication route (`/auth/login`, `/auth/logout`, `/auth/refresh`, `/auth/entra`, `/auth/reset-password`) and `_isRetry` is false:
   - `apiRequest` calls `POST /api/auth/refresh` silently using the current token.
   - If the database session is still within the sliding inactivity window, the backend responds with a freshly issued RS256 JWT access token.
   - The React client saves the new token to `sessionStorage` via `updateActiveAuthToken(freshToken)`.
   - The client immediately retries the original request with the fresh token and flags `_isRetry: true`.
3. If the refresh request itself fails (due to inactivity timeout, revocation, or logout) or if the retried request fails:
   - The client **never retries a second time**, guaranteeing **zero infinite retry loops**.
   - The client clears active session data (`clearActiveAuthSession()`) and dispatches the `auth:expired` event to prompt the user to re-authenticate.

### 3.3 Account Status Enforcement (HTTP 403)
If an API request returns `HTTP 403 Forbidden` with error code `USER_DISABLED` or `ACCOUNT_INACTIVE` (e.g., an administrator deactivated or deprovisioned the account):
- The client terminates the local session immediately (`clearActiveAuthSession()`).
- Dispatches `auth:disabled` with the server-supplied explanation.
- The UI redirects the user to the login screen displaying the account deactivation notice.

---

## 4. Inactivity Timer & Warning Modal Synchronization

The frontend timer hook (`useSessionTimeout`) and warning modal (`SessionTimeoutModal`) are synchronized with backend session parameters:

- **Total Inactivity Window:** 15 minutes (900 seconds), matching backend `SESSION_INACTIVITY_TIMEOUT_MINUTES = 15`.
- **Countdown Warning Window:** 60 seconds. The modal appears at 14 minutes of continuous inactivity.
- **Activity Keep-Alive:**
  - Any genuine user interaction (mouse movement, keypress, scroll, touch, or click) updates the client-side activity timestamp.
  - Active keep-alive calls to `api.refreshSession()` are throttled to at most once every 30 seconds during active usage.
  - If the warning modal is currently visible, ANY interaction immediately dismisses the modal and triggers `api.refreshSession()`, renewing the JWT access token and sliding the database expiration window.
- **Expiry Action:** If the 60-second countdown reaches 0 without activity:
  - Invokes `onLogout('EXPIRED')`.
  - Sends `POST /api/auth/logout`, updates database session to `LOGGED_OUT`, purges `sessionStorage`, and transitions the UI to the login view with an expiration notice.

---

## 5. Token Storage Security & Threat Modeling

### 5.1 Storage Mechanism Evaluation
- **Chosen Mechanism:** `sessionStorage` (with single-use tab bridge for child window investigations).
- **Isolation Scope:** Stored per browser tab; automatically purged when the tab is closed; inaccessible to third-party frames or cross-origin contexts.
- **Comparison:**
  - `localStorage`: Rejected due to persistence across browser restarts, shared state across tabs, and vulnerability to persistent device harvesting.
  - `sessionStorage`: Scoped to active browsing session, purged on logout and tab close.
  - `HttpOnly SameSite=Strict Cookies (BFF Pattern)`: Optimal architectural target for complete XSS isolation. When deploying with a separate frontend/backend origin (e.g. Render Web Service + Static Site), cross-origin cookie policies require CORS with credentials and domain alignment.

### 5.2 XSS Exposure & Compensating Controls
Because JavaScript in the client possesses access to `sessionStorage`:
1. **Strict Content Security Policy (CSP):** Prevent execution of untrusted scripts and external eval.
2. **HTML Escaping & Sanitization:** All user inputs and database fields rendered in the UI are handled through React's JSX parser (automatic entity escaping) or dedicated sanitizers.
3. **Zero Credential / Zero PII in Token:** Even if a token string were intercepted, the Veyra JWT payload carries zero user credentials, zero emails, zero passwords, and zero permission lists. The token cannot be used to forge identity without the server's private key.
4. **Short 15-Minute Lifetime:** Stolen tokens are bounded to 15 minutes max and subject to immediate server-side revocation on logout or force-login.

---

## 6. Zero Token & Credential Logging Policy

In compliance with Acceptance Criteria 3:
- **Deduplication Logs:** Log only `${method} ${endpoint}` (e.g. `GET /api/users`), never the request body or authorization header.
- **Error Diagnostics:** In `ApiError` logging, output only status codes and message summaries (`HTTP 401 (INVALID_TOKEN)`), never raw token strings or serialized request bodies.
- **Telemetry & URLs:** Tokens are never passed as query parameters, URL path segments, analytics events, or browser history states.

