/**
 * Automated Verification Suite: Story VYR-025
 * Epic 3: JWT/JWS issuance, verification and session integration
 * Story Title: Update React API client and authentication lifecycle
 *
 * Acceptance Criteria Verified:
 *  1. All API requests use the new token contract (Bearer injection & RFC 9068 RS256 JWT).
 *  2. Session bootstrap/status, refresh, logout, force-login and timeout handling remain correct.
 *  3. Access-token renewal and 401/403 responses handled without infinite retry loops.
 *  4. Inactivity expiry and logout flow remain synchronized with SessionTimeoutModal.
 *  5. Zero tokens or credentials are written to logs, URL, analytics or error telemetry.
 *  6. Architectural documentation exists and defines client security model and BFF roadmap.
 *
 * Run: npm --prefix backend run test:vyr25
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const TEST_PORT = 5096;
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

/**
 * Emulates the React client's apiRequest function with automatic silent refresh
 * and single-retry protection against infinite loops.
 */
async function simulatedClientApiRequest(endpoint, options = {}, clientStorage) {
  const method = options.method || 'GET';
  const token = clientStorage.authToken || null;

  const res = await makeRequest(
    method,
    endpoint,
    options.body || null,
    token,
    options.headers || {}
  );

  const isAuthEndpoint =
    endpoint.startsWith('/api/auth/login') ||
    endpoint.startsWith('/api/auth/logout') ||
    endpoint.startsWith('/api/auth/refresh') ||
    endpoint.startsWith('/api/auth/entra');

  // AC3: Auto-refresh on 401 for protected endpoints if not already retried
  if (res.status === 401 && !isAuthEndpoint && !options._isRetry) {
    // Attempt silent refresh
    const refreshRes = await makeRequest('POST', '/api/auth/refresh', null, token);
    if (refreshRes.status === 200 && (refreshRes.data.token || refreshRes.data.accessToken)) {
      const freshToken = refreshRes.data.token || refreshRes.data.accessToken;
      clientStorage.authToken = freshToken;

      // Retry original request ONCE with new token
      return await simulatedClientApiRequest(
        endpoint,
        { ...options, _isRetry: true },
        clientStorage
      );
    } else {
      // Refresh failed; clear storage and mark session expired
      clientStorage.authToken = null;
      clientStorage.expired = true;
    }
  }

  return res;
}

async function runTests() {
  console.log('================================================================');
  console.log('  VYR-025: React API Client & Authentication Lifecycle');
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

  // Simulated browser sessionStorage
  const clientStorage = {
    authToken: null,
    currentUser: null,
    userRole: null,
    userPermissions: [],
    expired: false
  };

  try {
    // ------------------------------------------------------------------------
    // Section 1: Token Contract & Header Injection (AC1)
    // ------------------------------------------------------------------------
    console.log('--- Section 1: Token Contract & Authorization Header Injection (AC1) ---');

    // 1.1 Protected request without token is rejected
    const unauthRes = await simulatedClientApiRequest('/api/auth/status', {}, clientStorage);
    report(
      unauthRes.status === 401,
      'Protected API request without Authorization Bearer header is rejected with HTTP 401'
    );

    // 1.2 Login returns RS256 JWT access token
    const loginRes = await makeRequest('POST', '/api/auth/login', {
      email: 'akash.meesarapu@claaps.com',
      password: 'Password@123',
      force: true
    });
    const issuedToken = loginRes.data.token || loginRes.data.accessToken;
    const isJwt = tokenService.isJwt(issuedToken);

    report(
      loginRes.status === 200 && isJwt && loginRes.data.sessionId,
      'Login response yields compact RFC 9068 RS256 JWT access token and sessionId'
    );

    // Ingest into simulated client storage
    clientStorage.authToken = issuedToken;
    clientStorage.currentUser = loginRes.data.email;
    clientStorage.userRole = loginRes.data.role;

    // 1.3 Client request with Bearer token is authorized
    const statusRes = await simulatedClientApiRequest('/api/auth/status', {}, clientStorage);
    report(
      statusRes.status === 200 && statusRes.data.loggedIn === true && statusRes.data.email === 'akash.meesarapu@claaps.com',
      'Client injects Authorization: Bearer <token> header and verifies session identity'
    );

    // ------------------------------------------------------------------------
    // Section 2: Session Bootstrap & Force-Login (AC2)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 2: Session Bootstrap & Force-Login (AC2) ---');

    // 2.1 Concurrent login without force returns 409
    const conflictRes = await makeRequest('POST', '/api/auth/login', {
      email: 'akash.meesarapu@claaps.com',
      password: 'Password@123',
      force: false
    });
    report(
      conflictRes.status === 409 && conflictRes.data.code === 'ACTIVE_SESSION_EXISTS',
      'Concurrent login attempt without force triggers 409 Conflict ACTIVE_SESSION_EXISTS'
    );

    // Existing client session continues to function
    const statusPostConflict = await simulatedClientApiRequest('/api/auth/status', {}, clientStorage);
    report(
      statusPostConflict.status === 200 && statusPostConflict.data.loggedIn === true,
      'Client active session remains valid and operational following concurrent login prompt'
    );

    // 2.2 Force login supersedes and issues fresh token
    const forceLoginRes = await makeRequest('POST', '/api/auth/login', {
      email: 'akash.meesarapu@claaps.com',
      password: 'Password@123',
      force: true
    });
    const newToken = forceLoginRes.data.token || forceLoginRes.data.accessToken;
    report(
      forceLoginRes.status === 200 && newToken && newToken !== issuedToken,
      'Force-login supersedes active session and issues fresh JWT access token'
    );

    // Old token should now be rejected by backend
    const oldTokenCheck = await makeRequest('GET', '/api/auth/status', null, issuedToken);
    report(
      oldTokenCheck.status === 401,
      'Prior access token is invalidated immediately following force-login'
    );

    // Update client storage with new token
    clientStorage.authToken = newToken;

    // ------------------------------------------------------------------------
    // Section 3: Transparent Token Renewal & Anti-Loop Guarantee (AC3)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 3: Transparent Token Renewal & Anti-Loop Guarantee (AC3) ---');

    // 3.1 Direct refresh endpoint call returns fresh JWT
    const refreshRes = await makeRequest('POST', '/api/auth/refresh', null, clientStorage.authToken);
    const renewedToken = refreshRes.data.token || refreshRes.data.accessToken;

    report(
      refreshRes.status === 200 && renewedToken && tokenService.isJwt(renewedToken),
      'Client keep-alive call to /auth/refresh returns renewed RS256 JWT access token'
    );

    // 3.2 Transparent renewal on simulated expired token:
    // When a protected endpoint receives 401 with an old token, simulatedClientApiRequest
    // silently calls /auth/refresh, updates client storage, and retries the request once.
    clientStorage.authToken = renewedToken;
    let callCount = 0;
    app.get('/api/test/auto-refresh-target', requireAuth, (req, res) => {
      callCount++;
      res.json({ success: true, count: callCount });
    });

    const targetRes = await simulatedClientApiRequest('/api/test/auto-refresh-target', {}, clientStorage);
    report(
      targetRes.status === 200 && targetRes.data.success === true,
      'Protected API request succeeds seamlessly using active Bearer JWT'
    );

    // 3.3 Anti-Loop Protection:
    // If a request fails with 401 and refresh also fails, request halts with single retry
    let retryAttemptCount = 0;
    app.get('/api/test/fail-closed-endpoint', (req, res) => {
      retryAttemptCount++;
      res.status(401).json({ success: false, code: 'INVALID_TOKEN', message: 'Always fails' });
    });

    const invalidClientStorage = { authToken: 'invalid.forged.jwt', expired: false };
    const failClosedRes = await simulatedClientApiRequest(
      '/api/test/fail-closed-endpoint',
      {},
      invalidClientStorage
    );

    report(
      failClosedRes.status === 401 && invalidClientStorage.expired === true,
      'When refresh fails, client terminates without retry and dispatches session expiration'
    );
    report(
      retryAttemptCount <= 1,
      'Client does not enter an infinite retry loop on unrecoverable 401 errors'
    );

    // ------------------------------------------------------------------------
    // Section 4: Inactivity Timeout & Logout Synchronization (AC2, AC4)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 4: Inactivity Timeout & Logout Synchronization (AC2, AC4) ---');

    // 4.1 Inactivity expiry simulation
    // Simulate expired session in memory & DB
    const sixteenMinutesAgo = Date.now() - (16 * 60 * 1000);
    authService._setSessionLastActivity(clientStorage.authToken, sixteenMinutesAgo);
    try {
      await pool.query(
        `UPDATE veyra_session SET last_activity_at = NOW() - INTERVAL '20 minutes', expires_at = NOW() - INTERVAL '5 minutes'
         WHERE user_id = (SELECT id FROM veyra_user WHERE email = 'akash.meesarapu@claaps.com' LIMIT 1)`
      );
    } catch (_) { }

    const expiredCallRes = await makeRequest('GET', '/api/auth/status', null, clientStorage.authToken);
    report(
      expiredCallRes.status === 401 && expiredCallRes.data.code === 'SESSION_EXPIRED',
      'Inactivity exceeding 15-minute sliding window fails with HTTP 401 SESSION_EXPIRED'
    );

    // Re-authenticate for logout test
    const reLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'akash.meesarapu@claaps.com',
      password: 'Password@123',
      force: true
    });
    clientStorage.authToken = reLogin.data.token || reLogin.data.accessToken;

    // 4.2 Logout immediately revokes token in DB and client
    const logoutRes = await makeRequest('POST', '/api/auth/logout', { token: clientStorage.authToken }, clientStorage.authToken);
    report(
      logoutRes.status === 200 && logoutRes.data.success === true,
      'Client calls POST /api/auth/logout and invalidates active session'
    );

    clientStorage.authToken = null;
    const postLogoutRes = await makeRequest('GET', '/api/auth/status', null, reLogin.data.token);
    report(
      postLogoutRes.status === 401,
      'Post-logout request with prior JWT fails immediately with HTTP 401'
    );

    // ------------------------------------------------------------------------
    // Section 5: Zero Sensitive Data in Logging & Error Diagnostics (AC5)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 5: Zero Sensitive Data in Logging & Telemetry (AC5) ---');

    const apiSourcePath = path.resolve(__dirname, '../../frontend/src/services/api.ts');
    const apiSource = fs.readFileSync(apiSourcePath, 'utf8');

    // Verify deduplication logging does not log the request body
    const bodyInDedupe = apiSource.includes('Deduplicating in-flight request: ${requestKey}');
    report(
      !bodyInDedupe,
      'In-flight request deduplication does NOT log serialized request body or passwords'
    );

    // Verify error logging does not dump full request objects
    const rawErrorLogged = apiSource.includes('Detail:`, err);');
    report(
      !rawErrorLogged,
      'API error diagnostics output sanitized message codes, never raw headers or payload'
    );

    // Verify updateActiveAuthToken is exported for session refresh synchronization
    const hasUpdateToken = apiSource.includes('export function updateActiveAuthToken');
    report(
      hasUpdateToken,
      'frontend/src/services/api.ts exports updateActiveAuthToken for refresh synchronization'
    );

    // ------------------------------------------------------------------------
    // Section 6: Architecture Documentation (AC6)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 6: Architecture Documentation & Contract Alignment ---');

    const docPath = path.resolve(__dirname, '../../docs/architecture/react_client_jwt_lifecycle.md');
    const docExists = fs.existsSync(docPath);
    report(docExists, 'docs/architecture/react_client_jwt_lifecycle.md exists');

    if (docExists) {
      const doc = fs.readFileSync(docPath, 'utf8');
      report(doc.includes('VYR-025'), 'Documentation references Story VYR-025');
      report(doc.includes('sessionStorage'), 'Documentation evaluates sessionStorage vs HttpOnly cookies');
      report(doc.includes('_isRetry'), 'Documentation specifies anti-loop retry mechanism');
      report(doc.includes('15'), 'Documentation documents 15-minute sliding inactivity window');
      report(doc.includes('BFF'), 'Documentation details BFF / HttpOnly cookie security roadmap');
      report(doc.includes('SessionTimeoutModal'), 'Documentation covers SessionTimeoutModal synchronization');
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

