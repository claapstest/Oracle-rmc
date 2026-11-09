/**
 * Authentication Provider Abstraction Types & Interfaces
 * Decouples authentication routes and controllers from identity-provider implementations.
 */

export type AuthProviderType = 'LOCAL' | 'ENTRA';

export interface ProviderMetadata {
  id: string;
  type: AuthProviderType;
  name: string;
  description: string;
  isExternal: boolean;
  supportedAuthMethods: string[];
  version?: string;
}

export interface AuthCredentials {
  email?: string;
  password?: string;
  code?: string;
  token?: string;
  redirectUri?: string;
  clientMeta?: {
    ipAddress?: string;
    userAgent?: string;
    force?: boolean;
  };
}

export interface IdentityProfile {
  id?: string;
  email: string;
  displayName?: string;
  status?: string;
  roles?: string[];
  permissions?: string[];
  metadata?: Record<string, any>;
}

export interface AuthenticationResult {
  success: boolean;
  code?: string;
  message?: string;
  status?: string;
  identity?: IdentityProfile;
  providerMetadata?: ProviderMetadata;
  rawPayload?: any;
}

export interface AuthenticationProvider {
  readonly metadata: ProviderMetadata;
  
  /**
   * Returns provider descriptive metadata
   */
  getMetadata(): ProviderMetadata;

  /**
   * Authenticates caller credentials and returns structured result
   */
  authenticate(credentials: AuthCredentials): Promise<AuthenticationResult>;

  /**
   * Resolves identity profile by user identifier (email, external ID, or UUID)
   */
  resolveIdentity(identifier: string): Promise<IdentityProfile | null>;

  /**
   * Validates required deployment configuration. Throws ConfigurationError if invalid.
   */
  validateConfiguration(): void;
}

export class ConfigurationError extends Error {
  public readonly code: string;
  public readonly safeDiagnostic: string;

  constructor(message: string, code = 'CONFIGURATION_ERROR') {
    super(message);
    this.name = 'ConfigurationError';
    this.code = code;
    this.safeDiagnostic = message;
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

