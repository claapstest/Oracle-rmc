exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE oracle_control_incidents 
    ADD COLUMN IF NOT EXISTS assigned_incidents INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS accepted_incidents INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS remediate_incidents INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS resolved_incidents INT DEFAULT 0;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE oracle_control_incidents 
    DROP COLUMN IF EXISTS assigned_incidents,
    DROP COLUMN IF EXISTS accepted_incidents,
    DROP COLUMN IF EXISTS remediate_incidents,
    DROP COLUMN IF EXISTS resolved_incidents;
  `);
};
