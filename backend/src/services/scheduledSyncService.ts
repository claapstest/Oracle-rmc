import { oracleSyncService } from './oracleSyncService.js';

export class ScheduledSyncService {
  private timer: NodeJS.Timeout | null = null;
  private isInitialized = false;

  /**
   * Initializes the off-peak scheduled sync.
   * Runs daily at the configured off-peak hour (default: 23 = 11:00 PM).
   *
   * @param oracleService The oracleService instance used to perform data sync
   * @param targetHour The target hour in 24h format (default: 23 = 11:00 PM)
   */
  public initialize(oracleService: any, targetHour = 23): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    const envHour = process.env.SYNC_OFFPEAK_HOUR;
    const hour = envHour !== undefined ? parseInt(envHour, 10) : targetHour;
    const validHour = isNaN(hour) || hour < 0 || hour > 23 ? 23 : hour;

    this.scheduleNextRun(oracleService, validHour);
    console.log(`[ScheduledSyncService] Initialized off-peak synchronization schedule for ${validHour}:00 daily.`);
  }

  private scheduleNextRun(oracleService: any, targetHour: number): void {
    const now = new Date();
    const nextRun = new Date();
    nextRun.setHours(targetHour, 0, 0, 0);

    // If target hour has already passed today, schedule for tomorrow
    if (now.getTime() >= nextRun.getTime()) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    const delayMs = nextRun.getTime() - now.getTime();
    const hoursAway = (delayMs / (1000 * 60 * 60)).toFixed(1);

    console.log(`[ScheduledSyncService] Next off-peak synchronization scheduled at ${nextRun.toLocaleString()} (~${hoursAway} hours from now).`);

    this.timer = setTimeout(async () => {
      console.log(`[ScheduledSyncService] Off-peak window reached (${targetHour}:00). Initiating background synchronization...`);
      try {
        await oracleSyncService.runFullSync(oracleService, 'SCHEDULED_OFFPEAK_CRON');
      } catch (err: any) {
        console.error('[ScheduledSyncService] Nightly synchronization encountered error:', err.message);
      } finally {
        // Schedule next run for 24 hours later
        this.scheduleNextRun(oracleService, targetHour);
      }
    }, delayMs);

    if (this.timer && typeof (this.timer as any).unref === 'function') {
      (this.timer as any).unref();
    }
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.isInitialized = false;
  }
}

export const scheduledSyncService = new ScheduledSyncService();
