/**
 * Test Suite: Story VYR-040
 * "Refactor sync operations to use a shared ingestion pipeline"
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Validates that:
 *  - The ingestion pipeline service exists and exports the expected API
 *  - oracleSyncService.runFullSync delegates to the pipeline
 *  - API routes import and use the pipeline
 *  - Dead scheduler code has been removed
 *  - Pipeline carries crypto audit context
 *  - Domain runners cover all five sync domains
 *  - Mutex (lock) behavior is preserved
 *  - Status/health endpoint is wired
 *
 * No database or Oracle connection required — source and build-artifact checks only.
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
  console.log('  VYR-040: Shared Ingestion Pipeline');
  console.log('================================================================\n');

  const src = path.resolve(__dirname, '../src');
  const dist = path.resolve(__dirname, '../dist');

  const pipelineSrcPath = path.join(src, 'services/ingestionPipelineService.ts');
  const syncSrcPath = path.join(src, 'services/oracleSyncService.ts');
  const apiSrcPath = path.join(src, 'routes/api.ts');
  const auditSrcPath = path.join(src, 'services/auditRawDbService.ts');
  const controlSrcPath = path.join(src, 'services/controlRawDbService.ts');
  const schedSrcPath = path.join(src, 'services/scheduledSyncService.ts');

  // ====================================================================
  // Section 1: Pipeline service file structure
  // ====================================================================
  console.log('\n--- Section 1: Pipeline service file structure ---');

  assert(fs.existsSync(pipelineSrcPath), 'ingestionPipelineService.ts exists in src');
  assert(
    fs.existsSync(path.join(dist, 'services/ingestionPipelineService.js')),
    'ingestionPipelineService.js exists in dist (compiled)'
  );

  const pipelineSrc = read(pipelineSrcPath);

  assert(pipelineSrc.includes('class IngestionPipelineService'), 'IngestionPipelineService class is defined');
  assert(pipelineSrc.includes('export const ingestionPipeline'), 'ingestionPipeline singleton is exported');

  // ====================================================================
  // Section 2: Pipeline exports the expected API surface
  // ====================================================================
  console.log('\n--- Section 2: Pipeline API surface ---');

  assert(pipelineSrc.includes('public async run('), 'run() method exists (full pipeline)');
  assert(pipelineSrc.includes('public async runDomain('), 'runDomain() method exists (single domain)');
  assert(pipelineSrc.includes('public getStatus()'), 'getStatus() method exists');
  assert(pipelineSrc.includes('public isRunning()'), 'isRunning() method exists');

  // ====================================================================
  // Section 3: All five sync domains are defined
  // ====================================================================
  console.log('\n--- Section 3: Sync domains ---');

  const domains = ['controls', 'roleHierarchy', 'audit', 'usersRoles', 'userAccess'];
  for (const d of domains) {
    assert(pipelineSrc.includes(`'${d}'`), `Domain '${d}' is defined in SyncDomain type`);
  }

  assert(pipelineSrc.includes('ALL_SYNC_DOMAINS'), 'ALL_SYNC_DOMAINS constant exported');
  assert(pipelineSrc.includes('DOMAIN_LABELS'), 'DOMAIN_LABELS map defined');
  assert(pipelineSrc.includes('DOMAIN_RUNNERS'), 'DOMAIN_RUNNERS dispatch map defined');

  // ====================================================================
  // Section 4: Domain runners call the correct underlying services
  // ====================================================================
  console.log('\n--- Section 4: Domain runner wiring ---');

  assert(pipelineSrc.includes('controlRawDbService.runAutoSyncCycle'), 'controls runner calls runAutoSyncCycle');
  assert(pipelineSrc.includes('roleHierarchyService.syncFromBip'), 'roleHierarchy runner calls syncFromBip');
  assert(pipelineSrc.includes('auditRawDbService.runDailyIncrementalSync'), 'audit runner calls runDailyIncrementalSync');
  assert(pipelineSrc.includes('userRoleRawDbService.saveRawRolesBatch'), 'usersRoles runner calls saveRawRolesBatch');
  assert(pipelineSrc.includes('userRoleRawDbService.saveRawUsersBatch'), 'usersRoles runner calls saveRawUsersBatch');
  assert(pipelineSrc.includes('userAccessReportService.getUserAccessReport'), 'userAccess runner calls getUserAccessReport');

  // ====================================================================
  // Section 5: Crypto audit context is wired
  // ====================================================================
  console.log('\n--- Section 5: Crypto audit context integration ---');

  assert(pipelineSrc.includes("import { runAsCryptoService"), 'Pipeline imports runAsCryptoService');
  assert(pipelineSrc.includes("runAsCryptoService('ingestion-pipeline'"), 'run() wraps execution in crypto service context');

  // ====================================================================
  // Section 6: Mutex behavior via oracleSyncService
  // ====================================================================
  console.log('\n--- Section 6: Mutex / lock behavior ---');

  assert(pipelineSrc.includes('oracleSyncService.acquireLock'), 'Pipeline acquires lock via oracleSyncService');
  assert(pipelineSrc.includes('oracleSyncService.releaseLock'), 'Pipeline releases lock via oracleSyncService');
  assert(pipelineSrc.includes('already in progress'), 'Lock contention returns a clear message');

  // ====================================================================
  // Section 7: oracleSyncService delegates to pipeline
  // ====================================================================
  console.log('\n--- Section 7: oracleSyncService delegation ---');

  const syncSrc = read(syncSrcPath);

  assert(syncSrc.includes('ingestionPipeline'), 'oracleSyncService imports/uses ingestionPipeline');
  assert(syncSrc.includes('ingestionPipeline.run('), 'runFullSync delegates to ingestionPipeline.run()');
  assert(syncSrc.includes('setCurrentTask'), 'setCurrentTask method exposed for pipeline progress');

  // Verify the old inline sync code is gone
  assert(
    !syncSrc.includes('controlRawDbService.runAutoSyncCycle'),
    'Old inline controlRawDbService call removed from oracleSyncService'
  );
  assert(
    !syncSrc.includes('roleHierarchyService.syncFromBip'),
    'Old inline roleHierarchyService call removed from oracleSyncService'
  );
  assert(
    !syncSrc.includes('auditRawDbService.runDailyIncrementalSync'),
    'Old inline auditRawDbService call removed from oracleSyncService'
  );
  assert(
    !syncSrc.includes('userRoleRawDbService'),
    'Old inline userRoleRawDbService call removed from oracleSyncService'
  );
  assert(
    !syncSrc.includes('userAccessReportService'),
    'Old inline userAccessReportService call removed from oracleSyncService'
  );

  // ====================================================================
  // Section 8: API routes use the pipeline
  // ====================================================================
  console.log('\n--- Section 8: API route integration ---');

  const apiSrc = read(apiSrcPath);

  assert(apiSrc.includes("from '../services/ingestionPipelineService.js'"), 'api.ts imports ingestionPipelineService');
  assert(apiSrc.includes('ingestionPipeline.run('), 'Full sync route uses ingestionPipeline.run()');
  assert(apiSrc.includes('ingestionPipeline.runDomain('), 'On-demand routes use ingestionPipeline.runDomain()');
  assert(apiSrc.includes('ingestionPipeline.isRunning()'), 'Sync-in-progress guard uses ingestionPipeline.isRunning()');
  assert(apiSrc.includes('ingestion-status'), 'Pipeline status endpoint is registered');

  // ====================================================================
  // Section 9: Dead scheduler code removed
  // ====================================================================
  console.log('\n--- Section 9: Dead scheduler code removal ---');

  const auditSrc = read(auditSrcPath);
  const controlSrc = read(controlSrcPath);

  assert(
    !auditSrc.includes('public startDailyScheduler'),
    'auditRawDbService.startDailyScheduler removed'
  );
  assert(
    !controlSrc.includes('public startAutoSyncScheduler'),
    'controlRawDbService.startAutoSyncScheduler removed'
  );
  assert(
    auditSrc.includes('startDailyScheduler removed'),
    'auditRawDbService has removal comment'
  );
  assert(
    controlSrc.includes('startAutoSyncScheduler removed'),
    'controlRawDbService has removal comment'
  );

  // ====================================================================
  // Section 10: ScheduledSyncService still uses the pipeline path
  // ====================================================================
  console.log('\n--- Section 10: Scheduled sync still works through pipeline ---');

  const schedSrc = read(schedSrcPath);

  assert(schedSrc.includes('oracleSyncService.runFullSync'), 'scheduledSyncService calls oracleSyncService.runFullSync (which delegates to pipeline)');
  assert(schedSrc.includes('SCHEDULED_OFFPEAK_CRON'), 'Nightly trigger passes SCHEDULED_OFFPEAK_CRON as triggeredBy');

  // ====================================================================
  // Section 11: Pipeline types — PipelineResult shape
  // ====================================================================
  console.log('\n--- Section 11: Pipeline result types ---');

  assert(pipelineSrc.includes('interface PipelineResult'), 'PipelineResult interface is defined');
  assert(pipelineSrc.includes('interface DomainResult'), 'DomainResult interface is defined');
  assert(pipelineSrc.includes('interface PipelineOptions'), 'PipelineOptions interface is defined');
  assert(pipelineSrc.includes('triggeredBy'), 'PipelineResult carries triggeredBy');
  assert(pipelineSrc.includes('durationMs'), 'PipelineResult carries durationMs');
  assert(pipelineSrc.includes("domains: DomainResult[]"), 'PipelineResult carries per-domain results');

  // ====================================================================
  // Section 12: Build output — compiled pipeline module is importable
  // ====================================================================
  console.log('\n--- Section 12: Build artifact verification ---');

  const distPipeline = path.join(dist, 'services/ingestionPipelineService.js');
  assert(fs.existsSync(distPipeline), 'Compiled pipeline module exists in dist');
  const distContent = read(distPipeline);
  assert(distContent.includes('IngestionPipelineService'), 'Compiled module contains the class');
  assert(distContent.includes('ingestionPipeline'), 'Compiled module exports the singleton');

  // ====================================================================
  // Section 13: No old domain-service imports remain in oracleSyncService
  // ====================================================================
  console.log('\n--- Section 13: oracleSyncService import cleanup ---');

  assert(
    !syncSrc.includes("from './controlRawDbService.js'"),
    'oracleSyncService no longer imports controlRawDbService'
  );
  assert(
    !syncSrc.includes("from './roleHierarchyService.js'"),
    'oracleSyncService no longer imports roleHierarchyService'
  );
  assert(
    !syncSrc.includes("from './auditRawDbService.js'"),
    'oracleSyncService no longer imports auditRawDbService'
  );
  assert(
    !syncSrc.includes("from './userRoleRawDbService.js'"),
    'oracleSyncService no longer imports userRoleRawDbService'
  );
  assert(
    !syncSrc.includes("from './userAccessReportService.js'"),
    'oracleSyncService no longer imports userAccessReportService'
  );

  // ====================================================================
  // Summary
  // ====================================================================
  console.log('\n================================================================');
  console.log(`  Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================\n');

  process.exit(failedTests > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
