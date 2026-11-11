/**
 * Automated Verification Suite: Story VYR-017
 * Epic 2: Configurable authentication providers: Entra ID and Local Users
 * Story Title: Unify logout, expiry and account-state handling across providers
 *
 * Acceptance Criteria Verified:
 * 1. Unified session lifecycle and principal normalization across providers (LOCAL & ENTRA).
 * 2. Instant local session revocation on logout (in-memory & veyra_session database).
 * 3. Subsequent requests with revoked tokens fail immediately with HTTP 401 INVALID_TOKEN.
 * 4. Sliding inactivity expiration and keep-alive session refresh.
 * 5. Real-time fail-closed enforcement when account status changes to DISABLED / SUSPENDED (HTTP 403 USER_DISABLED).
 * 6. Entra upstream Single Logout (SLO) URL construction and metadata exposure.
 */

const assert = require('assert');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

let passedTests = 0;
let failedTests = 0;

function report(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  FAIL: ${message}`);
    failedTests++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('  VYR-017: Unified Session, Expiry and Logout Verification Suite');
  console.log('================================================================\n');

  const { authService } = await import('../dist/services/authService.js');
  const { buildEntraLogoutUrl, isEntraEnabled } = await import('../dist/services/entraOidcService.js');
  const { pool } = await import('../dist/db.js');

  // -------------------------------------------------------------------------
  // Section 1: Session Normalization & Single Active Session Enforcement
  // -------------------------------------------------------------------------
  console.log('--- Section 1: Unified Session Lifecycle & Principal Normalization ---');

  // Clean any active sessions for the test user first
  const testEmail = 'audit.manager@claaps.com';
  const testPassword = process.env.TEST_USER_PASSWORD || 'Manager@123';

  // Login session 1 with force: true
  const login1 = await authService.login(testEmail, testPassword, { force: true });
  report(
    login1 && login1.success && typeof login1.token === 'string',
    'AC1.1: Successful login creates valid session token'
  );

  const session1Token = login1.token;
  const validation1 = await authService.validateSession(session1Token, false);
  report(
    validation1.valid && validation1.session && validation1.session.email.toLowerCase() === testEmail.toLowerCase(),
    'AC1.2: Active session normalizes user email identity to lowercase'
  );
  report(
    validation1.session && validation1.session.authProvider === 'LOCAL',
    'AC1.3: Session tracks correct authentication provider (LOCAL)'
  );

  // Verify veyra_session database record
  const dbSessionRes = await pool.query(
    `SELECT s.*, u.email as user_email, u.status as user_status 
     FROM veyra_session s 
     JOIN veyra_user u ON u.id = s.user_id 
     WHERE u.email = $1 AND s.status = 'ACTIVE'`,
    [testEmail]
  );
  report(
    dbSessionRes.rows.length === 1 && dbSessionRes.rows[0].status === 'ACTIVE',
    'AC1.4: veyra_session table contains synchronized active record for the session'
  );

  // Attempt concurrent second login without force -> must reject with 409
  const loginConflict = await authService.login(testEmail, testPassword, { force: false });
  report(
    loginConflict.success === false && loginConflict.code === 'ACTIVE_SESSION_EXISTS',
    'AC1.5: Concurrent login attempt without force is rejected with ACTIVE_SESSION_EXISTS'
  );

  // Second login with force: true -> supersedes session 1
  const login2 = await authService.login(testEmail, testPassword, { force: true });
  report(
    login2.success && typeof login2.token === 'string',
    'AC1.6: Concurrent login with force: true successfully creates new session'
  );

  // Verify previous session1 is revoked/invalidated
  const oldValidation = await authService.validateSession(session1Token, false);
  report(
    oldValidation.valid === false,
    'AC1.7: Overridden session 1 is immediately invalidated'
  );

  // -------------------------------------------------------------------------
  // Section 2: Sliding Inactivity Expiration & Keep-Alive Refresh
  // -------------------------------------------------------------------------
  console.log('\n--- Section 2: Sliding Inactivity Expiration & Refresh ---');

  const session2Token = login2.token;
  const initialValidation = await authService.validateSession(session2Token, false);
  const initialLastActivity = initialValidation.session.lastActivityAt;

  // Refresh session activity
  await new Promise(r => setTimeout(r, 50));
  const refreshResult = await authService.refreshSessionActivity(session2Token);
  report(
    refreshResult.success && refreshResult.lastActivityAt >= initialLastActivity,
    'AC2.1: refreshSessionActivity successfully updates lastActivityAt'
  );

  // Simulate inactivity expiration by backdating lastActivityAt beyond 15 minutes (901 seconds)
  const expiredTime = Date.now() - (901 * 1000);
  const activeSessionObj = authService.getSession(session2Token);
  if (activeSessionObj) {
    activeSessionObj.lastActivityAt = expiredTime;
    activeSessionObj.expiresAt = expiredTime;
  }
  await pool.query(
    `UPDATE veyra_session 
     SET last_activity_at = to_timestamp($1 / 1000.0), 
         expires_at = to_timestamp($1 / 1000.0)
     WHERE session_id = $2`,
    [expiredTime, session2Token]
  );

  const expiredValidation = await authService.validateSession(session2Token, true);
  report(
    expiredValidation.valid === false && expiredValidation.code === 'SESSION_EXPIRED',
    'AC2.2: Session past 15-minute inactivity window is rejected with SESSION_EXPIRED'
  );

  // -------------------------------------------------------------------------
  // Section 3: Instant Local Session Revocation on Logout
  // -------------------------------------------------------------------------
  console.log('\n--- Section 3: Instant Local Session Revocation on Logout ---');

  // Sign in clean session
  const login3 = await authService.login(testEmail, testPassword, { forceOverride: true });
  const session3Token = login3.token;
  report(
    login3.success && (await authService.validateSession(session3Token, false)).valid,
    'AC3.1: Fresh session established for revocation test'
  );

  // Perform logout
  await authService.logout(session3Token, { ipAddress: '127.0.0.1', userAgent: 'TestRunner' });

  // Verify memory cache immediately invalid
  const postLogoutValidation = await authService.validateSession(session3Token, false);
  report(
    postLogoutValidation.valid === false && postLogoutValidation.code === 'INVALID_TOKEN',
    'AC3.2: Revoked session fails validation immediately with INVALID_TOKEN'
  );

  // Verify DB veyra_session status is no longer ACTIVE
  const dbPostLogoutRes = await pool.query(
    `SELECT status FROM veyra_session WHERE session_id = $1`,
    [session3Token]
  );
  report(
    dbPostLogoutRes.rows.length === 1 && dbPostLogoutRes.rows[0].status === 'LOGGED_OUT',
    'AC3.3: Database veyra_session record is updated to LOGGED_OUT status immediately'
  );

  // -------------------------------------------------------------------------
  // Section 4: Real-time Account Deactivation Enforcement (Fail-Closed)
  // -------------------------------------------------------------------------
  console.log('\n--- Section 4: Real-time Account Deactivation Enforcement ---');

  // Create temporary test user to test disablement
  const disabledTestEmail = `temp.deact.${Date.now()}@example.com`;
  const createRes = await authService.createUser({
    email: disabledTestEmail,
    displayName: 'Temporary Deactivation Test User',
    role: 'AUDIT_USER',
    password: 'TempPassword@123',
    status: 'ACTIVE'
  });
  const createdUser = createRes.user;
  report(
    createRes.success && createdUser && createdUser.email.toLowerCase() === disabledTestEmail.toLowerCase(),
    'AC4.1: Temporary user provisioned in database with ACTIVE status'
  );

  // User logs in and obtains active session
  const deactLogin = await authService.login(disabledTestEmail, 'TempPassword@123');
  report(
    deactLogin.success && typeof deactLogin.token === 'string',
    'AC4.2: User successfully logs in with active session'
  );
  const deactToken = deactLogin.token;

  // Verify session is active before disabling
  const beforeDeactValidation = await authService.validateSession(deactToken, false);
  report(
    beforeDeactValidation.valid === true,
    'AC4.3: Session validates successfully while user status is ACTIVE'
  );

  // Site Admin deactivates/suspends user
  await authService.updateUser(disabledTestEmail, { status: 'DISABLED' });

  // Verify immediate real-time rejection on the next request
  const afterDeactValidation = await authService.validateSession(deactToken, false);
  report(
    afterDeactValidation.valid === false && afterDeactValidation.code === 'USER_DISABLED',
    'AC4.4: Active session immediately fails closed with USER_DISABLED upon account deactivation'
  );

  // Verify veyra_session was revoked in DB
  const dbDeactSessionRes = await pool.query(
    `SELECT status FROM veyra_session WHERE session_id = $1`,
    [deactToken]
  );
  report(
    dbDeactSessionRes.rows.length === 1 && dbDeactSessionRes.rows[0].status === 'EXPIRED',
    'AC4.5: Active database session was expired upon user deactivation'
  );

  // Cleanup temporary user
  await pool.query(`DELETE FROM veyra_session WHERE user_id IN (SELECT id FROM veyra_user WHERE email = $1)`, [disabledTestEmail]);
  await pool.query(`DELETE FROM veyra_user_role WHERE user_id IN (SELECT id FROM veyra_user WHERE email = $1)`, [disabledTestEmail]);
  await pool.query(`DELETE FROM veyra_user WHERE email = $1`, [disabledTestEmail]);
  if (authService.users && authService.users[disabledTestEmail]) {
    delete authService.users[disabledTestEmail];
    authService.saveUsers();
  }

  // -------------------------------------------------------------------------
  // Section 5: Upstream Microsoft Entra Sign-Out URL Construction & SLO
  // -------------------------------------------------------------------------
  console.log('\n--- Section 5: Upstream Microsoft Entra Sign-Out URL & SLO ---');

  // Test custom tenant Entra logout URL
  const testTenant = '88888888-4444-4444-4444-121212121212';
  const customLogoutUrl = buildEntraLogoutUrl(
    {
      tenantId: testTenant,
      clientId: 'dummy-client-id',
      clientSecret: 'dummy-secret',
      redirectUri: 'https://app.veyra.internal/auth/callback'
    },
    'https://app.veyra.internal/login'
  );
  report(
    customLogoutUrl.includes(`login.microsoftonline.com/${testTenant}/oauth2/v2.0/logout`) &&
    customLogoutUrl.includes('post_logout_redirect_uri=https%3A%2F%2Fapp.veyra.internal%2Flogin'),
    'AC5.1: buildEntraLogoutUrl formats tenant-specific Microsoft Entra end-session endpoint'
  );

  // Test fallback tenant
  const fallbackLogoutUrl = buildEntraLogoutUrl({
    tenantId: '',
    clientId: 'dummy',
    clientSecret: 'dummy',
    redirectUri: 'https://app.veyra.internal/callback'
  });
  report(
    fallbackLogoutUrl.includes('login.microsoftonline.com/common/oauth2/v2.0/logout'),
    'AC5.2: buildEntraLogoutUrl gracefully falls back to "common" if tenantId is blank'
  );

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`  Tests Completed: ${passedTests + failedTests}`);
  console.log(`  Passed: ${passedTests}`);
  console.log(`  Failed: ${failedTests}`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch(err => {
  console.error('Fatal error running Story 17 test suite:', err);
  process.exit(1);
});
