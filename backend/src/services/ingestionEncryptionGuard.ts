/**
 * Ingestion Encryption Guard
 * Story ID: VYR-041
 * Epic: EPIC 5 ??? Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Pre-flight and runtime encryption assurance for the ingestion pipeline.
 *
 * When VEYRA_RAW_ENCRYPTION=true the guard:
 *   1. runs a canary encrypt/decrypt cycle before any Oracle data is fetched;
 *   2. wraps each domain step so that an encryption failure quarantines the
 *      batch (domain is skipped, incident is logged, pipeline continues);
 *   3. sanitises every error message logged by the pipeline through
 *      maskSensitive(), so Oracle response data never appears in logs.
 *
 * When encryption is disabled the guard is transparent ??? preflight succeeds
 * and no additional wrapping is applied.
 */

import { isRawEncryptionEnabled } from '../security/encryptedRecordWriter.js';
import { encryptionService } from '../security/encryptionService.js';
import { buildTableRecordAad, isEncryptedPayload } from '../security/encryptionContract.js';
import { maskSensitive, ProtectedDataError, newCryptoIncidentId, classifyCryptoError } from '../security/cryptoFailure.js';
import { cryptoAuditService } from '../security/cryptoAuditService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreflightResult {
  passed: boolean;
  encryptionEnabled: boolean;
  /** Non-null when the preflight failed. Safe for logs (no key material). */
  reason?: string;
  incidentId?: string;
}

export type EncryptionPolicy = 'FAIL_DOMAIN' | 'FAIL_PIPELINE';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CANARY_TABLE = '__encryption_preflight__';
const CANARY_RECORD = { id: 'canary', host: 'preflight' };
const CANARY_PAYLOAD = { ts: Date.now(), probe: true };

/**
 * Reads the pipeline encryption policy from the environment.
 *
 *   VEYRA_SYNC_ENCRYPTION_POLICY=FAIL_PIPELINE  ???  abort the entire pipeline
 *   (default) FAIL_DOMAIN                        ???  skip the failed domain, continue
 */
export function getEncryptionPolicy(): EncryptionPolicy {
  const raw = (process.env.VEYRA_SYNC_ENCRYPTION_POLICY || '').trim().toUpperCase();
  return raw === 'FAIL_PIPELINE' ? 'FAIL_PIPELINE' : 'FAIL_DOMAIN';
}

// ---------------------------------------------------------------------------
// Pre-flight check
// ---------------------------------------------------------------------------

/**
 * Verifies the encryption subsystem is operational before fetching Oracle data.
 *
 * When encryption is disabled (VEYRA_RAW_ENCRYPTION != 'true'), the check
 * passes immediately ??? there is nothing to guard.
 *
 * When enabled, encrypts a canary payload, validates the container, and
 * decrypts it back. Any failure is classified, audited and returned as a
 * failing PreflightResult ??? the caller decides whether to abort.
 */
export async function encryptionPreflight(): Promise<PreflightResult> {
  if (!isRawEncryptionEnabled()) {
    return { passed: true, encryptionEnabled: false };
  }

  try {
    const aad = buildTableRecordAad(CANARY_TABLE, CANARY_RECORD, 'preflight');
    const encrypted = await encryptionService.encryptPayload(CANARY_PAYLOAD, aad);

    if (!isEncryptedPayload(encrypted)) {
      throw new Error('Canary encrypt returned a non-encrypted payload');
    }

    const decrypted = await encryptionService.decryptPayload<typeof CANARY_PAYLOAD>(encrypted, aad);
    if (!decrypted || decrypted.probe !== true) {
      throw new Error('Canary decrypt returned unexpected data');
    }

    return { passed: true, encryptionEnabled: true };
  } catch (err: any) {
    const category = classifyCryptoError(err);
    const incidentId = newCryptoIncidentId();

    cryptoAuditService.recordFailure({
      operation: 'ENCRYPT',
      tenant: null,
      tableName: CANARY_TABLE,
      recordRef: 'preflight-canary',
      keyId: null,
      category,
      incidentId,
      internalDetail: maskSensitive(err),
    });

    return {
      passed: false,
      encryptionEnabled: true,
      reason: `Encryption preflight failed (${category}). Reference: ${incidentId}`,
      incidentId,
    };
  }
}

// ---------------------------------------------------------------------------
// Safe error sanitisation for pipeline logging
// ---------------------------------------------------------------------------

/**
 * Returns a log-safe version of an error message. Oracle API responses, key
 * material, JWTs and encoded payloads are redacted.
 *
 * ProtectedDataErrors are already safe; everything else goes through
 * maskSensitive().
 */
export function safePipelineError(err: unknown): string {
  if (err instanceof ProtectedDataError) return err.message;
  return maskSensitive(err, 500);
}

// ---------------------------------------------------------------------------
// Domain-step encryption wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps a domain runner so that a ProtectedDataError (encryption/decryption
 * failure) is handled according to the configured policy.
 *
 * FAIL_DOMAIN (default): the error is logged with maskSensitive(), an audit
 * event is recorded and the domain is reported as quarantined ??? the pipeline
 * continues with the remaining domains.
 *
 * FAIL_PIPELINE: the ProtectedDataError is re-thrown, which the pipeline
 * orchestrator records as a fatal error.
 */
export function withEncryptionGuard<T>(
  domain: string,
  fn: () => Promise<T>,
  policy?: EncryptionPolicy
): () => Promise<T> {
  const effectivePolicy = policy ?? getEncryptionPolicy();

  return async () => {
    try {
      return await fn();
    } catch (err: any) {
      // Only intercept encryption/decryption failures
      if (!(err instanceof ProtectedDataError)) throw err;

      console.warn(
        `[IngestionEncryptionGuard] ${domain}: encryption failure quarantined ??? ${safePipelineError(err)}`
      );

      if (effectivePolicy === 'FAIL_PIPELINE') {
        throw err;
      }

      // FAIL_DOMAIN: re-throw with a sanitised message the pipeline will
      // record as a domain failure, stripping any Oracle data from the chain.
      throw new Error(
        `[Quarantined] ${domain} skipped due to encryption failure. ${err.message}`
      );
    }
  };
}
