/**
 * Automated Verification Suite: Story VYR-061
 * Epic 7: Security, branch, regression and release testing
 * Story Title: Regression-test core Veyra modules and existing API contracts
 *
 * Acceptance Criteria Verified:
 *  1. All in-scope workflows pass in both branches (AI-free & AI-enabled).
 *  2. No unauthorized data exposure or material API regression.
 *  3. Changed contracts are documented and versioned.
 *
 * Test Sections:
 *  1.  Login, JWT Contract, Session Refresh & Logout Lifecycle
 *  2.  Dashboard Workflows & Role Scoping (Site Admin, Audit Manager, Audit Supervisor, Audit User)
 *  3.  Users Management Module (List, Detail, Scopes, Create, Update, Delete & Escalation Guards)
 *  4.  Roles, Privileges & Entitlement Catalog Module
 *  5.  Audit Trail Module (Products, Query, Sync & Validation)
 *  6.  Advanced Controls, Incidents, SoD & Access Certifications
 *  7.  Reports Module (Query, Generate, Detail, Download, Role Hierarchy, User Access, Control Summary)
 *  8.  Oracle Settings, Secrets Sanitization & API Command Center
 *  9.  Investigation Workflows (Snapshot Save & Retrieve)
 * 10.  Pre- vs Post-Encryption API DTO Parity & Zero Crypto/Secret Exposure
 * 11.  OWASP Auth/Privilege Boundaries, Error Handling, Headers & Tenant Isolation
 * 12.  Branch Variant Verification (AI-Free vs AI-Enabled) & Contract Documentation Check
 *
 * Run: npm --prefix backend run test:vyr61
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const assert = require('assert');
const dotenv = require('dotenv');

function deepEqual(a, b) {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

const repoRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.resolve(repoRoot, '.env') });
dotenv.config({ path: path.resolve(repoRoot, 'backend/.env') });

process.env.AUTH_PROVIDER = 'LOCAL';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.API_RATE_LIMIT_MAX = '500';
if (!process.env.DATABASE_URL && !process.env.DATABASE_URI) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/veyra_db';
}

const TEST_PORT = 5061;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let passed = 0;
let failed = 0;
let skipped = 0;
const sections = [];
let currentSection = null;

function report(condition, message, details) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    if (details !== undefined) {
      console.error('        Details:', typeof details === 'object' ? JSON.stringify(details) : details);
    }
    failed++;
  }
}

function skip(message) {
  console.log(`  SKIP: ${message}`);
  skipped++;
}

function section(name) {
  currentSection = { name, startPassed: passed, startFailed: failed, startSkipped: skipped };
  console.log(`\n--- ${name} ---`);
}

function sectionEnd() {
  if (currentSection) {
    sections.push({
      name: currentSection.name,
      passed: passed - currentSection.startPassed,
      failed: failed - currentSection.startFailed,
      skipped: skipped - currentSection.startSkipped,
    });
    currentSection = null;
  }
}

function dist(rel) {
  return path.join(__dirname, '..', 'dist', rel);
}

function requireDist(rel) {
  const file = dist(rel);
  if (!fs.existsSync(file)) {
    throw new Error(`Build output missing: ${file}. Run "npm --prefix backend run build" first.`);
  }
  return require(file);
}

function makeRequest(method, reqPath, body = null, token = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, BASE_URL);
    const headers = { ...extraHeaders };
    if (body !== null && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const rawBody =
      body === null
        ? null
        : typeof body === 'string'
          ? body
          : JSON.stringify(body);

    if (rawBody !== null) {
      headers['Content-Length'] = Buffer.byteLength(rawBody);
    }

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch (_) {
            parsed = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw });
        });
      }
    );

    req.on('error', reject);
    if (rawBody !== null) req.write(rawBody);
    req.end();
  });
}

// Sensitive / encrypted container keys that must NEVER leak in decrypted API DTOs
const FORBIDDEN_CRYPTO_AND_SECRET_KEYS = [
  'encryptedDek',
  'ciphertext',
  'authTag',
  'nonce',
  'passwordHash',
  'password_hash',
  'resetCode',
  'privateKey',
  'clientSecret',
  'encryptionKey',
  'TOGETHER_API_KEY',
  'GROQ_API_KEY',
];

function findForbiddenKeys(obj, prefix = '') {
  const found = [];
  if (!obj || typeof obj !== 'object') return found;
  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 25); i++) {
      found.push(...findForbiddenKeys(obj[i], `${prefix}[${i}]`));
    }
    return found;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (FORBIDDEN_CRYPTO_AND_SECRET_KEYS.includes(k)) {
      found.push(`${prefix ? `${prefix}.` : ''}${k}`);
    }
    // Also detect EncryptedPayload shape anywhere in response
    if (
      k === 'formatVersion' &&
      obj.algorithm === 'AES-256-GCM' &&
      typeof obj.ciphertext === 'string'
    ) {
      found.push(`${prefix || 'root'}<EncryptedPayload>`);
    }
    if (v && typeof v === 'object') {
      found.push(...findForbiddenKeys(v, `${prefix ? `${prefix}.` : ''}${k}`));
    }
  }
  return found;
}

function assertCleanDto(res, label) {
  const leaks = findForbiddenKeys(res?.data);
  report(leaks.length === 0, `${label}: zero crypto/secret fields in API DTO`, leaks);
}

async function main() {
  console.log('================================================================');
  console.log('  VYR-061: Core Veyra Modules & API Contract Regression Suite');
  console.log('================================================================\n');

  const express = require('../node_modules/express');
  const jose = require('../node_modules/jose');
  const { Pool } = require('pg');

  const { apiRouter } = requireDist('routes/api.js');
  const { authService } = requireDist('services/authService.js');
  const { query: dbQuery } = requireDist('db.js');
  const { initializeAuthProvider, keyManager } = requireDist('auth/index.js');
  const { VEYRA_JWT_ALGORITHM, VEYRA_JWT_TYPE, VEYRA_JWT_FORBIDDEN_CLAIMS } = requireDist('auth/jwtContract.js');
  const { corsMiddleware, securityHeadersMiddleware } = requireDist('security/securityHeadersService.js');
  const { rateLimitService } = requireDist('security/rateLimitService.js');

  // Detect branch variant dynamically so the same suite passes on both AI-Free & AI-Enabled
  const isAiEnabledBranch =
    fs.existsSync(path.join(repoRoot, 'backend/src/ai/orchestrator.ts')) &&
    fs.existsSync(path.join(repoRoot, 'frontend/src/pages/Assistant.tsx'));
  console.log(`[Variant] Detected branch variant: ${isAiEnabledBranch ? 'AI-ENABLED (AskVeyra retained)' : 'AI-FREE (Standard)'}\n`);

  // Ensure auth provider & rate limiter are initialized cleanly
  initializeAuthProvider();
  rateLimitService.resetAll();

  // Clear stale active sessions in DB before test run
  await dbQuery("UPDATE veyra_session SET status = 'EXPIRED' WHERE status = 'ACTIVE'").catch(() => {});
  if (typeof authService._clearActiveSessions === 'function') {
    authService._clearActiveSessions();
  }

  // Mount production middleware stack matching backend/src/index.ts
  const app = express();
  app.use(securityHeadersMiddleware);
  app.use(corsMiddleware);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ limit: '2mb', extended: true }));
  app.get(['/health', '/api/health'], (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });
  app.get(['/.well-known/jwks.json', '/api/.well-known/jwks.json'], async (_req, res) => {
    const jwks = await keyManager.getJwks();
    res.status(200).json(jwks);
  });
  app.use('/api', (req, res, next) => {
    if (!res.getHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
    }
    next();
  });
  app.use('/api', apiRouter);
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `API endpoint ${req.method} ${req.path} does not exist.`,
    });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  console.log(`[Test Server] Listening on ${BASE_URL}\n`);

  const runSuffix = crypto.randomBytes(4).toString('hex');
  const ephemeralEmails = [];
  const createdSavedRequestIds = [];
  let adminToken = null;
  let mgrToken = null;
  let supToken = null;
  let userToken = null;
  const capturedDtos = {};

  try {
    // =========================================================================
    // SECTION 1: Login, JWT Contract, Session Refresh & Logout Lifecycle
    // =========================================================================
    section('Section 1: Login, JWT Contract & Session Lifecycle');

    const healthRes = await makeRequest('GET', '/api/health');
    report(healthRes.status === 200 && healthRes.data?.status === 'ok', 'GET /api/health returns 200 ok');

    const providerRes = await makeRequest('GET', '/api/auth/provider');
    report(providerRes.status === 200 && providerRes.data?.success === true && providerRes.data?.provider?.type === 'LOCAL',
      'GET /api/auth/provider returns LOCAL provider metadata');

    const authConfigRes = await makeRequest('GET', '/api/auth/config');
    report(
      authConfigRes.status === 200 &&
      authConfigRes.data?.success === true &&
      authConfigRes.data?.provider === 'LOCAL' &&
      authConfigRes.data?.entraEnabled === false &&
      typeof authConfigRes.data?.sessionTimeoutMinutes === 'number',
      'GET /api/auth/config returns safe non-secret bootstrap contract'
    );

    const jwksRes = await makeRequest('GET', '/api/.well-known/jwks.json');
    report(jwksRes.status === 200 && Array.isArray(jwksRes.data?.keys) && jwksRes.data.keys.length >= 1,
      'GET /api/.well-known/jwks.json returns RFC 7517 public key set');

    // Negative login checks (contract & OWASP)
    const badPassRes = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@admin.com',
      password: 'WrongPassword!123',
    });
    report(badPassRes.status === 401 && badPassRes.data?.success === false,
      'POST /api/auth/login rejects wrong password with 401', badPassRes.status);

    const invalidSchemaRes = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@admin.com',
    });
    report(invalidSchemaRes.status === 422 && invalidSchemaRes.data?.code === 'VALIDATION_ERROR',
      'POST /api/auth/login rejects missing password with 422 VALIDATION_ERROR (VYR-049 contract)');

    const massAssignRes = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@admin.com',
      password: 'Admin@123',
      isAdmin: true,
    });
    report(massAssignRes.status === 422 && massAssignRes.data?.code === 'VALIDATION_ERROR',
      'POST /api/auth/login rejects unknown mass-assignment field via strict schema');

    const overrideProviderRes = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@admin.com',
      password: 'Admin@123',
      provider: 'ENTRA',
    });
    report(overrideProviderRes.status === 400 && overrideProviderRes.data?.code === 'PROVIDER_OVERRIDE_REJECTED',
      'POST /api/auth/login rejects client provider override with 400 PROVIDER_OVERRIDE_REJECTED');

    rateLimitService.resetAll();

    // Authenticate Site Admin
    const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@123';
    const adminLoginRes = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@admin.com',
      password: adminPassword,
      force: true,
    });
    adminToken = adminLoginRes.data?.token;
    capturedDtos.login = adminLoginRes.data;
    report(
      adminLoginRes.status === 200 &&
      adminLoginRes.data?.success === true &&
      typeof adminToken === 'string' &&
      adminLoginRes.data?.accessToken === adminToken &&
      adminLoginRes.data?.role === 'SITE_ADMIN' &&
      adminLoginRes.data?.isAdmin === true &&
      Array.isArray(adminLoginRes.data?.permissions) &&
      adminLoginRes.data?.authProvider === 'LOCAL',
      'POST /api/auth/login (SITE_ADMIN) returns unified JWT login DTO',
      { status: adminLoginRes.status, msg: adminLoginRes.data?.message }
    );
    assertCleanDto(adminLoginRes, 'POST /api/auth/login');

    if (adminToken) {
      const hdr = jose.decodeProtectedHeader(adminToken);
      const claims = jose.decodeJwt(adminToken);
      const hasForbiddenClaim = VEYRA_JWT_FORBIDDEN_CLAIMS.some((c) => claims[c] !== undefined);
      report(
        hdr.alg === VEYRA_JWT_ALGORITHM &&
        hdr.typ === VEYRA_JWT_TYPE &&
        Boolean(hdr.kid) &&
        Boolean(claims.sub) &&
        Boolean(claims.sid) &&
        Boolean(claims.jti) &&
        !hasForbiddenClaim,
        'Issued Veyra JWT satisfies RS256 at+jwt header and minimal non-PII claims contract'
      );
    }

    // Provision deterministic ephemeral personas for AUDIT_MANAGER, AUDIT_SUPERVISOR, AUDIT_USER
    const personaPass = `Vyr061!Pass_${runSuffix}`;
    const personaSpecs = [
      { key: 'mgr', role: 'AUDIT_MANAGER', email: `vyr061.mgr.${runSuffix}@claaps.com`, name: 'VYR061 Manager' },
      { key: 'sup', role: 'AUDIT_SUPERVISOR', email: `vyr061.sup.${runSuffix}@claaps.com`, name: 'VYR061 Supervisor' },
      { key: 'usr', role: 'AUDIT_USER', email: `vyr061.usr.${runSuffix}@claaps.com`, name: 'VYR061 Audit User' },
    ];
    const personaTokens = {};
    const personaIds = {};

    for (const p of personaSpecs) {
      const createRes = await makeRequest(
        'POST',
        '/api/users',
        {
          email: p.email,
          displayName: p.name,
          role: p.role,
          password: personaPass,
          status: 'ACTIVE',
        },
        adminToken
      );
      if (createRes.status === 201 && createRes.data?.user) {
        ephemeralEmails.push(p.email);
        personaIds[p.key] = createRes.data.user.userId || createRes.data.user.id || p.email;
      }
      report(createRes.status === 201, `Provisioned ephemeral ${p.role} persona via POST /api/users`);

      const loginRes = await makeRequest('POST', '/api/auth/login', {
        email: p.email,
        password: personaPass,
        force: true,
      });
      personaTokens[p.key] = loginRes.data?.token;
      report(loginRes.status === 200 && loginRes.data?.role === p.role && Boolean(personaTokens[p.key]),
        `Authenticated ephemeral ${p.role} persona via POST /api/auth/login`);
    }

    mgrToken = personaTokens.mgr;
    supToken = personaTokens.sup;
    userToken = personaTokens.usr;

    // Session status & refresh
    const statusRes = await makeRequest('GET', '/api/auth/status', null, mgrToken);
    capturedDtos.authStatus = statusRes.data;
    report(
      statusRes.status === 200 &&
      statusRes.data?.loggedIn === true &&
      statusRes.data?.role === 'AUDIT_MANAGER' &&
      typeof statusRes.data?.sessionTimeoutMinutes === 'number',
      'GET /api/auth/status returns active session claims DTO'
    );

    const refreshRes = await makeRequest('POST', '/api/auth/refresh', {}, mgrToken);
    report(
      refreshRes.status === 200 &&
      refreshRes.data?.success === true &&
      typeof refreshRes.data?.accessToken === 'string' &&
      typeof refreshRes.data?.lastActivityAt === 'number',
      'POST /api/auth/refresh renews session and returns fresh JWT'
    );
    if (refreshRes.data?.accessToken) {
      mgrToken = refreshRes.data.accessToken;
    }

    const capsRes = await makeRequest('GET', '/api/capabilities', null, adminToken);
    report(
      capsRes.status === 200 &&
      capsRes.data?.users === true &&
      capsRes.data?.roles === true &&
      capsRes.data?.audit === true,
      'GET /api/capabilities returns platform feature flags DTO'
    );

    // Logout revocation test using an ephemeral throwaway account
    const logoutEmail = `vyr061.logout.${runSuffix}@claaps.com`;
    await makeRequest('POST', '/api/users', {
      email: logoutEmail,
      displayName: 'VYR061 Logout Test',
      role: 'AUDIT_USER',
      password: personaPass,
      status: 'ACTIVE',
    }, adminToken);
    ephemeralEmails.push(logoutEmail);

    const logoutLoginRes = await makeRequest('POST', '/api/auth/login', {
      email: logoutEmail,
      password: personaPass,
      force: true,
    });
    const logoutJwt = logoutLoginRes.data?.token;
    const logoutRes = await makeRequest('POST', '/api/auth/logout', {}, logoutJwt);
    report(
      logoutRes.status === 200 &&
      logoutRes.data?.success === true &&
      logoutRes.data?.localLogout === true &&
      logoutRes.data?.sessionInvalidated === true,
      'POST /api/auth/logout returns unified session invalidation DTO'
    );
    const postLogoutStatus = await makeRequest('GET', '/api/auth/status', null, logoutJwt);
    report(postLogoutStatus.status === 401, 'Revoked JWT is rejected with 401 after logout');

    sectionEnd();

    // =========================================================================
    // SECTION 2: Dashboard Workflows & Role Scoping
    // =========================================================================
    section('Section 2: Dashboard Workflows & Role Scoping');

    const adminDash = await makeRequest('GET', '/api/dashboard/admin', null, adminToken);
    const siteAdminDash = await makeRequest('GET', '/api/dashboard/site-admin', null, adminToken);
    capturedDtos.adminDashboard = adminDash.data;
    report(adminDash.status === 200 && adminDash.data?.success === true, 'GET /api/dashboard/admin returns 200 for SITE_ADMIN');
    report(siteAdminDash.status === 200 && siteAdminDash.data?.success === true, 'GET /api/dashboard/site-admin alias returns 200');
    report(
      (await makeRequest('GET', '/api/dashboard/admin', null, mgrToken)).status === 403 &&
      (await makeRequest('GET', '/api/dashboard/site-admin', null, userToken)).status === 403,
      'Admin dashboard rejects non-SITE_ADMIN roles with 403'
    );
    assertCleanDto(adminDash, 'GET /api/dashboard/admin');

    const mgrDash = await makeRequest('GET', '/api/dashboard/audit-manager', null, mgrToken);
    const overviewStats = await makeRequest('GET', '/api/overview/stats', null, mgrToken);
    const riskTrend = await makeRequest('GET', '/api/dashboard/risk-trend', null, mgrToken);
    const prodActivity = await makeRequest('GET', '/api/dashboard/product-activity', null, mgrToken);
    capturedDtos.managerDashboard = mgrDash.data;

    report(
      mgrDash.status === 200 &&
      mgrDash.data?.success === true &&
      mgrDash.data?.data !== undefined &&
      mgrDash.data?.userScope !== undefined,
      'GET /api/dashboard/audit-manager returns data & userScope DTO'
    );
    report(overviewStats.status === 200 && overviewStats.data?.success === true, 'GET /api/overview/stats returns 200');
    report(riskTrend.status === 200 && riskTrend.data?.success === true, 'GET /api/dashboard/risk-trend returns 200');
    report(prodActivity.status === 200 && prodActivity.data?.success === true, 'GET /api/dashboard/product-activity returns 200');
    report(
      (await makeRequest('GET', '/api/dashboard/audit-manager', null, userToken)).status === 403,
      'Audit Manager dashboard rejects AUDIT_USER with 403'
    );
    assertCleanDto(mgrDash, 'GET /api/dashboard/audit-manager');

    // Supervisor dashboard & DB endpoints
    const supDash = await makeRequest('GET', '/api/dashboard/audit-supervisor', null, supToken);
    const supHistory = await makeRequest('GET', '/api/dashboard/history', null, supToken);
    const supDbSummary = await makeRequest('GET', '/api/dashboard/audit-supervisor/db/summary', null, supToken);
    const supDbRisk = await makeRequest('GET', '/api/dashboard/audit-supervisor/db/risk', null, supToken);
    const supDbReports = await makeRequest('GET', '/api/dashboard/audit-supervisor/db/reports', null, supToken);
    const supDbAudit = await makeRequest('GET', '/api/dashboard/audit-supervisor/db/audit', null, supToken);
    const supDbEvents = await makeRequest('GET', '/api/dashboard/audit-supervisor/db/audit-events', null, supToken);

    report(supDash.status === 200 && supDash.data?.success === true, 'GET /api/dashboard/audit-supervisor returns 200');
    report(supDash.data?.userScope?.hasAskVeyraAccess === false && supDash.data?.userScope?.features?.askVeyra === false,
      'Audit Supervisor dashboard strictly disables AskVeyra access across both variants');
    report(supHistory.status === 200 && supHistory.data?.success === true, 'GET /api/dashboard/history returns 200');
    report(supDbSummary.status === 200 && supDbSummary.data?.success === true, 'GET /api/dashboard/audit-supervisor/db/summary returns 200');
    report(supDbRisk.status === 200 && Array.isArray(supDbRisk.data?.data), 'GET /api/dashboard/audit-supervisor/db/risk returns 200');
    report(supDbReports.status === 200 && Array.isArray(supDbReports.data?.data), 'GET /api/dashboard/audit-supervisor/db/reports returns 200');
    report(supDbAudit.status === 200 && Array.isArray(supDbAudit.data?.data), 'GET /api/dashboard/audit-supervisor/db/audit returns 200');
    report(supDbEvents.status === 200 && Array.isArray(supDbEvents.data?.data), 'GET /api/dashboard/audit-supervisor/db/audit-events returns 200');
    report(
      (await makeRequest('GET', '/api/dashboard/audit-supervisor', null, userToken)).status === 403,
      'Audit Supervisor dashboard rejects AUDIT_USER with 403'
    );

    // Reports-only / Audit User dashboard
    const usrDash = await makeRequest('GET', '/api/dashboard/reports-only', null, userToken);
    const usrDashAlias = await makeRequest('GET', '/api/dashboard/audit-user', null, userToken);
    report(usrDash.status === 200 && usrDash.data?.success === true, 'GET /api/dashboard/reports-only returns 200 for AUDIT_USER');
    report(usrDashAlias.status === 200 && usrDashAlias.data?.success === true, 'GET /api/dashboard/audit-user alias returns 200');

    sectionEnd();

    // =========================================================================
    // SECTION 3: Users Management Module & Privilege Boundaries
    // =========================================================================
    section('Section 3: Users Management Module');

    const usersListRes = await makeRequest('GET', '/api/users?page=1&pageSize=10', null, adminToken);
    capturedDtos.usersList = usersListRes.data;
    report(
      usersListRes.status === 200 &&
      usersListRes.data?.success === true &&
      Array.isArray(usersListRes.data?.users) &&
      typeof usersListRes.data?.total === 'number',
      'GET /api/users returns paginated user DTO'
    );
    assertCleanDto(usersListRes, 'GET /api/users');

    const usersDbRes = await makeRequest('GET', '/api/users?source=database&count=10', null, adminToken);
    report(
      usersDbRes.status === 200 && usersDbRes.data?.success === true && Array.isArray(usersDbRes.data?.users),
      'GET /api/users?source=database returns PostgreSQL directory users DTO'
    );
    assertCleanDto(usersDbRes, 'GET /api/users?source=database');

    const singleUserRes = await makeRequest('GET', `/api/users/${encodeURIComponent('admin@admin.com')}`, null, adminToken);
    report(
      singleUserRes.status === 200 && singleUserRes.data?.success === true && singleUserRes.data?.user?.email === 'admin@admin.com',
      'GET /api/users/:id returns single user DTO'
    );
    assertCleanDto(singleUserRes, 'GET /api/users/:id');

    const scopesRes = await makeRequest('GET', `/api/users/${encodeURIComponent('admin@admin.com')}/scopes`, null, adminToken);
    report(scopesRes.status === 200 && scopesRes.data?.success === true && Array.isArray(scopesRes.data?.scopes),
      'GET /api/users/:id/scopes returns 200');

    const adminUsersRes = await makeRequest('GET', '/api/admin/users', null, adminToken);
    const adminUsersSummaryRes = await makeRequest('GET', '/api/admin/users/summary', null, adminToken);
    report(adminUsersRes.status === 200 && Array.isArray(adminUsersRes.data?.users), 'GET /api/admin/users returns safe users list');
    report(adminUsersSummaryRes.status === 200 && typeof adminUsersSummaryRes.data?.total === 'number', 'GET /api/admin/users/summary returns 200');
    assertCleanDto(adminUsersRes, 'GET /api/admin/users');

    // RBAC guards on users endpoints
    report((await makeRequest('GET', '/api/users', null, userToken)).status === 403, 'GET /api/users denies AUDIT_USER with 403');
    report((await makeRequest('GET', '/api/admin/users', null, mgrToken)).status === 403, 'GET /api/admin/users denies AUDIT_MANAGER without USER_MANAGEMENT (403)');
    report((await makeRequest('POST', '/api/users', { email: 'blocked@claaps.com', role: 'AUDIT_USER' }, mgrToken)).status === 403,
      'POST /api/users denies non-USER_MANAGEMENT caller with 403');

    // Self-deletion guard & user CRUD round-trip
    const selfDeleteRes = await makeRequest('DELETE', `/api/users/${encodeURIComponent('admin@admin.com')}`, null, adminToken);
    report(selfDeleteRes.status === 403 && selfDeleteRes.data?.code === 'SELF_DELETE_FORBIDDEN',
      'DELETE /api/users/:id blocks admin self-deletion with 403 SELF_DELETE_FORBIDDEN');

    const crudEmail = `vyr061.crud.${runSuffix}@claaps.com`;
    const crudCreate = await makeRequest('POST', '/api/users', {
      email: crudEmail,
      displayName: 'VYR061 CRUD User',
      role: 'AUDIT_USER',
      password: personaPass,
      status: 'ACTIVE',
    }, adminToken);
    ephemeralEmails.push(crudEmail);
    const crudUserId = crudCreate.data?.user?.userId || crudCreate.data?.user?.id || crudEmail;
    report(crudCreate.status === 201 && crudCreate.data?.success === true, 'POST /api/users creates user (201)');

    const crudUpdate = await makeRequest('PUT', `/api/users/${encodeURIComponent(crudUserId)}`, {
      displayName: 'VYR061 CRUD Updated',
      role: 'AUDIT_SUPERVISOR',
    }, adminToken);
    report(crudUpdate.status === 200 && crudUpdate.data?.success === true, 'PUT /api/users/:id updates user (200)');

    const crudDelete = await makeRequest('DELETE', `/api/users/${encodeURIComponent(crudUserId)}`, null, adminToken);
    report(crudDelete.status === 200 && crudDelete.data?.success === true, 'DELETE /api/users/:id deletes user (200)');

    sectionEnd();

    // =========================================================================
    // SECTION 4: Roles, Privileges & Entitlement Catalog Module
    // =========================================================================
    section('Section 4: Roles, Privileges & Entitlement Catalog');

    const rolesRes = await makeRequest('GET', '/api/roles?count=10', null, mgrToken);
    capturedDtos.roles = rolesRes.data;
    report(rolesRes.status === 200 && Array.isArray(rolesRes.data?.roles), 'GET /api/roles returns roles list DTO');
    assertCleanDto(rolesRes, 'GET /api/roles');

    const firstRoleCode = rolesRes.data?.roles?.[0]?.roleCode || rolesRes.data?.roles?.[0]?.id;
    if (firstRoleCode) {
      const singleRole = await makeRequest('GET', `/api/roles/single?identifier=${encodeURIComponent(firstRoleCode)}`, null, mgrToken);
      const roleById = await makeRequest('GET', `/api/roles/${encodeURIComponent(firstRoleCode)}`, null, mgrToken);
      report(singleRole.status === 200 && Boolean(singleRole.data?.role), 'GET /api/roles/single returns matching role DTO');
      report(roleById.status === 200 && roleById.data?.success === true, 'GET /api/roles/:id returns matching role DTO');
    } else {
      skip('No cached roles present in oracle_roles_cache.json; skipping single-role lookup check');
    }

    const missingRoleParam = await makeRequest('GET', '/api/roles/single', null, mgrToken);
    report(missingRoleParam.status === 400, 'GET /api/roles/single without identifier returns 400');

    const unknownRole = await makeRequest('GET', '/api/roles/NONEXISTENT_ROLE_VYR061', null, mgrToken);
    report(unknownRole.status === 404, 'GET /api/roles/:id for unknown role returns 404');

    const privsRes = await makeRequest('GET', '/api/privileges', null, mgrToken);
    report(privsRes.status === 200 && privsRes.data?.success === true && Array.isArray(privsRes.data?.privileges),
      'GET /api/privileges returns privilege catalog DTO');

    const rolePrivMeta = await makeRequest('GET', '/api/catalog/role-privileges', null, mgrToken);
    const privRolesMeta = await makeRequest('GET', '/api/privilege-roles/metadata', null, mgrToken);
    report(rolePrivMeta.status === 200 && rolePrivMeta.data?.success === true, 'GET /api/catalog/role-privileges returns 200');
    report(privRolesMeta.status === 200, 'GET /api/privilege-roles/metadata returns 200');

    report((await makeRequest('GET', '/api/catalog/role-privileges/roles-by-privilege', null, mgrToken)).status === 400,
      'GET /api/catalog/role-privileges/roles-by-privilege requires query param (400)');
    report((await makeRequest('GET', '/api/catalog/role-privileges/privileges-by-role', null, mgrToken)).status === 400,
      'GET /api/catalog/role-privileges/privileges-by-role requires query param (400)');
    report((await makeRequest('GET', '/api/catalog/users-by-privilege?privilege=NONEXISTENT_PRIV', null, mgrToken)).status === 200,
      'GET /api/catalog/users-by-privilege returns 200 entitlement DTO');
    report((await makeRequest('GET', '/api/catalog/privileges-by-user?username=NONEXISTENT_USER', null, mgrToken)).status === 200,
      'GET /api/catalog/privileges-by-user returns 200 entitlement DTO');

    // RBAC checks
    report((await makeRequest('GET', '/api/roles', null, userToken)).status === 403, 'GET /api/roles denies AUDIT_USER with 403');
    report((await makeRequest('GET', '/api/privileges', null, userToken)).status === 403, 'GET /api/privileges denies AUDIT_USER with 403');

    sectionEnd();

    // =========================================================================
    // SECTION 5: Audit Trail Module
    // =========================================================================
    section('Section 5: Audit Trail Module');

    const auditProducts = await makeRequest('GET', '/api/audit/products', null, mgrToken);
    report(auditProducts.status === 200 && auditProducts.data?.success === true && Array.isArray(auditProducts.data?.products),
      'GET /api/audit/products returns audit catalog DTO');

    const auditDbGet = await makeRequest('GET', '/api/audit?source=database&pageNumber=1&pageSize=10', null, mgrToken);
    capturedDtos.audit = auditDbGet.data;
    report(
      auditDbGet.status === 200 &&
      typeof auditDbGet.data?.success === 'boolean' &&
      Array.isArray(auditDbGet.data?.logs),
      'GET /api/audit?source=database returns structured audit DTO'
    );
    assertCleanDto(auditDbGet, 'GET /api/audit');

    const auditPostQuery = await makeRequest('POST', '/api/audit/query', {
      product: 'Global Human Resources',
      page: 1,
      limit: 10,
    }, mgrToken);
    report(
      auditPostQuery.status === 200 &&
      typeof auditPostQuery.data?.success === 'boolean' &&
      Array.isArray(auditPostQuery.data?.logs),
      'POST /api/audit/query returns structured audit DTO'
    );

    const auditBadDate = await makeRequest('POST', '/api/audit/query', {
      fromDate: 'not-a-valid-date',
    }, mgrToken);
    report(auditBadDate.status === 422 && auditBadDate.data?.code === 'VALIDATION_ERROR',
      'POST /api/audit/query rejects malformed date with 422 VALIDATION_ERROR');

    const auditSyncAll = await makeRequest('POST', '/api/audit/sync', { product: '__ALL__' }, mgrToken);
    report(auditSyncAll.status === 200 && auditSyncAll.data?.success === true,
      'POST /api/audit/sync (__ALL__) returns 200 contract');

    const auditSyncProdMissing = await makeRequest('POST', '/api/audit/sync/product', {}, mgrToken);
    report(auditSyncProdMissing.status === 400, 'POST /api/audit/sync/product without product returns 400');

    // RBAC checks
    report((await makeRequest('GET', '/api/audit/products', null, userToken)).status === 403,
      'GET /api/audit/products denies AUDIT_USER with 403');
    report((await makeRequest('GET', '/api/audit', null, userToken)).status === 403,
      'GET /api/audit denies AUDIT_USER with 403');

    sectionEnd();

    // =========================================================================
    // SECTION 6: Advanced Controls, Incidents, SoD & Access Certifications
    // =========================================================================
    section('Section 6: Advanced Controls, Incidents & Access Certifications');

    const controlsRes = await makeRequest('GET', '/api/risk/controls?limit=10', null, mgrToken);
    const controlCountsRes = await makeRequest('GET', '/api/risk/controls/counts', null, mgrToken);
    const riskCapsRes = await makeRequest('GET', '/api/risk/capabilities', null, mgrToken);
    const sodRes = await makeRequest('GET', '/api/risk/sod', null, mgrToken);
    const incidentsRes = await makeRequest('GET', '/api/risk/incidents?limit=10', null, mgrToken);
    const topUsersRes = await makeRequest('GET', '/api/risk/incidents/top-users?limit=5', null, mgrToken);
    const topRolesRes = await makeRequest('GET', '/api/risk/incidents/top-roles?limit=5', null, mgrToken);
    const accessReqRes = await makeRequest('GET', '/api/risk/access-requests?limit=5', null, mgrToken);

    report(controlsRes.status === 200 && typeof controlsRes.data === 'object', 'GET /api/risk/controls returns 200 DTO');
    report(controlCountsRes.status === 200 && controlCountsRes.data?.success === true, 'GET /api/risk/controls/counts returns 200');
    report(riskCapsRes.status === 200 && riskCapsRes.data?.success === true, 'GET /api/risk/capabilities returns 200');
    report(sodRes.status === 200 && typeof sodRes.data === 'object', 'GET /api/risk/sod returns 200 contract');
    report(incidentsRes.status === 200 && typeof incidentsRes.data === 'object', 'GET /api/risk/incidents returns 200 DTO');
    report(topUsersRes.status === 200 && typeof topUsersRes.data === 'object', 'GET /api/risk/incidents/top-users returns 200 DTO');
    report(topRolesRes.status === 200 && typeof topRolesRes.data === 'object', 'GET /api/risk/incidents/top-roles returns 200 DTO');
    report(accessReqRes.status === 200 && typeof accessReqRes.data === 'object', 'GET /api/risk/access-requests returns 200 DTO');
    assertCleanDto(controlsRes, 'GET /api/risk/controls');
    assertCleanDto(incidentsRes, 'GET /api/risk/incidents');

    const policiesRes = await makeRequest('GET', '/api/sync/policies', null, mgrToken);
    report(policiesRes.status === 200 && policiesRes.data?.success === true && Array.isArray(policiesRes.data?.policies),
      'GET /api/sync/policies returns 200 policies DTO');
    const missingPolicyPut = await makeRequest('PUT', '/api/sync/policies/NONEXISTENT_PRODUCT', {
      autoSyncEnabled: false,
    }, adminToken);
    report(missingPolicyPut.status === 404, 'PUT /api/sync/policies/:productCode returns 404 for unknown product');

    // Access certifications: returns 200 from DB/BIP or 400/502 when Oracle BIP is unconfigured/unreachable
    const certsRes = await makeRequest('GET', '/api/access-certifications', null, mgrToken);
    const riskCertsRes = await makeRequest('GET', '/api/risk/certifications', null, mgrToken);
    report(
      [200, 400, 502].includes(certsRes.status) && typeof certsRes.data?.success === 'boolean',
      `GET /api/access-certifications returns valid contract (status: ${certsRes.status})`
    );
    report(
      [200, 400, 502].includes(riskCertsRes.status) && typeof riskCertsRes.data?.success === 'boolean',
      `GET /api/risk/certifications returns valid contract (status: ${riskCertsRes.status})`
    );
    assertCleanDto(certsRes, 'GET /api/access-certifications');

    // RBAC checks
    report((await makeRequest('GET', '/api/risk/controls', null, userToken)).status === 403,
      'GET /api/risk/controls denies AUDIT_USER with 403');
    report((await makeRequest('GET', '/api/risk/incidents', null, userToken)).status === 403,
      'GET /api/risk/incidents denies AUDIT_USER with 403');

    sectionEnd();

    // =========================================================================
    // SECTION 7: Reports Module
    // =========================================================================
    section('Section 7: Reports Module');

    const reportsList = await makeRequest('GET', '/api/reports?page=1&pageSize=10', null, userToken);
    const reportsDbList = await makeRequest('GET', '/api/reports/db?limit=10', null, userToken);
    const reportsOnlyDb = await makeRequest('GET', '/api/dashboard/reports-only/db/reports?limit=10', null, userToken);
    capturedDtos.reports = reportsList.data;

    report(reportsList.status === 200 && reportsList.data?.success === true && Array.isArray(reportsList.data?.reports),
      'GET /api/reports returns paginated reports DTO for AUDIT_USER');
    report(reportsDbList.status === 200 && reportsDbList.data?.success === true, 'GET /api/reports/db returns 200');
    report(reportsOnlyDb.status === 200 && reportsOnlyDb.data?.success === true, 'GET /api/dashboard/reports-only/db/reports returns 200');
    assertCleanDto(reportsList, 'GET /api/reports');

    // Validation + Generate + Detail + Download round-trip
    const badReport = await makeRequest('POST', '/api/reports', {}, userToken);
    report(badReport.status === 400 && badReport.data?.code === 'INVALID_PARAMETERS',
      'POST /api/reports without reportType returns 400 INVALID_PARAMETERS');

    const badFormatReport = await makeRequest('POST', '/api/reports', {
      reportType: 'USER_ACCESS',
      format: 'XML',
    }, userToken);
    report(badFormatReport.status === 422 && badFormatReport.data?.code === 'VALIDATION_ERROR',
      'POST /api/reports rejects unsupported format with 422 VALIDATION_ERROR');

    const genReport = await makeRequest('POST', '/api/reports', {
      reportType: 'USER_ACCESS',
      reportName: `VYR061 Regression Report ${runSuffix}`,
      format: 'json',
    }, userToken);
    report(
      genReport.status === 201 &&
      genReport.data?.success === true &&
      Boolean(genReport.data?.report?.reportId),
      'POST /api/reports generates report (201)', genReport.data
    );

    const createdReportId = genReport.data?.report?.reportId;
    if (createdReportId) {
      const detailRes = await makeRequest('GET', `/api/reports/${encodeURIComponent(createdReportId)}`, null, userToken);
      const dlRes = await makeRequest('GET', `/api/reports/${encodeURIComponent(createdReportId)}/download?json=true`, null, userToken);
      report(detailRes.status === 200 && detailRes.data?.report?.reportId === createdReportId,
        'GET /api/reports/:id retrieves generated report');
      report(dlRes.status === 200 && dlRes.data?.success === true && dlRes.data?.reportId === createdReportId,
        'GET /api/reports/:id/download?json=true downloads report DTO');
    }

    const missingReport = await makeRequest('GET', '/api/reports/RPT-NONEXISTENT-VYR061', null, userToken);
    report(missingReport.status === 404, 'GET /api/reports/:id returns 404 for nonexistent report');

    const roleHierRpt = await makeRequest('GET', '/api/reports/role-hierarchy', null, userToken);
    const userAccessRpt = await makeRequest('GET', '/api/reports/user-access', null, userToken);
    const rolePrivSumRpt = await makeRequest('GET', '/api/reports/role-privilege-summary', null, userToken);
    const ctrlSumRpt = await makeRequest('GET', '/api/risk/reports/control-summary', null, mgrToken);

    report(roleHierRpt.status === 200, 'GET /api/reports/role-hierarchy returns 200');
    report(userAccessRpt.status === 200 && userAccessRpt.data?.success === true, 'GET /api/reports/user-access returns 200');
    report(rolePrivSumRpt.status === 200, 'GET /api/reports/role-privilege-summary returns 200');
    report(ctrlSumRpt.status === 200, 'GET /api/risk/reports/control-summary returns 200');
    assertCleanDto(userAccessRpt, 'GET /api/reports/user-access');

    sectionEnd();

    // =========================================================================
    // SECTION 8: Oracle Settings, Secrets Sanitization & API Command Center
    // =========================================================================
    rateLimitService.resetAll();
    section('Section 8: Oracle Settings & API Command Center');

    const settingsRes = await makeRequest('GET', '/api/settings', null, adminToken);
    const adminOracleRes = await makeRequest('GET', '/api/admin/oracle/integration', null, adminToken);
    capturedDtos.settings = settingsRes.data;

    report(
      settingsRes.status === 200 &&
      settingsRes.data?.password === undefined &&
      settingsRes.data?.token === undefined &&
      settingsRes.data?.geminiApiKey === undefined &&
      settingsRes.data?.groqApiKey === undefined &&
      settingsRes.data?.togetherApiKey === undefined &&
      (isAiEnabledBranch ||
        (settingsRes.data?.hasGeminiKey === undefined &&
          settingsRes.data?.togetherModel === undefined &&
          settingsRes.data?.groqModel === undefined)),
      isAiEnabledBranch
        ? 'GET /api/settings returns sanitized configuration without plaintext secrets'
        : 'GET /api/settings returns sanitized configuration without secrets or AI keys'
    );
    report(
      adminOracleRes.status === 200 &&
      adminOracleRes.data?.success === true &&
      adminOracleRes.data?.password === undefined &&
      adminOracleRes.data?.token === undefined,
      'GET /api/admin/oracle/integration returns sanitized configuration'
    );
    assertCleanDto(settingsRes, 'GET /api/settings');

    // SSRF rejection in settings/test-connection
    const ssrfSettings = await makeRequest('POST', '/api/settings/test-connection', {
      baseUrl: 'http://169.254.169.254/latest/meta-data',
      authType: 'basic',
    }, adminToken);
    report(ssrfSettings.status === 400 && ssrfSettings.data?.success === false,
      'POST /api/settings/test-connection blocks metadata SSRF URL with 400');

    // RBAC guards
    report((await makeRequest('GET', '/api/settings', null, userToken)).status === 403, 'GET /api/settings denies AUDIT_USER (403)');
    report((await makeRequest('GET', '/api/admin/oracle/integration', null, mgrToken)).status === 403, 'GET /api/admin/oracle/integration denies non-admin (403)');

    // Command Center API console
    const ccCatalog = await makeRequest('GET', '/api/command-center/catalog', null, adminToken);
    const ccHistory = await makeRequest('GET', '/api/command-center/history', null, adminToken);
    const ccSaved = await makeRequest('GET', '/api/command-center/saved-requests', null, adminToken);

    report(ccCatalog.status === 200 && ccCatalog.data?.success === true && Array.isArray(ccCatalog.data?.catalog),
      'GET /api/command-center/catalog returns endpoint catalog DTO');
    report(ccHistory.status === 200 && ccHistory.data?.success === true && Array.isArray(ccHistory.data?.history),
      'GET /api/command-center/history returns execution history DTO');
    report(ccSaved.status === 200 && ccSaved.data?.success === true && Array.isArray(ccSaved.data?.items),
      'GET /api/command-center/saved-requests returns saved requests DTO');

    const ccCreate = await makeRequest('POST', '/api/command-center/saved-requests', {
      name: `VYR061 Probe ${runSuffix}`,
      category: 'Regression',
      method: 'GET',
      url: '/fscmRestApi/resources/11.13.18.05/advancedControls',
    }, adminToken);
    const savedId = ccCreate.data?.item?.id;
    if (savedId) createdSavedRequestIds.push(savedId);
    report(ccCreate.status === 200 && ccCreate.data?.success === true && Boolean(savedId),
      'POST /api/command-center/saved-requests persists template');

    if (savedId) {
      const ccDelete = await makeRequest('DELETE', `/api/command-center/saved-requests/${encodeURIComponent(savedId)}`, null, adminToken);
      report(ccDelete.status === 200 && ccDelete.data?.success === true,
        'DELETE /api/command-center/saved-requests/:id cleans up template');
    }

    const ccSsrf = await makeRequest('POST', '/api/command-center/request', {
      method: 'GET',
      url: 'http://127.0.0.1:5433/',
    }, adminToken);
    report(ccSsrf.status === 400 && ccSsrf.data?.success === false,
      'POST /api/command-center/request blocks private/loopback SSRF URL with 400');

    report((await makeRequest('GET', '/api/command-center/catalog', null, userToken)).status === 403,
      'GET /api/command-center/catalog denies AUDIT_USER without ORACLE_API_CONSOLE (403)');
    report((await makeRequest('GET', '/api/command-center/catalog', null, mgrToken)).status === 403,
      'GET /api/command-center/catalog denies AUDIT_MANAGER without ORACLE_API_CONSOLE (403)');

    sectionEnd();

    // =========================================================================
    // SECTION 9: Investigation Workflows
    // =========================================================================
    section('Section 9: Investigation Workflows');

    const invUnauth = await makeRequest('POST', '/api/investigations', {
      id: `inv-unauth-${runSuffix}`,
      payload: { sample: true },
    });
    report(invUnauth.status === 401, 'POST /api/investigations rejects unauthenticated request with 401');

    const invMissing = await makeRequest('POST', '/api/investigations', {}, mgrToken);
    report(invMissing.status === 400, 'POST /api/investigations without id/payload returns 400');

    const invId = `inv-vyr061-${runSuffix}`;
    const invPayload = {
      title: 'VYR-061 Regression Snapshot',
      subjectUser: 'TEST_USER',
      findingsCount: 3,
      tags: ['regression', 'vyr-061'],
    };
    const invSave = await makeRequest('POST', '/api/investigations', { id: invId, payload: invPayload }, mgrToken);
    report(invSave.status === 200 && invSave.data?.success === true && invSave.data?.id === invId,
      'POST /api/investigations saves snapshot DTO (200)');

    const invGet = await makeRequest('GET', `/api/investigations/${encodeURIComponent(invId)}`, null, mgrToken);
    report(
      invGet.status === 200 &&
      invGet.data?.success === true &&
      invGet.data?.data?.title === invPayload.title &&
      invGet.data?.data?.findingsCount === 3,
      'GET /api/investigations/:id retrieves exact snapshot payload DTO'
    );

    const invNotFound = await makeRequest('GET', `/api/investigations/missing-${runSuffix}`, null, mgrToken);
    report(invNotFound.status === 404, 'GET /api/investigations/:id returns 404 for unknown snapshot');

    sectionEnd();

    // =========================================================================
    // SECTION 10: Pre- vs Post-Encryption API DTO Parity & DB Round-Trip
    // =========================================================================
    section('Section 10: Pre- vs Post-Encryption DTO Parity');

    const { userRoleRawDbService } = requireDist('services/userRoleRawDbService.js');
    const { auditRawDbService } = requireDist('services/auditRawDbService.js');
    const { controlRawDbService } = requireDist('services/controlRawDbService.js');
    const { accessCertRawDbService } = requireDist('services/accessCertRawDbService.js');
    const { isEncryptedPayload } = requireDist('security/encryptionContract.js');

    const dtoTestHost = `vyr061-dto-${runSuffix}.oraclecloud.com`;
    const prevHost = process.env.FUSION_HOST;
    const prevRawEnc = process.env.VEYRA_RAW_ENCRYPTION;
    process.env.FUSION_HOST = dtoTestHost;

    // Preserve existing disk cache if present (saveRawCertifications updates it)
    const certCacheFile = path.join(repoRoot, 'backend/oracle_access_certs_cache.json');
    const certCacheBackup = fs.existsSync(certCacheFile) ? fs.readFileSync(certCacheFile, 'utf8') : null;

    const dtoPool = new Pool({
      connectionString: process.env.DATABASE_URL || process.env.DATABASE_URI,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });

    const dtoTables = [
      'oracle_raw_users',
      'oracle_raw_roles',
      'oracle_raw_audit_records',
      'oracle_raw_controls',
      'oracle_raw_access_certifications',
    ];

    const uniqueUser = `DTO_USER_${runSuffix}`;
    const uniqueRole = `DTO_ROLE_${runSuffix}`;
    const uniqueControlId = `CTRL-061-${runSuffix}`;
    const uniqueCertId = `CERT-061-${runSuffix}`;

    try {
      const sampleUser = {
        id: `scim-u-${runSuffix}`,
        userName: uniqueUser,
        displayName: 'DTO Parity User',
        active: true,
        emails: [{ value: `dto.${runSuffix}@example.com`, primary: true }],
        roles: [{ value: 'GL_ANALYST', displayName: 'GL Analyst' }],
        'urn:ietf:params:scim:schemas:extension:fa:2.0:faUser': {
          userCategory: 'WORKER',
          accountType: 'Person',
        },
      };

      const sampleRole = {
        id: `scim-r-${runSuffix}`,
        roleCode: uniqueRole,
        displayName: `DTO Test Role ${runSuffix}`,
        category: 'JOB_ROLE',
        module: 'Financials',
        description: 'Parity verification role',
        members: [{ value: uniqueUser }],
      };

      const sampleAudit = {
        eventTime: new Date().toISOString(),
        userName: uniqueUser,
        action: 'UPDATE',
        businessObjectName: 'User Role Assignment',
        productName: 'Global Human Resources',
        description: `Assigned ${uniqueRole}`,
        auditData: { beforeValue: 'A', afterValue: 'B' },
      };

      const sampleControl = {
        id: uniqueControlId,
        name: 'DTO Parity Control',
        status: 'ACTIVE',
        priority: 'HIGH',
        controlType: 'ACCESS',
      };

      const sampleCert = {
        certificationId: uniqueCertId,
        certificationName: `Q4 Access Review Parity ${runSuffix}`,
        type: 'USER_ACCESS',
        status: 'ACTIVE',
        certificationPercentComplete: 75,
      };

      // Phase A: Pre-encryption baseline write + read
      process.env.VEYRA_RAW_ENCRYPTION = 'false';
      await userRoleRawDbService.saveRawUser(sampleUser);
      await userRoleRawDbService.saveRawRole(sampleRole);
      await auditRawDbService.saveRawAuditRecords('Global Human Resources', 'User Role Assignment', [sampleAudit]);
      await controlRawDbService.saveRawControl(uniqueControlId, sampleControl);
      await accessCertRawDbService.saveRawCertifications([sampleCert]);

      const preUsersRes = await userRoleRawDbService.getRawUsers({ filterText: uniqueUser, limit: 10 });
      const preRolesRes = await userRoleRawDbService.getRawRoles({ filterText: uniqueRole, limit: 10 });
      const preAuditRes = await auditRawDbService.getRawAuditRecords({
        product: 'Global Human Resources',
        username: uniqueUser,
        pageNumber: 1,
        pageSize: 10,
      });
      const preControl = await controlRawDbService.getRawControl(uniqueControlId);
      const preCerts = (await accessCertRawDbService.getCertifications() || []).filter(
        (c) => String(c.certificationId) === uniqueCertId
      );

      // Clear & Phase B: Post-encryption write + DB inspection + decrypted read
      for (const tbl of dtoTables) {
        await dtoPool.query(`DELETE FROM ${tbl} WHERE environment_host = $1`, [dtoTestHost]).catch(() => {});
      }

      process.env.VEYRA_RAW_ENCRYPTION = 'true';
      await userRoleRawDbService.saveRawUser(sampleUser);
      await userRoleRawDbService.saveRawRole(sampleRole);
      await auditRawDbService.saveRawAuditRecords('Global Human Resources', 'User Role Assignment', [sampleAudit]);
      await controlRawDbService.saveRawControl(uniqueControlId, sampleControl);
      await accessCertRawDbService.saveRawCertifications([sampleCert]);

      // Confirm DB rows are actually encrypted at rest
      const dbUserRow = await dtoPool.query('SELECT raw_user, is_encrypted FROM oracle_raw_users WHERE environment_host = $1', [dtoTestHost]);
      const dbAuditRow = await dtoPool.query('SELECT raw_payload, is_encrypted FROM oracle_raw_audit_records WHERE environment_host = $1', [dtoTestHost]);
      const dbCertRow = await dtoPool.query('SELECT raw_data, is_encrypted FROM oracle_raw_access_certifications WHERE environment_host = $1', [dtoTestHost]);

      report(
        dbUserRow.rows[0]?.is_encrypted === true && isEncryptedPayload(dbUserRow.rows[0]?.raw_user),
        'Post-encryption oracle_raw_users row stores AES-256-GCM EncryptedPayload'
      );
      report(
        dbAuditRow.rows[0]?.is_encrypted === true && isEncryptedPayload(dbAuditRow.rows[0]?.raw_payload),
        'Post-encryption oracle_raw_audit_records row stores AES-256-GCM EncryptedPayload'
      );
      report(
        dbCertRow.rows[0]?.is_encrypted === true && isEncryptedPayload(dbCertRow.rows[0]?.raw_data),
        'Post-encryption oracle_raw_access_certifications row stores AES-256-GCM EncryptedPayload'
      );

      // Read back through service layer and compare DTOs field-for-field against pre-encryption baseline
      const postUsersRes = await userRoleRawDbService.getRawUsers({ filterText: uniqueUser, limit: 10 });
      const postRolesRes = await userRoleRawDbService.getRawRoles({ filterText: uniqueRole, limit: 10 });
      const postAuditRes = await auditRawDbService.getRawAuditRecords({
        product: 'Global Human Resources',
        username: uniqueUser,
        pageNumber: 1,
        pageSize: 10,
      });
      const postControl = await controlRawDbService.getRawControl(uniqueControlId);
      const postCerts = (await accessCertRawDbService.getCertifications() || []).filter(
        (c) => String(c.certificationId) === uniqueCertId
      );

      const preUser = preUsersRes.users.find((u) => u.userName === uniqueUser);
      const postUser = postUsersRes.users.find((u) => u.userName === uniqueUser);
      report(
        Boolean(preUser) && Boolean(postUser) && deepEqual(preUser, postUser),
        'Users raw-DB DTO matches pre- vs post-encryption integration'
      );

      const preRole = preRolesRes.roles.find((r) => r.roleCode === uniqueRole);
      const postRole = postRolesRes.roles.find((r) => r.roleCode === uniqueRole);
      report(
        Boolean(preRole) && Boolean(postRole) && deepEqual(preRole, postRole),
        'Roles raw-DB DTO matches pre- vs post-encryption integration'
      );

      report(
        preAuditRes.rawItems.length === 1 &&
        postAuditRes.rawItems.length === 1 &&
        deepEqual(preAuditRes.rawItems[0], postAuditRes.rawItems[0]),
        'Audit raw-DB DTO matches pre- vs post-encryption integration'
      );
      report(
        Boolean(preControl) && Boolean(postControl) && deepEqual(preControl, postControl),
        'Controls raw-DB DTO matches pre- vs post-encryption integration'
      );
      report(
        preCerts.length === 1 &&
        postCerts.length === 1 &&
        deepEqual(preCerts[0], postCerts[0]),
        'Access Certifications raw-DB DTO matches pre- vs post-encryption integration'
      );

      const postLeaks = findForbiddenKeys({ postUser, postRole, postAuditRes, postControl, postCerts });
      report(postLeaks.length === 0, 'Decrypted service DTOs contain zero ciphertext/DEK/nonce/authTag fields', postLeaks);
    } finally {
      for (const tbl of dtoTables) {
        await dtoPool.query(`DELETE FROM ${tbl} WHERE environment_host = $1`, [dtoTestHost]).catch(() => {});
      }
      await dtoPool.end();
      if (certCacheBackup !== null) {
        fs.writeFileSync(certCacheFile, certCacheBackup, 'utf8');
      }
      if (prevHost === undefined) delete process.env.FUSION_HOST;
      else process.env.FUSION_HOST = prevHost;
      if (prevRawEnc === undefined) delete process.env.VEYRA_RAW_ENCRYPTION;
      else process.env.VEYRA_RAW_ENCRYPTION = prevRawEnc;
    }

    sectionEnd();

    // =========================================================================
    // SECTION 11: OWASP Security Headers, Error Handling & Tenant Isolation
    // =========================================================================
    section('Section 11: OWASP Security Controls, Headers & Tenant Isolation');

    const unauthCheck = await makeRequest('GET', '/api/users');
    report(unauthCheck.status === 401, 'Unauthenticated request to protected route returns 401');
    report(
      unauthCheck.headers['x-content-type-options'] === 'nosniff' &&
      unauthCheck.headers['x-frame-options'] === 'DENY' &&
      Boolean(unauthCheck.headers['content-security-policy']) &&
      String(unauthCheck.headers['cache-control'] || '').includes('no-store'),
      'Security headers (X-Content-Type-Options, X-Frame-Options, CSP, Cache-Control: no-store) present on API responses'
    );

    const badCt = await makeRequest('POST', '/api/investigations', 'plain text', mgrToken, {
      'Content-Type': 'text/plain',
    });
    report(badCt.status === 415 && badCt.data?.code === 'UNSUPPORTED_MEDIA_TYPE',
      'Disallowed Content-Type rejected with 415 UNSUPPORTED_MEDIA_TYPE');

    const crossTenantQuery = await makeRequest('GET', '/api/reports?tenantId=attacker-tenant.oraclecloud.com', null, mgrToken);
    report(crossTenantQuery.status === 403 && crossTenantQuery.data?.code === 'TENANT_MISMATCH',
      'Cross-tenant query parameter substitution rejected with 403 TENANT_MISMATCH');

    const crossTenantBody = await makeRequest('POST', '/api/investigations', {
      id: `ct-${runSuffix}`,
      tenantId: 'attacker-tenant.oraclecloud.com',
      payload: { a: 1 },
    }, mgrToken);
    report(crossTenantBody.status === 403 && crossTenantBody.data?.code === 'TENANT_MISMATCH',
      'Cross-tenant body parameter substitution rejected with 403 TENANT_MISMATCH');

    const notFoundApi = await makeRequest('GET', '/api/nonexistent-vyr061-route', null, adminToken);
    report(
      notFoundApi.status === 404 &&
      notFoundApi.data?.error === 'Not Found' &&
      !String(notFoundApi.raw).includes('at Object.') &&
      !String(notFoundApi.raw).includes('SELECT '),
      'Unknown route returns safe 404 JSON without stack traces or SQL details'
    );

    sectionEnd();

    // =========================================================================
    // SECTION 12: Branch Variant Verification (AI-Free vs AI-Enabled)
    // =========================================================================
    section('Section 12: Branch Variant Verification & Contract Docs');

    if (isAiEnabledBranch) {
      const chatUnauth = await makeRequest('POST', '/api/chat', { message: 'hello' });
      const chatSup = await makeRequest('POST', '/api/chat', { message: 'hello' }, supToken);
      const chatUsr = await makeRequest('POST', '/api/chat', { message: 'hello' }, userToken);
      const schemaMgr = await makeRequest('GET', '/api/database/schema', null, mgrToken);
      const tracesMgr = await makeRequest('GET', '/api/ai/universal-traces', null, mgrToken);

      report(chatUnauth.status === 401, 'AI-Enabled: Unauthenticated POST /api/chat rejected with 401');
      report(chatSup.status === 403, 'AI-Enabled: AUDIT_SUPERVISOR blocked from POST /api/chat with 403');
      report(chatUsr.status === 403, 'AI-Enabled: AUDIT_USER blocked from POST /api/chat with 403');
      report(schemaMgr.status === 403, 'AI-Enabled: GET /api/database/schema requires SITE_ADMIN (403 for non-admin)');
      report(tracesMgr.status === 403, 'AI-Enabled: GET /api/ai/universal-traces requires SITE_ADMIN (403 for non-admin)');
      report(
        adminDash.data?.userScope?.hasAskVeyraAccess === true &&
        mgrDash.data?.userScope?.hasAskVeyraAccess === true,
        'AI-Enabled: SITE_ADMIN and AUDIT_MANAGER dashboards grant hasAskVeyraAccess=true'
      );
    } else {
      const chatUnauth = await makeRequest('POST', '/api/chat', { message: 'hello' });
      const chatAdmin = await makeRequest('POST', '/api/chat', { message: 'hello' }, adminToken);
      const chatMgr = await makeRequest('POST', '/api/chat', { message: 'hello' }, mgrToken);
      const uniQuery = await makeRequest('POST', '/api/ai/universal-query', { query: 'users' }, adminToken);
      const uniTraces = await makeRequest('GET', '/api/ai/universal-traces', null, adminToken);
      const dbSchema = await makeRequest('GET', '/api/database/schema', null, adminToken);

      report(chatUnauth.status === 404, 'AI-Free: Unauthenticated POST /api/chat returns 404');
      report(chatAdmin.status === 404, 'AI-Free: Admin POST /api/chat returns 404');
      report(chatMgr.status === 404, 'AI-Free: Audit Manager POST /api/chat returns 404');
      report(uniQuery.status === 404, 'AI-Free: POST /api/ai/universal-query returns 404');
      report(uniTraces.status === 404, 'AI-Free: GET /api/ai/universal-traces returns 404');
      report(dbSchema.status === 404, 'AI-Free: GET /api/database/schema returns 404');
      report(
        adminDash.data?.userScope?.hasAskVeyraAccess === false &&
        mgrDash.data?.userScope?.hasAskVeyraAccess === false &&
        !mgrDash.data?.userScope?.authorizedModules?.includes('AI_ASSISTANT'),
        'AI-Free: Dashboards enforce hasAskVeyraAccess=false and exclude AI_ASSISTANT'
      );
    }

    const contractDocPath = path.join(repoRoot, 'docs/security/VYR-061_CORE_REGRESSION_AND_API_CONTRACTS.md');
    report(fs.existsSync(contractDocPath), 'VYR-061 API contract & regression doc exists');

    sectionEnd();
  } finally {
    rateLimitService.resetAll();
    // Clean up ephemeral test users & saved requests
    for (const email of ephemeralEmails) {
      if (adminToken) {
        await makeRequest('DELETE', `/api/users/${encodeURIComponent(email)}`, null, adminToken).catch(() => {});
      }
      await dbQuery('DELETE FROM veyra_user WHERE LOWER(email) = LOWER($1)', [email]).catch(() => {});
    }
    for (const id of createdSavedRequestIds) {
      if (adminToken) {
        await makeRequest('DELETE', `/api/command-center/saved-requests/${encodeURIComponent(id)}`, null, adminToken).catch(() => {});
      }
    }
    await dbQuery("UPDATE veyra_session SET status = 'EXPIRED' WHERE status = 'ACTIVE'").catch(() => {});
    server.close();
    console.log('\n[Test Server] Shut down gracefully.');
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n================================================================');
  console.log('  VYR-061 RESULTS SUMMARY');
  console.log('================================================================');
  for (const s of sections) {
    const status = s.failed === 0 ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${s.name}: ${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped`);
  }
  console.log('----------------------------------------------------------------');
  console.log(`  TOTAL: ${passed} passed, ${failed} failed, ${skipped} skipped out of ${passed + failed + skipped} assertions`);
  console.log('================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error in VYR-061 regression suite:', err);
  process.exit(2);
});
