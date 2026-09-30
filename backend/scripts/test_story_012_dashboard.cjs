const http = require('http');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 5098;
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
  console.log('  VY-STRY-012: Audit Manager Dashboard APIs Test Suite');
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

  function assert(condition, message, extra = null) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      testsPassed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      if (extra) console.error(`         Details: status=${extra.status}, data=`, extra.data);
      testsFailed++;
    }
  }

  try {
    // ------------------------------------------------------------------------
    // Step 1: Login Seed Personas
    // ------------------------------------------------------------------------
    console.log('--- Step 1: Authenticate Personas ---');
    
    // Site Admin
    const adminLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@admin.com',
      password: 'Admin@123'
    });
    assert(adminLogin.status === 200 && adminLogin.data.token, 'Site Admin logged in successfully', adminLogin);
    const adminToken = adminLogin.data.token;

    // Audit Manager
    const managerLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'akash.meesarapu@claaps.com',
      password: 'Password@123'
    });
    assert(managerLogin.status === 200 && managerLogin.data.token, 'Audit Manager logged in successfully', managerLogin);
    const managerToken = managerLogin.data.token;

    // Audit Supervisor
    const supervisorLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'supervisor.user@claaps.com',
      password: 'Password@123'
    });
    assert(supervisorLogin.status === 200 && supervisorLogin.data.token, 'Audit Supervisor logged in successfully', supervisorLogin);
    const supervisorToken = supervisorLogin.data.token;

    // Create and login a verified Security Analyst
    const analystEmail = `analyst_${Date.now()}@claaps.com`;
    const createAnalystRes = await makeRequest('POST', '/api/users', {
      email: analystEmail,
      displayName: 'Test Security Analyst',
      role: 'SECURITY_ANALYST',
      password: 'Password@123',
      status: 'ACTIVE'
    }, adminToken);
    assert(createAnalystRes.status === 201, 'Created Security Analyst account', createAnalystRes);

    const analystLogin = await makeRequest('POST', '/api/auth/login', {
      email: analystEmail,
      password: 'Password@123'
    });
    assert(analystLogin.status === 200 && analystLogin.data.token, 'Security Analyst logged in successfully', analystLogin);
    const analystToken = analystLogin.data.token;

    // Audit User (Reports only)
    const auditUserLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'audit.user@claaps.com',
      password: 'Password@123'
    });
    assert(auditUserLogin.status === 200 && auditUserLogin.data.token, 'Audit User logged in successfully', auditUserLogin);
    const auditUserToken = auditUserLogin.data.token;

    // ------------------------------------------------------------------------
    // AC1: Authentication (Require Active VEYRA Session)
    // ------------------------------------------------------------------------
    console.log('\n--- AC1: Authentication Tests ---');

    // 1.1: Unauthenticated GET /api/dashboard/audit-manager returns 401
    const noAuthRes = await makeRequest('GET', '/api/dashboard/audit-manager');
    assert(noAuthRes.status === 401 && noAuthRes.data.success === false, 'GET /api/dashboard/audit-manager without token returns 401 Unauthorized', noAuthRes);

    // 1.2: Invalid Token GET /api/dashboard/metrics returns 401
    const invalidTokenRes = await makeRequest('GET', '/api/dashboard/metrics', null, 'invalid-bearer-token-12345');
    assert(invalidTokenRes.status === 401 && invalidTokenRes.data.success === false, 'GET /api/dashboard/metrics with invalid token returns 401 Unauthorized', invalidTokenRes);

    // 1.3: Unauthenticated GET /api/overview/stats returns 401
    const noAuthOverviewRes = await makeRequest('GET', '/api/overview/stats');
    assert(noAuthOverviewRes.status === 401 && noAuthOverviewRes.data.success === false, 'GET /api/overview/stats without token returns 401 Unauthorized', noAuthOverviewRes);

    // ------------------------------------------------------------------------
    // AC2: Authorization (Role / Privilege Verification & UI Navigation Bypass Prevention)
    // ------------------------------------------------------------------------
    console.log('\n--- AC2: Authorization & RBAC Enforcement Tests ---');

    // 2.1: Audit User (unauthorized) attempting to access Audit Manager dashboard gets 403 FORBIDDEN
    const auditUserBlocked = await makeRequest('GET', '/api/dashboard/audit-manager', null, auditUserToken);
    assert(auditUserBlocked.status === 403 && auditUserBlocked.data.code === 'FORBIDDEN', 'Audit User is blocked from GET /api/dashboard/audit-manager with 403 FORBIDDEN', auditUserBlocked);

    // 2.2: Audit User attempting GET /api/overview/stats gets 403 FORBIDDEN
    const auditUserOverviewBlocked = await makeRequest('GET', '/api/overview/stats', null, auditUserToken);
    assert(auditUserOverviewBlocked.status === 403 && auditUserOverviewBlocked.data.code === 'FORBIDDEN', 'Audit User is blocked from GET /api/overview/stats with 403 FORBIDDEN', auditUserOverviewBlocked);

    // 2.3: Audit Manager gets 200 OK on GET /api/dashboard/audit-manager
    const managerDashRes = await makeRequest('GET', '/api/dashboard/audit-manager', null, managerToken);
    assert(managerDashRes.status === 200 && managerDashRes.data.success === true, 'Audit Manager gets 200 OK on GET /api/dashboard/audit-manager', managerDashRes);

    // 2.4: Site Admin gets 200 OK on GET /api/dashboard/audit-manager
    const adminDashRes = await makeRequest('GET', '/api/dashboard/audit-manager', null, adminToken);
    assert(adminDashRes.status === 200 && adminDashRes.data.success === true, 'Site Admin gets 200 OK on GET /api/dashboard/audit-manager', adminDashRes);

    // 2.5: Security Analyst gets 200 OK on GET /api/dashboard/metrics
    const analystMetricsRes = await makeRequest('GET', '/api/dashboard/metrics', null, analystToken);
    assert(analystMetricsRes.status === 200 && analystMetricsRes.data.success === true, 'Security Analyst gets 200 OK on GET /api/dashboard/metrics', analystMetricsRes);

    // ------------------------------------------------------------------------
    // AC3: Dashboard Metrics Contract Verification
    // ------------------------------------------------------------------------
    console.log('\n--- AC3: Dashboard Metrics Contract Tests ---');

    const metricsData = managerDashRes.data;

    // AC3 Example fields: activeRisks, openIssues, reportsGenerated, pendingReviews
    assert(typeof metricsData.activeRisks === 'number' && metricsData.activeRisks >= 0, `activeRisks is returned as a number (${metricsData.activeRisks})`);
    assert(typeof metricsData.openIssues === 'number' && metricsData.openIssues >= 0, `openIssues is returned as a number (${metricsData.openIssues})`);
    assert(typeof metricsData.reportsGenerated === 'number' && metricsData.reportsGenerated >= 0, `reportsGenerated is returned as a number (${metricsData.reportsGenerated})`);
    assert(typeof metricsData.pendingReviews === 'number' && metricsData.pendingReviews >= 0, `pendingReviews is returned as a number (${metricsData.pendingReviews})`);

    // Comprehensive detail metrics
    assert(typeof metricsData.data.totalUsers === 'number' && metricsData.data.totalUsers > 0, `totalUsers present (${metricsData.data.totalUsers})`);
    assert(typeof metricsData.data.totalRoles === 'number' && metricsData.data.totalRoles > 0, `totalRoles present (${metricsData.data.totalRoles})`);
    assert(typeof metricsData.data.auditEventsCount === 'number' && metricsData.data.auditEventsCount >= 0, `auditEventsCount present (${metricsData.data.auditEventsCount})`);
    assert(typeof metricsData.data.highRiskUsersCount === 'number' && metricsData.data.highRiskUsersCount >= 0, `highRiskUsersCount present (${metricsData.data.highRiskUsersCount})`);
    assert(typeof metricsData.data.usersWithoutRolesCount === 'number' && metricsData.data.usersWithoutRolesCount >= 0, `usersWithoutRolesCount present (${metricsData.data.usersWithoutRolesCount})`);

    // Array / Object structures
    assert(Array.isArray(metricsData.data.roleDistribution) && metricsData.data.roleDistribution.length > 0, 'roleDistribution donut array present and populated');
    assert(typeof metricsData.data.userAccountHealth === 'object' && metricsData.data.userAccountHealth !== null, 'userAccountHealth object present');
    assert(Array.isArray(metricsData.data.activityTrend) && metricsData.data.activityTrend.length > 0, 'activityTrend array present and populated');
    assert(Array.isArray(metricsData.data.businessObjects) && metricsData.data.businessObjects.length > 0, 'businessObjects array present and populated');
    assert(typeof metricsData.data.systemHealth === 'object' && metricsData.data.systemHealth.status === 'HEALTHY', 'systemHealth status is HEALTHY');

    // Test standard alias: GET /api/audit-manager/dashboard
    const aliasRes = await makeRequest('GET', '/api/audit-manager/dashboard', null, managerToken);
    assert(aliasRes.status === 200 && aliasRes.data.activeRisks === metricsData.activeRisks, 'GET /api/audit-manager/dashboard alias returns identical metrics', aliasRes);

    // Test Frontend compatibility endpoint: GET /api/overview/stats
    const overviewRes = await makeRequest('GET', '/api/overview/stats', null, managerToken);
    assert(overviewRes.status === 200 && overviewRes.data.data.auditEventsCount !== undefined, 'GET /api/overview/stats returns full metrics object for frontend Dashboard.tsx', overviewRes);

    // ------------------------------------------------------------------------
    // AC4: User-Specific Authorization & Scoping Tests
    // ------------------------------------------------------------------------
    console.log('\n--- AC4: User-Specific Authorization & Scoping Tests ---');

    // Check manager userScope
    const managerScope = managerDashRes.data.userScope;
    assert(managerScope.role === 'AUDIT_MANAGER', 'userScope contains correct user role AUDIT_MANAGER');
    assert(managerScope.scopeLevel === 'EXECUTIVE_AUDIT_MANAGER', 'userScope contains correct scopeLevel EXECUTIVE_AUDIT_MANAGER');
    assert(Array.isArray(managerScope.authorizedModules) && managerScope.authorizedModules.includes('AUDIT') && managerScope.authorizedModules.includes('RISK'), 'userScope authorizedModules contains AUDIT and RISK');

    // Check admin userScope
    const adminScope = adminDashRes.data.userScope;
    assert(adminScope.role === 'SITE_ADMIN', 'userScope contains correct user role SITE_ADMIN');
    assert(adminScope.scopeLevel === 'ENTERPRISE_ADMINISTRATOR', 'userScope contains ENTERPRISE_ADMINISTRATOR');
    assert(adminScope.authorizedModules.includes('ADMIN'), 'Site Admin userScope includes ADMIN module');

    // ------------------------------------------------------------------------
    // AC5: Audit Logging Tests
    // ------------------------------------------------------------------------
    console.log('\n--- AC5: Audit Logging Verification Tests ---');

    const auditLogPath = path.join(__dirname, '../oracle_audit.log');
    let auditLogContent = '';
    if (fs.existsSync(auditLogPath)) {
      auditLogContent = fs.readFileSync(auditLogPath, 'utf8');
    }
    const hasAuditEntry = auditLogContent.includes('DASHBOARD_ACCESS') && auditLogContent.includes('akash.meesarapu@claaps.com');
    assert(hasAuditEntry, 'Dashboard access recorded in audit trail with action DASHBOARD_ACCESS and user email (AC5)');

    // ------------------------------------------------------------------------
    // AC6: Error Handling & Status Codes Tests
    // ------------------------------------------------------------------------
    console.log('\n--- AC6: Controlled Error Handling Tests ---');

    // Verify 401 code format
    assert(noAuthRes.status === 401 && (noAuthRes.data.message || noAuthRes.data.code), '401 response has controlled error message format');
    // Verify 403 code format
    assert(auditUserBlocked.status === 403 && auditUserBlocked.data.code === 'FORBIDDEN', '403 response has controlled application error code FORBIDDEN');
    // Verify 200 code format
    assert(managerDashRes.status === 200 && managerDashRes.data.success === true, '200 response has controlled success: true format');

    // Clean up temporary test user
    await makeRequest('DELETE', `/api/users/${analystEmail}`, null, adminToken);

    console.log('\n================================================================');
    console.log(`  VY-STRY-012 Test Results: ${testsPassed} Passed, ${testsFailed} Failed`);
    console.log('================================================================\n');

    if (testsFailed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution encountered uncaught error:', err);
    process.exit(1);
  } finally {
    server.close();
  }
}

runTests();
