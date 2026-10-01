/**
 * Comprehensive Automated Verification Suite for VY-STRY-24
 * BE: Implement VEYRA User Management APIs
 * Acceptance Criteria AC1 - AC10
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 5096;
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
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('  VY-STRY-24: VEYRA User Management APIs Automated Verification');
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
    // 1. Establish sessions for different personas
    console.log('--- Establishing Authenticated Sessions ---');
    const adminLogin = await makeRequest('POST', '/api/auth/login', { email: 'admin@admin.com', password: 'Admin@123' });
    const adminToken = adminLogin.body?.token;
    assert(adminLogin.status === 200 && adminToken !== undefined, 'Site Admin logged in successfully');

    const managerLogin = await makeRequest('POST', '/api/auth/login', { email: 'akash.meesarapu@claaps.com', password: 'Password@123' });
    const managerToken = managerLogin.body?.token;
    assert(managerLogin.status === 200 && managerToken !== undefined, 'Audit Manager logged in successfully');

    const supervisorLogin = await makeRequest('POST', '/api/auth/login', { email: 'supervisor.user@claaps.com', password: 'Password@123' });
    const supervisorToken = supervisorLogin.body?.token;
    assert(supervisorLogin.status === 200 && supervisorToken !== undefined, 'Audit Supervisor logged in successfully');

    const userLogin = await makeRequest('POST', '/api/auth/login', { email: 'audit.user@claaps.com', password: 'Password@123' });
    const userToken = userLogin.body?.token;
    assert(userLogin.status === 200 && userToken !== undefined, 'Audit User logged in successfully\n');

    // --- AC1: Authentication Enforcement ---
    console.log('--- AC1: Authentication Enforcement ---');
    const unauthGet = await makeRequest('GET', '/api/users');
    assert(unauthGet.status === 401, 'Unauthenticated GET /api/users rejected with 401 Unauthorized (AC1)');

    const unauthGetSingle = await makeRequest('GET', '/api/users/admin@admin.com');
    assert(unauthGetSingle.status === 401, 'Unauthenticated GET /api/users/:id rejected with 401 Unauthorized (AC1)');

    const unauthPost = await makeRequest('POST', '/api/users', { email: 'unauth@claaps.com' });
    assert(unauthPost.status === 401, 'Unauthenticated POST /api/users rejected with 401 Unauthorized (AC1)');

    const unauthPut = await makeRequest('PUT', '/api/users/some_id', { displayName: 'Hacker' });
    assert(unauthPut.status === 401, 'Unauthenticated PUT /api/users/:id rejected with 401 Unauthorized (AC1)');

    const unauthDel = await makeRequest('DELETE', '/api/users/some_id');
    assert(unauthDel.status === 401, 'Unauthenticated DELETE /api/users/:id rejected with 401 Unauthorized (AC1)');

    const invalidTokenRes = await makeRequest('GET', '/api/users', null, 'invalid_fake_token_12345');
    assert(invalidTokenRes.status === 401, 'Invalid bearer token rejected with 401 Unauthorized (AC1)');

    // --- AC2: Authorization Verification ---
    console.log('\n--- AC2: Authorization Verification ---');
    // Site Admin has full access
    const adminGet = await makeRequest('GET', '/api/users', null, adminToken);
    assert(adminGet.status === 200, 'Site Admin permitted on GET /api/users with 200 OK (AC2)');
    assert(adminGet.body.success === true, 'Site Admin response success is true');
    assert(Array.isArray(adminGet.body.users), 'Site Admin response contains users array');

    // Audit Manager has USERS_LIST privilege -> can view users
    const managerGet = await makeRequest('GET', '/api/users', null, managerToken);
    assert(managerGet.status === 200, 'Audit Manager permitted on GET /api/users with 200 OK (AC2)');

    // Audit Supervisor has USERS_LIST privilege -> can view users
    const supervisorGet = await makeRequest('GET', '/api/users', null, supervisorToken);
    assert(supervisorGet.status === 200, 'Audit Supervisor permitted on GET /api/users with 200 OK (AC2)');

    // Audit User does NOT have USERS_LIST -> strictly 403 Forbidden
    const userGet = await makeRequest('GET', '/api/users', null, userToken);
    assert(userGet.status === 403, 'Audit User REJECTED from GET /api/users with 403 Forbidden (AC2)');
    assert(userGet.body.code === 'FORBIDDEN', 'Rejection code is FORBIDDEN');

    const userGetSingle = await makeRequest('GET', '/api/users/admin@admin.com', null, userToken);
    assert(userGetSingle.status === 403, 'Audit User REJECTED from GET /api/users/:id with 403 Forbidden (AC2)');

    // Non-Admin mutations rejected with 403 Forbidden
    const managerPost = await makeRequest('POST', '/api/users', { email: 'forbidden.create@claaps.com', displayName: 'Forbidden User' }, managerToken);
    assert(managerPost.status === 403, 'Audit Manager REJECTED from POST /api/users with 403 Forbidden (AC2)');

    const supervisorPost = await makeRequest('POST', '/api/users', { email: 'forbidden.create@claaps.com' }, supervisorToken);
    assert(supervisorPost.status === 403, 'Audit Supervisor REJECTED from POST /api/users with 403 Forbidden (AC2)');

    const userPost = await makeRequest('POST', '/api/users', { email: 'forbidden.create@claaps.com' }, userToken);
    assert(userPost.status === 403, 'Audit User REJECTED from POST /api/users with 403 Forbidden (AC2)');

    const managerPut = await makeRequest('PUT', '/api/users/admin@admin.com', { displayName: 'Tampered Name' }, managerToken);
    assert(managerPut.status === 403, 'Audit Manager REJECTED from PUT /api/users/:id with 403 Forbidden (AC2)');

    const supervisorPut = await makeRequest('PUT', '/api/users/admin@admin.com', { displayName: 'Tampered Name' }, supervisorToken);
    assert(supervisorPut.status === 403, 'Audit Supervisor REJECTED from PUT /api/users/:id with 403 Forbidden (AC2)');

    const userPut = await makeRequest('PUT', '/api/users/admin@admin.com', { displayName: 'Tampered Name' }, userToken);
    assert(userPut.status === 403, 'Audit User REJECTED from PUT /api/users/:id with 403 Forbidden (AC2)');

    const managerDel = await makeRequest('DELETE', '/api/users/user.test@claaps.com', null, managerToken);
    assert(managerDel.status === 403, 'Audit Manager REJECTED from DELETE /api/users/:id with 403 Forbidden (AC2)');

    const supervisorDel = await makeRequest('DELETE', '/api/users/user.test@claaps.com', null, supervisorToken);
    assert(supervisorDel.status === 403, 'Audit Supervisor REJECTED from DELETE /api/users/:id with 403 Forbidden (AC2)');

    const userDel = await makeRequest('DELETE', '/api/users/user.test@claaps.com', null, userToken);
    assert(userDel.status === 403, 'Audit User REJECTED from DELETE /api/users/:id with 403 Forbidden (AC2)');

    // --- AC3: User Search by Name / Email ---
    console.log('\n--- AC3: User Search Tests ---');
    const searchAdminRes = await makeRequest('GET', '/api/users?search=admin', null, adminToken);
    assert(searchAdminRes.status === 200, 'Search query ?search=admin returns 200 OK (AC3)');
    assert(searchAdminRes.body.users.length > 0, 'Search results return matching admin accounts');
    const allMatchAdmin = searchAdminRes.body.users.every(u =>
      u.email.toLowerCase().includes('admin') ||
      (u.displayName && u.displayName.toLowerCase().includes('admin')) ||
      (u.role && u.role.toLowerCase().includes('admin'))
    );
    assert(allMatchAdmin, 'All search results match search term "admin" (AC3)');

    const searchSpecificRes = await makeRequest('GET', '/api/users?search=akash.meesarapu', null, adminToken);
    assert(searchSpecificRes.status === 200, 'Search query ?search=akash.meesarapu returns 200 OK');
    assert(searchSpecificRes.body.users.some(u => u.email === 'akash.meesarapu@claaps.com'), 'Search found target email akash.meesarapu@claaps.com (AC3)');

    const searchNoneRes = await makeRequest('GET', '/api/users?search=nonexistent_query_xyz_999', null, adminToken);
    assert(searchNoneRes.status === 200, 'Search with no matches returns 200 OK');
    assert(searchNoneRes.body.total === 0 && searchNoneRes.body.users.length === 0, 'Empty search result has total 0 and empty array (AC3)');

    // --- AC4: Filtering (Role / Status) ---
    console.log('\n--- AC4: Filtering Tests ---');
    const filterRoleRes = await makeRequest('GET', '/api/users?role=SITE_ADMIN', null, adminToken);
    assert(filterRoleRes.status === 200, 'Filter by role ?role=SITE_ADMIN returns 200 OK (AC4)');
    const allSiteAdmin = filterRoleRes.body.users.every(u => u.role === 'SITE_ADMIN' || u.isAdmin === true);
    assert(allSiteAdmin, 'All returned users match SITE_ADMIN role filter (AC4)');

    const filterStatusRes = await makeRequest('GET', '/api/users?status=ACTIVE', null, adminToken);
    assert(filterStatusRes.status === 200, 'Filter by status ?status=ACTIVE returns 200 OK (AC4)');
    const allActive = filterStatusRes.body.users.every(u => u.status === 'ACTIVE' || u.isActive === true);
    assert(allActive, 'All returned users are ACTIVE (AC4)');

    // --- AC5: Pagination Parameters (page, pageSize) ---
    console.log('\n--- AC5: Pagination Tests ---');
    const page1Res = await makeRequest('GET', '/api/users?page=1&pageSize=2', null, adminToken);
    assert(page1Res.status === 200, 'Pagination page 1 with pageSize 2 returns 200 OK (AC5)');
    assert(page1Res.body.page === 1, 'Response metadata reflects page = 1');
    assert(page1Res.body.pageSize === 2, 'Response metadata reflects pageSize = 2');
    assert(page1Res.body.users.length <= 2, 'Returned users count is <= pageSize (2)');
    assert(page1Res.body.total >= 2, 'Total count reflects full dataset count');
    assert(page1Res.body.totalPages >= 1, 'totalPages is calculated correctly');

    const page2Res = await makeRequest('GET', '/api/users?page=2&pageSize=2', null, adminToken);
    assert(page2Res.status === 200, 'Pagination page 2 returns 200 OK (AC5)');
    assert(page2Res.body.page === 2, 'Response reflects page = 2');

    // --- AC6: Sorting Parameters (sortBy, sortOrder) ---
    console.log('\n--- AC6: Controlled Sorting Tests ---');
    const sortAscRes = await makeRequest('GET', '/api/users?sortBy=displayName&sortOrder=asc', null, adminToken);
    assert(sortAscRes.status === 200, 'Sorting ?sortBy=displayName&sortOrder=asc returns 200 OK (AC6)');
    const namesAsc = sortAscRes.body.users.map(u => (u.displayName || '').toLowerCase());
    let isAsc = true;
    for (let i = 0; i < namesAsc.length - 1; i++) {
      if (namesAsc[i].localeCompare(namesAsc[i + 1]) > 0) {
        isAsc = false;
        break;
      }
    }
    assert(isAsc, 'Users are sorted ascending by displayName (AC6)');

    const sortDescRes = await makeRequest('GET', '/api/users?sortBy=displayName&sortOrder=desc', null, adminToken);
    assert(sortDescRes.status === 200, 'Sorting ?sortBy=displayName&sortOrder=desc returns 200 OK (AC6)');

    // --- CRUD Operations: Create, Read Single, Update, Delete ---
    console.log('\n--- CRUD Operations & AC7, AC8, AC9, AC10 ---');
    const testEmail = `test.user.${Date.now()}@claaps.com`;
    const createRes = await makeRequest('POST', '/api/users', {
      email: testEmail,
      displayName: 'Test Automated User',
      role: 'AUDIT_SUPERVISOR',
      password: 'Temporary@123',
      status: 'ACTIVE'
    }, adminToken);

    assert(createRes.status === 201, 'POST /api/users creates user with 201 Created');
    assert(createRes.body.success === true, 'Creation response success is true');
    assert(createRes.body.user.email === testEmail, 'Created user has matching email');
    assert(createRes.body.user.role === 'AUDIT_SUPERVISOR', 'Created user has assigned role');

    const createdUserId = createRes.body.user.userId || createRes.body.user.id;

    // AC10: Data Security check on Create response
    assert(createRes.body.user.passwordHash === undefined, 'Create response does NOT contain passwordHash (AC10)');
    assert(createRes.body.user.password === undefined, 'Create response does NOT contain plaintext password (AC10)');
    assert(createRes.body.user.resetCode === undefined || createRes.body.user.resetCode === null, 'Create response does NOT leak resetCode (AC10)');

    // Duplicate creation test (409 Conflict)
    const dupRes = await makeRequest('POST', '/api/users', {
      email: testEmail,
      displayName: 'Duplicate User'
    }, adminToken);
    assert(dupRes.status === 409, 'Duplicate user creation rejected with 409 Conflict');
    assert(dupRes.body.code === 'USER_ALREADY_EXISTS', 'Rejection code is USER_ALREADY_EXISTS');

    // GET /api/users/:id
    const getSingleRes = await makeRequest('GET', `/api/users/${encodeURIComponent(testEmail)}`, null, adminToken);
    assert(getSingleRes.status === 200, 'GET /api/users/:id by email returns 200 OK');
    assert(getSingleRes.body.user.email === testEmail, 'Single user lookup returns correct user');
    assert(getSingleRes.body.user.passwordHash === undefined, 'Single user lookup does NOT contain passwordHash (AC10)');

    // Lookup by userId
    const getByIdRes = await makeRequest('GET', `/api/users/${encodeURIComponent(createdUserId)}`, null, adminToken);
    assert(getByIdRes.status === 200, 'GET /api/users/:id by userId returns 200 OK');
    assert(getByIdRes.body.user.id === createdUserId || getByIdRes.body.user.userId === createdUserId, 'Matched by userId');

    // PUT /api/users/:id
    const updateRes = await makeRequest('PUT', `/api/users/${encodeURIComponent(testEmail)}`, {
      displayName: 'Updated Test User Name',
      role: 'AUDIT_MANAGER',
      status: 'SUSPENDED'
    }, adminToken);
    assert(updateRes.status === 200, 'PUT /api/users/:id updates user with 200 OK');
    assert(updateRes.body.user.displayName === 'Updated Test User Name', 'Display name was updated');
    assert(updateRes.body.user.role === 'AUDIT_MANAGER', 'Role was updated to AUDIT_MANAGER');
    assert(updateRes.body.user.status === 'SUSPENDED', 'Status was updated to SUSPENDED');
    assert(updateRes.body.user.passwordHash === undefined, 'Update response does NOT contain passwordHash (AC10)');

    // PUT non-existent user (404 Not Found)
    const updateNonExistent = await makeRequest('PUT', '/api/users/nonexistent.user.xyz@claaps.com', { displayName: 'Ghost' }, adminToken);
    assert(updateNonExistent.status === 404, 'PUT on non-existent user returns 404 Not Found');

    // --- AC8: Self-Delete Protection ---
    console.log('\n--- AC8: Self-Delete Protection Tests ---');
    const selfDeleteByEmail = await makeRequest('DELETE', '/api/users/admin@admin.com', null, adminToken);
    assert(selfDeleteByEmail.status === 400, 'Self-delete by root admin email rejected with 400 Bad Request (AC8)');
    assert(selfDeleteByEmail.body.code === 'CANNOT_DELETE_SELF', 'Error code is CANNOT_DELETE_SELF (AC8)');

    // --- AC7: Delete Verification (Target exists & eligible) ---
    console.log('\n--- AC7: Delete Verification Tests ---');
    const deleteNonExistent = await makeRequest('DELETE', '/api/users/nonexistent.user.xyz@claaps.com', null, adminToken);
    assert(deleteNonExistent.status === 404, 'DELETE on non-existent user returns 404 Not Found (AC7)');

    // Delete the newly created user
    const deleteRes = await makeRequest('DELETE', `/api/users/${encodeURIComponent(testEmail)}`, null, adminToken);
    assert(deleteRes.status === 200, 'DELETE on eligible user returns 200 OK (AC7)');
    assert(deleteRes.body.success === true, 'Delete response success is true');

    // Verify user is gone
    const verifyGone = await makeRequest('GET', `/api/users/${encodeURIComponent(testEmail)}`, null, adminToken);
    assert(verifyGone.status === 404, 'Subsequent GET on deleted user returns 404 Not Found (AC7)');

    // --- AC10: Data Security Across Full Users List ---
    console.log('\n--- AC10: Data Security Verification ---');
    const fullListRes = await makeRequest('GET', '/api/users?pageSize=100', null, adminToken);
    assert(fullListRes.status === 200, 'GET /api/users for security inspection returns 200 OK');
    let hasLeakedSecret = false;
    for (const u of fullListRes.body.users) {
      if (
        u.passwordHash !== undefined ||
        u.password_hash !== undefined ||
        u.password !== undefined ||
        u.sessionToken !== undefined ||
        u.token !== undefined ||
        u.session_id !== undefined ||
        u.secret !== undefined
      ) {
        hasLeakedSecret = true;
        break;
      }
    }
    assert(!hasLeakedSecret, 'All user records in list strictly omit password hashes, tokens, and secrets (AC10)');

  } finally {
    server.close();
  }

  console.log('\n================================================================');
  console.log(`  VY-STRY-24 Test Results: ${testsPassed} Passed, ${testsFailed} Failed`);
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
