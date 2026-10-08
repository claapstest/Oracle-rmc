const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../../database/.env') });

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5433/veyra_db';

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  console.log('[Sync Script] Connected to PostgreSQL at', connectionString);

  const host = 'eiiv-dev14.fa.us6.oraclecloud.com';

  // 1. Sync Roles from oracle_roles_cache.json
  const rolesCachePath = path.resolve(__dirname, '../oracle_roles_cache.json');
  if (fs.existsSync(rolesCachePath)) {
    console.log('[Sync Script] Reading roles from:', rolesCachePath);
    const rawData = fs.readFileSync(rolesCachePath, 'utf-8');
    const parsed = JSON.parse(rawData);
    const roles = Array.isArray(parsed?.roles) ? parsed.roles : [];

    console.log(`[Sync Script] Found ${roles.length} roles to populate into oracle_raw_roles.`);

    const chunkSize = 200;
    let savedRoles = 0;

    for (let i = 0; i < roles.length; i += chunkSize) {
      const chunk = roles.slice(i, i + chunkSize);
      const values = [];
      const valueClauses = [];

      chunk.forEach((role) => {
        const roleCode = String(role.roleCode || role.code || role.id || '').trim();
        if (!roleCode) return;

        const roleName = role.displayName || role.roleName || role.name || roleCode;
        const category = role.category || null;
        const isCustom = Boolean(role.isCustom || roleCode.startsWith('CUSTOM_') || roleCode.startsWith('CLAAPS_'));
        const memberCount = typeof role.memberCount === 'number' ? role.memberCount : (Array.isArray(role.members) ? role.members.length : 0);

        const baseIndex = values.length + 1;
        valueClauses.push(
          `($${baseIndex}, $${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, NOW(), NOW())`
        );
        values.push(host, roleCode, roleName, category, isCustom, memberCount, JSON.stringify(role));
      });

      if (valueClauses.length > 0) {
        const sql = `
          INSERT INTO oracle_raw_roles (
            environment_host,
            role_code,
            role_name,
            category,
            is_custom,
            member_count,
            raw_role,
            last_synced_at,
            updated_at
          ) VALUES ${valueClauses.join(', ')}
          ON CONFLICT (environment_host, role_code) DO UPDATE SET
            role_name = EXCLUDED.role_name,
            category = EXCLUDED.category,
            is_custom = EXCLUDED.is_custom,
            member_count = EXCLUDED.member_count,
            raw_role = EXCLUDED.raw_role,
            last_synced_at = NOW(),
            updated_at = NOW();
        `;
        await client.query(sql, values);
        savedRoles += chunk.length;
      }
    }
    console.log(`[Sync Script] Successfully inserted/updated ${savedRoles} roles into oracle_raw_roles!`);
  } else {
    console.warn('[Sync Script] Roles cache not found at:', rolesCachePath);
  }

  // 2. Query total counts
  const rolesCount = await client.query('SELECT count(*) FROM oracle_raw_roles WHERE environment_host = $1', [host]);
  const usersCount = await client.query('SELECT count(*) FROM oracle_raw_users WHERE environment_host = $1', [host]);

  console.log(`\n======================================================`);
  console.log(`[Sync Script] Summary for host "${host}":`);
  console.log(`  - Total in oracle_raw_roles: ${rolesCount.rows[0].count}`);
  console.log(`  - Total in oracle_raw_users: ${usersCount.rows[0].count}`);
  console.log(`======================================================\n`);

  await client.end();
}

main().catch((err) => {
  console.error('[Sync Script] Error:', err);
  process.exit(1);
});
