import { query } from '../db.js';
import { controlRawDbService } from './controlRawDbService.js';
import { roleHierarchyService } from './roleHierarchyService.js';
import { auditRawDbService } from './auditRawDbService.js';
import { auditProductCatalogService } from './auditProductCatalogService.js';
import { userRoleRawDbService } from './userRoleRawDbService.js';

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

      // 4. Users & Roles Sync
      this.currentTask = 'Synchronizing Users & Roles Directory...';
      try {
        console.log('[OracleSyncService] Step 4/4: Syncing Users & Roles...');
        const client = (oracleService as any).client;
        if (client) {
          const rolesRes = await client.getRoles({ limit: 500 });
          if (Array.isArray(rolesRes?.items)) {
            await userRoleRawDbService.saveRawRolesBatch(rolesRes.items);
          }
          const usersRes = await client.getUsers({ limit: 500 });
          if (Array.isArray(usersRes?.items)) {
            await userRoleRawDbService.saveRawUsersBatch(usersRes.items);
          }
        }
        results.usersRoles = { success: true };
      } catch (err: any) {
        console.warn('[OracleSyncService] Users/roles sync warning:', err.message);
        results.usersRoles = { success: false, error: err.message };
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
