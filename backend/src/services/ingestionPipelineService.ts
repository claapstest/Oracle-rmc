/**
 * Shared Ingestion Pipeline
 * Story ID: VYR-040
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Unifies manual (API-triggered) and scheduled synchronization into a single
 * orchestration layer. Routes and the nightly scheduler invoke this pipeline
 * rather than duplicating fetch/validate/persist logic in each call site.
 *
 * Responsibilities separated:
 *   - Orchestration (this file): sequencing, mutex, progress, audit context
 *   - Oracle client: network I/O, pagination, retry (unchanged domain services)
 *   - Transformation: mapping Oracle payloads to DB rows (unchanged domain services)
 *   - Persistence: DB writes, encryption boundary (unchanged domain services)
 */

import { oracleSyncService, type SyncStatus } from './oracleSyncService.js';
import { controlRawDbService } from './controlRawDbService.js';
import { roleHierarchyService } from './roleHierarchyService.js';
import { auditRawDbService } from './auditRawDbService.js';
import { auditProductCatalogService } from './auditProductCatalogService.js';
import { userRoleRawDbService } from './userRoleRawDbService.js';
import { userAccessReportService } from './userAccessReportService.js';
import { runAsCryptoService, getCryptoAuditContext } from '../security/cryptoAuditContext.js';
import { serviceIdentityRegistry, type ServiceExecutionContext } from '../oracle/serviceIdentity.js';
import { bipClient } from '../oracle/bipClient.js';
import { distributedLockService, type LockAcquisitionResult } from './distributedLockService.js';
import { executeWithRetry, throttleBetweenPages, deduplicateBatch, computeRecordHash, type RetryConfig } from '../oracle/resilienceService.js';
import { syncCheckpointService, type SyncCheckpoint, type QuarantinedRecord } from './syncCheckpointService.js';
import {
  encryptionPreflight,
  safePipelineError,
  withEncryptionGuard,
  getEncryptionPolicy,
  type PreflightResult,
  type EncryptionPolicy,
} from './ingestionEncryptionGuard.js';
import { syncMonitorService } from './syncMonitorService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncDomain =
  | 'controls'
  | 'roleHierarchy'
  | 'audit'
  | 'usersRoles'
  | 'userAccess';

export const ALL_SYNC_DOMAINS: readonly SyncDomain[] = [
  'controls',
  'roleHierarchy',
  'usersRoles',
  'userAccess',
];

const DOMAIN_LABELS: Record<SyncDomain, string> = {
  controls: 'Advanced Controls & Incidents',
  roleHierarchy: 'Role Hierarchy & Functional Privileges',
  audit: 'Audit Trail Records',
  usersRoles: 'Users & Roles Directory',
  userAccess: 'User Access Report',
};

export interface DomainResult {
  success: boolean;
  domain: SyncDomain;
  label: string;
  durationMs: number;
  detail?: Record<string, unknown>;
  error?: string;
  /** VYR-044: Checkpoint committed for this domain */
  checkpoint?: SyncCheckpoint | null;
  /** VYR-044: Quarantined malformed records count */
  quarantinedCount?: number;
  /** VYR-044: Duplicates filtered for idempotency */
  duplicatesFiltered?: number;
  /** VYR-044: Retries attempted across operations */
  retriesAttempted?: number;
}

export interface PipelineResult {
  success: boolean;
  message: string;
  triggeredBy: string;
  /** VYR-042: Workload/service identity under which this sync executed. */
  serviceIdentity?: {
    principalName: string;
    identityRef: string;
    isHumanTriggered: boolean;
  };
  startedAt: string;
  completedAt: string;
  durationMs: number;
  domains: DomainResult[];
  /** VYR-041: encryption preflight outcome (present when encryption is enabled). */
  encryptionPreflight?: PreflightResult;
  /** VYR-041: the encryption policy that governed this run. */
  encryptionPolicy?: EncryptionPolicy;
  /** VYR-043: Error or status code (e.g. 'SYNC_IN_PROGRESS') */
  code?: string;
  /** VYR-043: Distributed lock outcome */
  distributedLock?: LockAcquisitionResult;
  /** VYR-044: Resilience & recovery metrics */
  resilience?: {
    checkpointsCommitted: number;
    quarantinedTotal: number;
    duplicatesFilteredTotal: number;
    retriesTotal: number;
  };
}

export interface PipelineOptions {
  /** Who triggered this sync — an email, 'SCHEDULED_OFFPEAK_CRON', etc. */
  triggeredBy: string;
  /** Which domains to sync. Defaults to all five. */
  domains?: SyncDomain[];
  /** Optional tenant identifier for multi-tenant lock isolation (VYR-043). */
  tenantId?: string;
  /** The oracleService instance (carries the Oracle Fusion HTTP client). */
  oracleService: any;
  /** Optional: filter params for audit domain. */
  auditFilter?: { fromDate?: string; toDate?: string; product?: string; businessObject?: string };
}

// ---------------------------------------------------------------------------
// Domain runners — each wraps the existing domain service call
// ---------------------------------------------------------------------------

async function syncControls(oracleService: any): Promise<Omit<DomainResult, 'durationMs'>> {
  const { attempts } = await executeWithRetry(
    () => controlRawDbService.runAutoSyncCycle(oracleService),
    {},
    'Controls Sync'
  );
  return {
    success: true,
    domain: 'controls',
    label: DOMAIN_LABELS.controls,
    retriesAttempted: Math.max(0, attempts - 1),
  };
}

async function syncRoleHierarchy(): Promise<Omit<DomainResult, 'durationMs'>> {
  const { result: res, attempts } = await executeWithRetry(
    () => roleHierarchyService.syncFromBip(),
    {},
    'Role Hierarchy Sync'
  );
  return {
    success: true,
    domain: 'roleHierarchy',
    label: DOMAIN_LABELS.roleHierarchy,
    detail: res as any,
    retriesAttempted: Math.max(0, attempts - 1),
  };
}

async function syncAudit(
  oracleService: any,
  filter?: PipelineOptions['auditFilter']
): Promise<Omit<DomainResult, 'durationMs'>> {
  const client = oracleService?.client ?? oracleService;
  const { result: res, attempts } = await executeWithRetry(
    () => auditRawDbService.runDailyIncrementalSync(client, auditProductCatalogService, filter),
    {},
    'Audit Sync'
  );
  return {
    success: true,
    domain: 'audit',
    label: DOMAIN_LABELS.audit,
    detail: res as any,
    retriesAttempted: Math.max(0, attempts - 1),
  };
}

async function syncUsersRoles(oracleService: any): Promise<Omit<DomainResult, 'durationMs'>> {
  const client = oracleService?.client ?? oracleService;
  let syncedRolesCount = 0;
  let syncedUsersCount = 0;
  let duplicatesFiltered = 0;
  let totalRetries = 0;

  if (client) {
    let roleStart = 1;
    let roleTotal: number | null = null;
    let roleBatchNum = 0;

    while (roleTotal === null || roleStart <= roleTotal) {
      roleBatchNum++;
      const { result: rolesRes, attempts } = await executeWithRetry<any>(
        () => client.getRoles({ count: 500, startIndex: roleStart }),
        {},
        'UsersRoles (getRoles)'
      );
      totalRetries += Math.max(0, attempts - 1);
      const rawBatch = rolesRes?.Resources || rolesRes?.items || [];
      if (!Array.isArray(rawBatch) || rawBatch.length === 0) break;
      if (typeof rolesRes?.totalResults === 'number') roleTotal = rolesRes.totalResults;

      // VYR-044 Idempotency: deduplicate records in batch
      const { uniqueRecords: batch, duplicatesCount } = deduplicateBatch('roles', rawBatch);
      duplicatesFiltered += duplicatesCount;

      const persisted = await userRoleRawDbService.saveRawRolesBatch(batch);
      syncedRolesCount += persisted;

      // VYR-044 Checkpoint: advance only after successful persistence
      await syncCheckpointService.commitCheckpoint({
        domain: 'usersRoles',
        batchNumber: roleBatchNum,
        cursor: `roles:${roleStart}`,
        persistedInBatch: persisted,
      });

      roleStart += rawBatch.length;
      if (rawBatch.length < 500) break;
      await throttleBetweenPages(50);
    }

    let userStart = 1;
    let userTotal: number | null = null;
    let userBatchNum = 0;

    while (userTotal === null || userStart <= userTotal) {
      userBatchNum++;
      const { result: usersRes, attempts } = await executeWithRetry<any>(
        () => client.getUsers({ count: 500, startIndex: userStart }),
        {},
        'UsersRoles (getUsers)'
      );
      totalRetries += Math.max(0, attempts - 1);
      const rawBatch = usersRes?.Resources || usersRes?.items || [];
      if (!Array.isArray(rawBatch) || rawBatch.length === 0) break;
      if (typeof usersRes?.totalResults === 'number') userTotal = usersRes.totalResults;

      // VYR-044 Idempotency: deduplicate records in batch
      const { uniqueRecords: batch, duplicatesCount } = deduplicateBatch('users', rawBatch);
      duplicatesFiltered += duplicatesCount;

      const persisted = await userRoleRawDbService.saveRawUsersBatch(batch);
      syncedUsersCount += persisted;

      // VYR-044 Checkpoint: advance only after successful persistence
      await syncCheckpointService.commitCheckpoint({
        domain: 'usersRoles',
        batchNumber: roleBatchNum + userBatchNum,
        cursor: `users:${userStart}`,
        persistedInBatch: persisted,
      });

      userStart += rawBatch.length;
      if (rawBatch.length < 500) break;
      await throttleBetweenPages(50);
    }
  }

  return {
    success: true,
    domain: 'usersRoles',
    label: DOMAIN_LABELS.usersRoles,
    detail: { roles: syncedRolesCount, users: syncedUsersCount },
    duplicatesFiltered,
    retriesAttempted: totalRetries,
  };
}

async function syncUserAccess(): Promise<Omit<DomainResult, 'durationMs'>> {
  const { result: res, attempts } = await executeWithRetry(
    () => userAccessReportService.getUserAccessReport({ syncFromOracle: true }),
    {},
    'User Access Sync'
  );
  return {
    success: true,
    domain: 'userAccess',
    label: DOMAIN_LABELS.userAccess,
    detail: { success: res.success, rows: res.data?.length || 0 },
    retriesAttempted: Math.max(0, attempts - 1),
  };
}

const DOMAIN_RUNNERS: Record<
  SyncDomain,
  (oracleService: any, filter?: PipelineOptions['auditFilter']) => Promise<Omit<DomainResult, 'durationMs'>>
> = {
  controls: (os) => syncControls(os),
  roleHierarchy: () => syncRoleHierarchy(),
  audit: (os, f) => syncAudit(os, f),
  usersRoles: (os) => syncUsersRoles(os),
  userAccess: () => syncUserAccess(),
};

// ---------------------------------------------------------------------------
// Pipeline orchestrator
// ---------------------------------------------------------------------------

export class IngestionPipelineService {

  /**
   * Runs the ingestion pipeline across the requested domains (default: all).
   * Protected by oracleSyncService's mutual-exclusion lock.
   * Wraps execution in a crypto audit service context so all decrypt/encrypt
   * operations during sync are attributed to the pipeline trigger.
   */
  public async run(options: PipelineOptions): Promise<PipelineResult> {
    const result = await this._runInternal(options);

    // VYR-045: Record operational audit event for every pipeline execution
    try {
      const auditEvent = syncMonitorService.buildEventFromPipelineResult(result);
      await syncMonitorService.recordSyncEvent(auditEvent);
    } catch (monitorErr: any) {
      console.warn(`[IngestionPipeline] Monitor recording failed (non-fatal): ${monitorErr.message}`);
    }

    return result;
  }

  private async _runInternal(options: PipelineOptions): Promise<PipelineResult> {
    const { triggeredBy, oracleService, auditFilter } = options;
    const domains = options.domains ?? [...ALL_SYNC_DOMAINS];
    const taskName = domains.length === ALL_SYNC_DOMAINS.length
      ? 'Full Oracle Synchronization'
      : `Partial Oracle Synchronization (${domains.join(', ')})`;

    if (!oracleSyncService.acquireLock(taskName, triggeredBy)) {
      return {
        success: false,
        message: 'A synchronization operation is already in progress. Please wait for it to complete.',
        code: 'SYNC_IN_PROGRESS',
        triggeredBy,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        domains: [],
      };
    }

    // ── VYR-043: Distributed lock acquisition across replicas ──────
    const tenantId = options.tenantId || '__GLOBAL__';
    const distLock = await distributedLockService.acquireLock(
      taskName,
      triggeredBy,
      { domain: 'full', tenantId }
    );

    if (!distLock.acquired) {
      oracleSyncService.releaseLock(false, 'Distributed lock contention');
      console.warn(
        `[IngestionPipeline] Synchronization rejected by distributed lock (scope: ${distLock.lockKey}, holder: ${distLock.existingHolder?.holderId || 'another replica'}).`
      );
      return {
        success: false,
        message: 'A synchronization operation is already in progress on another worker replica. Please wait for it to complete.',
        code: 'SYNC_IN_PROGRESS',
        triggeredBy,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        domains: [],
        distributedLock: distLock,
      };
    }

    const startedAt = new Date();
    console.log(`[IngestionPipeline] Starting ${taskName} triggered by: ${triggeredBy}`);

    // ── VYR-041: encryption preflight ──────────────────────────────
    const preflight = await encryptionPreflight();
    const policy = getEncryptionPolicy();

    if (!preflight.passed) {
      console.error(
        `[IngestionPipeline] Encryption preflight FAILED — aborting pipeline. ${preflight.reason}`
      );
      oracleSyncService.releaseLock(false, preflight.reason);
      await distributedLockService.releaseLock(distLock);
      return {
        success: false,
        message: `Synchronization aborted: encryption subsystem is not operational. ${preflight.reason}`,
        triggeredBy,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        domains: [],
        encryptionPreflight: preflight,
        encryptionPolicy: policy,
      };
    }

    if (preflight.encryptionEnabled) {
      console.log(`[IngestionPipeline] Encryption preflight passed. Policy: ${policy}`);
    }
    // ── end VYR-041 preflight ──────────────────────────────────────

    const results: DomainResult[] = [];
    let capturedIdentity: { principalName: string; identityRef: string; isHumanTriggered: boolean } | undefined;

    try {
      const principalName = triggeredBy === 'SCHEDULED_OFFPEAK_CRON'
        ? 'veyra-sync-worker'
        : 'veyra-pipeline';
      const servicePurpose = `ingestion-pipeline:${triggeredBy}`;

      await runAsCryptoService('ingestion-pipeline', servicePurpose, async () => {
        await serviceIdentityRegistry.runAsService(principalName, servicePurpose, triggeredBy, async (svcCtx) => {
          capturedIdentity = {
            principalName: svcCtx.identity.principalName,
            identityRef: svcCtx.identity.identityRef,
            isHumanTriggered: svcCtx.isHumanTriggered,
          };

          // VYR-042: refresh Oracle credentials from provider at runtime
          try {
            if (typeof oracleService?.recreateClientFromProvider === 'function') {
              await oracleService.recreateClientFromProvider();
            }
            if (typeof bipClient?.refreshCredentialsFromProvider === 'function') {
              await bipClient.refreshCredentialsFromProvider();
            }
          } catch (credErr: any) {
            console.warn(`[IngestionPipeline] Credential refresh warning: ${credErr.message}`);
          }

          for (const domain of domains) {
            const stepStart = Date.now();
            const stepNum = domains.indexOf(domain) + 1;

            oracleSyncService.setCurrentTask(
              `Step ${stepNum}/${domains.length}: Synchronizing ${DOMAIN_LABELS[domain]}...`
            );

            // VYR-044: Initialize checkpoint tracking for domain
            await syncCheckpointService.startCheckpoint(domain, tenantId);

            try {
              console.log(`[IngestionPipeline] Step ${stepNum}/${domains.length}: ${DOMAIN_LABELS[domain]}...`);
              const runner = DOMAIN_RUNNERS[domain];
              // VYR-041: wrap the domain step so encryption failures are
              // quarantined (FAIL_DOMAIN) or escalated (FAIL_PIPELINE).
              const guarded = withEncryptionGuard(
                DOMAIN_LABELS[domain],
                () => runner(oracleService, auditFilter),
                policy
              );
              const partial = await guarded();

              // VYR-044: Advance & complete checkpoint only after successful persistence
              const committedCp = await syncCheckpointService.commitCheckpoint({
                domain,
                tenantId,
                batchNumber: 1,
                persistedInBatch: 0,
                isComplete: true,
              });
              const qSummary = await syncCheckpointService.getQuarantineSummary(domain, tenantId);

              results.push({
                ...partial,
                durationMs: Date.now() - stepStart,
                checkpoint: committedCp,
                quarantinedCount: qSummary.quarantined,
              });
            } catch (err: any) {
              // VYR-041: sanitise error messages before logging to prevent
              // Oracle response data or key material from leaking into logs.
              const safeMsg = safePipelineError(err);
              console.warn(`[IngestionPipeline] ${DOMAIN_LABELS[domain]} failed: ${safeMsg}`);

              // VYR-044: Record failure in checkpoint preserving last safe watermark
              const failedCp = await syncCheckpointService.failCheckpoint(domain, safeMsg, tenantId);
              const qSummary = await syncCheckpointService.getQuarantineSummary(domain, tenantId);

              results.push({
                success: false,
                domain,
                label: DOMAIN_LABELS[domain],
                durationMs: Date.now() - stepStart,
                error: safeMsg,
                checkpoint: failedCp,
                quarantinedCount: qSummary.quarantined,
              });
            }
          }
        });
      });

      const completedAt = new Date();
      const allOk = results.every((r) => r.success);
      oracleSyncService.releaseLock(allOk);
      await distributedLockService.releaseLock(distLock);

      console.log(`[IngestionPipeline] ${taskName} completed (${allOk ? 'all succeeded' : 'some domains failed'}).`);

      const checkpointsCommitted = results.filter((r) => r.checkpoint?.status === 'SUCCESS').length;
      const quarantinedTotal = results.reduce((acc, r) => acc + (r.quarantinedCount || 0), 0);
      const duplicatesFilteredTotal = results.reduce((acc, r) => acc + (r.duplicatesFiltered || 0), 0);
      const retriesTotal = results.reduce((acc, r) => acc + (r.retriesAttempted || 0), 0);

      return {
        success: true,
        message: allOk
          ? 'Oracle data synchronization completed successfully.'
          : 'Oracle synchronization completed with partial failures (see domains).',
        triggeredBy,
        serviceIdentity: capturedIdentity,
        distributedLock: distLock,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        domains: results,
        encryptionPreflight: preflight,
        encryptionPolicy: policy,
        resilience: {
          checkpointsCommitted,
          quarantinedTotal,
          duplicatesFilteredTotal,
          retriesTotal,
        },
      };
    } catch (err: any) {
      // VYR-041: sanitise fatal error logging
      const safeMsg = safePipelineError(err);
      console.error(`[IngestionPipeline] ${taskName} fatal error: ${safeMsg}`);
      oracleSyncService.releaseLock(false, safeMsg);
      await distributedLockService.releaseLock(distLock);

      return {
        success: false,
        message: `Synchronization failed: ${safeMsg}`,
        triggeredBy,
        serviceIdentity: capturedIdentity,
        distributedLock: distLock,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        domains: results,
        encryptionPreflight: preflight,
        encryptionPolicy: policy,
      };
    }
  }

  /**
   * Runs a single domain outside the full-sync lock.
   * Used by on-demand routes (e.g. POST /audit/sync) that sync one domain
   * without blocking the entire pipeline. Still checks isCurrentlySyncing
   * for the 409 guard the routes already enforce.
   */
  public async runDomain(
    domain: SyncDomain,
    oracleService: any,
    triggeredBy: string,
    auditFilter?: PipelineOptions['auditFilter']
  ): Promise<DomainResult> {
    const domainStart = new Date();
    const stepStart = Date.now();
    const taskName = `On-demand ${DOMAIN_LABELS[domain]}`;

    // VYR-043: Acquire domain-scoped distributed lock
    const distLock = await distributedLockService.acquireLock(
      taskName,
      triggeredBy,
      { domain, tenantId: '__GLOBAL__' }
    );

    if (!distLock.acquired) {
      console.warn(
        `[IngestionPipeline] Domain "${domain}" rejected: distributed lock active (holder: ${distLock.existingHolder?.holderId || 'another replica'}).`
      );
      const lockedResult: DomainResult = {
        success: false,
        domain,
        label: DOMAIN_LABELS[domain],
        durationMs: Date.now() - stepStart,
        error: `Synchronization for ${DOMAIN_LABELS[domain]} is already in progress on another worker replica.`,
      };

      // VYR-045: Record lock contention event
      try {
        const wrapResult = { success: false, code: 'SYNC_IN_PROGRESS', triggeredBy, startedAt: domainStart.toISOString(), completedAt: new Date().toISOString(), durationMs: lockedResult.durationMs, domains: [lockedResult] };
        const ev = syncMonitorService.buildEventFromPipelineResult(wrapResult);
        await syncMonitorService.recordSyncEvent(ev);
      } catch {}

      return lockedResult;
    }

    let domainResult: DomainResult;
    try {
      const principalName = triggeredBy === 'SCHEDULED_OFFPEAK_CRON'
        ? 'veyra-sync-worker'
        : domain === 'audit'
        ? 'veyra-audit-sync'
        : domain === 'roleHierarchy'
        ? 'veyra-role-sync'
        : 'veyra-pipeline';
      const servicePurpose = `ingestion-pipeline:${domain}:${triggeredBy}`;

      domainResult = await runAsCryptoService('ingestion-pipeline', servicePurpose, async () => {
        return serviceIdentityRegistry.runAsService(principalName, servicePurpose, triggeredBy, async () => {
          // VYR-042: refresh credentials before on-demand run
          try {
            if (typeof oracleService?.recreateClientFromProvider === 'function') {
              await oracleService.recreateClientFromProvider();
            }
            if (typeof bipClient?.refreshCredentialsFromProvider === 'function') {
              await bipClient.refreshCredentialsFromProvider();
            }
          } catch (credErr: any) {
            console.warn(`[IngestionPipeline] Credential refresh warning: ${credErr.message}`);
          }

          // VYR-044: Initialize checkpoint for on-demand domain run
          await syncCheckpointService.startCheckpoint(domain, '__GLOBAL__');

          try {
            console.log(`[IngestionPipeline] On-demand ${DOMAIN_LABELS[domain]} triggered by: ${triggeredBy}`);
            const runner = DOMAIN_RUNNERS[domain];
            // VYR-041: guard on-demand runs the same as full-pipeline domains
            const guarded = withEncryptionGuard(
              DOMAIN_LABELS[domain],
              () => runner(oracleService, auditFilter),
              getEncryptionPolicy()
            );
            const partial = await guarded();

            // VYR-044: Advance and commit checkpoint on success
            const committedCp = await syncCheckpointService.commitCheckpoint({
              domain,
              batchNumber: 1,
              persistedInBatch: 0,
              isComplete: true,
            });
            const qSummary = await syncCheckpointService.getQuarantineSummary(domain);

            return {
              ...partial,
              durationMs: Date.now() - stepStart,
              checkpoint: committedCp,
              quarantinedCount: qSummary.quarantined,
            } as DomainResult;
          } catch (err: any) {
            // VYR-041: sanitise error messages
            const safeMsg = safePipelineError(err);
            console.warn(`[IngestionPipeline] On-demand ${DOMAIN_LABELS[domain]} failed: ${safeMsg}`);

            // VYR-044: Record failure preserving last safe watermark
            const failedCp = await syncCheckpointService.failCheckpoint(domain, safeMsg);
            const qSummary = await syncCheckpointService.getQuarantineSummary(domain);

            return {
              success: false,
              domain,
              label: DOMAIN_LABELS[domain],
              durationMs: Date.now() - stepStart,
              error: safeMsg,
              checkpoint: failedCp,
              quarantinedCount: qSummary.quarantined,
            } as DomainResult;
          }
        });
      });
    } finally {
      await distributedLockService.releaseLock(distLock);
    }

    // VYR-045: Record domain-level operational audit event
    try {
      const wrapResult = {
        success: domainResult.success,
        triggeredBy,
        startedAt: domainStart.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: domainResult.durationMs,
        domains: [domainResult],
      };
      const ev = syncMonitorService.buildEventFromPipelineResult(wrapResult);
      await syncMonitorService.recordSyncEvent(ev);
    } catch (monitorErr: any) {
      console.warn(`[IngestionPipeline] Monitor recording failed (non-fatal): ${monitorErr.message}`);
    }

    return domainResult;
  }

  /** Exposes sync status from the underlying mutex. */
  public getStatus(): SyncStatus {
    return oracleSyncService.getStatus();
  }

  /** Whether a sync is currently running. */
  public isRunning(): boolean {
    return oracleSyncService.isCurrentlySyncing();
  }
}

export const ingestionPipeline = new IngestionPipelineService();
