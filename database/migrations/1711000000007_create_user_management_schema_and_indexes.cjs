/**
 * Migration: Implement User Management Database Schema, Constraints and Indexes
 * Story: VY-STRY-25: DB: Implement User Management Database Schema and Indexes
 *
 * Requirements & Acceptance Criteria:
 * 1. Database schema support for:
 *    - User identity (id UUID PK)
 *    - Email (email VARCHAR UNIQUE)
 *    - Display name (display_name VARCHAR)
 *    - Status (status VARCHAR with CHECK constraint)
 *    - Role assignment (veyra_user_role with FK referential integrity)
 *    - Created date (created_at TIMESTAMPTZ)
 *    - Updated date (updated_at TIMESTAMPTZ with auto-update trigger)
 *    - Last login (last_login_at TIMESTAMPTZ)
 *    - Created by (created_by VARCHAR)
 *    - Updated by (updated_by VARCHAR)
 *
 * 2. Required Constraints:
 *    - Unique user email (uq_veyra_user_email)
 *    - Valid role foreign key (fk_veyra_user_role_role_id)
 *    - Valid user status (ck_veyra_user_status)
 *    - Referential integrity (ON DELETE CASCADE on user_role)
 *
 * 3. Appropriate Indexes:
 *    - email: ix_veyra_user_email
 *    - name: ix_veyra_user_display_name, ix_veyra_user_display_name_lower
 *    - role: ix_veyra_user_role_role_id, ix_veyra_user_role_lookup, ix_veyra_role_role_code
 *    - status: ix_veyra_user_status, ix_veyra_user_status_created
 *    - last_login_at: ix_veyra_user_last_login_at
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Ensure column definitions and sizes for veyra_user
    ALTER TABLE veyra_user 
      ALTER COLUMN display_name TYPE VARCHAR(255),
      ALTER COLUMN created_by TYPE VARCHAR(255),
      ALTER COLUMN updated_by TYPE VARCHAR(255);

    -- 2. Extend and enforce valid user status constraint
    ALTER TABLE veyra_user DROP CONSTRAINT IF EXISTS ck_veyra_user_status;
    ALTER TABLE veyra_user ADD CONSTRAINT ck_veyra_user_status 
      CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED', 'EXPIRED', 'INACTIVE', 'LOCKED'));

    -- 3. Indexes on Email (AC)
    CREATE INDEX IF NOT EXISTS ix_veyra_user_email ON veyra_user(email);

    -- 4. Indexes on Name / Display Name (AC)
    CREATE INDEX IF NOT EXISTS ix_veyra_user_display_name ON veyra_user(display_name);
    CREATE INDEX IF NOT EXISTS ix_veyra_user_display_name_lower ON veyra_user(LOWER(display_name));

    -- 5. Indexes on Status (AC)
    CREATE INDEX IF NOT EXISTS ix_veyra_user_status ON veyra_user(status);
    CREATE INDEX IF NOT EXISTS ix_veyra_user_status_created ON veyra_user(status, created_at DESC);

    -- 6. Indexes on Last Login (AC)
    CREATE INDEX IF NOT EXISTS ix_veyra_user_last_login_at ON veyra_user(last_login_at DESC);

    -- 7. Indexes on Role and User-Role Referential Lookups (AC)
    CREATE INDEX IF NOT EXISTS ix_veyra_user_role_role_id ON veyra_user_role(role_id);
    CREATE INDEX IF NOT EXISTS ix_veyra_user_role_user_id ON veyra_user_role(user_id);
    CREATE INDEX IF NOT EXISTS ix_veyra_user_role_lookup ON veyra_user_role(user_id, role_id);
    CREATE INDEX IF NOT EXISTS ix_veyra_role_role_code ON veyra_role(role_code);

    -- 8. General Sorting / Pagination Indexes for Users List
    CREATE INDEX IF NOT EXISTS ix_veyra_user_created_at ON veyra_user(created_at DESC);
    CREATE INDEX IF NOT EXISTS ix_veyra_user_updated_at ON veyra_user(updated_at DESC);

    -- 9. Automatic updated_at timestamp trigger for veyra_user
    CREATE OR REPLACE FUNCTION trg_veyra_user_set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_set_updated_at_veyra_user ON veyra_user;
    CREATE TRIGGER trg_set_updated_at_veyra_user
      BEFORE UPDATE ON veyra_user
      FOR EACH ROW EXECUTE FUNCTION trg_veyra_user_set_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_set_updated_at_veyra_user ON veyra_user;
    DROP FUNCTION IF EXISTS trg_veyra_user_set_updated_at();

    DROP INDEX IF EXISTS ix_veyra_user_updated_at;
    DROP INDEX IF EXISTS ix_veyra_user_created_at;
    DROP INDEX IF EXISTS ix_veyra_user_role_lookup;
    DROP INDEX IF EXISTS ix_veyra_user_last_login_at;
    DROP INDEX IF EXISTS ix_veyra_user_status_created;
    DROP INDEX IF EXISTS ix_veyra_user_status;
    DROP INDEX IF EXISTS ix_veyra_user_display_name_lower;
    DROP INDEX IF EXISTS ix_veyra_user_display_name;

    ALTER TABLE veyra_user DROP CONSTRAINT IF EXISTS ck_veyra_user_status;
    ALTER TABLE veyra_user ADD CONSTRAINT ck_veyra_user_status 
      CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED', 'EXPIRED'));
  `);
};
