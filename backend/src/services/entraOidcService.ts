import crypto from 'crypto';
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from 'jose';
import { config } from '../config.js';

const STATE_TTL_MS = 10 * 60 * 1000;

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

interface PendingAuthorization {
  nonce: string;
  codeVerifier: string;
  createdAt: number;
}

export interface EntraIdentity {
  email: string;
  subject: string;
  tenantId: string;
  roles?: string[];
  groups?: string[];
  displayName?: string;
}

export class EntraOidcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = 'EntraOidcError';
  }
}

// Short-lived, single-use authorization transactions. Keyed by state.
const pendingAuthorizations = new Map<string, PendingAuthorization>();

function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function entraConfig(): EntraConfig {
  return { ...config.entra };
}

export function isEntraEnabled(): boolean {
  const entra = config.entra;
  return config.authProvider === 'ENTRA'
    && Boolean(entra.tenantId && entra.clientId && entra.redirectUri);
}

function issuerFor(cfg: EntraConfig): string {
  return `https://login.microsoftonline.com/${cfg.tenantId}/v2.0`;
}

function jwksUriFor(cfg: EntraConfig): string {
  return `https://login.microsoftonline.com/${cfg.tenantId}/discovery/v2.0/keys`;
}

function tokenEndpointFor(cfg: EntraConfig): string {
  return `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`;
}

export function createPkcePair(verifier = randomToken()): { codeVerifier: string; codeChallenge: string } {
  const codeChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { codeVerifier: verifier, codeChallenge };
}

export function buildAuthorizationUrl(
  cfg: EntraConfig,
  params: { state: string; nonce: string; codeChallenge: string }
): string {
  const url = new URL(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export function createAuthorizationRequest(
  cfg: EntraConfig = entraConfig()
): { authorizationUrl: string; state: string } {
  const state = randomToken();
  const nonce = randomToken();
  const { codeVerifier, codeChallenge } = createPkcePair();

  pendingAuthorizations.set(state, { nonce, codeVerifier, createdAt: Date.now() });
  purgeExpired(Date.now());

  return {
    authorizationUrl: buildAuthorizationUrl(cfg, { state, nonce, codeChallenge }),
    state,
  };
}

/**
 * Builds the Microsoft Entra ID end-session (logout) URL for upstream Single Logout (SLO).
 * Story: VYR-017
 */
export function buildEntraLogoutUrl(
  cfg: EntraConfig = entraConfig(),
  postLogoutRedirectUri?: string
): string {
  const tenantId = cfg.tenantId || 'common';
  const redirectUri = postLogoutRedirectUri || cfg.redirectUri;
  const url = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/logout`);
  if (redirectUri) {
    url.searchParams.set('post_logout_redirect_uri', redirectUri);
  }
  return url.toString();
}

export function consumeState(state: string, now = Date.now()): PendingAuthorization | null {
  const entry = pendingAuthorizations.get(state);
  if (!entry) return null;
  pendingAuthorizations.delete(state);
  if (now - entry.createdAt > STATE_TTL_MS) return null;
  return entry;
}

function purgeExpired(now: number): void {
  for (const [state, entry] of pendingAuthorizations) {
    if (now - entry.createdAt > STATE_TTL_MS) pendingAuthorizations.delete(state);
  }
}

export function extractIdentityEmail(claims: JWTPayload | Record<string, unknown>): string | null {
  const candidates = [claims.preferred_username, claims.email, claims.upn];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const email = candidate.trim().toLowerCase();
      if (email.includes('@')) return email;
    }
  }
  return null;
}

export function validateEntraClaims(
  claims: JWTPayload | Record<string, unknown>,
  expected: { issuer: string; audience: string; tenantId: string; nonce: string }
): void {
  if (claims.iss !== expected.issuer) {
    throw new EntraOidcError('INVALID_TOKEN', 'Microsoft sign-in could not be verified.', 401);
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expected.audience)) {
    throw new EntraOidcError('INVALID_TOKEN', 'Microsoft sign-in could not be verified.', 401);
  }

  if (claims.tid !== expected.tenantId) {
    throw new EntraOidcError('INVALID_TOKEN', 'Microsoft sign-in could not be verified.', 401);
  }

  if (claims.nonce !== expected.nonce) {
    throw new EntraOidcError('INVALID_TOKEN', 'Microsoft sign-in could not be verified.', 401);
  }

  if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) {
    throw new EntraOidcError('INVALID_TOKEN', 'Microsoft sign-in could not be verified.', 401);
  }

  if (!extractIdentityEmail(claims)) {
    throw new EntraOidcError('INVALID_TOKEN', 'Microsoft sign-in could not be verified.', 401);
  }
}

export async function verifyEntraIdToken(
  idToken: string,
  options: { config: EntraConfig; jwks: JWTVerifyGetKey; nonce: string }
): Promise<JWTPayload> {
  const issuer = issuerFor(options.config);
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(idToken, options.jwks, {
      issuer,
      audience: options.config.clientId,
      algorithms: ['RS256'],
      clockTolerance: 60,
    });
    payload = result.payload;
  } catch {
    throw new EntraOidcError('INVALID_TOKEN', 'Microsoft sign-in could not be verified.', 401);
  }

  validateEntraClaims(payload, {
    issuer,
    audience: options.config.clientId,
    tenantId: options.config.tenantId,
    nonce: options.nonce,
  });

  return payload;
}

export async function completeAuthorization(
  code: string,
  state: string,
  deps: { config?: EntraConfig; fetchImpl?: typeof fetch; jwks?: JWTVerifyGetKey } = {}
): Promise<EntraIdentity> {
  const pending = consumeState(state);
  if (!pending) {
    throw new EntraOidcError('INVALID_STATE', 'The sign-in request is invalid or has expired. Please try again.');
  }

  const cfg = deps.config ?? entraConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: pending.codeVerifier,
  });
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);

  const fetchImpl = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(tokenEndpointFor(cfg), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch {
    throw new EntraOidcError('TOKEN_EXCHANGE_FAILED', 'Microsoft sign-in could not be completed. Please try again.', 502);
  }

  if (!response.ok) {
    throw new EntraOidcError('TOKEN_EXCHANGE_FAILED', 'Microsoft sign-in could not be completed. Please try again.', 401);
  }

  let tokens: { id_token?: unknown };
  try {
    tokens = await response.json() as { id_token?: unknown };
  } catch {
    throw new EntraOidcError('TOKEN_EXCHANGE_FAILED', 'Microsoft sign-in could not be completed. Please try again.', 502);
  }

  if (typeof tokens.id_token !== 'string' || !tokens.id_token) {
    throw new EntraOidcError('INVALID_TOKEN', 'Microsoft sign-in could not be verified.', 401);
  }

  const jwks = deps.jwks ?? createRemoteJWKSet(new URL(jwksUriFor(cfg)));
  const payload = await verifyEntraIdToken(tokens.id_token, {
    config: cfg,
    jwks,
    nonce: pending.nonce,
  });

  const roles = Array.isArray(payload.roles)
    ? (payload.roles as unknown[]).map(String)
    : [];
  const groups = Array.isArray(payload.groups)
    ? (payload.groups as unknown[]).map(String)
    : [];
  const displayName = typeof payload.name === 'string'
    ? payload.name
    : undefined;

  return {
    email: extractIdentityEmail(payload) as string,
    subject: String(payload.oid ?? payload.sub ?? ''),
    tenantId: String(payload.tid ?? ''),
    roles,
    groups,
    displayName,
  };
}
