import { query as dbQuery } from '../db.js';

export type VeyraAuditEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGIN_REJECTED_ACTIVE_SESSION'
  | 'LOGOUT'
  | 'SESSION_EXPIRED'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DELETED'
  | 'ROLE_ASSIGNED'
  | 'ROLE_REMOVED'
  | 'PRIVILEGE_CHANGED';

export const ALLOWED_AUDIT_EVENT_TYPES: readonly VeyraAuditEventType[] = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGIN_REJECTED_ACTIVE_SESSION',
  'LOGOUT',
  'SESSION_EXPIRED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DELETED',
  'ROLE_ASSIGNED',
  'ROLE_REMOVED',
  'PRIVILEGE_CHANGED'
] as const;

export interface AuditEventInput {
  userId?: string | null;
  eventType: VeyraAuditEventType;
  ipAddress?: string | null;
  userAgent?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, any> | null;
}

export interface AuditEventRecord {
  eventId: string;
  userId: string | null;
  eventType: VeyraAuditEventType;
  eventTime: string | Date;
  ipAddress: string | null;
  userAgent: string | null;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, any> | null;
}

// Sensitive key patterns that must NEVER be persisted in audit records
const FORBIDDEN_KEY_PATTERNS: RegExp[] = [
  /^password$/i,
  /^passwordhash$/i,
  /^currentpassword$/i,
  /^newpassword$/i,
  /^confirmpassword$/i,
  /^oldpassword$/i,
  /^rawpassword$/i,
  /^token$/i,
  /^accesstoken$/i,
  /^refreshtoken$/i,
  /^sessiontoken$/i,
  /^authorization$/i,
  /^auth_header$/i,
  /^cookie$/i,
  /^cookies$/i,
  /^secret$/i,
  /^clientsecret$/i,
  /^sessionsecret$/i,
  /^apikey$/i,
  /^api_key$/i,
  /^privatekey$/i,
  /^private_key$/i,
  /^jwt$/i,
  /^bearer$/i,
  /password/i,
  /secret/i,
  /token/i,
  /apikey/i,
  /clientsecret/i
];

function isForbiddenKey(key: string): boolean {
  const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
  return FORBIDDEN_KEY_PATTERNS.some(
    pattern => pattern.test(key) || pattern.test(normalizedKey)
  );
}

/**
 * Defense-in-depth sanitization for audit details JSON.
 * Recursively strips/rejects any sensitive authentication keys or material.
 */
export function sanitizeAuditDetails(details: any, depth = 0): any {
  if (details === null || details === undefined) {
    return null;
  }
  if (depth > 10) {
    return undefined; // guard against circular structures
  }

  // Primitive strings: sanitize if they resemble bearer tokens or raw JWTs
  if (typeof details === 'string') {
    if (/^bearer\s+/i.test(details)) {
      return '[REDACTED_BEARER_TOKEN]';
    }
    if (/^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(details)) {
      return '[REDACTED_JWT]';
    }
    return details;
  }

  if (typeof details === 'number' || typeof details === 'boolean') {
    return details;
  }

  if (Array.isArray(details)) {
    return details
      .map(item => sanitizeAuditDetails(item, depth + 1))
      .filter(item => item !== undefined);
  }

  if (typeof details === 'object') {
    const sanitizedObj: Record<string, any> = {};
    for (const [k, v] of Object.entries(details)) {
      // Reject any forbidden sensitive key
      if (isForbiddenKey(k)) {
        continue;
      }
      const cleanedVal = sanitizeAuditDetails(v, depth + 1);
      if (cleanedVal !== undefined) {
        sanitizedObj[k] = cleanedVal;
      }
    }
    return sanitizedObj;
  }

  return undefined;
}

function sanitizeIp(ip?: string | null): string | null {
  if (!ip) return null;
  let clean = ip.trim();
  if (clean.startsWith('::ffff:')) {
    clean = clean.replace('::ffff:', '');
  }
  return clean.substring(0, 100) || null;
}

function sanitizeUserAgent(ua?: string | null): string | null {
  if (!ua) return null;
  const clean = ua.trim();
  return clean ? clean.substring(0, 1000) : null;
}

function isValidUuid(id?: string | null): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export class AuditService {
  /**
   * Main audit recording function for VEYRA.
   * Validates event type, sanitizes metadata, and writes to veyra_audit_event.
   */
  public async recordAuditEvent(input: AuditEventInput): Promise<{
    success: boolean;
    eventId?: string;
    event?: AuditEventRecord;
    error?: string;
  }> {
    const { userId, eventType, ipAddress, userAgent, targetType, targetId, details } = input;

    // 1. Validate event type
    if (!ALLOWED_AUDIT_EVENT_TYPES.includes(eventType)) {
      const err = `Invalid audit event type "${eventType}". Allowed: ${ALLOWED_AUDIT_EVENT_TYPES.join(', ')}`;
      console.error(`[Audit Service Error] ${err}`);
      throw new Error(err);
    }

    // 2. Defense-in-depth sanitization of details
    const sanitizedDetails = sanitizeAuditDetails(details);

    // 3. User ID validation (ensure valid UUID or null so DB doesn't throw type error)
    const validUserId = isValidUuid(userId) ? userId : null;

    // 4. IP and User-Agent sanitization
    const validIp = sanitizeIp(ipAddress);
    const validUserAgent = sanitizeUserAgent(userAgent);
    const validTargetType = targetType ? targetType.trim().substring(0, 100) : null;
    const validTargetId = targetId ? String(targetId).trim().substring(0, 255) : null;

    try {
      const res = await dbQuery(
        `INSERT INTO veyra_audit_event (
           user_id, event_type, ip_address, user_agent, target_type, target_id, details
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING event_id, user_id, event_type, event_time, ip_address, user_agent, target_type, target_id, details`,
        [
          validUserId,
          eventType,
          validIp,
          validUserAgent,
          validTargetType,
          validTargetId,
          sanitizedDetails ? JSON.stringify(sanitizedDetails) : null
        ]
      );

      const row = res.rows[0];
      const record: AuditEventRecord = {
        eventId: row.event_id,
        userId: row.user_id,
        eventType: row.event_type as VeyraAuditEventType,
        eventTime: row.event_time,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        targetType: row.target_type,
        targetId: row.target_id,
        details: row.details
      };

      return {
        success: true,
        eventId: record.eventId,
        event: record
      };
    } catch (err: any) {
      console.error('[Audit Service Error] Failed to persist audit event:', err.message || err);
      // We do not expose internal DB details or stack traces to callers
      throw err;
    }
  }

  /**
   * Helper to retrieve recent audit events (for verification, testing, and admin view)
   */
  public async getAuditEvents(filter?: {
    userId?: string;
    eventType?: string;
    targetType?: string;
    targetId?: string;
    limit?: number;
    offset?: number;
  }): Promise<AuditEventRecord[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (filter?.userId && isValidUuid(filter.userId)) {
      conditions.push(`user_id = $${idx++}`);
      params.push(filter.userId);
    }
    if (filter?.eventType) {
      conditions.push(`event_type = $${idx++}`);
      params.push(filter.eventType);
    }
    if (filter?.targetType) {
      conditions.push(`target_type = $${idx++}`);
      params.push(filter.targetType);
    }
    if (filter?.targetId) {
      conditions.push(`target_id = $${idx++}`);
      params.push(filter.targetId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(filter?.limit || 100, 500);
    const offset = filter?.offset || 0;

    params.push(limit);
    const limitParamIdx = idx++;
    params.push(offset);
    const offsetParamIdx = idx++;

    const res = await dbQuery(
      `SELECT event_id, user_id, event_type, event_time, ip_address, user_agent, target_type, target_id, details
       FROM veyra_audit_event
       ${whereClause}
       ORDER BY event_time DESC
       LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
      params
    );

    return res.rows.map((row: any) => ({
      eventId: row.event_id,
      userId: row.user_id,
      eventType: row.event_type,
      eventTime: row.event_time,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      targetType: row.target_type,
      targetId: row.target_id,
      details: row.details
    }));
  }
}

export const auditService = new AuditService();

/**
 * Convenient standalone helper matching VY-STRY-010 specification
 */
export async function recordAuditEvent(input: AuditEventInput) {
  return auditService.recordAuditEvent(input);
}
