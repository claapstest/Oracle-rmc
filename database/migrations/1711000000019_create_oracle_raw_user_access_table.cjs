/**
 * Migration: Create Oracle Raw User Access Table & Summary
 * Feature: Store User Access Report rows (SCIM Users + HCM Workers + BIP Auto-Provision) in PostgreSQL as single source of truth
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS oracle_raw_user_access (
      id BIGSERIAL PRIMARY KEY,
      environment_host VARCHAR(255) NOT NULL,
      username VARCHAR(255) NOT NULL,
      user_category VARCHAR(100),
      first_name VARCHAR(255),
      last_name VARCHAR(255),
      display_name VARCHAR(255),
      email VARCHAR(255),
      active BOOLEAN DEFAULT TRUE,
      role_name VARCHAR(500),
      role_code VARCHAR(255),
      auto_provisioned VARCHAR(10),
      person_id VARCHAR(100),
      person_number VARCHAR(100),
      department VARCHAR(255),
      job VARCHAR(255),
      business_unit VARCHAR(255),
      location VARCHAR(255),
      manager VARCHAR(255),
      last_synced_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_user_access_host
      ON oracle_raw_user_access (environment_host);

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_user_access_username
      ON oracle_raw_user_access (environment_host, username);

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_user_access_role_code
      ON oracle_raw_user_access (environment_host, role_code);

    CREATE TABLE IF NOT EXISTS oracle_user_access_summary (
      environment_host VARCHAR(255) PRIMARY KEY,
      total_users INT NOT NULL DEFAULT 0,
      users_with_roles INT NOT NULL DEFAULT 0,
      users_without_roles INT NOT NULL DEFAULT 0,
      total_role_assignments INT NOT NULL DEFAULT 0,
      active_users INT NOT NULL DEFAULT 0,
      inactive_users INT NOT NULL DEFAULT 0,
      calculated_at TIMESTAMPTZ DEFAULT NOW(),
      last_synced_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS oracle_raw_user_access CASCADE;
    DROP TABLE IF EXISTS oracle_user_access_summary CASCADE;
  `);
};

