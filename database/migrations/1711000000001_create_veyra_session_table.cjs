/**
 * Migration: Create VEYRA Session Tracking Table
 * Story: VY-STRY-009
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- Create veyra_session table
    CREATE TABLE IF NOT EXISTS veyra_session (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id VARCHAR(255) NOT NULL,
      user_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ,
      logged_out_at TIMESTAMPTZ,
      status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
      ip_address INET,
      user_agent TEXT,
      created_by VARCHAR(100),
      CONSTRAINT uq_veyra_session_session_id UNIQUE (session_id),
      CONSTRAINT fk_veyra_session_user_id FOREIGN KEY (user_id) REFERENCES veyra_user(id) ON DELETE CASCADE,
      CONSTRAINT ck_veyra_session_status CHECK (status IN ('ACTIVE', 'LOGGED_OUT', 'EXPIRED', 'REJECTED'))
    );

    -- Standard lookup indexes
    CREATE INDEX IF NOT EXISTS ix_veyra_session_session_id ON veyra_session(session_id);
    CREATE INDEX IF NOT EXISTS ix_veyra_session_user_id ON veyra_session(user_id);
    CREATE INDEX IF NOT EXISTS ix_veyra_session_status ON veyra_session(status);

    -- Partial unique index to enforce SINGLE ACTIVE SESSION per user
    -- Permits multiple historical sessions (LOGGED_OUT, EXPIRED, REJECTED)
    -- but strictly prevents more than one ACTIVE session for any user
    CREATE UNIQUE INDEX IF NOT EXISTS uq_veyra_session_user_active 
      ON veyra_session(user_id) 
      WHERE status = 'ACTIVE';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS uq_veyra_session_user_active;
    DROP INDEX IF EXISTS ix_veyra_session_status;
    DROP INDEX IF EXISTS ix_veyra_session_user_id;
    DROP INDEX IF EXISTS ix_veyra_session_session_id;
    DROP TABLE IF EXISTS veyra_session CASCADE;
  `);
};
