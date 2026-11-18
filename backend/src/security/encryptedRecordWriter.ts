/**
 * Raw-Record Encryption Write Helper
 * Story ID: VYR-032
 * Epic: EPIC 4 - Oracle raw-data encryption and Node.js-only decryption
 *
 * Single integration point between the Oracle ingestion services and the
 * VYR-028/VYR-029 encryption contract. Every raw-table write in the sync
 * pipeline routes its classified JSON payload through encryptRawField().
 *
 * Rollout switch: VEYRA_RAW_ENCRYPTION=true enables encryption at rest.
 * It is disabled by default because VYR-035 (authorized Node.js decryption
 * for dashboards, reports and investigations) must migrate the SQL JSONB
 * read paths before encrypted rows can be consumed.
 *
 * Fail closed: when encryption is enabled, any encryption failure throws
 * before the INSERT is issued, so no plaintext row can be persisted.
 */

import {
  buildTableRecordAad,
  CURRENT_ENCRYPTION_FORMAT_VERSION,
  getRecordNaturalId,
  isEncryptedPayload,
} from './encryptionContract.js';
import { encryptionService } from './encryptionService.js';
import { classifyCryptoError, newCryptoIncidentId, ProtectedDataError, CryptoFailureCategory } from './cryptoFailure.js';
import { cryptoAuditService, CryptoOperation } from './cryptoAuditService.js';

function safeRecordRef(tableName: string, record: Record<string, any>): string | null {
  try {
    return getRecordNaturalId(tableName, record).slice(0, 200) || null;
  } catch {
    return null;
  }
}

/**
 * VYR-038: converts any failure at the raw-record boundary into a classified,
 * audited ProtectedDataError. The original error never leaves this function.
 */
function failClosed(
  operation: CryptoOperation,
  tableName: string,
  record: Record<string, any>,
  environmentHost: string,
  err: unknown,
  keyId: string | null,
  forcedCategory?: CryptoFailureCategory
): ProtectedDataError {
  if (err instanceof ProtectedDataError) return err;
  let category = forcedCategory || classifyCryptoError(err);
  if (operation === 'ENCRYPT' && (category === 'UNKNOWN' || category === 'CORRUPTED_PAYLOAD')) {
    category = 'ENCRYPTION_FAILURE';
  }
  const incidentId = newCryptoIncidentId();
  cryptoAuditService.recordFailure({
    operation,
    tenant: environmentHost || null,
    tableName,
    recordRef: safeRecordRef(tableName, record),
    keyId,
    category,
    incidentId,
    internalDetail: String((err as any)?.message || err || ''),
  });
  return new ProtectedDataError(category, incidentId, operation);
}

export const RAW_ENCRYPTION_ENV = 'VEYRA_RAW_ENCRYPTION';

/**
 * Whether at-rest encryption is enabled for this deployment.
 * Default: disabled (legacy plaintext writes, dual-mode readable).
 */
export function isRawEncryptionEnabled(): boolean {
  return (process.env[RAW_ENCRYPTION_ENV] || '').trim().toLowerCase() === 'true';
}

export interface RawFieldWrite {
  /**
   * JSONB value to bind to the raw payload column:
   * the EncryptedPayload container when enabled, otherwise the legacy object.
   */
  rawValue: unknown;
  isEncrypted: boolean;
  /** Active KEK id when encrypted, null for legacy rows. */
  encryptionKey: string | null;
}

/**
 * Encrypted tracking column values, in schema order:
 * [is_encrypted, encryption_format_version, encryption_key_id, encrypted_at]
 */
export function trackingColumns(write: RawFieldWrite): unknown[] {
  return [
    write.isEncrypted,
    write.isEncrypted ? CURRENT_ENCRYPTION_FORMAT_VERSION : null,
    write.encryptionKey,
    write.isEncrypted ? new Date() : null,
  ];
}

/**
 * Encrypts a classified raw payload bound to (tenant, table, record) AAD.
 * Returns the legacy value untouched when encryption is disabled.
 */
export async function encryptRawField(
  tableName: string,
  record: Record<string, any>,
  rawObject: unknown,
  environmentHost: string
): Promise<RawFieldWrite> {
  if (!isRawEncryptionEnabled()) {
    return { rawValue: rawObject, isEncrypted: false, encryptionKey: null };
  }

  if (rawObject === null || rawObject === undefined) {
    throw new Error(`[EncryptedRecordWriter] Refusing to persist a missing raw payload for ${tableName}`);
  }

  let payload: unknown;
  try {
    payload = await encryptionService.encryptPayload(
      rawObject,
      buildTableRecordAad(tableName, record, environmentHost)
    );
  } catch (err) {
    // Fail closed (VYR-038): no plaintext fallback; the caller's INSERT never runs.
    throw failClosed('ENCRYPT', tableName, record, environmentHost, err, null);
  }

  // Boundary check: the encryption service must return a genuine container.
  // A degraded KMS/provider returning plaintext is rejected before any SQL.
  if (!isEncryptedPayload(payload)) {
    throw failClosed('ENCRYPT', tableName, record, environmentHost,
      new Error('Encryption service returned a non-encrypted payload'), null, 'ENCRYPTION_FAILURE');
  }

  return { rawValue: payload, isEncrypted: true, encryptionKey: payload.keyId };
}

/**
 * Repository-boundary guard (VYR-034). Call before any SQL that persists a
 * raw payload column. While encryption is enforced, only genuine encrypted
 * writes may pass; a plaintext write is rejected instead of persisted.
 */
export function assertEncryptedRawWrite(tableName: string, write: RawFieldWrite): void {
  if (!isRawEncryptionEnabled()) return; // dual-mode rollout: legacy writes allowed while disabled
  if (!write || write.isEncrypted !== true || !isEncryptedPayload(write.rawValue)) {
    throw new Error(
      `[EncryptedRecordWriter] Plaintext write rejected for ${tableName} raw payload while encryption is enabled. Route the write through encryptRawField().`
    );
  }
}

/**
 * Read-side counterpart (consumed by VYR-035): dual-mode. Legacy plaintext
 * payloads are returned untouched; EncryptedPayload containers are decrypted
 * and verified against the record's AAD.
 *
 * VYR-038: every decrypt of a protected record is audited (who, tenant,
 * record, purpose, time, outcome). Failures throw ProtectedDataError, whose
 * message is safe to return to clients and never contains crypto detail.
 */
export async function decryptRawField<T = any>(
  tableName: string,
  record: Record<string, any>,
  rawColumnValue: unknown,
  environmentHost: string
): Promise<T> {
  if (!isEncryptedPayload(rawColumnValue)) {
    // A row flagged encrypted must hold a genuine container; anything else is
    // treated as corrupted rather than returned as if it were plaintext.
    if (record?.is_encrypted === true) {
      throw failClosed('DECRYPT', tableName, record, environmentHost,
        new Error('Row is flagged encrypted but does not hold an encrypted container'), null, 'CORRUPTED_PAYLOAD');
    }
    return rawColumnValue as T; // legacy plaintext row (migration window)
  }

  const keyId = typeof rawColumnValue.keyId === 'string' ? rawColumnValue.keyId : null;
  try {
    const plain = await encryptionService.decryptEntityRecord<T>(tableName, record, rawColumnValue, environmentHost);
    cryptoAuditService.recordSuccess({
      operation: 'DECRYPT',
      tenant: environmentHost || null,
      tableName,
      recordRef: safeRecordRef(tableName, record),
      keyId,
    });
    return plain;
  } catch (err) {
    throw failClosed('DECRYPT', tableName, record, environmentHost, err, keyId);
  }
}
