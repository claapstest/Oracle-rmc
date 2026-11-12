/**
 * VYR-029 Verification Suite
 * Implement AES-256-GCM encryption/decryption service
 *
 * Assertions:
 *   Section 1: Representative Payload Round-Trip Encryption & Decryption (AC1)
 *   Section 2: Nonce Freshness & Ciphertext Non-Determinism (Step 2, AC1)
 *   Section 3: Tamper-Negative Cryptographic Fail-Closed Assertions (Step 3, AC2)
 *   Section 4: Key Rotation & Multi-Generation Decryption (Step 1, AC1, AC2)
 *   Section 5: Entity-Level Helpers & Dual-Mode Backward Compatibility (Step 4, AC1)
 *   Section 6: Architecture Documentation & Regression Harness (AC1, AC2, AC3)
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../database/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

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
  console.log('  VYR-029: AES-256-GCM Encryption & Decryption Service');
  console.log('================================================================\n');

  try {
    const serviceSourcePath = path.resolve(__dirname, '../src/security/encryptionService.ts');
    assert(fs.existsSync(serviceSourcePath), 'backend/src/security/encryptionService.ts exists');

    // Import EncryptionService and KeyProvider dynamically
    const {
      EncryptionService,
      LocalKeyProvider,
      EncryptionError,
    } = await import('../src/security/encryptionService.js').catch(async () => {
      return await import('../dist/security/encryptionService.js');
    });

    const keyProvider = new LocalKeyProvider('veyra-kms-k1-2026', 'test-master-secret-key-oracle-rmc-2026');
    const service = new EncryptionService(keyProvider);

    // -------------------------------------------------------------
    // Section 1: Representative Payload Round-Trip Encryption & Decryption (AC1)
    // -------------------------------------------------------------
    console.log('--- Section 1: Representative Payload Round-Trip (AC1) ---');

    // 1.1 SCIM User Payload (Complex nested, unicode, arrays)
    const representativeUser = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: '300000045129',
      userName: 'akash.meesarapu@claaps.com',
      name: {
        givenName: 'Akash',
        familyName: 'Meesarapu',
        formatted: 'Akash Meesarapu',
      },
      displayName: 'Akash Meesarapu (Security Audit)',
      emails: [
        { value: 'akash.meesarapu@claaps.com', type: 'work', primary: true },
        { value: 'akash.sec@backup.org', type: 'recovery', primary: false },
      ],
      assignedRoles: [
        { roleCode: 'ORA_FND_IT_SECURITY_MANAGER_JOB', roleName: 'IT Security Manager' },
        { roleCode: 'CLAAPS_CUSTOM_AUDITOR', roleName: 'Custom Internal Auditor' },
      ],
      meta: {
        created: '2026-01-15T09:30:00Z',
        lastModified: '2026-11-12T14:20:00Z',
        version: 'W/"4829104820"',
      },
      unicodeNotes: 'Prüfung & Überwachung — 監査とセキュリティ — Confidential 🔒',
    };

    const userAad = {
      tenant: 'eiiv-dev14.fa.us6.oraclecloud.com',
      table: 'oracle_raw_users',
      recordId: representativeUser.userName,
    };

    const encryptedUser = await service.encryptPayload(representativeUser, userAad);
    assert(encryptedUser.formatVersion === 1, 'Encrypted user payload has formatVersion 1');
    assert(encryptedUser.algorithm === 'AES-256-GCM', 'Encrypted user payload uses AES-256-GCM');
    assert(Boolean(encryptedUser.ciphertext), 'Encrypted user payload contains ciphertext');
    assert(Boolean(encryptedUser.authTag), 'Encrypted user payload contains authTag');
    assert(Boolean(encryptedUser.nonce), 'Encrypted user payload contains nonce');
    assert(Boolean(encryptedUser.encryptedDek), 'Encrypted user payload contains wrapped DEK');

    const decryptedUser = await service.decryptPayload(encryptedUser, userAad);
    assert(decryptedUser.userName === representativeUser.userName, 'Decrypted user matches original userName');
    assert(decryptedUser.displayName === representativeUser.displayName, 'Decrypted user matches original displayName');
    assert(decryptedUser.assignedRoles.length === 2, 'Decrypted user preserves assignedRoles array');
    assert(decryptedUser.unicodeNotes === representativeUser.unicodeNotes, 'Decrypted user preserves complex Unicode strings');

    // 1.2 Audit Record Payload
    const representativeAudit = {
      eventId: 498104,
      userInternalName: 'FUSION_APPS_AM',
      eventTimestamp: '2026-10-22T14:52:20.161Z',
      businessObject: 'JournalEntry',
      product: 'Financials',
      action: 'UPDATE',
      changedAttributes: [
        { attribute: 'Status', oldValue: 'Draft', newValue: 'Posted' },
        { attribute: 'Amount', oldValue: '150000.00', newValue: '250000.00' },
      ],
    };
    const auditAad = 'tenant=eiiv-dev14.fa.us6.oraclecloud.com|table=oracle_raw_audit_records|id=hash_810239|v=v1';
    const encryptedAudit = await service.encryptPayload(representativeAudit, auditAad);
    const decryptedAudit = await service.decryptPayload(encryptedAudit, auditAad);
    assert(decryptedAudit.eventId === 498104, 'Decrypted audit record preserves numeric eventId');
    assert(decryptedAudit.changedAttributes.length === 2, 'Decrypted audit record preserves changedAttributes diff array');

    // 1.3 Control Incidents Array Payload (Large array)
    const representativeIncidents = Array.from({ length: 50 }, (_, i) => ({
      resultId: `RES_${1000 + i}`,
      incidentId: i + 1,
      status: i % 2 === 0 ? 'Assigned' : 'Remediate',
      globalUser: `violator_${i}@enterprise.com`,
      conflictingRoles: ['ROLE_AP_CLERK', 'ROLE_GL_MANAGER'],
    }));
    const incidentsAad = 'tenant=eiiv-dev14.fa.us6.oraclecloud.com|table=oracle_control_incidents|id=CTRL_SOD_99|v=v1';
    const encryptedIncidents = await service.encryptPayload(representativeIncidents, incidentsAad);
    const decryptedIncidents = await service.decryptPayload(encryptedIncidents, incidentsAad);
    assert(Array.isArray(decryptedIncidents) && decryptedIncidents.length === 50, 'Decrypted incidents preserves 50-element array');
    assert(decryptedIncidents[25].resultId === 'RES_1025', 'Decrypted incidents preserves array element properties');

    // 1.4 Raw String and Buffer Payloads
    const rawStringData = 'Plain text secret string with symbols !@#$%^&*()';
    const strAad = 'tenant=test|table=generic|id=str1|v=v1';
    const encStr = await service.encryptPayload(rawStringData, strAad);
    const decStr = await service.decryptPayload(encStr, strAad);
    assert(decStr === rawStringData, 'Decrypted string matches raw string input');

    const rawBuffer = Buffer.from('Binary data buffer stream bytes \x00\x01\x02\xff');
    const bufAad = 'tenant=test|table=generic|id=buf1|v=v1';
    const encBuf = await service.encryptPayload(rawBuffer, bufAad);
    const decBuf = await service.decryptPayload(encBuf, bufAad);
    assert(decBuf === rawBuffer.toString('utf8'), 'Decrypted buffer matches raw buffer content');

    // -------------------------------------------------------------
    // Section 2: Nonce Freshness & Ciphertext Non-Determinism (Step 2, AC1)
    // -------------------------------------------------------------
    console.log('\n--- Section 2: Nonce Freshness & Non-Determinism (Step 2, AC1) ---');

    const iterations = 10;
    const testSecret = { secret: 'identical message content for every run' };
    const fixedAad = 'tenant=test|table=oracle_raw_users|id=same_user|v=v1';

    const nonces = new Set();
    const ciphertexts = new Set();

    for (let i = 0; i < iterations; i++) {
      const encrypted = await service.encryptPayload(testSecret, fixedAad);
      nonces.add(encrypted.nonce);
      ciphertexts.add(encrypted.ciphertext);
    }

    assert(nonces.size === iterations, 'All 10 nonces are strictly unique (no nonce reuse)');
    assert(ciphertexts.size === iterations, 'All 10 ciphertexts are distinct for identical plaintext (cryptographically non-deterministic)');

    // -------------------------------------------------------------
    // Section 3: Tamper-Negative Cryptographic Fail-Closed Assertions (Step 3, AC2)
    // -------------------------------------------------------------
    console.log('\n--- Section 3: Tamper-Negative Cryptographic Fail-Closed (Step 3, AC2) ---');

    // Control: unaltered container decrypts cleanly
    const basePayload = await service.encryptPayload({ confidential: 'sensitive data' }, fixedAad);
    const controlDecrypt = await service.decryptPayload(basePayload, fixedAad);
    assert(controlDecrypt.confidential === 'sensitive data', 'Control: authentic payload decrypts successfully');

    // Negative 1: Bit-flipped ciphertext
    const ctBuf = Buffer.from(basePayload.ciphertext, 'base64');
    ctBuf[0] ^= 0x01; // Flip 1 bit
    const tamperedCtPayload = { ...basePayload, ciphertext: ctBuf.toString('base64') };
    let failedClosed = false;
    try {
      await service.decryptPayload(tamperedCtPayload, fixedAad);
    } catch (err) {
      failedClosed = err instanceof EncryptionError && err.code === 'DECRYPTION_FAILED';
    }
    assert(failedClosed, 'Tampered ciphertext triggers DECRYPTION_FAILED and fails closed');

    // Negative 2: Truncated ciphertext
    const truncatedCtPayload = { ...basePayload, ciphertext: basePayload.ciphertext.slice(0, 8) };
    failedClosed = false;
    try {
      await service.decryptPayload(truncatedCtPayload, fixedAad);
    } catch (err) {
      failedClosed = err instanceof EncryptionError && err.code === 'DECRYPTION_FAILED';
    }
    assert(failedClosed, 'Truncated ciphertext triggers DECRYPTION_FAILED');

    // Negative 3: Bit-flipped nonce
    const nonceBuf = Buffer.from(basePayload.nonce, 'base64');
    nonceBuf[0] ^= 0x01; // Flip 1 bit
    const tamperedNoncePayload = { ...basePayload, nonce: nonceBuf.toString('base64') };
    failedClosed = false;
    try {
      await service.decryptPayload(tamperedNoncePayload, fixedAad);
    } catch (err) {
      failedClosed = err instanceof EncryptionError && err.code === 'DECRYPTION_FAILED';
    }
    assert(failedClosed, 'Tampered nonce triggers DECRYPTION_FAILED');

    // Negative 4: Corrupted authentication tag
    const tagBuf = Buffer.from(basePayload.authTag, 'base64');
    tagBuf[0] ^= 0x01; // Flip 1 bit
    const tamperedTagPayload = { ...basePayload, authTag: tagBuf.toString('base64') };
    failedClosed = false;
    try {
      await service.decryptPayload(tamperedTagPayload, fixedAad);
    } catch (err) {
      failedClosed = err instanceof EncryptionError && err.code === 'DECRYPTION_FAILED';
    }
    assert(failedClosed, 'Corrupted authentication tag triggers DECRYPTION_FAILED');

    // Negative 5: Altered AAD context (payload AAD modified)
    const alteredAadPayload = { ...basePayload, aad: 'tenant=test|table=oracle_raw_users|id=ATTACKER_ID|v=v1' };
    failedClosed = false;
    try {
      await service.decryptPayload(alteredAadPayload, alteredAadPayload.aad);
    } catch (err) {
      failedClosed = err instanceof EncryptionError && err.code === 'DECRYPTION_FAILED';
    }
    assert(failedClosed, 'Altered AAD triggers DECRYPTION_FAILED (GCM tag verification rejects altered AAD)');

    // Negative 6: Expected AAD mismatch
    failedClosed = false;
    try {
      await service.decryptPayload(basePayload, 'tenant=foreign_host|table=oracle_raw_users|id=same_user|v=v1');
    } catch (err) {
      failedClosed = err instanceof EncryptionError && err.code === 'AAD_MISMATCH';
    }
    assert(failedClosed, 'Caller expected AAD mismatch triggers AAD_MISMATCH');

    // Negative 7: Cross-tenant transplantation rejection
    const devContext = { tenant: 'dev-fusion.acme.com', table: 'oracle_raw_users', recordId: 'user1' };
    const prodContext = { tenant: 'prod-fusion.acme.com', table: 'oracle_raw_users', recordId: 'user1' };
    const devPayload = await service.encryptPayload({ secret: 'dev profile' }, devContext);
    failedClosed = false;
    try {
      await service.decryptPayload(devPayload, prodContext);
    } catch (err) {
      failedClosed = err instanceof EncryptionError;
    }
    assert(failedClosed, 'Cross-tenant transplantation fails closed');

    // Negative 8: Cross-table transplantation rejection
    const userContext = { tenant: 'dev.acme.com', table: 'oracle_raw_users', recordId: 'admin' };
    const roleContext = { tenant: 'dev.acme.com', table: 'oracle_raw_roles', recordId: 'admin' };
    const userContainer = await service.encryptPayload({ secret: 'user profile' }, userContext);
    failedClosed = false;
    try {
      await service.decryptPayload(userContainer, roleContext);
    } catch (err) {
      failedClosed = err instanceof EncryptionError;
    }
    assert(failedClosed, 'Cross-table transplantation fails closed');

    // Negative 9: Intra-table user swapping rejection
    const userAContext = { tenant: 'dev.acme.com', table: 'oracle_raw_users', recordId: 'cfo_smith' };
    const userBContext = { tenant: 'dev.acme.com', table: 'oracle_raw_users', recordId: 'intern_bob' };
    const cfoPayload = await service.encryptPayload({ salary: '$500,000' }, userAContext);
    failedClosed = false;
    try {
      await service.decryptPayload(cfoPayload, userBContext);
    } catch (err) {
      failedClosed = err instanceof EncryptionError;
    }
    assert(failedClosed, 'Intra-table entity swapping fails closed');

    // -------------------------------------------------------------
    // Section 4: Key Rotation & Multi-Generation Decryption (AC1, AC2)
    // -------------------------------------------------------------
    console.log('\n--- Section 4: Key Rotation & Multi-Generation Decryption (Step 1, AC1, AC2) ---');

    // Register multiple key generations in key provider
    keyProvider.registerKey('veyra-kms-k1-2025', 'master-seed-key-2025-generation');
    keyProvider.registerKey('veyra-kms-k2-2026', 'master-seed-key-2026-generation');
    keyProvider.registerKey('veyra-kms-k3-2027', 'master-seed-key-2027-generation');

    // 1. Encrypt payload under 2025 key
    keyProvider.setActiveKeyId('veyra-kms-k1-2025');
    const payload2025 = await service.encryptPayload({ account: 'historical row' }, 'tenant=test|table=users|id=1|v=v1');
    assert(payload2025.keyId === 'veyra-kms-k1-2025', 'Payload encrypted under key generation 2025');

    // 2. Rotate active key to 2026
    keyProvider.setActiveKeyId('veyra-kms-k2-2026');
    const payload2026 = await service.encryptPayload({ account: 'current row' }, 'tenant=test|table=users|id=2|v=v1');
    assert(payload2026.keyId === 'veyra-kms-k2-2026', 'Payload encrypted under key generation 2026');

    // 3. Verify older 2025 payload still decrypts cleanly without global re-encryption
    const dec2025 = await service.decryptPayload(payload2025);
    assert(dec2025.account === 'historical row', 'Historical 2025 payload successfully decrypts under rotated active key');

    // 4. Verify 2026 payload decrypts cleanly
    const dec2026 = await service.decryptPayload(payload2026);
    assert(dec2026.account === 'current row', 'Current 2026 payload successfully decrypts');

    // 5. Test rotatePayloadKey helper
    const reEncrypted2025To2027 = await service.rotatePayloadKey(payload2025, 'veyra-kms-k3-2027');
    assert(reEncrypted2027To2027KeyId(reEncrypted2025To2027, 'veyra-kms-k3-2027'), 'rotatePayloadKey updates container keyId to veyra-kms-k3-2027');
    const decRotated = await service.decryptPayload(reEncrypted2025To2027);
    assert(decRotated.account === 'historical row', 'Re-encrypted payload preserves original plaintext content');

    function reEncrypted2027To2027KeyId(p, expected) {
      return p.keyId === expected;
    }

    // Negative: Unknown key ID
    const unknownKeyPayload = { ...payload2025, keyId: 'veyra-kms-unknown-999' };
    failedClosed = false;
    try {
      await service.decryptPayload(unknownKeyPayload);
    } catch (err) {
      failedClosed = err instanceof EncryptionError && err.code === 'KEY_NOT_FOUND';
    }
    assert(failedClosed, 'Unknown keyId triggers KEY_NOT_FOUND and fails closed');

    // -------------------------------------------------------------
    // Section 5: Entity-Level Helpers & Dual-Mode Backward Compatibility (AC1)
    // -------------------------------------------------------------
    console.log('\n--- Section 5: Entity-Level Helpers & Dual-Mode (Step 4, AC1) ---');

    const host = 'eiiv-dev14.fa.us6.oraclecloud.com';

    // 1. Ingestion helper: encryptEntityRecord
    const rawUserRecord = {
      username: 'sarah.connor@acme.com',
      display_name: 'Sarah Connor',
      raw_user: {
        emails: [{ value: 'sarah@acme.com' }],
        phone: '+1-555-0199',
        roles: ['DEFENDER'],
      },
    };

    const encUserPayload = await service.encryptEntityRecord('oracle_raw_users', rawUserRecord, 'raw_user', host);
    assert(encUserPayload.formatVersion === 1, 'encryptEntityRecord produces valid EncryptedPayload');
    assert(encUserPayload.aad.includes('id=sarah.connor@acme.com'), 'encryptEntityRecord binds username to AAD');

    // 2. Read helper: decryptEntityRecord on encrypted container
    const decUserObj = await service.decryptEntityRecord('oracle_raw_users', rawUserRecord, encUserPayload, host);
    assert(decUserObj.phone === '+1-555-0199', 'decryptEntityRecord cleanly decrypts encrypted entity');

    // 3. Dual-mode backward compatibility: decryptEntityRecord on legacy plaintext JSON
    const legacyPlaintext = { legacyField: 'old unencrypted profile', active: true };
    const dualModeRes = await service.decryptEntityRecord('oracle_raw_users', rawUserRecord, legacyPlaintext, host);
    assert(dualModeRes.legacyField === 'old unencrypted profile', 'decryptEntityRecord transparently returns legacy plaintext without error');

    // -------------------------------------------------------------
    // Section 6: Architecture Documentation & Regression Harness (AC1, AC2, AC3)
    // -------------------------------------------------------------
    console.log('\n--- Section 6: Documentation & Regression Harness (AC1, AC2, AC3) ---');

    const docPath = path.resolve(__dirname, '../../docs/architecture/aes_256_gcm_encryption_service.md');
    assert(fs.existsSync(docPath), 'docs/architecture/aes_256_gcm_encryption_service.md exists');

    const docContent = fs.readFileSync(docPath, 'utf-8');
    assert(docContent.includes('VYR-029'), 'Architecture doc explicitly references Story VYR-029');
    assert(docContent.includes('EPIC 4'), 'Architecture doc explicitly references EPIC 4');
    assert(docContent.includes('standard-veyra-application-dev'), 'Architecture doc documents applicability to standard branch');
    assert(docContent.includes('veyra-application-dev'), 'Architecture doc documents applicability to veyra dev branch');
    assert(docContent.includes('AES-256-GCM'), 'Architecture doc specifies AES-256-GCM cipher');
    assert(docContent.includes('randomBytes(12)'), 'Architecture doc documents 12-byte nonce generation');
    assert(docContent.includes('fill(0)'), 'Architecture doc specifies memory zeroing hygiene');
    assert(docContent.includes('Fail-Closed'), 'Architecture doc specifies fail-closed semantics');
    assert(docContent.includes('LocalKeyProvider'), 'Architecture doc documents key provider abstraction');

    // Package.json verification
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
    assert(Boolean(pkg.scripts['test:vyr29']), 'package.json defines "test:vyr29" script');
    assert(pkg.scripts['test:epic4'].includes('test:vyr29'), 'package.json wires test:vyr29 into "test:epic4"');

    console.log('\n================================================================');
    console.log(`  Passed: ${passedCount}  Failed: ${failedCount}`);
    console.log('================================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution failed with error:', err);
    process.exit(1);
  }
}

run();

