/**
 * Test Suite: Story VYR-036
 * "Implement key rotation and encrypted-record version compatibility"
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both
 *
 * Acceptance criteria covered:
 *   1. Rotation is tested with existing records (DB rewrap job on real raw tables).
 *   2. Old records remain decryptable during the approved transition (RETIRING keys).
 *   3. Retired keys are not removed while records still depend on them.
 * Plus: key ID / format version per record, unsupported versions fail closed,
 * restartable + idempotent rewrap, emergency key-compromise flow, no key material
 * in lifecycle events.
 *
 * Uses isolated tenant vyr036-rot-test.oraclecloud.com and test-only key IDs
 * (vyr036-k*) so real synced data and production key IDs are never touched.
 */

const path = require('path');
const pg = require('pg');
const dotenv = require('dotenv');

const HOST = 'vyr036-rot-test.oraclecloud.com';
const SENTINEL = 'VYR036_ROTATION_SECRET_41';
const K1 = 'vyr036-k1';
const K2 = 'vyr036-k2';
const K3 = 'vyr036-k3';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/veyra_db';
}

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) { console.log(`  PASS: ${name}`); passed++; }
  else { console.error(`  FAIL: ${name}`); failed++; }
}
async function expectReject(fn, code, name) {
  try { await fn(); assert(false, `${name} (no error thrown)`); }
  catch (err) { assert(!code || err.code === code, `${name}${err.code !== code ? ` (got ${err.code}: ${err.message})` : ''}`); }
}

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
    CREATE TABLE IF NOT EXISTS oracle_raw_roles (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      role_code VARCHAR(255) NOT NULL, role_name VARCHAR(255), category VARCHAR(100),
      is_custom BOOLEAN DEFAULT false, member_count INT DEFAULT 0, raw_role JSONB NOT NULL,
      is_encrypted BOOLEAN DEFAULT false, encryption_format_version SMALLINT,
      encryption_key_id VARCHAR(100), encrypted_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_raw_role UNIQUE(environment_host, role_code)
    );
  `);
}

async function cleanup(client) {
  for (const t of ['oracle_raw_users', 'oracle_raw_roles']) {
    await client.query(`DELETE FROM ${t} WHERE environment_host = $1`, [HOST]).catch(() => {});
  }
}

function newRegistry(mod) {
  const { KeyLifecycleRegistry, LocalKeyProvider, EncryptionService } = mod;
  const registry = new KeyLifecycleRegistry(new LocalKeyProvider(K1, 'vyr036-secret-k1'));
  return { registry, service: new EncryptionService(registry) };
}

async function unitTests(mod, contract) {
  const { EncryptionError } = mod;
  console.log('--- Key lifecycle registry ---');
  const { registry, service } = newRegistry(mod);
  const aad = 'tenant=t|table=oracle_raw_users|id=u1|v=1';

  assert(registry.getActiveKeyId() === K1, 'Initial provider key is ACTIVE');
  assert(registry.getStatus(K1) === 'ACTIVE', 'getStatus reports ACTIVE');

  const p1 = await service.encryptPayload({ secret: SENTINEL }, aad);
  assert(p1.keyId === K1 && p1.formatVersion === contract.CURRENT_ENCRYPTION_FORMAT_VERSION, 'Payload records key ID and format version');

  registry.addKey(K2, 'vyr036-secret-k2');
  assert(registry.getStatus(K2) === 'PENDING', 'Newly added key starts PENDING');
  await expectReject(() => service.encryptPayload({ x: 1 }, aad, { keyId: K2 }), 'KEY_NOT_APPROVED', 'PENDING key cannot wrap');

  registry.activate(K2);
  assert(registry.getActiveKeyId() === K2, 'activate() switches active key');
  assert(registry.getStatus(K1) === 'RETIRING', 'Previous active key becomes RETIRING');

  const p2 = await service.encryptPayload({ secret: SENTINEL }, aad);
  assert(p2.keyId === K2, 'New writes use the new active key');

  const d1 = await service.decryptPayload(p1, aad);
  assert(d1.secret === SENTINEL, 'Old record (RETIRING key) remains decryptable');
  await expectReject(() => service.encryptPayload({ x: 1 }, aad, { keyId: K1 }), 'KEY_NOT_APPROVED', 'RETIRING key cannot wrap new data');

  console.log('\n--- DEK rewrap ---');
  const r1 = await service.rewrapPayloadDek(p1);
  assert(r1.keyId === K2, 'Rewrap moves payload to active key');
  assert(r1.ciphertext === p1.ciphertext && r1.nonce === p1.nonce && r1.authTag === p1.authTag && r1.aad === p1.aad,
    'Rewrap preserves ciphertext, nonce, authTag and AAD');
  assert(r1.createdAt === p1.createdAt, 'Rewrap preserves original encryption timestamp');
  assert(r1.encryptedDek !== p1.encryptedDek, 'Rewrap replaces the wrapped DEK');
  assert((await service.decryptPayload(r1, aad)).secret === SENTINEL, 'Rewrapped payload decrypts');

  console.log('\n--- Version compatibility ---');
  await expectReject(() => service.decryptPayload({ ...p2, formatVersion: 99 }, aad), 'UNSUPPORTED_FORMAT_VERSION', 'Unsupported format version fails closed');
  assert(contract.SUPPORTED_ENCRYPTION_FORMAT_VERSIONS.includes(1), 'Format version 1 is supported');
  await expectReject(() => service.decryptPayload({ ...p2, keyId: 'unknown-key' }, aad), 'KEY_NOT_APPROVED', 'Unknown key ID fails closed');

  console.log('\n--- Retirement guard ---');
  expectSync(() => registry.retire(K2, 0), 'KEY_IN_USE', 'Active key cannot be retired', EncryptionError);
  expectSync(() => registry.retire(K1, 3), 'KEY_IN_USE', 'Key with dependent records cannot be retired', EncryptionError);
  registry.retire(K1, 0);
  assert(registry.getStatus(K1) === 'RETIRED', 'Key with zero dependents is retired');
  await expectReject(() => service.decryptPayload(p1, aad), 'KEY_NOT_APPROVED', 'RETIRED key can no longer decrypt');

  console.log('\n--- Emergency compromise ---');
  registry.addKey(K3, 'vyr036-secret-k3');
  registry.markCompromised(K2, K3);
  assert(registry.getStatus(K2) === 'COMPROMISED', 'Key marked COMPROMISED');
  assert(registry.getActiveKeyId() === K3, 'Replacement key becomes ACTIVE');
  await expectReject(() => service.encryptPayload({ x: 1 }, aad, { keyId: K2 }), 'KEY_NOT_APPROVED', 'COMPROMISED key cannot wrap');
  assert((await service.decryptPayload(p2, aad)).secret === SENTINEL, 'COMPROMISED key can still unwrap so data can be moved off it');
  expectSync(() => registry.markCompromised(K3), 'INVALID_INPUT', 'Compromising the active key requires a replacement', EncryptionError);

  console.log('\n--- No key material exposed ---');
  const dump = JSON.stringify({ keys: registry.listKeys(), events: registry.getEvents() });
  assert(!dump.includes('vyr036-secret'), 'listKeys/getEvents contain no secrets');
  assert(registry.getEvents().some(e => e.action === 'ACTIVATED' && e.keyId === K2), 'Lifecycle events are recorded');

  console.log('\n--- Configuration from environment ---');
  const { KeyLifecycleRegistry, LocalKeyProvider } = mod;
  process.env.VYR036_TEST_K1 = 'env-secret-1';
  process.env.VYR036_TEST_K2 = 'env-secret-2';
  const envReg = KeyLifecycleRegistry.fromEnv(new LocalKeyProvider('bootstrap-key', 'bootstrap'), JSON.stringify([
    { keyId: 'env-k1', secretEnv: 'VYR036_TEST_K1', status: 'RETIRING' },
    { keyId: 'env-k2', secretEnv: 'VYR036_TEST_K2', status: 'ACTIVE' },
  ]));
  assert(envReg.getActiveKeyId() === 'env-k2', 'VEYRA_KEY_RING ACTIVE entry becomes active key');
  assert(envReg.getStatus('env-k1') === 'RETIRING', 'VEYRA_KEY_RING RETIRING entry loaded');
  expectSync(() => KeyLifecycleRegistry.fromEnv(new LocalKeyProvider('b', 'b'), JSON.stringify([
    { keyId: 'a', secretEnv: 'VYR036_TEST_K1', status: 'ACTIVE' },
    { keyId: 'b2', secretEnv: 'VYR036_TEST_K2', status: 'ACTIVE' },
  ])), 'INVALID_KEY', 'Two ACTIVE keys rejected', EncryptionError);
  expectSync(() => KeyLifecycleRegistry.fromEnv(new LocalKeyProvider('b', 'b'), JSON.stringify([
    { keyId: 'a', secretEnv: 'VYR036_MISSING_ENV', status: 'ACTIVE' },
  ])), 'KEY_NOT_FOUND', 'Missing secret env var rejected', EncryptionError);
  const defReg = KeyLifecycleRegistry.fromEnv(new LocalKeyProvider('default-k', 'x'), '');
  assert(defReg.getActiveKeyId() === 'default-k' && defReg.getStatus('default-k') === 'ACTIVE', 'No VEYRA_KEY_RING keeps provider default key ACTIVE');
}

function expectSync(fn, code, name) {
  try { fn(); assert(false, `${name} (no error thrown)`); }
  catch (err) { assert(err.code === code, `${name}${err.code !== code ? ` (got ${err.code}: ${err.message})` : ''}`); }
}

async function dbTests(mod, rotation, pool) {
  const client = await pool.connect();
  try {
    await ensureTables(client);
    await cleanup(client);

    const { registry, service } = newRegistry(mod);
    const { buildTableRecordAad } = require('../dist/security/encryptionContract.js');

    console.log('\n--- Seed existing encrypted records under K1 ---');
    const users = [];
    for (let i = 1; i <= 5; i++) {
      const rec = { environment_host: HOST, username: `ROT_USER_${i}` };
      const payload = await service.encryptPayload({ username: rec.username, ssn: `${SENTINEL}-${i}` }, buildTableRecordAad('oracle_raw_users', rec, HOST));
      const res = await client.query(
        `INSERT INTO oracle_raw_users (environment_host, username, display_name, raw_user, is_encrypted, encryption_format_version, encryption_key_id, encrypted_at)
         VALUES ($1,$2,$3,$4,true,1,$5,'2026-01-01T00:00:00Z') RETURNING id`,
        [HOST, rec.username, `User ${i}`, JSON.stringify(payload), payload.keyId]
      );
      users.push({ id: res.rows[0].id, rec });
    }
    const roleRec = { environment_host: HOST, role_code: 'ROT_ROLE_1' };
    const rolePayload = await service.encryptPayload({ roleCode: 'ROT_ROLE_1', note: SENTINEL }, buildTableRecordAad('oracle_raw_roles', roleRec, HOST));
    await client.query(
      `INSERT INTO oracle_raw_roles (environment_host, role_code, role_name, raw_role, is_encrypted, encryption_format_version, encryption_key_id, encrypted_at)
       VALUES ($1,$2,'Rotation Role',$3,true,1,$4,NOW())`,
      [HOST, roleRec.role_code, JSON.stringify(rolePayload), rolePayload.keyId]
    );
    // A legacy plaintext row must be ignored by rotation.
    await client.query(
      `INSERT INTO oracle_raw_roles (environment_host, role_code, role_name, raw_role, is_encrypted) VALUES ($1,'ROT_PLAIN','Plain','{"plain":true}',false)`,
      [HOST]
    );

    const usage = await rotation.getKeyUsage(pool, HOST);
    const k1Users = usage.find(u => u.tableName === 'oracle_raw_users' && u.keyId === K1);
    assert(k1Users && k1Users.records === 5 && k1Users.formatVersion === 1, 'Key usage inventory reports key ID + format version per table');

    registry.addKey(K2, 'vyr036-secret-k2');
    registry.activate(K2);

    await expectReject(() => rotation.retireKey(pool, K1, { registry }), 'KEY_IN_USE', 'retireKey refused while records depend on K1');
    assert(registry.getStatus(K1) === 'RETIRING', 'K1 stays RETIRING after refused retirement');

    console.log('\n--- Dry run ---');
    const dry = await rotation.rewrapAll(pool, { service, toKeyId: K2, environmentHost: HOST, dryRun: true });
    assert(dry.totals.candidates === 6, `Dry run counts 6 candidates (got ${dry.totals.candidates})`);
    const stillK1 = await client.query(`SELECT COUNT(*)::int c FROM oracle_raw_users WHERE environment_host=$1 AND encryption_key_id=$2`, [HOST, K1]);
    assert(stillK1.rows[0].c === 5, 'Dry run changes nothing');

    console.log('\n--- Partial run then resume (restartable) ---');
    const before = (await client.query(`SELECT id, username, display_name, encrypted_at, raw_user FROM oracle_raw_users WHERE environment_host=$1 ORDER BY id`, [HOST])).rows;
    const partial = await rotation.rewrapTable(pool, 'oracle_raw_users', { service, toKeyId: K2, environmentHost: HOST, batchSize: 2, maxBatches: 1 });
    assert(partial.rewrapped === 2 && partial.complete === false, 'Partial run rewraps one batch and reports incomplete');
    const resumed = await rotation.rewrapTable(pool, 'oracle_raw_users', { service, toKeyId: K2, environmentHost: HOST, batchSize: 2 });
    assert(resumed.rewrapped === 3 && resumed.complete === true, 'Resumed run finishes remaining records');

    const after = (await client.query(`SELECT id, username, display_name, encrypted_at, raw_user, encryption_key_id FROM oracle_raw_users WHERE environment_host=$1 ORDER BY id`, [HOST])).rows;
    assert(after.every(r => r.encryption_key_id === K2 && r.raw_user.keyId === K2), 'All user rows now on K2 (column + payload agree)');
    assert(after.every((r, i) => r.id === before[i].id && r.username === before[i].username && r.display_name === before[i].display_name
      && new Date(r.encrypted_at).getTime() === new Date(before[i].encrypted_at).getTime()),
      'Record IDs, metadata and encrypted_at preserved');
    assert(after.every((r, i) => r.raw_user.ciphertext === before[i].raw_user.ciphertext), 'Ciphertext untouched by rewrap');
    let allDecrypt = true;
    for (const r of after) {
      const plain = await service.decryptEntityRecord('oracle_raw_users', { environment_host: HOST, username: r.username }, r.raw_user, HOST);
      if (!plain || !String(plain.ssn).startsWith(SENTINEL)) allDecrypt = false;
    }
    assert(allDecrypt, 'Rotated rows decrypt with their record AAD');
    assert(!JSON.stringify(after.map(r => r.raw_user)).includes(SENTINEL), 'No plaintext sentinel in rotated rows');

    console.log('\n--- Idempotency and corrupted rows ---');
    const again = await rotation.rewrapTable(pool, 'oracle_raw_users', { service, toKeyId: K2, environmentHost: HOST });
    assert(again.candidates === 0 && again.rewrapped === 0, 'Re-running is a no-op');

    const corrupted = { ...rolePayload, encryptedDek: Buffer.alloc(60, 7).toString('base64') };
    await client.query(`UPDATE oracle_raw_roles SET raw_role=$1 WHERE environment_host=$2 AND role_code='ROT_ROLE_1'`, [JSON.stringify(corrupted), HOST]);
    const roles = await rotation.rewrapTable(pool, 'oracle_raw_roles', { service, toKeyId: K2, environmentHost: HOST });
    assert(roles.failed === 1 && roles.rewrapped === 0, 'Corrupted row is counted as failed, not rewritten');
    assert(roles.failures[0] && !/[A-Za-z0-9+/=]{40,}/.test(roles.failures[0].error), 'Failure report contains no key/ciphertext material');
    const roleRow = (await client.query(`SELECT encryption_key_id, raw_role FROM oracle_raw_roles WHERE environment_host=$1 AND role_code='ROT_ROLE_1'`, [HOST])).rows[0];
    assert(roleRow.encryption_key_id === K1 && roleRow.raw_role.encryptedDek === corrupted.encryptedDek, 'Failed row left unchanged');
    const plainRow = (await client.query(`SELECT is_encrypted, raw_role FROM oracle_raw_roles WHERE environment_host=$1 AND role_code='ROT_PLAIN'`, [HOST])).rows[0];
    assert(plainRow.is_encrypted === false && plainRow.raw_role.plain === true, 'Legacy plaintext row ignored by rotation');

    await expectReject(() => rotation.retireKey(pool, K1, { registry }), 'KEY_IN_USE', 'K1 retirement still refused (corrupted row depends on it)');
    await client.query(`DELETE FROM oracle_raw_roles WHERE environment_host=$1 AND role_code='ROT_ROLE_1'`, [HOST]);
    const retired = await rotation.retireKey(pool, K1, { registry });
    assert(retired.dependentRecords === 0 && registry.getStatus(K1) === 'RETIRED', 'K1 retired once no records depend on it');

    console.log('\n--- Emergency compromise rotation ---');
    const report = await rotation.emergencyRotate(pool, { registry, service, compromisedKeyId: K2, replacementKeyId: K3, replacementSecret: 'vyr036-secret-k3', environmentHost: HOST });
    assert(registry.getStatus(K2) === 'COMPROMISED' && registry.getActiveKeyId() === K3, 'Compromised key blocked, replacement active');
    assert(report.totals.rewrapped === 5 && report.totals.failed === 0, `Emergency rewrap moved 5 records (got ${report.totals.rewrapped})`);
    const k3 = await client.query(`SELECT COUNT(*)::int c FROM oracle_raw_users WHERE environment_host=$1 AND encryption_key_id=$2`, [HOST, K3]);
    assert(k3.rows[0].c === 5, 'All records now on replacement key');
    const k3Row = (await client.query(`SELECT username, raw_user FROM oracle_raw_users WHERE environment_host=$1 LIMIT 1`, [HOST])).rows[0];
    const k3Plain = await service.decryptEntityRecord('oracle_raw_users', { environment_host: HOST, username: k3Row.username }, k3Row.raw_user, HOST);
    assert(String(k3Plain.ssn).startsWith(SENTINEL), 'Records decrypt after emergency rotation');
  } finally {
    await cleanup(client);
    client.release();
  }
}

async function run() {
  console.log('\n=== VYR-036: Key rotation and encrypted-record version compatibility ===\n');
  const mod = require('../dist/security/encryptionService.js');
  const contract = require('../dist/security/encryptionContract.js');
  const rotation = require('../dist/security/keyRotationService.js');

  await unitTests(mod, contract);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await dbTests(mod, rotation, pool);
  } finally {
    await pool.end();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
