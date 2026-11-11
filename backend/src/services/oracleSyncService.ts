import { query } from '../db.js';
import { controlRawDbService } from './controlRawDbService.js';
import { roleHierarchyService } from './roleHierarchyService.js';
import { auditRawDbService } from './auditRawDbService.js';
import { auditProductCatalogService } from './auditProductCatalogService.js';
import { userRoleRawDbService } from './userRoleRawDbService.js';
import { userAccessReportService } from './userAccessReportService.js';

export interface SyncStatus {
  isSyncing: boolean;
  currentTask: string | null;
  startedAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: 'IDLE' | 'SYNCING' | 'SUCCESS' | 'ERROR';
  lastError: string | null;
  triggeredBy: string | null;
}

export class OracleSyncService {
  private isSyncing = false;
  private currentTask: string | null = null;
  private startedAt: string | null = null;
  private lastCompletedAt: string | null = null;
  private lastStatus: 'IDLE' | 'SYNCING' | 'SUCCESS' | 'ERROR' = 'IDLE';
  private lastError: string | null = null;
  private triggeredBy: string | null = null;

  public getStatus(): SyncStatus {
    return {
      isSyncing: this.isSyncing,
      currentTask: this.currentTask,
      startedAt: this.startedAt,
      lastCompletedAt: this.lastCompletedAt,
      lastStatus: this.lastStatus,
      lastError: this.lastError,
      triggeredBy: this.triggeredBy,
    };
  }

  public isCurrentlySyncing(): boolean {
    return this.isSyncing;
  }

  /**
   * Acquire a mutex lock for sync operations.
   * If a sync is already running, throws an error or returns false.
   */
  public acquireLock(taskName: string, triggeredBy: string): boolean {
    if (this.isSyncing) {
      return false;
    }
    this.isSyncing = true;
    this.currentTask = taskName;
    this.startedAt = new Date().toISOString();
    this.lastStatus = 'SYNCING';
    this.lastError = null;
    this.triggeredBy = triggeredBy;
    return true;
  }

  public releaseLock(success: boolean, error?: string) {
    this.isSyncing = false;
    this.currentTask = null;
    this.lastCompletedAt = new Date().toISOString();
    this.lastStatus = success ? 'SUCCESS' : 'ERROR';
    if (error) {
      this.lastError = error;
    }
  }

  /**
   * Runs a complete end-to-end sync across all Oracle data domains:
   * 1. Controls & Incidents
   * 2. Role Hierarchy & Privileges (from BIP report)
   * 3. Audit Trail Records
   * 4. Users & Roles
   *
   * Protected by a mutual exclusion lock to prevent concurrent sync executions.
   */
  public async runFullSync(
    oracleService: any,
    triggeredBy = 'ADMIN'
  ): Promise<{ success: boolean; message: string; details?: any }> {
    if (!this.acquireLock('Full Oracle Synchronization', triggeredBy)) {
      return {
        success: false,
        message: 'A synchronization operation is already in progress. Please wait for it to complete.',
      };
    }

    console.log(`[OracleSyncService] Starting full synchronization triggered by: ${triggeredBy}`);
    const results: Record<string, any> = {};

    try {
      // 1. Controls & Incidents Sync
      this.currentTask = 'Synchronizing Advanced Controls & Incidents...';
      try {
        console.log('[OracleSyncService] Step 1/4: Syncing Controls & Incidents...');
        await controlRawDbService.runAutoSyncCycle(oracleService);
        results.controls = { success: true };
      } catch (err: any) {
        console.warn('[OracleSyncService] Controls sync warning:', err.message);
        results.controls = { success: false, error: err.message };
      }

      // 2. Role Hierarchy & Privileges Sync
      this.currentTask = 'Synchronizing Role Hierarchy & Functional Privileges...';
      try {
        console.log('[OracleSyncService] Step 2/4: Syncing Role Hierarchy via BIP...');
        const roleRes = await roleHierarchyService.syncFromBip();
        results.roleHierarchy = roleRes;
      } catch (err: any) {
        console.warn('[OracleSyncService] Role hierarchy sync warning:', err.message);
        results.roleHierarchy = { success: false, error: err.message };
      }

      // 3. Audit Trail Sync
      this.currentTask = 'Synchronizing Audit Trail Records...';
      try {
        console.log('[OracleSyncService] Step 3/4: Syncing Audit Trail...');
        const auditRes = await auditRawDbService.runDailyIncrementalSync(
          (oracleService as any).client,
          auditProductCatalogService
        );
        results.audit = auditRes;
      } catch (err: any) {
        console.warn('[OracleSyncService] Audit sync warning:', err.message);
        results.audit = { success: false, error: err.message };
      }

      // 4. Users & Roles Sync (SCIM paginated)
      this.currentTask = 'Synchronizing Users & Roles Directory...';
      try {
        console.log('[OracleSyncService] Step 4/5: Syncing Users & Roles...');
        const client = (oracleService as any).client;
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
        results.usersRoles = { success: true, roles: syncedRolesCount, users: syncedUsersCount };
      } catch (err: any) {
        console.warn('[OracleSyncService] Users/roles sync warning:', err.message);
        results.usersRoles = { success: false, error: err.message };
      }

      // 5. User Access Report Sync (SCIM + HCM Workers + BIP Auto-Provisioning)
      this.currentTask = 'Synchronizing User Access Report...';
      try {
        console.log('[OracleSyncService] Step 5/5: Syncing User Access Report to PostgreSQL...');
        const uaRes = await userAccessReportService.getUserAccessReport({ syncFromOracle: true });
        results.userAccess = { success: uaRes.success, rows: uaRes.data?.length || 0 };
      } catch (err: any) {
        console.warn('[OracleSyncService] User Access sync warning:', err.message);
        results.userAccess = { success: false, error: err.message };
      }

      this.releaseLock(true);
      console.log('[OracleSyncService] Full synchronization completed successfully.');

      return {
        success: true,
        message: 'Oracle data synchronization completed successfully.',
        details: results
      };
    } catch (err: any) {
      console.error('[OracleSyncService] Full synchronization encountered an error:', err.message);
      this.releaseLock(false, err.message);

      return {
        success: false,
        message: `Synchronization failed: ${err.message}`,
        details: results
      };
    }
  }
}

export const oracleSyncService = new OracleSyncService();
