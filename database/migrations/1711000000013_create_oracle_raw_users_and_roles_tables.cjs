/**
 * Migration: Create Oracle Raw Users and Roles Tables
 * Feature: Store raw JSON data from Oracle Fusion for Users and Roles in separate dedicated tables
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Table for Oracle Fusion Raw Users
    CREATE TABLE IF NOT EXISTS oracle_raw_users (
      environment_host VARCHAR(255) NOT NULL,
      username VARCHAR(255) NOT NULL,
      display_name VARCHAR(255),
      email VARCHAR(255),
      is_active BOOLEAN DEFAULT TRUE,
      user_category VARCHAR(100),
      raw_user JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (environment_host, username)
    );

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_users_host ON oracle_raw_users (environment_host);
    CREATE INDEX IF NOT EXISTS ix_oracle_raw_users_username ON oracle_raw_users (username);

    -- 2. Table for Oracle Fusion Raw Roles
    CREATE TABLE IF NOT EXISTS oracle_raw_roles (
      environment_host VARCHAR(255) NOT NULL,
      role_code VARCHAR(255) NOT NULL,
      role_name VARCHAR(255),
      category VARCHAR(100),
      is_custom BOOLEAN DEFAULT FALSE,
      member_count INT DEFAULT 0,
      raw_role JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (environment_host, role_code)
    );

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_roles_host ON oracle_raw_roles (environment_host);
    CREATE INDEX IF NOT EXISTS ix_oracle_raw_roles_category ON oracle_raw_roles (category);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS oracle_raw_users CASCADE;
    DROP TABLE IF EXISTS oracle_raw_roles CASCADE;
  `);
};
