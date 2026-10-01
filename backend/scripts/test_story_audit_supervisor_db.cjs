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
  console.log('  Story: DB: Support Audit Supervisor Dashboard Data & Auth');
  console.log('  Backend Service & Express Route Verification Suite');
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

  const distDbService = path.join(__dirname, '../dist/services/supervisorDashboardDbService.js');
  const { supervisorDashboardDbService } = require(distDbService);

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
    // Setup Test Sessions
    // -------------------------------------------------------------------------
    console.log('--- Step 0: Authenticating Test Personas ---');
    let supLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'supervisor.user@claaps.com',
      password: 'Supervisor@123'
    });
    if (supLogin.status !== 200) {
      supLogin = await makeRequest('POST', '/api/auth/login', {
        email: 'supervisor.user@claaps.com',
        password: 'Password@123'
      });
    }
    const supervisorToken = supLogin.data.token;
    assert(supLogin.status === 200 && supervisorToken, 'Audit Supervisor logged in successfully');

    const adminLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@admin.com',
      password: 'Admin@123'
    });
    const adminToken = adminLogin.data.token;
    assert(adminLogin.status === 200 && adminToken, 'Site Admin logged in successfully');

    const userLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'audit.user@claaps.com',
      password: 'Password@123'
    });
    const auditUserToken = userLogin.data.token;
    assert(userLogin.status === 200 && auditUserToken, 'Audit User (non-supervisor) logged in successfully');

    // -------------------------------------------------------------------------
    // Test 1: Query Risk Data via DB Endpoint (AC1)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 1: Testing Risk Data DB Queries (AC1) ---');
    const riskRes = await makeRequest('GET', '/api/dashboard/audit-supervisor/db/risk', null, supervisorToken);
    assert(riskRes.status === 200 && riskRes.data.success === true, 'GET /dashboard/audit-supervisor/db/risk returns 200 OK');
    assert(Array.isArray(riskRes.data.data), 'Risk metrics returned as structured array');

    // -------------------------------------------------------------------------
    // Test 2: Query Report Data via DB Endpoint (AC1)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 2: Testing Report Data DB Queries (AC1) ---');
    const reportsRes = await makeRequest('GET', '/api/dashboard/audit-supervisor/db/reports', null, supervisorToken);
    assert(reportsRes.status === 200 && reportsRes.data.success === true, 'GET /dashboard/audit-supervisor/db/reports returns 200 OK');
    assert(Array.isArray(reportsRes.data.data), 'Report metrics returned as structured array');

    // -------------------------------------------------------------------------
    // Test 3: Query Audit Data via DB Endpoint (AC1)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 3: Testing Audit Data DB Queries (AC1) ---');
    const auditRes = await makeRequest('GET', '/api/dashboard/audit-supervisor/db/audit', null, supervisorToken);
    assert(auditRes.status === 200 && auditRes.data.success === true, 'GET /dashboard/audit-supervisor/db/audit returns 200 OK');
    assert(Array.isArray(auditRes.data.data), 'Audit metrics returned as structured array');

    const auditEventsRes = await makeRequest('GET', '/api/dashboard/audit-supervisor/db/audit-events?limit=5', null, supervisorToken);
    assert(auditEventsRes.status === 200 && auditEventsRes.data.success === true, 'GET /dashboard/audit-supervisor/db/audit-events returns 200 OK');
    assert(Array.isArray(auditEventsRes.data.data), 'Audit events trail returned as structured array');

    // -------------------------------------------------------------------------
    // Test 4: Consolidated Summary DB Query (AC1, AC2)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 4: Testing Consolidated DB Summary Endpoint ---');
    const summaryRes = await makeRequest('GET', '/api/dashboard/audit-supervisor/db/summary', null, supervisorToken);
    assert(summaryRes.status === 200 && summaryRes.data.success === true, 'GET /dashboard/audit-supervisor/db/summary returns 200 OK');
    assert(typeof summaryRes.data.activeRisks === 'number', 'Summary contains activeRisks metric');
    assert(typeof summaryRes.data.reportsGenerated === 'number', 'Summary contains reportsGenerated metric');
    assert(summaryRes.data.applicationScope === 'ORACLE_FUSION', 'Summary application scope defaults to ORACLE_FUSION');

    // -------------------------------------------------------------------------
    // Test 5: Scope Enforcement and Tampering Resistance (AC2, AC3)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 5: Scope Enforcement & Tampering Resistance (AC2, AC3) ---');
    // Attempt to tamper with scope parameter to request an unauthorized tenant/application
    const tamperedRes = await makeRequest(
      'GET',
      '/api/dashboard/audit-supervisor/db/risk?applicationScope=UNAUTHORIZED_TENANT',
      null,
      supervisorToken
    );
    assert(tamperedRes.status === 200, 'Tampered scope request handled securely without crashing');
    // Should fallback to default authorized scope ORACLE_FUSION and return no unauthorized data
    if (tamperedRes.data.data.length > 0) {
      const anyUnauthorized = tamperedRes.data.data.some(d => d.applicationScope === 'UNAUTHORIZED_TENANT');
      assert(!anyUnauthorized, 'Tampered scope UNAUTHORIZED_TENANT is rejected and never leaks data');
    } else {
      assert(true, 'Tampered scope returned zero data');
    }

    // -------------------------------------------------------------------------
    // Test 6: Audit User (unauthorized role) Forbidden from Risk/Audit (AC3)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 6: Role Authorization Boundary (AC3) ---');
    const auditUserRisk = await makeRequest('GET', '/api/dashboard/audit-supervisor/db/risk', null, auditUserToken);
    assert(auditUserRisk.status === 403, 'AUDIT_USER is blocked with 403 FORBIDDEN when attempting to access risk DB query');

    const auditUserAudit = await makeRequest('GET', '/api/dashboard/audit-supervisor/db/audit', null, auditUserToken);
    assert(auditUserAudit.status === 403, 'AUDIT_USER is blocked with 403 FORBIDDEN when attempting to access audit DB query');

    const unauthReq = await makeRequest('GET', '/api/dashboard/audit-supervisor/db/summary');
    assert(unauthReq.status === 401, 'Unauthenticated request is rejected with 401 UNAUTHORIZED');

    // -------------------------------------------------------------------------
    // Test 7: Historical Metric Snapshot Access for Audit Supervisor
    // -------------------------------------------------------------------------
    console.log('\n--- Step 7: Historical Metric Snapshots Access ---');
    const historyRes = await makeRequest('GET', '/api/dashboard/history?metricKey=ACTIVE_RISKS', null, supervisorToken);
    assert(historyRes.status === 200 && historyRes.data.success === true, 'Audit Supervisor can query /api/dashboard/history');

    // -------------------------------------------------------------------------
    // Test 8: Empty Result Sets Handled Gracefully
    // -------------------------------------------------------------------------
    console.log('\n--- Step 8: Empty Result Sets Handling ---');
    const emptyEvents = await makeRequest(
      'GET',
      '/api/dashboard/audit-supervisor/db/audit-events?eventType=NON_EXISTENT_TYPE_XYZ',
      null,
      supervisorToken
    );
    assert(emptyEvents.status === 200 && emptyEvents.data.count === 0, 'Non-existent filter returns 200 OK with count 0 and empty array');

    // -------------------------------------------------------------------------
    // Test 9: Direct Service Scope Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Step 9: Direct Service Scope Verification ---');
    const resolved = supervisorDashboardDbService.resolveAuthorizedScope(
      { userId: 'test-user-id', role: 'AUDIT_SUPERVISOR' },
      { applicationScope: 'HACKED_APP' }
    );
    assert(resolved.applicationScope === 'ORACLE_FUSION', 'resolveAuthorizedScope bounds invalid applicationScope to ORACLE_FUSION');

    const validationDenied = supervisorDashboardDbService.validateSupervisorAuthorization(
      { userId: 'user-id', role: 'AUDIT_USER' },
      'RISK'
    );
    assert(validationDenied.authorized === false, 'validateSupervisorAuthorization denies AUDIT_USER for RISK module');

    const validationGranted = supervisorDashboardDbService.validateSupervisorAuthorization(
      { userId: 'sup-id', role: 'AUDIT_SUPERVISOR' },
      'RISK'
    );
    assert(validationGranted.authorized === true, 'validateSupervisorAuthorization grants AUDIT_SUPERVISOR for RISK module');

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
    console.log('  🎉 All Audit Supervisor Backend & DB Integration Tests Passed!');
  }
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
