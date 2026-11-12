/**
 * Migration: Normalized Indexed Incident Rows Table (oracle_incident_rows)
 * Purpose: Eliminate 2-11s TOAST JSONB full-array decompression overhead on every
 *          Reports & Control Detail page/filter query while keeping oracle_control_incidents intact.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS oracle_incident_rows (
      environment_host TEXT NOT NULL,
      control_id TEXT NOT NULL,
      control_name TEXT,
      ord INTEGER NOT NULL,
      result_id TEXT DEFAULT '',
      status TEXT DEFAULT '',
      state TEXT DEFAULT '',
      lifecycle VARCHAR(16) NOT NULL DEFAULT 'ASSIGNED',
      priority TEXT DEFAULT '',
      global_user TEXT DEFAULT '',
      role_name TEXT DEFAULT '',
      access_entitlement TEXT DEFAULT '',
      access_point_name TEXT DEFAULT '',
      access_point_type TEXT DEFAULT '',
      grouping_value TEXT DEFAULT '',
      group_name TEXT DEFAULT '',
      data_source TEXT DEFAULT '',
      incident_information TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      investigator TEXT DEFAULT '',
      last_updated_by TEXT DEFAULT '',
      raw JSONB NOT NULL,
      PRIMARY KEY (environment_host, control_id, ord)
    );

    CREATE INDEX IF NOT EXISTS ix_oracle_inc_rows_ctrl_life_ord
      ON oracle_incident_rows (environment_host, control_id, lifecycle, ord);

    CREATE INDEX IF NOT EXISTS ix_oracle_inc_rows_life_ctrl_ord
      ON oracle_incident_rows (environment_host, lifecycle, control_id, ord);

    CREATE INDEX IF NOT EXISTS ix_oracle_inc_rows_ctrl_resid
      ON oracle_incident_rows (environment_host, control_id, result_id);

    CREATE TABLE IF NOT EXISTS oracle_incident_rows_sync (
      environment_host TEXT NOT NULL,
      control_id TEXT NOT NULL,
      control_name TEXT,
      row_count INTEGER NOT NULL DEFAULT 0,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (environment_host, control_id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS oracle_incident_rows_sync CASCADE;
    DROP TABLE IF EXISTS oracle_incident_rows CASCADE;
  `);
};

