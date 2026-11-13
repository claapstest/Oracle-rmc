/**
 * Test Suite: Story VYR-037
 * "Migrate existing plaintext Oracle records to encrypted storage"
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both
 *
 * Acceptance criteria covered:
 *   1. Migration is restartable and idempotent (checkpointed batches, resume, re-run no-op).
 *   2. Counts before/after reconcile; no records are silently lost.
 *   3. Plaintext is removed only after a successful, verified encrypted write.
 *   4. Rollback path exists (gated decrypt-back) and refuses unsafe use.
 * Plus: refuses to run while sync could still write plaintext, single-migrator lock,
 * IDs / dedup hashes / timestamps / metadata preserved, failures left untouched.
 *
 * Isolated tenant vyr037-mig-test.oraclecloud.com; rows deleted before and after.
 */

const path = require('path');
const pg = require('pg');
const dotenv = require('dotenv');

const HOST = 'vyr037-mig-test.oraclecloud.com';
const SENTINEL = 'VYR037_PLAINTEXT_SECRET_63';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/veyra_db';
}
delete process.env.VEYRA_RAW_ENCRYPTION;

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) { console.log(`  PASS: ${name}`); passed++; }
  else { console.error(`  FAIL: ${name}`); failed++; }
}
async function expectReject(fn, code, name) {
  try { await fn(); assert(false, `${name} (no error thrown)`); }
  catch (err) { assert(err.code === code, `${name}${err.code !== code ? ` (got ${err.code}: ${err.message})` : ''}`); }
}
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

const TABLES = ['oracle_raw_users', 'oracle_raw_audit_records', 'oracle_raw_user_access'];

async function ensureTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS oracle_raw_users (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      username VARCHAR(150) NOT NULL, display_name VARCHAR(255), email VARCHAR(255),
      is_active BOOLEAN DEFAULT true, user_category VARCHAR(100), business_unit VARCHAR(255),
      raw_user JSONB NOT NULL,
      is_encrypted BOOLEAN DEFAULT false, encryption_format_version SMALLINT,
      encryption_key_id VARCHAR(100), encrypted_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_raw_user UNIQUE(environment_host, username)
    );
    CREATE TABLE IF NOT EXISTS oracle_raw_audit_records (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      product VARCHAR(100), business_object VARCHAR(255), record_unique_hash VARCHAR(255),
      event_timestamp TIMESTAMPTZ, username VARCHAR(255), event_type VARCHAR(100),
      raw_payload JSONB NOT NULL,
      is_encrypted BOOLEAN DEFAULT false, encryption_format_version SMALLINT,
      encryption_key_id VARCHAR(100), encrypted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS oracle_raw_user_access (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      username VARCHAR(150), display_name VARCHAR(255), email VARCHAR(255), active BOOLEAN,
      role_name VARCHAR(255), role_code VARCHAR(255), raw_payload JSONB,
      is_encrypted BOOLEAN DEFAULT false, encryption_format_version SMALLINT,
      encryption_key_id VARCHAR(100), encrypted_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS oracle_encryption_migration_ledger (
      id SERIAL PRIMARY KEY, table_name VARCHAR(128) NOT NULL, environment_host VARCHAR(255) NOT NULL,
      total_records INT NOT NULL DEFAULT 0, encrypted_records INT NOT NULL DEFAULT 0,
      plaintext_records INT NOT NULL DEFAULT 0, last_migrated_id TEXT DEFAULT NULL,
      batch_size INT NOT NULL DEFAULT 100, status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
      last_error TEXT DEFAULT NULL, started_at TIMESTAMPTZ DEFAULT NULL, completed_at TIMESTAMPTZ DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_enc_migration_ledger UNIQUE (table_name, environment_host)
    );
  `);
}

async function cleanup(client) {
  for (const t of TABLES) await client.query(`DELETE FROM ${t} WHERE environment_host = $1`, [HOST]).catch(() => {});
  await client.query(`DELETE FROM oracle_encryption_migration_ledger WHERE environment_host = $1`, [HOST]).catch(() => {});
}

async function seed(client, writer) {
  const originals = new Map();
  for (let i = 1; i <= 7; i++) {
    const raw = { username: `MIG_USER_${i}`, ssn: `${SENTINEL}-${i}`, nested: { roles: ['A', 'B'], n: i }, unicode: 'Zürich ✓' };
    originals.set(`MIG_USER_${i}`, raw);
    await client.query(
      `INSERT INTO oracle_raw_users (environment_host, username, display_name, raw_user, last_synced_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'2026-02-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-15T00:00:00Z')`,
      [HOST, `MIG_USER_${i}`, `Mig User ${i}`, JSON.stringify(raw)]
    );
  }
  // One user already encrypted by a sync that ran with encryption on.
  process.env.VEYRA_RAW_ENCRYPTION = 'true';
  const encRec = { environment_host: HOST, username: 'MIG_ALREADY_ENC' };
  const w = await writer.encryptRawField('oracle_raw_users', encRec, { username: 'MIG_ALREADY_ENC', note: 'already' }, HOST);
  await client.query(
    `INSERT INTO oracle_raw_users (environment_host, username, raw_user, is_encrypted, encryption_format_version, encryption_key_id, encrypted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [HOST, 'MIG_ALREADY_ENC', JSON.stringify(w.rawValue), ...writer.trackingColumns(w)]
  );
  delete process.env.VEYRA_RAW_ENCRYPTION;

  for (let i = 1; i <= 3; i++) {
    const raw = { eventId: `EV${i}`, userName: 'AUDITOR', detail: `${SENTINEL}-audit-${i}` };
    originals.set(`AUDIT_HASH_${i}`, raw);
    await client.query(
      `INSERT INTO oracle_raw_audit_records (environment_host, product, business_object, record_unique_hash, event_timestamp, username, raw_payload)
       VALUES ($1,'HCM','Worker',$2,'2026-03-0${i}T10:00:00Z','AUDITOR',$3)`,
      [HOST, `AUDIT_HASH_${i}`, JSON.stringify(raw)]
    );
  }

  originals.set('ACCESS_1', { username: 'ACC_USER', roleCode: 'R1', salary: `${SENTINEL}-access` });
  await client.query(
    `INSERT INTO oracle_raw_user_access (environment_host, username, role_code, raw_payload) VALUES ($1,'ACC_USER','R1',$2),($1,'ACC_EMPTY','R2',NULL)`,
    [HOST, JSON.stringify(originals.get('ACCESS_1'))]
  );
  return originals;
}

async function run() {
  console.log('\n=== VYR-037: Migrate existing plaintext Oracle records to encrypted storage ===\n');
  const writer = require('../dist/security/encryptedRecordWriter.js');
  const { decryptRawRows } = require('../dist/security/decryptedRecordReader.js');
  const mig = require('../dist/security/plaintextMigrationService.js');

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await ensureTables(client);
    await cleanup(client);
    const originals = await seed(client, writer);
    const usersBefore = (await client.query(`SELECT id, username, display_name, created_at, updated_at, last_synced_at, raw_user FROM oracle_raw_users WHERE environment_host=$1 ORDER BY id`, [HOST])).rows;
    const alreadyEncBefore = usersBefore.find(r => r.username === 'MIG_ALREADY_ENC').raw_user;

    console.log('--- Preconditions ---');
    await expectReject(() => mig.migrateTable(pool, 'oracle_raw_users', { environmentHost: HOST }), 'ENCRYPTION_NOT_ENABLED',
      'Refuses to migrate while VEYRA_RAW_ENCRYPTION is off (sync could still write plaintext)');
    await expectReject(() => mig.migrateTable(pool, 'oracle_raw_users', {}), 'INVALID_INPUT', 'Requires an environment host');
    await expectReject(() => mig.migrateTable(pool, 'not_a_raw_table', { environmentHost: HOST }), 'INVALID_INPUT', 'Rejects unregistered tables');

    console.log('\n--- Dry run ---');
    const dry = await mig.migrateAll(pool, { environmentHost: HOST, dryRun: true });
    const dryUsers = dry.tables.find(t => t.tableName === 'oracle_raw_users');
    assert(dryUsers.before.total === 8 && dryUsers.before.plaintext === 7 && dryUsers.candidates === 7, 'Dry run reports 8 total / 7 plaintext candidates for users');
    assert(dry.totals.candidates === 11, `Dry run totals 11 candidates across tables (got ${dry.totals.candidates})`);
    assert(dry.tables.find(t => t.tableName === 'oracle_raw_user_access').emptyPayloads === 1, 'Dry run counts NULL payload rows separately');
    const plainCount = (await client.query(`SELECT COUNT(*)::int c FROM oracle_raw_users WHERE environment_host=$1 AND is_encrypted=false`, [HOST])).rows[0].c;
    const ledgerRows = (await client.query(`SELECT COUNT(*)::int c FROM oracle_encryption_migration_ledger WHERE environment_host=$1`, [HOST])).rows[0].c;
    assert(plainCount === 7 && ledgerRows === 0, 'Dry run changes no rows and writes no ledger entry');

    process.env.VEYRA_RAW_ENCRYPTION = 'true';

    console.log('\n--- Single-migrator lock ---');
    const lockClient = await pool.connect();
    await lockClient.query('SELECT pg_advisory_lock($1)', [mig.migrationLockKey('oracle_raw_users', HOST)]);
    await expectReject(() => mig.migrateTable(pool, 'oracle_raw_users', { environmentHost: HOST }), 'MIGRATION_LOCKED', 'Second migrator is refused while lock is held');
    await lockClient.query('SELECT pg_advisory_unlock($1)', [mig.migrationLockKey('oracle_raw_users', HOST)]);
    lockClient.release();

    console.log('\n--- Checkpointed partial run, then resume ---');
    const part = await mig.migrateTable(pool, 'oracle_raw_users', { environmentHost: HOST, batchSize: 3, maxBatches: 1 });
    assert(part.migrated === 3 && part.complete === false, 'Partial run migrates one batch and reports incomplete');
    let ledger = (await client.query(`SELECT * FROM oracle_encryption_migration_ledger WHERE environment_host=$1 AND table_name='oracle_raw_users'`, [HOST])).rows[0];
    assert(ledger && ledger.status === 'IN_PROGRESS' && ledger.last_migrated_id, 'Ledger checkpoint recorded (IN_PROGRESS + last_migrated_id)');
    assert(ledger.plaintext_records === 4 && ledger.encrypted_records === 4, 'Ledger counts updated mid-run');

    const rest = await mig.migrateTable(pool, 'oracle_raw_users', { environmentHost: HOST, batchSize: 3 });
    assert(rest.resumedFromCheckpoint === true, 'Second run resumes from checkpoint');
    assert(rest.migrated === 4 && rest.complete === true && rest.failed === 0, 'Resumed run migrates the remaining 4');
    ledger = (await client.query(`SELECT * FROM oracle_encryption_migration_ledger WHERE environment_host=$1 AND table_name='oracle_raw_users'`, [HOST])).rows[0];
    assert(ledger.status === 'COMPLETED' && ledger.last_migrated_id === null && ledger.completed_at, 'Ledger COMPLETED and checkpoint cleared');
    assert(rest.reconciliation.reconciled === true && rest.reconciliation.lost === 0, 'Reconciliation passes with 0 lost records');
    assert(rest.after.total === 8 && rest.after.plaintext === 0 && rest.after.encrypted === 8, 'After counts: 8 total, 0 plaintext, 8 encrypted');

    console.log('\n--- Encrypted at rest, preserved and readable ---');
    const usersAfter = (await client.query(`SELECT * FROM oracle_raw_users WHERE environment_host=$1 ORDER BY id`, [HOST])).rows;
    assert(usersAfter.every(r => r.is_encrypted && r.encryption_key_id && r.encryption_format_version === 1 && r.encrypted_at), 'All rows flagged encrypted with key ID, format version, encrypted_at');
    const rawText = (await client.query(`SELECT string_agg(raw_user::text, '') t FROM oracle_raw_users WHERE environment_host=$1`, [HOST])).rows[0].t;
    assert(!rawText.includes(SENTINEL) && !rawText.includes('Zürich'), 'No plaintext sentinel left in the database');
    assert(usersAfter.every((r, i) => r.id === usersBefore[i].id && r.username === usersBefore[i].username && r.display_name === usersBefore[i].display_name
      && +r.created_at === +usersBefore[i].created_at && +r.updated_at === +usersBefore[i].updated_at && +r.last_synced_at === +usersBefore[i].last_synced_at),
      'IDs, metadata and created/updated/last_synced timestamps preserved');
    assert(stable(usersAfter.find(r => r.username === 'MIG_ALREADY_ENC').raw_user) === stable(alreadyEncBefore), 'Already-encrypted row left untouched');
    const decrypted = await decryptRawRows('oracle_raw_users', 'raw_user', usersAfter, HOST);
    assert(decrypted.filter(r => r.username.startsWith('MIG_USER_')).every(r => stable(r.raw_user) === stable(originals.get(r.username))),
      'Read path decrypts every migrated row back to the exact original payload');

    const again = await mig.migrateTable(pool, 'oracle_raw_users', { environmentHost: HOST });
    assert(again.candidates === 0 && again.migrated === 0 && again.complete === true, 'Re-running is a no-op (idempotent)');

    console.log('\n--- All tables, dedup hashes and NULL payloads ---');
    const auditBefore = (await client.query(`SELECT id, record_unique_hash, event_timestamp FROM oracle_raw_audit_records WHERE environment_host=$1 ORDER BY id`, [HOST])).rows;
    const all = await mig.migrateAll(pool, { environmentHost: HOST });
    assert(all.totals.migrated === 4 && all.totals.failed === 0 && all.reconciled === true, `migrateAll migrates remaining 4 rows (got ${all.totals.migrated}) and reconciles`);
    const auditAfter = (await client.query(`SELECT * FROM oracle_raw_audit_records WHERE environment_host=$1 ORDER BY id`, [HOST])).rows;
    assert(auditAfter.every((r, i) => r.id === auditBefore[i].id && r.record_unique_hash === auditBefore[i].record_unique_hash && +r.event_timestamp === +auditBefore[i].event_timestamp && r.is_encrypted),
      'Audit dedup hashes, IDs and event timestamps preserved');
    const auditDec = await decryptRawRows('oracle_raw_audit_records', 'raw_payload', auditAfter, HOST);
    assert(auditDec.every(r => stable(r.raw_payload) === stable(originals.get(r.record_unique_hash))), 'Audit rows decrypt to originals');
    const empty = (await client.query(`SELECT is_encrypted, raw_payload FROM oracle_raw_user_access WHERE environment_host=$1 AND username='ACC_EMPTY'`, [HOST])).rows[0];
    assert(empty.is_encrypted === false && empty.raw_payload === null, 'NULL payload row left as-is (nothing to encrypt)');
    assert(all.tables.length === 10 && all.tables.every(t => t.tableSkippedReason || t.complete), 'Every registered raw table is either migrated or explicitly skipped');

    console.log('\n--- Failure leaves plaintext in place ---');
    await client.query(`INSERT INTO oracle_raw_users (environment_host, username, raw_user) VALUES ($1, 'MIG_FLAG_MISMATCH', $2)`, [HOST, JSON.stringify(alreadyEncBefore)]);
    const bad = await mig.migrateTable(pool, 'oracle_raw_users', { environmentHost: HOST });
    assert(bad.failed === 1 && bad.migrated === 0 && bad.failures[0].code === 'FLAG_MISMATCH', 'Row flagged plaintext but holding ciphertext is not double-encrypted (FLAG_MISMATCH)');
    assert(bad.failures[0] && !bad.failures[0].error.includes(SENTINEL), 'Failure report contains no payload content');
    const badRow = (await client.query(`SELECT is_encrypted, raw_user FROM oracle_raw_users WHERE environment_host=$1 AND username='MIG_FLAG_MISMATCH'`, [HOST])).rows[0];
    assert(badRow.is_encrypted === false && stable(badRow.raw_user) === stable(alreadyEncBefore), 'Failed row is not modified or lost');
    ledger = (await client.query(`SELECT status, last_error FROM oracle_encryption_migration_ledger WHERE environment_host=$1 AND table_name='oracle_raw_users'`, [HOST])).rows[0];
    assert(ledger.status === 'FAILED' && ledger.last_error && !ledger.last_error.includes(SENTINEL), 'Ledger marked FAILED with sanitized error');
    assert(bad.reconciliation.reconciled === true, 'Reconciliation still holds (failed row accounted for, nothing lost)');
    await client.query(`DELETE FROM oracle_raw_users WHERE environment_host=$1 AND username='MIG_FLAG_MISMATCH'`, [HOST]);

    console.log('\n--- Rollback (decrypt back to plaintext) ---');
    await expectReject(() => mig.rollbackTable(pool, 'oracle_raw_users', { environmentHost: HOST, confirm: mig.ROLLBACK_CONFIRMATION }), 'ENCRYPTION_STILL_ENABLED',
      'Rollback refused while encryption is enabled');
    delete process.env.VEYRA_RAW_ENCRYPTION;
    await expectReject(() => mig.rollbackTable(pool, 'oracle_raw_users', { environmentHost: HOST }), 'CONFIRMATION_REQUIRED', 'Rollback refused without explicit confirmation');
    const rb = await mig.rollbackTable(pool, 'oracle_raw_users', { environmentHost: HOST, confirm: mig.ROLLBACK_CONFIRMATION });
    assert(rb.restored === 8 && rb.failed === 0, `Rollback restores 8 rows (got ${rb.restored})`);
    const rolled = (await client.query(`SELECT * FROM oracle_raw_users WHERE environment_host=$1 ORDER BY id`, [HOST])).rows;
    assert(rolled.every(r => r.is_encrypted === false && r.encryption_key_id === null && r.encrypted_at === null), 'Rolled-back rows have tracking columns cleared');
    assert(rolled.filter(r => r.username.startsWith('MIG_USER_')).every(r => stable(r.raw_user) === stable(originals.get(r.username))), 'Rolled-back payloads equal the originals');
    ledger = (await client.query(`SELECT status FROM oracle_encryption_migration_ledger WHERE environment_host=$1 AND table_name='oracle_raw_users'`, [HOST])).rows[0];
    assert(ledger.status === 'ROLLED_BACK', 'Ledger records ROLLED_BACK');
  } finally {
    delete process.env.VEYRA_RAW_ENCRYPTION;
    await cleanup(client);
    client.release();
    await pool.end();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
