/**
 * Migration: Create VEYRA User, Role, and Privilege Database Tables
 * Story: VY-STRY-008
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. veyra_user
    CREATE TABLE IF NOT EXISTS veyra_user (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255),
      display_name VARCHAR(150),
      status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
      is_local_user BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ,
      created_by VARCHAR(100),
      updated_by VARCHAR(100),
      CONSTRAINT uq_veyra_user_email UNIQUE (email),
      CONSTRAINT ck_veyra_user_status CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED', 'EXPIRED')),
      CONSTRAINT ck_veyra_user_email_normalized CHECK (email = LOWER(TRIM(email)))
    );
    CREATE INDEX IF NOT EXISTS ix_veyra_user_email ON veyra_user(email);

    -- 2. veyra_role
    CREATE TABLE IF NOT EXISTS veyra_role (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      role_code VARCHAR(100) NOT NULL,
      role_name VARCHAR(150) NOT NULL,
      description TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_veyra_role_role_code UNIQUE (role_code)
    );
    CREATE INDEX IF NOT EXISTS ix_veyra_role_role_code ON veyra_role(role_code);

    -- 3. veyra_privilege
    CREATE TABLE IF NOT EXISTS veyra_privilege (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      privilege_code VARCHAR(100) NOT NULL,
      privilege_name VARCHAR(150) NOT NULL,
      description TEXT,
      module VARCHAR(100),
      status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_veyra_privilege_privilege_code UNIQUE (privilege_code)
    );
    CREATE INDEX IF NOT EXISTS ix_veyra_privilege_privilege_code ON veyra_privilege(privilege_code);

    -- 4. veyra_user_role
    CREATE TABLE IF NOT EXISTS veyra_user_role (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      role_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by VARCHAR(100),
      CONSTRAINT fk_veyra_user_role_user_id FOREIGN KEY (user_id) REFERENCES veyra_user(id) ON DELETE CASCADE,
      CONSTRAINT fk_veyra_user_role_role_id FOREIGN KEY (role_id) REFERENCES veyra_role(id) ON DELETE CASCADE,
      CONSTRAINT uq_veyra_user_role UNIQUE (user_id, role_id)
    );
    CREATE INDEX IF NOT EXISTS ix_veyra_user_role_user_id ON veyra_user_role(user_id);
    CREATE INDEX IF NOT EXISTS ix_veyra_user_role_role_id ON veyra_user_role(role_id);

    -- 5. veyra_role_privilege
    CREATE TABLE IF NOT EXISTS veyra_role_privilege (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      role_id UUID NOT NULL,
      privilege_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by VARCHAR(100),
      CONSTRAINT fk_veyra_role_privilege_role_id FOREIGN KEY (role_id) REFERENCES veyra_role(id) ON DELETE CASCADE,
      CONSTRAINT fk_veyra_role_privilege_privilege_id FOREIGN KEY (privilege_id) REFERENCES veyra_privilege(id) ON DELETE CASCADE,
      CONSTRAINT uq_veyra_role_privilege UNIQUE (role_id, privilege_id)
    );
    CREATE INDEX IF NOT EXISTS ix_veyra_role_privilege_role_id ON veyra_role_privilege(role_id);
    CREATE INDEX IF NOT EXISTS ix_veyra_role_privilege_privilege_id ON veyra_role_privilege(privilege_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS veyra_role_privilege CASCADE;
    DROP TABLE IF EXISTS veyra_user_role CASCADE;
    DROP TABLE IF EXISTS veyra_privilege CASCADE;
    DROP TABLE IF EXISTS veyra_role CASCADE;
    DROP TABLE IF EXISTS veyra_user CASCADE;
  `);
};
