/**
 * Migration: Create Oracle Raw Access Certifications and Certifier Worksheets Tables
 * Feature: Store raw BI Publisher report data for Access Certifications campaigns and Certifier Worksheets
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Table for Oracle Fusion Access Certifications Campaigns (from Access Certification Review Report)
    CREATE TABLE IF NOT EXISTS oracle_raw_access_certifications (
      environment_host VARCHAR(255) NOT NULL,
      certification_id VARCHAR(255) NOT NULL,
      certification_name VARCHAR(255),
      type VARCHAR(100),
      status VARCHAR(100),
      percent_complete NUMERIC DEFAULT 0,
      due_date VARCHAR(50),
      creation_date VARCHAR(50),
      owner_name VARCHAR(255),
      manager_name VARCHAR(255),
      certifier_name VARCHAR(255),
      raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (environment_host, certification_id)
    );

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_access_certs_host ON oracle_raw_access_certifications (environment_host);
    CREATE INDEX IF NOT EXISTS ix_oracle_raw_access_certs_status ON oracle_raw_access_certifications (status);
    CREATE INDEX IF NOT EXISTS ix_oracle_raw_access_certs_name ON oracle_raw_access_certifications (certification_name);

    -- 2. Table for Oracle Fusion Certifier Worksheet Rows (from Certifier Worksheet Report with P_CERTIFICATION_ID)
    CREATE TABLE IF NOT EXISTS oracle_raw_certifier_worksheets (
      id BIGSERIAL PRIMARY KEY,
      environment_host VARCHAR(255) NOT NULL,
      certification_id VARCHAR(255) NOT NULL,
      certification_name VARCHAR(255),
      user_name VARCHAR(255),
      role_name VARCHAR(255),
      role_code VARCHAR(255),
      certifier_name VARCHAR(255),
      certified_manager VARCHAR(255),
      direct_manager VARCHAR(255),
      business_unit VARCHAR(255),
      department VARCHAR(255),
      action VARCHAR(100),
      raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_worksheet_cert ON oracle_raw_certifier_worksheets (environment_host, certification_id);
    CREATE INDEX IF NOT EXISTS ix_oracle_raw_worksheet_user ON oracle_raw_certifier_worksheets (user_name);
    CREATE INDEX IF NOT EXISTS ix_oracle_raw_worksheet_role ON oracle_raw_certifier_worksheets (role_name);
    CREATE INDEX IF NOT EXISTS ix_oracle_raw_worksheet_mgr ON oracle_raw_certifier_worksheets (direct_manager);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS oracle_raw_certifier_worksheets CASCADE;
    DROP TABLE IF EXISTS oracle_raw_access_certifications CASCADE;
  `);
};
