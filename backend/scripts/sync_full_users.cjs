const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/veyra_db'
});

async function syncFullUsers() {
  const cachePath = path.resolve(__dirname, '../oracle_user_access_report_cache.json');
  if (!fs.existsSync(cachePath)) {
    console.error('Cache not found at', cachePath);
    process.exit(1);
  }
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const usersMap = new Map();
  for (const r of cache.data || []) {
    const u = (r.username || '').toLowerCase();
    if (!u) continue;
    if (!usersMap.has(u)) {
      usersMap.set(u, {
        username: r.username,
        displayName: r.displayName || r.username,
        email: r.email || (r.username.includes('@') ? r.username : r.username + '@oracle.corp'),
        active: r.active !== false,
        userCategory: r.userCategory || 'DEFAULT',
        department: r.department || 'Corporate',
        assignedRoles: []
      });
    }
    if (r.roleName || r.roleCode) {
      usersMap.get(u).assignedRoles.push({ roleName: r.roleName, roleCode: r.roleCode });
    }
  }
  console.log('Unique users to sync:', usersMap.size);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let inserted = 0;
    for (const [_, u] of usersMap) {
      const rawUser = {
        userName: u.username,
        displayName: u.displayName,
        email: u.email,
        active: u.active,
        userCategory: u.userCategory,
        department: u.department,
        assignedRoles: u.assignedRoles
      };
      await client.query(`
        INSERT INTO oracle_raw_users (environment_host, username, display_name, email, is_active, user_category, raw_user, updated_at)
        VALUES ('eiiv-dev14.fa.us6.oraclecloud.com', $1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (environment_host, username)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          email = EXCLUDED.email,
          is_active = EXCLUDED.is_active,
          user_category = EXCLUDED.user_category,
          raw_user = EXCLUDED.raw_user,
          updated_at = NOW();
      `, [u.username, u.displayName, u.email, u.active, u.userCategory, JSON.stringify(rawUser)]);
      inserted++;
    }
    await client.query('COMMIT');
    console.log('Successfully synced users into oracle_raw_users:', inserted);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Sync failed:', err);
  } finally {
    client.release();
    pool.end();
  }
}

syncFullUsers();
