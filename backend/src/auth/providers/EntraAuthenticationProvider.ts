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

    // VYR-011: ID tokens and codes are only trusted after the BFF callback validates
    // issuer, audience, tenant, nonce, expiry and signature. Never authenticate raw input here.
    return {
      success: false,
      code: 'ENTRA_AUTH_FAILED',
      message: 'Microsoft Entra sign-in must complete through the authorization-code callback.'
    };
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

