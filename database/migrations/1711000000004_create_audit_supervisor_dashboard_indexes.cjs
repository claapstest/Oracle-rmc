/**
 * Migration: Create Audit Supervisor Dashboard Performance Indexes
 * Story: DB: Support Audit Supervisor Dashboard Data and Authorization
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Index on veyra_dashboard_metric for application_scope + metric_key queries
    CREATE INDEX IF NOT EXISTS ix_veyra_dashboard_metric_app_key_time
      ON veyra_dashboard_metric(application_scope, metric_key, captured_at DESC);

    -- 2. Index on veyra_dashboard_metric for application_scope + scope_type queries
    CREATE INDEX IF NOT EXISTS ix_veyra_dashboard_metric_app_scope_time
      ON veyra_dashboard_metric(application_scope, scope_type, is_mock, captured_at DESC);

    -- 3. Composite index on veyra_audit_event for user_id + event_time DESC
    CREATE INDEX IF NOT EXISTS ix_veyra_audit_event_user_time
      ON veyra_audit_event(user_id, event_time DESC)
      WHERE user_id IS NOT NULL;

    -- 4. Composite index on veyra_audit_event for event_type + event_time DESC
    CREATE INDEX IF NOT EXISTS ix_veyra_audit_event_type_time
      ON veyra_audit_event(event_type, event_time DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS ix_veyra_audit_event_type_time;
    DROP INDEX IF EXISTS ix_veyra_audit_event_user_time;
    DROP INDEX IF EXISTS ix_veyra_dashboard_metric_app_scope_time;
    DROP INDEX IF EXISTS ix_veyra_dashboard_metric_app_key_time;
  `);
};
