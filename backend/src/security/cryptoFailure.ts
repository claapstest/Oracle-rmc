/**
 * Cryptographic Failure Classification and Safe Error Surface
 * Story ID: VYR-038
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Every encryption/decryption failure at the raw-record boundary is:
 *   1. classified into a small, stable set of categories operators can act on;
 *   2. re-thrown as a ProtectedDataError whose message carries no key ids,
 *      AAD bindings, ciphertext or library detail — only an incident reference;
 *   3. logged internally through maskSensitive(), never with payload or key material.
 *
 * Route handlers across the API echo err.message to the client, so the safe
 * message is enforced here, at the boundary, rather than in each route.
 */

import crypto from 'crypto';
import { EncryptionError } from './encryptionService.js';

export type CryptoFailureCategory =
  | 'KMS_UNAVAILABLE'      // key service unreachable / throttled / timing out
  | 'INVALID_KEY'          // key missing, not approved, or cannot open the record's data key
  | 'AUTH_TAG_MISMATCH'    // ciphertext, tag or AAD binding tampered or misrouted
  | 'UNSUPPORTED_VERSION'  // container format version or algorithm this build cannot read
  | 'CORRUPTED_PAYLOAD'    // container malformed, truncated, unparsable or flag/value mismatch
  | 'ENCRYPTION_FAILURE'   // encrypt path failed; nothing was persisted
  | 'UNKNOWN';

export const CRYPTO_FAILURE_CATEGORIES: readonly CryptoFailureCategory[] = [
  'KMS_UNAVAILABLE',
  'INVALID_KEY',
  'AUTH_TAG_MISMATCH',
  'UNSUPPORTED_VERSION',
  'CORRUPTED_PAYLOAD',
  'ENCRYPTION_FAILURE',
  'UNKNOWN',
];

const KMS_NETWORK_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
]);

const KMS_SERVICE_ERROR_NAMES = new Set([
  'ThrottlingException', 'KMSInternalException', 'DependencyTimeoutException', 'ServiceUnavailableException',
  'KMSInvalidStateException', 'TimeoutError', 'RequestTimeout', 'ServiceUnavailable', 'AbortError',
]);

/**
 * Maps any error raised by the encryption stack (EncryptionError, KMS SDK,
 * contract validation, JSON parsing) to a stable category.
 */
export function classifyCryptoError(err: unknown): CryptoFailureCategory {
  if (err instanceof ProtectedDataError) return err.category;

  const e = err as any;
  const message = String(e?.message || '');

  if (err instanceof EncryptionError) {
    switch (err.code) {
      case 'KMS_UNAVAILABLE':
        return 'KMS_UNAVAILABLE';
      case 'KEY_NOT_FOUND':
      case 'INVALID_KEY':
      case 'KEY_NOT_APPROVED':
        return 'INVALID_KEY';
      case 'AAD_MISMATCH':
        return 'AUTH_TAG_MISMATCH';
      case 'UNSUPPORTED_FORMAT_VERSION':
      case 'UNSUPPORTED_ALGORITHM':
        return 'UNSUPPORTED_VERSION';
      case 'INVALID_CONTAINER':
      case 'INVALID_INPUT':
        return 'CORRUPTED_PAYLOAD';
      case 'ENCRYPTION_FAILED':
        return 'ENCRYPTION_FAILURE';
      case 'DECRYPTION_FAILED':
        // The data key could not be unwrapped by the KEK: wrong / rotated-away key material.
        if (/unwrap/i.test(message)) return 'INVALID_KEY';
        if (/length/i.test(message)) return 'CORRUPTED_PAYLOAD';
        return 'AUTH_TAG_MISMATCH';
      default:
        return 'UNKNOWN';
    }
  }

  // Cloud KMS / network failures
  const status = Number(e?.statusCode ?? e?.$metadata?.httpStatusCode ?? e?.status);
  if (
    KMS_NETWORK_CODES.has(String(e?.code || '')) ||
    KMS_SERVICE_ERROR_NAMES.has(String(e?.name || '')) ||
    status === 429 || (status >= 500 && status <= 599)
  ) {
    return 'KMS_UNAVAILABLE';
  }

  // Contract validation / parsing of a stored container
  if (err instanceof SyntaxError) return 'CORRUPTED_PAYLOAD';
  if (/^(Invalid |EncryptedPayload |Missing natural identifier|Cannot extract record natural ID)/.test(message)) {
    return 'CORRUPTED_PAYLOAD';
  }

  return 'UNKNOWN';
}

/** HTTP status a route should use for this category. */
export function httpStatusForCategory(category: CryptoFailureCategory): number {
  return category === 'KMS_UNAVAILABLE' ? 503 : 500;
}

/** Short, non-guessable reference that ties a client-visible error to its audit row. */
export function newCryptoIncidentId(): string {
  return `CRY-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * The only error type that leaves the raw-record crypto boundary.
 * Its message is safe to show to an end user and to echo in an API response.
 */
export class ProtectedDataError extends Error {
  public readonly code = 'PROTECTED_DATA_UNAVAILABLE';
  public readonly isOperational = true;
  public readonly status: number;

  constructor(
    public readonly category: CryptoFailureCategory,
    public readonly incidentId: string,
    public readonly operation: 'DECRYPT' | 'ENCRYPT'
  ) {
    super(
      category === 'KMS_UNAVAILABLE'
        ? `Protected data is temporarily unavailable. Reference: ${incidentId}`
        : operation === 'ENCRYPT'
          ? `Protected data could not be stored securely. Reference: ${incidentId}`
          : `Protected data could not be accessed. Reference: ${incidentId}`
    );
    this.name = 'ProtectedDataError';
    this.status = httpStatusForCategory(category);
    Object.setPrototypeOf(this, ProtectedDataError.prototype);
  }

  /** Never serialize internal detail, even through JSON.stringify(err). */
  public toJSON() {
    return { code: this.code, message: this.message, reference: this.incidentId };
  }
}

const SENSITIVE_ASSIGNMENT = /\b(password|new_?password|current_?password|reset_?code|passwd|pwd|secret|client_?secret|token|access_?token|refresh_?token|api_?key|private_?key|master_?key|encryption_?key|dek|kek|authorization|cookie)\b(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&|}]+)/gi;

/**
 * Masks credentials, tokens, key material and encoded payloads from text
 * before it is written to any log line.
 */
export function maskSensitive(input: unknown, maxLength = 500): string {
  let text = typeof input === 'string' ? input : String((input as any)?.message ?? input ?? '');
  text = text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '[REDACTED_PEM]')
    // AAD bindings (tenant|table|record id) are already logged as structured fields.
    .replace(/tenant=[^"\s]*\|table=[^"\s]*\|id=[^"\s]*\|v=[^"\s|]*/g, '[AAD]')
    .replace(SENSITIVE_ASSIGNMENT, (_m, key, sep) => `${key}${sep}[REDACTED]`)
    .replace(/\b[0-9a-f]{40,}\b/gi, '[REDACTED_HEX]')
    .replace(/[A-Za-z0-9+/]{24,}={0,2}/g, '[REDACTED_B64]');
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
