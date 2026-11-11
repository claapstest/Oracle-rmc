/**
 * Automated Verification Suite: Story VYR-018
 * Epic 2: Configurable authentication providers: Entra ID and Local Users
 * Story Title: Test Entra and Local authentication scenarios
 *
 * Acceptance Criteria Verified:
 *  1. Entra: valid/invalid issuer, audience, tenant, signature, expiry and missing claims.
 *  2. Local: invalid password, disabled user, inactive account and active-session conflict.
 *  3. Role mapping, unknown identity, logout, session expiry and provider misconfiguration.
 *  4. Audit events are recorded and secrets/tokens are never logged or persisted.
 *
 * Run: npm --prefix backend run test:story18
 * DB-dependent cases are skipped with an explicit SKIP when PostgreSQL is unreachable.
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

let passed = 0;
let failed = 0;
let skipped = 0;

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

function skip(message) {
  console.log(`  SKIP: ${message}`);
  skipped++;
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

function throwsWithCode(fn, expectedCode, expectedStatus) {
  try {
    fn();
    return false;
  } catch (err) {
    return err && err.code === expectedCode && (expectedStatus === undefined || err.status === expectedStatus);
  }
}

async function main() {
  console.log('================================================================');
  console.log('  VYR-018: Entra + Local Authentication Scenario Matrix');
  console.log('================================================================\n');

  const { AuthenticationProviderFactory } = requireDist('auth/factory.js');
  const {
    LocalAuthenticationProvider,
    LOCAL_AUTH_GENERIC_FAILURE_MSG,
    LOCAL_AUTH_INACTIVE_MSG,
  } = requireDist('auth/providers/LocalAuthenticationProvider.js');
  const { EntraAuthenticationProvider } = requireDist('auth/providers/EntraAuthenticationProvider.js');
  const {
    validateEntraClaims,
    verifyEntraIdToken,
    extractIdentityEmail,
  } = requireDist('services/entraOidcService.js');
  const { entraIdentityService } = requireDist('services/entraIdentityService.js');
  const { sanitizeAuditDetails } = requireDist('services/auditService.js');
  const { config } = requireDist('config.js');

  const tenantId = '11111111-2222-3333-4444-555555555555';
  const clientId = 'veyra-test-client';
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const expected = { issuer, audience: clientId, tenantId, nonce: 'nonce-vyr018' };

  const baseClaims = {
    iss: issuer,
    aud: clientId,
    tid: tenantId,
    nonce: expected.nonce,
    exp: Math.floor(Date.now() / 1000) + 300,
    preferred_username: 'User@Example.com',
    oid: 'oid-vyr018',
    sub: 'sub-vyr018',
  };

  // -------------------------------------------------------------------------
  // Section 1: Provider selection and misconfiguration (fail closed)
  // -------------------------------------------------------------------------
  console.log('--- Section 1: Provider selection and misconfiguration ---');

  const localProvider = AuthenticationProviderFactory.initialize('LOCAL');
  report(localProvider.metadata.type === 'LOCAL', 'AUTH_PROVIDER=LOCAL selects the local provider');

  const entraProvider = AuthenticationProviderFactory.initialize('ENTRA', {
    tenantId,
    clientId,
    redirectUri: 'https://app.veyra.internal/auth/callback',
  });
  report(entraProvider.metadata.type === 'ENTRA', 'AUTH_PROVIDER=ENTRA selects the Entra provider');

  report(
    throwsWithCode(() => AuthenticationProviderFactory.initialize('BOGUS'), 'UNKNOWN_AUTH_PROVIDER'),
    'Unknown AUTH_PROVIDER fails closed with UNKNOWN_AUTH_PROVIDER'
  );
  report(
    throwsWithCode(
      () => AuthenticationProviderFactory.initialize('ENTRA', { tenantId: '', clientId: '', redirectUri: '' }),
      'MISSING_ENTRA_CONFIG'
    ),
    'ENTRA with missing tenant/client configuration fails closed with MISSING_ENTRA_CONFIG'
  );

  const incompleteEntra = new EntraAuthenticationProvider({ tenantId: '   ', clientId: '' });
  report(
    throwsWithCode(() => incompleteEntra.validateConfiguration(), 'MISSING_ENTRA_CONFIG'),
    'Entra provider rejects blank tenant/client values at startup'
  );

  const rawTokenResult = await incompleteEntra.authenticate({ token: 'raw-id-token' });
  report(
    rawTokenResult.success === false && rawTokenResult.code === 'ENTRA_AUTH_FAILED',
    'Raw Entra token input is never trusted outside the authorization-code callback'
  );
  const missingEntraCreds = await incompleteEntra.authenticate({});
  report(
    missingEntraCreds.success === false && missingEntraCreds.code === 'MISSING_ENTRA_CREDENTIALS',
    'Entra authentication without token/code/email is rejected'
  );

  AuthenticationProviderFactory.initialize('LOCAL');

  // -------------------------------------------------------------------------
  // Section 2: Entra claim validation (issuer, audience, tenant, nonce, expiry, claims)
  // -------------------------------------------------------------------------
  console.log('\n--- Section 2: Entra claim validation ---');

  let validClaimsPassed = true;
  try {
    validateEntraClaims(baseClaims, expected);
  } catch {
    validClaimsPassed = false;
  }
  report(validClaimsPassed, 'Valid Entra claims (issuer, audience, tenant, nonce, expiry, email) are accepted');

  const claimNegatives = [
    ['wrong issuer', { ...baseClaims, iss: 'https://login.microsoftonline.com/evil/v2.0' }],
    ['wrong audience', { ...baseClaims, aud: 'some-other-client' }],
    ['wrong tenant', { ...baseClaims, tid: '99999999-9999-9999-9999-999999999999' }],
    ['wrong nonce', { ...baseClaims, nonce: 'replayed-nonce' }],
    ['expired token', { ...baseClaims, exp: Math.floor(Date.now() / 1000) - 3600 }],
    ['missing email/upn/preferred_username', { ...baseClaims, preferred_username: undefined, email: undefined, upn: undefined }],
  ];

  for (const [label, claims] of claimNegatives) {
    report(
      throwsWithCode(() => validateEntraClaims(claims, expected), 'INVALID_TOKEN', 401),
      `Entra claims with ${label} are rejected with INVALID_TOKEN (401)`
    );
  }

  report(
    validateEntraClaims({ ...baseClaims, aud: [clientId, 'api://other'] }, expected) === undefined,
    'Entra audience array containing the configured client ID is accepted'
  );
  report(
    extractIdentityEmail({ preferred_username: '  Mixed.Case@Example.COM ' }) === 'mixed.case@example.com',
    'Entra email extraction normalizes preferred_username to lowercase'
  );
  report(
    extractIdentityEmail({ email: 'fallback@example.com' }) === 'fallback@example.com' &&
      extractIdentityEmail({ upn: 'upn@example.com' }) === 'upn@example.com',
    'Entra email extraction falls back to email and upn claims'
  );
  report(
    extractIdentityEmail({ preferred_username: 'no-at-sign' }) === null,
    'Entra email extraction rejects claims without an @ address'
  );

  // -------------------------------------------------------------------------
  // Section 3: Entra signature, algorithm and key-ID verification
  // -------------------------------------------------------------------------
  console.log('\n--- Section 3: Entra signature, algorithm and key-ID verification ---');

  const jose = await import('jose');
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const { privateKey: otherPrivateKey } = await jose.generateKeyPair('RS256');

  const publicJwk = await jose.exportJWK(publicKey);
  publicJwk.kid = 'vyr018-key';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  const jwks = jose.createLocalJWKSet({ keys: [publicJwk] });

  const entraConfig = { tenantId, clientId, redirectUri: 'https://app.veyra.internal/auth/callback' };

  async function signToken(overrides = {}, options = {}) {
    const payload = {
      tid: tenantId,
      nonce: expected.nonce,
      preferred_username: 'user@example.com',
      oid: 'oid-vyr018',
      sub: 'sub-vyr018',
      ...overrides,
    };
    return new jose.SignJWT(payload)
      .setProtectedHeader({ alg: options.alg || 'RS256', kid: options.kid || 'vyr018-key' })
      .setIssuer(options.issuer || issuer)
      .setAudience(options.audience || clientId)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn || '5m')
      .sign(options.key || privateKey);
  }

  async function verify(token) {
    return verifyEntraIdToken(token, { config: entraConfig, jwks, nonce: expected.nonce });
  }

  async function verifyRejects(token, label) {
    try {
      await verify(token);
      report(false, `Entra ID token with ${label} is rejected`);
    } catch (err) {
      report(
        err && err.code === 'INVALID_TOKEN' && err.status === 401,
        `Entra ID token with ${label} is rejected with INVALID_TOKEN (401)`,
        err && err.message
      );
    }
  }

  const validToken = await signToken();
  try {
    const verified = await verify(validToken);
    report(
      verified && verified.preferred_username === 'user@example.com',
      'Valid RS256 Entra ID token passes signature, issuer and audience verification'
    );
  } catch (err) {
    report(false, 'Valid RS256 Entra ID token passes verification', err && err.message);
  }

  const tokenParts = validToken.split('.');
  const signatureBytes = Buffer.from(tokenParts[2], 'base64url');
  signatureBytes[0] ^= 0xff;
  const tampered = `${tokenParts[0]}.${tokenParts[1]}.${signatureBytes.toString('base64url')}`;
  await verifyRejects(tampered, 'a tampered signature');
  await verifyRejects(await signToken({}, { key: otherPrivateKey }), 'a signature from an untrusted key');
  await verifyRejects(await signToken({}, { alg: 'HS256', key: new TextEncoder().encode('shared-secret') }), 'the HS256 algorithm');
  await verifyRejects(await signToken({}, { kid: 'unknown-kid' }), 'an unknown key ID (kid)');
  await verifyRejects(await signToken({}, { issuer: 'https://login.microsoftonline.com/evil/v2.0' }), 'a wrong issuer');
  await verifyRejects(await signToken({}, { audience: 'another-api' }), 'a wrong audience');
  await verifyRejects(await signToken({}, { expiresIn: Math.floor(Date.now() / 1000) - 3600 }), 'an expired exp claim');

  // -------------------------------------------------------------------------
  // Section 4: Entra role mapping and tenant isolation
  // -------------------------------------------------------------------------
  console.log('\n--- Section 4: Entra role mapping and tenant isolation ---');

  const savedEntraConfig = { ...config.entra };
  try {
    config.entra.roleMapping = {};
    config.entra.requireRoleMapping = false;
    config.entra.defaultRole = 'AUDIT_USER';

    report(
      entraIdentityService.resolveEntraRole({ email: 'a@b.com', subject: 's', tenantId, roles: ['AUDIT_USER'] }).roleCode ===
        'AUDIT_USER',
      'Direct Entra role claim maps to AUDIT_USER'
    );
    report(
      entraIdentityService.resolveEntraRole({
        email: 'a@b.com', subject: 's', tenantId, roles: ['AUDIT_USER', 'SITE_ADMIN'],
      }).roleCode === 'SITE_ADMIN',
      'Highest-privilege role wins when multiple role claims are present'
    );
    report(
      entraIdentityService.resolveEntraRole({
        email: 'a@b.com', subject: 's', tenantId, groups: ['veyra.auditmanager'],
      }).roleCode === 'AUDIT_MANAGER',
      'Standard Entra group convention (veyra.auditmanager) maps to AUDIT_MANAGER'
    );

    config.entra.roleMapping = { 'veyra-security-admins': 'SITE_ADMIN' };
    const mapped = entraIdentityService.resolveEntraRole({
      email: 'a@b.com', subject: 's', tenantId, groups: ['veyra-security-admins'],
    });
    report(
      mapped.roleCode === 'SITE_ADMIN' && mapped.source === 'CLAIM_MAPPING',
      'Configured ENTRA_ROLE_MAPPING claim maps to the approved Veyra role'
    );

    config.entra.requireRoleMapping = true;
    const unmapped = entraIdentityService.resolveEntraRole({ email: 'a@b.com', subject: 's', tenantId, roles: [] });
    report(
      unmapped.roleCode === null && unmapped.source === 'UNMAPPED',
      'Unmapped Entra identity is denied when role mapping is required'
    );

    config.entra.requireRoleMapping = false;
    const fallback = entraIdentityService.resolveEntraRole({ email: 'a@b.com', subject: 's', tenantId, roles: [] });
    report(
      fallback.roleCode === 'AUDIT_USER' && fallback.source === 'DEFAULT_FALLBACK',
      'Unmapped Entra identity receives the configured least-privilege fallback role'
    );

    config.entra.tenantId = tenantId;
    report(
      entraIdentityService.isTenantAllowed(tenantId) === true &&
        entraIdentityService.isTenantAllowed('99999999-9999-9999-9999-999999999999') === false,
      'Entra tenant isolation accepts the configured tenant and rejects other tenants'
    );

    config.entra.tenantId = '';
    report(
      entraIdentityService.isTenantAllowed('any-tenant') === true,
      'Unconstrained development configuration permits the incoming tenant'
    );
  } finally {
    config.entra = savedEntraConfig;
  }

  // -------------------------------------------------------------------------
  // Section 5: Local provider credential and account-status matrix
  // -------------------------------------------------------------------------
  console.log('\n--- Section 5: Local provider credential and account-status matrix ---');

  const local = new LocalAuthenticationProvider();
  const validHash = await local.hashPassword('ValidPass@123');
  const activeUser = {
    id: 'vyr018-user',
    email: 'vyr018.user@example.com',
    password_hash: validHash,
    display_name: 'VYR-018 User',
    status: 'ACTIVE',
  };

  function stubLookup(user) {
    local.lookupUser = async () => user;
  }

  stubLookup(activeUser);
  const validLogin = await local.authenticate({
    email: '  VYR018.User@Example.COM ',
    password: 'ValidPass@123',
  });
  report(validLogin.success === true, 'Valid local credentials authenticate successfully');
  report(
    validLogin.identity &&
      validLogin.identity.email === 'vyr018.user@example.com' &&
      validLogin.identity.password === undefined &&
      validLogin.identity.password_hash === undefined,
    'Successful local identity is normalized and omits password/hash fields'
  );

  const wrongPassword = await local.authenticate({
    email: 'vyr018.user@example.com',
    password: 'WrongPass@123',
  });
  report(
    wrongPassword.success === false &&
      wrongPassword.code === 'INVALID_CREDENTIALS' &&
      wrongPassword.message === LOCAL_AUTH_GENERIC_FAILURE_MSG,
    'Wrong local password is rejected with the generic INVALID_CREDENTIALS message'
  );

  stubLookup(null);
  const unknownUser = await local.authenticate({
    email: 'missing.user@example.com',
    password: 'AnyPass@123',
  });
  report(
    unknownUser.success === false &&
      unknownUser.code === 'INVALID_CREDENTIALS' &&
      unknownUser.message === wrongPassword.message,
    'Unknown local user returns the same generic error as a wrong password (anti-enumeration)'
  );

  stubLookup({ ...activeUser, status: 'DISABLED' });
  const disabled = await local.authenticate({
    email: 'vyr018.user@example.com',
    password: 'ValidPass@123',
  });
  report(
    disabled.success === false &&
      disabled.code === 'ACCOUNT_INACTIVE' &&
      disabled.status === 'DISABLED' &&
      disabled.message === LOCAL_AUTH_INACTIVE_MSG,
    'Disabled local user is denied with ACCOUNT_INACTIVE before password comparison'
  );

  stubLookup({ ...activeUser, status: 'INACTIVE' });
  const inactive = await local.authenticate({
    email: 'vyr018.user@example.com',
    password: 'ValidPass@123',
  });
  report(
    inactive.success === false && inactive.code === 'ACCOUNT_INACTIVE' && inactive.status === 'INACTIVE',
    'Inactive local account is denied with ACCOUNT_INACTIVE'
  );

  stubLookup({ ...activeUser, password_hash: null });
  const noHash = await local.authenticate({
    email: 'vyr018.user@example.com',
    password: 'ValidPass@123',
  });
  report(
    noHash.success === false && noHash.code === 'INVALID_CREDENTIALS',
    'Account without a password hash cannot authenticate'
  );

  const missingCredentials = await local.authenticate({ email: '', password: '' });
  report(
    missingCredentials.success === false && missingCredentials.code === 'INVALID_CREDENTIALS',
    'Missing local credentials are rejected'
  );

  // No secret material may be written to the console during failed authentication.
  const captured = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  console.log = (...args) => captured.push(args.join(' '));
  console.error = (...args) => captured.push(args.join(' '));
  console.warn = (...args) => captured.push(args.join(' '));
  try {
    stubLookup(activeUser);
    await local.authenticate({ email: 'vyr018.user@example.com', password: 'TopSecretPassword!42' });
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
  report(
    !captured.some((line) => line.includes('TopSecretPassword!42') || line.includes(validHash)),
    'Failed local authentication logs neither the plaintext password nor the password hash'
  );

  // -------------------------------------------------------------------------
  // Section 6: Audit sanitization (secrets and tokens)
  // -------------------------------------------------------------------------
  console.log('\n--- Section 6: Audit sanitization ---');

  const dirty = {
    password: 'PlaintextPassword!1',
    passwordHash: validHash,
    token: 'opaque-session-token',
    access_token: 'access-token-value',
    authorization: 'Bearer abc.def.ghi',
    clientSecret: 'super-secret',
    safeField: 'keep-me',
    nested: {
      refreshToken: 'refresh-token-value',
      password_hash: validHash,
      reason: 'INVALID_CREDENTIALS',
    },
  };
  const clean = sanitizeAuditDetails(dirty);
  const flat = JSON.stringify(clean);

  report(
    clean && clean.safeField === 'keep-me' && clean.nested.reason === 'INVALID_CREDENTIALS',
    'Audit sanitization preserves non-sensitive diagnostic fields'
  );
  report(
    !('password' in clean) &&
      !('passwordHash' in clean) &&
      !('token' in clean) &&
      !('access_token' in clean) &&
      !('authorization' in clean) &&
      !('clientSecret' in clean),
    'Audit sanitization strips password, token, authorization and secret keys'
  );
  report(
    !('refreshToken' in clean.nested) && !('password_hash' in clean.nested),
    'Audit sanitization recursively strips sensitive nested keys'
  );
  report(
    !flat.includes('PlaintextPassword!1') &&
      !flat.includes(validHash) &&
      !flat.includes('opaque-session-token') &&
      !flat.includes('super-secret'),
    'Audit sanitization output contains no secret values'
  );
  report(
    sanitizeAuditDetails('Bearer opaque-token') === '[REDACTED_BEARER_TOKEN]',
    'Bearer token strings are redacted in audit details'
  );
  report(
    sanitizeAuditDetails('eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123') === '[REDACTED_JWT]',
    'Raw JWT strings are redacted in audit details'
  );

  // -------------------------------------------------------------------------
  // Section 7: Database-backed session, logout, expiry and audit matrix
  // -------------------------------------------------------------------------
  console.log('\n--- Section 7: Database-backed session, logout, expiry and audit matrix ---');

  let dbAvailable = false;
  try {
    const { Pool } = require('pg');
    const probe = new Pool({
      connectionString:
        process.env.DATABASE_URL ||
        `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || '127.0.0.1'}:${process.env.POSTGRES_PORT || '5433'}/${process.env.POSTGRES_DB || 'veyra_db'}`,
      connectionTimeoutMillis: 1500,
      max: 1,
    });
    await probe.query('SELECT 1');
    await probe.end();
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }

  if (!dbAvailable) {
    skip('PostgreSQL unreachable: active-session conflict, logout, session expiry, DB audit events and Entra provisioning cases');
  } else {
    const { authService } = await import('../dist/services/authService.js');
    const { pool, query } = await import('../dist/db.js');

    const stamp = Date.now();
    const email = `vyr018.temp.${stamp}@example.com`;
    const password = 'TempPass@123';

    const cleanupUser = async (targetEmail) => {
      const normalized = targetEmail.toLowerCase();
      await query(
        `DELETE FROM veyra_session WHERE user_id IN (SELECT id FROM veyra_user WHERE LOWER(email) = $1)`,
        [normalized]
      ).catch(() => {});
      await query(
        `DELETE FROM veyra_user_role WHERE user_id IN (SELECT id FROM veyra_user WHERE LOWER(email) = $1)`,
        [normalized]
      ).catch(() => {});
      await query(`DELETE FROM veyra_user_identity_mapping WHERE LOWER(external_email) = $1`, [normalized]).catch(() => {});
      await query(`DELETE FROM veyra_user WHERE LOWER(email) = $1`, [normalized]).catch(() => {});
      if (authService.users && authService.users[normalized]) {
        delete authService.users[normalized];
        authService.saveUsers();
      }
    };

    try {
      const createRes = await authService.createUser({
        email,
        displayName: 'VYR-018 Temp User',
        role: 'AUDIT_USER',
        password,
        status: 'ACTIVE',
      });
      report(createRes.success === true && Boolean(createRes.user), 'Temporary local user is provisioned for integration cases');

      const badPassword = await authService.login(email, 'WrongTempPass@123');
      report(
        badPassword.success === false && badPassword.code === 'INVALID_CREDENTIALS',
        'Local login with an invalid password is denied'
      );

      const unknown = await authService.login(`vyr018.missing.${stamp}@example.com`, password);
      report(
        unknown.success === false && unknown.code === 'INVALID_CREDENTIALS',
        'Local login for an unknown identity is denied'
      );

      const firstLogin = await authService.login(email, password, { force: true });
      report(firstLogin.success === true && typeof firstLogin.token === 'string', 'Valid local login creates a session');
      const firstToken = firstLogin.token;

      const conflict = await authService.login(email, password, { force: false });
      report(
        conflict.success === false && conflict.code === 'ACTIVE_SESSION_EXISTS',
        'Second login without force is rejected with ACTIVE_SESSION_EXISTS'
      );

      const forced = await authService.login(email, password, { force: true });
      report(forced.success === true, 'Force login supersedes the existing active session');
      const secondToken = forced.token;

      const oldSession = await authService.validateSession(firstToken, false);
      report(oldSession.valid === false, 'Superseded session is invalidated immediately');

      await authService.logout(secondToken, { ipAddress: '127.0.0.1', userAgent: 'VYR018-Test' });
      const afterLogout = await authService.validateSession(secondToken, false);
      report(
        afterLogout.valid === false && afterLogout.code === 'INVALID_TOKEN',
        'Logout revokes the session immediately (INVALID_TOKEN)'
      );

      const expiryLogin = await authService.login(email, password, { force: true });
      const expiryToken = expiryLogin.token;
      const expiredAt = Date.now() - 901 * 1000;
      const cachedSession = authService.getSession(expiryToken);
      if (cachedSession) {
        cachedSession.lastActivityAt = expiredAt;
        cachedSession.expiresAt = expiredAt;
      }
      await query(
        `UPDATE veyra_session
         SET last_activity_at = to_timestamp($1 / 1000.0),
             expires_at = to_timestamp($1 / 1000.0)
         WHERE session_id = $2`,
        [expiredAt, expiryToken]
      );
      const expired = await authService.validateSession(expiryToken, true);
      report(
        expired.valid === false && expired.code === 'SESSION_EXPIRED',
        'Session past the 15-minute inactivity window is rejected with SESSION_EXPIRED'
      );

      await authService.updateUser(email, { status: 'DISABLED' });
      const disabledSession = await authService.login(email, password, { force: true });
      report(
        disabledSession.success === false && disabledSession.status === 'DISABLED',
        'Disabled local user cannot start a new session'
      );

      const auditRows = await query(
        `SELECT event_type, details FROM veyra_audit_event
         WHERE event_time > now() - interval '5 minutes'
           AND event_type IN ('LOGIN_FAILED', 'LOGIN_SUCCESS', 'LOGOUT')
         ORDER BY event_time DESC
         LIMIT 50`
      );
      const auditText = JSON.stringify(auditRows.rows);
      report(
        auditRows.rows.some((r) => r.event_type === 'LOGIN_FAILED') &&
          auditRows.rows.some((r) => r.event_type === 'LOGIN_SUCCESS') &&
          auditRows.rows.some((r) => r.event_type === 'LOGOUT'),
        'Audit trail records LOGIN_FAILED, LOGIN_SUCCESS and LOGOUT events'
      );
      report(
        !auditText.includes(password) &&
          !auditText.includes('WrongTempPass@123') &&
          !auditText.includes(firstToken) &&
          !auditText.includes(secondToken),
        'Audit records contain no plaintext password or session token'
      );

      // Entra identity provisioning and disabled-account enforcement.
      const entraEmail = `vyr018.entra.${stamp}@example.com`;
      await authService.createUser({
        email: entraEmail,
        displayName: 'VYR-018 Entra User',
        role: 'AUDIT_USER',
        password,
        status: 'ACTIVE',
      });

      const savedTenant = config.entra.tenantId;
      const savedJit = config.entra.jitProvisioning;
      try {
        config.entra.tenantId = tenantId;
        config.entra.jitProvisioning = false;

        const claims = {
          email: entraEmail,
          subject: `entra-oid-${stamp}`,
          tenantId,
          displayName: 'VYR-018 Entra User',
          roles: ['AUDIT_USER'],
        };

        const provisioned = await entraIdentityService.resolveOrProvision(claims, {
          ipAddress: '127.0.0.1',
          userAgent: 'VYR018-Test',
        });
        report(
          provisioned.success === true && provisioned.mapping && provisioned.mapping.tenantId === tenantId,
          'Entra identity maps to an existing Veyra user and records the external identity mapping'
        );

        const unknownEntra = await entraIdentityService.resolveOrProvision(
          {
            email: `vyr018.unmapped.${stamp}@example.com`,
            subject: `entra-unmapped-${stamp}`,
            tenantId,
            roles: ['AUDIT_USER'],
          },
          { ipAddress: '127.0.0.1', userAgent: 'VYR018-Test' }
        );
        report(
          unknownEntra.success === false && unknownEntra.code === 'IDENTITY_NOT_PROVISIONED',
          'Unknown Entra identity is denied when JIT provisioning is disabled'
        );

        const mismatch = await entraIdentityService.resolveOrProvision(
          {
            email: entraEmail,
            subject: `entra-oid-${stamp}`,
            tenantId: '99999999-9999-9999-9999-999999999999',
            roles: ['AUDIT_USER'],
          },
          { ipAddress: '127.0.0.1', userAgent: 'VYR018-Test' }
        );
        report(
          mismatch.success === false && mismatch.code === 'TENANT_MISMATCH',
          'Entra identity from an unconfigured tenant is denied with TENANT_MISMATCH'
        );

        await authService.updateUser(entraEmail, { status: 'DISABLED' });
        const disabledEntra = await entraIdentityService.resolveOrProvision(claims, {
          ipAddress: '127.0.0.1',
          userAgent: 'VYR018-Test',
        });
        report(
          disabledEntra.success === false && disabledEntra.code === 'USER_DISABLED',
          'Disabled Veyra user cannot authenticate through Entra'
        );
      } finally {
        config.entra.tenantId = savedTenant;
        config.entra.jitProvisioning = savedJit;
        await cleanupUser(entraEmail);
      }
    } finally {
      await cleanupUser(email);
      await pool.end().catch(() => {});
    }
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`  Passed: ${passed}  Failed: ${failed}  Skipped: ${skipped}`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('[Fatal Test Error]:', err);
  process.exit(1);
});
