/**
 * Migration: Create VEYRA Report Record Persistence Table and Indexes
 * Story: VY-STRY-19: DB: Implement Database Support for Reports-Only User Access
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- Create veyra_report table for compliance and audit report persistence
    CREATE TABLE IF NOT EXISTS veyra_report (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      report_id VARCHAR(100) NOT NULL UNIQUE,
      report_name VARCHAR(255) NOT NULL,
      report_type VARCHAR(100) NOT NULL,
      category VARCHAR(100) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
      format VARCHAR(20) NOT NULL DEFAULT 'PDF',
      size_bytes BIGINT DEFAULT 0,
      download_url VARCHAR(500),
      generated_by VARCHAR(255) NOT NULL DEFAULT 'system_scheduler',
      user_id UUID,
      scope_type VARCHAR(30) NOT NULL DEFAULT 'GLOBAL',
      scope_id VARCHAR(100),
      application_scope VARCHAR(100) NOT NULL DEFAULT 'ORACLE_FUSION',
      is_mock BOOLEAN NOT NULL DEFAULT false,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT fk_veyra_report_user_id FOREIGN KEY (user_id) REFERENCES veyra_user(id) ON DELETE SET NULL,
      CONSTRAINT ck_veyra_report_scope_type CHECK (scope_type IN ('GLOBAL', 'USER', 'APPLICATION', 'TENANT')),
      CONSTRAINT ck_veyra_report_status CHECK (status IN ('COMPLETED', 'PENDING', 'FAILED', 'READY')),
      CONSTRAINT ck_veyra_report_format CHECK (format IN ('PDF', 'EXCEL', 'CSV', 'JSON'))
    );

    -- 1. Index for application and scope filtering ordered by generation time
    CREATE INDEX IF NOT EXISTS ix_veyra_report_app_scope_time
      ON veyra_report(application_scope, scope_type, is_mock, generated_at DESC);

    -- 2. Partial index for user-owned reports
    CREATE INDEX IF NOT EXISTS ix_veyra_report_user_time
      ON veyra_report(user_id, generated_at DESC)
      WHERE user_id IS NOT NULL;

    -- 3. Composite index for category and report type lookups
    CREATE INDEX IF NOT EXISTS ix_veyra_report_category_type
      ON veyra_report(category, report_type, generated_at DESC);

    -- 4. Status filter index
    CREATE INDEX IF NOT EXISTS ix_veyra_report_status_time
      ON veyra_report(status, generated_at DESC);

    -- Seed standard initial compliance report records for live query support
    INSERT INTO veyra_report (
      report_id, report_name, report_type, category, status, format, size_bytes,
      download_url, generated_by, scope_type, application_scope, is_mock, generated_at
    ) VALUES
      ('rep_role_hier_001', 'Role Hierarchy Deep-Dive Report', 'ROLE_HIERARCHY', 'Role Hierarchy & Inheritance', 'COMPLETED', 'PDF', 2457600, '/api/reports/role-hierarchy', 'system_scheduler', 'GLOBAL', 'ORACLE_FUSION', false, NOW() - INTERVAL '1 day'),
      ('rep_user_acc_002', 'User Access & Entitlements Audit', 'USER_ACCESS', 'User Access & Entitlements', 'COMPLETED', 'EXCEL', 1843200, '/api/reports/user-access', 'system_scheduler', 'GLOBAL', 'ORACLE_FUSION', false, NOW() - INTERVAL '2 days'),
      ('rep_sod_conf_003', 'Segregation of Duties (SoD) Conflict Summary', 'SOD_CONFLICTS', 'Segregation of Duties (SoD)', 'READY', 'PDF', 983040, '/api/reports/role-hierarchy', 'system_scheduler', 'GLOBAL', 'ORACLE_FUSION', false, NOW() - INTERVAL '3 days'),
      ('rep_priv_grant_004', 'Security Privilege Assignment Matrix', 'PRIVILEGE_GRANTS', 'Security & Compliance Governance', 'COMPLETED', 'CSV', 524288, '/api/reports/role-hierarchy', 'system_scheduler', 'GLOBAL', 'ORACLE_FUSION', false, NOW() - INTERVAL '4 days'),
      ('rep_cert_stat_005', 'Q3 Access Certification Review Status', 'COMPLIANCE_CERTIFICATION', 'Security & Compliance Governance', 'COMPLETED', 'PDF', 1258291, '/api/reports/user-access', 'system_scheduler', 'GLOBAL', 'ORACLE_FUSION', false, NOW() - INTERVAL '5 days')
    ON CONFLICT (report_id) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS ix_veyra_report_status_time;
    DROP INDEX IF EXISTS ix_veyra_report_category_type;
    DROP INDEX IF EXISTS ix_veyra_report_user_time;
    DROP INDEX IF EXISTS ix_veyra_report_app_scope_time;
    DROP TABLE IF EXISTS veyra_report CASCADE;
  `);
};
