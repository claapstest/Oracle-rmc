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
  console.log('  VY-STRY-013: Dashboard Metrics DB & Service Integration Test');
  console.log('================================================================\n');

  process.env.PORT = String(TEST_PORT);
  process.env.NODE_ENV = 'test';

  const express = require('express');
  const cors = require('cors');

  const distApi = path.join(__dirname, '../dist/routes/api.js');
  const distAuth = path.join(__dirname, '../dist/services/authService.js');
  const distDash = path.join(__dirname, '../dist/services/auditDashboardService.js');

  const { apiRouter } = require(distApi);
  const { authService } = require(distAuth);
  const { auditDashboardService } = require(distDash);

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
      console.log(`  ✅ [PASS] ${message}`);
      testsPassed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      if (extra) console.error(`         Details: status=${extra.status}, data=`, extra.data);
      testsFailed++;
    }
  }

  try {
    // ------------------------------------------------------------------------
    // Part 1: Service-level direct testing
    // ------------------------------------------------------------------------
    console.log('--- Part 1: Service-level Metric Snapshot & Retrieval ---');

    // 1.1: Record a metric snapshot
    const testKey = `STORY13_TEST_METRIC_${Date.now()}`;
    await auditDashboardService.recordMetricSnapshot({
      metricKey: testKey,
      metricValue: 42.5,
      metricType: 'GAUGE',
      scopeType: 'GLOBAL',
      source: 'VEYRA_POSTGRES',
      isMock: false
    });
    assert(true, 'Service recordMetricSnapshot executed successfully');

    // 1.2: Retrieve latest metric snapshot
    const latest = await auditDashboardService.getLatestMetricSnapshot(testKey, 'GLOBAL', null, false);
    assert(
      latest !== null && latest.metricKey === testKey && latest.metricValue === 42.5,
      'Service getLatestMetricSnapshot retrieves the recorded snapshot'
    );

    // 1.3: Retrieve metric history
    await auditDashboardService.recordMetricSnapshot({
      metricKey: testKey,
      metricValue: 45.0,
      metricType: 'GAUGE',
      scopeType: 'GLOBAL',
      source: 'VEYRA_POSTGRES',
      isMock: false
    });
    const history = await auditDashboardService.getHistoricalMetrics(testKey, 10, 'GLOBAL', false);
    assert(
      history.length >= 2 && history[0].metricValue === 45.0,
      'Service getHistoricalMetrics returns time-series snapshots in descending order'
    );

    // 1.4: Scoped metrics retrieval
    await auditDashboardService.recordMetricSnapshot({
      metricKey: 'APP_TEST_METRIC',
      metricValue: 10,
      metricType: 'COUNTER',
      scopeType: 'APPLICATION',
      scopeId: 'ORACLE_RMC',
      source: 'ORACLE_FUSION',
      isMock: false
    });
    const scopedMetrics = await auditDashboardService.getMetricsByScope('APPLICATION', 'ORACLE_RMC', false);
    assert(
      scopedMetrics.some(m => m.metricKey === 'APP_TEST_METRIC'),
      'Service getMetricsByScope returns application-scoped metrics'
    );

    // 1.5: Verify getRawMetrics generates and persists snapshot data
    const rawMetrics = await auditDashboardService.getRawMetrics(true);
    assert(
      typeof rawMetrics.activeRisks === 'number' && typeof rawMetrics.totalUsers === 'number',
      'Service getRawMetrics computes core dashboard metrics'
    );

    // Verify snapshot was created in DB for ACTIVE_RISKS
    const { oracleService } = require(path.join(__dirname, '../dist/services/oracleService.js'));
    const isOracleDemo = oracleService.isDemoMode();
    const activeRisksSnapshot = await auditDashboardService.getLatestMetricSnapshot('ACTIVE_RISKS', 'GLOBAL', null, isOracleDemo);
    assert(
      activeRisksSnapshot !== null && typeof activeRisksSnapshot.metricValue === 'number',
      'getRawMetrics successfully persisted ACTIVE_RISKS snapshot in PostgreSQL'
    );

    // ------------------------------------------------------------------------
    // Part 2: HTTP API Endpoints & RBAC Authorization
    // ------------------------------------------------------------------------
    console.log('\n--- Part 2: HTTP API Endpoints & RBAC Security ---');

    // 2.1: Log in with Site Admin
    const adminLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@admin.com',
      password: 'Admin@123'
    });
    assert(adminLogin.status === 200 && adminLogin.data.token, 'Site Admin logged in successfully', adminLogin);
    const adminToken = adminLogin.data.token;

    // 2.2: Log in with Audit User (unprivileged)
    const auditUserLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'audit.user@claaps.com',
      password: 'Password@123'
    });
    assert(auditUserLogin.status === 200 && auditUserLogin.data.token, 'Audit User logged in successfully', auditUserLogin);
    const auditUserToken = auditUserLogin.data.token;

    // 2.3: Unauthenticated access to GET /api/dashboard/history returns 401
    const unauthHistory = await makeRequest('GET', '/api/dashboard/history?metricKey=ACTIVE_RISKS');
    assert(unauthHistory.status === 401, 'Unauthenticated GET /api/dashboard/history returns 401 Unauthorized', unauthHistory);

    // 2.4: Unauthorized user (Audit User) access to GET /api/dashboard/history returns 403
    const blockedHistory = await makeRequest('GET', '/api/dashboard/history?metricKey=ACTIVE_RISKS', null, auditUserToken);
    assert(blockedHistory.status === 403, 'Unauthorized Audit User blocked from GET /api/dashboard/history with 403 FORBIDDEN', blockedHistory);

    // 2.5: Authorized user (Site Admin) access to GET /api/dashboard/history returns 200
    const adminHistory = await makeRequest('GET', '/api/dashboard/history?metricKey=ACTIVE_RISKS', null, adminToken);
    assert(
      adminHistory.status === 200 && adminHistory.data.success === true && Array.isArray(adminHistory.data.history),
      'Site Admin successfully retrieves metric history from GET /api/dashboard/history',
      adminHistory
    );

    // 2.6: Overview stats returns full dashboard contract
    const overviewRes = await makeRequest('GET', '/api/overview/stats', null, adminToken);
    assert(
      overviewRes.status === 200 && overviewRes.data.data.auditEventsCount !== undefined,
      'GET /api/overview/stats returns full metrics object for frontend',
      overviewRes
    );

    console.log('\n================================================================');
    console.log(`  VY-STRY-013 Integration Test Results: ${testsPassed} Passed, ${testsFailed} Failed`);
    console.log('================================================================\n');

    if (testsFailed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test encountered uncaught exception:', err);
    process.exit(1);
  } finally {
    server.close();
  }
}

runTests();
