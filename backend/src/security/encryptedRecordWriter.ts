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
  isEncryptedPayload,
} from './encryptionContract.js';
import { encryptionService } from './encryptionService.js';

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

  const payload = await encryptionService.encryptPayload(
    rawObject,
    buildTableRecordAad(tableName, record, environmentHost)
  );

  // Boundary check: the encryption service must return a genuine container.
  // A degraded KMS/provider returning plaintext is rejected before any SQL.
  if (!isEncryptedPayload(payload)) {
    throw new Error(`[EncryptedRecordWriter] Encryption service returned a non-encrypted payload for ${tableName}; refusing to persist`);
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
 */
export async function decryptRawField<T = any>(
  tableName: string,
  record: Record<string, any>,
  rawColumnValue: unknown,
  environmentHost: string
): Promise<T> {
  return encryptionService.decryptEntityRecord<T>(
    tableName,
    record,
    rawColumnValue,
    environmentHost
  );
}
