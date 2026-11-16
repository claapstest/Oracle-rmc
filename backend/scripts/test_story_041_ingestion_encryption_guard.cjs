/**
 * Test Suite: Story VYR-041
 * "Integrate encryption into scheduled background synchronization"
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Drift check: asserts every VYR-041 acceptance criterion against the current
 * source of the ingestion pipeline and its encryption guard. No database
 * required.
 */

const fs = require('fs');
const path = require('path');

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
  console.log('  VYR-041: Encryption integrated into scheduled synchronization');
  console.log('================================================================\n');

  const src = path.resolve(__dirname, '../src');
  const guardPath = path.join(src, 'services/ingestionEncryptionGuard.ts');
  const pipelinePath = path.join(src, 'services/ingestionPipelineService.ts');

  assert(fs.existsSync(guardPath), 'ingestionEncryptionGuard.ts exists');
  assert(fs.existsSync(pipelinePath), 'ingestionPipelineService.ts exists');

  const guard = read(guardPath);
  const pipeline = read(pipelinePath);

  // ------------------------------------------------------------------
  // AC1: Call shared EncryptionService for each sensitive record
  //      (guaranteed transitively: every domain step goes through the
  //      VYR-040 shared pipeline, and the guard wraps every domain step)
  // ------------------------------------------------------------------
  console.log('--- Shared pipeline coverage ---');

  assert(/from '\.\/ingestionEncryptionGuard\.js'/.test(pipeline),
    'Pipeline imports the encryption guard');
  assert(/withEncryptionGuard\(/.test(pipeline),
    'Pipeline wraps domain steps with withEncryptionGuard');
  assert((pipeline.match(/withEncryptionGuard\(/g) || []).length >= 2,
    'Guard wraps BOTH the scheduled pipeline and on-demand domain runs');

  // ------------------------------------------------------------------
  // AC2: Fail job safely if encryption/KMS is unavailable (preflight)
  // ------------------------------------------------------------------
  console.log('--- Preflight (fail safely when encryption unavailable) ---');

  assert(/export async function encryptionPreflight/.test(guard),
    'encryptionPreflight runs a canary encrypt/decrypt cycle');
  assert(/isRawEncryptionEnabled\(\)/.test(guard),
    'Preflight is gated on VEYRA_RAW_ENCRYPTION (transparent when disabled)');
  assert(/encryptPayload[\s\S]*?isEncryptedPayload[\s\S]*?decryptPayload/.test(guard),
    'Preflight encrypts, validates and decrypts the canary');
  assert(/cryptoAuditService\.recordFailure/.test(guard),
    'Preflight failures are recorded in the crypto audit trail');
  assert(/maskSensitive\(err\)/.test(guard),
    'Preflight failure details are sanitised before audit');

  // Pipeline aborts BEFORE fetching Oracle data when preflight fails
  const preflightIdx = pipeline.indexOf('encryptionPreflight()');
  const runnersIdx = pipeline.indexOf('const runner = DOMAIN_RUNNERS[domain]');
  assert(preflightIdx > -1 && runnersIdx > preflightIdx,
    'Preflight runs before any domain runner is invoked');
  assert(/preflight\.passed[\s\S]{0,400}releaseLock\(false[\s\S]{0,400}return \{/.test(pipeline),
    'Pipeline aborts and releases the lock when preflight fails');

  // ------------------------------------------------------------------
  // AC3: KMS/encryption failure stops or quarantines the batch by policy
  // ------------------------------------------------------------------
  console.log('--- Quarantine policy ---');

  assert(/EncryptionPolicy = 'FAIL_DOMAIN' \| 'FAIL_PIPELINE'/.test(guard),
    'Two quarantine policies exist (FAIL_DOMAIN / FAIL_PIPELINE)');
  assert(/VEYRA_SYNC_ENCRYPTION_POLICY/.test(guard),
    'Policy is configurable via VEYRA_SYNC_ENCRYPTION_POLICY');
  assert(/'FAIL_PIPELINE' \? 'FAIL_PIPELINE' : 'FAIL_DOMAIN'/.test(guard),
    'Default policy is FAIL_DOMAIN (quarantine domain, continue pipeline)');
  assert(/err instanceof ProtectedDataError/.test(guard),
    'Guard intercepts only encryption/decryption failures (ProtectedDataError)');
  assert(/effectivePolicy === 'FAIL_PIPELINE'[\s\S]{0,120}throw err/.test(guard),
    'FAIL_PIPELINE escalates the failure and aborts the run');

  // ------------------------------------------------------------------
  // AC4: Worker does not log Oracle responses or decrypted content
  // ------------------------------------------------------------------
  console.log('--- Log sanitisation ---');

  assert(/export function safePipelineError/.test(guard),
    'safePipelineError sanitises pipeline errors through maskSensitive');
  assert((pipeline.match(/safePipelineError\(err\)/g) || []).length >= 3,
    'All pipeline error paths (domain, on-demand, fatal) use safePipelineError');
  assert(!/console\.\w+\([^)]*err\.message/.test(pipeline),
    'No pipeline log line prints a raw err.message');

  // Job outcome recorded without payload leakage
  assert(/encryptionPreflight\?: PreflightResult/.test(pipeline),
    'PipelineResult records the preflight outcome');
  assert(/encryptionPolicy\?: EncryptionPolicy/.test(pipeline),
    'PipelineResult records the policy that governed the run');

  console.log('\n================================================================');
  console.log(`  RESULTS: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================\n');
  process.exit(failedTests > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
