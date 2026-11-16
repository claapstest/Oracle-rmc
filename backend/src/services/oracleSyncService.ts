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
