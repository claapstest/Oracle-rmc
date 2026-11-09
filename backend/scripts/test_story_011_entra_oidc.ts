// VYR-011: Entra OIDC Authorization Code + PKCE security checks.
// Runs offline: token verification uses a locally generated RSA key.
import assert from 'node:assert/strict';
import {
  createPkcePair,
  buildAuthorizationUrl,
  createAuthorizationRequest,
  consumeState,
  extractIdentityEmail,
  validateEntraClaims,
  verifyEntraIdToken,
  completeAuthorization,
  EntraOidcError,
} from '../src/services/entraOidcService.js';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';

const cfg = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  clientId: 'client-123',
  redirectUri: 'http://localhost:5173/',
  clientSecret: '',
};
const issuer = `https://login.microsoftonline.com/${cfg.tenantId}/v2.0`;

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256' };
const jwks = createLocalJWKSet({ keys: [jwk] });

async function makeToken(overrides = {}, options = {}) {
  return new SignJWT({
    tid: cfg.tenantId,
    nonce: 'nonce-1',
    preferred_username: 'user@example.com',
    sub: 'subject-1',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? cfg.clientId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(options.key ?? privateKey);
}

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

await test('PKCE S256 challenge matches RFC 7636 vector', () => {
  const pair = createPkcePair('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  assert.equal(pair.codeChallenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

await test('authorization URL carries PKCE/state/nonce and no client secret', () => {
  const url = new URL(buildAuthorizationUrl(cfg, {
    state: 'state-1',
    nonce: 'nonce-1',
    codeChallenge: 'challenge-1',
  }));
  assert.equal(url.host, 'login.microsoftonline.com');
  assert.equal(url.pathname, `/${cfg.tenantId}/oauth2/v2.0/authorize`);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-1');
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.equal(url.searchParams.get('nonce'), 'nonce-1');
  assert.equal(url.searchParams.get('client_id'), cfg.clientId);
  assert.equal(url.searchParams.get('redirect_uri'), cfg.redirectUri);
  assert(url.searchParams.get('scope')?.includes('openid'));
  assert.equal(url.searchParams.get('client_secret'), null);
});

await test('state is single-use', () => {
  const request = createAuthorizationRequest(cfg);
  assert.equal(consumeState(request.state)?.nonce.length > 0, true);
  assert.equal(consumeState(request.state), null);
});

await test('state expires after its TTL', () => {
  const request = createAuthorizationRequest(cfg);
  assert.equal(consumeState(request.state, Date.now() + 11 * 60 * 1000), null);
});

await test('valid ID token is accepted', async () => {
  const token = await makeToken();
  const payload = await verifyEntraIdToken(token, { config: cfg, jwks, nonce: 'nonce-1' });
  assert.equal(payload.sub, 'subject-1');
});

await test('token with wrong nonce is rejected', async () => {
  const token = await makeToken({ nonce: 'attacker-nonce' });
  await assert.rejects(
    verifyEntraIdToken(token, { config: cfg, jwks, nonce: 'nonce-1' }),
    (err) => err instanceof EntraOidcError && err.code === 'INVALID_TOKEN'
  );
});

await test('token from a different tenant is rejected', async () => {
  const token = await makeToken({ tid: '22222222-2222-2222-2222-222222222222' });
  await assert.rejects(
    verifyEntraIdToken(token, { config: cfg, jwks, nonce: 'nonce-1' }),
    (err) => err instanceof EntraOidcError && err.code === 'INVALID_TOKEN'
  );
});

await test('token for a different audience is rejected', async () => {
  const token = await makeToken({}, { audience: 'some-other-api' });
  await assert.rejects(
    verifyEntraIdToken(token, { config: cfg, jwks, nonce: 'nonce-1' }),
    (err) => err instanceof EntraOidcError && err.code === 'INVALID_TOKEN'
  );
});

await test('token from a different issuer is rejected', async () => {
  const token = await makeToken({}, { issuer: 'https://evil.example.com/v2.0' });
  await assert.rejects(
    verifyEntraIdToken(token, { config: cfg, jwks, nonce: 'nonce-1' }),
    (err) => err instanceof EntraOidcError && err.code === 'INVALID_TOKEN'
  );
});

await test('token signed by an untrusted key is rejected', async () => {
  const attacker = await generateKeyPair('RS256');
  const token = await makeToken({}, { key: attacker.privateKey });
  await assert.rejects(
    verifyEntraIdToken(token, { config: cfg, jwks, nonce: 'nonce-1' }),
    (err) => err instanceof EntraOidcError && err.code === 'INVALID_TOKEN'
  );
});

await test('token without an email claim is rejected', async () => {
  const token = await makeToken({ preferred_username: undefined, email: undefined, upn: undefined });
  await assert.rejects(
    verifyEntraIdToken(token, { config: cfg, jwks, nonce: 'nonce-1' }),
    (err) => err instanceof EntraOidcError && err.code === 'INVALID_TOKEN'
  );
});

await test('identity email prefers preferred_username and normalizes case', () => {
  assert.equal(
    extractIdentityEmail({ preferred_username: 'User@Example.COM', email: 'other@example.com' }),
    'user@example.com'
  );
});

await test('callback exchanges the code with PKCE and returns the identity', async () => {
  const request = createAuthorizationRequest(cfg);
  const nonce = new URL(request.authorizationUrl).searchParams.get('nonce');
  const idToken = await makeToken({ nonce });
  let requestBody = '';
  const fetchImpl = async (url, init) => {
    requestBody = String(init.body);
    return new Response(JSON.stringify({ id_token: idToken }), { status: 200 });
  };
  const identity = await completeAuthorization('auth-code-1', request.state, {
    config: cfg,
    jwks,
    fetchImpl,
  });
  assert.equal(identity.email, 'user@example.com');
  assert.equal(identity.tenantId, cfg.tenantId);
  assert(requestBody.includes('grant_type=authorization_code'));
  assert(requestBody.includes('code=auth-code-1'));
  assert(requestBody.includes('code_verifier='));
  assert(!requestBody.includes('client_secret'));
});

await test('callback rejects an unknown state before calling the token endpoint', async () => {
  let called = false;
  await assert.rejects(
    completeAuthorization('auth-code-1', 'unknown-state', {
      config: cfg,
      jwks,
      fetchImpl: async () => { called = true; return new Response('{}'); },
    }),
    (err) => err instanceof EntraOidcError && err.code === 'INVALID_STATE'
  );
  assert.equal(called, false);
});

await test('callback rejects a failed token exchange', async () => {
  const request = createAuthorizationRequest(cfg);
  await assert.rejects(
    completeAuthorization('auth-code-1', request.state, {
      config: cfg,
      jwks,
      fetchImpl: async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    }),
    (err) => err instanceof EntraOidcError && err.code === 'TOKEN_EXCHANGE_FAILED'
  );
});

console.log(`\nVYR-011 checks passed: ${passed} tests.`);
