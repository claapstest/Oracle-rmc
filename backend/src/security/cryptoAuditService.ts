/**
 * Decryption Audit Trail and Crypto Failure Alerting
 * Story ID: VYR-038
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Records who decrypted which protected records, for what purpose, when, and
 * whether it succeeded — without ever storing the payload, key material,
 * tokens or the raw session id.
 *
 *   Successes  aggregated per (actor, session, tenant, table, purpose) and
 *              flushed every few seconds, so a 500-row report is one audit row
 *              with record_count = 500 and a capped list of record references.
 *   Failures   written immediately, one row each, with the error category and
 *              the incident reference the user was shown.
 *   Alerts     a sliding window per failure category; crossing the threshold
 *              raises a [VEYRA SECURITY ALERT] log line, an ALERT audit row and
 *              an entry on GET /api/security/crypto-health.
 *
 * Audit persistence never blocks or weakens the data path: decryption still
 * fails closed on its own. A failing audit sink is itself surfaced as an alert.
 */

import { query as dbQuery } from '../db.js';
import { getCryptoAuditContext, CryptoAuditContext } from './cryptoAuditContext.js';
import { CryptoFailureCategory, CRYPTO_FAILURE_CATEGORIES, maskSensitive } from './cryptoFailure.js';

export type CryptoOperation = 'DECRYPT' | 'ENCRYPT';

export interface CryptoEventInput {
  operation: CryptoOperation;
  tenant: string | null;
  tableName: string;
  recordRef: string | null;
  keyId?: string | null;
}

export interface CryptoFailureInput extends CryptoEventInput {
  category: CryptoFailureCategory;
  incidentId: string;
  internalDetail?: string;
}

export interface CryptoAlert {
  alertId: string;
  raisedAt: string;
  category: CryptoFailureCategory | 'AUDIT_SINK_UNAVAILABLE';
  failuresInWindow: number;
  windowMinutes: number;
  affectedTables: string[];
  affectedTenants: string[];
  message: string;
}

interface AuditRow {
  operation: CryptoOperation | 'ALERT';
  outcome: 'SUCCESS' | 'FAILURE' | 'RAISED';
  ctx: CryptoAuditContext;
  tenant: string | null;
  tableName: string;
  recordRefs: string[];
  recordCount: number;
  errorCategory: string | null;
  incidentId: string | null;
  keyId: string | null;
  windowStartedAt: Date | null;
  occurredAt: Date;
}

interface PendingAggregate {
  row: AuditRow;
  refs: Set<string>;
}

const MAX_REFS_PER_ROW = 50;
const MAX_RECORDS_PER_AGGREGATE = 1000;
const MAX_QUEUED_ROWS = 5000;

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS veyra_crypto_audit_event (
    event_id          BIGSERIAL PRIMARY KEY,
    occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    window_started_at TIMESTAMPTZ,
    operation         VARCHAR(16)  NOT NULL CHECK (operation IN ('DECRYPT', 'ENCRYPT', 'ALERT')),
    outcome           VARCHAR(16)  NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE', 'RAISED')),
    actor_type        VARCHAR(16)  NOT NULL CHECK (actor_type IN ('USER', 'SERVICE')),
    user_id           VARCHAR(64),
    user_email        VARCHAR(320),
    service_name      VARCHAR(100),
    session_ref       VARCHAR(64),
    ip_address        VARCHAR(100),
    tenant            VARCHAR(255),
    table_name        VARCHAR(100) NOT NULL,
    record_refs       JSONB        NOT NULL DEFAULT '[]'::jsonb,
    record_count      INTEGER      NOT NULL DEFAULT 1,
    purpose           VARCHAR(255) NOT NULL,
    error_category    VARCHAR(40),
    incident_id       VARCHAR(40),
    key_id            VARCHAR(200)
  );
  CREATE INDEX IF NOT EXISTS idx_crypto_audit_occurred ON veyra_crypto_audit_event (occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_crypto_audit_outcome ON veyra_crypto_audit_event (outcome, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_crypto_audit_user ON veyra_crypto_audit_event (user_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_crypto_audit_incident ON veyra_crypto_audit_event (incident_id) WHERE incident_id IS NOT NULL;
`;

export class CryptoAuditService {
  private readonly pending = new Map<string, PendingAggregate>();
  private queue: AuditRow[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushChain: Promise<void> = Promise.resolve();
  private schemaReady: Promise<void> | null = null;

  private readonly failureLog: Array<{ at: number; category: CryptoFailureCategory; table: string; tenant: string | null }> = [];
  private readonly lastAlertAt = new Map<string, number>();
  private readonly alerts: CryptoAlert[] = [];
  private totals = { decryptSuccess: 0, decryptFailure: 0, encryptFailure: 0, auditWriteFailures: 0, droppedAuditRows: 0 };

  private get flushIntervalMs() { return envInt('VEYRA_CRYPTO_AUDIT_FLUSH_MS', 5000); }
  private get windowMs() { return envInt('VEYRA_CRYPTO_ALERT_WINDOW_MINUTES', 5) * 60_000; }
  private get cooldownMs() { return envInt('VEYRA_CRYPTO_ALERT_COOLDOWN_MINUTES', 15) * 60_000; }

  /** Failures of one category within the window that make it "systemic". */
  private thresholdFor(category: CryptoFailureCategory): number {
    // Key-service and key-material failures affect every record, so alert sooner.
    if (category === 'KMS_UNAVAILABLE' || category === 'INVALID_KEY' || category === 'UNSUPPORTED_VERSION') {
      return envInt('VEYRA_CRYPTO_ALERT_SYSTEMIC_THRESHOLD', 3);
    }
    return envInt('VEYRA_CRYPTO_ALERT_THRESHOLD', 5);
  }

  public ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = dbQuery(SCHEMA_SQL).then(() => undefined).catch(err => {
        this.schemaReady = null;
        throw err;
      });
    }
    return this.schemaReady;
  }

  /** A protected record was decrypted and handed to the caller. */
  public recordSuccess(input: CryptoEventInput): void {
    if (input.operation === 'DECRYPT') this.totals.decryptSuccess++;
    const ctx = getCryptoAuditContext();
    const key = [input.operation, ctx.actorType, ctx.userId, ctx.serviceName, ctx.sessionRef, input.tenant, input.tableName, ctx.purpose].join('\u0000');

    let agg = this.pending.get(key);
    if (!agg) {
      agg = {
        refs: new Set(),
        row: {
          operation: input.operation,
          outcome: 'SUCCESS',
          ctx,
          tenant: input.tenant,
          tableName: input.tableName,
          recordRefs: [],
          recordCount: 0,
          errorCategory: null,
          incidentId: null,
          keyId: input.keyId ?? null,
          windowStartedAt: new Date(),
          occurredAt: new Date(),
        },
      };
      this.pending.set(key, agg);
    }
    agg.row.recordCount++;
    agg.row.occurredAt = new Date();
    if (input.recordRef && agg.refs.size < MAX_REFS_PER_ROW) agg.refs.add(input.recordRef);

    if (agg.row.recordCount >= MAX_RECORDS_PER_AGGREGATE) {
      this.pending.delete(key);
      this.enqueue(this.finalize(agg));
    }
    this.scheduleFlush();
  }

  /** A protected-record operation failed closed. Written immediately and fed to alerting. */
  public recordFailure(input: CryptoFailureInput): void {
    if (input.operation === 'DECRYPT') this.totals.decryptFailure++;
    else this.totals.encryptFailure++;

    const ctx = getCryptoAuditContext();
    const who = ctx.actorType === 'USER' ? `user=${ctx.userId || 'unknown'}` : `service=${ctx.serviceName}`;
    console.error(
      `[VEYRA Crypto] ${input.operation} failed category=${input.category} ref=${input.incidentId} ` +
      `table=${input.tableName} tenant=${input.tenant || '-'} ${who} purpose="${ctx.purpose}"` +
      (input.internalDetail ? ` detail="${maskSensitive(input.internalDetail, 300)}"` : '')
    );

    this.enqueue({
      operation: input.operation,
      outcome: 'FAILURE',
      ctx,
      tenant: input.tenant,
      tableName: input.tableName,
      recordRefs: input.recordRef ? [input.recordRef] : [],
      recordCount: 1,
      errorCategory: input.category,
      incidentId: input.incidentId,
      keyId: input.keyId ?? null,
      windowStartedAt: null,
      occurredAt: new Date(),
    });
    this.trackForAlerting(input.category, input.tableName, input.tenant);
    void this.flush();
  }

  private trackForAlerting(category: CryptoFailureCategory, table: string, tenant: string | null): void {
    const now = Date.now();
    this.failureLog.push({ at: now, category, table, tenant });
    this.pruneFailureLog(now);

    const inWindow = this.failureLog.filter(f => f.category === category);
    if (inWindow.length < this.thresholdFor(category)) return;
    if (now - (this.lastAlertAt.get(category) || 0) < this.cooldownMs) return;

    this.raiseAlert(category, inWindow.length,
      [...new Set(inWindow.map(f => f.table))],
      [...new Set(inWindow.map(f => f.tenant).filter((t): t is string => !!t))]);
  }

  private raiseAlert(
    category: CryptoAlert['category'],
    failuresInWindow: number,
    affectedTables: string[],
    affectedTenants: string[]
  ): void {
    const now = Date.now();
    this.lastAlertAt.set(category, now);
    const windowMinutes = Math.round(this.windowMs / 60_000);
    const alert: CryptoAlert = {
      alertId: `ALR-${now.toString(36).toUpperCase()}`,
      raisedAt: new Date(now).toISOString(),
      category,
      failuresInWindow,
      windowMinutes,
      affectedTables,
      affectedTenants,
      message: category === 'AUDIT_SINK_UNAVAILABLE'
        ? 'Decryption audit events could not be persisted; check database connectivity.'
        : `${failuresInWindow} ${category} failure(s) in the last ${windowMinutes} minute(s) — likely systemic, investigate key service / key ring / stored payloads.`,
    };
    this.alerts.push(alert);
    if (this.alerts.length > 50) this.alerts.shift();

    console.error(`[VEYRA SECURITY ALERT] ${JSON.stringify(alert)}`);

    if (category !== 'AUDIT_SINK_UNAVAILABLE') {
      this.enqueue({
        operation: 'ALERT',
        outcome: 'RAISED',
        ctx: { actorType: 'SERVICE', serviceName: 'crypto-monitor', purpose: 'systemic-failure-alert' },
        tenant: affectedTenants.length === 1 ? affectedTenants[0] : null,
        tableName: affectedTables.length === 1 ? affectedTables[0] : '*',
        recordRefs: affectedTables,
        recordCount: failuresInWindow,
        errorCategory: category,
        incidentId: alert.alertId,
        keyId: null,
        windowStartedAt: new Date(now - this.windowMs),
        occurredAt: new Date(now),
      });
    }
  }

  private pruneFailureLog(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    while (this.failureLog.length && this.failureLog[0].at < cutoff) this.failureLog.shift();
  }

  private finalize(agg: PendingAggregate): AuditRow {
    return { ...agg.row, recordRefs: [...agg.refs] };
  }

  private enqueue(row: AuditRow): void {
    this.queue.push(row);
    if (this.queue.length > MAX_QUEUED_ROWS) {
      const dropped = this.queue.length - MAX_QUEUED_ROWS;
      this.queue.splice(0, dropped);
      this.totals.droppedAuditRows += dropped;
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  /**
   * Persists every aggregate and row recorded before this call. Flushes are
   * strictly serialized, so the returned promise resolves only after this
   * caller's rows have been written (or re-queued after a sink failure).
   */
  public flush(): Promise<void> {
    const run = this.flushChain.then(() => this.doFlush());
    this.flushChain = run.catch(() => {});
    return run;
  }

  private async doFlush(): Promise<void> {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    for (const agg of this.pending.values()) this.enqueue(this.finalize(agg));
    this.pending.clear();
    if (this.queue.length === 0) return;

    const batch = this.queue;
    this.queue = [];
    try {
      await this.ensureSchema();
      const cols = 18;
      const values: unknown[] = [];
      const tuples = batch.map((r, i) => {
        values.push(
          r.occurredAt, r.windowStartedAt, r.operation, r.outcome, r.ctx.actorType,
          r.ctx.userId ?? null, r.ctx.userEmail ?? null, r.ctx.serviceName ?? null, r.ctx.sessionRef ?? null,
          r.ctx.ipAddress ?? null, r.tenant, r.tableName, JSON.stringify(r.recordRefs), r.recordCount,
          r.ctx.purpose, r.errorCategory, r.incidentId, r.keyId
        );
        const base = i * cols;
        return `(${Array.from({ length: cols }, (_, c) => `$${base + c + 1}`).join(', ')})`;
      });
      await dbQuery(
        `INSERT INTO veyra_crypto_audit_event (
           occurred_at, window_started_at, operation, outcome, actor_type,
           user_id, user_email, service_name, session_ref,
           ip_address, tenant, table_name, record_refs, record_count,
           purpose, error_category, incident_id, key_id
         ) VALUES ${tuples.join(', ')}`,
        values
      );
    } catch (err) {
      this.totals.auditWriteFailures++;
      // Keep the rows for the next attempt (bounded by MAX_QUEUED_ROWS).
      this.queue = batch.concat(this.queue);
      if (this.queue.length > MAX_QUEUED_ROWS) {
        const dropped = this.queue.length - MAX_QUEUED_ROWS;
        this.queue.splice(0, dropped);
        this.totals.droppedAuditRows += dropped;
      }
      console.error(`[VEYRA Crypto] Failed to persist ${batch.length} crypto audit event(s): ${maskSensitive(err, 200)}`);
      if (Date.now() - (this.lastAlertAt.get('AUDIT_SINK_UNAVAILABLE') || 0) >= this.cooldownMs) {
        this.raiseAlert('AUDIT_SINK_UNAVAILABLE', this.totals.auditWriteFailures, [], []);
      }
      this.scheduleFlush();
    }
  }

  /** Operational snapshot for GET /api/security/crypto-health. Contains no sensitive values. */
  public getHealth() {
    const now = Date.now();
    this.pruneFailureLog(now);
    const failuresByCategory = Object.fromEntries(
      CRYPTO_FAILURE_CATEGORIES.map(c => [c, this.failureLog.filter(f => f.category === c).length])
    ) as Record<CryptoFailureCategory, number>;

    const activeAlerts = this.alerts.filter(a => now - Date.parse(a.raisedAt) < this.cooldownMs);
    const systemicActive = activeAlerts.some(a =>
      a.category === 'KMS_UNAVAILABLE' || a.category === 'INVALID_KEY' || a.category === 'UNSUPPORTED_VERSION');
    const status = systemicActive ? 'CRITICAL'
      : activeAlerts.length > 0 || this.failureLog.length > 0 ? 'DEGRADED'
      : 'HEALTHY';

    return {
      status,
      windowMinutes: Math.round(this.windowMs / 60_000),
      failuresInWindow: this.failureLog.length,
      failuresByCategory,
      activeAlerts,
      recentAlerts: this.alerts.slice(-10),
      totalsSinceStart: { ...this.totals },
      auditSink: {
        pendingRows: this.queue.length + this.pending.size,
        writeFailures: this.totals.auditWriteFailures,
        droppedRows: this.totals.droppedAuditRows,
      },
      generatedAt: new Date(now).toISOString(),
    };
  }

  /** Test hook: clears in-memory alerting state (does not touch persisted rows). */
  public resetForTests(): void {
    this.pending.clear();
    this.queue = [];
    this.failureLog.length = 0;
    this.lastAlertAt.clear();
    this.alerts.length = 0;
    this.totals = { decryptSuccess: 0, decryptFailure: 0, encryptFailure: 0, auditWriteFailures: 0, droppedAuditRows: 0 };
  }
}

export const cryptoAuditService = new CryptoAuditService();

process.once('beforeExit', () => { void cryptoAuditService.flush().catch(() => {}); });
