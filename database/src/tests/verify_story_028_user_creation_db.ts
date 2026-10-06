/**
 * Automated Database Verification Suite for:
 * Story: VY-STRY-28
 * Title: DB: Persist User Creation, Role Assignment and Application Access
 *
 * Verifies all Acceptance Criteria:
 * - AC1: New user can be inserted into veyra_user.
 * - AC2: Role assignment is persisted in the user-role relationship table (veyra_user_role).
 * - AC3: Duplicate email is prevented through database constraint.
 * - AC4: Invalid role references are prevented using foreign keys.
 * - AC5: User status is persisted.
 * - AC6: Created/updated timestamps are maintained.
 * - AC7: Created-by information is persisted.
 * - AC8: Application/data scope can be associated with the user where required
 *        (user -> user_application_scope -> application).
 * - AC9: User creation and role assignment must be transactional.
 *        If role assignment fails, the user creation transaction must not leave inconsistent data.
 * - Section 10: Migration Reversibility (UP / DOWN).
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
  console.log('  VEYRA Database Verification: VY-STRY-28 User Creation & Scopes DB');
  console.log(`  Connecting to: ${connectionString.replace(/:[^:@]+@/, ':****@')}`);
  console.log('========================================================================\n');

  try {
    // Ensure migrations are up to date
    execSync('npm run migrate', { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });

    // -------------------------------------------------------------------------
    // SECTION 1: User Persistence into veyra_user (AC1, AC5, AC6, AC7)
    // -------------------------------------------------------------------------
    console.log('--- Section 1: User Persistence into veyra_user (AC1, AC5, AC6, AC7) ---');

    const testEmail1 = `auditor.user.${Date.now()}@veyra.local`;
    const testDisplayName1 = 'Senior Audit Officer';
    const testCreator1 = 'admin@admin.com';

    const insertUserRes = await pool.query(`
      INSERT INTO veyra_user (
        email, display_name, status, is_local_user, created_by
      ) VALUES (
        $1, $2, 'ACTIVE', TRUE, $3
      ) RETURNING id, email, display_name, status, created_by, created_at, updated_at;
    `, [testEmail1, testDisplayName1, testCreator1]);

    assert(insertUserRes.rows.length === 1, 'TEST 1: New user can be inserted into veyra_user (AC1)');
    const createdUser = insertUserRes.rows[0];
    const createdUserId = createdUser.id;

    assert(createdUser.email === testEmail1, 'TEST 2: User email persisted accurately (AC1)');
    assert(createdUser.display_name === testDisplayName1, 'TEST 3: User display name persisted accurately (AC1)');
    assert(createdUser.status === 'ACTIVE', 'TEST 4: User status is persisted as ACTIVE (AC5)');
    assert(createdUser.created_by === testCreator1, 'TEST 5: Created-by information is persisted (AC7)');
    assert(createdUser.created_at !== null && createdUser.updated_at !== null, 'TEST 6: Created and updated timestamps are populated (AC6)');

    // -------------------------------------------------------------------------
    // SECTION 2: Role Assignment Persistence (AC2)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 2: Role Assignment Persistence (AC2) ---');

    const roleRes = await pool.query(`SELECT id, role_code FROM veyra_role WHERE role_code = 'AUDIT_USER' LIMIT 1`);
    assert(roleRes.rows.length === 1, 'Found existing AUDIT_USER role in database');
    const auditRoleId = roleRes.rows[0].id;

    // Persist role assignment in veyra_user_role
    const userRoleRes = await pool.query(`
      INSERT INTO veyra_user_role (user_id, role_id, created_by)
      VALUES ($1, $2, $3)
      RETURNING id, user_id, role_id, created_by;
    `, [createdUserId, auditRoleId, testCreator1]);

    assert(userRoleRes.rows.length === 1, 'TEST 7: Role assignment persisted in user-role relationship table (AC2)');

    // Verify join resolves role code
    const userRoleJoin = await pool.query(`
      SELECT u.id, u.email, r.role_code, r.role_name
      FROM veyra_user u
      JOIN veyra_user_role ur ON u.id = ur.user_id
      JOIN veyra_role r ON ur.role_id = r.id
      WHERE u.id = $1;
    `, [createdUserId]);

    assert(
      userRoleJoin.rows.length === 1 && userRoleJoin.rows[0].role_code === 'AUDIT_USER',
      'TEST 8: Role assignment relationship can be joined and resolved via veyra_user_role (AC2)'
    );

    // -------------------------------------------------------------------------
    // SECTION 3: Duplicate Email Constraint (AC3)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 3: Duplicate Email Prevention (AC3) ---');

    let dupEmailRejected = false;
    try {
      await pool.query(`
        INSERT INTO veyra_user (email, display_name, status)
        VALUES ($1, 'Duplicate Attempt', 'ACTIVE');
      `, [testEmail1]);
    } catch (err: any) {
      if (err.code === '23505') {
        dupEmailRejected = true;
      }
    }
    assert(dupEmailRejected, 'TEST 9: Duplicate email is prevented through database unique constraint (23505) (AC3)');

    // -------------------------------------------------------------------------
    // SECTION 4: Invalid Role References Prevented via Foreign Key (AC4)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 4: Foreign Key Referential Integrity for Roles (AC4) ---');

    const bogusRoleId = '00000000-0000-0000-0000-000000000000';
    let invalidRoleRejected = false;
    try {
      await pool.query(`
        INSERT INTO veyra_user_role (user_id, role_id, created_by)
        VALUES ($1, $2, 'SYSTEM');
      `, [createdUserId, bogusRoleId]);
    } catch (err: any) {
      if (err.code === '23503') {
        invalidRoleRejected = true;
      }
    }
    assert(invalidRoleRejected, 'TEST 10: Invalid role references prevented by foreign key constraint (23503) (AC4)');

    // -------------------------------------------------------------------------
    // SECTION 5: Timestamp Updates upon Record Modification (AC6)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 5: Timestamp Maintenance upon Modification (AC6) ---');

    const initialUpdatedAt = new Date(createdUser.updated_at).getTime();

    // Sleep 15ms so timestamp difference is measurable
    await new Promise(r => setTimeout(r, 20));

    const updateRes = await pool.query(`
      UPDATE veyra_user
      SET display_name = 'Lead Senior Audit Officer',
          updated_by = 'admin@admin.com'
      WHERE id = $1
      RETURNING updated_at, display_name;
    `, [createdUserId]);

    const newUpdatedAt = new Date(updateRes.rows[0].updated_at).getTime();
    assert(newUpdatedAt > initialUpdatedAt, 'TEST 11: Updated-at timestamp automatically advanced upon modification (AC6)');

    // -------------------------------------------------------------------------
    // SECTION 6: Application and Data Scope Association (AC8)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 6: Application Scope Persistence (AC8) ---');

    // 12. veyra_application table exists and contains seeded applications
    const appsRes = await pool.query(`
      SELECT id, app_code, app_name, status FROM veyra_application WHERE status = 'ACTIVE' ORDER BY app_code;
    `);
    assert(appsRes.rows.length >= 3, 'TEST 12: veyra_application table contains seeded active applications (AC8)');

    const fusionApp = appsRes.rows.find(a => a.app_code === 'ORACLE_FUSION');
    assert(fusionApp !== undefined, 'TEST 13: ORACLE_FUSION application exists in veyra_application (AC8)');

    // 14. Associate user with application scope (GLOBAL scope for ORACLE_FUSION)
    const scopeInsertRes = await pool.query(`
      INSERT INTO veyra_user_application_scope (
        user_id, application_id, scope_type, scope_value, access_level, granted_by
      ) VALUES (
        $1, $2, 'GLOBAL', 'ALL', 'AUDITOR', 'admin@admin.com'
      ) RETURNING id, user_id, application_id, scope_type, scope_value, access_level;
    `, [createdUserId, fusionApp.id]);

    assert(scopeInsertRes.rows.length === 1, 'TEST 14: Application scope associated with user in veyra_user_application_scope (AC8)');

    // 15. Associate secondary application scope (e.g., BUSINESS_UNIT scope for ORACLE_ERP)
    const erpApp = appsRes.rows.find(a => a.app_code === 'ORACLE_ERP');
    if (erpApp) {
      await pool.query(`
        INSERT INTO veyra_user_application_scope (
          user_id, application_id, scope_type, scope_value, access_level, granted_by
        ) VALUES (
          $1, $2, 'BUSINESS_UNIT', 'US1_LEGAL_ENTITY', 'READ', 'admin@admin.com'
        );
      `, [createdUserId, erpApp.id]);
    }

    // 16. Verify query traversing user -> user_application_scope -> application
    const userScopesQuery = await pool.query(`
      SELECT uas.id, uas.scope_type, uas.scope_value, uas.access_level, a.app_code, a.app_name
      FROM veyra_user_application_scope uas
      JOIN veyra_application a ON uas.application_id = a.id
      WHERE uas.user_id = $1
      ORDER BY a.app_code;
    `, [createdUserId]);

    assert(userScopesQuery.rows.length >= 2, 'TEST 15: User application scopes successfully queried via user -> user_application_scope -> application hierarchy (AC8)');
    assert(userScopesQuery.rows.some(s => s.app_code === 'ORACLE_FUSION' && s.scope_type === 'GLOBAL'), 'TEST 16: User has GLOBAL scope on ORACLE_FUSION (AC8)');

    // 17. Duplicate scope prevention
    let dupScopeRejected = false;
    try {
      await pool.query(`
        INSERT INTO veyra_user_application_scope (
          user_id, application_id, scope_type, scope_value
        ) VALUES (
          $1, $2, 'GLOBAL', 'ALL'
        );
      `, [createdUserId, fusionApp.id]);
    } catch (err: any) {
      if (err.code === '23505') {
        dupScopeRejected = true;
      }
    }
    assert(dupScopeRejected, 'TEST 17: Duplicate user application scope rejected by unique constraint (AC8)');

    // -------------------------------------------------------------------------
    // SECTION 7: Referential Integrity and Cascade Deletes (AC4, AC8)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 7: Referential Integrity and Cascade Deletion (AC4, AC8) ---');

    await pool.query(`DELETE FROM veyra_user WHERE id = $1`, [createdUserId]);

    // Check roles were cascaded
    const rolesAfterDelete = await pool.query(`SELECT id FROM veyra_user_role WHERE user_id = $1`, [createdUserId]);
    assert(rolesAfterDelete.rows.length === 0, 'TEST 18: User deletion cleanly cascades to veyra_user_role (AC4)');

    // Check scopes were cascaded
    const scopesAfterDelete = await pool.query(`SELECT id FROM veyra_user_application_scope WHERE user_id = $1`, [createdUserId]);
    assert(scopesAfterDelete.rows.length === 0, 'TEST 19: User deletion cleanly cascades to veyra_user_application_scope (AC8)');

    // -------------------------------------------------------------------------
    // SECTION 8: Transactional Atomicity (AC9)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 8: Transactional Atomicity & Rollback Integrity (AC9) ---');

    const txTestEmail = `tx.failed.user.${Date.now()}@veyra.local`;

    // Simulate failed transaction: user creation succeeds, but role assignment fails due to invalid foreign key
    const client = await pool.connect();
    let txErrorEncountered = false;
    try {
      await client.query('BEGIN');
      const userTxRes = await client.query(`
        INSERT INTO veyra_user (email, display_name, status, created_by)
        VALUES ($1, 'Tx Failure User', 'ACTIVE', 'admin@admin.com')
        RETURNING id;
      `, [txTestEmail]);

      const txUserId = userTxRes.rows[0].id;

      // Intentionally insert with non-existent role_id to trigger constraint violation
      await client.query(`
        INSERT INTO veyra_user_role (user_id, role_id, created_by)
        VALUES ($1, '99999999-9999-9999-9999-999999999999', 'admin@admin.com');
      `, [txUserId]);

      await client.query('COMMIT');
    } catch (txErr) {
      txErrorEncountered = true;
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    assert(txErrorEncountered, 'TEST 20: Transaction encountered failure on invalid role assignment (AC9)');

    // Verify user was NOT persisted in veyra_user after rollback
    const userAfterRollback = await pool.query(`SELECT id FROM veyra_user WHERE email = $1`, [txTestEmail]);
    assert(
      userAfterRollback.rows.length === 0,
      'TEST 21: Transaction ROLLBACK left NO inconsistent user data in veyra_user (AC9)'
    );

    // Verify successful transaction: atomic commit of user, role, and application scopes
    const txSuccessEmail = `tx.success.user.${Date.now()}@veyra.local`;
    const client2 = await pool.connect();
    let committedUserId: string | null = null;
    try {
      await client2.query('BEGIN');
      const userTx = await client2.query(`
        INSERT INTO veyra_user (email, display_name, status, created_by)
        VALUES ($1, 'Tx Success User', 'ACTIVE', 'admin@admin.com')
        RETURNING id;
      `, [txSuccessEmail]);
      committedUserId = userTx.rows[0].id;

      await client2.query(`
        INSERT INTO veyra_user_role (user_id, role_id, created_by)
        VALUES ($1, $2, 'admin@admin.com');
      `, [committedUserId, auditRoleId]);

      await client2.query(`
        INSERT INTO veyra_user_application_scope (user_id, application_id, scope_type, scope_value, access_level, granted_by)
        VALUES ($1, $2, 'GLOBAL', 'ALL', 'AUDITOR', 'admin@admin.com');
      `, [committedUserId, fusionApp.id]);

      await client2.query('COMMIT');
    } catch (err) {
      await client2.query('ROLLBACK');
      throw err;
    } finally {
      client2.release();
    }

    // Verify atomic persistence of all 3 entities
    const checkTxUser = await pool.query(`SELECT id FROM veyra_user WHERE id = $1`, [committedUserId]);
    const checkTxRole = await pool.query(`SELECT id FROM veyra_user_role WHERE user_id = $1`, [committedUserId]);
    const checkTxScope = await pool.query(`SELECT id FROM veyra_user_application_scope WHERE user_id = $1`, [committedUserId]);

    assert(
      checkTxUser.rows.length === 1 && checkTxRole.rows.length === 1 && checkTxScope.rows.length === 1,
      'TEST 22: User creation, role assignment, and application scope committed atomically in single transaction (AC9)'
    );

    // Clean up test user
    await pool.query(`DELETE FROM veyra_user WHERE id = $1`, [committedUserId]);

    // -------------------------------------------------------------------------
    // SECTION 9: Indexes Verification (AC8)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 9: Indexes Verification (AC8) ---');

    const indexRes = await pool.query(`
      SELECT indexname, tablename FROM pg_indexes
      WHERE tablename IN ('veyra_application', 'veyra_user_application_scope');
    `);
    const indexNames = new Set(indexRes.rows.map(r => r.indexname));

    assert(indexNames.has('ix_veyra_application_app_code'), 'TEST 23a: Index ix_veyra_application_app_code exists');
    assert(indexNames.has('ix_veyra_application_status'), 'TEST 23b: Index ix_veyra_application_status exists');
    assert(indexNames.has('ix_veyra_user_app_scope_user_id'), 'TEST 23c: Index ix_veyra_user_app_scope_user_id exists');
    assert(indexNames.has('ix_veyra_user_app_scope_app_id'), 'TEST 23d: Index ix_veyra_user_app_scope_app_id exists');
    assert(indexNames.has('ix_veyra_user_app_scope_type'), 'TEST 23e: Index ix_veyra_user_app_scope_type exists');
    assert(indexNames.has('ix_veyra_user_app_scope_composite'), 'TEST 23f: Index ix_veyra_user_app_scope_composite exists');

    // -------------------------------------------------------------------------
    // SECTION 10: Migration Reversibility (UP / DOWN)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 10: Migration Reversibility ---');

    const currentMigRes = await pool.query('SELECT name FROM pgmigrations ORDER BY id DESC');
    const migNames = currentMigRes.rows.map(r => r.name);
    const migIndex = migNames.indexOf('1711000000008_create_application_scope_and_user_creation_tables');
    const rollbackCount = migIndex >= 0 ? migIndex + 1 : 1;

    execSync(`npx node-pg-migrate down ${rollbackCount}`, { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });

    const checkDroppedTables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('veyra_application', 'veyra_user_application_scope');
    `);
    assert(checkDroppedTables.rows.length === 0, 'TEST 24: Migration DOWN cleanly drops application and scope tables');

    // Re-apply migration
    execSync('npm run migrate', { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });

    const checkRestoredTables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('veyra_application', 'veyra_user_application_scope');
    `);
    assert(checkRestoredTables.rows.length === 2, 'TEST 25: Migration UP cleanly re-creates application and scope tables');

    // -------------------------------------------------------------------------
    // Final Summary
    // -------------------------------------------------------------------------
    console.log('\n========================================================================');
    console.log(`  Summary: ${passedTests} passed, ${failedTests} failed.`);
    if (failedTests === 0) {
      console.log('  🎉 All Story VY-STRY-28 Database Requirements Successfully Verified!');
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
