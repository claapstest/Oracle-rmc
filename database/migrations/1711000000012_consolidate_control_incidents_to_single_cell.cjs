/**
 * Migration: Consolidate Control Incidents to Single Row per Control ID with Single JSONB Cell
 * Feature: Exactly 1 row per control ID containing the complete raw incidents array from Oracle Fusion
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Create table with exactly 1 row per control ID and a single cell for all raw incidents
    CREATE TABLE IF NOT EXISTS oracle_control_incidents (
      environment_host VARCHAR(255) NOT NULL,
      control_id VARCHAR(100) NOT NULL,
      control_name VARCHAR(255),
      total_incidents INT DEFAULT 0,
      last_oracle_update_date TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(),
      sync_status VARCHAR(50) DEFAULT 'READY' CHECK (sync_status IN ('NOT_SYNCED', 'SYNCING', 'READY', 'PARTIAL', 'ERROR')),
      raw_incidents JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (environment_host, control_id)
    );

    -- 2. Migrate existing records from oracle_control_raw_incidents if any exist
    DO $$
    BEGIN
      IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'oracle_control_raw_incidents') THEN
        INSERT INTO oracle_control_incidents (
          environment_host,
          control_id,
          total_incidents,
          last_oracle_update_date,
          raw_incidents,
          sync_status,
          updated_at
        )
        SELECT
          environment_host,
          control_id,
          COUNT(*)::int as total_incidents,
          MAX(oracle_last_update_date) as last_oracle_update_date,
          COALESCE(jsonb_agg(raw_payload ORDER BY id), '[]'::jsonb) as raw_incidents,
          'READY',
          NOW()
        FROM oracle_control_raw_incidents
        GROUP BY environment_host, control_id
        ON CONFLICT (environment_host, control_id) DO UPDATE SET
          total_incidents = EXCLUDED.total_incidents,
          last_oracle_update_date = EXCLUDED.last_oracle_update_date,
          raw_incidents = EXCLUDED.raw_incidents,
          updated_at = NOW();

        -- Drop the old table that had one row per incident
        DROP TABLE oracle_control_raw_incidents CASCADE;
      END IF;
    END $$;

    -- 3. High-performance Index
    CREATE INDEX IF NOT EXISTS ix_oracle_ctrl_incidents_host
      ON oracle_control_incidents (environment_host);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS oracle_control_incidents CASCADE;
  `);
};
