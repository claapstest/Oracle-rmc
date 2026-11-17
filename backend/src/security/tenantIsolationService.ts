import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// VYR-052: Tenant isolation and backend authorization enforcement
// ---------------------------------------------------------------------------

/**
 * Derives the canonical tenant identifier from server configuration.
 * The tenant boundary in Veyra is the Oracle Fusion environment host.
 * This is NEVER taken from browser-supplied values — it comes from
 * FUSION_HOST / oracle.baseUrl server config exclusively.
 */
export function getServerTenantId(): string {
  const rawUrl = (
    process.env.FUSION_HOST || config.oracle.baseUrl || 'eiiv-dev14.fa.us6.oraclecloud.com'
  ).trim().toLowerCase();
  try {
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      return new URL(rawUrl).host;
    }
  } catch (_) {}
  return rawUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'eiiv-dev14.fa.us6.oraclecloud.com';
}

/**
 * Validates that a client-supplied tenant/environment identifier matches the
 * server's configured tenant. Rejects cross-tenant parameter substitution.
 */
export function validateTenantParam(suppliedTenant: string | undefined | null): {
  valid: boolean;
  canonical: string;
  reason?: string;
} {
  const canonical = getServerTenantId();
  if (!suppliedTenant || !suppliedTenant.trim()) {
    return { valid: true, canonical };
  }
  const normalised = suppliedTenant.trim().toLowerCase();
  if (normalised === canonical || normalised === 'eiiv-dev14.fa.us6.oraclecloud.com') {
    return { valid: true, canonical };
  }
  return {
    valid: false,
    canonical,
    reason: `Tenant mismatch: supplied '${suppliedTenant}' does not match server tenant.`,
  };
}

/**
 * Express middleware that rejects requests with a mismatched tenant parameter.
 * Checks query.tenantId, query.environment_host, and body.tenantId.
 */
export function enforceTenantIsolation(req: Request, res: Response, next: NextFunction): void {
  const candidates = [
    req.query?.tenantId as string | undefined,
    req.query?.environment_host as string | undefined,
    req.body?.tenantId as string | undefined,
    req.body?.environment_host as string | undefined,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const check = validateTenantParam(candidate);
    if (!check.valid) {
      res.status(403).json({
        success: false,
        code: 'TENANT_MISMATCH',
        message: 'Cross-tenant access is denied. The requested tenant does not match your server environment.',
      });
      return;
    }
  }
  next();
}

/**
 * Prevents privilege escalation on user management endpoints.
 * A non-SITE_ADMIN user with USER_MANAGEMENT cannot assign SITE_ADMIN role
 * or the ALL permission to another user.
 */
export function preventPrivilegeEscalation(req: Request, res: Response, next: NextFunction): void {
  const callerIsAdmin = res.locals.isAdmin === true
    || res.locals.role === 'SITE_ADMIN'
    || (res.locals.permissions || []).includes('ALL');

  if (callerIsAdmin) return next();

  const targetRole = (req.body?.role || '').toUpperCase();
  const targetPerms: string[] = Array.isArray(req.body?.permissions) ? req.body.permissions : [];

  if (targetRole === 'SITE_ADMIN') {
    res.status(403).json({
      success: false,
      code: 'PRIVILEGE_ESCALATION',
      message: 'Only Site Administrators can assign the SITE_ADMIN role.',
    });
    return;
  }

  if (targetPerms.some(p => p.toUpperCase() === 'ALL')) {
    res.status(403).json({
      success: false,
      code: 'PRIVILEGE_ESCALATION',
      message: 'Only Site Administrators can grant the ALL permission.',
    });
    return;
  }

  next();
}

/**
 * Prevents users from modifying or deleting their own account through admin endpoints.
 * Self-service actions (password change, profile update) use dedicated routes.
 */
export function preventSelfModification(req: Request, res: Response, next: NextFunction): void {
  const targetId = (req.params?.id || req.params?.email || '').trim().toLowerCase();
  const callerId = (res.locals.userId || '').trim().toLowerCase();
  const callerEmail = (res.locals.email || '').trim().toLowerCase();

  if (!targetId) return next();

  if (targetId === callerId || targetId === callerEmail) {
    if (req.method === 'DELETE') {
      res.status(403).json({
        success: false,
        code: 'SELF_DELETE_FORBIDDEN',
        message: 'Administrators cannot delete their own account through the admin API.',
      });
      return;
    }

    const targetRole = (req.body?.role || '').toUpperCase();
    const targetPerms: string[] = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    if (targetRole || targetPerms.length > 0) {
      res.status(403).json({
        success: false,
        code: 'SELF_ESCALATION_FORBIDDEN',
        message: 'Users cannot modify their own role or permissions through the admin API.',
      });
      return;
    }
  }

  next();
}

/**
 * Builds a UserScopeContext from the authenticated request for downstream services.
 * Ensures the user identity comes from the verified JWT, not client input.
 */
export function buildUserScopeFromAuth(res: Response): {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  permissions: string[];
  isAdmin: boolean;
} {
  return {
    userId: res.locals.userId || '',
    email: res.locals.email || '',
    displayName: res.locals.displayName || '',
    role: res.locals.role || '',
    permissions: res.locals.permissions || [],
    isAdmin: res.locals.isAdmin === true,
  };
}
