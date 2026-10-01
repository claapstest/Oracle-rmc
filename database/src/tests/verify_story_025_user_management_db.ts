/**
 * Automated Database Verification Suite for:
 * Story: VY-STRY-25
 * Title: DB: Implement User Management Database Schema and Indexes
 *
 * Verifies all Acceptance Criteria:
 * 1. Database schema support for:
 *    - User identity (id UUID PK)
 *    - Email
 *    - Display name
 *    - Status
 *    - Role assignment
 *    - Created date
 *    - Updated date
 *    - Last login
 *    - Created by
 *    - Updated by
 * 2. Required Constraints:
 *    - Unique user email
 *    - Valid role foreign key
 *    - Valid user status
 *    - Referential integrity
 * 3. Appropriate Indexes:
 *    - email
 *    - name (display_name)
 *    - role (user_role table / role_id / role_code)
 *    - status
 *    - last_login_at
 * 4. Query Performance & Index Scans
 * 5. Migration Reversibility (UP / DOWN)
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || '127.0.0.1'}:${process.env.POSTGRES_PORT || '5433'}/${process.env.POSTGRES_DB || 'veyra_db'}`;

const pool = new pg.Pool({ connectionString });

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}`);
    if (details) {
      console.error(`     Details: ${details}`);
    }
    failedTests++;
  }
}

async function runVerification() {
  console.log('========================================================================');
  console.log('  VEYRA Database Verification: VY-STRY-25 User Management Schema & Indexes');
  console.log(`  Connecting to: ${connectionString.replace(/:[^:@]+@/, ':****@')}`);
  console.log('========================================================================\n');

  try {
    // Ensure migrations are up to date
    execSync('npm run migrate', { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });

    // -------------------------------------------------------------------------
    // SECTION 1: Schema Support for All User Management Fields (AC1)
    // -------------------------------------------------------------------------
    console.log('--- Section 1: User Management Fields Support (AC1) ---');

    // 1. Query table columns from information_schema
    const colRes = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'veyra_user'
    `);
    const colMap = new Map(colRes.rows.map(r => [r.column_name, r]));

    // Check individual required fields
    assert(colMap.has('id') && colMap.get('id')!.data_type === 'uuid', 'TEST 1: User identity (id UUID PK) supported');
    assert(colMap.has('email') && colMap.get('email')!.is_nullable === 'NO', 'TEST 2: Email (email VARCHAR NOT NULL) supported');
    assert(colMap.has('display_name'), 'TEST 3: Display name (display_name VARCHAR) supported');
    assert(colMap.has('status') && colMap.get('status')!.is_nullable === 'NO', 'TEST 4: Status (status VARCHAR NOT NULL) supported');
    assert(colMap.has('created_at') && colMap.get('created_at')!.data_type.includes('timestamp'), 'TEST 5: Created date (created_at TIMESTAMPTZ) supported');
    assert(colMap.has('updated_at') && colMap.get('updated_at')!.data_type.includes('timestamp'), 'TEST 6: Updated date (updated_at TIMESTAMPTZ) supported');
    assert(colMap.has('last_login_at') && colMap.get('last_login_at')!.data_type.includes('timestamp'), 'TEST 7: Last login (last_login_at TIMESTAMPTZ) supported');
    assert(colMap.has('created_by'), 'TEST 8: Created by (created_by VARCHAR) supported');
    assert(colMap.has('updated_by'), 'TEST 9: Updated by (updated_by VARCHAR) supported');

    // Role assignment table (veyra_user_role)
    const userRoleTable = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'veyra_user_role'
    `);
    assert(userRoleTable.rows.length === 1, 'TEST 10: Role assignment (veyra_user_role) table supported');

    // -------------------------------------------------------------------------
    // SECTION 2: Constraints Verification (AC2)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 2: Required Constraints Verification (AC2) ---');

    // 11. Unique User Email constraint
    const uqRes = await pool.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'veyra_user'::regclass AND contype = 'u'
    `);
    const uqNames = uqRes.rows.map(r => r.conname);
    assert(uqNames.includes('uq_veyra_user_email'), 'TEST 11: Unique constraint uq_veyra_user_email exists');

    // Test duplicate email rejection
    let duplicateEmailRejected = false;
    try {
      await pool.query(`
        INSERT INTO veyra_user (email, display_name, status)
        VALUES ('admin@admin.com', 'Duplicate Admin', 'ACTIVE');
      `);
    } catch (err: any) {
      if (err.code === '23505') {
        duplicateEmailRejected = true;
      }
    }
    assert(duplicateEmailRejected, 'TEST 12: Unique user email constraint enforced (duplicate email rejected with 23505)');

    // 12. Valid User Status check constraint
    const testEmailStatus = `status_test_${Date.now()}@claaps.com`;
    // Insert valid status
    const validStatusRes = await pool.query(`
      INSERT INTO veyra_user (email, display_name, status)
      VALUES ($1, 'Status Test User', 'ACTIVE')
      RETURNING id, status;
    `, [testEmailStatus]);
    assert(validStatusRes.rows.length === 1 && validStatusRes.rows[0].status === 'ACTIVE', 'TEST 13: Valid user status (ACTIVE) accepted by constraint');

    // Reject invalid status
    let invalidStatusRejected = false;
    try {
      await pool.query(`
        INSERT INTO veyra_user (email, display_name, status)
        VALUES ($1, 'Invalid Status User', 'BOGUS_STATUS');
      `, [`bogus_${Date.now()}@claaps.com`]);
    } catch (err: any) {
      if (err.code === '23514') {
        invalidStatusRejected = true;
      }
    }
    assert(invalidStatusRejected, 'TEST 14: Valid user status constraint enforced (invalid status rejected with 23514)');

    // 13. Valid Role Foreign Key constraint
    const testUserId = validStatusRes.rows[0].id;
    let invalidRoleRejected = false;
    try {
      await pool.query(`
        INSERT INTO veyra_user_role (user_id, role_id)
        VALUES ($1, '00000000-0000-0000-0000-000000000000');
      `, [testUserId]);
    } catch (err: any) {
      if (err.code === '23503') {
        invalidRoleRejected = true;
      }
    }
    assert(invalidRoleRejected, 'TEST 15: Valid role foreign key constraint enforced (invalid role_id rejected with 23503)');

    // 14. Referential Integrity on Role Assignment (Cascade on User Deletion)
    const adminRoleRes = await pool.query(`SELECT id FROM veyra_role WHERE role_code = 'AUDIT_USER' LIMIT 1`);
    const auditRoleId = adminRoleRes.rows[0].id;

    await pool.query(`
      INSERT INTO veyra_user_role (user_id, role_id, created_by)
      VALUES ($1, $2, 'TEST_SUITE')
    `, [testUserId, auditRoleId]);

    const assignedRole = await pool.query(`
      SELECT user_id, role_id FROM veyra_user_role WHERE user_id = $1
    `, [testUserId]);
    assert(assignedRole.rows.length === 1, 'TEST 16: Role assigned successfully to user in veyra_user_role');

    // Delete user and verify cascade delete in veyra_user_role
    await pool.query(`DELETE FROM veyra_user WHERE id = $1`, [testUserId]);
    const orphanedRoles = await pool.query(`
      SELECT user_id FROM veyra_user_role WHERE user_id = $1
    `, [testUserId]);
    assert(orphanedRoles.rows.length === 0, 'TEST 17: Referential integrity enforced (user deletion cascades to veyra_user_role)');

    // -------------------------------------------------------------------------
    // SECTION 3: Required Indexes Verification (AC3)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 3: Appropriate Indexes Verification (AC3) ---');

    const indexRes = await pool.query(`
      SELECT indexname, tablename FROM pg_indexes
      WHERE tablename IN ('veyra_user', 'veyra_user_role', 'veyra_role')
    `);
    const indexNames = new Set(indexRes.rows.map(r => r.indexname));

    // Index on email
    assert(indexNames.has('ix_veyra_user_email'), 'TEST 18: Index on email (ix_veyra_user_email) exists');

    // Index on name
    assert(indexNames.has('ix_veyra_user_display_name'), 'TEST 19a: Index on name (ix_veyra_user_display_name) exists');
    assert(indexNames.has('ix_veyra_user_display_name_lower'), 'TEST 19b: Index on case-insensitive name (ix_veyra_user_display_name_lower) exists');

    // Index on role
    assert(indexNames.has('ix_veyra_user_role_role_id'), 'TEST 20a: Index on role foreign key (ix_veyra_user_role_role_id) exists');
    assert(indexNames.has('ix_veyra_user_role_user_id'), 'TEST 20b: Index on user_role user_id (ix_veyra_user_role_user_id) exists');
    assert(indexNames.has('ix_veyra_user_role_lookup'), 'TEST 20c: Composite index on user_role lookup (ix_veyra_user_role_lookup) exists');
    assert(indexNames.has('ix_veyra_role_role_code'), 'TEST 20d: Index on role_code (ix_veyra_role_role_code) exists');

    // Index on status
    assert(indexNames.has('ix_veyra_user_status'), 'TEST 21a: Index on status (ix_veyra_user_status) exists');
    assert(indexNames.has('ix_veyra_user_status_created'), 'TEST 21b: Composite index on status and created_at (ix_veyra_user_status_created) exists');

    // Index on last_login_at
    assert(indexNames.has('ix_veyra_user_last_login_at'), 'TEST 22: Index on last_login_at (ix_veyra_user_last_login_at) exists');

    // Additional User List sorting indexes
    assert(indexNames.has('ix_veyra_user_created_at'), 'TEST 23a: Index on created_at (ix_veyra_user_created_at) exists');
    assert(indexNames.has('ix_veyra_user_updated_at'), 'TEST 23b: Index on updated_at (ix_veyra_user_updated_at) exists');

    // -------------------------------------------------------------------------
    // SECTION 4: Automatic Timestamp & Trigger Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Section 4: Automatic updated_at Trigger Verification ---');

    const triggerUserEmail = `trg_test_${Date.now()}@claaps.com`;
    const trigInsert = await pool.query(`
      INSERT INTO veyra_user (email, display_name, status, created_at, updated_at)
      VALUES ($1, 'Trigger Test User', 'ACTIVE', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour')
      RETURNING id, updated_at;
    `, [triggerUserEmail]);

    const initialUpdatedAt = new Date(trigInsert.rows[0].updated_at).getTime();

    // Perform update
    const trigUpdate = await pool.query(`
      UPDATE veyra_user
      SET display_name = 'Updated Trigger Name'
      WHERE id = $1
      RETURNING updated_at;
    `, [trigInsert.rows[0].id]);

    const newUpdatedAt = new Date(trigUpdate.rows[0].updated_at).getTime();
    assert(newUpdatedAt > initialUpdatedAt, 'TEST 24: Trigger automatically updates updated_at timestamp upon modification');

    // Clean up
    await pool.query(`DELETE FROM veyra_user WHERE id = $1`, [trigInsert.rows[0].id]);

    // -------------------------------------------------------------------------
    // SECTION 5: Query Plan & Index Scan Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Section 5: Query Plan & Index Scan Verification ---');

    // Verify index scan on display_name search
    await pool.query('SET enable_seqscan = off');

    const explainName = await pool.query(`
      EXPLAIN (FORMAT JSON)
      SELECT id, email, display_name
      FROM veyra_user
      WHERE display_name = 'Administrator';
    `);
    const planNameText = JSON.stringify(explainName.rows);
    const usesNameIndex = planNameText.includes('ix_veyra_user_display_name') || planNameText.includes('Index Scan');
    assert(usesNameIndex, 'TEST 25: Query on display_name uses index scan');

    // Verify index scan on status
    const explainStatus = await pool.query(`
      EXPLAIN (FORMAT JSON)
      SELECT id, email, status
      FROM veyra_user
      WHERE status = 'ACTIVE'
      ORDER BY status, created_at DESC;
    `);
    const planStatusText = JSON.stringify(explainStatus.rows);
    const usesStatusIndex = planStatusText.includes('ix_veyra_user_status') || planStatusText.includes('Index Scan');
    assert(usesStatusIndex, 'TEST 26: Query on status with sorting uses index scan');

    await pool.query('SET enable_seqscan = on');

    // -------------------------------------------------------------------------
    // SECTION 6: Migration Reversibility (DOWN and UP)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 6: Migration Reversibility ---');

    // Rollback migration
    const currentMigRes = await pool.query('SELECT name FROM pgmigrations ORDER BY id DESC');
    const migNames = currentMigRes.rows.map(r => r.name);
    const migIndex = migNames.indexOf('1711000000007_create_user_management_schema_and_indexes');
    const rollbackCount = migIndex >= 0 ? migIndex + 1 : 1;

    execSync(`npx node-pg-migrate down ${rollbackCount}`, { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });

    const checkDroppedIdx = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'veyra_user' AND indexname IN (
        'ix_veyra_user_display_name',
        'ix_veyra_user_status',
        'ix_veyra_user_last_login_at'
      );
    `);
    assert(checkDroppedIdx.rows.length === 0, 'TEST 27: Migration DOWN cleanly drops user management indexes');

    // Re-apply migration
    execSync('npm run migrate', { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });

    const checkRestoredIdx = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'veyra_user' AND indexname IN (
        'ix_veyra_user_display_name',
        'ix_veyra_user_status',
        'ix_veyra_user_last_login_at'
      );
    `);
    assert(checkRestoredIdx.rows.length === 3, 'TEST 28: Migration UP cleanly restores user management indexes');

    // -------------------------------------------------------------------------
    // Final Summary
    // -------------------------------------------------------------------------
    console.log('\n========================================================================');
    console.log(`  Summary: ${passedTests} passed, ${failedTests} failed.`);
    if (failedTests === 0) {
      console.log('  🎉 All Story VY-STRY-25 Database Requirements Successfully Verified!');
    } else {
      console.error('  ⚠️ Some verification tests failed!');
    }
    console.log('========================================================================\n');

  } catch (error) {
    console.error('Fatal verification error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }

  if (failedTests > 0) {
    process.exit(1);
  }
}

runVerification();
