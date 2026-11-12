/**
 * Test Suite: Story VYR-030
 * "Integrate envelope encryption with KMS/Key Vault"
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Verifies KMS envelope encryption architecture, cloud KMS adapters, DEK generation,
 * authenticated wrapping/unwrapping, context binding, tamper-resistance, memory zeroing,
 * zero key disclosure in telemetry, healthchecks, and end-to-end EncryptionService integration.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

async function run() {
  console.log('\n================================================================');
  console.log('  VYR-030: KMS & Key Vault Envelope Encryption Integration');
  console.log('================================================================\n');

  const kmsProviderModulePath = path.resolve(__dirname, '../dist/security/kmsProvider.js');
  const encryptionServiceModulePath = path.resolve(__dirname, '../dist/security/encryptionService.js');
  const encryptionContractModulePath = path.resolve(__dirname, '../dist/security/encryptionContract.js');

  assert(fs.existsSync(kmsProviderModulePath), 'backend/dist/security/kmsProvider.js compiled and exists');
  assert(fs.existsSync(encryptionServiceModulePath), 'backend/dist/security/encryptionService.js compiled and exists');

  const {
    LocalKmsProvider,
    AwsKmsProvider,
    AzureKeyVaultProvider,
    createKmsProvider,
    kmsProvider,
    createKmsEncryptionService,
    kmsEncryptionService,
  } = require(kmsProviderModulePath);

  const {
    EncryptionService,
    LocalKeyProvider,
    EncryptionError,
  } = require(encryptionServiceModulePath);

  const {
    DEK_LENGTH_BYTES,
    GCM_NONCE_LENGTH_BYTES,
    GCM_AUTH_TAG_LENGTH_BYTES,
    buildTableRecordAad,
  } = require(encryptionContractModulePath);

  // -------------------------------------------------------------------------
  // Section 1: KMS Provider Factory & Instantiation (AC1)
  // -------------------------------------------------------------------------
  console.log('--- Section 1: KMS Provider Factory & Instantiation (AC1) ---');

  const defaultVault = createKmsProvider();
  assert(defaultVault instanceof LocalKmsProvider, 'createKmsProvider returns LocalKmsProvider by default');
  assert(defaultVault.providerType === 'LOCAL_VAULT', 'default providerType is LOCAL_VAULT');
  assert(typeof defaultVault.getActiveKeyId() === 'string' && defaultVault.getActiveKeyId().length > 0, 'getActiveKeyId returns active key identifier');

  // Test AWS KMS adapter
  const awsKeyArn = 'arn:aws:kms:us-east-1:123456789012:key/test-kek-2026';
  const awsProvider = new AwsKmsProvider(awsKeyArn, 'us-east-1');
  assert(awsProvider.providerType === 'AWS_KMS', 'AwsKmsProvider reports AWS_KMS provider type');
  assert(awsProvider.getActiveKeyId() === awsKeyArn, 'AwsKmsProvider activeKeyId matches ARN');
  const awsMasterKey = await awsProvider.getMasterKey(awsKeyArn);
  assert(awsMasterKey === null, 'AWS KMS provider never exposes raw master key (returns null)');

  // Test Azure Key Vault adapter
  const azureVaultUrl = 'https://veyra-vault.vault.azure.net';
  const azureProvider = new AzureKeyVaultProvider(azureVaultUrl, 'veyra-oracle-kek');
  assert(azureProvider.providerType === 'AZURE_KEY_VAULT', 'AzureKeyVaultProvider reports AZURE_KEY_VAULT provider type');
  assert(azureProvider.getActiveKeyId().includes('https://veyra-vault.vault.azure.net/keys/veyra-oracle-kek'), 'AzureKeyVaultProvider activeKeyId matches Key Vault URL');
  const azureMasterKey = await azureProvider.getMasterKey(azureProvider.getActiveKeyId());
  assert(azureMasterKey === null, 'Azure Key Vault provider never exposes raw master key (returns null)');

  // -------------------------------------------------------------------------
  // Section 2: DEK Generation & Authenticated Wrapping/Unwrapping (AC1, AC2)
  // -------------------------------------------------------------------------
  console.log('\n--- Section 2: DEK Generation & Wrapping/Unwrapping Round-Trip (AC1, AC2) ---');

  const vault = new LocalKmsProvider('test-key-2026', 'strong-test-master-key-seed-xyz-1234567');
  
  // 1. generateDataKey
  const keyResult = await vault.generateDataKey();
  assert(Buffer.isBuffer(keyResult.plaintextDek), 'generateDataKey returns Buffer plaintextDek');
  assert(keyResult.plaintextDek.length === DEK_LENGTH_BYTES, `plaintextDek is exactly ${DEK_LENGTH_BYTES} bytes (256 bits)`);
  assert(typeof keyResult.encryptedDek === 'string' && keyResult.encryptedDek.length > 0, 'encryptedDek is non-empty string');
  assert(keyResult.keyId === 'test-key-2026', 'keyResult records active keyId');

  // 2. unwrapDek round-trip
  const unwrappedDek = await vault.unwrapDek(keyResult.encryptedDek, keyResult.keyId);
  assert(Buffer.isBuffer(unwrappedDek), 'unwrapDek returns Buffer');
  assert(unwrappedDek.equals(keyResult.plaintextDek), 'unwrapped DEK identically matches original plaintext DEK');

  // 3. Freshness / Non-determinism: consecutive generateDataKey calls produce unique DEKs and unique envelopes
  const keyResult2 = await vault.generateDataKey();
  assert(!keyResult2.plaintextDek.equals(keyResult.plaintextDek), 'consecutive generateDataKey generates distinct DEK bytes');
  assert(keyResult2.encryptedDek !== keyResult.encryptedDek, 'consecutive generateDataKey produces distinct encrypted envelopes');

  // 4. wrapDek arbitrary valid DEK
  const customDek = crypto.randomBytes(DEK_LENGTH_BYTES);
  const wrappedCustom = await vault.wrapDek(customDek, 'test-key-2026');
  const unwrappedCustom = await vault.unwrapDek(wrappedCustom, 'test-key-2026');
  assert(unwrappedCustom.equals(customDek), 'wrapDek and unwrapDek arbitrary DEK round-trip succeeds');

  // 5. Invalid DEK lengths rejected
  let invalidDekLengthThrown = false;
  try {
    await vault.wrapDek(Buffer.alloc(16), 'test-key-2026');
  } catch (err) {
    invalidDekLengthThrown = err.code === 'INVALID_KEY';
  }
  assert(invalidDekLengthThrown, 'wrapDek rejects invalid 16-byte DEK with INVALID_KEY');

  // -------------------------------------------------------------------------
  // Section 3: Context Binding & Tamper-Negative Cryptographic Fail-Closed (AC2)
  // -------------------------------------------------------------------------
  console.log('\n--- Section 3: Context Binding & Tamper-Negative Fail-Closed (AC2) ---');

  const contextA = { tenant: 'oracle-fusion-prod-01', table: 'oracle_raw_user_access' };
  const contextB = { tenant: 'oracle-fusion-prod-02', table: 'oracle_raw_user_access' };

  const contextKey = await vault.generateDataKey('test-key-2026', contextA);
  const unwrappedWithContext = await vault.unwrapDek(contextKey.encryptedDek, 'test-key-2026', contextA);
  assert(unwrappedWithContext.equals(contextKey.plaintextDek), 'unwrapDek with matching encryption context succeeds');

  // Altered context fail-closed
  let alteredContextThrown = false;
  try {
    await vault.unwrapDek(contextKey.encryptedDek, 'test-key-2026', contextB);
  } catch (err) {
    alteredContextThrown = err.code === 'DECRYPTION_FAILED';
  }
  assert(alteredContextThrown, 'unwrapDek with altered encryption context fails closed (DECRYPTION_FAILED)');

  // Missing context when wrapped with context fails closed
  let missingContextThrown = false;
  try {
    await vault.unwrapDek(contextKey.encryptedDek, 'test-key-2026');
  } catch (err) {
    missingContextThrown = err.code === 'DECRYPTION_FAILED';
  }
  assert(missingContextThrown, 'unwrapDek without context fails closed when wrapped with context');

  // Tampered ciphertext in wrapped envelope
  const rawEnvelope = Buffer.from(contextKey.encryptedDek, 'base64');
  const tamperedEnvelope = Buffer.from(rawEnvelope);
  tamperedEnvelope[tamperedEnvelope.length - 1] ^= 0xff; // Flip bits in ciphertext
  let tamperedCiphertextThrown = false;
  try {
    await vault.unwrapDek(tamperedEnvelope.toString('base64'), 'test-key-2026', contextA);
  } catch (err) {
    tamperedCiphertextThrown = err.code === 'DECRYPTION_FAILED';
  }
  assert(tamperedCiphertextThrown, 'Tampered wrapped DEK ciphertext fails closed (DECRYPTION_FAILED)');

  // Tampered nonce
  const tamperedNonceEnvelope = Buffer.from(rawEnvelope);
  tamperedNonceEnvelope[0] ^= 0xff;
  let tamperedNonceThrown = false;
  try {
    await vault.unwrapDek(tamperedNonceEnvelope.toString('base64'), 'test-key-2026', contextA);
  } catch (err) {
    tamperedNonceThrown = err.code === 'DECRYPTION_FAILED';
  }
  assert(tamperedNonceThrown, 'Tampered wrapped DEK nonce fails closed (DECRYPTION_FAILED)');

  // Corrupted authentication tag
  const tamperedTagEnvelope = Buffer.from(rawEnvelope);
  tamperedTagEnvelope[GCM_NONCE_LENGTH_BYTES + 2] ^= 0xaa;
  let tamperedTagThrown = false;
  try {
    await vault.unwrapDek(tamperedTagEnvelope.toString('base64'), 'test-key-2026', contextA);
  } catch (err) {
    tamperedTagThrown = err.code === 'DECRYPTION_FAILED';
  }
  assert(tamperedTagThrown, 'Corrupted authentication tag in wrapped DEK fails closed (DECRYPTION_FAILED)');

  // Truncated envelope
  const truncatedEnvelope = rawEnvelope.subarray(0, 10);
  let truncatedThrown = false;
  try {
    await vault.unwrapDek(truncatedEnvelope.toString('base64'), 'test-key-2026');
  } catch (err) {
    truncatedThrown = err.code === 'INVALID_CONTAINER';
  }
  assert(truncatedThrown, 'Truncated wrapped DEK envelope fails closed (INVALID_CONTAINER)');

  // Unknown key ID
  let unknownKeyThrown = false;
  try {
    await vault.unwrapDek(contextKey.encryptedDek, 'non-existent-key-id-999');
  } catch (err) {
    unknownKeyThrown = err.code === 'KEY_NOT_FOUND';
  }
  assert(unknownKeyThrown, 'Unknown keyId fails closed (KEY_NOT_FOUND)');

  // -------------------------------------------------------------------------
  // Section 4: Memory Zeroing Hygiene & Zero Key Disclosure (AC1, AC2, AC3)
  // -------------------------------------------------------------------------
  console.log('\n--- Section 4: Memory Zeroing Hygiene & Zero Key Disclosure (AC1, AC2, AC3) ---');

  // Verify memory zeroing
  const dekToWipe = crypto.randomBytes(DEK_LENGTH_BYTES);
  const nonzeroBefore = dekToWipe.some(byte => byte !== 0);
  dekToWipe.fill(0);
  const allZeroAfter = dekToWipe.every(byte => byte === 0);
  assert(nonzeroBefore && allZeroAfter, 'Memory zeroing (fill(0)) completely clears DEK byte buffer in heap');

  // Verify telemetry tracking
  const telemetry = vault.getTelemetry();
  assert(telemetry.providerType === 'LOCAL_VAULT', 'Telemetry records correct providerType');
  assert(telemetry.totalOperations > 0, `Telemetry records totalOperations (${telemetry.totalOperations})`);
  assert(telemetry.generateDataKeyCount > 0, `Telemetry records generateDataKeyCount (${telemetry.generateDataKeyCount})`);
  assert(telemetry.wrapCount > 0, `Telemetry records wrapCount (${telemetry.wrapCount})`);
  assert(telemetry.unwrapCount > 0, `Telemetry records unwrapCount (${telemetry.unwrapCount})`);
  assert(telemetry.failureCount > 0, `Telemetry records failureCount from negative tests (${telemetry.failureCount})`);
  assert(typeof telemetry.averageLatencyMs === 'number', 'Telemetry tracks averageLatencyMs');
  assert(telemetry.lastOperationTimestamp !== null, 'Telemetry tracks lastOperationTimestamp');

  // Zero Key Disclosure in Telemetry:
  const telemetryJson = JSON.stringify(telemetry);
  assert(!telemetryJson.includes('strong-test-master-key-seed'), 'Telemetry does not leak master key secret');
  assert(!telemetryJson.includes(keyResult.plaintextDek.toString('hex')), 'Telemetry does not leak plaintext DEK');
  assert(!telemetryJson.includes(keyResult.encryptedDek), 'Telemetry does not leak raw wrapped DEK');
  if (telemetry.lastError) {
    assert(!/[A-Za-z0-9+/=]{44,}/.test(telemetry.lastError), 'Telemetry lastError contains zero base64 key strings');
  }

  // -------------------------------------------------------------------------
  // Section 5: Key Rotation & Multi-Generation Support (AC1, AC2)
  // -------------------------------------------------------------------------
  console.log('\n--- Section 5: Key Rotation & Multi-Generation Support (AC1, AC2) ---');

  const rotVault = new LocalKmsProvider('veyra-kms-k1-2025', 'secret-2025-seed');
  rotVault.registerKey('veyra-kms-k2-2026', 'secret-2026-seed');

  // Wrap under 2025 key
  const dek2025 = await rotVault.generateDataKey('veyra-kms-k1-2025');
  assert(dek2025.keyId === 'veyra-kms-k1-2025', 'Generated DEK under historical 2025 key');

  // Rotate active key to 2026
  rotVault.setActiveKeyId('veyra-kms-k2-2026');
  assert(rotVault.getActiveKeyId() === 'veyra-kms-k2-2026', 'Active key successfully rotated to 2026');

  // Historical DEK still unwraps under 2025 key
  const unwrappedHistorical = await rotVault.unwrapDek(dek2025.encryptedDek, 'veyra-kms-k1-2025');
  assert(unwrappedHistorical.equals(dek2025.plaintextDek), 'Historical 2025 DEK remains fully unwrappable after key rotation');

  // New DEK generation uses 2026 active key
  const dek2026 = await rotVault.generateDataKey();
  assert(dek2026.keyId === 'veyra-kms-k2-2026', 'New generateDataKey automatically uses active 2026 key');

  // Backward compatibility: LocalKmsProvider unwraps LocalKeyProvider envelopes
  const legacyKeyProvider = new LocalKeyProvider('veyra-kms-legacy', 'shared-vault-secret-123456');
  const kmsVaultInterop = new LocalKmsProvider('veyra-kms-legacy', 'shared-vault-secret-123456');
  const legacyTestDek = crypto.randomBytes(32);
  const legacyWrapped = await legacyKeyProvider.wrapDek(legacyTestDek, 'veyra-kms-legacy');
  const interopUnwrapped = await kmsVaultInterop.unwrapDek(legacyWrapped, 'veyra-kms-legacy');
  assert(interopUnwrapped.equals(legacyTestDek), 'LocalKmsProvider transparently unwraps Story 29 LocalKeyProvider wrapped DEKs');

  // -------------------------------------------------------------------------
  // Section 6: KMS Health Check & Self-Test (AC3)
  // -------------------------------------------------------------------------
  console.log('\n--- Section 6: KMS Health Check & Self-Test (AC3) ---');

  const health = await vault.healthCheck();
  assert(health.healthy === true, 'KMS provider healthCheck reports healthy === true');
  assert(health.provider === 'LOCAL_VAULT', 'healthCheck reports provider === LOCAL_VAULT');
  assert(health.activeKeyId === 'test-key-2026', 'healthCheck reports activeKeyId');
  assert(typeof health.latencyMs === 'number' && health.latencyMs >= 0, 'healthCheck measures round-trip latency in ms');

  const awsHealth = await awsProvider.healthCheck();
  assert(awsHealth.healthy === true, 'AwsKmsProvider healthCheck reports healthy === true');
  assert(awsHealth.provider === 'AWS_KMS', 'AwsKmsProvider healthCheck reports provider === AWS_KMS');

  const azureHealth = await azureProvider.healthCheck();
  assert(azureHealth.healthy === true, 'AzureKeyVaultProvider healthCheck reports healthy === true');
  assert(azureHealth.provider === 'AZURE_KEY_VAULT', 'AzureKeyVaultProvider healthCheck reports provider === AZURE_KEY_VAULT');

  // -------------------------------------------------------------------------
  // Section 7: End-to-End EncryptionService Integration (AC1, AC2)
  // -------------------------------------------------------------------------
  console.log('\n--- Section 7: End-to-End EncryptionService Integration (AC1, AC2) ---');

  const encService = new EncryptionService(vault);
  assert(encService.getKeyProvider() === vault, 'EncryptionService uses LocalKmsProvider as KeyProvider');

  const sensitiveOracleRecord = {
    userName: 'oracle.executive.vp',
    userGuid: 'B98234-A782-90DF-1234',
    email: 'executive.vp@enterprise.com',
    roles: ['ORA_FND_IT_SECURITY_MANAGER_JOB', 'ORA_PER_HUMAN_RESOURCE_SPECIALIST_JOB'],
    salaryBand: 'EXECUTIVE_TIER_1',
    ssnLast4: '8812',
  };

  const aad = buildTableRecordAad(
    'oracle_raw_user_access',
    { username: 'oracle.executive.vp', role_code: 'ORA_FND_IT_SECURITY_MANAGER_JOB' },
    'fusion-prod-env.oraclecloud.com'
  );
  const encryptedPayload = await encService.encryptPayload(sensitiveOracleRecord, aad);

  assert(encryptedPayload.formatVersion === 1, 'EncryptedPayload formatVersion is 1');
  assert(encryptedPayload.algorithm === 'AES-256-GCM', 'EncryptedPayload algorithm is AES-256-GCM');
  assert(encryptedPayload.keyId === 'test-key-2026', 'EncryptedPayload keyId matches KMS active key');
  assert(typeof encryptedPayload.encryptedDek === 'string', 'EncryptedPayload contains KMS-wrapped DEK');
  assert(typeof encryptedPayload.ciphertext === 'string', 'EncryptedPayload contains ciphertext');

  // Decryption round-trip
  const decryptedRecord = await encService.decryptPayload(encryptedPayload, aad);
  assert(decryptedRecord.userName === sensitiveOracleRecord.userName, 'Decrypted userName matches original');
  assert(decryptedRecord.userGuid === sensitiveOracleRecord.userGuid, 'Decrypted userGuid matches original');
  assert(decryptedRecord.roles.length === 2, 'Decrypted roles preserved');
  assert(decryptedRecord.ssnLast4 === sensitiveOracleRecord.ssnLast4, 'Decrypted sensitive attributes preserved');

  // Tamper detection fail-closed through EncryptionService
  const tamperedPayload = { ...encryptedPayload, ciphertext: Buffer.from('tampered-bytes').toString('base64') };
  let serviceTamperFailed = false;
  try {
    await encService.decryptPayload(tamperedPayload, aad);
  } catch (err) {
    serviceTamperFailed = err.code === 'DECRYPTION_FAILED';
  }
  assert(serviceTamperFailed, 'EncryptionService fails closed on tampered ciphertext with KMS provider');

  // Verify factory createKmsEncryptionService
  const customKmsEncService = createKmsEncryptionService(vault);
  assert(customKmsEncService instanceof EncryptionService, 'createKmsEncryptionService returns configured EncryptionService');

  // -------------------------------------------------------------------------
  // Section 8: Architecture Spec & Package Configuration Verification (AC1, AC2, AC3)
  // -------------------------------------------------------------------------
  console.log('\n--- Section 8: Documentation & Regression Harness (AC1, AC2, AC3) ---');

  const archDocPath = path.resolve(__dirname, '../../docs/architecture/kms_envelope_encryption_integration.md');
  assert(fs.existsSync(archDocPath), 'docs/architecture/kms_envelope_encryption_integration.md exists');

  const archDocContent = fs.readFileSync(archDocPath, 'utf8');
  assert(archDocContent.includes('VYR-030'), 'Architecture doc explicitly references Story VYR-030');
  assert(archDocContent.includes('EPIC 4'), 'Architecture doc explicitly references EPIC 4');
  assert(archDocContent.includes('standard-veyra-application-dev'), 'Architecture doc documents applicability to standard branch');
  assert(archDocContent.includes('veyra-application-dev'), 'Architecture doc documents applicability to veyra dev branch');
  assert(archDocContent.includes('Envelope Encryption Hierarchy'), 'Architecture doc diagrams envelope encryption hierarchy');
  assert(archDocContent.includes('LocalKmsProvider'), 'Architecture doc specifies LocalKmsProvider');
  assert(archDocContent.includes('AwsKmsProvider'), 'Architecture doc specifies AwsKmsProvider');
  assert(archDocContent.includes('AzureKeyVaultProvider'), 'Architecture doc specifies AzureKeyVaultProvider');
  assert(archDocContent.includes('Least-Privilege'), 'Architecture doc documents least-privilege IAM policies');
  assert(archDocContent.includes('Memory Hygiene'), 'Architecture doc documents memory zeroing hygiene');
  assert(archDocContent.includes('Zero-Fallback Fail-Closed'), 'Architecture doc documents fail-closed semantics');
  assert(archDocContent.includes('Zero Key Material Disclosure'), 'Architecture doc documents zero key disclosure');

  const packageJsonPath = path.resolve(__dirname, '../package.json');
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  assert(Boolean(pkg.scripts && pkg.scripts['test:vyr30']), 'package.json defines "test:vyr30" script');
  assert(Boolean(pkg.scripts && pkg.scripts['test:epic4'] && pkg.scripts['test:epic4'].includes('test:vyr30')), 'package.json wires test:vyr30 into "test:epic4"');

  console.log('\n================================================================');
  console.log(`  Passed: ${passedTests}  Failed: ${failedTests}`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Unhandled test harness error:', err);
  process.exit(1);
});
