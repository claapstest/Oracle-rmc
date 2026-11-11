/**
 * VEYRA Access Token Contract v1 (VYR-019)
 *
 * Single source of truth for the claims, algorithm, type and lifetime of
 * Veyra-issued JWTs. Issuance (VYR-020) and verification (VYR-021) must both
 * read these constants instead of re-declaring them, so the documented contract
 * and the runtime behaviour cannot drift apart.
 *
 * Human-readable specification: docs/architecture/jwt_token_contract.md
 */

export const VEYRA_JWT_CONTRACT_VERSION = 'v1';

/** Only this algorithm may be used to sign or accept Veyra access tokens. */
export const VEYRA_JWT_ALGORITHM = 'RS256';

/** RFC 9068 access-token media/typ value. */
export const VEYRA_JWT_TYPE = 'at+jwt';

/** 15 minutes, matching the existing session inactivity window. */
export const VEYRA_JWT_LIFETIME_SECONDS = 15 * 60;

/** Deployment defaults; issuance may override from environment configuration. */
export const VEYRA_JWT_ISSUER = 'veyra';
export const VEYRA_JWT_AUDIENCE = 'veyra-api';

/** Every issued token must carry exactly these claims. */
export const VEYRA_JWT_REQUIRED_CLAIMS = [
  'iss',
  'sub',
  'aud',
  'iat',
  'nbf',
  'exp',
  'jti',
  'sid',
] as const;

/**
 * Claims that must never appear in a Veyra access token. JWTs are signed, not
 * encrypted, so anything here would be readable by whoever holds the token.
 */
export const VEYRA_JWT_FORBIDDEN_CLAIMS = [
  'email',
  'upn',
  'preferred_username',
  'name',
  'display_name',
  'roles',
  'groups',
  'permissions',
  'password',
  'password_hash',
  'token',
] as const;

export type VeyraJwtRequiredClaim = (typeof VEYRA_JWT_REQUIRED_CLAIMS)[number];
export type VeyraJwtForbiddenClaim = (typeof VEYRA_JWT_FORBIDDEN_CLAIMS)[number];

export interface VeyraAccessTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  nbf: number;
  exp: number;
  jti: string;
  sid: string;
}
