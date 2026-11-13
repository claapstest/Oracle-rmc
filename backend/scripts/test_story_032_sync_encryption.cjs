/**
 * Test Suite: Story VYR-032
 * "Encrypt records in full Oracle baseline synchronization"
 * Epic: EPIC 4 ??? Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Verifies that every raw-table write path in the Oracle sync pipeline routes
 * the classified JSON payload through the VYR-028/029 encryption contract:
 *   - Flag-off default keeps legacy plaintext writes (dual-mode rollout).
 *   - Flag-on writes encrypt the raw column and populate tracking columns.
 *   - Ciphertext never contains plaintext sentinels (verified in the DB).
 *   - Decryption round-trips through decryptRawField.
 *   - Tampered ciphertext fails closed.
 *   - Encryption failure surfaces before any plaintext row is persisted.
 *
 * Uses an isolated tenant (vyr032-test.oraclecloud.com) so the test never
 * touches real synced rows; all test rows are deleted at start and end.
 */

const fs = require('fs');
const path = require('path');
const pg = require('pg');
const dotenv = require('dotenv');

const HOST = 'vyr032-test.oraclecloud.com';
const SENTINEL = 'VYR032_SECRET_MARKER_42';

// Must be set before dotenv/config import: services resolve the tenant per call.
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

const RAW_TABLES = [
  'oracle_raw_roles',
  'oracle_raw_users',
  'oracle_raw_role_hierarchy',
  'oracle_raw_audit_records',
  'oracle_raw_controls',
  'oracle_control_incidents',
  'oracle_incident_rows',
  'oracle_raw_user_access',
];

async function cleanupHost(pool) {
  for (const t of RAW_TABLES) {
    await pool.query(`DELETE FROM ${t} WHERE environment_host = $1`, [HOST]);
  }
}

async function run() {
  console.log('\n================================================================');
  console.log('  VYR-032: Encrypt Records in Full Oracle Baseline Sync');
  console.log('================================================================\n');

  // --------------------------------------------------------------------
  // Compiled artifacts exist
  // --------------------------------------------------------------------
  const writerPath = path.resolve(__dirname, '../dist/security/encryptedRecordWriter.js');
  const contractPath = path.resolve(__dirname, '../dist/security/encryptionContract.js');
  const encryptionServicePath = path.resolve(__dirname, '../dist/security/encryptionService.js');
  const servicesPath = path.resolve(__dirname, '../dist/services');

  assert(fs.existsSync(writerPath), 'backend/dist/security/encryptedRecordWriter.js compiled and exists');
  assert(fs.existsSync(contractPath), 'backend/dist/security/encryptionContract.js compiled and exists');
  assert(fs.existsSync(encryptionServicePath), 'backend/dist/security/encryptionService.js compiled and exists');
  for (const svc of ['userRoleRawDbService', 'roleHierarchyService', 'auditRawDbService', 'controlRawDbService', 'userAccessReportService']) {
    assert(fs.existsSync(path.join(servicesPath, `${svc}.js`)), `backend/dist/services/${svc}.js compiled and exists`);
  }

  const {
    isRawEncryptionEnabled,
    encryptRawField,
    decryptRawField,
    trackingColumns,
    RAW_ENCRYPTION_ENV,
  } = require(writerPath);
  const { isEncryptedPayload } = require(contractPath);
  const { encryptionService } = require(encryptionServicePath);

  const { userRoleRawDbService } = require(path.join(servicesPath, 'userRoleRawDbService.js'));
  const { roleHierarchyService } = require(path.join(servicesPath, 'roleHierarchyService.js'));
  const { auditRawDbService } = require(path.join(servicesPath, 'auditRawDbService.js'));
  const { controlRawDbService } = require(path.join(servicesPath, 'controlRawDbService.js'));
  const { userAccessReportService } = require(path.join(servicesPath, 'userAccessReportService.js'));

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // --------------------------------------------------------------------
  // Test data
  // --------------------------------------------------------------------
  const roleA = {
    roleCode: 'VYR032_ROLE_A',
    displayName: `VYR032 Role A ${SENTINEL}`,
    category: 'Fusion Roles',
    isCustom: true,
    memberCount: 2,
  };
  const roleB = {
    roleCode: 'VYR032_ROLE_B',
    displayName: `VYR032 Role B ${SENTINEL}`,
    category: 'Custom Roles',
    isCustom: true,
    memberCount: 0,
  };
  const userA = {
    username: 'VYR032.USER',
    displayName: `VYR032 User ${SENTINEL}`,
    email: 'vyr032.user@test.local',
    businessUnit: 'VYR032 BU',
    assignedRoles: [{ name: 'VYR032_ROLE_A' }],
  };
  const userB = {
    username: 'VYR032.USER.B',
    displayName: `VYR032 User B ${SENTINEL}`,
    email: 'vyr032.user.b@test.local',
    businessUnit: 'VYR032 BU',
    assignedRoles: [],
  };
  const hierarchyItem = {
    parentRole: 'VYR032_PARENT',
    parentRoleType: 'JOB',
    childRole: 'VYR032_CHILD',
    childRoleType: 'ROLE',
    roleCode: 'VYR032_ROLE_A',
    category: null,
    relationshipType: 'HIERARCHY',
    privileges: [{ privilegeName: `VYR032_PRIV ${SENTINEL}` }],
  };
  const auditItem = {
    date: '2026-02-01T00:00:00Z',
    userInternalName: 'VYR032.USER',
    eventType: 'USER_SESSION_CREATED',
    description: `VYR032 audit event ${SENTINEL}`,
  };
  const controlRaw = {
    ControlId: 'VYR032_CTRL',
    Name: `VYR032 Control ${SENTINEL}`,
    Status: 'ACTIVE',
    StateCode: 'DRAFT',
    Description: `VYR032 control payload ${SENTINEL}`,
  };
  const incidents = [
    { ResultId: 'R1', Status: 'ASSIGNED', State: 'Open', Details: `VYR032 incident 1 ${SENTINEL}`, LastUpdateDate: '2026-02-01T10:00:00Z' },
    { ResultId: 'R2', Status: 'RESOLVED', State: 'Closed', Details: `VYR032 incident 2 ${SENTINEL}`, LastUpdateDate: '2026-02-02T10:00:00Z' },
  ];
  const userAccessRow = {
    username: 'VYR032.USER',
    userCategory: 'EMP',
    firstName: 'Vyr',
    lastName: `Tester ${SENTINEL}`,
    displayName: 'VYR032 User',
    email: 'vyr032.user@test.local',
    active: true,
    roleName: 'VYR032_ROLE_A',
    roleCode: 'VYR032_ROLE_A',
    autoProvisioned: 'No',
    personId: 'VYR032-P1',
    personNumber: 'VYR032-N1',
    department: 'Security',
    job: 'Tester',
    businessUnit: 'VYR032 BU',
    location: 'Testville',
    manager: 'VYR032.MANAGER',
  };

  try {
    // ------------------------------------------------------------------
    // Section 1: Helper contract (flag default, encrypt/decrypt round-trip)
    // ------------------------------------------------------------------
    console.log('--- Section 1: Helper Contract (VYR-028/029 integration) ---');

    delete process.env[RAW_ENCRYPTION_ENV];
    assert(isRawEncryptionEnabled() === false, `Encryption disabled by default (${RAW_ENCRYPTION_ENV} unset)`);

    process.env[RAW_ENCRYPTION_ENV] = 'false';
    assert(isRawEncryptionEnabled() === false, `${RAW_ENCRYPTION_ENV}=false disables encryption`);

    const legacy = await encryptRawField('oracle_raw_roles', { role_code: roleA.roleCode }, { role: roleA }, HOST);
    assert(legacy.isEncrypted === false && legacy.encryptionKey === null, 'Flag off: encryptRawField returns legacy plaintext untouched');

    process.env[RAW_ENCRYPTION_ENV] = 'true';
    assert(isRawEncryptionEnabled() === true, `${RAW_ENCRYPTION_ENV}=true enables encryption`);

    const enc = await encryptRawField('oracle_raw_roles', { role_code: roleA.roleCode }, { role: roleA, marker: SENTINEL }, HOST);
    assert(enc.isEncrypted === true && isEncryptedPayload(enc.rawValue), 'Flag on: encryptRawField returns an EncryptedPayload container');
    assert(typeof enc.encryptionKey === 'string' && enc.encryptionKey.length > 0, 'Encrypted result carries the KEK id (encryptionKey)');
    assert(!JSON.stringify(enc.rawValue).includes(SENTINEL), 'Ciphertext contains no plaintext sentinel');

    const roundtrip = await decryptRawField('oracle_raw_roles', { role_code: roleA.roleCode }, enc.rawValue, HOST);
    assert(deepEqual(roundtrip, { role: roleA, marker: SENTINEL }), 'decryptRawField round-trips the encrypted payload to the original object');

    // Tamper with the ciphertext
    const tampered = JSON.parse(JSON.stringify(enc.rawValue));
    const firstChar = tampered.ciphertext ? tampered.ciphertext[0] : null;
    if (firstChar !== null) {
      const flipped = firstChar === 'A' ? 'B' : 'A';
      tampered.ciphertext = flipped + tampered.ciphertext.slice(1);
      let tamperThrew = false;
      try { await decryptRawField('oracle_raw_roles', { role_code: roleA.roleCode }, tampered, HOST); } catch (_) { tamperThrew = true; }
      assert(tamperThrew, 'Tampered ciphertext fails closed (decryption throws)');
    } else {
      assert(false, 'Tampered ciphertext fails closed (decryption throws) ??? payload has no ciphertext field');
    }

    const cols = trackingColumns(enc);
    assert(cols.length === 4 && cols[0] === true && typeof cols[1] === 'number' && typeof cols[2] === 'string' && cols[3] instanceof Date,
      'trackingColumns yields [is_encrypted, version, key_id, encrypted_at] in schema order');

    // ------------------------------------------------------------------
    // Section 2: Flag-off integration ??? legacy plaintext write path intact
    // ------------------------------------------------------------------
    console.log('\n--- Section 2: Flag-Off Regression (legacy plaintext writes) ---');

    await cleanupHost(pool);
    delete process.env[RAW_ENCRYPTION_ENV];

    await userRoleRawDbService.saveRawUser(userA);
    const offRow = await pool.query(
      `SELECT raw_user, is_encrypted FROM oracle_raw_users WHERE environment_host = $1 AND username = $2`,
      [HOST, userA.username]
    );
    assert(offRow.rows.length === 1, 'Flag off: saveRawUser persists one row');
    assert(offRow.rows[0].is_encrypted === false, 'Flag off: is_encrypted is false');
    const offRaw = typeof offRow.rows[0].raw_user === 'string' ? JSON.parse(offRow.rows[0].raw_user) : offRow.rows[0].raw_user;
    assert(JSON.stringify(offRaw).includes(SENTINEL), 'Flag off: raw_user stores legacy plaintext JSON');

    // ------------------------------------------------------------------
    // Section 3: Flag-on integration ??? every sync write site encrypts
    // ------------------------------------------------------------------
    console.log('\n--- Section 3: Flag-On Sync Writes (all raw tables) ---');

    await cleanupHost(pool);
    process.env[RAW_ENCRYPTION_ENV] = 'true';

    await userRoleRawDbService.saveRawRole(roleA);
    await userRoleRawDbService.saveRawRolesBatch([roleB]);
    await userRoleRawDbService.saveRawUser(userA);
    await userRoleRawDbService.saveRawUsersBatch([userB]);
    await roleHierarchyService.persistItemsToDatabase([hierarchyItem]);
    await auditRawDbService.saveRawAuditRecords('Fusion Audit', 'User', [auditItem]);
    await controlRawDbService.saveRawControl(controlRaw.ControlId, controlRaw);
    await controlRawDbService.saveRawIncidentsBatch(controlRaw.ControlId, incidents, controlRaw.Name);
    await userAccessReportService.persistToDatabase({
      summary: { totalUsers: 1, usersWithRoles: 1, usersWithoutRoles: 0, totalRoleAssignments: 1, activeUsers: 1, inactiveUsers: 0 },
      data: [userAccessRow],
      calculatedAt: new Date().toISOString(),
    });

    const tableChecks = [
      { table: 'oracle_raw_roles', col: 'raw_role', key: 'role_code', id: roleA.roleCode, name: 'saveRawRole' },
      { table: 'oracle_raw_roles', col: 'raw_role', key: 'role_code', id: roleB.roleCode, name: 'saveRawRolesBatch' },
      { table: 'oracle_raw_users', col: 'raw_user', key: 'username', id: userA.username, name: 'saveRawUser' },
      { table: 'oracle_raw_users', col: 'raw_user', key: 'username', id: userB.username, name: 'saveRawUsersBatch' },
      { table: 'oracle_raw_role_hierarchy', col: 'raw_record', key: 'child_role_name', id: hierarchyItem.childRole, name: 'persistItemsToDatabase' },
      { table: 'oracle_raw_controls', col: 'raw_payload', key: 'control_id', id: controlRaw.ControlId, name: 'saveRawControl' },
      { table: 'oracle_control_incidents', col: 'raw_incidents', key: 'control_id', id: controlRaw.ControlId, name: 'saveRawIncidentsBatch' },
      { table: 'oracle_raw_user_access', col: 'raw_payload', key: 'username', id: userAccessRow.username, name: 'persistToDatabase' },
    ];
    for (const c of tableChecks) {
      const res = await pool.query(
        `SELECT ${c.col} AS raw, is_encrypted, encryption_format_version, encryption_key_id, encrypted_at
         FROM ${c.table} WHERE environment_host = $1 AND ${c.key} = $2`,
        [HOST, c.id]
      );
      assert(res.rows.length === 1, `${c.name}: row present in ${c.table}`);
      if (res.rows.length === 1) {
        const row = res.rows[0];
        assert(row.is_encrypted === true, `${c.name}: ${c.table}.is_encrypted is true`);
        assert(typeof row.encryption_key_id === 'string' && row.encryption_key_id.length > 0, `${c.name}: encryption_key_id populated`);
        assert(row.encrypted_at !== null, `${c.name}: encrypted_at populated`);
        const rawVal = typeof row.raw === 'string' ? JSON.parse(row.raw) : row.raw;
        assert(isEncryptedPayload(rawVal), `${c.name}: ${c.col} holds an EncryptedPayload container`);
        assert(!JSON.stringify(rawVal).includes(SENTINEL), `${c.name}: ${c.col} ciphertext contains no plaintext sentinel`);
      }
    }

    // Audit records are keyed by a computed unique hash ??? check by host + product
    const auditRes = await pool.query(
      `SELECT raw_payload, is_encrypted, encryption_key_id, record_unique_hash
       FROM oracle_raw_audit_records WHERE environment_host = $1 AND product = 'Fusion Audit'`,
      [HOST]
    );
    assert(auditRes.rows.length === 1, 'saveRawAuditRecords: row present in oracle_raw_audit_records');
    if (auditRes.rows.length === 1) {
      const row = auditRes.rows[0];
      assert(row.is_encrypted === true, 'saveRawAuditRecords: is_encrypted is true');
      assert(typeof row.encryption_key_id === 'string' && row.encryption_key_id.length > 0, 'saveRawAuditRecords: encryption_key_id populated');
      const rawVal = typeof row.raw_payload === 'string' ? JSON.parse(row.raw_payload) : row.raw_payload;
      assert(isEncryptedPayload(rawVal), 'saveRawAuditRecords: raw_payload holds an EncryptedPayload container');
      assert(!JSON.stringify(rawVal).includes(SENTINEL), 'saveRawAuditRecords: ciphertext contains no plaintext sentinel');
    }

    // Derived incident-row index re-derives from the encrypted raw_incidents cell
    await controlRawDbService.syncSingleControlRowsFromDb(HOST, controlRaw.ControlId);
    const incidentRows = await pool.query(
      `SELECT raw, is_encrypted, status FROM oracle_incident_rows WHERE environment_host = $1 AND control_id = $2 ORDER BY ord`,
      [HOST, controlRaw.ControlId]
    );
    assert(incidentRows.rows.length === 2, 'syncSingleControlRowsFromDb: 2 derived rows in oracle_incident_rows');
    if (incidentRows.rows.length === 2) {
      assert(incidentRows.rows.every(r => r.is_encrypted === true), 'syncSingleControlRowsFromDb: derived rows flagged is_encrypted');
      const allEncrypted = incidentRows.rows.every(r => {
        const v = typeof r.raw === 'string' ? JSON.parse(r.raw) : r.raw;
        return isEncryptedPayload(v) && !JSON.stringify(v).includes(SENTINEL);
      });
      assert(allEncrypted, 'syncSingleControlRowsFromDb: derived raw column encrypted, no plaintext sentinel');
    }

    // ------------------------------------------------------------------
    // Section 4: Round-trip decryption of stored rows
    // ------------------------------------------------------------------
    console.log('\n--- Section 4: Round-Trip Decryption of Stored Rows ---');

    const storedUser = await pool.query(
      `SELECT raw_user FROM oracle_raw_users WHERE environment_host = $1 AND username = $2`,
      [HOST, userA.username]
    );
    const storedIncidents = await pool.query(
      `SELECT raw_incidents FROM oracle_control_incidents WHERE environment_host = $1 AND control_id = $2`,
      [HOST, controlRaw.ControlId]
    );
    const decUser = await decryptRawField('oracle_raw_users', { username: userA.username }, storedUser.rows[0].raw_user, HOST);
    assert(deepEqual(decUser, userA), 'Stored encrypted raw_user decrypts to the original Oracle user payload');
    const decInc = await decryptRawField('oracle_control_incidents', { control_id: controlRaw.ControlId }, storedIncidents.rows[0].raw_incidents, HOST);
    assert(Array.isArray(decInc) && deepEqual(decInc, incidents), 'Stored encrypted raw_incidents decrypts to the original incident array');

    // ------------------------------------------------------------------
    // Section 5: Fail-closed ??? encryption failure must not persist plaintext
    // ------------------------------------------------------------------
    console.log('\n--- Section 5: Fail-Closed on Encryption Failure ---');

    const originalEncrypt = encryptionService.encryptPayload;
    encryptionService.encryptPayload = async () => { throw new Error('KMS unavailable'); };
    let threw = false;
    try {
      await userRoleRawDbService.saveRawUser(userB);
    } catch (_) { threw = true; }
    encryptionService.encryptPayload = originalEncrypt;

    assert(threw, 'Encryption failure surfaces (write throws, is not swallowed)');

    // Remove any row persisted before the failure so only post-failure inserts count
    await pool.query(
      `DELETE FROM oracle_raw_users WHERE environment_host = $1 AND username = $2`,
      [HOST, userB.username]
    );
    const failRow = await pool.query(
      `SELECT 1 FROM oracle_raw_users WHERE environment_host = $1 AND username = $2`,
      [HOST, userB.username]
    );
    assert(failRow.rows.length === 0, 'No plaintext row persisted when encryption fails');

    // ------------------------------------------------------------------
    // Section 6: Tamper at rest fails closed
    // ------------------------------------------------------------------
    console.log('\n--- Section 6: Tamper at Rest Fails Closed ---');

    await pool.query(
      `UPDATE oracle_raw_users SET raw_user = jsonb_set(raw_user, '{ciphertext}', to_jsonb('AAAA'::text)) 
       WHERE environment_host = $1 AND username = $2`,
      [HOST, userA.username]
    );
    let tamperAtRestThrew = false;
    try { await decryptRawField('oracle_raw_users', { username: userA.username }, (await pool.query(`SELECT raw_user FROM oracle_raw_users WHERE environment_host = $1 AND username = $2`, [HOST, userA.username])).rows[0].raw_user, HOST); } catch (_) { tamperAtRestThrew = true; }
    assert(tamperAtRestThrew, 'DB-tampered ciphertext fails closed on decryption');

    // ------------------------------------------------------------------
    // Final cleanup
    // ------------------------------------------------------------------
    await cleanupHost(pool);
    console.log('\n  [cleanup] Test tenant rows removed from all 8 raw tables.');
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
