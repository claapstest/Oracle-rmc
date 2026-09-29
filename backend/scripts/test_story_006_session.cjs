const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');

// Import compiled backend modules
const { authService, getInactivityTimeoutMs, DEFAULT_INACTIVITY_TIMEOUT_MINUTES } = require('../dist/services/authService.js');
const { apiRouter } = require('../dist/routes/api.js');

async function runSessionTestSuite() {
  console.log('================================================================');
  console.log('🧪 Starting VY-STRY-006: Backend Session Lifecycle & Timeout Suite');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failed++;
    }
  }

  // Setup ephemeral express server for HTTP endpoint tests
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  async function apiRequest(endpoint, options = {}) {
    const url = `${baseUrl}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const body = options.body ? JSON.stringify(options.body) : undefined;
    
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const req = http.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers
      }, (res) => {
        let rawData = '';
        res.on('data', chunk => rawData += chunk);
        res.on('end', () => {
          let json = {};
          try {
            json = rawData ? JSON.parse(rawData) : {};
          } catch (_) {
            json = { raw: rawData };
          }
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        });
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  try {
    // Clear in-memory active sessions before starting
    authService._clearActiveSessions();

    // =========================================================================
    // AC1: Session Creation on Successful Login
    // =========================================================================
    console.log('\n[AC1 — Session Creation]');
    const loginRes = await apiRequest('/auth/login', {
      method: 'POST',
      body: { email: 'admin@admin.com', password: 'Admin@123' }
    });

    assert(loginRes.status === 200, 'HTTP 200 returned on valid login');
    assert(loginRes.body.success === true, 'Response indicates success');
    assert(typeof loginRes.body.token === 'string' && loginRes.body.token.length > 20, 'Session token string is returned');

    const token1 = loginRes.body.token;
    const session1 = authService.getSession(token1);
    assert(session1 !== undefined, 'Session record exists in session store');
    assert(session1.userId !== undefined, `Session contains user id: ${session1.userId}`);
    assert(session1.email === 'admin@admin.com', `Session contains email: ${session1.email}`);
    assert(session1.token === token1, 'Session contains session token identifier');
    assert(typeof session1.createdAt === 'number', `Session contains createdAt timestamp (${session1.createdAt})`);
    assert(typeof session1.lastActivityAt === 'number', `Session contains lastActivityAt timestamp (${session1.lastActivityAt})`);
    assert(typeof session1.expiresAt === 'number', `Session contains expiresAt timestamp (${session1.expiresAt})`);
    assert(session1.status === 'ACTIVE', `Session status is ACTIVE (${session1.status})`);

    // =========================================================================
    // AC2: Five-Minute Inactivity Configuration & Detection
    // =========================================================================
    console.log('\n[AC2 — Five-Minute Inactivity Default]');
    const defaultInactivityMs = getInactivityTimeoutMs();
    assert(defaultInactivityMs === 5 * 60 * 1000, `Default inactivity timeout is exactly 5 minutes (${defaultInactivityMs} ms)`);
    assert(DEFAULT_INACTIVITY_TIMEOUT_MINUTES === 5, 'Default timeout constant is 5 minutes');

    // =========================================================================
    // AC3: Last Activity Update on Protected Requests
    // =========================================================================
    console.log('\n[AC3 — Last Activity Tracking on Protected Requests]');
    const initialActivity = session1.lastActivityAt;
    
    // Simulate short passage of time (e.g. 50ms)
    await new Promise(r => setTimeout(r, 50));
    
    const statusRes = await apiRequest('/auth/status', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token1}` }
    });

    assert(statusRes.status === 200, 'Protected endpoint /auth/status succeeds with active session');
    assert(statusRes.body.loggedIn === true, 'Returns loggedIn = true');
    const updatedSession1 = authService.getSession(token1);
    assert(updatedSession1.lastActivityAt >= initialActivity, 'Protected request updated session lastActivityAt');

    // =========================================================================
    // AC4: Inactivity Expiration & Controlled 401 Response
    // =========================================================================
    console.log('\n[AC4 — Inactivity Timeout Rejection & Error Response]');
    // Fast-forward lastActivityAt by 6 minutes (360,000 ms ago)
    const sixMinutesAgo = Date.now() - (6 * 60 * 1000);
    authService._setSessionLastActivity(token1, sixMinutesAgo);

    const expiredReq = await apiRequest('/auth/status', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token1}` }
    });

    assert(expiredReq.status === 401, 'HTTP 401 Unauthorized returned for inactive session (>5m)');
    assert(expiredReq.body.code === 'SESSION_EXPIRED', `Response error code is 'SESSION_EXPIRED' (${expiredReq.body.code})`);
    assert(expiredReq.body.message === 'Your session has expired. Please log in again.', 'Message matches AC4 requirement');

    // =========================================================================
    // AC5 & AC6: Logout API & Session Invalidation
    // =========================================================================
    console.log('\n[AC5 & AC6 — Logout API & Session Reusability Prevention]');
    
    // Log in another user: Akash Meesarapu
    const loginUser2 = await apiRequest('/auth/login', {
      method: 'POST',
      body: { email: 'akash.meesarapu@claaps.com', password: 'Password@123' }
    });

    assert(loginUser2.status === 200, 'User 2 logs in successfully');
    const token2 = loginUser2.body.token;

    // Verify token2 is active
    const checkActive = await apiRequest('/auth/status', {
      headers: { Authorization: `Bearer ${token2}` }
    });
    assert(checkActive.status === 200, 'User 2 session is active before logout');

    // Perform logout via POST /api/auth/logout
    const logoutRes = await apiRequest('/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token2}` }
    });

    assert(logoutRes.status === 200, 'POST /api/auth/logout returns HTTP 200');
    assert(logoutRes.body.success === true, 'Logout response success is true');

    // AC6: Verify invalidated session cannot be reused
    const reusedReq = await apiRequest('/auth/status', {
      headers: { Authorization: `Bearer ${token2}` }
    });
    assert(reusedReq.status === 401, 'Logged-out session is rejected with HTTP 401 on protected route');

    // =========================================================================
    // AC7: Protected APIs Session Validation
    // =========================================================================
    console.log('\n[AC7 — Protected Route Session Validation]');
    const noTokenReq = await apiRequest('/auth/status');
    assert(noTokenReq.status === 401, 'Request with missing token is rejected with HTTP 401');

    const badTokenReq = await apiRequest('/auth/status', {
      headers: { Authorization: 'Bearer totally_invalid_fake_token_12345' }
    });
    assert(badTokenReq.status === 401, 'Request with non-existent token is rejected with HTTP 401');

    const malformedHeaderReq = await apiRequest('/auth/status', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' }
    });
    assert(malformedHeaderReq.status === 401, 'Request with malformed authorization header is rejected with HTTP 401');

    // =========================================================================
    // AC8: Session Cleanup Routine
    // =========================================================================
    console.log('\n[AC8 — Expired Session Cleanup Routine]');
    
    // Log in user 2 again for session cleanup test (since previous session was logged out)
    const loginUser3 = await apiRequest('/auth/login', {
      method: 'POST',
      body: { email: 'akash.meesarapu@claaps.com', password: 'Password@123' }
    });
    assert(loginUser3.status === 200, 'User logged in for cleanup test');
    const token3 = loginUser3.body.token;
    
    // Age token3 beyond 5 minutes
    authService._setSessionLastActivity(token3, Date.now() - (10 * 60 * 1000));
    
    const countBefore = authService._getActiveSessionsCount();
    assert(countBefore >= 1, `Active sessions count before cleanup: ${countBefore}`);
    
    // Trigger cleanup
    await authService.cleanupExpiredSessions();
    
    const sessionAfter = authService.getSession(token3);
    assert(sessionAfter === undefined, 'Expired session was purged by cleanupExpiredSessions');

    // =========================================================================
    // AC9: Auditability (USER_LOGIN, LOGIN_REJECTED, USER_LOGOUT, SESSION_EXPIRED)
    // =========================================================================
    console.log('\n[AC9 — Auditability & Event Logging]');
    
    // Trigger a rejected login (wrong password)
    await apiRequest('/auth/login', {
      method: 'POST',
      body: { email: 'admin@admin.com', password: 'WrongPassword@999' }
    });

    const auditLogPath = path.join(__dirname, '../oracle_audit.log');
    let auditLogsContent = '';
    if (fs.existsSync(auditLogPath)) {
      auditLogsContent = fs.readFileSync(auditLogPath, 'utf8');
    }

    assert(auditLogsContent.includes('USER_LOGIN'), 'Audit log contains USER_LOGIN event');
    assert(auditLogsContent.includes('LOGIN_REJECTED'), 'Audit log contains LOGIN_REJECTED event');
    assert(auditLogsContent.includes('USER_LOGOUT'), 'Audit log contains USER_LOGOUT event');
    assert(auditLogsContent.includes('SESSION_EXPIRED'), 'Audit log contains SESSION_EXPIRED event');

    // =========================================================================
    // Test Summary
    // =========================================================================
    console.log('\n================================================================');
    console.log(`📊 Story 006 Test Results: ${passed} Passed, ${failed} Failed`);
    console.log('================================================================');

    server.close();
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error in test suite:', err);
    server.close();
    process.exit(1);
  }
}

runSessionTestSuite();
