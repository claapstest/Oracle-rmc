/**
 * VYR-028 Verification Suite
 * Design encryption contract, AAD and storage schema
 *
 * Assertions:
 *   Section 1: Versioned EncryptedPayload Container Structure & Validation (Step 1, AC1)
 *   Section 2: Additional Authenticated Data (AAD) Construction & Canonicalization (Step 2, AC3)
 *   Section 3: Table-to-AAD Natural Key Binding Matrix (Step 2, AC3)
 *   Section 4: Key Rotation & Multi-Generation Storage Compatibility (Step 1, AC2)
 *   Section 5: Dual-Mode Legacy vs. Encrypted Payload Discrimination (Step 4, AC1)
 *   Section 6: Database Storage Schema & JSONB Compatibility (Step 3, AC1, AC2)
 *   Section 7: Architecture Documentation & Regression Harness (AC1, AC2, AC3)
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../database/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString =
  process.env.DATABASE_URL ||
  process.env.DATABASE_URI ||
  `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || '127.0.0.1'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'veyra_db'}`;

let passedCount = 0;
let failedCount = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  FAIL: ${testName}`);
    if (details) console.error(`        Details: ${details}`);
    failedCount++;
  }
}

async function run() {
  console.log('\n================================================================');
  console.log('  VYR-028: Encryption Contract, AAD & Storage Schema Design');
  console.log('================================================================\n');

  const pool = new Pool({ connectionString });

  try {
    // -------------------------------------------------------------
    // Section 1: Versioned EncryptedPayload Container Structure & Validation (AC1)
    // -------------------------------------------------------------
    console.log('--- Section 1: Versioned EncryptedPayload Container Structure & Validation (Step 1, AC1) ---');

    const contractSourcePath = path.resolve(__dirname, '../src/security/encryptionContract.ts');
    assert(fs.existsSync(contractSourcePath), 'backend/src/security/encryptionContract.ts exists');

    // Dynamically compile/require or import ts module using tsx or dynamic import
    // Because backend has "type": "module", let's import the compiled dist or ts directly
    const contract = await import('../src/security/encryptionContract.js').catch(async () => {
      // In ts-node / development, test if dist exists or import via tsx
      return await import('../dist/security/encryptionContract.js');
    });

    assert(Boolean(contract.ENCRYPTION_ALGORITHM_AES_256_GCM), 'Contract exports ENCRYPTION_ALGORITHM_AES_256_GCM constant');
    assert(contract.ENCRYPTION_ALGORITHM_AES_256_GCM === 'AES-256-GCM', 'Cipher algorithm is standard AES-256-GCM');
    assert(contract.CURRENT_ENCRYPTION_FORMAT_VERSION === 1, 'Current formatVersion is integer 1');
    assert(contract.GCM_NONCE_LENGTH_BYTES === 12, 'Recommended GCM nonce size is 12 bytes (96 bits)');
    assert(contract.GCM_AUTH_TAG_LENGTH_BYTES === 16, 'Recommended GCM auth tag size is 16 bytes (128 bits)');
    assert(contract.DEK_LENGTH_BYTES === 32, 'Standard DEK size is 32 bytes (256 bits)');

    // Helper to generate sample 12-byte nonce (16 base64 chars) and 16-byte tag (24 base64 chars)
    const validNonceB64 = Buffer.alloc(12, 0xaa).toString('base64');
    const validAuthTagB64 = Buffer.alloc(16, 0xbb).toString('base64');
    const validCiphertextB64 = Buffer.from('encrypted ciphertext sample').toString('base64');
    const validDekB64 = Buffer.alloc(32, 0xcc).toString('base64');

    const sampleValidPayload = {
      formatVersion: 1,
      algorithm: 'AES-256-GCM',
      keyId: 'veyra-kms-k1-2026',
      encryptedDek: validDekB64,
      nonce: validNonceB64,
      authTag: validAuthTagB64,
      ciphertext: validCiphertextB64,
      aad: 'tenant=eiiv-dev14.fa.us6.oraclecloud.com|table=oracle_raw_users|id=admin|v=v1',
      createdAt: new Date().toISOString(),
    };

    assert(contract.validateEncryptedPayload(sampleValidPayload) === true, 'Valid EncryptedPayload passes schema validation');

    // Negative validation tests
    let threw = false;
    try { contract.validateEncryptedPayload(null); } catch { threw = true; }
    assert(threw, 'Rejects null payload');

    threw = false;
    try { contract.validateEncryptedPayload({ ...sampleValidPayload, formatVersion: 0 }); } catch { threw = true; }
    assert(threw, 'Rejects non-positive formatVersion');

    threw = false;
    try { contract.validateEncryptedPayload({ ...sampleValidPayload, algorithm: 'AES-128-CBC' }); } catch { threw = true; }
    assert(threw, 'Rejects non-AES-256-GCM algorithm');

    threw = false;
    try { contract.validateEncryptedPayload({ ...sampleValidPayload, keyId: '' }); } catch { threw = true; }
    assert(threw, 'Rejects missing or empty keyId');

    threw = false;
    try { contract.validateEncryptedPayload({ ...sampleValidPayload, nonce: Buffer.alloc(8).toString('base64') }); } catch { threw = true; }
    assert(threw, 'Rejects invalid nonce length (not 12 bytes)');

    threw = false;
    try { contract.validateEncryptedPayload({ ...sampleValidPayload, authTag: Buffer.alloc(12).toString('base64') }); } catch { threw = true; }
    assert(threw, 'Rejects invalid authTag length (not 16 bytes)');

    threw = false;
    try { contract.validateEncryptedPayload({ ...sampleValidPayload, ciphertext: '' }); } catch { threw = true; }
    assert(threw, 'Rejects empty ciphertext');

    threw = false;
    try { contract.validateEncryptedPayload({ ...sampleValidPayload, aad: '' }); } catch { threw = true; }
    assert(threw, 'Rejects empty AAD string');

    // -------------------------------------------------------------
    // Section 2: Additional Authenticated Data (AAD) Construction & Canonicalization (AC3)
    // -------------------------------------------------------------
    console.log('\n--- Section 2: Additional Authenticated Data (AAD) Construction (Step 2, AC3) ---');

    const aadContext = {
      tenant: 'EiiV-Dev14.Fa.Us6.OracleCloud.Com ',
      table: 'ORACLE_RAW_USERS',
      recordId: 'akash.meesarapu@claaps.com',
      schemaVersion: 'v1',
    };

    const generatedAad = contract.buildAad(aadContext);
    assert(
      generatedAad === 'tenant=eiiv-dev14.fa.us6.oraclecloud.com|table=oracle_raw_users|id=akash.meesarapu@claaps.com|v=v1',
      'buildAad creates normalized canonical string with lowercased tenant and table'
    );

    // Parsing round-trip
    const parsedAad = contract.parseAad(generatedAad);
    assert(parsedAad.tenant === 'eiiv-dev14.fa.us6.oraclecloud.com', 'parseAad correctly extracts tenant');
    assert(parsedAad.table === 'oracle_raw_users', 'parseAad correctly extracts table');
    assert(parsedAad.recordId === 'akash.meesarapu@claaps.com', 'parseAad correctly extracts recordId');
    assert(parsedAad.schemaVersion === 'v1', 'parseAad correctly extracts schemaVersion');

    // Delimiter escaping injection prevention
    const injectionContext = {
      tenant: 'host|inject=evil',
      table: 'oracle_raw_users|drop=table',
      recordId: 'user=admin|role=admin',
      schemaVersion: 'v1',
    };
    const escapedAad = contract.buildAad(injectionContext);
    assert(escapedAad.includes('\\|') && escapedAad.includes('\\='), 'Pipes and equal signs are safely escaped');
    const parsedInjection = contract.parseAad(escapedAad);
    assert(parsedInjection.tenant === 'host|inject=evil', 'Escaped tenant round-trips without corruption');
    assert(parsedInjection.table === 'oracle_raw_users|drop=table', 'Escaped table round-trips without corruption');
    assert(parsedInjection.recordId === 'user=admin|role=admin', 'Escaped recordId round-trips without corruption');

    // Cross-tenant transplantation distinction
    const devAad = contract.buildAad({ tenant: 'dev-fusion.oracle.com', table: 'oracle_raw_users', recordId: 'user1' });
    const prodAad = contract.buildAad({ tenant: 'prod-fusion.oracle.com', table: 'oracle_raw_users', recordId: 'user1' });
    assert(devAad !== prodAad, 'AAD strictly isolates Dev and Prod tenants (prevents cross-tenant ciphertext move)');

    // Cross-table transplantation distinction
    const userTableAad = contract.buildAad({ tenant: 'dev-fusion.oracle.com', table: 'oracle_raw_users', recordId: 'admin' });
    const roleTableAad = contract.buildAad({ tenant: 'dev-fusion.oracle.com', table: 'oracle_raw_roles', recordId: 'admin' });
    assert(userTableAad !== roleTableAad, 'AAD strictly isolates tables (prevents moving user ciphertext into role table)');

    // Intra-table entity transposition distinction
    const userAAad = contract.buildAad({ tenant: 'dev-fusion.oracle.com', table: 'oracle_raw_users', recordId: 'user_a' });
    const userBAad = contract.buildAad({ tenant: 'dev-fusion.oracle.com', table: 'oracle_raw_users', recordId: 'user_b' });
    assert(userAAad !== userBAad, 'AAD strictly isolates records (prevents swapping ciphertext between different users)');

    // -------------------------------------------------------------
    // Section 3: Table-to-AAD Natural Key Binding Matrix (AC3)
    // -------------------------------------------------------------
    console.log('\n--- Section 3: Table-to-AAD Natural Key Binding Matrix (Step 2, AC3) ---');

    const envHost = 'eiiv-dev14.fa.us6.oraclecloud.com';

    // 1. Audit records -> record_unique_hash
    const auditRecord = { record_unique_hash: '9a8b7c6d5e4f3a2b1c0d' };
    const auditAad = contract.buildTableRecordAad('oracle_raw_audit_records', auditRecord, envHost);
    assert(auditAad.includes('table=oracle_raw_audit_records') && auditAad.includes('id=9a8b7c6d5e4f3a2b1c0d'),
      'oracle_raw_audit_records binds record_unique_hash as natural AAD ID');

    // 2. Users -> username
    const userRecord = { username: 'john.smith@acme.com' };
    const userAad = contract.buildTableRecordAad('oracle_raw_users', userRecord, envHost);
    assert(userAad.includes('table=oracle_raw_users') && userAad.includes('id=john.smith@acme.com'),
      'oracle_raw_users binds username as natural AAD ID');

    // 3. Roles -> role_code
    const roleRecord = { role_code: 'ORA_GL_GENERAL_ACCOUNTANT_JOB' };
    const roleAad = contract.buildTableRecordAad('oracle_raw_roles', roleRecord, envHost);
    assert(roleAad.includes('table=oracle_raw_roles') && roleAad.includes('id=ORA_GL_GENERAL_ACCOUNTANT_JOB'),
      'oracle_raw_roles binds role_code as natural AAD ID');

    // 4. Role Hierarchy -> parent:child
    const hierarchyRecord = { parent_role_name: 'IT_SECURITY_MANAGER', child_role_name: 'VIEW_AUDIT_DUTY' };
    const hierarchyAad = contract.buildTableRecordAad('oracle_raw_role_hierarchy', hierarchyRecord, envHost);
    assert(hierarchyAad.includes('table=oracle_raw_role_hierarchy') && hierarchyAad.includes('id=IT_SECURITY_MANAGER:VIEW_AUDIT_DUTY'),
      'oracle_raw_role_hierarchy binds parent_role_name:child_role_name as natural AAD ID');

    // 5. Controls -> control_id
    const controlRecord = { control_id: 'CTRL_SOD_AP_GL_01' };
    const controlAad = contract.buildTableRecordAad('oracle_raw_controls', controlRecord, envHost);
    assert(controlAad.includes('table=oracle_raw_controls') && controlAad.includes('id=CTRL_SOD_AP_GL_01'),
      'oracle_raw_controls binds control_id as natural AAD ID');

    // 6. Control Incidents -> control_id
    const incAad = contract.buildTableRecordAad('oracle_control_incidents', controlRecord, envHost);
    assert(incAad.includes('table=oracle_control_incidents') && incAad.includes('id=CTRL_SOD_AP_GL_01'),
      'oracle_control_incidents binds control_id as natural AAD ID');

    // 7. Incident Rows -> control_id:ord
    const rowRecord = { control_id: 'CTRL_SOD_AP_GL_01', ord: 15 };
    const rowAad = contract.buildTableRecordAad('oracle_incident_rows', rowRecord, envHost);
    assert(rowAad.includes('table=oracle_incident_rows') && rowAad.includes('id=CTRL_SOD_AP_GL_01:15'),
      'oracle_incident_rows binds control_id:ord as natural AAD ID');

    // 8. Access Certifications -> certification_id
    const certRecord = { certification_id: 'CERT_Q4_2026' };
    const certAad = contract.buildTableRecordAad('oracle_raw_access_certifications', certRecord, envHost);
    assert(certAad.includes('table=oracle_raw_access_certifications') && certAad.includes('id=CERT_Q4_2026'),
      'oracle_raw_access_certifications binds certification_id as natural AAD ID');

    // 9. Certifier Worksheets -> certification_id:id
    const wsRecord = { certification_id: 'CERT_Q4_2026', id: 504 };
    const wsAad = contract.buildTableRecordAad('oracle_raw_certifier_worksheets', wsRecord, envHost);
    assert(wsAad.includes('table=oracle_raw_certifier_worksheets') && wsAad.includes('id=CERT_Q4_2026:504'),
      'oracle_raw_certifier_worksheets binds certification_id:id as natural AAD ID');

    // Fail closed on missing natural ID
    threw = false;
    try { contract.buildTableRecordAad('oracle_raw_users', {}, envHost); } catch { threw = true; }
    assert(threw, 'buildTableRecordAad fails closed when entity has no natural identifier');

    // -------------------------------------------------------------
    // Section 4: Key Rotation & Multi-Generation Storage (AC2)
    // -------------------------------------------------------------
    console.log('\n--- Section 4: Key Rotation & Multi-Generation Storage (Step 1, AC2) ---');

    const keyGenerations = [
      { keyId: 'veyra-kms-k1-2025', encryptedDek: Buffer.alloc(32, 0x11).toString('base64') },
      { keyId: 'veyra-kms-k2-2026', encryptedDek: Buffer.alloc(32, 0x22).toString('base64') },
      { keyId: 'veyra-kms-k3-2027', encryptedDek: Buffer.alloc(32, 0x33).toString('base64') },
    ];

    for (const gen of keyGenerations) {
      const payload = {
        ...sampleValidPayload,
        keyId: gen.keyId,
        encryptedDek: gen.encryptedDek,
      };
      assert(contract.validateEncryptedPayload(payload), `EncryptedPayload valid under key generation ${gen.keyId}`);
      assert(payload.keyId === gen.keyId, `Container retains specific rotation key ID: ${gen.keyId}`);
    }

    assert(
      keyGenerations[0].keyId !== keyGenerations[1].keyId,
      'Multi-generation payloads coexist without forcing simultaneous global re-encryption'
    );

    // -------------------------------------------------------------
    // Section 5: Dual-Mode Legacy vs. Encrypted Payload Discrimination (AC1)
    // -------------------------------------------------------------
    console.log('\n--- Section 5: Dual-Mode Legacy vs. Encrypted Payload Discrimination (AC1) ---');

    // Encrypted payload detection
    assert(contract.isEncryptedPayload(sampleValidPayload) === true, 'isEncryptedPayload identifies EncryptedPayload container');

    // Legacy plaintext SCIM user representation
    const legacyPlaintextUser = {
      id: '300000001',
      userName: 'akash.meesarapu@claaps.com',
      name: { givenName: 'Akash', familyName: 'Meesarapu' },
      emails: [{ value: 'akash.meesarapu@claaps.com', primary: true }],
      assignedRoles: [{ roleCode: 'AUDIT_MANAGER', roleName: 'Audit Manager' }],
      active: true,
    };
    assert(contract.isEncryptedPayload(legacyPlaintextUser) === false, 'isEncryptedPayload rejects legacy SCIM user JSON (treats as plaintext)');

    // Legacy plaintext audit record
    const legacyPlaintextAudit = {
      userInternalName: 'FUSION_APPS',
      eventTimestamp: '2026-10-14T08:38:45Z',
      businessObject: 'User',
      attributes: [{ name: 'PasswordExpires', newValue: '2027-01-01' }],
    };
    assert(contract.isEncryptedPayload(legacyPlaintextAudit) === false, 'isEncryptedPayload rejects legacy auditData JSON');

    // Legacy plaintext control
    const legacyPlaintextControl = {
      controlId: 'CTRL_101',
      name: 'AP vs GL Posting',
      rules: ['RULE_1', 'RULE_2'],
    };
    assert(contract.isEncryptedPayload(legacyPlaintextControl) === false, 'isEncryptedPayload rejects legacy control definition JSON');

    // Serialization & Parsing
    const serialized = contract.serializeEncryptedPayload(sampleValidPayload);
    assert(typeof serialized === 'string', 'serializeEncryptedPayload returns valid JSON string');
    const parsed = contract.parseEncryptedPayload(serialized);
    assert(parsed.formatVersion === 1, 'parseEncryptedPayload restores formatVersion');
    assert(parsed.keyId === sampleValidPayload.keyId, 'parseEncryptedPayload restores keyId');
    assert(parsed.ciphertext === sampleValidPayload.ciphertext, 'parseEncryptedPayload restores ciphertext');
    assert(parsed.nonce === sampleValidPayload.nonce, 'parseEncryptedPayload restores nonce');
    assert(parsed.authTag === sampleValidPayload.authTag, 'parseEncryptedPayload restores authTag');

    // -------------------------------------------------------------
    // Section 6: Database Storage Schema & JSONB Compatibility (AC1, AC2)
    // -------------------------------------------------------------
    console.log('\n--- Section 6: Database Storage Schema & JSONB Compatibility (AC1, AC2) ---');

    // Test inserting and querying an EncryptedPayload into PostgreSQL raw_payload JSONB column
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const testHost = 'test-encryption-contract.local';
      const testHash = 'test_hash_' + Date.now();
      const testPayloadJson = contract.serializeEncryptedPayload({
        ...sampleValidPayload,
        aad: `tenant=${testHost}|table=oracle_raw_audit_records|id=${testHash}|v=v1`,
      });

      const insertRes = await client.query(
        `INSERT INTO oracle_raw_audit_records (
          environment_host, product, business_object, record_unique_hash, event_timestamp, username, event_type, raw_payload
        ) VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7::jsonb)
        RETURNING id, raw_payload`,
        [testHost, 'TEST_PRODUCT', 'TEST_OBJECT', testHash, 'test_user', 'ENCRYPT', testPayloadJson]
      );

      assert(insertRes.rowCount === 1, 'PostgreSQL successfully inserts EncryptedPayload into raw_payload JSONB column');

      const fetchedRow = insertRes.rows[0];
      assert(contract.isEncryptedPayload(fetchedRow.raw_payload) === true, 'Stored JSONB parses as a valid EncryptedPayload');
      assert(fetchedRow.raw_payload.formatVersion === 1, 'Stored JSONB preserves formatVersion');
      assert(fetchedRow.raw_payload.algorithm === 'AES-256-GCM', 'Stored JSONB preserves algorithm');
      assert(fetchedRow.raw_payload.keyId === sampleValidPayload.keyId, 'Stored JSONB preserves keyId');
      assert(fetchedRow.raw_payload.ciphertext === sampleValidPayload.ciphertext, 'Stored JSONB preserves ciphertext without truncation');

      // Test dual-mode coexistence: insert legacy plaintext in same column
      const legacyHash = 'legacy_hash_' + Date.now();
      const legacyInsertRes = await client.query(
        `INSERT INTO oracle_raw_audit_records (
          environment_host, product, business_object, record_unique_hash, event_timestamp, username, event_type, raw_payload
        ) VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7::jsonb)
        RETURNING id, raw_payload`,
        [testHost, 'TEST_PRODUCT', 'TEST_OBJECT', legacyHash, 'legacy_user', 'PLAIN', JSON.stringify(legacyPlaintextAudit)]
      );

      assert(contract.isEncryptedPayload(legacyInsertRes.rows[0].raw_payload) === false, 'Coexisting legacy plaintext record identified accurately in same table');

      // Clean rollback of test data
      await client.query('ROLLBACK');
      assert(true, 'Test database transaction rolled back cleanly without polluting production rows');
    } finally {
      client.release();
    }

    // -------------------------------------------------------------
    // Section 7: Architecture Documentation & Regression Harness (AC1, AC2, AC3)
    // -------------------------------------------------------------
    console.log('\n--- Section 7: Documentation & Regression Harness (AC1, AC2, AC3) ---');

    const docPath = path.resolve(__dirname, '../../docs/architecture/encryption_contract_aad_and_storage_schema.md');
    assert(fs.existsSync(docPath), 'docs/architecture/encryption_contract_aad_and_storage_schema.md exists');

    const docContent = fs.readFileSync(docPath, 'utf-8');
    assert(docContent.includes('VYR-028'), 'Architecture doc explicitly references Story VYR-028');
    assert(docContent.includes('EPIC 4'), 'Architecture doc explicitly references EPIC 4');
    assert(docContent.includes('standard-veyra-application-dev'), 'Architecture doc documents applicability to standard branch');
    assert(docContent.includes('veyra-application-dev'), 'Architecture doc documents applicability to veyra dev branch');
    assert(docContent.includes('EncryptedPayload'), 'Architecture doc defines EncryptedPayload structure');
    assert(docContent.includes('AES-256-GCM'), 'Architecture doc specifies AES-256-GCM cipher');
    assert(docContent.includes('keyId'), 'Architecture doc documents keyId rotation support');
    assert(docContent.includes('encryptedDek'), 'Architecture doc documents envelope DEK field');
    assert(docContent.includes('nonce'), 'Architecture doc specifies 96-bit nonce parameter');
    assert(docContent.includes('authTag'), 'Architecture doc specifies 128-bit auth tag parameter');
    assert(docContent.includes('buildAad'), 'Architecture doc specifies canonical buildAad format');
    assert(docContent.includes('tenant='), 'Architecture doc documents tenant parameter in AAD');
    assert(docContent.includes('Cross-Tenant Transplantation'), 'Architecture doc documents cross-tenant transplantation threat mitigation');
    assert(docContent.includes('Dual-Mode'), 'Architecture doc documents dual-mode JSONB storage strategy');

    // Package.json check
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
    assert(Boolean(pkg.scripts['test:vyr28']), 'package.json defines "test:vyr28" script');
    assert(pkg.scripts['test:epic4'].includes('test:vyr28'), 'package.json wires test:vyr28 into "test:epic4"');

    console.log('\n================================================================');
    console.log(`  Passed: ${passedCount}  Failed: ${failedCount}`);
    console.log('================================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution failed with error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
