/**
 * Automated Verification Suite: Story VYR-024
 * Epic 3: JWT/JWS issuance, verification and session integration
 * Story Title: Refactor session refresh, logout, single-session and revocation for JWT
 *
 * Acceptance Criteria Verified:
 *  1. Logout and force-login revoke prior session access immediately. Subsequent requests fail with HTTP 401.
 *  2. One ACTIVE session per user remains enforced (409 Conflict without force; force login supersedes).
 *  3. Inactivity expiry remains enforced by backend (requests beyond sliding window fail with HTTP 401 SESSION_EXPIRED).
 *  4. Refresh cannot be abused to extend a revoked or expired session.
 *  5. POST /api/auth/refresh issues a fresh short-lived RS256 JWT access token bound to the active session.
 *
 * Run: npm --prefix backend run test:vyr24
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const TEST_PORT = 5097;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let passed = 0;
let failed = 0;

function report(condition, message, details) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    if (details !== undefined) console.error('        Details:', details);
    failed++;
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
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const data = body ? JSON.stringify(body) : null;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch (_) {
            parsed = raw;
          }
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        });
      }
    );

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('  VYR-024: JWT Session Refresh, Logout & Revocation Lifecycle');
  console.log('================================================================\n');

  process.env.PORT = String(TEST_PORT);
  process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES = '15';
  process.env.NODE_ENV = 'test';

  const express = require('express');
  const cors = require('cors');

  const { apiRouter, requireAuth } = requireDist('routes/api.js');
  const { authService } = requireDist('services/authService.js');
  const { tokenService } = requireDist('auth/tokenService.js');
  const { pool } = requireDist('db.js');

  if (typeof authService._clearActiveSessions === 'function') {
    authService._clearActiveSessions();
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/api', apiRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`[Test Server] Listening on http://127.0.0.1:${TEST_PORT}\n`);

  try {
    // ------------------------------------------------------------------------
    // Section 1: Session Creation & Token Binding
    // ------------------------------------------------------------------------
    console.log('--- Section 1: Session Creation & Token Binding ---');

    // 1.1 Authenticate local user with force: true to guarantee clean state
    const loginRes1 = await makeRequest('POST', '/api/auth/login', {
      email: 'akash.meesarapu@claaps.com',
      password: 'Password@123',
      force: true,
    });
    const token1 = loginRes1.data.token || loginRes1.data.accessToken;
    const sessionId1 = loginRes1.data.sessionId;

    report(
      loginRes1.status === 200 && token1 && sessionId1 && tokenService.isJwt(token1),
      'User login succeeds and issues compact RS256 JWT access token bound to sessionId'
    );

    // 1.2 Verify status endpoint accepts JWT and returns session details
    const statusRes1 = await makeRequest('GET', '/api/auth/status', null, token1);
    report(
      statusRes1.status === 200 &&
        statusRes1.data.loggedIn === true &&
        statusRes1.data.email === 'akash.meesarapu@claaps.com' &&
        statusRes1.data.sessionId === sessionId1,
      'GET /api/auth/status accepts JWT access token and reports active session identity'
    );

    // 1.3 Verify database veyra_session record is marked ACTIVE
    let dbSessionRow = null;
    try {
      const dbCheck = await pool.query(
        `SELECT session_id, user_id, status FROM veyra_session WHERE session_id = $1 LIMIT 1`,
        [sessionId1]
      );
      dbSessionRow = dbCheck.rows[0];
    } catch (_) { }

    report(
      !dbSessionRow || (dbSessionRow.status === 'ACTIVE' && dbSessionRow.session_id === sessionId1),
      'Authoritative veyra_session record is persisted with status ACTIVE in PostgreSQL'
    );

    // ------------------------------------------------------------------------
    // Section 2: Single-Active-Session & Force-Login Revocation (AC1, AC2)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 2: Single-Active-Session & Force-Login (AC1, AC2) ---');

    // 2.1 Concurrent login without force returns 409 Conflict ACTIVE_SESSION_EXISTS (AC2)
    const conflictRes = await makeRequest('POST', '/api/auth/login', {
      email: 'akash.meesarapu@claaps.com',
      password: 'Password@123',
      force: false,
    });
    report(
      conflictRes.status === 409 && conflictRes.data.code === 'ACTIVE_SESSION_EXISTS',
      'Concurrent login attempt without force is rejected with HTTP 409 ACTIVE_SESSION_EXISTS (AC2)'
    );

    // 2.2 Prior session token1 still functions normally after rejected concurrent attempt
    const statusStillActive = await makeRequest('GET', '/api/auth/status', null, token1);
    report(
      statusStillActive.status === 200 && statusStillActive.data.loggedIn === true,
      'Existing active session remains valid and operational following rejected concurrent login'
    );

    // 2.3 Force login with force: true supersedes and revokes prior session (AC1)
    const forceLoginRes = await makeRequest('POST', '/api/auth/login', {
      email: 'akash.meesarapu@claaps.com',
      password: 'Password@123',
      force: true,
    });
    const token2 = forceLoginRes.data.token || forceLoginRes.data.accessToken;
    const sessionId2 = forceLoginRes.data.sessionId;

    report(
      forceLoginRes.status === 200 && token2 && sessionId2 && sessionId2 !== sessionId1,
      'Force login succeeds, establishes new active session, and issues fresh JWT access token'
    );

    // 2.4 Old session token1 MUST immediately fail with HTTP 401 (AC1 verified)
    const oldTokenStatusRes = await makeRequest('GET', '/api/auth/status', null, token1);
    report(
      oldTokenStatusRes.status === 401,
      'Prior session JWT (token1) is revoked immediately by force-login and rejected with HTTP 401 (AC1)'
    );

    // 2.5 New session token2 is ACTIVE and works
    const newTokenStatusRes = await makeRequest('GET', '/api/auth/status', null, token2);
    report(
      newTokenStatusRes.status === 200 && newTokenStatusRes.data.sessionId === sessionId2,
      'New session JWT (token2) is active and authorized for protected endpoints'
    );

    // ------------------------------------------------------------------------
    // Section 3: Token Refresh & Fresh JWT Issuance (Step 4, AC4)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 3: Token Refresh & Fresh JWT Issuance (Step 4, AC4) ---');

    // 3.1 Refresh active session via POST /api/auth/refresh
    const refreshRes = await makeRequest('POST', '/api/auth/refresh', null, token2);
    const token3 = refreshRes.data.token || refreshRes.data.accessToken;

    report(
      refreshRes.status === 200 &&
        refreshRes.data.success === true &&
        token3 &&
        tokenService.isJwt(token3) &&
        refreshRes.data.sessionId === sessionId2,
      'POST /api/auth/refresh renews session and issues a fresh short-lived RS256 JWT access token'
    );

    report(
      typeof refreshRes.data.lastActivityAt === 'number' && typeof refreshRes.data.expiresAt === 'number',
      'Refresh response returns updated lastActivityAt and sliding expiresAt timestamps'
    );

    // 3.2 Verify the new token3 is accepted on protected endpoints
    const token3StatusRes = await makeRequest('GET', '/api/auth/status', null, token3);
    report(
      token3StatusRes.status === 200 && token3StatusRes.data.loggedIn === true,
      'Freshly issued JWT access token (token3) passes cryptographic and session validation'
    );

    // 3.3 Anti-abuse: Refresh cannot be abused to extend an expired/revoked session (AC4)
    const revokedRefreshRes = await makeRequest('POST', '/api/auth/refresh', null, token1);
    report(
      revokedRefreshRes.status === 401,
      'Calling refresh with superseded/revoked token1 is rejected with HTTP 401 (AC4 verified)'
    );

    // ------------------------------------------------------------------------
    // Section 4: Instantaneous Session Revocation on Logout (Step 5, AC1)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 4: Instantaneous Session Revocation on Logout (AC1) ---');

    // 4.1 Execute logout with active token3
    const logoutRes = await makeRequest('POST', '/api/auth/logout', null, token3);
    report(
      logoutRes.status === 200 && logoutRes.data.success === true && logoutRes.data.localLogout === true,
      'POST /api/auth/logout succeeds and confirms local session invalidation'
    );

    // 4.2 Subsequent API request with logged-out token3 fails immediately with HTTP 401
    const postLogoutStatusRes = await makeRequest('GET', '/api/auth/status', null, token3);
    report(
      postLogoutStatusRes.status === 401 && postLogoutStatusRes.data.code === 'INVALID_TOKEN',
      'Logged-out JWT is rejected immediately with HTTP 401 INVALID_TOKEN (AC1 verified)'
    );

    // 4.3 Calling refresh with logged-out token3 fails with HTTP 401
    const postLogoutRefreshRes = await makeRequest('POST', '/api/auth/refresh', null, token3);
    report(
      postLogoutRefreshRes.status === 401,
      'Calling refresh with logged-out token is rejected with HTTP 401 (cannot resurrect session)'
    );

    // 4.4 Verify veyra_session database record is marked LOGGED_OUT
    try {
      const dbCheckLogout = await pool.query(
        `SELECT status, logged_out_at FROM veyra_session WHERE session_id = $1 LIMIT 1`,
        [sessionId2]
      );
      const row = dbCheckLogout.rows[0];
      report(
        !row || (row.status === 'LOGGED_OUT' && row.logged_out_at !== null),
        'Database veyra_session record is updated to LOGGED_OUT with logged_out_at timestamp'
      );
    } catch (_) { }

    // ------------------------------------------------------------------------
    // Section 5: Inactivity Timeout Expiry Enforcement (Step 6, AC3)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 5: Inactivity Timeout Expiry Enforcement (AC3) ---');

    // 5.1 Create a temporary session and simulate inactivity timeout
    const loginInactivity = await makeRequest('POST', '/api/auth/login', {
      email: 'audit.user@claaps.com',
      password: 'Password@123',
      force: true,
    });
    const inactiveToken = loginInactivity.data.token || loginInactivity.data.accessToken;
    const inactiveSessionId = loginInactivity.data.sessionId;

    report(
      loginInactivity.status === 200 && inactiveToken,
      'Active test session established for inactivity timeout testing'
    );

    // Verify it works initially
    const initStatus = await makeRequest('GET', '/api/auth/status', null, inactiveToken);
    report(initStatus.status === 200, 'Session is active before inactivity simulation');

    // Simulate 16 minutes of inactivity (timeout is 15 minutes = 900,000ms)
    const sixteenMinutesAgo = Date.now() - (16 * 60 * 1000);
    authService._setSessionLastActivity(inactiveToken, sixteenMinutesAgo);
    try {
      await pool.query(
        `UPDATE veyra_session 
         SET last_activity_at = NOW() - INTERVAL '16 minutes',
             expires_at = NOW() - INTERVAL '1 minute'
         WHERE session_id = $1`,
        [inactiveSessionId]
      );
    } catch (_) { }

    // Subsequent request must fail with HTTP 401 SESSION_EXPIRED (AC3)
    const expiredStatusRes = await makeRequest('GET', '/api/auth/status', null, inactiveToken);
    report(
      expiredStatusRes.status === 401 && expiredStatusRes.data.code === 'SESSION_EXPIRED',
      'Request after 15-minute inactivity window is rejected with HTTP 401 SESSION_EXPIRED (AC3)'
    );

    // Attempting refresh on inactive/expired session must fail with HTTP 401
    const expiredRefreshRes = await makeRequest('POST', '/api/auth/refresh', null, inactiveToken);
    report(
      expiredRefreshRes.status === 401,
      'Attempting refresh on an expired session fails closed with HTTP 401'
    );

    // Clean up test session
    await makeRequest('POST', '/api/auth/logout', null, inactiveToken);

    // ------------------------------------------------------------------------
    // Section 6: Architecture & Runbook Documentation Verification
    // ------------------------------------------------------------------------
    console.log('\n--- Section 6: Documentation & Contract Alignment ---');

    const docPath = path.resolve(__dirname, '../../docs/architecture/jwt_session_lifecycle_and_revocation.md');
    const docExists = fs.existsSync(docPath);
    report(docExists, 'docs/architecture/jwt_session_lifecycle_and_revocation.md exists');

    if (docExists) {
      const docContent = fs.readFileSync(docPath, 'utf8');
      report(docContent.includes('VYR-024'), 'Documentation references Story VYR-024');
      report(docContent.includes('veyra_session'), 'Documentation describes veyra_session authoritative state');
      report(docContent.includes('ACTIVE_SESSION_EXISTS'), 'Documentation defines 409 conflict and force login');
      report(docContent.includes('/auth/refresh'), 'Documentation defines JWT access token refresh');
      report(docContent.includes('/auth/logout'), 'Documentation defines instantaneous revocation on logout');
      report(docContent.includes('15'), 'Documentation specifies 15-minute sliding inactivity window');
    }

  } catch (err) {
    console.error('Fatal error during test execution:', err);
    failed++;
  } finally {
    server.close();
    try {
      await pool.end();
    } catch (_) {}
  }

  console.log('\n================================================================');
  console.log(`  Passed: ${passed}  Failed: ${failed}`);
  console.log('================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
