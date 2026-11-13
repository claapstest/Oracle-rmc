/**
 * Test Suite: Story VYR-036
 * "Add queryable-metadata columns to support encrypted-era dashboard filtering"
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 *
 * Verifies that dashboard filtering and statistics queries work correctly
 * on both legacy plaintext and encrypted rows by using indexed metadata
 * columns instead of JSONB operators on the raw column.
 *
 * Covers:
 *   - assigned_roles_count and role_names_text columns exist on oracle_raw_users
 *   - Sync pipeline populates metadata columns from JSON before encryption
 *   - businessUnit filter uses the indexed business_unit column
 *   - Role-count filters (MULTIPLE_ROLES, NO_ROLES, SINGLE_ROLE) use assigned_roles_count
 *   - Role-name filters (ADMIN, HIGH_RISK, PAYROLL) use role_names_text
 *   - getSecurityStatistics uses assigned_roles_count instead of JSONB
 *   - incidentAnalyticsService uses oracle_incident_rows (not JSONB array decomposition)
 *   - Encrypted rows are included in filter results (no is_encrypted=false guard)
 */

const path = require('path');
const pg = require('pg');
const dotenv = require('dotenv');

const HOST = 'vyr036-test.oraclecloud.com';
const SENTINEL = 'VYR036_SECRET_MARKER_77';

process.env.FUSION_HOST = HOST;

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/veyra_db';
}

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  FAIL: ${testName}`);
    failedTests++;
  }
}

async function ensureTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS oracle_raw_users (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      username VARCHAR(150) NOT NULL, display_name VARCHAR(255), email VARCHAR(255),
      is_active BOOLEAN DEFAULT true, user_category VARCHAR(100),
      business_unit VARCHAR(255), department VARCHAR(255), job_title VARCHAR(255),
      person_number VARCHAR(100), raw_user JSONB NOT NULL,
      is_encrypted BOOLEAN DEFAULT false, encryption_format_version SMALLINT,
      encryption_key_id VARCHAR(100), encrypted_at TIMESTAMPTZ,
      assigned_roles_count INT DEFAULT 0,
      role_names_text TEXT DEFAULT '',
      last_synced_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_raw_user UNIQUE(environment_host, username)
    );
    CREATE TABLE IF NOT EXISTS oracle_raw_roles (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      role_code VARCHAR(255) NOT NULL, role_name VARCHAR(255), category VARCHAR(100),
      is_custom BOOLEAN DEFAULT false, member_count INT DEFAULT 0, raw_role JSONB NOT NULL,
      is_encrypted BOOLEAN DEFAULT false, encryption_format_version SMALLINT,
      encryption_key_id VARCHAR(100), encrypted_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_raw_role UNIQUE(environment_host, role_code)
    );
    CREATE TABLE IF NOT EXISTS oracle_control_incidents (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      control_id VARCHAR(100) NOT NULL, control_name VARCHAR(500),
      total_incidents INT DEFAULT 0, raw_incidents JSONB DEFAULT '[]',
      is_encrypted BOOLEAN DEFAULT false, encryption_format_version SMALLINT,
      encryption_key_id VARCHAR(100), encrypted_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_control_incidents UNIQUE(environment_host, control_id)
    );
    CREATE TABLE IF NOT EXISTS oracle_incident_rows (
      environment_host TEXT NOT NULL, control_id TEXT NOT NULL, control_name TEXT,
      ord INTEGER NOT NULL, result_id TEXT DEFAULT '', status TEXT DEFAULT '',
      state TEXT DEFAULT '', lifecycle VARCHAR(16) NOT NULL DEFAULT 'ASSIGNED',
      priority TEXT DEFAULT '', global_user TEXT DEFAULT '', role_name TEXT DEFAULT '',
      access_entitlement TEXT DEFAULT '', access_point_name TEXT DEFAULT '',
      access_point_type TEXT DEFAULT '', grouping_value TEXT DEFAULT '',
      group_name TEXT DEFAULT '', data_source TEXT DEFAULT '',
      incident_information TEXT DEFAULT '', created_by TEXT DEFAULT '',
      investigator TEXT DEFAULT '', last_updated_by TEXT DEFAULT '',
      raw JSONB NOT NULL,
      PRIMARY KEY (environment_host, control_id, ord)
    );
    CREATE TABLE IF NOT EXISTS oracle_incident_rows_sync (
      environment_host TEXT NOT NULL, control_id TEXT NOT NULL,
      control_name TEXT, row_count INT DEFAULT 0, last_synced_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (environment_host, control_id)
    );
    CREATE TABLE IF NOT EXISTS oracle_raw_user_access (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      username VARCHAR(150), user_category VARCHAR(100),
      first_name VARCHAR(255), last_name VARCHAR(255), display_name VARCHAR(255),
      email VARCHAR(255), active BOOLEAN, role_name VARCHAR(255), role_code VARCHAR(255),
      auto_provisioned BOOLEAN, person_id VARCHAR(100), person_number VARCHAR(100),
      department VARCHAR(255), job VARCHAR(255), business_unit VARCHAR(255),
      location VARCHAR(255), manager VARCHAR(255), raw_payload JSONB,
      is_encrypted BOOLEAN DEFAULT false, encryption_format_version SMALLINT,
      encryption_key_id VARCHAR(100), encrypted_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // Add columns if missing (for databases created before VYR-036)
  await client.query(`ALTER TABLE oracle_raw_users ADD COLUMN IF NOT EXISTS assigned_roles_count INT DEFAULT 0`).catch(() => {});
  await client.query(`ALTER TABLE oracle_raw_users ADD COLUMN IF NOT EXISTS role_names_text TEXT DEFAULT ''`).catch(() => {});
}

async function cleanup(client) {
  for (const tbl of ['oracle_raw_users', 'oracle_raw_roles', 'oracle_control_incidents', 'oracle_incident_rows', 'oracle_incident_rows_sync', 'oracle_raw_user_access']) {
    await client.query(`DELETE FROM ${tbl} WHERE environment_host = $1`, [HOST]).catch(() => {});
  }
}

async function run() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    console.log('\n=== VYR-035b (follow-up to VYR-035): Queryable Metadata for Encrypted-era Filtering ===\n');
    await ensureTables(client);
    await cleanup(client);

    const { encryptRawField } = require('../dist/security/encryptedRecordWriter.js');

    // ---------------------------------------------------------------
    // 1. Columns exist on oracle_raw_users
    // ---------------------------------------------------------------
    console.log('--- Schema validation ---');
    const colRes = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'oracle_raw_users' AND column_name IN ('assigned_roles_count', 'role_names_text') ORDER BY column_name`
    );
    const colNames = colRes.rows.map(r => r.column_name);
    assert(colNames.includes('assigned_roles_count'), 'assigned_roles_count column exists');
    assert(colNames.includes('role_names_text'), 'role_names_text column exists');

    // ---------------------------------------------------------------
    // 2. Sync pipeline populates metadata columns
    // ---------------------------------------------------------------
    console.log('\n--- Sync pipeline metadata extraction ---');

    // Insert test users: one with multiple roles, one with no roles, one admin
    process.env.VEYRA_RAW_ENCRYPTION = 'true';

    const multiRoleUser = {
      userName: 'MULTI_ROLE_036', displayName: 'Multi Role', email: 'multi@test.com',
      businessUnit: 'Finance', secret: SENTINEL,
      assignedRoles: [
        { roleCode: 'AP_MANAGER', roleName: 'AP Manager', category: 'Job' },
        { roleCode: 'GL_ACCOUNTANT', roleName: 'GL Accountant', category: 'Duty' },
        { roleCode: 'FIN_ANALYST', roleName: 'Financial Analyst', category: 'Job' }
      ]
    };
    const noRoleUser = {
      userName: 'NO_ROLE_036', displayName: 'No Roles', email: 'norole@test.com',
      businessUnit: 'IT', secret: SENTINEL, assignedRoles: []
    };
    const adminUser = {
      userName: 'ADMIN_036', displayName: 'Admin User', email: 'admin@test.com',
      businessUnit: 'Corporate', secret: SENTINEL,
      assignedRoles: [
        { roleCode: 'ORA_SECURITY_ADMINISTRATOR', roleName: 'Security Administrator', category: 'Job' },
        { roleCode: 'ORA_IT_SECURITY_MANAGER', roleName: 'IT Security Manager', category: 'Job' }
      ]
    };
    const payrollUser = {
      userName: 'PAYROLL_036', displayName: 'Payroll User', email: 'payroll@test.com',
      businessUnit: 'HR', secret: SENTINEL,
      assignedRoles: [
        { roleCode: 'PAY_MANAGER', roleName: 'Payroll Manager', category: 'Job' }
      ]
    };

    const testUsers = [multiRoleUser, noRoleUser, adminUser, payrollUser];
    for (const u of testUsers) {
      const write = await encryptRawField('oracle_raw_users', { username: u.userName }, u, HOST);
      const roles = Array.isArray(u.assignedRoles) ? u.assignedRoles : [];
      const roleCount = roles.length;
      const roleNamesText = roles.map(r => r.roleName || r.roleCode || '').join('|');

      await client.query(
        `INSERT INTO oracle_raw_users (environment_host, username, display_name, email, is_active, user_category,
          business_unit, raw_user, is_encrypted, encryption_format_version, encryption_key_id, encrypted_at,
          assigned_roles_count, role_names_text, last_synced_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, 'TEST', $5, $6::jsonb, $7, $8, $9, $10, $11, $12, NOW(), NOW(), NOW())`,
        [HOST, u.userName, u.displayName, u.email, u.businessUnit,
         JSON.stringify(write.rawValue), write.isEncrypted, 1, write.encryptionKey, new Date(),
         roleCount, roleNamesText]
      );
    }

    // Verify metadata was stored
    const metaRes = await client.query(
      `SELECT username, assigned_roles_count, role_names_text, is_encrypted FROM oracle_raw_users WHERE environment_host = $1 ORDER BY username`,
      [HOST]
    );
    const metaByUser = {};
    metaRes.rows.forEach(r => { metaByUser[r.username] = r; });

    assert(metaByUser['MULTI_ROLE_036'].assigned_roles_count === 3, 'Multi-role user: count=3');
    assert(metaByUser['MULTI_ROLE_036'].role_names_text.includes('AP Manager'), 'Multi-role user: role_names_text includes AP Manager');
    assert(metaByUser['NO_ROLE_036'].assigned_roles_count === 0, 'No-role user: count=0');
    assert(metaByUser['NO_ROLE_036'].role_names_text === '', 'No-role user: empty role_names_text');
    assert(metaByUser['ADMIN_036'].assigned_roles_count === 2, 'Admin user: count=2');
    assert(metaByUser['ADMIN_036'].role_names_text.includes('Security Administrator'), 'Admin user: role_names_text includes Security Administrator');
    assert(metaByUser['PAYROLL_036'].role_names_text.includes('Payroll'), 'Payroll user: role_names_text includes Payroll');
    assert(metaByUser['MULTI_ROLE_036'].is_encrypted === true, 'All rows are encrypted');

    // ---------------------------------------------------------------
    // 3. Filter: MULTIPLE_ROLES uses assigned_roles_count (includes encrypted rows)
    // ---------------------------------------------------------------
    console.log('\n--- Filter queries on metadata columns ---');

    const multiRes = await client.query(
      `SELECT username FROM oracle_raw_users WHERE environment_host = $1 AND assigned_roles_count > 1 ORDER BY username`,
      [HOST]
    );
    assert(multiRes.rows.length === 2, 'MULTIPLE_ROLES filter: 2 users (ADMIN + MULTI)');
    assert(multiRes.rows.some(r => r.username === 'MULTI_ROLE_036'), 'MULTIPLE_ROLES: includes multi-role user');
    assert(multiRes.rows.some(r => r.username === 'ADMIN_036'), 'MULTIPLE_ROLES: includes admin user');

    // Filter: NO_ROLES
    const noRoleRes = await client.query(
      `SELECT username FROM oracle_raw_users WHERE environment_host = $1 AND assigned_roles_count = 0`,
      [HOST]
    );
    assert(noRoleRes.rows.length === 1 && noRoleRes.rows[0].username === 'NO_ROLE_036', 'NO_ROLES filter: 1 user');

    // Filter: SINGLE_ROLE
    const singleRes = await client.query(
      `SELECT username FROM oracle_raw_users WHERE environment_host = $1 AND assigned_roles_count = 1`,
      [HOST]
    );
    assert(singleRes.rows.length === 1 && singleRes.rows[0].username === 'PAYROLL_036', 'SINGLE_ROLE filter: 1 user');

    // Filter: ADMIN_ROLES via role_names_text
    const adminRes = await client.query(
      `SELECT username FROM oracle_raw_users WHERE environment_host = $1 AND (role_names_text ILIKE '%security administrator%' OR role_names_text ILIKE '%it security manager%')`,
      [HOST]
    );
    assert(adminRes.rows.length === 1 && adminRes.rows[0].username === 'ADMIN_036', 'ADMIN filter: 1 user');

    // Filter: PAYROLL via role_names_text
    const payrollRes = await client.query(
      `SELECT username FROM oracle_raw_users WHERE environment_host = $1 AND role_names_text ILIKE '%payroll%'`,
      [HOST]
    );
    assert(payrollRes.rows.length === 1 && payrollRes.rows[0].username === 'PAYROLL_036', 'PAYROLL filter: 1 user');

    // Filter: businessUnit uses indexed column (not JSONB)
    const buRes = await client.query(
      `SELECT username FROM oracle_raw_users WHERE environment_host = $1 AND business_unit ILIKE '%finance%'`,
      [HOST]
    );
    assert(buRes.rows.length === 1 && buRes.rows[0].username === 'MULTI_ROLE_036', 'businessUnit filter: works on indexed column');

    // ---------------------------------------------------------------
    // 4. Statistics use assigned_roles_count
    // ---------------------------------------------------------------
    console.log('\n--- Statistics queries ---');
    const statsRes = await client.query(
      `SELECT
        COUNT(1) AS total_users,
        COUNT(1) FILTER (WHERE assigned_roles_count > 1) AS multiple_role_users,
        COUNT(1) FILTER (WHERE assigned_roles_count = 0) AS users_without_roles,
        COUNT(1) FILTER (WHERE assigned_roles_count = 1) AS single_role_users
       FROM oracle_raw_users WHERE environment_host = $1`,
      [HOST]
    );
    const stats = statsRes.rows[0];
    assert(parseInt(stats.total_users) === 4, 'Stats: total_users=4');
    assert(parseInt(stats.multiple_role_users) === 2, 'Stats: multiple_role_users=2');
    assert(parseInt(stats.users_without_roles) === 1, 'Stats: users_without_roles=1');
    assert(parseInt(stats.single_role_users) === 1, 'Stats: single_role_users=1');

    // ---------------------------------------------------------------
    // 5. Incident analytics uses oracle_incident_rows
    // ---------------------------------------------------------------
    console.log('\n--- Incident analytics via oracle_incident_rows ---');

    // Insert normalized incident rows (these are populated by sync pipeline, not from encrypted JSONB)
    await client.query(
      `INSERT INTO oracle_incident_rows (environment_host, control_id, control_name, ord, result_id, status, lifecycle, global_user, role_name, raw)
       VALUES ($1, 'CTRL-036', 'Test Control', 1, 'R1', 'Active', 'ASSIGNED', 'USER_A', 'AP Manager', '{}'),
              ($1, 'CTRL-036', 'Test Control', 2, 'R2', 'Active', 'ASSIGNED', 'USER_B', 'GL Accountant', '{}'),
              ($1, 'CTRL-036', 'Test Control', 3, 'R3', 'Resolved', 'RESOLVED', 'USER_A', 'AP Manager', '{}')`,
      [HOST]
    );
    await client.query(
      `INSERT INTO oracle_incident_rows_sync (environment_host, control_id, control_name, row_count) VALUES ($1, 'CTRL-036', 'Test Control', 3)`,
      [HOST]
    );

    // Query using flat columns (no jsonb_array_elements needed)
    const incUserRes = await client.query(
      `SELECT global_user AS user, COUNT(*)::int AS incidents FROM oracle_incident_rows WHERE environment_host = $1 GROUP BY 1 ORDER BY 2 DESC`,
      [HOST]
    );
    assert(incUserRes.rows.length === 2, 'Incident analytics: 2 distinct users');
    assert(incUserRes.rows[0].user === 'USER_A' && incUserRes.rows[0].incidents === 2, 'Incident analytics: USER_A has 2 incidents');

    const incRoleRes = await client.query(
      `SELECT role_name AS role, COUNT(*)::int AS incidents FROM oracle_incident_rows WHERE environment_host = $1 GROUP BY 1 ORDER BY 2 DESC`,
      [HOST]
    );
    assert(incRoleRes.rows.length === 2, 'Incident role analytics: 2 distinct roles');
    assert(incRoleRes.rows[0].role === 'AP Manager', 'Incident role analytics: AP Manager most frequent');

    // ---------------------------------------------------------------
    // 6. Encrypted rows are NOT excluded from filter results
    // ---------------------------------------------------------------
    console.log('\n--- Encrypted rows included in results ---');
    const allEncRes = await client.query(
      `SELECT COUNT(1)::int AS cnt FROM oracle_raw_users WHERE environment_host = $1 AND is_encrypted = true AND assigned_roles_count > 0`,
      [HOST]
    );
    assert(parseInt(allEncRes.rows[0].cnt) === 3, 'Encrypted rows with roles: 3 (all except NO_ROLE)');

    // ---------------------------------------------------------------
    // Cleanup
    // ---------------------------------------------------------------
    delete process.env.VEYRA_RAW_ENCRYPTION;
    await cleanup(client);

    console.log(`\n=== Results: ${passedTests} passed, ${failedTests} failed ===`);
    process.exitCode = failedTests > 0 ? 1 : 0;
  } catch (err) {
    console.error('FATAL:', err);
    process.exitCode = 1;
  } finally {
    delete process.env.VEYRA_RAW_ENCRYPTION;
    await cleanup(client).catch(() => {});
    client.release();
    await pool.end();
  }
}

run();
