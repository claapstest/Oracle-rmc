# Deployment-Level Authentication Provider Configuration (VYR-016)

## 1. Overview & Objectives

In accordance with **Epic 2 (Configurable authentication providers: Entra ID and Local Users)** and **Story VYR-016**, VEYRA enforces a single, deterministic authentication provider per deployment environment.

Authentication provider selection is governed entirely by server-side deployment configuration (`AUTH_PROVIDER`). Client requests cannot switch or override the active provider via payload manipulation or query parameters.

---

## 2. Supported Deployment Modes

| Mode | Environment Variable | Target Environments | Identity Source | Credential Handling |
| :--- | :--- | :--- | :--- | :--- |
| **Local Mode** | `AUTH_PROVIDER=LOCAL` | Development, Testing, Air-gapped / Local Deployments | PostgreSQL `veyra_user` & local auth store | Asynchronous non-blocking bcrypt (`bcrypt.compare`) |
| **Entra Mode** | `AUTH_PROVIDER=ENTRA` | Production Enterprise Deployments | Customer Microsoft Entra Tenant (OIDC) | Authorization Code Flow + PKCE (S256), Microsoft JWKS validation |

---

## 3. Startup Configuration Validation (Fail-Closed)

During backend initialization, the system validates the configured `AUTH_PROVIDER` through `validateConfig()` in `config.ts` and `AuthenticationProviderFactory.initialize()`:

1. **Unknown Provider Protection:**
   If `AUTH_PROVIDER` is set to any value other than `LOCAL` or `ENTRA` (e.g. `GOOGLE`, `OAUTH`, `SAML`), backend initialization halts immediately with an error:
   ```
   [Config Error] Invalid AUTH_PROVIDER "<value>". Supported providers are LOCAL and ENTRA.
   ```
2. **Entra Mode Isolation:**
   When `AUTH_PROVIDER=ENTRA`, the backend validates that `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, and `ENTRA_REDIRECT_URI` are non-empty. If any required setting is missing, the application fails closed.
3. **Local Mode Isolation:**
   When `AUTH_PROVIDER=LOCAL`, Entra environment variables are **not** required or validated. The backend operates purely on database/local configuration.

---

## 4. Public Non-Secret Metadata API (`GET /api/auth/config`)

To enable the frontend React application to render the appropriate authentication UI without exposing any backend secrets, the public endpoint `GET /api/auth/config` is exposed:

### Sample Response (`AUTH_PROVIDER=LOCAL`):
```json
{
  "success": true,
  "provider": "LOCAL",
  "providerName": "Local VEYRA Authentication",
  "description": "Local password-based authentication with bcrypt hashing and rate limiting",
  "isExternal": false,
  "supportedAuthMethods": ["PASSWORD"],
  "entraEnabled": false
}
```

### Sample Response (`AUTH_PROVIDER=ENTRA`):
```json
{
  "success": true,
  "provider": "ENTRA",
  "providerName": "Microsoft Entra ID",
  "description": "Enterprise identity federation via Microsoft Entra ID (OIDC / OAuth2)",
  "isExternal": true,
  "supportedAuthMethods": ["BEARER_TOKEN", "AUTHORIZATION_CODE", "FEDERATED_SSO"],
  "entraEnabled": true,
  "entra": {
    "tenantId": "8f8b89e2-....",
    "clientId": "3c4d5e6f-....",
    "redirectUri": "https://app.veyra.com/"
  }
}
```

> [!IMPORTANT]
> The public configuration endpoint **never** exposes sensitive secrets such as `ENTRA_CLIENT_SECRET`, `JWT_SECRET`, `SESSION_SECRET`, or `ORACLE_ENCRYPTION_KEY`.

---

## 5. Security Guardrails

### 5.1 Client-Side Provider Override Rejection (AC2)
Clients cannot bypass server policy by passing a `provider` property in request bodies (e.g., `{ "provider": "LOCAL" }` when the server is in `ENTRA` mode).
The endpoint `POST /api/auth/login` checks incoming payloads and rejects mismatched provider overrides with `HTTP 400 Bad Request` and `PROVIDER_OVERRIDE_REJECTED`, logging a `SECURITY_WARNING` audit event.

### 5.2 Break-Glass Emergency Local Admin Access
In `ENTRA` mode, enterprise users authenticate exclusively via Microsoft Entra SSO. However, in accordance with the user experience disclaimer:
> *"Single Sign-On is managed by Microsoft Entra ID. Site Admin (admin@admin.com) can sign in using local credentials above."*

The backend allows `admin@admin.com` to authenticate using local credentials in `ENTRA` mode as a break-glass mechanism in the event of an identity provider outage. Non-admin users attempting password logins in `ENTRA` mode are rejected.

---

## 6. Environment Configuration Reference

```bash
# ==============================================================================
# VEYRA AUTHENTICATION PROVIDER CONFIGURATION
# ==============================================================================

# Choice of provider: LOCAL | ENTRA
AUTH_PROVIDER=LOCAL

# Required ONLY when AUTH_PROVIDER=ENTRA:
ENTRA_TENANT_ID=
ENTRA_CLIENT_ID=
ENTRA_CLIENT_SECRET=
ENTRA_REDIRECT_URI=http://localhost:5173/
ENTRA_DEFAULT_ROLE=AUDIT_USER
ENTRA_JIT_PROVISIONING=false
```

