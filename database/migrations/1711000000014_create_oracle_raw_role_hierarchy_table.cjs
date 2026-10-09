/**
 * Migration: Create Oracle Raw Role Hierarchy Table
 * Feature: Store raw role hierarchy parent-child relationships from Oracle Fusion BI Publisher
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS oracle_raw_role_hierarchy (
      id SERIAL PRIMARY KEY,
      environment_host VARCHAR(255) NOT NULL,
      parent_role_name VARCHAR(500) NOT NULL,
      parent_role_type VARCHAR(100),
      child_role_name VARCHAR(500) NOT NULL,
      child_role_type VARCHAR(100),
      role_code VARCHAR(255),
      category VARCHAR(100),
      relationship_type VARCHAR(200),
      raw_record JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_oracle_raw_role_hierarchy 
      ON oracle_raw_role_hierarchy (environment_host, parent_role_name, child_role_name);

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_role_hierarchy_parent 
      ON oracle_raw_role_hierarchy (parent_role_name);

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_role_hierarchy_child 
      ON oracle_raw_role_hierarchy (child_role_name);

    CREATE INDEX IF NOT EXISTS ix_oracle_raw_role_hierarchy_category 
      ON oracle_raw_role_hierarchy (category);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS oracle_raw_role_hierarchy CASCADE;
  `);
};
