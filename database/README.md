# VEYRA Database Layer (PostgreSQL & Node.js Migrations)

This directory contains the database migration tooling, seed scripts, and verification tests for the **VEYRA** project.

Implemented under:
- **VY-STRY-008**: *DB: Create VEYRA User, Role and Privilege Database Tables*
- **VY-STRY-009**: *DB: Create VEYRA Session Tracking and Session Audit Tables*
- **VY-STRY-010**: *DB: Create VEYRA Authentication and Administrative Audit Trail*

---

## 🏗️ Architecture & Entities

The schema establishes the foundational Role-Based Access Control (RBAC), Session Enforcement, and Security Audit Trail:

```text
VEYRA_USER
    │
    ├── VEYRA_USER_ROLE ─── VEYRA_ROLE
    │                           │
    │                           └── VEYRA_ROLE_PRIVILEGE ─── VEYRA_PRIVILEGE
    │
    ├── VEYRA_SESSION (Single Active Session Enforcement)
    │
    └── VEYRA_AUDIT_EVENT (Authentication & Administrative Audit Trail)
```

### Tables:
1. **`veyra_user`**: Users table with canonical normalized email (`email = LOWER(TRIM(email))`), status check constraint (`INVITED`, `ACTIVE`, `SUSPENDED`, `DISABLED`, `EXPIRED`), timestamps, audit tracking, and optional password hash. Plaintext passwords are never stored.
2. **`veyra_role`**: System roles with unique `role_code` and status.
3. **`veyra_privilege`**: System privileges with unique `privilege_code`, module categorization, and status.
4. **`veyra_user_role`**: Association table linking users to roles with database-level uniqueness constraint `(user_id, role_id)`.
5. **`veyra_role_privilege`**: Association table linking roles to privileges with database-level uniqueness constraint `(role_id, privilege_id)`.
6. **`veyra_session`**: Session tracking table enforcing **Single Active Session per user** via PostgreSQL partial unique index `uq_veyra_session_user_active WHERE status = 'ACTIVE'`.
7. **`veyra_audit_event`**: Security and administrative audit trail table capturing security-sensitive events.

---

## 🛡️ VEYRA Audit Trail (`veyra_audit_event`) — VY-STRY-010

The `veyra_audit_event` table provides tamper-resistant, immutable persistence for security-critical authentication and administrative activities.

### Table Schema:
| Column | Type | Constraints / Defaults | Description |
|---|---|---|---|
| `event_id` | UUID | PRIMARY KEY, `DEFAULT gen_random_uuid()` | Cryptographically secure unique event identifier |
| `user_id` | UUID | NULLABLE, `REFERENCES veyra_user(id) ON DELETE SET NULL` | Identifier of the **actor** who performed the action (NULL for non-existent users on failed login) |
| `event_type` | VARCHAR(100) | NOT NULL, `ck_veyra_audit_event_type` | Supported audit event type |
| `event_time` | TIMESTAMPTZ | NOT NULL, `DEFAULT now()` | Database timestamp with timezone when event occurred |
| `ip_address` | VARCHAR(100) | NULLABLE | Request/client IP address |
| `user_agent` | TEXT | NULLABLE | Request User-Agent header |
| `target_type` | VARCHAR(100) | NULLABLE | Type of affected entity (`USER`, `ROLE`, `PRIVILEGE`, `SESSION`, etc.) |
| `target_id` | VARCHAR(255) | NULLABLE | Identifier of the affected entity |
| `details` | JSONB | NULLABLE | Sanitized, non-sensitive metadata object |

### Indexes:
- `ix_veyra_audit_event_time` on `(event_time DESC)`
- `ix_veyra_audit_event_user_id` on `(user_id)`
- `ix_veyra_audit_event_event_type` on `(event_type)`
- `ix_veyra_audit_event_target` on `(target_type, target_id)`

---

## 📋 Supported Event Types

Enforced via PostgreSQL CHECK constraint `ck_veyra_audit_event_type`:

| Event Type | Category | Trigger Condition |
|---|---|---|
| `LOGIN_SUCCESS` | Authentication | User authenticates with valid credentials, session created |
| `LOGIN_FAILED` | Authentication | Authentication fails (invalid password, unknown email, inactive account) |
| `LOGIN_REJECTED_ACTIVE_SESSION` | Authentication | Login rejected because an active session already exists (HTTP 409) |
| `LOGOUT` | Authentication | User explicitly signs out and session is invalidated |
| `SESSION_EXPIRED` | Authentication | Session transitions from ACTIVE to EXPIRED due to inactivity timeout |
| `USER_CREATED` | Administrative | Administrator creates a new user account |
| `USER_UPDATED` | Administrative | Administrator modifies user metadata, status, or role |
| `USER_DELETED` | Administrative | Administrator permanently deletes a user account |
| `ROLE_ASSIGNED` | Administrative | Role is assigned to a user |
| `ROLE_REMOVED` | Administrative | Role is removed from a user |
| `PRIVILEGE_CHANGED` | Administrative | Privileges associated with a role or user are modified |

---

## 🎯 Actor vs Target Semantics

A strict distinction is maintained between the entity performing the action and the entity being affected:

- **`user_id` (Actor)**: The administrator or user who performed the action.
- **`target_type` & `target_id` (Target)**: The entity being created, modified, or affected.

**Example 1**: Administrator creates a new user:
- `user_id`: Admin's user ID
- `event_type`: `USER_CREATED`
- `target_type`: `'USER'`
- `target_id`: New user's ID
- `details`: `{"targetEmail": "john@example.com", "role": "AUDIT_USER"}`

**Example 2**: Failed login with non-existent user:
- `user_id`: `NULL` (no authenticated actor exists)
- `event_type`: `LOGIN_FAILED`
- `target_type`: `'USER'`
- `target_id`: `NULL`
- `details`: `{"reason": "INVALID_CREDENTIALS"}`

---

## 🔒 Security Rules & Defense-in-Depth Sanitization

1. **Zero Secret Persistence**: Passwords, password hashes, reset tokens, session secrets, JWTs, Authorization headers, cookies, Oracle credentials, Groq API keys, and private keys must **NEVER** be persisted in the audit trail.
2. **Automated Sanitization**: The Node.js `AuditService` recursively inspects and strips all sensitive keys from details JSON before database insertion.
3. **No Account Enumeration**: Failed login responses and public messages remain generic ("Invalid email or password.") regardless of whether the email exists.
4. **Preservation on Deletion**: `user_id` has `ON DELETE SET NULL`, ensuring historical audit events remain permanently preserved even if a user account is deleted.

---

## 🚀 Quick Start for Developers

### 1. Run Migrations
```bash
npm run migrate         # Apply all UP migrations (Story 8, 9, and 10)
npm run migrate:down    # Roll back latest migration
```

### 2. Run Verification Suites
```bash
npm run test:story8     # Story 8: RBAC schema & constraints (17 tests)
npm run test:story9     # Story 9: Session tracking & single active session (16 tests)
npm run test:story10    # Story 10: Audit trail schema, constraints & sanitization (31 tests)
npm run test:story13    # Story 13: Dashboard metrics persistence & scope filtering (20 tests)
npm test                # Run all verification suites concurrently
```

---

## 📊 Story 13: Dashboard Metrics Architecture & Schema

### Migration: `1711000000003_create_veyra_dashboard_metric_table.cjs`

Table: `veyra_dashboard_metric`

| Column | Type | Constraints / Defaults | Description |
|---|---|---|---|
| `metric_id` | UUID | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Unique metric measurement ID |
| `metric_key` | VARCHAR(100) | NOT NULL | Canonical identifier (e.g. `ACTIVE_RISKS`, `TOTAL_USERS`, `ROLE_DISTRIBUTION`) |
| `metric_value` | NUMERIC(14, 4) | NULL | Numeric KPI value (for gauges and counters) |
| `metric_type` | VARCHAR(30) | NOT NULL, DEFAULT `'GAUGE'`, CHECK `IN ('COUNTER', 'GAUGE', 'AGGREGATE', 'SUMMARY_SNAPSHOT')` | Metric classification |
| `scope_type` | VARCHAR(30) | NOT NULL, DEFAULT `'GLOBAL'`, CHECK `IN ('GLOBAL', 'USER', 'APPLICATION', 'TENANT')` | Scope boundary |
| `scope_id` | VARCHAR(100) | NULL | Scope identifier (e.g. user ID, application code) |
| `user_id` | UUID | NULL, FOREIGN KEY REFERENCES `veyra_user(id) ON DELETE SET NULL` | Reference to user for user-scoped metrics |
| `application_scope` | VARCHAR(100) | NOT NULL, DEFAULT `'ORACLE_FUSION'` | Application partition boundary |
| `metric_payload` | JSONB | NULL | Structured metric breakdown (no UI coordinates or colors) |
| `source` | VARCHAR(50) | NOT NULL, DEFAULT `'VEYRA_CALCULATED'`, CHECK `IN ('VEYRA_POSTGRES', 'ORACLE_FUSION', 'VEYRA_CALCULATED', 'MANUAL', 'DEMO_SEED')` | Authoritative source of data |
| `is_mock` | BOOLEAN | NOT NULL, DEFAULT `false` | Explicit separation of mock/sample vs production data |
| `captured_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `now()` | Measurement timestamp |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `now()` | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `now()` | Record update timestamp |

### Indexes:
- `ix_veyra_dashboard_metric_key_scope_time`: `(metric_key, scope_type, is_mock, captured_at DESC)`
- `ix_veyra_dashboard_metric_user_time`: `(user_id, captured_at DESC) WHERE user_id IS NOT NULL`
- `ix_veyra_dashboard_metric_app_time`: `(application_scope, captured_at DESC)`
- `ix_veyra_dashboard_metric_scope_captured`: `(scope_type, captured_at DESC)`
- `ix_veyra_dashboard_metric_captured_at`: `(captured_at DESC)`

### Backend Integration:
- Extended `auditDashboardService.ts` to persist snapshots during dashboard computation.
- Added API: `GET /api/dashboard/history?metricKey=...&scopeType=...` (guarded by `requireAuditManagerDashboard`).
- Zero data duplication: Base user, role, session, and audit counts calculated from existing PostgreSQL tables or Oracle services.

