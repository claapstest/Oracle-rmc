/**
 * Test Suite: Story VYR-044
 * "Implement retries, idempotency, pagination and partial-failure recovery"
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Validates that:
 *  1. ResilienceService exists and implements bounded exponential backoff with jitter
 *  2. Transient errors (429, 500-504, network drops) are retried with backoff and jitter
 *  3. Permanent errors (400, 401, 403, 404) are NOT retried indefinitely (AC 4)
 *  4. Oracle pagination and rate-limit responses (Retry-After) are respected
 *  5. Stable unique record keys/hashes make reprocessing idempotent (AC 1)
 *  6. Checkpoints/watermarks persist only AFTER successful batch persistence (AC 2)
 *  7. Dead-letter queue / quarantine handling captures malformed records (AC 3)
 *  8. veyra_sync_checkpoints and veyra_sync_quarantine database migration DDL exists
 *  9. Admin routes exist for inspecting checkpoints and quarantine records
 * 10. IngestionPipeline integrates resilience, checkpoints, and partial-failure recovery
 */

process.env.TEST_OFFLINE = 'true';

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
  console.log('  VYR-044: Retries, Idempotency, Pagination & Partial Failure Recovery');
  console.log('================================================================\n');

  const src = path.resolve(__dirname, '../src');
  const root = path.resolve(__dirname, '../..');
  const resilienceServicePath = path.join(src, 'oracle/resilienceService.ts');
  const checkpointServicePath = path.join(src, 'services/syncCheckpointService.ts');
  const pipelinePath = path.join(src, 'services/ingestionPipelineService.ts');
  const apiPath = path.join(src, 'routes/api.ts');
  const migrationPath = path.join(root, 'database/migrations/1711000000023_create_veyra_sync_checkpoints_and_quarantine_tables.cjs');

  // ====================================================================
  // Section 1: Required Source Modules & Migrations Exist
  // ====================================================================
  console.log('--- Section 1: Source Files & Migration Existence ---');

  assert(fs.existsSync(resilienceServicePath), 'resilienceService.ts exists in src/oracle');
  assert(fs.existsSync(checkpointServicePath), 'syncCheckpointService.ts exists in src/services');
  assert(fs.existsSync(pipelinePath), 'ingestionPipelineService.ts exists in src/services');
  assert(fs.existsSync(apiPath), 'api.ts exists in src/routes');
  assert(fs.existsSync(migrationPath), '1711000000023_create_veyra_sync_checkpoints_and_quarantine_tables.cjs exists in database/migrations');

  const resilienceSrc = read(resilienceServicePath);
  const checkpointSrc = read(checkpointServicePath);
  const pipelineSrc = read(pipelinePath);
  const apiSrc = read(apiPath);
  const migrationSrc = read(migrationPath);

  // ====================================================================
  // Section 2: Error Classification (Transient vs Permanent)
  // ====================================================================
  console.log('\n--- Section 2: Error Classification (Transient vs Permanent) ---');

  assert(resilienceSrc.includes('isTransientError'), 'resilienceService exports isTransientError function');
  assert(resilienceSrc.includes('status === 429'), 'HTTP 429 rate-limited responses classified as transient');
  assert(resilienceSrc.includes('status >= 500 && status <= 504'), 'HTTP 500-504 server/gateway errors classified as transient');
  assert(resilienceSrc.includes('ECONNRESET'), 'Socket resets classified as transient');
  assert(resilienceSrc.includes('ETIMEDOUT'), 'Connection timeouts classified as transient');
  assert(resilienceSrc.includes('status >= 400 && status < 500'), 'HTTP 4xx client errors (400, 401, 403, 404) classified as non-transient');

  // Load compiled or TypeScript module via dynamic import or direct logic simulation
  const { isTransientError, getRetryAfterMs, computeBackoffWithJitter, executeWithRetry, computeRecordHash, deduplicateBatch } =
    await import('../dist/oracle/resilienceService.js');

  assert(isTransientError({ response: { status: 429 } }) === true, 'Status 429 is transient');
  assert(isTransientError({ response: { status: 503 } }) === true, 'Status 503 is transient');
  assert(isTransientError({ response: { status: 502 } }) === true, 'Status 502 is transient');
  assert(isTransientError({ code: 'ECONNRESET' }) === true, 'ECONNRESET code is transient');
  assert(isTransientError({ code: 'ETIMEDOUT' }) === true, 'ETIMEDOUT code is transient');
  assert(isTransientError({ response: { status: 401 } }) === false, 'Status 401 (auth failed) is PERMANENT');
  assert(isTransientError({ response: { status: 403 } }) === false, 'Status 403 (forbidden) is PERMANENT');
  assert(isTransientError({ response: { status: 404 } }) === false, 'Status 404 (not found) is PERMANENT');
  assert(isTransientError({ response: { status: 400 } }) === false, 'Status 400 (bad request) is PERMANENT');

  // ====================================================================
  // Section 3: Bounded Exponential Backoff with Jitter (Step 1 & AC 4)
  // ====================================================================
  console.log('\n--- Section 3: Bounded Exponential Backoff with Jitter ---');

  assert(resilienceSrc.includes('computeBackoffWithJitter'), 'Exports computeBackoffWithJitter function');
  assert(resilienceSrc.includes('executeWithRetry'), 'Exports executeWithRetry helper');
  assert(resilienceSrc.includes('maxAttempts'), 'RetryConfig specifies maxAttempts for bounded retry');
  assert(resilienceSrc.includes('maxDelayMs'), 'RetryConfig bounds delays via maxDelayMs');

  // Verify backoff delay calculation is strictly bounded
  const delay1 = computeBackoffWithJitter(1, { baseDelayMs: 100, maxDelayMs: 1000, multiplier: 2, jitter: false });
  const delay2 = computeBackoffWithJitter(2, { baseDelayMs: 100, maxDelayMs: 1000, multiplier: 2, jitter: false });
  const delay3 = computeBackoffWithJitter(3, { baseDelayMs: 100, maxDelayMs: 1000, multiplier: 2, jitter: false });
  const delayCapped = computeBackoffWithJitter(10, { baseDelayMs: 100, maxDelayMs: 1000, multiplier: 2, jitter: false });

  assert(delay1 === 100, 'Attempt 1 delay matches baseDelay (100ms)');
  assert(delay2 === 200, 'Attempt 2 delay doubles with multiplier 2 (200ms)');
  assert(delay3 === 400, 'Attempt 3 delay quadruples with multiplier 2 (400ms)');
  assert(delayCapped === 1000, 'Delay is strictly capped at maxDelayMs (1000ms)');

  // Verify jitter produces non-zero randomized delays within bounded range
  const jitteredA = computeBackoffWithJitter(2, { baseDelayMs: 100, maxDelayMs: 1000, multiplier: 2, jitter: true });
  const jitteredB = computeBackoffWithJitter(2, { baseDelayMs: 100, maxDelayMs: 1000, multiplier: 2, jitter: true });
  assert(jitteredA >= 100 && jitteredA <= 200, 'Jittered delay stays within valid bounded range [100, 200]');
  assert(typeof jitteredB === 'number', 'Jitter returns valid number');

  // Verify executeWithRetry on immediate success
  let callsSuccess = 0;
  const immediateRes = await executeWithRetry(async () => {
    callsSuccess++;
    return 'SUCCESS_DATA';
  }, { maxAttempts: 3, baseDelayMs: 10 });
  assert(immediateRes.result === 'SUCCESS_DATA', 'executeWithRetry returns result on immediate success');
  assert(immediateRes.attempts === 1, 'Immediate success completes in 1 attempt');
  assert(callsSuccess === 1, 'Operation called exactly once on first try success');

  // Verify executeWithRetry succeeds after transient error
  let callsTransient = 0;
  const retryRes = await executeWithRetry(async (attempt) => {
    callsTransient++;
    if (attempt < 2) {
      const err = new Error('Transient 503');
      (err).response = { status: 503 };
      throw err;
    }
    return 'RECOVERED_DATA';
  }, { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50, jitter: false });
  assert(retryRes.result === 'RECOVERED_DATA', 'Operation recovers after transient error');
  assert(retryRes.attempts === 2, 'Operation succeeded on attempt 2');
  assert(callsTransient === 2, 'Operation was called exactly twice');

  // Verify AC 4: Permanent errors fail immediately without retry
  let callsPermanent = 0;
  let caughtPermanentError = false;
  try {
    await executeWithRetry(async () => {
      callsPermanent++;
      const err = new Error('Oracle 401 Unauthorized');
      (err).response = { status: 401 };
      throw err;
    }, { maxAttempts: 3, baseDelayMs: 10 });
  } catch (err) {
    caughtPermanentError = true;
  }
  assert(caughtPermanentError, 'Permanent error rethrows to caller');
  assert(callsPermanent === 1, 'AC 4: Permanent error is NOT retried (called exactly 1 time, not 3)');

  // Verify transient errors exhaust bounded retries
  let callsExhausted = 0;
  let caughtExhausted = false;
  try {
    await executeWithRetry(async () => {
      callsExhausted++;
      const err = new Error('Persistent 504 Gateway Timeout');
      (err).response = { status: 504 };
      throw err;
    }, { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 30, jitter: false });
  } catch {
    caughtExhausted = true;
  }
  assert(caughtExhausted, 'Exhausted transient error throws after max attempts');
  assert(callsExhausted === 3, 'AC 1: Retry is bounded by maxAttempts (3 attempts made)');

  // ====================================================================
  // Section 4: Rate Limiting & Retry-After Compliance (Step 2)
  // ====================================================================
  console.log('\n--- Section 4: Rate Limiting & Retry-After Compliance ---');

  assert(resilienceSrc.includes('getRetryAfterMs'), 'Exports getRetryAfterMs helper');
  assert(resilienceSrc.includes('throttleBetweenPages'), 'Exports throttleBetweenPages helper');

  const errWithSeconds = { response: { headers: { 'retry-after': '12' } } };
  assert(getRetryAfterMs(errWithSeconds) === 12000, 'Parses integer seconds Retry-After header into milliseconds (12000ms)');

  const errWithCapitalHeader = { response: { headers: { 'Retry-After': '5' } } };
  assert(getRetryAfterMs(errWithCapitalHeader) === 5000, 'Parses case-insensitive Retry-After header (5000ms)');

  assert(getRetryAfterMs({ response: { headers: {} } }, 3000) === null, 'Returns null when no Retry-After header present');

  // ====================================================================
  // Section 5: Stable Record Keys & Idempotency (Step 3 & AC 1)
  // ====================================================================
  console.log('\n--- Section 5: Stable Record Keys & Idempotency ---');

  assert(resilienceSrc.includes('computeRecordHash'), 'Exports computeRecordHash function');
  assert(resilienceSrc.includes('deduplicateBatch'), 'Exports deduplicateBatch function');

  // Deterministic hashing for users
  const user1 = { id: 'usr_001', userName: 'JSMITH', email: 'jsmith@example.com' };
  const user1Copy = { id: 'usr_001', userName: 'JSMITH', email: 'jsmith@example.com' };
  const user2 = { id: 'usr_002', userName: 'ALICEC', email: 'alicec@example.com' };

  const hashUser1 = computeRecordHash('users', user1);
  const hashUser1Copy = computeRecordHash('users', user1Copy);
  const hashUser2 = computeRecordHash('users', user2);

  assert(hashUser1.length === 64, 'Record hash is valid 64-char SHA-256 hex string');
  assert(hashUser1 === hashUser1Copy, 'Identical records produce identical hash (idempotent key)');
  assert(hashUser1 !== hashUser2, 'Different records produce distinct hashes');

  // In-batch deduplication
  const mixedBatch = [user1, user2, user1Copy];
  const { uniqueRecords, duplicatesCount, hashes } = deduplicateBatch('users', mixedBatch);
  assert(uniqueRecords.length === 2, 'deduplicateBatch filters duplicate entries');
  assert(duplicatesCount === 1, 'Duplicate count accurately tracks 1 duplicate removed');
  assert(hashes.length === 2, 'Emits 2 unique hashes');

  // ====================================================================
  // Section 6: Checkpoints & Watermark State Management (Step 4 & AC 2)
  // ====================================================================
  console.log('\n--- Section 6: Checkpoints & Watermark State Management ---');

  assert(checkpointSrc.includes('SyncCheckpointService'), 'syncCheckpointService class is defined');
  assert(checkpointSrc.includes('commitCheckpoint'), 'commitCheckpoint method exists');
  assert(checkpointSrc.includes('getCheckpoint'), 'getCheckpoint method exists');
  assert(checkpointSrc.includes('startCheckpoint'), 'startCheckpoint method exists');
  assert(checkpointSrc.includes('failCheckpoint'), 'failCheckpoint method exists');
  assert(checkpointSrc.includes('listCheckpoints'), 'listCheckpoints method exists');

  const { syncCheckpointService } = await import('../dist/services/syncCheckpointService.js');

  // Start checkpoint
  const startedCp = await syncCheckpointService.startCheckpoint('controls', 'tenant_test');
  assert(startedCp.domain === 'controls', 'Started checkpoint has correct domain');
  assert(startedCp.status === 'IN_PROGRESS', 'Started checkpoint has status IN_PROGRESS');
  assert(startedCp.lastSuccessfulBatch === 0, 'Unpersisted checkpoint starts at batch 0');

  // Commit batch 1
  const cpBatch1 = await syncCheckpointService.commitCheckpoint({
    domain: 'controls',
    tenantId: 'tenant_test',
    batchNumber: 1,
    watermarkTimestamp: '2026-11-16T10:00:00.000Z',
    cursor: 'page_1_token',
    persistedInBatch: 50,
  });
  assert(cpBatch1.lastSuccessfulBatch === 1, 'AC 2: Checkpoint advances to batch 1 after persistence');
  assert(cpBatch1.recordsPersisted === 50, 'Records persisted increments to 50');
  assert(cpBatch1.watermarkCursor === 'page_1_token', 'Cursor advances to page_1_token');

  // Commit batch 2
  const cpBatch2 = await syncCheckpointService.commitCheckpoint({
    domain: 'controls',
    tenantId: 'tenant_test',
    batchNumber: 2,
    watermarkTimestamp: '2026-11-16T11:00:00.000Z',
    cursor: 'page_2_token',
    persistedInBatch: 30,
    isComplete: true,
  });
  assert(cpBatch2.lastSuccessfulBatch === 2, 'Checkpoint advances to batch 2');
  assert(cpBatch2.recordsPersisted === 80, 'Records persisted accumulates (50 + 30 = 80)');
  assert(cpBatch2.status === 'SUCCESS', 'Completed checkpoint marked SUCCESS');

  // Verify failure preserves watermark (does not advance past unpersisted data)
  await syncCheckpointService.startCheckpoint('audit', 'tenant_test');
  await syncCheckpointService.commitCheckpoint({
    domain: 'audit',
    tenantId: 'tenant_test',
    batchNumber: 1,
    cursor: 'audit_cursor_1',
    persistedInBatch: 100,
  });
  // Simulate batch 2 failure during fetch/persistence
  const failedCp = await syncCheckpointService.failCheckpoint('audit', 'Network disconnect during batch 2', 'tenant_test');
  assert(failedCp.status === 'FAILED', 'Failed checkpoint status marked FAILED');
  assert(failedCp.lastSuccessfulBatch === 1, 'AC 2: Watermark does NOT advance past unpersisted batch (remains at batch 1)');
  assert(failedCp.recordsPersisted === 100, 'Records persisted remains at 100');

  // ====================================================================
  // Section 7: Dead-Letter Queue & Quarantine Handling (Step 5 & AC 3)
  // ====================================================================
  console.log('\n--- Section 7: Dead-Letter Queue & Quarantine Handling ---');

  assert(checkpointSrc.includes('quarantineRecord'), 'syncCheckpointService has quarantineRecord method');
  assert(checkpointSrc.includes('getQuarantinedRecords'), 'syncCheckpointService has getQuarantinedRecords method');
  assert(checkpointSrc.includes('resolveQuarantinedRecord'), 'syncCheckpointService has resolveQuarantinedRecord method');
  assert(checkpointSrc.includes('getQuarantineSummary'), 'syncCheckpointService has getQuarantineSummary method');

  // Quarantine a malformed record
  const malformedPayload = { raw: 'invalid_json_bytes', missingFields: true };
  const quarantined = await syncCheckpointService.quarantineRecord({
    domain: 'usersRoles',
    recordKey: 'user_corrupt_999',
    payload: malformedPayload,
    errorReason: 'Missing mandatory email and displayName fields',
    errorCode: 'INVALID_USER_SCHEMA',
    tenantId: 'tenant_test',
  });

  assert(quarantined.id.startsWith('qr_'), 'Quarantine record ID generated with prefix qr_');
  assert(quarantined.domain === 'usersRoles', 'Domain recorded as usersRoles');
  assert(quarantined.recordKey === 'user_corrupt_999', 'Record key preserved');
  assert(quarantined.status === 'QUARANTINED', 'Initial status is QUARANTINED');

  // Query quarantine records
  const qList = await syncCheckpointService.getQuarantinedRecords({ domain: 'usersRoles', tenantId: 'tenant_test' });
  assert(qList.length >= 1, 'AC 3: Partial failure is visible via quarantine list');
  assert(qList.some((r) => r.recordKey === 'user_corrupt_999'), 'Quarantined record is retrievable');

  // Summary counts
  const summary = await syncCheckpointService.getQuarantineSummary('usersRoles', 'tenant_test');
  assert(summary.quarantined >= 1, 'Quarantine summary reflects active quarantined count');

  // Resolve quarantined record
  const resolved = await syncCheckpointService.resolveQuarantinedRecord(quarantined.id);
  assert(resolved === true, 'resolveQuarantinedRecord returns true');
  const resolvedList = await syncCheckpointService.getQuarantinedRecords({ domain: 'usersRoles', status: 'RESOLVED', tenantId: 'tenant_test' });
  assert(resolvedList.some((r) => r.id === quarantined.id), 'Record status transitioned to RESOLVED');

  // ====================================================================
  // Section 8: Database Migration DDL Verification
  // ====================================================================
  console.log('\n--- Section 8: Database Migration DDL Verification ---');

  assert(migrationSrc.includes('CREATE TABLE IF NOT EXISTS veyra_sync_checkpoints'),
    'Migration defines veyra_sync_checkpoints table');
  assert(migrationSrc.includes('watermark_timestamp TIMESTAMPTZ'),
    'Migration defines watermark_timestamp column');
  assert(migrationSrc.includes('watermark_cursor TEXT'),
    'Migration defines watermark_cursor column');
  assert(migrationSrc.includes('last_successful_batch INT'),
    'Migration defines last_successful_batch column');
  assert(migrationSrc.includes('CREATE TABLE IF NOT EXISTS veyra_sync_quarantine'),
    'Migration defines veyra_sync_quarantine dead-letter table');
  assert(migrationSrc.includes('error_reason TEXT NOT NULL'),
    'Migration defines error_reason column in quarantine table');
  assert(migrationSrc.includes('ix_veyra_sync_checkpoints_tenant_domain'),
    'Migration defines tenant and domain index for checkpoints');
  assert(migrationSrc.includes('ix_veyra_sync_quarantine_tenant_domain_status'),
    'Migration defines indexed lookup for quarantine records');

  // ====================================================================
  // Section 9: Admin Endpoints in api.ts
  // ====================================================================
  console.log('\n--- Section 9: Admin Endpoints in api.ts ---');

  assert(apiSrc.includes("apiRouter.get('/admin/sync/checkpoints'"),
    'api.ts registers GET /api/admin/sync/checkpoints endpoint');
  assert(apiSrc.includes("apiRouter.get('/admin/sync/quarantine'"),
    'api.ts registers GET /api/admin/sync/quarantine endpoint');
  assert(apiSrc.includes("apiRouter.post('/admin/sync/quarantine/:id/resolve'"),
    'api.ts registers POST /api/admin/sync/quarantine/:id/resolve endpoint');
  assert(apiSrc.includes('syncCheckpointService.listCheckpoints'),
    'Checkpoints endpoint queries syncCheckpointService.listCheckpoints');
  assert(apiSrc.includes('syncCheckpointService.getQuarantinedRecords'),
    'Quarantine endpoint queries syncCheckpointService.getQuarantinedRecords');
  assert(apiSrc.includes('syncCheckpointService.resolveQuarantinedRecord'),
    'Quarantine resolve endpoint calls syncCheckpointService.resolveQuarantinedRecord');

  // ====================================================================
  // Section 10: Ingestion Pipeline Integration
  // ====================================================================
  console.log('\n--- Section 10: Ingestion Pipeline Integration ---');

  assert(pipelineSrc.includes('executeWithRetry') && pipelineSrc.includes('resilienceService'),
    'ingestionPipelineService imports executeWithRetry');
  assert(pipelineSrc.includes('syncCheckpointService') && pipelineSrc.includes('syncCheckpointService'),
    'ingestionPipelineService imports syncCheckpointService');
  assert(pipelineSrc.includes("syncCheckpointService.startCheckpoint"),
    'Pipeline starts checkpoint tracking before domain execution');
  assert(pipelineSrc.includes("syncCheckpointService.commitCheckpoint"),
    'Pipeline commits checkpoint after successful persistence');
  assert(pipelineSrc.includes("syncCheckpointService.failCheckpoint"),
    'Pipeline marks checkpoint failed on domain error preserving watermark');
  assert(pipelineSrc.includes("deduplicateBatch('roles'"),
    'usersRoles runner deduplicates role batches for idempotency');
  assert(pipelineSrc.includes("deduplicateBatch('users'"),
    'usersRoles runner deduplicates user batches for idempotency');
  assert(pipelineSrc.includes("resilience?: {"),
    'PipelineResult interface includes resilience metrics summary');

  // -------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`  Tests Passed: ${passedTests}`);
  console.log(`  Tests Failed: ${failedTests}`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
