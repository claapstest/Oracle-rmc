import crypto from 'crypto';
import { query as dbQuery } from '../db.js';

// VYR-053: extended event schema — configuration changes, privileged data
// access (reports), decryption access and audit-log access are now first-class
// security events alongside the original identity/session events.
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
  | 'PRIVILEGE_CHANGED'
  | 'CONFIG_CHANGED'
  | 'PRIVILEGED_DATA_ACCESS'
  | 'DECRYPTION_ACCESS'
  | 'AUDIT_LOG_ACCESS';

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
  'PRIVILEGE_CHANGED',
  'CONFIG_CHANGED',
  'PRIVILEGED_DATA_ACCESS',
  'DECRYPTION_ACCESS',
  'AUDIT_LOG_ACCESS'
] as const;

export interface AuditEventInput {
  userId?: string | null;
  eventType: VeyraAuditEventType;
  ipAddress?: string | null;
  userAgent?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, any> | null;
  /** VYR-053: correlation ID tying related events together (defaults to a fresh UUID). */
  correlationId?: string | null;
  /** VYR-053: who performed the action — service name or identified user. */
  serviceIdentity?: string | null;
  /** VYR-053: tenant scope the action applies to (multi-tenant deployments). */
  tenant?: string | null;
  /** VYR-053: outcome of the action. */
  result?: 'SUCCESS' | 'FAILURE' | 'DENIED' | null;
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
  correlationId: string | null;
  serviceIdentity: string | null;
  tenant: string | null;
  result: string | null;
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
  // VYR-053: schema extension (new columns + widened CHECK) applied lazily once.
  private schemaReady: Promise<void> | null = null;

  private ensureAuditSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await dbQuery(`
          ALTER TABLE veyra_audit_event ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(64);
          ALTER TABLE veyra_audit_event ADD COLUMN IF NOT EXISTS service_identity VARCHAR(100);
          ALTER TABLE veyra_audit_event ADD COLUMN IF NOT EXISTS tenant VARCHAR(100);
          ALTER TABLE veyra_audit_event ADD COLUMN IF NOT EXISTS result VARCHAR(20);
          ALTER TABLE veyra_audit_event ADD COLUMN IF NOT EXISTS event_hash VARCHAR(64);
          ALTER TABLE veyra_audit_event DROP CONSTRAINT IF EXISTS ck_veyra_audit_event_type;
          ALTER TABLE veyra_audit_event ADD CONSTRAINT ck_veyra_audit_event_type
            CHECK (event_type IN ('LOGIN_SUCCESS','LOGIN_FAILED','LOGIN_REJECTED_ACTIVE_SESSION','LOGOUT','SESSION_EXPIRED','USER_CREATED','USER_UPDATED','USER_DELETED','ROLE_ASSIGNED','ROLE_REMOVED','PRIVILEGE_CHANGED','CONFIG_CHANGED','PRIVILEGED_DATA_ACCESS','DECRYPTION_ACCESS','AUDIT_LOG_ACCESS'));
        `);
      })().catch((err) => {
        // Allow retry on the next call; original columns/constraint still work
        // for the identity events the table was created for.
        this.schemaReady = null;
        throw err;
      });
    }
    return this.schemaReady;
  }

  /**
   * VYR-053 tamper evidence: each event is hash-chained to its predecessor.
   * canonical = sha256(prevHash | eventTime | eventType | userId | serviceIdentity |
   *                    tenant | result | targetType | targetId | detailsJson)
   * `row` is a veyra_audit_event row (snake_case columns).
   */
  private computeEventHash(prevHash: string | null, row: {
    event_time: string | Date; event_type: string; user_id: string | null;
    service_identity: string | null; tenant: string | null; result: string | null;
    target_type: string | null; target_id: string | null; details: Record<string, any> | null;
  }): string {
    const parts = [
      prevHash || '',
      typeof row.event_time === 'string' ? row.event_time : new Date(row.event_time).toISOString(),
      row.event_type,
      row.user_id || '',
      row.service_identity || '',
      row.tenant || '',
      row.result || '',
      row.target_type || '',
      row.target_id || '',
      row.details ? JSON.stringify(row.details) : ''
    ];
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
  }

  /**
   * VYR-053: verify the tamper-evidence chain of the audit event table.
   * Rows written before VYR-053 (event_hash IS NULL) are tolerated at the
   * start of the log; a NULL hash after a hashed row is a tamper signal.
   * Returns the first broken link, if any.
   */
  public async verifyAuditChain(limit = 1000): Promise<{
    valid: boolean;
    eventsChecked: number;
    legacyEvents: number;
    brokenEventId?: string;
    reason?: string;
  }> {
    const res = await dbQuery(
      `SELECT event_id, event_time, event_type, user_id, service_identity, tenant,
              result, target_type, target_id, details, event_hash
         FROM veyra_audit_event
        ORDER BY event_time ASC, event_id ASC
        LIMIT $1`,
      [limit]
    );

    let prevHash: string | null = null;
    let seenHashed = false;
    let legacy = 0;

    for (const row of res.rows) {
      if (!row.event_hash) {
        if (seenHashed) {
          return { valid: false, eventsChecked: res.rows.length, legacyEvents: legacy, brokenEventId: row.event_id, reason: 'event_hash missing on a hashed-row successor (hash was stripped)' };
        }
        legacy++;
        continue;
      }
      const expected = this.computeEventHash(seenHashed ? prevHash : null, row);
      if (expected !== row.event_hash) {
        return { valid: false, eventsChecked: res.rows.length, legacyEvents: legacy, brokenEventId: row.event_id, reason: 'event_hash mismatch (event content was modified after write)' };
      }
      prevHash = row.event_hash;
      seenHashed = true;
    }
    return { valid: true, eventsChecked: res.rows.length, legacyEvents: legacy };
  }

  /**
   * VYR-053: backfill event_hash for rows recorded before VYR-053 or after an
   * authorized, documented data correction. Recomputes every link from the
   * stored content in log order. Returns the number of rows repaired.
   */
  public async repairAuditChain(limit = 1000): Promise<{ repaired: number }> {
    const res = await dbQuery(
      `SELECT event_id, event_time, event_type, user_id, service_identity, tenant,
              result, target_type, target_id, details, event_hash
         FROM veyra_audit_event
        ORDER BY event_time ASC, event_id ASC
        LIMIT $1`,
      [limit]
    );

    let prevHash: string | null = null;
    let repaired = 0;
    for (const row of res.rows) {
      const expected = this.computeEventHash(prevHash, row);
      if (row.event_hash !== expected) {
        await dbQuery(`UPDATE veyra_audit_event SET event_hash = $1 WHERE event_id = $2`, [expected, row.event_id]);
        repaired++;
      }
      prevHash = expected;
    }
    return { repaired };
  }

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

    // 0. VYR-053: make sure the extended columns / widened CHECK exist.
    await this.ensureAuditSchema();

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

    // 5. VYR-053 standardized fields: correlation, service identity, tenant, result
    const validCorrelationId = (input.correlationId
      ? String(input.correlationId).replace(/[^A-Za-z0-9-]/g, '').substring(0, 64)
      : crypto.randomUUID());
    const validServiceIdentity = input.serviceIdentity ? String(input.serviceIdentity).trim().substring(0, 100) : null;
    const validTenant = input.tenant ? String(input.tenant).trim().substring(0, 100) : null;
    const validResult = input.result ? String(input.result).trim().substring(0, 20) : 'SUCCESS';

    try {
      // 6. VYR-053 hash chain: link this event to its predecessor.
      const prevRes = await dbQuery(
        `SELECT event_hash FROM veyra_audit_event
          WHERE event_hash IS NOT NULL
          ORDER BY event_time DESC, event_id DESC LIMIT 1`
      );
      const prevHash: string | null = prevRes.rows[0]?.event_hash || null;

      const res = await dbQuery(
        `INSERT INTO veyra_audit_event (
           user_id, event_type, ip_address, user_agent, target_type, target_id, details,
           correlation_id, service_identity, tenant, result, event_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING event_id, user_id, event_type, event_time, ip_address, user_agent,
                   target_type, target_id, details, correlation_id, service_identity,
                   tenant, result, event_hash`,
        [
          validUserId,
          eventType,
          validIp,
          validUserAgent,
          validTargetType,
          validTargetId,
          sanitizedDetails ? JSON.stringify(sanitizedDetails) : null,
          validCorrelationId,
          validServiceIdentity,
          validTenant,
          validResult,
          null // placeholder — hash computed below over the stored details
        ]
      );

      // Hash is computed over the canonical stored form (details as persisted),
      // then written back — keeps verifyAuditChain deterministic.
      const row = res.rows[0];
      const eventHash = this.computeEventHash(prevHash, row);
      await dbQuery(`UPDATE veyra_audit_event SET event_hash = $1 WHERE event_id = $2`, [eventHash, row.event_id]);

      const record: AuditEventRecord = {
        eventId: row.event_id,
        userId: row.user_id,
        eventType: row.event_type as VeyraAuditEventType,
        eventTime: row.event_time,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        targetType: row.target_type,
        targetId: row.target_id,
        details: row.details,
        correlationId: row.correlation_id,
        serviceIdentity: row.service_identity,
        tenant: row.tenant,
        result: row.result
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
      `SELECT event_id, user_id, event_type, event_time, ip_address, user_agent, target_type, target_id, details,
              correlation_id, service_identity, tenant, result
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
      details: row.details,
      correlationId: row.correlation_id,
      serviceIdentity: row.service_identity,
      tenant: row.tenant,
      result: row.result
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
