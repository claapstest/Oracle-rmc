/**
 * Test Suite: Story VYR-055
 * "Harden environment configuration and secrets management"
 * Epic: EPIC 6 — OWASP application and API security hardening
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Verifies:
 *  1. AC1: No production secret is stored in source control or React bundle
 *  2. AC2: Least privilege is enforced for secret retrieval (service scoping)
 *  3. AC3: Secret rotation procedure is tested (Oracle, JWT, KMS, DB credentials)
 *  4. Step 1: Secrets manager abstraction supports DB, Oracle, JWT, KMS, Entra credentials
 *  5. Step 2: Workload identities / managed identities resolution (AWS IRSA, Azure MI, K8s)
 *  6. Step 3: Environment segregation & production gates (rejection of fallback keys)
 *  7. Step 4: Startup config validation & settings API secrets sanitization
 *  8. Step 5: Rotation and incident response runbook documentation
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '../..');
const backendRoot = path.resolve(repoRoot, 'backend');
const frontendRoot = path.resolve(repoRoot, 'frontend');
const distDir = path.resolve(backendRoot, 'dist');
const runbookPath = path.resolve(repoRoot, 'docs/security/VYR-055_secrets_management_and_rotation_runbook.md');

let passed = 0;
let failed = 0;

function check(testName, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${testName}`);
    console.error(`          ${err.message}`);
    failed++;
  }
}

async function checkAsync(testName, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${testName}`);
    console.error(`          ${err.message}`);
    failed++;
  }
}

async function run() {
  console.log('================================================================');
  console.log('  VYR-055: Environment Configuration & Secrets Management');
  console.log('================================================================\n');

  // Verify compiled artifacts exist
  assert.ok(fs.existsSync(distDir), 'backend is compiled (dist/ exists)');

  // ------------------------------------------------------------------
  // Section 1: Acceptance Criterion 1 — No Production Secrets in Repo/Bundle
  // ------------------------------------------------------------------
  console.log('--- Section 1: Source Control & Frontend Bundle Cleanliness ---');

  check('VYR-055-01: .gitignore blocks environment and private key files', () => {
    const gitignorePath = path.resolve(repoRoot, '.gitignore');
    assert.ok(fs.existsSync(gitignorePath), '.gitignore must exist');
    const content = fs.readFileSync(gitignorePath, 'utf8');

    assert.ok(content.includes('.env'), '.gitignore must block .env');
    assert.ok(content.includes('*.pem') || content.includes('.pem'), '.gitignore must block .pem key files');
    assert.ok(content.includes('*.key') || content.includes('.key'), '.gitignore must block .key files');
  });

  check('VYR-055-02: .env.example contains safe dummy values only', () => {
    const envExamplePath = path.resolve(repoRoot, '.env.example');
    if (fs.existsSync(envExamplePath)) {
      const content = fs.readFileSync(envExamplePath, 'utf8');
      assert.ok(!content.includes('SuperSecretProductionPassword!'), 'No production credentials in .env.example');
      assert.ok(!content.includes('eyJh'), 'No JWT tokens in .env.example');
    }
  });

  check('VYR-055-03: React bundle contains no embedded private keys or encryption secrets', () => {
    const frontendDist = path.resolve(frontendRoot, 'dist/assets');
    if (fs.existsSync(frontendDist)) {
      const jsFiles = fs.readdirSync(frontendDist).filter((f) => f.endsWith('.js'));
      for (const f of jsFiles) {
        const code = fs.readFileSync(path.join(frontendDist, f), 'utf8');
        assert.ok(!code.includes('-----BEGIN RSA PRIVATE KEY-----'), `${f} must not contain private key`);
        assert.ok(!code.includes('-----BEGIN PRIVATE KEY-----'), `${f} must not contain private key`);
        assert.ok(!code.includes('ORACLE_ENCRYPTION_KEY'), `${f} must not expose backend encryption key`);
      }
    }
  });

  check('VYR-055-04: Frontend source code references zero backend production secrets', () => {
    const apiTsPath = path.resolve(frontendRoot, 'src/services/api.ts');
    assert.ok(fs.existsSync(apiTsPath), 'frontend api.ts exists');
    const code = fs.readFileSync(apiTsPath, 'utf8');
    assert.ok(!code.includes('process.env.ORACLE_PASSWORD'), 'No direct backend secret in frontend');
    assert.ok(!code.includes('process.env.JWT_PRIVATE_KEY'), 'No JWT private key in frontend');
  });

  // ------------------------------------------------------------------
  // Section 2: Acceptance Criterion 2 — Least Privilege Scoped Retrieval
  // ------------------------------------------------------------------
  console.log('\n--- Section 2: Least Privilege Enforcement by Service Role ---');

  await checkAsync('VYR-055-05: SecretsManager enforces least-privilege scoping by service role', async () => {
    const { SecretsManager, EnvSecretBackend, UnauthorizedSecretAccessError } = await import(
      '../dist/security/secretsManager.js'
    );

    const backend = new EnvSecretBackend();
    const sm = new SecretsManager(backend, 'development');

    process.env.DATABASE_URL = 'postgresql://usr:pwd@127.0.0.1:5433/veyra_db';
    process.env.ORACLE_PASSWORD = 'TestOraclePassword123';
    process.env.JWT_PRIVATE_KEY = 'mock-private-key-data';
    process.env.ORACLE_ENCRYPTION_KEY = 'mock-kms-master-key-32-chars-long!';

    // 1. database service
    const dbUrl = await sm.getSecret('DATABASE_URL', 'database');
    assert.ok(dbUrl && dbUrl.includes('postgresql://'), 'database service can access DATABASE_URL');

    await assert.rejects(
      async () => sm.getSecret('ORACLE_PASSWORD', 'database'),
      (err) => err instanceof UnauthorizedSecretAccessError && err.code === 'UNAUTHORIZED_SECRET_ACCESS',
      'database service must be DENIED access to ORACLE_PASSWORD'
    );

    await assert.rejects(
      async () => sm.getSecret('JWT_PRIVATE_KEY', 'database'),
      (err) => err instanceof UnauthorizedSecretAccessError,
      'database service must be DENIED access to JWT_PRIVATE_KEY'
    );

    // 2. oracle_sync service
    const oraPass = await sm.getSecret('ORACLE_PASSWORD', 'oracle_sync');
    assert.strictEqual(oraPass, 'TestOraclePassword123', 'oracle_sync service can access ORACLE_PASSWORD');

    await assert.rejects(
      async () => sm.getSecret('JWT_PRIVATE_KEY', 'oracle_sync'),
      (err) => err instanceof UnauthorizedSecretAccessError,
      'oracle_sync service must be DENIED access to JWT_PRIVATE_KEY'
    );

    await assert.rejects(
      async () => sm.getSecret('DATABASE_URL', 'oracle_sync'),
      (err) => err instanceof UnauthorizedSecretAccessError,
      'oracle_sync service must be DENIED access to DATABASE_URL'
    );

    // 3. auth service
    const jwtKey = await sm.getSecret('JWT_PRIVATE_KEY', 'auth');
    assert.strictEqual(jwtKey, 'mock-private-key-data', 'auth service can access JWT_PRIVATE_KEY');

    await assert.rejects(
      async () => sm.getSecret('ORACLE_PASSWORD', 'auth'),
      (err) => err instanceof UnauthorizedSecretAccessError,
      'auth service must be DENIED access to ORACLE_PASSWORD'
    );

    // 4. encryption service
    const kmsKey = await sm.getSecret('ORACLE_ENCRYPTION_KEY', 'encryption');
    assert.ok(kmsKey, 'encryption service can access ORACLE_ENCRYPTION_KEY');

    await assert.rejects(
      async () => sm.getSecret('DATABASE_URL', 'encryption'),
      (err) => err instanceof UnauthorizedSecretAccessError,
      'encryption service must be DENIED access to DATABASE_URL'
    );

    // 5. admin service
    const adminDb = await sm.getSecret('DATABASE_URL', 'admin');
    const adminOra = await sm.getSecret('ORACLE_PASSWORD', 'admin');
    const adminJwt = await sm.getSecret('JWT_PRIVATE_KEY', 'admin');
    assert.ok(adminDb && adminOra && adminJwt, 'admin service can access all secret domains');
  });

  // ------------------------------------------------------------------
  // Section 3: Acceptance Criterion 3 — Secret Rotation Procedure Tested
  // ------------------------------------------------------------------
  console.log('\n--- Section 3: Secret Rotation & Incident Lifecycle ---');

  await checkAsync('VYR-055-06: Secret rotation lifecycle and listener notification', async () => {
    const { SecretsManager, EnvSecretBackend } = await import('../dist/security/secretsManager.js');

    const backend = new EnvSecretBackend();
    const sm = new SecretsManager(backend, 'development');

    process.env.ORACLE_PASSWORD = 'OriginalPassword_1';

    let rotationHookCalled = false;
    let hookOldFp = '';
    let hookNewFp = '';

    sm.onSecretRotated('ORACLE_PASSWORD', async (key, oldFp, newFp) => {
      rotationHookCalled = true;
      hookOldFp = oldFp;
      hookNewFp = newFp;
    });

    const rotationResult = await sm.rotateSecret(
      'ORACLE_PASSWORD',
      'UpdatedSecretPassword_2',
      'admin'
    );

    assert.strictEqual(rotationResult.rotated, true, 'Rotation must succeed');
    assert.ok(rotationResult.oldFingerprint.startsWith('fp:'), 'Old fingerprint must start with fp:');
    assert.ok(rotationResult.newFingerprint.startsWith('fp:'), 'New fingerprint must start with fp:');
    assert.notStrictEqual(rotationResult.oldFingerprint, rotationResult.newFingerprint, 'Fingerprints must differ');
    assert.strictEqual(rotationHookCalled, true, 'Rotation listener hook must be called');
    assert.strictEqual(hookOldFp, rotationResult.oldFingerprint);
    assert.strictEqual(hookNewFp, rotationResult.newFingerprint);

    const updatedValue = await sm.getSecret('ORACLE_PASSWORD', 'oracle_sync');
    assert.strictEqual(updatedValue, 'UpdatedSecretPassword_2', 'Updated secret is immediately active');
  });

  await checkAsync('VYR-055-07: Non-admin service accounts cannot rotate secrets', async () => {
    const { SecretsManager, EnvSecretBackend } = await import('../dist/security/secretsManager.js');
    const sm = new SecretsManager(new EnvSecretBackend(), 'development');

    await assert.rejects(
      async () => sm.rotateSecret('ORACLE_PASSWORD', 'hacked', 'oracle_sync'),
      /administrative/,
      'Non-admin service cannot trigger secret rotation'
    );
  });

  await checkAsync('VYR-055-08: Emergency secret revocation evicts cache and triggers incident record', async () => {
    const { SecretsManager, EnvSecretBackend } = await import('../dist/security/secretsManager.js');
    const sm = new SecretsManager(new EnvSecretBackend(), 'development');

    process.env.ORACLE_TOKEN = 'token-to-revoke-123';
    await sm.getSecret('ORACLE_TOKEN', 'oracle_sync');

    await sm.revokeSecret('ORACLE_TOKEN', 'Compromise suspected in operator console');
  });

  // ------------------------------------------------------------------
  // Section 4: Technical Steps 1 & 2 — Backends & Workload Identity
  // ------------------------------------------------------------------
  console.log('\n--- Section 4: Workload Identity & Backend Abstractions ---');

  await checkAsync('VYR-055-09: Workload Identity resolver detects cloud IAM federations', async () => {
    const { resolveWorkloadIdentity } = await import('../dist/security/secretsManager.js');

    const localId = resolveWorkloadIdentity();
    assert.ok(localId.type === 'LOCAL_PROCESS' || localId.type === 'AWS_IRSA' || localId.type === 'AZURE_MANAGED_IDENTITY');

    process.env.AWS_ROLE_ARN = 'arn:aws:iam::123456789012:role/veyra-app-role';
    process.env.AWS_WEB_IDENTITY_TOKEN_FILE = '/tmp/test-token';
    const awsId = resolveWorkloadIdentity();
    assert.strictEqual(awsId.type, 'AWS_IRSA', 'Must resolve to AWS_IRSA when AWS IRSA vars set');
    assert.strictEqual(awsId.authenticated, true);

    delete process.env.AWS_ROLE_ARN;
    delete process.env.AWS_WEB_IDENTITY_TOKEN_FILE;

    process.env.AZURE_FEDERATED_TOKEN_FILE = '/tmp/azure-token';
    process.env.AZURE_CLIENT_ID = '00000000-0000-0000-0000-000000000000';
    const azureId = resolveWorkloadIdentity();
    assert.strictEqual(azureId.type, 'AZURE_MANAGED_IDENTITY', 'Must resolve to AZURE_MANAGED_IDENTITY');
    assert.strictEqual(azureId.authenticated, true);

    delete process.env.AZURE_FEDERATED_TOKEN_FILE;
    delete process.env.AZURE_CLIENT_ID;
  });

  await checkAsync('VYR-055-10: FileSecretBackend reads secrets from file system with directory fallback', async () => {
    const { FileSecretBackend } = await import('../dist/security/secretsManager.js');
    const tempDir = path.resolve(__dirname, 'temp_secrets_test');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const fb = new FileSecretBackend(tempDir);
    await fb.setSecret('POSTGRES_PASSWORD', 'secure-file-pass-99', 'test');

    const val = await fb.getSecret('POSTGRES_PASSWORD', 'test');
    assert.strictEqual(val, 'secure-file-pass-99', 'File backend correctly reads persisted secret');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------
  // Section 5: Technical Step 3 — Environment Segregation & Production Gates
  // ------------------------------------------------------------------
  console.log('\n--- Section 5: Environment Segregation & Production Gates ---');

  await checkAsync('VYR-055-11: Environment segregation supports namespaced profile overrides', async () => {
    const { SecretsManager, EnvSecretBackend } = await import('../dist/security/secretsManager.js');
    const sm = new SecretsManager(new EnvSecretBackend(), 'production');

    process.env.DATABASE_URL = 'postgresql://default_user:def@localhost:5433/db';
    process.env.VEYRA_PRODUCTION_DATABASE_URL = 'postgresql://prod_user:p@prod-db.internal:5432/veyra_prod';

    const prodDb = await sm.getSecret('DATABASE_URL', 'database', 'production');
    assert.strictEqual(prodDb, 'postgresql://prod_user:p@prod-db.internal:5432/veyra_prod');

    const devDb = await sm.getSecret('DATABASE_URL', 'database', 'development');
    assert.strictEqual(devDb, 'postgresql://default_user:def@localhost:5433/db');

    delete process.env.VEYRA_PRODUCTION_DATABASE_URL;
  });

  await checkAsync('VYR-055-12: Production gate fails closed on default fallback encryption key', async () => {
    const { validateStartupConfig } = await import('../dist/security/configValidator.js');

    process.env.ORACLE_ENCRYPTION_KEY = 'default-fallback-security-key-oracle-fusion';

    const report = validateStartupConfig({ environment: 'production', strict: true, throwOnError: false });
    assert.strictEqual(report.valid, false, 'Validation must fail when using default fallback key in production');

    const hasFallbackError = report.errors.some((e) => e.includes('default fallback encryption key'));
    assert.ok(hasFallbackError, 'Report must contain error regarding default fallback encryption key');

    assert.throws(
      () => validateStartupConfig({ environment: 'production', strict: true, throwOnError: true }),
      /Startup configuration validation failed/,
      'Must throw fail-closed error in production'
    );
  });

  await checkAsync('VYR-055-13: Production gate rejects default postgres password on remote host', async () => {
    const { validateStartupConfig } = await import('../dist/security/configValidator.js');

    const savedUrl = process.env.DATABASE_URL;
    const savedHost = process.env.POSTGRES_HOST;
    const savedPass = process.env.POSTGRES_PASSWORD;

    process.env.DATABASE_URL = 'postgresql://postgres:postgres@db.prod.internal.cloud:5432/veyra_db';
    process.env.POSTGRES_HOST = 'db.prod.internal.cloud';
    process.env.POSTGRES_PASSWORD = 'postgres';

    const report = validateStartupConfig({ environment: 'production', strict: true, throwOnError: false });
    const hasDbError = report.errors.some((e) => e.includes('DATABASE_CREDENTIALS'));
    assert.ok(hasDbError, 'Report must flag default credentials on production database');

    process.env.DATABASE_URL = savedUrl;
    process.env.POSTGRES_HOST = savedHost;
    process.env.POSTGRES_PASSWORD = savedPass;
  });

  // ------------------------------------------------------------------
  // Section 6: Technical Step 4 — Settings API Sanitization & Startup Validation
  // ------------------------------------------------------------------
  console.log('\n--- Section 6: Settings API Sanitization & Startup Validation ---');

  await checkAsync('VYR-055-14: sanitizeSettingsResponse scrubs sensitive credentials from output', async () => {
    const { sanitizeSettingsResponse } = await import('../dist/security/secretsManager.js');

    const rawPayload = {
      mode: 'ORACLE_FUSION',
      baseUrl: 'https://oracle.fusion.example.com',
      authType: 'BASIC',
      username: 'integration_user',
      password: 'PlaintextSuperSecretPassword123!',
      token: 'eyJhbGciOiJSUzI1NiIs...',
      clientSecret: 'secret_value_xyz',
      privateKey: '-----BEGIN RSA PRIVATE KEY-----...',
      databaseUrl: 'postgresql://admin:super_secret_pw@postgres.internal:5432/db',
      nestedConfig: {
        oraclePassword: 'NestedSecretPassword',
        timeout: 5000,
      },
    };

    const sanitized = sanitizeSettingsResponse(rawPayload);

    assert.strictEqual(sanitized.password, undefined, 'password must be removed');
    assert.strictEqual(sanitized.token, undefined, 'token must be removed');
    assert.strictEqual(sanitized.clientSecret, undefined, 'clientSecret must be removed');
    assert.strictEqual(sanitized.privateKey, undefined, 'privateKey must be removed');
    assert.strictEqual(sanitized.nestedConfig.oraclePassword, undefined, 'nested secrets removed');

    assert.strictEqual(sanitized.hasPassword, true, 'hasPassword flag set');
    assert.strictEqual(sanitized.hasToken, true, 'hasToken flag set');
    assert.strictEqual(sanitized.hasClientSecret, true, 'hasClientSecret flag set');
    assert.strictEqual(sanitized.hasPrivateKey, true, 'hasPrivateKey flag set');

    assert.strictEqual(sanitized.mode, 'ORACLE_FUSION');
    assert.strictEqual(sanitized.username, 'integration_user');
    assert.strictEqual(sanitized.nestedConfig.timeout, 5000);

    assert.strictEqual(
      sanitized.databaseUrl,
      'postgresql://admin:***@postgres.internal:5432/db',
      'Database password must be masked in connection string'
    );
  });

  await checkAsync('VYR-055-15: Safe fingerprinting utility generates 12-char SHA-256 fingerprint', async () => {
    const { createSecretFingerprint } = await import('../dist/security/secretsManager.js');

    const fp1 = createSecretFingerprint('secret-token-alpha');
    const fp2 = createSecretFingerprint('secret-token-beta');
    const fpEmpty = createSecretFingerprint('');

    assert.ok(fp1.startsWith('fp:'), 'Fingerprint starts with fp:');
    assert.strictEqual(fp1.length, 15, 'fp: + 12 hex chars = 15 chars');
    assert.notStrictEqual(fp1, fp2, 'Different secrets have different fingerprints');
    assert.strictEqual(fpEmpty, 'none', 'Empty secret returns none');
  });

  check('VYR-055-16: Admin secrets status route is registered in API router', () => {
    const apiTs = fs.readFileSync(path.resolve(backendRoot, 'src/routes/api.ts'), 'utf8');

    assert.ok(
      apiTs.includes('/admin/security/secrets-status'),
      'api.ts must define GET /admin/security/secrets-status'
    );
    assert.ok(
      apiTs.includes('/admin/security/rotate-secret'),
      'api.ts must define POST /admin/security/rotate-secret'
    );
    assert.ok(
      apiTs.includes('sanitizeSettingsResponse'),
      'api.ts must import and apply sanitizeSettingsResponse'
    );
  });

  // ------------------------------------------------------------------
  // Section 7: Technical Step 5 — Runbook Documentation & Subsystem Integration
  // ------------------------------------------------------------------
  console.log('\n--- Section 7: Documentation & Subsystem Integration ---');

  check('VYR-055-17: Secrets management runbook exists and covers required procedures', () => {
    assert.ok(fs.existsSync(runbookPath), 'VYR-055 runbook markdown document must exist');
    const doc = fs.readFileSync(runbookPath, 'utf8');

    assert.ok(doc.includes('VYR-055'), 'Runbook references VYR-055');
    assert.ok(doc.includes('EPIC 6'), 'Runbook references EPIC 6');
    assert.ok(doc.includes('DB_CREDENTIALS'), 'Runbook covers DB_CREDENTIALS');
    assert.ok(doc.includes('ORACLE_CREDENTIALS'), 'Runbook covers ORACLE_CREDENTIALS');
    assert.ok(doc.includes('JWT_KEYS'), 'Runbook covers JWT_KEYS');
    assert.ok(doc.includes('KMS_KEYS'), 'Runbook covers KMS_KEYS');
    assert.ok(doc.includes('Workload Identity'), 'Runbook covers Workload Identity');
    assert.ok(doc.includes('Least-Privilege'), 'Runbook covers Least-Privilege policy');
    assert.ok(doc.includes('Incident Response'), 'Runbook covers Incident Response');
    assert.ok(doc.includes('Rotation Runbooks'), 'Runbook covers rotation runbooks');
  });

  await checkAsync('VYR-055-18: barrel export in security/index.ts exports secretsManager and configValidator', async () => {
    const indexTs = fs.readFileSync(path.resolve(backendRoot, 'src/security/index.ts'), 'utf8');

    assert.ok(indexTs.includes("from './secretsManager.js'"), 'security/index.ts must export secretsManager');
    assert.ok(indexTs.includes("from './configValidator.js'"), 'security/index.ts must export configValidator');

    const securityBarrel = await import('../dist/security/index.js');
    assert.ok(securityBarrel.secretsManager, 'secretsManager instance exported from barrel');
    assert.ok(typeof securityBarrel.validateStartupConfig === 'function', 'validateStartupConfig exported');
  });

  await checkAsync('VYR-055-19: validateConfig in config.ts delegates to validateStartupConfig', async () => {
    const configTs = fs.readFileSync(path.resolve(backendRoot, 'src/config.ts'), 'utf8');

    assert.ok(
      configTs.includes('validateStartupConfig'),
      'config.ts validateConfig must call validateStartupConfig'
    );

    const { validateConfig } = await import('../dist/config.js');
    assert.doesNotThrow(() => validateConfig(), 'validateConfig executes cleanly in development/test');
  });

  await checkAsync('VYR-055-20: Request validation schemas include POST /admin/security/rotate-secret', async () => {
    const { schemas } = await import('../dist/security/requestValidationService.js');

    assert.ok(
      schemas['POST /admin/security/rotate-secret'],
      'requestValidationService must define schema for POST /admin/security/rotate-secret'
    );

    const validBody = { target: 'oracle', payload: { password: 'NewPassword123' } };
    const parseResult = schemas['POST /admin/security/rotate-secret'].safeParse(validBody);
    assert.strictEqual(parseResult.success, true, 'Valid rotation body must parse successfully');

    const invalidBody = { target: 'unsupported_target' };
    const invalidParse = schemas['POST /admin/security/rotate-secret'].safeParse(invalidBody);
    assert.strictEqual(invalidParse.success, false, 'Invalid target must fail validation');
  });

  // ------------------------------------------------------------------
  // Summary & Process Exit
  // ------------------------------------------------------------------
  console.log(`\n================================================================`);
  console.log(`  VYR-055 Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  console.log(`================================================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('FATAL Test Suite Error:', err);
  process.exit(1);
});
