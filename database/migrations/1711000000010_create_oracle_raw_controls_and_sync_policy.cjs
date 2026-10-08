/**
 * Migration: Create Oracle Raw Control Incidents and Product-Level Sync Policy Tables
 * Feature: Store raw Oracle Fusion JSON data with product-level incremental sync policies
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Product-Level Sync Policies
    CREATE TABLE IF NOT EXISTS product_sync_policy (
      product_code VARCHAR(50) PRIMARY KEY,
      display_name VARCHAR(100) NOT NULL,
      sync_cadence VARCHAR(20) DEFAULT 'DAILY' CHECK (sync_cadence IN ('HOURLY', 'DAILY', 'WEEKLY', 'MANUAL_ONLY')),
      sync_interval_hours INT DEFAULT 24 CHECK (sync_interval_hours > 0),
      auto_sync_enabled BOOLEAN DEFAULT TRUE,
      last_run_at TIMESTAMPTZ,
      next_scheduled_at TIMESTAMPTZ,
      last_status VARCHAR(20) DEFAULT 'IDLE' CHECK (last_status IN ('IDLE', 'RUNNING', 'SUCCESS', 'FAILED')),
      last_error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Seed default product policies
    INSERT INTO product_sync_policy (product_code, display_name, sync_cadence, sync_interval_hours, auto_sync_enabled)
    VALUES
      ('RISK_CONTROLS', 'Risk Management Advanced Controls', 'DAILY', 24, TRUE),
      ('AUDIT_TRAIL',   'Oracle Fusion Audit Trail',         'HOURLY', 2,  TRUE),
      ('ACCESS_CERTS',  'Access Certification Campaigns',    'DAILY', 12, TRUE),
      ('USER_ROLES',    'HCM Users and Role Catalog',        'WEEKLY', 168, TRUE)
    ON CONFLICT (product_code) DO NOTHING;

    -- 2. Control Incident Watermark & Synchronization Status
    CREATE TABLE IF NOT EXISTS oracle_control_sync_watermark (
      environment_host VARCHAR(255) NOT NULL,
      control_id VARCHAR(100) NOT NULL,
      control_name VARCHAR(255),
      total_incidents INT DEFAULT 0,
      synced_incidents INT DEFAULT 0,
      last_oracle_update_date TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ,
      last_checked_at TIMESTAMPTZ DEFAULT NOW(),
      sync_status VARCHAR(50) DEFAULT 'NOT_SYNCED' CHECK (sync_status IN ('NOT_SYNCED', 'SYNCING', 'READY', 'PARTIAL', 'ERROR')),
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (environment_host, control_id)
    );

    -- 3. Raw Oracle Control Incidents (Raw JSONB Storage)
    CREATE TABLE IF NOT EXISTS oracle_control_raw_incidents (
      id BIGSERIAL PRIMARY KEY,
      environment_host VARCHAR(255) NOT NULL,
      control_id VARCHAR(100) NOT NULL,
      incident_id VARCHAR(100) NOT NULL,
      status VARCHAR(50),
      state VARCHAR(50),
      priority VARCHAR(50),
      global_user_name VARCHAR(255),
      role_name VARCHAR(255),
      oracle_creation_date TIMESTAMPTZ,
      oracle_last_update_date TIMESTAMPTZ,
      raw_payload JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_oracle_control_incident UNIQUE (environment_host, control_id, incident_id)
    );

    -- 4. High-Performance Indexes
    CREATE INDEX IF NOT EXISTS ix_oracle_raw_incidents_host_ctrl
      ON oracle_control_raw_incidents (environment_host, control_id);

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_incidents_ctrl_user
      ON oracle_control_raw_incidents (control_id, global_user_name);

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_incidents_ctrl_status
      ON oracle_control_raw_incidents (control_id, status);

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_incidents_ctrl_upd
      ON oracle_control_raw_incidents (control_id, oracle_last_update_date DESC);

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_incidents_jsonb
      ON oracle_control_raw_incidents USING GIN (raw_payload);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS oracle_control_raw_incidents CASCADE;
    DROP TABLE IF EXISTS oracle_control_sync_watermark CASCADE;
    DROP TABLE IF EXISTS product_sync_policy CASCADE;
  `);
};
