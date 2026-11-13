/**
 * KEK Rotation, DEK Rewrap and Key Retirement
 * Story ID: VYR-036
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both
 *
 * Operates on the raw Oracle tables listed in RAW_ORACLE_PERSISTENCE_TABLES.
 * Rotation only rewraps each record's DEK: ciphertext, nonce, authTag, AAD,
 * record IDs and metadata columns are never touched. Process and runbook:
 * docs/architecture/key_rotation_and_version_compatibility.md
 */

import pg from 'pg';
import { isEncryptedPayload } from './encryptionContract.js';
import {
  EncryptionError,
  EncryptionService,
  KeyLifecycleRegistry,
  encryptionService as defaultService,
  keyRegistry as defaultRegistry,
} from './encryptionService.js';
import { RAW_ORACLE_PERSISTENCE_TABLES, RawTableDescriptor } from './encryptionMigrationService.js';

export interface KeyUsageRow {
  tableName: string;
  keyId: string | null;
  formatVersion: number | null;
  records: number;
}

export interface RewrapOptions {
  service?: EncryptionService;
  /** Defaults to the service's active key. Must be ACTIVE. */
  toKeyId?: string;
  /** Only rewrap records currently under this key. */
  fromKeyId?: string;
  environmentHost?: string;
  batchSize?: number;
  /** Stop after this many batches (the job is restartable). */
  maxBatches?: number;
  dryRun?: boolean;
}

export interface RewrapTableResult {
  tableName: string;
  candidates: number;
  rewrapped: number;
  /** Rows changed by a concurrent writer between read and update; left as written. */
  skipped: number;
  failed: number;
  failures: Array<{ recordKey: string; code: string; error: string }>;
  complete: boolean;
  tableSkippedReason?: string;
}

export interface RewrapReport {
  toKeyId: string;
  dryRun: boolean;
  tables: RewrapTableResult[];
  totals: { candidates: number; rewrapped: number; skipped: number; failed: number };
}

export interface RawTableShape {
  descriptor: RawTableDescriptor;
  keyColumns: string[];
  hasHost: boolean;
  hasFormatVersion: boolean;
}

const MAX_REPORTED_FAILURES = 50;

function q(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function sanitizeError(err: any): string {
  return String(err?.message || err || 'Unknown error')
    .replace(/[A-Za-z0-9+/=]{32,}/g, '[REDACTED]')
    .slice(0, 300);
}

function findDescriptor(tableName: string): RawTableDescriptor {
  const descriptor = RAW_ORACLE_PERSISTENCE_TABLES.find(d => d.tableName === tableName);
  if (!descriptor) {
    throw new EncryptionError('INVALID_INPUT', `"${tableName}" is not a registered raw Oracle table`);
  }
  return descriptor;
}

export async function describeRawTable(pool: pg.Pool, descriptor: RawTableDescriptor): Promise<RawTableShape | null> {
  const res = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [descriptor.tableName]
  );
  const cols = new Set(res.rows.map((r: any) => r.column_name as string));
  if (!['is_encrypted', 'encryption_key_id', descriptor.rawColumnName].every(c => cols.has(c))) return null;

  const keyColumns = cols.has('id') ? ['id'] : descriptor.primaryKeyColumns;
  if (!keyColumns.every(c => cols.has(c))) return null;

  return {
    descriptor,
    keyColumns,
    hasHost: cols.has('environment_host'),
    hasFormatVersion: cols.has('encryption_format_version'),
  };
}

function assertWrapTarget(service: EncryptionService, keyId: string): void {
  const provider = service.getKeyProvider();
  if (provider instanceof KeyLifecycleRegistry && provider.getStatus(keyId) !== 'ACTIVE') {
    throw new EncryptionError('KEY_NOT_APPROVED', `Rewrap target "${keyId}" must be the ACTIVE key (is ${provider.getStatus(keyId) ?? 'UNKNOWN'})`);
  }
}

/** Encrypted record counts per table, key ID and format version. */
export async function getKeyUsage(pool: pg.Pool, environmentHost?: string): Promise<KeyUsageRow[]> {
  const rows: KeyUsageRow[] = [];
  for (const descriptor of RAW_ORACLE_PERSISTENCE_TABLES) {
    const shape = await describeRawTable(pool, descriptor);
    if (!shape) continue;
    const params: any[] = [];
    let where = 'is_encrypted = true';
    if (environmentHost && shape.hasHost) {
      params.push(environmentHost);
      where += ` AND environment_host = $${params.length}`;
    }
    const versionCol = shape.hasFormatVersion ? 'encryption_format_version' : 'NULL::smallint';
    const res = await pool.query(
      `SELECT encryption_key_id AS key_id, ${versionCol} AS format_version, COUNT(*)::int AS records
       FROM ${q(descriptor.tableName)} WHERE ${where} GROUP BY 1, 2 ORDER BY 1, 2`,
      params
    );
    for (const r of res.rows) {
      rows.push({
        tableName: descriptor.tableName,
        keyId: r.key_id,
        formatVersion: r.format_version === null ? null : Number(r.format_version),
        records: r.records,
      });
    }
  }
  return rows;
}

/**
 * Rewraps every encrypted record in one table that is not yet under the target
 * key. Restartable and idempotent: rewrapped rows drop out of the candidate set,
 * so re-running continues where a previous run stopped.
 */
export async function rewrapTable(pool: pg.Pool, tableName: string, opts: RewrapOptions = {}): Promise<RewrapTableResult> {
  const descriptor = findDescriptor(tableName);
  const service = opts.service || defaultService;
  const toKeyId = opts.toKeyId || service.getKeyProvider().getActiveKeyId();
  const batchSize = Math.min(Math.max(opts.batchSize ?? 200, 1), 5000);

  const result: RewrapTableResult = {
    tableName, candidates: 0, rewrapped: 0, skipped: 0, failed: 0, failures: [], complete: false,
  };

  const shape = await describeRawTable(pool, descriptor);
  if (!shape) {
    result.complete = true;
    result.tableSkippedReason = 'table missing or has no encryption tracking columns';
    return result;
  }
  if (!opts.dryRun) assertWrapTarget(service, toKeyId);

  const rawCol = q(descriptor.rawColumnName);
  const keyCols = shape.keyColumns.map(q);
  const baseParams: any[] = [toKeyId];
  let where = 'is_encrypted = true AND encryption_key_id IS DISTINCT FROM $1';
  if (opts.fromKeyId) {
    baseParams.push(opts.fromKeyId);
    where += ` AND encryption_key_id = $${baseParams.length}`;
  }
  if (opts.environmentHost && shape.hasHost) {
    baseParams.push(opts.environmentHost);
    where += ` AND environment_host = $${baseParams.length}`;
  }

  const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM ${q(tableName)} WHERE ${where}`, baseParams);
  result.candidates = countRes.rows[0].c;
  if (opts.dryRun || result.candidates === 0) {
    result.complete = result.candidates === 0;
    return result;
  }

  const afterCursor = (cursor: any[] | null, params: any[]): string => {
    if (!cursor) return '';
    const placeholders = cursor.map(v => { params.push(v); return `$${params.length}`; });
    return ` AND (${keyCols.join(', ')}) > (${placeholders.join(', ')})`;
  };

  let cursor: any[] | null = null;
  let batches = 0;
  while (true) {
    const params = [...baseParams];
    const cursorClause = afterCursor(cursor, params);
    params.push(batchSize);
    const batch = await pool.query(
      `SELECT ${keyCols.join(', ')}, encryption_key_id, ${rawCol} AS raw_value
       FROM ${q(tableName)} WHERE ${where}${cursorClause}
       ORDER BY ${keyCols.join(', ')} LIMIT $${params.length}`,
      params
    );
    if (batch.rows.length === 0) {
      result.complete = true;
      break;
    }

    for (const row of batch.rows) {
      const keyValues = shape.keyColumns.map(c => row[c]);
      const recordKey = keyValues.join('/');
      try {
        const payload = row.raw_value;
        if (!isEncryptedPayload(payload)) {
          throw new EncryptionError('INVALID_CONTAINER', 'Row is flagged encrypted but does not hold an encrypted payload');
        }
        const rewrapped = await service.rewrapPayloadDek(payload, toKeyId);
        // Verify before persisting: the new wrap must decrypt the unchanged ciphertext.
        await service.decryptPayload(rewrapped, payload.aad);

        const updParams: any[] = [JSON.stringify(rewrapped), toKeyId, row.encryption_key_id, payload.ciphertext];
        const keyMatch = shape.keyColumns.map(c => { updParams.push(row[c]); return `${q(c)} = $${updParams.length}`; });
        const upd = await pool.query(
          `UPDATE ${q(tableName)} SET ${rawCol} = $1, encryption_key_id = $2
           WHERE ${keyMatch.join(' AND ')}
             AND encryption_key_id IS NOT DISTINCT FROM $3
             AND ${rawCol}->>'ciphertext' = $4`,
          updParams
        );
        if (upd.rowCount === 1) result.rewrapped++;
        else result.skipped++;
      } catch (err: any) {
        result.failed++;
        if (result.failures.length < MAX_REPORTED_FAILURES) {
          result.failures.push({ recordKey, code: err?.code || 'ERROR', error: sanitizeError(err) });
        }
      }
    }

    const last = batch.rows[batch.rows.length - 1];
    cursor = shape.keyColumns.map(c => last[c]);
    batches++;

    if (opts.maxBatches && batches >= opts.maxBatches) {
      const params2 = [...baseParams];
      const more = await pool.query(
        `SELECT 1 FROM ${q(tableName)} WHERE ${where}${afterCursor(cursor, params2)} LIMIT 1`,
        params2
      );
      result.complete = more.rows.length === 0;
      break;
    }
  }

  return result;
}

/** Runs rewrapTable over every registered raw Oracle table. */
export async function rewrapAll(pool: pg.Pool, opts: RewrapOptions = {}): Promise<RewrapReport> {
  const service = opts.service || defaultService;
  const toKeyId = opts.toKeyId || service.getKeyProvider().getActiveKeyId();
  if (!opts.dryRun) assertWrapTarget(service, toKeyId);

  const tables: RewrapTableResult[] = [];
  for (const descriptor of RAW_ORACLE_PERSISTENCE_TABLES) {
    tables.push(await rewrapTable(pool, descriptor.tableName, { ...opts, service, toKeyId }));
  }
  const totals = tables.reduce(
    (acc, t) => ({
      candidates: acc.candidates + t.candidates,
      rewrapped: acc.rewrapped + t.rewrapped,
      skipped: acc.skipped + t.skipped,
      failed: acc.failed + t.failed,
    }),
    { candidates: 0, rewrapped: 0, skipped: 0, failed: 0 }
  );
  return { toKeyId, dryRun: Boolean(opts.dryRun), tables, totals };
}

/**
 * Counts records (all tenants) that still depend on keyId, by tracking column
 * or by the keyId inside the stored payload, and retires the key only if none do.
 */
export async function retireKey(
  pool: pg.Pool,
  keyId: string,
  opts: { registry?: KeyLifecycleRegistry } = {}
): Promise<{ keyId: string; dependentRecords: number; perTable: Record<string, number> }> {
  const registry = opts.registry || defaultRegistry;
  const perTable: Record<string, number> = {};
  let dependentRecords = 0;

  for (const descriptor of RAW_ORACLE_PERSISTENCE_TABLES) {
    const shape = await describeRawTable(pool, descriptor);
    if (!shape) continue;
    const res = await pool.query(
      `SELECT COUNT(*)::int AS c FROM ${q(descriptor.tableName)}
       WHERE encryption_key_id = $1 OR ${q(descriptor.rawColumnName)}->>'keyId' = $1`,
      [keyId]
    );
    if (res.rows[0].c > 0) {
      perTable[descriptor.tableName] = res.rows[0].c;
      dependentRecords += res.rows[0].c;
    }
  }

  registry.retire(keyId, dependentRecords);
  return { keyId, dependentRecords, perTable };
}

/**
 * Emergency key-compromise response: blocks the compromised key from wrapping,
 * activates the replacement, then rewraps every record off the compromised key.
 */
export async function emergencyRotate(
  pool: pg.Pool,
  opts: {
    compromisedKeyId: string;
    replacementKeyId: string;
    replacementSecret?: string | Buffer;
    registry?: KeyLifecycleRegistry;
    service?: EncryptionService;
    environmentHost?: string;
    batchSize?: number;
  }
): Promise<RewrapReport & { compromisedKeyId: string; activeKeyId: string }> {
  const registry = opts.registry || defaultRegistry;
  const service = opts.service || defaultService;

  if (opts.replacementSecret && registry.getStatus(opts.replacementKeyId) === null) {
    registry.addKey(opts.replacementKeyId, opts.replacementSecret);
  }
  registry.markCompromised(opts.compromisedKeyId, opts.replacementKeyId);
  if (registry.getActiveKeyId() !== opts.replacementKeyId) {
    registry.activate(opts.replacementKeyId);
  }

  const report = await rewrapAll(pool, {
    service,
    fromKeyId: opts.compromisedKeyId,
    toKeyId: registry.getActiveKeyId(),
    environmentHost: opts.environmentHost,
    batchSize: opts.batchSize,
  });
  return { ...report, compromisedKeyId: opts.compromisedKeyId, activeKeyId: registry.getActiveKeyId() };
}
