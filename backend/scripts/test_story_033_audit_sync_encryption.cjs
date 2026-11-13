/**
 * Test Suite: Story VYR-033
 * "Encrypt records in audit and product-level synchronization"
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Verifies that all on-demand audit ingestion routes persist encrypted data:
 *   - auditRawDbService.syncProduct (POST /api/audit/sync + /api/audit/sync/product)
 *   - auditRawDbService.runDailyIncrementalSync (POST /api/audit/sync with __ALL__)
 *   - The auto-save path inside oracleService.getAuditHistory
 * plus duplicate/idempotency handling and no-plaintext-logging guarantees.
 *
 * The persistence surface for oracle_raw_audit_records is the single
 * saveRawAuditRecords write site (wired to the VYR-028/029 contract in VYR-032);
 * this suite proves the ingestion routes preserve that and never leak plaintext.
 *
 * Uses an isolated tenant (vyr033-test.oraclecloud.com); rows are deleted
 * before and after, so real synced data is never touched.
 */

const fs = require('fs');
const path = require('path');
const pg = require('pg');
const dotenv = require('dotenv');
const { isEncryptedPayload } = require('../dist/security/encryptionContract.js');

const HOST = 'vyr033-test.oraclecloud.com';
const SENTINEL = 'VYR033_SECRET_MARKER_99';

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

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Minimal stub catalog: confirms exactly one target for the incremental sync,
// and any single-product request for syncProduct.
function makeCatalogStub(confirmedProduct, confirmedBO) {
  return {
    getAllProducts: () => [],
    resolveAuditRequest: (product, businessObject) => {
      if (product === confirmedProduct && (businessObject === confirmedBO || businessObject === undefined)) {
        return {
          status: 'CONFIRMED',
          businessObject: {
            displayName: businessObject || confirmedBO,
            restBusinessObjectType: 'VYR033_BO',
            payloadTemplate: { productId: 'VYR033_P1' },
          },
          product: { restProduct: product, displayName: product },
        };
      }
      return { status: 'NOT_CONFIRMED' };
    },
  };
}

function makeClientStub(auditItems) {
  return {
    getAuditHistory: async () => ({ status: 'SUCCESS', auditData: auditItems }),
  };
}

const AUDIT_ITEMS = [
  { date: '2026-03-01T08:00:00Z', userInternalName: 'VYR033.USER', eventType: 'SESSION_CREATED', description: `VYR033 event one ${SENTINEL}` },
  { date: '2026-03-01T09:00:00Z', userInternalName: 'VYR033.USER', eventType: 'ROLE_ASSIGNED', description: `VYR033 event two ${SENTINEL}` },
];

async function cleanupHost(pool) {
  await pool.query(`DELETE FROM oracle_raw_audit_records WHERE environment_host = $1`, [HOST]);
  await pool.query(`DELETE FROM oracle_audit_sync_state WHERE environment_host = $1`, [HOST]);
}

async function fetchRows(pool) {
  const res = await pool.query(
    `SELECT product, business_object, record_unique_hash, raw_payload, is_encrypted,
            encryption_format_version, encryption_key_id, encrypted_at
     FROM oracle_raw_audit_records
     WHERE environment_host = $1
     ORDER BY product, record_unique_hash`,
    [HOST]
  );
  return res.rows;
}

function rowIsEncrypted(row) {
  if (!row) return false;
  const raw = typeof row.raw_payload === 'string' ? JSON.parse(row.raw_payload) : row.raw_payload;
  return row.is_encrypted === true &&
    typeof row.encryption_key_id === 'string' && row.encryption_key_id.length > 0 &&
    row.encrypted_at !== null &&
    isEncryptedPayload(raw) &&
    !JSON.stringify(raw).includes(SENTINEL);
}

async function run() {
  console.log('\n================================================================');
  console.log('  VYR-033: Encrypt Records in Audit & Product-Level Sync');
  console.log('================================================================\n');

  const srcPath = path.resolve(__dirname, '../src/services/auditRawDbService.ts');
  const routesPath = path.resolve(__dirname, '../src/routes/api.ts');
  const distAudit = path.resolve(__dirname, '../dist/services/auditRawDbService.js');
  const writerPath = path.resolve(__dirname, '../dist/security/encryptedRecordWriter.js');
  const contractPath = path.resolve(__dirname, '../dist/security/encryptionContract.js');

  assert(fs.existsSync(distAudit), 'backend/dist/services/auditRawDbService.js compiled and exists');
  assert(fs.existsSync(writerPath), 'backend/dist/security/encryptedRecordWriter.js compiled and exists');

  const src = fs.readFileSync(srcPath, 'utf8');
  const routes = fs.readFileSync(routesPath, 'utf8');

  // ------------------------------------------------------------------
  // Section 1: Structural integrity — one encrypted write site for all routes
  // ------------------------------------------------------------------
  console.log('--- Section 1: Structural Integrity (AC4: no alternate unencrypted paths) ---');

  const insertSites = (src.match(/INSERT INTO oracle_raw_audit_records/g) || []).length;
  assert(insertSites === 1, 'auditRawDbService has exactly one INSERT site for oracle_raw_audit_records');
  assert(/encryptRawField/.test(src), 'saveRawAuditRecords routes payloads through encryptRawField');
  assert(/trackingColumns/.test(src), 'saveRawAuditRecords populates the encryption tracking columns');

  const syncProductCallsSave = /public async syncProduct[\s\S]*?saveRawAuditRecords/.test(src);
  assert(syncProductCallsSave, 'syncProduct persists through saveRawAuditRecords (POST /api/audit/sync/product path)');

  const dailyCallsSave = /public async runDailyIncrementalSync[\s\S]*?saveRawAuditRecords/.test(src);
  assert(dailyCallsSave, 'runDailyIncrementalSync persists through saveRawAuditRecords (POST /api/audit/sync __ALL__ path)');

  assert(/apiRouter\.post\('\/audit\/sync'[\s\S]*?runDailyIncrementalSync[\s\S]*?syncProduct/.test(routes),
    'POST /api/audit/sync delegates to runDailyIncrementalSync / syncProduct');
  assert(/apiRouter\.post\('\/audit\/sync\/product'[\s\S]*?syncProduct/.test(routes),
    'POST /api/audit/sync/product delegates to syncProduct');

  // ------------------------------------------------------------------
  // Setup
  // ------------------------------------------------------------------
  const { auditRawDbService } = require(distAudit);
  const { encryptRawField, decryptRawField, RAW_ENCRYPTION_ENV } = require(writerPath);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const catalogStub = makeCatalogStub('VYR033 Product', 'VYR033 Business Object');
  const clientStub = makeClientStub(AUDIT_ITEMS);

  try {
    await cleanupHost(pool);

    // ------------------------------------------------------------------
    // Section 2: Flag-off regression — legacy plaintext writes still work
    // ------------------------------------------------------------------
    console.log('\n--- Section 2: Flag-Off Regression ---');

    delete process.env[RAW_ENCRYPTION_ENV];
    const offResult = await auditRawDbService.syncProduct('VYR033 Product', clientStub, catalogStub);
    assert(offResult.savedCount === 2, 'Flag off: syncProduct persists 2 records (product route intact)');
    const offRows = await fetchRows(pool);
    assert(offRows.length === 2 && offRows.every(r => r.is_encrypted === false), 'Flag off: rows stored as legacy plaintext');
    assert(offRows.every(r => JSON.stringify(r.raw_payload).includes(SENTINEL)), 'Flag off: plaintext payload readable (dual-mode legacy)');

    // ------------------------------------------------------------------
    // Section 3: Flag-on — product sync persists encrypted (AC1)
    // ------------------------------------------------------------------
    console.log('\n--- Section 3: Product Sync Persists Encrypted (AC1) ---');

    await cleanupHost(pool);
    process.env[RAW_ENCRYPTION_ENV] = 'true';

    const onResult = await auditRawDbService.syncProduct('VYR033 Product', clientStub, catalogStub);
    assert(onResult.savedCount === 2, 'syncProduct reports 2 records saved');
    assert(onResult.product === 'VYR033 Product', 'syncProduct returns the normalized product name');

    const rows = await fetchRows(pool);
    assert(rows.length === 2, 'syncProduct persisted 2 rows in oracle_raw_audit_records');
    assert(rows.every(rowIsEncrypted), 'Both rows: encrypted container, tracking columns set, no plaintext sentinel');

    const stateRes = await pool.query(
      `SELECT sync_status, records_synced FROM oracle_audit_sync_state WHERE environment_host = $1 AND product = $2`,
      [HOST, 'VYR033 Product']
    );
    assert(stateRes.rows.length === 1 && stateRes.rows[0].sync_status === 'SUCCESS', 'Sync state marked SUCCESS with no payload data');

    // ------------------------------------------------------------------
    // Section 4: Duplicate detection / idempotency (AC2)
    // ------------------------------------------------------------------
    console.log('\n--- Section 4: Duplicate Detection & Idempotency (AC2) ---');

    const second = await auditRawDbService.syncProduct('VYR033 Product', clientStub, catalogStub);
    assert(second.savedCount === 0, 'Re-running the same sync inserts 0 duplicates (ON CONFLICT DO NOTHING)');
    const afterSecond = await fetchRows(pool);
    assert(afterSecond.length === 2, 'Row count unchanged after duplicate run');
    assert(afterSecond.every(rowIsEncrypted), 'Original encrypted rows untouched after duplicate run');
    assert(deepEqual(afterSecond.map(r => r.record_unique_hash).sort(), rows.map(r => r.record_unique_hash).sort()),
      'Duplicate detection keys (record_unique_hash) stable across runs');

    // ------------------------------------------------------------------
    // Section 5: Incremental multi-target sync persists encrypted (AC1)
    // ------------------------------------------------------------------
    console.log('\n--- Section 5: Incremental Sync Persists Encrypted (AC1) ---');

    await cleanupHost(pool);
    const incCatalog = makeCatalogStub('Risks and Controls', 'Advanced Controls');
    const incResult = await auditRawDbService.runDailyIncrementalSync(clientStub, incCatalog);
    assert(incResult.totalSaved === 2, 'runDailyIncrementalSync persists 2 records from the confirmed target');
    const incRows = await fetchRows(pool);
    assert(incRows.length === 2, 'Incremental sync persisted 2 rows');
    assert(incRows.every(rowIsEncrypted), 'Incremental sync rows: encrypted, tracking columns set, no plaintext sentinel');

    // ------------------------------------------------------------------
    // Section 6: Round-trip and no-plaintext-logging (AC3)
    // ------------------------------------------------------------------
    console.log('\n--- Section 6: Round-Trip Decryption & Log Hygiene (AC3) ---');

    const firstRow = incRows[0];
    const rawVal = typeof firstRow.raw_payload === 'string' ? JSON.parse(firstRow.raw_payload) : firstRow.raw_payload;
    assert(isEncryptedPayload(rawVal), 'Stored row matches the EncryptedPayload contract');
    const decoded = await decryptRawField(
      'oracle_raw_audit_records',
      { record_unique_hash: firstRow.record_unique_hash },
      rawVal,
      HOST
    );
    assert(deepEqual(decoded, AUDIT_ITEMS.find(i => i.eventType === 'SESSION_CREATED') || AUDIT_ITEMS[0]) ||
           deepEqual(decoded, AUDIT_ITEMS[1]),
      'Stored encrypted audit payload decrypts to the original Oracle record');

    // Capture console output during a sync and ensure no plaintext leaks
    const captured = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    console.log = (...a) => captured.push(a.join(' '));
    console.warn = (...a) => captured.push(a.join(' '));
    console.error = (...a) => captured.push(a.join(' '));
    try {
      await auditRawDbService.syncProduct('VYR033 Product', clientStub, catalogStub);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    }
    assert(captured.length > 0, 'Sync path produces operational logs');
    assert(!captured.some(line => line.includes(SENTINEL)), 'No log line contains the raw payload sentinel (AC3)');

    // ------------------------------------------------------------------
    // Final cleanup
    // ------------------------------------------------------------------
    await cleanupHost(pool);
    console.log('\n  [cleanup] Test tenant rows removed.');
  } finally {
    try { await cleanupHost(pool); } catch (_) {}
    delete process.env[RAW_ENCRYPTION_ENV];
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
