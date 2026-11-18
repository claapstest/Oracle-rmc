/**
 * Migration: VYR-053 — security audit event schema extension
 * Epic: EPIC 6 — OWASP application and API security hardening
 *
 * Extends veyra_audit_event with the standardized security-event schema
 * (actor/service identity, tenant, result, correlation ID, tamper-evidence
 * hash) and widens the event-type CHECK constraint to cover configuration
 * changes, privileged data access, decryption access and audit-log access.
 *
 * The runtime also applies this idempotently on first use (see
 * AuditService.ensureAuditSchema) — this migration makes it explicit for
 * migration-managed environments.
 */

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE veyra_audit_event ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(64);
    ALTER TABLE veyra_audit_event ADD COLUMN IF NOT EXISTS service_identity VARCHAR(100);
    ALTER TABLE veyra_audit_event ADD COLUMN IF NOT EXISTS tenant VARCHAR(100);
    ALTER TABLE veyra_audit_event ADD COLUMN IF NOT EXISTS result VARCHAR(20);
    ALTER TABLE veyra_audit_event ADD COLUMN IF NOT EXISTS event_hash VARCHAR(64);
    ALTER TABLE veyra_audit_event DROP CONSTRAINT IF EXISTS ck_veyra_audit_event_type;
    ALTER TABLE veyra_audit_event ADD CONSTRAINT ck_veyra_audit_event_type
      CHECK (event_type IN (
        'LOGIN_SUCCESS',
        'LOGIN_FAILED',
        'LOGIN_REJECTED_ACTIVE_SESSION',
        'LOGOUT',
        'SESSION_EXPIRED',
        'USER_CREATED',
        'USER_UPDATED',
        'USER_DELETED',
        'ROLE_ASSIGNED',
        'ROLE_REMOVED',
        'PRIVILEGE_CHANGED',
        'CONFIG_CHANGED',
        'PRIVILEGED_DATA_ACCESS',
        'DECRYPTION_ACCESS',
        'AUDIT_LOG_ACCESS'
      ));
    CREATE INDEX IF NOT EXISTS idx_veyra_audit_event_correlation ON veyra_audit_event (correlation_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_veyra_audit_event_correlation;
    ALTER TABLE veyra_audit_event DROP CONSTRAINT IF EXISTS ck_veyra_audit_event_type;
    ALTER TABLE veyra_audit_event ADD CONSTRAINT ck_veyra_audit_event_type
      CHECK (event_type IN (
        'LOGIN_SUCCESS',
        'LOGIN_FAILED',
        'LOGIN_REJECTED_ACTIVE_SESSION',
        'LOGOUT',
        'SESSION_EXPIRED',
        'USER_CREATED',
        'USER_UPDATED',
        'USER_DELETED',
        'ROLE_ASSIGNED',
        'ROLE_REMOVED',
        'PRIVILEGE_CHANGED'
      ));
    ALTER TABLE veyra_audit_event DROP COLUMN IF EXISTS correlation_id;
    ALTER TABLE veyra_audit_event DROP COLUMN IF EXISTS service_identity;
    ALTER TABLE veyra_audit_event DROP COLUMN IF EXISTS tenant;
    ALTER TABLE veyra_audit_event DROP COLUMN IF EXISTS result;
    ALTER TABLE veyra_audit_event DROP COLUMN IF EXISTS event_hash;
  `);
};
