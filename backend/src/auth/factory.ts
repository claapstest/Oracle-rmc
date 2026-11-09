import {
  AuthenticationProvider,
  AuthProviderType,
  ConfigurationError
} from './types.js';
import { LocalAuthenticationProvider } from './providers/LocalAuthenticationProvider.js';
import { EntraAuthenticationProvider, EntraConfig } from './providers/EntraAuthenticationProvider.js';

export class AuthenticationProviderFactory {
  private static instance: AuthenticationProvider | null = null;
  private static configuredProviderType: AuthProviderType | null = null;

  /**
   * Initializes the application authentication provider at startup based strictly on deployment configuration.
   * Throws ConfigurationError if the provider is unknown or if required configuration is missing.
   */
  public static initialize(
    explicitProviderType?: string,
    explicitEntraConfig?: Partial<EntraConfig>
  ): AuthenticationProvider {
    const rawType = (explicitProviderType || process.env.AUTH_PROVIDER || 'LOCAL').trim().toUpperCase();

    // 1. Validate that the configured provider is recognized
    if (rawType !== 'LOCAL' && rawType !== 'ENTRA') {
      throw new ConfigurationError(
        `Unknown or unsupported AUTH_PROVIDER "${explicitProviderType || process.env.AUTH_PROVIDER}". Supported providers are LOCAL and ENTRA.`,
        'UNKNOWN_AUTH_PROVIDER'
      );
    }

    const providerType = rawType as AuthProviderType;

    // 2. Select and instantiate the configured provider
    if (providerType === 'ENTRA') {
      const entraConfig: EntraConfig = {
        tenantId: explicitEntraConfig?.tenantId || process.env.ENTRA_TENANT_ID || process.env.AZURE_TENANT_ID || '',
        clientId: explicitEntraConfig?.clientId || process.env.ENTRA_CLIENT_ID || process.env.AZURE_CLIENT_ID || '',
        clientSecret: explicitEntraConfig?.clientSecret || process.env.ENTRA_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '',
        redirectUri: explicitEntraConfig?.redirectUri || process.env.ENTRA_REDIRECT_URI || ''
      };

      const provider = new EntraAuthenticationProvider(entraConfig);
      // Validate configuration immediately — fails closed if missing required settings
      provider.validateConfiguration();

      this.instance = provider;
      this.configuredProviderType = 'ENTRA';
      return provider;
    }

    // Default: LOCAL provider
    const localProvider = new LocalAuthenticationProvider();
    localProvider.validateConfiguration();

    this.instance = localProvider;
    this.configuredProviderType = 'LOCAL';
    return localProvider;
  }

  /**
   * Retrieves the currently active singleton AuthenticationProvider instance.
   * If not already initialized, initializes using the deployment environment.
   */
  public static getProvider(): AuthenticationProvider {
    if (!this.instance) {
      return this.initialize();
    }
    return this.instance;
  }

  /**
   * Returns the configured provider type selected at startup ('LOCAL' | 'ENTRA').
   */
  public static getConfiguredProviderType(): AuthProviderType {
    if (!this.configuredProviderType) {
      this.getProvider();
    }
    return this.configuredProviderType || 'LOCAL';
  }

  /**
   * Resets the factory singleton instance. Used exclusively in automated testing suites.
   */
  public static reset(): void {
    this.instance = null;
    this.configuredProviderType = null;
  }
}

/**
 * Convenience accessor for controllers and services to consume the provider abstraction.
 */
export function getAuthenticationProvider(): AuthenticationProvider {
  return AuthenticationProviderFactory.getProvider();
}

/**
 * Explicit startup initialization helper.
 */
export function initializeAuthProvider(
  providerType?: string,
  entraConfig?: Partial<EntraConfig>
): AuthenticationProvider {
  return AuthenticationProviderFactory.initialize(providerType, entraConfig);
}

