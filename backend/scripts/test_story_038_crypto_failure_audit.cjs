/**
 * Test Suite: Story VYR-038
 * "Implement encryption failure handling and decryption audit controls"
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both
 *
 * Acceptance criteria covered:
 *   1. No plaintext fallback exists (encrypt and decrypt fail closed).
 *   2. Decryption events are auditable without sensitive values.
 *   3. Operational alerts identify systemic KMS/decryption failures.
 * Plus: error classification (KMS unavailable, invalid key, auth-tag mismatch,
 * unsupported version, corrupted payload), safe client-facing messages,
 * log masking, and row-host AAD binding for fallback-host queries.
 *
 * Requires `npm run build` first (imports from dist/). Uses the local Postgres
 * only for veyra_crypto_audit_event; test rows are removed before and after.
 */

const path = require('path');
const pg = require('pg');
const dotenv = require('dotenv');

const HOST = 'vyr038-crypto-test.oraclecloud.com';
const OTHER_HOST = 'vyr038-other-tenant.oraclecloud.com';
const SENTINEL = 'VYR038_SECRET_MARKER_41';
const PURPOSE = 'VYR038-test';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/veyra_db';
}
process.env.VEYRA_RAW_ENCRYPTION = 'true';
process.env.VEYRA_CRYPTO_AUDIT_FLUSH_MS = '60000'; // tests flush explicitly
process.env.VEYRA_CRYPTO_ALERT_SYSTEMIC_THRESHOLD = '3';
process.env.VEYRA_CRYPTO_ALERT_THRESHOLD = '5';

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) { console.log(`  PASS: ${name}`); passed++; }
  else { console.error(`  FAIL: ${name}`); failed++; }
}

async function catchErr(fn) {
  try { await fn(); return null; } catch (err) { return err; }
}

/** Captures console.error output produced while fn runs. */
async function captureErrors(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...args) => { lines.push(args.map(String).join(' ')); };
  try { await fn(); } finally { console.error = orig; }
  return lines.join('\n');
}

const writer = require('../dist/security/encryptedRecordWriter.js');
const reader = require('../dist/security/decryptedRecordReader.js');
const { encryptionService, EncryptionError } = require('../dist/security/encryptionService.js');
const { classifyCryptoError, ProtectedDataError, maskSensitive } = require('../dist/security/cryptoFailure.js');
const { runWithCryptoAuditContext, runAsCryptoService, hashSessionRef } = require('../dist/security/cryptoAuditContext.js');
const { cryptoAuditService } = require('../dist/security/cryptoAuditService.js');

const USER_CTX = {
  actorType: 'USER',
  userId: '00000000-0000-4000-8000-000000000038',
  userEmail: 'auditor.vyr038@example.com',
  sessionRef: hashSessionRef('raw-session-id-vyr038'),
  ipAddress: '10.0.0.38',
  purpose: PURPOSE,
};

async function encryptedUserRow(username, host = HOST) {
  const raw = { userName: username, email: `${username}@example.com`, secret: SENTINEL };
  const write = await writer.encryptRawField('oracle_raw_users', { username }, raw, host);
  return { environment_host: host, username, is_encrypted: true, raw_user: write.rawValue };
}

function leaksSensitive(text, payload) {
  return text.includes(SENTINEL) ||
    (payload && (text.includes(payload.ciphertext) || text.includes(payload.encryptedDek) || text.includes(payload.aad)));
}

async function cleanup(client) {
  await cryptoAuditService.ensureSchema();
  await client.query(
    `DELETE FROM veyra_crypto_audit_event
     WHERE tenant IN ($1, $2) OR purpose LIKE $3`,
    [HOST, OTHER_HOST, `${PURPOSE}%`]
  );
}

async function run() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    console.log('\n=== VYR-038: Encryption failure handling and decryption audit controls ===\n');
    await cleanup(client);
    cryptoAuditService.resetForTests();

    // ------------------------------------------------------------------
    console.log('--- 1. Error classification ---');
    const cases = [
      [new EncryptionError('KMS_UNAVAILABLE', 'x'), 'KMS_UNAVAILABLE'],
      [Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED' }), 'KMS_UNAVAILABLE'],
      [Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' }), 'KMS_UNAVAILABLE'],
      [Object.assign(new Error('upstream'), { statusCode: 503 }), 'KMS_UNAVAILABLE'],
      [new EncryptionError('KEY_NOT_FOUND', 'x'), 'INVALID_KEY'],
      [new EncryptionError('KEY_NOT_APPROVED', 'x'), 'INVALID_KEY'],
      [new EncryptionError('DECRYPTION_FAILED', 'Failed to unwrap DEK under keyId "k"'), 'INVALID_KEY'],
      [new EncryptionError('DECRYPTION_FAILED', 'Authentication tag verification failed'), 'AUTH_TAG_MISMATCH'],
      [new EncryptionError('AAD_MISMATCH', 'x'), 'AUTH_TAG_MISMATCH'],
      [new EncryptionError('UNSUPPORTED_FORMAT_VERSION', 'x'), 'UNSUPPORTED_VERSION'],
      [new EncryptionError('UNSUPPORTED_ALGORITHM', 'x'), 'UNSUPPORTED_VERSION'],
      [new EncryptionError('INVALID_CONTAINER', 'x'), 'CORRUPTED_PAYLOAD'],
      [new SyntaxError('Unexpected token'), 'CORRUPTED_PAYLOAD'],
      [new Error('Invalid nonce length'), 'CORRUPTED_PAYLOAD'],
      [new EncryptionError('ENCRYPTION_FAILED', 'x'), 'ENCRYPTION_FAILURE'],
    ];
    for (const [err, expected] of cases) {
      const got = classifyCryptoError(err);
      assert(got === expected, `${err.name}${err.code ? `(${err.code})` : ''} "${err.message.slice(0, 30)}" -> ${expected}${got !== expected ? ` (got ${got})` : ''}`);
    }

    await runWithCryptoAuditContext(USER_CTX, async () => {
      // ----------------------------------------------------------------
      console.log('\n--- 2. Decrypt fails closed with a safe error (AC1) ---');
      const row = await encryptedUserRow('VYR038_TAMPER');
      const payload = row.raw_user;
      const ct = Buffer.from(payload.ciphertext, 'base64'); ct[0] ^= 0xff;
      const tampered = { ...row, raw_user: { ...payload, ciphertext: ct.toString('base64') } };

      let err;
      const logs = await captureErrors(async () => {
        err = await catchErr(() => reader.decryptSingleRawField('oracle_raw_users', 'raw_user', tampered, HOST));
      });
      assert(err instanceof ProtectedDataError, 'Tampered ciphertext throws ProtectedDataError');
      assert(err && err.category === 'AUTH_TAG_MISMATCH', 'Tampered ciphertext classified AUTH_TAG_MISMATCH');
      assert(err && /^Protected data could not be accessed\. Reference: CRY-/.test(err.message), 'Client message is generic with an incident reference');
      assert(err && !leaksSensitive(err.message, payload) && !/aes|gcm|keyId|tenant=|kms/i.test(err.message), 'Client message leaks no key id, AAD, algorithm or ciphertext');
      assert(err && JSON.stringify(err) === JSON.stringify({ code: 'PROTECTED_DATA_UNAVAILABLE', message: err.message, reference: err.incidentId }), 'JSON serialization exposes only code, message and reference');
      assert(err && err.status === 500, 'Integrity failures map to HTTP 500');
      assert(logs.includes(err && err.incidentId) && !leaksSensitive(logs, payload), 'Internal log carries the reference but no payload, ciphertext, DEK or AAD');

      err = await catchErr(() => reader.decryptSingleRawField('oracle_raw_users', 'raw_user',
        { ...row, raw_user: { ...payload, keyId: 'vyr038-unknown-key' } }, HOST));
      assert(err && err.category === 'INVALID_KEY', 'Unknown key id fails closed as INVALID_KEY');

      err = await catchErr(() => reader.decryptSingleRawField('oracle_raw_users', 'raw_user',
        { ...row, raw_user: { ...payload, formatVersion: 99 } }, HOST));
      assert(err && err.category === 'UNSUPPORTED_VERSION', 'Unsupported format version fails closed as UNSUPPORTED_VERSION');

      err = await catchErr(() => reader.decryptSingleRawField('oracle_raw_users', 'raw_user',
        { ...row, raw_user: { ...payload, nonce: 'AAAA' } }, HOST));
      assert(err && err.category === 'CORRUPTED_PAYLOAD', 'Truncated container fails closed as CORRUPTED_PAYLOAD');

      const flagged = { environment_host: HOST, username: 'VYR038_FLAGGED', is_encrypted: true, raw_user: { secret: SENTINEL } };
      let out;
      err = await catchErr(async () => { out = await reader.decryptRawRows('oracle_raw_users', 'raw_user', [flagged], HOST); });
      assert(err && err.category === 'CORRUPTED_PAYLOAD' && out === undefined, 'Row flagged encrypted but holding plaintext is refused, not returned (no plaintext fallback)');

      const legacy = { environment_host: HOST, username: 'VYR038_LEGACY', is_encrypted: false, raw_user: { name: 'legacy' } };
      out = await reader.decryptRawRows('oracle_raw_users', 'raw_user', [legacy], HOST);
      assert(out[0].raw_user.name === 'legacy', 'Genuine legacy plaintext rows still pass through during migration window');

      const original = encryptionService.decryptEntityRecord;
      encryptionService.decryptEntityRecord = async () => { throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }); };
      try {
        err = await catchErr(() => reader.decryptSingleRawField('oracle_raw_users', 'raw_user', row, HOST));
      } finally {
        encryptionService.decryptEntityRecord = original;
      }
      assert(err && err.category === 'KMS_UNAVAILABLE' && err.status === 503, 'KMS timeout on decrypt -> KMS_UNAVAILABLE / HTTP 503');
      assert(err && /temporarily unavailable/.test(err.message), 'KMS outage message tells the user to retry, nothing more');

      // ----------------------------------------------------------------
      console.log('\n--- 3. Encrypt fails closed: no plaintext persisted (AC1) ---');
      const origEncrypt = encryptionService.encryptPayload;
      encryptionService.encryptPayload = async () => { throw Object.assign(new Error('KMS unreachable'), { code: 'ECONNREFUSED' }); };
      let write;
      try {
        err = await catchErr(async () => { write = await writer.encryptRawField('oracle_raw_users', { username: 'VYR038_ENC' }, { secret: SENTINEL }, HOST); });
      } finally {
        encryptionService.encryptPayload = origEncrypt;
      }
      assert(err instanceof ProtectedDataError && err.category === 'KMS_UNAVAILABLE' && write === undefined, 'KMS outage on encrypt throws; no write value is produced');
      assert(err && err.operation === 'ENCRYPT' && /could not be stored securely|temporarily unavailable/.test(err.message), 'Encrypt failure message is safe');

      encryptionService.encryptPayload = async (data) => data; // degraded provider returning plaintext
      try {
        err = await catchErr(async () => { write = await writer.encryptRawField('oracle_raw_users', { username: 'VYR038_ENC2' }, { secret: SENTINEL }, HOST); });
      } finally {
        encryptionService.encryptPayload = origEncrypt;
      }
      assert(err && err.category === 'ENCRYPTION_FAILURE' && write === undefined, 'Provider returning plaintext is rejected as ENCRYPTION_FAILURE');

      err = await catchErr(() => writer.assertEncryptedRawWrite('oracle_raw_users', { rawValue: { secret: SENTINEL }, isEncrypted: false, encryptionKey: null }));
      assert(!!err, 'Repository boundary still rejects plaintext writes while encryption is enabled');

      // ----------------------------------------------------------------
      console.log('\n--- 4. Row host binding for fallback-host queries ---');
      const other = await encryptedUserRow('VYR038_OTHERHOST', OTHER_HOST);
      out = await reader.decryptRawRows('oracle_raw_users', 'raw_user', [other], HOST);
      assert(out[0].raw_user.userName === 'VYR038_OTHERHOST', "Row from a fallback host decrypts with that row's own host");
      err = await catchErr(() => reader.decryptRawRows('oracle_raw_users', 'raw_user', [{ ...other, environment_host: HOST }], HOST));
      assert(err && err.category === 'AUTH_TAG_MISMATCH', "Ciphertext copied into another tenant's row still fails closed");
    });

    // ------------------------------------------------------------------
    console.log('\n--- 5. Decryption audit trail (AC2) ---');
    cryptoAuditService.resetForTests();
    const rows = [];
    for (const u of ['VYR038_A', 'VYR038_B', 'VYR038_C']) rows.push(await encryptedUserRow(u));

    let failureRef;
    await runWithCryptoAuditContext(USER_CTX, async () => {
      const out = await reader.decryptRawRows('oracle_raw_users', 'raw_user', rows, HOST);
      assert(out.length === 3 && out.every(r => r.raw_user.secret === SENTINEL), 'Authorized read returns decrypted rows');
      const bad = { ...rows[0], raw_user: { ...rows[0].raw_user, authTag: Buffer.alloc(16).toString('base64') } };
      await captureErrors(async () => {
        const e = await catchErr(() => reader.decryptSingleRawField('oracle_raw_users', 'raw_user', bad, HOST));
        failureRef = e && e.incidentId;
      });
    });
    await runAsCryptoService('vyr038-sync', `${PURPOSE}:service`, async () => {
      await reader.decryptRawRows('oracle_raw_users', 'raw_user', [rows[1]], HOST);
    });
    await cryptoAuditService.flush();

    const success = (await client.query(
      `SELECT * FROM veyra_crypto_audit_event WHERE purpose = $1 AND outcome = 'SUCCESS' AND operation = 'DECRYPT' AND tenant = $2`,
      [PURPOSE, HOST]
    )).rows;
    assert(success.length === 1, 'Three decrypts in one request aggregate into one audit row');
    const s = success[0] || {};
    assert(s.record_count === 3, 'Audit row counts every record decrypted (record_count = 3)');
    assert(s.actor_type === 'USER' && s.user_id === USER_CTX.userId && s.user_email === USER_CTX.userEmail, 'Audit row records user identity');
    assert(s.tenant === HOST && s.table_name === 'oracle_raw_users', 'Audit row records tenant and table');
    assert(Array.isArray(s.record_refs) && ['VYR038_A', 'VYR038_B', 'VYR038_C'].every(r => s.record_refs.includes(r)), 'Audit row records record references');
    assert(s.purpose === PURPOSE && s.occurred_at instanceof Date, 'Audit row records purpose and timestamp');
    assert(s.session_ref === USER_CTX.sessionRef && s.session_ref !== 'raw-session-id-vyr038', 'Session is stored as a one-way hash, not the raw session id');

    const fail = (await client.query(`SELECT * FROM veyra_crypto_audit_event WHERE incident_id = $1`, [failureRef])).rows[0];
    assert(!!fail && fail.outcome === 'FAILURE' && fail.error_category === 'AUTH_TAG_MISMATCH', 'Failed decrypt is audited with its category');
    assert(!!fail && fail.user_id === USER_CTX.userId && fail.record_refs[0] === 'VYR038_A', 'Failure row ties the incident reference to user and record');

    const svc = (await client.query(`SELECT * FROM veyra_crypto_audit_event WHERE purpose = $1`, [`${PURPOSE}:service`])).rows[0];
    assert(!!svc && svc.actor_type === 'SERVICE' && svc.service_name === 'vyr038-sync' && svc.user_id === null, 'Background decrypts are attributed to the service identity');

    const allRows = (await client.query(`SELECT * FROM veyra_crypto_audit_event WHERE tenant = $1 OR purpose LIKE $2`, [HOST, `${PURPOSE}%`])).rows;
    const dump = JSON.stringify(allRows);
    assert(!dump.includes(SENTINEL), 'No audit row contains decrypted payload values');
    assert(!rows.some(r => dump.includes(r.raw_user.ciphertext) || dump.includes(r.raw_user.encryptedDek) || dump.includes(r.raw_user.nonce)), 'No audit row contains ciphertext, wrapped DEK or nonce');

    // ------------------------------------------------------------------
    console.log('\n--- 6. Systemic failure alerting (AC3) ---');
    cryptoAuditService.resetForTests();
    const badKeyRow = { ...rows[2], raw_user: { ...rows[2].raw_user, keyId: 'vyr038-missing-key' } };
    const alertLogs = await captureErrors(async () => {
      await runWithCryptoAuditContext(USER_CTX, async () => {
        for (let i = 0; i < 2; i++) await catchErr(() => reader.decryptSingleRawField('oracle_raw_users', 'raw_user', badKeyRow, HOST));
        assert(cryptoAuditService.getHealth().activeAlerts.length === 0, 'Isolated failures below threshold raise no alert');
        await catchErr(() => reader.decryptSingleRawField('oracle_raw_users', 'raw_user', badKeyRow, HOST));
      });
    });
    let health = cryptoAuditService.getHealth();
    assert(health.activeAlerts.length === 1 && health.activeAlerts[0].category === 'INVALID_KEY', 'Third INVALID_KEY failure in the window raises a systemic alert');
    assert(health.status === 'CRITICAL', 'Health status is CRITICAL while a key-level alert is active');
    assert(health.failuresByCategory.INVALID_KEY === 3, 'Health reports failure counts by category');
    assert(health.activeAlerts[0].affectedTables.includes('oracle_raw_users') && health.activeAlerts[0].affectedTenants.includes(HOST), 'Alert names affected tables and tenants');
    assert(alertLogs.includes('[VEYRA SECURITY ALERT]'), 'Alert is emitted as a [VEYRA SECURITY ALERT] log line for monitoring');
    assert(!alertLogs.includes(SENTINEL) && !JSON.stringify(health).includes(SENTINEL), 'Alert and health output contain no sensitive values');

    await captureErrors(async () => {
      await catchErr(() => reader.decryptSingleRawField('oracle_raw_users', 'raw_user', badKeyRow, HOST));
    });
    assert(cryptoAuditService.getHealth().recentAlerts.length === 1, 'Cooldown prevents alert storms for the same category');

    await cryptoAuditService.flush();
    const alertRow = (await client.query(
      `SELECT * FROM veyra_crypto_audit_event WHERE operation = 'ALERT' AND incident_id = $1`, [health.activeAlerts[0].alertId]
    )).rows[0];
    assert(!!alertRow && alertRow.error_category === 'INVALID_KEY' && alertRow.record_count === 3, 'Alert is persisted to the crypto audit table');

    // ------------------------------------------------------------------
    console.log('\n--- 7. Log masking ---');
    const masked = maskSensitive(
      'Authorization: Bearer abc.def.ghi password=Hunter2! token="tok_123" ' +
      'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVlLXZ5cjAzOA ' +
      'dek=' + Buffer.alloc(32, 7).toString('base64') + ' ' +
      '-----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY----- ' +
      'blob ' + Buffer.alloc(48, 9).toString('base64')
    );
    assert(!/abc\.def\.ghi|Hunter2|tok_123|eyJhbGci|MIIEv/.test(masked), 'Bearer tokens, passwords, JWTs and PEM keys are masked');
    assert(!masked.includes(Buffer.alloc(32, 7).toString('base64')) && !masked.includes(Buffer.alloc(48, 9).toString('base64')), 'Key material and encoded payloads are masked');
    assert(maskSensitive('table=oracle_raw_users category=INVALID_KEY') === 'table=oracle_raw_users category=INVALID_KEY', 'Ordinary diagnostic text is left readable');

    // ------------------------------------------------------------------
    console.log('\n--- 8. Health endpoint wiring ---');
    const fs = require('fs');
    const apiSrc = fs.readFileSync(path.resolve(__dirname, '../src/routes/api.ts'), 'utf8');
    assert(/apiRouter\.get\('\/security\/crypto-health',\s*requireAdmin/.test(apiSrc), 'GET /api/security/crypto-health is registered and Site-Admin only');
    const mwSrc = fs.readFileSync(path.resolve(__dirname, '../src/middleware/jwtAuthMiddleware.ts'), 'utf8');
    assert(mwSrc.includes('bindRequestCryptoContext(req, res, next)'), 'Authenticated requests bind the principal for decrypt auditing');

    await cleanup(client);
  } finally {
    cryptoAuditService.resetForTests();
    await client.end();
  }

  console.log(`\n=== VYR-038 results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test harness error:', err);
  process.exit(1);
});
