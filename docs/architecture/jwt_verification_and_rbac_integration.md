# Veyra JWT Verification and RBAC Integration (VYR-023)

## 1. Scope & Traceability

**Epic 3: JWT/JWS issuance, verification and session integration**  
**Story ID:** `VYR-023`  
**Story Title:** Integrate JWT verification with existing `requireAuth` and RBAC  
**Dependencies:** VYR-019 (JWT Contract), VYR-020 (JWT Issuance), VYR-021 (JWT Verification Middleware), VYR-022 (Key Rotation & JWKS)

---

## 2. Architecture & Request Lifecycle

```
               [ Incoming HTTP Request ]
                           │
                           ▼
          [ Authorization Header Present? ]
                 ├── No / Non-Bearer ─────────► [ 401 INVALID_TOKEN ]
                 └── Yes (Bearer <jwt>)
                           │
                           ▼
          [ tokenService.verifyAccessToken ]
                 ├── Invalid Sig / Expired ───► [ 401 INVALID_TOKEN / SESSION_EXPIRED ]
                 └── Valid (RS256, JWKS, sub, sid)
                           │
                           ▼
             [ authService.validateSession ]
                 ├── sid Not Found / Revoked ─► [ 401 INVALID_TOKEN / SESSION_EXPIRED ]
                 ├── sub !== session.userId ──► [ 401 INVALID_TOKEN ]
                 ├── Account Inactive/Disabled► [ 403 USER_DISABLED ]
                 └── Active User & Session
                           │
                           ▼
      [ Context Binding: res.locals & req.user ]
        (userId, email, role, permissions, isAdmin)
                           │
                           ▼
                  [ Route RBAC Guard ]
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
  requireAdmin      requirePrivilege    Specialized Guards
 (SITE_ADMIN/ALL)   (e.g. AUDIT_READ)   (AuditManager/Supervisor)
        │                  │                  │
   Denied: 403        Denied: 403        Denied: 403
   Allowed: next()    Allowed: next()    Allowed: next()
                           │
                           ▼
             [ Protected Route Handler ]
```

### 2.1 Principal Resolution
In compliance with RFC 9068 and Story VYR-019, the Veyra RS256 JWT carries **zero PII, zero credentials, and zero permission lists** inside the client-held token. It carries strictly:
- `sub`: The immutable Veyra user identifier (`userId`)
- `sid`: The active session identifier
- `jti`: Unique token identifier
- `iss`: `"veyra"`
- `aud`: `"veyra-api"`
- `iat`, `nbf`, `exp`: Timestamps bounding access to 15 minutes

When a request arrives at `verifyJwtAndSession`:
1. The cryptographic signature and claims are verified against the published JWKS.
2. The session is resolved from `sid`, asserting `session.userId === claims.sub` (Rule 11).
3. The user account status and assigned roles/privileges are re-verified server-side from PostgreSQL.
4. The authenticated principal is attached to `res.locals` and `req.user`:
   - `res.locals.userId` / `req.user.id`: User ID
   - `res.locals.email` / `req.user.email`: Normalized email
   - `res.locals.role` / `req.user.role`: Primary assigned role
   - `res.locals.permissions` / `req.user.permissions`: Granted privilege codes array
   - `res.locals.isAdmin` / `req.user.isAdmin`: Boolean flag for administrative status
   - `res.locals.authProvider`: Authentication provider (`LOCAL` or `ENTRA`)

---

## 3. RBAC Route-Level Authorization

All route guards depend directly on the verified server-side principal resolved by `requireAuth`:

### 3.1 `requireAdmin` (Site Administrator Guard)
- **Constraint:** Strictly requires `res.locals.isAdmin === true || res.locals.role === 'SITE_ADMIN' || res.locals.permissions.includes('ALL')`.
- **Rejection:** Any non-admin user (e.g., `AUDIT_USER`, `AUDIT_MANAGER`, `AUDIT_SUPERVISOR`) receives:
  ```json
  {
    "success": false,
    "code": "FORBIDDEN",
    "message": "Access denied. Site Administrator privileges required."
  }
  ```
  with HTTP status **403 Forbidden**.

### 3.2 `requirePrivilege(requiredPrivileges)` (Privilege Guard)
- **Constraint:** Evaluates whether the authenticated user holds at least one of the required privileges, or has explicit superuser access (`isAdmin === true`, `role === 'SITE_ADMIN'`, or permission `'ALL'`).
- **Support:** Accepts either a single privilege string (e.g., `'ORACLE_INTEGRATION'`) or an array of alternative privileges (e.g., `['RISK_MANAGEMENT', 'RISK_READ']`).
- **Rejection:** Users lacking the required privilege receive:
  ```json
  {
    "success": false,
    "code": "FORBIDDEN",
    "message": "Access denied. Insufficient privileges."
  }
  ```
  with HTTP status **403 Forbidden**.

### 3.3 Specialized Route Guards
- **`requireAuditManagerDashboard`:** Grants access to `AUDIT_MANAGER`, `SITE_ADMIN`, `SECURITY_ANALYST`, `COMPLIANCE_OFFICER`, and `AUDIT_SUPERVISOR`. Strictly denies `AUDIT_USER` with HTTP 403.
- **`requireAuditSupervisorDashboard`:** Grants access to `AUDIT_SUPERVISOR`, `AUDIT_MANAGER`, `SITE_ADMIN`, `SECURITY_ANALYST`, and `COMPLIANCE_OFFICER`. Strictly denies `AUDIT_USER` with HTTP 403.
- **`requireUsersListAccess`:** Grants access to roles with user directory read permissions. Strictly denies `AUDIT_USER` with HTTP 403.
- **`requireReportsDashboard`:** Allows all authenticated personas including `AUDIT_USER` to access compliance reports.

---

## 4. Server-Side Account State Re-check & Dynamic Synchronization

A critical vulnerability in stateless tokens is that deactivating a user or changing their permissions does not revoke access until the token expires. VYR-023 eliminates this vulnerability through server-side state enforcement:

1. **Account Status Re-check:** On every incoming API call, `authService.validateSession` queries `veyra_user` (or memory cache) for `status = 'ACTIVE'`.
   - If an administrator toggles account status to `DISABLED` or deactivates the user, the active session is immediately marked `LOGGED_OUT`, removed from the active session cache, and subsequent requests fail closed with **HTTP 403 `USER_DISABLED`**.
2. **Dynamic Role & Privilege Synchronization:** If an administrator updates role assignments or privileges in `veyra_user_role` or `veyra_role_privilege`, `authService.validateSession` dynamically synchronizes `session.role`, `session.permissions`, and `session.isAdmin`. The user's new permissions take effect on their very next request without requiring token re-issuance.
3. **Session Revocation & Logout:** Calling `/api/auth/logout` revokes the session in PostgreSQL and memory; any further requests using that JWT fail immediately with **HTTP 401 `INVALID_TOKEN`**.

---

## 5. Client-Side Page Visibility is NOT Security Enforcement (AC3)

Client-side routing guards (such as `canAccessPage` in `frontend/src/utils/authorization.ts`) provide user experience convenience by hiding navigation items. They are **never** treated as security boundaries:

- Direct HTTP API requests made with curl, Postman, or custom scripts bypassing the React UI are independently evaluated by the Express route middleware.
- Client-supplied request headers (e.g. `x-user-role`, `x-is-admin`) or request body properties (e.g. `{ role: 'SITE_ADMIN' }`) are strictly ignored.
- Route authorization is derived exclusively from the cryptographically verified JWT subject mapped to authoritative database records.

---

## 6. Acceptance Criteria Verification Matrix

| AC ID | Acceptance Criteria | Implementation / Verification | Status |
|---|---|---|---|
| **AC1** | Existing route-level authorization tests pass under JWT verification | All existing protected endpoints pass under `verifyJwtAndSession` and RBAC middleware | **VERIFIED** |
| **AC2** | A valid JWT without required privilege receives HTTP 403 Forbidden | Valid tokens lacking required privilege receive HTTP 403 with code `FORBIDDEN` | **VERIFIED** |
| **AC3** | Client-side page visibility is not treated as security enforcement | Direct API calls bypassing frontend are denied by backend route guards | **VERIFIED** |

---

## 7. Automated Test Suite

The test suite in `backend/scripts/test_story_023_jwt_rbac.cjs` exercises:
1. Token format, signature verification, and subject mismatch rejection (Rule 11).
2. Context binding to `res.locals` and standard `req.user`.
3. Server-side account deactivation resulting in immediate HTTP 403 `USER_DISABLED`.
4. `requireAdmin` enforcement across admin, manager, supervisor, and user personas.
5. `requirePrivilege` enforcement for single and multi-privilege route protections.
6. Role exclusion checks on Audit Manager, Audit Supervisor, and Users List dashboards.
7. Anti-spoofing tests proving client headers/bodies cannot elevate privileges.
8. Multi-middleware chaining execution without redundant cryptographic re-verification.

**To run the test suite:**
```bash
npm --prefix backend run test:vyr23
```
Expected output: **38 Passed, 0 Failed**.

