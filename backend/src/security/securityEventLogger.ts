/**
 * Security Event Logger — standardized recorder for VYR-053.
 *
 * Wraps AuditService with the fields the story requires on every security
 * event: actor/service identity, tenant, result and a correlation ID.
 * The correlation ID falls back to the active crypto-audit context's hashed
 * session ref (VYR-038), so related events in one request share a link.
 *
 * Recording must never break the business flow: failures are logged and
 * surfaced as { success: false } instead of throwing.
 */

import { randomUUID } from 'crypto';
import { auditService, VeyraAuditEventType } from '../services/auditService.js';
import { getCryptoAuditContext } from './cryptoAuditContext.js';

export interface SecurityEventInput {
  eventType: VeyraAuditEventType;
  userId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  result?: 'SUCCESS' | 'FAILURE' | 'DENIED';
  tenant?: string | null;
  correlationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, any> | null;
}

export interface SecurityEventResult {
  success: boolean;
  eventId?: string;
  correlationId?: string;
  error?: string;
}

export class SecurityEventLogger {
  public async record(input: SecurityEventInput): Promise<SecurityEventResult> {
    const ctx = getCryptoAuditContext();

    // Service identity: background services act under their service name;
    // interactive requests are attributed to the identified user.
    const serviceIdentity =
      ctx.actorType === 'SERVICE'
        ? (ctx.serviceName || 'veyra-backend')
        : `USER:${ctx.userEmail || ctx.userId || input.userId || 'unknown'}`;

    const correlationId = input.correlationId || ctx.sessionRef || randomUUID();

    try {
      const result = await auditService.recordAuditEvent({
        userId: input.userId ?? ctx.userId ?? null,
        eventType: input.eventType,
        ipAddress: input.ipAddress ?? ctx.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        details: input.details ?? null,
        correlationId,
        serviceIdentity,
        tenant: input.tenant ?? null,
        result: input.result ?? 'SUCCESS'
      });
      return { success: true, eventId: result.eventId, correlationId: correlationId };
    } catch (err: any) {
      // Audit failures must not crash the request, but must be visible.
      console.error('[SecurityEventLogger] failed to record', input.eventType,
        err?.message || err);
      return { success: false, error: 'AUDIT_WRITE_FAILED' };
    }
  }
}

export const securityEventLogger = new SecurityEventLogger();
