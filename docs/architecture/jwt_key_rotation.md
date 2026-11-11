# Veyra Signing Key Lifecycle and Rotation Runbook (VYR-022)

## 1. Scope

**Epic 3, Story VYR-022 — Implement signing key ID, JWKS and key rotation.**

This runbook defines how Veyra signing keys are generated, activated, retired and
revoked in an emergency. It operates on the key manager implemented in
`backend/src/auth/keyManager.ts` and the contract fixed by
[jwt_token_contract.md](jwt_token_contract.md) (VYR-019).

The goal is safe rollover: a key change must never invalidate tokens that are still
inside their 15-minute lifetime.

---

## 2. Configuration Surface

| Variable | Purpose |
|---|---|
| `JWT_KEY_ID` | `kid` placed in the protected header of newly issued tokens. |
| `JWT_PRIVATE_KEY` | PKCS#8 RSA private key (PEM or Base64). Never published. |
| `JWT_PUBLIC_KEY` | SPKI RSA public key. Optional; derived from the private key when omitted. |
| `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` | File-based alternative to the inline values. |
| `JWT_PREVIOUS_KEY_ID` | `kid` of the retiring key during an overlap window. |
| `JWT_PREVIOUS_PUBLIC_KEY` | Public key of the retiring key, published in JWKS during the overlap window. |
| `JWT_PREVIOUS_PUBLIC_KEY_PATH` | File-based alternative for the retiring public key. |
| `JWT_REVOKED_KEY_IDS` | Comma-separated `kid` list removed from JWKS immediately (emergency revocation). |

---

## 3. Generation and Activation

1. Generate an RSA 2048-bit (minimum) keypair:

   ```bash
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt_new_private.pem
   openssl pkey -in jwt_new_private.pem -pubout -out jwt_new_public.pem
   ```

2. Store the **private key only** in the secret manager or workload-identity-backed
   secret store. It is never committed, never logged, and never sent to the browser.
3. Set `JWT_PRIVATE_KEY` (or `JWT_PRIVATE_KEY_PATH`) and `JWT_PUBLIC_KEY`, and set
   `JWT_KEY_ID` to a new unique identifier such as `veyra-key-2026-11`.
4. Deploy. New tokens are signed with the new `kid`; the JWKS endpoint publishes the
   corresponding public key.

---

## 4. Rotation with Overlap

Rotation is a three-step deployment. Steps 2 and 3 are separated by at least the
token lifetime.

1. **Prepare the new key** — generate and store it, but keep the current key active.
2. **Activate and overlap** — set the new key as `JWT_KEY_ID` / `JWT_PRIVATE_KEY`, and
   set `JWT_PREVIOUS_KEY_ID` / `JWT_PREVIOUS_PUBLIC_KEY` to the old key. Deploy.
   - JWKS now publishes **both** keys.
   - Tokens signed with either key verify.
   - New tokens are signed with the new `kid`.
3. **Retire** — after at least **900 seconds (15 minutes)**, equal to the token
   lifetime, remove `JWT_PREVIOUS_KEY_ID` and `JWT_PREVIOUS_PUBLIC_KEY` and deploy.
   - The old public key disappears from JWKS.
   - Tokens signed with the old key are rejected.
   - The old private key may then be destroyed.

The 900-second window guarantees that no token minted by the retiring key is still
valid when that key stops being published.

---

## 5. Emergency Revocation

Use this when a private key is suspected compromised. It takes effect on the next
`getJwks()` call — no token-lifetime wait.

1. Add the compromised `kid` to `JWT_REVOKED_KEY_IDS` (comma-separated for multiple).
2. Deploy immediately.
3. The key is removed from JWKS and every token signed with it fails closed with
   `INVALID_TOKEN`.
4. Revoke and reissue the compromised private key, then activate a replacement using
   the normal procedure in section 3.

Revoking the **active** key is permitted and fail-closed: that `kid` is removed from
JWKS and every token signed with it is rejected until a replacement key is activated.
A warning is logged identifying the revoked active `kid`. Any approved retiring key
stays published, so revocation of one key does not disturb the other.

> Note: the JWKS endpoint sends `Cache-Control: public, max-age=300`. In-process
> verification is immediate, but an external verifier that caches JWKS may keep the
> revoked key for up to five minutes.

---

## 6. Invariants

- **Private key material is never published.** JWKS contains only `kty`, `n`, `e`,
  `kid`, `alg` and `use`; no `d`, `p`, `q`, `dp`, `dq`, `qi` or `oth` members.
- Only `RS256` is accepted, for both signing and verification.
- The `kid` header is mandatory; a token without `kid`, or with a `kid` absent from
  JWKS, is rejected.
- Verification resolves keys from JWKS by `kid` and never trusts a key supplied by
  the caller.
- An overlap window shorter than 900 seconds risks rejecting tokens that are still
  valid.

---

## 7. Verification

```bash
npm --prefix backend run test:vyr22
```

The suite exercises activation, overlap, retirement, emergency revocation, key
substitution, algorithm confusion and private-material exposure.
