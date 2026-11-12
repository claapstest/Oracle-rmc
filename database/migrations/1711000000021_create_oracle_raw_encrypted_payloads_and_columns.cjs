/**
 * Migration: Create Oracle Raw Encrypted Payloads & Encryption Migration Ledger
 * Story ID: VYR-031
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Adds encryption tracking columns (is_encrypted, encryption_format_version,
 * encryption_key_id, encrypted_at) and performance indexes across all 10 raw
 * Oracle Fusion persistence tables. Adds raw_payload JSONB column to oracle_raw_user_access.
 * Creates oracle_encryption_migration_ledger table for rolling migration tracking.
 */

const RAW_TABLES = [
  'oracle_raw_audit_records',
  'oracle_raw_users',
  'oracle_raw_roles',
  'oracle_raw_role_hierarchy',
  'oracle_raw_controls',
  'oracle_control_incidents',
  'oracle_incident_rows',
  'oracle_raw_access_certifications',
  'oracle_raw_certifier_worksheets',
  'oracle_raw_user_access',
];

exports.up = (pgm) => {
  // 1. Add raw_payload JSONB column to oracle_raw_user_access if not present
  pgm.sql(`
    ALTER TABLE oracle_raw_user_access
      ADD COLUMN IF NOT EXISTS raw_payload JSONB DEFAULT NULL;
  `);

  // 2. Add encryption tracking columns and indexes to all 10 raw tables
  for (const table of RAW_TABLES) {
    pgm.sql(`
      ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS encryption_format_version INTEGER DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS encryption_key_id VARCHAR(128) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS encrypted_at TIMESTAMPTZ DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS ix_${table}_enc_status
        ON ${table} (environment_host, is_encrypted);
    `);
  }

  // 3. Create dedicated migration tracking ledger
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS oracle_encryption_migration_ledger (
      id SERIAL PRIMARY KEY,
      table_name VARCHAR(128) NOT NULL,
      environment_host VARCHAR(255) NOT NULL,
      total_records INT NOT NULL DEFAULT 0,
      encrypted_records INT NOT NULL DEFAULT 0,
      plaintext_records INT NOT NULL DEFAULT 0,
      last_migrated_id TEXT DEFAULT NULL,
      batch_size INT NOT NULL DEFAULT 100,
      status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
      last_error TEXT DEFAULT NULL,
      started_at TIMESTAMPTZ DEFAULT NULL,
      completed_at TIMESTAMPTZ DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_enc_migration_ledger UNIQUE (table_name, environment_host)
    );

    CREATE INDEX IF NOT EXISTS ix_enc_migration_ledger_status
      ON oracle_encryption_migration_ledger (status);

    CREATE INDEX IF NOT EXISTS ix_enc_migration_ledger_host
      ON oracle_encryption_migration_ledger (environment_host);
  `);
};

exports.down = (pgm) => {
  // Drop ledger table
  pgm.sql(`
    DROP TABLE IF EXISTS oracle_encryption_migration_ledger CASCADE;
  `);

  // Drop columns and indexes from raw tables
  for (const table of RAW_TABLES) {
    pgm.sql(`
      DROP INDEX IF EXISTS ix_${table}_enc_status CASCADE;

      ALTER TABLE ${table}
        DROP COLUMN IF EXISTS is_encrypted,
        DROP COLUMN IF EXISTS encryption_format_version,
        DROP COLUMN IF EXISTS encryption_key_id,
        DROP COLUMN IF EXISTS encrypted_at;
    `);
  }

  pgm.sql(`
    ALTER TABLE oracle_raw_user_access
      DROP COLUMN IF EXISTS raw_payload;
  `);
};
