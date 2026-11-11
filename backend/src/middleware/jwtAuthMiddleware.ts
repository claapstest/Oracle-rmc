// JWT Authentication Middleware
// Implements Story VYR-021 verification and session enforcement.
// This middleware validates the Authorization Bearer token, enforces the V1 JWT contract,
// checks cryptographic integrity against the JWKS, verifies the session is ACTIVE,
// and binds user identity to the request context.

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
  }
}

/**
 * verifyJwtAndSession is a thin wrapper around authService.validateSession that
 * expands error handling to meet the specific ACs for Story VYR-021.
 */
export async function verifyJwtAndSession(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_TOKEN',
        message: 'Authentication required. Missing or malformed token.',
      });
    }

    const token = authHeader.substring(7).trim();
    // authService.validateSession returns a rich validation object and also updates activity when requested.
    const validation = await authService.validateSession(token, true);
    if (!validation.valid) {
      // Map specific error codes to the required HTTP status per ACs.
      const status = validation.code === 'SESSION_EXPIRED' ? 401 : validation.code === 'USER_DISABLED' ? 403 : 401;
      const code = validation.code || 'INVALID_TOKEN';
      const message = validation.message || 'Invalid or expired token.';
      // Audit logging for security-relevant rejections.
      if (code === 'USER_DISABLED') {
        const email = validation.session?.email || 'Unknown User';
        logSecurityAudit(email, 'ACCOUNT_DEACTIVATED', `Blocked request: account status is ${validation.status || 'DISABLED'}`, req, validation.session?.userId);
      } else if (code === 'SESSION_EXPIRED') {
        const email = validation.session?.email || 'Unknown User';
        logSecurityAudit(email, 'SESSION_EXPIRED', 'Session expired due to inactivity or expiry period', req, validation.session?.userId);
      }
      return res.status(status).json({ success: false, code, message });
    }

    // At this point the token is cryptographically valid, claims are correct, and the session is ACTIVE.
    const session = validation.session!;
    // Attach useful auth context for downstream handlers.
    res.locals.userId = session.userId;
    res.locals.email = session.email;
    res.locals.displayName = session.displayName;
    res.locals.role = session.role;
    res.locals.permissions = session.permissions;
    res.locals.isAdmin = session.isAdmin;
    res.locals.token = token;
    res.locals.authProvider = session.authProvider || authService.getEffectiveProvider();
    // Continue to the protected route.
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

