/**
 * Migration: Create VEYRA Dashboard Metric Persistence Table and Indexes
 * Story: VY-STRY-013
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- Create veyra_dashboard_metric table
    CREATE TABLE IF NOT EXISTS veyra_dashboard_metric (
      metric_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      metric_key VARCHAR(100) NOT NULL,
      metric_value NUMERIC(14, 4),
      metric_type VARCHAR(30) NOT NULL DEFAULT 'GAUGE',
      scope_type VARCHAR(30) NOT NULL DEFAULT 'GLOBAL',
      scope_id VARCHAR(100),
      user_id UUID,
      application_scope VARCHAR(100) NOT NULL DEFAULT 'ORACLE_FUSION',
      metric_payload JSONB,
      source VARCHAR(50) NOT NULL DEFAULT 'VEYRA_CALCULATED',
      is_mock BOOLEAN NOT NULL DEFAULT false,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT fk_veyra_dashboard_metric_user_id FOREIGN KEY (user_id) REFERENCES veyra_user(id) ON DELETE SET NULL,
      CONSTRAINT ck_veyra_dashboard_metric_scope_type CHECK (scope_type IN ('GLOBAL', 'USER', 'APPLICATION', 'TENANT')),
      CONSTRAINT ck_veyra_dashboard_metric_type CHECK (metric_type IN ('COUNTER', 'GAUGE', 'AGGREGATE', 'SUMMARY_SNAPSHOT')),
      CONSTRAINT ck_veyra_dashboard_metric_source CHECK (source IN ('VEYRA_POSTGRES', 'ORACLE_FUSION', 'VEYRA_CALCULATED', 'MANUAL', 'DEMO_SEED'))
    );

    -- Indexes optimized for dashboard queries and time-series aggregation
    -- 1. Fast retrieval of latest metric by key, scope, and mock flag
    CREATE INDEX IF NOT EXISTS ix_veyra_dashboard_metric_key_scope_time 
      ON veyra_dashboard_metric(metric_key, scope_type, is_mock, captured_at DESC);

    -- 2. Fast retrieval of user-scoped metrics
    CREATE INDEX IF NOT EXISTS ix_veyra_dashboard_metric_user_time 
      ON veyra_dashboard_metric(user_id, captured_at DESC)
      WHERE user_id IS NOT NULL;

    -- 3. Fast retrieval of application-scoped metrics
    CREATE INDEX IF NOT EXISTS ix_veyra_dashboard_metric_app_time 
      ON veyra_dashboard_metric(application_scope, captured_at DESC);

    -- 4. Scope-level overview retrieval
    CREATE INDEX IF NOT EXISTS ix_veyra_dashboard_metric_scope_captured 
      ON veyra_dashboard_metric(scope_type, captured_at DESC);

    -- 5. Time-series historical trend analysis
    CREATE INDEX IF NOT EXISTS ix_veyra_dashboard_metric_captured_at 
      ON veyra_dashboard_metric(captured_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS ix_veyra_dashboard_metric_captured_at;
    DROP INDEX IF EXISTS ix_veyra_dashboard_metric_scope_captured;
    DROP INDEX IF EXISTS ix_veyra_dashboard_metric_app_time;
    DROP INDEX IF EXISTS ix_veyra_dashboard_metric_user_time;
    DROP INDEX IF EXISTS ix_veyra_dashboard_metric_key_scope_time;
    DROP TABLE IF EXISTS veyra_dashboard_metric CASCADE;
  `);
};
