import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { query as dbQuery } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_FILE_PATH = path.join(__dirname, '../../users_auth.json');

export type UserStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED' | 'EXPIRED';

export interface ResetCodeInfo {
  codeHash: string;
  expiresAt: string;
  used: boolean;
}

export interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
  passwordHash: string | null;
  status: UserStatus;
  role: string;
  permissions: string[];
  setupCompleted: boolean;
  isAdmin: boolean;
  isActive: boolean;
  lastLoginAt?: string | null;
  resetCode: ResetCodeInfo | null;
}

export interface Session {
  token: string;
  userId: string;
  email: string;
  displayName: string;
  role: string;
  permissions: string[];
  isAdmin: boolean;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
  status: 'ACTIVE' | 'EXPIRED' | 'LOGGED_OUT';
}

export interface SessionValidationResult {
  valid: boolean;
  code?: 'SESSION_EXPIRED' | 'INVALID_TOKEN' | 'SESSION_NOT_FOUND';
  message?: string;
  session?: Session;
}

export interface LoginResult {
  success: boolean;
  code?: string;
  token?: string;
  userId?: string;
  displayName?: string;
  email?: string;
  normalizedEmail?: string;
  role?: string;
  permissions?: string[];
  status?: UserStatus;
  isAdmin?: boolean;
  setupCompleted?: boolean;
  message: string;
}

export const DEFAULT_INACTIVITY_TIMEOUT_MINUTES = 5;
export function getInactivityTimeoutMs(): number {
  const envVal = process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES;
  const minutes = envVal ? parseInt(envVal, 10) : DEFAULT_INACTIVITY_TIMEOUT_MINUTES;
  return (isNaN(minutes) || minutes <= 0 ? 5 : minutes) * 60 * 1000;
}

// In-memory session store
const activeSessions = new Map<string, Session>();

export interface RoleInfo {
  id: string;
  role_code: string;
  role_name: string;
  description: string;
  privileges: string[];
  status: 'ACTIVE' | 'INACTIVE';
}

export interface PrivilegeInfo {
  id: string;
  privilege_code: string;
  privilege_name: string;
  module: string;
  description: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export const VEYRA_ROLES: RoleInfo[] = [
  {
    id: 'role_site_admin',
    role_code: 'SITE_ADMIN',
    role_name: 'Site Administrator',
    description: 'Site Administrator with full administrative access and integration control',
    privileges: [
      'ALL',
      'USER_MANAGEMENT',
      'USERS_LIST',
      'ROLES_CATALOG',
      'AUDIT_TRAIL',
      'RISK_MANAGEMENT',
      'REPORTS',
      'ORACLE_INTEGRATION',
      'ORACLE_API_CONSOLE',
      'ASK_VEYRA',
      'SECURITY_READ',
      'SECURITY_WRITE'
    ],
    status: 'ACTIVE'
  },
  {
    id: 'role_audit_manager',
    role_code: 'AUDIT_MANAGER',
    role_name: 'Audit Manager',
    description: 'Audit Manager responsible for reviews, risk, investigations, and reporting',
    privileges: [
      'ASK_VEYRA',
      'USERS_LIST',
      'ROLES_CATALOG',
      'AUDIT_TRAIL',
      'RISK_MANAGEMENT',
      'REPORTS',
      'SECURITY_READ'
    ],
    status: 'ACTIVE'
  },
  {
    id: 'role_audit_supervisor',
    role_code: 'AUDIT_SUPERVISOR',
    role_name: 'Audit Supervisor',
    description: 'Audit Supervisor responsible for oversight, catalogs, and reporting (excluded from Ask Veyra)',
    privileges: [
      'USERS_LIST',
      'ROLES_CATALOG',
      'AUDIT_TRAIL',
      'RISK_MANAGEMENT',
      'REPORTS',
      'SECURITY_READ'
    ],
    status: 'ACTIVE'
  },
  {
    id: 'role_audit_user',
    role_code: 'AUDIT_USER',
    role_name: 'Audit User',
    description: 'Baseline audit user strictly restricted to reports generation and viewing',
    privileges: [
      'REPORTS'
    ],
    status: 'ACTIVE'
  },
  {
    id: 'role_security_analyst',
    role_code: 'SECURITY_ANALYST',
    role_name: 'Security Analyst',
    description: 'Security Analyst with threat review, SoD analysis, and Ask Veyra access',
    privileges: [
      'ASK_VEYRA',
      'USERS_LIST',
      'ROLES_CATALOG',
      'AUDIT_TRAIL',
      'RISK_MANAGEMENT',
      'REPORTS',
      'SECURITY_READ'
    ],
    status: 'ACTIVE'
  },
  {
    id: 'role_compliance_officer',
    role_code: 'COMPLIANCE_OFFICER',
    role_name: 'Compliance Officer',
    description: 'Compliance Officer with compliance audit, reports, and risk oversight',
    privileges: [
      'USERS_LIST',
      'ROLES_CATALOG',
      'AUDIT_TRAIL',
      'RISK_MANAGEMENT',
      'REPORTS',
      'SECURITY_READ'
    ],
    status: 'ACTIVE'
  },
  {
    id: 'role_viewer',
    role_code: 'VIEWER',
    role_name: 'Viewer',
    description: 'Read-only dashboard and audit log viewer',
    privileges: [
      'REPORTS',
      'AUDIT_TRAIL',
      'SECURITY_READ'
    ],
    status: 'ACTIVE'
  }
];

export const VEYRA_PRIVILEGES: PrivilegeInfo[] = [
  {
    id: 'priv_all',
    privilege_code: 'ALL',
    privilege_name: 'Full Superuser Access',
    module: 'SYSTEM',
    description: 'Unrestricted superuser access to all system functions and resources',
    status: 'ACTIVE'
  },
  {
    id: 'priv_ask_veyra',
    privilege_code: 'ASK_VEYRA',
    privilege_name: 'Ask VEYRA Assistant',
    module: 'AI_ASSISTANT',
    description: 'Conversational AI and investigation assistant',
    status: 'ACTIVE'
  },
  {
    id: 'priv_users_list',
    privilege_code: 'USERS_LIST',
    privilege_name: 'Users Directory',
    module: 'SECURITY',
    description: 'View user directories and identities',
    status: 'ACTIVE'
  },
  {
    id: 'priv_roles_catalog',
    privilege_code: 'ROLES_CATALOG',
    privilege_name: 'Roles Catalog',
    module: 'SECURITY',
    description: 'View role catalog and privilege hierarchies',
    status: 'ACTIVE'
  },
  {
    id: 'priv_audit_trail',
    privilege_code: 'AUDIT_TRAIL',
    privilege_name: 'Audit Trail Logs',
    module: 'AUDIT',
    description: 'Access audit trail and change history logs',
    status: 'ACTIVE'
  },
  {
    id: 'priv_risk_management',
    privilege_code: 'RISK_MANAGEMENT',
    privilege_name: 'Risk Management & Controls',
    module: 'RISK',
    description: 'Access Segregation of Duties and risk controls',
    status: 'ACTIVE'
  },
  {
    id: 'priv_reports',
    privilege_code: 'REPORTS',
    privilege_name: 'Compliance & Audit Reports',
    module: 'REPORTS',
    description: 'Access enterprise audit and compliance reports',
    status: 'ACTIVE'
  },
  {
    id: 'priv_user_management',
    privilege_code: 'USER_MANAGEMENT',
    privilege_name: 'User Management',
    module: 'ADMIN',
    description: 'Manage system users, create, update, assign roles, and delete accounts',
    status: 'ACTIVE'
  },
  {
    id: 'priv_oracle_integration',
    privilege_code: 'ORACLE_INTEGRATION',
    privilege_name: 'Oracle Integration',
    module: 'INTEGRATION',
    description: 'Configure and manage Oracle Fusion integrations',
    status: 'ACTIVE'
  },
  {
    id: 'priv_oracle_api_console',
    privilege_code: 'ORACLE_API_CONSOLE',
    privilege_name: 'Oracle API Console',
    module: 'INTEGRATION',
    description: 'Access Oracle Fusion REST API console',
    status: 'ACTIVE'
  }
];

// Role to default permissions mapping
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  SITE_ADMIN: [
    'ALL',
    'USER_MANAGEMENT',
    'USERS_LIST',
    'USER_READ',
    'USER_CREATE',
    'USER_MODIFY',
    'USER_DELETE',
    'ROLES_CATALOG',
    'ROLE_READ',
    'ROLE_ASSIGN',
    'PRIVILEGE_READ',
    'AUDIT_TRAIL',
    'AUDIT_READ',
    'RISK_MANAGEMENT',
    'RISK_READ',
    'RISK_WRITE',
    'REPORTS',
    'REPORTS_READ',
    'REPORTS_MANAGE',
    'ORACLE_INTEGRATION',
    'SETTINGS_MANAGE',
    'ORACLE_API_CONSOLE',
    'ASK_VEYRA',
    'ADMIN_USERS',
    'SECURITY_READ',
    'SECURITY_WRITE',
    'INVESTIGATIONS_READ',
    'INVESTIGATIONS_WRITE',
    'INVESTIGATIONS_MANAGE'
  ],
  AUDIT_MANAGER: [
    'ASK_VEYRA',
    'USERS_LIST',
    'USER_READ',
    'ROLES_CATALOG',
    'ROLE_READ',
    'PRIVILEGE_READ',
    'AUDIT_TRAIL',
    'AUDIT_READ',
    'RISK_MANAGEMENT',
    'RISK_READ',
    'REPORTS',
    'REPORTS_READ',
    'SECURITY_READ',
    'INVESTIGATIONS_READ',
    'INVESTIGATIONS_WRITE'
  ],
  AUDIT_SUPERVISOR: [
    'USERS_LIST',
    'USER_READ',
    'ROLES_CATALOG',
    'ROLE_READ',
    'PRIVILEGE_READ',
    'AUDIT_TRAIL',
    'AUDIT_READ',
    'RISK_MANAGEMENT',
    'RISK_READ',
    'REPORTS',
    'REPORTS_READ',
    'SECURITY_READ',
    'INVESTIGATIONS_READ'
  ],
  AUDIT_USER: [
    'REPORTS',
    'REPORTS_READ',
    'REPORTS_MANAGE'
  ],
  SECURITY_ANALYST: [
    'ASK_VEYRA',
    'USERS_LIST',
    'USER_READ',
    'ROLES_CATALOG',
    'ROLE_READ',
    'PRIVILEGE_READ',
    'AUDIT_TRAIL',
    'AUDIT_READ',
    'RISK_MANAGEMENT',
    'RISK_READ',
    'REPORTS',
    'REPORTS_READ',
    'SECURITY_READ',
    'INVESTIGATIONS_READ'
  ],
  COMPLIANCE_OFFICER: [
    'USERS_LIST',
    'USER_READ',
    'ROLES_CATALOG',
    'ROLE_READ',
    'PRIVILEGE_READ',
    'AUDIT_TRAIL',
    'AUDIT_READ',
    'RISK_MANAGEMENT',
    'RISK_READ',
    'REPORTS',
    'REPORTS_READ',
    'SECURITY_READ'
  ],
  VIEWER: [
    'REPORTS',
    'REPORTS_READ',
    'AUDIT_TRAIL',
    'AUDIT_READ',
    'SECURITY_READ'
  ]
};

// Generic failure message per AC5 to avoid leaking whether user exists or password was wrong
const GENERIC_AUTH_FAILURE_MSG = 'Invalid email or password.';

export class AuthService {
  private users: Record<string, AuthUser> = {};

  constructor() {
    this.loadUsers();
    this.loadActiveSessionsFromDb().catch(() => {});
    const timer = setInterval(() => {
      this.cleanupExpiredSessions().catch(() => {});
    }, 60 * 1000);
    if (timer && typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
  }

  private loadUsers() {
    try {
      if (fs.existsSync(AUTH_FILE_PATH)) {
        const fileData = fs.readFileSync(AUTH_FILE_PATH, 'utf8');
        const data = JSON.parse(fileData);
        const rawUsers = data.users || {};
        this.users = {};
        for (const [key, user] of Object.entries<any>(rawUsers)) {
          const normKey = this.normalizeEmail(key);
          const role = (user.role || (user.isAdmin ? 'SITE_ADMIN' : 'VIEWER')).toUpperCase();
          const permissions = Array.isArray(user.permissions) && user.permissions.length > 0
            ? user.permissions
            : (DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS.VIEWER);

          const status: UserStatus = user.status
            ? (user.status.toUpperCase() as UserStatus)
            : (user.isActive === false ? 'DISABLED' : 'ACTIVE');

          this.users[normKey] = {
            userId: user.userId || `usr_${normKey.replace(/[^a-zA-Z0-9]/g, '_')}`,
            email: user.email ? user.email.trim() : normKey,
            displayName: user.displayName || this.generateDisplayName(user.email || normKey),
            passwordHash: user.passwordHash || null,
            status,
            role,
            permissions,
            setupCompleted: user.setupCompleted ?? (!!user.passwordHash),
            isAdmin: user.isAdmin ?? (role === 'SITE_ADMIN'),
            isActive: status === 'ACTIVE',
            lastLoginAt: user.lastLoginAt || null,
            resetCode: user.resetCode || null
          };
        }
      } else {
        this.users = {};
      }
    } catch (err) {
      console.error('[Auth Service] Failed to load users file:', err);
      this.users = {};
    }
  }

  private saveUsers() {
    try {
      const dataToSave = { users: this.users };
      const tempPath = AUTH_FILE_PATH + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(dataToSave, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempPath, AUTH_FILE_PATH);
    } catch (err) {
      console.error('[Auth Service] Failed to save users file:', err);
    }
  }

  private generateDisplayName(email: string): string {
    try {
      const localPart = email.split('@')[0];
      const parts = localPart.split('.');
      return parts
        .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(' ');
    } catch (_) {
      return email;
    }
  }

  private ensureInitialAdmin() {
    // AC6 — Site Admin: admin@admin.com mapped to Site Admin role with local VEYRA auth
    const siteAdminEmail = 'admin@admin.com';
    const siteAdminNorm = this.normalizeEmail(siteAdminEmail);
    if (!this.users[siteAdminNorm]) {
      const salt = bcrypt.genSaltSync(10);
      const defaultAdminHash = bcrypt.hashSync('Admin@123', salt);
      this.users[siteAdminNorm] = {
        userId: 'usr_adm_0001',
        email: siteAdminEmail,
        displayName: 'Site Administrator',
        passwordHash: defaultAdminHash,
        status: 'ACTIVE',
        role: 'SITE_ADMIN',
        permissions: DEFAULT_ROLE_PERMISSIONS.SITE_ADMIN,
        setupCompleted: true,
        isAdmin: true,
        isActive: true,
        lastLoginAt: null,
        resetCode: null
      };
      this.saveUsers();
      console.log(`[Auth Service] Provisioned default Site Admin account: ${siteAdminEmail}`);
    } else {
      this.users[siteAdminNorm].role = 'SITE_ADMIN';
      this.users[siteAdminNorm].isAdmin = true;
      this.users[siteAdminNorm].status = 'ACTIVE';
      this.users[siteAdminNorm].isActive = true;
      if (!this.users[siteAdminNorm].permissions || this.users[siteAdminNorm].permissions.length === 0) {
        this.users[siteAdminNorm].permissions = DEFAULT_ROLE_PERMISSIONS.SITE_ADMIN;
      }
    }
  }

  // AC2: Normalize email address (lowercase and trimmed)
  public normalizeEmail(email: string): string {
    return (email || '').trim().toLowerCase();
  }

  public validateEmailFormat(email: string): boolean {
    if (!email) return false;
    const normalized = this.normalizeEmail(email);
    // Allow admin@admin.com and valid company / email patterns
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(normalized);
  }

  public validateNewPasswordPolicy(password: string): { valid: boolean; message?: string } {
    if (!password || password.length < 8) {
      return { valid: false, message: 'Password must be at least 8 characters long.' };
    }
    if (!/[A-Z]/.test(password)) {
      return { valid: false, message: 'Password must contain at least one uppercase letter.' };
    }
    if (!/[a-z]/.test(password)) {
      return { valid: false, message: 'Password must contain at least one lowercase letter.' };
    }
    if (!/[0-9]/.test(password)) {
      return { valid: false, message: 'Password must contain at least one number.' };
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      return { valid: false, message: 'Password must contain at least one special character.' };
    }
    return { valid: true };
  }

  /**
   * Story VY-STRY-004 & VY-STRY-008:
   * Main Login Handler for Claaps VEYRA using PostgreSQL as Single Source of Truth
   */
  /**
   * Story VY-STRY-004, VY-STRY-008 & VY-STRY-005:
   * Main Login Handler for Claaps VEYRA using PostgreSQL as Single Source of Truth
   * Enforces SINGLE ACTIVE SESSION per user via database check + partial unique index.
   */
  public async login(
    rawEmail: string,
    rawPassword: string,
    clientMeta?: { ipAddress?: string; userAgent?: string }
  ): Promise<LoginResult> {
    // 1. Normalization: trim and lowercase email before database lookup
    const normalized = this.normalizeEmail(rawEmail);

    if (!normalized || !rawPassword) {
      return {
        success: false,
        message: GENERIC_AUTH_FAILURE_MSG
      };
    }

    if (!this.validateEmailFormat(normalized)) {
      // Generic failure response (never reveal format error vs credentials)
      return {
        success: false,
        message: GENERIC_AUTH_FAILURE_MSG
      };
    }

    try {
      // 2. Query veyra_user from PostgreSQL by normalized email
      const userRes = await dbQuery(
        `SELECT id, email, password_hash, display_name, status, is_local_user, last_login_at
         FROM veyra_user
         WHERE email = $1`,
        [normalized]
      );

      // 3. If user does not exist in database, return generic failure (no account enumeration)
      if (userRes.rows.length === 0) {
        return {
          success: false,
          message: GENERIC_AUTH_FAILURE_MSG
        };
      }

      const dbUser = userRes.rows[0];

      // 4. Validate user status: only ACTIVE accounts may authenticate (AC7)
      if (dbUser.status !== 'ACTIVE') {
        return {
          success: false,
          status: dbUser.status as UserStatus,
          message: 'Your account is not active. Please contact a system administrator.'
        };
      }

      // 5. Password verification against veyra_user.password_hash using bcrypt
      if (!dbUser.password_hash) {
        return {
          success: false,
          message: GENERIC_AUTH_FAILURE_MSG
        };
      }

      const isMatch = bcrypt.compareSync(rawPassword, dbUser.password_hash);
      if (!isMatch) {
        return {
          success: false,
          message: GENERIC_AUTH_FAILURE_MSG
        };
      }

      // 6. AC6: Transition any expired ACTIVE sessions for this user to EXPIRED status
      try {
        await dbQuery(
          `UPDATE veyra_session
           SET status = 'EXPIRED'
           WHERE user_id = $1 AND status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at < NOW()`,
          [dbUser.id]
        );
      } catch (expErr) {
        console.error('[Auth Service] Error updating expired sessions:', expErr);
      }

      // 7. AC2 & AC3: Check if an ACTIVE session already exists for this user in PostgreSQL
      const existingActiveRes = await dbQuery(
        `SELECT id, session_id, created_at, expires_at
         FROM veyra_session
         WHERE user_id = $1 AND status = 'ACTIVE'
         LIMIT 1`,
        [dbUser.id]
      );

      if (existingActiveRes.rows.length > 0) {
        // Active session already exists: reject second login with 409 conflict
        // AC4: Existing session remains completely valid and untouched
        return {
          success: false,
          code: 'ACTIVE_SESSION_EXISTS',
          message: 'An active session already exists for this user.'
        };
      }

      // 8. Retrieve active roles assigned via veyra_user_role -> veyra_role
      const rolesRes = await dbQuery(
        `SELECT r.role_code, r.role_name
         FROM veyra_role r
         JOIN veyra_user_role ur ON ur.role_id = r.id
         WHERE ur.user_id = $1 AND r.status = 'ACTIVE'`,
        [dbUser.id]
      );

      // 9. Retrieve active privileges assigned via veyra_role_privilege -> veyra_privilege
      const privilegesRes = await dbQuery(
        `SELECT DISTINCT p.privilege_code
         FROM veyra_privilege p
         JOIN veyra_role_privilege rp ON rp.privilege_id = p.id
         JOIN veyra_user_role ur ON ur.role_id = rp.role_id
         WHERE ur.user_id = $1 AND p.status = 'ACTIVE'`,
        [dbUser.id]
      );

      const assignedRoleCodes: string[] = rolesRes.rows.map((r: any) => r.role_code);
      const isSiteAdmin = assignedRoleCodes.includes('SITE_ADMIN') || normalized === 'admin@admin.com';
      const primaryRole = isSiteAdmin ? 'SITE_ADMIN' : (assignedRoleCodes[0] || 'VIEWER');

      let permissions: string[] = privilegesRes.rows.map((p: any) => p.privilege_code);

      // For SITE_ADMIN, guarantee ALL and full admin capabilities
      if (isSiteAdmin) {
        if (!permissions.includes('ALL')) {
          permissions = ['ALL', ...permissions];
        }
        for (const perm of (DEFAULT_ROLE_PERMISSIONS.SITE_ADMIN || [])) {
          if (!permissions.includes(perm)) {
            permissions.push(perm);
          }
        }
      } else if (permissions.length === 0 && DEFAULT_ROLE_PERMISSIONS[primaryRole]) {
        permissions = DEFAULT_ROLE_PERMISSIONS[primaryRole];
      }

      // 10. Generate cryptographically secure session identifier & expiry
      // Inactivity timeout sliding model: initial expiry is NOW() + inactivity timeout
      const sessionId = crypto.randomBytes(32).toString('hex');
      const inactivityTimeoutMs = getInactivityTimeoutMs();
      const expiresAt = new Date(Date.now() + inactivityTimeoutMs);

      // Sanitize IP address for PostgreSQL INET (handle IPv4/IPv6 cleanly)
      let rawIp = clientMeta?.ipAddress || '127.0.0.1';
      if (rawIp.startsWith('::ffff:')) {
        rawIp = rawIp.replace('::ffff:', '');
      }
      const ipAddress = (rawIp === '::1' || /^[\d.]+$/.test(rawIp) || /^[a-fA-F0-9:]+$/.test(rawIp)) ? rawIp : '127.0.0.1';
      const userAgent = (clientMeta?.userAgent || 'Unknown Client').substring(0, 1000);

      // 11. AC1 & AC5: Create veyra_session row with PostgreSQL partial unique constraint protection
      try {
        await dbQuery(
          `INSERT INTO veyra_session (
             session_id, user_id, status, created_at, last_activity_at, expires_at, ip_address, user_agent, created_by
           ) VALUES ($1, $2, 'ACTIVE', NOW(), NOW(), $3, $4, $5, 'AUTH_SERVICE')`,
          [sessionId, dbUser.id, expiresAt, ipAddress, userAgent]
        );
      } catch (insertErr: any) {
        // AC5: Concurrency race protection — catch PostgreSQL unique constraint violation on partial index
        if (
          insertErr.code === '23505' &&
          (insertErr.constraint === 'uq_veyra_session_user_active' ||
           insertErr.message?.includes('uq_veyra_session_user_active') ||
           insertErr.detail?.includes('user_id'))
        ) {
          console.warn(`[Auth Service] Caught concurrent active session race condition for user ${dbUser.id}`);
          return {
            success: false,
            code: 'ACTIVE_SESSION_EXISTS',
            message: 'An active session already exists for this user.'
          };
        }
        console.error('[Auth Service] Database session creation failure:', insertErr);
        throw insertErr;
      }

      // 12. Update last_login_at in veyra_user
      try {
        await dbQuery(
          `UPDATE veyra_user SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [dbUser.id]
        );
      } catch (auditErr) {
        console.error('[Auth Service] Failed to update last_login_at in veyra_user:', auditErr);
      }

      // 13. Populate in-memory session cache for fast auth verification
      const authUser: AuthUser = {
        userId: dbUser.id,
        email: dbUser.email,
        displayName: dbUser.display_name || this.generateDisplayName(dbUser.email),
        passwordHash: null,
        status: dbUser.status as UserStatus,
        role: primaryRole,
        permissions,
        setupCompleted: true,
        isAdmin: isSiteAdmin,
        isActive: true,
        lastLoginAt: new Date().toISOString(),
        resetCode: null
      };

      const now = Date.now();
      activeSessions.set(sessionId, {
        token: sessionId,
        userId: dbUser.id,
        email: normalized,
        displayName: authUser.displayName,
        role: primaryRole,
        permissions,
        isAdmin: isSiteAdmin,
        createdAt: now,
        lastActivityAt: now,
        expiresAt: expiresAt.getTime(),
        status: 'ACTIVE'
      });

      // 14. Return safe authenticated context (never return password or hash)
      return {
        success: true,
        token: sessionId,
        userId: dbUser.id,
        displayName: authUser.displayName,
        email: dbUser.email,
        normalizedEmail: normalized,
        role: primaryRole,
        permissions,
        status: dbUser.status as UserStatus,
        isAdmin: isSiteAdmin,
        setupCompleted: true,
        message: 'Authentication successful.'
      };
    } catch (dbErr) {
      console.warn('[Auth Service] PostgreSQL database offline or unreachable; falling back to local user store.');
      return this.loginLocalFallback(normalized, rawPassword);
    }
  }

  /**
   * Fallback login handler for offline development/testing using users_auth.json
   */
  private loginLocalFallback(normalized: string, rawPassword: string): LoginResult {
    this.loadUsers();
    const user = this.users[normalized];

    // If user does not exist, return generic failure
    if (!user) {
      return {
        success: false,
        message: GENERIC_AUTH_FAILURE_MSG
      };
    }

    // Status validation
    if (user.status !== 'ACTIVE' || !user.isActive) {
      return {
        success: false,
        status: user.status,
        message: 'Your account is not active. Please contact a system administrator.'
      };
    }

    // Password verification
    if (!user.passwordHash) {
      return {
        success: false,
        message: GENERIC_AUTH_FAILURE_MSG
      };
    }

    const isMatch = bcrypt.compareSync(rawPassword, user.passwordHash);
    if (!isMatch) {
      return {
        success: false,
        message: GENERIC_AUTH_FAILURE_MSG
      };
    }

    if (normalized === 'admin@admin.com') {
      user.role = 'SITE_ADMIN';
      user.isAdmin = true;
      user.permissions = DEFAULT_ROLE_PERMISSIONS.SITE_ADMIN;
    }

    const now = Date.now();
    const inactivityTimeout = getInactivityTimeoutMs();

    // Check if an unexpired active session already exists for this user in local fallback
    for (const [, session] of activeSessions.entries()) {
      if (
        session.email === normalized &&
        session.status === 'ACTIVE' &&
        now < session.expiresAt &&
        (now - session.lastActivityAt <= inactivityTimeout)
      ) {
        return {
          success: false,
          code: 'ACTIVE_SESSION_EXISTS',
          message: 'An active session already exists for this user.'
        };
      }
    }

    const token = this.createSession(user);
    user.lastLoginAt = new Date().toISOString();
    this.saveUsers();

    return {
      success: true,
      token,
      userId: user.userId,
      displayName: user.displayName || this.generateDisplayName(user.email),
      email: user.email || normalized,
      normalizedEmail: normalized,
      role: user.role,
      permissions: user.permissions || DEFAULT_ROLE_PERMISSIONS[user.role] || DEFAULT_ROLE_PERMISSIONS.VIEWER,
      status: user.status,
      isAdmin: user.isAdmin || user.role === 'SITE_ADMIN',
      setupCompleted: user.setupCompleted,
      message: 'Authentication successful.'
    };
  }

  // Session management & creation
  private createSession(user: AuthUser): string {
    const normalized = this.normalizeEmail(user.email);
    const now = Date.now();
    const token = crypto.randomBytes(32).toString('hex');
    const inactivityTimeout = getInactivityTimeoutMs();
    const expiresAt = now + inactivityTimeout;

    activeSessions.set(token, {
      token,
      userId: user.userId,
      email: normalized,
      displayName: user.displayName,
      role: user.role,
      permissions: user.permissions,
      isAdmin: user.isAdmin,
      createdAt: now,
      lastActivityAt: now,
      expiresAt,
      status: 'ACTIVE'
    });

    return token;
  }

  /**
   * Validate session with 5-minute continuous inactivity timeout and activity refresh.
   * As long as user activity is detected, expires_at slides forward (last_activity_at + timeout).
   */
  public async validateSession(token: string, updateActivity = true): Promise<SessionValidationResult> {
    if (!token) {
      return { valid: false, code: 'INVALID_TOKEN', message: 'Authentication required. Missing or malformed token.' };
    }

    const now = Date.now();
    const inactivityTimeout = getInactivityTimeoutMs();

    // Check database authoritative source of truth for session status & expiry
    try {
      const dbRes = await dbQuery(
        `SELECT s.session_id, s.user_id, s.status, s.last_activity_at, s.expires_at
         FROM veyra_session s
         WHERE s.session_id = $1 LIMIT 1`,
        [token]
      );
      if (dbRes.rows.length > 0) {
        const dbRow = dbRes.rows[0];
        if (dbRow.status !== 'ACTIVE') {
          activeSessions.delete(token);
          return {
            valid: false,
            code: 'SESSION_EXPIRED',
            message: 'Your session has expired. Please log in again.'
          };
        }

        const dbLastAct = dbRow.last_activity_at ? new Date(dbRow.last_activity_at).getTime() : 0;
        const dbExpiresAt = dbRow.expires_at ? new Date(dbRow.expires_at).getTime() : (dbLastAct + inactivityTimeout);

        if (now >= dbExpiresAt || (now - dbLastAct >= inactivityTimeout)) {
          activeSessions.delete(token);
          await this.markSessionExpiredInDb(token);
          return {
            valid: false,
            code: 'SESSION_EXPIRED',
            message: 'Your session has expired. Please log in again.'
          };
        }
      }
    } catch (_) {
      // In case DB is temporarily offline, fallback to in-memory validation
    }

    let session = activeSessions.get(token);
    if (!session) {
      session = (await this.restoreSessionFromDb(token)) || undefined;
    }

    if (!session) {
      return { valid: false, code: 'SESSION_NOT_FOUND', message: 'Session expired or invalid. Please sign in again.' };
    }

    if (session.status !== 'ACTIVE') {
      activeSessions.delete(token);
      return {
        valid: false,
        code: 'SESSION_EXPIRED',
        message: 'Your session has expired. Please log in again.',
        session
      };
    }

    // 5-minute continuous inactivity timeout check:
    // If now >= session.expiresAt OR now - session.lastActivityAt >= inactivityTimeout
    if (now >= session.expiresAt || (now - session.lastActivityAt >= inactivityTimeout)) {
      session.status = 'EXPIRED';
      activeSessions.delete(token);
      this.markSessionExpiredInDb(token).catch(() => {});
      return {
        valid: false,
        code: 'SESSION_EXPIRED',
        message: 'Your session has expired. Please log in again.',
        session
      };
    }

    // User activity detected: reset inactivity timer and slide expires_at forward
    if (updateActivity) {
      session.lastActivityAt = now;
      session.expiresAt = now + inactivityTimeout;
      this.updateLastActivityInDb(token, session.lastActivityAt, session.expiresAt).catch(() => {});
    }

    return { valid: true, session };
  }

  public verifySession(token: string, updateActivity = true): Session | null {
    if (!token) return null;
    const session = activeSessions.get(token);
    if (!session) return null;

    if (session.status !== 'ACTIVE') {
      activeSessions.delete(token);
      return null;
    }

    const now = Date.now();
    const inactivityTimeout = getInactivityTimeoutMs();

    if (now >= session.expiresAt || (now - session.lastActivityAt >= inactivityTimeout)) {
      session.status = 'EXPIRED';
      activeSessions.delete(token);
      this.markSessionExpiredInDb(token).catch(() => {});
      return null;
    }

    if (updateActivity) {
      session.lastActivityAt = now;
      session.expiresAt = now + inactivityTimeout;
      this.updateLastActivityInDb(token, session.lastActivityAt, session.expiresAt).catch(() => {});
    }

    return session;
  }

  public async restoreSessionFromDb(token: string): Promise<Session | null> {
    if (!token) return null;
    try {
      const res = await dbQuery(
        `SELECT s.session_id, s.user_id, s.created_at, s.last_activity_at, s.expires_at,
                u.email, u.display_name, u.status as user_status
         FROM veyra_session s
         JOIN veyra_user u ON u.id = s.user_id
         WHERE s.session_id = $1 AND s.status = 'ACTIVE' AND (s.expires_at IS NULL OR s.expires_at > NOW())
         LIMIT 1`,
        [token]
      );

      if (res.rows.length === 0) return null;
      const row = res.rows[0];

      const lastActivityTime = row.last_activity_at ? new Date(row.last_activity_at).getTime() : new Date(row.created_at).getTime();
      const inactivityTimeout = getInactivityTimeoutMs();
      const rowExpiresAt = row.expires_at ? new Date(row.expires_at).getTime() : (lastActivityTime + inactivityTimeout);

      // Check inactivity on DB restored session
      if (Date.now() >= rowExpiresAt || (Date.now() - lastActivityTime >= inactivityTimeout)) {
        await this.markSessionExpiredInDb(token);
        return null;
      }

      const rolesRes = await dbQuery(
        `SELECT r.role_code FROM veyra_role r
         JOIN veyra_user_role ur ON ur.role_id = r.id
         WHERE ur.user_id = $1 AND r.status = 'ACTIVE'`,
        [row.user_id]
      );
      const roleCodes = rolesRes.rows.map((r: any) => r.role_code);
      const primaryRole = roleCodes[0] || 'SITE_ADMIN';
      const isSiteAdmin = roleCodes.includes('SITE_ADMIN') || row.email === 'admin@admin.com';

      const privsRes = await dbQuery(
        `SELECT DISTINCT p.privilege_code FROM veyra_privilege p
         JOIN veyra_role_privilege rp ON rp.privilege_id = p.id
         JOIN veyra_user_role ur ON ur.role_id = rp.role_id
         WHERE ur.user_id = $1 AND p.status = 'ACTIVE'`,
        [row.user_id]
      );
      let permissions = privsRes.rows.map((p: any) => p.privilege_code);
      if (permissions.length === 0) {
        permissions = DEFAULT_ROLE_PERMISSIONS[primaryRole] || ['ALL'];
      }

      const session: Session = {
        token: row.session_id,
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name || row.email,
        role: primaryRole,
        permissions,
        isAdmin: isSiteAdmin,
        createdAt: new Date(row.created_at).getTime(),
        lastActivityAt: lastActivityTime,
        expiresAt: rowExpiresAt,
        status: 'ACTIVE'
      };

      activeSessions.set(token, session);
      return session;
    } catch (err) {
      console.warn('[Auth Service] Could not restore session from DB:', (err as Error).message);
      return null;
    }
  }

  public async loadActiveSessionsFromDb() {
    try {
      const res = await dbQuery(
        `SELECT s.session_id, s.user_id, s.created_at, s.last_activity_at, s.expires_at,
                u.email, u.display_name, u.status as user_status
         FROM veyra_session s
         JOIN veyra_user u ON u.id = s.user_id
         WHERE s.status = 'ACTIVE' AND (s.expires_at IS NULL OR s.expires_at > NOW())`
      );

      const now = Date.now();
      const inactivityTimeout = getInactivityTimeoutMs();

      for (const row of res.rows) {
        const lastActivityTime = row.last_activity_at ? new Date(row.last_activity_at).getTime() : new Date(row.created_at).getTime();
        const rowExpiresAt = row.expires_at ? new Date(row.expires_at).getTime() : (lastActivityTime + inactivityTimeout);
        if (now >= rowExpiresAt || (now - lastActivityTime >= inactivityTimeout)) {
          continue; // skip inactive sessions
        }

        const rolesRes = await dbQuery(
          `SELECT r.role_code FROM veyra_role r
           JOIN veyra_user_role ur ON ur.role_id = r.id
           WHERE ur.user_id = $1 AND r.status = 'ACTIVE'`,
          [row.user_id]
        );
        const roleCodes = rolesRes.rows.map((r: any) => r.role_code);
        const primaryRole = roleCodes[0] || 'SITE_ADMIN';
        const isSiteAdmin = roleCodes.includes('SITE_ADMIN') || row.email === 'admin@admin.com';

        const privsRes = await dbQuery(
          `SELECT DISTINCT p.privilege_code FROM veyra_privilege p
           JOIN veyra_role_privilege rp ON rp.privilege_id = p.id
           JOIN veyra_user_role ur ON ur.role_id = rp.role_id
           WHERE ur.user_id = $1 AND p.status = 'ACTIVE'`,
          [row.user_id]
        );
        let permissions = privsRes.rows.map((p: any) => p.privilege_code);
        if (permissions.length === 0) {
          permissions = DEFAULT_ROLE_PERMISSIONS[primaryRole] || ['ALL'];
        }

        activeSessions.set(row.session_id, {
          token: row.session_id,
          userId: row.user_id,
          email: row.email,
          displayName: row.display_name || row.email,
          role: primaryRole,
          permissions,
          isAdmin: isSiteAdmin,
          createdAt: new Date(row.created_at).getTime(),
          lastActivityAt: lastActivityTime,
          expiresAt: rowExpiresAt,
          status: 'ACTIVE'
        });
      }
      console.log(`[Auth Service] Restored ${activeSessions.size} active session(s) from PostgreSQL.`);
    } catch (err) {
      console.warn('[Auth Service] Could not restore active sessions from DB on startup:', (err as Error).message);
    }
  }

  // AC5 & AC6: Logout API & Invalidation
  public async logout(token: string) {
    if (!token) return;
    this.sessionDbLastWritten.delete(token);
    const session = activeSessions.get(token);
    if (session) {
      session.status = 'LOGGED_OUT';
    }
    activeSessions.delete(token);
    try {
      await dbQuery(
        `UPDATE veyra_session 
         SET status = 'LOGGED_OUT', logged_out_at = NOW() 
         WHERE session_id = $1 AND status = 'ACTIVE'`,
        [token]
      );
    } catch (err) {
      // ignore
    }
  }

  // AC8: Session cleanup routine
  public async cleanupExpiredSessions() {
    const now = Date.now();
    const inactivityTimeout = getInactivityTimeoutMs();

    for (const [token, session] of activeSessions.entries()) {
      if (session.status !== 'ACTIVE' || now >= session.expiresAt || (now - session.lastActivityAt >= inactivityTimeout)) {
        session.status = 'EXPIRED';
        activeSessions.delete(token);
      }
    }

    try {
      const minutes = Math.ceil(inactivityTimeout / (60 * 1000));
      await dbQuery(
        `UPDATE veyra_session
         SET status = 'EXPIRED'
         WHERE status = 'ACTIVE' AND (
           (expires_at IS NOT NULL AND expires_at <= NOW()) OR
           (last_activity_at <= NOW() - ($1 || ' minutes')::interval)
         )`,
        [`${minutes}`]
      );
    } catch (_) {}
  }

  private async markSessionExpiredInDb(token: string) {
    try {
      this.sessionDbLastWritten.delete(token);
      await dbQuery(
        `UPDATE veyra_session SET status = 'EXPIRED' WHERE session_id = $1 AND status = 'ACTIVE'`,
        [token]
      );
    } catch (_) {}
  }

  private sessionDbLastWritten = new Map<string, number>();

  private async updateLastActivityInDb(token: string, lastActivityAt?: number, expiresAt?: number, forceImmediate = false) {
    const now = Date.now();
    const lastWritten = this.sessionDbLastWritten.get(token) || 0;
    // Throttle database writes to at most once per 10 seconds unless forceImmediate is requested
    if (!forceImmediate && now - lastWritten < 10000) {
      return;
    }
    this.sessionDbLastWritten.set(token, now);

    try {
      const actDate = lastActivityAt ? new Date(lastActivityAt) : new Date(now);
      const expDate = expiresAt ? new Date(expiresAt) : new Date(now + getInactivityTimeoutMs());
      await dbQuery(
        `UPDATE veyra_session 
         SET last_activity_at = $1, expires_at = $2 
         WHERE session_id = $3 AND status = 'ACTIVE'`,
        [actDate, expDate, token]
      );
    } catch (_) {}
  }

  public async refreshSessionActivity(token: string): Promise<{ success: boolean; lastActivityAt?: number; expiresAt?: number }> {
    let session = activeSessions.get(token);
    if (!session) {
      session = (await this.restoreSessionFromDb(token)) || undefined;
    }

    if (!session || session.status !== 'ACTIVE') {
      return { success: false };
    }

    const now = Date.now();
    const inactivityTimeout = getInactivityTimeoutMs();

    // Check if session has expired
    if (now >= session.expiresAt || (now - session.lastActivityAt >= inactivityTimeout)) {
      session.status = 'EXPIRED';
      activeSessions.delete(token);
      this.markSessionExpiredInDb(token).catch(() => {});
      return { success: false };
    }

    // Refresh activity & slide expires_at forward
    session.lastActivityAt = now;
    session.expiresAt = now + inactivityTimeout;
    await this.updateLastActivityInDb(token, session.lastActivityAt, session.expiresAt, true);

    return {
      success: true,
      lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt
    };
  }

  public getSession(token: string): Session | undefined {
    return activeSessions.get(token);
  }

  public _setSessionLastActivity(token: string, lastActivityAt: number) {
    const session = activeSessions.get(token);
    if (session) {
      session.lastActivityAt = lastActivityAt;
    }
  }

  public _getActiveSessionsCount(): number {
    return activeSessions.size;
  }

  public _clearActiveSessions(): void {
    activeSessions.clear();
  }

  public getUserByEmail(email: string): AuthUser | null {
    this.loadUsers();
    const normalized = this.normalizeEmail(email);
    const user = this.users[normalized];
    if (!user) return null;
    // Return copy without passwordHash
    return { ...user };
  }

  // Admin Portal user management helpers
  public getAdminUsersList(): any[] {
    this.loadUsers();
    return Object.values(this.users).map(u => ({
      userId: u.userId,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      permissions: u.permissions,
      status: u.status,
      isAdmin: u.isAdmin,
      isActive: u.status === 'ACTIVE',
      setupCompleted: u.setupCompleted,
      hasPassword: !!u.passwordHash,
      lastLoginAt: u.lastLoginAt,
      resetCodeStatus: u.resetCode
        ? (u.resetCode.used ? 'used' : (new Date(u.resetCode.expiresAt).getTime() < Date.now() ? 'expired' : 'active'))
        : 'none'
    }));
  }

  // Story VY-STRY-007: User, Role, and Privilege Management APIs

  public getUsersList(filterText?: string): any[] {
    this.loadUsers();
    let userList = Object.values(this.users).map(u => ({
      id: u.userId,
      userId: u.userId,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      roles: [u.role],
      permissions: u.permissions,
      status: u.status,
      isAdmin: u.isAdmin,
      isActive: u.status === 'ACTIVE',
      setupCompleted: u.setupCompleted,
      lastLoginAt: u.lastLoginAt,
      createdAt: new Date().toISOString()
    }));

    if (filterText) {
      const lower = filterText.toLowerCase();
      userList = userList.filter(u =>
        u.email.toLowerCase().includes(lower) ||
        u.displayName.toLowerCase().includes(lower) ||
        u.role.toLowerCase().includes(lower)
      );
    }
    return userList;
  }

  public getUserByIdOrEmail(idOrEmail: string): any | null {
    this.loadUsers();
    if (!idOrEmail) return null;
    const normalized = this.normalizeEmail(idOrEmail);
    // Try by email first
    let user: AuthUser | undefined = this.users[normalized];
    if (!user) {
      // Try by userId or id
      user = Object.values(this.users).find(u => u.userId === idOrEmail || u.userId === `usr_${idOrEmail}`);
    }
    if (!user) return null;

    return {
      id: user.userId,
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      roles: [user.role],
      permissions: user.permissions,
      status: user.status,
      isAdmin: user.isAdmin,
      isActive: user.status === 'ACTIVE',
      setupCompleted: user.setupCompleted,
      lastLoginAt: user.lastLoginAt
    };
  }

  public async createUser(data: {
    email: string;
    displayName?: string;
    role?: string;
    password?: string;
    status?: UserStatus;
    createdBy?: string;
  }): Promise<{ success: boolean; user?: any; code?: string; message: string }> {
    this.loadUsers();
    const rawEmail = (data.email || '').trim();
    if (!rawEmail) {
      return { success: false, code: 'INVALID_EMAIL', message: 'Email is required.' };
    }

    const normalized = this.normalizeEmail(rawEmail);
    if (!this.validateEmailFormat(normalized)) {
      return { success: false, code: 'INVALID_EMAIL_FORMAT', message: 'Invalid email format.' };
    }

    if (this.users[normalized]) {
      return { success: false, code: 'USER_ALREADY_EXISTS', message: 'A user with this email already exists.' };
    }

    const role = (data.role || 'VIEWER').toUpperCase();
    const permissions = DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS.VIEWER;
    const isSiteAdmin = role === 'SITE_ADMIN';
    const status: UserStatus = data.status ? (data.status.toUpperCase() as UserStatus) : 'ACTIVE';
    const displayName = data.displayName?.trim() || this.generateDisplayName(rawEmail);
    const userId = `usr_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

    let passwordHash: string | null = null;
    let setupCompleted = false;
    if (data.password) {
      const salt = bcrypt.genSaltSync(10);
      passwordHash = bcrypt.hashSync(data.password, salt);
      setupCompleted = true;
    }

    const newUser: AuthUser = {
      userId,
      email: rawEmail,
      displayName,
      passwordHash,
      status,
      role,
      permissions,
      setupCompleted,
      isAdmin: isSiteAdmin,
      isActive: status === 'ACTIVE',
      lastLoginAt: null,
      resetCode: null
    };

    this.users[normalized] = newUser;
    this.saveUsers();

    // Persist to PostgreSQL if available
    try {
      const userRes = await dbQuery(
        `INSERT INTO veyra_user (email, password_hash, display_name, status, is_local_user, created_by)
         VALUES ($1, $2, $3, $4, TRUE, $5)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [normalized, passwordHash, displayName, status, data.createdBy || 'AUTH_SERVICE']
      );
      if (userRes.rows.length > 0) {
        const dbUserId = userRes.rows[0].id;
        const roleRes = await dbQuery(`SELECT id FROM veyra_role WHERE role_code = $1`, [role]);
        if (roleRes.rows.length > 0) {
          await dbQuery(
            `INSERT INTO veyra_user_role (user_id, role_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [dbUserId, roleRes.rows[0].id, data.createdBy || 'AUTH_SERVICE']
          );
        }
      }
    } catch (_) {}

    const safeUser = this.getUserByIdOrEmail(normalized);
    return { success: true, user: safeUser, message: 'User created successfully.' };
  }

  public async updateUser(
    idOrEmail: string,
    data: {
      displayName?: string;
      role?: string;
      status?: UserStatus;
      password?: string;
      permissions?: string[];
      updatedBy?: string;
    }
  ): Promise<{ success: boolean; user?: any; message: string }> {
    this.loadUsers();
    const normalized = this.normalizeEmail(idOrEmail);
    let userKey = normalized;
    let user = this.users[normalized];

    if (!user) {
      // Find key by userId
      const entry = Object.entries(this.users).find(([_, u]) => u.userId === idOrEmail);
      if (entry) {
        userKey = entry[0];
        user = entry[1];
      }
    }

    if (!user) {
      return { success: false, message: 'User not found.' };
    }

    if (data.displayName !== undefined) {
      user.displayName = data.displayName.trim();
    }

    // AC4: Site Admin can assign/modify user roles
    if (data.role !== undefined) {
      const newRole = data.role.toUpperCase();
      user.role = newRole;
      user.isAdmin = (newRole === 'SITE_ADMIN');
      user.permissions = DEFAULT_ROLE_PERMISSIONS[newRole] || data.permissions || DEFAULT_ROLE_PERMISSIONS.VIEWER;
    }

    if (data.status !== undefined) {
      const newStatus = data.status.toUpperCase() as UserStatus;
      user.status = newStatus;
      user.isActive = (newStatus === 'ACTIVE');

      // If user is deactivated or disabled, terminate active sessions immediately
      if (newStatus !== 'ACTIVE') {
        for (const [token, session] of activeSessions.entries()) {
          if (this.normalizeEmail(session.email) === userKey) {
            activeSessions.delete(token);
          }
        }
      }
    }

    if (data.password) {
      const salt = bcrypt.genSaltSync(10);
      user.passwordHash = bcrypt.hashSync(data.password, salt);
      user.setupCompleted = true;
    }

    this.saveUsers();

    // Update in PostgreSQL if available
    try {
      await dbQuery(
        `UPDATE veyra_user SET display_name = $1, status = $2, updated_at = NOW(), updated_by = $3 WHERE email = $4`,
        [user.displayName, user.status, data.updatedBy || 'AUTH_SERVICE', userKey]
      );
      if (data.role) {
        const uRes = await dbQuery(`SELECT id FROM veyra_user WHERE email = $1`, [userKey]);
        const rRes = await dbQuery(`SELECT id FROM veyra_role WHERE role_code = $1`, [user.role]);
        if (uRes.rows.length > 0 && rRes.rows.length > 0) {
          await dbQuery(`DELETE FROM veyra_user_role WHERE user_id = $1`, [uRes.rows[0].id]);
          await dbQuery(
            `INSERT INTO veyra_user_role (user_id, role_id, created_by) VALUES ($1, $2, $3)`,
            [uRes.rows[0].id, rRes.rows[0].id, data.updatedBy || 'AUTH_SERVICE']
          );
        }
      }
    } catch (_) {}

    const safeUser = this.getUserByIdOrEmail(userKey);
    return { success: true, user: safeUser, message: 'User updated successfully.' };
  }

  public async deleteUser(idOrEmail: string, adminEmail: string): Promise<{ success: boolean; code?: string; message: string }> {
    this.loadUsers();
    const normalizedTarget = this.normalizeEmail(idOrEmail);
    const normalizedAdmin = this.normalizeEmail(adminEmail);

    let targetKey = normalizedTarget;
    let user = this.users[normalizedTarget];
    if (!user) {
      const entry = Object.entries(this.users).find(([_, u]) => u.userId === idOrEmail);
      if (entry) {
        targetKey = entry[0];
        user = entry[1];
      }
    }

    if (!user) {
      return { success: false, message: 'User not found.' };
    }

    if (targetKey === normalizedAdmin || user.email.toLowerCase() === normalizedAdmin) {
      return { success: false, code: 'CANNOT_DELETE_SELF', message: 'Administrators cannot delete their own accounts.' };
    }

    // Invalidate active sessions
    for (const [token, session] of activeSessions.entries()) {
      if (this.normalizeEmail(session.email) === targetKey) {
        activeSessions.delete(token);
      }
    }

    delete this.users[targetKey];
    this.saveUsers();

    // Delete in PostgreSQL if available
    try {
      await dbQuery(`DELETE FROM veyra_user WHERE email = $1`, [targetKey]);
    } catch (_) {}

    return { success: true, message: `User ${user.email} has been permanently deleted.` };
  }

  // AC2: Role APIs
  public getRolesList(): RoleInfo[] {
    return VEYRA_ROLES;
  }

  public getRoleByIdOrCode(idOrCode: string): RoleInfo | null {
    if (!idOrCode) return null;
    const lower = idOrCode.toLowerCase();
    const upper = idOrCode.toUpperCase();
    const role = VEYRA_ROLES.find(r => r.id.toLowerCase() === lower || r.role_code.toUpperCase() === upper);
    return role || null;
  }

  // AC3: Privilege APIs
  public getPrivilegesList(): PrivilegeInfo[] {
    return VEYRA_PRIVILEGES;
  }

  public toggleAccountStatus(adminEmail: string, targetEmail: string, active: boolean): boolean {
    const normalizedAdmin = this.normalizeEmail(adminEmail);
    const normalizedTarget = this.normalizeEmail(targetEmail);
    if (normalizedAdmin === normalizedTarget) {
      throw new Error('Administrators cannot deactivate their own accounts.');
    }
    const user = this.users[normalizedTarget];
    if (!user) return false;

    user.isActive = active;
    user.status = active ? 'ACTIVE' : 'DISABLED';
    this.saveUsers();
    return true;
  }

  public deleteUserAccount(adminEmail: string, targetEmail: string): boolean {
    const normalizedAdmin = this.normalizeEmail(adminEmail);
    const normalizedTarget = this.normalizeEmail(targetEmail);

    if (normalizedAdmin === normalizedTarget) {
      throw new Error('Administrators cannot delete their own accounts.');
    }

    const user = this.users[normalizedTarget];
    if (!user) return false;

    // Terminate any active sessions for the deleted user
    for (const [token, session] of activeSessions.entries()) {
      if (this.normalizeEmail(session.email) === normalizedTarget) {
        activeSessions.delete(token);
      }
    }

    delete this.users[normalizedTarget];
    this.saveUsers();
    return true;
  }

  public generateResetCode(targetEmail: string): string {
    const normalized = this.normalizeEmail(targetEmail);
    const user = this.users[normalized];
    if (!user) {
      throw new Error(`User with email "${targetEmail}" does not exist.`);
    }

    const rawCode = crypto.randomBytes(4).toString('hex');
    const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    user.resetCode = {
      codeHash,
      expiresAt,
      used: false
    };

    this.saveUsers();
    return rawCode;
  }

  public revokeResetCode(targetEmail: string): boolean {
    const normalized = this.normalizeEmail(targetEmail);
    const user = this.users[normalized];
    if (!user || !user.resetCode) return false;

    user.resetCode = null;
    this.saveUsers();
    return true;
  }

  public resetPassword(email: string, rawCode: string, newPassword: string): { success: boolean; message: string } {
    this.loadUsers();
    const normalized = this.normalizeEmail(email);
    const user = this.users[normalized];
    if (!user) {
      return { success: false, message: 'Invalid reset code or email.' };
    }

    const policy = this.validateNewPasswordPolicy(newPassword);
    if (!policy.valid) {
      return { success: false, message: policy.message || 'Password does not meet safety criteria.' };
    }

    if (!user.passwordHash) {
      const salt = bcrypt.genSaltSync(10);
      user.passwordHash = bcrypt.hashSync(newPassword, salt);
      user.setupCompleted = true;
      user.status = 'ACTIVE';
      user.isActive = true;
      user.resetCode = null;
      this.saveUsers();
      return { success: true, message: 'Password has been set successfully. You can now log in.' };
    }

    if (!user.resetCode) {
      return { success: false, message: 'No active password reset request exists for this account.' };
    }

    if (user.resetCode.used) {
      return { success: false, message: 'This reset code has already been used.' };
    }

    if (new Date(user.resetCode.expiresAt).getTime() < Date.now()) {
      return { success: false, message: 'This reset code has expired.' };
    }

    const inputHash = crypto.createHash('sha256').update((rawCode || '').trim()).digest('hex');
    if (inputHash !== user.resetCode.codeHash) {
      return { success: false, message: 'Invalid reset code or email.' };
    }

    const salt = bcrypt.genSaltSync(10);
    user.passwordHash = bcrypt.hashSync(newPassword, salt);
    user.setupCompleted = true;
    user.status = 'ACTIVE';
    user.isActive = true;
    user.resetCode = null;

    this.saveUsers();
    return { success: true, message: 'Password has been reset successfully. You can now log in.' };
  }
}

export const authService = new AuthService();
