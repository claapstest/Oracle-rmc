/**
 * Migration: Create Oracle Raw Controls Table
 * Feature: Store raw control definition and metadata JSON from Oracle Fusion
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS oracle_raw_controls (
      environment_host VARCHAR(255) NOT NULL,
      control_id VARCHAR(100) NOT NULL,
      name VARCHAR(255),
      state VARCHAR(50),
      status VARCHAR(50),
      oracle_last_run_date TIMESTAMPTZ,
      oracle_last_update_date TIMESTAMPTZ,
      raw_payload JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (environment_host, control_id)
    );

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_controls_host
      ON oracle_raw_controls (environment_host);

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_controls_gin
      ON oracle_raw_controls USING GIN (raw_payload);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS oracle_raw_controls CASCADE;
  `);
};
