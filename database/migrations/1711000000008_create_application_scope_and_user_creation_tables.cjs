/**
 * Migration: Create Application and User Application Scope Tables for User Creation Persistence
 * Story: VY-STRY-28: DB: Persist User Creation, Role Assignment and Application Access
 *
 * Requirements & Acceptance Criteria:
 * - AC1: User persistence into veyra_user
 * - AC2: Role assignment persistence in veyra_user_role
 * - AC3: Duplicate email prevention via constraint
 * - AC4: Invalid role references prevented via foreign keys
 * - AC5: User status persistence
 * - AC6: Created/updated timestamps maintenance
 * - AC7: Created-by information persistence
 * - AC8: Application/data scope association via:
 *        user -> user_application_scope -> application
 * - AC9: Transactional atomicity (ROLLBACK on failure)
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Create veyra_application table
    CREATE TABLE IF NOT EXISTS veyra_application (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_code VARCHAR(100) NOT NULL UNIQUE,
      app_name VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(100) NOT NULL DEFAULT 'ENTERPRISE_APPLICATION',
      status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT ck_veyra_application_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'DECOMMISSIONED'))
    );

    CREATE INDEX IF NOT EXISTS ix_veyra_application_app_code ON veyra_application(app_code);
    CREATE INDEX IF NOT EXISTS ix_veyra_application_status ON veyra_application(status);

    -- 2. Create veyra_user_application_scope table (AC8)
    CREATE TABLE IF NOT EXISTS veyra_user_application_scope (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      application_id UUID NOT NULL,
      scope_type VARCHAR(50) NOT NULL DEFAULT 'GLOBAL',
      scope_value VARCHAR(255) NOT NULL DEFAULT 'ALL',
      access_level VARCHAR(50) NOT NULL DEFAULT 'READ',
      status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
      granted_by VARCHAR(255) NOT NULL DEFAULT 'SYSTEM',
      granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT fk_veyra_user_app_scope_user_id FOREIGN KEY (user_id) REFERENCES veyra_user(id) ON DELETE CASCADE,
      CONSTRAINT fk_veyra_user_app_scope_app_id FOREIGN KEY (application_id) REFERENCES veyra_application(id) ON DELETE CASCADE,
      CONSTRAINT uq_veyra_user_app_scope UNIQUE (user_id, application_id, scope_type, scope_value),
      CONSTRAINT ck_veyra_user_app_scope_type CHECK (scope_type IN ('GLOBAL', 'TENANT', 'BUSINESS_UNIT', 'LEDGER', 'MODULE', 'DEPARTMENT')),
      CONSTRAINT ck_veyra_user_app_scope_access CHECK (access_level IN ('READ', 'WRITE', 'ADMIN', 'AUDITOR')),
      CONSTRAINT ck_veyra_user_app_scope_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED'))
    );

    -- 3. Indexes for User Application Scope Lookups (AC8)
    CREATE INDEX IF NOT EXISTS ix_veyra_user_app_scope_user_id ON veyra_user_application_scope(user_id);
    CREATE INDEX IF NOT EXISTS ix_veyra_user_app_scope_app_id ON veyra_user_application_scope(application_id);
    CREATE INDEX IF NOT EXISTS ix_veyra_user_app_scope_type ON veyra_user_application_scope(scope_type, scope_value);
    CREATE INDEX IF NOT EXISTS ix_veyra_user_app_scope_composite ON veyra_user_application_scope(user_id, application_id, status);

    -- 4. Automatic updated_at trigger for veyra_user_application_scope
    CREATE OR REPLACE FUNCTION trg_veyra_user_app_scope_set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_set_updated_at_veyra_user_app_scope ON veyra_user_application_scope;
    CREATE TRIGGER trg_set_updated_at_veyra_user_app_scope
      BEFORE UPDATE ON veyra_user_application_scope
      FOR EACH ROW EXECUTE FUNCTION trg_veyra_user_app_scope_set_updated_at();

    -- 5. Seed standard enterprise application records (AC8)
    INSERT INTO veyra_application (app_code, app_name, description, category, status)
    VALUES
      ('ORACLE_FUSION', 'Oracle Fusion Cloud Applications', 'Core Oracle Fusion ERP, HCM & SCM integration suite', 'ERP_FUSION', 'ACTIVE'),
      ('ORACLE_ERP', 'Oracle Fusion Cloud Financials & ERP', 'Financial management, general ledger, and payables/receivables', 'FINANCIALS', 'ACTIVE'),
      ('ORACLE_HCM', 'Oracle Fusion Cloud Human Capital Management', 'Global HR, payroll, talent management, and workforce compliance', 'HUMAN_CAPITAL', 'ACTIVE'),
      ('ORACLE_SCM', 'Oracle Fusion Cloud Supply Chain Management', 'Procurement, inventory, order management, and supply chain logistics', 'SUPPLY_CHAIN', 'ACTIVE'),
      ('VEYRA_CORE', 'VEYRA Security & Audit Platform', 'Role monitoring, segregation of duties, and audit compliance platform', 'SECURITY_GOVERNANCE', 'ACTIVE')
    ON CONFLICT (app_code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_set_updated_at_veyra_user_app_scope ON veyra_user_application_scope;
    DROP FUNCTION IF EXISTS trg_veyra_user_app_scope_set_updated_at();

    DROP INDEX IF EXISTS ix_veyra_user_app_scope_composite;
    DROP INDEX IF EXISTS ix_veyra_user_app_scope_type;
    DROP INDEX IF EXISTS ix_veyra_user_app_scope_app_id;
    DROP INDEX IF EXISTS ix_veyra_user_app_scope_user_id;
    DROP TABLE IF EXISTS veyra_user_application_scope CASCADE;

    DROP INDEX IF EXISTS ix_veyra_application_status;
    DROP INDEX IF EXISTS ix_veyra_application_app_code;
    DROP TABLE IF EXISTS veyra_application CASCADE;
  `);
};
