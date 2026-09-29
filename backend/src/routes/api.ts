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
  const logMessage = `[${timestamp}] User: ${username} | Action: ${action} | Details: ${details}\n`;
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
      username,
      businessObject: action.includes('USER') || action.includes('ACCOUNT') ? `User: ${details.split(' ').pop() || username}` : 'Security Administration',
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

// Middleware to enforce backend admin authorization
export function requireAdmin(req: Request, res: Response, next: () => void) {
  requireAuth(req, res, () => {
    if (!res.locals.isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied. Authorized administrators only.' });
    }
    next();
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
apiRouter.post('/auth/refresh', requireAuth, (req: Request, res: Response) => {
  logAudit(res.locals.email, 'SESSION_REFRESH', 'User requested session keep-alive refresh');
  res.json({
    success: true,
    message: 'Session activity refreshed successfully.',
    lastActivityAt: Date.now()
  });
});

// POST /auth/logout - Sign Out User & Invalidate Session (AC5, AC6, AC9)
apiRouter.post('/auth/logout', async (req: Request, res: Response) => {
  const authHeader = req.header('Authorization');
  let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.body?.token || req.body?.sessionId);
  if (!token) {
    return res.status(400).json({ success: false, message: 'Missing token for logout.' });
  }

  const validation = await authService.validateSession(token, false);
  const email = validation.session?.email || 'Unknown User';
  await authService.logout(token);
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
      config.environmentMode = mode;
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

// 1.8 Overview Statistics API with in-memory caching
let cachedStatsResult: { data: any; expiresAt: number } | null = null;

apiRouter.get('/overview/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    if (cachedStatsResult && Date.now() < cachedStatsResult.expiresAt) {
      return res.json(cachedStatsResult.data);
    }
    const statsResult = await tools.SECURITY_STATISTICS({});
    cachedStatsResult = { data: statsResult, expiresAt: Date.now() + 60 * 1000 };
    res.json(statsResult);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 2. Chat / NLU Assistant API
apiRouter.post('/chat', requireAuth, async (req: Request, res: Response) => {
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

// 3. User Data APIs
apiRouter.get('/users', requireAuth, async (req: Request, res: Response) => {
  try {
    const filter = req.query.filter as string | undefined;
    const startIndex = req.query.startIndex ? parseInt(req.query.startIndex as string, 10) : (req.query.page && req.query.limit ? (parseInt(req.query.page as string, 10) - 1) * parseInt(req.query.limit as string, 10) + 1 : 1);
    const count = req.query.count ? parseInt(req.query.count as string, 10) : (req.query.limit ? parseInt(req.query.limit as string, 10) : 50);
    const result = await oracleService.getUsers({ filterText: filter, startIndex, count });
    res.json({ ...result, ...oracleService.getModeInfo() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.get('/users/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await oracleService.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user, ...oracleService.getModeInfo() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 4. Role Data APIs
apiRouter.get('/roles', requireAuth, async (req: Request, res: Response) => {
  try {
    const filter = req.query.filter as string | undefined;
    const category = req.query.category as string | undefined;
    const startIndex = req.query.startIndex ? parseInt(req.query.startIndex as string, 10) : (req.query.page && req.query.limit ? (parseInt(req.query.page as string, 10) - 1) * parseInt(req.query.limit as string, 10) + 1 : 1);
    const count = req.query.count ? parseInt(req.query.count as string, 10) : (req.query.limit ? parseInt(req.query.limit as string, 10) : 50);
    const result = await oracleService.getRoles({ filterText: filter, category, startIndex, count });
    res.json({ ...result, ...oracleService.getModeInfo() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Single Role Lookup Endpoint (Fast In-Memory 0ms, avoids downloading entire /api/roles list)
apiRouter.get('/roles/single', requireAuth, async (req: Request, res: Response) => {
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

// Assigned Role Members Endpoint (Batched User Lookup, no N+1)
apiRouter.get('/roles/:name/members', requireAuth, async (req: Request, res: Response) => {
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
apiRouter.get('/roles/validation', requireAuth, async (req: Request, res: Response) => {
  try {
    const validation = oracleService.validateRoleCounts();
    res.json(validation);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Authoritative Role Dataset Sync Endpoint
apiRouter.post('/roles/sync', requireAuth, async (req: Request, res: Response) => {
  try {
    const syncResult = await oracleService.syncAuthoritativeRoles();
    res.json(syncResult);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.get('/reports/role-hierarchy', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await oracleService.getRoleHierarchyReport();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.get('/reports/user-access', requireAuth, async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const result = await userAccessReportService.getUserAccessReport(forceRefresh);
    res.json(result);
  } catch (err) {
    console.error('[API Route /reports/user-access] Error:', err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/roles/:name/hierarchy', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await oracleService.getRoleHierarchy(req.params.name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.get('/roles/:name/privileges', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await oracleService.getPrivilegesForRole(req.params.name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 5. Audit logs API
apiRouter.get('/audit/products', requireAuth, (req: Request, res: Response) => {
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

apiRouter.get('/audit', requireAuth, async (req: Request, res: Response) => {
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

apiRouter.post('/audit/query', requireAuth, async (req: Request, res: Response) => {
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

// 6. Risk Dashboard APIs
apiRouter.get('/risk/access-requests', requireAuth, async (req: Request, res: Response) => {
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

apiRouter.get('/risk/access-requests/:id', requireAuth, async (req: Request, res: Response) => {
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

apiRouter.get('/risk/controls', requireAuth, async (req: Request, res: Response) => {
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

apiRouter.post('/risk/controls/refresh', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await oracleService.getAdvancedControls({ forceRefresh: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

apiRouter.get('/risk/controls/:id', requireAuth, async (req: Request, res: Response) => {
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

// GET /risk/reports/control-summary - Fast, scalable Control Summary reporting endpoint
apiRouter.get('/risk/reports/control-summary', requireAuth, async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const scan = req.query.scan === 'true';
    const result = await oracleService.getControlSummaryReport({ forceRefresh, scan });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// GET /risk/reports/control-summary/:id - Single control incident count probe
apiRouter.get('/risk/reports/control-summary/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const controlId = req.params.id;
    const result = await oracleService.scanSingleControlIncidentCount(controlId);
    res.json({ success: true, scan: result });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// POST /risk/reports/control-summary/scan - Trigger lightweight count scan across unscanned controls
apiRouter.post('/risk/reports/control-summary/scan', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await oracleService.getControlSummaryReport({ scan: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});


apiRouter.get('/risk/capabilities', requireAuth, (req: Request, res: Response) => {
  try {
    const capabilities = oracleService.getRiskCapabilities();
    res.json({ success: true, capabilities });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.get('/risk/incidents', requireAuth, async (req: Request, res: Response) => {
  try {
    const controlId = req.query.controlId as string | undefined;
    const forceRefresh = req.query.refresh === 'true';
    const result = await oracleService.getRiskIncidents({ controlId, forceRefresh });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/risk/sod', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await oracleService.getSoDConflicts();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/access-certifications - Oracle Fusion BI Publisher Access Certification Report
apiRouter.get('/access-certifications', requireAuth, async (req: Request, res: Response) => {
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

// GET /api/access-certifications/:certificationId/details - Oracle Fusion BI Publisher Certifier Worksheet Drill-Down
apiRouter.get('/access-certifications/:certificationId/details', requireAuth, async (req: Request, res: Response) => {
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

// Backward-compatible alias for /risk/certifications
apiRouter.get('/risk/certifications', requireAuth, async (req: Request, res: Response) => {
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
// Role & Privilege Intelligence Catalog APIs
// ==========================================

// Get Catalog Metadata (status, counts, instance, last sync)
apiRouter.get('/catalog/role-privileges', requireAuth, (req: Request, res: Response) => {
  try {
    const meta = rolePrivilegeCatalogService.getMetadata();
    res.json({ success: true, catalog: meta });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Trigger Background Catalog Synchronization
apiRouter.post('/catalog/role-privileges/sync', requireAuth, async (req: Request, res: Response) => {
  try {
    logAudit(res.locals.email || 'SYSTEM', 'CATALOG_SYNC_TRIGGERED', 'Role & Privilege catalog sync started in background');
    const result = await rolePrivilegeCatalogService.syncCatalogInBackground(oracleService);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Reverse Lookup: Privilege -> Roles (OTBI Authoritative Source)
apiRouter.get('/catalog/role-privileges/roles-by-privilege', requireAuth, (req: Request, res: Response) => {
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
apiRouter.get('/privilege-roles', requireAuth, (req: Request, res: Response) => {
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

apiRouter.get('/privilege-roles/metadata', requireAuth, (_req: Request, res: Response) => {
  try {
    res.json(privilegeRoleCatalogService.getMetadata());
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/privilege-roles/sync', requireAuth, async (_req: Request, res: Response) => {
  try {
    const syncResult = await privilegeRoleCatalogService.syncFromOtbi();
    res.json(syncResult);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Forward Lookup: Role -> Privileges
apiRouter.get('/catalog/role-privileges/privileges-by-role', requireAuth, (req: Request, res: Response) => {
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
// 8. Oracle Fusion API Operations & Diagnostics Command Center
// =========================================================

// POST /command-center/request - Execute an API request against Oracle Fusion safely
apiRouter.post('/command-center/request', requireAuth, async (req: Request, res: Response) => {
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
apiRouter.post('/command-center/test-connection', requireAuth, async (_req: Request, res: Response) => {
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
apiRouter.get('/command-center/catalog', requireAuth, (_req: Request, res: Response) => {
  try {
    const catalog = commandCenterService.getCatalog();
    res.json({ success: true, catalog, baseUrl: config.oracle.baseUrl });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /command-center/history - Execution history
apiRouter.get('/command-center/history', requireAuth, (_req: Request, res: Response) => {
  try {
    const history = commandCenterService.getHistory();
    res.json({ success: true, history });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /command-center/history - Clear execution history
apiRouter.delete('/command-center/history', requireAuth, (_req: Request, res: Response) => {
  try {
    commandCenterService.clearHistory();
    res.json({ success: true, message: 'Oracle API Console history cleared.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /command-center/saved-requests - List saved requests / collections
apiRouter.get('/command-center/saved-requests', requireAuth, (_req: Request, res: Response) => {
  try {
    const saved = commandCenterService.getSavedRequests();
    res.json({ success: true, items: saved });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /command-center/saved-requests - Save a request template
apiRouter.post('/command-center/saved-requests', requireAuth, (req: Request, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /command-center/saved-requests/:id - Delete a saved request template
apiRouter.delete('/command-center/saved-requests/:id', requireAuth, (req: Request, res: Response) => {
  try {
    const success = commandCenterService.deleteSavedRequest(req.params.id);
    res.json({ success, message: success ? 'Saved request deleted.' : 'Item not found.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
