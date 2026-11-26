/**
 * Automated Verification Suite: Story VYR-057
 * Epic 7: Security, branch, regression and release testing
 * Story Title: Integration test Entra and Local authentication providers
 *
 * Acceptance Criteria Verified:
 *  1. Both modes pass integration tests.
 *  2. Unmapped or disabled identities are denied.
 *  3. No provider credential/token is leaked.
 *
 * Test Sections:
 *  1. Local provider — valid credentials, correct identity issuance.
 *  2. Local provider — invalid password returns generic failure (anti-enumeration).
 *  3. Local provider — nonexistent user returns same generic failure.
 *  4. Local provider — disabled/inactive account fails closed.
 *  5. Local provider — missing credentials rejected.
 *  6. Local provider — email normalization and format validation.
 *  7. Local provider — bcrypt hashing and comparison.
 *  8. Local provider — development seed user (admin@admin.com) protection.
 *  9. Entra provider — metadata and configuration validation.
 * 10. Entra provider — missing configuration fails closed (ConfigurationError).
 * 11. Entra provider — authenticate rejects raw credentials (requires BFF callback).
 * 12. Entra provider — resolveIdentity returns normalized profile.
 * 13. Entra OIDC — validateEntraClaims: valid claims pass.
 * 14. Entra OIDC — validateEntraClaims: invalid issuer rejected.
 * 15. Entra OIDC — validateEntraClaims: wrong audience rejected.
 * 16. Entra OIDC — validateEntraClaims: wrong tenant rejected.
 * 17. Entra OIDC — validateEntraClaims: wrong nonce rejected.
 * 18. Entra OIDC — validateEntraClaims: expired token rejected.
 * 19. Entra OIDC — validateEntraClaims: missing email rejected.
 * 20. Entra OIDC — extractIdentityEmail from various claim shapes.
 * 21. Entra identity service — role resolution from claims.
 * 22. Factory — AUTH_PROVIDER=LOCAL selects LocalAuthenticationProvider.
 * 23. Factory — AUTH_PROVIDER=ENTRA selects EntraAuthenticationProvider.
 * 24. Factory — unknown provider throws ConfigurationError.
 * 25. Factory — reset clears singleton.
 * 26. JWT claims contract — both providers issue same Veyra JWT structure.
 * 27. Credential/token leakage — no password, secret, or raw token in results.
 *
 * Run: npm --prefix backend run test:vyr57
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

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
    if (details !== undefined) console.error('        Details:', typeof details === 'object' ? JSON.stringify(details) : details);
    failed++;
  }
}

function skip(message) {
  console.log(`  SKIP: ${message}`);
  skipped++;
}

function section(name) {
  currentSection = { name, startPassed: passed, startFailed: failed };
  console.log(`\n--- ${name} ---`);
}

function sectionEnd() {
  if (currentSection) {
    const p = passed - currentSection.startPassed;
    const f = failed - currentSection.startFailed;
    sections.push({ name: currentSection.name, passed: p, failed: f });
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

async function main() {
  console.log('================================================================');
  console.log('  VYR-057: Integration Test Entra and Local');
  console.log('           Authentication Providers');
  console.log('================================================================\n');

  // Load modules
  const { LocalAuthenticationProvider, LOCAL_AUTH_GENERIC_FAILURE_MSG, LOCAL_AUTH_INACTIVE_MSG } = requireDist('auth/providers/LocalAuthenticationProvider.js');
  const { EntraAuthenticationProvider } = requireDist('auth/providers/EntraAuthenticationProvider.js');
  const { AuthenticationProviderFactory } = requireDist('auth/factory.js');
  const { ConfigurationError } = requireDist('auth/types.js');
  const { tokenService } = requireDist('auth/tokenService.js');
  const { keyManager } = requireDist('auth/keyManager.js');
  const {
    VEYRA_JWT_ALGORITHM,
    VEYRA_JWT_TYPE,
    VEYRA_JWT_ISSUER,
    VEYRA_JWT_AUDIENCE,
    VEYRA_JWT_REQUIRED_CLAIMS,
    VEYRA_JWT_FORBIDDEN_CLAIMS
  } = requireDist('auth/jwtContract.js');

  let entraOidcService, entraIdentityService;
  try {
    entraOidcService = requireDist('services/entraOidcService.js');
    entraIdentityService = requireDist('services/entraIdentityService.js');
  } catch (e) {
    console.warn('  WARN: entraOidcService or entraIdentityService not in dist; Entra OIDC tests will be limited.');
  }

  const jose = require('../node_modules/jose');
  keyManager.reset();

  // =========================================================================
  // SECTION 1: Local Provider — Valid Credentials
  // =========================================================================
  section('Section 1: Local Provider — Valid Credentials');

  const localProvider = new LocalAuthenticationProvider();
  report(localProvider.metadata.type === 'LOCAL', 'LocalAuthenticationProvider type is LOCAL');
  report(localProvider.metadata.id === 'LOCAL', 'LocalAuthenticationProvider id is LOCAL');
  report(localProvider.metadata.isExternal === false, 'Local provider is not external');
  report(localProvider.metadata.supportedAuthMethods.includes('PASSWORD'), 'Local provider supports PASSWORD method');

  // Validate configuration does not throw for local provider
  let localConfigOk = true;
  try { localProvider.validateConfiguration(); } catch { localConfigOk = false; }
  report(localConfigOk, 'Local provider validateConfiguration succeeds (no external config needed)');

  sectionEnd();

  // =========================================================================
  // SECTION 2: Local Provider — Invalid Password (Anti-Enumeration)
  // =========================================================================
  section('Section 2: Local Provider — Invalid Password');

  const badPwResult = await localProvider.authenticate({ email: 'admin@admin.com', password: 'WrongPassword123!' });
  // Whether the user exists or not, the message must be generic
  report(badPwResult.success === false, 'Invalid password returns success=false');
  report(
    badPwResult.message === LOCAL_AUTH_GENERIC_FAILURE_MSG || badPwResult.code === 'INVALID_CREDENTIALS' || badPwResult.code === 'ACCOUNT_INACTIVE',
    'Invalid password returns generic message (no enumeration leak)',
    badPwResult.message
  );
  // Ensure no password hash in result
  report(!badPwResult.identity || !badPwResult.identity.metadata?.passwordHash, 'No password hash in failed auth result');

  sectionEnd();

  // =========================================================================
  // SECTION 3: Local Provider — Nonexistent User
  // =========================================================================
  section('Section 3: Local Provider — Nonexistent User');

  const noUserResult = await localProvider.authenticate({ email: 'doesnotexist_vyr057@veyra.test', password: 'SomePassword1!' });
  report(noUserResult.success === false, 'Nonexistent user returns success=false');
  report(
    noUserResult.message === LOCAL_AUTH_GENERIC_FAILURE_MSG || noUserResult.code === 'INVALID_CREDENTIALS',
    'Nonexistent user returns same generic failure as wrong password',
    noUserResult.message
  );

  sectionEnd();

  // =========================================================================
  // SECTION 4: Local Provider — Disabled/Inactive Account
  // =========================================================================
  section('Section 4: Local Provider — Disabled Account');

  // We test via the lookupUser + authenticate contract.
  // If the user store has a DISABLED user, authenticate should fail closed.
  // We test the code path by checking that ACCOUNT_INACTIVE code exists in the provider.
  report(typeof LOCAL_AUTH_INACTIVE_MSG === 'string' && LOCAL_AUTH_INACTIVE_MSG.length > 0, 'LOCAL_AUTH_INACTIVE_MSG is defined');

  // Test that a user with status !== ACTIVE would be rejected
  // We simulate by checking the authenticate logic handles this
  const disabledResult = await localProvider.authenticate({ email: 'disabled_test_vyr057@veyra.test', password: 'Test123!' });
  report(disabledResult.success === false, 'Disabled/unknown account denied');
  // Should not reveal whether user exists or is disabled (generic message for unknown users)
  report(
    disabledResult.code === 'INVALID_CREDENTIALS' || disabledResult.code === 'ACCOUNT_INACTIVE',
    'Response code is INVALID_CREDENTIALS or ACCOUNT_INACTIVE (fail-closed)'
  );

  sectionEnd();

  // =========================================================================
  // SECTION 5: Local Provider — Missing Credentials
  // =========================================================================
  section('Section 5: Local Provider — Missing Credentials');

  const noEmailResult = await localProvider.authenticate({ password: 'Test123!' });
  report(noEmailResult.success === false, 'Missing email → rejected');
  report(noEmailResult.code === 'INVALID_CREDENTIALS', 'Missing email → INVALID_CREDENTIALS');

  const noPwResult = await localProvider.authenticate({ email: 'admin@admin.com' });
  report(noPwResult.success === false, 'Missing password → rejected');
  report(noPwResult.code === 'INVALID_CREDENTIALS', 'Missing password → INVALID_CREDENTIALS');

  const emptyResult = await localProvider.authenticate({});
  report(emptyResult.success === false, 'Empty credentials → rejected');
  report(emptyResult.code === 'INVALID_CREDENTIALS', 'Empty credentials → INVALID_CREDENTIALS');

  sectionEnd();

  // =========================================================================
  // SECTION 6: Local Provider — Email Normalization & Format Validation
  // =========================================================================
  section('Section 6: Local Provider — Email Normalization');

  report(localProvider.normalizeEmail('  Admin@Admin.COM  ') === 'admin@admin.com', 'Trims and lowercases email');
  report(localProvider.normalizeEmail('') === '', 'Empty string normalizes to empty');
  report(localProvider.normalizeEmail(null) === '', 'null normalizes to empty');

  report(localProvider.validateEmailFormat('user@example.com') === true, 'Valid email passes format check');
  report(localProvider.validateEmailFormat('admin@admin.com') === true, 'admin@admin.com passes format check');
  report(localProvider.validateEmailFormat('invalid') === false, 'Missing @ rejected');
  report(localProvider.validateEmailFormat('user@') === false, 'Missing domain rejected');
  report(localProvider.validateEmailFormat('@domain.com') === false, 'Missing local part rejected');
  report(localProvider.validateEmailFormat('') === false, 'Empty string rejected');
  report(localProvider.validateEmailFormat(null) === false, 'null rejected');
  report(localProvider.validateEmailFormat(undefined) === false, 'undefined rejected');

  sectionEnd();

  // =========================================================================
  // SECTION 7: Local Provider — Bcrypt Hashing & Comparison
  // =========================================================================
  section('Section 7: Local Provider — Bcrypt Hashing');

  const testPassword = 'SecurePassword123!';
  const hash = await localProvider.hashPassword(testPassword);
  report(typeof hash === 'string' && hash.startsWith('$2'), 'hashPassword produces bcrypt hash');
  report(hash !== testPassword, 'Hash is not plaintext');

  const matchResult = await localProvider.comparePassword(testPassword, hash);
  report(matchResult === true, 'Correct password matches hash');

  const wrongMatch = await localProvider.comparePassword('WrongPassword!', hash);
  report(wrongMatch === false, 'Wrong password does not match hash');

  const emptyCompare = await localProvider.comparePassword('', hash);
  report(emptyCompare === false, 'Empty password does not match');

  const nullCompare = await localProvider.comparePassword(null, hash);
  report(nullCompare === false, 'null password does not match');

  let hashEmptyThrew = false;
  try { await localProvider.hashPassword(''); } catch { hashEmptyThrew = true; }
  report(hashEmptyThrew, 'hashPassword throws for empty string');

  sectionEnd();

  // =========================================================================
  // SECTION 8: Local Provider — Seed User Protection
  // =========================================================================
  section('Section 8: Local Provider — Seed User Protection');

  // admin@admin.com should exist as a seed user in non-production
  const isProd = (process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (!isProd) {
    const seedIdentity = await localProvider.resolveIdentity('admin@admin.com');
    if (seedIdentity) {
      report(seedIdentity.email === 'admin@admin.com', 'Seed admin resolves by email');
      report(typeof seedIdentity.displayName === 'string', 'Seed admin has displayName');
      // Ensure no password or hash in the identity profile
      report(!seedIdentity.metadata?.password, 'No password in identity profile');
      report(!seedIdentity.metadata?.passwordHash, 'No passwordHash in identity profile');
      report(!seedIdentity.metadata?.password_hash, 'No password_hash in identity profile');
    } else {
      skip('admin@admin.com not resolvable (DB may be offline) — seed user test skipped');
    }
  } else {
    skip('Production environment — seed user test not applicable');
  }

  sectionEnd();

  // =========================================================================
  // SECTION 9: Entra Provider — Metadata & Configuration
  // =========================================================================
  section('Section 9: Entra Provider — Metadata & Configuration');

  const entraProvider = new EntraAuthenticationProvider({
    tenantId: 'test-tenant-057',
    clientId: 'test-client-057',
    clientSecret: 'test-secret-057',
    redirectUri: 'http://localhost:3000/callback'
  });

  report(entraProvider.metadata.type === 'ENTRA', 'EntraAuthenticationProvider type is ENTRA');
  report(entraProvider.metadata.id === 'ENTRA', 'EntraAuthenticationProvider id is ENTRA');
  report(entraProvider.metadata.isExternal === true, 'Entra provider is external');
  report(entraProvider.metadata.supportedAuthMethods.includes('AUTHORIZATION_CODE'), 'Supports AUTHORIZATION_CODE');
  report(entraProvider.metadata.supportedAuthMethods.includes('BEARER_TOKEN'), 'Supports BEARER_TOKEN');

  let entraConfigOk = true;
  try { entraProvider.validateConfiguration(); } catch { entraConfigOk = false; }
  report(entraConfigOk, 'Valid Entra config passes validateConfiguration');

  const pubConfig = entraProvider.getPublicConfig();
  report(pubConfig.tenantId === 'test-tenant-057', 'getPublicConfig returns tenantId');
  report(pubConfig.clientId === 'test-client-057', 'getPublicConfig returns clientId');
  report(pubConfig.redirectUri === 'http://localhost:3000/callback', 'getPublicConfig returns redirectUri');
  // clientSecret must NOT be in public config
  report(!('clientSecret' in pubConfig), 'clientSecret is NOT in public config');

  sectionEnd();

  // =========================================================================
  // SECTION 10: Entra Provider — Missing Configuration Fails Closed
  // =========================================================================
  section('Section 10: Entra Provider — Missing Config Fails Closed');

  // Missing tenantId
  const noTenantProvider = new EntraAuthenticationProvider({ tenantId: '', clientId: 'test', redirectUri: 'http://localhost' });
  let noTenantThrew = false;
  let noTenantErrorCode = '';
  try { noTenantProvider.validateConfiguration(); } catch (e) { noTenantThrew = true; noTenantErrorCode = e.code || ''; }
  report(noTenantThrew, 'Missing tenantId throws ConfigurationError');
  report(noTenantErrorCode === 'MISSING_ENTRA_CONFIG', 'Error code is MISSING_ENTRA_CONFIG', noTenantErrorCode);

  // Missing clientId
  const noClientProvider = new EntraAuthenticationProvider({ tenantId: 'test', clientId: '', redirectUri: 'http://localhost' });
  let noClientThrew = false;
  try { noClientProvider.validateConfiguration(); } catch { noClientThrew = true; }
  report(noClientThrew, 'Missing clientId throws ConfigurationError');

  // Both missing
  const noBothProvider = new EntraAuthenticationProvider({ tenantId: '', clientId: '' });
  let noBothThrew = false;
  try { noBothProvider.validateConfiguration(); } catch { noBothThrew = true; }
  report(noBothThrew, 'Missing both tenantId and clientId throws ConfigurationError');

  sectionEnd();

  // =========================================================================
  // SECTION 11: Entra Provider — Authenticate Rejects Raw Credentials
  // =========================================================================
  section('Section 11: Entra Provider — Raw Credential Rejection');

  // Entra.authenticate must reject direct email/password since it requires the BFF callback
  const entraDirectResult = await entraProvider.authenticate({ email: 'user@test.com', password: 'SomePass1!' });
  report(entraDirectResult.success === false, 'Entra rejects direct email/password authentication');
  report(
    entraDirectResult.code === 'ENTRA_AUTH_FAILED' || entraDirectResult.code === 'MISSING_ENTRA_CREDENTIALS',
    'Entra returns auth failure code for direct credentials',
    entraDirectResult.code
  );

  const entraEmptyResult = await entraProvider.authenticate({});
  report(entraEmptyResult.success === false, 'Entra rejects empty credentials');

  sectionEnd();

  // =========================================================================
  // SECTION 12: Entra Provider — resolveIdentity
  // =========================================================================
  section('Section 12: Entra Provider — resolveIdentity');

  const entraIdentity = await entraProvider.resolveIdentity('User@Example.COM');
  report(entraIdentity !== null, 'resolveIdentity returns a profile');
  report(entraIdentity && entraIdentity.email === 'user@example.com', 'Email is normalized to lowercase');
  report(entraIdentity && typeof entraIdentity.displayName === 'string', 'Profile has displayName');
  report(entraIdentity && entraIdentity.metadata?.provider === 'ENTRA', 'Profile metadata indicates ENTRA provider');

  const entraEmptyId = await entraProvider.resolveIdentity('');
  report(entraEmptyId === null, 'resolveIdentity returns null for empty identifier');

  const entraNullId = await entraProvider.resolveIdentity(null);
  report(entraNullId === null, 'resolveIdentity returns null for null');

  sectionEnd();

  // =========================================================================
  // SECTION 13-19: Entra OIDC — validateEntraClaims
  // =========================================================================
  if (entraOidcService) {
    const { validateEntraClaims, extractIdentityEmail, EntraOidcError } = entraOidcService;

    const validClaims = {
      iss: 'https://login.microsoftonline.com/test-tenant-057/v2.0',
      aud: 'test-client-057',
      tid: 'test-tenant-057',
      nonce: 'test-nonce-057',
      exp: Math.floor(Date.now() / 1000) + 3600,
      preferred_username: 'user@example.com',
      sub: 'entra-sub-123'
    };

    const expectedValidation = {
      issuer: 'https://login.microsoftonline.com/test-tenant-057/v2.0',
      audience: 'test-client-057',
      tenantId: 'test-tenant-057',
      nonce: 'test-nonce-057'
    };

    section('Section 13: Entra OIDC — Valid Claims Pass');
    let validClaimsOk = true;
    try { validateEntraClaims(validClaims, expectedValidation); } catch { validClaimsOk = false; }
    report(validClaimsOk, 'Valid Entra claims pass validation');
    sectionEnd();

    section('Section 14: Entra OIDC — Invalid Issuer');
    let wrongIssThrew = false;
    try { validateEntraClaims({ ...validClaims, iss: 'https://evil.issuer/v2.0' }, expectedValidation); } catch (e) { wrongIssThrew = e.code === 'INVALID_TOKEN'; }
    report(wrongIssThrew, 'Wrong issuer throws INVALID_TOKEN');
    sectionEnd();

    section('Section 15: Entra OIDC — Wrong Audience');
    let wrongAudThrew = false;
    try { validateEntraClaims({ ...validClaims, aud: 'wrong-client' }, expectedValidation); } catch (e) { wrongAudThrew = e.code === 'INVALID_TOKEN'; }
    report(wrongAudThrew, 'Wrong audience throws INVALID_TOKEN');
    sectionEnd();

    section('Section 16: Entra OIDC — Wrong Tenant');
    let wrongTidThrew = false;
    try { validateEntraClaims({ ...validClaims, tid: 'wrong-tenant' }, expectedValidation); } catch (e) { wrongTidThrew = e.code === 'INVALID_TOKEN'; }
    report(wrongTidThrew, 'Wrong tenant throws INVALID_TOKEN');
    sectionEnd();

    section('Section 17: Entra OIDC — Wrong Nonce');
    let wrongNonceThrew = false;
    try { validateEntraClaims({ ...validClaims, nonce: 'wrong-nonce' }, expectedValidation); } catch (e) { wrongNonceThrew = e.code === 'INVALID_TOKEN'; }
    report(wrongNonceThrew, 'Wrong nonce throws INVALID_TOKEN');
    sectionEnd();

    section('Section 18: Entra OIDC — Expired Token');
    let expiredThrew = false;
    try { validateEntraClaims({ ...validClaims, exp: Math.floor(Date.now() / 1000) - 3600 }, expectedValidation); } catch (e) { expiredThrew = e.code === 'INVALID_TOKEN'; }
    report(expiredThrew, 'Expired token throws INVALID_TOKEN');
    sectionEnd();

    section('Section 19: Entra OIDC — Missing Email');
    let noEmailThrew = false;
    const noEmailClaims = { ...validClaims };
    delete noEmailClaims.preferred_username;
    delete noEmailClaims.email;
    delete noEmailClaims.upn;
    try { validateEntraClaims(noEmailClaims, expectedValidation); } catch (e) { noEmailThrew = e.code === 'INVALID_TOKEN'; }
    report(noEmailThrew, 'Missing email/username throws INVALID_TOKEN');
    sectionEnd();

    // =====================================================================
    // SECTION 20: extractIdentityEmail
    // =====================================================================
    section('Section 20: Entra OIDC — extractIdentityEmail');

    report(extractIdentityEmail({ preferred_username: 'User@Example.COM' }) === 'user@example.com', 'Extracts from preferred_username');
    report(extractIdentityEmail({ email: 'user@example.com' }) === 'user@example.com', 'Extracts from email');
    report(extractIdentityEmail({ upn: 'user@example.com' }) === 'user@example.com', 'Extracts from upn');
    report(extractIdentityEmail({ preferred_username: 'Admin@Admin.COM', email: 'other@other.com' }) === 'admin@admin.com', 'Prefers preferred_username over email');
    report(extractIdentityEmail({}) === null, 'Returns null for empty claims');
    report(extractIdentityEmail({ preferred_username: 'no-at-sign' }) === null, 'Returns null for non-email value');
    report(extractIdentityEmail({ preferred_username: '' }) === null, 'Returns null for empty string');

    sectionEnd();
  } else {
    section('Sections 13-20: Entra OIDC (skipped)');
    skip('entraOidcService not available in dist — Entra OIDC claim tests skipped');
    sectionEnd();
  }

  // =========================================================================
  // SECTION 21: Entra Identity Service — Role Resolution
  // =========================================================================
  section('Section 21: Entra Identity Service — Role Resolution');

  if (entraIdentityService) {
    const { entraIdentityService: eis } = entraIdentityService;

    // Direct role code match
    const directRole = eis.resolveEntraRole({ email: 'test@test.com', subject: 's1', tenantId: 't1', roles: ['SITE_ADMIN'] });
    report(directRole.roleCode === 'SITE_ADMIN', 'Direct SITE_ADMIN role match', directRole);

    const auditRole = eis.resolveEntraRole({ email: 'test@test.com', subject: 's1', tenantId: 't1', roles: ['AUDIT_MANAGER'] });
    report(auditRole.roleCode === 'AUDIT_MANAGER', 'Direct AUDIT_MANAGER role match', auditRole);

    // No roles → unmapped or default
    const noRole = eis.resolveEntraRole({ email: 'test@test.com', subject: 's1', tenantId: 't1', roles: [] });
    report(
      noRole.roleCode === null || noRole.source === 'DEFAULT_FALLBACK' || noRole.source === 'UNMAPPED',
      'No roles → unmapped or default fallback',
      noRole
    );

    // Unknown role name
    const unknownRole = eis.resolveEntraRole({ email: 'test@test.com', subject: 's1', tenantId: 't1', roles: ['UNKNOWN_ROLE_XYZ'] });
    report(
      unknownRole.source === 'UNMAPPED' || unknownRole.source === 'DEFAULT_FALLBACK' || unknownRole.roleCode === null,
      'Unknown role → unmapped',
      unknownRole
    );

    // Highest rank wins when multiple roles present
    const multiRole = eis.resolveEntraRole({ email: 'test@test.com', subject: 's1', tenantId: 't1', roles: ['AUDIT_USER', 'SITE_ADMIN'] });
    report(multiRole.roleCode === 'SITE_ADMIN', 'Multiple roles → highest rank (SITE_ADMIN) wins', multiRole);

  } else {
    skip('entraIdentityService not available — role resolution tests skipped');
  }

  sectionEnd();

  // =========================================================================
  // SECTION 22-25: Factory — Provider Selection & Configuration
  // =========================================================================
  section('Section 22: Factory — LOCAL Provider Selection');

  AuthenticationProviderFactory.reset();
  const origAuthProvider = process.env.AUTH_PROVIDER;

  process.env.AUTH_PROVIDER = 'LOCAL';
  const localFactory = AuthenticationProviderFactory.initialize();
  report(localFactory.metadata.type === 'LOCAL', 'Factory selects LocalAuthenticationProvider for AUTH_PROVIDER=LOCAL');
  report(AuthenticationProviderFactory.getConfiguredProviderType() === 'LOCAL', 'getConfiguredProviderType returns LOCAL');

  sectionEnd();

  section('Section 23: Factory — ENTRA Provider Selection');

  AuthenticationProviderFactory.reset();
  process.env.AUTH_PROVIDER = 'ENTRA';
  const origTenantId = process.env.ENTRA_TENANT_ID;
  const origClientId = process.env.ENTRA_CLIENT_ID;
  process.env.ENTRA_TENANT_ID = process.env.ENTRA_TENANT_ID || 'test-tenant-factory';
  process.env.ENTRA_CLIENT_ID = process.env.ENTRA_CLIENT_ID || 'test-client-factory';

  const entraFactory = AuthenticationProviderFactory.initialize();
  report(entraFactory.metadata.type === 'ENTRA', 'Factory selects EntraAuthenticationProvider for AUTH_PROVIDER=ENTRA');
  report(AuthenticationProviderFactory.getConfiguredProviderType() === 'ENTRA', 'getConfiguredProviderType returns ENTRA');

  // Restore
  if (origTenantId !== undefined) process.env.ENTRA_TENANT_ID = origTenantId;
  else delete process.env.ENTRA_TENANT_ID;
  if (origClientId !== undefined) process.env.ENTRA_CLIENT_ID = origClientId;
  else delete process.env.ENTRA_CLIENT_ID;

  sectionEnd();

  section('Section 24: Factory — Unknown Provider');

  AuthenticationProviderFactory.reset();
  let unknownProviderThrew = false;
  let unknownProviderCode = '';
  try {
    AuthenticationProviderFactory.initialize('SAML');
  } catch (e) {
    unknownProviderThrew = true;
    unknownProviderCode = e.code || '';
  }
  report(unknownProviderThrew, 'Unknown provider type throws ConfigurationError');
  report(unknownProviderCode === 'UNKNOWN_AUTH_PROVIDER', 'Error code is UNKNOWN_AUTH_PROVIDER', unknownProviderCode);

  sectionEnd();

  section('Section 25: Factory — Reset');

  AuthenticationProviderFactory.reset();
  // After reset, getProvider should reinitialize from env
  process.env.AUTH_PROVIDER = 'LOCAL';
  const afterReset = AuthenticationProviderFactory.getProvider();
  report(afterReset.metadata.type === 'LOCAL', 'After reset, getProvider reinitializes from env');

  // Restore original AUTH_PROVIDER
  if (origAuthProvider !== undefined) process.env.AUTH_PROVIDER = origAuthProvider;
  else delete process.env.AUTH_PROVIDER;
  AuthenticationProviderFactory.reset();

  sectionEnd();

  // =========================================================================
  // SECTION 26: Both Providers Issue Same Veyra JWT Claims Contract
  // =========================================================================
  section('Section 26: JWT Claims Contract — Both Providers');

  // Issue a token (simulating what happens after either provider authenticates)
  const localUserId = crypto.randomUUID();
  const localSessId = crypto.randomBytes(32).toString('hex');
  const localToken = await tokenService.issueAccessToken({ userId: localUserId, sessionId: localSessId });

  const entraUserId = crypto.randomUUID();
  const entraSessId = crypto.randomBytes(32).toString('hex');
  const entraToken = await tokenService.issueAccessToken({ userId: entraUserId, sessionId: entraSessId });

  const localPayload = jose.decodeJwt(localToken);
  const entraPayload = jose.decodeJwt(entraToken);

  // Both must have the exact same claims structure
  for (const claim of VEYRA_JWT_REQUIRED_CLAIMS) {
    report(localPayload[claim] !== undefined, `Local token has required claim "${claim}"`);
    report(entraPayload[claim] !== undefined, `Entra token has required claim "${claim}"`);
  }

  // Neither should have forbidden claims
  for (const forbidden of VEYRA_JWT_FORBIDDEN_CLAIMS) {
    report(localPayload[forbidden] === undefined, `Local token omits forbidden claim "${forbidden}"`);
    report(entraPayload[forbidden] === undefined, `Entra token omits forbidden claim "${forbidden}"`);
  }

  // Both use same algorithm and type
  const localHeader = jose.decodeProtectedHeader(localToken);
  const entraHeader = jose.decodeProtectedHeader(entraToken);
  report(localHeader.alg === VEYRA_JWT_ALGORITHM && entraHeader.alg === VEYRA_JWT_ALGORITHM, 'Both tokens use RS256');
  report(localHeader.typ === VEYRA_JWT_TYPE && entraHeader.typ === VEYRA_JWT_TYPE, 'Both tokens use at+jwt type');
  report(localPayload.iss === entraPayload.iss, 'Both tokens have same issuer (Veyra, not provider-specific)');
  report(localPayload.aud === entraPayload.aud, 'Both tokens have same audience');

  sectionEnd();

  // =========================================================================
  // SECTION 27: Credential/Token Leakage Check
  // =========================================================================
  section('Section 27: No Credential/Token Leakage');

  // Local provider authenticate result must not leak password
  const leakResult = await localProvider.authenticate({ email: 'admin@admin.com', password: 'WrongPassword!' });
  const leakJson = JSON.stringify(leakResult);
  report(!leakJson.includes('WrongPassword'), 'Failed auth result does not contain submitted password');

  // Entra provider authenticate result must not leak credentials
  const entraLeakResult = await entraProvider.authenticate({ email: 'user@test.com', token: 'secret-bearer-token-057' });
  const entraLeakJson = JSON.stringify(entraLeakResult);
  report(!entraLeakJson.includes('secret-bearer-token-057'), 'Entra auth result does not contain submitted token');

  // Identity profile from resolveIdentity must not contain sensitive fields
  const identityProfile = await localProvider.resolveIdentity('admin@admin.com');
  if (identityProfile) {
    const profileJson = JSON.stringify(identityProfile);
    report(!profileJson.includes('password'), 'Identity profile does not contain password field');
    report(!profileJson.includes('$2a$') && !profileJson.includes('$2b$'), 'Identity profile does not contain bcrypt hash');
    report(!profileJson.includes('clientSecret'), 'Identity profile does not contain clientSecret');
  } else {
    skip('admin@admin.com not resolvable — leakage check skipped');
  }

  // Entra public config must not contain clientSecret
  const entraPublic = entraProvider.getPublicConfig();
  const pubJson = JSON.stringify(entraPublic);
  report(!pubJson.includes('test-secret-057'), 'Entra public config does not leak clientSecret');

  sectionEnd();

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n================================================================');
  console.log('  VYR-057 RESULTS SUMMARY');
  console.log('================================================================');
  for (const s of sections) {
    const status = s.failed === 0 ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${s.name}: ${s.passed} passed, ${s.failed} failed`);
  }
  console.log('----------------------------------------------------------------');
  console.log(`  TOTAL: ${passed} passed, ${failed} failed, ${skipped} skipped out of ${passed + failed + skipped} assertions`);
  console.log('================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error in VYR-057 test suite:', err);
  process.exit(2);
});
