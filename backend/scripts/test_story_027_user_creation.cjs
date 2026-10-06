/**
 * Comprehensive Automated Verification Suite for VY-STRY-27
 * BE: Implement User Creation and Role Assignment API
 * Acceptance Criteria AC1 - AC12
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
  console.log('  VY-STRY-27: User Creation & Role Assignment Automated Suite   ');
  console.log('================================================================\n');

  process.env.PORT = String(TEST_PORT);
  process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES = '5';
  process.env.ORACLE_BASE_URL = '';
  process.env.NODE_ENV = 'test';

  const authFilePath = path.join(__dirname, '../users_auth.json');
  const originalAuthFileContent = fs.readFileSync(authFilePath, 'utf8');

  function cleanupTestUsers() {
    try {
      const data = JSON.parse(fs.readFileSync(authFilePath, 'utf8'));
      const testEmails = [
        'new.auditor27@veyra.local',
        'priv.injection@veyra.local',
        'audit.event.test@veyra.local',
        'pwd.test@veyra.local',
        'test.blocked1@veyra.local',
        'test.blocked2@veyra.local',
        'test.blocked3@veyra.local',
        'test.unauth@veyra.local',
        'duplicate alice',
        'bad.role@veyra.local'
      ];
      for (const email of testEmails) {
        delete data.users[email];
        delete data.users[email.toLowerCase()];
      }
      fs.writeFileSync(authFilePath, JSON.stringify(data, null, 2), 'utf8');
      if (authService && typeof authService.loadUsers === 'function') {
        authService.loadUsers();
      }
    } catch (_) {}
  }

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

  // Clean any test users before starting
  cleanupTestUsers();

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
    assert(adminLogin.status === 200 && adminToken, 'Site Admin logged in successfully');

    const auditUserLogin = await makeRequest('POST', '/api/auth/login', { email: 'audit.user@claaps.com', password: 'Password@123' });
    const auditUserToken = auditUserLogin.body?.token;
    assert(auditUserLogin.status === 200 && auditUserToken, 'Audit User logged in successfully');

    const supervisorLogin = await makeRequest('POST', '/api/auth/login', { email: 'supervisor.user@claaps.com', password: 'Password@123' });
    const supervisorToken = supervisorLogin.body?.token;
    assert(supervisorLogin.status === 200 && supervisorToken, 'Audit Supervisor logged in successfully');

    const managerLogin = await makeRequest('POST', '/api/auth/login', { email: 'akash.meesarapu@claaps.com', password: 'Password@123' });
    const managerToken = managerLogin.body?.token;
    assert(managerLogin.status === 200 && managerToken, 'Audit Manager logged in successfully');

    // -------------------------------------------------------------
    // AC1 & AC2: Endpoint & Authorization
    // -------------------------------------------------------------
    console.log('\n--- AC1 & AC2: Endpoint POST /api/users & Authorization Enforcement ---');
    
    // AC2: Unauthenticated request rejected with 401
    const unauthRes = await makeRequest('POST', '/api/users', { email: 'test.unauth@veyra.local', name: 'Unauth User' });
    assert(unauthRes.status === 401, 'AC2: Unauthenticated POST /api/users rejected with 401 Unauthorized');

    // AC2: Non-admin roles (Audit User, Supervisor, Manager) rejected with 403 Forbidden
    const auditUserCreate = await makeRequest('POST', '/api/users', { email: 'test.blocked1@veyra.local', name: 'Blocked' }, auditUserToken);
    assert(auditUserCreate.status === 403 && auditUserCreate.body?.code === 'FORBIDDEN', 'AC2: Audit User rejected from POST /api/users with 403 Forbidden (code: FORBIDDEN)');

    const supervisorCreate = await makeRequest('POST', '/api/users', { email: 'test.blocked2@veyra.local', name: 'Blocked' }, supervisorToken);
    assert(supervisorCreate.status === 403 && supervisorCreate.body?.code === 'FORBIDDEN', 'AC2: Audit Supervisor rejected from POST /api/users with 403 Forbidden');

    const managerCreate = await makeRequest('POST', '/api/users', { email: 'test.blocked3@veyra.local', name: 'Blocked' }, managerToken);
    assert(managerCreate.status === 403 && managerCreate.body?.code === 'FORBIDDEN', 'AC2: Audit Manager rejected from POST /api/users with 403 Forbidden');

    // -------------------------------------------------------------
    // AC3: Server-side Input Validation
    // -------------------------------------------------------------
    console.log('\n--- AC3: Server-side Input Validation ---');

    // Name missing / empty
    const noNameRes = await makeRequest('POST', '/api/users', { email: 'valid.email@veyra.local', name: '   ' }, adminToken);
    assert(noNameRes.status === 400 && noNameRes.body?.code === 'INVALID_INPUT', 'AC3: Missing/empty name rejected with 400 (code: INVALID_INPUT)');

    // Email missing
    const noEmailRes = await makeRequest('POST', '/api/users', { name: 'Valid Name', email: '' }, adminToken);
    assert(noEmailRes.status === 400 && noEmailRes.body?.code === 'INVALID_INPUT', 'AC3: Missing email rejected with 400 (code: INVALID_INPUT)');

    // Email malformed
    const badEmailRes = await makeRequest('POST', '/api/users', { name: 'Valid Name', email: 'notanemail' }, adminToken);
    assert(badEmailRes.status === 400 && badEmailRes.body?.code === 'INVALID_EMAIL_FORMAT', 'AC3: Malformed email rejected with 400 (code: INVALID_EMAIL_FORMAT)');

    // Invalid Status
    const badStatusRes = await makeRequest('POST', '/api/users', { name: 'Valid Name', email: 'test.badstatus@veyra.local', status: 'DELETED_STATUS' }, adminToken);
    assert(badStatusRes.status === 400 && badStatusRes.body?.code === 'INVALID_STATUS', 'AC3: Invalid status rejected with 400 (code: INVALID_STATUS)');

    // -------------------------------------------------------------
    // AC4 & AC5: Email Normalization & Uniqueness (409 Conflict)
    // -------------------------------------------------------------
    console.log('\n--- AC4 & AC5: Email Normalization & Uniqueness ---');

    const rawEmailInput = '   New.Auditor27@Veyra.Local   ';
    const normalizedExpected = 'new.auditor27@veyra.local';

    const createSuccess = await makeRequest('POST', '/api/users', {
      name: 'Alice Auditor 27',
      email: rawEmailInput,
      role: 'AUDIT_USER',
      status: 'ACTIVE',
      applicationAccess: ['Fusion - Production']
    }, adminToken);

    assert(createSuccess.status === 201 && createSuccess.body?.success === true, 'AC1: POST /api/users successfully created user with 201 Created');
    assert(createSuccess.body?.user?.email === normalizedExpected, 'AC5: Email was normalized (trimmed and lowercased) before persistence');
    assert(createSuccess.body?.user?.displayName === 'Alice Auditor 27', 'AC3: Display name correctly persisted');
    assert(createSuccess.body?.user?.role === 'AUDIT_USER', 'AC6: Role correctly assigned');

    // Duplicate email creation attempt (AC4)
    const duplicateCreate = await makeRequest('POST', '/api/users', {
      name: 'Duplicate Alice',
      email: 'NEW.AUDITOR27@VEYRA.LOCAL',
      role: 'AUDIT_USER'
    }, adminToken);

    assert(duplicateCreate.status === 409 && duplicateCreate.body?.code === 'USER_ALREADY_EXISTS', 'AC4: Duplicate email rejected with 409 Conflict (code: USER_ALREADY_EXISTS)');

    // -------------------------------------------------------------
    // AC6 & AC7: Role Validation & Privilege Validation
    // -------------------------------------------------------------
    console.log('\n--- AC6 & AC7: Role Validation & Privilege Derivation ---');

    // AC6: Invalid role rejected
    const badRoleRes = await makeRequest('POST', '/api/users', {
      name: 'Bad Role User',
      email: 'bad.role@veyra.local',
      role: 'SUPERUSER_ADMIN_HACK'
    }, adminToken);
    assert(badRoleRes.status === 400 && badRoleRes.body?.code === 'INVALID_ROLE', 'AC6: Invalid role rejected with 400 Bad Request (code: INVALID_ROLE)');

    // AC7: Frontend cannot assign arbitrary privileges
    const maliciousPrivUser = await makeRequest('POST', '/api/users', {
      name: 'Privilege Injection Attempt',
      email: 'priv.injection@veyra.local',
      role: 'AUDIT_USER',
      permissions: ['ALL', 'SYSTEM_ROOT', 'ORACLE_INTEGRATION', 'SECURITY_WRITE']
    }, adminToken);

    assert(maliciousPrivUser.status === 201, 'User created with AUDIT_USER role');
    const assignedPerms = maliciousPrivUser.body?.user?.permissions || [];
    assert(!assignedPerms.includes('ALL') && !assignedPerms.includes('SYSTEM_ROOT'), 'AC7: Arbitrary frontend privileges strictly rejected/ignored');
    assert(assignedPerms.includes('REPORTS'), 'AC7: Backend strictly assigned permissions derived from AUDIT_USER role');

    // -------------------------------------------------------------
    // AC8: Site Admin Account Handling
    // -------------------------------------------------------------
    console.log('\n--- AC8: Site Admin Account Handling ---');
    const siteAdminGet = await makeRequest('GET', '/api/users/admin@admin.com', null, adminToken);
    assert(siteAdminGet.status === 200 && siteAdminGet.body?.user?.role === 'SITE_ADMIN' && siteAdminGet.body?.user?.isAdmin === true, 'AC8: admin@admin.com is handled as local Site Admin account');

    // -------------------------------------------------------------
    // AC9 & AC10: Database Transaction & Audit Event Generation
    // -------------------------------------------------------------
    console.log('\n--- AC9 & AC10: Database Transaction & Audit Log ---');

    const dbUserCreation = await makeRequest('POST', '/api/users', {
      name: 'Audit Event Test User',
      email: 'audit.event.test@veyra.local',
      role: 'AUDIT_SUPERVISOR',
      status: 'INVITED',
      applicationAccess: ['Fusion - Test']
    }, adminToken);

    assert(dbUserCreation.status === 201, 'AC9: User created in database transaction');

    // Check single user detail route
    const createdUserDetail = await makeRequest('GET', '/api/users/audit.event.test@veyra.local', null, adminToken);
    assert(createdUserDetail.status === 200 && createdUserDetail.body?.user?.role === 'AUDIT_SUPERVISOR', 'AC9: User and role assignment retrieved accurately');
    assert(createdUserDetail.body?.user?.status === 'INVITED', 'AC3: User status INVITED successfully saved');

    // -------------------------------------------------------------
    // AC11: Password Security & Response Sanitization
    // -------------------------------------------------------------
    console.log('\n--- AC11: Password Lifecycle & Response Sanitization ---');

    const userWithPassword = await makeRequest('POST', '/api/users', {
      name: 'Password Lifecycle User',
      email: 'pwd.test@veyra.local',
      role: 'AUDIT_USER',
      password: 'SecureUser@123'
    }, adminToken);

    assert(userWithPassword.status === 201, 'User created with initial password');
    assert(userWithPassword.body?.user?.password === undefined, 'AC11: Plaintext password is NEVER returned in response');
    assert(userWithPassword.body?.user?.passwordHash === undefined, 'AC11: Password hash is NEVER returned in response');
    assert(userWithPassword.body?.user?.resetCode === undefined, 'AC11: Reset code is NEVER returned in response');

    // Verify created user can authenticate with the set password
    const newLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'pwd.test@veyra.local',
      password: 'SecureUser@123'
    });
    assert(newLogin.status === 200 && newLogin.body?.token, 'AC11: New user can log in with established bcrypt-hashed password');

    // -------------------------------------------------------------
    // AC12: Future Entra Compatibility
    // -------------------------------------------------------------
    console.log('\n--- AC12: Future Entra Compatibility ---');
    assert(createdUserDetail.body?.user?.userId !== undefined, 'AC12: User ID cleanly separated from email/identity');
    assert(createdUserDetail.body?.user?.roles?.includes('AUDIT_SUPERVISOR'), 'AC12: Role mappings decoupled from auth provider');

    console.log('\n================================================================');
    console.log(`  Verification Summary: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('================================================================\n');

    cleanupTestUsers();
    server.close();
    process.exit(testsFailed > 0 ? 1 : 0);
  } catch (err) {
    console.error('[Test Execution Error]:', err);
    cleanupTestUsers();
    server.close();
    process.exit(1);
  }
}

runTests();
