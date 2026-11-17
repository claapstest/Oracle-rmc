/**
 * Test Suite: Story VYR-053
 * "Implement security audit logging and sensitive-data masking"
 * Epic: EPIC 6 — OWASP application and API security hardening
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Sections:
 *  A. Runtime: standardized event schema — record CONFIG_CHANGED /
 *     PRIVILEGED_DATA_ACCESS events and read back correlation_id,
 *     service_identity, tenant, result.
 *  B. Runtime: tamper evidence — hash chain verifies; a direct DB mutation is
 *     detected; repairAuditChain restores verifiability.
 *  C. Runtime: sensitive-data masking — forbidden keys stripped from details,
 *     free-form strings masked by logAudit's maskSensitive.
 *  D. Static: logAudit masking, event wiring (CONFIG_CHANGED /
 *     PRIVILEGED_DATA_ACCESS / AUDIT_LOG_ACCESS), supervisor-gated read route,
 *     migration + policy doc present.
 *
 * Runtime sections require the local PostgreSQL test database:
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/veyra_db
 */

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
  console.log('  VYR-053: Security Audit Logging & Sensitive-Data Masking');
  console.log('================================================================\n');

  const src = path.resolve(__dirname, '../src');
  const dist = path.resolve(__dirname, '../dist');
  const root = path.resolve(__dirname, '../..');

  assert(fs.existsSync(dist), 'backend is compiled (dist/ exists)');

  const api = read(path.join(src, 'routes/api.ts'));
  const auditSrc = read(path.join(src, 'services/auditService.ts'));
  const loggerSrc = read(path.join(src, 'security/securityEventLogger.ts'));

  const hasDb = !!process.env.DATABASE_URL && /5433|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

  const auditServiceMod = await import(
    pathToFileURL(path.join(dist, 'services/auditService.js')).href
  );
  const cryptoFailureMod = await import(
    pathToFileURL(path.join(dist, 'security/cryptoFailure.js')).href
  );

  // =====================================================================
  // Section A: standardized event schema (runtime, needs DB)
  // =====================================================================
  console.log('--- Section A: standardized event schema (runtime) ---');

  if (hasDb) {
    const auditService = auditServiceMod.auditService;
    const marker = `vyr053-selftest-${Date.now()}`;

    const rec = await auditService.recordAuditEvent({
      eventType: 'CONFIG_CHANGED',
      userId: null,
      targetType: 'vyr053_test',
      targetId: 'self-test',
      details: { marker, note: 'VYR-053 test event' },
      serviceIdentity: 'vyr053-selftest',
      tenant: 'vyr053-test-tenant',
      correlationId: marker,
      result: 'SUCCESS'
    });
    assert(rec.success === true, 'CONFIG_CHANGED event recorded');
    assert(rec.event && rec.event.correlationId === marker, 'correlation_id persisted');
    assert(rec.event && rec.event.serviceIdentity === 'vyr053-selftest', 'service_identity persisted');
    assert(rec.event && rec.event.tenant === 'vyr053-test-tenant', 'tenant persisted');
    assert(rec.event && rec.event.result === 'SUCCESS', 'result persisted');

    const rec2 = await auditService.recordAuditEvent({
      eventType: 'PRIVILEGED_DATA_ACCESS',
      userId: null,
      targetType: 'report',
      targetId: 'vyr053-test-report',
      details: { marker },
      correlationId: marker,
      result: 'DENIED'
    });
    assert(rec2.success === true, 'PRIVILEGED_DATA_ACCESS event recorded (DENIED)');

    // auto correlation: omit correlationId -> fresh UUID assigned
    const rec3 = await auditService.recordAuditEvent({
      eventType: 'AUDIT_LOG_ACCESS',
      userId: null,
      targetType: 'audit_event',
      details: { marker }
    });
    assert(rec3.success === true && rec3.event && /^[0-9a-f-]{36}$/.test(rec3.event.correlationId || ''),
      'correlation_id auto-generated when omitted');

    // ===================================================================
    // Section B: tamper evidence
    // ===================================================================
    console.log('\n--- Section B: tamper evidence (runtime) ---');

    let verify = await auditService.verifyAuditChain();
    assert(verify.valid === true, `hash chain verifies after clean writes (${verify.eventsChecked} events, ${verify.legacyEvents} legacy)`);

    // Tamper: mutate the stored details of the last test event directly.
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(
      `UPDATE veyra_audit_event SET details = details || '{"marker":"tampered"}'
        WHERE correlation_id = $1 AND event_type = 'CONFIG_CHANGED'`,
      [marker]
    );
    verify = await auditService.verifyAuditChain();
    assert(verify.valid === false, 'tamper detected: modified event breaks the chain');
    assert(verify.reason && verify.reason.includes('mismatch'), `tamper reason reported (${verify.reason || '-'})`);

    // Repair and confirm the chain verifies again.
    const repair = await auditService.repairAuditChain();
    assert(repair.repaired >= 1, `repairAuditChain re-verified content (${repair.repaired} rows recomputed)`);
    verify = await auditService.verifyAuditChain();
    assert(verify.valid === true, 'chain verifies again after repair');

    // Hash-stripping tamper: nulling a hashed row's hash must be flagged.
    await client.query(
      `UPDATE veyra_audit_event SET event_hash = NULL WHERE correlation_id = $1 AND event_type = 'CONFIG_CHANGED'`,
      [marker]
    );
    verify = await auditService.verifyAuditChain();
    assert(verify.valid === false && (verify.reason || '').includes('missing'),
      'tamper detected: stripped hash flagged');
    await auditService.repairAuditChain();
    verify = await auditService.verifyAuditChain();
    assert(verify.valid === true, 'chain restored after stripping tamper');

    // Cleanup: remove only self-test rows, then re-link the chain — row
    // deletion is itself a chain break for successors, so repair follows.
    await client.query(
      `DELETE FROM veyra_audit_event
        WHERE correlation_id = $1 OR details->>'marker' LIKE 'vyr053-selftest-%'`,
      [marker]
    );
    await auditService.repairAuditChain();
    await client.end();
    console.log('  (self-test events removed)');
  } else {
    console.log('  SKIP: DATABASE_URL not set — runtime sections skipped (static sections still run)');
  }

  // =====================================================================
  // Section C: sensitive-data masking (runtime, no DB writes)
  // =====================================================================
  console.log('\n--- Section C: sensitive-data masking ---');

  const { maskSensitive } = cryptoFailureMod;
  assert(maskSensitive('Bearer abc.def.ghi') === 'Bearer [REDACTED]', 'Authorization headers masked');
  assert(!/eyJ/.test(maskSensitive('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123def456')), 'JWTs masked');
  assert(!/hunter2/.test(maskSensitive('password=hunter2')), 'password assignments masked');
  assert(!/abcdef0123456789abcdef0123456789abcdef0123/.test(
    maskSensitive('cipher abcdef0123456789abcdef0123456789abcdef0123')), 'long hex secrets masked');

  // Structured details sanitizer (no DB needed): forbidden keys dropped.
  if (hasDb) {
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const marker2 = `vyr053-mask-${Date.now()}`;
    await auditServiceMod.auditService.recordAuditEvent({
      eventType: 'CONFIG_CHANGED',
      userId: null,
      targetType: 'vyr053_mask_test',
      details: { marker: marker2, password: 'super-secret', authorization: 'Bearer x', nested: { api_key: 'k', safe: 'kept' } },
      correlationId: marker2
    });
    const res = await client.query(`SELECT details FROM veyra_audit_event WHERE correlation_id = $1`, [marker2]);
    const stored = res.rows[0] ? JSON.stringify(res.rows[0].details) : '';
    assert(!stored.includes('super-secret'), 'password value never persisted in details');
    assert(!stored.includes('api_key'), 'forbidden nested keys dropped entirely');
    assert(stored.includes('kept'), 'non-sensitive sibling keys preserved');
    await client.query(`DELETE FROM veyra_audit_event WHERE details->>'marker' = $1`, [marker2]);
    await auditServiceMod.auditService.repairAuditChain();
    await client.end();
  }

  // =====================================================================
  // Section D: static wiring checks
  // =====================================================================
  console.log('\n--- Section D: static wiring ---');

  // New event types in the allowlist union + DB CHECK.
  for (const t of ['CONFIG_CHANGED', 'PRIVILEGED_DATA_ACCESS', 'DECRYPTION_ACCESS', 'AUDIT_LOG_ACCESS']) {
    assert(auditSrc.includes(`'${t}'`), `event type ${t} in allowlist`);
  }
  assert(/ck_veyra_audit_event_type/.test(auditSrc) && /CONFIG_CHANGED/.test(auditSrc),
    'CHECK constraint widened by ensureAuditSchema');

  // New schema columns present.
  for (const col of ['correlation_id', 'service_identity', 'tenant', 'result', 'event_hash']) {
    assert(auditSrc.includes(col), `column ${col} in schema ensure`);
  }
  assert(auditSrc.includes('verifyAuditChain') && auditSrc.includes('repairAuditChain'),
    'verifyAuditChain + repairAuditChain implemented');
  assert(/createHash\('sha256'\)/.test(auditSrc), 'hash chain uses sha256');

  // Standardized recorder exists and never breaks the business flow.
  assert(/record\(input: SecurityEventInput\)/.test(loggerSrc), 'securityEventLogger.record() standardized recorder');
  assert(/AUDIT_WRITE_FAILED/.test(loggerSrc) && !loggerSrc.includes('throw new Error') ,
    'recorder swallows errors (audit failure never breaks business flow)');

  // logAudit masks free-form strings before file + in-memory trail.
  assert(/maskSensitive\(details, 2000\)/.test(api), 'logAudit masks details via maskSensitive');
  assert(/safeDetails/.test(api), 'masked string used for both file log and in-memory trail');

  // Routes wired.
  assert(/'CONFIG_CHANGED'/.test(api), 'config-save routes record CONFIG_CHANGED');
  assert(/'PRIVILEGED_DATA_ACCESS'/.test(api), 'report download records PRIVILEGED_DATA_ACCESS');
  assert(/'AUDIT_LOG_ACCESS'/.test(api), 'audit-events read route records AUDIT_LOG_ACCESS');
  assert(/credentialsUpdated/.test(api) && !/password: req\.body|token: req\.body/.test(api),
    'credential presence recorded as booleans, never values');

  // Read route stays supervisor-gated.
  const auditRouteLine = api.split('\n').find((l) => l.includes('audit-events') && l.includes('apiRouter.get'));
  assert(!!auditRouteLine && auditRouteLine.includes('requireAuditSupervisorDashboard'),
    'audit-events read route still supervisor-gated');

  // Migration + policy doc exist.
  const migration = path.join(root, 'database/migrations/1711000000025_vyr053_audit_event_security_columns.cjs');
  assert(fs.existsSync(migration), 'migration 1711000000025 (VYR-053 columns + CHECK widening) present');
  const policyDoc = path.join(root, 'docs/security/VYR-053_audit_log_policy.md');
  assert(fs.existsSync(policyDoc), 'audit log policy document present');
  if (fs.existsSync(policyDoc)) {
    const doc = read(policyDoc);
    assert(/[Rr]etention/.test(doc) && /[Aa]ccess control/.test(doc) && /[Tt]amper/.test(doc),
      'policy doc covers retention, access control and tamper evidence');
  }

  // File logger still mode 0600.
  assert(/mode: 0o600/.test(api), 'oracle_audit.log written with mode 0600');

  console.log('\n================================================================');
  console.log(`  RESULTS: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================\n');
  process.exit(failedTests > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
