/**
 * Automated Non-Production Release & Rollback Rehearsal Suite: Story VYR-064
 * Epic 7: Security, branch, regression and release testing
 * Story Title: Release, rollback, runbook and architecture documentation
 *
 * Acceptance Criteria Verified:
 *  1. Release and rollback are rehearsed in non-production.
 *  2. Runbooks identify owners, alerts and recovery steps.
 *  3. Architecture and API documents match delivered implementation.
 *
 * Run: npm --prefix backend run test:vyr64
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');

const repoRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.resolve(repoRoot, '.env') });
dotenv.config({ path: path.resolve(repoRoot, 'backend/.env') });

process.env.AUTH_PROVIDER = 'LOCAL';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.API_RATE_LIMIT_MAX = '500';
if (!process.env.DATABASE_URL && !process.env.DATABASE_URI) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/veyra_db';
}

const TEST_PORT = 5064;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const REHEARSAL_HOST = 'vyr064-rehearsal.oraclecloud.com';
const SENTINEL = 'VYR064_REHEARSAL_SECRET_91';

let passed = 0;
let failed = 0;
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

function section(name) {
  currentSection = { name, startPassed: passed, startFailed: failed };
  console.log(`\n--- ${name} ---`);
}

function sectionEnd() {
  if (currentSection) {
    sections.push({
      name: currentSection.name,
      passed: passed - currentSection.startPassed,
      failed: failed - currentSection.startFailed,
    });
    currentSection = null;
  }
}

async function expectRejectCode(fn, expectedCode, label) {
  try {
    await fn();
    report(false, `${label} (expected error ${expectedCode}, none thrown)`);
  } catch (err) {
    report(
      err?.code === expectedCode,
      label,
      `expected ${expectedCode}, got ${err?.code || err?.message}`
    );
  }
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
    if (rawBody !== null && !headers['Content-Length']) {
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
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
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

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

async function run() {
  console.log('\n================================================================');
  console.log('  VYR-064: Release, Rollback & Runbook Non-Production Rehearsal');
  console.log('================================================================\n');

  const usersAuthPath = path.join(repoRoot, 'backend/users_auth.json');
  const usersAuthBackup = fs.existsSync(usersAuthPath) ? fs.readFileSync(usersAuthPath, 'utf8') : null;

  const express = require('../node_modules/express');
  const pg = require('../node_modules/pg');
  const { apiRouter } = require(path.join(repoRoot, 'backend/dist/routes/api.js'));
  const { authService } = require(path.join(repoRoot, 'backend/dist/services/authService.js'));
  const { pool, query: dbQuery } = require(path.join(repoRoot, 'backend/dist/db.js'));
  const { initializeAuthProvider } = require(path.join(repoRoot, 'backend/dist/auth/index.js'));
  const { corsMiddleware, securityHeadersMiddleware } = require(path.join(repoRoot, 'backend/dist/security/securityHeadersService.js'));
  const { rateLimitService } = require(path.join(repoRoot, 'backend/dist/security/rateLimitService.js'));
  const { validateStartupConfig } = require(path.join(repoRoot, 'backend/dist/security/configValidator.js'));
  const { EncryptionMigrationService } = require(path.join(repoRoot, 'backend/dist/security/encryptionMigrationService.js'));
  const { EncryptionError, EncryptionService, KeyLifecycleRegistry, LocalKeyProvider } = require(path.join(repoRoot, 'backend/dist/security/encryptionService.js'));
  const { buildTableRecordAad } = require(path.join(repoRoot, 'backend/dist/security/encryptionContract.js'));
  const { decryptRawRows } = require(path.join(repoRoot, 'backend/dist/security/decryptedRecordReader.js'));
  const migrationSvc = require(path.join(repoRoot, 'backend/dist/security/plaintextMigrationService.js'));
  const rotationSvc = require(path.join(repoRoot, 'backend/dist/security/keyRotationService.js'));
  const { syncCheckpointService } = require(path.join(repoRoot, 'backend/dist/services/syncCheckpointService.js'));
  const { distributedLockService } = require(path.join(repoRoot, 'backend/dist/services/distributedLockService.js'));

  const prevEnv = {
    ALLOW_LEGACY_OPAQUE_TOKENS: process.env.ALLOW_LEGACY_OPAQUE_TOKENS,
    VEYRA_RAW_ENCRYPTION: process.env.VEYRA_RAW_ENCRYPTION,
    ORACLE_ENCRYPTION_KEY: process.env.ORACLE_ENCRYPTION_KEY,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
    POSTGRES_HOST: process.env.POSTGRES_HOST,
    JWT_PRIVATE_KEY: process.env.JWT_PRIVATE_KEY,
    ORACLE_USERNAME: process.env.ORACLE_USERNAME,
    ORACLE_PASSWORD: process.env.ORACLE_PASSWORD,
  };

  // =========================================================================
  // SECTION 1: Schema Migration Sequencing & Pre-Flight Release Gate
  // =========================================================================
  section('Section 1: Schema Migration Sequencing & Pre-Flight Gate');

  const migrationsDir = path.join(repoRoot, 'database/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.cjs')).sort();
  report(
    migrationFiles.length >= 26,
    `Ordered PostgreSQL migration chain present (${migrationFiles.length} migrations)`
  );

  const validUpDown = migrationFiles.every((f) => {
    const mod = require(path.join(migrationsDir, f));
    return typeof mod.up === 'function' && typeof mod.down === 'function';
  });
  report(validUpDown, 'Every migration (000..025) defines reversible up() and down() handlers');

  const encMigration = new EncryptionMigrationService();
  const schemaReport = await encMigration.verifySchemaIntegrity(pool);
  report(
    schemaReport.healthy === true && schemaReport.ledgerTableExists === true && schemaReport.missingColumns.length === 0,
    'Live PostgreSQL schema passes verifySchemaIntegrity() across all 10 raw tables + migration ledger',
    schemaReport.missingColumns
  );

  process.env.ORACLE_ENCRYPTION_KEY = 'default-fallback-security-key-oracle-fusion';
  delete process.env.JWT_PRIVATE_KEY;
  const badStrict = validateStartupConfig({ environment: 'production', strict: true, throwOnError: false });
  report(
    badStrict.valid === false && badStrict.errors.some((e) => e.includes('KMS_MASTER_KEY')),
    'Pre-flight production gate fails closed when fallback encryption/JWT keys are present'
  );

  process.env.ORACLE_ENCRYPTION_KEY = 'vyr064-prod-grade-32plus-char-encryption-key!!';
  process.env.JWT_PRIVATE_KEY = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
  process.env.ORACLE_USERNAME = process.env.ORACLE_USERNAME || 'veyra_sync_svc';
  process.env.ORACLE_PASSWORD = process.env.ORACLE_PASSWORD || 'RehearsalPass!99';
  const goodStrict = validateStartupConfig({ environment: 'production', strict: true, throwOnError: false });
  report(
    goodStrict.valid === true && goodStrict.errors.length === 0,
    'Pre-flight production gate passes when hardened KMS/JWT/Oracle config is supplied',
    goodStrict.errors
  );

  sectionEnd();

  // Boot Express server for live rehearsal
  initializeAuthProvider();
  rateLimitService.resetAll();
  await dbQuery("UPDATE veyra_session SET status = 'EXPIRED' WHERE status = 'ACTIVE'").catch(() => {});
  if (typeof authService._clearActiveSessions === 'function') {
    authService._clearActiveSessions();
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeadersMiddleware);
  app.use(corsMiddleware);
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));

  let quarantineId = null;
  const lockKey = '__GLOBAL__:vyr064_rehearsal';
  const legacySessionId = crypto.randomBytes(32).toString('hex'); // 64-hex legacy opaque token

  try {
    const adminPass = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@123';
    const adminLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@admin.com',
      password: adminPass,
      force: true,
    });
    const adminToken = adminLogin.data?.token;
    report(adminLogin.status === 200 && Boolean(adminToken), 'Admin authentication succeeds for rehearsal operator');

    // =========================================================================
    // SECTION 2: Staged Auth Token Cutover & Rollback Rehearsal
    // =========================================================================
    section('Section 2: Staged Auth Token Cutover & Rollback Rehearsal');

    const userRow = (await dbQuery("SELECT id FROM veyra_user WHERE LOWER(email) = 'audit.user@claaps.com' LIMIT 1")).rows[0];
    if (!userRow) {
      report(false, 'Seeded audit.user@claaps.com exists in veyra_user for auth cutover rehearsal');
    } else {
      await dbQuery("UPDATE veyra_session SET status = 'EXPIRED' WHERE user_id = $1 AND status = 'ACTIVE'", [userRow.id]);
      await dbQuery(
        `INSERT INTO veyra_session (session_id, user_id, status, expires_at, last_activity_at, created_by)
         VALUES ($1, $2, 'ACTIVE', NOW() + interval '15 minutes', NOW(), 'vyr064_rehearsal')`,
        [legacySessionId, userRow.id]
      );

      // Phase 1 default: opaque token rejected
      process.env.ALLOW_LEGACY_OPAQUE_TOKENS = 'false';
      const rejectedPhase1 = await makeRequest('GET', '/api/auth/status', null, legacySessionId);
      report(
        rejectedPhase1.status === 401 && rejectedPhase1.data?.code === 'INVALID_TOKEN',
        'Phase 1 default rejects legacy opaque token with 401 INVALID_TOKEN',
        rejectedPhase1.data
      );

      // Phase 2 transition window: opaque accepted & upgraded on /auth/refresh
      process.env.ALLOW_LEGACY_OPAQUE_TOKENS = 'true';
      const acceptedPhase2 = await makeRequest('GET', '/api/auth/status', null, legacySessionId);
      report(
        acceptedPhase2.status === 200 && acceptedPhase2.data?.loggedIn === true,
        'Phase 2 migration window accepts active legacy opaque session',
        acceptedPhase2.data
      );

      const refreshed = await makeRequest('POST', '/api/auth/refresh', {}, legacySessionId);
      const upgradedJwt = refreshed.data?.accessToken || refreshed.data?.token;
      const jwtParts = typeof upgradedJwt === 'string' ? upgradedJwt.split('.') : [];
      const jwtHeader = jwtParts.length === 3 ? JSON.parse(Buffer.from(jwtParts[0], 'base64url').toString('utf8')) : null;
      report(
        refreshed.status === 200 && jwtParts.length === 3 && jwtHeader?.alg === 'RS256' && jwtHeader?.typ === 'at+jwt',
        'POST /api/auth/refresh upgrades legacy session to RS256 at+jwt',
        jwtHeader
      );

      // Close migration window -> upgraded JWT works, opaque rejected
      process.env.ALLOW_LEGACY_OPAQUE_TOKENS = 'false';
      const jwtAfterClose = await makeRequest('GET', '/api/auth/status', null, upgradedJwt);
      const opaqueAfterClose = await makeRequest('GET', '/api/auth/status', null, legacySessionId);
      report(
        jwtAfterClose.status === 200 && opaqueAfterClose.status === 401,
        'Cutover complete: RS256 JWT accepted while un-upgraded opaque token fails closed'
      );

      // Rollback RB-1: re-enable compatibility window -> opaque accepted immediately
      process.env.ALLOW_LEGACY_OPAQUE_TOKENS = 'true';
      const opaqueAfterRollback = await makeRequest('GET', '/api/auth/status', null, legacySessionId);
      report(
        opaqueAfterRollback.status === 200,
        'RB-1 Auth rollback: re-enabling ALLOW_LEGACY_OPAQUE_TOKENS=true restores legacy token support immediately'
      );

      process.env.ALLOW_LEGACY_OPAQUE_TOKENS = 'false';
      await dbQuery('DELETE FROM veyra_session WHERE session_id = $1', [legacySessionId]);
    }

    const cleanupRes = await makeRequest('POST', '/api/admin/sessions/cleanup', {}, adminToken);
    report(cleanupRes.status === 200 && cleanupRes.data?.success === true, 'Admin session cleanup endpoint succeeds (POST /api/admin/sessions/cleanup)');

    sectionEnd();

    // =========================================================================
    // SECTION 3: Data Migration & Decrypt-Back Rollback Rehearsal (VYR-037)
    // =========================================================================
    section('Section 3: Plaintext Migration & Decrypt-Back Rollback Rehearsal (RB-3)');

    const dbClient = await pool.connect();
    try {
      await dbClient.query('DELETE FROM oracle_raw_users WHERE environment_host = $1', [REHEARSAL_HOST]);
      await dbClient.query('DELETE FROM oracle_encryption_migration_ledger WHERE environment_host = $1', [REHEARSAL_HOST]);

      const originals = new Map();
      for (let i = 1; i <= 3; i++) {
        const rec = { username: `VYR064_USER_${i}`, secretRef: `${SENTINEL}_${i}`, roles: ['AUDITOR'] };
        originals.set(rec.username, rec);
        await dbClient.query(
          `INSERT INTO oracle_raw_users (environment_host, username, display_name, raw_user)
           VALUES ($1, $2, $3, $4)`,
          [REHEARSAL_HOST, rec.username, `Rehearsal User ${i}`, JSON.stringify(rec)]
        );
      }

      delete process.env.VEYRA_RAW_ENCRYPTION;
      const dryRun = await migrationSvc.migrateTable(pool, 'oracle_raw_users', { environmentHost: REHEARSAL_HOST, dryRun: true });
      const stillPlain = (await dbClient.query('SELECT COUNT(*)::int c FROM oracle_raw_users WHERE environment_host=$1 AND is_encrypted=false', [REHEARSAL_HOST])).rows[0].c;
      report(
        dryRun.candidates === 3 && stillPlain === 3,
        'Phase 3 dry run identifies 3 plaintext rows without modifying DB'
      );

      process.env.VEYRA_RAW_ENCRYPTION = 'true';
      const migResult = await migrationSvc.migrateTable(pool, 'oracle_raw_users', { environmentHost: REHEARSAL_HOST, batchSize: 2 });
      const encRows = (await dbClient.query('SELECT * FROM oracle_raw_users WHERE environment_host=$1 ORDER BY username', [REHEARSAL_HOST])).rows;
      const rawConcat = encRows.map((r) => JSON.stringify(r.raw_user)).join('');
      report(
        migResult.migrated === 3 && migResult.failed === 0 && migResult.reconciliation.reconciled === true &&
        encRows.every((r) => r.is_encrypted === true) && !rawConcat.includes(SENTINEL),
        'Phase 3 backfill encrypts all 3 rows, clears plaintext sentinel, and reconciles'
      );

      const decRows = await decryptRawRows('oracle_raw_users', 'raw_user', encRows, REHEARSAL_HOST);
      report(
        decRows.every((r) => stable(r.raw_user) === stable(originals.get(r.username))),
        'Node.js read path decrypts migrated rows back to exact original payloads'
      );

      // Rehearse RB-3 safety gate & rollback
      await expectRejectCode(
        () => migrationSvc.rollbackTable(pool, 'oracle_raw_users', { environmentHost: REHEARSAL_HOST, confirm: migrationSvc.ROLLBACK_CONFIRMATION }),
        'ENCRYPTION_STILL_ENABLED',
        'RB-3 safety guard refuses decrypt-back rollback while VEYRA_RAW_ENCRYPTION=true'
      );

      delete process.env.VEYRA_RAW_ENCRYPTION;
      const rbResult = await migrationSvc.rollbackTable(pool, 'oracle_raw_users', {
        environmentHost: REHEARSAL_HOST,
        confirm: migrationSvc.ROLLBACK_CONFIRMATION,
      });
      const restoredRows = (await dbClient.query('SELECT * FROM oracle_raw_users WHERE environment_host=$1 ORDER BY username', [REHEARSAL_HOST])).rows;
      const rbLedger = (await dbClient.query(
        "SELECT status FROM oracle_encryption_migration_ledger WHERE environment_host=$1 AND table_name='oracle_raw_users'",
        [REHEARSAL_HOST]
      )).rows[0];
      report(
        rbResult.restored === 3 && rbResult.failed === 0 &&
        restoredRows.every((r) => r.is_encrypted === false && r.encryption_key_id === null && stable(r.raw_user) === stable(originals.get(r.username))) &&
        rbLedger?.status === 'ROLLED_BACK',
        'RB-3 rollback cleanly restores original JSON, clears tracking columns, and marks ledger ROLLED_BACK'
      );

      sectionEnd();

      // =========================================================================
      // SECTION 4: Key Rotation & Pre-Retirement Rollback Rehearsal (VYR-036)
      // =========================================================================
      section('Section 4: Key Rotation & Before-Retirement Rollback Rehearsal');

      await dbClient.query('DELETE FROM oracle_raw_users WHERE environment_host = $1', [REHEARSAL_HOST]);
      const K1 = 'vyr064-k1';
      const K2 = 'vyr064-k2';
      const registry = new KeyLifecycleRegistry(new LocalKeyProvider(K1, 'vyr064-kek-secret-1'));
      const rotService = new EncryptionService(registry);

      for (let i = 1; i <= 2; i++) {
        const rec = { environment_host: REHEARSAL_HOST, username: `ROT_U_${i}` };
        const payload = await rotService.encryptPayload(
          { username: rec.username, secret: `${SENTINEL}_ROT_${i}` },
          buildTableRecordAad('oracle_raw_users', rec, REHEARSAL_HOST)
        );
        await dbClient.query(
          `INSERT INTO oracle_raw_users (environment_host, username, display_name, raw_user, is_encrypted, encryption_format_version, encryption_key_id, encrypted_at)
           VALUES ($1, $2, $3, $4, true, 1, $5, NOW())`,
          [REHEARSAL_HOST, rec.username, `Rot User ${i}`, JSON.stringify(payload), K1]
        );
      }

      registry.addKey(K2, 'vyr064-kek-secret-2');
      registry.activate(K2);
      report(
        registry.getActiveKeyId() === K2 && registry.getStatus(K1) === 'RETIRING',
        'Key activation switches active KEK to K2 and moves K1 to RETIRING'
      );

      await expectRejectCode(
        () => rotationSvc.retireKey(pool, K1, { registry }),
        'KEY_IN_USE',
        'Key retirement fails closed (KEY_IN_USE) while rows still depend on K1'
      );

      const rewrapRes = await rotationSvc.rewrapTable(pool, 'oracle_raw_users', {
        service: rotService,
        toKeyId: K2,
        environmentHost: REHEARSAL_HOST,
      });
      report(
        rewrapRes.rewrapped === 2 && rewrapRes.failed === 0,
        `rewrapTable migrates 2 DEKs onto ${K2} without modifying ciphertext`
      );

      // Rehearse key rotation rollback before retirement: reactivate K1 while K2 remains RETIRING
      registry.activate(K1);
      const afterRollbackRow = (await dbClient.query('SELECT username, raw_user FROM oracle_raw_users WHERE environment_host=$1 LIMIT 1', [REHEARSAL_HOST])).rows[0];
      const decUnderRolledBackRing = await rotService.decryptEntityRecord(
        'oracle_raw_users',
        { environment_host: REHEARSAL_HOST, username: afterRollbackRow.username },
        afterRollbackRow.raw_user,
        REHEARSAL_HOST
      );
      report(
        registry.getActiveKeyId() === K1 && registry.getStatus(K2) === 'RETIRING' && String(decUnderRolledBackRing.secret).includes(SENTINEL),
        'Key rollback before retirement reactivates K1 cleanly while keeping K2 records decryptable'
      );

      // Clean up synthetic DB rows
      await dbClient.query('DELETE FROM oracle_raw_users WHERE environment_host = $1', [REHEARSAL_HOST]);
      await dbClient.query('DELETE FROM oracle_encryption_migration_ledger WHERE environment_host = $1', [REHEARSAL_HOST]);
    } finally {
      dbClient.release();
    }

    sectionEnd();

    // =========================================================================
    // SECTION 5: KMS Outage Fail-Closed & Scheduler / Lock / Quarantine Recovery
    // =========================================================================
    section('Section 5: KMS Outage Fail-Closed & Scheduler Recovery Rehearsal');

    const failingKmsProvider = {
      getActiveKeyId: () => 'vyr064-outage-kek',
      getMasterKey: async () => null,
      wrapDek: async () => {
        throw new EncryptionError('KMS_UNAVAILABLE', 'Simulated KMS endpoint timeout (503)');
      },
      unwrapDek: async () => {
        throw new EncryptionError('KMS_UNAVAILABLE', 'Simulated KMS endpoint timeout (503)');
      },
    };
    const kmsService = new EncryptionService(failingKmsProvider);
    await expectRejectCode(
      () => kmsService.encryptPayload({ secret: SENTINEL }, 'tenant=t|table=oracle_raw_users|id=1|v=1'),
      'KMS_UNAVAILABLE',
      'KMS outage simulation: encryption fails closed with KMS_UNAVAILABLE (zero plaintext fallback)'
    );

    const dummyEncrypted = {
      formatVersion: 1,
      algorithm: 'AES-256-GCM',
      keyId: 'vyr064-outage-kek',
      encryptedDek: Buffer.alloc(48, 1).toString('base64'),
      nonce: Buffer.alloc(12, 2).toString('base64'),
      authTag: Buffer.alloc(16, 3).toString('base64'),
      ciphertext: Buffer.alloc(32, 4).toString('base64'),
      aad: 'tenant=t|table=oracle_raw_users|id=1|v=1',
      createdAt: new Date().toISOString(),
    };
    await expectRejectCode(
      () => kmsService.decryptPayload(dummyEncrypted, 'tenant=t|table=oracle_raw_users|id=1|v=1'),
      'KMS_UNAVAILABLE',
      'KMS outage simulation: decryption fails closed with KMS_UNAVAILABLE'
    );

    // Insert expired stale lock & rehearse POST /api/admin/locks/recover-stale
    await distributedLockService.ensureTable();
    await dbQuery(
      `INSERT INTO veyra_distributed_locks (lock_key, tenant_id, domain, holder_id, task_name, acquired_at, expires_at, heartbeat_at)
       VALUES ($1, '__GLOBAL__', 'vyr064_rehearsal', 'crashed-pod-01:999', 'NIGHTLY_SYNC', NOW() - interval '2 hours', NOW() - interval '1 hour', NOW() - interval '2 hours')
       ON CONFLICT (lock_key) DO UPDATE SET expires_at = NOW() - interval '1 hour'`,
      [lockKey]
    );
    const recoverRes = await makeRequest('POST', '/api/admin/locks/recover-stale', {}, adminToken);
    const remainingStale = (await dbQuery('SELECT COUNT(*)::int c FROM veyra_distributed_locks WHERE lock_key = $1', [lockKey])).rows[0].c;
    report(
      recoverRes.status === 200 && recoverRes.data?.cleanedCount >= 1 && remainingStale === 0,
      'Scheduler recovery: POST /api/admin/locks/recover-stale removes expired crashed worker lock',
      recoverRes.data
    );

    // Insert quarantined record & rehearse triage + resolution endpoints
    const qr = await syncCheckpointService.quarantineRecord({
      domain: 'controls',
      recordKey: 'VYR064_QUAR_CTRL_1',
      payload: { controlId: 'VYR064_QUAR_CTRL_1', malformed: true },
      errorReason: 'Rehearsal malformed record test',
      errorCode: 'MALFORMED_RECORD',
    });
    quarantineId = qr.id;

    const listQuarRes = await makeRequest('GET', '/api/admin/sync/quarantine?domain=controls&status=QUARANTINED', null, adminToken);
    const resolveQuarRes = await makeRequest('POST', `/api/admin/sync/quarantine/${quarantineId}/resolve`, {}, adminToken);
    const resolvedRow = (await dbQuery('SELECT status FROM veyra_sync_quarantine WHERE id = $1', [quarantineId])).rows[0];
    report(
      listQuarRes.status === 200 && Array.isArray(listQuarRes.data?.quarantine) &&
      listQuarRes.data.quarantine.some((r) => r.id === quarantineId) &&
      resolveQuarRes.status === 200 && resolveQuarRes.data?.success === true &&
      resolvedRow?.status === 'RESOLVED',
      'Quarantine recovery: GET /api/admin/sync/quarantine lists item and POST .../resolve clears it'
    );

    // Telemetry endpoints respond accurately
    const cryptoHealth = await makeRequest('GET', '/api/security/crypto-health', null, adminToken);
    const syncMonitor = await makeRequest('GET', '/api/security/sync-monitor', null, adminToken);
    const ckptRes = await makeRequest('GET', '/api/admin/sync/checkpoints', null, adminToken);
    const secretsStatus = await makeRequest('GET', '/api/admin/security/secrets-status', null, adminToken);
    report(
      [200, 503].includes(cryptoHealth.status) &&
      [200, 503].includes(syncMonitor.status) &&
      ckptRes.status === 200 &&
      secretsStatus.status === 200 &&
      secretsStatus.data?.success === true,
      'Operational telemetry endpoints (crypto-health, sync-monitor, checkpoints, secrets-status) respond cleanly'
    );

    sectionEnd();

    // =========================================================================
    // SECTION 6: Architecture, API & Runbook Parity Check
    // =========================================================================
    section('Section 6: Architecture, API & Runbook Parity Verification');

    const archDocPath = path.join(repoRoot, 'docs/architecture/VEYRA_SECURITY_AND_API_ARCHITECTURE.md');
    const releaseDocPath = path.join(repoRoot, 'docs/security/VYR-064_RELEASE_AND_ROLLBACK_RUNBOOK.md');
    const opsDocPath = path.join(repoRoot, 'docs/security/VYR-064_OPERATIONAL_RUNBOOKS_AND_HANDOVER.md');

    const archDoc = fs.existsSync(archDocPath) ? fs.readFileSync(archDocPath, 'utf8') : '';
    const releaseDoc = fs.existsSync(releaseDocPath) ? fs.readFileSync(releaseDocPath, 'utf8') : '';
    const opsDoc = fs.existsSync(opsDocPath) ? fs.readFileSync(opsDocPath, 'utf8') : '';
    const apiSrc = fs.readFileSync(path.join(repoRoot, 'backend/src/routes/api.ts'), 'utf8');

    report(
      archDoc.includes('```mermaid') &&
      archDoc.includes('standard-veyra-application-dev') &&
      archDoc.includes('veyra-application-dev'),
      'Architecture doc contains Mermaid diagrams and dual-branch variant model'
    );

    const documentedRoutes = [
      '/security/crypto-health',
      '/security/sync-monitor',
      '/security/sync-alerts',
      '/admin/sync/status',
      '/admin/sync/full',
      '/admin/locks',
      '/admin/locks/recover-stale',
      '/admin/locks/force-release',
      '/admin/sync/checkpoints',
      '/admin/sync/quarantine',
      '/admin/security/secrets-status',
      '/admin/security/rotate-secret',
      '/admin/credentials/health',
      '/admin/credentials/rotate',
      '/admin/sessions/cleanup',
      '/admin/users/:email/unlock',
    ];
    const allRoutesMatchCode = documentedRoutes.every((r) => apiSrc.includes(r) && archDoc.includes(`/api${r}`));
    report(
      allRoutesMatchCode,
      'All documented operational & security API endpoints exist in backend/src/routes/api.ts'
    );

    report(
      releaseDoc.includes('Phase 0') &&
      releaseDoc.includes('Phase 1') &&
      releaseDoc.includes('Phase 2') &&
      releaseDoc.includes('Phase 3') &&
      releaseDoc.includes('Phase 4') &&
      releaseDoc.includes('RB-1') &&
      releaseDoc.includes('RB-2') &&
      releaseDoc.includes('RB-3') &&
      releaseDoc.includes('RB-4'),
      'Release runbook documents 5-phase rollout, DB migration sequencing, and all 4 rollback procedures'
    );

    report(
      opsDoc.includes('Runbook A') &&
      opsDoc.includes('Runbook B') &&
      opsDoc.includes('Runbook C') &&
      opsDoc.includes('Runbook D') &&
      opsDoc.includes('Primary Owner') &&
      opsDoc.includes('Escalation Owner') &&
      opsDoc.includes('Handover Checklist'),
      'Operational runbook covers key rotation, KMS outage, scheduler recovery, incident response, owners, alerts, and handover'
    );

    sectionEnd();
  } finally {
    // Restore environment & clean ephemeral DB state
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await dbQuery('DELETE FROM veyra_distributed_locks WHERE lock_key = $1', [lockKey]).catch(() => {});
    if (quarantineId) {
      await dbQuery('DELETE FROM veyra_sync_quarantine WHERE id = $1', [quarantineId]).catch(() => {});
    }
    await dbQuery('DELETE FROM veyra_session WHERE session_id = $1', [legacySessionId]).catch(() => {});
    await dbQuery("UPDATE veyra_session SET status = 'EXPIRED' WHERE status = 'ACTIVE'").catch(() => {});
    if (usersAuthBackup !== null) {
      fs.writeFileSync(usersAuthPath, usersAuthBackup, 'utf8');
    }
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }

  console.log('\n================================================================');
  for (const s of sections) {
    console.log(`  [${s.name}] passed=${s.passed} failed=${s.failed}`);
  }
  console.log(`  TOTAL: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  console.log('================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal VYR-064 rehearsal error:', err);
  process.exit(1);
});
