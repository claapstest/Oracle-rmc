/**
 * Migration: Create Veyra Sync Checkpoints & Quarantine Tables
 * Story ID: VYR-044
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both
 *
 * Implements persistent state tracking for:
 *   1. veyra_sync_checkpoints: High-watermark timestamps, pagination cursors,
 *      and batch progression committed ONLY after successful database persistence.
 *   2. veyra_sync_quarantine: Dead-letter queue for malformed/corrupted records
 *      and partial domain failures, allowing partial failure visibility and recovery.
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Sync Checkpoints / Watermarks Table
    CREATE TABLE IF NOT EXISTS veyra_sync_checkpoints (
      checkpoint_key VARCHAR(128) PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL DEFAULT '__GLOBAL__',
      domain VARCHAR(64) NOT NULL,
      watermark_timestamp TIMESTAMPTZ,
      watermark_cursor TEXT,
      last_successful_batch INT NOT NULL DEFAULT 0,
      records_persisted INT NOT NULL DEFAULT 0,
      last_sync_started_at TIMESTAMPTZ,
      last_sync_completed_at TIMESTAMPTZ,
      status VARCHAR(32) NOT NULL DEFAULT 'IDLE',
      metadata JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS ix_veyra_sync_checkpoints_tenant_domain
      ON veyra_sync_checkpoints (tenant_id, domain);

    CREATE INDEX IF NOT EXISTS ix_veyra_sync_checkpoints_watermark
      ON veyra_sync_checkpoints (domain, watermark_timestamp);

    -- 2. Dead-Letter / Quarantine Table for Malformed Records
    CREATE TABLE IF NOT EXISTS veyra_sync_quarantine (
      id VARCHAR(64) PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL DEFAULT '__GLOBAL__',
      domain VARCHAR(64) NOT NULL,
      record_key VARCHAR(256),
      payload JSONB,
      error_reason TEXT NOT NULL,
      error_code VARCHAR(64),
      retry_count INT NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL DEFAULT 'QUARANTINED',
      quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      metadata JSONB
    );

    CREATE INDEX IF NOT EXISTS ix_veyra_sync_quarantine_tenant_domain_status
      ON veyra_sync_quarantine (tenant_id, domain, status);

    CREATE INDEX IF NOT EXISTS ix_veyra_sync_quarantine_quarantined_at
      ON veyra_sync_quarantine (quarantined_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS veyra_sync_quarantine CASCADE;
    DROP TABLE IF EXISTS veyra_sync_checkpoints CASCADE;
  `);
};
