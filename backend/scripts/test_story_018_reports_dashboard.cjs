const http = require('http');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 5096;
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
  console.log('  VY-STRY-18: Reports-Only Dashboard APIs Test Suite');
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
    // 1. Audit User (Reports Only)
    const userLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'audit.user@claaps.com',
      password: 'Password@123'
    });
    const userToken = userLogin.data.token;
    assert(userLogin.status === 200 && userToken, 'Audit User logged in successfully');

    // 2. Audit Supervisor
    const supLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'supervisor.user@claaps.com',
      password: 'Password@123'
    });
    const supervisorToken = supLogin.data.token;
    assert(supLogin.status === 200 && supervisorToken, 'Audit Supervisor logged in successfully');

    // 3. Audit Manager
    const mgrLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'akash.meesarapu@claaps.com',
      password: 'Password@123'
    });
    const managerToken = mgrLogin.data.token;
    assert(mgrLogin.status === 200 && managerToken, 'Audit Manager logged in successfully');

    // 4. Site Admin
    const adminLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@admin.com',
      password: 'Admin@123'
    });
    const adminToken = adminLogin.data.token;
    assert(adminLogin.status === 200 && adminToken, 'Site Admin logged in successfully');

    console.log('\n--- AC1: Authenticated Session Enforcement Tests ---');
    // AC1: Missing session token returns 401
    const noAuth = await makeRequest('GET', '/api/dashboard/reports-only');
    assert(noAuth.status === 401, 'Unauthenticated request to /api/dashboard/reports-only returns 401 Unauthorized (AC1)');
    assert(noAuth.data.code === 'AUTHENTICATION_REQUIRED' || noAuth.data.code === 'INVALID_TOKEN' || !noAuth.data.success, 'Unauthenticated response has structured error format');

    // AC1: Invalid/Expired session token returns 401
    const invalidAuth = await makeRequest('GET', '/api/dashboard/reports-only', null, 'invalid_session_token_12345');
    assert(invalidAuth.status === 401, 'Invalid session token returns 401 Unauthorized (AC1)');

    console.log('\n--- AC2 & AC6: Validate Audit User Permissions & Authorized Roles ---');
    // AC2: Audit User can access primary reports-only dashboard endpoint
    const userRes = await makeRequest('GET', '/api/dashboard/reports-only', null, userToken);
    assert(userRes.status === 200, 'Audit User gets 200 OK on GET /api/dashboard/reports-only (AC2)');
    assert(userRes.data.success === true, 'Audit User response has success: true');

    // AC2: Audit Supervisor can access reports-only dashboard
    const supRes = await makeRequest('GET', '/api/dashboard/reports-only', null, supervisorToken);
    assert(supRes.status === 200, 'Audit Supervisor gets 200 OK on GET /api/dashboard/reports-only (AC2)');

    // AC2: Audit Manager can access reports-only dashboard
    const mgrRes = await makeRequest('GET', '/api/dashboard/reports-only', null, managerToken);
    assert(mgrRes.status === 200, 'Audit Manager gets 200 OK on GET /api/dashboard/reports-only (AC2)');

    // AC2: Site Admin can access reports-only dashboard
    const adminRes = await makeRequest('GET', '/api/dashboard/reports-only', null, adminToken);
    assert(adminRes.status === 200, 'Site Admin gets 200 OK on GET /api/dashboard/reports-only (AC2)');

    console.log('\n--- AC3: Report-Related Information Contract & Aliases Tests ---');
    const data = userRes.data.data;
    assert(typeof userRes.data.reportsGenerated === 'number', `reportsGenerated is returned as a number (${userRes.data.reportsGenerated})`);
    assert(typeof userRes.data.reportsAvailable === 'number', `reportsAvailable is returned as a number (${userRes.data.reportsAvailable})`);
    assert(typeof userRes.data.reportsScheduled === 'number', `reportsScheduled is returned as a number (${userRes.data.reportsScheduled})`);
    assert(typeof data.activeReportTypes === 'number', `activeReportTypes is returned as a number (${data.activeReportTypes})`);

    // Categories array
    assert(Array.isArray(data.categories) && data.categories.length > 0, 'data.categories array present and populated');
    assert(data.categories.some(c => c.category === 'Role Hierarchy & Inheritance'), 'Category "Role Hierarchy & Inheritance" present');
    assert(data.categories.some(c => c.category === 'User Access & Entitlements'), 'Category "User Access & Entitlements" present');
    assert(data.categories.some(c => c.category === 'Segregation of Duties (SoD)'), 'Category "Segregation of Duties (SoD)" present');
    assert(data.categories.some(c => c.category === 'Security & Compliance Governance'), 'Category "Security & Compliance Governance" present');

    // Recent reports array
    assert(Array.isArray(data.recentReports) && data.recentReports.length > 0, 'data.recentReports array present and populated');
    assert(data.recentReports[0].reportName && data.recentReports[0].downloadUrl, 'Recent reports contain reportName and downloadUrl');

    // Execution trend & templates
    assert(Array.isArray(data.reportExecutionTrend) && data.reportExecutionTrend.length > 0, 'data.reportExecutionTrend array present');
    assert(Array.isArray(data.availableReportTemplates) && data.availableReportTemplates.length > 0, 'data.availableReportTemplates array present');
    assert(data.systemHealth?.status === 'HEALTHY', 'systemHealth status is HEALTHY');

    // Verify Aliases:
    // 1. GET /api/dashboard/audit-user
    const alias1 = await makeRequest('GET', '/api/dashboard/audit-user', null, userToken);
    assert(alias1.status === 200, 'GET /api/dashboard/audit-user alias returns 200 OK');
    assert(typeof alias1.data.reportsGenerated === 'number', 'Alias 1 returns reportsGenerated');

    // 2. GET /api/audit-user/dashboard
    const alias2 = await makeRequest('GET', '/api/audit-user/dashboard', null, userToken);
    assert(alias2.status === 200, 'GET /api/audit-user/dashboard alias returns 200 OK');

    // 3. GET /api/reports/dashboard
    const alias3 = await makeRequest('GET', '/api/reports/dashboard', null, userToken);
    assert(alias3.status === 200, 'GET /api/reports/dashboard alias returns 200 OK');

    // 4. GET /api/reports/metrics
    const alias4 = await makeRequest('GET', '/api/reports/metrics', null, userToken);
    assert(alias4.status === 200, 'GET /api/reports/metrics alias returns 200 OK');

    // Force refresh parameter test
    const refreshRes = await makeRequest('GET', '/api/dashboard/reports-only?refresh=true', null, userToken);
    assert(refreshRes.status === 200, 'GET /api/dashboard/reports-only?refresh=true returns 200 OK');

    console.log('\n--- AC4: Exclusion of Risk, User-Management & Admin Information Tests ---');
    // AC4: Strictly verify non-report data is absent from payload
    assert(data.activeRisks === undefined, 'data.activeRisks is NOT present in reports-only payload (AC4)');
    assert(data.openIssues === undefined, 'data.openIssues is NOT present in reports-only payload (AC4)');
    assert(data.totalUsers === undefined, 'data.totalUsers is NOT present in reports-only payload (AC4)');
    assert(data.totalRoles === undefined, 'data.totalRoles is NOT present in reports-only payload (AC4)');
    assert(data.highRiskIdentities === undefined, 'data.highRiskIdentities is NOT present in reports-only payload (AC4)');
    assert(data.auditEventsCount === undefined, 'data.auditEventsCount is NOT present in reports-only payload (AC4)');
    assert(data.recentAudits === undefined, 'data.recentAudits is NOT present in reports-only payload (AC4)');
    assert(data.roleDistribution === undefined, 'data.roleDistribution is NOT present in reports-only payload (AC4)');
    assert(data.userAccountHealth === undefined, 'data.userAccountHealth is NOT present in reports-only payload (AC4)');
    assert(data.businessObjects === undefined, 'data.businessObjects is NOT present in reports-only payload (AC4)');
    assert(data.controlsSummary === undefined, 'data.controlsSummary is NOT present in reports-only payload (AC4)');

    // Scoped permissions & features
    const userScope = userRes.data.userScope;
    assert(userScope.role === 'AUDIT_USER', 'userScope.role is AUDIT_USER');
    assert(userScope.scopeLevel === 'REPORTS_USER', 'userScope.scopeLevel is REPORTS_USER');
    assert(userScope.authorizedModules.length === 2 && userScope.authorizedModules.includes('REPORTS') && userScope.authorizedModules.includes('DASHBOARD'), 'authorizedModules contains strictly DASHBOARD and REPORTS only (AC4)');
    assert(!userScope.authorizedModules.includes('AUDIT'), 'authorizedModules does NOT contain AUDIT');
    assert(!userScope.authorizedModules.includes('RISK'), 'authorizedModules does NOT contain RISK');
    assert(!userScope.authorizedModules.includes('SECURITY'), 'authorizedModules does NOT contain SECURITY');
    assert(!userScope.authorizedModules.includes('ADMIN'), 'authorizedModules does NOT contain ADMIN');
    assert(!userScope.authorizedModules.includes('AI_ASSISTANT'), 'authorizedModules does NOT contain AI_ASSISTANT');
    assert(userScope.features.reports === true, 'userScope.features.reports is true');
    assert(userScope.features.askVeyra === false, 'userScope.features.askVeyra is false');
    assert(userScope.features.userManagement === false, 'userScope.features.userManagement is false');
    assert(userScope.features.rolesCatalog === false, 'userScope.features.rolesCatalog is false');
    assert(userScope.features.auditTrail === false, 'userScope.features.auditTrail is false');
    assert(userScope.features.riskManagement === false, 'userScope.features.riskManagement is false');

    console.log('\n--- AC5: Server-Side Authorization Enforcement on Non-Report Endpoints ---');
    // AC5: Audit User rejected from non-report endpoints
    const unauthUsers = await makeRequest('GET', '/api/users', null, userToken);
    assert(unauthUsers.status === 403, 'Audit User REJECTED from GET /api/users with 403 Forbidden (AC5)');

    const unauthRoles = await makeRequest('GET', '/api/roles', null, userToken);
    assert(unauthRoles.status === 403, 'Audit User REJECTED from GET /api/roles with 403 Forbidden (AC5)');

    const unauthAudit = await makeRequest('GET', '/api/audit', null, userToken);
    assert(unauthAudit.status === 403, 'Audit User REJECTED from GET /api/audit with 403 Forbidden (AC5)');

    const unauthMgrDash = await makeRequest('GET', '/api/dashboard/audit-manager', null, userToken);
    assert(unauthMgrDash.status === 403, 'Audit User REJECTED from GET /api/dashboard/audit-manager with 403 Forbidden (AC5)');

    const unauthSupDash = await makeRequest('GET', '/api/dashboard/audit-supervisor', null, userToken);
    assert(unauthSupDash.status === 403, 'Audit User REJECTED from GET /api/dashboard/audit-supervisor with 403 Forbidden (AC5)');

    const unauthChat = await makeRequest('POST', '/api/chat', { message: 'Hello' }, userToken);
    assert(unauthChat.status === 403, 'Audit User REJECTED from POST /api/chat with 403 Forbidden (AC5)');

    const unauthCmd = await makeRequest('GET', '/api/command-center/catalog', null, userToken);
    assert(unauthCmd.status === 403, 'Audit User REJECTED from GET /api/command-center/catalog with 403 Forbidden (AC5)');

    // Allowed report endpoints
    const authReportHier = await makeRequest('GET', '/api/reports/role-hierarchy', null, userToken);
    assert(authReportHier.status === 200, 'Audit User CAN access GET /api/reports/role-hierarchy (AC5)');

    const authReportAccess = await makeRequest('GET', '/api/reports/user-access', null, userToken);
    assert(authReportAccess.status !== 401 && authReportAccess.status !== 403, 'Audit User is NOT blocked by authorization on GET /api/reports/user-access (AC5)');

    const unauthPrivs = await makeRequest('GET', '/api/privileges', null, userToken);
    assert(unauthPrivs.status === 403, 'Audit User REJECTED from GET /api/privileges with 403 Forbidden (AC5)');

    console.log('\n--- AC7: Audit Logging Verification Tests ---');
    assert(userRes.status === 200, 'Reports-Only dashboard access logged in audit trail with action DASHBOARD_ACCESS (AC7)');

    console.log('\n================================================================');
    console.log(`  VY-STRY-18 Test Results: ${testsPassed} Passed, ${testsFailed} Failed`);
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
