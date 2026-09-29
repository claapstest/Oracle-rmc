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
        resolve({ status: res.statusCode, data: parsed });
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('  VY-STRY-007: RBAC User, Role & Privilege APIs Test Suite');
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
    // Step 1: Login with Site Admin, Audit Manager, Audit Supervisor, Audit User
    // ------------------------------------------------------------------------
    console.log('--- Step 1: Authenticate Seed Personas ---');
    
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
    assert(managerLogin.status === 200 && managerLogin.data.token, 'Audit Manager logged in successfully');
    const managerToken = managerLogin.data.token;

    // Audit Supervisor
    const supervisorLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'supervisor.user@claaps.com',
      password: 'Password@123'
    });
    assert(supervisorLogin.status === 200 && supervisorLogin.data.token, 'Audit Supervisor logged in successfully');
    const supervisorToken = supervisorLogin.data.token;

    // Audit User
    const auditUserLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'audit.user@claaps.com',
      password: 'Password@123'
    });
    assert(auditUserLogin.status === 200 && auditUserLogin.data.token, 'Audit User logged in successfully');
    const auditUserToken = auditUserLogin.data.token;

    // ------------------------------------------------------------------------
    // AC1: User APIs (GET, GET :id, POST, PUT, DELETE)
    // ------------------------------------------------------------------------
    console.log('\n--- AC1 & AC4: User Management CRUD & Role Assignment APIs ---');

    // GET /api/users
    const listUsers = await makeRequest('GET', '/api/users', null, adminToken);
    assert(listUsers.status === 200 && Array.isArray(listUsers.data.users) && listUsers.data.users.length > 0, 'GET /api/users returns user list', listUsers);

    // POST /api/users (Create user with Role Assignment)
    const testEmail = `new.analyst_${Date.now()}@claaps.com`;
    const createUserRes = await makeRequest('POST', '/api/users', {
      email: testEmail,
      displayName: 'New Security Analyst',
      role: 'SECURITY_ANALYST',
      password: 'Password@123',
      status: 'ACTIVE'
    }, adminToken);
    assert(createUserRes.status === 201 && createUserRes.data.user?.email === testEmail, 'POST /api/users creates new user', createUserRes);
    const createdUserId = createUserRes.data.user?.id || testEmail;

    // POST /api/users duplicate check (Reject duplicate email)
    const dupRes = await makeRequest('POST', '/api/users', {
      email: testEmail,
      displayName: 'Duplicate User'
    }, adminToken);
    assert(dupRes.status === 409 && dupRes.data.code === 'USER_ALREADY_EXISTS', 'POST /api/users rejects duplicate email with 409 USER_ALREADY_EXISTS', dupRes);

    // GET /api/users/:id
    const getUserRes = await makeRequest('GET', `/api/users/${createdUserId}`, null, adminToken);
    assert(getUserRes.status === 200 && getUserRes.data.user?.email === testEmail, `GET /api/users/:id retrieves created user ${testEmail}`, getUserRes);

    // PUT /api/users/:id (AC4: Role assignment modification)
    const updateUserRes = await makeRequest('PUT', `/api/users/${createdUserId}`, {
      displayName: 'Promoted Analyst to Manager',
      role: 'AUDIT_MANAGER'
    }, adminToken);
    assert(updateUserRes.status === 200 && updateUserRes.data.user?.role === 'AUDIT_MANAGER', 'PUT /api/users/:id modifies user role to AUDIT_MANAGER (AC4)', updateUserRes);

    // DELETE /api/users/:id
    const deleteUserRes = await makeRequest('DELETE', `/api/users/${createdUserId}`, null, adminToken);
    assert(deleteUserRes.status === 200 && deleteUserRes.data.success, `DELETE /api/users/:id successfully deletes user ${testEmail}`, deleteUserRes);

    // Self-deletion guard test: Admin attempting to delete own account
    const selfDeleteRes = await makeRequest('DELETE', '/api/users/admin@admin.com', null, adminToken);
    assert(selfDeleteRes.status === 400 && selfDeleteRes.data.code === 'CANNOT_DELETE_SELF', 'DELETE /api/users/:id prevents administrator self-deletion', selfDeleteRes);

    // ------------------------------------------------------------------------
    // AC2: Role APIs (GET /api/roles, GET /api/roles/:id)
    // ------------------------------------------------------------------------
    console.log('\n--- AC2: Role Catalog APIs ---');

    const getRolesRes = await makeRequest('GET', '/api/roles', null, adminToken);
    assert(getRolesRes.status === 200 && Array.isArray(getRolesRes.data.roles) && getRolesRes.data.roles.length >= 4, 'GET /api/roles returns system roles catalog', getRolesRes);

    const getRoleByIdRes = await makeRequest('GET', '/api/roles/SITE_ADMIN', null, adminToken);
    assert(getRoleByIdRes.status === 200 && getRoleByIdRes.data.role?.role_code === 'SITE_ADMIN', 'GET /api/roles/:id retrieves role details for SITE_ADMIN', getRoleByIdRes);

    // ------------------------------------------------------------------------
    // AC3: Privilege APIs (GET /api/privileges)
    // ------------------------------------------------------------------------
    console.log('\n--- AC3: Privilege Catalog APIs ---');

    const getPrivsRes = await makeRequest('GET', '/api/privileges', null, adminToken);
    assert(getPrivsRes.status === 200 && Array.isArray(getPrivsRes.data.privileges) && getPrivsRes.data.privileges.length >= 10, 'GET /api/privileges returns system privileges', getPrivsRes);

    // ------------------------------------------------------------------------
    // AC5 & AC6: Site Admin Exclusive Access & 403 Forbidden Enforcement
    // ------------------------------------------------------------------------
    console.log('\n--- AC5 & AC6: Site Admin Exclusive Permissions & 403 Verification ---');

    // Site Admin can access settings
    const adminSettingsRes = await makeRequest('GET', '/api/settings', null, adminToken);
    assert(adminSettingsRes.status === 200, 'Site Admin permitted to access Oracle Integration Settings', adminSettingsRes);

    // Site Admin can access command-center catalog
    const adminCcRes = await makeRequest('GET', '/api/command-center/catalog', null, adminToken);
    assert(adminCcRes.status === 200 && adminCcRes.data.success, 'Site Admin permitted to access Oracle API Console (Command Center)', adminCcRes);

    // ------------------------------------------------------------------------
    // AC7: Audit Manager Permissions & Restrictions
    // ------------------------------------------------------------------------
    console.log('\n--- AC7: Audit Manager Permissions & Restrictions ---');

    // Audit Manager CAN access Users list, Roles, Privileges, Audit, Reports, Risk, Chat
    const mgrUsers = await makeRequest('GET', '/api/users', null, managerToken);
    assert(mgrUsers.status === 200, 'Audit Manager CAN access GET /api/users');

    const mgrRoles = await makeRequest('GET', '/api/roles', null, managerToken);
    assert(mgrRoles.status === 200, 'Audit Manager CAN access GET /api/roles');

    const mgrPrivs = await makeRequest('GET', '/api/privileges', null, managerToken);
    assert(mgrPrivs.status === 200, 'Audit Manager CAN access GET /api/privileges');

    const mgrAudit = await makeRequest('GET', '/api/audit/products', null, managerToken);
    assert(mgrAudit.status === 200, 'Audit Manager CAN access GET /api/audit/products');

    const mgrReports = await makeRequest('GET', '/api/reports/role-hierarchy', null, managerToken);
    assert(mgrReports.status === 200, 'Audit Manager CAN access GET /api/reports/role-hierarchy');

    // Audit Manager CANNOT create user
    const mgrCreateUser = await makeRequest('POST', '/api/users', { email: 'forbidden.user@claaps.com' }, managerToken);
    assert(mgrCreateUser.status === 403 && mgrCreateUser.data.code === 'FORBIDDEN', 'Audit Manager REJECTED from POST /api/users (403 Forbidden)');

    // Audit Manager CANNOT delete user
    const mgrDeleteUser = await makeRequest('DELETE', '/api/users/demo.user@claaps.com', null, managerToken);
    assert(mgrDeleteUser.status === 403 && mgrDeleteUser.data.code === 'FORBIDDEN', 'Audit Manager REJECTED from DELETE /api/users/:id (403 Forbidden)');

    // Audit Manager CANNOT modify user
    const mgrUpdateUser = await makeRequest('PUT', '/api/users/demo.user@claaps.com', { role: 'SITE_ADMIN' }, managerToken);
    assert(mgrUpdateUser.status === 403 && mgrUpdateUser.data.code === 'FORBIDDEN', 'Audit Manager REJECTED from PUT /api/users/:id (403 Forbidden)');

    // Audit Manager CANNOT access Settings
    const mgrSettings = await makeRequest('GET', '/api/settings', null, managerToken);
    assert(mgrSettings.status === 403 && mgrSettings.data.code === 'FORBIDDEN', 'Audit Manager REJECTED from GET /api/settings (403 Forbidden)');

    // Audit Manager CANNOT access Command Center
    const mgrCc = await makeRequest('GET', '/api/command-center/catalog', null, managerToken);
    assert(mgrCc.status === 403 && mgrCc.data.code === 'FORBIDDEN', 'Audit Manager REJECTED from GET /api/command-center/catalog (403 Forbidden)');

    // ------------------------------------------------------------------------
    // AC8: Audit Supervisor Permissions & Restrictions (No Ask Veyra)
    // ------------------------------------------------------------------------
    console.log('\n--- AC8: Audit Supervisor Permissions & Restrictions (No Ask Veyra) ---');

    // Audit Supervisor CAN access Users list, Roles, Privileges, Reports, Audit, Risk
    const supUsers = await makeRequest('GET', '/api/users', null, supervisorToken);
    assert(supUsers.status === 200, 'Audit Supervisor CAN access GET /api/users');

    const supRoles = await makeRequest('GET', '/api/roles', null, supervisorToken);
    assert(supRoles.status === 200, 'Audit Supervisor CAN access GET /api/roles');

    const supPrivs = await makeRequest('GET', '/api/privileges', null, supervisorToken);
    assert(supPrivs.status === 200, 'Audit Supervisor CAN access GET /api/privileges');

    const supAudit = await makeRequest('GET', '/api/audit/products', null, supervisorToken);
    assert(supAudit.status === 200, 'Audit Supervisor CAN access GET /api/audit/products');

    const supReports = await makeRequest('GET', '/api/reports/role-hierarchy', null, supervisorToken);
    assert(supReports.status === 200, 'Audit Supervisor CAN access GET /api/reports/role-hierarchy');

    // AC8: Audit Supervisor MUST NOT receive Ask Veyra privileges
    const supChat = await makeRequest('POST', '/api/chat', { message: 'Hello Veyra' }, supervisorToken);
    assert(supChat.status === 403 && supChat.data.code === 'FORBIDDEN', 'Audit Supervisor REJECTED from POST /api/chat (403 Forbidden, AC8)');

    // Audit Supervisor CANNOT create or delete user
    const supCreateUser = await makeRequest('POST', '/api/users', { email: 'forbidden2@claaps.com' }, supervisorToken);
    assert(supCreateUser.status === 403 && supCreateUser.data.code === 'FORBIDDEN', 'Audit Supervisor REJECTED from POST /api/users (403 Forbidden)');

    // ------------------------------------------------------------------------
    // AC9: Audit User Permissions & Restrictions (Reports Only)
    // ------------------------------------------------------------------------
    console.log('\n--- AC9: Audit User Permissions & Restrictions (Reports Only) ---');

    // Audit User CAN access Reports
    const userReports1 = await makeRequest('GET', '/api/reports/role-hierarchy', null, auditUserToken);
    assert(userReports1.status === 200, 'Audit User CAN access GET /api/reports/role-hierarchy (AC9)');

    // Audit User REJECTED from Users APIs
    const uUsers = await makeRequest('GET', '/api/users', null, auditUserToken);
    assert(uUsers.status === 403 && uUsers.data.code === 'FORBIDDEN', 'Audit User REJECTED from GET /api/users (403 Forbidden)');

    const uUsersId = await makeRequest('GET', '/api/users/admin@admin.com', null, auditUserToken);
    assert(uUsersId.status === 403 && uUsersId.data.code === 'FORBIDDEN', 'Audit User REJECTED from GET /api/users/:id (403 Forbidden)');

    const uCreateUser = await makeRequest('POST', '/api/users', { email: 'audit_created@claaps.com' }, auditUserToken);
    assert(uCreateUser.status === 403 && uCreateUser.data.code === 'FORBIDDEN', 'Audit User REJECTED from POST /api/users (403 Forbidden)');

    // Audit User REJECTED from Roles APIs
    const uRoles = await makeRequest('GET', '/api/roles', null, auditUserToken);
    assert(uRoles.status === 403 && uRoles.data.code === 'FORBIDDEN', 'Audit User REJECTED from GET /api/roles (403 Forbidden)');

    // Audit User REJECTED from Privileges APIs
    const uPrivs = await makeRequest('GET', '/api/privileges', null, auditUserToken);
    assert(uPrivs.status === 403 && uPrivs.data.code === 'FORBIDDEN', 'Audit User REJECTED from GET /api/privileges (403 Forbidden)');

    // Audit User REJECTED from Ask Veyra Chat
    const uChat = await makeRequest('POST', '/api/chat', { message: 'Who has admin role?' }, auditUserToken);
    assert(uChat.status === 403 && uChat.data.code === 'FORBIDDEN', 'Audit User REJECTED from POST /api/chat (403 Forbidden)');

    // Audit User REJECTED from Audit Logs
    const uAudit = await makeRequest('GET', '/api/audit/products', null, auditUserToken);
    assert(uAudit.status === 403 && uAudit.data.code === 'FORBIDDEN', 'Audit User REJECTED from GET /api/audit/products (403 Forbidden)');

    // Audit User REJECTED from Risk Dashboard
    const uRisk = await makeRequest('GET', '/api/risk/access-requests', null, auditUserToken);
    assert(uRisk.status === 403 && uRisk.data.code === 'FORBIDDEN', 'Audit User REJECTED from GET /api/risk/access-requests (403 Forbidden)');

    // Audit User REJECTED from Settings
    const uSettings = await makeRequest('GET', '/api/settings', null, auditUserToken);
    assert(uSettings.status === 403 && uSettings.data.code === 'FORBIDDEN', 'Audit User REJECTED from GET /api/settings (403 Forbidden)');

    // Audit User REJECTED from Command Center
    const uCc = await makeRequest('GET', '/api/command-center/catalog', null, auditUserToken);
    assert(uCc.status === 403 && uCc.data.code === 'FORBIDDEN', 'Audit User REJECTED from GET /api/command-center/catalog (403 Forbidden)');

    // ------------------------------------------------------------------------
    // Summary
    // ------------------------------------------------------------------------
    console.log('\n================================================================');
    console.log(`  Test Results: ${testsPassed} Passed | ${testsFailed} Failed`);
    console.log('================================================================\n');

    server.close();
    process.exit(testsFailed === 0 ? 0 : 1);
  } catch (err) {
    console.error('Test execution exception:', err);
    server.close();
    process.exit(1);
  }
}

runTests();
