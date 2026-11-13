/**
 * Plaintext -> Encrypted Migration for Existing Oracle Raw Records
 * Story ID: VYR-037
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both
 *
 * Converts legacy plaintext raw payloads in place, per table and tenant, through
 * the same encryptRawField() boundary the sync pipeline uses. Runbook:
 * docs/architecture/plaintext_to_encrypted_migration.md
 */

import crypto from 'crypto';
import pg from 'pg';
import { isEncryptedPayload } from './encryptionContract.js';
import {
  assertEncryptedRawWrite,
  decryptRawField,
  encryptRawField,
  isRawEncryptionEnabled,
  trackingColumns,
} from './encryptedRecordWriter.js';
import { RAW_ORACLE_PERSISTENCE_TABLES, RawTableDescriptor } from './encryptionMigrationService.js';
import { describeRawTable, RawTableShape } from './keyRotationService.js';

export type MigrationErrorCode =
  | 'INVALID_INPUT'
  | 'ENCRYPTION_NOT_ENABLED'
  | 'ENCRYPTION_STILL_ENABLED'
  | 'MIGRATION_LOCKED'
  | 'CONFIRMATION_REQUIRED';

export class MigrationError extends Error {
  constructor(public readonly code: MigrationErrorCode, message: string) {
    super(`[MigrationError: ${code}] ${message}`);
    this.name = 'MigrationError';
    Object.setPrototypeOf(this, MigrationError.prototype);
  }
}

/** Typed by the operator to confirm a decrypt-to-plaintext rollback. */
export const ROLLBACK_CONFIRMATION = 'DECRYPT_TO_PLAINTEXT';

export interface TableCounts {
  total: number;
  encrypted: number;
  plaintext: number;
  /** Plaintext rows with a NULL payload: nothing to encrypt. */
  emptyPayloads: number;
}

export interface RecordFailure {
  recordKey: string;
  code: string;
  error: string;
}

export interface MigrateTableResult {
  tableName: string;
  dryRun: boolean;
  candidates: number;
  emptyPayloads: number;
  migrated: number;
  /** Rows changed by a concurrent writer between read and update; left as written. */
  skipped: number;
  failed: number;
  failures: RecordFailure[];
  complete: boolean;
  resumedFromCheckpoint: boolean;
  before: TableCounts;
  after: TableCounts;
  reconciliation: { lost: number; reconciled: boolean };
  tableSkippedReason?: string;
}

export interface MigrateOptions {
  environmentHost?: string;
  batchSize?: number;
  /** Stop after this many batches; the next run resumes from the ledger checkpoint. */
  maxBatches?: number;
  dryRun?: boolean;
  /** Resume from the ledger checkpoint of an interrupted run (default true). */
  resume?: boolean;
}

const MAX_REPORTED_FAILURES = 50;
const MD5_COL = '__vyr037_raw_md5';

class RecordError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

function q(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function sanitizeError(err: any): string {
  return String(err?.message || err || 'Unknown error')
    .replace(/[A-Za-z0-9+/=]{32,}/g, '[REDACTED]')
    .slice(0, 300);
}

function stableStringify(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function samePayload(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Advisory-lock key shared by every migrator/rollback of one table + tenant. */
export function migrationLockKey(tableName: string, environmentHost: string): number {
  return crypto.createHash('sha256').update(`vyr037:${tableName}:${environmentHost}`).digest().readInt32BE(0);
}

function resolveTable(tableName: string, environmentHost?: string): RawTableDescriptor {
  if (!environmentHost || !environmentHost.trim()) {
    throw new MigrationError('INVALID_INPUT', 'environmentHost is required; migrations run per tenant');
  }
  const descriptor = RAW_ORACLE_PERSISTENCE_TABLES.find(d => d.tableName === tableName);
  if (!descriptor) {
    throw new MigrationError('INVALID_INPUT', `"${tableName}" is not a registered raw Oracle table`);
  }
  return descriptor;
}

async function countRows(db: pg.Pool | pg.PoolClient, shape: RawTableShape, host: string): Promise<TableCounts> {
  const raw = q(shape.descriptor.rawColumnName);
  const res = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE is_encrypted IS TRUE)::int AS encrypted,
            COUNT(*) FILTER (WHERE is_encrypted IS NOT TRUE)::int AS plaintext,
            COUNT(*) FILTER (WHERE is_encrypted IS NOT TRUE AND ${raw} IS NULL)::int AS empty_payloads
     FROM ${q(shape.descriptor.tableName)} WHERE environment_host = $1`,
    [host]
  );
  const r = res.rows[0];
  return { total: r.total, encrypted: r.encrypted, plaintext: r.plaintext, emptyPayloads: r.empty_payloads };
}

async function writeLedger(
  db: pg.PoolClient,
  tableName: string,
  host: string,
  fields: { counts: TableCounts; checkpoint: unknown[] | null; batchSize: number; status: string; lastError: string | null; starting?: boolean }
): Promise<void> {
  await db.query(
    `INSERT INTO oracle_encryption_migration_ledger (
       table_name, environment_host, total_records, encrypted_records, plaintext_records,
       last_migrated_id, batch_size, status, last_error, started_at, completed_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::varchar, $9, NOW(), CASE WHEN $8::varchar = 'COMPLETED' THEN NOW() END, NOW())
     ON CONFLICT (table_name, environment_host) DO UPDATE SET
       total_records = EXCLUDED.total_records,
       encrypted_records = EXCLUDED.encrypted_records,
       plaintext_records = EXCLUDED.plaintext_records,
       last_migrated_id = EXCLUDED.last_migrated_id,
       batch_size = EXCLUDED.batch_size,
       status = EXCLUDED.status,
       last_error = EXCLUDED.last_error,
       started_at = CASE WHEN $10 THEN NOW() ELSE COALESCE(oracle_encryption_migration_ledger.started_at, NOW()) END,
       completed_at = CASE WHEN EXCLUDED.status = 'COMPLETED' THEN NOW()
                           WHEN $10 THEN NULL
                           ELSE oracle_encryption_migration_ledger.completed_at END,
       updated_at = NOW()`,
    [
      tableName, host, fields.counts.total, fields.counts.encrypted, fields.counts.plaintext,
      fields.checkpoint ? JSON.stringify(fields.checkpoint) : null,
      fields.batchSize, fields.status, fields.lastError, Boolean(fields.starting),
    ]
  );
}

async function acquireLock(pool: pg.Pool, tableName: string, host: string): Promise<{ client: pg.PoolClient; key: number }> {
  const client = await pool.connect();
  const key = migrationLockKey(tableName, host);
  try {
    const res = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [key]);
    if (!res.rows[0].ok) {
      throw new MigrationError('MIGRATION_LOCKED', `A migration or rollback for ${tableName} / ${host} is already running`);
    }
    return { client, key };
  } catch (err) {
    client.release();
    throw err;
  }
}

async function releaseLock(lock: { client: pg.PoolClient; key: number }): Promise<void> {
  try {
    await lock.client.query('SELECT pg_advisory_unlock($1)', [lock.key]);
  } finally {
    lock.client.release();
  }
}

function keysetClause(shape: RawTableShape, cursor: unknown[] | null, params: unknown[]): string {
  if (!cursor) return '';
  const placeholders = cursor.map(v => { params.push(v); return `$${params.length}`; });
  return ` AND (${shape.keyColumns.map(q).join(', ')}) > (${placeholders.join(', ')})`;
}

function emptyResult(tableName: string, dryRun: boolean, counts: TableCounts): MigrateTableResult {
  return {
    tableName, dryRun, candidates: 0, emptyPayloads: counts.emptyPayloads, migrated: 0, skipped: 0, failed: 0,
    failures: [], complete: true, resumedFromCheckpoint: false, before: counts, after: counts,
    reconciliation: { lost: 0, reconciled: true },
  };
}

/**
 * Encrypts every plaintext raw payload of one table for one tenant.
 *
 * Per record: encrypt through encryptRawField -> verify it decrypts to the
 * original -> UPDATE in a transaction guarded by the row's content hash ->
 * decrypt the written value and compare again -> COMMIT. Plaintext is replaced
 * only by that committed, verified write. Restartable from the ledger checkpoint
 * and idempotent: encrypted rows are never candidates again.
 */
export async function migrateTable(pool: pg.Pool, tableName: string, opts: MigrateOptions = {}): Promise<MigrateTableResult> {
  const descriptor = resolveTable(tableName, opts.environmentHost);
  const host = opts.environmentHost!.trim();
  const dryRun = Boolean(opts.dryRun);
  const batchSize = Math.min(Math.max(opts.batchSize ?? 100, 1), 5000);

  const shape = await describeRawTable(pool, descriptor);
  if (!shape || !shape.hasHost) {
    return {
      ...emptyResult(tableName, dryRun, { total: 0, encrypted: 0, plaintext: 0, emptyPayloads: 0 }),
      tableSkippedReason: 'table missing or has no encryption tracking columns',
    };
  }

  if (dryRun) {
    const counts = await countRows(pool, shape, host);
    const candidates = counts.plaintext - counts.emptyPayloads;
    return { ...emptyResult(tableName, true, counts), candidates, complete: candidates === 0 };
  }

  if (!isRawEncryptionEnabled()) {
    throw new MigrationError(
      'ENCRYPTION_NOT_ENABLED',
      'Set VEYRA_RAW_ENCRYPTION=true before migrating so normal sync cannot write new plaintext behind the migration'
    );
  }

  const lock = await acquireLock(pool, tableName, host);
  const db = lock.client;
  const rawCol = q(descriptor.rawColumnName);
  const keyCols = shape.keyColumns.map(q);
  const result: MigrateTableResult = emptyResult(tableName, false, await countRows(db, shape, host));
  result.candidates = result.before.plaintext - result.before.emptyPayloads;
  result.complete = false;
  let cursor: unknown[] | null = null;

  try {
    if (opts.resume !== false) {
      const prior = await db.query(
        `SELECT status, last_migrated_id FROM oracle_encryption_migration_ledger WHERE table_name = $1 AND environment_host = $2`,
        [tableName, host]
      );
      const row = prior.rows[0];
      if (row?.last_migrated_id && (row.status === 'IN_PROGRESS' || row.status === 'FAILED')) {
        cursor = JSON.parse(row.last_migrated_id);
        result.resumedFromCheckpoint = true;
      }
    }
    await writeLedger(db, tableName, host, {
      counts: result.before, checkpoint: cursor, batchSize, status: 'IN_PROGRESS', lastError: null, starting: !result.resumedFromCheckpoint,
    });

    let batches = 0;
    while (true) {
      const params: unknown[] = [host];
      const cursorClause = keysetClause(shape, cursor, params);
      params.push(batchSize);
      const batch = await db.query(
        `SELECT *, md5(${rawCol}::text) AS ${MD5_COL}
         FROM ${q(tableName)}
         WHERE environment_host = $1 AND is_encrypted IS NOT TRUE AND ${rawCol} IS NOT NULL${cursorClause}
         ORDER BY ${keyCols.join(', ')} LIMIT $${params.length}`,
        params
      );
      if (batch.rows.length === 0) {
        result.complete = true;
        break;
      }

      for (const row of batch.rows) {
        const { [MD5_COL]: rawMd5, ...record } = row;
        const recordKey = shape.keyColumns.map(c => row[c]).join('/');
        const original = record[descriptor.rawColumnName];
        let inTx = false;
        try {
          if (isEncryptedPayload(original)) {
            throw new RecordError('FLAG_MISMATCH', 'Row is flagged plaintext but already holds an encrypted payload; not re-encrypting');
          }

          const write = await encryptRawField(tableName, record, original, record.environment_host);
          assertEncryptedRawWrite(tableName, write);
          const check = await decryptRawField(tableName, record, write.rawValue, record.environment_host);
          if (!samePayload(check, original)) {
            throw new RecordError('VERIFY_FAILED', 'Encrypted payload did not decrypt to the original');
          }

          const updParams: unknown[] = [JSON.stringify(write.rawValue), ...trackingColumns(write), rawMd5];
          const keyMatch = shape.keyColumns.map(c => { updParams.push(row[c]); return `${q(c)} = $${updParams.length}`; });

          await db.query('BEGIN');
          inTx = true;
          const upd = await db.query(
            `UPDATE ${q(tableName)}
             SET ${rawCol} = $1, is_encrypted = $2, encryption_format_version = $3, encryption_key_id = $4, encrypted_at = $5
             WHERE ${keyMatch.join(' AND ')} AND is_encrypted IS NOT TRUE AND md5(${rawCol}::text) = $6
             RETURNING ${rawCol} AS written`,
            updParams
          );
          if (upd.rowCount !== 1) {
            await db.query('ROLLBACK');
            inTx = false;
            result.skipped++;
            continue;
          }
          const persisted = await decryptRawField(tableName, record, upd.rows[0].written, record.environment_host);
          if (!samePayload(persisted, original)) {
            throw new RecordError('POST_WRITE_VERIFY_FAILED', 'Persisted payload did not decrypt to the original');
          }
          await db.query('COMMIT');
          inTx = false;
          result.migrated++;
        } catch (err: any) {
          if (inTx) await db.query('ROLLBACK').catch(() => {});
          result.failed++;
          if (result.failures.length < MAX_REPORTED_FAILURES) {
            result.failures.push({ recordKey, code: err?.code || 'ERROR', error: sanitizeError(err) });
          }
        }
      }

      const last = batch.rows[batch.rows.length - 1];
      cursor = shape.keyColumns.map(c => last[c]);
      batches++;
      await writeLedger(db, tableName, host, {
        counts: await countRows(db, shape, host), checkpoint: cursor, batchSize, status: 'IN_PROGRESS', lastError: null,
      });

      if (opts.maxBatches && batches >= opts.maxBatches) {
        const moreParams: unknown[] = [host];
        const more = await db.query(
          `SELECT 1 FROM ${q(tableName)}
           WHERE environment_host = $1 AND is_encrypted IS NOT TRUE AND ${rawCol} IS NOT NULL${keysetClause(shape, cursor, moreParams)}
           LIMIT 1`,
          moreParams
        );
        result.complete = more.rows.length === 0;
        break;
      }
    }

    result.after = await countRows(db, shape, host);
    const remaining = result.after.plaintext - result.after.emptyPayloads;
    const lost = result.before.total - result.after.total;
    result.reconciliation = {
      lost,
      reconciled:
        lost <= 0 &&
        result.after.encrypted >= result.before.encrypted + result.migrated &&
        result.after.plaintext <= result.before.plaintext - result.migrated,
    };

    let status = 'IN_PROGRESS';
    let lastError: string | null = null;
    if (result.complete) {
      status = remaining === 0 ? 'COMPLETED' : 'FAILED';
      if (remaining > 0) {
        const codes = Array.from(new Set(result.failures.map(f => f.code))).join(', ') || 'see previous runs';
        lastError = `${remaining} plaintext record(s) remain (${codes})`;
      }
    }
    await writeLedger(db, tableName, host, {
      counts: result.after, checkpoint: result.complete ? null : cursor, batchSize, status, lastError,
    });
    return result;
  } catch (err: any) {
    await writeLedger(db, tableName, host, {
      counts: await countRows(db, shape, host).catch(() => result.before),
      checkpoint: cursor, batchSize, status: 'FAILED', lastError: sanitizeError(err),
    }).catch(() => {});
    throw err;
  } finally {
    await releaseLock(lock);
  }
}

/** Runs migrateTable for every registered raw Oracle table of one tenant. */
export async function migrateAll(pool: pg.Pool, opts: MigrateOptions = {}): Promise<{
  tables: MigrateTableResult[];
  totals: { candidates: number; migrated: number; skipped: number; failed: number; emptyPayloads: number };
  reconciled: boolean;
}> {
  const tables: MigrateTableResult[] = [];
  for (const descriptor of RAW_ORACLE_PERSISTENCE_TABLES) {
    tables.push(await migrateTable(pool, descriptor.tableName, opts));
  }
  const totals = tables.reduce(
    (acc, t) => ({
      candidates: acc.candidates + t.candidates,
      migrated: acc.migrated + t.migrated,
      skipped: acc.skipped + t.skipped,
      failed: acc.failed + t.failed,
      emptyPayloads: acc.emptyPayloads + t.emptyPayloads,
    }),
    { candidates: 0, migrated: 0, skipped: 0, failed: 0, emptyPayloads: 0 }
  );
  return { tables, totals, reconciled: tables.every(t => t.reconciliation.reconciled) };
}

/**
 * Rollback: decrypts one table's encrypted payloads for one tenant back to
 * plaintext. Allowed only with encryption disabled and explicit confirmation.
 */
export async function rollbackTable(
  pool: pg.Pool,
  tableName: string,
  opts: { environmentHost?: string; confirm?: string; batchSize?: number } = {}
): Promise<{ tableName: string; restored: number; skipped: number; failed: number; failures: RecordFailure[] }> {
  const descriptor = resolveTable(tableName, opts.environmentHost);
  const host = opts.environmentHost!.trim();
  if (isRawEncryptionEnabled()) {
    throw new MigrationError('ENCRYPTION_STILL_ENABLED', 'Disable VEYRA_RAW_ENCRYPTION before rolling back, or sync will re-encrypt rows');
  }
  if (opts.confirm !== ROLLBACK_CONFIRMATION) {
    throw new MigrationError('CONFIRMATION_REQUIRED', `Rollback writes plaintext; pass confirm: "${ROLLBACK_CONFIRMATION}"`);
  }

  const out = { tableName, restored: 0, skipped: 0, failed: 0, failures: [] as RecordFailure[] };
  const shape = await describeRawTable(pool, descriptor);
  if (!shape || !shape.hasHost) return out;

  const batchSize = Math.min(Math.max(opts.batchSize ?? 100, 1), 5000);
  const lock = await acquireLock(pool, tableName, host);
  const db = lock.client;
  const rawCol = q(descriptor.rawColumnName);
  const keyCols = shape.keyColumns.map(q);
  try {
    let cursor: unknown[] | null = null;
    while (true) {
      const params: unknown[] = [host];
      const cursorClause = keysetClause(shape, cursor, params);
      params.push(batchSize);
      const batch = await db.query(
        `SELECT *, md5(${rawCol}::text) AS ${MD5_COL} FROM ${q(tableName)}
         WHERE environment_host = $1 AND is_encrypted IS TRUE${cursorClause}
         ORDER BY ${keyCols.join(', ')} LIMIT $${params.length}`,
        params
      );
      if (batch.rows.length === 0) break;

      for (const row of batch.rows) {
        const { [MD5_COL]: rawMd5, ...record } = row;
        try {
          const plain = await decryptRawField(tableName, record, record[descriptor.rawColumnName], record.environment_host);
          const updParams: unknown[] = [JSON.stringify(plain), rawMd5];
          const keyMatch = shape.keyColumns.map(c => { updParams.push(row[c]); return `${q(c)} = $${updParams.length}`; });
          const upd = await db.query(
            `UPDATE ${q(tableName)}
             SET ${rawCol} = $1, is_encrypted = false, encryption_format_version = NULL, encryption_key_id = NULL, encrypted_at = NULL
             WHERE ${keyMatch.join(' AND ')} AND is_encrypted IS TRUE AND md5(${rawCol}::text) = $2`,
            updParams
          );
          if (upd.rowCount === 1) out.restored++;
          else out.skipped++;
        } catch (err: any) {
          out.failed++;
          if (out.failures.length < MAX_REPORTED_FAILURES) {
            out.failures.push({ recordKey: shape.keyColumns.map(c => row[c]).join('/'), code: err?.code || 'ERROR', error: sanitizeError(err) });
          }
        }
      }
      const last = batch.rows[batch.rows.length - 1];
      cursor = shape.keyColumns.map(c => last[c]);
    }

    await writeLedger(db, tableName, host, {
      counts: await countRows(db, shape, host), checkpoint: null, batchSize,
      status: out.failed > 0 ? 'FAILED' : 'ROLLED_BACK',
      lastError: out.failed > 0 ? `${out.failed} record(s) could not be decrypted during rollback` : null,
    });
    return out;
  } finally {
    await releaseLock(lock);
  }
}
