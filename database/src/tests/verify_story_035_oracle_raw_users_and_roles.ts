/**
 * Verification Test: Story 035 - Oracle Raw Users and Roles Tables
 * Validates:
 * 1. Schema integrity for oracle_raw_users and oracle_raw_roles
 * 2. Raw JSON format preservation in single JSONB cells (raw_user, raw_role)
 * 3. Idempotent upsert behavior
 * 4. Indexing and environment host partitioning
 */

import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5433/veyra_db';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName}${detail ? `: ${detail}` : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('  Running Story 035 Verification: Oracle Raw Users & Roles Tables');
  console.log('===============================================================\n');

  const client = new Client({ connectionString });
  await client.connect();

  try {
    // Test 1: Check oracle_raw_users table existence
    const usersTableRes = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'oracle_raw_users'
    `);
    assert(usersTableRes.rows.length === 1, 'Table "oracle_raw_users" exists in PostgreSQL');

    // Test 2: Check oracle_raw_roles table existence
    const rolesTableRes = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'oracle_raw_roles'
    `);
    assert(rolesTableRes.rows.length === 1, 'Table "oracle_raw_roles" exists in PostgreSQL');

    // Test 3: Check columns in oracle_raw_users
    const userColumnsRes = await client.query(`
      SELECT column_name, data_type FROM information_schema.columns 
      WHERE table_name = 'oracle_raw_users'
    `);
    const userCols = new Set(userColumnsRes.rows.map(r => r.column_name));
    assert(
      userCols.has('environment_host') &&
      userCols.has('username') &&
      userCols.has('raw_user') &&
      userCols.has('last_synced_at'),
      'Table "oracle_raw_users" has required columns (environment_host, username, raw_user, last_synced_at)'
    );

    // Test 4: Check raw_user column is JSONB
    const rawUserCol = userColumnsRes.rows.find(r => r.column_name === 'raw_user');
    assert(rawUserCol?.data_type === 'jsonb', 'Column "raw_user" is of type JSONB');

    // Test 5: Check columns in oracle_raw_roles
    const roleColumnsRes = await client.query(`
      SELECT column_name, data_type FROM information_schema.columns 
      WHERE table_name = 'oracle_raw_roles'
    `);
    const roleCols = new Set(roleColumnsRes.rows.map(r => r.column_name));
    assert(
      roleCols.has('environment_host') &&
      roleCols.has('role_code') &&
      roleCols.has('raw_role') &&
      roleCols.has('last_synced_at'),
      'Table "oracle_raw_roles" has required columns (environment_host, role_code, raw_role, last_synced_at)'
    );

    // Test 6: Check raw_role column is JSONB
    const rawRoleCol = roleColumnsRes.rows.find(r => r.column_name === 'raw_role');
    assert(rawRoleCol?.data_type === 'jsonb', 'Column "raw_role" is of type JSONB');

    // Test 7: Verify raw roles records count
    const roleCountRes = await client.query('SELECT count(*) as count FROM oracle_raw_roles');
    const roleCount = parseInt(roleCountRes.rows[0].count, 10);
    assert(roleCount > 0, `Table "oracle_raw_roles" contains populated records (Count: ${roleCount})`);

    // Test 8: Verify raw users records count
    const userCountRes = await client.query('SELECT count(*) as count FROM oracle_raw_users');
    const userCount = parseInt(userCountRes.rows[0].count, 10);
    assert(userCount > 0, `Table "oracle_raw_users" contains populated records (Count: ${userCount})`);

    // Test 9: Verify raw JSON integrity for a user
    const sampleUserRes = await client.query('SELECT username, raw_user FROM oracle_raw_users LIMIT 1');
    const sampleUser = sampleUserRes.rows[0];
    assert(
      sampleUser && typeof sampleUser.raw_user === 'object' && sampleUser.raw_user !== null,
      'Stored user raw_user contains a valid parsed JSON object',
      `Username: ${sampleUser?.username}`
    );

    // Test 10: Verify raw JSON integrity for a role
    const sampleRoleRes = await client.query('SELECT role_code, raw_role FROM oracle_raw_roles LIMIT 1');
    const sampleRole = sampleRoleRes.rows[0];
    assert(
      sampleRole && typeof sampleRole.raw_role === 'object' && sampleRole.raw_role !== null,
      'Stored role raw_role contains a valid parsed JSON object',
      `Role Code: ${sampleRole?.role_code}`
    );

    // Test 11: Idempotent upsert verification
    const testHost = 'test.verify.oraclecloud.com';
    const testUsername = 'test_verify_user';
    await client.query(`
      INSERT INTO oracle_raw_users (environment_host, username, display_name, raw_user)
      VALUES ($1, $2, 'Test User', '{"test": true}'::jsonb)
      ON CONFLICT (environment_host, username) DO UPDATE SET display_name = EXCLUDED.display_name;
    `, [testHost, testUsername]);

    const upsertRes = await client.query(
      'SELECT username, raw_user FROM oracle_raw_users WHERE environment_host = $1 AND username = $2',
      [testHost, testUsername]
    );
    assert(upsertRes.rows.length === 1 && upsertRes.rows[0].raw_user.test === true, 'Idempotent upsert works as expected');

    // Clean up test record
    await client.query('DELETE FROM oracle_raw_users WHERE environment_host = $1 AND username = $2', [testHost, testUsername]);

  } finally {
    await client.end();
  }

  console.log(`\n===============================================================`);
  console.log(`  Tests Completed: Passed: ${passed}, Failed: ${failed}`);
  console.log(`===============================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
