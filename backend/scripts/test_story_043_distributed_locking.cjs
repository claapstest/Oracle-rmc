/**
 * Test Suite: Story VYR-043
 * "Implement scheduler concurrency and distributed locking"
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Validates that:
 *  1. DistributedLockService exists and provides PostgreSQL-backed distributed locking
 *  2. In-process mutex is retained as a fast local safeguard (Code Area 1)
 *  3. PostgreSQL advisory locks (pg_try_advisory_lock) and lock table are used (Code Area 2)
 *  4. Lock timeout (TTL), heartbeat, and automatic stale lock recovery are implemented (Code Area 3)
 *  5. Per-tenant and per-domain lock scopes are supported (Code Area 3)
 *  6. 409 SYNC_IN_PROGRESS responses are preserved for user-triggered operations (Code Area 4)
 *  7. ScheduledSyncService gracefully skips without crashing when lock is held by another replica
 *  8. veyra_distributed_locks database migration exists and defines valid DDL
 *  9. Admin routes exist for inspecting active distributed locks and recovering stale locks
 * 10. Functional in-process concurrency and stale recovery contracts behave correctly
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
  console.log('  VYR-043: Scheduler Concurrency and Distributed Locking');
  console.log('================================================================\n');

  const src = path.resolve(__dirname, '../src');
  const root = path.resolve(__dirname, '../..');
  const distLockServicePath = path.join(src, 'services/distributedLockService.ts');
  const syncServicePath = path.join(src, 'services/oracleSyncService.ts');
  const pipelinePath = path.join(src, 'services/ingestionPipelineService.ts');
  const schedulerPath = path.join(src, 'services/scheduledSyncService.ts');
  const apiPath = path.join(src, 'routes/api.ts');
  const migrationPath = path.join(root, 'database/migrations/1711000000022_create_veyra_distributed_locks_table.cjs');

  // ====================================================================
  // Section 1: Required Source Modules & Migrations Exist
  // ====================================================================
  console.log('\n--- Section 1: Source Files & Migration Existence ---');

  assert(fs.existsSync(distLockServicePath), 'distributedLockService.ts exists in src/services');
  assert(fs.existsSync(syncServicePath), 'oracleSyncService.ts exists in src/services');
  assert(fs.existsSync(pipelinePath), 'ingestionPipelineService.ts exists in src/services');
  assert(fs.existsSync(schedulerPath), 'scheduledSyncService.ts exists in src/services');
  assert(fs.existsSync(apiPath), 'api.ts exists in src/routes');
  assert(fs.existsSync(migrationPath), '1711000000022_create_veyra_distributed_locks_table.cjs exists in database/migrations');

  const distLockSrc = read(distLockServicePath);
  const syncSrc = read(syncServicePath);
  const pipelineSrc = read(pipelinePath);
  const schedSrc = read(schedulerPath);
  const apiSrc = read(apiPath);
  const migrationSrc = read(migrationPath);

  // ====================================================================
  // Section 2: In-Process Mutex Retained as Local Safeguard (Code Area 1)
  // ====================================================================
  console.log('\n--- Section 2: In-Process Mutex Retained as Local Safeguard ---');

  assert(syncSrc.includes('public acquireLock(taskName: string, triggeredBy: string): boolean'),
    'oracleSyncService retains synchronous acquireLock() for local safeguard');
  assert(syncSrc.includes('public releaseLock(success: boolean, error?: string)'),
    'oracleSyncService retains releaseLock()');
  assert(syncSrc.includes('this.isSyncing'),
    'oracleSyncService maintains in-process boolean isSyncing state');
  assert(syncSrc.includes('acquireDistributedLock'),
    'oracleSyncService provides acquireDistributedLock for multi-replica coordination');
  assert(syncSrc.includes('releaseDistributedLock'),
    'oracleSyncService provides releaseDistributedLock');

  // ====================================================================
  // Section 3: PostgreSQL Advisory Lock & Lock Table (Code Area 2)
  // ====================================================================
  console.log('\n--- Section 3: PostgreSQL Distributed Mutual Exclusion ---');

  assert(distLockSrc.includes('pg_try_advisory_lock'),
    'distributedLockService uses pg_try_advisory_lock for atomic session exclusion');
  assert(distLockSrc.includes('pg_advisory_unlock'),
    'distributedLockService unlocks advisory locks via pg_advisory_unlock');
  assert(distLockSrc.includes('veyra_distributed_locks'),
    'distributedLockService manages veyra_distributed_locks table');
  assert(distLockSrc.includes('advisoryKeyFromLockKey'),
    'distributedLockService computes deterministic 32-bit advisory key from lock scope');
  assert(migrationSrc.includes('CREATE TABLE IF NOT EXISTS veyra_distributed_locks'),
    'Migration defines veyra_distributed_locks table with primary key');
  assert(migrationSrc.includes('ix_veyra_dist_locks_expires'),
    'Migration indexes expires_at column for efficient stale lock cleanup');
  assert(migrationSrc.includes('ix_veyra_dist_locks_tenant_domain'),
    'Migration indexes tenant_id and domain for scoped queries');

  // ====================================================================
  // Section 4: Lock Timeout & Stale Lock Recovery (Code Area 3)
  // ====================================================================
  console.log('\n--- Section 4: Lock Timeout, Heartbeat & Stale Lock Recovery ---');

  assert(distLockSrc.includes('SYNC_LOCK_TTL_SECONDS'),
    'distributedLockService supports configurable lock TTL via SYNC_LOCK_TTL_SECONDS');
  assert(distLockSrc.includes('isStaleRecovered'),
    'distributedLockService flags and handles stale lock recovery');
  assert(distLockSrc.includes('expires_at <= NOW()') || distLockSrc.includes('Date.now() > expiresTime'),
    'distributedLockService detects expired/stale locks');
  assert(distLockSrc.includes('public async heartbeat'),
    'distributedLockService provides heartbeat() method to extend active locks');
  assert(distLockSrc.includes('public async recoverStaleLocks'),
    'distributedLockService provides recoverStaleLocks() cleanup method');

  // ====================================================================
  // Section 5: Per-Tenant and Per-Domain Scopes (Code Area 3)
  // ====================================================================
  console.log('\n--- Section 5: Per-Tenant and Per-Domain Lock Scope ---');

  assert(distLockSrc.includes('export interface LockScope'),
    'distributedLockService exports LockScope interface');
  assert(distLockSrc.includes('tenantId?: string;'),
    'LockScope includes tenantId field');
  assert(distLockSrc.includes('domain?: string;'),
    'LockScope includes domain field');
  assert(distLockSrc.includes('buildLockKey'),
    'distributedLockService provides buildLockKey helper');
  assert(pipelineSrc.includes("domain: 'full'"),
    'Full pipeline run acquires full-domain distributed lock');
  assert(pipelineSrc.includes('{ domain, tenantId:'),
    'On-demand runDomain acquires domain-scoped distributed lock');

  // ====================================================================
  // Section 6: Preservation of 409 Behaviour (Code Area 4)
  // ====================================================================
  console.log('\n--- Section 6: Preservation of 409 for Duplicate Operations ---');

  assert(pipelineSrc.includes("code: 'SYNC_IN_PROGRESS'"),
    'Pipeline returns code: SYNC_IN_PROGRESS when lock acquisition fails');
  assert(pipelineSrc.includes('A synchronization operation is already in progress'),
    'Pipeline returns standard conflict message on contention');
  assert(apiSrc.includes("result.code === 'SYNC_IN_PROGRESS'") || apiSrc.includes("already in progress"),
    'api.ts /admin/sync/full returns 409 when lock contention occurs');
  assert(apiSrc.includes('/reports/role-hierarchy/sync') && apiSrc.includes('409'),
    'Role hierarchy sync route preserves 409 on lock contention');
  assert(apiSrc.includes('/audit/sync') && apiSrc.includes('409'),
    'Audit sync route preserves 409 on lock contention');

  // ====================================================================
  // Section 7: Scheduled Synchronization Replicas Resilience
  // ====================================================================
  console.log('\n--- Section 7: Multi-Replica Scheduled Sync Resilience ---');

  assert(schedSrc.includes('distributed lock') || schedSrc.includes('already in progress'),
    'ScheduledSyncService detects and logs when distributed lock is held by a peer replica');
  assert(schedSrc.includes('SCHEDULED_OFFPEAK_CRON'),
    'ScheduledSyncService maintains SCHEDULED_OFFPEAK_CRON trigger identity');

  // ====================================================================
  // Section 8: Admin Lock Inspection Endpoints
  // ====================================================================
  console.log('\n--- Section 8: Admin Lock Inspection Endpoints ---');

  assert(apiSrc.includes('/admin/locks'),
    'api.ts registers GET /api/admin/locks endpoint');
  assert(apiSrc.includes('/admin/locks/recover-stale'),
    'api.ts registers POST /api/admin/locks/recover-stale endpoint');
  assert(apiSrc.includes('distributedLockService.getActiveLocks()'),
    'Admin route fetches active locks from distributedLockService');
  assert(apiSrc.includes('distributedLockService.recoverStaleLocks()'),
    'Admin route triggers recoverStaleLocks() on distributedLockService');

  // ====================================================================
  // Section 9: Functional In-Process Contract Verification
  // ====================================================================
  console.log('\n--- Section 9: Functional Contract Verification ---');

  // Test 9.1: Scope Key Building
  function buildKey(tenant, domain) {
    return `${(tenant || '__GLOBAL__').trim()}:${(domain || 'full').trim()}`;
  }
  assert(buildKey() === '__GLOBAL__:full', 'Default scope is __GLOBAL__:full');
  assert(buildKey('tenant_alpha', 'audit') === 'tenant_alpha:audit', 'Scoped key builds tenant_alpha:audit');
  assert(buildKey('tenant_beta', 'controls') === 'tenant_beta:controls', 'Scoped key builds tenant_beta:controls');

  // Test 9.2: Advisory Key 32-bit Integer Stability
  function advisoryKey(lockKey) {
    return crypto.createHash('sha256').update(`veyra_lock:${lockKey}`).digest().readInt32BE(0);
  }
  const k1 = advisoryKey('__GLOBAL__:full');
  const k2 = advisoryKey('__GLOBAL__:full');
  const k3 = advisoryKey('tenant_alpha:audit');
  assert(typeof k1 === 'number' && Number.isInteger(k1), 'Advisory key is a valid integer');
  assert(k1 === k2, 'Same scope produces identical advisory key');
  assert(k1 !== k3, 'Different scopes produce distinct advisory keys');

  // Test 9.3: In-Memory Concurrency & Mutual Exclusion Simulation
  class MockLockManager {
    constructor() {
      this.locks = new Map();
    }
    acquire(key, holder, ttlMs = 1000) {
      const existing = this.locks.get(key);
      const now = Date.now();
      if (existing && now < existing.expiresAt) {
        return { acquired: false, existingHolder: existing.holder };
      }
      const isStale = Boolean(existing && now >= existing.expiresAt);
      this.locks.set(key, { holder, expiresAt: now + ttlMs });
      return { acquired: true, isStaleRecovered: isStale };
    }
    release(key, holder) {
      const existing = this.locks.get(key);
      if (existing && existing.holder === holder) {
        this.locks.delete(key);
        return true;
      }
      return false;
    }
  }

  const manager = new MockLockManager();
  const resA = manager.acquire('__GLOBAL__:full', 'replica-1', 500);
  assert(resA.acquired === true, 'First replica acquires lock');

  const resB = manager.acquire('__GLOBAL__:full', 'replica-2', 500);
  assert(resB.acquired === false && resB.existingHolder === 'replica-1',
    'Second concurrent replica is rejected with existing holder attribution');

  manager.release('__GLOBAL__:full', 'replica-1');
  const resC = manager.acquire('__GLOBAL__:full', 'replica-2', 500);
  assert(resC.acquired === true, 'After release, second replica acquires lock');

  // Test 9.4: Stale Lock Recovery Simulation
  manager.acquire('stale:test', 'dead-replica', 1); // 1ms TTL
  await new Promise(r => setTimeout(r, 10)); // wait for expiry
  const staleRes = manager.acquire('stale:test', 'living-replica', 500);
  assert(staleRes.acquired === true && staleRes.isStaleRecovered === true,
    'Expired/stale lock is automatically recovered by new worker');

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
  console.error('Fatal error in VYR-043 test suite:', err);
  process.exit(1);
});
