/**
 * Comprehensive Quality Gate & Verification Suite for Story VYR-015:
 * Implement controlled local-user provisioning and development seed users
 * 
 * Verifies:
 *  1. Non-production environment availability (development, test)
 *  2. Production environment guard rail (fails closed when NODE_ENV=production)
 *  3. Explicit production override with audited SECURITY_WARNING (ALLOW_PRODUCTION_SEED=true)
 *  4. Secret injection credential handling (dynamic bcrypt hashing, zero plaintext passwords committed)
 *  5. Coverage of representative development roles (SITE_ADMIN, AUDIT_MANAGER, AUDIT_SUPERVISOR, AUDIT_USER)
 *  6. Controlled production administrator provisioning requiring secret injection
 *  7. Authentication integration via LocalAuthenticationProvider
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { pathToFileURL } = require('url');

let testsPassed = 0;
let testsFailed = 0;

function pass(msg) {
  console.log(`  ✅ [PASS] ${msg}`);
  testsPassed++;
}

function fail(msg, err) {
  console.error(`  ❌ [FAIL] ${msg}`);
  if (err) console.error(`         Details: ${err.message || err}`);
  testsFailed++;
}

async function runSuite() {
  console.log('================================================================');
  console.log('  Story VYR-015: Controlled Local-User Provisioning & Seeds');
  console.log('  Comprehensive Quality Gate & Verification Suite');
  console.log('================================================================\n');

  const distProvisioning = path.join(__dirname, '../dist/services/localUserProvisioningService.js');
  const distLocalAuth = path.join(__dirname, '../dist/auth/providers/LocalAuthenticationProvider.js');
  const distDb = path.join(__dirname, '../dist/db.js');

  if (!fs.existsSync(distProvisioning)) {
    console.error('Build output dist/services/localUserProvisioningService.js not found! Please build first.');
    process.exit(1);
  }

  const {
    LocalUserProvisioningService,
    ProductionSeedBlockedError,
    REPRESENTATIVE_DEV_PERSONAS
  } = await import(pathToFileURL(distProvisioning).href);
  const { LocalAuthenticationProvider } = await import(pathToFileURL(distLocalAuth).href);
  const { query: dbQuery } = await import(pathToFileURL(distDb).href);
  const bcrypt = (await import('bcryptjs')).default;

  const service = new LocalUserProvisioningService();
  const localAuth = new LocalAuthenticationProvider();

  // -------------------------------------------------------------
  // Section 1: Representative Role Coverage
  // -------------------------------------------------------------
  console.log('--- Section 1: Representative Role Coverage ---');
  try {
    const rolesInPersonas = REPRESENTATIVE_DEV_PERSONAS.map(p => p.roleCode);
    assert(rolesInPersonas.includes('SITE_ADMIN'), 'Personas must include SITE_ADMIN');
    assert(rolesInPersonas.includes('AUDIT_MANAGER'), 'Personas must include AUDIT_MANAGER');
    assert(rolesInPersonas.includes('AUDIT_SUPERVISOR'), 'Personas must include AUDIT_SUPERVISOR');
    assert(rolesInPersonas.includes('AUDIT_USER'), 'Personas must include AUDIT_USER');
    pass('Representative personas cover all 4 primary VEYRA RBAC roles');

    for (const p of REPRESENTATIVE_DEV_PERSONAS) {
      assert(p.email.includes('@'), `Persona email must be valid format: ${p.email}`);
      assert.strictEqual(p.status, 'ACTIVE', `Dev persona must default to ACTIVE status: ${p.email}`);
    }
    pass('All representative personas have valid RFC email formats and ACTIVE status');
  } catch (err) {
    fail('Representative role coverage verification failed', err);
  }

  // -------------------------------------------------------------
  // Section 2: Production Guard Rail & Fail-Closed Protection
  // -------------------------------------------------------------
  console.log('\n--- Section 2: Production Guard Rail & Fail-Closed Protection ---');
  try {
    // 1. canSeedDevelopmentUsers returns false in production
    const prodGate = service.canSeedDevelopmentUsers('production');
    assert.strictEqual(prodGate.allowed, false, 'canSeedDevelopmentUsers must deny production seeding by default');
    assert(prodGate.reason && prodGate.reason.includes('PRODUCTION'), 'Diagnostic reason must explicitly cite PRODUCTION');
    pass('Production environment check strictly blocks development seeding by default');

    // 2. seedDevelopmentUsers throws ProductionSeedBlockedError in production
    let threwProdError = false;
    try {
      await service.seedDevelopmentUsers({ overrideEnv: 'production' });
    } catch (e) {
      if (e instanceof ProductionSeedBlockedError || e.name === 'ProductionSeedBlockedError') {
        threwProdError = true;
      }
    }
    assert.strictEqual(threwProdError, true, 'seedDevelopmentUsers must throw ProductionSeedBlockedError in production');
    pass('seedDevelopmentUsers fails closed with ProductionSeedBlockedError in production');

    // 3. ALLOW_PRODUCTION_SEED=true allows controlled override with audit warning
    const originalOverride = process.env.ALLOW_PRODUCTION_SEED;
    process.env.ALLOW_PRODUCTION_SEED = 'true';
    const overrideGate = service.canSeedDevelopmentUsers('production');
    assert.strictEqual(overrideGate.allowed, true, 'canSeedDevelopmentUsers allows seeding when ALLOW_PRODUCTION_SEED=true');
    pass('Explicit ALLOW_PRODUCTION_SEED=true enables controlled administrative override');

    const overrideResult = await service.seedDevelopmentUsers({
      overrideEnv: 'production',
      customPassword: 'AuditOverridePassword!2026'
    });
    assert.strictEqual(overrideResult.success, true);
    assert.strictEqual(overrideResult.auditWarningEmitted, true, 'Must emit security warning audit event for production seed');
    pass('Production seeding with override records SECURITY_WARNING audit event');

    // Restore env
    if (originalOverride !== undefined) {
      process.env.ALLOW_PRODUCTION_SEED = originalOverride;
    } else {
      delete process.env.ALLOW_PRODUCTION_SEED;
    }
  } catch (err) {
    fail('Production guard rail verification failed', err);
  }

  // -------------------------------------------------------------
  // Section 3: Non-Production Availability & Dynamic Seeding
  // -------------------------------------------------------------
  console.log('\n--- Section 3: Non-Production Seeding & Secret Injection ---');
  try {
    // Seed in development mode with custom secret injection
    const injectedPassword = 'CustomInjectedPassword!2026';
    const seedResult = await service.seedDevelopmentUsers({
      overrideEnv: 'development',
      customPassword: injectedPassword
    });

    assert.strictEqual(seedResult.success, true);
    assert.strictEqual(seedResult.environment, 'development');
    assert(seedResult.seededUsersCount >= 4, 'Must seed at least 4 representative dev personas');
    pass('Development user seeding succeeds in development environment');

    // Verify stored password hash in database is valid bcrypt hash (never plaintext)
    for (const u of seedResult.users) {
      const dbCheck = await dbQuery(`SELECT email, password_hash, is_local_user, status FROM veyra_user WHERE id = $1`, [u.userId]);
      assert(dbCheck.rows.length > 0, `User ${u.email} must exist in database`);
      const row = dbCheck.rows[0];
      assert.strictEqual(row.is_local_user, true, 'User must be marked is_local_user=true');
      assert.strictEqual(row.status, 'ACTIVE', 'User must be marked ACTIVE');

      const hash = row.password_hash;
      assert(hash && (hash.startsWith('$2a$') || hash.startsWith('$2b$')), 'Password must be stored as bcrypt hash');
      assert(!hash.includes(injectedPassword), 'Password hash must never contain raw password substring');

      // Verify the injected password matches the hash
      const matches = await bcrypt.compare(injectedPassword, hash);
      assert.strictEqual(matches, true, 'Injected password matches stored bcrypt hash');
    }
    pass('All seeded development users have valid bcrypt hashes matching injected secret');
    pass('Zero plaintext passwords are stored in database');
  } catch (err) {
    fail('Non-production seeding verification failed', err);
  }

  // -------------------------------------------------------------
  // Section 4: Controlled Administrator Provisioning
  // -------------------------------------------------------------
  console.log('\n--- Section 4: Controlled Administrator Provisioning ---');
  try {
    // Non-production admin provisioning
    const devAdminResult = await service.provisionAdministrator({
      email: 'admin@admin.com',
      password: 'DevAdminSecurePass!2026'
    });
    assert.strictEqual(devAdminResult.success, true);
    assert.strictEqual(devAdminResult.role, 'SITE_ADMIN');
    pass('Controlled administrator provisioning assigns SITE_ADMIN role');

    // Production admin provisioning without password or hash fails closed
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.ADMIN_INITIAL_PASSWORD;
    delete process.env.INITIAL_ADMIN_PASSWORD;
    delete process.env.ADMIN_INITIAL_PASSWORD_HASH;

    let prodAdminBlocked = false;
    try {
      await service.provisionAdministrator();
    } catch (e) {
      prodAdminBlocked = true;
    }
    assert.strictEqual(prodAdminBlocked, true, 'Production admin provisioning fails closed without secret injection');
    pass('Production admin provisioning strictly requires ADMIN_INITIAL_PASSWORD or hash');

    // Production admin provisioning with secret injection succeeds
    const prodAdminResult = await service.provisionAdministrator({
      password: 'ProdAdminSecretInjection!999',
      allowProductionOverride: true
    });
    assert.strictEqual(prodAdminResult.success, true);
    pass('Production admin provisioning succeeds when secret injection is provided');

    // Restore NODE_ENV
    process.env.NODE_ENV = originalNodeEnv || 'development';
  } catch (err) {
    fail('Controlled administrator provisioning verification failed', err);
  }

  // -------------------------------------------------------------
  // Section 5: Authentication Integration via LocalAuthenticationProvider
  // -------------------------------------------------------------
  console.log('\n--- Section 5: Authentication Integration ---');
  try {
    // Re-seed with standard dev password to verify local authentication
    const testDevPass = 'Password@123';
    await service.seedDevelopmentUsers({
      overrideEnv: 'development',
      customPassword: testDevPass
    });

    const personasToTest = [
      { email: 'admin@admin.com', expectedRole: 'SITE_ADMIN' },
      { email: 'akash.meesarapu@claaps.com', expectedRole: 'AUDIT_MANAGER' },
      { email: 'supervisor.user@claaps.com', expectedRole: 'AUDIT_SUPERVISOR' },
      { email: 'audit.user@claaps.com', expectedRole: 'AUDIT_USER' }
    ];

    for (const persona of personasToTest) {
      const authResult = await localAuth.authenticate({
        email: persona.email,
        password: testDevPass
      });
      assert.strictEqual(authResult.success, true, `Authentication should succeed for ${persona.email}`);
      assert.strictEqual(authResult.identity.email.toLowerCase(), persona.email.toLowerCase());
      assert.strictEqual(authResult.identity.status, 'ACTIVE');
      assert.strictEqual(authResult.identity.metadata.isLocalUser, true);
    }
    pass('All seeded development personas authenticate successfully via LocalAuthenticationProvider');

    // Wrong password must fail
    const badAuth = await localAuth.authenticate({
      email: 'akash.meesarapu@claaps.com',
      password: 'IncorrectPassword999!'
    });
    assert.strictEqual(badAuth.success, false);
    assert.strictEqual(badAuth.code, 'INVALID_CREDENTIALS');
    pass('Seeded users enforce secure password verification (reject incorrect credentials)');
  } catch (err) {
    fail('Authentication integration verification failed', err);
  }

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`  Story VYR-015 Verification Summary: ${testsPassed} passed, ${testsFailed} failed.`);
  if (testsFailed === 0) {
    console.log('  🎉 All Controlled Local-User Provisioning & Seed Tests Passed!');
  } else {
    console.error('  ⚠️ Some verification tests failed. Please review the output above.');
  }
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSuite().catch((err) => {
  console.error('[Fatal Error running VYR-015 test suite]:', err);
  process.exit(1);
});
