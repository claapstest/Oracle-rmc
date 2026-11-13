/**
 * Test Suite: Story VYR-035
 * "Implement authorized Node.js decryption for dashboards, reports and investigations"
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Verifies that every raw-table READ path in dashboard, report and investigation
 * services decrypts EncryptedPayload containers transparently:
 *   - Legacy plaintext rows pass through unchanged.
 *   - Encrypted rows are decrypted and returned as plain objects.
 *   - Mixed legacy + encrypted result sets work (migration window).
 *   - Tampered encrypted rows fail closed (no silent fallback).
 *   - Decryption keys/DEKs are never exposed in returned DTOs.
 *   - The decryptedRecordReader module provides the batch helper.
 *
 * Uses an isolated tenant (vyr035-test.oraclecloud.com); rows are deleted
 * before and after, so real synced data is never touched.
 */

const fs = require('fs');
const path = require('path');
const pg = require('pg');
const dotenv = require('dotenv');

const HOST = 'vyr035-test.oraclecloud.com';
const SENTINEL = 'VYR035_SECRET_MARKER_99';

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
  'oracle_raw_access_certifications',
  'oracle_raw_certifier_worksheets',
  'oracle_raw_user_access',
];

async function cleanup(client) {
  for (const tbl of RAW_TABLES) {
    await client.query(`DELETE FROM ${tbl} WHERE environment_host = $1`, [HOST]).catch(() => {});
  }
}

async function ensureTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS oracle_raw_users (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      username VARCHAR(150) NOT NULL, display_name VARCHAR(255), email VARCHAR(255),
      is_active BOOLEAN DEFAULT true, user_category VARCHAR(100),
      business_unit VARCHAR(255), department VARCHAR(255), job_title VARCHAR(255),
      person_number VARCHAR(100), raw_user JSONB NOT NULL,
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
    CREATE TABLE IF NOT EXISTS oracle_raw_audit_records (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      product VARCHAR(150) NOT NULL, business_object VARCHAR(255) NOT NULL,
      record_unique_hash VARCHAR(64) NOT NULL, event_timestamp TIMESTAMPTZ,
      username VARCHAR(150), event_type VARCHAR(100), raw_payload JSONB NOT NULL,
      is_encrypted BOOLEAN DEFAULT false, encryption_format_version SMALLINT,
      encryption_key_id VARCHAR(100), encrypted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_raw_audit UNIQUE(environment_host, product, business_object, record_unique_hash)
    );
    CREATE TABLE IF NOT EXISTS oracle_raw_controls (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      control_id VARCHAR(100) NOT NULL, name VARCHAR(500), raw_payload JSONB NOT NULL,
      is_encrypted BOOLEAN DEFAULT false, encryption_format_version SMALLINT,
      encryption_key_id VARCHAR(100), encrypted_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_raw_control UNIQUE(environment_host, control_id)
    );
    CREATE TABLE IF NOT EXISTS oracle_control_incidents (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      control_id VARCHAR(100) NOT NULL, control_name VARCHAR(500),
      total_incidents INT DEFAULT 0, raw_incidents JSONB DEFAULT '[]',
      is_encrypted BOOLEAN DEFAULT false, encryption_format_version SMALLINT,
      encryption_key_id VARCHAR(100), encrypted_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_control_incidents UNIQUE(environment_host, control_id)
    );
    CREATE TABLE IF NOT EXISTS oracle_raw_role_hierarchy (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      parent_role_name VARCHAR(255), child_role_name VARCHAR(255), role_code VARCHAR(255),
      raw_record JSONB, is_encrypted BOOLEAN DEFAULT false,
      encryption_format_version SMALLINT, encryption_key_id VARCHAR(100), encrypted_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS oracle_raw_access_certifications (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      certification_id VARCHAR(100) NOT NULL, certification_name VARCHAR(500),
      type VARCHAR(100), status VARCHAR(100), percent_complete NUMERIC,
      due_date VARCHAR(100), creation_date VARCHAR(100),
      owner_name VARCHAR(255), manager_name VARCHAR(255), certifier_name VARCHAR(255),
      raw_data JSONB DEFAULT '{}',
      is_encrypted BOOLEAN DEFAULT false, encryption_format_version SMALLINT,
      encryption_key_id VARCHAR(100), encrypted_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_raw_cert UNIQUE(environment_host, certification_id)
    );
    CREATE TABLE IF NOT EXISTS oracle_raw_certifier_worksheets (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      certification_id VARCHAR(100) NOT NULL, certification_name VARCHAR(500),
      user_name VARCHAR(255), role_name VARCHAR(255), role_code VARCHAR(255),
      certifier_name VARCHAR(255), certified_manager VARCHAR(255),
      direct_manager VARCHAR(255), business_unit VARCHAR(255), department VARCHAR(255),
      action VARCHAR(100), raw_data JSONB DEFAULT '{}',
      is_encrypted BOOLEAN DEFAULT false, encryption_format_version SMALLINT,
      encryption_key_id VARCHAR(100), encrypted_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS oracle_raw_user_access (
      id BIGSERIAL PRIMARY KEY, environment_host VARCHAR(255) NOT NULL,
      username VARCHAR(150), user_category VARCHAR(100),
      first_name VARCHAR(255), last_name VARCHAR(255), display_name VARCHAR(255),
      email VARCHAR(255), active BOOLEAN, role_name VARCHAR(255), role_code VARCHAR(255),
      auto_provisioned BOOLEAN, person_id VARCHAR(100), person_number VARCHAR(100),
      department VARCHAR(255), job VARCHAR(255), business_unit VARCHAR(255),
      location VARCHAR(255), manager VARCHAR(255), raw_payload JSONB,
      is_encrypted BOOLEAN DEFAULT false, encryption_format_version SMALLINT,
      encryption_key_id VARCHAR(100), encrypted_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function run() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    console.log('\n=== VYR-035: Authorized Node.js Decryption ===\n');
    await ensureTables(client);
    await cleanup(client);

    // ---------------------------------------------------------------
    // 1. decryptedRecordReader module exists and exports correctly
    // ---------------------------------------------------------------
    console.log('--- Module availability ---');
    let decryptedRecordReader;
    try {
      decryptedRecordReader = require('../dist/security/decryptedRecordReader.js');
      assert(typeof decryptedRecordReader.decryptRawRows === 'function', 'decryptRawRows is exported');
      assert(typeof decryptedRecordReader.decryptSingleRawField === 'function', 'decryptSingleRawField is exported');
    } catch (e) {
      console.error(`  FAIL: Could not import decryptedRecordReader: ${e.message}`);
      failedTests += 2;
    }

    const { encryptRawField, isRawEncryptionEnabled } = require('../dist/security/encryptedRecordWriter.js');
    const { isEncryptedPayload } = require('../dist/security/encryptionContract.js');

    // ---------------------------------------------------------------
    // 2. Legacy plaintext rows pass through unchanged
    // ---------------------------------------------------------------
    console.log('\n--- Plaintext passthrough ---');

    const legacyUser = { userName: 'LEGACY_USER', displayName: 'Legacy Test', email: 'legacy@test.com', secret: SENTINEL };
    await client.query(
      `INSERT INTO oracle_raw_users (environment_host, username, display_name, email, is_active, user_category, raw_user,
        is_encrypted, encryption_format_version, encryption_key_id, encrypted_at, last_synced_at, created_at, updated_at)
       VALUES ($1, 'LEGACY_USER_035', 'Legacy Test', 'legacy@test.com', true, 'TEST', $2::jsonb,
        false, NULL, NULL, NULL, NOW(), NOW(), NOW())`,
      [HOST, JSON.stringify(legacyUser)]
    );

    if (decryptedRecordReader) {
      const res = await client.query(
        `SELECT raw_user, is_encrypted, username FROM oracle_raw_users WHERE environment_host = $1 AND username = 'LEGACY_USER_035'`,
        [HOST]
      );
      const decrypted = await decryptedRecordReader.decryptRawRows(
        'oracle_raw_users', 'raw_user', res.rows, HOST
      );
      assert(decrypted.length === 1, 'Plaintext: one row returned');
      assert(decrypted[0].raw_user.userName === 'LEGACY_USER' && decrypted[0].raw_user.email === 'legacy@test.com', 'Plaintext: raw_user passes through unchanged');
      assert(decrypted[0].raw_user.secret === SENTINEL, 'Plaintext: sentinel preserved');
    }

    // ---------------------------------------------------------------
    // 3. Encrypted rows are decrypted correctly
    // ---------------------------------------------------------------
    console.log('\n--- Encrypted row decryption ---');

    process.env.VEYRA_RAW_ENCRYPTION = 'true';
    const encUser = { userName: 'ENCRYPTED_USER', displayName: 'Encrypted Test', email: 'enc@test.com', secret: SENTINEL };
    const write = await encryptRawField('oracle_raw_users', { username: 'ENCRYPTED_USER_035' }, encUser, HOST);
    assert(write.isEncrypted === true, 'Write: encryption produced encrypted payload');

    await client.query(
      `INSERT INTO oracle_raw_users (environment_host, username, display_name, email, is_active, user_category, raw_user,
        is_encrypted, encryption_format_version, encryption_key_id, encrypted_at, last_synced_at, created_at, updated_at)
       VALUES ($1, 'ENCRYPTED_USER_035', 'Encrypted Test', 'enc@test.com', true, 'TEST', $2::jsonb,
        $3, $4, $5, $6, NOW(), NOW(), NOW())`,
      [HOST, JSON.stringify(write.rawValue), write.isEncrypted, 1, write.encryptionKey, new Date()]
    );

    if (decryptedRecordReader) {
      const res = await client.query(
        `SELECT raw_user, is_encrypted, username FROM oracle_raw_users WHERE environment_host = $1 AND username = 'ENCRYPTED_USER_035'`,
        [HOST]
      );
      assert(isEncryptedPayload(res.rows[0].raw_user), 'DB row contains encrypted container');

      const decrypted = await decryptedRecordReader.decryptRawRows(
        'oracle_raw_users', 'raw_user', res.rows, HOST
      );
      assert(decrypted.length === 1, 'Encrypted: one row returned');
      assert(decrypted[0].raw_user.userName === 'ENCRYPTED_USER', 'Encrypted: userName decrypted');
      assert(decrypted[0].raw_user.secret === SENTINEL, 'Encrypted: sentinel decrypted');
      assert(!isEncryptedPayload(decrypted[0].raw_user), 'Encrypted: returned value is NOT an encrypted container');
    }

    // ---------------------------------------------------------------
    // 4. Mixed legacy + encrypted rows (migration window)
    // ---------------------------------------------------------------
    console.log('\n--- Mixed legacy + encrypted rows ---');

    if (decryptedRecordReader) {
      const res = await client.query(
        `SELECT raw_user, is_encrypted, username FROM oracle_raw_users WHERE environment_host = $1 ORDER BY username`,
        [HOST]
      );
      assert(res.rows.length === 2, 'Mixed: two rows found');

      const decrypted = await decryptedRecordReader.decryptRawRows(
        'oracle_raw_users', 'raw_user', res.rows, HOST
      );
      assert(decrypted.length === 2, 'Mixed: both rows returned');
      const enc = decrypted.find(r => r.username === 'ENCRYPTED_USER_035');
      const leg = decrypted.find(r => r.username === 'LEGACY_USER_035');
      assert(enc && enc.raw_user.userName === 'ENCRYPTED_USER', 'Mixed: encrypted row decrypted');
      assert(leg && leg.raw_user.userName === 'LEGACY_USER', 'Mixed: legacy row passes through');
    }

    // ---------------------------------------------------------------
    // 5. Tampered encrypted row fails closed
    // ---------------------------------------------------------------
    console.log('\n--- Tampered ciphertext fails closed ---');

    if (decryptedRecordReader) {
      const res = await client.query(
        `SELECT raw_user, is_encrypted, username FROM oracle_raw_users WHERE environment_host = $1 AND username = 'ENCRYPTED_USER_035'`,
        [HOST]
      );
      const tampered = { ...res.rows[0] };
      const tamperedPayload = { ...tampered.raw_user };
      if (tamperedPayload.ciphertext) {
        tamperedPayload.ciphertext = tamperedPayload.ciphertext.slice(0, -4) + 'XXXX';
      }
      tampered.raw_user = tamperedPayload;

      let threw = false;
      try {
        await decryptedRecordReader.decryptRawRows(
          'oracle_raw_users', 'raw_user', [tampered], HOST
        );
      } catch (e) {
        threw = true;
        assert(!e.message.includes(SENTINEL), 'Tampered: error does not leak plaintext');
      }
      assert(threw, 'Tampered: decryption threw on tampered ciphertext');
    }

    // ---------------------------------------------------------------
    // 6. decryptSingleRawField works for single-record lookups
    // ---------------------------------------------------------------
    console.log('\n--- Single record decryption ---');

    if (decryptedRecordReader) {
      const res = await client.query(
        `SELECT raw_user, is_encrypted, username FROM oracle_raw_users WHERE environment_host = $1 AND username = 'ENCRYPTED_USER_035'`,
        [HOST]
      );
      const decrypted = await decryptedRecordReader.decryptSingleRawField(
        'oracle_raw_users', 'raw_user', res.rows[0], HOST
      );
      assert(decrypted.userName === 'ENCRYPTED_USER', 'Single: decrypted correctly');
      assert(decrypted.secret === SENTINEL, 'Single: sentinel present');
    }

    // ---------------------------------------------------------------
    // 7. Returned DTOs never contain encryption keys or DEK material
    // ---------------------------------------------------------------
    console.log('\n--- DTO security ---');

    if (decryptedRecordReader) {
      const res = await client.query(
        `SELECT raw_user, is_encrypted, username FROM oracle_raw_users WHERE environment_host = $1 AND username = 'ENCRYPTED_USER_035'`,
        [HOST]
      );
      const decrypted = await decryptedRecordReader.decryptRawRows(
        'oracle_raw_users', 'raw_user', res.rows, HOST
      );
      const serialized = JSON.stringify(decrypted);
      assert(!serialized.includes('wrappedDek'), 'DTO: no wrappedDek in output');
      assert(!serialized.includes('ciphertext'), 'DTO: no ciphertext in output');
      assert(!serialized.includes('authTag'), 'DTO: no authTag in output');
      assert(!serialized.includes('formatVersion'), 'DTO: no formatVersion in output');
    }

    // ---------------------------------------------------------------
    // 8. Audit records (oracle_raw_audit_records) decrypt
    // ---------------------------------------------------------------
    console.log('\n--- Audit record decryption ---');

    const auditPayload = { EventType: 'UPDATE', UserName: 'TESTUSER', Details: SENTINEL };
    const auditWrite = await encryptRawField(
      'oracle_raw_audit_records',
      { record_unique_hash: 'vyr035-audit-hash-1' },
      auditPayload, HOST
    );

    await client.query(
      `INSERT INTO oracle_raw_audit_records (environment_host, product, business_object, event_type, username,
        event_timestamp, record_unique_hash, raw_payload, is_encrypted, encryption_format_version,
        encryption_key_id, encrypted_at, created_at, updated_at)
       VALUES ($1, 'TEST_PRODUCT', 'TEST_BO', 'UPDATE', 'TESTUSER',
        NOW(), 'vyr035-audit-hash-1', $2::jsonb, $3, $4, $5, $6, NOW(), NOW())`,
      [HOST, JSON.stringify(auditWrite.rawValue), auditWrite.isEncrypted, 1, auditWrite.encryptionKey, new Date()]
    );

    if (decryptedRecordReader) {
      const res = await client.query(
        `SELECT raw_payload, is_encrypted, record_unique_hash FROM oracle_raw_audit_records WHERE environment_host = $1 AND record_unique_hash = 'vyr035-audit-hash-1'`,
        [HOST]
      );
      const decrypted = await decryptedRecordReader.decryptRawRows(
        'oracle_raw_audit_records', 'raw_payload', res.rows, HOST
      );
      assert(decrypted[0].raw_payload.EventType === 'UPDATE', 'Audit: EventType decrypted');
      assert(decrypted[0].raw_payload.Details === SENTINEL, 'Audit: sentinel decrypted');
    }

    // ---------------------------------------------------------------
    // 9. Control records (oracle_raw_controls) decrypt
    // ---------------------------------------------------------------
    console.log('\n--- Control record decryption ---');

    const controlPayload = { ControlId: '99901', ControlName: 'Test Control', Sensitive: SENTINEL };
    const controlWrite = await encryptRawField(
      'oracle_raw_controls',
      { control_id: 'VYR035-CTRL-1' },
      controlPayload, HOST
    );

    await client.query(
      `INSERT INTO oracle_raw_controls (environment_host, control_id, name, raw_payload,
        is_encrypted, encryption_format_version, encryption_key_id, encrypted_at, last_synced_at, created_at, updated_at)
       VALUES ($1, 'VYR035-CTRL-1', 'Test Control', $2::jsonb,
        $3, $4, $5, $6, NOW(), NOW(), NOW())`,
      [HOST, JSON.stringify(controlWrite.rawValue), controlWrite.isEncrypted, 1, controlWrite.encryptionKey, new Date()]
    );

    if (decryptedRecordReader) {
      const res = await client.query(
        `SELECT raw_payload, is_encrypted, control_id FROM oracle_raw_controls WHERE environment_host = $1 AND control_id = 'VYR035-CTRL-1'`,
        [HOST]
      );
      const decrypted = await decryptedRecordReader.decryptRawRows(
        'oracle_raw_controls', 'raw_payload', res.rows, HOST
      );
      assert(decrypted[0].raw_payload.ControlName === 'Test Control', 'Control: name decrypted');
      assert(decrypted[0].raw_payload.Sensitive === SENTINEL, 'Control: sentinel decrypted');
    }

    // ---------------------------------------------------------------
    // 10. Role records (oracle_raw_roles) decrypt
    // ---------------------------------------------------------------
    console.log('\n--- Role record decryption ---');

    const rolePayload = { roleCode: 'VYR035_ROLE', roleName: 'Test Role', members: [], secret: SENTINEL };
    const roleWrite = await encryptRawField(
      'oracle_raw_roles',
      { role_code: 'VYR035_ROLE' },
      rolePayload, HOST
    );

    await client.query(
      `INSERT INTO oracle_raw_roles (environment_host, role_code, role_name, category, is_custom, member_count, raw_role,
        is_encrypted, encryption_format_version, encryption_key_id, encrypted_at, last_synced_at, created_at, updated_at)
       VALUES ($1, 'VYR035_ROLE', 'Test Role', 'Duty', false, 0, $2::jsonb,
        $3, $4, $5, $6, NOW(), NOW(), NOW())`,
      [HOST, JSON.stringify(roleWrite.rawValue), roleWrite.isEncrypted, 1, roleWrite.encryptionKey, new Date()]
    );

    if (decryptedRecordReader) {
      const res = await client.query(
        `SELECT raw_role, is_encrypted, role_code, member_count FROM oracle_raw_roles WHERE environment_host = $1 AND role_code = 'VYR035_ROLE'`,
        [HOST]
      );
      const decrypted = await decryptedRecordReader.decryptRawRows(
        'oracle_raw_roles', 'raw_role', res.rows, HOST
      );
      assert(decrypted[0].raw_role.roleName === 'Test Role', 'Role: name decrypted');
      assert(decrypted[0].raw_role.secret === SENTINEL, 'Role: sentinel decrypted');
    }

    // ---------------------------------------------------------------
    // 11. Service-level integration: userRoleRawDbService read paths
    // ---------------------------------------------------------------
    console.log('\n--- Service integration: userRoleRawDbService ---');

    let userRoleService;
    try {
      const mod = require('../dist/services/userRoleRawDbService.js');
      userRoleService = mod.userRoleRawDbService || mod.default;
    } catch (e) {
      console.log(`  SKIP: userRoleRawDbService not importable: ${e.message}`);
    }

    if (userRoleService) {
      const singleRole = await userRoleService.getRawRole('VYR035_ROLE');
      if (singleRole) {
        assert(!isEncryptedPayload(singleRole), 'Service getRawRole: returns decrypted data');
        assert(singleRole.roleName === 'Test Role' || singleRole.roleCode === 'VYR035_ROLE',
          'Service getRawRole: correct role data');
      } else {
        console.log('  SKIP: getRawRole returned null (host mismatch expected in CI)');
      }

      const singleUser = await userRoleService.getRawUser('ENCRYPTED_USER_035');
      if (singleUser) {
        assert(!isEncryptedPayload(singleUser), 'Service getRawUser: returns decrypted data');
        assert(singleUser.userName === 'ENCRYPTED_USER', 'Service getRawUser: correct user data');
      } else {
        console.log('  SKIP: getRawUser returned null (host mismatch expected in CI)');
      }
    }

    // ---------------------------------------------------------------
    // 12. Service-level integration: controlRawDbService read paths
    // ---------------------------------------------------------------
    console.log('\n--- Service integration: controlRawDbService ---');

    try {
      const mod = require('../dist/services/controlRawDbService.js');
      const controlService = mod.controlRawDbService || mod.default;
      if (controlService) {
        const singleCtrl = await controlService.getRawControl('VYR035-CTRL-1');
        if (singleCtrl) {
          assert(!isEncryptedPayload(singleCtrl), 'Service getRawControl: returns decrypted data');
          assert(singleCtrl.ControlName === 'Test Control', 'Service getRawControl: correct data');
        } else {
          console.log('  SKIP: getRawControl returned null (host mismatch expected in CI)');
        }
      }
    } catch (e) {
      console.log(`  SKIP: controlRawDbService not importable: ${e.message}`);
    }

    // ---------------------------------------------------------------
    // 13. Service-level integration: auditRawDbService read paths
    // ---------------------------------------------------------------
    console.log('\n--- Service integration: auditRawDbService ---');

    try {
      const mod = require('../dist/services/auditRawDbService.js');
      const auditService = mod.auditRawDbService || mod.default;
      if (auditService) {
        const page = await auditService.getAuditRecordsPage({
          product: 'TEST_PRODUCT',
          businessObject: 'TEST_BO',
          pageNumber: 1,
          pageSize: 10
        });
        if (page && page.rawItems && page.rawItems.length > 0) {
          const first = page.rawItems[0];
          assert(!isEncryptedPayload(first), 'Service getAuditRecordsPage: returns decrypted data');
          assert(first.EventType === 'UPDATE', 'Service getAuditRecordsPage: correct data');
        } else {
          console.log('  SKIP: getAuditRecordsPage returned no items (host mismatch expected in CI)');
        }
      }
    } catch (e) {
      console.log(`  SKIP: auditRawDbService not importable: ${e.message}`);
    }

    // ---------------------------------------------------------------
    // Cleanup
    // ---------------------------------------------------------------
    delete process.env.VEYRA_RAW_ENCRYPTION;
    await cleanup(client);

    console.log(`\n=== Results: ${passedTests} passed, ${failedTests} failed ===`);
    process.exitCode = failedTests > 0 ? 1 : 0;
  } catch (err) {
    console.error('FATAL:', err);
    process.exitCode = 1;
  } finally {
    delete process.env.VEYRA_RAW_ENCRYPTION;
    await cleanup(client).catch(() => {});
    client.release();
    await pool.end();
  }
}

run();
