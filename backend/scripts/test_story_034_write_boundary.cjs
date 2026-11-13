/**
 * Test Suite: Story VYR-034
 * "Enforce encryption at every raw-data persistence boundary"
 * Epic: EPIC 4 ??? Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Makes plaintext writes structurally difficult:
 *   - Static scan: every INSERT/UPDATE touching a raw payload column in
 *     backend/src must belong to a service that routes through the secured
 *     write boundary (encryptRawField / assertEncryptedRawWrite).
 *   - Boundary guard: while VEYRA_RAW_ENCRYPTION is on, plaintext writes are
 *     rejected before SQL; a degraded encryption provider returning plaintext
 *     is rejected too.
 *   - Integration: the certification tables (last plaintext gaps) now persist
 *     encrypted; round-trip decrypt works with the documented AAD convention.
 *
 * Uses an isolated tenant (vyr034-test.oraclecloud.com); rows are deleted
 * before and after, so real synced data is never touched.
 */

const fs = require('fs');
const path = require('path');
const pg = require('pg');
const dotenv = require('dotenv');
const { isEncryptedPayload } = require('../dist/security/encryptionContract.js');

const HOST = 'vyr034-test.oraclecloud.com';
const SENTINEL = 'VYR034_SECRET_MARKER_77';

process.env.FUSION_HOST = HOST;

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/veyra_db';
}

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

const RAW_TABLES = [
  'oracle_raw_audit_records',
  'oracle_raw_users',
  'oracle_raw_roles',
  'oracle_raw_role_hierarchy',
  'oracle_raw_controls',
  'oracle_control_incidents',
  'oracle_incident_rows',
  'oracle_raw_access_certifications',
  'oracle_raw_certifier_worksheets',
  'oracle_raw_user_access',
];

const RAW_COLUMNS = ['raw_payload', 'raw_user', 'raw_role', 'raw_record', 'raw_incidents', 'raw_data', 'raw '];

/**
 * Statements that match a raw-table regex but provably do not write a raw
 * payload column. Each entry documents why it is safe.
 */
const WRITE_SITE_WHITELIST = [
  'controlRawDbService.ts:293', // auto-heal: reads jsonb_array_length(raw_incidents), writes counters only
  'controlRawDbService.ts:1576', // upsertWatermark: no raw column in statement
  'controlRawDbService.ts:1651', // counter update: no raw column in statement
];

async function cleanupHost(pool) {
  await pool.query(`DELETE FROM oracle_raw_access_certifications WHERE environment_host = $1`, [HOST]);
  await pool.query(`DELETE FROM oracle_raw_certifier_worksheets WHERE environment_host = $1`, [HOST]);
}

function deleteCacheFiles() {
  for (const f of ['oracle_access_certs_cache.json', 'oracle_certifier_worksheets_cache.json']) {
    const p = path.resolve(__dirname, '..', f);
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
  }
}

async function run() {
  console.log('\n================================================================');
  console.log('  VYR-034: Enforce Encryption at Raw-Data Persistence Boundary');
  console.log('================================================================\n');

  // ------------------------------------------------------------------
  // Section 1: Static scan ??? no unsecured raw-table writes in backend/src
  // ------------------------------------------------------------------
  console.log('--- Section 1: Static Scan (AC1: all raw writes use the secured boundary) ---');

  const srcDir = path.resolve(__dirname, '../src');
  const srcFiles = (function walk(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(fp));
      else if (e.name.endsWith('.ts')) out.push(fp);
    }
    return out;
  })(srcDir);

  let writeMatches = 0;
  let securedFiles = new Set();
  let unsecuredSites = [];

  for (const file of srcFiles) {
    const rel = path.relative(srcDir, file).replace(/\\/g, '/');
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const usesBoundary = /encryptRawField|assertEncryptedRawWrite/.test(text);

    lines.forEach((line, i) => {
      const m = line.match(/\b(INSERT INTO|UPDATE)\s+(oracle_raw_audit_records|oracle_raw_users|oracle_raw_roles|oracle_raw_role_hierarchy|oracle_raw_controls|oracle_control_incidents|oracle_incident_rows|oracle_raw_access_certifications|oracle_raw_certifier_worksheets|oracle_raw_user_access)\b/);
      if (!m) return;
      writeMatches++;

      const siteKey = path.basename(file) + ':' + (i + 1);
      if (WRITE_SITE_WHITELIST.includes(siteKey)) return; // documented: does not write a raw column

      // Does the statement (this line plus following context) assign a raw column?
      const stmt = lines.slice(i, Math.min(i + 30, lines.length)).join('\n');
      const touchesRawColumn = RAW_COLUMNS.some(c => stmt.includes(c));
      if (touchesRawColumn && !usesBoundary) {
        unsecuredSites.push(`${rel}:${i + 1}`);
      }
      if (usesBoundary) securedFiles.add(rel);
    });
  }

  assert(writeMatches > 0, `Static scan found ${writeMatches} raw-table INSERT/UPDATE sites across backend/src`);
  assert(unsecuredSites.length === 0,
    unsecuredSites.length === 0
      ? 'Every raw-table write site belongs to a service using the secured write boundary'
      : `Unsecured raw-table write sites: ${unsecuredSites.join(', ')}`);

  // The boundary helper itself must exist and be exported
  const writerPath = path.resolve(__dirname, '../dist/security/encryptedRecordWriter.js');
  assert(fs.existsSync(writerPath), 'backend/dist/security/encryptedRecordWriter.js compiled and exists');
  const { isRawEncryptionEnabled, encryptRawField, assertEncryptedRawWrite, decryptRawField, RAW_ENCRYPTION_ENV } = require(writerPath);

  // ------------------------------------------------------------------
  // Section 2: Boundary guard (AC2: plaintext writes rejected)
  // ------------------------------------------------------------------
  console.log('\n--- Section 2: Repository Boundary Guard (AC2) ---');

  const { encryptionService } = require(path.resolve(__dirname, '../dist/security/encryptionService.js'));

  delete process.env[RAW_ENCRYPTION_ENV];
  assert(isRawEncryptionEnabled() === false, 'Enforcement off by default (dual-mode rollout)');
  const legacyWrite = { rawValue: { plain: 'text' }, isEncrypted: false, encryptionKey: null };
  let legacyOk = true;
  try { assertEncryptedRawWrite('oracle_raw_users', legacyWrite); } catch (_) { legacyOk = false; }
  assert(legacyOk, 'Enforcement off: legacy plaintext write allowed at the boundary');

  process.env[RAW_ENCRYPTION_ENV] = 'true';

  let plaintextRejected = false;
  try { assertEncryptedRawWrite('oracle_raw_users', legacyWrite); } catch (_) { plaintextRejected = true; }
  assert(plaintextRejected, 'Enforcement on: plaintext write REJECTED at the boundary (AC2)');

  const enc = await encryptRawField('oracle_raw_users', { username: 'u1' }, { username: 'u1', marker: SENTINEL }, HOST);
  let encryptedAccepted = true;
  try { assertEncryptedRawWrite('oracle_raw_users', enc); } catch (_) { encryptedAccepted = false; }
  assert(encryptedAccepted && enc.isEncrypted && isEncryptedPayload(enc.rawValue), 'Enforcement on: genuine encrypted write accepted');

  // A degraded encryption provider returning plaintext must be rejected before SQL
  const origEncrypt = encryptionService.encryptPayload;
  encryptionService.encryptPayload = async () => ({ username: 'u1', marker: SENTINEL }); // fake plaintext "result"
  let degradedRejected = false;
  try { await encryptRawField('oracle_raw_users', { username: 'u1' }, { username: 'u1' }, HOST); } catch (_) { degradedRejected = true; }
  encryptionService.encryptPayload = origEncrypt;
  assert(degradedRejected, 'Degraded encryption provider returning plaintext is rejected before any SQL');

  // ------------------------------------------------------------------
  // Section 3: Certification tables now persist encrypted (the last gaps)
  // ------------------------------------------------------------------
  console.log('\n--- Section 3: Certification Tables Persist Encrypted ---');

  const { accessCertRawDbService } = require(path.resolve(__dirname, '../dist/services/accessCertRawDbService.js'));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const cert = {
    certificationId: 'VYR034_CERT_1',
    certificationName: `VYR034 Campaign ${SENTINEL}`,
    type: 'Standard',
    status: 'Active',
    certificationPercentComplete: 42,
    dueDate: '2026-04-01',
    ownerName: 'VYR034 Owner',
  };
  const worksheetRows = [
    { userName: 'VYR034.USER', roleName: `VYR034 Role ${SENTINEL}`, roleCode: 'VYR034_ROLE', certifierName: 'VYR034 Certifier', action: 'Pending', businessUnit: 'VYR034 BU' },
    { userName: 'VYR034.USER.B', roleName: `VYR034 Role B ${SENTINEL}`, roleCode: 'VYR034_ROLE_B', certifierName: 'VYR034 Certifier', action: 'Approved', businessUnit: 'VYR034 BU' },
  ];

  try {
    await cleanupHost(pool);
    deleteCacheFiles();

    await accessCertRawDbService.saveRawCertifications([cert]);
    await accessCertRawDbService.saveRawWorksheetRows('VYR034_CERT_1', worksheetRows);

    const certRow = await pool.query(
      `SELECT raw_data, is_encrypted, encryption_key_id, encrypted_at FROM oracle_raw_access_certifications
       WHERE environment_host = $1 AND certification_id = $2`,
      [HOST, cert.certificationId]
    );
    assert(certRow.rows.length === 1, 'saveRawCertifications persisted 1 row');
    const certRaw = typeof certRow.rows[0].raw_data === 'string' ? JSON.parse(certRow.rows[0].raw_data) : certRow.rows[0].raw_data;
    assert(certRow.rows[0].is_encrypted === true && isEncryptedPayload(certRaw), 'Certification row: encrypted container with tracking columns');
    assert(!JSON.stringify(certRaw).includes(SENTINEL), 'Certification row: no plaintext sentinel in the DB');

    const wsRows = await pool.query(
      `SELECT id, raw_data, is_encrypted, encryption_key_id FROM oracle_raw_certifier_worksheets
       WHERE environment_host = $1 AND certification_id = $2 ORDER BY id`,
      [HOST, 'VYR034_CERT_1']
    );
    assert(wsRows.rows.length === 2, 'saveRawWorksheetRows persisted 2 rows');
    const allWsEncrypted = wsRows.rows.every(r => {
      const v = typeof r.raw_data === 'string' ? JSON.parse(r.raw_data) : r.raw_data;
      return r.is_encrypted === true && isEncryptedPayload(v) && !JSON.stringify(v).includes(SENTINEL);
    });
    assert(allWsEncrypted, 'Worksheet rows: encrypted containers, no plaintext sentinel');

    // ------------------------------------------------------------------
    // Section 4: Round-trip decryption with the documented AAD convention
    // ------------------------------------------------------------------
    console.log('\n--- Section 4: Round-Trip Decryption ---');

    const decCert = await decryptRawField(
      'oracle_raw_access_certifications',
      { certification_id: cert.certificationId },
      certRaw,
      HOST
    );
    assert(JSON.stringify(decCert).includes(SENTINEL) && decCert.certificationId === cert.certificationId,
      'Certification row decrypts to the original BI Publisher payload');

    const wsFirst = wsRows.rows[0];
    const wsFirstRaw = typeof wsFirst.raw_data === 'string' ? JSON.parse(wsFirst.raw_data) : wsFirst.raw_data;
    const decWs = await decryptRawField(
      'oracle_raw_certifier_worksheets',
      { certification_id: 'VYR034_CERT_1', id: String(wsFirst.id) },
      wsFirstRaw,
      HOST
    );
    assert(JSON.stringify(decWs).includes(SENTINEL), 'Worksheet row decrypts with (certification_id, id) AAD convention');

    // ------------------------------------------------------------------
    // Section 5: Flag-off regression for the certification tables
    // ------------------------------------------------------------------
    console.log('\n--- Section 5: Flag-Off Regression ---');

    await cleanupHost(pool);
    delete process.env[RAW_ENCRYPTION_ENV];

    await accessCertRawDbService.saveRawCertifications([cert]);
    const offRow = await pool.query(
      `SELECT raw_data, is_encrypted FROM oracle_raw_access_certifications WHERE environment_host = $1 AND certification_id = $2`,
      [HOST, cert.certificationId]
    );
    const offRaw = typeof offRow.rows[0].raw_data === 'string' ? JSON.parse(offRow.rows[0].raw_data) : offRow.rows[0].raw_data;
    assert(offRow.rows[0].is_encrypted === false && JSON.stringify(offRaw).includes(SENTINEL),
      'Flag off: certification tables keep legacy plaintext writes (dual-mode)');

    // ------------------------------------------------------------------
    // Section 6: Code review checklist documentation (AC3)
    // ------------------------------------------------------------------
    console.log('\n--- Section 6: Code Review Checklist (AC3) ---');

    const docPath = path.resolve(__dirname, '../../docs/architecture/raw_data_write_boundary.md');
    assert(fs.existsSync(docPath), 'docs/architecture/raw_data_write_boundary.md exists');
    if (fs.existsSync(docPath)) {
      const doc = fs.readFileSync(docPath, 'utf8');
      assert(/encryptRawField/.test(doc) && /assertEncryptedRawWrite/.test(doc),
        'Checklist documents the secured write boundary functions');
      assert(/new ingestion path|new sync|new write/i.test(doc),
        'Checklist covers adding any new ingestion path');
    }

    await cleanupHost(pool);
    console.log('\n  [cleanup] Test tenant rows removed.');
  } finally {
    try { await cleanupHost(pool); } catch (_) {}
    delete process.env[RAW_ENCRYPTION_ENV];
    deleteCacheFiles();
    await pool.end().catch(() => {});
  }

  console.log('\n================================================================');
  console.log(`  RESULTS: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================\n');
  process.exit(failedTests > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
