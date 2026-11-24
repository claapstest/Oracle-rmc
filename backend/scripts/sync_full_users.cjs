const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../../database/.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/veyra_db';
const isRemote = Boolean(connectionString && !connectionString.includes('127.0.0.1') && !connectionString.includes('localhost'));

const pool = new Pool({
  connectionString,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined
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
  const usersList = Array.from(usersMap.values());
  console.log('Unique users to sync:', usersList.length);

  const client = await pool.connect();
  try {
    const CHUNK_SIZE = 200;
    let inserted = 0;
    const host = 'eiiv-dev14.fa.us6.oraclecloud.com';

    for (let i = 0; i < usersList.length; i += CHUNK_SIZE) {
      const chunk = usersList.slice(i, i + CHUNK_SIZE);
      const values = [];
      const valueClauses = [];

      chunk.forEach((u) => {
        const rawUser = {
          userName: u.username,
          displayName: u.displayName,
          email: u.email,
          active: u.active,
          userCategory: u.userCategory,
          department: u.department,
          assignedRoles: u.assignedRoles
        };
        const idx = values.length + 1;
        valueClauses.push(
          `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, NOW())`
        );
        values.push(host, u.username, u.displayName, u.email, u.active, u.userCategory, JSON.stringify(rawUser));
      });

      if (valueClauses.length > 0) {
        const sql = `
          INSERT INTO oracle_raw_users (environment_host, username, display_name, email, is_active, user_category, raw_user, updated_at)
          VALUES ${valueClauses.join(', ')}
          ON CONFLICT (environment_host, username)
          DO UPDATE SET
            display_name = EXCLUDED.display_name,
            email = EXCLUDED.email,
            is_active = EXCLUDED.is_active,
            user_category = EXCLUDED.user_category,
            raw_user = EXCLUDED.raw_user,
            updated_at = NOW();
        `;
        await client.query(sql, values);
        inserted += chunk.length;
      }
    }
    console.log('Successfully batched synced users into oracle_raw_users:', inserted);
  } catch (err) {
    console.error('Sync failed:', err);
  } finally {
    client.release();
    pool.end();
  }
}

syncFullUsers();
