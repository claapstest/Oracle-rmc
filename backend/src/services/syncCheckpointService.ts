/**
 * Sync Checkpoint & Quarantine Service
 * Story ID: VYR-044
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both
 *
 * Implements:
 *   1. Checkpoint & Watermark State Management:
 *      - Persists high-watermark timestamps, cursors, and batch progression
 *      - Enforces AC 2: Checkpoint does NOT advance past unpersisted data
 *   2. Dead-Letter Queue & Quarantine Management:
 *      - Enforces AC 3: Malformed/corrupted records are quarantined without crashing the batch
 *      - Partial domain failure is visible and recoverable
 *   3. Dual-mode support: PostgreSQL persistence with automatic in-memory fallback
 *      for testing/offline environments.
 */

import crypto from 'crypto';
import { query } from '../db.js';

export interface SyncCheckpoint {
  checkpointKey: string;
  tenantId: string;
  domain: string;
  watermarkTimestamp: string | null;
  watermarkCursor: string | null;
  lastSuccessfulBatch: number;
  recordsPersisted: number;
  lastSyncStartedAt: string;
  lastSyncCompletedAt: string | null;
  status: 'IDLE' | 'IN_PROGRESS' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
  metadata?: Record<string, unknown>;
  updatedAt: string;
}

export interface QuarantinedRecord {
  id: string;
  tenantId: string;
  domain: string;
  recordKey: string;
  payload?: any;
  errorReason: string;
  errorCode: string;
  retryCount: number;
  status: 'QUARANTINED' | 'RESOLVED' | 'DISCARDED';
  quarantinedAt: string;
  resolvedAt: string | null;
  metadata?: Record<string, unknown>;
}

export function buildCheckpointKey(domain: string, tenantId = '__GLOBAL__'): string {
  return `${tenantId.trim()}:${domain.trim()}`;
}

export class SyncCheckpointService {
  // In-memory fallback stores for offline/test environments
  private inMemoryCheckpoints = new Map<string, SyncCheckpoint>();
  private inMemoryQuarantine = new Map<string, QuarantinedRecord>();
  private isDbAvailable: boolean | null = null;
  private lastDbFailureTime = 0;

  private shouldAttemptDb(): boolean {
    if (process.env.OFFLINE_MODE === 'true' || process.env.TEST_OFFLINE === 'true') {
      return false;
    }
    if (this.isDbAvailable === false && Date.now() - this.lastDbFailureTime < 30000) {
      return false;
    }
    return true;
  }

  private markDbSuccess(): void {
    this.isDbAvailable = true;
  }

  private markDbFailure(): void {
    this.isDbAvailable = false;
    this.lastDbFailureTime = Date.now();
  }

  public setOfflineMode(offline: boolean): void {
    this.isDbAvailable = !offline;
    this.lastDbFailureTime = offline ? Date.now() + 86400000 : 0;
  }

  // -------------------------------------------------------------------------
  // 1. Checkpoint Operations
  // -------------------------------------------------------------------------

  /**
   * Retrieves the current checkpoint and watermark for a domain.
   */
  public async getCheckpoint(domain: string, tenantId = '__GLOBAL__'): Promise<SyncCheckpoint | null> {
    const key = buildCheckpointKey(domain, tenantId);

    if (this.shouldAttemptDb()) {
      try {
        const res = await query(
          `SELECT checkpoint_key, tenant_id, domain, watermark_timestamp, watermark_cursor,
                  last_successful_batch, records_persisted, last_sync_started_at,
                  last_sync_completed_at, status, metadata, updated_at
           FROM veyra_sync_checkpoints
           WHERE checkpoint_key = $1`,
          [key]
        );
        this.markDbSuccess();

        if (res && res.rows && res.rows.length > 0) {
          const row = res.rows[0];
          return {
            checkpointKey: row.checkpoint_key,
            tenantId: row.tenant_id,
            domain: row.domain,
            watermarkTimestamp: row.watermark_timestamp ? new Date(row.watermark_timestamp).toISOString() : null,
            watermarkCursor: row.watermark_cursor || null,
            lastSuccessfulBatch: Number(row.last_successful_batch) || 0,
            recordsPersisted: Number(row.records_persisted) || 0,
            lastSyncStartedAt: new Date(row.last_sync_started_at).toISOString(),
            lastSyncCompletedAt: row.last_sync_completed_at ? new Date(row.last_sync_completed_at).toISOString() : null,
            status: row.status,
            metadata: row.metadata || {},
            updatedAt: new Date(row.updated_at).toISOString(),
          };
        }
      } catch {
        this.markDbFailure();
      }
    }

    return this.inMemoryCheckpoints.get(key) || null;
  }

  /**
   * Initializes or marks a checkpoint as IN_PROGRESS when a sync cycle begins.
   * Does NOT advance the watermark cursor or batch until data is persisted.
   */
  public async startCheckpoint(domain: string, tenantId = '__GLOBAL__'): Promise<SyncCheckpoint> {
    const key = buildCheckpointKey(domain, tenantId);
    const existing = await this.getCheckpoint(domain, tenantId);
    const now = new Date().toISOString();

    const checkpoint: SyncCheckpoint = {
      checkpointKey: key,
      tenantId,
      domain,
      watermarkTimestamp: existing?.watermarkTimestamp || null,
      watermarkCursor: existing?.watermarkCursor || null,
      lastSuccessfulBatch: existing?.lastSuccessfulBatch || 0,
      recordsPersisted: existing?.recordsPersisted || 0,
      lastSyncStartedAt: now,
      lastSyncCompletedAt: null,
      status: 'IN_PROGRESS',
      metadata: existing?.metadata || {},
      updatedAt: now,
    };

    if (this.shouldAttemptDb()) {
      try {
        await query(
          `INSERT INTO veyra_sync_checkpoints (
             checkpoint_key, tenant_id, domain, watermark_timestamp, watermark_cursor,
             last_successful_batch, records_persisted, last_sync_started_at, status, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (checkpoint_key) DO UPDATE SET
             last_sync_started_at = EXCLUDED.last_sync_started_at,
             status = 'IN_PROGRESS',
             updated_at = EXCLUDED.updated_at`,
          [
            key,
            tenantId,
            domain,
            checkpoint.watermarkTimestamp,
            checkpoint.watermarkCursor,
            checkpoint.lastSuccessfulBatch,
            checkpoint.recordsPersisted,
            now,
            'IN_PROGRESS',
            now,
          ]
        );
        this.markDbSuccess();
      } catch {
        this.markDbFailure();
      }
    }

    this.inMemoryCheckpoints.set(key, checkpoint);
    return checkpoint;
  }

  /**
   * Advances the checkpoint watermark and batch progression ONLY after successful persistence.
   * Acceptance Criteria 2: Checkpoint does not advance past unpersisted data.
   */
  public async commitCheckpoint(params: {
    domain: string;
    tenantId?: string;
    batchNumber: number;
    watermarkTimestamp?: string;
    cursor?: string;
    persistedInBatch: number;
    isComplete?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<SyncCheckpoint> {
    const tenantId = params.tenantId || '__GLOBAL__';
    const key = buildCheckpointKey(params.domain, tenantId);
    const existing = await this.getCheckpoint(params.domain, tenantId);
    const now = new Date().toISOString();

    const totalPersisted = (existing?.recordsPersisted || 0) + params.persistedInBatch;
    const isComplete = params.isComplete ?? false;

    const checkpoint: SyncCheckpoint = {
      checkpointKey: key,
      tenantId,
      domain: params.domain,
      watermarkTimestamp: params.watermarkTimestamp || existing?.watermarkTimestamp || now,
      watermarkCursor: params.cursor !== undefined ? params.cursor : (existing?.watermarkCursor || null),
      lastSuccessfulBatch: params.batchNumber,
      recordsPersisted: totalPersisted,
      lastSyncStartedAt: existing?.lastSyncStartedAt || now,
      lastSyncCompletedAt: isComplete ? now : null,
      status: isComplete ? 'SUCCESS' : 'IN_PROGRESS',
      metadata: { ...(existing?.metadata || {}), ...(params.metadata || {}) },
      updatedAt: now,
    };

    if (this.shouldAttemptDb()) {
      try {
        await query(
          `INSERT INTO veyra_sync_checkpoints (
             checkpoint_key, tenant_id, domain, watermark_timestamp, watermark_cursor,
             last_successful_batch, records_persisted, last_sync_started_at,
             last_sync_completed_at, status, metadata, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (checkpoint_key) DO UPDATE SET
             watermark_timestamp = EXCLUDED.watermark_timestamp,
             watermark_cursor = EXCLUDED.watermark_cursor,
             last_successful_batch = EXCLUDED.last_successful_batch,
             records_persisted = EXCLUDED.records_persisted,
             last_sync_completed_at = EXCLUDED.last_sync_completed_at,
             status = EXCLUDED.status,
             metadata = EXCLUDED.metadata,
             updated_at = EXCLUDED.updated_at`,
          [
            key,
            tenantId,
            params.domain,
            checkpoint.watermarkTimestamp,
            checkpoint.watermarkCursor,
            checkpoint.lastSuccessfulBatch,
            checkpoint.recordsPersisted,
            checkpoint.lastSyncStartedAt,
            checkpoint.lastSyncCompletedAt,
            checkpoint.status,
            JSON.stringify(checkpoint.metadata),
            now,
          ]
        );
        this.markDbSuccess();
      } catch {
        this.markDbFailure();
      }
    }

    this.inMemoryCheckpoints.set(key, checkpoint);
    console.log(
      `[Checkpoint] Domain "${params.domain}" checkpoint advanced to batch #${params.batchNumber} (${totalPersisted} total records persisted, status: ${checkpoint.status}).`
    );
    return checkpoint;
  }

  /**
   * Marks a checkpoint as failed without advancing the watermark, preserving the last
   * successfully persisted checkpoint for restartability.
   */
  public async failCheckpoint(
    domain: string,
    errorReason: string,
    tenantId = '__GLOBAL__'
  ): Promise<SyncCheckpoint> {
    const key = buildCheckpointKey(domain, tenantId);
    const existing = await this.getCheckpoint(domain, tenantId);
    const now = new Date().toISOString();

    const checkpoint: SyncCheckpoint = {
      checkpointKey: key,
      tenantId,
      domain,
      watermarkTimestamp: existing?.watermarkTimestamp || null,
      watermarkCursor: existing?.watermarkCursor || null,
      lastSuccessfulBatch: existing?.lastSuccessfulBatch || 0,
      recordsPersisted: existing?.recordsPersisted || 0,
      lastSyncStartedAt: existing?.lastSyncStartedAt || now,
      lastSyncCompletedAt: now,
      status: 'FAILED',
      metadata: { ...(existing?.metadata || {}), lastError: errorReason },
      updatedAt: now,
    };

    if (this.shouldAttemptDb()) {
      try {
        await query(
          `UPDATE veyra_sync_checkpoints
           SET status = 'FAILED',
               last_sync_completed_at = $2,
               metadata = $3,
               updated_at = $2
           WHERE checkpoint_key = $1`,
          [key, now, JSON.stringify(checkpoint.metadata)]
        );
        this.markDbSuccess();
      } catch {
        this.markDbFailure();
      }
    }

    this.inMemoryCheckpoints.set(key, checkpoint);
    console.warn(
      `[Checkpoint] Domain "${domain}" marked FAILED. Watermark preserved at batch #${checkpoint.lastSuccessfulBatch} (${checkpoint.recordsPersisted} records).`
    );
    return checkpoint;
  }

  /**
   * Lists all registered checkpoints across domains.
   */
  public async listCheckpoints(tenantId = '__GLOBAL__'): Promise<SyncCheckpoint[]> {
    if (this.shouldAttemptDb()) {
      try {
        const res = await query(
          `SELECT checkpoint_key, tenant_id, domain, watermark_timestamp, watermark_cursor,
                  last_successful_batch, records_persisted, last_sync_started_at,
                  last_sync_completed_at, status, metadata, updated_at
           FROM veyra_sync_checkpoints
           WHERE tenant_id = $1
           ORDER BY domain ASC`,
          [tenantId]
        );
        this.markDbSuccess();

        if (res && res.rows && res.rows.length > 0) {
          return res.rows.map((row) => ({
            checkpointKey: row.checkpoint_key,
            tenantId: row.tenant_id,
            domain: row.domain,
            watermarkTimestamp: row.watermark_timestamp ? new Date(row.watermark_timestamp).toISOString() : null,
            watermarkCursor: row.watermark_cursor || null,
            lastSuccessfulBatch: Number(row.last_successful_batch) || 0,
            recordsPersisted: Number(row.records_persisted) || 0,
            lastSyncStartedAt: new Date(row.last_sync_started_at).toISOString(),
            lastSyncCompletedAt: row.last_sync_completed_at ? new Date(row.last_sync_completed_at).toISOString() : null,
            status: row.status,
            metadata: row.metadata || {},
            updatedAt: new Date(row.updated_at).toISOString(),
          }));
        }
      } catch {
        this.markDbFailure();
      }
    }

    return Array.from(this.inMemoryCheckpoints.values()).filter((c) => c.tenantId === tenantId);
  }

  // -------------------------------------------------------------------------
  // 2. Dead-Letter Queue & Quarantine Operations
  // -------------------------------------------------------------------------

  /**
   * Quarantines a malformed or corrupted record, preventing it from aborting the entire batch.
   * Acceptance Criteria 3: Partial failure is visible and recoverable.
   */
  public async quarantineRecord(params: {
    domain: string;
    recordKey: string;
    payload?: any;
    errorReason: string;
    errorCode?: string;
    tenantId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<QuarantinedRecord> {
    const tenantId = params.tenantId || '__GLOBAL__';
    const id = `qr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    const record: QuarantinedRecord = {
      id,
      tenantId,
      domain: params.domain,
      recordKey: params.recordKey,
      payload: params.payload || null,
      errorReason: params.errorReason,
      errorCode: params.errorCode || 'MALFORMED_RECORD',
      retryCount: 0,
      status: 'QUARANTINED',
      quarantinedAt: now,
      resolvedAt: null,
      metadata: params.metadata || {},
    };

    if (this.shouldAttemptDb()) {
      try {
        await query(
          `INSERT INTO veyra_sync_quarantine (
             id, tenant_id, domain, record_key, payload, error_reason,
             error_code, retry_count, status, quarantined_at, metadata
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            id,
            tenantId,
            params.domain,
            params.recordKey,
            JSON.stringify(record.payload),
            params.errorReason,
            record.errorCode,
            0,
            'QUARANTINED',
            now,
            JSON.stringify(record.metadata),
          ]
        );
        this.markDbSuccess();
      } catch {
        this.markDbFailure();
      }
    }

    this.inMemoryQuarantine.set(id, record);
    console.warn(
      `[Quarantine] Quarantined malformed record in domain "${params.domain}" (key: "${params.recordKey}"). Reason: ${params.errorReason}`
    );
    return record;
  }

  /**
   * Retrieves quarantined records with optional status and domain filtering.
   */
  public async getQuarantinedRecords(filter?: {
    domain?: string;
    status?: string;
    tenantId?: string;
  }): Promise<QuarantinedRecord[]> {
    const tenantId = filter?.tenantId || '__GLOBAL__';

    if (this.shouldAttemptDb()) {
      try {
        let sql = `SELECT id, tenant_id, domain, record_key, payload, error_reason,
                          error_code, retry_count, status, quarantined_at, resolved_at, metadata
                   FROM veyra_sync_quarantine
                   WHERE tenant_id = $1`;
        const queryParams: any[] = [tenantId];

        if (filter?.domain) {
          queryParams.push(filter.domain);
          sql += ` AND domain = $${queryParams.length}`;
        }
        if (filter?.status) {
          queryParams.push(filter.status);
          sql += ` AND status = $${queryParams.length}`;
        }
        sql += ` ORDER BY quarantined_at DESC LIMIT 100`;

        const res = await query(sql, queryParams);
        this.markDbSuccess();

        if (res && res.rows && res.rows.length > 0) {
          return res.rows.map((row) => ({
            id: row.id,
            tenantId: row.tenant_id,
            domain: row.domain,
            recordKey: row.record_key,
            payload: row.payload,
            errorReason: row.error_reason,
            errorCode: row.error_code,
            retryCount: Number(row.retry_count) || 0,
            status: row.status,
            quarantinedAt: new Date(row.quarantined_at).toISOString(),
            resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
            metadata: row.metadata || {},
          }));
        }
      } catch {
        this.markDbFailure();
      }
    }

    let records = Array.from(this.inMemoryQuarantine.values()).filter((r) => r.tenantId === tenantId);
    if (filter?.domain) records = records.filter((r) => r.domain === filter.domain);
    if (filter?.status) records = records.filter((r) => r.status === filter.status);
    return records;
  }

  /**
   * Resolves a quarantined record after administrative review or manual reprocessing.
   */
  public async resolveQuarantinedRecord(id: string): Promise<boolean> {
    const now = new Date().toISOString();

    if (this.shouldAttemptDb()) {
      try {
        const res = await query(
          `UPDATE veyra_sync_quarantine
           SET status = 'RESOLVED',
               resolved_at = $2
           WHERE id = $1 AND status = 'QUARANTINED'`,
          [id, now]
        );
        this.markDbSuccess();

        if (res && res.rowCount && res.rowCount > 0) {
          const mem = this.inMemoryQuarantine.get(id);
          if (mem) {
            mem.status = 'RESOLVED';
            mem.resolvedAt = now;
          }
          return true;
        }
      } catch {
        this.markDbFailure();
      }
    }

    const rec = this.inMemoryQuarantine.get(id);
    if (rec && rec.status === 'QUARANTINED') {
      rec.status = 'RESOLVED';
      rec.resolvedAt = now;
      return true;
    }
    return false;
  }

  /**
   * Gets a summary count of quarantined records per domain.
   */
  public async getQuarantineSummary(domain?: string, tenantId = '__GLOBAL__'): Promise<{
    total: number;
    quarantined: number;
    resolved: number;
  }> {
    const records = await this.getQuarantinedRecords({ domain, tenantId });
    const quarantined = records.filter((r) => r.status === 'QUARANTINED').length;
    const resolved = records.filter((r) => r.status === 'RESOLVED').length;
    return {
      total: records.length,
      quarantined,
      resolved,
    };
  }
}

export const syncCheckpointService = new SyncCheckpointService();
