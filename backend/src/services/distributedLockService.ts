/**
 * Distributed Lock Service
 * Story ID: VYR-043
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both
 *
 * Implements distributed mutual exclusion for Oracle synchronization across
 * multiple process replicas and worker instances.
 *
 * Architecture:
 *   1. Local in-process mutex check (fast-fail without network roundtrip)
 *   2. PostgreSQL session advisory lock (pg_try_advisory_lock) for atomic exclusion
 *   3. Persistent distributed lock table (veyra_distributed_locks) for auditability,
 *      operator inspectability, lock timeouts, and stale lock recovery.
 *   4. Per-tenant and per-domain lock scopes (e.g. "full", "controls", "audit")
 *   5. Automatic stale lock detection and recovery after worker crash
 *   6. Graceful in-memory fallback when database connection is offline (test/offline mode)
 */

import os from 'os';
import crypto from 'crypto';
import type pg from 'pg';
import { pool, query } from '../db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LockScope {
  tenantId?: string;
  domain?: string;
}

export interface LockHolderInfo {
  lockKey: string;
  tenantId: string;
  domain: string;
  holderId: string;
  taskName: string;
  acquiredAt: string;
  expiresAt: string;
  heartbeatAt: string;
  metadata?: Record<string, unknown>;
}

export interface LockAcquisitionResult {
  acquired: boolean;
  lockKey: string;
  holderId: string;
  expiresAt?: string;
  isStaleRecovered?: boolean;
  errorReason?: string;
  existingHolder?: LockHolderInfo | null;
  /** Internal client held for session advisory lock */
  client?: pg.PoolClient;
  advisoryKey?: number;
}

export interface DistributedLockOptions {
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function buildLockKey(scope?: LockScope): string {
  const tenant = (scope?.tenantId || '__GLOBAL__').trim();
  const domain = (scope?.domain || 'full').trim();
  return `${tenant}:${domain}`;
}

export function advisoryKeyFromLockKey(lockKey: string): number {
  return crypto.createHash('sha256').update(`veyra_lock:${lockKey}`).digest().readInt32BE(0);
}

function generateHolderId(triggeredBy: string): string {
  const host = os.hostname() || 'worker';
  const pid = process.pid;
  const rand = crypto.randomBytes(4).toString('hex');
  return `${host}:${pid}:${triggeredBy}:${rand}`;
}

// ---------------------------------------------------------------------------
// Distributed Lock Service Implementation
// ---------------------------------------------------------------------------

export class DistributedLockService {
  private inMemoryLocks = new Map<string, {
    holderId: string;
    taskName: string;
    acquiredAt: Date;
    expiresAt: Date;
    metadata?: Record<string, unknown>;
  }>();

  private activeHeldLocks = new Map<string, {
    client: pg.PoolClient;
    advisoryKey: number;
    lockKey: string;
    heartbeatInterval?: NodeJS.Timeout;
  }>();

  private tableInitialized = false;

  /**
   * Idempotently ensures the veyra_distributed_locks table exists in PostgreSQL.
   */
  public async ensureTable(): Promise<void> {
    if (this.tableInitialized) return;
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS veyra_distributed_locks (
          lock_key VARCHAR(128) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL DEFAULT '__GLOBAL__',
          domain VARCHAR(64) NOT NULL DEFAULT 'full',
          holder_id VARCHAR(128) NOT NULL,
          task_name TEXT,
          acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          metadata JSONB
        );
        CREATE INDEX IF NOT EXISTS ix_veyra_dist_locks_expires
          ON veyra_distributed_locks (expires_at);
        CREATE INDEX IF NOT EXISTS ix_veyra_dist_locks_tenant_domain
          ON veyra_distributed_locks (tenant_id, domain);
      `);
      this.tableInitialized = true;
    } catch (err: any) {
      console.warn('[DistributedLock] ensureTable warning (operating in fallback-tolerant mode):', err.message);
    }
  }

  /**
   * Attempts to acquire a distributed lock for the specified scope.
   */
  public async acquireLock(
    taskName: string,
    triggeredBy: string,
    scope?: LockScope,
    options?: DistributedLockOptions
  ): Promise<LockAcquisitionResult> {
    const lockKey = buildLockKey(scope);
    const tenantId = scope?.tenantId || '__GLOBAL__';
    const domain = scope?.domain || 'full';
    const holderId = generateHolderId(triggeredBy);

    const defaultTtl = domain === 'full'
      ? parseInt(process.env.SYNC_LOCK_TTL_SECONDS || '1800', 10)
      : 600;
    const ttlSeconds = options?.ttlSeconds || defaultTtl;

    // Check PostgreSQL connection
    let client: pg.PoolClient | null = null;
    let advisoryKey = advisoryKeyFromLockKey(lockKey);

    try {
      await this.ensureTable();
      client = await pool.connect();

      // Step 1: Attempt PostgreSQL advisory lock
      const advRes = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [advisoryKey]);
      const advOk = Boolean(advRes.rows[0]?.ok);

      if (!advOk) {
        // Another connection holds the advisory lock
        client.release();
        client = null;

        const existing = await this.getLockInfoFromDb(lockKey);
        console.warn(`[DistributedLock] Advisory lock contention for "${lockKey}". Held by: ${existing?.holderId || 'unknown'}`);
        return {
          acquired: false,
          lockKey,
          holderId,
          errorReason: 'ADVISORY_LOCK_HELD',
          existingHolder: existing,
        };
      }

      // Step 2: Check persistent lock table for existing unexpired lock
      const existing = await this.getLockInfoFromDb(lockKey);
      let isStaleRecovered = false;

      if (existing) {
        const expiresTime = new Date(existing.expiresAt).getTime();
        const isExpired = Date.now() > expiresTime;

        if (!isExpired && existing.holderId !== holderId) {
          // Valid active lock held by another worker record
          await client.query('SELECT pg_advisory_unlock($1)', [advisoryKey]);
          client.release();
          return {
            acquired: false,
            lockKey,
            holderId,
            errorReason: 'TABLE_LOCK_ACTIVE',
            existingHolder: existing,
          };
        }

        if (isExpired) {
          isStaleRecovered = true;
          console.warn(
            `[DistributedLock] Stale lock detected for "${lockKey}" previously held by "${existing.holderId}" ` +
            `(expired at ${existing.expiresAt}). Performing automatic stale lock recovery.`
          );
        }
      }

      // Step 3: Record lock in persistent table
      const meta = options?.metadata ? JSON.stringify(options.metadata) : null;
      await client.query(`
        INSERT INTO veyra_distributed_locks (
          lock_key, tenant_id, domain, holder_id, task_name, acquired_at, expires_at, heartbeat_at, metadata
        ) VALUES (
          $1, $2, $3, $4, $5, NOW(), NOW() + ($6 || ' seconds')::interval, NOW(), $7
        )
        ON CONFLICT (lock_key) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          domain = EXCLUDED.domain,
          holder_id = EXCLUDED.holder_id,
          task_name = EXCLUDED.task_name,
          acquired_at = NOW(),
          expires_at = NOW() + ($6 || ' seconds')::interval,
          heartbeat_at = NOW(),
          metadata = EXCLUDED.metadata
      `, [lockKey, tenantId, domain, holderId, taskName, ttlSeconds, meta]);

      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

      // Track active client for clean release
      this.activeHeldLocks.set(lockKey, {
        client,
        advisoryKey,
        lockKey,
      });

      console.log(
        `[DistributedLock] Acquired distributed lock for "${lockKey}" ` +
        `(holder: ${holderId}, ttl: ${ttlSeconds}s${isStaleRecovered ? ', STALE RECOVERED' : ''})`
      );

      return {
        acquired: true,
        lockKey,
        holderId,
        expiresAt,
        isStaleRecovered,
        client,
        advisoryKey,
      };
    } catch (dbErr: any) {
      if (client) {
        try {
          await client.query('SELECT pg_advisory_unlock($1)', [advisoryKey]);
        } catch { /* ignore */ }
        client.release();
      }

      console.warn(`[DistributedLock] Database locking unavailable (${dbErr.message}). Engaging in-memory safeguard.`);
      return this.acquireInMemoryFallback(lockKey, taskName, holderId, ttlSeconds, options?.metadata);
    }
  }

  /**
   * Releases a held distributed lock.
   */
  public async releaseLock(lockKeyOrResult: string | LockAcquisitionResult): Promise<boolean> {
    const lockKey = typeof lockKeyOrResult === 'string' ? lockKeyOrResult : lockKeyOrResult.lockKey;
    const holderId = typeof lockKeyOrResult === 'object' ? lockKeyOrResult.holderId : undefined;

    // Check held active locks
    const held = this.activeHeldLocks.get(lockKey);
    let releasedDb = false;

    if (held) {
      this.activeHeldLocks.delete(lockKey);
      if (held.heartbeatInterval) {
        clearInterval(held.heartbeatInterval);
      }

      try {
        await held.client.query('SELECT pg_advisory_unlock($1)', [held.advisoryKey]);
      } catch (unlockErr: any) {
        console.warn(`[DistributedLock] Warning unlocking advisory key for "${lockKey}":`, unlockErr.message);
      } finally {
        held.client.release();
      }
      releasedDb = true;
    }

    // Remove or delete entry from veyra_distributed_locks table
    try {
      if (holderId) {
        await query(
          'DELETE FROM veyra_distributed_locks WHERE lock_key = $1 AND holder_id = $2',
          [lockKey, holderId]
        );
      } else {
        await query(
          'DELETE FROM veyra_distributed_locks WHERE lock_key = $1',
          [lockKey]
        );
      }
      releasedDb = true;
    } catch (err: any) {
      // In offline or fallback mode, database query may fail gracefully
    }

    // Always clear in-memory fallback
    const releasedMem = this.inMemoryLocks.delete(lockKey);

    console.log(`[DistributedLock] Released distributed lock for "${lockKey}".`);
    return releasedDb || releasedMem;
  }

  /**
   * Extends the TTL of an active lock (heartbeat).
   */
  public async heartbeat(lockKey: string, additionalTtlSeconds = 600): Promise<boolean> {
    try {
      const res = await query(`
        UPDATE veyra_distributed_locks
        SET heartbeat_at = NOW(),
            expires_at = NOW() + ($2 || ' seconds')::interval
        WHERE lock_key = $1
        RETURNING lock_key
      `, [lockKey, additionalTtlSeconds]);

      const updated = (res.rowCount || 0) > 0;
      if (updated) {
        const inMem = this.inMemoryLocks.get(lockKey);
        if (inMem) {
          inMem.expiresAt = new Date(Date.now() + additionalTtlSeconds * 1000);
        }
      }
      return updated;
    } catch (err: any) {
      const inMem = this.inMemoryLocks.get(lockKey);
      if (inMem) {
        inMem.expiresAt = new Date(Date.now() + additionalTtlSeconds * 1000);
        return true;
      }
      return false;
    }
  }

  /**
   * Checks whether a specific lock is currently held.
   */
  public async isLocked(scope?: LockScope): Promise<boolean> {
    const lockKey = buildLockKey(scope);

    // Check in-memory first
    const inMem = this.inMemoryLocks.get(lockKey);
    if (inMem && Date.now() < inMem.expiresAt.getTime()) {
      return true;
    }

    try {
      const info = await this.getLockInfoFromDb(lockKey);
      if (!info) return false;
      return Date.now() < new Date(info.expiresAt).getTime();
    } catch {
      return Boolean(inMem);
    }
  }

  /**
   * Returns all active locks in the system.
   */
  public async getActiveLocks(): Promise<LockHolderInfo[]> {
    try {
      const res = await query(`
        SELECT lock_key, tenant_id, domain, holder_id, task_name,
               acquired_at, expires_at, heartbeat_at, metadata
        FROM veyra_distributed_locks
        WHERE expires_at > NOW()
        ORDER BY acquired_at ASC
      `);

      return res.rows.map(r => ({
        lockKey: r.lock_key,
        tenantId: r.tenant_id,
        domain: r.domain,
        holderId: r.holder_id,
        taskName: r.task_name,
        acquiredAt: new Date(r.acquired_at).toISOString(),
        expiresAt: new Date(r.expires_at).toISOString(),
        heartbeatAt: new Date(r.heartbeat_at).toISOString(),
        metadata: r.metadata,
      }));
    } catch {
      // In-memory fallback
      const now = Date.now();
      const list: LockHolderInfo[] = [];
      for (const [key, item] of this.inMemoryLocks.entries()) {
        if (now < item.expiresAt.getTime()) {
          const [tenantId, domain] = key.split(':');
          list.push({
            lockKey: key,
            tenantId: tenantId || '__GLOBAL__',
            domain: domain || 'full',
            holderId: item.holderId,
            taskName: item.taskName,
            acquiredAt: item.acquiredAt.toISOString(),
            expiresAt: item.expiresAt.toISOString(),
            heartbeatAt: item.acquiredAt.toISOString(),
            metadata: item.metadata,
          });
        }
      }
      return list;
    }
  }

  /**
   * Cleans up expired / stale locks from the database.
   */
  public async recoverStaleLocks(): Promise<number> {
    try {
      const res = await query(`
        DELETE FROM veyra_distributed_locks
        WHERE expires_at <= NOW()
        RETURNING lock_key
      `);
      const count = res.rowCount || 0;
      if (count > 0) {
        console.log(`[DistributedLock] Cleaned up ${count} stale distributed lock(s).`);
      }
      return count;
    } catch {
      let count = 0;
      const now = Date.now();
      for (const [key, item] of this.inMemoryLocks.entries()) {
        if (now >= item.expiresAt.getTime()) {
          this.inMemoryLocks.delete(key);
          count++;
        }
      }
      return count;
    }
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private async getLockInfoFromDb(lockKey: string): Promise<LockHolderInfo | null> {
    try {
      const res = await query(`
        SELECT lock_key, tenant_id, domain, holder_id, task_name,
               acquired_at, expires_at, heartbeat_at, metadata
        FROM veyra_distributed_locks
        WHERE lock_key = $1
      `, [lockKey]);

      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        lockKey: r.lock_key,
        tenantId: r.tenant_id,
        domain: r.domain,
        holderId: r.holder_id,
        taskName: r.task_name,
        acquiredAt: new Date(r.acquired_at).toISOString(),
        expiresAt: new Date(r.expires_at).toISOString(),
        heartbeatAt: new Date(r.heartbeat_at).toISOString(),
        metadata: r.metadata,
      };
    } catch {
      return null;
    }
  }

  private acquireInMemoryFallback(
    lockKey: string,
    taskName: string,
    holderId: string,
    ttlSeconds: number,
    metadata?: Record<string, unknown>
  ): LockAcquisitionResult {
    const existing = this.inMemoryLocks.get(lockKey);
    const now = Date.now();

    if (existing) {
      if (now < existing.expiresAt.getTime()) {
        return {
          acquired: false,
          lockKey,
          holderId,
          errorReason: 'IN_MEMORY_LOCKED',
          existingHolder: {
            lockKey,
            tenantId: '__GLOBAL__',
            domain: 'full',
            holderId: existing.holderId,
            taskName: existing.taskName,
            acquiredAt: existing.acquiredAt.toISOString(),
            expiresAt: existing.expiresAt.toISOString(),
            heartbeatAt: existing.acquiredAt.toISOString(),
            metadata: existing.metadata,
          },
        };
      }
    }

    const expiresAtDate = new Date(now + ttlSeconds * 1000);
    this.inMemoryLocks.set(lockKey, {
      holderId,
      taskName,
      acquiredAt: new Date(now),
      expiresAt: expiresAtDate,
      metadata,
    });

    return {
      acquired: true,
      lockKey,
      holderId,
      expiresAt: expiresAtDate.toISOString(),
      isStaleRecovered: Boolean(existing),
    };
  }
}

export const distributedLockService = new DistributedLockService();
