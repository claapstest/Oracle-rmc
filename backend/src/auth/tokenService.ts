import crypto from 'crypto';
import * as jose from 'jose';
import {
  VEYRA_JWT_ALGORITHM,
  VEYRA_JWT_TYPE,
  VEYRA_JWT_LIFETIME_SECONDS,
  VEYRA_JWT_ISSUER,
  VEYRA_JWT_AUDIENCE,
  VEYRA_JWT_FORBIDDEN_CLAIMS,
  VeyraAccessTokenClaims
} from './jwtContract.js';
import { keyManager } from './keyManager.js';

export interface TokenIssuanceParams {
  userId: string;
  sessionId: string;
  issuer?: string;
  audience?: string;
}

export interface TokenVerificationResult {
  valid: boolean;
  claims?: VeyraAccessTokenClaims;
  code?: 'INVALID_TOKEN' | 'SESSION_EXPIRED';
  message?: string;
}

/**
 * TokenService
 *
 * Story VYR-020: Veyra JWT Access Token Issuance & Verification
 *
 * Implements the V1 JWT access token contract (VYR-019):
 * - Signs tokens using RS256 with header typ="at+jwt" and required kid
 * - Sets required claims: iss, sub, aud, iat, nbf, exp, jti, sid
 * - Enforces zero PII or credentials in payload (fails closed if forbidden claims present)
 * - Exact 900-second (15-minute) token lifetime
 * - Cryptographic verification against published JWKS
 */
class TokenService {
  /**
   * Checks whether a raw string has the compact JWS three-part shape.
   */
  public isJwt(token?: string | null): boolean {
    if (!token || typeof token !== 'string') return false;
    const parts = token.trim().split('.');
    return parts.length === 3 && parts[0].length > 0 && parts[1].length > 0 && parts[2].length > 0;
  }

  /**
   * Extracts the session ID (sid) from either a JWT token or an opaque sessionId string.
   */
  public extractSessionId(token?: string | null): string | null {
    if (!token || typeof token !== 'string') return null;
    const trimmed = token.trim();
    if (!this.isJwt(trimmed)) {
      return trimmed;
    }
    try {
      const payload = jose.decodeJwt(trimmed);
      return typeof payload.sid === 'string' && payload.sid ? payload.sid : null;
    } catch {
      return null;
    }
  }

  /**
   * Decodes protected header and claims payload without cryptographic verification.
   */
  public decodeToken(token: string): { header: jose.ProtectedHeaderParameters; payload: VeyraAccessTokenClaims } {
    if (!this.isJwt(token)) {
      throw new Error('Malformed token: Expected compact JWS with 3 segments.');
    }
    const header = jose.decodeProtectedHeader(token);
    const payload = jose.decodeJwt(token) as unknown as VeyraAccessTokenClaims;
    return { header, payload };
  }

  /**
   * Issues a signed Veyra JWT access token strictly compliant with the V1 contract.
   */
  public async issueAccessToken(params: TokenIssuanceParams): Promise<string> {
    const { userId, sessionId } = params;
    if (!userId || typeof userId !== 'string') {
      throw new Error('Token issuance error: userId (sub) is required.');
    }
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Token issuance error: sessionId (sid) is required.');
    }

    const bundle = await keyManager.getSigningKeyBundle();
    const now = Math.floor(Date.now() / 1000);
    const exp = now + VEYRA_JWT_LIFETIME_SECONDS;
    const jti = crypto.randomUUID();

    const issuer = (params.issuer || process.env.JWT_ISSUER || VEYRA_JWT_ISSUER).trim();
    const audience = (params.audience || process.env.JWT_AUDIENCE || VEYRA_JWT_AUDIENCE).trim();

    const payload: VeyraAccessTokenClaims = {
      iss: issuer,
      sub: userId,
      aud: audience,
      iat: now,
      nbf: now,
      exp,
      jti,
      sid: sessionId
    };

    // Defensive check: verify no forbidden claim is present
    for (const forbidden of VEYRA_JWT_FORBIDDEN_CLAIMS) {
      if ((payload as any)[forbidden] !== undefined) {
        throw new Error(`Security policy violation: Claim "${forbidden}" is forbidden in Veyra JWTs.`);
      }
    }

    return await new jose.SignJWT(payload as unknown as Record<string, unknown>)
      .setProtectedHeader({
        alg: VEYRA_JWT_ALGORITHM,
        typ: VEYRA_JWT_TYPE,
        kid: bundle.kid
      })
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(exp)
      .sign(bundle.privateKey);
  }

  /**
   * Cryptographically verifies a Veyra JWT access token against the published JWKS public keys.
   */
  public async verifyAccessToken(token: string, options?: { clockSkewSeconds?: number }): Promise<TokenVerificationResult> {
    if (!this.isJwt(token)) {
      return {
        valid: false,
        code: 'INVALID_TOKEN',
        message: 'Authentication required. Missing or malformed token.'
      };
    }

    let header: jose.ProtectedHeaderParameters;
    try {
      header = jose.decodeProtectedHeader(token);
    } catch {
      return {
        valid: false,
        code: 'INVALID_TOKEN',
        message: 'Malformed token header.'
      };
    }

    // Rule 2: Algorithm must be exactly RS256 and typ must be at+jwt
    if (header.alg !== VEYRA_JWT_ALGORITHM) {
      return {
        valid: false,
        code: 'INVALID_TOKEN',
        message: `Invalid token algorithm. Accepted: ${VEYRA_JWT_ALGORITHM}, received: ${header.alg}.`
      };
    }
    if (header.typ !== VEYRA_JWT_TYPE) {
      return {
        valid: false,
        code: 'INVALID_TOKEN',
        message: `Invalid token type. Accepted: ${VEYRA_JWT_TYPE}, received: ${header.typ}.`
      };
    }

    // Rule 3: kid must be present
    const kid = header.kid;
    if (!kid) {
      return {
        valid: false,
        code: 'INVALID_TOKEN',
        message: 'Missing kid header in token.'
      };
    }

    // Resolve key from JWKS
    const jwks = await keyManager.getJwks();
    const matchingJwk = jwks.keys.find(k => k.kid === kid);
    if (!matchingJwk) {
      return {
        valid: false,
        code: 'INVALID_TOKEN',
        message: `Signing key with kid "${kid}" not found in JWKS.`
      };
    }

    try {
      const publicKey = await jose.importJWK(matchingJwk, VEYRA_JWT_ALGORITHM);
      const expectedIssuer = (process.env.JWT_ISSUER || VEYRA_JWT_ISSUER).trim();
      const expectedAudience = (process.env.JWT_AUDIENCE || VEYRA_JWT_AUDIENCE).trim();

      const { payload } = await jose.jwtVerify(token, publicKey, {
        issuer: expectedIssuer,
        audience: expectedAudience,
        algorithms: [VEYRA_JWT_ALGORITHM],
        clockTolerance: options?.clockSkewSeconds || 5
      });

      // Assert no forbidden claim
      for (const forbidden of VEYRA_JWT_FORBIDDEN_CLAIMS) {
        if ((payload as any)[forbidden] !== undefined) {
          return {
            valid: false,
            code: 'INVALID_TOKEN',
            message: `Token contains forbidden claim "${forbidden}".`
          };
        }
      }

      // Assert required claims are present and non-empty
      if (!payload.sub || !payload.jti || !(payload as any).sid) {
        return {
          valid: false,
          code: 'INVALID_TOKEN',
          message: 'Token is missing required claims (sub, jti, or sid).'
        };
      }

      return {
        valid: true,
        claims: payload as unknown as VeyraAccessTokenClaims
      };
    } catch (err: any) {
      if (err.code === 'ERR_JWT_EXPIRED') {
        return {
          valid: false,
          code: 'SESSION_EXPIRED',
          message: 'Your token has expired. Please sign in again.'
        };
      }
      return {
        valid: false,
        code: 'INVALID_TOKEN',
        message: `Token verification failed: ${err.message}`
      };
    }
  }
}

export const tokenService = new TokenService();

