# VEYRA JWT Access Token Contract (VYR-019)

## 1. Overview & Scope

**Epic 3, Story VYR-019 — Define Veyra JWT claims, token lifetime and signing policy.**

This document is the versioned contract for access tokens issued by VEYRA. It is a
design artefact: no issuance or verification code ships with this story. VYR-020
(issuance) and VYR-021 (verification middleware) implement against this contract.

The machine-readable form of this contract lives in
`backend/src/auth/jwtContract.ts`. The document and that module are kept in sync by
`backend/scripts/test_story_019_jwt_contract.cjs`.

**Contract version: `v1`**

### Current state

Today login issues a 32-byte opaque hex token and `veyra_session` is authoritative.
`requireAuth` looks that token up in the session store on every request. `v1` replaces
the token format, **not** the session model: `veyra_session` stays authoritative and the
token carries a `sid` claim pointing at it.

---

## 2. Signing Policy

| Property | Value | Rationale |
|---|---|---|
| Algorithm | `RS256` | Asymmetric, widely supported, already available via `jose` in this backend. |
| Key type | RSA 2048-bit minimum | Adequate for the token lifetime and standard tooling. |
| `typ` header | `at+jwt` | RFC 9068 access-token typing; prevents a token being replayed as an ID token. |
| `kid` header | Required | Selects the verification key during rotation. |
| Algorithms accepted | `RS256` only | Never accept `none`, `HS256`, or any algorithm supplied by the token itself. |

### Key management

- The signing private key is supplied through deployment configuration and never
  committed to the repository.
- Only the public key is published, at `GET /.well-known/jwks.json`.
- Exactly one key signs at a time; the previous public key stays in the JWKS for one
  token lifetime (900 seconds) after rotation so in-flight tokens still verify.
- Verification selects the key by the `kid` header and rejects unknown `kid` values.

---

## 3. Lifetime and Renewal

| Property | Value |
|---|---|
| Access token lifetime | **900 seconds (15 minutes)** |
| Renewal | Sliding, driven by session activity |
| Absolute cap | None in `v1`; the session inactivity window governs |

The 15-minute lifetime intentionally matches the existing
`SESSION_INACTIVITY_TIMEOUT_MINUTES` default. A token is therefore never valid for
longer than the session it represents.

Renewal re-issues a token **only after** the presented session has been validated as
`ACTIVE`. Renewal never extends a session that has been logged out, superseded by a
forced login, or expired.

---

## 4. Required Claims

Every token must carry exactly this claim set. No additional claims are permitted
without a contract version bump.

| Claim | Type | Meaning |
|---|---|---|
| `iss` | string | Issuer. Default `veyra`, deployment-overridable. |
| `sub` | string | Veyra user identifier (`veyra_user.id`). |
| `aud` | string | Intended audience. Default `veyra-api`. |
| `iat` | number | Issued-at, seconds since epoch. |
| `nbf` | number | Not-before, seconds since epoch. |
| `exp` | number | Expiry, seconds since epoch. Must equal `iat + 900`. |
| `jti` | string | Unique token identifier, for replay detection and audit correlation. |
| `sid` | string | Session identifier, bound to `veyra_session.session_id`. |

Example payload:

```json
{
  "iss": "veyra",
  "sub": "3f1c8a72-9d4e-4b21-a6f0-1c2d3e4f5a6b",
  "aud": "veyra-api",
  "iat": 1762819200,
  "nbf": 1762819200,
  "exp": 1762820100,
  "jti": "8c2b1f0e-4a7d-4f3c-9e21-5b6a7c8d9e0f",
  "sid": "a3f9c2d1e4b5a6f7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1"
}
```

---

## 5. Forbidden Claims — No PII, No Secrets

A JWT is **signed, not encrypted**. Anyone holding the token can read the payload.
The following must never appear in a Veyra access token:

`email`, `upn`, `preferred_username`, `name`, `display_name`, `roles`, `groups`,
`permissions`, `password`, `password_hash`, `token`.

Consequences for callers:

- Authorization data (roles, permissions) is resolved **server-side** from
  `veyra_user_role` on each request, never read from the token.
- Display data (email, name) is returned by the session/profile endpoint, not embedded.
- No secrets of any kind — no client secrets, no session tokens, no Oracle credentials.

---

## 6. Validation Rules

A Veyra access token is accepted only when **all** of the following hold. Any failure
is a fail-closed rejection with HTTP 401 `INVALID_TOKEN`.

1. The token is structurally a compact JWS with three segments.
2. The protected header `alg` is exactly `RS256` and `typ` is `at+jwt`.
3. The `kid` header resolves to a published, non-retired key.
4. The signature verifies against that key.
5. `iss` equals the configured issuer.
6. `aud` contains the configured audience.
7. `nbf` is not in the future (small clock skew allowance only).
8. `exp` is in the future.
9. `jti`, `sub` and `sid` are present and non-empty.
10. No forbidden claim from section 5 is present.
11. The session referenced by `sid` is `ACTIVE` and belongs to `sub`.

Rule 11 is what preserves instant revocation: logout, forced login and account
disablement take effect on the next request, not when the token expires.

---

## 7. Compatibility and Migration

- `v1` is additive to the existing opaque-token flow. Both may be accepted during a
  transition window, distinguished by token shape (three dot-separated segments).
- The opaque format is retired only after VYR-020 and VYR-021 are both deployed.
- `sid` is the only link between the token and session state; no session data is
  duplicated into the token.

---

## 8. Versioning Policy

- The version identifier is `v1` and is recorded in
  `VEYRA_JWT_CONTRACT_VERSION`.
- Adding, removing or renaming a required claim, changing the algorithm, or changing
  the lifetime requires a new version (`v2`) plus a migration note here.
- During a version transition, verification accepts both versions; issuance emits one.
- The version is **not** carried as a claim. It is identified by the `typ` header and
  the JWKS key set, keeping the payload minimal.

---

## 9. How to Verify This Contract Is Implemented

```bash
npm --prefix backend run test:vyr19
```

The check asserts that:

- `backend/src/auth/jwtContract.ts` exports version `v1`, algorithm `RS256`, type
  `at+jwt` and a 900-second lifetime.
- The required claim list is exactly `iss`, `sub`, `aud`, `iat`, `nbf`, `exp`, `jti`,
  `sid`.
- No forbidden claim overlaps the required claim list.
- This document mentions every required claim, the algorithm, the type, the lifetime
  and the version, so documentation cannot silently drift from code.

Note: the npm script is `test:vyr19` because `test:story19` already belongs to the
unrelated internal reports story (`test_story_019_reports_db.cjs`).

---

## 10. Out of Scope

Token issuance, JWKS publication, verification middleware, refresh endpoints and client
storage are delivered by VYR-020, VYR-021 and later Epic 3 stories. This story fixes the
contract only.
