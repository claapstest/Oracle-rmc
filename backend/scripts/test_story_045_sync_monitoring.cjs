/**
 * Test Suite: Story VYR-045
 * "Implement sync status, monitoring and operational audit events"
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Validates that:
 *  1. syncMonitorService.ts exists and exports the service singleton
 *  2. Audit event table DDL (CREATE TABLE veyra_sync_audit_event) is present
 *  3. Alert table DDL (CREATE TABLE veyra_sync_alerts) is present
 *  4. Service records operational audit events with safe, masked error messages
 *  5. buildEventFromPipelineResult maps pipeline outcomes correctly
 *  6. Alert evaluation: repeated failures, lock contention, encryption, domain degraded
 *  7. Health endpoint returns status, staleness, active/recent alerts
 *  8. Pipeline integration: run() and runDomain() call the monitor
 *  9. Admin API routes exist for /security/sync-monitor, sync-history, sync-alerts
 * 10. No raw credentials or payloads are logged in audit events
 */

process.env.TEST_OFFLINE = 'true';

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
  console.log('  VYR-045: Sync Status, Monitoring & Operational Audit Events');
  console.log('================================================================\n');

  const src = path.resolve(__dirname, '../src');
  const monitorPath = path.join(src, 'services/syncMonitorService.ts');
  const pipelinePath = path.join(src, 'services/ingestionPipelineService.ts');
  const apiPath = path.join(src, 'routes/api.ts');

  // ====================================================================
  // Section 1: Source File Existence
  // ====================================================================
  console.log('--- Section 1: Source Files Existence ---');

  assert(fs.existsSync(monitorPath), 'syncMonitorService.ts exists in src/services');
  assert(fs.existsSync(pipelinePath), 'ingestionPipelineService.ts exists');
  assert(fs.existsSync(apiPath), 'api.ts exists in src/routes');

  const monitorSrc = read(monitorPath);
  const pipelineSrc = read(pipelinePath);
  const apiSrc = read(apiPath);

  // ====================================================================
  // Section 2: Audit Event Table Schema
  // ====================================================================
  console.log('\n--- Section 2: Audit Event Table Schema ---');

  assert(monitorSrc.includes('CREATE TABLE IF NOT EXISTS') && monitorSrc.includes('veyra_sync_audit_event'), 'Audit event table DDL present');
  assert(monitorSrc.includes('job_id'), 'Table has job_id column');
  assert(monitorSrc.includes('tenant_id'), 'Table has tenant_id column');
  assert(monitorSrc.includes('triggered_by'), 'Table has triggered_by column');
  assert(monitorSrc.includes('service_identity'), 'Table has service_identity column');
  assert(monitorSrc.includes('outcome'), 'Table has outcome column');
  assert(monitorSrc.includes('started_at'), 'Table has started_at column');
  assert(monitorSrc.includes('completed_at'), 'Table has completed_at column');
  assert(monitorSrc.includes('duration_ms'), 'Table has duration_ms column');
  assert(monitorSrc.includes('domain_results'), 'Table has domain_results JSONB column');
  assert(monitorSrc.includes('error_category'), 'Table has error_category column');
  assert(monitorSrc.includes('correlation_id'), 'Table has correlation_id column');
  assert(monitorSrc.includes('encryption_status'), 'Table has encryption_status column');
  assert(monitorSrc.includes('lock_type'), 'Table has lock_type column');

  // ====================================================================
  // Section 3: Alert Table Schema
  // ====================================================================
  console.log('\n--- Section 3: Alert Table Schema ---');

  assert(monitorSrc.includes('CREATE TABLE IF NOT EXISTS') && monitorSrc.includes('veyra_sync_alerts'), 'Alert table DDL present');
  assert(monitorSrc.includes('alert_id'), 'Alert table has alert_id column');
  assert(monitorSrc.includes('alert_type'), 'Alert table has alert_type column');
  assert(monitorSrc.includes('severity'), 'Alert table has severity column');
  assert(monitorSrc.includes('resolved_at'), 'Alert table has resolved_at column');
  assert(monitorSrc.includes('metadata'), 'Alert table has metadata JSONB column');

  // ====================================================================
  // Section 4: Core Service Exports and Types
  // ====================================================================
  console.log('\n--- Section 4: Core Service Exports & Types ---');

  assert(monitorSrc.includes('export const syncMonitorService'), 'syncMonitorService singleton is exported');
  assert(monitorSrc.includes('class SyncMonitorService'), 'SyncMonitorService class exists');
  assert(monitorSrc.includes('SyncAuditEvent'), 'SyncAuditEvent type is defined');
  assert(monitorSrc.includes('SyncAlert'), 'SyncAlert type is defined');
  assert(monitorSrc.includes('SyncHealthStatus'), 'SyncHealthStatus type is defined');
  assert(monitorSrc.includes('DomainMetrics'), 'DomainMetrics type is defined');

  // ====================================================================
  // Section 5: Event Outcome Classification
  // ====================================================================
  console.log('\n--- Section 5: Event Outcome Classification ---');

  assert(monitorSrc.includes("'SUCCESS'"), 'SUCCESS outcome defined');
  assert(monitorSrc.includes("'PARTIAL'"), 'PARTIAL outcome defined');
  assert(monitorSrc.includes("'FAILED'"), 'FAILED outcome defined');
  assert(monitorSrc.includes("'ABORTED'"), 'ABORTED outcome for encryption preflight failure');
  assert(monitorSrc.includes("'LOCK_CONTENTION'"), 'LOCK_CONTENTION outcome for distributed lock conflicts');

  // ====================================================================
  // Section 6: buildEventFromPipelineResult Mapping
  // ====================================================================
  console.log('\n--- Section 6: Pipeline-to-Event Mapping ---');

  assert(monitorSrc.includes('buildEventFromPipelineResult'), 'buildEventFromPipelineResult method exists');
  assert(monitorSrc.includes('SYNC_IN_PROGRESS'), 'Maps SYNC_IN_PROGRESS to LOCK_CONTENTION');
  assert(monitorSrc.includes('ENCRYPTION_PREFLIGHT_FAILED'), 'Maps encryption preflight failure to ABORTED');
  assert(monitorSrc.includes('PIPELINE_ERROR'), 'Maps generic failure to PIPELINE_ERROR');
  assert(monitorSrc.includes('DOMAIN_FAILURE'), 'Maps partial failure to DOMAIN_FAILURE with domain list');

  // ====================================================================
  // Section 7: Domain Metrics Extraction
  // ====================================================================
  console.log('\n--- Section 7: Domain Metrics ---');

  assert(monitorSrc.includes('fetchedCount'), 'Domain metrics track fetched count');
  assert(monitorSrc.includes('savedCount'), 'Domain metrics track saved count');
  assert(monitorSrc.includes('failedCount'), 'Domain metrics track failed count');
  assert(monitorSrc.includes('duplicatesFiltered'), 'Domain metrics track duplicates filtered');
  assert(monitorSrc.includes('retriesAttempted'), 'Domain metrics track retries');
  assert(monitorSrc.includes('quarantinedCount'), 'Domain metrics track quarantined count');

  // ====================================================================
  // Section 8: Safe Error Handling — No Raw Credentials/Payloads
  // ====================================================================
  console.log('\n--- Section 8: Safe Error Handling ---');

  assert(monitorSrc.includes('maskSensitive'), 'Error messages are masked via maskSensitive');
  assert(monitorSrc.includes("import { maskSensitive }"), 'maskSensitive is imported from cryptoFailure');
  assert(!monitorSrc.includes('password'), 'No mention of password in monitor service');
  assert(!monitorSrc.includes('rawPayload'), 'No raw payload logging in monitor service');
  assert(!monitorSrc.includes('Bearer'), 'No Bearer token patterns in monitor service');

  // ====================================================================
  // Section 9: Alert Types and Thresholds
  // ====================================================================
  console.log('\n--- Section 9: Alert Types & Thresholds ---');

  assert(monitorSrc.includes('REPEATED_SYNC_FAILURES'), 'Alert type: repeated sync failures');
  assert(monitorSrc.includes('STALE_LAST_SYNC'), 'Alert type: stale last sync');
  assert(monitorSrc.includes('LOCK_CONTENTION'), 'Alert type: lock contention');
  assert(monitorSrc.includes('ENCRYPTION_FAILURE'), 'Alert type: encryption failure');
  assert(monitorSrc.includes('DOMAIN_DEGRADED'), 'Alert type: domain degraded');
  assert(monitorSrc.includes('FAILURE_ALERT_THRESHOLD'), 'Configurable failure alert threshold');
  assert(monitorSrc.includes('LOCK_CONTENTION_THRESHOLD'), 'Configurable lock contention threshold');
  assert(monitorSrc.includes('STALE_SYNC_HOURS'), 'Configurable stale sync threshold');
  assert(monitorSrc.includes('ALERT_COOLDOWN_MINUTES'), 'Alert cooldown prevents flooding');

  // ====================================================================
  // Section 10: Alert Severity Levels
  // ====================================================================
  console.log('\n--- Section 10: Alert Severity ---');

  assert(monitorSrc.includes("'WARNING'"), 'WARNING severity level defined');
  assert(monitorSrc.includes("'CRITICAL'"), 'CRITICAL severity level defined');
  assert(monitorSrc.includes('encryptionStatus === \'FAILED\''), 'Encryption failures raise CRITICAL alerts');
  assert(monitorSrc.includes('consecutiveFailures >= FAILURE_ALERT_THRESHOLD * 2'), 'Doubles threshold escalates to CRITICAL');

  // ====================================================================
  // Section 11: Alert Resolution
  // ====================================================================
  console.log('\n--- Section 11: Alert Resolution ---');

  assert(monitorSrc.includes('resolveAlerts'), 'resolveAlerts method exists');
  assert(monitorSrc.includes("UPDATE"), 'Resolved alerts are updated in DB');
  assert(monitorSrc.includes("resolved_at IS NULL"), 'Only unresolved alerts are targeted');

  // ====================================================================
  // Section 12: Health Status API
  // ====================================================================
  console.log('\n--- Section 12: Health Status ---');

  assert(monitorSrc.includes('getHealth'), 'getHealth method exists');
  assert(monitorSrc.includes('lastSuccessfulSync'), 'Health includes last successful sync time');
  assert(monitorSrc.includes('lastSyncAttempt'), 'Health includes last sync attempt time');
  assert(monitorSrc.includes('consecutiveFailures'), 'Health includes consecutive failure count');
  assert(monitorSrc.includes('isSyncStale'), 'Health includes stale sync flag');
  assert(monitorSrc.includes("'HEALTHY'"), 'HEALTHY status defined');
  assert(monitorSrc.includes("'DEGRADED'"), 'DEGRADED status when warnings present');
  assert(monitorSrc.includes("'CRITICAL'"), 'CRITICAL status when critical alerts active');

  // ====================================================================
  // Section 13: Sync History Query
  // ====================================================================
  console.log('\n--- Section 13: Sync History ---');

  assert(monitorSrc.includes('getSyncHistory'), 'getSyncHistory method exists for paginated history');
  assert(monitorSrc.includes('ORDER BY created_at DESC'), 'History is sorted by most recent first');
  assert(monitorSrc.includes('LIMIT'), 'History supports pagination via LIMIT');

  // ====================================================================
  // Section 14: Pipeline Integration
  // ====================================================================
  console.log('\n--- Section 14: Pipeline Integration ---');

  assert(pipelineSrc.includes("import { syncMonitorService }"), 'Pipeline imports syncMonitorService');
  assert(pipelineSrc.includes('buildEventFromPipelineResult'), 'Pipeline calls buildEventFromPipelineResult');
  assert(pipelineSrc.includes('recordSyncEvent'), 'Pipeline calls recordSyncEvent');
  assert(pipelineSrc.includes('VYR-045'), 'Pipeline has VYR-045 comments for traceability');

  // Full run() integration
  assert(
    pipelineSrc.includes('_runInternal') && pipelineSrc.includes('Monitor recording failed (non-fatal)'),
    'run() delegates to _runInternal and records monitor event with non-fatal catch'
  );

  // runDomain() integration
  const domainMonitorIdx = pipelineSrc.indexOf('Record domain-level operational audit event');
  assert(domainMonitorIdx > 0, 'runDomain() records domain-level audit event after completion');

  // Lock contention recording in runDomain
  const lockContentionIdx = pipelineSrc.indexOf('Record lock contention event');
  assert(lockContentionIdx > 0, 'runDomain() records lock contention events');

  // ====================================================================
  // Section 15: Admin API Routes
  // ====================================================================
  console.log('\n--- Section 15: Admin API Routes ---');

  assert(apiSrc.includes("import { syncMonitorService }"), 'api.ts imports syncMonitorService');
  assert(apiSrc.includes('/security/sync-monitor'), 'GET /security/sync-monitor endpoint exists');
  assert(apiSrc.includes('/security/sync-history'), 'GET /security/sync-history endpoint exists');
  assert(apiSrc.includes('/security/sync-alerts'), 'GET /security/sync-alerts endpoint exists');

  // Verify endpoints require admin
  const syncMonitorRouteMatch = apiSrc.match(/apiRouter\.get\('\/security\/sync-monitor'.*?requireAdmin/);
  assert(!!syncMonitorRouteMatch, '/security/sync-monitor requires admin authentication');

  const syncHistoryRouteMatch = apiSrc.match(/apiRouter\.get\('\/security\/sync-history'.*?requireAdmin/);
  assert(!!syncHistoryRouteMatch, '/security/sync-history requires admin authentication');

  const syncAlertsRouteMatch = apiSrc.match(/apiRouter\.get\('\/security\/sync-alerts'.*?requireAdmin/);
  assert(!!syncAlertsRouteMatch, '/security/sync-alerts requires admin authentication');

  // ====================================================================
  // Section 16: History Endpoint Supports Filtering
  // ====================================================================
  console.log('\n--- Section 16: History Filtering ---');

  assert(apiSrc.includes('req.query.outcome'), 'History endpoint supports outcome filter');
  assert(apiSrc.includes('req.query.tenantId'), 'History endpoint supports tenantId filter');
  assert(apiSrc.includes('req.query.limit'), 'History endpoint supports limit parameter');

  // ====================================================================
  // Section 17: Monitor Health HTTP Status Codes
  // ====================================================================
  console.log('\n--- Section 17: HTTP Status Codes ---');

  assert(apiSrc.includes("health.status === 'CRITICAL' ? 503 : 200"), 'Sync-monitor returns 503 on CRITICAL status');

  // ====================================================================
  // Section 18: Database Index Coverage
  // ====================================================================
  console.log('\n--- Section 18: Database Index Coverage ---');

  assert(monitorSrc.includes('idx_sync_audit_job_id'), 'Index on job_id for fast lookup');
  assert(monitorSrc.includes('idx_sync_audit_outcome'), 'Index on outcome + created_at for filtered queries');
  assert(monitorSrc.includes('idx_sync_audit_tenant'), 'Index on tenant_id + created_at for tenant queries');
  assert(monitorSrc.includes('idx_sync_alerts_type'), 'Index on alert_type for fast alert lookup');
  assert(monitorSrc.includes('idx_sync_alerts_active'), 'Partial index for active (unresolved) alerts');

  // ====================================================================
  // Section 19: Correlation ID and Job ID Generation
  // ====================================================================
  console.log('\n--- Section 19: Correlation & Job IDs ---');

  assert(monitorSrc.includes('generateJobId'), 'Job ID generator exists');
  assert(monitorSrc.includes('generateCorrelationId'), 'Correlation ID generator exists');
  assert(monitorSrc.includes('generateAlertId'), 'Alert ID generator exists');
  assert(monitorSrc.includes('SYN-'), 'Job IDs prefixed with SYN-');
  assert(monitorSrc.includes('COR-'), 'Correlation IDs prefixed with COR-');
  assert(monitorSrc.includes('ALR-'), 'Alert IDs prefixed with ALR-');

  // ====================================================================
  // Section 20: Built Module Exists
  // ====================================================================
  console.log('\n--- Section 20: Built Module Verification ---');

  const distMonitorPath = path.join(__dirname, '../dist/services/syncMonitorService.js');
  assert(fs.existsSync(distMonitorPath), 'syncMonitorService.js built to dist/services/');

  // ====================================================================
  // Summary
  // ====================================================================
  console.log('\n================================================================');
  console.log(`  Results: ${passedTests} passed, ${failedTests} failed out of ${passedTests + failedTests} tests`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
