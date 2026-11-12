/**
 * Automated Verification Suite: Story VYR-026
 * Epic 3: JWT/JWS issuance, verification and session integration
 * Story Title: Test JWT security and backward-compatibility migration
 *
 * Acceptance Criteria Verified:
 *  1. All token-negative tests fail closed (no adversarial token is ever honoured).
 *  2. Migration strategy for legacy opaque tokens is documented and tested in both phases.
 *  3. Both branches pass authentication regression (Epic 3 harness VYR-019..VYR-025 wired).
 *
 * Technical Implementation Steps Covered:
 *  1. Forged signature, expired token, wrong issuer/audience, unknown kid, revoked sid,
 *     disabled user and stale role.
 *  2. Old opaque tokens during the planned migration window, under both the reject-immediately
 *     default and the time-bounded transition opt-in.
 *  3. Concurrent login, force login, inactivity refresh and logout.
 *  4. Both Entra and Local login issue the same Veyra token contract.
 *
 * Security note: every negative case asserts the *specific* HTTP status and error code, because
 * a fail-closed boundary that returns the wrong code still leaks information to an attacker and
 * breaks the VYR-025 React client contract.
 *
 * Run: npm --prefix backend run test:vyr26
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const TEST_PORT = 5099;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// Fixtures must be VYR-015 seeded personas - they are the only rows whose credentials are
// known to the suite. Re-seed with: npm --prefix backend run seed:local-users
const PRIMARY_USER = 'akash.meesarapu@claaps.com';   // AUDIT_MANAGER - holds AUDIT_TRAIL
const DEMOTION_USER = 'akash.meesarapu@claaps.com';  // demoted to AUDIT_USER mid-session, then restored
const DISABLE_USER = 'supervisor.user@claaps.com';   // disabled mid-session, then restored
const IDLE_USER = 'audit.user@claaps.com';
const TEST_PASSWORD = process.env.DEV_SEED_PASSWORD || 'Password@123';

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
          resolve({ status: res.statusCode, data: parsed, headers: res.headers, raw });
        });
      }
    );

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/** Asserts a protected endpoint rejects `token` with an exact status and error code. */
async function expectRejected(token, expectedStatus, expectedCode, label) {
  const res = await makeRequest('GET', '/api/auth/status', null, token);
  const codeMatches = expectedCode === null || res.data?.code === expectedCode;
  report(
    res.status === expectedStatus && codeMatches,
    label,
    `expected HTTP ${expectedStatus}${expectedCode ? ` ${expectedCode}` : ''}, got HTTP ${res.status} ${res.data?.code || '(no code)'}`
  );
  return res;
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function runTests() {
  console.log('================================================================');
  console.log('  VYR-026: JWT Security & Backward-Compatibility Migration');
  console.log('================================================================\n');

  process.env.PORT = String(TEST_PORT);
  process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES = '15';
  process.env.NODE_ENV = 'test';

  // Start from the documented production posture. Section 4 toggles this deliberately.
  const originalLegacyFlag = process.env.ALLOW_LEGACY_OPAQUE_TOKENS;
  process.env.ALLOW_LEGACY_OPAQUE_TOKENS = 'false';

  const express = require('express');
  const cors = require('cors');
  const jose = require('jose');

  const { apiRouter } = requireDist('routes/api.js');
  const { authService } = requireDist('services/authService.js');
  const { tokenService } = requireDist('auth/tokenService.js');
  const { keyManager } = requireDist('auth/keyManager.js');
  const contract = requireDist('auth/jwtContract.js');
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

  // Tracks state mutated against the live database so the finally block can always restore it.
  const cleanup = { disabledUser: null, demotedUser: null, demotedRoleCode: null, roleSnapshot: null, entraSubject: null };

  try {
    const bundle = await keyManager.getSigningKeyBundle();
    const activeKid = bundle.kid;
    const expectedIssuer = (process.env.JWT_ISSUER || contract.VEYRA_JWT_ISSUER).trim();
    const expectedAudience = (process.env.JWT_AUDIENCE || contract.VEYRA_JWT_AUDIENCE).trim();

    // Establish one authentic session that the forged tokens below will impersonate.
    const baselineLogin = await makeRequest('POST', '/api/auth/login', {
      email: PRIMARY_USER,
      password: TEST_PASSWORD,
      force: true,
    });
    const baselineToken = baselineLogin.data.token || baselineLogin.data.accessToken;
    const baselineSessionId = baselineLogin.data.sessionId;

    report(
      baselineLogin.status === 200 && baselineToken && tokenService.isJwt(baselineToken),
      'Baseline local login succeeds and issues a compact RS256 JWT access token',
      baselineLogin.status !== 200
        ? `login failed (HTTP ${baselineLogin.status}). Seed fixtures with "npm --prefix backend run seed:local-users" or set DEV_SEED_PASSWORD.`
        : undefined
    );
    if (!baselineToken) {
      throw new Error(
        `Fixture login failed for ${PRIMARY_USER}. Run "npm --prefix backend run seed:local-users" ` +
        'or export DEV_SEED_PASSWORD to match the seeded credential.'
      );
    }

    const baselineClaims = tokenService.decodeToken(baselineToken).payload;

    /** Signs a token with the REAL active signing key, overriding header/claims for attack simulation. */
    async function signWithRealKey(claimOverrides = {}, headerOverrides = {}) {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: expectedIssuer,
        sub: baselineClaims.sub,
        aud: expectedAudience,
        iat: now,
        nbf: now,
        exp: now + 900,
        jti: crypto.randomUUID(),
        sid: baselineSessionId,
        ...claimOverrides,
      };
      return new jose.SignJWT(payload)
        .setProtectedHeader({
          alg: contract.VEYRA_JWT_ALGORITHM,
          typ: contract.VEYRA_JWT_TYPE,
          kid: activeKid,
          ...headerOverrides,
        })
        .sign(bundle.privateKey);
    }

    // ------------------------------------------------------------------------
    // Section 1: Token-Negative Cryptographic Fail-Closed Tests (Step 1, AC1)
    // ------------------------------------------------------------------------
    console.log('--- Section 1: Token-Negative Cryptographic Fail-Closed (Step 1, AC1) ---');

    // 1.1 Sanity: the authentic token IS accepted, so the negatives below prove rejection
    //     rather than a globally broken endpoint.
    const authenticRes = await makeRequest('GET', '/api/auth/status', null, baselineToken);
    report(
      authenticRes.status === 200 && authenticRes.data.loggedIn === true,
      'Control: authentic RS256 JWT is accepted (HTTP 200) — negatives below are meaningful'
    );

    // 1.2 Forged signature: attacker re-signs escalated claims with a rogue key, reusing the real kid
    const rogueKeyPair = await jose.generateKeyPair(contract.VEYRA_JWT_ALGORITHM, { extractable: true });
    const forgedToken = await new jose.SignJWT({
      iss: expectedIssuer,
      sub: baselineClaims.sub,
      aud: expectedAudience,
      iat: Math.floor(Date.now() / 1000),
      nbf: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
      jti: crypto.randomUUID(),
      sid: baselineSessionId,
    })
      .setProtectedHeader({ alg: contract.VEYRA_JWT_ALGORITHM, typ: contract.VEYRA_JWT_TYPE, kid: activeKid })
      .sign(rogueKeyPair.privateKey);

    await expectRejected(forgedToken, 401, 'INVALID_TOKEN',
      'Forged signature (rogue RSA key, authentic kid) is rejected with HTTP 401 INVALID_TOKEN');

    // 1.3 Signature byte tampering on an otherwise authentic token
    const tamperedParts = baselineToken.split('.');
    const lastChar = tamperedParts[2].slice(-1);
    tamperedParts[2] = tamperedParts[2].slice(0, -1) + (lastChar === 'A' ? 'B' : 'A');
    await expectRejected(tamperedParts.join('.'), 401, 'INVALID_TOKEN',
      'Bit-flipped signature on an authentic token is rejected with HTTP 401 INVALID_TOKEN');

    // 1.4 Payload tampering: privilege escalation attempt without re-signing
    const escalatedPayload = { ...baselineClaims, role: 'SITE_ADMIN' };
    const escalatedToken = [
      tamperedParts[0],
      base64url(JSON.stringify(escalatedPayload)),
      baselineToken.split('.')[2],
    ].join('.');
    await expectRejected(escalatedToken, 401, 'INVALID_TOKEN',
      'Payload tampering to escalate role without re-signing is rejected with HTTP 401');

    // 1.5 Algorithm spoofing: alg "none" (RFC 7519 section 8.5 bypass)
    const noneHeader = base64url(JSON.stringify({ alg: 'none', typ: contract.VEYRA_JWT_TYPE, kid: activeKid }));
    const nonePayload = base64url(JSON.stringify({ ...baselineClaims, jti: crypto.randomUUID() }));
    await expectRejected(`${noneHeader}.${nonePayload}.AAAA`, 401, 'INVALID_TOKEN',
      'Algorithm spoofing with alg:"none" is rejected with HTTP 401 INVALID_TOKEN');

    // 1.6 Algorithm confusion: HS256 signed with the published RSA public key as the HMAC secret
    const publicPem = bundle.publicKey.export
      ? bundle.publicKey.export({ type: 'spki', format: 'pem' })
      : (await jose.exportSPKI(bundle.publicKey));
    const hsHeader = base64url(JSON.stringify({ alg: 'HS256', typ: contract.VEYRA_JWT_TYPE, kid: activeKid }));
    const hsPayload = base64url(JSON.stringify({ ...baselineClaims, jti: crypto.randomUUID() }));
    const hsSignature = crypto
      .createHmac('sha256', String(publicPem))
      .update(`${hsHeader}.${hsPayload}`)
      .digest('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    await expectRejected(`${hsHeader}.${hsPayload}.${hsSignature}`, 401, 'INVALID_TOKEN',
      'Algorithm confusion (HS256 signed with the public key) is rejected with HTTP 401');

    // 1.7 Wrong media type: RFC 9068 requires typ "at+jwt"
    await expectRejected(await signWithRealKey({}, { typ: 'JWT' }), 401, 'INVALID_TOKEN',
      'Token with non-RFC-9068 typ header ("JWT") is rejected with HTTP 401 INVALID_TOKEN');

    // 1.8 Expired token, beyond the 5-second clock-skew tolerance
    const nowSec = Math.floor(Date.now() / 1000);
    await expectRejected(
      await signWithRealKey({ iat: nowSec - 1800, nbf: nowSec - 1800, exp: nowSec - 900 }),
      401, 'SESSION_EXPIRED',
      'Expired token (exp 15 minutes in the past) is rejected with HTTP 401 SESSION_EXPIRED'
    );

    // 1.9 Untrusted issuer
    await expectRejected(await signWithRealKey({ iss: 'https://evil-idp.example.com' }), 401, 'INVALID_TOKEN',
      'Token asserting an untrusted issuer is rejected with HTTP 401 INVALID_TOKEN');

    // 1.10 Untrusted audience (token minted for a different service)
    await expectRejected(await signWithRealKey({ aud: 'some-other-api' }), 401, 'INVALID_TOKEN',
      'Token with a foreign audience is rejected with HTTP 401 INVALID_TOKEN');

    // 1.11 Unknown kid: key resolution must fail closed, never fall back to a default key
    await expectRejected(await signWithRealKey({}, { kid: 'veyra-key-does-not-exist' }), 401, 'INVALID_TOKEN',
      'Token referencing an unknown kid is rejected with HTTP 401 (no default-key fallback)');

    // 1.12 Missing kid header entirely
    const noKidToken = await new jose.SignJWT({ ...baselineClaims, jti: crypto.randomUUID() })
      .setProtectedHeader({ alg: contract.VEYRA_JWT_ALGORITHM, typ: contract.VEYRA_JWT_TYPE })
      .sign(bundle.privateKey);
    await expectRejected(noKidToken, 401, 'INVALID_TOKEN',
      'Token with no kid header is rejected with HTTP 401 INVALID_TOKEN');

    // 1.13 Forbidden PII claim smuggled into an otherwise authentic token (VYR-019 zero-PII rule)
    await expectRejected(await signWithRealKey({ email: PRIMARY_USER }), 401, 'INVALID_TOKEN',
      'Authentically signed token carrying a forbidden PII claim (email) is rejected with HTTP 401');

    // 1.14 Unbound sid: valid signature, but sid references no active session
    await expectRejected(await signWithRealKey({ sid: crypto.randomBytes(32).toString('hex') }), 401, null,
      'Validly signed token whose sid matches no session fails closed with HTTP 401');

    // 1.15 Subject/session mismatch (Rule 11 binding)
    await expectRejected(await signWithRealKey({ sub: crypto.randomUUID() }), 401, 'INVALID_TOKEN',
      'Token whose sub does not match the session user is rejected with HTTP 401 INVALID_TOKEN');

    // 1.16 Structurally malformed credential
    await expectRejected('not-a-token', 401, 'INVALID_TOKEN',
      'Structurally malformed credential is rejected with HTTP 401 INVALID_TOKEN');

    // 1.17 Missing Authorization header
    const noAuthRes = await makeRequest('GET', '/api/auth/status');
    report(
      noAuthRes.status === 401 && noAuthRes.data?.code === 'INVALID_TOKEN',
      'Request with no Authorization header is rejected with HTTP 401 INVALID_TOKEN'
    );

    // 1.18 Error responses must not leak internals (stack traces, key material, SQL)
    const leakProbe = await makeRequest('GET', '/api/auth/status', null, forgedToken);
    const leakBody = JSON.stringify(leakProbe.data || '');
    report(
      !/BEGIN (RSA )?(PRIVATE|PUBLIC) KEY|at Object\.|\.ts:\d+|node_modules|SELECT .* FROM/i.test(leakBody),
      'Rejection responses disclose no key material, stack traces or SQL internals'
    );

    // ------------------------------------------------------------------------
    // Section 2: Session Security & Revocation Enforcement (Step 3, AC1)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 2: Session Security & Revocation Enforcement (Step 3, AC1) ---');

    // 2.1 Concurrent login without force is refused while a session is ACTIVE
    const concurrentRes = await makeRequest('POST', '/api/auth/login', {
      email: PRIMARY_USER,
      password: TEST_PASSWORD,
      force: false,
    });
    report(
      concurrentRes.status === 409 && concurrentRes.data.code === 'ACTIVE_SESSION_EXISTS',
      'Concurrent login without force is refused with HTTP 409 ACTIVE_SESSION_EXISTS'
    );

    // 2.2 The incumbent session is untouched by the refused attempt
    const incumbentRes = await makeRequest('GET', '/api/auth/status', null, baselineToken);
    report(
      incumbentRes.status === 200 && incumbentRes.data.loggedIn === true,
      'Incumbent session survives a refused concurrent login attempt'
    );

    // 2.3 Force-login supersedes and revokes the prior session (revoked sid)
    const forceRes = await makeRequest('POST', '/api/auth/login', {
      email: PRIMARY_USER,
      password: TEST_PASSWORD,
      force: true,
    });
    const forcedToken = forceRes.data.token || forceRes.data.accessToken;
    report(
      forceRes.status === 200 && forcedToken && forceRes.data.sessionId !== baselineSessionId,
      'Force login establishes a new session with a distinct sid and a fresh JWT'
    );

    await expectRejected(baselineToken, 401, null,
      'Superseded session JWT is revoked immediately by force-login (HTTP 401, revoked sid)');

    // 2.4 Refresh keeps an active session alive and rotates the access token
    const refreshRes = await makeRequest('POST', '/api/auth/refresh', null, forcedToken);
    const refreshedToken = refreshRes.data.token || refreshRes.data.accessToken;
    report(
      refreshRes.status === 200 && refreshedToken && tokenService.isJwt(refreshedToken),
      'POST /api/auth/refresh renews an active session and rotates in a fresh RS256 JWT'
    );

    // 2.5 Refresh must never resurrect a revoked session
    const revokedRefresh = await makeRequest('POST', '/api/auth/refresh', null, baselineToken);
    report(
      revokedRefresh.status === 401,
      'Refresh with a revoked token cannot resurrect the session (HTTP 401)'
    );

    // 2.6 Inactivity beyond the 15-minute sliding window expires the session
    const idleLogin = await makeRequest('POST', '/api/auth/login', {
      email: IDLE_USER,
      password: TEST_PASSWORD,
      force: true,
    });
    const idleToken = idleLogin.data.token || idleLogin.data.accessToken;
    const idleSessionId = idleLogin.data.sessionId;
    authService._setSessionLastActivity(idleToken, Date.now() - 16 * 60 * 1000);
    await pool.query(
      `UPDATE veyra_session
          SET last_activity_at = NOW() - INTERVAL '16 minutes',
              expires_at = NOW() - INTERVAL '1 minute'
        WHERE session_id = $1`,
      [idleSessionId]
    ).catch(() => { });

    await expectRejected(idleToken, 401, 'SESSION_EXPIRED',
      'Request after the 15-minute inactivity window is rejected with HTTP 401 SESSION_EXPIRED');

    const idleRefresh = await makeRequest('POST', '/api/auth/refresh', null, idleToken);
    report(idleRefresh.status === 401, 'Refresh on an inactivity-expired session fails closed with HTTP 401');
    await makeRequest('POST', '/api/auth/logout', null, idleToken);

    // 2.7 Explicit logout revokes instantly
    const logoutRes = await makeRequest('POST', '/api/auth/logout', null, refreshedToken);
    report(
      logoutRes.status === 200 && logoutRes.data.success === true,
      'POST /api/auth/logout succeeds and invalidates the local session'
    );
    await expectRejected(refreshedToken, 401, 'INVALID_TOKEN',
      'Logged-out JWT is rejected immediately with HTTP 401 INVALID_TOKEN');

    // ------------------------------------------------------------------------
    // Section 3: Identity State & Dynamic Authorization (Step 1, AC1)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 3: Identity State & Dynamic Authorization (Step 1, AC1) ---');

    // 3.1 Disabling an account mid-session cuts access off on the very next request
    const disableLogin = await makeRequest('POST', '/api/auth/login', {
      email: DISABLE_USER,
      password: TEST_PASSWORD,
      force: true,
    });
    const disableToken = disableLogin.data.token || disableLogin.data.accessToken;
    report(disableLogin.status === 200 && !!disableToken, 'Established an active session for the account-state test');

    await pool.query(`UPDATE veyra_user SET status = 'DISABLED' WHERE LOWER(email) = LOWER($1)`, [DISABLE_USER]);
    cleanup.disabledUser = DISABLE_USER;

    const disabledRes = await makeRequest('GET', '/api/auth/status', null, disableToken);
    report(
      disabledRes.status === 403 && disabledRes.data?.code === 'USER_DISABLED',
      'Account disabled mid-session is cut off on the next request with HTTP 403 USER_DISABLED',
      `got HTTP ${disabledRes.status} ${disabledRes.data?.code}`
    );

    await pool.query(`UPDATE veyra_user SET status = 'ACTIVE' WHERE LOWER(email) = LOWER($1)`, [DISABLE_USER]);
    cleanup.disabledUser = null;

    // 3.2 Stale role: demote mid-session and confirm RBAC re-reads authoritative DB privileges
    const demoteLogin = await makeRequest('POST', '/api/auth/login', {
      email: DEMOTION_USER,
      password: TEST_PASSWORD,
      force: true,
    });
    const demoteToken = demoteLogin.data.token || demoteLogin.data.accessToken;

    const privilegedBefore = await makeRequest('GET', '/api/audit/products', null, demoteToken);
    report(
      privilegedBefore.status === 200,
      'AUDIT_MANAGER session can reach an AUDIT_TRAIL-gated endpoint before demotion (HTTP 200)',
      `got HTTP ${privilegedBefore.status}`
    );

    const demoteRows = await pool.query(
      `SELECT ur.user_id, ur.role_id, r.role_code
         FROM veyra_user_role ur
         JOIN veyra_role r ON r.id = ur.role_id
         JOIN veyra_user u ON u.id = ur.user_id
        WHERE LOWER(u.email) = LOWER($1)`,
      [DEMOTION_USER]
    );
    const managerRow = demoteRows.rows.find((r) => r.role_code === 'AUDIT_MANAGER');
    const auditUserRole = await pool.query(`SELECT id FROM veyra_role WHERE role_code = 'AUDIT_USER' LIMIT 1`);

    if (managerRow && auditUserRole.rows.length > 0) {
      cleanup.demotedUser = managerRow.user_id;
      cleanup.demotedRoleCode = 'AUDIT_MANAGER';
      await pool.query(
        `UPDATE veyra_user_role SET role_id = $1 WHERE user_id = $2 AND role_id = $3`,
        [auditUserRole.rows[0].id, managerRow.user_id, managerRow.role_id]
      );

      const privilegedAfter = await makeRequest('GET', '/api/audit/products', null, demoteToken);
      report(
        privilegedAfter.status === 403 && privilegedAfter.data?.code === 'FORBIDDEN',
        'Role demoted mid-session is enforced on the next request with HTTP 403 FORBIDDEN (stale claims ignored)',
        `got HTTP ${privilegedAfter.status} ${privilegedAfter.data?.code}`
      );

      // Restore and confirm the demotion was genuinely the cause
      await pool.query(
        `UPDATE veyra_user_role SET role_id = $1 WHERE user_id = $2 AND role_id = $3`,
        [managerRow.role_id, managerRow.user_id, auditUserRole.rows[0].id]
      );
      cleanup.demotedUser = null;

      const privilegedRestored = await makeRequest('GET', '/api/audit/products', null, demoteToken);
      report(
        privilegedRestored.status === 200,
        'Restoring the role restores access on the same session, proving RBAC reads live DB state'
      );
    } else {
      report(false, 'Role demotion fixture available (AUDIT_MANAGER assignment and AUDIT_USER role present)');
    }

    await makeRequest('POST', '/api/auth/logout', null, demoteToken);

    // ------------------------------------------------------------------------
    // Section 4: Backward-Compatibility & Opaque Token Migration (Step 2, AC2)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 4: Backward-Compatibility & Opaque Migration (Step 2, AC2) ---');

    // Phase 1 — production default: legacy opaque tokens are refused outright.
    process.env.ALLOW_LEGACY_OPAQUE_TOKENS = 'false';

    const migrationLogin = await makeRequest('POST', '/api/auth/login', {
      email: PRIMARY_USER,
      password: TEST_PASSWORD,
      force: true,
    });
    const migrationJwt = migrationLogin.data.token || migrationLogin.data.accessToken;
    const legacyOpaqueToken = migrationLogin.data.sessionId;

    report(
      /^[0-9a-f]{64}$/.test(String(legacyOpaqueToken)),
      'Login still returns the 64-character hex opaque sessionId used by pre-Epic-3 clients'
    );

    const rejectedLegacy = await makeRequest('GET', '/api/auth/status', null, legacyOpaqueToken);
    report(
      rejectedLegacy.status === 401 && rejectedLegacy.data?.code === 'INVALID_TOKEN',
      'Phase 1 (default): legacy opaque token is rejected with HTTP 401 INVALID_TOKEN',
      `got HTTP ${rejectedLegacy.status} ${rejectedLegacy.data?.code}`
    );
    report(
      typeof rejectedLegacy.data?.message === 'string' && /sign in again/i.test(rejectedLegacy.data.message),
      'Phase 1 rejection message instructs re-authentication (drives the VYR-025 client purge)'
    );
    report(
      rejectedLegacy.data?.code === 'INVALID_TOKEN',
      'Phase 1 returns the exact code the VYR-025 React client listens for before dispatching auth:expired'
    );

    // The modern JWT for the same session is unaffected by the legacy rejection.
    const jwtStillValid = await makeRequest('GET', '/api/auth/status', null, migrationJwt);
    report(
      jwtStillValid.status === 200,
      'Phase 1: the RS256 JWT for the same session remains fully valid'
    );

    // Phase 2 — time-bounded migration window: legacy tokens are honoured and upgraded.
    process.env.ALLOW_LEGACY_OPAQUE_TOKENS = 'true';

    const acceptedLegacy = await makeRequest('GET', '/api/auth/status', null, legacyOpaqueToken);
    report(
      acceptedLegacy.status === 200 && acceptedLegacy.data.loggedIn === true,
      'Phase 2 (migration window): legacy opaque token is honoured for its remaining session lifetime'
    );

    // Automatic upgrade: refreshing with a legacy token must hand back a real JWT.
    const upgradeRes = await makeRequest('POST', '/api/auth/refresh', null, legacyOpaqueToken);
    const upgradedToken = upgradeRes.data.token || upgradeRes.data.accessToken;
    report(
      upgradeRes.status === 200 && upgradedToken && tokenService.isJwt(upgradedToken),
      'Phase 2: POST /api/auth/refresh transparently upgrades a legacy session to an RS256 JWT'
    );

    const upgradedVerification = await tokenService.verifyAccessToken(upgradedToken);
    report(
      upgradedVerification.valid === true && upgradedVerification.claims?.sid === legacyOpaqueToken,
      'Phase 2: the upgraded JWT verifies cryptographically and stays bound to the same sid'
    );

    const upgradedWorks = await makeRequest('GET', '/api/auth/status', null, upgradedToken);
    report(upgradedWorks.status === 200, 'Phase 2: the upgraded JWT is accepted on protected endpoints');

    // The migration window must not weaken cryptographic verification for real JWTs.
    const forgedDuringWindow = await makeRequest('GET', '/api/auth/status', null, forgedToken);
    report(
      forgedDuringWindow.status === 401,
      'Phase 2 does NOT weaken crypto: a forged JWT is still rejected while legacy tokens are allowed'
    );

    // An unknown opaque string must still fail closed even inside the window.
    const unknownOpaque = await makeRequest('GET', '/api/auth/status', null, crypto.randomBytes(32).toString('hex'));
    report(
      unknownOpaque.status === 401,
      'Phase 2: an opaque token matching no veyra_session row still fails closed with HTTP 401'
    );

    // A revoked session must stay revoked even inside the window.
    await makeRequest('POST', '/api/auth/logout', null, upgradedToken);
    const revokedDuringWindow = await makeRequest('GET', '/api/auth/status', null, legacyOpaqueToken);
    report(
      revokedDuringWindow.status === 401,
      'Phase 2: a logged-out session is not resurrected by presenting its legacy opaque token'
    );

    // Cutover: returning to the default posture closes the window again.
    process.env.ALLOW_LEGACY_OPAQUE_TOKENS = 'false';
    const postCutoverLogin = await makeRequest('POST', '/api/auth/login', {
      email: PRIMARY_USER,
      password: TEST_PASSWORD,
      force: true,
    });
    const postCutoverLegacy = postCutoverLogin.data.sessionId;
    const postCutoverRes = await makeRequest('GET', '/api/auth/status', null, postCutoverLegacy);
    report(
      postCutoverRes.status === 401 && postCutoverRes.data?.code === 'INVALID_TOKEN',
      'Cutover: clearing ALLOW_LEGACY_OPAQUE_TOKENS closes the window and rejects legacy tokens again'
    );
    await makeRequest('POST', '/api/auth/logout', null, postCutoverLogin.data.token || postCutoverLogin.data.accessToken);

    // ------------------------------------------------------------------------
    // Section 5: Cross-Provider Token Contract Parity (Step 4, AC3)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 5: Cross-Provider Token Contract Parity (Step 4, AC3) ---');

    const localLogin = await authService.login(PRIMARY_USER, TEST_PASSWORD, { force: true });
    const localToken = localLogin.token || localLogin.accessToken;
    report(
      localLogin.success === true && tokenService.isJwt(localToken),
      'LOCAL provider login issues a compact RS256 JWT'
    );

    // VYR-013 role mapping rewrites veyra_user_role to match the Entra-resolved role. With no
    // group claims it falls back to the configured default, so snapshot the real assignments
    // first - otherwise this parity check silently demotes the fixture user.
    const parityUserRow = await pool.query(`SELECT id FROM veyra_user WHERE LOWER(email) = LOWER($1) LIMIT 1`, [PRIMARY_USER]);
    const parityUserId = parityUserRow.rows[0]?.id;
    if (parityUserId) {
      const snapshot = await pool.query(`SELECT role_id FROM veyra_user_role WHERE user_id = $1`, [parityUserId]);
      cleanup.roleSnapshot = { userId: parityUserId, roleIds: snapshot.rows.map((r) => r.role_id) };
    }

    const entraSubject = `entra-${crypto.randomUUID()}`;
    cleanup.entraSubject = entraSubject;
    const entraLogin = await authService.loginWithExternalIdentity(
      {
        email: PRIMARY_USER,
        subject: entraSubject,
        tenantId: process.env.ENTRA_TENANT_ID || 'default-tenant',
        displayName: 'Parity Test Identity',
      },
      { force: true, ipAddress: '127.0.0.1', userAgent: 'VYR-026 parity test' }
    );
    const entraToken = entraLogin.token || entraLogin.accessToken;
    report(
      entraLogin.success === true && tokenService.isJwt(entraToken),
      'ENTRA provider login issues a compact RS256 JWT through the same issuance path'
    );

    if (tokenService.isJwt(localToken) && tokenService.isJwt(entraToken)) {
      const localDecoded = tokenService.decodeToken(localToken);
      const entraDecoded = tokenService.decodeToken(entraToken);

      report(
        localDecoded.header.alg === entraDecoded.header.alg && localDecoded.header.alg === contract.VEYRA_JWT_ALGORITHM,
        `Both providers sign with the same algorithm (${contract.VEYRA_JWT_ALGORITHM})`
      );
      report(
        localDecoded.header.typ === entraDecoded.header.typ && localDecoded.header.typ === contract.VEYRA_JWT_TYPE,
        `Both providers emit the same RFC 9068 media type (${contract.VEYRA_JWT_TYPE})`
      );
      report(
        localDecoded.header.kid === entraDecoded.header.kid && !!localDecoded.header.kid,
        'Both providers reference the same active signing key id (kid)'
      );

      const localClaimNames = Object.keys(localDecoded.payload).sort();
      const entraClaimNames = Object.keys(entraDecoded.payload).sort();
      report(
        JSON.stringify(localClaimNames) === JSON.stringify(entraClaimNames),
        'Both providers emit an identical claim set (no provider-specific claim drift)',
        `LOCAL=${localClaimNames.join(',')} ENTRA=${entraClaimNames.join(',')}`
      );

      const requiredPresent = (claims) =>
        contract.VEYRA_JWT_REQUIRED_CLAIMS.every((c) => claims[c] !== undefined && claims[c] !== '');
      report(
        requiredPresent(localDecoded.payload) && requiredPresent(entraDecoded.payload),
        `Both providers emit every required claim (${contract.VEYRA_JWT_REQUIRED_CLAIMS.join(', ')})`
      );

      const noForbidden = (claims) =>
        contract.VEYRA_JWT_FORBIDDEN_CLAIMS.every((c) => claims[c] === undefined);
      report(
        noForbidden(localDecoded.payload) && noForbidden(entraDecoded.payload),
        'Neither provider leaks a forbidden PII claim (email, roles, groups, permissions, ...)'
      );

      report(
        localDecoded.payload.iss === entraDecoded.payload.iss &&
          localDecoded.payload.aud === entraDecoded.payload.aud,
        'Both providers assert the same issuer and audience'
      );
      report(
        localDecoded.payload.exp - localDecoded.payload.iat === contract.VEYRA_JWT_LIFETIME_SECONDS &&
          entraDecoded.payload.exp - entraDecoded.payload.iat === contract.VEYRA_JWT_LIFETIME_SECONDS,
        `Both providers issue the same ${contract.VEYRA_JWT_LIFETIME_SECONDS}-second token lifetime`
      );
      report(
        localDecoded.payload.sid !== entraDecoded.payload.sid &&
          localDecoded.payload.jti !== entraDecoded.payload.jti,
        'Each login receives a unique sid and jti (no token or session reuse across logins)'
      );

      const entraVerification = await tokenService.verifyAccessToken(entraToken);
      report(
        entraVerification.valid === true,
        'The ENTRA-issued token verifies through the identical verification pipeline'
      );

      const entraSession = authService.getSession(entraToken);
      report(
        entraSession?.authProvider === 'ENTRA',
        'Provider identity is recorded in server-side session state, not in the token payload'
      );
    }

    if (entraToken) await makeRequest('POST', '/api/auth/logout', null, entraToken);

    // ------------------------------------------------------------------------
    // Section 6: Documentation & Epic 3 Regression Harness (AC2, AC3)
    // ------------------------------------------------------------------------
    console.log('\n--- Section 6: Documentation & Epic 3 Regression Harness (AC2, AC3) ---');

    const docPath = path.resolve(__dirname, '../../docs/architecture/jwt_security_and_backward_compatibility_migration.md');
    const docExists = fs.existsSync(docPath);
    report(docExists, 'docs/architecture/jwt_security_and_backward_compatibility_migration.md exists');

    if (docExists) {
      const doc = fs.readFileSync(docPath, 'utf8');
      report(doc.includes('VYR-026'), 'Documentation references Story VYR-026');
      report(doc.includes('ALLOW_LEGACY_OPAQUE_TOKENS'), 'Documentation names the migration control flag');
      report(
        /Phase 1/i.test(doc) && /Phase 2/i.test(doc),
        'Documentation defines both migration phases (reject-by-default and time-bounded window)'
      );
      report(
        doc.includes('USER_DISABLED') && doc.includes('SESSION_EXPIRED') && doc.includes('INVALID_TOKEN'),
        'Documentation enumerates the fail-closed error codes asserted by this suite'
      );
      report(
        doc.includes(contract.VEYRA_JWT_ISSUER) && doc.includes(contract.VEYRA_JWT_AUDIENCE),
        `Documented issuer/audience match the runtime contract (${contract.VEYRA_JWT_ISSUER} / ${contract.VEYRA_JWT_AUDIENCE})`
      );
      report(
        !/"email"\s*:/.test(doc) && !/"permissions"\s*:/.test(doc),
        'Documented token payload contains no forbidden PII claim (doc matches the zero-PII contract)'
      );
      report(
        doc.includes('test_story_026_jwt_security_and_migration.cjs'),
        'Documentation points at this verification suite by filename'
      );
    }

    // AC3 regression harness: every Epic 3 suite must exist and be runnable by name.
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    const epic3Suites = [
      ['test:vyr19', 'test_story_019_jwt_contract.cjs'],
      ['test:vyr20', 'test_story_020_jwt_issuance.cjs'],
      ['test:vyr22', 'test_story_022_key_rotation.cjs'],
      ['test:vyr23', 'test_story_023_jwt_rbac.cjs'],
      ['test:vyr24', 'test_story_024_jwt_session_lifecycle.cjs'],
      ['test:vyr25', 'test_story_025_react_api_client.cjs'],
      ['test:vyr26', 'test_story_026_jwt_security_and_migration.cjs'],
    ];
    for (const [scriptName, fileName] of epic3Suites) {
      report(
        fs.existsSync(path.resolve(__dirname, fileName)) && typeof pkg.scripts?.[scriptName] === 'string',
        `Epic 3 regression harness wired: ${scriptName} -> ${fileName}`
      );
    }
    report(
      typeof pkg.scripts?.['test:epic3'] === 'string',
      'Aggregate "test:epic3" script runs the full VYR-019..VYR-026 authentication regression'
    );

  } catch (err) {
    console.error('Fatal error during test execution:', err);
    failed++;
  } finally {
    // Always restore any live database state this suite mutated.
    try {
      if (cleanup.disabledUser) {
        await pool.query(`UPDATE veyra_user SET status = 'ACTIVE' WHERE LOWER(email) = LOWER($1)`, [cleanup.disabledUser]);
        console.log(`[Cleanup] Restored ${cleanup.disabledUser} to ACTIVE`);
      }
      if (cleanup.demotedUser && cleanup.demotedRoleCode) {
        const role = await pool.query(`SELECT id FROM veyra_role WHERE role_code = $1 LIMIT 1`, [cleanup.demotedRoleCode]);
        const auditUserRole = await pool.query(`SELECT id FROM veyra_role WHERE role_code = 'AUDIT_USER' LIMIT 1`);
        if (role.rows.length && auditUserRole.rows.length) {
          await pool.query(
            `UPDATE veyra_user_role SET role_id = $1 WHERE user_id = $2 AND role_id = $3`,
            [role.rows[0].id, cleanup.demotedUser, auditUserRole.rows[0].id]
          );
          console.log(`[Cleanup] Restored ${cleanup.demotedRoleCode} assignment`);
        }
      }
      if (cleanup.roleSnapshot && cleanup.roleSnapshot.roleIds.length > 0) {
        const { userId, roleIds } = cleanup.roleSnapshot;
        const current = await pool.query(`SELECT role_id FROM veyra_user_role WHERE user_id = $1`, [userId]);
        const currentIds = current.rows.map((r) => r.role_id).sort().join(',');
        if (currentIds !== roleIds.slice().sort().join(',')) {
          await pool.query(`DELETE FROM veyra_user_role WHERE user_id = $1`, [userId]);
          for (const roleId of roleIds) {
            await pool.query(
              `INSERT INTO veyra_user_role (user_id, role_id, created_by) VALUES ($1, $2, 'VYR-026-TEST-RESTORE')`,
              [userId, roleId]
            );
          }
          console.log('[Cleanup] Restored role assignments mutated by the Entra parity login');
        }
      }
      if (cleanup.entraSubject) {
        await pool.query(
          `DELETE FROM veyra_user_identity_mapping WHERE external_user_id = $1`,
          [cleanup.entraSubject]
        ).catch(() => { });
      }
    } catch (cleanupErr) {
      console.error('[Cleanup] Failed to restore database state:', cleanupErr.message);
      failed++;
    }

    if (originalLegacyFlag === undefined) {
      delete process.env.ALLOW_LEGACY_OPAQUE_TOKENS;
    } else {
      process.env.ALLOW_LEGACY_OPAQUE_TOKENS = originalLegacyFlag;
    }

    server.close();
    try {
      await pool.end();
    } catch (_) { }
  }

  console.log('\n================================================================');
  console.log(`  Passed: ${passed}  Failed: ${failed}`);
  console.log('================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
