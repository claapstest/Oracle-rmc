import { distributedLockService, type LockAcquisitionResult, type LockScope } from './distributedLockService.js';

export interface SyncStatus {
  isSyncing: boolean;
  currentTask: string | null;
  startedAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: 'IDLE' | 'SYNCING' | 'SUCCESS' | 'ERROR';
  lastError: string | null;
  triggeredBy: string | null;
  distributedLock?: LockAcquisitionResult | null;
}

export class OracleSyncService {
  private isSyncing = false;
  private currentTask: string | null = null;
  private startedAt: string | null = null;
  private lastCompletedAt: string | null = null;
  private lastStatus: 'IDLE' | 'SYNCING' | 'SUCCESS' | 'ERROR' = 'IDLE';
  private lastError: string | null = null;
  private triggeredBy: string | null = null;
  private currentDistributedLock: LockAcquisitionResult | null = null;

  public getStatus(): SyncStatus {
    return {
      isSyncing: this.isSyncing,
      currentTask: this.currentTask,
      startedAt: this.startedAt,
      lastCompletedAt: this.lastCompletedAt,
      lastStatus: this.lastStatus,
      lastError: this.lastError,
      triggeredBy: this.triggeredBy,
      distributedLock: this.currentDistributedLock,
    };
  }

  public isCurrentlySyncing(): boolean {
    return this.isSyncing;
  }

  /**
   * Acquire a local in-process mutex lock for sync operations (Code Area 1 safeguard).
   * Fast-fails within the local Node process without database network roundtrips.
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

  /**
   * Acquire distributed lock across replicas with in-process safeguard (VYR-043).
   */
  public async acquireDistributedLock(
    taskName: string,
    triggeredBy: string,
    scope?: LockScope
  ): Promise<LockAcquisitionResult> {
    // 1. Local mutex safeguard check
    if (!this.acquireLock(taskName, triggeredBy)) {
      return {
        acquired: false,
        lockKey: scope?.domain || 'full',
        holderId: 'local-process',
        errorReason: 'LOCAL_MUTEX_LOCKED',
      };
    }

    // 2. Distributed lock across replicas
    const result = await distributedLockService.acquireLock(taskName, triggeredBy, scope);
    if (!result.acquired) {
      // Release local lock if distributed lock fails
      this.isSyncing = false;
      this.currentTask = null;
      return result;
    }

    this.currentDistributedLock = result;
    return result;
  }

  public releaseLock(success: boolean, error?: string) {
    this.isSyncing = false;
    this.currentTask = null;
    this.lastCompletedAt = new Date().toISOString();
    this.lastStatus = success ? 'SUCCESS' : 'ERROR';
    if (error) {
      this.lastError = error;
    }
    if (this.currentDistributedLock) {
      distributedLockService.releaseLock(this.currentDistributedLock).catch(() => {});
      this.currentDistributedLock = null;
    }
  }

  /**
   * Asynchronously releases both local and distributed lock.
   */
  public async releaseDistributedLock(success: boolean, error?: string): Promise<void> {
    this.isSyncing = false;
    this.currentTask = null;
    this.lastCompletedAt = new Date().toISOString();
    this.lastStatus = success ? 'SUCCESS' : 'ERROR';
    if (error) {
      this.lastError = error;
    }
    if (this.currentDistributedLock) {
      await distributedLockService.releaseLock(this.currentDistributedLock);
      this.currentDistributedLock = null;
    }
  }

  /** Allows the ingestion pipeline to update progress text. */
  public setCurrentTask(task: string): void {
    this.currentTask = task;
  }

  /**
   * Runs a full sync via the shared ingestion pipeline (VYR-040).
   * Kept for backward compatibility — callers that already use
   * `oracleSyncService.runFullSync(...)` continue to work.
   */
  public async runFullSync(
    oracleService: any,
    triggeredBy = 'ADMIN'
  ): Promise<{ success: boolean; message: string; details?: any }> {
    // Lazy import to avoid circular dependency at module load time
    const { ingestionPipeline } = await import('./ingestionPipelineService.js');
    const result = await ingestionPipeline.run({ triggeredBy, oracleService });

    const details: Record<string, any> = {};
    for (const d of result.domains) {
      details[d.domain] = d.success
        ? { success: true, ...(d.detail || {}) }
        : { success: false, error: d.error };
    }

    return {
      success: result.success,
      message: result.message,
      details,
    };
  }
}

export const oracleSyncService = new OracleSyncService();
