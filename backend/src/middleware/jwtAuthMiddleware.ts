// JWT Authentication & RBAC Resolution Middleware
// Implements Stories VYR-021 & VYR-023:
// - VYR-021: JWT verification against published JWKS and active session enforcement.
// - VYR-023: Resolves JWT subject/session to active Veyra principal and integrates with RBAC route authorization.
//
// Technical Implementation:
// 1. Validates Authorization Bearer token (RS256 compact JWS).
// 2. Resolves token subject (sub) and session ID (sid) to the active Veyra user.
// 3. Re-checks user account status and tenant access server-side (fails closed with 403 on inactive/disabled).
// 4. Binds verified identity, roles, and privileges to res.locals and req.user for downstream RBAC enforcement.

import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService.js';
import { recordAuditEvent } from '../services/auditService.js';

function logSecurityAudit(email: string, action: string, details: string, req?: Request, userId?: string | null) {
  console.log(`[AUDIT] [${new Date().toISOString()}] User: ${email} | Action: ${action} | Details: ${details}`);
  if (action === 'SESSION_EXPIRED') {
    recordAuditEvent({
      userId: userId || null,
      eventType: 'SESSION_EXPIRED',
      ipAddress: req?.ip || null,
      userAgent: req?.get('user-agent') || null,
      details: { email, details }
    }).catch(() => {});
  } else if (action === 'ACCOUNT_DEACTIVATED') {
    recordAuditEvent({
      userId: userId || null,
      eventType: 'LOGIN_FAILED',
      ipAddress: req?.ip || null,
      userAgent: req?.get('user-agent') || null,
      details: { email, reason: action, details }
    }).catch(() => {});
  }
}

/**
 * verifyJwtAndSession validates the JWT and active session, re-checks account status,
 * and attaches the verified Veyra principal to the request context.
 */
export async function verifyJwtAndSession(req: Request, res: Response, next: NextFunction) {
  try {
    // If authentication was already verified on this request (e.g., chained middlewares), proceed immediately
    if (res.locals.userId && res.locals.token) {
      return next();
    }

    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_TOKEN',
        message: 'Authentication required. Missing or malformed token.',
      });
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_TOKEN',
        message: 'Authentication required. Missing or malformed token.',
      });
    }

    // authService.validateSession verifies cryptographic signature against JWKS,
    // matches JWT sub against active session, and re-checks database account status.
    const validation = await authService.validateSession(token, true);
    if (!validation.valid) {
      const status = validation.code === 'SESSION_EXPIRED' ? 401 : validation.code === 'USER_DISABLED' ? 403 : 401;
      const code = validation.code || 'INVALID_TOKEN';
      const message = validation.message || 'Invalid or expired token.';

      if (code === 'USER_DISABLED') {
        const email = validation.session?.email || 'Unknown User';
        logSecurityAudit(email, 'ACCOUNT_DEACTIVATED', `Blocked request: account status is ${validation.status || 'DISABLED'}`, req, validation.session?.userId);
      } else if (code === 'SESSION_EXPIRED') {
        const email = validation.session?.email || 'Unknown User';
        logSecurityAudit(email, 'SESSION_EXPIRED', 'Session expired due to inactivity or expiry period', req, validation.session?.userId);
      }

      return res.status(status).json({ success: false, code, message });
    }

    // Token is cryptographically valid, claims are correct, session is ACTIVE, and account is ACTIVE
    const session = validation.session!;

    // Attach verified principal to res.locals for downstream handlers and RBAC middleware
    res.locals.userId = session.userId;
    res.locals.email = session.email;
    res.locals.username = session.email;
    res.locals.displayName = session.displayName;
    res.locals.role = session.role;
    res.locals.permissions = session.permissions;
    res.locals.isAdmin = session.isAdmin;
    res.locals.token = token;
    res.locals.sessionId = session.token;
    res.locals.authProvider = session.authProvider || authService.getEffectiveProvider();

    // Standard Express req.user binding for downstream handlers
    (req as any).user = {
      id: session.userId,
      userId: session.userId,
      email: session.email,
      displayName: session.displayName,
      role: session.role,
      permissions: session.permissions,
      isAdmin: session.isAdmin,
      authProvider: res.locals.authProvider
    };

    next();
  } catch (err: any) {
    console.error('[verifyJwtAndSession Error]:', err);
    return res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: err?.message || 'Internal server error.',
    });
  }
}
