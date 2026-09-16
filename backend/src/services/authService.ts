import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_FILE_PATH = path.join(__dirname, '../../users_auth.json');

export interface ResetCodeInfo {
  codeHash: string;
  expiresAt: string;
  used: boolean;
}

export interface AuthUser {
  email: string;
  passwordHash: string | null;
  setupCompleted: boolean;
  isAdmin: boolean;
  isActive: boolean;
  resetCode: ResetCodeInfo | null;
}

export interface Session {
  token: string;
  email: string;
  isAdmin: boolean;
  expiresAt: number;
}

// In-memory session store (resilient to reloads via token checks, but clean for memory)
const activeSessions = new Map<string, Session>();

// Regex to validate company emails: name.name@claaps.com (case-insensitive)
const EMAIL_REGEX = /^[a-zA-Z]+\.[a-zA-Z]+@claaps\.com$/i;

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
        for (const [key, user] of Object.entries<AuthUser>(rawUsers)) {
          const normKey = this.normalizeEmail(key);
          this.users[normKey] = {
            ...user,
            email: user.email ? user.email.trim() : normKey
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

  private ensureInitialAdmin() {
    const adminEmail = 'karthika.gundreddi@claaps.com';
    const normalized = adminEmail.toLowerCase().trim();
    if (!this.users[normalized]) {
      this.users[normalized] = {
        email: 'Karthika.Gundreddi@claaps.com',
        passwordHash: null,
        setupCompleted: false,
        isAdmin: true,
        isActive: true,
        resetCode: null
      };
      this.saveUsers();
      console.log(`[Auth Service] Provisioned default administrator account: ${adminEmail}`);
    } else {
      this.users[normalized].isAdmin = true;
      this.users[normalized].isActive = true;
      if (!this.users[normalized].email) {
        this.users[normalized].email = 'Karthika.Gundreddi@claaps.com';
      }
    }
  }

  public validateEmailFormat(email: string): boolean {
    if (!email) return false;
    return EMAIL_REGEX.test(this.normalizeEmail(email));
  }

  public normalizeEmail(email: string): string {
    return (email || '').trim().toLowerCase();
  }

  public validateOnboardingPassword(email: string, password: string): boolean {
    const normalized = this.normalizeEmail(email);
    const parts = normalized.split('@');
    if (parts.length !== 2) return false;
    const localPart = parts[0].replace(/\./g, '');
    
    // Format must be exactly 4 letters followed by @123
    const match = (password || '').match(/^([a-zA-Z]{4})@123$/);
    if (!match) return false;
    
    const letters = match[1].toLowerCase();
    return localPart.includes(letters);
  }

  public validateNewPasswordPolicy(password: string): { valid: boolean; message?: string } {
    if (password.length < 8) {
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

  public async login(email: string, password: string): Promise<{ success: boolean; token?: string; email?: string; normalizedEmail?: string; isAdmin?: boolean; setupCompleted?: boolean; message: string }> {
    this.loadUsers();
    const normalized = this.normalizeEmail(email);
    
    if (!this.validateEmailFormat(normalized)) {
      return { success: false, message: 'Invalid email address or format. Please use name.name@claaps.com.' };
    }

    let user = this.users[normalized];
    
    // Onboarding flow: if user is not in database but format is correct, we onboard them!
    if (!user) {
      user = {
        email: email ? email.trim() : normalized,
        passwordHash: null,
        setupCompleted: false,
        isAdmin: false,
        isActive: true,
        resetCode: null
      };
      this.users[normalized] = user;
      this.saveUsers();
    }

    if (!user.isActive) {
      return { success: false, message: 'Your account has been deactivated. Please contact an administrator.' };
    }

    // Step E: Password setup for accounts without a password or pending setup
    if (!user.setupCompleted || !user.passwordHash) {
      const policyCheck = this.validateNewPasswordPolicy(password);
      const onboardingCheck = this.validateOnboardingPassword(normalized, password);

      if (!policyCheck.valid && !onboardingCheck) {
        return { 
          success: false, 
          message: policyCheck.message || 'Password must be at least 8 characters long and contain uppercase, lowercase, number, and special character.' 
        };
      }
      
      // Valid password becomes the user's permanent password hash
      const salt = bcrypt.genSaltSync(10);
      user.passwordHash = bcrypt.hashSync(password, salt);
      user.setupCompleted = true;
      this.saveUsers();
      
      const token = this.createSession(normalized, user.isAdmin);
      return { 
        success: true, 
        token, 
        email: user.email || normalized, 
        normalizedEmail: normalized, 
        isAdmin: user.isAdmin, 
        setupCompleted: true, 
        message: 'New password set successfully! Welcome.' 
      };
    }

    // Step D: Normal password verification
    const matches = bcrypt.compareSync(password, user.passwordHash);
    if (!matches) {
      return { success: false, message: 'Invalid credentials.' };
    }

    const token = this.createSession(normalized, user.isAdmin);
    return { 
      success: true, 
      token, 
      email: user.email || normalized, 
      normalizedEmail: normalized, 
      isAdmin: user.isAdmin, 
      setupCompleted: true, 
      message: 'Authentication successful.' 
    };
  }

  private createSession(email: string, isAdmin: boolean): string {
    const normalized = this.normalizeEmail(email);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    
    activeSessions.set(token, {
      token,
      email: normalized,
      isAdmin,
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

  public logout(token: string) {
    activeSessions.delete(token);
  }

  // Admin: Get all users list
  public getAdminUsersList(): any[] {
    this.loadUsers();
    return Object.values(this.users).map(u => ({
      email: u.email,
      isAdmin: u.isAdmin,
      isActive: u.isActive,
      setupCompleted: u.setupCompleted,
      hasPassword: !!u.passwordHash,
      resetCodeStatus: u.resetCode 
        ? (u.resetCode.used ? 'used' : (new Date(u.resetCode.expiresAt).getTime() < Date.now() ? 'expired' : 'active'))
        : 'none'
    }));
  }

  // Admin: Toggle account active/inactive
  public toggleAccountStatus(adminEmail: string, targetEmail: string, active: boolean): boolean {
    const normalized = this.normalizeEmail(targetEmail);
    if (this.normalizeEmail(adminEmail) === normalized) {
      throw new Error('Administrators cannot deactivate their own accounts.');
    }
    const user = this.users[normalized];
    if (!user) return false;
    
    user.isActive = active;
    this.saveUsers();
    return true;
  }

  // Admin: Permanently delete user account
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

  // Admin: Generate Reset Code
  public generateResetCode(targetEmail: string): string {
    const normalized = this.normalizeEmail(targetEmail);
    const user = this.users[normalized];
    if (!user) {
      throw new Error(`User with email "${targetEmail}" does not exist.`);
    }

    // Generate secure 8-character token (4 bytes random)
    const rawCode = crypto.randomBytes(4).toString('hex');
    const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour expiry

    user.resetCode = {
      codeHash,
      expiresAt,
      used: false
    };

    this.saveUsers();
    return rawCode;
  }

  // Admin: Invalidate Reset Code
  public revokeResetCode(targetEmail: string): boolean {
    const normalized = this.normalizeEmail(targetEmail);
    const user = this.users[normalized];
    if (!user || !user.resetCode) return false;
    
    user.resetCode = null;
    this.saveUsers();
    return true;
  }

  // User: Reset Password
  public resetPassword(email: string, rawCode: string, newPassword: string): { success: boolean; message: string } {
    this.loadUsers();
    const normalized = this.normalizeEmail(email);
    const user = this.users[normalized];
    if (!user) {
      return { success: false, message: 'Invalid reset code or email.' };
    }

    // Validate new password policy
    const policy = this.validateNewPasswordPolicy(newPassword);
    if (!policy.valid) {
      return { success: false, message: policy.message || 'Password does not meet safety criteria.' };
    }

    // If account has no password yet (password was deleted / reset), allow setting password directly
    if (!user.passwordHash) {
      const salt = bcrypt.genSaltSync(10);
      user.passwordHash = bcrypt.hashSync(newPassword, salt);
      user.setupCompleted = true;
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

    // Verify code hash
    const inputHash = crypto.createHash('sha256').update((rawCode || '').trim()).digest('hex');
    if (inputHash !== user.resetCode.codeHash) {
      return { success: false, message: 'Invalid reset code or email.' };
    }

    // Update password hash and mark code as used
    const salt = bcrypt.genSaltSync(10);
    user.passwordHash = bcrypt.hashSync(newPassword, salt);
    user.setupCompleted = true; // resets also mark user as setup complete
    user.resetCode.used = true;
    user.resetCode = null; // remove active code

    this.saveUsers();
    return { success: true, message: 'Password has been reset successfully. You can now log in.' };
  }
}

export const authService = new AuthService();
