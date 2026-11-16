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
import {
  encryptionPreflight,
  safePipelineError,
  withEncryptionGuard,
  getEncryptionPolicy,
  type PreflightResult,
  type EncryptionPolicy,
} from './ingestionEncryptionGuard.js';

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
  'audit',
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
}

export interface PipelineOptions {
  /** Who triggered this sync — an email, 'SCHEDULED_OFFPEAK_CRON', etc. */
  triggeredBy: string;
  /** Which domains to sync. Defaults to all five. */
  domains?: SyncDomain[];
  /** The oracleService instance (carries the Oracle Fusion HTTP client). */
  oracleService: any;
  /** Optional: filter params for audit domain. */
  auditFilter?: { fromDate?: string; toDate?: string; product?: string; businessObject?: string };
}

// ---------------------------------------------------------------------------
// Domain runners — each wraps the existing domain service call
// ---------------------------------------------------------------------------

async function syncControls(oracleService: any): Promise<Omit<DomainResult, 'durationMs'>> {
  await controlRawDbService.runAutoSyncCycle(oracleService);
  return { success: true, domain: 'controls', label: DOMAIN_LABELS.controls };
}

async function syncRoleHierarchy(): Promise<Omit<DomainResult, 'durationMs'>> {
  const res = await roleHierarchyService.syncFromBip();
  return { success: true, domain: 'roleHierarchy', label: DOMAIN_LABELS.roleHierarchy, detail: res as any };
}

async function syncAudit(
  oracleService: any,
  filter?: PipelineOptions['auditFilter']
): Promise<Omit<DomainResult, 'durationMs'>> {
  const client = oracleService?.client ?? oracleService;
  const res = await auditRawDbService.runDailyIncrementalSync(client, auditProductCatalogService, filter);
  return { success: true, domain: 'audit', label: DOMAIN_LABELS.audit, detail: res as any };
}

async function syncUsersRoles(oracleService: any): Promise<Omit<DomainResult, 'durationMs'>> {
  const client = oracleService?.client ?? oracleService;
  let syncedRolesCount = 0;
  let syncedUsersCount = 0;

  if (client) {
    let roleStart = 1;
    let roleTotal: number | null = null;
    while (roleTotal === null || roleStart <= roleTotal) {
      const rolesRes = await client.getRoles({ count: 500, startIndex: roleStart });
      const batch = rolesRes?.Resources || rolesRes?.items || [];
      if (!Array.isArray(batch) || batch.length === 0) break;
      if (typeof rolesRes?.totalResults === 'number') roleTotal = rolesRes.totalResults;
      syncedRolesCount += await userRoleRawDbService.saveRawRolesBatch(batch);
      roleStart += batch.length;
      if (batch.length < 500) break;
    }

    let userStart = 1;
    let userTotal: number | null = null;
    while (userTotal === null || userStart <= userTotal) {
      const usersRes = await client.getUsers({ count: 500, startIndex: userStart });
      const batch = usersRes?.Resources || usersRes?.items || [];
      if (!Array.isArray(batch) || batch.length === 0) break;
      if (typeof usersRes?.totalResults === 'number') userTotal = usersRes.totalResults;
      syncedUsersCount += await userRoleRawDbService.saveRawUsersBatch(batch);
      userStart += batch.length;
      if (batch.length < 500) break;
    }
  }

  return {
    success: true,
    domain: 'usersRoles',
    label: DOMAIN_LABELS.usersRoles,
    detail: { roles: syncedRolesCount, users: syncedUsersCount },
  };
}

async function syncUserAccess(): Promise<Omit<DomainResult, 'durationMs'>> {
  const res = await userAccessReportService.getUserAccessReport({ syncFromOracle: true });
  return {
    success: true,
    domain: 'userAccess',
    label: DOMAIN_LABELS.userAccess,
    detail: { success: res.success, rows: res.data?.length || 0 },
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
    const { triggeredBy, oracleService, auditFilter } = options;
    const domains = options.domains ?? [...ALL_SYNC_DOMAINS];
    const taskName = domains.length === ALL_SYNC_DOMAINS.length
      ? 'Full Oracle Synchronization'
      : `Partial Oracle Synchronization (${domains.join(', ')})`;

    if (!oracleSyncService.acquireLock(taskName, triggeredBy)) {
      return {
        success: false,
        message: 'A synchronization operation is already in progress. Please wait for it to complete.',
        triggeredBy,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        domains: [],
      };
    }

    const startedAt = new Date();
    console.log(`[IngestionPipeline] Starting ${taskName} triggered by: ${triggeredBy}`);

    // ?????? VYR-041: encryption preflight ??????????????????????????????????????????????????????????????????????????????????????????
    const preflight = await encryptionPreflight();
    const policy = getEncryptionPolicy();

    if (!preflight.passed) {
      console.error(
        `[IngestionPipeline] Encryption preflight FAILED ??? aborting pipeline. ${preflight.reason}`
      );
      oracleSyncService.releaseLock(false, preflight.reason);
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
    // ?????? end VYR-041 preflight ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????

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
              results.push({ ...partial, durationMs: Date.now() - stepStart });
            } catch (err: any) {
              // VYR-041: sanitise error messages before logging to prevent
              // Oracle response data or key material from leaking into logs.
              const safeMsg = safePipelineError(err);
              console.warn(`[IngestionPipeline] ${DOMAIN_LABELS[domain]} failed: ${safeMsg}`);
              results.push({
                success: false,
                domain,
                label: DOMAIN_LABELS[domain],
                durationMs: Date.now() - stepStart,
                error: safeMsg,
              });
            }
          }
        });
      });

      const completedAt = new Date();
      const allOk = results.every((r) => r.success);
      oracleSyncService.releaseLock(allOk);

      console.log(`[IngestionPipeline] ${taskName} completed (${allOk ? 'all succeeded' : 'some domains failed'}).`);

      return {
        success: true,
        message: allOk
          ? 'Oracle data synchronization completed successfully.'
          : 'Oracle synchronization completed with partial failures (see domains).',
        triggeredBy,
        serviceIdentity: capturedIdentity,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        domains: results,
        encryptionPreflight: preflight,
        encryptionPolicy: policy,
      };
    } catch (err: any) {
      // VYR-041: sanitise fatal error logging
      const safeMsg = safePipelineError(err);
      console.error(`[IngestionPipeline] ${taskName} fatal error: ${safeMsg}`);
      oracleSyncService.releaseLock(false, safeMsg);

      return {
        success: false,
        message: `Synchronization failed: ${safeMsg}`,
        triggeredBy,
        serviceIdentity: capturedIdentity,
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
    const stepStart = Date.now();
    const principalName = triggeredBy === 'SCHEDULED_OFFPEAK_CRON'
      ? 'veyra-sync-worker'
      : domain === 'audit'
      ? 'veyra-audit-sync'
      : domain === 'roleHierarchy'
      ? 'veyra-role-sync'
      : 'veyra-pipeline';
    const servicePurpose = `ingestion-pipeline:${domain}:${triggeredBy}`;

    return runAsCryptoService('ingestion-pipeline', servicePurpose, async () => {
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
          return { ...partial, durationMs: Date.now() - stepStart };
        } catch (err: any) {
          // VYR-041: sanitise error messages
          const safeMsg = safePipelineError(err);
          console.warn(`[IngestionPipeline] On-demand ${DOMAIN_LABELS[domain]} failed: ${safeMsg}`);
          return {
            success: false,
            domain,
            label: DOMAIN_LABELS[domain],
            durationMs: Date.now() - stepStart,
            error: safeMsg,
          };
        }
      });
    });
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
