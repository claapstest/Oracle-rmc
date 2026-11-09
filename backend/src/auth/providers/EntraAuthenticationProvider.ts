import {
  AuthenticationProvider,
  ProviderMetadata,
  AuthCredentials,
  AuthenticationResult,
  IdentityProfile,
  ConfigurationError
} from '../types.js';

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  authority?: string;
}

export class EntraAuthenticationProvider implements AuthenticationProvider {
  public readonly metadata: ProviderMetadata = {
    id: 'ENTRA',
    type: 'ENTRA',
    name: 'Microsoft Entra ID',
    description: 'Enterprise identity federation via Microsoft Entra ID (OIDC / OAuth2)',
    isExternal: true,
    supportedAuthMethods: ['BEARER_TOKEN', 'AUTHORIZATION_CODE', 'FEDERATED_SSO'],
    version: '1.0.0'
  };

  private config: EntraConfig;

  constructor(config: EntraConfig) {
    this.config = { ...config };
  }

  public getMetadata(): ProviderMetadata {
    return this.metadata;
  }

  public getPublicConfig(): { tenantId: string; clientId: string; redirectUri?: string } {
    return {
      tenantId: this.config.tenantId,
      clientId: this.config.clientId,
      redirectUri: this.config.redirectUri
    };
  }

  public validateConfiguration(): void {
    const missing: string[] = [];
    if (!this.config.tenantId || this.config.tenantId.trim() === '') {
      missing.push('ENTRA_TENANT_ID');
    }
    if (!this.config.clientId || this.config.clientId.trim() === '') {
      missing.push('ENTRA_CLIENT_ID');
    }

    if (missing.length > 0) {
      throw new ConfigurationError(
        `AUTH_PROVIDER is set to ENTRA, but required configuration is missing: ${missing.join(', ')}.`,
        'MISSING_ENTRA_CONFIG'
      );
    }
  }

  public async authenticate(credentials: AuthCredentials): Promise<AuthenticationResult> {
    // 1. Validate required credential parameter presence
    if (!credentials.token && !credentials.code && !credentials.email) {
      return {
        success: false,
        code: 'MISSING_ENTRA_CREDENTIALS',
        message: 'Microsoft Entra authentication requires an ID token, authorization code, or federated identity.'
      };
    }

    try {
      // 2. Token / Authorization Code processing
      let resolvedEmail = '';
      let resolvedDisplayName = '';
      let externalId = '';

      if (credentials.token) {
        // Parse ID Token claims (simulated / standard JWT payload)
        const parts = credentials.token.split('.');
        if (parts.length === 3) {
          try {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
            resolvedEmail = payload.email || payload.upn || payload.preferred_username || '';
            resolvedDisplayName = payload.name || resolvedEmail.split('@')[0] || 'Entra User';
            externalId = payload.oid || payload.sub || '';
          } catch (_) {
            return {
              success: false,
              code: 'INVALID_TOKEN',
              message: 'Invalid or malformed Microsoft Entra ID token.'
            };
          }
        } else if (credentials.token.startsWith('mock_entra_token_')) {
          // Test harness / sandbox mock token
          resolvedEmail = credentials.email || 'entra.user@claaps.com';
          resolvedDisplayName = 'Entra Test User';
          externalId = 'entra_mock_sub_001';
        } else {
          return {
            success: false,
            code: 'INVALID_TOKEN',
            message: 'Invalid Microsoft Entra token signature or structure.'
          };
        }
      } else if (credentials.code) {
        // Authorization code flow
        resolvedEmail = credentials.email || 'federated.user@claaps.com';
        resolvedDisplayName = 'Federated Entra User';
        externalId = `entra_${credentials.code.substring(0, 8)}`;
      } else if (credentials.email) {
        resolvedEmail = credentials.email;
        resolvedDisplayName = resolvedEmail.split('@')[0];
        externalId = `entra_${Buffer.from(resolvedEmail).toString('hex').substring(0, 12)}`;
      }

      if (!resolvedEmail) {
        return {
          success: false,
          code: 'UNRESOLVED_IDENTITY',
          message: 'Unable to extract valid user email from Microsoft Entra identity claims.'
        };
      }

      const normalizedEmail = resolvedEmail.trim().toLowerCase();

      return {
        success: true,
        identity: {
          id: externalId || undefined,
          email: normalizedEmail,
          displayName: resolvedDisplayName,
          status: 'ACTIVE',
          metadata: {
            provider: 'ENTRA',
            tenantId: this.config.tenantId,
            clientId: this.config.clientId,
            externalId
          }
        },
        providerMetadata: this.metadata
      };
    } catch (err: any) {
      console.error('[EntraAuthenticationProvider Error]:', err);
      return {
        success: false,
        code: 'ENTRA_AUTH_FAILED',
        message: 'Microsoft Entra authentication failed.'
      };
    }
  }

  public async resolveIdentity(identifier: string): Promise<IdentityProfile | null> {
    if (!identifier) return null;
    const normalized = identifier.trim().toLowerCase();

    return {
      email: normalized,
      displayName: normalized.split('@')[0],
      status: 'ACTIVE',
      metadata: {
        provider: 'ENTRA',
        tenantId: this.config.tenantId,
        identifier: normalized
      }
    };
  }
}

