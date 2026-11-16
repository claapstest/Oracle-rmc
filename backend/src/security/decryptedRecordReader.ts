/**
 * Raw-Record Decryption Read Helper
 * Story ID: VYR-035
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 *
 * Read-side counterpart to encryptedRecordWriter.ts. Every service that
 * returns a raw JSONB payload to the dashboard, report or investigation
 * layer routes the DB rows through decryptRawRows() before returning.
 *
 * Dual-mode: legacy plaintext rows pass through unchanged; encrypted
 * payloads are decrypted with AAD verification. This supports the
 * migration window where plaintext and encrypted rows coexist.
 *
 * Security invariants:
 *   - Encryption keys/DEKs are never exposed in returned objects.
 *   - Tampered ciphertext fails closed (throws, no silent fallback).
 *   - Decrypted plaintext is never logged.
 *   - Every decrypt is audited and failures surface only as ProtectedDataError (VYR-038).
 */

import { isEncryptedPayload } from './encryptionContract.js';
import { decryptRawField } from './encryptedRecordWriter.js';

/**
 * AAD tenant for a stored row. Queries may return rows from a fallback
 * environment host, so the row's own environment_host is authoritative.
 * A payload copied into another tenant's row still fails AAD verification,
 * because that row's host differs from the one bound at encryption time.
 */
function rowTenant(row: Record<string, any>, requestedHost: string): string {
  const own = row?.environment_host;
  return typeof own === 'string' && own.trim() ? own : requestedHost;
}

/**
 * Decrypts the named raw column in every row of a DB result set, in place.
 * Returns the same row objects with the raw column replaced by its plaintext.
 *
 * @param tableName   - The raw table name (used for AAD binding).
 * @param rawColumn   - Column name holding the raw JSONB / encrypted payload (e.g. 'raw_user', 'raw_payload').
 * @param rows        - Array of DB row objects (from pg query result).
 * @param environmentHost - Tenant host for AAD binding.
 * @returns The same rows array with raw columns decrypted in place.
 */
export async function decryptRawRows<R extends Record<string, any>>(
  tableName: string,
  rawColumn: string,
  rows: R[],
  environmentHost: string
): Promise<R[]> {
  if (!rows || rows.length === 0) return rows;

  const results: R[] = [];
  for (const row of rows) {
    const rawValue = row[rawColumn];
    if (rawValue === null || rawValue === undefined) {
      results.push(row);
      continue;
    }

    // Legacy plaintext passes through, unless the row claims to be encrypted:
    // decryptRawField then fails closed as CORRUPTED_PAYLOAD (VYR-038).
    if (!isEncryptedPayload(rawValue) && row.is_encrypted !== true) {
      results.push(row);
      continue;
    }

    const decrypted = await decryptRawField(tableName, row, rawValue, rowTenant(row, environmentHost));
    results.push({ ...row, [rawColumn]: decrypted });
  }

  return results;
}

/**
 * Decrypts a single row's raw column value. Used by service methods that
 * return a single record (e.g. getRawUser, getRawControlById).
 *
 * @param tableName   - The raw table name (used for AAD binding).
 * @param rawColumn   - Column name holding the raw JSONB / encrypted payload.
 * @param row         - Single DB row object.
 * @param environmentHost - Tenant host for AAD binding.
 * @returns The decrypted value of the raw column.
 */
export async function decryptSingleRawField<T = any>(
  tableName: string,
  rawColumn: string,
  row: Record<string, any>,
  environmentHost: string
): Promise<T> {
  const rawValue = row[rawColumn];
  if (rawValue === null || rawValue === undefined) return rawValue as T;
  return decryptRawField<T>(tableName, row, rawValue, rowTenant(row, environmentHost));
}
