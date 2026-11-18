/**
 * Migration: Create Veyra Rate Limit & Account Lockouts Tables
 * Story ID: VYR-048
 * Epic: EPIC 6 — OWASP application and API security hardening
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Implements persistent audit and state tracking for:
 *   1. veyra_account_lockouts: Account lockout state after consecutive failed logins
 *      with automatic lockout window, unlock auditing, and failed attempt counting.
 *   2. veyra_rate_limit_events: Abuse telemetry tracking 429 rate limit events
 *      with client IP, route tier, and user identifier (NO raw credentials or tokens logged).
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Account Lockout Tracking Table (GAP-002 / ASVS V2.2)
    CREATE TABLE IF NOT EXISTS veyra_account_lockouts (
      email VARCHAR(320) PRIMARY KEY,
      failed_attempts INT NOT NULL DEFAULT 0,
      last_failed_at TIMESTAMPTZ,
      locked_until TIMESTAMPTZ,
      is_locked BOOLEAN NOT NULL DEFAULT false,
      unlocked_by VARCHAR(320),
      unlocked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS ix_veyra_account_lockouts_locked
      ON veyra_account_lockouts (is_locked, locked_until);

    -- 2. Rate Limit & Abuse Events Audit Table (GAP-017 / API4:2023)
    CREATE TABLE IF NOT EXISTS veyra_rate_limit_events (
      id BIGSERIAL PRIMARY KEY,
      client_ip VARCHAR(64) NOT NULL,
      identifier VARCHAR(320),
      tenant_id VARCHAR(64) DEFAULT '__GLOBAL__',
      tier VARCHAR(32) NOT NULL,
      route VARCHAR(255) NOT NULL,
      method VARCHAR(16) NOT NULL,
      retry_after_seconds INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS ix_veyra_rate_limit_events_ip_created
      ON veyra_rate_limit_events (client_ip, created_at DESC);

    CREATE INDEX IF NOT EXISTS ix_veyra_rate_limit_events_tier
      ON veyra_rate_limit_events (tier, created_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS veyra_rate_limit_events CASCADE;
    DROP TABLE IF EXISTS veyra_account_lockouts CASCADE;
  `);
};
