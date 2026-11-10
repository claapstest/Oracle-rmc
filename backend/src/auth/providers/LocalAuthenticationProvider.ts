import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query as dbQuery } from '../../db.js';
import {
  AuthenticationProvider,
  ProviderMetadata,
  AuthCredentials,
  AuthenticationResult,
  IdentityProfile
} from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_FILE_PATH = path.resolve(__dirname, '../../../users_auth.json');

// Generic authentication failure message to prevent username enumeration or password oracle attacks
export const LOCAL_AUTH_GENERIC_FAILURE_MSG = 'Invalid email or password.';
export const LOCAL_AUTH_INACTIVE_MSG = 'Your account is not active. Please contact a system administrator.';

export interface LocalDbUserRecord {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string;
  status: string;
  is_local_user?: boolean;
  last_login_at?: string | null;
}

/**
 * LocalAuthenticationProvider
 * 
 * VYR-014: Refactored local username/password authentication behind the AuthenticationProvider abstraction.
 * Encapsulates:
 *  - Email normalization and RFC-compliant format validation
 *  - Database user lookup (with resilient fallback for offline dev/test)
 *  - Account status validation (fail-closed for inactive/disabled users)
 *  - Asynchronous, non-blocking bcrypt verification and hashing
 *  - Generic response protection against username harvesting
 *  - Strict prevention of plaintext credential leakage in logs or return objects
 */
export class LocalAuthenticationProvider implements AuthenticationProvider {
  public readonly metadata: ProviderMetadata = {
    id: 'LOCAL',
    type: 'LOCAL',
    name: 'Local Database Authentication',
    description: 'PostgreSQL-backed asynchronous bcrypt credential authentication for local VEYRA users',
    isExternal: false,
    supportedAuthMethods: ['PASSWORD'],
    version: '1.1.0'
  };

  public getMetadata(): ProviderMetadata {
    return this.metadata;
  }

  public validateConfiguration(): void {
    // Local provider uses primary application database pool; no external third-party keys required.
  }

  /**
   * Normalizes an email address by trimming whitespace and converting to lowercase.
   */
  public normalizeEmail(email: string): string {
    return (email || '').trim().toLowerCase();
  }

  /**
   * Validates standard email format using regex to reject malformed inputs early.
   */
  public validateEmailFormat(email: string): boolean {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  }

  /**
   * Asynchronously compares a candidate plaintext password with a bcrypt hash.
   * Uses non-blocking Promise API to avoid starving the Node.js event loop.
   */
  public async comparePassword(candidatePassword: string, hash: string): Promise<boolean> {
    if (!candidatePassword || !hash) return false;
    try {
      return await bcrypt.compare(candidatePassword, hash);
    } catch (err: any) {
      console.error('[LocalAuthenticationProvider] Asynchronous bcrypt compare error:', err?.message || err);
      return false;
    }
  }

  /**
   * Asynchronously hashes a plaintext password using bcrypt with salt rounds >= 10.
   */
  public async hashPassword(password: string, saltRounds = 10): Promise<string> {
    if (!password) {
      throw new Error('Password cannot be empty.');
    }
    return await bcrypt.hash(password, saltRounds);
  }

  /**
   * Performs user lookup by normalized email against PostgreSQL `veyra_user`.
   * If the database query fails (e.g. offline dev/testing), safely falls back to local user store.
   */
  public async lookupUser(normalizedEmail: string): Promise<LocalDbUserRecord | null> {
    if (!normalizedEmail) return null;

    try {
      const userRes = await dbQuery(
        `SELECT id, email, password_hash, display_name, status, is_local_user, last_login_at
         FROM veyra_user
         WHERE LOWER(email) = $1`,
        [normalizedEmail]
      );

      if (userRes && userRes.rows && userRes.rows.length > 0) {
        const row = userRes.rows[0];
        return {
          id: String(row.id),
          email: row.email,
          password_hash: row.password_hash,
          display_name: row.display_name,
          status: (row.status || 'ACTIVE').toUpperCase(),
          is_local_user: row.is_local_user ?? true,
          last_login_at: row.last_login_at
        };
      }
      return null;
    } catch (err: any) {
      // Offline fallback for development / test environments without PostgreSQL running
      return this.lookupFallbackUser(normalizedEmail);
    }
  }

  /**
   * Fallback user lookup from `users_auth.json` for offline development/testing.
   */
  private lookupFallbackUser(normalizedEmail: string): LocalDbUserRecord | null {
    try {
      if (fs.existsSync(AUTH_FILE_PATH)) {
        const fileData = fs.readFileSync(AUTH_FILE_PATH, 'utf8');
        const data = JSON.parse(fileData);
        const rawUser = data.users?.[normalizedEmail];
        if (rawUser) {
          const status = rawUser.status
            ? rawUser.status.toUpperCase()
            : (rawUser.isActive === false ? 'DISABLED' : 'ACTIVE');
          return {
            id: rawUser.userId || `usr_${normalizedEmail.replace(/[^a-zA-Z0-9]/g, '_')}`,
            email: rawUser.email ? rawUser.email.trim().toLowerCase() : normalizedEmail,
            password_hash: rawUser.passwordHash || null,
            display_name: rawUser.displayName || normalizedEmail.split('@')[0],
            status,
            is_local_user: true,
            last_login_at: rawUser.lastLoginAt || null
          };
        }
      }
    } catch (fileErr: any) {
      console.error('[LocalAuthenticationProvider] Fallback user lookup error:', fileErr?.message || fileErr);
    }
    return null;
  }

  /**
   * Primary authentication method for Local users (VYR-014).
   * Validates credentials, checks account status, and compares password via async bcrypt.
   */
  public async authenticate(credentials: AuthCredentials): Promise<AuthenticationResult> {
    const rawEmail = credentials.email;
    const rawPassword = credentials.password;

    // 1. Missing credentials check
    if (!rawEmail || !rawPassword) {
      return {
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: LOCAL_AUTH_GENERIC_FAILURE_MSG
      };
    }

    // 2. Email normalization
    const normalized = this.normalizeEmail(rawEmail);

    // 3. Email format validation
    if (!this.validateEmailFormat(normalized)) {
      return {
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: LOCAL_AUTH_GENERIC_FAILURE_MSG
      };
    }

    try {
      // 4. User lookup
      const dbUser = await this.lookupUser(normalized);

      if (!dbUser) {
        return {
          success: false,
          code: 'INVALID_CREDENTIALS',
          message: LOCAL_AUTH_GENERIC_FAILURE_MSG
        };
      }

      // 5. Account status validation (fail-closed for any non-ACTIVE status)
      if (dbUser.status !== 'ACTIVE') {
        return {
          success: false,
          code: 'ACCOUNT_INACTIVE',
          status: dbUser.status,
          message: LOCAL_AUTH_INACTIVE_MSG
        };
      }

      // 6. Password hash validation
      if (!dbUser.password_hash) {
        return {
          success: false,
          code: 'INVALID_CREDENTIALS',
          message: LOCAL_AUTH_GENERIC_FAILURE_MSG
        };
      }

      // 7. Asynchronous bcrypt compare (non-blocking)
      const isMatch = await this.comparePassword(rawPassword, dbUser.password_hash);
      if (!isMatch) {
        return {
          success: false,
          code: 'INVALID_CREDENTIALS',
          message: LOCAL_AUTH_GENERIC_FAILURE_MSG
        };
      }

      // 8. Authentication successful
      return {
        success: true,
        identity: {
          id: dbUser.id,
          email: dbUser.email,
          displayName: dbUser.display_name,
          status: dbUser.status,
          metadata: {
            isLocalUser: dbUser.is_local_user ?? true,
            provider: 'LOCAL'
          }
        },
        providerMetadata: this.metadata
      };
    } catch (err: any) {
      console.error('[LocalAuthenticationProvider Error]:', err?.message || err);
      return {
        success: false,
        code: 'AUTH_PROVIDER_ERROR',
        message: 'An internal authentication error occurred.'
      };
    }
  }

  /**
   * Resolves a Veyra user identity by email or identifier.
   */
  public async resolveIdentity(identifier: string): Promise<IdentityProfile | null> {
    if (!identifier) return null;
    const normalized = this.normalizeEmail(identifier);

    try {
      const user = await this.lookupUser(normalized);
      if (!user) return null;

      return {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        status: user.status,
        metadata: {
          isLocalUser: user.is_local_user ?? true,
          provider: 'LOCAL'
        }
      };
    } catch (err: any) {
      console.error('[LocalAuthenticationProvider resolveIdentity Error]:', err?.message || err);
      return null;
    }
  }
}
