import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from database directory or root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || '127.0.0.1'}:${process.env.POSTGRES_PORT || '5433'}/${process.env.POSTGRES_DB || 'veyra_db'}`;

export async function provisionAdminPassword(customPassword?: string): Promise<void> {
  const targetEmail = 'admin@admin.com';
  // Check CLI argument, then environment variable, fallback to default local dev password
  const password = customPassword || process.env.INITIAL_ADMIN_PASSWORD || process.argv[2] || 'Admin@123';

  console.log(`===========================================================`);
  console.log(`🔐 VEYRA Local Admin Password Provisioning`);
  console.log(`   Target User : ${targetEmail}`);
  console.log(`   Target DB   : ${connectionString.replace(/:[^:@]+@/, ':****@')}`);
  console.log(`===========================================================`);

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');

    // 1. Generate salt and bcrypt hash
    const saltRounds = 10;
    const passwordHash = bcrypt.hashSync(password, saltRounds);

    // 2. Check if admin user exists in veyra_user
    const userCheck = await client.query(
      `SELECT id, email, status FROM veyra_user WHERE email = $1`,
      [targetEmail]
    );

    let userId: string;

    if (userCheck.rows.length === 0) {
      console.log(`ℹ️  admin@admin.com not found. Creating user row in veyra_user...`);
      const insertRes = await client.query(
        `INSERT INTO veyra_user (email, display_name, status, is_local_user, password_hash, created_by)
         VALUES ($1, 'Site Administrator', 'ACTIVE', TRUE, $2, 'PROVISION_SCRIPT')
         RETURNING id`,
        [targetEmail, passwordHash]
      );
      userId = insertRes.rows[0].id;
    } else {
      userId = userCheck.rows[0].id;
      const updateRes = await client.query(
        `UPDATE veyra_user
         SET password_hash = $1, status = 'ACTIVE', updated_at = NOW(), updated_by = 'PROVISION_SCRIPT'
         WHERE id = $2
         RETURNING id, email, status`,
        [passwordHash, userId]
      );
      console.log(`✅ Updated password_hash in veyra_user for ${updateRes.rows[0].email} (Status: ${updateRes.rows[0].status})`);
    }

    // 3. Ensure role is mapped to SITE_ADMIN
    const roleRes = await client.query(
      `SELECT id FROM veyra_role WHERE role_code = 'SITE_ADMIN'`
    );

    if (roleRes.rows.length > 0) {
      const roleId = roleRes.rows[0].id;
      await client.query(
        `INSERT INTO veyra_user_role (user_id, role_id, created_by)
         VALUES ($1, $2, 'PROVISION_SCRIPT')
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [userId, roleId]
      );
      console.log(`✅ Ensured ${targetEmail} is linked to SITE_ADMIN role.`);
    } else {
      console.warn(`⚠️  Warning: SITE_ADMIN role not found in veyra_role. Run seed first!`);
    }

    await client.query('COMMIT');
    console.log(`🎉 Password hash provisioned successfully for ${targetEmail}.`);
    console.log(`   (Plaintext password was not logged or stored in database/git.)`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`❌ Provisioning failed:`, err);
    throw err;
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  provisionAdminPassword()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
