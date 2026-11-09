/**
 * Story 5 Verification Suite:
 * Remove chat endpoint and AskVeyra middleware from AI-free backend
 *
 * Objectives & Acceptance Criteria:
 * 1. Express Router Stack Audit: No '/chat' route is registered in apiRouter.
 * 2. Middleware Cleanup: requireAskVeyra is completely removed from exports and routes.
 * 3. Endpoint Unregistration Contract: POST /api/chat returns HTTP 404 (Not Found)
 *    for all callers (Unauthenticated, Admin, Audit Manager, Supervisor, Audit User).
 * 4. RBAC Decoupling: ASK_VEYRA privilege code is removed from role mappings,
 *    default privilege catalog, and database seed tables.
 * 5. Dashboard Isolation: Scoped dashboard responses report hasAskVeyraAccess=false,
 *    features.askVeyra=false, and exclude AI_ASSISTANT from authorized modules.
 * 6. Preserved Shared Authorization: requireAuth, requireRole, requirePrivilege,
 *    and dashboard guards continue to function properly (401/403/200).
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 5097;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function makeRequest(method, reqPath, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, BASE_URL);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const data = body ? JSON.stringify(body) : null;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {
          parsed = raw;
        }
        resolve({ status: res.statusCode, data: parsed, raw });
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('  Story 5: Remove Chat Endpoint & AskVeyra Middleware (AI-Free)');
  console.log('  API Contract & Authorization Verification Suite');
  console.log('================================================================\n');

  process.env.PORT = String(TEST_PORT);
  process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES = '5';
  process.env.NODE_ENV = 'test';

  const express = require('express');
  const cors = require('cors');

  const distApi = path.join(__dirname, '../dist/routes/api.js');
  if (!fs.existsSync(distApi)) {
    console.error('Build output dist/routes/api.js not found! Please run npm run build:backend first.');
    process.exit(1);
  }

  const apiModule = require(distApi);
  const { apiRouter } = apiModule;

  const distAuth = path.join(__dirname, '../dist/services/authService.js');
  const { authService } = require(distAuth);

  const distDb = path.join(__dirname, '../dist/db.js');
  const { query: dbQuery } = require(distDb);

  const distAuditDash = path.join(__dirname, '../dist/services/auditDashboardService.js');
  const { auditDashboardService } = require(distAuditDash);

  // Clear existing active test sessions
  await dbQuery("UPDATE veyra_session SET status = 'EXPIRED' WHERE status = 'ACTIVE'").catch(() => {});
  if (typeof authService._clearActiveSessions === 'function') {
    authService._clearActiveSessions();
  }

  // Setup Express App matching index.ts architecture
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Mount API router
  app.use('/api', apiRouter);

  // 404 handler for unknown routes (identical to src/index.ts)
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `API endpoint ${req.method} ${req.path} does not exist.`
    });
  });

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(TEST_PORT, resolve));
  console.log(`[Test Server] Running on http://127.0.0.1:${TEST_PORT}\n`);

  let testsPassed = 0;
  let testsFailed = 0;

  function assert(condition, message, details = null) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      testsPassed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      if (details) console.error(`         Details:`, details);
      testsFailed++;
    }
  }

  try {
    // ------------------------------------------------------------------------
    // Section 1: Router Stack & Dead Middleware Inspection
    // ------------------------------------------------------------------------
    console.log('--- Section 1: Router Stack & Middleware Inspection ---');

    // 1.1 Verify requireAskVeyra is not exported
    assert(
      typeof apiModule.requireAskVeyra === 'undefined',
      'requireAskVeyra middleware is completely purged from api.js exports'
    );

    // 1.2 Inspect apiRouter.stack for /chat routes
    const registeredRoutes = [];
    if (apiRouter.stack) {
      for (const layer of apiRouter.stack) {
        if (layer.route && layer.route.path) {
          const methods = Object.keys(layer.route.methods || {}).map(m => m.toUpperCase());
          registeredRoutes.push({ path: layer.route.path, methods });
        }
      }
    }

    const hasChatRoute = registeredRoutes.some(r => r.path === '/chat' || r.path === '/api/chat');
    assert(
      !hasChatRoute,
      'Express apiRouter.stack does NOT contain any route registration for /chat'
    );

    const postChatRoute = registeredRoutes.find(r => r.path === '/chat' && r.methods.includes('POST'));
    assert(
      !postChatRoute,
      'POST /chat route handler is completely removed from express router'
    );

    // ------------------------------------------------------------------------
    // Section 2: Personas Authentication for Contract Tests
    // ------------------------------------------------------------------------
    console.log('\n--- Section 2: Personas Authentication ---');

    const adminLogin = await authService.login('admin@admin.com', 'Admin@123').catch(() => null)
      || await authService.login('admin@admin.com', '');
    const adminToken = adminLogin?.token;
    assert(Boolean(adminToken), 'Site Admin authenticated successfully');

    const mgrLogin = await authService.login('akash.meesarapu@claaps.com', 'Password@123');
    const mgrToken = mgrLogin?.token;
    assert(Boolean(mgrToken), 'Audit Manager authenticated successfully');

    const supLogin = await authService.login('supervisor.user@claaps.com', 'Password@123');
    const supToken = supLogin?.token;
    assert(Boolean(supToken), 'Audit Supervisor authenticated successfully');

    const userLogin = await authService.login('audit.user@claaps.com', 'Password@123');
    const userToken = userLogin?.token;
    assert(Boolean(userToken), 'Audit User authenticated successfully');

    // ------------------------------------------------------------------------
    // Section 3: API Contract Tests — POST /api/chat Returns 404 Not Found
    // ------------------------------------------------------------------------
    console.log('\n--- Section 3: API Contract — POST /api/chat Unregistered (404) ---');

    // 3.1 Unauthenticated request returns 404 (not 401, confirming endpoint does not exist)
    const unauthChat = await makeRequest('POST', '/api/chat', { message: 'hello' });
    assert(
      unauthChat.status === 404,
      'Unauthenticated POST /api/chat returns HTTP 404 Not Found',
      unauthChat
    );
    assert(
      unauthChat.data?.error === 'Not Found',
      '404 payload correctly identifies "Not Found" error structure'
    );

    // 3.2 Site Admin request returns 404 (not 200 or 500)
    const adminChat = await makeRequest('POST', '/api/chat', { message: 'system status' }, adminToken);
    assert(
      adminChat.status === 404,
      'Site Admin POST /api/chat returns HTTP 404 Not Found (no chat endpoint exposed)',
      adminChat
    );

    // 3.3 Audit Manager request returns 404
    const mgrChat = await makeRequest('POST', '/api/chat', { message: 'show high risk roles' }, mgrToken);
    assert(
      mgrChat.status === 404,
      'Audit Manager POST /api/chat returns HTTP 404 Not Found',
      mgrChat
    );

    // 3.4 Audit Supervisor request returns 404 (not 403 Forbidden)
    const supChat = await makeRequest('POST', '/api/chat', { message: 'audit status' }, supToken);
    assert(
      supChat.status === 404,
      'Audit Supervisor POST /api/chat returns HTTP 404 Not Found (endpoint absent, not 403)',
      supChat
    );

    // 3.5 Audit User request returns 404
    const userChat = await makeRequest('POST', '/api/chat', { message: 'my reports' }, userToken);
    assert(
      userChat.status === 404,
      'Audit User POST /api/chat returns HTTP 404 Not Found',
      userChat
    );

    // 3.6 GET /api/chat returns 404
    const getChat = await makeRequest('GET', '/api/chat', null, adminToken);
    assert(
      getChat.status === 404,
      'GET /api/chat returns HTTP 404 Not Found',
      getChat
    );

    // ------------------------------------------------------------------------
    // Section 4: RBAC & Permission Decoupling Verification
    // ------------------------------------------------------------------------
    console.log('\n--- Section 4: RBAC & Permission Decoupling ---');

    // 4.1 Audit Manager role does not have ASK_VEYRA
    const mgrRole = authService.getRoleByIdOrCode('AUDIT_MANAGER');
    const mgrPrivs = mgrRole ? mgrRole.privileges : [];
    assert(
      !mgrPrivs.includes('ASK_VEYRA'),
      'AUDIT_MANAGER role privileges do NOT include ASK_VEYRA'
    );

    // 4.2 Site Admin role does not have ASK_VEYRA
    const adminRole = authService.getRoleByIdOrCode('SITE_ADMIN');
    const adminPrivs = adminRole ? adminRole.privileges : [];
    assert(
      !adminPrivs.includes('ASK_VEYRA'),
      'SITE_ADMIN role privileges do NOT include ASK_VEYRA'
    );

    // 4.3 Security Analyst role does not have ASK_VEYRA
    const analystRole = authService.getRoleByIdOrCode('SECURITY_ANALYST');
    const analystPrivs = analystRole ? analystRole.privileges : [];
    assert(
      !analystPrivs.includes('ASK_VEYRA'),
      'SECURITY_ANALYST role privileges do NOT include ASK_VEYRA'
    );

    // 4.4 Global catalog does not include priv_ask_veyra
    const allPrivs = authService.getPrivilegesList();
    const hasAskVeyraPriv = allPrivs.some(p => p.privilege_code === 'ASK_VEYRA' || p.id === 'priv_ask_veyra');
    assert(
      !hasAskVeyraPriv,
      'System privilege catalog does NOT contain ASK_VEYRA privilege'
    );

    // 4.5 Login tokens do not contain ASK_VEYRA permission
    assert(
      Array.isArray(mgrLogin?.permissions) && !mgrLogin.permissions.includes('ASK_VEYRA'),
      'AUDIT_MANAGER login permissions array does NOT contain ASK_VEYRA'
    );

    // 4.6 Database check for veyra_privilege table
    const dbPrivCheck = await dbQuery("SELECT * FROM veyra_privilege WHERE privilege_code = 'ASK_VEYRA'");
    assert(
      dbPrivCheck.rows.length === 0,
      'PostgreSQL veyra_privilege table has 0 rows for ASK_VEYRA'
    );

    const dbMapCheck = await dbQuery(`
      SELECT rp.* FROM veyra_role_privilege rp
      JOIN veyra_privilege p ON p.id = rp.privilege_id
      WHERE p.privilege_code = 'ASK_VEYRA'
    `);
    assert(
      dbMapCheck.rows.length === 0,
      'PostgreSQL veyra_role_privilege table has 0 mappings for ASK_VEYRA'
    );

    // ------------------------------------------------------------------------
    // Section 5: Dashboard Service AI-Free Flags
    // ------------------------------------------------------------------------
    console.log('\n--- Section 5: Dashboard AI-Free Flags ---');

    const adminUserContext = {
      userId: adminLogin.userId,
      email: adminLogin.email,
      displayName: adminLogin.displayName,
      role: 'SITE_ADMIN',
      permissions: adminLogin.permissions
    };
    const mgrUserContext = {
      userId: mgrLogin.userId,
      email: mgrLogin.email,
      displayName: mgrLogin.displayName,
      role: 'AUDIT_MANAGER',
      permissions: mgrLogin.permissions
    };
    const supUserContext = {
      userId: supLogin.userId,
      email: supLogin.email,
      displayName: supLogin.displayName,
      role: 'AUDIT_SUPERVISOR',
      permissions: supLogin.permissions
    };

    const mgrDashData = await auditDashboardService.getDashboardDataForUser(mgrUserContext);
    assert(
      mgrDashData.userScope?.hasAskVeyraAccess === false,
      'Audit Manager userScope.hasAskVeyraAccess is strictly false'
    );
    assert(
      mgrDashData.userScope?.features?.askVeyra === false,
      'Audit Manager userScope.features.askVeyra is strictly false'
    );
    assert(
      !mgrDashData.userScope?.authorizedModules?.includes('AI_ASSISTANT'),
      'Audit Manager authorizedModules does NOT contain AI_ASSISTANT'
    );

    const supDashData = await auditDashboardService.getSupervisorDashboardData(supUserContext);
    assert(
      supDashData.userScope?.features?.askVeyra === false,
      'Audit Supervisor userScope.features.askVeyra is strictly false'
    );
    assert(
      !supDashData.userScope?.authorizedModules?.includes('AI_ASSISTANT'),
      'Audit Supervisor authorizedModules does NOT contain AI_ASSISTANT'
    );

    // ------------------------------------------------------------------------
    // Section 6: Preservation of Shared Authorization & Route Guards
    // ------------------------------------------------------------------------
    console.log('\n--- Section 6: Preserved Shared Authorization & Route Guards ---');

    // 6.1 requireAuth guards protected routes
    const unauthUsers = await makeRequest('GET', '/api/users');
    assert(
      unauthUsers.status === 401,
      'requireAuth middleware continues to reject unauthenticated request with 401'
    );

    // 6.2 requirePrivilege / requireRole guards administrative routes
    const forbiddenSettings = await makeRequest('GET', '/api/settings', null, userToken);
    assert(
      forbiddenSettings.status === 403,
      'requirePrivilege middleware continues to block unauthorized role with 403'
    );

    // 6.3 Authorized user can access legitimate routes
    const authReports = await makeRequest('GET', '/api/reports/role-hierarchy', null, userToken);
    assert(
      authReports.status === 200,
      'AUDIT_USER can access GET /api/reports/role-hierarchy with REPORTS privilege (200 OK)'
    );

    const authUsers = await makeRequest('GET', '/api/users', null, adminToken);
    assert(
      authUsers.status === 200,
      'SITE_ADMIN can access GET /api/users with administrative privilege (200 OK)'
    );

    const authMgrDash = await makeRequest('GET', '/api/dashboard/audit-manager', null, mgrToken);
    assert(
      authMgrDash.status === 200,
      'AUDIT_MANAGER can access GET /api/dashboard/audit-manager (200 OK)'
    );
  } finally {
    server.close();
    console.log('\n[Test Server] Shut down gracefully.');
  }

  console.log('\n================================================================');
  console.log(`  Summary: ${testsPassed} passed, ${testsFailed} failed.`);
  if (testsFailed === 0) {
    console.log('  🎉 All Story 5 API Contract & Verification Tests Passed!');
  } else {
    console.error('  ⚠️ Some Story 5 verification tests failed.');
  }
  console.log('================================================================');

  process.exit(testsFailed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Unexpected error running Story 5 tests:', err);
  process.exit(1);
});
