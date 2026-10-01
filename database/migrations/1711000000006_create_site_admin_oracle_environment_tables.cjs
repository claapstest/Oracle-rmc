/**
 * Migration: Create Database Structures for Site Administration and Oracle Integration
 * Story: VY-STRY-22: DB: Create Database Structures for Site Administration and Oracle Integration
 *
 * Implements:
 * 1. veyra_oracle_environment - Config persistence for multiple Oracle environments (AC1, AC2, AC6)
 * 2. Secrets security - Strict prohibition of plain text secrets; references & metadata only (AC5)
 * 3. Configuration status & health tracking (AC3)
 * 4. veyra_oracle_environment_audit & automated trigger - Full auditability of all changes (AC4)
 * 5. Multi-environment support with partial unique index for default environment (AC6)
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Create veyra_oracle_environment table
    CREATE TABLE IF NOT EXISTS veyra_oracle_environment (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      env_code VARCHAR(100) NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,

      -- Oracle API Configuration (AC1)
      base_url VARCHAR(500) NOT NULL,
      auth_type VARCHAR(50) NOT NULL DEFAULT 'BASIC',
      username VARCHAR(255),
      api_version VARCHAR(50) NOT NULL DEFAULT '11.13.18.05',
      timeout_ms INTEGER NOT NULL DEFAULT 30000,
      max_retries INTEGER NOT NULL DEFAULT 3,

      -- Secrets Reference & Metadata Management (AC5: Zero plain text secrets)
      secret_vault_ref VARCHAR(255),
      secret_storage_type VARCHAR(50) NOT NULL DEFAULT 'VAULT_REF',
      secret_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_secret_configured BOOLEAN NOT NULL DEFAULT false,

      -- Integration Status & Health Monitoring (AC3)
      status VARCHAR(50) NOT NULL DEFAULT 'STANDBY',
      health_status VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
      health_message TEXT,
      last_sync_at TIMESTAMPTZ,
      last_health_check_at TIMESTAMPTZ,

      -- Multi-Environment Orchestration (AC6)
      is_default BOOLEAN NOT NULL DEFAULT false,
      is_active BOOLEAN NOT NULL DEFAULT true,

      -- Extensible Metadata & Custom Headers
      custom_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      version INTEGER NOT NULL DEFAULT 1,

      -- Audit Trail Metadata
      created_by VARCHAR(255) NOT NULL DEFAULT 'SYSTEM',
      updated_by VARCHAR(255) NOT NULL DEFAULT 'SYSTEM',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- Constraints
      CONSTRAINT uq_veyra_oracle_env_code UNIQUE (env_code),
      CONSTRAINT ck_veyra_oracle_env_code_format CHECK (env_code ~ '^[A-Za-z0-9_-]+$'),
      CONSTRAINT ck_veyra_oracle_env_auth_type CHECK (auth_type IN ('BASIC', 'BEARER', 'OAUTH2', 'API_KEY')),
      CONSTRAINT ck_veyra_oracle_env_secret_storage CHECK (secret_storage_type IN ('VAULT_REF', 'ENV_REF', 'AWS_SECRETS_MANAGER', 'AZURE_KEY_VAULT', 'KMS_ENCRYPTED')),
      CONSTRAINT ck_veyra_oracle_env_status CHECK (status IN ('STANDBY', 'CONNECTED', 'DISCONNECTED', 'DEGRADED', 'ERROR', 'MAINTENANCE')),
      CONSTRAINT ck_veyra_oracle_env_health CHECK (health_status IN ('HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN')),
      CONSTRAINT ck_veyra_oracle_env_timeout CHECK (timeout_ms >= 1000 AND timeout_ms <= 300000),
      CONSTRAINT ck_veyra_oracle_env_no_plaintext_passwords CHECK (
        NOT (
          secret_metadata ? 'password' OR 
          secret_metadata ? 'client_secret' OR 
          secret_metadata ? 'token' OR 
          secret_metadata ? 'access_token' OR
          secret_metadata ? 'raw_password'
        )
      )
    );

    -- Unique index on is_default ensures at most ONE active default environment exists at a time (AC6)
    CREATE UNIQUE INDEX IF NOT EXISTS ix_veyra_oracle_env_default 
      ON veyra_oracle_environment(is_default) 
      WHERE is_default = TRUE;

    -- Query optimization indexes
    CREATE INDEX IF NOT EXISTS ix_veyra_oracle_env_code ON veyra_oracle_environment(env_code);
    CREATE INDEX IF NOT EXISTS ix_veyra_oracle_env_status_active ON veyra_oracle_environment(status, is_active);
    CREATE INDEX IF NOT EXISTS ix_veyra_oracle_env_updated_at ON veyra_oracle_environment(updated_at DESC);

    -- 2. Create veyra_oracle_environment_audit table for change auditing (AC4)
    CREATE TABLE IF NOT EXISTS veyra_oracle_environment_audit (
      audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      environment_id UUID,
      env_code VARCHAR(100) NOT NULL,
      action VARCHAR(50) NOT NULL,
      changed_by VARCHAR(255) NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ip_address VARCHAR(100),
      user_agent TEXT,
      previous_state JSONB,
      new_state JSONB,
      diff JSONB,
      reason TEXT,
      CONSTRAINT fk_veyra_oracle_audit_env FOREIGN KEY (environment_id) REFERENCES veyra_oracle_environment(id) ON DELETE SET NULL,
      CONSTRAINT ck_veyra_oracle_audit_action CHECK (action IN (
        'CREATE',
        'UPDATE',
        'STATUS_CHANGE',
        'SECRET_ROTATED',
        'TEST_CONNECTION',
        'SYNC_INITIATED',
        'SET_DEFAULT',
        'DELETE'
      )),
      CONSTRAINT ck_veyra_oracle_audit_no_plaintext_passwords CHECK (
        NOT (
          (diff ? 'password') OR 
          (diff ? 'token') OR 
          (new_state ? 'password') OR 
          (new_state ? 'token')
        )
      )
    );

    -- Audit query performance indexes
    CREATE INDEX IF NOT EXISTS ix_veyra_oracle_audit_env_time ON veyra_oracle_environment_audit(environment_id, changed_at DESC);
    CREATE INDEX IF NOT EXISTS ix_veyra_oracle_audit_env_code_time ON veyra_oracle_environment_audit(env_code, changed_at DESC);
    CREATE INDEX IF NOT EXISTS ix_veyra_oracle_audit_action_time ON veyra_oracle_environment_audit(action, changed_at DESC);

    -- 3. Automatic Audit Trigger function to capture all configuration changes (AC4)
    CREATE OR REPLACE FUNCTION trg_veyra_oracle_env_audit()
    RETURNS TRIGGER AS $$
    DECLARE
      v_action VARCHAR(50);
      v_old_json JSONB;
      v_new_json JSONB;
      v_diff JSONB;
      v_user VARCHAR(255);
    BEGIN
      IF TG_OP = 'INSERT' THEN
        v_action := 'CREATE';
        v_new_json := to_jsonb(NEW) - 'secret_metadata';
        v_user := COALESCE(NEW.created_by, 'SYSTEM');
        INSERT INTO veyra_oracle_environment_audit (
          environment_id, env_code, action, changed_by, changed_at, new_state, diff, reason
        ) VALUES (
          NEW.id, NEW.env_code, v_action, v_user, now(), v_new_json, v_new_json, 'Initial environment configuration created'
        );
        RETURN NEW;
      ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status IS DISTINCT FROM NEW.status THEN
          v_action := 'STATUS_CHANGE';
        ELSE
          v_action := 'UPDATE';
        END IF;
        v_old_json := to_jsonb(OLD) - 'secret_metadata';
        v_new_json := to_jsonb(NEW) - 'secret_metadata';
        v_diff := jsonb_build_object(
          'status_changed', OLD.status IS DISTINCT FROM NEW.status,
          'old_status', OLD.status,
          'new_status', NEW.status,
          'base_url_changed', OLD.base_url IS DISTINCT FROM NEW.base_url,
          'old_base_url', OLD.base_url,
          'new_base_url', NEW.base_url,
          'version', NEW.version
        );
        v_user := COALESCE(NEW.updated_by, 'SYSTEM');
        INSERT INTO veyra_oracle_environment_audit (
          environment_id, env_code, action, changed_by, changed_at, previous_state, new_state, diff, reason
        ) VALUES (
          NEW.id, NEW.env_code, v_action, v_user, now(), v_old_json, v_new_json, v_diff, 'Environment configuration updated'
        );
        RETURN NEW;
      ELSIF TG_OP = 'DELETE' THEN
        v_action := 'DELETE';
        v_old_json := to_jsonb(OLD) - 'secret_metadata';
        v_user := COALESCE(OLD.updated_by, 'SYSTEM');
        INSERT INTO veyra_oracle_environment_audit (
          environment_id, env_code, action, changed_by, changed_at, previous_state, reason
        ) VALUES (
          NULL, OLD.env_code, v_action, v_user, now(), v_old_json, 'Environment configuration deleted'
        );
        RETURN OLD;
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_audit_veyra_oracle_environment ON veyra_oracle_environment;
    CREATE TRIGGER trg_audit_veyra_oracle_environment
      AFTER INSERT OR UPDATE OR DELETE ON veyra_oracle_environment
      FOR EACH ROW EXECUTE FUNCTION trg_veyra_oracle_env_audit();

    -- 4. Initial Seed for Primary Default Environment
    INSERT INTO veyra_oracle_environment (
      env_code, name, description, base_url, auth_type, username,
      secret_vault_ref, secret_storage_type, secret_metadata, is_secret_configured,
      status, health_status, health_message, is_default, is_active,
      metadata
    ) VALUES (
      'DEFAULT',
      'Oracle Fusion Cloud - Primary Production',
      'Default enterprise Oracle Fusion ERP / HCM REST, BIP, and SOAP integration endpoint',
      'https://fa-internal-fusion.oraclecloud.com',
      'BASIC',
      'FUSION_SVC_ADMIN',
      'vault://veyra/oracle/environments/default/credentials',
      'VAULT_REF',
      '{"key_version": "v1", "provider": "HASHICORP_VAULT", "last_rotated": "2026-03-01T00:00:00Z"}'::jsonb,
      true,
      'STANDBY',
      'HEALTHY',
      'Standby - ready for connection testing and synchronization',
      true,
      true,
      '{"region": "us-ashburn-1", "groqModel": "llama-3.3-70b-versatile", "catalogEndpointsCount": 42}'::jsonb
    ) ON CONFLICT (env_code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_audit_veyra_oracle_environment ON veyra_oracle_environment;
    DROP FUNCTION IF EXISTS trg_veyra_oracle_env_audit();
    DROP INDEX IF EXISTS ix_veyra_oracle_audit_action_time;
    DROP INDEX IF EXISTS ix_veyra_oracle_audit_env_code_time;
    DROP INDEX IF EXISTS ix_veyra_oracle_audit_env_time;
    DROP TABLE IF EXISTS veyra_oracle_environment_audit CASCADE;
    DROP INDEX IF EXISTS ix_veyra_oracle_env_default;
    DROP INDEX IF EXISTS ix_veyra_oracle_env_updated_at;
    DROP INDEX IF EXISTS ix_veyra_oracle_env_status_active;
    DROP INDEX IF EXISTS ix_veyra_oracle_env_code;
    DROP TABLE IF EXISTS veyra_oracle_environment CASCADE;
  `);
};
