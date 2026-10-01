const http = require('http');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 5099;
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
  console.log('  Story: VY-STRY-19: DB: Reports-Only User Access Verification');
  console.log('  Backend & Express Route Integration Test Suite');
  console.log('================================================================\n');

  process.env.PORT = String(TEST_PORT);
  process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES = '5';
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
  const distDb = path.join(__dirname, '../dist/db.js');
  const { query: dbQuery } = require(distDb);
  await dbQuery("UPDATE veyra_session SET status = 'EXPIRED' WHERE status = 'ACTIVE'").catch(() => {});
  authService._clearActiveSessions();

  const distReportDb = path.join(__dirname, '../dist/services/reportDbService.js');
  const { reportDbService } = require(distReportDb);

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
    // -------------------------------------------------------------------------
    // Setup Test Sessions & Verify RBAC Isolation
    // -------------------------------------------------------------------------
    console.log('--- Step 0: Authenticating Personas & Checking Privileges (AC1, AC2) ---');

    // 1. Audit User (Reports Only)
    const userLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'audit.user@claaps.com',
      password: 'Password@123'
    });
    const auditUserToken = userLogin.data.token;
    assert(userLogin.status === 200 && auditUserToken, 'Audit User logged in successfully');
    assert(userLogin.data.role === 'AUDIT_USER', 'Logged-in user has role AUDIT_USER');

    const permissions = userLogin.data.permissions || [];
    assert(permissions.includes('REPORTS'), 'Audit User is granted REPORTS privilege (AC1)');
    assert(
      !permissions.includes('ASK_VEYRA') &&
      !permissions.includes('USERS_LIST') &&
      !permissions.includes('ROLES_CATALOG') &&
      !permissions.includes('AUDIT_TRAIL') &&
      !permissions.includes('RISK_MANAGEMENT') &&
      !permissions.includes('USER_MANAGEMENT'),
      'Audit User does NOT inherit administrative/security privileges (AC2)'
    );

    // 2. Audit Supervisor
    const supLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'supervisor.user@claaps.com',
      password: 'Supervisor@123'
    });
    const supervisorToken = supLogin.data.token;
    assert(supLogin.status === 200 && supervisorToken, 'Audit Supervisor logged in successfully');

    // -------------------------------------------------------------------------
    // Test 1: Query Reports via DB Endpoint (AC3, AC4)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 1: Testing Report DB Retrieval (AC3, AC4) ---');
    const reportsRes = await makeRequest('GET', '/api/reports/db', null, auditUserToken);
    assert(reportsRes.status === 200 && reportsRes.data.success === true, 'GET /api/reports/db returns 200 OK for AUDIT_USER');
    assert(Array.isArray(reportsRes.data.reports) && reportsRes.data.reports.length > 0, 'Report records returned as structured array from PostgreSQL');
    assert(reportsRes.data.applicationScope === 'ORACLE_FUSION', 'Report query defaults to application scope ORACLE_FUSION');

    // -------------------------------------------------------------------------
    // Test 2: Single Report Lookup by ID (AC3)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 2: Testing Single Report Retrieval by ID ---');
    const firstReportId = reportsRes.data.reports[0].reportId;
    const detailRes = await makeRequest('GET', `/api/reports/db/${firstReportId}`, null, auditUserToken);
    assert(detailRes.status === 200 && detailRes.data.success === true, `GET /api/reports/db/${firstReportId} returns 200 OK`);
    assert(detailRes.data.report.reportId === firstReportId, 'Retrieved report has matching reportId');

    const notFoundRes = await makeRequest('GET', '/api/reports/db/non_existent_report_id_123', null, auditUserToken);
    assert(notFoundRes.status === 404, 'Non-existent report ID returns 404 NOT_FOUND');

    // -------------------------------------------------------------------------
    // Test 3: Reports-Only Dashboard DB Reports Alias
    // -------------------------------------------------------------------------
    console.log('\n--- Step 3: Testing Reports Dashboard DB Alias ---');
    const aliasRes = await makeRequest('GET', '/api/dashboard/reports-only/db/reports', null, auditUserToken);
    assert(aliasRes.status === 200 && aliasRes.data.success === true, 'GET /api/dashboard/reports-only/db/reports returns 200 OK');

    // -------------------------------------------------------------------------
    // Test 4: Existing Report Routes Remain Functional (AC1, AC4)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 4: Existing Report Routes Accessibility ---');
    const roleHierRes = await makeRequest('GET', '/api/reports/role-hierarchy', null, auditUserToken);
    assert(roleHierRes.status === 200, 'AUDIT_USER can access GET /api/reports/role-hierarchy with REPORTS privilege');

    const userAccRes = await makeRequest('GET', '/api/reports/user-access', null, auditUserToken);
    assert(userAccRes.status === 200, 'AUDIT_USER can access GET /api/reports/user-access with REPORTS privilege');

    // -------------------------------------------------------------------------
    // Test 5: Scope Enforcement and Tampering Resistance (AC4)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 5: Scope Parameter Tampering Resistance (AC4) ---');
    const tamperedRes = await makeRequest(
      'GET',
      '/api/reports/db?applicationScope=UNAUTHORIZED_TENANT_XYZ',
      null,
      auditUserToken
    );
    assert(tamperedRes.status === 200, 'Tampered applicationScope parameter handled safely');
    assert(tamperedRes.data.applicationScope === 'ORACLE_FUSION', 'Tampered scope bounded strictly to authorized scope ORACLE_FUSION');
    if (tamperedRes.data.reports && tamperedRes.data.reports.length > 0) {
      const leaked = tamperedRes.data.reports.some(r => r.applicationScope === 'UNAUTHORIZED_TENANT_XYZ');
      assert(!leaked, 'Zero records leaked from unauthorized applicationScope');
    }

    // -------------------------------------------------------------------------
    // Test 6: AUDIT_USER is Blocked from Non-Report Endpoints (AC2)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 6: Authorization Boundary & Prohibited Endpoints (AC2) ---');

    const riskAttempt = await makeRequest('GET', '/api/dashboard/audit-supervisor/db/risk', null, auditUserToken);
    assert(riskAttempt.status === 403, 'AUDIT_USER is blocked (403 Forbidden) from risk metrics');

    const auditAttempt = await makeRequest('GET', '/api/dashboard/audit-supervisor/db/audit', null, auditUserToken);
    assert(auditAttempt.status === 403, 'AUDIT_USER is blocked (403 Forbidden) from audit metrics');

    const chatAttempt = await makeRequest('POST', '/api/chat', { message: 'hello' }, auditUserToken);
    assert(chatAttempt.status === 403, 'AUDIT_USER is blocked (403 Forbidden) from Ask Veyra chat');

    const usersAttempt = await makeRequest('GET', '/api/users', null, auditUserToken);
    assert(usersAttempt.status === 403, 'AUDIT_USER is blocked (403 Forbidden) from user directory');

    // Unauthenticated access
    const unauthAttempt = await makeRequest('GET', '/api/reports/db');
    assert(unauthAttempt.status === 401, 'Unauthenticated request is rejected (401 Unauthorized)');

    // -------------------------------------------------------------------------
    // Test 7: Direct Service Layer Scope & Authorization Checks
    // -------------------------------------------------------------------------
    console.log('\n--- Step 7: Direct Service Scope Resolution ---');
    const resolved = reportDbService.resolveAuthorizedScope(
      { userId: 'test-user', role: 'AUDIT_USER' },
      { applicationScope: 'MALICIOUS_APP' }
    );
    assert(resolved.applicationScope === 'ORACLE_FUSION', 'resolveAuthorizedScope bounds invalid applicationScope to ORACLE_FUSION');

    const validationGranted = reportDbService.validateReportAuthorization({
      userId: 'test-user',
      role: 'AUDIT_USER',
      permissions: ['REPORTS']
    });
    assert(validationGranted.authorized === true, 'validateReportAuthorization grants AUDIT_USER with REPORTS');

    const validationDenied = reportDbService.validateReportAuthorization({
      userId: 'viewer-user',
      role: 'VIEWER',
      permissions: ['SOME_OTHER_PRIV']
    });
    assert(validationDenied.authorized === false, 'validateReportAuthorization denies role without REPORTS privilege');

  } catch (err) {
    console.error('Test Suite encountered an error:', err);
    testsFailed++;
  } finally {
    await new Promise(resolve => server.close(resolve));
    console.log('\n[Test Server] Shut down gracefully.');
  }

  console.log('\n================================================================');
  console.log(`  Summary: ${testsPassed} passed, ${testsFailed} failed.`);
  if (testsFailed === 0) {
    console.log('  🎉 All Story VY-STRY-19 Backend Integration Tests Passed!');
  }
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
