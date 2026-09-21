# VEYRA Database Layer (PostgreSQL & Node.js Migrations)

This directory contains the database migration tooling, seed scripts, and verification tests for the **VEYRA** project.

Implemented under **VY-STRY-008**: *DB: Create VEYRA User, Role and Privilege Database Tables*.

---

## 🏗️ Architecture & Entities

The schema establishes the foundational Role-Based Access Control (RBAC) data model:

```text
VEYRA_USER
    │
    └── VEYRA_USER_ROLE ─── VEYRA_ROLE
                                │
                                └── VEYRA_ROLE_PRIVILEGE ─── VEYRA_PRIVILEGE
```

### Tables Created:
1. **`veyra_user`**: Users table with canonical normalized email (`email = LOWER(TRIM(email))`), status check constraint (`INVITED`, `ACTIVE`, `SUSPENDED`, `DISABLED`, `EXPIRED`), timestamps, audit tracking, and optional password hash. Plaintext passwords are never stored.
2. **`veyra_role`**: System roles with unique `role_code` and status.
3. **`veyra_privilege`**: System privileges with unique `privilege_code`, module categorization, and status.
4. **`veyra_user_role`**: Association table linking users to roles with database-level uniqueness constraint `(user_id, role_id)`.
5. **`veyra_role_privilege`**: Association table linking roles to privileges with database-level uniqueness constraint `(role_id, privilege_id)`.

---

## 🚀 Quick Start for Developers (After Git Pull)

### 1. Install Dependencies
From the repository root:
```bash
npm install --prefix database
```
*(Or `npm run install:all` to install across root, frontend, backend, and database concurrently)*

### 2. Configure Environment Variables
Copy `.env.example` to `.env` or verify your database connection settings:
```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5433
POSTGRES_DB=veyra_db
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/veyra_db
```

### 3. Run Database Migrations
From repository root:
```bash
npm run db:migrate
```
*(Or from `database/`: `npm run migrate`)*

To rollback the migration:
```bash
npm run db:migrate:down
```

### 4. Run Seed Data Initialization (Idempotent)
To seed the 4 roles, 9 privileges, role-privilege mappings, and bootstrap admin:
```bash
npm run db:seed
```

### 5. Run Database Verification Suite
Run the automated verification suite covering all 17 Story 8 requirements:
```bash
npm run db:test
```

---

## 🔒 Security & Admin Provisioning Note

- **Bootstrap Admin**: `admin@admin.com` is seeded and assigned the `SITE_ADMIN` role.
- **Initial Password Provisioning**: Per Story 8 specifications, **no hardcoded or invented initial admin password has been set** (`password_hash` is initialized as `NULL`).
- **Next Steps for Backend Team**: Implement the administrative invitation or secure first-time password setup workflow as part of the authentication API stories.
