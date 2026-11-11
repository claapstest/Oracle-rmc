# Veyra JWT Access Token Issuance & JWKS Publication (VYR-020)

## 1. Overview & Scope

**Epic 3, Story VYR-020 — Veyra JWT Access Token Issuance & JWKS Publication.**

This document details the implementation of token issuance and public JWKS distribution for VEYRA, implementing against the v1 contract defined in [jwt_token_contract.md](jwt_token_contract.md) (VYR-019).

### Implemented Capabilities

1. **RSA Key Manager (`backend/src/auth/keyManager.ts`)**:
   - Loads RSA 2048+ private/public signing keys from environment (`JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`, PEM or Base64 format) or file paths (`JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH`).
   - Automatically provisions an ephemeral RSA 2048-bit keypair for development and testing environments when no keys are explicitly injected.
   - Manages Key IDs (`kid`) with rotation support, preserving retired public keys in the published JWKS during their grace periods.

2. **Token Issuance Service (`backend/src/auth/tokenService.ts`)**:
   - Issues compact JWS access tokens (`header.payload.signature`) using algorithm `RS256` and RFC 9068 media type `typ: "at+jwt"`.
   - Includes exact required claims: `iss` (`"veyra"`), `sub` (`veyra_user.id`), `aud` (`"veyra-api"`), `iat`, `nbf`, `exp` (`iat + 900`), `jti` (UUID v4), `sid` (`veyra_session.session_id`).
   - Strictly enforces zero PII or credentials in payloads (fails closed if forbidden claims are detected).
   - Lifetime is bounded to exactly 900 seconds (15 minutes), aligning with session inactivity policies.

3. **Public JWKS Endpoint (`/.well-known/jwks.json`)**:
   - RFC 7517 compliant JSON Web Key Set endpoint accessible at both `GET /.well-known/jwks.json` and `GET /api/.well-known/jwks.json`.
   - Exposes public modulus (`n`) and public exponent (`e`) with `kty: "RSA"`, `alg: "RS256"`, `use: "sig"`.
   - Exposes zero private key material (`d`, `p`, `q`, `dp`, `dq`, `qi`).

4. **Authentication & Session Integration (`backend/src/services/authService.ts`)**:
   - On successful login via `/api/auth/login` or Entra ID callback, the signed RS256 JWT access token is minted and returned to the client as `token` and `accessToken`, while binding to the PostgreSQL authoritative session via `sid` (`sessionId`).
   - Dual-format compatibility: `requireAuth` and `validateSession` seamlessly accept both RS256 JWT access tokens and legacy opaque session tokens during migration.
   - Preserves instant session revocation upon logout, user deactivation, or single-active-session supersession.

---

## 2. API Contract & Response Shape

### POST /api/auth/login Response

```json
{
  "success": true,
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6ImF0K2p3dCIsImtpZCI6InZleXJhLWtleS0xIn0.eyJpc3MiOiJ2ZXlyYSIsInN1YiI6IjNmMWM4YTcyLTlkNGUtNGIyMS1hNmYwLTFjMmQzZTRmNWE2YiIsImF1ZCI6InZleXJhLWFwaSIsImlhdCI6MTc2MjgxOTIwMCwibmJmIjoxNzYyODE5MjAwLCJleHAiOjE3NjI4MjAxMDAsImp0aSI6IjhjMmIxZjBlLTRhN2QtNGYzYy05ZTIxLTViNmE3YzhkOWUwZiIsInNpZCI6ImEzZjljMmQxZTRiNWE2ZjdjOGQ5ZTBmMWEyYjNjNGQ1ZTZmN2E4YjljMGQxZTJmM2E0YjVjNmQ3ZThmOWEwYjEifQ.signature...",
  "accessToken": "eyJhbGciOiJSUzI1Ni...",
  "sessionId": "a3f9c2d1e4b5a6f7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1",
  "userId": "3f1c8a72-9d4e-4b21-a6f0-1c2d3e4f5a6b",
  "displayName": "Akash Meesarapu",
  "email": "akash.meesarapu@claaps.com",
  "role": "AUDIT_MANAGER",
  "permissions": ["VIEW_ALL_CONTROLS", "EXECUTE_REPORTS"],
  "status": "ACTIVE",
  "isAdmin": false,
  "setupCompleted": true,
  "environmentMode": "ORACLE_FUSION",
  "authProvider": "LOCAL",
  "message": "Authentication successful."
}
```

### GET /.well-known/jwks.json Response

```json
{
  "keys": [
    {
      "kty": "RSA",
      "n": "1hWtxBlmE_W3gK0Qbu77Z_...",
      "e": "AQAB",
      "kid": "veyra-key-1",
      "alg": "RS256",
      "use": "sig"
    }
  ]
}
```

---

## 3. Verification Suite

Run automated verification:

```bash
npm --prefix backend run test:vyr20
```

Coverage:
- 43 automated assertions covering RSA Key Manager, JWKS distribution, token claims, zero PII, cryptographic tamper verification, algorithm confusion immunity, login integration, and logout revocation.

