/**
 * Test Suite: Story VYR-048
 * "Implement rate limiting, brute-force protection and abuse controls"
 * Epic: EPIC 6 — OWASP application and API security hardening
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Validates that:
 *  1. Source files and database migrations exist with valid DDL for lockouts and abuse events
 *  2. Safe client IP extraction respects trusted proxy settings to prevent IP spoofing (Step 3)
 *  3. In-memory sliding window store tracks hit rates with accurate resets and cleanup
 *  4. Account lockout protects against brute-force attacks after consecutive failed logins (GAP-002)
 *  5. Successful authentication resets failed attempts counter
 *  6. Administrative unlock restores account access
 *  7. Tiered rate limiters (auth, admin, api, tenant) enforce configured thresholds
 *  8. HTTP 429 responses provide standard IETF and legacy headers with Retry-After guidance
 *  9. Abuse telemetry logs security events without logging passwords, tokens, or credentials
 * 10. Express routes and middleware are correctly wired across auth and admin surfaces
 */

process.env.TEST_OFFLINE = 'true';
process.env.OFFLINE_MODE = 'true';
process.env.ACCOUNT_LOCKOUT_MAX_ATTEMPTS = '5';
process.env.ACCOUNT_LOCKOUT_DURATION_MS = '900000'; // 15 min

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  FAIL: ${testName}`);
    failedTests++;
  }
}

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

async function run() {
  console.log('\n================================================================');
  console.log('  VYR-048: Rate Limiting, Brute-Force & Abuse Controls');
  console.log('================================================================\n');

  const root = path.resolve(__dirname, '../..');
  const backendSrc = path.resolve(__dirname, '../src');
  const distPath = path.resolve(__dirname, '../dist');

  const rateLimitSrcPath = path.join(backendSrc, 'security/rateLimitService.ts');
  const apiSrcPath = path.join(backendSrc, 'routes/api.ts');
  const indexSrcPath = path.join(backendSrc, 'index.ts');
  const migrationPath = path.join(root, 'database/migrations/1711000000024_create_veyra_rate_limit_and_lockouts_tables.cjs');

  // ====================================================================
  // Section 1: Source Files & Database Migration Existence
  // ====================================================================
  console.log('--- Section 1: Source Files & Database Migration ---');

  assert(fs.existsSync(rateLimitSrcPath), 'rateLimitService.ts source file exists');
  assert(fs.existsSync(migrationPath), 'Database migration 1711000000024 exists');

  const migrationContent = read(migrationPath);
  assert(migrationContent.includes('veyra_account_lockouts'), 'Migration defines veyra_account_lockouts table');
  assert(migrationContent.includes('veyra_rate_limit_events'), 'Migration defines veyra_rate_limit_events table');
  assert(migrationContent.includes('ix_veyra_account_lockouts_locked'), 'Migration defines index on account lockouts');
  assert(migrationContent.includes('ix_veyra_rate_limit_events_ip_created'), 'Migration defines index on rate limit events by IP');
  assert(migrationContent.includes('ix_veyra_rate_limit_events_tier'), 'Migration defines index on rate limit events by tier');
  assert(migrationContent.includes('DROP TABLE IF EXISTS veyra_account_lockouts'), 'Migration down() cleans up lockouts table');
  assert(migrationContent.includes('DROP TABLE IF EXISTS veyra_rate_limit_events'), 'Migration down() cleans up events table');

  // Load compiled ESM module from dist
  const rateLimitModulePath = path.join(distPath, 'security/rateLimitService.js');
  assert(fs.existsSync(rateLimitModulePath), 'Compiled rateLimitService.js exists in dist');

  const {
    normalizeIp,
    getClientIp,
    SlidingWindowStore,
    AccountLockoutManager,
    RateLimitService,
    rateLimitService,
    authRateLimiter,
    sensitiveAdminRateLimiter,
    apiRateLimiter,
    tenantRateLimiter,
  } = await import(pathToFileURL(rateLimitModulePath).href);

  // ====================================================================
  // Section 2: Safe Client IP Extraction & Anti-Spoofing (Step 3)
  // ====================================================================
  console.log('\n--- Section 2: Safe Client IP Extraction & Anti-Spoofing ---');

  // IP Normalization
  assert(normalizeIp(' 192.168.1.1 ') === '192.168.1.1', 'Normalizes whitespace');
  assert(normalizeIp('::ffff:192.168.1.5') === '192.168.1.5', 'Strips IPv4-mapped IPv6 prefix');
  assert(normalizeIp('192.168.1.1:8080') === '192.168.1.1', 'Strips port from IPv4');
  assert(normalizeIp('[2001:db8::1]:8080') === '2001:db8::1', 'Strips port from bracketed IPv6');
  assert(normalizeIp('') === '127.0.0.1', 'Falls back to 127.0.0.1 for empty IP');

  // Anti-Spoofing when TRUST_PROXY is false (default)
  const spoofedReq = {
    headers: {
      'x-forwarded-for': '203.0.113.195, 10.0.0.1',
      'x-real-ip': '203.0.113.195',
    },
    socket: {
      remoteAddress: '198.51.100.42',
    },
  };

  const untrustedIp = getClientIp(spoofedReq, false);
  assert(untrustedIp === '198.51.100.42',
    'When TRUST_PROXY is false, X-Forwarded-For is strictly ignored and socket IP is returned');

  // Trusted proxy extraction
  const trustedIp = getClientIp(spoofedReq, true);
  assert(trustedIp === '203.0.113.195',
    'When TRUST_PROXY is true, client IP is safely taken from first hop in X-Forwarded-For');

  const realIpReq = {
    headers: {
      'x-real-ip': '198.51.100.99',
    },
    socket: {
      remoteAddress: '10.0.0.5',
    },
  };
  const trustedRealIp = getClientIp(realIpReq, true);
  assert(trustedRealIp === '198.51.100.99',
    'When TRUST_PROXY is true and X-Real-IP is provided, X-Real-IP is used');

  // ====================================================================
  // Section 3: In-Memory Sliding Window Store
  // ====================================================================
  console.log('\n--- Section 3: Sliding Window Store ---');

  const store = new SlidingWindowStore();
  const testKey = 'test:client:1';
  const windowMs = 500; // 500ms window for fast test
  const max = 3;

  const hit1 = store.hit(testKey, windowMs, max);
  assert(hit1.totalHits === 1 && hit1.remaining === 2 && !hit1.isExceeded, 'Hit 1: totalHits=1, remaining=2, not exceeded');

  const hit2 = store.hit(testKey, windowMs, max);
  assert(hit2.totalHits === 2 && hit2.remaining === 1 && !hit2.isExceeded, 'Hit 2: totalHits=2, remaining=1, not exceeded');

  const hit3 = store.hit(testKey, windowMs, max);
  assert(hit3.totalHits === 3 && hit3.remaining === 0 && !hit3.isExceeded, 'Hit 3: totalHits=3, remaining=0, not exceeded');

  const hit4 = store.hit(testKey, windowMs, max);
  assert(hit4.totalHits === 4 && hit4.remaining === 0 && hit4.isExceeded, 'Hit 4: limit exceeded (totalHits=4 > max=3)');

  // Reset single key
  store.resetKey(testKey);
  assert(store.getHits(testKey, windowMs) === 0, 'Resetting key clears hit count to 0');

  // Sliding window expiration test
  const shortKey = 'test:short:expiry';
  store.hit(shortKey, 50, 2);
  store.hit(shortKey, 50, 2);
  assert(store.getHits(shortKey, 50) === 2, 'Hits recorded in active window');
  await new Promise((r) => setTimeout(r, 70)); // wait for window to slide
  assert(store.getHits(shortKey, 50) === 0, 'Hits naturally expire after sliding window passes');

  // ====================================================================
  // Section 4: Account Lockout & Brute-Force Protection (GAP-002)
  // ====================================================================
  console.log('\n--- Section 4: Account Lockout & Brute-Force Protection ---');

  const lockoutMgr = new AccountLockoutManager();
  const victimEmail = 'alice.target@veyra.example.com';
  const attackerIp = '198.51.100.25';

  // Initially unlocked
  let info = lockoutMgr.isLocked(victimEmail);
  assert(!info.isLocked && info.failedAttempts === 0, 'Account is initially unlocked');

  // 1 to 4 failed attempts should not lock out
  for (let i = 1; i <= 4; i++) {
    info = lockoutMgr.recordFailedAttempt(victimEmail, attackerIp);
    assert(!info.isLocked && info.failedAttempts === i, `Attempt ${i}: failedAttempts=${i}, not yet locked`);
  }

  // 5th failed attempt triggers lockout
  info = lockoutMgr.recordFailedAttempt(victimEmail, attackerIp);
  assert(info.isLocked === true, 'Attempt 5: Account is now locked out');
  assert(info.remainingSeconds > 0, 'Lockout has positive remaining seconds');
  assert(info.lockedUntil !== null, 'Lockout has ISO timestamp lockedUntil');

  // Subsequent check reflects lockout state
  const check = lockoutMgr.isLocked(victimEmail);
  assert(check.isLocked === true, 'Subsequent isLocked() check returns true');

  // Locked accounts list
  const lockedList = lockoutMgr.getLockedAccounts();
  assert(lockedList.some((a) => a.email === victimEmail), 'getLockedAccounts() contains locked user');

  // Successful login resets counter
  const recoveredUser = 'bob.recover@veyra.example.com';
  lockoutMgr.recordFailedAttempt(recoveredUser, attackerIp);
  lockoutMgr.recordFailedAttempt(recoveredUser, attackerIp);
  assert(lockoutMgr.isLocked(recoveredUser).failedAttempts === 2, 'Bob has 2 failed attempts');
  lockoutMgr.recordSuccessfulLogin(recoveredUser);
  assert(lockoutMgr.isLocked(recoveredUser).failedAttempts === 0, 'Successful login resets failed attempts to 0');

  // Administrative unlock
  const unlockResult = lockoutMgr.unlockAccount(victimEmail, 'security-admin@veyra.internal');
  assert(unlockResult === true, 'Admin unlock returns true for locked user');
  assert(lockoutMgr.isLocked(victimEmail).isLocked === false, 'Account is unlocked immediately following admin action');
  assert(lockoutMgr.isLocked(victimEmail).failedAttempts === 0, 'Failed attempts reset to 0 after admin unlock');

  // ====================================================================
  // Section 5: Rate Limiter Middleware Execution & Standard 429 Headers
  // ====================================================================
  console.log('\n--- Section 5: Rate Limiter Middleware & HTTP 429 Responses ---');

  const customService = new RateLimitService();
  const testLimiter = customService.createLimiter({
    tierName: 'test_tier',
    max: 2,
    windowMs: 1000,
    message: 'Test rate limit exceeded.',
  });

  function createMockContext(ip = '192.168.1.100') {
    let statusCode = 200;
    let jsonBody = null;
    let nextCalled = false;
    const headers = {};

    const req = {
      path: '/api/test/resource',
      method: 'GET',
      headers: {},
      socket: { remoteAddress: ip },
    };

    const res = {
      setHeader(name, value) {
        headers[name.toLowerCase()] = String(value);
      },
      getHeader(name) {
        return headers[name.toLowerCase()];
      },
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        jsonBody = body;
        return this;
      },
      locals: {},
    };

    const next = () => {
      nextCalled = true;
    };

    return { req, res, next, getStatus: () => statusCode, getBody: () => jsonBody, headers, isNext: () => nextCalled };
  }

  // Request 1: Allowed
  const ctx1 = createMockContext();
  testLimiter(ctx1.req, ctx1.res, ctx1.next);
  assert(ctx1.isNext() && ctx1.getStatus() === 200, 'Request 1: Allowed, calls next()');
  assert(ctx1.headers['ratelimit-limit'] === '2', 'Standard RateLimit-Limit header set to 2');
  assert(ctx1.headers['ratelimit-remaining'] === '1', 'Standard RateLimit-Remaining header set to 1');
  assert(Boolean(ctx1.headers['ratelimit-reset']), 'Standard RateLimit-Reset header present');
  assert(Boolean(ctx1.headers['x-ratelimit-limit']), 'Legacy X-RateLimit-Limit header present');

  // Request 2: Allowed
  const ctx2 = createMockContext();
  testLimiter(ctx2.req, ctx2.res, ctx2.next);
  assert(ctx2.isNext() && ctx2.getStatus() === 200, 'Request 2: Allowed, calls next()');
  assert(ctx2.headers['ratelimit-remaining'] === '0', 'RateLimit-Remaining is 0 after 2nd request');

  // Request 3: Exceeded (HTTP 429)
  const ctx3 = createMockContext();
  testLimiter(ctx3.req, ctx3.res, ctx3.next);
  assert(!ctx3.isNext() && ctx3.getStatus() === 429, 'Request 3: Blocked with HTTP 429');
  assert(Boolean(ctx3.headers['retry-after']), 'Retry-After header present in 429 response');
  assert(parseInt(ctx3.headers['retry-after'], 10) >= 1, 'Retry-After header contains positive integer seconds');
  assert(ctx3.getBody()?.success === false, 'Response body has success: false');
  assert(ctx3.getBody()?.code === 'RATE_LIMIT_EXCEEDED', 'Response body has code: RATE_LIMIT_EXCEEDED');
  assert(Boolean(ctx3.getBody()?.retryAfterSeconds), 'Response body provides retryAfterSeconds guidance');

  // Different IP should still be allowed (per-IP isolation)
  const ctxOtherIp = createMockContext('192.168.1.101');
  testLimiter(ctxOtherIp.req, ctxOtherIp.res, ctxOtherIp.next);
  assert(ctxOtherIp.isNext() && ctxOtherIp.getStatus() === 200,
    'Different client IP has isolated rate limit and is allowed');

  // ====================================================================
  // Section 6: Pre-Configured Middlewares
  // ====================================================================
  console.log('\n--- Section 6: Pre-Configured Tier Middlewares ---');

  assert(typeof authRateLimiter === 'function', 'authRateLimiter is an Express RequestHandler');
  assert(typeof sensitiveAdminRateLimiter === 'function', 'sensitiveAdminRateLimiter is an Express RequestHandler');
  assert(typeof apiRateLimiter === 'function', 'apiRateLimiter is an Express RequestHandler');
  assert(typeof tenantRateLimiter === 'function', 'tenantRateLimiter is an Express RequestHandler');

  const status = rateLimitService.getStatus();
  assert(status.tiers && status.tiers.auth && status.tiers.auth.max === 5,
    'Status reports default auth rate limit tier max=5');
  assert(status.tiers && status.tiers.admin && status.tiers.admin.max === 20,
    'Status reports default admin rate limit tier max=20');
  assert(status.tiers && status.tiers.api && status.tiers.api.max === 100,
    'Status reports default api rate limit tier max=100');
  assert(status.tiers && status.tiers.tenant && status.tiers.tenant.max === 1000,
    'Status reports default tenant rate limit tier max=1000');

  // ====================================================================
  // Section 7: Credential-Free Abuse Logging Verification (Step 4)
  // ====================================================================
  console.log('\n--- Section 7: Credential-Free Abuse Telemetry ---');

  let loggedMessage = '';
  const originalWarn = console.warn;
  console.warn = (...args) => {
    loggedMessage += args.join(' ');
  };

  try {
    customService.logAbuse({
      clientIp: '198.51.100.99',
      identifier: 'test.user@veyra.example.com',
      tenantId: 'tenant_omega',
      tier: 'auth',
      route: '/api/auth/login',
      method: 'POST',
      retryAfterSeconds: 900,
    });
  } finally {
    console.warn = originalWarn;
  }

  assert(loggedMessage.includes('[RateLimit: Abuse]'), 'Abuse event logs to security console');
  assert(loggedMessage.includes('198.51.100.99'), 'Abuse event records client IP');
  assert(loggedMessage.includes('auth'), 'Abuse event records rate limit tier');
  assert(!loggedMessage.toLowerCase().includes('password'), 'Abuse logging never records passwords');
  assert(!loggedMessage.toLowerCase().includes('bearer'), 'Abuse logging never records bearer tokens');
  assert(!loggedMessage.toLowerCase().includes('secret'), 'Abuse logging never records client secrets');

  // ====================================================================
  // Section 8: Express Routing Integration & Verification
  // ====================================================================
  console.log('\n--- Section 8: Express Router Wiring in api.ts & index.ts ---');

  const apiSrc = read(apiSrcPath);
  const indexSrc = read(indexSrcPath);

  // Trust proxy in index.ts
  assert(indexSrc.includes("app.set('trust proxy'"), 'index.ts sets trust proxy dynamically');

  // Global rate limiters in api.ts
  assert(apiSrc.includes('apiRouter.use(tenantRateLimiter)'), 'api.ts mounts tenantRateLimiter globally on apiRouter');
  assert(apiSrc.includes('apiRouter.use(apiRateLimiter)'), 'api.ts mounts apiRateLimiter globally on apiRouter');

  // Auth rate limiter on sensitive auth endpoints
  assert(apiSrc.includes("apiRouter.post('/auth/login', authRateLimiter"), 'api.ts mounts authRateLimiter on /auth/login');
  assert(apiSrc.includes("apiRouter.post('/auth/entra/callback', authRateLimiter"), 'api.ts mounts authRateLimiter on /auth/entra/callback');
  assert(apiSrc.includes("apiRouter.post('/auth/refresh', authRateLimiter"), 'api.ts mounts authRateLimiter on /auth/refresh');
  assert(apiSrc.includes("apiRouter.post('/auth/reset-password', authRateLimiter"), 'api.ts mounts authRateLimiter on /auth/reset-password');

  // Account lockout integration in login route
  assert(apiSrc.includes('rateLimitService.getLockoutManager().isLocked('),
    'Login route checks account lockout before authentication');
  assert(apiSrc.includes('rateLimitService.getLockoutManager().recordFailedAttempt('),
    'Login route records failed attempts for lockout tracking');
  assert(apiSrc.includes('rateLimitService.getLockoutManager().recordSuccessfulLogin('),
    'Login route resets failed attempts on successful login');

  // Sensitive admin rate limiters
  assert(apiSrc.includes("apiRouter.post('/admin/sync/full', requireAdmin, sensitiveAdminRateLimiter"),
    'api.ts mounts sensitiveAdminRateLimiter on /admin/sync/full');
  assert(apiSrc.includes("apiRouter.post('/admin/credentials/rotate', requireAdmin, sensitiveAdminRateLimiter"),
    'api.ts mounts sensitiveAdminRateLimiter on /admin/credentials/rotate');
  assert(apiSrc.includes("apiRouter.post('/admin/locks/recover-stale', requireAdmin, sensitiveAdminRateLimiter"),
    'api.ts mounts sensitiveAdminRateLimiter on /admin/locks/recover-stale');

  // Admin management endpoints
  assert(apiSrc.includes("apiRouter.get('/admin/security/rate-limits'"),
    'api.ts exposes GET /admin/security/rate-limits');
  assert(apiSrc.includes("apiRouter.post('/admin/users/:email/unlock'"),
    'api.ts exposes POST /admin/users/:email/unlock');
  assert(apiSrc.includes("apiRouter.post('/admin/security/rate-limits/reset'"),
    'api.ts exposes POST /admin/security/rate-limits/reset');

  // ====================================================================
  // Summary
  // ====================================================================
  console.log('\n----------------------------------------------------------------');
  console.log(`  Tests Passed: ${passedTests}`);
  console.log(`  Tests Failed: ${failedTests}`);
  console.log('----------------------------------------------------------------\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error during test execution:', err);
  process.exit(1);
});
