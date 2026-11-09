import bcrypt from 'bcryptjs';
import { query as dbQuery } from '../../db.js';
import {
  AuthenticationProvider,
  ProviderMetadata,
  AuthCredentials,
  AuthenticationResult,
  IdentityProfile
} from '../types.js';

export class LocalAuthenticationProvider implements AuthenticationProvider {
  public readonly metadata: ProviderMetadata = {
    id: 'LOCAL',
    type: 'LOCAL',
    name: 'Local Database Authentication',
    description: 'PostgreSQL-backed bcrypt credential authentication for local VEYRA users',
    isExternal: false,
    supportedAuthMethods: ['PASSWORD'],
    version: '1.0.0'
  };

  public getMetadata(): ProviderMetadata {
    return this.metadata;
  }

  public validateConfiguration(): void {
    // Local provider uses primary application database pool; no external third-party keys required.
  }

  public async authenticate(credentials: AuthCredentials): Promise<AuthenticationResult> {
    const rawEmail = credentials.email;
    const rawPassword = credentials.password;

    if (!rawEmail || !rawPassword) {
      return {
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.'
      };
    }

    const normalized = (rawEmail || '').trim().toLowerCase();

    try {
      const userRes = await dbQuery(
        `SELECT id, email, password_hash, display_name, status, is_local_user, last_login_at
         FROM veyra_user
         WHERE email = $1`,
        [normalized]
      );

      if (userRes.rows.length === 0) {
        return {
          success: false,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.'
        };
      }

      const dbUser = userRes.rows[0];

      if (dbUser.status !== 'ACTIVE') {
        return {
          success: false,
          code: 'ACCOUNT_INACTIVE',
          status: dbUser.status,
          message: 'Your account is not active. Please contact a system administrator.'
        };
      }

      if (!dbUser.password_hash) {
        return {
          success: false,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.'
        };
      }

      const isMatch = bcrypt.compareSync(rawPassword, dbUser.password_hash);
      if (!isMatch) {
        return {
          success: false,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.'
        };
      }

      return {
        success: true,
        identity: {
          id: dbUser.id,
          email: dbUser.email,
          displayName: dbUser.display_name,
          status: dbUser.status,
          metadata: {
            isLocalUser: dbUser.is_local_user,
            provider: 'LOCAL'
          }
        },
        providerMetadata: this.metadata
      };
    } catch (err: any) {
      console.error('[LocalAuthenticationProvider Error]:', err);
      return {
        success: false,
        code: 'AUTH_PROVIDER_ERROR',
        message: 'An internal authentication error occurred.'
      };
    }
  }

  public async resolveIdentity(identifier: string): Promise<IdentityProfile | null> {
    if (!identifier) return null;
    const normalized = identifier.trim().toLowerCase();

    try {
      const userRes = await dbQuery(
        `SELECT id, email, display_name, status, is_local_user
         FROM veyra_user
         WHERE email = $1 OR id::text = $1`,
        [normalized]
      );

      if (userRes.rows.length === 0) return null;

      const dbUser = userRes.rows[0];
      return {
        id: dbUser.id,
        email: dbUser.email,
        displayName: dbUser.display_name,
        status: dbUser.status,
        metadata: {
          isLocalUser: dbUser.is_local_user,
          provider: 'LOCAL'
        }
      };
    } catch (err: any) {
      console.error('[LocalAuthenticationProvider resolveIdentity Error]:', err);
      return null;
    }
  }
}

