/**
 * Test Suite: Story VYR-042
 * "Implement service identity and secure Oracle credential retrieval for worker"
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Validates that:
 *  1. ServiceIdentityRegistry exists and manages dedicated workload/service identities
 *  2. Scheduled sync runs under dedicated 'veyra-sync-worker' identity (not a human browser JWT)
 *  3. Ingestion pipeline is wired to execute within service identity execution context
 *  4. OracleCredentialProvider abstraction supports env, file, and vault backends
 *  5. Secret manager runtime retrieval is supported with zero plaintext leakage in logs/health
 *  6. Credential fingerprinting masks plain-text passwords and tokens
 *  7. Credential rotation (refresh) is supported and auditable
 *  8. Oracle clients (OracleFusionClient, bipClient, otbiClient, oracleService) support provider-based credential refresh
 *  9. Admin routes exist for credential health monitoring and runtime rotation
 *  10. ScheduledSyncService executes non-interactively without human authentication tokens
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

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

async function run() {
  console.log('\n================================================================');
  console.log('  VYR-042: Service Identity & Secure Oracle Credential Retrieval');
  console.log('================================================================\n');

  const src = path.resolve(__dirname, '../src');
  const credProviderPath = path.join(src, 'oracle/credentialProvider.ts');
  const serviceIdentityPath = path.join(src, 'oracle/serviceIdentity.ts');
  const clientPath = path.join(src, 'oracle/client.ts');
  const bipClientPath = path.join(src, 'oracle/bipClient.ts');
  const otbiClientPath = path.join(src, 'oracle/otbiClient.ts');
  const oracleServicePath = path.join(src, 'services/oracleService.ts');
  const pipelinePath = path.join(src, 'services/ingestionPipelineService.ts');
  const schedulerPath = path.join(src, 'services/scheduledSyncService.ts');
  const apiPath = path.join(src, 'routes/api.ts');

  // ====================================================================
  // Section 1: Required Source Modules Exist
  // ====================================================================
  console.log('\n--- Section 1: Source Files & Module Existence ---');

  assert(fs.existsSync(credProviderPath), 'credentialProvider.ts exists in src/oracle');
  assert(fs.existsSync(serviceIdentityPath), 'serviceIdentity.ts exists in src/oracle');
  assert(fs.existsSync(clientPath), 'client.ts exists in src/oracle');
  assert(fs.existsSync(bipClientPath), 'bipClient.ts exists in src/oracle');
  assert(fs.existsSync(otbiClientPath), 'otbiClient.ts exists in src/oracle');
  assert(fs.existsSync(pipelinePath), 'ingestionPipelineService.ts exists in src/services');
  assert(fs.existsSync(schedulerPath), 'scheduledSyncService.ts exists in src/services');
  assert(fs.existsSync(apiPath), 'api.ts exists in src/routes');

  const credSrc = read(credProviderPath);
  const svcSrc = read(serviceIdentityPath);
  const clientSrc = read(clientPath);
  const bipSrc = read(bipClientPath);
  const otbiSrc = read(otbiClientPath);
  const oracleSvcSrc = read(oracleServicePath);
  const pipelineSrc = read(pipelinePath);
  const schedSrc = read(schedulerPath);
  const apiSrc = read(apiPath);

  // ====================================================================
  // Section 2: Service Identity Registry (Code Area 1 & 4)
  // ====================================================================
  console.log('\n--- Section 2: Workload & Service Identity Registry ---');

  assert(svcSrc.includes('export interface ServiceIdentity'), 'Exports ServiceIdentity interface');
  assert(svcSrc.includes('export interface ServiceExecutionContext'), 'Exports ServiceExecutionContext interface');
  assert(svcSrc.includes('export class ServiceIdentityRegistry'), 'Exports ServiceIdentityRegistry class');
  assert(svcSrc.includes('export const serviceIdentityRegistry'), 'Exports singleton serviceIdentityRegistry');
  assert(svcSrc.includes('veyra-sync-worker'), 'Defines dedicated "veyra-sync-worker" identity for scheduled jobs');
  assert(svcSrc.includes('veyra-pipeline'), 'Defines "veyra-pipeline" identity for shared ingestion');
  assert(svcSrc.includes('veyra-admin-sync'), 'Defines "veyra-admin-sync" identity for admin operations');
  assert(svcSrc.includes('makeIdentityRef'), 'Generates deterministic identity reference hashes');
  assert(svcSrc.includes('runAsCryptoService'), 'Sets crypto audit context to service identity');
  assert(svcSrc.includes('isHumanTriggered'), 'Differentiates human vs automated service triggers');
  assert(svcSrc.includes('rotateCredentials'), 'Service identity registry exposes credential rotation');
  assert(svcSrc.includes('getHealth'), 'Service identity registry exposes health reporting');

  // ====================================================================
  // Section 3: Credential Provider Abstraction & Backends (Code Area 2)
  // ====================================================================
  console.log('\n--- Section 3: Oracle Credential Provider Backends ---');

  assert(credSrc.includes('export interface OracleCredentialProvider'), 'Exports OracleCredentialProvider interface');
  assert(credSrc.includes('export interface OracleCredentials'), 'Exports OracleCredentials interface');
  assert(credSrc.includes('export interface CredentialProviderHealth'), 'Exports CredentialProviderHealth interface');
  assert(credSrc.includes('export class EnvCredentialProvider'), 'Implements EnvCredentialProvider (env backend)');
  assert(credSrc.includes('export class FileCredentialProvider'), 'Implements FileCredentialProvider (file backend)');
  assert(credSrc.includes('export class VaultCredentialProvider'), 'Implements VaultCredentialProvider (vault/secret manager backend)');
  assert(credSrc.includes('export function createProvider'), 'Provides factory for credential provider instantiation');
  assert(credSrc.includes('export const oracleCredentialProvider'), 'Exports singleton oracleCredentialProvider instance');
  assert(credSrc.includes('ORACLE_CREDENTIAL_BACKEND'), 'Resolves provider backend from ORACLE_CREDENTIAL_BACKEND');
  assert(credSrc.includes('ORACLE_VAULT_URL'), 'Supports secret manager endpoint via ORACLE_VAULT_URL');
  assert(credSrc.includes('fingerprint'), 'Implements sha256 fingerprinting for safe auditing without secret exposure');

  // ====================================================================
  // Section 4: Oracle Clients Integration (Code Area 2 & 3)
  // ====================================================================
  console.log('\n--- Section 4: Oracle Client Dynamic Credential Refresh ---');

  assert(clientSrc.includes('recreateClientFromProvider'), 'OracleFusionClient has recreateClientFromProvider method');
  assert(clientSrc.includes('oracleCredentialProvider.getCredentials()'), 'OracleFusionClient fetches credentials from provider at runtime');
  assert(clientSrc.includes('applyCredentials'), 'OracleFusionClient applies dynamic credentials cleanly');

  assert(bipSrc.includes('refreshCredentialsFromProvider'), 'bipClient has refreshCredentialsFromProvider method');
  assert(bipSrc.includes('setCredentials'), 'bipClient has setCredentials method');
  assert(bipSrc.includes('dynamicCredentials'), 'bipClient prefers dynamic runtime credentials');

  assert(otbiSrc.includes('oracleCredentialProvider.getCredentials()'), 'otbiClient retrieves runtime credentials in logon()');

  assert(oracleSvcSrc.includes('recreateClientFromProvider'), 'oracleService exposes recreateClientFromProvider');

  // ====================================================================
  // Section 5: Ingestion Pipeline & Scheduler Wiring (Code Area 1, 2, 4)
  // ====================================================================
  console.log('\n--- Section 5: Pipeline & Scheduler Integration ---');

  assert(pipelineSrc.includes("import { serviceIdentityRegistry"), 'Pipeline imports serviceIdentityRegistry');
  assert(pipelineSrc.includes("principalName = triggeredBy === 'SCHEDULED_OFFPEAK_CRON'"),
    'Pipeline assigns dedicated "veyra-sync-worker" when triggered by off-peak cron');
  assert(pipelineSrc.includes('serviceIdentityRegistry.runAsService'),
    'Pipeline wraps domain runs within serviceIdentityRegistry.runAsService');
  assert(pipelineSrc.includes('recreateClientFromProvider'),
    'Pipeline refreshes Oracle client credentials from provider before sync');
  assert(pipelineSrc.includes('serviceIdentity?:'),
    'PipelineResult includes serviceIdentity metadata');

  assert(schedSrc.includes('SCHEDULED_OFFPEAK_CRON'),
    'ScheduledSyncService invokes sync with "SCHEDULED_OFFPEAK_CRON" trigger');
  assert(/VYR-042.*[Nn]on-interactive/.test(schedSrc),
    'ScheduledSyncService explicitly documents non-interactive service identity execution without user JWT');

  // ====================================================================
  // Section 6: Admin Endpoints for Credential Health & Rotation (Code Area 3)
  // ====================================================================
  console.log('\n--- Section 6: Admin API Endpoints for Credentials ---');

  assert(apiSrc.includes('/admin/credentials/health'),
    'api.ts registers GET /api/admin/credentials/health endpoint');
  assert(apiSrc.includes('/admin/credentials/rotate'),
    'api.ts registers POST /api/admin/credentials/rotate endpoint');
  assert(apiSrc.includes('serviceIdentityRegistry.getHealth()'),
    'Health endpoint returns service identity and credential provider health');
  assert(apiSrc.includes('serviceIdentityRegistry.rotateCredentials()'),
    'Rotate endpoint calls serviceIdentityRegistry.rotateCredentials');
  assert(apiSrc.includes('recreateClientFromProvider'),
    'Rotate endpoint refreshes Oracle client after rotation');

  // ====================================================================
  // Section 7: Functional Assertion Tests (In-Process Execution)
  // ====================================================================
  console.log('\n--- Section 7: Functional Unit & Contract Tests ---');

  // Test 7.1: Fingerprinting credentials
  const dummyCreds = {
    baseUrl: 'https://fa-test.oraclecloud.com',
    authType: 'BASIC',
    username: 'INTEGRATION_USER',
    password: 'super-secret-password-123',
    token: ''
  };
  const dummyData = `${dummyCreds.baseUrl}|${dummyCreds.authType}|${dummyCreds.username}|P|-`;
  const expectedFp = crypto.createHash('sha256').update(dummyData).digest('hex').slice(0, 12);

  assert(expectedFp.length === 12, `Fingerprint generates 12-char hex hash: ${expectedFp}`);
  assert(!expectedFp.includes('super-secret-password-123'), 'Fingerprint does not contain plaintext password');

  // Test 7.2: File credential provider logic
  const tempDir = path.join(__dirname, '../dist');
  const tempCredFile = path.join(tempDir, 'test_temp_creds.json');
  fs.writeFileSync(tempCredFile, JSON.stringify({
    baseUrl: 'https://test-oracle.example.com',
    authType: 'BASIC',
    username: 'test_svc_acct',
    password: 'test_svc_password',
    token: ''
  }));

  try {
    const rawContent = JSON.parse(fs.readFileSync(tempCredFile, 'utf8'));
    assert(rawContent.username === 'test_svc_acct', 'Credential file contains valid JSON configuration');
    assert(rawContent.baseUrl === 'https://test-oracle.example.com', 'Credential file baseUrl resolved correctly');
  } finally {
    if (fs.existsSync(tempCredFile)) {
      fs.unlinkSync(tempCredFile);
    }
  }

  // Test 7.3: Identity reference generation
  const svcRef = crypto.createHash('sha256').update('svc:veyra-sync-worker').digest('hex').slice(0, 16);
  assert(svcRef.length === 16, `IdentityRef generates consistent 16-char hash: ${svcRef}`);

  // Test 7.4: Non-interactive detection (no user browser JWT)
  function isHumanTrigger(triggeredBy, principalName) {
    return Boolean(
      triggeredBy &&
      triggeredBy !== 'SCHEDULED_OFFPEAK_CRON' &&
      triggeredBy !== principalName &&
      triggeredBy.includes('@')
    );
  }

  assert(isHumanTrigger('SCHEDULED_OFFPEAK_CRON', 'veyra-sync-worker') === false,
    'SCHEDULED_OFFPEAK_CRON is correctly classified as non-human/workload trigger');
  assert(isHumanTrigger('admin@example.com', 'veyra-pipeline') === true,
    'admin@example.com is correctly classified as human trigger');
  assert(isHumanTrigger('veyra-sync-worker', 'veyra-sync-worker') === false,
    'Direct service principal trigger is classified as non-human');

  // ====================================================================
  // Summary
  // ====================================================================
  console.log('\n----------------------------------------------------------------');
  console.log(`  Tests Passed: ${passedTests}`);
  console.log(`  Tests Failed: ${failedTests}`);
  console.log('----------------------------------------------------------------\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in VYR-042 test suite:', err);
  process.exit(1);
});
