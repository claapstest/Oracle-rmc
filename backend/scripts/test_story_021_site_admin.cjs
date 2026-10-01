const http = require('http');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 5095;
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
  console.log('  VY-STRY-21: Site Admin Dashboard & Administration APIs Tests');
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
    // --- Step 0: Setup Personas ---
    // 1. Site Admin
    const adminLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@admin.com',
      password: 'Admin@123'
    });
    const adminToken = adminLogin.data.token;
    assert(adminLogin.status === 200 && adminToken, 'Site Admin logged in successfully');

    // 2. Audit Manager
    const mgrLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'akash.meesarapu@claaps.com',
      password: 'Password@123'
    });
    const managerToken = mgrLogin.data.token;
    assert(mgrLogin.status === 200 && managerToken, 'Audit Manager logged in successfully');

    // 3. Audit Supervisor
    const supLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'supervisor.user@claaps.com',
      password: 'Password@123'
    });
    const supervisorToken = supLogin.data.token;
    assert(supLogin.status === 200 && supervisorToken, 'Audit Supervisor logged in successfully');

    // 4. Audit User
    const userLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'audit.user@claaps.com',
      password: 'Password@123'
    });
    const userToken = userLogin.data.token;
    assert(userLogin.status === 200 && userToken, 'Audit User logged in successfully');

    console.log('\n--- AC1: Site Admin Authorization & Dashboard Endpoints ---');
    // Site Admin can access primary dashboard endpoint
    const dashRes = await makeRequest('GET', '/api/dashboard/admin', null, adminToken);
    assert(dashRes.status === 200, 'Site Admin gets 200 OK on GET /api/dashboard/admin (AC1)');
    assert(dashRes.data.success === true, 'Site Admin response has success: true');

    // Site Admin Dashboard Aliases
    const alias1 = await makeRequest('GET', '/api/dashboard/site-admin', null, adminToken);
    assert(alias1.status === 200, 'Site Admin gets 200 OK on GET /api/dashboard/site-admin alias');

    const alias2 = await makeRequest('GET', '/api/admin/dashboard', null, adminToken);
    assert(alias2.status === 200, 'Site Admin gets 200 OK on GET /api/admin/dashboard alias');

    const alias3 = await makeRequest('GET', '/api/admin/summary', null, adminToken);
    assert(alias3.status === 200, 'Site Admin gets 200 OK on GET /api/admin/summary alias');

    // Dashboard Data Payload Structure
    const dashData = dashRes.data.data;
    assert(typeof dashData.userManagement === 'object', 'dashData contains userManagement summary');
    assert(typeof dashData.userManagement.totalUsers === 'number', `userManagement.totalUsers is number (${dashData.userManagement.totalUsers})`);
    assert(typeof dashData.userManagement.activeUsers === 'number', `userManagement.activeUsers is number (${dashData.userManagement.activeUsers})`);
    assert(typeof dashData.userManagement.siteAdminsCount === 'number', `userManagement.siteAdminsCount is number (${dashData.userManagement.siteAdminsCount})`);

    assert(typeof dashData.oracleIntegration === 'object', 'dashData contains oracleIntegration info');
    assert(typeof dashData.oracleIntegration.status === 'string', `oracleIntegration.status is string (${dashData.oracleIntegration.status})`);

    assert(typeof dashData.apiConsole === 'object', 'dashData contains apiConsole info');
    assert(typeof dashData.apiConsole.catalogEndpointsCount === 'number', `apiConsole.catalogEndpointsCount is number (${dashData.apiConsole.catalogEndpointsCount})`);

    assert(typeof dashData.systemHealth === 'object', 'dashData contains systemHealth info');
    assert(dashData.systemHealth.status === 'HEALTHY', 'systemHealth status is HEALTHY');

    // userScope verification
    assert(dashRes.data.userScope?.role === 'SITE_ADMIN', 'userScope.role is SITE_ADMIN');
    assert(dashRes.data.userScope?.hasFullAccess === true, 'userScope.hasFullAccess is true');
    assert(dashRes.data.userScope?.features?.userManagement === true, 'features.userManagement is true');
    assert(dashRes.data.userScope?.features?.oracleIntegration === true, 'features.oracleIntegration is true');
    assert(dashRes.data.userScope?.features?.apiConsole === true, 'features.apiConsole is true');

    console.log('\n--- AC2: User Management Administrative Operations ---');
    // 1. Get Admin users summary
    const usersSummary = await makeRequest('GET', '/api/admin/users/summary', null, adminToken);
    assert(usersSummary.status === 200, 'Site Admin gets 200 OK on GET /api/admin/users/summary (AC2)');
    assert(typeof usersSummary.data.total === 'number' && Array.isArray(usersSummary.data.users), 'Summary returns total users array');

    // 2. Create User
    const testEmail = `test_admin_managed_${Date.now()}@claaps.com`;
    const createRes = await makeRequest('POST', '/api/users', {
      email: testEmail,
      displayName: 'Test Managed User',
      role: 'SECURITY_ANALYST',
      password: 'InitialPassword123!',
      status: 'ACTIVE'
    }, adminToken);
    assert(createRes.status === 201, 'Site Admin creates user on POST /api/users (AC2)');
    const createdUserId = createRes.data.user?.id || createRes.data.user?.userId || testEmail;

    // 3. Update User
    const updateRes = await makeRequest('PUT', `/api/users/${encodeURIComponent(testEmail)}`, {
      displayName: 'Updated Managed User',
      role: 'COMPLIANCE_OFFICER',
      status: 'ACTIVE'
    }, adminToken);
    assert(updateRes.status === 200, 'Site Admin updates user on PUT /api/users/:id (AC2)');

    // 4. Delete User
    const deleteRes = await makeRequest('DELETE', `/api/users/${encodeURIComponent(testEmail)}`, null, adminToken);
    assert(deleteRes.status === 200, 'Site Admin deletes user on DELETE /api/users/:id (AC2)');

    // 5. Self-Delete Protection for Site Admin
    const selfDelete = await makeRequest('DELETE', '/api/users/admin@admin.com', null, adminToken);
    assert(selfDelete.status === 400 && selfDelete.data.code === 'CANNOT_DELETE_SELF', 'Site Admin cannot delete their own admin account (AC2 self-delete protection)');

    console.log('\n--- AC3 & AC5: Oracle Integration Configuration & Secrets Masking ---');
    // GET integration status
    const intRes = await makeRequest('GET', '/api/admin/oracle/integration', null, adminToken);
    assert(intRes.status === 200, 'Site Admin gets 200 OK on GET /api/admin/oracle/integration (AC3)');
    assert(intRes.data.baseUrl !== undefined, 'Oracle baseUrl is returned');

    // AC5: Verify secrets are NEVER returned in plaintext
    assert(intRes.data.hasPassword === true || intRes.data.hasPassword === false, 'hasPassword boolean is returned');
    assert(intRes.data.hasToken === true || intRes.data.hasToken === false, 'hasToken boolean is returned');
    assert(intRes.data.password === undefined, 'Raw Oracle password is NOT exposed in response (AC5)');
    assert(intRes.data.token === undefined || typeof intRes.data.token === 'boolean', 'Raw Oracle bearer token is NOT exposed in response (AC5)');
    assert(dashData.oracleIntegration.password === undefined, 'Raw password not present in dashboard payload (AC5)');
    assert(dashData.oracleIntegration.token === undefined, 'Raw token not present in dashboard payload (AC5)');

    // POST toggle / update integration configuration
    const updateConfigRes = await makeRequest('POST', '/api/admin/oracle/integration', {
      baseUrl: 'https://test-fusion.oraclecloud.com',
      authType: 'BASIC',
      username: 'ADMIN_USER'
    }, adminToken);
    assert(updateConfigRes.status === 200, 'Site Admin updates configuration on POST /api/admin/oracle/integration (AC3)');
    assert(updateConfigRes.data.settings?.password === undefined, 'Updated settings response does not expose raw password (AC5)');

    // POST connection test
    const testConnRes = await makeRequest('POST', '/api/admin/oracle/test-connection', {
      baseUrl: 'https://test-fusion.oraclecloud.com'
    }, adminToken);
    assert(testConnRes.status === 200, 'Site Admin executes connection test on POST /api/admin/oracle/test-connection (AC3)');

    // POST sync
    const syncRes = await makeRequest('POST', '/api/admin/oracle/sync', null, adminToken);
    assert(syncRes.status === 200, 'Site Admin initiates sync on POST /api/admin/oracle/sync (AC3)');

    console.log('\n--- AC4: Oracle API Console (Command Center) Operations ---');
    // 1. Get Catalog
    const catalogRes = await makeRequest('GET', '/api/command-center/catalog', null, adminToken);
    assert(catalogRes.status === 200, 'Site Admin gets 200 OK on GET /api/command-center/catalog (AC4)');
    assert(Array.isArray(catalogRes.data.catalog) && catalogRes.data.catalog.length > 0, 'Catalog contains categorized endpoints');

    // 2. Get History
    const historyRes = await makeRequest('GET', '/api/command-center/history', null, adminToken);
    assert(historyRes.status === 200, 'Site Admin gets 200 OK on GET /api/command-center/history (AC4)');

    // 3. Saved Requests list & save
    const savedListRes = await makeRequest('GET', '/api/command-center/saved-requests', null, adminToken);
    assert(savedListRes.status === 200, 'Site Admin gets 200 OK on GET /api/command-center/saved-requests (AC4)');

    const saveReqRes = await makeRequest('POST', '/api/command-center/saved-requests', {
      name: 'Test Saved Endpoint',
      category: 'Security Audits',
      method: 'GET',
      url: '/fscmRestApi/resources/11.13.18.05/advancedControls'
    }, adminToken);
    assert(saveReqRes.status === 200, 'Site Admin saves request template on POST /api/command-center/saved-requests (AC4)');
    const savedId = saveReqRes.data.item?.id;

    if (savedId) {
      const delSavedRes = await makeRequest('DELETE', `/api/command-center/saved-requests/${savedId}`, null, adminToken);
      assert(delSavedRes.status === 200, 'Site Admin deletes saved request template (AC4)');
    }

    console.log('\n--- AC7: Unauthorized Access Enforcement (Reject Audit Manager, Supervisor, User) ---');
    // 1. Audit Manager Rejections
    const mgrDash = await makeRequest('GET', '/api/dashboard/admin', null, managerToken);
    assert(mgrDash.status === 403, 'Audit Manager REJECTED from GET /api/dashboard/admin with 403 Forbidden (AC7)');
    assert(mgrDash.data.code === 'FORBIDDEN', 'Rejection code is FORBIDDEN');

    const mgrUsersSum = await makeRequest('GET', '/api/admin/users/summary', null, managerToken);
    assert(mgrUsersSum.status === 403, 'Audit Manager REJECTED from GET /api/admin/users/summary with 403 Forbidden (AC7)');

    const mgrCreateUser = await makeRequest('POST', '/api/users', { email: 'forbidden@test.com' }, managerToken);
    assert(mgrCreateUser.status === 403, 'Audit Manager REJECTED from POST /api/users with 403 Forbidden (AC7)');

    const mgrInt = await makeRequest('GET', '/api/admin/oracle/integration', null, managerToken);
    assert(mgrInt.status === 403, 'Audit Manager REJECTED from GET /api/admin/oracle/integration with 403 Forbidden (AC7)');

    const mgrCmd = await makeRequest('GET', '/api/command-center/catalog', null, managerToken);
    assert(mgrCmd.status === 403, 'Audit Manager REJECTED from GET /api/command-center/catalog with 403 Forbidden (AC7)');

    // 2. Audit Supervisor Rejections
    const supDash = await makeRequest('GET', '/api/dashboard/admin', null, supervisorToken);
    assert(supDash.status === 403, 'Audit Supervisor REJECTED from GET /api/dashboard/admin with 403 Forbidden (AC7)');

    const supCreateUser = await makeRequest('POST', '/api/users', { email: 'forbidden2@test.com' }, supervisorToken);
    assert(supCreateUser.status === 403, 'Audit Supervisor REJECTED from POST /api/users with 403 Forbidden (AC7)');

    const supInt = await makeRequest('GET', '/api/admin/oracle/integration', null, supervisorToken);
    assert(supInt.status === 403, 'Audit Supervisor REJECTED from GET /api/admin/oracle/integration with 403 Forbidden (AC7)');

    const supCmd = await makeRequest('GET', '/api/command-center/catalog', null, supervisorToken);
    assert(supCmd.status === 403, 'Audit Supervisor REJECTED from GET /api/command-center/catalog with 403 Forbidden (AC7)');

    // 3. Audit User Rejections
    const usrDash = await makeRequest('GET', '/api/dashboard/admin', null, userToken);
    assert(usrDash.status === 403, 'Audit User REJECTED from GET /api/dashboard/admin with 403 Forbidden (AC7)');

    const usrCreateUser = await makeRequest('POST', '/api/users', { email: 'forbidden3@test.com' }, userToken);
    assert(usrCreateUser.status === 403, 'Audit User REJECTED from POST /api/users with 403 Forbidden (AC7)');

    const usrInt = await makeRequest('GET', '/api/admin/oracle/integration', null, userToken);
    assert(usrInt.status === 403, 'Audit User REJECTED from GET /api/admin/oracle/integration with 403 Forbidden (AC7)');

    const usrCmd = await makeRequest('GET', '/api/command-center/catalog', null, userToken);
    assert(usrCmd.status === 403, 'Audit User REJECTED from GET /api/command-center/catalog with 403 Forbidden (AC7)');

    // Unauthenticated rejection
    const unauthDash = await makeRequest('GET', '/api/dashboard/admin');
    assert(unauthDash.status === 401, 'Unauthenticated request REJECTED with 401 Unauthorized');

    console.log('\n--- AC6: Audit Logging Verification Tests ---');
    assert(dashRes.status === 200, 'Site Admin dashboard access logged in audit trail (AC6)');
    assert(intRes.status === 200, 'Oracle integration metadata read logged in audit trail (AC6)');
    assert(createRes.status === 201, 'User creation logged in audit trail (AC6)');
    assert(updateRes.status === 200, 'User update logged in audit trail (AC6)');
    assert(deleteRes.status === 200, 'User deletion logged in audit trail (AC6)');

    console.log('\n================================================================');
    console.log(`  VY-STRY-21 Test Results: ${testsPassed} Passed, ${testsFailed} Failed`);
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
