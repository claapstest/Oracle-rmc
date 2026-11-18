/**
 * Sync Monitor Service
 * Story ID: VYR-045
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both
 *
 * Provides safe observability for scheduled and manual sync operations:
 *   1. Records operational audit events (job ID, tenant, domain, start/end,
 *      fetched/saved/skipped/failed counts, duration) to a Postgres table.
 *   2. Records safe error category and correlation ID — never raw payloads
 *      or credentials.
 *   3. Exposes operational status to authorized administrators.
 *   4. Alerts on repeated failures, stale last-sync time, lock contention
 *      and encryption/KMS failures.
 */

import crypto from 'crypto';
import { query as dbQuery } from '../db.js';
import { maskSensitive } from '../security/cryptoFailure.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncEventOutcome = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'ABORTED' | 'LOCK_CONTENTION';

export interface SyncAuditEvent {
  jobId: string;
  tenantId: string;
  triggeredBy: string;
  isHumanTriggered: boolean;
  serviceIdentity: string | null;
  domains: string[];
  outcome: SyncEventOutcome;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  domainResults: DomainMetrics[];
  errorCategory: string | null;
  correlationId: string;
  encryptionStatus: string | null;
  lockType: string | null;
}

export interface DomainMetrics {
  domain: string;
  success: boolean;
  durationMs: number;
  fetchedCount?: number;
  savedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  duplicatesFiltered?: number;
  retriesAttempted?: number;
  quarantinedCount?: number;
  errorCategory?: string;
  errorMessage?: string;
}

export type AlertSeverity = 'WARNING' | 'CRITICAL';
export type AlertType =
  | 'REPEATED_SYNC_FAILURES'
  | 'STALE_LAST_SYNC'
  | 'LOCK_CONTENTION'
  | 'ENCRYPTION_FAILURE'
  | 'DOMAIN_DEGRADED';

export interface SyncAlert {
  alertId: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  raisedAt: string;
  resolvedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface SyncHealthStatus {
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  lastSuccessfulSync: string | null;
  lastSyncAttempt: string | null;
  consecutiveFailures: number;
  activeAlerts: SyncAlert[];
  recentAlerts: SyncAlert[];
  staleSyncThresholdHours: number;
  isSyncStale: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABLE_NAME = 'veyra_sync_audit_event';
const ALERT_TABLE_NAME = 'veyra_sync_alerts';

const STALE_SYNC_HOURS = parseInt(process.env.VEYRA_STALE_SYNC_HOURS || '26', 10);
const FAILURE_ALERT_THRESHOLD = parseInt(process.env.VEYRA_SYNC_FAILURE_ALERT_THRESHOLD || '3', 10);
const LOCK_CONTENTION_THRESHOLD = parseInt(process.env.VEYRA_SYNC_LOCK_ALERT_THRESHOLD || '5', 10);
const ALERT_COOLDOWN_MINUTES = parseInt(process.env.VEYRA_SYNC_ALERT_COOLDOWN_MINUTES || '30', 10);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class SyncMonitorService {
  private tableEnsured = false;
  private alertTableEnsured = false;
  private consecutiveFailures = 0;
  private lockContentionCount = 0;
  private lockContentionWindowStart = 0;
  private lastAlertTimes = new Map<AlertType, number>();

  private async ensureTable(): Promise<void> {
    if (this.tableEnsured) return;
    try {
      await dbQuery(`
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          id            BIGSERIAL PRIMARY KEY,
          job_id        VARCHAR(64) NOT NULL,
          tenant_id     VARCHAR(128) NOT NULL DEFAULT '__GLOBAL__',
          triggered_by  VARCHAR(255) NOT NULL,
          is_human      BOOLEAN NOT NULL DEFAULT false,
          service_identity VARCHAR(128),
          domains       JSONB NOT NULL DEFAULT '[]',
          outcome       VARCHAR(32) NOT NULL,
          started_at    TIMESTAMPTZ NOT NULL,
          completed_at  TIMESTAMPTZ NOT NULL,
          duration_ms   INTEGER NOT NULL,
          domain_results JSONB NOT NULL DEFAULT '[]',
          error_category VARCHAR(64),
          correlation_id VARCHAR(64) NOT NULL,
          encryption_status VARCHAR(32),
          lock_type     VARCHAR(32),
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await dbQuery(`CREATE INDEX IF NOT EXISTS idx_sync_audit_job_id ON ${TABLE_NAME} (job_id);`);
      await dbQuery(`CREATE INDEX IF NOT EXISTS idx_sync_audit_outcome ON ${TABLE_NAME} (outcome, created_at DESC);`);
      await dbQuery(`CREATE INDEX IF NOT EXISTS idx_sync_audit_tenant ON ${TABLE_NAME} (tenant_id, created_at DESC);`);
      this.tableEnsured = true;
    } catch (err: any) {
      console.error(`[SyncMonitor] Failed to ensure audit table: ${err.message}`);
    }
  }

  private async ensureAlertTable(): Promise<void> {
    if (this.alertTableEnsured) return;
    try {
      await dbQuery(`
        CREATE TABLE IF NOT EXISTS ${ALERT_TABLE_NAME} (
          id           BIGSERIAL PRIMARY KEY,
          alert_id     VARCHAR(64) NOT NULL UNIQUE,
          alert_type   VARCHAR(64) NOT NULL,
          severity     VARCHAR(16) NOT NULL,
          message      TEXT NOT NULL,
          raised_at    TIMESTAMPTZ NOT NULL,
          resolved_at  TIMESTAMPTZ,
          metadata     JSONB NOT NULL DEFAULT '{}',
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await dbQuery(`CREATE INDEX IF NOT EXISTS idx_sync_alerts_type ON ${ALERT_TABLE_NAME} (alert_type, raised_at DESC);`);
      await dbQuery(`CREATE INDEX IF NOT EXISTS idx_sync_alerts_active ON ${ALERT_TABLE_NAME} (resolved_at) WHERE resolved_at IS NULL;`);
      this.alertTableEnsured = true;
    } catch (err: any) {
      console.error(`[SyncMonitor] Failed to ensure alert table: ${err.message}`);
    }
  }

  private generateJobId(): string {
    return `SYN-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private generateCorrelationId(): string {
    return `COR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private generateAlertId(): string {
    return `ALR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  }

  // -------------------------------------------------------------------------
  // Record sync events
  // -------------------------------------------------------------------------

  public async recordSyncEvent(event: SyncAuditEvent): Promise<void> {
    await this.ensureTable();

    const safeDomainResults = event.domainResults.map(d => ({
      ...d,
      errorMessage: d.errorMessage ? maskSensitive(d.errorMessage, 200) : undefined,
    }));

    try {
      await dbQuery(
        `INSERT INTO ${TABLE_NAME}
          (job_id, tenant_id, triggered_by, is_human, service_identity, domains,
           outcome, started_at, completed_at, duration_ms, domain_results,
           error_category, correlation_id, encryption_status, lock_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          event.jobId,
          event.tenantId,
          event.triggeredBy,
          event.isHumanTriggered,
          event.serviceIdentity,
          JSON.stringify(event.domains),
          event.outcome,
          event.startedAt,
          event.completedAt,
          event.durationMs,
          JSON.stringify(safeDomainResults),
          event.errorCategory,
          event.correlationId,
          event.encryptionStatus,
          event.lockType,
        ]
      );
    } catch (err: any) {
      console.error(`[SyncMonitor] Failed to record sync event ${event.jobId}: ${err.message}`);
    }

    await this.evaluateAlerts(event);
  }

  /**
   * Builds a SyncAuditEvent from a PipelineResult.
   * Called by the pipeline after each run.
   */
  public buildEventFromPipelineResult(result: any): SyncAuditEvent {
    const jobId = this.generateJobId();
    const correlationId = this.generateCorrelationId();

    let outcome: SyncEventOutcome = 'SUCCESS';
    let errorCategory: string | null = null;

    if (!result.success && result.code === 'SYNC_IN_PROGRESS') {
      outcome = 'LOCK_CONTENTION';
      errorCategory = 'LOCK_CONTENTION';
    } else if (!result.success) {
      outcome = 'FAILED';
      errorCategory = 'PIPELINE_ERROR';
    } else if (result.domains?.some((d: any) => !d.success)) {
      outcome = 'PARTIAL';
      const failedDomains = result.domains.filter((d: any) => !d.success);
      if (failedDomains.length > 0) {
        errorCategory = `DOMAIN_FAILURE:${failedDomains.map((d: any) => d.domain).join(',')}`;
      }
    }

    if (result.encryptionPreflight && !result.encryptionPreflight.passed) {
      outcome = 'ABORTED';
      errorCategory = 'ENCRYPTION_PREFLIGHT_FAILED';
    }

    const domainResults: DomainMetrics[] = (result.domains || []).map((d: any) => {
      const detail = d.detail || {};
      return {
        domain: d.domain,
        success: d.success,
        durationMs: d.durationMs || 0,
        fetchedCount: detail.totalSynced ?? detail.count ?? detail.rows ?? detail.roles ?? undefined,
        savedCount: detail.totalSaved ?? detail.roles ?? detail.users ?? detail.rows ?? undefined,
        skippedCount: undefined,
        failedCount: d.success ? 0 : 1,
        duplicatesFiltered: d.duplicatesFiltered || 0,
        retriesAttempted: d.retriesAttempted || 0,
        quarantinedCount: d.quarantinedCount || 0,
        errorCategory: d.error ? 'DOMAIN_ERROR' : undefined,
        errorMessage: d.error || undefined,
      };
    });

    return {
      jobId,
      tenantId: '__GLOBAL__',
      triggeredBy: result.triggeredBy || 'UNKNOWN',
      isHumanTriggered: result.serviceIdentity?.isHumanTriggered ?? false,
      serviceIdentity: result.serviceIdentity?.principalName ?? null,
      domains: (result.domains || []).map((d: any) => d.domain),
      outcome,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      durationMs: result.durationMs || 0,
      domainResults,
      errorCategory,
      correlationId,
      encryptionStatus: result.encryptionPreflight?.passed === false
        ? 'FAILED'
        : result.encryptionPreflight?.encryptionEnabled
          ? 'ACTIVE'
          : 'DISABLED',
      lockType: result.distributedLock ? 'DISTRIBUTED' : 'LOCAL',
    };
  }

  // -------------------------------------------------------------------------
  // Alerting
  // -------------------------------------------------------------------------

  private async evaluateAlerts(event: SyncAuditEvent): Promise<void> {
    await this.ensureAlertTable();

    if (event.outcome === 'FAILED' || event.outcome === 'ABORTED') {
      this.consecutiveFailures++;
    } else if (event.outcome === 'SUCCESS') {
      this.consecutiveFailures = 0;
      await this.resolveAlerts(['REPEATED_SYNC_FAILURES', 'STALE_LAST_SYNC']);
    }

    if (event.outcome === 'LOCK_CONTENTION') {
      const now = Date.now();
      if (now - this.lockContentionWindowStart > 30 * 60 * 1000) {
        this.lockContentionCount = 0;
        this.lockContentionWindowStart = now;
      }
      this.lockContentionCount++;
    }

    // Repeated failure alert
    if (this.consecutiveFailures >= FAILURE_ALERT_THRESHOLD) {
      await this.raiseAlert({
        type: 'REPEATED_SYNC_FAILURES',
        severity: this.consecutiveFailures >= FAILURE_ALERT_THRESHOLD * 2 ? 'CRITICAL' : 'WARNING',
        message: `${this.consecutiveFailures} consecutive sync failures detected. Last error: ${event.errorCategory || 'unknown'}`,
        metadata: {
          consecutiveFailures: this.consecutiveFailures,
          lastJobId: event.jobId,
          lastErrorCategory: event.errorCategory,
        },
      });
    }

    // Lock contention alert
    if (this.lockContentionCount >= LOCK_CONTENTION_THRESHOLD) {
      await this.raiseAlert({
        type: 'LOCK_CONTENTION',
        severity: 'WARNING',
        message: `${this.lockContentionCount} lock contention events in the last 30 minutes. Possible replica conflict or stuck lock.`,
        metadata: {
          contentionCount: this.lockContentionCount,
          windowStart: new Date(this.lockContentionWindowStart).toISOString(),
        },
      });
    }

    // Encryption failure alert
    if (event.encryptionStatus === 'FAILED') {
      await this.raiseAlert({
        type: 'ENCRYPTION_FAILURE',
        severity: 'CRITICAL',
        message: `Sync aborted due to encryption preflight failure. Job: ${event.jobId}`,
        metadata: { jobId: event.jobId, correlationId: event.correlationId },
      });
    }

    // Per-domain degraded alert
    for (const dr of event.domainResults) {
      if (!dr.success) {
        await this.raiseAlert({
          type: 'DOMAIN_DEGRADED',
          severity: 'WARNING',
          message: `Domain "${dr.domain}" failed during sync job ${event.jobId}`,
          metadata: {
            domain: dr.domain,
            jobId: event.jobId,
            errorCategory: dr.errorCategory,
          },
        });
      }
    }
  }

  private async raiseAlert(alert: Omit<SyncAlert, 'alertId' | 'raisedAt' | 'resolvedAt'>): Promise<void> {
    const now = Date.now();
    const lastRaised = this.lastAlertTimes.get(alert.type) || 0;
    if (now - lastRaised < ALERT_COOLDOWN_MINUTES * 60 * 1000) return;

    this.lastAlertTimes.set(alert.type, now);
    const alertId = this.generateAlertId();
    const raisedAt = new Date().toISOString();

    console.warn(`[VEYRA SYNC ALERT] [${alert.severity}] ${alert.type}: ${alert.message}`);

    try {
      await dbQuery(
        `INSERT INTO ${ALERT_TABLE_NAME} (alert_id, alert_type, severity, message, raised_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (alert_id) DO NOTHING`,
        [alertId, alert.type, alert.severity, alert.message, raisedAt, JSON.stringify(alert.metadata)]
      );
    } catch (err: any) {
      console.error(`[SyncMonitor] Failed to persist alert ${alertId}: ${err.message}`);
    }
  }

  private async resolveAlerts(types: AlertType[]): Promise<void> {
    try {
      for (const type of types) {
        await dbQuery(
          `UPDATE ${ALERT_TABLE_NAME} SET resolved_at = NOW() WHERE alert_type = $1 AND resolved_at IS NULL`,
          [type]
        );
      }
    } catch (err: any) {
      console.error(`[SyncMonitor] Failed to resolve alerts: ${err.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Query: sync history and health
  // -------------------------------------------------------------------------

  public async getSyncHistory(options?: {
    limit?: number;
    outcome?: string;
    tenantId?: string;
  }): Promise<SyncAuditEvent[]> {
    await this.ensureTable();
    const limit = options?.limit || 25;
    const conditions: string[] = [];
    const params: any[] = [];

    if (options?.outcome) {
      params.push(options.outcome);
      conditions.push(`outcome = $${params.length}`);
    }
    if (options?.tenantId) {
      params.push(options.tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    const result = await dbQuery(
      `SELECT * FROM ${TABLE_NAME} ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );

    return result.rows.map((r: any) => ({
      jobId: r.job_id,
      tenantId: r.tenant_id,
      triggeredBy: r.triggered_by,
      isHumanTriggered: r.is_human,
      serviceIdentity: r.service_identity,
      domains: r.domains,
      outcome: r.outcome,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      durationMs: r.duration_ms,
      domainResults: r.domain_results,
      errorCategory: r.error_category,
      correlationId: r.correlation_id,
      encryptionStatus: r.encryption_status,
      lockType: r.lock_type,
    }));
  }

  public async getActiveAlerts(): Promise<SyncAlert[]> {
    await this.ensureAlertTable();
    try {
      const result = await dbQuery(
        `SELECT * FROM ${ALERT_TABLE_NAME} WHERE resolved_at IS NULL ORDER BY raised_at DESC LIMIT 50`
      );
      return result.rows.map(this.mapAlertRow);
    } catch {
      return [];
    }
  }

  public async getRecentAlerts(limit = 20): Promise<SyncAlert[]> {
    await this.ensureAlertTable();
    try {
      const result = await dbQuery(
        `SELECT * FROM ${ALERT_TABLE_NAME} ORDER BY raised_at DESC LIMIT $1`,
        [limit]
      );
      return result.rows.map(this.mapAlertRow);
    } catch {
      return [];
    }
  }

  private mapAlertRow(r: any): SyncAlert {
    return {
      alertId: r.alert_id,
      type: r.alert_type,
      severity: r.severity,
      message: r.message,
      raisedAt: r.raised_at,
      resolvedAt: r.resolved_at,
      metadata: r.metadata || {},
    };
  }

  public async getHealth(): Promise<SyncHealthStatus> {
    await this.ensureTable();
    await this.ensureAlertTable();

    let lastSuccessfulSync: string | null = null;
    let lastSyncAttempt: string | null = null;

    try {
      const lastSuccess = await dbQuery(
        `SELECT completed_at FROM ${TABLE_NAME} WHERE outcome = 'SUCCESS' ORDER BY completed_at DESC LIMIT 1`
      );
      if (lastSuccess.rows.length > 0) {
        lastSuccessfulSync = lastSuccess.rows[0].completed_at;
      }

      const lastAttempt = await dbQuery(
        `SELECT completed_at FROM ${TABLE_NAME} ORDER BY completed_at DESC LIMIT 1`
      );
      if (lastAttempt.rows.length > 0) {
        lastSyncAttempt = lastAttempt.rows[0].completed_at;
      }
    } catch (err: any) {
      console.error(`[SyncMonitor] Health query failed: ${err.message}`);
    }

    const activeAlerts = await this.getActiveAlerts();
    const recentAlerts = await this.getRecentAlerts(10);

    const isSyncStale = lastSuccessfulSync
      ? (Date.now() - new Date(lastSuccessfulSync).getTime()) > STALE_SYNC_HOURS * 60 * 60 * 1000
      : true;

    if (isSyncStale && lastSuccessfulSync) {
      await this.raiseAlert({
        type: 'STALE_LAST_SYNC',
        severity: 'WARNING',
        message: `Last successful sync was more than ${STALE_SYNC_HOURS} hours ago (at ${lastSuccessfulSync})`,
        metadata: { lastSuccessfulSync, thresholdHours: STALE_SYNC_HOURS },
      });
    }

    const hasCritical = activeAlerts.some(a => a.severity === 'CRITICAL');
    const hasWarning = activeAlerts.length > 0;

    return {
      status: hasCritical ? 'CRITICAL' : hasWarning ? 'DEGRADED' : 'HEALTHY',
      lastSuccessfulSync,
      lastSyncAttempt,
      consecutiveFailures: this.consecutiveFailures,
      activeAlerts,
      recentAlerts,
      staleSyncThresholdHours: STALE_SYNC_HOURS,
      isSyncStale,
    };
  }

  /** Reset in-memory counters (for testing). */
  public resetForTests(): void {
    this.consecutiveFailures = 0;
    this.lockContentionCount = 0;
    this.lockContentionWindowStart = 0;
    this.lastAlertTimes.clear();
    this.tableEnsured = false;
    this.alertTableEnsured = false;
  }
}

export const syncMonitorService = new SyncMonitorService();
