/**
 * Migration: Create Veyra Distributed Locks Table (veyra_distributed_locks)
 * Story ID: VYR-043
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both
 *
 * Implements persistent distributed mutual exclusion for scheduled jobs and
 * on-demand ingestion across multiple server replicas/workers.
 * Supports:
 *   - Per-tenant and per-domain lock scopes
 *   - Configurable lock timeouts (expires_at)
 *   - Stale lock detection and automatic recovery
 *   - Worker/holder attribution and heartbeat tracking
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS veyra_distributed_locks (
      lock_key VARCHAR(128) PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL DEFAULT '__GLOBAL__',
      domain VARCHAR(64) NOT NULL DEFAULT 'full',
      holder_id VARCHAR(128) NOT NULL,
      task_name TEXT,
      acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata JSONB
    );

    CREATE INDEX IF NOT EXISTS ix_veyra_dist_locks_expires
      ON veyra_distributed_locks (expires_at);

    CREATE INDEX IF NOT EXISTS ix_veyra_dist_locks_tenant_domain
      ON veyra_distributed_locks (tenant_id, domain);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS veyra_distributed_locks CASCADE;
  `);
};
