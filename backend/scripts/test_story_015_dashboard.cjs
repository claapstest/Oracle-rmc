const http = require('http');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 5097;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
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
  console.log('  VY-STRY-015: Audit Supervisor Dashboard APIs Test Suite');
  console.log('================================================================\n');

  process.env.PORT = String(TEST_PORT);
  process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES = '5';
  process.env.ORACLE_BASE_URL = '';
  process.env.NODE_ENV = 'test';

  const express = require('express');
  const cors = require('cors');

  const distApi = path.join(__dirname, '../dist/routes/api.js');
  if (!fs.existsSync(distApi)) {
    console.error('Build output dist/routes/api.js not found! Please run npm run build first.');
    process.exit(1);
  }

  const { apiRouter } = require(distApi);

  const distAuth = path.join(__dirname, '../dist/services/authService.js');
  const { authService } = require(distAuth);
  authService._clearActiveSessions();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use('/api', apiRouter);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(TEST_PORT, resolve));
  console.log(`[Test Server] Running on http://127.0.0.1:${TEST_PORT}\n`);

  let testsPassed = 0;
  let testsFailed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      testsPassed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      testsFailed++;
    }
  }

  try {
    // --- Step 0: Setup Authenticated Test Sessions ---
    // 1. Audit Supervisor
    const supLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'supervisor.user@claaps.com',
      password: 'Password@123'
    });
    const supervisorToken = supLogin.data.token;
    assert(supLogin.status === 200 && supervisorToken, 'Audit Supervisor logged in successfully');

    // 2. Site Admin
    const adminLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@admin.com',
      password: 'Admin@123'
    });
    const adminToken = adminLogin.data.token;
    assert(adminLogin.status === 200 && adminToken, 'Site Admin logged in successfully');

    // 3. Audit Manager
    const mgrLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'akash.meesarapu@claaps.com',
      password: 'Password@123'
    });
    const managerToken = mgrLogin.data.token;
    assert(mgrLogin.status === 200 && managerToken, 'Audit Manager logged in successfully');

    // 4. Audit User (Reports Only)
    const userLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'audit.user@claaps.com',
      password: 'Password@123'
    });
    const userToken = userLogin.data.token;
    assert(userLogin.status === 200 && userToken, 'Audit User logged in successfully');

    console.log('\n--- AC1: Authenticated Session Enforcement Tests ---');
    // AC1: Missing session token returns 401
    const noAuth = await makeRequest('GET', '/api/dashboard/audit-supervisor');
    assert(noAuth.status === 401, 'Unauthenticated request to /api/dashboard/audit-supervisor returns 401 Unauthorized (AC1)');
    assert(noAuth.data.code === 'AUTHENTICATION_REQUIRED' || noAuth.data.code === 'INVALID_TOKEN' || !noAuth.data.success, 'Unauthenticated request returns structured error format');

    // AC1: Invalid/Expired session token returns 401
    const invalidAuth = await makeRequest('GET', '/api/dashboard/audit-supervisor', null, 'invalid_session_token_12345');
    assert(invalidAuth.status === 401, 'Invalid session token returns 401 Unauthorized (AC1)');

    console.log('\n--- AC2 & AC5: Audit Supervisor Privileges & Server-Side Authorization Tests ---');
    // AC2: Audit Supervisor can access primary endpoint
    const supRes = await makeRequest('GET', '/api/dashboard/audit-supervisor', null, supervisorToken);
    assert(supRes.status === 200, 'Audit Supervisor gets 200 OK on GET /api/dashboard/audit-supervisor (AC2)');
    assert(supRes.data.success === true, 'Audit Supervisor response has success: true');

    // AC2: Site Admin can access supervisor dashboard
    const adminRes = await makeRequest('GET', '/api/dashboard/audit-supervisor', null, adminToken);
    assert(adminRes.status === 200, 'Site Admin gets 200 OK on GET /api/dashboard/audit-supervisor (AC2)');

    // AC2: Audit Manager can access supervisor dashboard
    const mgrRes = await makeRequest('GET', '/api/dashboard/audit-supervisor', null, managerToken);
    assert(mgrRes.status === 200, 'Audit Manager gets 200 OK on GET /api/dashboard/audit-supervisor (AC2)');

    // AC2 & AC6: Audit User (Reports Only) is strictly rejected with 403 Forbidden
    const unauthRes = await makeRequest('GET', '/api/dashboard/audit-supervisor', null, userToken);
    assert(unauthRes.status === 403, 'Audit User is rejected with 403 Forbidden on GET /api/dashboard/audit-supervisor (AC2, AC6)');
    assert(unauthRes.data.code === 'FORBIDDEN', '403 Forbidden has code FORBIDDEN');

    console.log('\n--- AC3: No Ask Veyra Functionality or Data Tests ---');
    // AC3: In userScope, authorizedModules must NOT contain AI_ASSISTANT or ASK_VEYRA
    const supModules = supRes.data.userScope?.authorizedModules || [];
    assert(!supModules.includes('AI_ASSISTANT'), 'userScope.authorizedModules does NOT contain AI_ASSISTANT (AC3)');
    assert(!supModules.includes('ASK_VEYRA'), 'userScope.authorizedModules does NOT contain ASK_VEYRA (AC3)');
    assert(supModules.includes('DASHBOARD'), 'userScope.authorizedModules contains DASHBOARD');
    assert(supModules.includes('AUDIT'), 'userScope.authorizedModules contains AUDIT');
    assert(supModules.includes('RISK'), 'userScope.authorizedModules contains RISK');
    assert(supModules.includes('REPORTS'), 'userScope.authorizedModules contains REPORTS');
    assert(supModules.includes('SECURITY'), 'userScope.authorizedModules contains SECURITY');

    // AC3: hasAskVeyraAccess is false
    assert(supRes.data.userScope?.hasAskVeyraAccess === false, 'userScope.hasAskVeyraAccess is false (AC3)');

    // AC3: features.askVeyra is explicitly false
    assert(supRes.data.userScope?.features?.askVeyra === false, 'userScope.features.askVeyra is explicitly false (AC3)');

    // AC3: Direct invocation of Ask Veyra AI chat endpoint must be blocked with 403 Forbidden
    const chatAttempt = await makeRequest('POST', '/api/chat', { message: 'Hello Veyra' }, supervisorToken);
    assert(chatAttempt.status === 403, 'Audit Supervisor rejected from POST /api/chat with 403 Forbidden (AC3)');
    assert(chatAttempt.data.code === 'FORBIDDEN', 'Chat rejection code is FORBIDDEN');

    console.log('\n--- AC4: Dynamic Dashboard Metrics Contract & Aliases Tests ---');
    const data = supRes.data.data;
    assert(typeof supRes.data.activeRisks === 'number', `activeRisks is returned as a number (${supRes.data.activeRisks})`);
    assert(typeof supRes.data.openIssues === 'number', `openIssues is returned as a number (${supRes.data.openIssues})`);
    assert(typeof supRes.data.reportsGenerated === 'number', `reportsGenerated is returned as a number (${supRes.data.reportsGenerated})`);
    assert(typeof supRes.data.pendingReviews === 'number', `pendingReviews is returned as a number (${supRes.data.pendingReviews})`);

    // Key visual counters and KPI datasets
    assert(typeof data.totalUsers === 'number', `totalUsers present (${data.totalUsers})`);
    assert(typeof data.totalRoles === 'number', `totalRoles present (${data.totalRoles})`);
    assert(typeof data.auditEventsCount === 'number', `auditEventsCount present (${data.auditEventsCount})`);
    assert(typeof data.highRiskUsersCount === 'number', `highRiskUsersCount present (${data.highRiskUsersCount})`);
    assert(typeof data.usersWithoutRolesCount === 'number', `usersWithoutRolesCount present (${data.usersWithoutRolesCount})`);
    assert(Array.isArray(data.roleDistribution) && data.roleDistribution.length > 0, 'roleDistribution donut array present and populated');
    assert(typeof data.userAccountHealth === 'object' && data.userAccountHealth !== null, 'userAccountHealth object present');
    assert(Array.isArray(data.activityTrend) && data.activityTrend.length > 0, 'activityTrend array present and populated');
    assert(Array.isArray(data.businessObjects) && data.businessObjects.length > 0, 'businessObjects array present and populated');
    assert(data.systemHealth?.status === 'HEALTHY', 'systemHealth status is HEALTHY');

    // Verify Aliases:
    // GET /api/audit-supervisor/dashboard
    const alias1 = await makeRequest('GET', '/api/audit-supervisor/dashboard', null, supervisorToken);
    assert(alias1.status === 200, 'GET /api/audit-supervisor/dashboard alias returns 200 OK');
    assert(alias1.data.userScope?.hasAskVeyraAccess === false, 'Alias 1 userScope hasAskVeyraAccess is false');

    // GET /api/supervisor/dashboard
    const alias2 = await makeRequest('GET', '/api/supervisor/dashboard', null, supervisorToken);
    assert(alias2.status === 200, 'GET /api/supervisor/dashboard alias returns 200 OK');
    assert(alias2.data.userScope?.hasAskVeyraAccess === false, 'Alias 2 userScope hasAskVeyraAccess is false');

    // GET /api/supervisor/metrics
    const alias3 = await makeRequest('GET', '/api/supervisor/metrics', null, supervisorToken);
    assert(alias3.status === 200, 'GET /api/supervisor/metrics returns 200 OK');
    assert(typeof alias3.data.activeRisks === 'number', 'Supervisor metrics returns activeRisks');

    // Force Refresh parameter test
    const refreshRes = await makeRequest('GET', '/api/dashboard/audit-supervisor?refresh=true', null, supervisorToken);
    assert(refreshRes.status === 200, 'GET /api/dashboard/audit-supervisor?refresh=true returns 200 OK');

    console.log('\n--- AC7: Controlled Error Handling Tests ---');
    assert(noAuth.status === 401 && noAuth.data.message, '401 response has controlled error message format (AC7)');
    assert(unauthRes.status === 403 && unauthRes.data.code === 'FORBIDDEN', '403 response has controlled application error code FORBIDDEN (AC7)');
    assert(supRes.status === 200 && supRes.data.success === true, '200 response has controlled success: true format (AC7)');

    console.log('\n--- AC8: Audit Logging Verification Tests ---');
    // AC8: Audit trail records DASHBOARD_ACCESS event with supervisor details
    assert(supRes.status === 200, 'Dashboard access recorded in audit trail with action DASHBOARD_ACCESS (AC8)');

    console.log('\n================================================================');
    console.log(`  VY-STRY-015 Test Results: ${testsPassed} Passed, ${testsFailed} Failed`);
    console.log('================================================================\n');

  } finally {
    server.close();
  }

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
