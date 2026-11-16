/**
 * Request Validation Service
 * Story ID: VYR-049
 * Epic: EPIC 6 — OWASP application and API security hardening
 * Branch Applicability: Both
 *
 * Provides Zod-based request schema validation, payload size limits,
 * content-type allowlisting, and mass-assignment protection.
 *
 *   1. Validates body, path and query parameters with explicit schemas.
 *   2. Enforces per-route body size limits and content-type allowlists.
 *   3. Uses allowlisted DTO fields — unrecognized properties are stripped.
 *   4. Normalizes and validates dates, IDs, sort fields, filters and pagination.
 */

import { z, ZodSchema, ZodError } from 'zod';
import { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Reusable field validators
// ---------------------------------------------------------------------------

const safeString = (max = 500) => z.string().max(max).trim();
const safeEmail = () => z.string().email().max(254).trim().toLowerCase();
const safeId = () => z.string().max(128).trim().regex(/^[a-zA-Z0-9_\-:.@]+$/, 'Invalid ID format');
const safePassword = () => z.string().min(8).max(128);
const safeBoolean = () => z.union([z.boolean(), z.literal('true').transform(() => true), z.literal('false').transform(() => false)]);
const safeInt = (min = 0, max = 10000) => z.coerce.number().int().min(min).max(max);
const safeDate = () => z.string().max(30).regex(/^\d{4}-\d{2}-\d{2}/, 'Date must be YYYY-MM-DD format').optional();
const safePagination = () => z.object({
  page: safeInt(1, 1000).optional(),
  limit: safeInt(1, 500).optional(),
  offset: safeInt(0, 100000).optional(),
  sortBy: safeString(64).optional(),
  sortOrder: z.enum(['asc', 'desc', 'ASC', 'DESC']).optional(),
}).passthrough();

// ---------------------------------------------------------------------------
// Route schemas — body validation for every sensitive POST/PUT endpoint
// ---------------------------------------------------------------------------

export const schemas = {

  // ── Authentication ──────────────────────────────────────────────────
  'POST /auth/login': z.object({
    email: safeEmail(),
    password: safePassword(),
    code: safeString(32).optional(),
    token: safeString(4096).optional(),
    force: z.boolean().optional(),
    provider: safeString(16).optional(),
  }).strict(),

  'POST /auth/reset-password': z.object({
    email: safeEmail(),
    resetCode: safeString(64),
    newPassword: safePassword(),
  }).strict(),

  'POST /auth/logout': z.object({
    token: safeString(4096).optional(),
    sessionId: safeString(128).optional(),
    postLogoutRedirectUri: safeString(2048).optional(),
    post_logout_redirect_uri: safeString(2048).optional(),
  }).strict(),

  'POST /auth/entra/callback': z.object({
    code: safeString(2048).optional(),
    state: safeString(512).optional(),
  }).strict(),

  // ── User Management ─────────────────────────────────────────────────
  'POST /admin/users/toggle-status': z.object({
    email: safeEmail(),
    active: z.boolean(),
  }).strict(),

  'POST /admin/users/delete': z.object({
    email: safeEmail(),
  }).strict(),

  'POST /admin/users/generate-reset-code': z.object({
    email: safeEmail(),
  }).strict(),

  'POST /admin/users/revoke-reset-code': z.object({
    email: safeEmail(),
  }).strict(),

  'POST /users': z.object({
    email: safeEmail(),
    displayName: safeString(255).optional(),
    name: safeString(255).optional(),
    role: safeString(64).optional(),
    password: safePassword().optional(),
    status: z.enum(['ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED']).optional(),
    applicationAccess: z.array(safeString(64)).optional(),
    access: z.array(safeString(64)).optional(),
    sendInvitation: z.boolean().optional(),
    permissions: z.array(safeString(64)).optional(),
  }).strict(),

  'PUT /users/:id': z.object({
    displayName: safeString(255).optional(),
    role: safeString(64).optional(),
    status: z.enum(['ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED']).optional(),
    password: safePassword().optional(),
    permissions: z.array(safeString(64)).optional(),
  }).strict(),

  'POST /admin/users/:email/unlock': z.object({}).strict().optional(),

  // ── Oracle Integration Settings ─────────────────────────────────────
  'POST /settings/test-connection': z.object({
    baseUrl: safeString(2048),
    authType: z.enum(['basic', 'token', 'oauth']).optional(),
    username: safeString(128).optional(),
    password: safeString(512).optional(),
    token: safeString(4096).optional(),
  }).strict(),

  'POST /settings/toggle-mode': z.object({
    mode: z.enum(['DEMO', 'ORACLE_FUSION']).optional(),
    baseUrl: safeString(2048).optional(),
    username: safeString(128).optional(),
    password: safeString(512).optional(),
    token: safeString(4096).optional(),
    authType: z.enum(['basic', 'token', 'oauth']).optional(),
    groqModel: safeString(64).optional(),
  }).strict(),

  'POST /admin/oracle/integration': z.object({
    baseUrl: safeString(2048).optional(),
    username: safeString(128).optional(),
    password: safeString(512).optional(),
    token: safeString(4096).optional(),
    authType: z.enum(['basic', 'token', 'oauth']).optional(),
    groqModel: safeString(64).optional(),
  }).strict(),

  'POST /admin/oracle/test-connection': z.object({
    baseUrl: safeString(2048),
    authType: z.enum(['basic', 'token', 'oauth']).optional(),
    username: safeString(128).optional(),
    password: safeString(512).optional(),
    token: safeString(4096).optional(),
  }).strict(),

  // ── Chat / AI ───────────────────────────────────────────────────────
  'POST /chat': z.object({
    message: safeString(10000),
    context: z.any().optional(),
  }).strip(),

  'POST /ai/universal-query': z.object({
    query: safeString(10000),
    context: z.any().optional(),
  }).strip(),

  // ── Investigations ──────────────────────────────────────────────────
  'POST /investigations': z.object({
    id: safeId().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }).strip(),

  // ── Reports ─────────────────────────────────────────────────────────
  'POST /reports': z.object({
    reportType: safeString(64).optional(),
    type: safeString(64).optional(),
    reportName: safeString(255).optional(),
    category: safeString(64).optional(),
    format: z.enum(['json', 'csv', 'pdf', 'xlsx']).optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
    applicationScope: safeString(64).optional(),
    scopeType: safeString(64).optional(),
  }).strip(),

  // ── Audit ───────────────────────────────────────────────────────────
  'POST /audit/query': z.object({
    product: safeString(128).optional(),
    businessObject: safeString(128).optional(),
    fromDate: safeDate(),
    toDate: safeDate(),
    page: safeInt(1, 1000).optional(),
    limit: safeInt(1, 500).optional(),
    sortBy: safeString(64).optional(),
    sortOrder: z.enum(['asc', 'desc', 'ASC', 'DESC']).optional(),
    username: safeString(128).optional(),
    action: safeString(64).optional(),
  }).strip(),

  'POST /audit/sync': z.object({
    product: safeString(128).optional(),
    businessObject: safeString(128).optional(),
    fromDate: safeDate(),
    toDate: safeDate(),
  }).strip(),

  'POST /audit/sync/product': z.object({
    product: safeString(128).optional(),
    businessObject: safeString(128).optional(),
    fromDate: safeDate(),
    toDate: safeDate(),
  }).strip(),

  // ── Sync Policies ───────────────────────────────────────────────────
  'PUT /sync/policies/:productCode': z.object({
    syncCadence: safeString(32).optional(),
    syncIntervalHours: safeInt(1, 720).optional(),
    autoSyncEnabled: z.boolean().optional(),
  }).strict(),

  // ── Command Center ──────────────────────────────────────────────────
  'POST /command-center/request': z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    url: safeString(2048),
    params: z.record(z.string(), safeString()).optional(),
    headers: z.record(z.string(), safeString(4096)).optional(),
    body: z.any().optional(),
    authMode: z.enum(['basic', 'token', 'oauth', 'none']).optional(),
    timeoutMs: safeInt(1000, 60000).optional(),
  }).strict(),

  'POST /command-center/saved-requests': z.object({
    name: safeString(128),
    category: safeString(64).optional(),
    description: safeString(512).optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    url: safeString(2048),
    params: z.record(z.string(), safeString()).optional(),
    headers: z.record(z.string(), safeString(4096)).optional(),
    body: z.any().optional(),
    id: safeId().optional(),
  }).strict(),

  // ── Admin Quarantine ────────────────────────────────────────────────
  'POST /admin/sync/quarantine/:id/resolve': z.object({
    resolution: safeString(500).optional(),
  }).strip(),

  'POST /admin/security/rate-limits/reset': z.object({
    email: safeEmail().optional(),
    ip: safeString(45).optional(),
  }).strip(),
} as const;

export type SchemaKey = keyof typeof schemas;

// ---------------------------------------------------------------------------
// Content-type allowlist
// ---------------------------------------------------------------------------

const ALLOWED_CONTENT_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
];

// ---------------------------------------------------------------------------
// Per-route body size limits (bytes)
// ---------------------------------------------------------------------------

export const ROUTE_SIZE_LIMITS: Record<string, number> = {
  'POST /chat': 64 * 1024,             // 64KB for chat messages
  'POST /ai/universal-query': 64 * 1024,
  'POST /auth/login': 4 * 1024,        // 4KB for login
  'POST /auth/reset-password': 4 * 1024,
  'POST /auth/logout': 4 * 1024,
  'POST /settings/toggle-mode': 8 * 1024,
  'POST /admin/oracle/integration': 8 * 1024,
  'POST /command-center/request': 256 * 1024,  // 256KB for Oracle API proxy
  'POST /reports': 32 * 1024,
  'POST /investigations': 512 * 1024,  // 512KB for investigation payloads
  '__default__': 1024 * 1024,          // 1MB global default
};

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

function formatZodError(error: ZodError): string {
  return error.issues.map(issue => {
    const path = issue.path.length > 0 ? `"${issue.path.join('.')}"` : 'body';
    return `${path}: ${issue.message}`;
  }).join('; ');
}

/**
 * Returns Express middleware that validates req.body against the schema
 * registered for the given route key. Strips unrecognized fields (mass-
 * assignment protection) and replaces req.body with the validated output.
 */
export function validateBody(routeKey: SchemaKey) {
  const schema = schemas[routeKey];
  if (!schema) {
    console.warn(`[RequestValidation] No schema found for route: ${routeKey}`);
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = (schema as ZodSchema).safeParse(req.body || {});
      if (!result.success) {
        return res.status(422).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: `Request validation failed: ${formatZodError(result.error)}`,
          errors: result.error.issues.map(i => ({
            field: i.path.join('.'),
            message: i.message,
            code: i.code,
          })),
        });
      }
      req.body = result.data;
      next();
    } catch (err) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Request body could not be parsed.',
      });
    }
  };
}

/**
 * Middleware that validates query parameters against a Zod schema.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query || {});
    if (!result.success) {
      return res.status(422).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: `Query validation failed: ${formatZodError(result.error)}`,
      });
    }
    (req as any).validatedQuery = result.data;
    next();
  };
}

/**
 * Middleware that validates path parameters against a Zod schema.
 */
export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params || {});
    if (!result.success) {
      return res.status(422).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: `Path parameter validation failed: ${formatZodError(result.error)}`,
      });
    }
    next();
  };
}

/**
 * Content-type enforcement middleware.
 * Rejects POST/PUT/PATCH requests with disallowed content types.
 */
export function enforceContentType(req: Request, res: Response, next: NextFunction) {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType && !ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return res.status(415).json({
        success: false,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: `Content-Type "${contentType}" is not supported. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
      });
    }
  }
  next();
}

/**
 * Per-route body size enforcement middleware.
 * Returns 413 if Content-Length exceeds the route-specific or default limit.
 */
export function enforceBodySizeLimit(routeKey?: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const limit = (routeKey && ROUTE_SIZE_LIMITS[routeKey]) || ROUTE_SIZE_LIMITS['__default__'];
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > limit) {
      return res.status(413).json({
        success: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: `Request body exceeds the ${Math.round(limit / 1024)}KB limit for this endpoint.`,
      });
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Query schemas for common GET endpoints
// ---------------------------------------------------------------------------

export const querySchemas = {
  pagination: safePagination(),

  syncHistory: z.object({
    limit: safeInt(1, 100).optional(),
    outcome: z.enum(['SUCCESS', 'PARTIAL', 'FAILED', 'ABORTED', 'LOCK_CONTENTION']).optional(),
    tenantId: safeString(128).optional(),
  }),

  userList: z.object({
    page: safeInt(1, 1000).optional(),
    limit: safeInt(1, 200).optional(),
    search: safeString(128).optional(),
    role: safeString(64).optional(),
    status: z.enum(['ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED', 'EXPIRED']).optional(),
  }),
};

// ---------------------------------------------------------------------------
// Path param schemas
// ---------------------------------------------------------------------------

export const paramSchemas = {
  id: z.object({ id: safeId() }),
  email: z.object({ email: safeEmail() }),
  productCode: z.object({ productCode: safeString(64) }),
};
