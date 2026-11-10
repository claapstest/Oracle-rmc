/**
 * Migration: Create VEYRA External Identity Mapping Table
 * Story: VYR-012 (Implement Entra identity mapping and Veyra user provisioning)
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- Create veyra_user_identity_mapping table
    CREATE TABLE IF NOT EXISTS veyra_user_identity_mapping (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      provider VARCHAR(32) NOT NULL DEFAULT 'ENTRA',
      tenant_id VARCHAR(128) NOT NULL,
      external_user_id VARCHAR(128) NOT NULL,
      external_email VARCHAR(255) NOT NULL,
      external_display_name VARCHAR(150),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_authenticated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT fk_veyra_identity_mapping_user_id FOREIGN KEY (user_id) REFERENCES veyra_user(id) ON DELETE CASCADE,
      CONSTRAINT uq_veyra_identity_mapping_provider_tenant_extid UNIQUE (provider, tenant_id, external_user_id),
      CONSTRAINT ck_veyra_identity_provider CHECK (provider IN ('ENTRA', 'LOCAL', 'SAML')),
      CONSTRAINT ck_veyra_identity_email_normalized CHECK (external_email = LOWER(TRIM(external_email)))
    );

    -- Optimized query indexes
    CREATE INDEX IF NOT EXISTS ix_veyra_identity_lookup 
      ON veyra_user_identity_mapping(provider, tenant_id, external_user_id);
    
    CREATE INDEX IF NOT EXISTS ix_veyra_identity_user_id 
      ON veyra_user_identity_mapping(user_id);
    
    CREATE INDEX IF NOT EXISTS ix_veyra_identity_email 
      ON veyra_user_identity_mapping(external_email);

    CREATE INDEX IF NOT EXISTS ix_veyra_identity_tenant 
      ON veyra_user_identity_mapping(tenant_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS ix_veyra_identity_tenant;
    DROP INDEX IF EXISTS ix_veyra_identity_email;
    DROP INDEX IF EXISTS ix_veyra_identity_user_id;
    DROP INDEX IF EXISTS ix_veyra_identity_lookup;
    DROP TABLE IF EXISTS veyra_user_identity_mapping CASCADE;
  `);
};

