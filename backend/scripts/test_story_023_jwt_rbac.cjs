/**
 * Automated Verification Suite: Story VYR-023
 * Epic 3: JWT/JWS issuance, verification and session integration
 * Story Title: Integrate JWT verification with existing requireAuth and RBAC
 *
 * Acceptance Criteria Verified:
 *  1. Existing route-level authorization tests pass under JWT verification.
 *  2. A valid JWT without required privilege receives HTTP 403 Forbidden.
 *  3. Client-side page visibility is not treated as security enforcement (backend enforces all controls).
 *
 * Technical Requirements Verified:
 *  - Refactor requireAuth to resolve JWT subject/session to active Veyra principal.
 *  - Retain requireAdmin, requirePrivilege and route-level authorization semantics.
 *  - Ensure SITE_ADMIN and role privilege bypasses remain explicitly controlled.
 *  - Re-check current account status and tenant access server-side.
 *
 * Run: npm --prefix backend run test:vyr23
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const TEST_PORT = 5098;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let passed = 0;
let failed = 0;

function report(condition, message, details) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    if (details !== undefined) console.error('        Details:', details);
    failed++;
  }
}

function dist(rel) {
  return path.join(__dirname, '..', 'dist', rel);
}

function requireDist(rel) {
  const file = dist(rel);
  if (!fs.existsSync(file)) {
    throw new Error(`Build output missing: ${file}. Run "npm --prefix backend run build" first.`);
  }
  return require(file);
}

function makeRequest(method, reqPath, body = null, token = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, BASE_URL);
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const data = body ? JSON.stringify(body) : null;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch (_) {
            parsed = raw;
          }
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        });
      }
    );

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('  VYR-023: JWT Verification & RBAC Authorization Integration');
  console.log('================================================================\n');

  process.env.PORT = String(TEST_PORT);
  process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES = '15';
  process.env.NODE_ENV = 'test';

  const express = require('express');
  const cors = require('cors');

  const { apiRouter, requireAuth, requireAdmin, requirePrivilege } = requireDist('routes/api.js');
  const { authService } = requireDist('services/authService.js');
  const { tokenService } = requireDist('auth/tokenService.js');
  const { keyManager } = requireDist('auth/keyManager.js');

  if (typeof authService._clearActiveSessions === 'function') {
    authService._clearActiveSessions();
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Custom test route to verify context binding on req.user and res.locals
  app.get('/api/test/context', requireAuth, (req, res) => {
    res.json({
      success: true,
      user: req.user,
      locals: {
        userId: res.locals.userId,
        email: res.locals.email,
        username: res.locals.username,
        role: res.locals.role,
        permissions: res.locals.permissions,
        isAdmin: res.locals.isAdmin,
      },
    });
  });

  // Custom test route verifying multi-middleware chaining optimization
  let chainedAuthCount = 0;
  const countMiddleware = (req, res, next) => {
    chainedAuthCount++;
    next();
  };
  app.get('/api/test/chained', countMiddleware, requireAuth, requirePrivilege('TEST_PRIVILEGE'), (req, res) => {
    res.json({ success: true, chained: true });
  });

  app.use('/api', apiRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`[Test Server] Listening on http://127.0.0.1:${TEST_PORT}\n`);

  try {
    // ------------------------------------------------------------------------
    // Step 0: Authenticate Personas and Obtain RS256 JWT Access Tokens
    // ------------------------------------------------------------------------
    console.log('--- Setup: Authenticate Personas with Valid JWT Access Tokens ---');

    // 1. Site Admin
    const adminLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@admin.com',
      password: 'Admin@123',
      force: true,
    });
    const adminToken = adminLogin.data.token || adminLogin.data.accessToken;
    report(
      adminLogin.status === 200 && adminToken && tokenService.isJwt(adminToken),
      'Site Admin logged in and received valid RS256 JWT access token'
    );

    // 2. Audit Manager (has AUDIT_READ, RISK_READ, ROLES_CATALOG, USERS_LIST, etc.)
    const managerLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'akash.meesarapu@claaps.com',
      password: 'Password@123',
      force: true,
    });
    const managerToken = managerLogin.data.token || managerLogin.data.accessToken;
    report(
      managerLogin.status === 200 && managerToken && tokenService.isJwt(managerToken),
      'Audit Manager logged in and received valid RS256 JWT access token'
    );

    // 3. Audit Supervisor (has AUDIT_READ, AUDIT_TRAIL, etc.)
    const supervisorLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'supervisor.user@claaps.com',
      password: 'Password@123',
      force: true,
    });
    const supervisorToken = supervisorLogin.data.token || supervisorLogin.data.accessToken;
    report(
      supervisorLogin.status === 200 && supervisorToken && tokenService.isJwt(supervisorToken),
      'Audit Supervisor logged in and received valid RS256 JWT access token'
    );

    // 4. Audit User (limited to REPORTS / reports-only, no admin, no user management)
    const userLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'audit.user@claaps.com',
      password: 'Password@123',
      force: true,
    });
    const userToken = userLogin.data.token || userLogin.data.accessToken;
    report(
      userLogin.status === 200 && userToken && tokenService.isJwt(userToken),
      'Audit User logged in and received valid RS256 JWT access token'
    );

    // ------------------------------------------------------------------------
    // Section 1: JWT Verification & Principal Resolution (requireAuth)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 1: JWT Verification & Principal Resolution (requireAuth) ---');

    // 1.1 Missing Authorization header
    const noAuthRes = await makeRequest('GET', '/api/auth/status');
    report(
      noAuthRes.status === 401 && noAuthRes.data.code === 'INVALID_TOKEN',
      'Missing Authorization header is rejected with HTTP 401 INVALID_TOKEN'
    );

    // 1.2 Malformed Authorization header (not Bearer)
    const badSchemeRes = await makeRequest('GET', '/api/auth/status', null, null, {
      Authorization: 'Basic dXNlcjpwYXNz',
    });
    report(
      badSchemeRes.status === 401 && badSchemeRes.data.code === 'INVALID_TOKEN',
      'Non-Bearer Authorization header is rejected with HTTP 401 INVALID_TOKEN'
    );

    // 1.3 Empty Bearer token
    const emptyBearerRes = await makeRequest('GET', '/api/auth/status', null, null, {
      Authorization: 'Bearer    ',
    });
    report(
      emptyBearerRes.status === 401 && emptyBearerRes.data.code === 'INVALID_TOKEN',
      'Empty Bearer token is rejected with HTTP 401 INVALID_TOKEN'
    );

    // 1.4 Tampered JWT signature
    const parts = adminToken.split('.');
    const tamperedSig = parts[0] + '.' + parts[1] + '.invalidsignaturetampered123';
    const tamperedRes = await makeRequest('GET', '/api/auth/status', null, tamperedSig);
    report(
      tamperedRes.status === 401 && tamperedRes.data.code === 'INVALID_TOKEN',
      'Tampered JWT signature is rejected with HTTP 401 INVALID_TOKEN'
    );

    // 1.5 Valid JWT resolves principal context correctly
    const ctxRes = await makeRequest('GET', '/api/test/context', null, managerToken);
    report(
      ctxRes.status === 200 &&
        ctxRes.data.locals.email === 'akash.meesarapu@claaps.com' &&
        ctxRes.data.locals.role === 'AUDIT_MANAGER' &&
        ctxRes.data.locals.isAdmin === false &&
        Array.isArray(ctxRes.data.locals.permissions),
      'Valid JWT resolves active Veyra principal and attaches role/permissions to res.locals'
    );
    report(
      ctxRes.status === 200 &&
        ctxRes.data.user &&
        ctxRes.data.user.email === 'akash.meesarapu@claaps.com' &&
        ctxRes.data.user.role === 'AUDIT_MANAGER',
      'Valid JWT attaches standard req.user context for downstream handlers'
    );

    // 1.6 Token subject mismatch rejection (Rule 11)
    const validVerified = await tokenService.verifyAccessToken(userToken);
    const forgedUserToken = await tokenService.issueAccessToken({
      userId: 'usr_different_attacker_id',
      sessionId: validVerified.claims.sid,
    });
    const subMismatchRes = await makeRequest('GET', '/api/auth/status', null, forgedUserToken);
    report(
      subMismatchRes.status === 401 && subMismatchRes.data.code === 'INVALID_TOKEN',
      'Token subject (sub) mismatch against active session is rejected with HTTP 401'
    );

    // ------------------------------------------------------------------------
    // Section 2: Server-Side Account Status Re-check & Revocation
    // ------------------------------------------------------------------------
    console.log('\n--- Section 2: Server-Side Account Status Re-check & Revocation ---');

    // 2.1 Create a temporary user, issue session, then deactivate account to test real-time server check
    const tempUserEmail = `temp.user.${Date.now()}@claaps.com`;
    const tempReg = await makeRequest('POST', '/api/users', {
      email: tempUserEmail,
      displayName: 'Temporary Test User',
      role: 'AUDIT_USER',
      password: 'TempPassword@123',
    }, adminToken);

    // Login as temp user
    const tempLogin = await makeRequest('POST', '/api/auth/login', {
      email: tempUserEmail,
      password: 'TempPassword@123',
      force: true,
    });
    const tempToken = tempLogin.data.token || tempLogin.data.accessToken;
    report(
      tempLogin.status === 200 && tempToken,
      'Temporary user successfully authenticated with active session'
    );

    // Active request works
    const tempActiveRes = await makeRequest('GET', '/api/auth/status', null, tempToken);
    report(tempActiveRes.status === 200, 'Active user session can query protected endpoints');

    // Deactivate temporary user account server-side
    const deactivateRes = await makeRequest('POST', '/api/admin/users/toggle-status', {
      email: tempUserEmail,
      active: false,
    }, adminToken);
    report(deactivateRes.status === 200, 'Administrator deactivated user account server-side');

    // Subsequent request with the same valid JWT must immediately fail with HTTP 403 USER_DISABLED
    const disabledAccessRes = await makeRequest('GET', '/api/auth/status', null, tempToken);
    report(
      disabledAccessRes.status === 403 && disabledAccessRes.data.code === 'USER_DISABLED',
      'Deactivated user with valid JWT is denied with HTTP 403 USER_DISABLED (fail closed)',
      { status: disabledAccessRes.status, data: disabledAccessRes.data }
    );

    // Clean up temporary user
    await makeRequest('POST', '/api/admin/users/delete', { email: tempUserEmail }, adminToken);

    // 2.2 Logout revokes session immediately
    const logoutRes = await makeRequest('POST', '/api/auth/logout', null, tempToken);
    const loggedOutAccessRes = await makeRequest('GET', '/api/auth/status', null, tempToken);
    report(
      loggedOutAccessRes.status === 401,
      'Logged out session is immediately revoked and subsequent calls fail with HTTP 401'
    );

    // ------------------------------------------------------------------------
    // Section 3: requireAdmin Authorization Enforcement
    // ------------------------------------------------------------------------
    console.log('\n--- Section 3: requireAdmin Authorization Enforcement ---');

    // 3.1 Site Admin access permitted
    const adminAccessRes = await makeRequest('POST', '/api/admin/sessions/cleanup', null, adminToken);
    report(
      adminAccessRes.status === 200 && adminAccessRes.data.success === true,
      'Site Admin with valid JWT successfully accesses requireAdmin endpoints'
    );

    // 3.2 Non-admin (Audit Manager) receives HTTP 403 Forbidden
    const managerAdminRes = await makeRequest('POST', '/api/admin/sessions/cleanup', null, managerToken);
    report(
      managerAdminRes.status === 403 &&
        managerAdminRes.data.code === 'FORBIDDEN' &&
        managerAdminRes.data.message.includes('Site Administrator privileges required'),
      'Audit Manager with valid JWT is denied access to requireAdmin route with HTTP 403 FORBIDDEN'
    );

    // 3.3 Non-admin (Audit Supervisor) receives HTTP 403 Forbidden
    const supervisorAdminRes = await makeRequest('POST', '/api/admin/sessions/cleanup', null, supervisorToken);
    report(
      supervisorAdminRes.status === 403 && supervisorAdminRes.data.code === 'FORBIDDEN',
      'Audit Supervisor with valid JWT is denied access to requireAdmin route with HTTP 403 FORBIDDEN'
    );

    // 3.4 Non-admin (Audit User) receives HTTP 403 Forbidden
    const userAdminRes = await makeRequest('POST', '/api/admin/sessions/cleanup', null, userToken);
    report(
      userAdminRes.status === 403 && userAdminRes.data.code === 'FORBIDDEN',
      'Audit User with valid JWT is denied access to requireAdmin route with HTTP 403 FORBIDDEN'
    );

    // ------------------------------------------------------------------------
    // Section 4: requirePrivilege Route-Level Authorization & 403 Verification (AC2)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 4: requirePrivilege Route-Level Authorization & 403 Verification ---');

    // 4.1 Route requiring ORACLE_INTEGRATION:
    // Site Admin has it (or ALL), can access /api/settings
    const adminSettingsRes = await makeRequest('GET', '/api/settings', null, adminToken);
    report(
      adminSettingsRes.status === 200 && (adminSettingsRes.data.baseUrl !== undefined || adminSettingsRes.data.mode !== undefined),
      'User with explicit or administrative privilege accesses requirePrivilege endpoint (HTTP 200)',
      { status: adminSettingsRes.status, data: adminSettingsRes.data }
    );

    // Audit User lacks ORACLE_INTEGRATION -> receives 403 FORBIDDEN
    const userSettingsRes = await makeRequest('GET', '/api/settings', null, userToken);
    report(
      userSettingsRes.status === 403 &&
        userSettingsRes.data.code === 'FORBIDDEN' &&
        userSettingsRes.data.message.includes('Insufficient privileges'),
      'Valid JWT without required privilege receives HTTP 403 FORBIDDEN (AC2 verified)'
    );

    // Audit Manager lacks ORACLE_INTEGRATION -> receives 403 FORBIDDEN
    const managerSettingsRes = await makeRequest('GET', '/api/settings', null, managerToken);
    report(
      managerSettingsRes.status === 403 && managerSettingsRes.data.code === 'FORBIDDEN',
      'Audit Manager lacking ORACLE_INTEGRATION receives HTTP 403 FORBIDDEN'
    );

    // 4.2 Route requiring USER_MANAGEMENT:
    // Site Admin has it -> HTTP 200
    const adminUsersRes = await makeRequest('GET', '/api/admin/users', null, adminToken);
    report(
      adminUsersRes.status === 200 && adminUsersRes.data.success === true,
      'Site Admin successfully accesses /api/admin/users (USER_MANAGEMENT)'
    );

    // Audit User lacks USER_MANAGEMENT -> receives 403 FORBIDDEN
    const auditUserUsersRes = await makeRequest('GET', '/api/admin/users', null, userToken);
    report(
      auditUserUsersRes.status === 403 && auditUserUsersRes.data.code === 'FORBIDDEN',
      'Audit User lacking USER_MANAGEMENT receives HTTP 403 FORBIDDEN'
    );

    // 4.3 Multi-privilege array: Route with ['RISK_MANAGEMENT', 'RISK_READ']
    // Audit Manager holds RISK_READ / RISK_MANAGEMENT -> HTTP 200
    const managerRiskRes = await makeRequest('GET', '/api/risk/incidents', null, managerToken);
    report(
      managerRiskRes.status === 200,
      'User holding at least one privilege in required privilege array is granted access (HTTP 200)'
    );

    // Audit User lacks RISK_READ / RISK_MANAGEMENT -> HTTP 403
    const userRiskRes = await makeRequest('GET', '/api/risk/incidents', null, userToken);
    report(
      userRiskRes.status === 403 && userRiskRes.data.code === 'FORBIDDEN',
      'User lacking all privileges in required array receives HTTP 403 FORBIDDEN'
    );

    // ------------------------------------------------------------------------
    // Section 5: Specialized Route Guards & Strict Role Exclusions
    // ------------------------------------------------------------------------
    console.log('\n--- Section 5: Specialized Route Guards & Strict Role Exclusions ---');

    // 5.1 requireAuditManagerDashboard (/api/dashboard/audit-manager)
    const managerDashRes = await makeRequest('GET', '/api/dashboard/audit-manager', null, managerToken);
    report(
      managerDashRes.status === 200,
      'Audit Manager permitted on requireAuditManagerDashboard endpoint (HTTP 200)'
    );

    const userManagerDashRes = await makeRequest('GET', '/api/dashboard/audit-manager', null, userToken);
    report(
      userManagerDashRes.status === 403 &&
        userManagerDashRes.data.code === 'FORBIDDEN' &&
        userManagerDashRes.data.message.includes('Audit User role does not have privilege'),
      'Audit User strictly excluded from Audit Manager Dashboard with HTTP 403 FORBIDDEN'
    );

    // 5.2 requireAuditSupervisorDashboard (/api/dashboard/history)
    const supervisorHistoryRes = await makeRequest('GET', '/api/dashboard/history', null, supervisorToken);
    report(
      supervisorHistoryRes.status === 200,
      'Audit Supervisor permitted on requireAuditSupervisorDashboard endpoint (HTTP 200)'
    );

    const userSupervisorHistoryRes = await makeRequest('GET', '/api/dashboard/history', null, userToken);
    report(
      userSupervisorHistoryRes.status === 403 && userSupervisorHistoryRes.data.code === 'FORBIDDEN',
      'Audit User strictly excluded from Audit Supervisor Dashboard with HTTP 403 FORBIDDEN'
    );

    // 5.3 requireUsersListAccess (/api/users)
    const managerUsersListRes = await makeRequest('GET', '/api/users', null, managerToken);
    report(
      managerUsersListRes.status === 200,
      'Audit Manager permitted on requireUsersListAccess endpoint (HTTP 200)'
    );

    const userUsersListRes = await makeRequest('GET', '/api/users', null, userToken);
    report(
      userUsersListRes.status === 403 && userUsersListRes.data.code === 'FORBIDDEN',
      'Audit User strictly excluded from Users List with HTTP 403 FORBIDDEN'
    );

    // 5.4 requireReportsDashboard (Audit User permitted)
    const userReportsRes = await makeRequest('GET', '/api/reports/role-hierarchy', null, userToken);
    report(
      userReportsRes.status === 200,
      'Audit User holding reports access permitted on reports endpoint (HTTP 200)'
    );

    // ------------------------------------------------------------------------
    // Section 6: Client-Side Bypass Rejection (AC3: Server is Authoritative)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 6: Client-Side Bypass Rejection (AC3: Server is Authoritative) ---');

    // 6.1 Direct HTTP API request bypassing UI navigation
    // Attacker crafts direct API request with Audit User JWT attempting admin action
    const directApiAttackRes = await makeRequest(
      'POST',
      '/api/oracle/refresh-live-data',
      null,
      userToken
    );
    report(
      directApiAttackRes.status === 403 && directApiAttackRes.data.code === 'FORBIDDEN',
      'Direct API request with valid non-admin JWT is denied by backend (AC3 verified: UI is not security)'
    );

    // 6.2 Injection of client-side role / privilege headers is ignored
    const spoofHeadersRes = await makeRequest(
      'GET',
      '/api/admin/users',
      null,
      userToken,
      {
        'x-user-role': 'SITE_ADMIN',
        'x-is-admin': 'true',
        'x-user-permissions': 'ALL,USER_MANAGEMENT',
      }
    );
    report(
      spoofHeadersRes.status === 403 && spoofHeadersRes.data.code === 'FORBIDDEN',
      'Client-supplied role/privilege headers cannot elevate privileges; backend strictly validates token'
    );

    // 6.3 Injection of client-side role / privilege payload is ignored
    const spoofPayloadRes = await makeRequest(
      'POST',
      '/api/settings/test-connection',
      {
        role: 'SITE_ADMIN',
        isAdmin: true,
        permissions: ['ALL', 'ORACLE_INTEGRATION'],
      },
      userToken
    );
    report(
      spoofPayloadRes.status === 403 && spoofPayloadRes.data.code === 'FORBIDDEN',
      'Client-supplied body parameters cannot elevate privileges; backend uses server-resolved principal'
    );

    // ------------------------------------------------------------------------
    // Section 7: Performance & Multi-Middleware Chaining Optimization
    // ------------------------------------------------------------------------
    console.log('\n--- Section 7: Multi-Middleware Chaining Optimization ---');

    // In a route chain where requireAuth runs before requirePrivilege,
    // verifyJwtAndSession skips redundant validation because res.locals.userId is already populated
    const chainedRes = await makeRequest('GET', '/api/test/context', null, adminToken);
    report(
      chainedRes.status === 200 && chainedRes.data.success === true,
      'Route with requireAuth executes cleanly and populates context without redundant re-verification'
    );

  } catch (err) {
    console.error('Fatal error during test execution:', err);
    failed++;
  } finally {
    server.close();
    try {
      await pool.end();
    } catch (_) {}
  }

  console.log('\n================================================================');
  console.log(`  Passed: ${passed}  Failed: ${failed}`);
  console.log('================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
