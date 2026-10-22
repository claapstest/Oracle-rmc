const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');

// Ensure .env is loaded from backend, database, or workspace root
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../database/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || '127.0.0.1'}:${process.env.POSTGRES_PORT || '5433'}/${process.env.POSTGRES_DB || 'veyra_db'}`;

const isRemote = Boolean(
  process.env.DATABASE_URL &&
  !process.env.DATABASE_URL.includes('127.0.0.1') &&
  !process.env.DATABASE_URL.includes('localhost')
);

const pool = new Pool({
  connectionString,
  ssl: isRemote || process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

async function provisionUsers() {
  console.log('Connecting to PostgreSQL to provision Audit Manager & Audit Supervisor users...');

  try {
    const rolesRes = await pool.query('SELECT id, role_code FROM veyra_role');
    const roleMap = {};
    for (const r of rolesRes.rows) {
      roleMap[r.role_code] = r.id;
    }

    if (!roleMap['AUDIT_MANAGER'] || !roleMap['AUDIT_SUPERVISOR']) {
      throw new Error('Required roles not found in veyra_role table');
    }

    const usersToProvision = [
      {
        email: 'audit.manager@claaps.com',
        displayName: 'Audit Manager',
        password: 'Manager@123',
        roleCode: 'AUDIT_MANAGER'
      },
      {
        email: 'audit.supervisor@claaps.com',
        displayName: 'Audit Supervisor',
        password: 'Supervisor@123',
        roleCode: 'AUDIT_SUPERVISOR'
      },
      // Also ensure supervisor.user@claaps.com has Supervisor@123 for convenience
      {
        email: 'supervisor.user@claaps.com',
        displayName: 'Audit Supervisor User',
        password: 'Supervisor@123',
        roleCode: 'AUDIT_SUPERVISOR'
      },
      // Also ensure manager.user@claaps.com
      {
        email: 'manager.user@claaps.com',
        displayName: 'Audit Manager User',
        password: 'Manager@123',
        roleCode: 'AUDIT_MANAGER'
      }
    ];

    for (const user of usersToProvision) {
      const passwordHash = await bcrypt.hash(user.password, 10);
      const roleId = roleMap[user.roleCode];

      // Upsert user into veyra_user
      const userRes = await pool.query(
        `INSERT INTO veyra_user (email, display_name, password_hash, status, is_local_user)
         VALUES ($1, $2, $3, 'ACTIVE', true)
         ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             display_name = EXCLUDED.display_name,
             status = 'ACTIVE'
         RETURNING id, email, display_name`,
        [user.email, user.displayName, passwordHash]
      );

      const userId = userRes.rows[0].id;

      // Assign role in veyra_user_role
      await pool.query(
        `INSERT INTO veyra_user_role (user_id, role_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [userId, roleId]
      );

      console.log(`✅ Provisioned: ${user.email} (${user.roleCode}) with password "${user.password}"`);
    }

    // Clear any active sessions so user can immediately log in cleanly
    await pool.query("UPDATE veyra_session SET status = 'EXPIRED' WHERE status = 'ACTIVE'");
    console.log('✅ Cleared active sessions in veyra_session table.');

  } catch (err) {
    console.error('❌ Error provisioning users:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

provisionUsers();
