/**
 * Crypto Audit Context
 * Story ID: VYR-038
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 *
 * Carries "who is decrypting and why" from the HTTP request (or background
 * job) down to the raw-record crypto boundary without threading parameters
 * through every repository method. Backed by AsyncLocalStorage, so each
 * request/job sees only its own identity.
 */

import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export interface CryptoAuditContext {
  actorType: 'USER' | 'SERVICE';
  userId?: string | null;
  userEmail?: string | null;
  serviceName?: string | null;
  /** One-way hash of the session id — the raw session id is never stored. */
  sessionRef?: string | null;
  ipAddress?: string | null;
  /** Why the data is being decrypted, e.g. "GET /api/reports/user-access" or "plaintext-migration:verify". */
  purpose: string;
}

const storage = new AsyncLocalStorage<CryptoAuditContext>();

const DEFAULT_SERVICE_CONTEXT: CryptoAuditContext = {
  actorType: 'SERVICE',
  serviceName: 'veyra-backend',
  purpose: 'unattributed-background-operation',
};

export function getCryptoAuditContext(): CryptoAuditContext {
  return storage.getStore() || DEFAULT_SERVICE_CONTEXT;
}

export function runWithCryptoAuditContext<T>(ctx: CryptoAuditContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Runs fn as a named background service (sync, migration, scheduler). */
export function runAsCryptoService<T>(serviceName: string, purpose: string, fn: () => T): T {
  return storage.run({ actorType: 'SERVICE', serviceName, purpose }, fn);
}

export function hashSessionRef(sessionId: unknown): string | null {
  if (sessionId === null || sessionId === undefined || sessionId === '') return null;
  return crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 16);
}

function clientIp(req: Request): string | null {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip ? ip.replace(/^::ffff:/, '').slice(0, 100) : null;
}

/**
 * Binds the authenticated principal to the async context of the rest of the
 * request. Call after the JWT/session has been verified.
 */
export function bindRequestCryptoContext(req: Request, res: Response, next: NextFunction): void {
  const path = (req.originalUrl || req.url || '').split('?')[0];
  const ctx: CryptoAuditContext = {
    actorType: 'USER',
    userId: res.locals.userId ? String(res.locals.userId) : null,
    userEmail: res.locals.email ? String(res.locals.email) : null,
    sessionRef: hashSessionRef(res.locals.sessionId),
    ipAddress: clientIp(req),
    purpose: `${req.method} ${path}`.slice(0, 255),
  };
  storage.run(ctx, () => next());
}
