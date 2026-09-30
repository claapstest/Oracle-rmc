/**
 * Migration: Create VEYRA Authentication and Administrative Audit Trail Table
 * Story: VY-STRY-010
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- Create veyra_audit_event table
    CREATE TABLE IF NOT EXISTS veyra_audit_event (
      event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID,
      event_type VARCHAR(100) NOT NULL,
      event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
      ip_address VARCHAR(100),
      user_agent TEXT,
      target_type VARCHAR(100),
      target_id VARCHAR(255),
      details JSONB,
      CONSTRAINT fk_veyra_audit_event_user_id FOREIGN KEY (user_id) REFERENCES veyra_user(id) ON DELETE SET NULL,
      CONSTRAINT ck_veyra_audit_event_type CHECK (event_type IN (
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
      ))
    );

    -- Audit retrieval indexes
    CREATE INDEX IF NOT EXISTS ix_veyra_audit_event_time ON veyra_audit_event(event_time DESC);
    CREATE INDEX IF NOT EXISTS ix_veyra_audit_event_user_id ON veyra_audit_event(user_id);
    CREATE INDEX IF NOT EXISTS ix_veyra_audit_event_event_type ON veyra_audit_event(event_type);
    CREATE INDEX IF NOT EXISTS ix_veyra_audit_event_target ON veyra_audit_event(target_type, target_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS ix_veyra_audit_event_target;
    DROP INDEX IF EXISTS ix_veyra_audit_event_event_type;
    DROP INDEX IF EXISTS ix_veyra_audit_event_user_id;
    DROP INDEX IF EXISTS ix_veyra_audit_event_time;
    DROP TABLE IF EXISTS veyra_audit_event CASCADE;
  `);
};
