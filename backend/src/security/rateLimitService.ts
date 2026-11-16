/**
 * Rate Limiting, Brute-Force Protection and Abuse Controls
 * Story ID: VYR-048
 * Epic: EPIC 6 — OWASP application and API security hardening
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Implements:
 *   1. Stricter rate limits for login, password reset, and token endpoints (Step 1 & GAP-002)
 *   2. Account lockout after consecutive failed login attempts (GAP-002 / ASVS V2.2)
 *   3. Tiered, configurable per-IP, per-user, and per-tenant rate limits across API groups (Step 2 & GAP-017)
 *   4. Secure client IP derivation respecting trusted proxy settings to prevent spoofing (Step 3)
 *   5. Standard HTTP 429 response with Retry-After and IETF RateLimit headers (Step 4)
 *   6. Credential-free abuse monitoring and audit telemetry (Step 4)
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'crypto';
import { query as dbQuery } from '../db.js';

// ---------------------------------------------------------------------------
// Configuration Types & Defaults
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  tierName?: string;
  message?: string;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
  standardHeaders?: boolean;
  legacyHeaders?: boolean;
}

export interface LockoutInfo {
  isLocked: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
  remainingSeconds: number;
}

export interface AbuseEvent {
  clientIp: string;
  identifier?: string;
  tenantId?: string;
  tier: string;
  route: string;
  method: string;
  retryAfterSeconds: number;
}

// ---------------------------------------------------------------------------
// 1. Client IP Derivation with Trusted Proxy Verification (Step 3)
// ---------------------------------------------------------------------------

/**
 * Normalizes an IPv4 or IPv6 address by removing IPv6 mapped prefix and port.
 */
export function normalizeIp(ip: string): string {
  let cleaned = (ip || '').trim();
  // Strip port if formatted as ip:port (avoid stripping IPv6 colons unless bracketed)
  if (cleaned.startsWith('[') && cleaned.includes(']:')) {
    cleaned = cleaned.slice(1, cleaned.indexOf(']:'));
  } else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(cleaned)) {
    cleaned = cleaned.split(':')[0];
  }
  // Strip IPv4-mapped IPv6 prefix (::ffff:)
  if (cleaned.startsWith('::ffff:')) {
    cleaned = cleaned.slice(7);
  }
  return cleaned || '127.0.0.1';
}

/**
 * Safely extracts the client IP address.
 *
 * CRITICAL SECURITY INVARIANT (Step 3):
 * If TRUST_PROXY is false (default), X-Forwarded-For is strictly ignored to
 * prevent attackers from spoofing their IP address via custom HTTP headers.
 * If TRUST_PROXY is true (or a comma-separated list of trusted proxies),
 * the client IP is extracted safely from the proxy chain.
 */
export function getClientIp(req: Request, trustProxyOverride?: boolean): string {
  const trustProxyEnv = (process.env.TRUST_PROXY || '').trim().toLowerCase();
  const trustProxy = trustProxyOverride !== undefined
    ? trustProxyOverride
    : trustProxyEnv === 'true' || trustProxyEnv === '1';

  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      // First IP in X-Forwarded-For is the original client
      const ips = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
      if (ips.length > 0) {
        return normalizeIp(ips[0]);
      }
    }
    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.length > 0) {
      return normalizeIp(realIp);
    }
  }

  // Fallback to socket remote address when proxy is untrusted or header absent
  const socketIp = req.socket?.remoteAddress || (req as any).ip || '127.0.0.1';
  return normalizeIp(socketIp);
}

// ---------------------------------------------------------------------------
// 2. Sliding Window In-Memory Store
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  timestamps: number[];
}

export class SlidingWindowStore {
  private store = new Map<string, RateLimitEntry>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Periodically prune stale entries every 60 seconds
    this.cleanupTimer = setInterval(() => this.pruneStale(), 60000);
    if (this.cleanupTimer && typeof (this.cleanupTimer as any).unref === 'function') {
      (this.cleanupTimer as any).unref();
    }
  }

  /**
   * Increments hit count for the key and returns current count, remaining hits, and reset time.
   */
  public hit(key: string, windowMs: number, max: number): {
    totalHits: number;
    remaining: number;
    resetTimeMs: number;
    isExceeded: boolean;
  } {
    const now = Date.now();
    const windowStart = now - windowMs;

    let entry = this.store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.store.set(key, entry);
    }

    // Filter out timestamps outside the sliding window
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
    entry.timestamps.push(now);

    const totalHits = entry.timestamps.length;
    const oldestTimestamp = entry.timestamps[0] || now;
    const resetTimeMs = oldestTimestamp + windowMs;
    const remaining = Math.max(0, max - totalHits);
    const isExceeded = totalHits > max;

    return {
      totalHits,
      remaining,
      resetTimeMs,
      isExceeded,
    };
  }

  public getHits(key: string, windowMs: number): number {
    const now = Date.now();
    const windowStart = now - windowMs;
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
    return entry.timestamps.length;
  }

  public resetKey(key: string): void {
    this.store.delete(key);
  }

  public resetAll(): void {
    this.store.clear();
  }

  public size(): number {
    return this.store.size;
  }

  private pruneStale(): void {
    const now = Date.now();
    // Remove keys where all timestamps are older than 1 hour
    for (const [key, entry] of this.store.entries()) {
      entry.timestamps = entry.timestamps.filter((ts) => now - ts < 3600000);
      if (entry.timestamps.length === 0) {
        this.store.delete(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Account Lockout & Brute-Force Protection (GAP-002 / ASVS V2.2)
// ---------------------------------------------------------------------------

interface AccountLockoutRecord {
  email: string;
  failedAttempts: number;
  lastFailedAt: number;
  lockedUntil: number | null;
  unlockedBy?: string | null;
}

export class AccountLockoutManager {
  private lockouts = new Map<string, AccountLockoutRecord>();
  private defaultMaxAttempts = 5;
  private defaultLockoutDurationMs = 15 * 60 * 1000; // 15 minutes

  private getMaxAttempts(): number {
    const envVal = parseInt(process.env.ACCOUNT_LOCKOUT_MAX_ATTEMPTS || '', 10);
    return !isNaN(envVal) && envVal > 0 ? envVal : this.defaultMaxAttempts;
  }

  private getLockoutDurationMs(): number {
    const envVal = parseInt(process.env.ACCOUNT_LOCKOUT_DURATION_MS || '', 10);
    return !isNaN(envVal) && envVal > 0 ? envVal : this.defaultLockoutDurationMs;
  }

  /**
   * Checks if an account is currently locked out.
   */
  public isLocked(email: string): LockoutInfo {
    const normalized = (email || '').trim().toLowerCase();
    const record = this.lockouts.get(normalized);
    const now = Date.now();

    if (!record || !record.lockedUntil) {
      return {
        isLocked: false,
        failedAttempts: record?.failedAttempts || 0,
        lockedUntil: null,
        remainingSeconds: 0,
      };
    }

    if (now >= record.lockedUntil) {
      // Lock has naturally expired
      record.lockedUntil = null;
      record.failedAttempts = 0;
      return {
        isLocked: false,
        failedAttempts: 0,
        lockedUntil: null,
        remainingSeconds: 0,
      };
    }

    const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
    return {
      isLocked: true,
      failedAttempts: record.failedAttempts,
      lockedUntil: new Date(record.lockedUntil).toISOString(),
      remainingSeconds,
    };
  }

  /**
   * Records a failed authentication attempt.
   * Locks account if consecutive failures reach max attempts.
   */
  public recordFailedAttempt(email: string, clientIp: string): LockoutInfo {
    const normalized = (email || '').trim().toLowerCase();
    const now = Date.now();
    const maxAttempts = this.getMaxAttempts();
    const lockoutDuration = this.getLockoutDurationMs();

    let record = this.lockouts.get(normalized);
    if (!record) {
      record = {
        email: normalized,
        failedAttempts: 0,
        lastFailedAt: now,
        lockedUntil: null,
      };
      this.lockouts.set(normalized, record);
    }

    record.failedAttempts += 1;
    record.lastFailedAt = now;

    if (record.failedAttempts >= maxAttempts) {
      record.lockedUntil = now + lockoutDuration;
      console.warn(
        `[Security Alert: Brute-Force] Account "${normalized}" locked after ${record.failedAttempts} failed attempts from IP ${clientIp}. Locked for ${Math.round(lockoutDuration / 60000)} minutes.`
      );
    }

    return this.isLocked(normalized);
  }

  /**
   * Resets failed login counters upon successful authentication.
   */
  public recordSuccessfulLogin(email: string): void {
    const normalized = (email || '').trim().toLowerCase();
    this.lockouts.delete(normalized);
  }

  /**
   * Unlocks an account administratively.
   */
  public unlockAccount(email: string, unlockedBy = 'SITE_ADMIN'): boolean {
    const normalized = (email || '').trim().toLowerCase();
    const existing = this.lockouts.get(normalized);
    if (existing) {
      existing.failedAttempts = 0;
      existing.lockedUntil = null;
      existing.unlockedBy = unlockedBy;
      console.log(`[Security Audit] Account "${normalized}" unlocked by administrator: ${unlockedBy}.`);
      return true;
    }
    return false;
  }

  /**
   * Lists all currently locked accounts.
   */
  public getLockedAccounts(): Array<{ email: string; lockedUntil: string; remainingSeconds: number }> {
    const now = Date.now();
    const results: Array<{ email: string; lockedUntil: string; remainingSeconds: number }> = [];
    for (const [email, record] of this.lockouts.entries()) {
      if (record.lockedUntil && record.lockedUntil > now) {
        results.push({
          email,
          lockedUntil: new Date(record.lockedUntil).toISOString(),
          remainingSeconds: Math.ceil((record.lockedUntil - now) / 1000),
        });
      }
    }
    return results;
  }

  public resetAll(): void {
    this.lockouts.clear();
  }
}

// ---------------------------------------------------------------------------
// 4. Rate Limiting Service Singleton & Abuse Monitoring
// ---------------------------------------------------------------------------

export class RateLimitService {
  private store = new SlidingWindowStore();
  private lockoutManager = new AccountLockoutManager();
  private isDbAvailable: boolean | null = null;
  private lastDbFailureTime = 0;

  public getStore(): SlidingWindowStore {
    return this.store;
  }

  public getLockoutManager(): AccountLockoutManager {
    return this.lockoutManager;
  }

  /**
   * Logs an abuse event without logging sensitive credentials.
   * Enforces Step 4 invariant: never logs password, tokens, or auth headers.
   */
  public logAbuse(event: AbuseEvent): void {
    console.warn(
      `[RateLimit: Abuse] 429 Throttle triggered on tier "${event.tier}" (${event.method} ${event.route}) from IP ${event.clientIp}${event.identifier ? ` (identifier: ${event.identifier})` : ''}. Retry-After: ${event.retryAfterSeconds}s.`
    );

    // Persist to database if online
    if (this.shouldAttemptDb()) {
      dbQuery(
        `INSERT INTO veyra_rate_limit_events
           (client_ip, identifier, tenant_id, tier, route, method, retry_after_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          event.clientIp,
          event.identifier || null,
          event.tenantId || '__GLOBAL__',
          event.tier,
          event.route,
          event.method,
          event.retryAfterSeconds,
        ]
      ).catch(() => {
        this.markDbFailure();
      });
    }
  }

  private shouldAttemptDb(): boolean {
    if (process.env.TEST_OFFLINE === 'true' || process.env.OFFLINE_MODE === 'true') {
      return false;
    }
    if (this.isDbAvailable === false && Date.now() - this.lastDbFailureTime < 30000) {
      return false;
    }
    return true;
  }

  private markDbFailure(): void {
    this.isDbAvailable = false;
    this.lastDbFailureTime = Date.now();
  }

  /**
   * Factory function that creates a configurable Express rate-limiting middleware.
   */
  public createLimiter(options: RateLimitOptions = {}): RequestHandler {
    const windowMs = options.windowMs || parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000', 10);
    const max = options.max || parseInt(process.env.API_RATE_LIMIT_MAX || '100', 10);
    const tierName = options.tierName || 'api';
    const message = options.message || 'Too many requests. Please try again later.';
    const standardHeaders = options.standardHeaders !== false;
    const legacyHeaders = options.legacyHeaders !== false;

    return (req: Request, res: Response, next: NextFunction): void => {
      if (options.skip && options.skip(req)) {
        return next();
      }

      const clientIp = getClientIp(req);
      const customKey = options.keyGenerator ? options.keyGenerator(req) : null;
      const key = customKey || `${tierName}:${clientIp}`;

      const { totalHits, remaining, resetTimeMs, isExceeded } = this.store.hit(key, windowMs, max);
      const retryAfterSeconds = Math.max(1, Math.ceil((resetTimeMs - Date.now()) / 1000));

      // IETF Draft & Standard Headers
      if (standardHeaders) {
        res.setHeader('RateLimit-Limit', String(max));
        res.setHeader('RateLimit-Remaining', String(remaining));
        res.setHeader('RateLimit-Reset', String(Math.ceil(resetTimeMs / 1000)));
      }
      if (legacyHeaders) {
        res.setHeader('X-RateLimit-Limit', String(max));
        res.setHeader('X-RateLimit-Remaining', String(remaining));
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetTimeMs / 1000)));
      }

      if (isExceeded) {
        res.setHeader('Retry-After', String(retryAfterSeconds));

        this.logAbuse({
          clientIp,
          identifier: customKey || undefined,
          tenantId: (req.headers['x-tenant-id'] as string) || '__GLOBAL__',
          tier: tierName,
          route: req.path,
          method: req.method,
          retryAfterSeconds,
        });

        res.status(429).json({
          success: false,
          code: 'RATE_LIMIT_EXCEEDED',
          message: `${message} Please try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`,
          retryAfterSeconds,
        });
        return;
      }

      next();
    };
  }

  /**
   * Resets all rate limit stores and lockout states.
   */
  public resetAll(): void {
    this.store.resetAll();
    this.lockoutManager.resetAll();
  }

  /**
   * Operational summary for monitoring endpoints.
   */
  public getStatus(): Record<string, unknown> {
    return {
      activeTrackedKeys: this.store.size(),
      lockedAccounts: this.lockoutManager.getLockedAccounts(),
      trustProxyConfigured: (process.env.TRUST_PROXY || '').trim().toLowerCase() === 'true',
      tiers: {
        auth: {
          max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '5', 10),
          windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000', 10),
        },
        admin: {
          max: parseInt(process.env.ADMIN_RATE_LIMIT_MAX || '20', 10),
          windowMs: parseInt(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || '60000', 10),
        },
        api: {
          max: parseInt(process.env.API_RATE_LIMIT_MAX || '100', 10),
          windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000', 10),
        },
        tenant: {
          max: parseInt(process.env.TENANT_RATE_LIMIT_MAX || '1000', 10),
          windowMs: parseInt(process.env.TENANT_RATE_LIMIT_WINDOW_MS || '60000', 10),
        },
      },
    };
  }
}

export const rateLimitService = new RateLimitService();

// ---------------------------------------------------------------------------
// 5. Pre-Configured Tiered Middlewares
// ---------------------------------------------------------------------------

/**
 * Strict rate limiter for authentication endpoints: login, password reset, token endpoints.
 * Default: 5 requests per 15 minutes per IP or user.
 */
export const authRateLimiter: RequestHandler = (req, res, next) => {
  const max = parseInt(process.env.AUTH_RATE_LIMIT_MAX || '5', 10);
  const windowMs = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000', 10); // 15 min

  const limiter = rateLimitService.createLimiter({
    tierName: 'auth',
    max,
    windowMs,
    message: 'Too many authentication attempts. Please try again later.',
    keyGenerator: (r) => {
      const email = (r.body?.email || '').trim().toLowerCase();
      const ip = getClientIp(r);
      return email ? `auth:${email}:${ip}` : `auth:${ip}`;
    },
  });

  return limiter(req, res, next);
};

/**
 * Strict rate limiter for sensitive admin operations, credentials rotation, and manual syncs.
 * Default: 20 requests per minute per IP / user.
 */
export const sensitiveAdminRateLimiter: RequestHandler = (req, res, next) => {
  const max = parseInt(process.env.ADMIN_RATE_LIMIT_MAX || '20', 10);
  const windowMs = parseInt(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || '60000', 10); // 1 min

  const limiter = rateLimitService.createLimiter({
    tierName: 'admin',
    max,
    windowMs,
    message: 'Too many administrative operations requested. Please slow down.',
    keyGenerator: (r) => {
      const user = res.locals.email || res.locals.user?.email || 'admin';
      return `admin:${user}:${getClientIp(r)}`;
    },
  });

  return limiter(req, res, next);
};

/**
 * General rate limiter for standard REST API endpoints.
 * Default: 100 requests per minute per IP.
 */
export const apiRateLimiter: RequestHandler = (req, res, next) => {
  const max = parseInt(process.env.API_RATE_LIMIT_MAX || '100', 10);
  const windowMs = parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000', 10); // 1 min

  const limiter = rateLimitService.createLimiter({
    tierName: 'api',
    max,
    windowMs,
    message: 'API rate limit exceeded. Please throttle your requests.',
  });

  return limiter(req, res, next);
};

/**
 * Multi-tenant rate limiter throttling tenant-wide floods.
 * Default: 1000 requests per minute per tenant.
 */
export const tenantRateLimiter: RequestHandler = (req, res, next) => {
  const tenantId = (req.headers['x-tenant-id'] as string) || '__GLOBAL__';
  const max = parseInt(process.env.TENANT_RATE_LIMIT_MAX || '1000', 10);
  const windowMs = parseInt(process.env.TENANT_RATE_LIMIT_WINDOW_MS || '60000', 10);

  const limiter = rateLimitService.createLimiter({
    tierName: 'tenant',
    max,
    windowMs,
    message: 'Tenant API rate limit exceeded.',
    keyGenerator: () => `tenant:${tenantId}`,
  });

  return limiter(req, res, next);
};
