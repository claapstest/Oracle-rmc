import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';

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
  expiresAt: number;
}

export interface LoginResult {
  success: boolean;
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

// In-memory session store
const activeSessions = new Map<string, Session>();

// Role to default permissions mapping
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  SITE_ADMIN: [
    'ALL',
    'ADMIN_USERS',
    'SECURITY_READ',
    'SECURITY_WRITE',
    'AUDIT_READ',
    'RISK_READ',
    'RISK_WRITE',
    'SETTINGS_MANAGE',
    'INVESTIGATIONS_MANAGE',
    'REPORTS_MANAGE'
  ],
  AUDIT_MANAGER: [
    'SECURITY_READ',
    'AUDIT_READ',
    'RISK_READ',
    'REPORTS_READ',
    'INVESTIGATIONS_READ',
    'INVESTIGATIONS_WRITE'
  ],
  SECURITY_ANALYST: [
    'SECURITY_READ',
    'AUDIT_READ',
    'RISK_READ',
    'INVESTIGATIONS_READ'
  ],
  COMPLIANCE_OFFICER: [
    'SECURITY_READ',
    'AUDIT_READ',
    'RISK_READ',
    'REPORTS_READ'
  ],
  VIEWER: [
    'SECURITY_READ',
    'AUDIT_READ'
  ]
};

// Generic failure message per AC5 to avoid leaking whether user exists or password was wrong
const GENERIC_AUTH_FAILURE_MSG = 'Invalid email or password.';

export class AuthService {
  private users: Record<string, AuthUser> = {};

  constructor() {
    this.loadUsers();
    this.ensureInitialAdmin();
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
   * AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8:
   * Main Login Handler for Claaps VEYRA
   */
  public async login(rawEmail: string, rawPassword: string): Promise<LoginResult> {
    this.loadUsers();
    
    // AC2: Normalization
    const normalized = this.normalizeEmail(rawEmail);

    if (!normalized || !rawPassword) {
      return {
        success: false,
        message: GENERIC_AUTH_FAILURE_MSG
      };
    }

    if (!this.validateEmailFormat(normalized)) {
      // AC5: Generic failure response
      return {
        success: false,
        message: GENERIC_AUTH_FAILURE_MSG
      };
    }

    // AC2: Retrieve user from database
    const user = this.users[normalized];

    // AC5: If user does not exist, return generic error (do not reveal non-existence)
    if (!user) {
      return {
        success: false,
        message: GENERIC_AUTH_FAILURE_MSG
      };
    }

    // AC4: User status validation (ACTIVE only)
    if (user.status !== 'ACTIVE' || !user.isActive) {
      return {
        success: false,
        message: 'Your account is not active. Please contact a system administrator.'
      };
    }

    // AC3: Verify password against stored password hash
    if (!user.passwordHash) {
      // If user has no password yet (e.g. initial onboarding)
      return {
        success: false,
        message: GENERIC_AUTH_FAILURE_MSG
      };
    }

    const isMatch = bcrypt.compareSync(rawPassword, user.passwordHash);
    if (!isMatch) {
      // AC5: Generic authentication failure
      return {
        success: false,
        message: GENERIC_AUTH_FAILURE_MSG
      };
    }

    // AC6: Site Admin local authentication handling
    if (normalized === 'admin@admin.com') {
      user.role = 'SITE_ADMIN';
      user.isAdmin = true;
      user.permissions = DEFAULT_ROLE_PERMISSIONS.SITE_ADMIN;
    }

    // AC7: Create session and record login information
    const token = this.createSession(user);
    user.lastLoginAt = new Date().toISOString();
    this.saveUsers();

    // AC8: Return authorization info without sensitive data
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

  // AC7: Session management
  private createSession(user: AuthUser): string {
    const normalized = this.normalizeEmail(user.email);
    
    // Check if existing active session exists for this user and reuse or refresh
    for (const [existingToken, session] of activeSessions.entries()) {
      if (session.email === normalized && Date.now() < session.expiresAt) {
        // Refresh expiration
        session.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
        return existingToken;
      }
    }

    const token = crypto.randomBytes(32).toString('hex');
    const createdAt = Date.now();
    const expiresAt = createdAt + 24 * 60 * 60 * 1000; // 24 hours validity

    activeSessions.set(token, {
      token,
      userId: user.userId,
      email: normalized,
      displayName: user.displayName,
      role: user.role,
      permissions: user.permissions,
      isAdmin: user.isAdmin,
      createdAt,
      expiresAt
    });

    return token;
  }

  public verifySession(token: string): Session | null {
    if (!token) return null;
    const session = activeSessions.get(token);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      activeSessions.delete(token);
      return null;
    }

    return session;
  }

  public getUserByEmail(email: string): AuthUser | null {
    this.loadUsers();
    const normalized = this.normalizeEmail(email);
    const user = this.users[normalized];
    if (!user) return null;
    // Return copy without passwordHash
    return { ...user };
  }

  public logout(token: string) {
    activeSessions.delete(token);
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
