/**
 * Oracle Integration Resilience & Retry Service
 * Story ID: VYR-044
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both
 *
 * Implements:
 *   1. Bounded exponential backoff with randomized jitter for transient Oracle/network errors
 *   2. Rate-limit response handling (HTTP 429 & Retry-After headers)
 *   3. Non-transient / permanent error fast-fail (no infinite retries)
 *   4. Inter-page rate limit throttling to avoid triggering Oracle Cloud rate-limiters
 *   5. Deterministic record hashing for idempotent reprocessing without duplicate rows
 */

import crypto from 'crypto';

export interface RetryConfig {
  /** Maximum number of attempts including initial try (e.g. 3 = 1 try + 2 retries) */
  maxAttempts: number;
  /** Initial delay before first retry in milliseconds */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds */
  maxDelayMs: number;
  /** Exponential backoff multiplier */
  multiplier: number;
  /** Whether to randomize delay with jitter to prevent thundering herds */
  jitter: boolean;
  /** Default delay when HTTP 429 does not provide a Retry-After header */
  rateLimitDefaultDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  multiplier: 2,
  jitter: true,
  rateLimitDefaultDelayMs: 5000,
};

/**
 * Known transient network error codes from Node.js and Axios.
 */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'EHOSTUNREACH',
  'ECONNABORTED',
]);

/**
 * Determines whether an error is transient (retryable) or permanent (fail immediately).
 *
 * Transient:
 *   - HTTP 429 (Too Many Requests / Rate Limited)
 *   - HTTP 500, 502, 503, 504 (Server error / gateway glitch)
 *   - Socket / network blips (ECONNRESET, ETIMEDOUT, etc.)
 *   - Request timeouts
 *
 * Permanent:
 *   - HTTP 400 (Bad Request / Syntax error)
 *   - HTTP 401 (Authentication failure / invalid credentials)
 *   - HTTP 403 (Authorization failure / insufficient privileges)
 *   - HTTP 404 (Resource / endpoint not found)
 *   - Data schema & encryption failures
 */
export function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as any;

  // Check HTTP response status codes
  const status = err.response?.status || err.status || err.statusCode;
  if (typeof status === 'number') {
    if (status === 429) return true; // Rate limited
    if (status >= 500 && status <= 504) return true; // Transient server errors
    if (status >= 400 && status < 500) return false; // Permanent client errors (401, 403, 404, etc.)
  }

  // Check Node.js / Axios error codes
  if (err.code && TRANSIENT_NETWORK_CODES.has(String(err.code).toUpperCase())) {
    return true;
  }

  // Check error message heuristics
  const msg = (err.message || '').toLowerCase();
  if (
    msg.includes('timeout') ||
    msg.includes('socket hang up') ||
    msg.includes('connection reset') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  ) {
    return true;
  }

  return false;
}

/**
 * Extracts Retry-After delay in milliseconds from an HTTP error response, if present.
 * Supports both seconds integer (e.g. "15") and HTTP-date formats.
 */
export function getRetryAfterMs(error: unknown, defaultDelayMs = 5000): number | null {
  if (!error || typeof error !== 'object') return null;
  const err = error as any;
  const headers = err.response?.headers;
  if (!headers) return null;

  const retryAfter = headers['retry-after'] || headers['Retry-After'];
  if (!retryAfter) return null;

  // Case 1: Integer seconds (e.g. "30")
  const seconds = parseInt(String(retryAfter).trim(), 10);
  if (!isNaN(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 60000); // capped at 60s
  }

  // Case 2: HTTP date (e.g. "Wed, 21 Oct 2026 07:28:00 GMT")
  const dateMs = Date.parse(String(retryAfter));
  if (!isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return diff > 0 ? Math.min(diff, 60000) : defaultDelayMs;
  }

  return defaultDelayMs;
}

/**
 * Computes bounded exponential backoff delay with randomized jitter.
 * Formula: delay = min(maxDelay, baseDelay * multiplier^(attempt - 1))
 * Jitter: full jitter uniformly distributed in [0.5 * delay, delay]
 */
export function computeBackoffWithJitter(
  attempt: number,
  config: Partial<RetryConfig> = {}
): number {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  const expFactor = Math.pow(cfg.multiplier, Math.max(0, attempt - 1));
  const rawDelay = Math.min(cfg.maxDelayMs, cfg.baseDelayMs * expFactor);

  if (!cfg.jitter) {
    return Math.round(rawDelay);
  }

  // Decorrelated jitter: base delay + random jitter component [0.5 * delay, 1.0 * delay]
  const jitterFactor = 0.5 + Math.random() * 0.5;
  const jittered = Math.round(rawDelay * jitterFactor);
  return Math.min(cfg.maxDelayMs, Math.max(cfg.baseDelayMs, jittered));
}

/**
 * Executes an asynchronous operation with bounded exponential backoff and jitter.
 * Non-transient errors fail immediately without retry.
 */
export async function executeWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: Partial<RetryConfig> = {},
  contextName = 'Oracle Operation'
): Promise<{ result: T; attempts: number; totalDelayMs: number }> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...options };
  let totalDelayMs = 0;

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      const result = await operation(attempt);
      return { result, attempts: attempt, totalDelayMs };
    } catch (err: any) {
      const isTransient = isTransientError(err);

      // Acceptance Criteria 4: Permanent errors are not retried indefinitely
      if (!isTransient) {
        console.warn(
          `[Resilience] ${contextName} failed with non-transient error on attempt ${attempt}. Not retrying: ${err?.message || err}`
        );
        throw err;
      }

      // If attempts exhausted, fail bounded
      if (attempt >= cfg.maxAttempts) {
        console.error(
          `[Resilience] ${contextName} exhausted all ${cfg.maxAttempts} attempts. Last error: ${err?.message || err}`
        );
        throw err;
      }

      // Check for Retry-After header on 429
      const retryAfterMs = getRetryAfterMs(err, cfg.rateLimitDefaultDelayMs);
      const delayMs = retryAfterMs !== null
        ? retryAfterMs
        : computeBackoffWithJitter(attempt, cfg);

      totalDelayMs += delayMs;
      console.warn(
        `[Resilience] ${contextName} transient error on attempt ${attempt}/${cfg.maxAttempts} (status: ${err.response?.status || err.code || 'network'}). Retrying in ${delayMs}ms...`
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`${contextName} failed after ${cfg.maxAttempts} attempts.`);
}

/**
 * Throttle helper to respect Oracle rate-limits between high-volume pagination pages.
 */
export async function throttleBetweenPages(delayMs = 100): Promise<void> {
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

/**
 * Computes a stable, deterministic SHA-256 hash of a record for idempotent reprocessing.
 * Strips volatile timestamps to ensure identical logical records yield the same hash.
 */
export function computeRecordHash(domain: string, record: any): string {
  if (!record || typeof record !== 'object') {
    return crypto.createHash('sha256').update(`${domain}:${String(record)}`).digest('hex');
  }

  // Extract stable natural identity keys based on domain
  let keyString = '';
  switch (domain) {
    case 'usersRoles':
    case 'users':
      keyString = `user:${record.id || record.userName || record.username || record.email || ''}`;
      break;
    case 'roles':
      keyString = `role:${record.id || record.roleId || record.roleCode || record.roleName || ''}`;
      break;
    case 'controls':
      keyString = `control:${record.controlId || record.control_id || record.id || record.name || ''}`;
      break;
    case 'roleHierarchy':
      keyString = `hierarchy:${record.parentRoleId || record.role_code || ''}:${record.childRoleId || record.privilege_code || ''}`;
      break;
    case 'audit':
      keyString = `audit:${record.timestamp || record.eventTimestamp || ''}:${record.user || record.userName || ''}:${record.businessObject || record.businessObjectType || ''}:${record.action || record.eventType || ''}`;
      break;
    default:
      keyString = `${domain}:${record.id || record.key || JSON.stringify(record)}`;
  }

  return crypto.createHash('sha256').update(keyString).digest('hex');
}

/**
 * Filters a batch of records, eliminating in-batch duplicates based on deterministic hash.
 * Guarantees that batch processing is idempotent and will not duplicate records.
 */
export function deduplicateBatch<T>(
  domain: string,
  records: T[]
): { uniqueRecords: T[]; duplicatesCount: number; hashes: string[] } {
  if (!Array.isArray(records)) {
    return { uniqueRecords: [], duplicatesCount: 0, hashes: [] };
  }

  const seen = new Set<string>();
  const uniqueRecords: T[] = [];
  const hashes: string[] = [];
  let duplicatesCount = 0;

  for (const record of records) {
    const hash = computeRecordHash(domain, record);
    if (seen.has(hash)) {
      duplicatesCount++;
    } else {
      seen.add(hash);
      uniqueRecords.push(record);
      hashes.push(hash);
    }
  }

  return { uniqueRecords, duplicatesCount, hashes };
}
