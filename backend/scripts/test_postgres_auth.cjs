const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const pg = require('pg');

const { authService } = require('../dist/services/authService.js');

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || '127.0.0.1'}:${process.env.POSTGRES_PORT || '5433'}/${process.env.POSTGRES_DB || 'veyra_db'}`;

async function runPostgresAuthTests() {
  console.log('===========================================================');
  console.log('🧪 Starting VEYRA PostgreSQL Authentication Test Suite');
  console.log('   Stories: VY-STRY-004 & VY-STRY-008');
  console.log('   Database: ' + connectionString.replace(/:[^:@]+@/, ':****@'));
  console.log('===========================================================');

  const client = new pg.Client({ connectionString });
  await client.connect();

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Test 1: admin@admin.com + Admin@123 authenticates successfully
    // -------------------------------------------------------------
    console.log('\n[Test 1: Local Admin Authentication]');
    const adminLogin = await authService.login('admin@admin.com', 'Admin@123');
    assert(adminLogin.success === true, 'admin@admin.com authenticates successfully against PostgreSQL');
    assert(adminLogin.role === 'SITE_ADMIN', 'admin receives SITE_ADMIN role from veyra_role');
    assert(adminLogin.isAdmin === true, 'admin has isAdmin = true');
    assert(Array.isArray(adminLogin.permissions) && adminLogin.permissions.length > 0, 'admin receives permissions array');
    assert(adminLogin.permissions.includes('ALL'), 'admin receives ALL permission');
    assert(adminLogin.permissions.includes('USER_MANAGEMENT'), 'admin receives USER_MANAGEMENT from veyra_privilege');
    assert(adminLogin.token && adminLogin.token.length > 20, 'Session token generated successfully');

    // -------------------------------------------------------------
    // Test 2: Safe Authenticated Response (No sensitive data)
    // -------------------------------------------------------------
    console.log('\n[Test 2: Sensitive Data Exclusion]');
    assert(adminLogin.password === undefined, 'Plaintext password is NOT in response');
    assert(adminLogin.passwordHash === undefined, 'password_hash is NOT in response');
    assert(adminLogin.password_hash === undefined, 'password_hash (snake_case) is NOT in response');

    // -------------------------------------------------------------
    // Test 3: Email Normalization (Mixed case and leading/trailing spaces)
    // -------------------------------------------------------------
    console.log('\n[Test 3: Email Normalization]');
    const normLogin = await authService.login('   Admin@Admin.COM   ', 'Admin@123');
    assert(normLogin.success === true, 'Email with spaces and uppercase normalizes and logs in');
    assert(normLogin.normalizedEmail === 'admin@admin.com', 'Normalized email equals admin@admin.com');

    // -------------------------------------------------------------
    // Test 4: Wrong Password -> Generic Failure
    // -------------------------------------------------------------
    console.log('\n[Test 4: Wrong Password Generic Failure]');
    const wrongPass = await authService.login('admin@admin.com', 'WrongPass@999');
    assert(wrongPass.success === false, 'Wrong password returns success = false');
    assert(wrongPass.message === 'Invalid email or password.', 'Generic error message returned on wrong password');

    // -------------------------------------------------------------
    // Test 5: Unknown Email -> Generic Failure (No enumeration)
    // -------------------------------------------------------------
    console.log('\n[Test 5: Non-Existent User Generic Failure]');
    const unknownUser = await authService.login('nobody@nowhere.com', 'Admin@123');
    assert(unknownUser.success === false, 'Non-existent user returns success = false');
    assert(unknownUser.message === 'Invalid email or password.', 'Identical generic error message (no account leakage)');

    // -------------------------------------------------------------
    // Test 6: Ineligible User Status (DISABLED / SUSPENDED)
    // -------------------------------------------------------------
    console.log('\n[Test 6: Ineligible Status Validation (DISABLED / SUSPENDED)]');
    const testDisabledEmail = 'disabled.tester@claaps.com';
    const testHash = bcrypt.hashSync('Password@123', 10);

    // Upsert disabled user in PostgreSQL
    await client.query(
      `INSERT INTO veyra_user (email, display_name, status, is_local_user, password_hash, created_by)
       VALUES ($1, 'Disabled Tester', 'DISABLED', TRUE, $2, 'TEST_SUITE')
       ON CONFLICT (email) DO UPDATE SET status = 'DISABLED', password_hash = $2`,
      [testDisabledEmail, testHash]
    );

    const disabledLogin = await authService.login(testDisabledEmail, 'Password@123');
    assert(disabledLogin.success === false, 'DISABLED user in PostgreSQL is rejected');
    assert(
      disabledLogin.message.toLowerCase().includes('not active'),
      'Inactive status message returned for disabled account'
    );

    // Update to SUSPENDED
    await client.query(
      `UPDATE veyra_user SET status = 'SUSPENDED' WHERE email = $1`,
      [testDisabledEmail]
    );
    const suspendedLogin = await authService.login(testDisabledEmail, 'Password@123');
    assert(suspendedLogin.success === false, 'SUSPENDED user in PostgreSQL is rejected');

    // Clean up test user
    await client.query(`DELETE FROM veyra_user WHERE email = $1`, [testDisabledEmail]);

    // -------------------------------------------------------------
    // Test 7: PostgreSQL is Source of Truth (users_auth.json is bypassed)
    // -------------------------------------------------------------
    console.log('\n[Test 7: Verification That PostgreSQL Is Source of Truth]');
    // Create a user exclusively in PostgreSQL that does NOT exist in users_auth.json
    const pgOnlyEmail = 'postgres.unique.user@claaps.com';
    const pgOnlyPass = 'PgExclusive@123';
    const pgOnlyHash = bcrypt.hashSync(pgOnlyPass, 10);

    const pgUserRes = await client.query(
      `INSERT INTO veyra_user (email, display_name, status, is_local_user, password_hash, created_by)
       VALUES ($1, 'Postgres Exclusive User', 'ACTIVE', TRUE, $2, 'TEST_SUITE')
       ON CONFLICT (email) DO UPDATE SET status = 'ACTIVE', password_hash = $2
       RETURNING id`,
      [pgOnlyEmail, pgOnlyHash]
    );
    const pgUserId = pgUserRes.rows[0].id;

    // Assign AUDIT_MANAGER role
    const auditRoleRes = await client.query(`SELECT id FROM veyra_role WHERE role_code = 'AUDIT_MANAGER'`);
    if (auditRoleRes.rows.length > 0) {
      await client.query(
        `INSERT INTO veyra_user_role (user_id, role_id, created_by)
         VALUES ($1, $2, 'TEST_SUITE')
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [pgUserId, auditRoleRes.rows[0].id]
      );
    }

    // Verify users_auth.json does not have this user
    const usersAuthContent = fs.readFileSync(path.join(__dirname, '../users_auth.json'), 'utf8');
    const usersAuthJson = JSON.parse(usersAuthContent);
    assert(
      !usersAuthJson.users || !usersAuthJson.users[pgOnlyEmail],
      'Test user does NOT exist in users_auth.json'
    );

    // Login must succeed exclusively from PostgreSQL
    const pgOnlyLogin = await authService.login(pgOnlyEmail, pgOnlyPass);
    assert(pgOnlyLogin.success === true, 'User existing only in PostgreSQL logs in successfully');
    assert(pgOnlyLogin.role === 'AUDIT_MANAGER', 'User role resolved from veyra_role');
    assert(Array.isArray(pgOnlyLogin.permissions) && pgOnlyLogin.permissions.includes('ASK_VEYRA'), 'AUDIT_MANAGER receives ASK_VEYRA from veyra_privilege');
    assert(pgOnlyLogin.userId === pgUserId, 'userId matches PostgreSQL veyra_user id');

    // Clean up test user
    await client.query(`DELETE FROM veyra_user WHERE email = $1`, [pgOnlyEmail]);

    // -------------------------------------------------------------
    // Test 8: veyra_user.last_login_at timestamp updated
    // -------------------------------------------------------------
    console.log('\n[Test 8: Database Audit - last_login_at updated]');
    const checkLastLogin = await client.query(
      `SELECT last_login_at FROM veyra_user WHERE email = 'admin@admin.com'`
    );
    assert(
      checkLastLogin.rows[0].last_login_at !== null,
      'veyra_user.last_login_at is populated with valid timestamp'
    );

    // -------------------------------------------------------------
    // Test Summary
    // -------------------------------------------------------------
    console.log('\n===========================================================');
    console.log(`📊 PostgreSQL Auth Test Summary: ${passed} Passed, ${failed} Failed`);
    console.log('===========================================================');

    await client.end();
    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('❌ Test runner encountered error:', err);
    await client.end();
    process.exit(1);
  }
}

runPostgresAuthTests();
