/**
 * Test Suite: Story VYR-039
 * "Inspect current scheduler/cron implementation and synchronization lifecycle"
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Drift check: every fact documented in
 * docs/architecture/scheduler_and_sync_lifecycle.md is asserted against the
 * current source. If the scheduler design changes, this suite fails until the
 * document is updated. No database required.
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
  console.log('  VYR-039: Scheduler & Sync Lifecycle Inspection');
  console.log('================================================================\n');

  const root = path.resolve(__dirname, '../..');
  const src = path.resolve(__dirname, '../src');
  const indexPath = path.join(src, 'index.ts');
  const schedPath = path.join(src, 'services/scheduledSyncService.ts');
  const syncPath = path.join(src, 'services/oracleSyncService.ts');
  const auditPath = path.join(src, 'services/auditRawDbService.ts');
  const controlPath = path.join(src, 'services/controlRawDbService.ts');
  const authPath = path.join(src, 'services/authService.ts');
  const docPath = path.join(root, 'docs/architecture/scheduler_and_sync_lifecycle.md');

  for (const [p, name] of [[indexPath, 'index.ts'], [schedPath, 'scheduledSyncService.ts'], [syncPath, 'oracleSyncService.ts'], [docPath, 'inspection doc']]) {
    assert(fs.existsSync(p), `${name} exists`);
  }

  const idx = read(indexPath);
  const sched = read(schedPath);
  const syncSvc = read(syncPath);
  const audit = read(auditPath);
  const control = read(controlPath);
  const auth = read(authPath);
  const doc = read(docPath);

  // ------------------------------------------------------------------
  // Section 1: Deployment model facts (AC1: design documented)
  // ------------------------------------------------------------------
  console.log('--- Section 1: Deployment Model ---');

  const railwayPath = path.join(root, 'railway.json');
  const dockerPath = path.join(root, 'Dockerfile');
  assert(fs.existsSync(railwayPath) && fs.existsSync(dockerPath), 'Deployment manifests (railway.json, Dockerfile) exist');
  const railway = JSON.parse(read(railwayPath));
  const docker = read(dockerPath);
  assert(railway.deploy && railway.deploy.startCommand === 'npm start', 'Railway deploys a single web service (npm start)');
  assert(railway.deploy.healthcheckPath === '/health', 'Railway healthcheck on /health');
  assert(railway.deploy.restartPolicyType === 'ON_FAILURE', 'Railway restart policy ON_FAILURE');
  assert(/start:migrate/.test(docker), 'Dockerfile CMD runs migrations at container start');
  assert(!/node-cron|bull|bullmq|agenda/.test(read(path.join(__dirname, '../package.json'))),
    'No cron/queue library installed (plain setTimeout/setInterval)');

  // ------------------------------------------------------------------
  // Section 2: Active scheduler facts
  // ------------------------------------------------------------------
  console.log('\n--- Section 2: Active Scheduler ---');

  assert(/scheduledSyncService\.initialize\(oracleService, 23\)/.test(idx),
    'Boot initializes the nightly off-peak sync at hour 23');
  assert(/SYNC_OFFPEAK_HOUR/.test(sched), 'SYNC_OFFPEAK_HOUR env var overrides the target hour');
  assert(/runFullSync\(oracleService, 'SCHEDULED_OFFPEAK_CRON'\)/.test(sched),
    'Nightly run triggers runFullSync with the SCHEDULED_OFFPEAK_CRON label');
  assert(/setTimeout/.test(sched) && /scheduleNextRun/.test(sched),
    'Scheduling is setTimeout-based, re-armed after each run');
  assert(/unref/.test(sched), 'Scheduler timer is unref\\'+'\'d so it never holds the process open');
  assert(!/catch \(err[\s\S]*?retry|backoff/.test(sched), 'No retry/backoff in the nightly scheduler (documented gap)');

  // ------------------------------------------------------------------
  // Section 3: Dormant schedulers (AC2: no new cron service assumed)
  // ------------------------------------------------------------------
  console.log('\n--- Section 3: Dormant Schedulers ---');

  assert(/public startDailyScheduler/.test(audit), 'auditRawDbService.startDailyScheduler exists');
  assert(/public startAutoSyncScheduler/.test(control), 'controlRawDbService.startAutoSyncScheduler exists');
  assert(!/startDailyScheduler\(/.test(idx), 'startDailyScheduler is never called from boot (dormant)');
  assert(!/startAutoSyncScheduler\(/.test(idx), 'startAutoSyncScheduler is never called from boot (dormant)');

  // ------------------------------------------------------------------
  // Section 4: Full sync pipeline shape
  // ------------------------------------------------------------------
  console.log('\n--- Section 4: Full Sync Pipeline (5 domains) ---');

  const stepOrder = [
    'runAutoSyncCycle',
    'syncFromBip',
    'runDailyIncrementalSync',
    'saveRawUsersBatch',
    'getUserAccessReport',
  ];
  let lastIdx = -1;
  let ordered = true;
  for (const marker of stepOrder) {
    const i = syncSvc.indexOf(marker);
    if (i < 0 || i < lastIdx) ordered = false;
    lastIdx = i > 0 ? i : lastIdx;
  }
  assert(ordered, 'Pipeline order: controls -> role hierarchy -> audit -> users/roles -> user access');

  assert(/acquireLock/.test(syncSvc) && /if \(this\.isSyncing\)\s*\{\s*return false/.test(syncSvc),
    'Full sync guarded by an in-process boolean mutex (no distributed lock)');
  assert(/isSchedulerRunning/.test(control) && /this\.isSchedulerRunning = false/.test(control),
    'Control auto-sync cycle guarded by its own in-process flag');

  // API 409 behaviour for duplicate user-triggered syncs
  const routes = read(path.join(src, 'routes/api.ts'));
  assert(/SYNC_IN_PROGRESS/.test(routes), 'API returns SYNC_IN_PROGRESS for duplicate sync triggers');

  // ------------------------------------------------------------------
  // Section 5: Watermarks and pagination facts
  // ------------------------------------------------------------------
  console.log('\n--- Section 5: Watermarks & Pagination ---');

  assert(/oracle_audit_sync_state/.test(audit), 'Audit incremental sync uses oracle_audit_sync_state watermark table');
  assert(/'__GLOBAL__'/.test(audit), 'Audit watermark has a __GLOBAL__ fallback key');
  assert(/pageNumber: 1, pageSize: 500/.test(audit), 'Audit sync fetches page 1 only (documented truncation gap)');
  assert(/\{ count: 500, startIndex: roleStart \}/.test(syncSvc), 'SCIM users/roles sync paginates 500 per page');

  // ------------------------------------------------------------------
  // Section 6: Document coverage (AC1)
  // ------------------------------------------------------------------
  console.log('\n--- Section 6: Inspection Document ---');

  assert(/VYR-039/.test(doc) && /single instance/i.test(doc), 'Doc covers VYR-039 scope and single-instance finding');
  assert(/VYR-043/.test(doc) && /distributed lock/i.test(doc), 'Doc maps the distributed-locking gap to VYR-043');
  assert(/VYR-042/.test(doc), 'Doc maps the credential gap to VYR-042');
  assert(/dormant|dead code/i.test(doc), 'Doc records the dormant schedulers');
  assert(/cryptoAuditService/.test(doc) && /syncCatalogInBackground/.test(doc),
    'Doc inventories the non-scheduler background timers (flush debounce, catalog background sync)');

  console.log('\n================================================================');
  console.log(`  RESULTS: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================\n');
  process.exit(failedTests > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
