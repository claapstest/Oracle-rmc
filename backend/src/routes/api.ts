import { Router, Request, Response } from 'express';
import { oracleService } from '../services/oracleService.js';
import { rolePrivilegeCatalogService } from '../services/rolePrivilegeCatalogService.js';
import { privilegeRoleCatalogService } from '../services/privilegeRoleCatalogService.js';
import { processUserMessage } from '../ai/orchestrator.js';
import { config, savePersistedConfig } from '../config.js';
import { mockUsers, mockAuditTrail } from '../services/mockData.js';
import { authService } from '../services/authService.js';
import { tools } from '../tools/index.js';
import { auditProductCatalogService } from '../services/auditProductCatalogService.js';
import { commandCenterService } from '../services/commandCenterService.js';
import { userAccessReportService } from '../services/userAccessReportService.js';
import { auditDashboardService } from '../services/auditDashboardService.js';
import { supervisorDashboardDbService } from '../services/supervisorDashboardDbService.js';
import { reportDbService } from '../services/reportDbService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIT_LOG_PATH = path.join(__dirname, '../../oracle_audit.log');

export const apiRouter = Router();

// Write Audit Logs securely without exposing secrets
function logAudit(username: string, action: string, details: string) {
  const timestamp = new Date().toISOString();
  const safeUsername = username || 'SYSTEM';
  const logMessage = `[${timestamp}] User: ${safeUsername} | Action: ${action} | Details: ${details}\n`;
  console.log(`[AUDIT] ${logMessage.trim()}`);
  try {
    fs.appendFileSync(AUDIT_LOG_PATH, logMessage, { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    console.error('[Audit Error] Failed to write to audit log file:', err);
  }
  try {
    mockAuditTrail.unshift({
      id: `aud_adm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp,
      username: safeUsername,
      businessObject: action.includes('USER') || action.includes('ACCOUNT') ? `User: ${details.split(' ').pop() || safeUsername}` : 'Security Administration',
      action: action.includes('DELETE') ? 'DELETE' : action.includes('REVOKE') ? 'ROLE_REVOKE' : action.includes('ASSIGN') ? 'ROLE_ASSIGN' : 'UPDATE',
      details
    });
  } catch (err) {
    console.error('[Audit Error] Failed to update in-memory audit trail:', err);
  }
}

// Authentication middleware to verify session tokens (AC2, AC3, AC4, AC7)
export async function requireAuth(req: Request, res: Response, next: () => void) {
  const authHeader = req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required. Missing or malformed token.' });
  }

  const token = authHeader.substring(7);
  const validation = await authService.validateSession(token, true);
  if (!validation.valid) {
    if (validation.code === 'SESSION_EXPIRED') {
      const email = validation.session?.email || 'Unknown User';
      logAudit(email, 'SESSION_EXPIRED', 'Session expired due to inactivity or expiry period');
      return res.status(401).json({
        code: 'SESSION_EXPIRED',
        message: 'Your session has expired. Please log in again.'
      });
    }
    return res.status(401).json({
      success: false,
      code: validation.code || 'INVALID_TOKEN',
      message: validation.message || 'Session expired or invalid. Please sign in again.'
    });
  }

  const session = validation.session!;
  res.locals.userId = session.userId;
  res.locals.email = session.email;
  res.locals.displayName = session.displayName;
  res.locals.role = session.role;
  res.locals.permissions = session.permissions;
  res.locals.isAdmin = session.isAdmin;
  res.locals.token = token;
  next();
}

// Middleware to enforce backend admin authorization (Site Admin only - AC6)
export function requireAdmin(req: Request, res: Response, next: () => void) {
  requireAuth(req, res, () => {
    const isAdmin = res.locals.isAdmin === true || res.locals.role === 'SITE_ADMIN' || res.locals.permissions?.includes('ALL');
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Access denied. Site Administrator privileges required.'
      });
    }
    next();
  });
}

// Middleware to enforce specific privileges (AC5)
export function requirePrivilege(requiredPrivileges: string | string[]) {
  const reqPrivList = Array.isArray(requiredPrivileges) ? requiredPrivileges : [requiredPrivileges];
  return (req: Request, res: Response, next: () => void) => {
    requireAuth(req, res, () => {
      const userPermissions: string[] = res.locals.permissions || [];
      const isAdmin: boolean = res.locals.isAdmin === true || res.locals.role === 'SITE_ADMIN';

      if (isAdmin || userPermissions.includes('ALL')) {
        return next();
      }

      const hasPrivilege = reqPrivList.some(p => 
        userPermissions.map(x => x.toUpperCase()).includes(p.toUpperCase())
      );

      if (!hasPrivilege) {
        return res.status(403).json({
          success: false,
          code: 'FORBIDDEN',
          message: 'Access denied. Insufficient privileges.'
        });
      }

      next();
    });
  };
}

// Middleware to enforce Ask Veyra AI assistant access (AC8)
export function requireAskVeyra(req: Request, res: Response, next: () => void) {
  requireAuth(req, res, () => {
    const userRole = (res.locals.role || '').toUpperCase();
    const userPermissions: string[] = res.locals.permissions || [];
    const isAdmin: boolean = res.locals.isAdmin === true || userRole === 'SITE_ADMIN';

    // AC8: Audit Supervisor must not receive Ask Veyra privileges
    if (userRole === 'AUDIT_SUPERVISOR') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Access denied. Audit Supervisor does not have privilege to access Ask Veyra.'
      });
    }

    if (isAdmin || userPermissions.includes('ALL') || userPermissions.includes('ASK_VEYRA')) {
      return next();
    }

    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Access denied. Ask Veyra privileges required.'
    });
  });
}

// Middleware to enforce Audit Manager Dashboard authorization (AC2, AC4)
export function requireAuditManagerDashboard(req: Request, res: Response, next: () => void) {
  requireAuth(req, res, () => {
    const userRole = (res.locals.role || '').toUpperCase();
    const userPermissions: string[] = res.locals.permissions || [];
    const isAdmin = res.locals.isAdmin === true || userRole === 'SITE_ADMIN' || userPermissions.includes('ALL');

    // Site Admin, Audit Manager, Security Analyst, Compliance Officer, and authorized administrative roles
    if (isAdmin || userRole === 'AUDIT_MANAGER' || userRole === 'SECURITY_ANALYST' || userRole === 'COMPLIANCE_OFFICER') {
      return next();
    }

    // Role-based exclusion: AUDIT_USER is strictly limited to reports and cannot access Audit Manager dashboard (AC2)
    if (userRole === 'AUDIT_USER') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Access denied. Audit User role does not have privilege to access Audit Manager dashboard.'
      });
    }

    // Check specific required privileges
    const allowedPrivileges = [
      'AUDIT_READ',
      'AUDIT_TRAIL',
      'SECURITY_READ',
      'RISK_READ',
      'RISK_MANAGEMENT',
      'ROLES_CATALOG',
      'USERS_LIST'
    ];

    const hasPrivilege = allowedPrivileges.some(p =>
      userPermissions.map(x => x.toUpperCase()).includes(p.toUpperCase())
    );

    if (hasPrivilege) {
      return next();
    }

    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Access denied. Audit Manager dashboard privileges required.'
    });
  });
}

// Middleware to enforce Audit Supervisor Dashboard authorization (VY-STRY-015: AC1, AC2, AC5, AC6)
export function requireAuditSupervisorDashboard(req: Request, res: Response, next: () => void) {
  requireAuth(req, res, () => {
    const userRole = (res.locals.role || '').toUpperCase();
    const userPermissions: string[] = res.locals.permissions || [];
    const isAdmin = res.locals.isAdmin === true || userRole === 'SITE_ADMIN' || userPermissions.includes('ALL');

    // Site Admin, Audit Supervisor, Audit Manager, Security Analyst, Compliance Officer
    if (isAdmin || userRole === 'AUDIT_SUPERVISOR' || userRole === 'AUDIT_MANAGER' || userRole === 'SECURITY_ANALYST' || userRole === 'COMPLIANCE_OFFICER') {
      return next();
    }

    // Role-based exclusion: AUDIT_USER is strictly limited to reports and cannot access Audit Supervisor dashboard (AC2, AC6)
    if (userRole === 'AUDIT_USER') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Access denied. Audit User role does not have privilege to access Audit Supervisor dashboard.'
      });
    }

    // Check specific required privileges
    const allowedPrivileges = [
      'AUDIT_READ',
      'AUDIT_TRAIL',
      'SECURITY_READ',
      'RISK_READ',
      'RISK_MANAGEMENT',
      'ROLES_CATALOG',
      'USERS_LIST'
    ];

    const hasPrivilege = allowedPrivileges.some(p =>
      userPermissions.map(x => x.toUpperCase()).includes(p.toUpperCase())
    );

    if (hasPrivilege) {
      return next();
    }

    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Access denied. Audit Supervisor dashboard privileges required.'
    });
  });
}

// Middleware to enforce Reports-Only Dashboard authorization (VY-STRY-18: AC1, AC2, AC5, AC6)
export function requireReportsDashboard(req: Request, res: Response, next: () => void) {
  requireAuth(req, res, () => {
    const userRole = (res.locals.role || '').toUpperCase();
    const userPermissions: string[] = res.locals.permissions || [];
    const isAdmin = res.locals.isAdmin === true || userRole === 'SITE_ADMIN' || userPermissions.includes('ALL');

    // Site Admin, Audit Manager, Audit Supervisor, Audit User, or any role holding REPORTS privilege
    if (isAdmin || userRole === 'AUDIT_USER' || userRole === 'AUDIT_SUPERVISOR' || userRole === 'AUDIT_MANAGER') {
      return next();
    }

    const hasReportsPrivilege = userPermissions.some(p =>
      ['REPORTS', 'REPORTS_READ', 'REPORTS_MANAGE', 'ALL'].includes(p.toUpperCase())
    );

    if (hasReportsPrivilege) {
      return next();
    }

    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Access denied. Reports dashboard privileges required.'
    });
  });
}

// --- Authentication Endpoints ---

// POST /auth/login - VEYRA User Sign In (AC1-AC8)
apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  const { email: rawEmail, password } = req.body;
  if (!rawEmail || !password) {
    logAudit(rawEmail || 'unknown', 'LOGIN_REJECTED', 'Missing email or password (400 Bad Request)');
    return res.status(400).json({ success: false, message: 'Please provide email and password.' });
  }

  try {
    const rawIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.get('user-agent') || 'Unknown Client';
    const result = await authService.login(rawEmail, password, { ipAddress: rawIp, userAgent });

    if (!result.success) {
      if (result.code === 'ACTIVE_SESSION_EXISTS') {
        logAudit(rawEmail, 'LOGIN_REJECTED', 'Active session already exists for this user (409 Conflict)');
        return res.status(409).json({
          code: 'ACTIVE_SESSION_EXISTS',
          message: 'An active session already exists for this user.'
        });
      }
      if (result.status && result.status !== 'ACTIVE') {
        logAudit(rawEmail, 'LOGIN_REJECTED', `Account is not active: ${result.status} (403 Forbidden)`);
        return res.status(403).json({ success: false, code: 'USER_DISABLED', message: result.message });
      }
      logAudit(rawEmail, 'LOGIN_REJECTED', 'Invalid credentials (401 Unauthorized)');
      return res.status(401).json({ success: false, message: result.message });
    }
    
    logAudit(result.normalizedEmail || rawEmail, 'USER_LOGIN', `Successful login (${result.role || 'User'}, isAdmin: ${result.isAdmin})`);
    return res.json({
      success: true,
      token: result.token,
      sessionId: result.token,
      userId: result.userId,
      displayName: result.displayName,
      email: result.email || result.normalizedEmail || rawEmail,
      role: result.role,
      permissions: result.permissions,
      status: result.status,
      isAdmin: result.isAdmin,
      setupCompleted: result.setupCompleted,
      environmentMode: config.environmentMode,
      message: result.message
    });
  } catch (err) {
    console.error('[Login API Error]:', err);
    logAudit(rawEmail, 'LOGIN_REJECTED', 'Internal error during login attempt (500)');
    return res.status(500).json({ success: false, message: 'An internal login error occurred.' });
  }
});

// GET /auth/status - Verify Session Status & Authorization Info
apiRouter.get('/auth/status', requireAuth, (req: Request, res: Response) => {
  res.json({
    success: true,
    loggedIn: true,
    userId: res.locals.userId,
    email: res.locals.email,
    displayName: res.locals.displayName,
    role: res.locals.role,
    permissions: res.locals.permissions,
    isAdmin: res.locals.isAdmin,
    environmentMode: config.environmentMode
  });
});

// POST /auth/refresh - Refresh Active Session Inactivity Timer (AC3)
apiRouter.post('/auth/refresh', requireAuth, async (req: Request, res: Response) => {
  const token = res.locals.token;
  const result = await authService.refreshSessionActivity(token);
  logAudit(res.locals.email, 'SESSION_REFRESH', 'User requested session keep-alive refresh');
  res.json({
    success: true,
    message: 'Session activity refreshed successfully.',
    lastActivityAt: result.lastActivityAt || Date.now(),
    expiresAt: result.expiresAt
  });
});

// POST /auth/logout - Sign Out User & Invalidate Session (AC5, AC6, AC9)
apiRouter.post('/auth/logout', async (req: Request, res: Response) => {
  const authHeader = req.header('Authorization');
  let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.body?.token || req.body?.sessionId);
  if (!token) {
    return res.status(400).json({ success: false, message: 'Missing token for logout.' });
  }

  const rawIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.get('user-agent') || 'Unknown Client';

  const validation = await authService.validateSession(token, false);
  const email = validation.session?.email || 'Unknown User';
  await authService.logout(token, { ipAddress: rawIp, userAgent });
  logAudit(email, 'USER_LOGOUT', 'Logged out successfully; session invalidated');
  res.json({ success: true, message: 'Logged out successfully.' });
});

// POST /admin/sessions/cleanup - Trigger Session Cleanup (AC8)
apiRouter.post('/admin/sessions/cleanup', requireAdmin, async (req: Request, res: Response) => {
  await authService.cleanupExpiredSessions();
  logAudit(res.locals.email, 'SESSION_CLEANUP', 'Admin triggered expired session cleanup');
  res.json({ success: true, message: 'Expired sessions cleaned up successfully.' });
});

// POST /auth/reset-password - Perform Password Reset
apiRouter.post('/auth/reset-password', async (req: Request, res: Response) => {
  const { email: rawEmail, resetCode, newPassword } = req.body;
  if (!rawEmail || !resetCode || !newPassword) {
    return res.status(400).json({ success: false, message: 'Please fill in all reset fields.' });
  }

  const email = authService.normalizeEmail(rawEmail);
  try {
    const result = authService.resetPassword(email, resetCode, newPassword);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }

    logAudit(email, 'USER_PASSWORD_RESET', 'Successfully completed admin-approved password reset');
    res.json({ success: true, message: result.message });
  } catch (err) {
    console.error('[Reset Password API Error]:', err);
    res.status(500).json({ success: false, message: 'An internal password reset error occurred.' });
  }
});

// --- Investigation Snapshots Persistence (24h Retention) ---

const investigationSnapshots = new Map<string, {
  id: string;
  user: string;
  payload: any;
  createdAt: number;
}>();

const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

function purgeExpiredSnapshots() {
  const now = Date.now();
  for (const [id, item] of investigationSnapshots.entries()) {
    if (now - item.createdAt > SNAPSHOT_TTL_MS) {
      investigationSnapshots.delete(id);
    }
  }
}

// POST /investigations - Save temporary investigation snapshot
apiRouter.post('/investigations', requireAuth, (req: Request, res: Response) => {
  const { id, payload } = req.body;
  if (!id || !payload) {
    return res.status(400).json({ success: false, message: 'Investigation id and payload are required.' });
  }

  purgeExpiredSnapshots();

  if (investigationSnapshots.size > 200) {
    const oldestKey = investigationSnapshots.keys().next().value;
    if (oldestKey) investigationSnapshots.delete(oldestKey);
  }

  investigationSnapshots.set(id, {
    id,
    user: res.locals.email,
    payload,
    createdAt: Date.now()
  });

  res.json({ success: true, id });
});

// GET /investigations/:id - Retrieve investigation snapshot for authenticated user
apiRouter.get('/investigations/:id', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  purgeExpiredSnapshots();

  const snapshot = investigationSnapshots.get(id);
  if (!snapshot) {
    return res.status(404).json({ success: false, message: 'Investigation snapshot not found or expired.' });
  }

  res.json({ success: true, data: snapshot.payload });
});

// --- Admin Portal User & Reset Code Management Endpoints ---

// GET /admin/users - List users
apiRouter.get('/admin/users', requireAdmin, (req: Request, res: Response) => {
  try {
    const usersList = authService.getAdminUsersList();
    res.json({ success: true, users: usersList });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// POST /admin/users/toggle-status - Activate/Deactivate Account
apiRouter.post('/admin/users/toggle-status', requireAdmin, (req: Request, res: Response) => {
  const { email: rawEmail, active } = req.body;
  if (rawEmail === undefined || active === undefined) {
    return res.status(400).json({ success: false, message: 'Target email and active status are required.' });
  }

  const email = authService.normalizeEmail(rawEmail);
  try {
    const result = authService.toggleAccountStatus(res.locals.email, email, active);
    if (!result) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    
    logAudit(res.locals.email, active ? 'ADMIN_ACTIVATE_ACCOUNT' : 'ADMIN_DEACTIVATE_ACCOUNT', `Updated status for ${email}`);
    res.json({ success: true, message: `Account status updated for ${email}.` });
  } catch (err) {
    res.status(400).json({ success: false, message: (err as Error).message });
  }
});

// POST /admin/users/delete - Permanently delete user account
apiRouter.post('/admin/users/delete', requireAdmin, (req: Request, res: Response) => {
  const { email: rawEmail } = req.body;
  if (!rawEmail) {
    return res.status(400).json({ success: false, message: 'Target user email is required.' });
  }

  const email = authService.normalizeEmail(rawEmail);
  try {
    const result = authService.deleteUserAccount(res.locals.email, email);
    if (!result) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    logAudit(res.locals.email, 'ADMIN_DELETE_ACCOUNT', `Permanently deleted user account ${email}`);
    res.json({ success: true, message: `Account for ${email} has been permanently deleted.` });
  } catch (err) {
    res.status(400).json({ success: false, message: (err as Error).message });
  }
});

// POST /admin/users/generate-reset-code - Create one-time reset code
apiRouter.post('/admin/users/generate-reset-code', requireAdmin, (req: Request, res: Response) => {
  const { email: rawEmail } = req.body;
  if (!rawEmail) {
    return res.status(400).json({ success: false, message: 'Target user email is required.' });
  }

  const email = authService.normalizeEmail(rawEmail);
  try {
    const resetCode = authService.generateResetCode(email);
    logAudit(res.locals.email, 'ADMIN_GENERATE_RESET_CODE', `Generated reset code for user ${email}`);
    res.json({ success: true, resetCode, message: 'Reset code generated successfully.' });
  } catch (err) {
    res.status(400).json({ success: false, message: (err as Error).message });
  }
});

// POST /admin/users/revoke-reset-code - Revoke/Invalidate active reset code
apiRouter.post('/admin/users/revoke-reset-code', requireAdmin, (req: Request, res: Response) => {
  const { email: rawEmail } = req.body;
  if (!rawEmail) {
    return res.status(400).json({ success: false, message: 'Target user email is required.' });
  }

  const email = authService.normalizeEmail(rawEmail);
  try {
    const result = authService.revokeResetCode(email);
    if (!result) {
      return res.status(404).json({ success: false, message: 'User not found or has no active reset code.' });
    }
    
    logAudit(res.locals.email, 'ADMIN_REVOKE_RESET_CODE', `Revoked reset code for user ${email}`);
    res.json({ success: true, message: `Active reset code revoked for user ${email}.` });
  } catch (err) {
    res.status(400).json({ success: false, message: (err as Error).message });
  }
});

function validateAndNormalizeUrl(url: string): string {
  let trimmed = url.trim();
  if (!trimmed) {
    throw new Error('Base URL is required.');
  }

  // Reject query parameters and fragments
  if (trimmed.includes('?') || trimmed.includes('#')) {
    throw new Error('Base URL must not contain query parameters (?) or fragments (#).');
  }

  // Require HTTPS
  if (!trimmed.startsWith('https://')) {
    if (trimmed.startsWith('http://')) {
      throw new Error('Secure connection (https://) is required.');
    } else {
      trimmed = 'https://' + trimmed;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error('Invalid URL format. Please enter a valid URL.');
  }

  // Reject pathname prefixes
  if (parsed.pathname && parsed.pathname !== '/' && parsed.pathname.toLowerCase() !== '') {
    throw new Error("Please enter only the Base URL (e.g., https://example.oraclecloud.com) without any path (e.g., /hcmRestApi/...)");
  }

  // Normalize URL (strips trailing slash automatically)
  return `${parsed.protocol}//${parsed.host}`;
}

// 1. Connection & Settings API
apiRouter.get('/settings', requireAdmin, (req: Request, res: Response) => {
  const adminUser = res.locals.username;
  logAudit(adminUser, 'READ_SETTINGS', 'Retrieved settings metadata');
  
  res.json({
    mode: config.environmentMode,
    baseUrl: config.oracle.baseUrl,
    authType: config.oracle.authType,
    username: config.oracle.username,
    hasPassword: !!config.oracle.password,
    hasToken: !!config.oracle.token,
    hasGeminiKey: !!config.groqApiKey,
    groqModel: config.groqModel,
  });
});

apiRouter.post('/settings/test-connection', requireAdmin, async (req: Request, res: Response) => {
  const adminUser = res.locals.username;
  try {
    const { baseUrl, authType, username, password, token } = req.body;
    
    if (baseUrl !== undefined) {
      const normalizedBaseUrl = validateAndNormalizeUrl(baseUrl);
      
      let testPassword = password;
      let testToken = token;
      
      if (authType === 'BASIC' && !testPassword && username === config.oracle.username) {
        testPassword = config.oracle.password;
      }
      if (authType === 'BEARER' && !testToken) {
        testToken = config.oracle.token;
      }
      
      logAudit(adminUser, 'TEST_CONNECTION_ATTEMPTED', `Proposed Base URL: ${normalizedBaseUrl}, Auth Type: ${authType}`);
      
      const result = await oracleService.testConnection({
        baseUrl: normalizedBaseUrl,
        authType: authType as 'BASIC' | 'BEARER',
        username,
        password: testPassword,
        token: testToken
      });
      
      logAudit(adminUser, 'TEST_CONNECTION_RESULT', `Success: ${result.success}, Status: ${result.status}`);
      return res.json(result);
    }
    
    logAudit(adminUser, 'TEST_CONNECTION_ATTEMPTED', 'Current configuration test');
    const result = await oracleService.testConnection();
    logAudit(adminUser, 'TEST_CONNECTION_RESULT', `Success: ${result.success}, Status: ${result.status}`);
    res.json(result);
  } catch (err) {
    logAudit(adminUser, 'TEST_CONNECTION_FAILED', `Error: ${(err as Error).message}`);
    res.status(400).json({ success: false, status: 'ERROR', message: (err as Error).message });
  }
});

apiRouter.post('/settings/toggle-mode', requireAdmin, (req: Request, res: Response) => {
  const adminUser = res.locals.username;
  const { mode, baseUrl, username, password, token, authType, groqModel } = req.body;

  try {
    const oldMode = config.environmentMode;
    const oldUrl = config.oracle.baseUrl;
    const oldAuth = config.oracle.authType;

    if (mode === 'DEMO' || mode === 'ORACLE_FUSION') {
      // Live-instance-only: DEMO/sample mode is disabled. Always run live.
      config.environmentMode = 'ORACLE_FUSION';
    } else if (mode === undefined) {
      config.environmentMode = 'ORACLE_FUSION';
    }
    
    if (baseUrl !== undefined) {
      config.oracle.baseUrl = validateAndNormalizeUrl(baseUrl);
    }
    if (username !== undefined) config.oracle.username = username;
    
    if (password !== undefined && password !== '') {
      config.oracle.password = password;
    }
    if (token !== undefined && token !== '') {
      config.oracle.token = token;
    }
    
    if (authType !== undefined) {
      config.oracle.authType = authType.toUpperCase() as 'BASIC' | 'BEARER';
    }
    if (groqModel !== undefined) config.groqModel = groqModel;

    savePersistedConfig();
    oracleService.recreateClient();

    logAudit(adminUser, 'CONFIGURATION_SAVED', `Updated configuration. Mode: ${oldMode} -> ${config.environmentMode}, URL: ${oldUrl} -> ${config.oracle.baseUrl}, Auth: ${oldAuth} -> ${config.oracle.authType}`);

    res.json({
      success: true,
      message: `Environment configuration updated. Running in ${config.environmentMode} mode.`,
      settings: {
        mode: config.environmentMode,
        baseUrl: config.oracle.baseUrl,
        authType: config.oracle.authType,
        username: config.oracle.username,
        hasPassword: !!config.oracle.password,
        hasToken: !!config.oracle.token,
        hasGeminiKey: !!config.groqApiKey,
        groqModel: config.groqModel,
      }
    });
  } catch (err) {
    logAudit(adminUser, 'CONFIGURATION_SAVE_FAILED', `Error: ${(err as Error).message}`);
    res.status(400).json({ success: false, message: (err as Error).message });
  }
});

apiRouter.post('/oracle/refresh-live-data', requireAdmin, async (req: Request, res: Response) => {
  const adminUser = res.locals.username;
  try {
    console.log(`[Oracle API] Live data refresh initiated by ${adminUser}...`);
    oracleService.clearInstanceCache();
    oracleService.recreateClient();
    logAudit(adminUser, 'LIVE_DATA_REFRESHED', `Cleared old cache and initiated live dynamic sync for ${config.oracle.baseUrl}`);
    res.json({
      success: true,
      message: 'Old cache invalidated. Live dynamic data fetch initiated from Oracle instance.',
      mode: config.environmentMode,
      baseUrl: config.oracle.baseUrl
    });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// 1.5 Capabilities API
apiRouter.get('/capabilities', requireAuth, (req: Request, res: Response) => {
  const isDemo = oracleService.isDemoMode();
  res.json({
    users: true,
    roles: true,
    roleAssignments: true,
    audit: true,
    roleHierarchy: isDemo,
    privileges: isDemo,
    riskManagement: isDemo,
    sod: isDemo,
  });
});

// =========================================================================
// VY-STRY-012: Audit Manager Dashboard APIs (AC1 — AC6)
// =========================================================================

async function handleAuditManagerDashboard(req: Request, res: Response) {
  try {
    const userContext = {
      userId: res.locals.userId,
      email: res.locals.email,
      displayName: res.locals.displayName,
      role: res.locals.role,
      permissions: res.locals.permissions,
      isAdmin: res.locals.isAdmin
    };

    const forceRefresh = req.query.refresh === 'true';
    const result = await auditDashboardService.getDashboardDataForUser(userContext, forceRefresh);

    // AC5: Record dashboard access event according to VEYRA audit logging policy
    logAudit(res.locals.email || 'UNKNOWN', 'DASHBOARD_ACCESS', `Accessed Audit Manager dashboard (role: ${res.locals.role || 'Unknown'})`);

    return res.status(200).json(result);
  } catch (err) {
    console.error('[Audit Manager Dashboard Error]:', err);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: (err as Error).message || 'Failed to retrieve Audit Manager dashboard metrics.'
    });
  }
}

// GET /api/dashboard/audit-manager - Primary Audit Manager Dashboard Endpoint (AC1-AC6)
apiRouter.get('/dashboard/audit-manager', requireAuditManagerDashboard, handleAuditManagerDashboard);

// GET /api/dashboard/metrics - Dedicated Metrics Summary Endpoint (AC3)
apiRouter.get('/dashboard/metrics', requireAuditManagerDashboard, handleAuditManagerDashboard);

// GET /api/audit-manager/dashboard - Standard Audit Manager Alias Endpoint
apiRouter.get('/audit-manager/dashboard', requireAuditManagerDashboard, handleAuditManagerDashboard);

// GET /api/overview/stats - Overview / Dashboard Statistics API for Frontend Integration
apiRouter.get('/overview/stats', requireAuditManagerDashboard, async (req: Request, res: Response) => {
  try {
    const userContext = {
      userId: res.locals.userId,
      email: res.locals.email,
      displayName: res.locals.displayName,
      role: res.locals.role,
      permissions: res.locals.permissions,
      isAdmin: res.locals.isAdmin
    };

    const forceRefresh = req.query.refresh === 'true';
    const result = await auditDashboardService.getDashboardDataForUser(userContext, forceRefresh);

    logAudit(res.locals.email || 'UNKNOWN', 'DASHBOARD_ACCESS', `Accessed Overview Stats dashboard (role: ${res.locals.role || 'Unknown'})`);

    return res.status(200).json(result);
  } catch (err) {
    console.error('[Overview Stats API Error]:', err);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: (err as Error).message || 'Failed to retrieve overview statistics.'
    });
  }
});

// GET /api/dashboard/history - Retrieve historical metric snapshots (VY-STRY-013)
apiRouter.get('/dashboard/history', requireAuditSupervisorDashboard, async (req: Request, res: Response) => {
  try {
    const metricKey = (req.query.metricKey as string) || 'ACTIVE_RISKS';
    const scopeType = (req.query.scopeType as string) || 'GLOBAL';
    const limit = parseInt((req.query.limit as string) || '20', 10);
    const isMock = req.query.isMock === 'true';

    const history = await auditDashboardService.getHistoricalMetrics(metricKey, limit, scopeType, isMock);

    return res.status(200).json({
      success: true,
      metricKey,
      scopeType,
      history
    });
  } catch (err) {
    console.error('[Dashboard History API Error]:', err);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: (err as Error).message || 'Failed to retrieve dashboard metric history.'
    });
  }
});

// =========================================================================
// VY-STRY-015: Audit Supervisor Dashboard APIs (AC1 — AC8)
// =========================================================================

async function handleAuditSupervisorDashboard(req: Request, res: Response) {
  try {
    const userContext = {
      userId: res.locals.userId,
      email: res.locals.email,
      displayName: res.locals.displayName,
      role: res.locals.role,
      permissions: res.locals.permissions,
      isAdmin: res.locals.isAdmin
    };

    const forceRefresh = req.query.refresh === 'true';
    const result = await auditDashboardService.getSupervisorDashboardData(userContext, forceRefresh);

    // AC8: Dashboard access should be auditable
    logAudit(res.locals.email || 'UNKNOWN', 'DASHBOARD_ACCESS', `Accessed Audit Supervisor dashboard (role: ${res.locals.role || 'Unknown'})`);

    return res.status(200).json(result);
  } catch (err) {
    console.error('[Audit Supervisor Dashboard Error]:', err);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: (err as Error).message || 'Failed to retrieve Audit Supervisor dashboard metrics.'
    });
  }
}

// GET /api/dashboard/audit-supervisor - Primary Audit Supervisor Dashboard Endpoint (AC1-AC8)
apiRouter.get('/dashboard/audit-supervisor', requireAuditSupervisorDashboard, handleAuditSupervisorDashboard);

// GET /api/audit-supervisor/dashboard - Dedicated Audit Supervisor Alias Endpoint
apiRouter.get('/audit-supervisor/dashboard', requireAuditSupervisorDashboard, handleAuditSupervisorDashboard);

// GET /api/supervisor/dashboard - Supervisor Alias Endpoint
apiRouter.get('/supervisor/dashboard', requireAuditSupervisorDashboard, handleAuditSupervisorDashboard);

// GET /api/supervisor/metrics - Supervisor Metrics Summary Endpoint (AC4)
apiRouter.get('/supervisor/metrics', requireAuditSupervisorDashboard, handleAuditSupervisorDashboard);

// =========================================================================
// DB Story: Support Audit Supervisor Dashboard Data and Authorization Endpoints
// =========================================================================

// GET /api/dashboard/audit-supervisor/db/summary - Database-backed supervisor summary
apiRouter.get('/dashboard/audit-supervisor/db/summary', requireAuditSupervisorDashboard, async (req: Request, res: Response) => {
  try {
    const userContext = {
      userId: res.locals.userId,
      email: res.locals.email,
      displayName: res.locals.displayName,
      role: res.locals.role,
      permissions: res.locals.permissions,
      isAdmin: res.locals.isAdmin
    };

    const isMock = req.query.isMock === 'true';
    const applicationScope = req.query.applicationScope as string | undefined;
    const summary = await supervisorDashboardDbService.getSupervisorDashboardSummary(userContext, {
      isMock,
      applicationScope
    });

    logAudit(res.locals.email || 'UNKNOWN', 'DASHBOARD_DB_QUERY', `Audit Supervisor queried DB summary for scope: ${summary.applicationScope}`);
    return res.status(200).json({ success: true, ...summary });
  } catch (err) {
    console.error('[Audit Supervisor DB Summary Error]:', err);
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: (err as Error).message || 'Failed to query Audit Supervisor dashboard data.'
    });
  }
});

// GET /api/dashboard/audit-supervisor/db/risk - Database-backed risk metrics
apiRouter.get('/dashboard/audit-supervisor/db/risk', requireAuditSupervisorDashboard, async (req: Request, res: Response) => {
  try {
    const userContext = {
      userId: res.locals.userId,
      email: res.locals.email,
      displayName: res.locals.displayName,
      role: res.locals.role,
      permissions: res.locals.permissions,
      isAdmin: res.locals.isAdmin
    };

    const isMock = req.query.isMock === 'true';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const applicationScope = req.query.applicationScope as string | undefined;

    const risks = await supervisorDashboardDbService.queryRiskMetrics(userContext, {
      isMock,
      limit,
      applicationScope
    });

    return res.status(200).json({ success: true, count: risks.length, data: risks });
  } catch (err) {
    console.error('[Audit Supervisor DB Risk Error]:', err);
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: (err as Error).message || 'Failed to query risk data.'
    });
  }
});

// GET /api/dashboard/audit-supervisor/db/reports - Database-backed report metrics
apiRouter.get('/dashboard/audit-supervisor/db/reports', requireAuditSupervisorDashboard, async (req: Request, res: Response) => {
  try {
    const userContext = {
      userId: res.locals.userId,
      email: res.locals.email,
      displayName: res.locals.displayName,
      role: res.locals.role,
      permissions: res.locals.permissions,
      isAdmin: res.locals.isAdmin
    };

    const isMock = req.query.isMock === 'true';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const applicationScope = req.query.applicationScope as string | undefined;

    const reports = await supervisorDashboardDbService.queryReportMetrics(userContext, {
      isMock,
      limit,
      applicationScope
    });

    return res.status(200).json({ success: true, count: reports.length, data: reports });
  } catch (err) {
    console.error('[Audit Supervisor DB Reports Error]:', err);
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: (err as Error).message || 'Failed to query report data.'
    });
  }
});

// GET /api/dashboard/audit-supervisor/db/audit - Database-backed audit metrics
apiRouter.get('/dashboard/audit-supervisor/db/audit', requireAuditSupervisorDashboard, async (req: Request, res: Response) => {
  try {
    const userContext = {
      userId: res.locals.userId,
      email: res.locals.email,
      displayName: res.locals.displayName,
      role: res.locals.role,
      permissions: res.locals.permissions,
      isAdmin: res.locals.isAdmin
    };

    const isMock = req.query.isMock === 'true';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const applicationScope = req.query.applicationScope as string | undefined;

    const auditMetrics = await supervisorDashboardDbService.queryAuditMetrics(userContext, {
      isMock,
      limit,
      applicationScope
    });

    return res.status(200).json({ success: true, count: auditMetrics.length, data: auditMetrics });
  } catch (err) {
    console.error('[Audit Supervisor DB Audit Error]:', err);
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: (err as Error).message || 'Failed to query audit metrics.'
    });
  }
});

// GET /api/dashboard/audit-supervisor/db/audit-events - Database-backed audit event trail
apiRouter.get('/dashboard/audit-supervisor/db/audit-events', requireAuditSupervisorDashboard, async (req: Request, res: Response) => {
  try {
    const userContext = {
      userId: res.locals.userId,
      email: res.locals.email,
      displayName: res.locals.displayName,
      role: res.locals.role,
      permissions: res.locals.permissions,
      isAdmin: res.locals.isAdmin
    };

    const events = await supervisorDashboardDbService.queryAuditEvents(userContext, {
      eventType: req.query.eventType as string | undefined,
      targetType: req.query.targetType as string | undefined,
      targetId: req.query.targetId as string | undefined,
      userId: req.query.userId as string | undefined,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0
    });

    return res.status(200).json({ success: true, count: events.length, data: events });
  } catch (err) {
    console.error('[Audit Supervisor DB Audit Events Error]:', err);
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: (err as Error).message || 'Failed to query audit events.'
    });
  }
});

// =========================================================================
// VY-STRY-18: Reports-Only Dashboard APIs (AC1 — AC7)
// =========================================================================

async function handleReportsDashboard(req: Request, res: Response) {
  try {
    const userContext = {
      userId: res.locals.userId,
      email: res.locals.email,
      displayName: res.locals.displayName,
      role: res.locals.role,
      permissions: res.locals.permissions,
      isAdmin: res.locals.isAdmin
    };

    const forceRefresh = req.query.refresh === 'true';
    const result = await auditDashboardService.getReportsDashboardData(userContext, forceRefresh);

    // AC7: Access should be auditable
    logAudit(res.locals.email || 'UNKNOWN', 'DASHBOARD_ACCESS', `Accessed Reports-Only dashboard (role: ${res.locals.role || 'Unknown'})`);

    return res.status(200).json(result);
  } catch (err) {
    console.error('[Reports Dashboard Error]:', err);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: (err as Error).message || 'Failed to retrieve Reports dashboard data.'
    });
  }
}

// GET /api/dashboard/reports-only - Primary Reports-Only Dashboard Endpoint (AC1-AC7)
apiRouter.get('/dashboard/reports-only', requireReportsDashboard, handleReportsDashboard);

// GET /api/dashboard/audit-user - Dedicated Audit User Dashboard Endpoint (AC1-AC7)
apiRouter.get('/dashboard/audit-user', requireReportsDashboard, handleReportsDashboard);

// GET /api/audit-user/dashboard - Audit User Dashboard Alias
apiRouter.get('/audit-user/dashboard', requireReportsDashboard, handleReportsDashboard);

// GET /api/reports/dashboard - Reports Dashboard Alias
apiRouter.get('/reports/dashboard', requireReportsDashboard, handleReportsDashboard);

// GET /api/reports/metrics - Reports Metrics Summary Endpoint (AC3)
apiRouter.get('/reports/metrics', requireReportsDashboard, handleReportsDashboard);

// =========================================================================
// VY-STRY-19: DB Report Retrieval APIs for Reports-Only User Access (AC1-AC5)
// =========================================================================

// GET /api/reports/db - Parameterized database retrieval of reports respecting user scope
apiRouter.get('/reports/db', requireReportsDashboard, async (req: Request, res: Response) => {
  try {
    const userContext = {
      userId: res.locals.userId,
      email: res.locals.email,
      displayName: res.locals.displayName,
      role: res.locals.role,
      permissions: res.locals.permissions,
      isAdmin: res.locals.isAdmin
    };

    const isMock = req.query.isMock === 'true';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const category = req.query.category as string | undefined;
    const reportType = req.query.reportType as string | undefined;
    const status = req.query.status as any;
    const applicationScope = req.query.applicationScope as string | undefined;

    const result = await reportDbService.queryReports(userContext, {
      isMock,
      limit,
      offset,
      category,
      reportType,
      status,
      applicationScope
    });

    logAudit(res.locals.email || 'UNKNOWN', 'REPORT_DB_QUERY', `Queried reports database (scope: ${result.applicationScope}, count: ${result.count})`);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[Reports DB Query Error]:', err);
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: (err as Error).message || 'Failed to query report records.'
    });
  }
});

// GET /api/reports/db/:reportId - Single report lookup with authorization and scope validation
apiRouter.get('/reports/db/:reportId', requireReportsDashboard, async (req: Request, res: Response) => {
  try {
    const userContext = {
      userId: res.locals.userId,
      email: res.locals.email,
      displayName: res.locals.displayName,
      role: res.locals.role,
      permissions: res.locals.permissions,
      isAdmin: res.locals.isAdmin
    };

    const report = await reportDbService.getReportById(userContext, req.params.reportId);
    if (!report) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Report not found or not accessible within your authorized scope.'
      });
    }

    return res.status(200).json({ success: true, report });
  } catch (err) {
    console.error('[Report Detail DB Error]:', err);
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: (err as Error).message || 'Failed to retrieve report record.'
    });
  }
});

// GET /api/dashboard/reports-only/db/reports - Reports-Only Dashboard DB Reports Alias
apiRouter.get('/dashboard/reports-only/db/reports', requireReportsDashboard, async (req: Request, res: Response) => {
  try {
    const userContext = {
      userId: res.locals.userId,
      email: res.locals.email,
      displayName: res.locals.displayName,
      role: res.locals.role,
      permissions: res.locals.permissions,
      isAdmin: res.locals.isAdmin
    };

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const result = await reportDbService.queryReports(userContext, { limit });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: (err as Error).message || 'Failed to query reports.'
    });
  }
});

// =========================================================================
// VY-STRY-21: Site Admin Dashboard and Administration APIs (AC1 — AC7)
// =========================================================================

async function handleAdminDashboard(req: Request, res: Response) {
  try {
    const userContext = {
      userId: res.locals.userId,
      email: res.locals.email,
      displayName: res.locals.displayName,
      role: res.locals.role,
      permissions: res.locals.permissions,
      isAdmin: res.locals.isAdmin
    };

    const forceRefresh = req.query.refresh === 'true';
    const result = await auditDashboardService.getAdminDashboardData(userContext, forceRefresh);

    // AC6: All Site Admin administrative operations must be recorded in the VEYRA audit trail
    logAudit(res.locals.email || 'admin@admin.com', 'DASHBOARD_ACCESS', `Accessed Site Admin dashboard (role: ${res.locals.role || 'SITE_ADMIN'})`);

    return res.status(200).json(result);
  } catch (err) {
    console.error('[Site Admin Dashboard Error]:', err);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: (err as Error).message || 'Failed to retrieve Site Admin dashboard data.'
    });
  }
}

// GET /api/dashboard/admin - Primary Site Admin Dashboard Endpoint (AC1-AC7)
apiRouter.get('/dashboard/admin', requireAdmin, handleAdminDashboard);

// GET /api/dashboard/site-admin - Site Admin Dashboard Alias
apiRouter.get('/dashboard/site-admin', requireAdmin, handleAdminDashboard);

// GET /api/admin/dashboard - Dedicated Admin Dashboard Endpoint
apiRouter.get('/admin/dashboard', requireAdmin, handleAdminDashboard);

// GET /api/admin/summary - Site Admin Summary Endpoint
apiRouter.get('/admin/summary', requireAdmin, handleAdminDashboard);

// GET /api/admin/oracle/integration - Status & configuration (AC3, AC5: Secrets masked)
apiRouter.get('/admin/oracle/integration', requireAdmin, (req: Request, res: Response) => {
  const adminUser = res.locals.email || 'admin@admin.com';
  logAudit(adminUser, 'READ_SETTINGS', 'Retrieved Oracle integration metadata');
  res.json({
    success: true,
    mode: config.environmentMode,
    baseUrl: config.oracle.baseUrl,
    authType: config.oracle.authType,
    username: config.oracle.username,
    hasPassword: !!config.oracle.password,
    hasToken: !!config.oracle.token,
    hasGeminiKey: !!config.groqApiKey,
    groqModel: config.groqModel,
    status: config.oracle.baseUrl ? 'CONNECTED' : 'STANDBY'
  });
});

// POST /api/admin/oracle/integration - Update Oracle configuration (AC3, AC6)
apiRouter.post('/admin/oracle/integration', requireAdmin, (req: Request, res: Response) => {
  const adminUser = res.locals.email || 'admin@admin.com';
  const { baseUrl, username, password, token, authType, groqModel } = req.body;

  try {
    const oldUrl = config.oracle.baseUrl;
    const oldAuth = config.oracle.authType;

    if (baseUrl !== undefined) {
      config.oracle.baseUrl = validateAndNormalizeUrl(baseUrl);
    }
    if (username !== undefined) config.oracle.username = username;
    if (password !== undefined && password !== '') {
      config.oracle.password = password;
    }
    if (token !== undefined && token !== '') {
      config.oracle.token = token;
    }
    if (authType !== undefined) {
      config.oracle.authType = authType.toUpperCase() as 'BASIC' | 'BEARER';
    }
    if (groqModel !== undefined) config.groqModel = groqModel;

    savePersistedConfig();
    oracleService.recreateClient();

    logAudit(adminUser, 'CONFIGURATION_SAVED', `Updated Oracle integration configuration. URL: ${oldUrl} -> ${config.oracle.baseUrl}, Auth: ${oldAuth} -> ${config.oracle.authType}`);

    res.json({
      success: true,
      message: `Oracle integration configuration updated. Running in ${config.environmentMode} mode.`,
      settings: {
        mode: config.environmentMode,
        baseUrl: config.oracle.baseUrl,
        authType: config.oracle.authType,
        username: config.oracle.username,
        hasPassword: !!config.oracle.password,
        hasToken: !!config.oracle.token,
        hasGeminiKey: !!config.groqApiKey,
        groqModel: config.groqModel,
        status: config.oracle.baseUrl ? 'CONNECTED' : 'STANDBY'
      }
    });
  } catch (err) {
    logAudit(adminUser, 'CONFIGURATION_SAVE_FAILED', `Error: ${(err as Error).message}`);
    res.status(400).json({ success: false, message: (err as Error).message });
  }
});

// POST /api/admin/oracle/test-connection - Health probe (AC3, AC6)
apiRouter.post('/admin/oracle/test-connection', requireAdmin, async (req: Request, res: Response) => {
  const adminUser = res.locals.email || 'admin@admin.com';
  try {
    const { baseUrl, authType, username, password, token } = req.body;
    if (baseUrl !== undefined) {
      const normalizedBaseUrl = validateAndNormalizeUrl(baseUrl);
      let testPassword = password;
      let testToken = token;
      if (authType === 'BASIC' && !testPassword && username === config.oracle.username) {
        testPassword = config.oracle.password;
      }
      if (authType === 'BEARER' && !testToken) {
        testToken = config.oracle.token;
      }
      logAudit(adminUser, 'TEST_CONNECTION_ATTEMPTED', `Proposed Base URL: ${normalizedBaseUrl}, Auth Type: ${authType}`);
      const result = await oracleService.testConnection({
        baseUrl: normalizedBaseUrl,
        authType: authType as 'BASIC' | 'BEARER',
        username,
        password: testPassword,
        token: testToken
      });
      logAudit(adminUser, 'TEST_CONNECTION_RESULT', `Success: ${result.success}, Status: ${result.status}`);
      return res.json(result);
    }
    logAudit(adminUser, 'TEST_CONNECTION_ATTEMPTED', 'Current configuration test');
    const result = await oracleService.testConnection();
    logAudit(adminUser, 'TEST_CONNECTION_RESULT', `Success: ${result.success}, Status: ${result.status}`);
    res.json(result);
  } catch (err) {
    logAudit(adminUser, 'TEST_CONNECTION_FAILED', `Error: ${(err as Error).message}`);
    res.status(400).json({ success: false, status: 'ERROR', message: (err as Error).message });
  }
});

// POST /api/admin/oracle/sync - Refresh live data (AC3, AC6)
apiRouter.post('/admin/oracle/sync', requireAdmin, async (req: Request, res: Response) => {
  const adminUser = res.locals.email || 'admin@admin.com';
  try {
    oracleService.clearInstanceCache();
    oracleService.recreateClient();
    logAudit(adminUser, 'LIVE_DATA_REFRESHED', `Cleared old cache and initiated live dynamic sync for ${config.oracle.baseUrl}`);
    res.json({
      success: true,
      message: 'Old cache invalidated. Live dynamic data fetch initiated from Oracle instance.',
      mode: config.environmentMode,
      baseUrl: config.oracle.baseUrl
    });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// GET /api/admin/users/summary - Admin users summary (AC2, AC6)
apiRouter.get('/admin/users/summary', requireAdmin, (_req: Request, res: Response) => {
  try {
    const adminUsers = authService.getAdminUsersList();
    const total = adminUsers.length;
    const active = adminUsers.filter(u => u.status === 'ACTIVE').length;
    const suspended = adminUsers.filter(u => u.status === 'SUSPENDED').length;
    const disabled = adminUsers.filter(u => u.status === 'DISABLED').length;
    const siteAdmins = adminUsers.filter(u => u.isAdmin || u.role === 'SITE_ADMIN').length;

    logAudit(res.locals.email || 'admin@admin.com', 'READ_USERS_SUMMARY', 'Retrieved administrative user summary');
    res.json({
      success: true,
      total,
      active,
      suspended,
      disabled,
      siteAdmins,
      users: adminUsers
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// 2. Chat / NLU Assistant API (AC8: Audit Supervisor blocked, requires ASK_VEYRA)
apiRouter.post('/chat', requireAskVeyra, async (req: Request, res: Response) => {
  try {
    const { message, context } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    const aiResponse = await processUserMessage(message, context);
    res.json(aiResponse);
  } catch (err) {
    res.status(500).json({ error: 'AI Orchestration failed', details: (err as Error).message });
  }
});

// ==========================================
// AC1, AC4, AC5, AC6: User Management APIs
// ==========================================

// GET /users - List users (live Oracle instance only, no fallback)
apiRouter.get('/users', requirePrivilege(['USERS_LIST', 'USER_READ', 'USER_MANAGEMENT', 'SECURITY_READ']), async (req: Request, res: Response) => {
  try {
    const filter = req.query.filter as string | undefined;
    // Live-instance-only: ignore source=local, always serve from configured Oracle instance link.

    const startIndex = req.query.startIndex ? parseInt(req.query.startIndex as string, 10) : (req.query.page && req.query.limit ? (parseInt(req.query.page as string, 10) - 1) * parseInt(req.query.limit as string, 10) + 1 : 1);
    const count = req.query.count ? parseInt(req.query.count as string, 10) : (req.query.limit ? parseInt(req.query.limit as string, 10) : 50);
    const result = await oracleService.getUsers({ filterText: filter, startIndex, count });
    return res.json({ ...result, ...oracleService.getModeInfo() });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// GET /users/:id - Get single user by ID or Email (live Oracle instance only)
apiRouter.get('/users/:id', requirePrivilege(['USERS_LIST', 'USER_READ', 'USER_MANAGEMENT', 'SECURITY_READ']), async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const oracleUser = await oracleService.getUser(id);
    if (oracleUser) {
      return res.json({ success: true, user: oracleUser, ...oracleService.getModeInfo() });
    }

    return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'User not found.' });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// POST /users - Create a new user (AC1, AC4, AC5, AC6: Site Admin only)
apiRouter.post('/users', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { email, displayName, role, password, status } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: 'Email is required.' });
    }

    const result = await authService.createUser({
      email,
      displayName,
      role,
      password,
      status,
      createdBy: res.locals.email
    });

    if (!result.success) {
      if (result.code === 'USER_ALREADY_EXISTS') {
        return res.status(409).json({ success: false, code: result.code, message: result.message });
      }
      return res.status(400).json({ success: false, code: result.code || 'INVALID_INPUT', message: result.message });
    }

    logAudit(res.locals.email, 'ADMIN_CREATE_USER', `Created user ${result.user?.email} with role ${result.user?.role}`);
    return res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// PUT /users/:id - Update user / role assignment (AC1, AC4, AC5, AC6: Site Admin only)
apiRouter.put('/users/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const { displayName, role, status, password, permissions } = req.body;

    const result = await authService.updateUser(id, {
      displayName,
      role,
      status,
      password,
      permissions,
      updatedBy: res.locals.email
    });

    if (!result.success) {
      return res.status(404).json(result);
    }

    logAudit(res.locals.email, 'ADMIN_UPDATE_USER', `Updated user ${id} (role: ${role || 'unchanged'}, status: ${status || 'unchanged'})`);
    return res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// DELETE /users/:id - Delete user (AC1, AC5, AC6: Site Admin only)
apiRouter.delete('/users/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const result = await authService.deleteUser(id, res.locals.email);

    if (!result.success) {
      if (result.code === 'CANNOT_DELETE_SELF') {
        return res.status(400).json(result);
      }
      return res.status(404).json(result);
    }

    logAudit(res.locals.email, 'ADMIN_DELETE_USER', `Permanently deleted user account ${id}`);
    return res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ==========================================
// AC2: Role APIs
// ==========================================

// GET /roles - List roles (live Oracle instance only, no fallback)
apiRouter.get('/roles', requirePrivilege(['ROLES_CATALOG', 'ROLE_READ', 'USER_MANAGEMENT', 'SECURITY_READ']), async (req: Request, res: Response) => {
  try {
    // Live-instance-only: ignore source=local, always serve from configured Oracle instance link.
    const filter = req.query.filter as string | undefined;
    const category = req.query.category as string | undefined;
    const startIndex = req.query.startIndex ? parseInt(req.query.startIndex as string, 10) : (req.query.page && req.query.limit ? (parseInt(req.query.page as string, 10) - 1) * parseInt(req.query.limit as string, 10) + 1 : 1);
    const count = req.query.count ? parseInt(req.query.count as string, 10) : (req.query.limit ? parseInt(req.query.limit as string, 10) : 50);
    const result = await oracleService.getRoles({ filterText: filter, category, startIndex, count });
    return res.json({ ...result, ...oracleService.getModeInfo() });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Single Role Lookup Endpoint (Fast In-Memory 0ms)
apiRouter.get('/roles/single', requirePrivilege(['ROLES_CATALOG', 'ROLE_READ', 'USER_MANAGEMENT', 'SECURITY_READ']), async (req: Request, res: Response) => {
  try {
    const identifier = (req.query.identifier || req.query.id || req.query.name) as string;
    if (!identifier) {
      return res.status(400).json({ error: 'Role identifier is required' });
    }
    const role = await oracleService.getRole(identifier);
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }
    res.json({ role, ...oracleService.getModeInfo() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /roles/:id - Get single role by ID or Code (live Oracle instance only)
apiRouter.get('/roles/:id', requirePrivilege(['ROLES_CATALOG', 'ROLE_READ', 'USER_MANAGEMENT', 'SECURITY_READ']), async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const oracleRole = await oracleService.getRole(id);
    if (oracleRole) {
      return res.json({ success: true, role: oracleRole, ...oracleService.getModeInfo() });
    }

    return res.status(404).json({ success: false, code: 'ROLE_NOT_FOUND', message: 'Role not found.' });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Assigned Role Members Endpoint
apiRouter.get('/roles/:name/members', requirePrivilege(['ROLES_CATALOG', 'ROLE_READ', 'USER_MANAGEMENT']), async (req: Request, res: Response) => {
  try {
    const roleName = req.params.name;
    const members = await oracleService.getRoleMembers(roleName);
    res.json({
      success: true,
      roleName,
      members,
      total: members.length,
      ...oracleService.getModeInfo()
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Authoritative Role Dataset Validation Endpoint
apiRouter.get('/roles/validation', requirePrivilege(['ROLES_CATALOG', 'ROLE_READ']), async (req: Request, res: Response) => {
  try {
    const validation = oracleService.validateRoleCounts();
    res.json(validation);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Authoritative Role Dataset Sync Endpoint (Admin only)
apiRouter.post('/roles/sync', requireAdmin, async (req: Request, res: Response) => {
  try {
    const syncResult = await oracleService.syncAuthoritativeRoles();
    res.json(syncResult);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ==========================================
// AC3: Privilege APIs
// ==========================================

// GET /privileges - List privileges (AC3, AC5, AC7, AC8, AC9)
apiRouter.get('/privileges', requirePrivilege(['ROLES_CATALOG', 'ROLE_READ', 'PRIVILEGE_READ', 'USER_MANAGEMENT', 'SECURITY_READ']), (_req: Request, res: Response) => {
  try {
    const privs = authService.getPrivilegesList();
    res.json({
      success: true,
      privileges: privs,
      total: privs.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ==========================================
// Reports APIs (AC9: Audit User allowed)
// ==========================================

apiRouter.get('/reports/role-hierarchy', requirePrivilege(['REPORTS', 'REPORTS_READ']), async (req: Request, res: Response) => {
  try {
    const result = await oracleService.getRoleHierarchyReport();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.get('/reports/user-access', requirePrivilege(['REPORTS', 'REPORTS_READ']), async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const result = await userAccessReportService.getUserAccessReport(forceRefresh);
    res.json(result);
  } catch (err) {
    console.error('[API Route /reports/user-access] Error:', err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/roles/:name/hierarchy', requirePrivilege(['ROLES_CATALOG', 'ROLE_READ']), async (req: Request, res: Response) => {
  try {
    const result = await oracleService.getRoleHierarchy(req.params.name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.get('/roles/:name/privileges', requirePrivilege(['ROLES_CATALOG', 'ROLE_READ']), async (req: Request, res: Response) => {
  try {
    const result = await oracleService.getPrivilegesForRole(req.params.name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ==========================================
// 5. Audit logs API (AC5, AC7, AC8: Audit User blocked)
// ==========================================

apiRouter.get('/audit/products', requirePrivilege(['AUDIT_TRAIL', 'AUDIT_READ']), (req: Request, res: Response) => {
  try {
    const products = auditProductCatalogService.getPublicCatalog();
    res.json({
      success: true,
      products
    });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

apiRouter.get('/audit', requirePrivilege(['AUDIT_TRAIL', 'AUDIT_READ']), async (req: Request, res: Response) => {
  try {
    const product = req.query.product as string | undefined;
    const businessObjectType = req.query.businessObjectType as string | undefined;
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;
    const username = req.query.username as string | undefined;
    const action = req.query.action as string | undefined;
    const pageNumber = req.query.pageNumber ? parseInt(req.query.pageNumber as string, 10) : undefined;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : undefined;

    const result = await oracleService.getAuditHistory({
      product,
      businessObjectType,
      fromDate,
      toDate,
      username,
      action,
      pageNumber,
      pageSize
    });

    res.json({
      ...result,
      auditUnavailable: false,
      ...oracleService.getModeInfo()
    });
  } catch (err) {
    console.error('[API Router] Audit logs failed:', err);
    res.json({
      success: false,
      logs: [],
      auditUnavailable: true,
      message: (err as Error).message || String(err),
      ...oracleService.getModeInfo()
    });
  }
});

apiRouter.post('/audit/query', requirePrivilege(['AUDIT_TRAIL', 'AUDIT_READ']), async (req: Request, res: Response) => {
  try {
    const {
      product,
      businessObjectType,
      fromDate,
      toDate,
      username,
      action,
      pageNumber,
      pageSize
    } = req.body || {};

    const result = await oracleService.getAuditHistory({
      product,
      businessObjectType,
      fromDate,
      toDate,
      username,
      action,
      pageNumber,
      pageSize
    });

    res.json({
      ...result,
      auditUnavailable: false,
      ...oracleService.getModeInfo()
    });
  } catch (err) {
    console.error('[API Router] Audit query failed:', err);
    res.json({
      success: false,
      logs: [],
      auditUnavailable: true,
      message: (err as Error).message || String(err),
      ...oracleService.getModeInfo()
    });
  }
});

// ==========================================
// 6. Risk Dashboard APIs (AC5, AC7, AC8: Audit User blocked)
// ==========================================

apiRouter.get('/risk/access-requests', requirePrivilege(['RISK_MANAGEMENT', 'RISK_READ']), async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
    const status = req.query.status as string | undefined;
    const user = req.query.user as string | undefined;
    const result = await oracleService.getAdvancedAccessRequests({ limit, offset, status, user });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.get('/risk/access-requests/:id', requirePrivilege(['RISK_MANAGEMENT', 'RISK_READ']), async (req: Request, res: Response) => {
  try {
    const result = await oracleService.getAccessRequestById(req.params.id);
    if (!result.item) {
      return res.status(404).json({ error: 'Access request not found' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.get('/risk/controls', requirePrivilege(['RISK_MANAGEMENT', 'RISK_READ']), async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
    const forceRefresh = req.query.refresh === 'true';
    const result = await oracleService.getAdvancedControls({ limit, offset, forceRefresh });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

apiRouter.post('/risk/controls/refresh', requirePrivilege(['RISK_MANAGEMENT', 'RISK_READ']), async (req: Request, res: Response) => {
  try {
    const result = await oracleService.getAdvancedControls({ forceRefresh: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// GET /risk/controls/counts - Retrieve all cached incident counts and sync stale in background
apiRouter.get('/risk/controls/counts', requirePrivilege(['RISK_MANAGEMENT', 'RISK_READ']), async (req: Request, res: Response) => {
  try {
    const counts = oracleService.getIncidentCounts();
    res.json({ success: true, counts });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

apiRouter.get('/risk/controls/:id', requirePrivilege(['RISK_MANAGEMENT', 'RISK_READ']), async (req: Request, res: Response) => {
  try {
    const controlId = req.params.id;
    const forceRefresh = req.query.refresh === 'true';
    const result = await oracleService.getAdvancedControlDetail(controlId, { forceRefresh });
    if (!result.success && !result.control) {
      return res.status(404).json({
        success: false,
        message: result.message || 'Unable to retrieve control details from Oracle Fusion.'
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Unable to retrieve control details from Oracle Fusion.'
    });
  }
});

// GET /risk/controls/:id/incidents - Fast paginated incident retrieval (default 25 rows)
apiRouter.get('/risk/controls/:id/incidents', requirePrivilege(['RISK_MANAGEMENT', 'RISK_READ']), async (req: Request, res: Response) => {
  try {
    const controlId = req.params.id;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 25;
    const forceRefresh = req.query.refresh === 'true';

    const result = await oracleService.getControlIncidentsPage(controlId, {
      page,
      limit,
      forceRefresh
    });

    if (!result.success) {
      return res.status(500).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      message: (err as Error).message || 'Unable to retrieve incidents from Oracle Fusion.'
    });
  }
});

// GET /risk/controls/:id/count - Authoritative incident count from lightweight cache or live Oracle
apiRouter.get('/risk/controls/:id/count', requirePrivilege(['RISK_MANAGEMENT', 'RISK_READ']), async (req: Request, res: Response) => {
  try {
    const controlId = req.params.id;
    const forceRefresh = req.query.refresh === 'true';
    const result = await oracleService.getControlIncidentCount(controlId, forceRefresh);
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: (err as Error).message || 'Unable to retrieve incident count from Oracle Fusion.'
    });
  }
});

// GET /risk/reports/control-summary - Fast, scalable Control Summary reporting endpoint
apiRouter.get('/risk/reports/control-summary', requirePrivilege(['RISK_MANAGEMENT', 'RISK_READ']), async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const scan = req.query.scan === 'true';
    const result = await oracleService.getControlSummaryReport({ forceRefresh, scan });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

apiRouter.get('/risk/reports/control-summary/:id', requirePrivilege(['RISK_MANAGEMENT', 'RISK_READ']), async (req: Request, res: Response) => {
  try {
    const controlId = req.params.id;
    const result = await oracleService.scanSingleControlIncidentCount(controlId);
    res.json({ success: true, scan: result });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

apiRouter.post('/risk/reports/control-summary/scan', requirePrivilege(['RISK_MANAGEMENT', 'RISK_READ']), async (req: Request, res: Response) => {
  try {
    const result = await oracleService.getControlSummaryReport({ scan: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

apiRouter.get('/risk/capabilities', requirePrivilege(['RISK_MANAGEMENT', 'RISK_READ']), (req: Request, res: Response) => {
  try {
    const capabilities = oracleService.getRiskCapabilities();
    res.json({ success: true, capabilities });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.get('/risk/incidents', requirePrivilege(['RISK_MANAGEMENT', 'RISK_READ']), async (req: Request, res: Response) => {
  try {
    const controlId = req.query.controlId as string | undefined;
    const forceRefresh = req.query.refresh === 'true';
    const result = await oracleService.getRiskIncidents({ controlId, forceRefresh });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/risk/sod', requirePrivilege(['RISK_MANAGEMENT', 'RISK_READ']), async (req: Request, res: Response) => {
  try {
    const result = await oracleService.getSoDConflicts();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.get('/access-certifications', requirePrivilege(['REPORTS', 'REPORTS_READ', 'AUDIT_TRAIL']), async (req: Request, res: Response) => {
  try {
    const result = await oracleService.getAccessCertifications();
    if (!result.success) {
      const statusCode = result.isConfigurationError ? 400 : 502;
      return res.status(statusCode).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error('[Access Certifications API Error]:', (err as Error).message);
    return res.status(500).json({
      success: false,
      message: 'Unable to retrieve Access Certification data from Oracle Fusion.'
    });
  }
});

apiRouter.get('/access-certifications/:certificationId/details', requirePrivilege(['REPORTS', 'REPORTS_READ', 'AUDIT_TRAIL']), async (req: Request, res: Response) => {
  const certificationId = String(req.params.certificationId || '').trim();
  if (!certificationId) {
    return res.status(400).json({
      success: false,
      certificationId: '',
      message: 'Certification ID is required.'
    });
  }

  try {
    const result = await oracleService.getAccessCertificationDetails(certificationId);
    if (!result.success) {
      const statusCode = result.isConfigurationError ? 400 : 502;
      return res.status(statusCode).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error(`[Access Certification Drill-Down Error for ${certificationId}]:`, (err as Error).message);
    return res.status(500).json({
      success: false,
      certificationId,
      message: 'Unable to retrieve Access Certification details.',
      error: (err as Error).message
    });
  }
});

apiRouter.get('/risk/certifications', requirePrivilege(['REPORTS', 'REPORTS_READ', 'AUDIT_TRAIL']), async (req: Request, res: Response) => {
  try {
    const result = await oracleService.getAccessCertifications();
    if (!result.success) {
      const statusCode = result.isConfigurationError ? 400 : 502;
      return res.status(statusCode).json(result);
    }
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Unable to retrieve Access Certification data from Oracle Fusion.'
    });
  }
});

// ==========================================
// Role & Privilege Intelligence Catalog APIs (AC5, AC7, AC8: Audit User blocked)
// ==========================================

// Get Catalog Metadata (status, counts, instance, last sync)
apiRouter.get('/catalog/role-privileges', requirePrivilege(['ROLES_CATALOG', 'ROLE_READ']), (req: Request, res: Response) => {
  try {
    const meta = rolePrivilegeCatalogService.getMetadata();
    res.json({ success: true, catalog: meta });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Trigger Background Catalog Synchronization (Admin only)
apiRouter.post('/catalog/role-privileges/sync', requireAdmin, async (req: Request, res: Response) => {
  try {
    logAudit(res.locals.email || 'SYSTEM', 'CATALOG_SYNC_TRIGGERED', 'Role & Privilege catalog sync started in background');
    const result = await rolePrivilegeCatalogService.syncCatalogInBackground(oracleService);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Reverse Lookup: Privilege -> Roles (OTBI Authoritative Source)
apiRouter.get('/catalog/role-privileges/roles-by-privilege', requirePrivilege(['ROLES_CATALOG', 'ROLE_READ']), (req: Request, res: Response) => {
  try {
    const privilege = (req.query.privilege as string) || '';
    if (!privilege) {
      return res.status(400).json({ success: false, message: 'Query parameter "privilege" is required.' });
    }
    const result = privilegeRoleCatalogService.getRolesByPrivilege(privilege);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Dedicated Privilege -> Roles API
apiRouter.get('/privilege-roles', requirePrivilege(['ROLES_CATALOG', 'ROLE_READ']), (req: Request, res: Response) => {
  try {
    const query = (req.query.query as string) || (req.query.privilege as string) || '';
    if (!query) {
      return res.status(400).json({ success: false, message: 'Query parameter "query" or "privilege" is required.' });
    }
    const result = privilegeRoleCatalogService.getRolesByPrivilege(query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/privilege-roles/metadata', requirePrivilege(['ROLES_CATALOG', 'ROLE_READ']), (_req: Request, res: Response) => {
  try {
    res.json(privilegeRoleCatalogService.getMetadata());
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/privilege-roles/sync', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const syncResult = await privilegeRoleCatalogService.syncFromOtbi();
    res.json(syncResult);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Forward Lookup: Role -> Privileges
apiRouter.get('/catalog/role-privileges/privileges-by-role', requirePrivilege(['ROLES_CATALOG', 'ROLE_READ']), (req: Request, res: Response) => {
  try {
    const role = (req.query.role as string) || '';
    if (!role) {
      return res.status(400).json({ success: false, message: 'Query parameter "role" is required.' });
    }
    const result = rolePrivilegeCatalogService.getPrivilegesByRole(role);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// =========================================================
// AC6: Oracle Fusion API Operations & Diagnostics Command Center (Site Admin only)
// =========================================================

// POST /command-center/request - Execute an API request against Oracle Fusion safely
apiRouter.post('/command-center/request', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { method, url, params, headers, body, authMode, timeoutMs } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, message: 'Request URL or endpoint path is required.' });
    }
    const result = await commandCenterService.executeRequest({
      method: method || 'GET',
      url,
      params,
      headers,
      body,
      authMode,
      timeoutMs
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({
      success: false,
      status: 400,
      statusText: 'Validation / Security Rejection',
      responseTimeMs: 0,
      responseSizeBytes: 0,
      responseSizeFormatted: '0 B',
      timestamp: new Date().toISOString(),
      headers: {},
      data: { error: err.message },
      requestUrl: req.body?.url || '',
      diagnostic: {
        category: 'BAD_REQUEST',
        title: 'Request Rejected',
        message: err.message,
        severity: 'error'
      }
    });
  }
});

// POST /command-center/test-connection - Real connection health probe
apiRouter.post('/command-center/test-connection', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await commandCenterService.testConnection();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({
      connected: false,
      status: 0,
      responseTimeMs: 0,
      timestamp: new Date().toISOString(),
      message: err.message || 'Connection test failed.',
      baseUrl: ''
    });
  }
});

// GET /command-center/catalog - Pre-defined categorized catalog of Oracle Fusion APIs
apiRouter.get('/command-center/catalog', requireAdmin, (_req: Request, res: Response) => {
  try {
    const catalog = commandCenterService.getCatalog();
    res.json({ success: true, catalog, baseUrl: config.oracle.baseUrl });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /command-center/history - Execution history
apiRouter.get('/command-center/history', requireAdmin, (_req: Request, res: Response) => {
  try {
    const history = commandCenterService.getHistory();
    res.json({ success: true, history });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /command-center/history - Clear execution history
apiRouter.delete('/command-center/history', requireAdmin, (_req: Request, res: Response) => {
  try {
    commandCenterService.clearHistory();
    res.json({ success: true, message: 'Oracle API Console history cleared.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /command-center/saved-requests - List saved requests / collections
apiRouter.get('/command-center/saved-requests', requireAdmin, (_req: Request, res: Response) => {
  try {
    const saved = commandCenterService.getSavedRequests();
    res.json({ success: true, items: saved });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /command-center/saved-requests - Save a request template
apiRouter.post('/command-center/saved-requests', requireAdmin, (req: Request, res: Response) => {
  try {
    const { name, category, description, method, url, params, headers, body, id } = req.body;
    if (!name || !url) {
      return res.status(400).json({ success: false, message: 'Name and URL are required to save a request.' });
    }
    const saved = commandCenterService.saveRequest({
      id,
      name,
      category: category || 'Custom Collections',
      description,
      method: method || 'GET',
      url,
      params,
      headers,
      body
    });
    res.json({ success: true, item: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// DELETE /command-center/saved-requests/:id - Delete a saved request template
apiRouter.delete('/command-center/saved-requests/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    const success = commandCenterService.deleteSavedRequest(req.params.id);
    res.json({ success, message: success ? 'Saved request deleted.' : 'Item not found.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
