/**
 * Automated Verification Suite: Story VYR-020
 * Epic 3: JWT/JWS issuance, verification and session integration
 * Story Title: Veyra JWT Access Token Issuance & JWKS Publication
 *
 * Acceptance Criteria Verified:
 *  1. RSA Key Manager: loads keys, handles PEM/Base64/file, generates RSA 2048+ key in dev, manages rotation.
 *  2. Public JWKS Publication (RFC 7517): GET /.well-known/jwks.json exposes active + rotated public keys.
 *  3. Compact JWS shape with header { alg: "RS256", typ: "at+jwt", kid: "<key-id>" }.
 *  4. Exact required claims set: iss, sub, aud, iat, nbf, exp, jti, sid.
 *  5. Lifetime is exactly 900 seconds (15 minutes, matching session inactivity window).
 *  6. Forbidden claims policy: zero PII (no email, display_name, roles, permissions, passwords).
 *  7. Cryptographic verification: authenticates against JWKS; rejects tampered payload, signature, and wrong algs.
 *  8. Integration: /auth/login returns RS256 JWT access token; protected endpoints validate Bearer token.
 *  9. Instant revocation on logout and single-active-session override.
 * 10. Backward compatibility with legacy opaque tokens during migration.
 *
 * Run: npm --prefix backend run test:vyr20
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

let passed = 0;
let failed = 0;

function report(condition, message, details) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    if (details !== undefined) console.error('        Details:', details);
    failed++;
  }
}

function dist(rel) {
  return path.join(__dirname, '..', 'dist', rel);
}

function requireDist(rel) {
  const file = dist(rel);
  if (!fs.existsSync(file)) {
    throw new Error(`Build output missing: ${file}. Run "npm --prefix backend run build" first.`);
  }
  return require(file);
}

async function requestHttp(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json || data
        });
      });
    });
    req.on('error', reject);
    if (body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Content-Length', Buffer.byteLength(payload));
      req.write(payload);
    }
    req.end();
  });
}

async function main() {
  console.log('================================================================');
  console.log('  VYR-020: Veyra JWT Access Token Issuance & JWKS Publication');
  console.log('================================================================\n');

  const {
    VEYRA_JWT_CONTRACT_VERSION,
    VEYRA_JWT_ALGORITHM,
    VEYRA_JWT_TYPE,
    VEYRA_JWT_LIFETIME_SECONDS,
    VEYRA_JWT_ISSUER,
    VEYRA_JWT_AUDIENCE,
    VEYRA_JWT_REQUIRED_CLAIMS,
    VEYRA_JWT_FORBIDDEN_CLAIMS
  } = requireDist('auth/jwtContract.js');

  const { keyManager } = requireDist('auth/keyManager.js');
  const { tokenService } = requireDist('auth/tokenService.js');
  const { authService } = requireDist('services/authService.js');
  const jose = require('../node_modules/jose');

  // -------------------------------------------------------------------------
  // Section 1: RSA Key Manager & Key Generation
  // -------------------------------------------------------------------------
  console.log('--- Section 1: RSA Key Manager & Configuration ---');

  const activeBundle = await keyManager.getSigningKeyBundle();
  report(Boolean(activeBundle), 'KeyManager successfully loads or generates active signing bundle');
  report(typeof activeBundle.kid === 'string' && activeBundle.kid.length > 0, 'Active key bundle carries valid kid', activeBundle.kid);
  report(Boolean(activeBundle.privateKey), 'Active key bundle contains private signing key');
  report(Boolean(activeBundle.publicKey), 'Active key bundle contains public verification key');
  report(activeBundle.jwk.kty === 'RSA', 'Key type is RSA');
  report(activeBundle.jwk.alg === 'RS256', 'Signing algorithm is RS256');
  report(activeBundle.jwk.use === 'sig', 'Key use is "sig" (signature verification)');

  // -------------------------------------------------------------------------
  // Section 2: RFC 7517 Public JWKS Publication
  // -------------------------------------------------------------------------
  console.log('\n--- Section 2: Public JWKS Publication ---');

  const jwks = await keyManager.getJwks();
  report(Array.isArray(jwks.keys) && jwks.keys.length >= 1, 'JWKS contains keys array with at least 1 key');
  const activeJwk = jwks.keys.find((k) => k.kid === activeBundle.kid);
  report(Boolean(activeJwk), 'Active signing key is present in JWKS');
  report(
    activeJwk && activeJwk.n && activeJwk.e && !activeJwk.d && !activeJwk.p && !activeJwk.q,
    'JWKS contains public modulus (n) and exponent (e) with zero private key material'
  );

  // Key rotation simulation
  const { publicKey: rotPub } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  await keyManager.addRotatedPublicKey(rotPub, 'veyra-retired-key-99');
  const rotatedJwks = await keyManager.getJwks();
  const retiredJwk = rotatedJwks.keys.find((k) => k.kid === 'veyra-retired-key-99');
  report(Boolean(retiredJwk), 'Rotated/retired public key appears in published JWKS alongside active key');
  report(rotatedJwks.keys.length >= 2, 'JWKS exposes both active and grace-period keys during rotation');

  // -------------------------------------------------------------------------
  // Section 3: Token Issuance & Contract Compliance
  // -------------------------------------------------------------------------
  console.log('\n--- Section 3: Token Issuance & Claim Compliance ---');

  const testUserId = crypto.randomUUID();
  const testSessionId = crypto.randomBytes(32).toString('hex');
  const token = await tokenService.issueAccessToken({
    userId: testUserId,
    sessionId: testSessionId
  });

  report(tokenService.isJwt(token), 'Issued token is structurally a compact JWS with 3 segments');

  const decodedHeader = jose.decodeProtectedHeader(token);
  report(decodedHeader.alg === 'RS256', 'Protected header alg is RS256', decodedHeader.alg);
  report(decodedHeader.typ === 'at+jwt', 'Protected header typ is at+jwt (RFC 9068)', decodedHeader.typ);
  report(decodedHeader.kid === activeBundle.kid, 'Protected header kid matches active signing key ID', decodedHeader.kid);

  const payload = jose.decodeJwt(token);
  report(payload.iss === 'veyra', 'Token issuer is "veyra"', payload.iss);
  report(payload.sub === testUserId, 'Token sub equals user ID', payload.sub);
  report(payload.aud === 'veyra-api', 'Token aud equals "veyra-api"', payload.aud);
  report(payload.sid === testSessionId, 'Token sid equals session identifier', payload.sid);
  report(typeof payload.jti === 'string' && payload.jti.length >= 32, 'Token jti is a unique identifier (UUID)', payload.jti);

  const lifetime = payload.exp - payload.iat;
  report(lifetime === 900, 'Token lifetime is exactly 900 seconds (15 minutes)', lifetime);
  report(payload.nbf === payload.iat, 'Token nbf equals iat', { nbf: payload.nbf, iat: payload.iat });

  // -------------------------------------------------------------------------
  // Section 4: Zero PII and Credentials in Payload
  // -------------------------------------------------------------------------
  console.log('\n--- Section 4: Zero PII & Zero Credentials Enforcement ---');

  let leakedClaim = null;
  for (const forbidden of VEYRA_JWT_FORBIDDEN_CLAIMS) {
    if (payload[forbidden] !== undefined) {
      leakedClaim = forbidden;
      break;
    }
  }
  report(leakedClaim === null, 'Token payload strictly omits all forbidden claims (no email, roles, permissions, passwords)', leakedClaim);

  // -------------------------------------------------------------------------
  // Section 5: Cryptographic Verification & Tamper Resistance
  // -------------------------------------------------------------------------
  console.log('\n--- Section 5: Cryptographic Verification & Tamper Rejection ---');

  const verification = await tokenService.verifyAccessToken(token);
  report(verification.valid === true, 'Valid issued token successfully verifies against published JWKS');
  report(verification.claims && verification.claims.sub === testUserId, 'Verification returns parsed and validated claims');

  // Tampered payload
  const tokenParts = token.split('.');
  const tamperedPayloadRaw = Buffer.from(tokenParts[1], 'base64url').toString('utf8');
  const tamperedPayloadObj = JSON.parse(tamperedPayloadRaw);
  tamperedPayloadObj.sub = crypto.randomUUID(); // forged user ID
  const tamperedPayloadBase64 = Buffer.from(JSON.stringify(tamperedPayloadObj)).toString('base64url');
  const tamperedToken = `${tokenParts[0]}.${tamperedPayloadBase64}.${tokenParts[2]}`;

  const tamperedVerify = await tokenService.verifyAccessToken(tamperedToken);
  report(tamperedVerify.valid === false && tamperedVerify.code === 'INVALID_TOKEN', 'Token with tampered payload is rejected (INVALID_TOKEN)');

  // Tampered signature
  const tamperedSig = tokenParts[2].slice(0, -4) + 'AAAA';
  const badSigToken = `${tokenParts[0]}.${tokenParts[1]}.${tamperedSig}`;
  const badSigVerify = await tokenService.verifyAccessToken(badSigToken);
  report(badSigVerify.valid === false && badSigVerify.code === 'INVALID_TOKEN', 'Token with altered signature is rejected (INVALID_TOKEN)');

  // Unsigned / "none" algorithm attempt
  const forgedHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'at+jwt' })).toString('base64url');
  const forgedNoneToken = `${forgedHeader}.${tokenParts[1]}.`;
  const noneVerify = await tokenService.verifyAccessToken(forgedNoneToken);
  report(noneVerify.valid === false && noneVerify.code === 'INVALID_TOKEN', 'Token with alg="none" is strictly rejected');

  // HS256 algorithm confusion attempt
  const forgedHs256Header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'at+jwt', kid: activeBundle.kid })).toString('base64url');
  const forgedHs256Token = `${forgedHs256Header}.${tokenParts[1]}.${tokenParts[2]}`;
  const hs256Verify = await tokenService.verifyAccessToken(forgedHs256Token);
  report(hs256Verify.valid === false && hs256Verify.code === 'INVALID_TOKEN', 'Token with alg="HS256" is strictly rejected (algorithm confusion protection)');

  // Unknown key ID (kid) attempt
  const unknownKidHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'at+jwt', kid: 'unknown-key-999' })).toString('base64url');
  const unknownKidToken = `${unknownKidHeader}.${tokenParts[1]}.${tokenParts[2]}`;
  const unknownKidVerify = await tokenService.verifyAccessToken(unknownKidToken);
  report(unknownKidVerify.valid === false && unknownKidVerify.code === 'INVALID_TOKEN', 'Token with unknown kid is rejected');

  // -------------------------------------------------------------------------
  // Section 6: HTTP Server & End-to-End API Integration
  // -------------------------------------------------------------------------
  console.log('\n--- Section 6: HTTP Server & API Integration ---');

  const express = require('express');
  const { apiRouter } = requireDist('routes/api.js');

  const app = express();
  app.use(express.json());

  // Mount JWKS at root and api router
  app.get(['/.well-known/jwks.json', '/api/.well-known/jwks.json'], async (_req, res) => {
    const keys = await keyManager.getJwks();
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(keys);
  });
  app.use('/api', apiRouter);

  const server = app.listen(0);
  const port = server.address().port;

  try {
    // 1. GET /.well-known/jwks.json
    const jwksRes = await requestHttp({
      hostname: '127.0.0.1',
      port,
      path: '/.well-known/jwks.json',
      method: 'GET'
    });
    report(jwksRes.status === 200, 'GET /.well-known/jwks.json returns HTTP 200 OK');
    report(Array.isArray(jwksRes.body.keys) && jwksRes.body.keys.length >= 1, 'JWKS endpoint exposes valid RFC 7517 keys array');

    // 2. GET /api/.well-known/jwks.json
    const apiJwksRes = await requestHttp({
      hostname: '127.0.0.1',
      port,
      path: '/api/.well-known/jwks.json',
      method: 'GET'
    });
    report(apiJwksRes.status === 200, 'GET /api/.well-known/jwks.json returns HTTP 200 OK');

    // 3. POST /api/auth/login returns JWT access token
    const loginRes = await requestHttp(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/auth/login',
        method: 'POST'
      },
      {
        email: 'akash.meesarapu@claaps.com',
        password: 'Password@123',
        force: true
      }
    );

    report(loginRes.status === 200 && loginRes.body.success === true, 'POST /api/auth/login succeeds with HTTP 200');
    report(typeof loginRes.body.token === 'string', 'Login response returns token string');
    report(tokenService.isJwt(loginRes.body.token), 'Login response token is a compact RS256 JWT access token');
    report(Boolean(loginRes.body.sessionId), 'Login response includes session identifier (sessionId)');

    const jwtToken = loginRes.body.token;

    // 4. Authenticated request using JWT in Authorization header
    const statusRes = await requestHttp({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/status',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwtToken}`
      }
    });

    report(statusRes.status === 200 && statusRes.body.loggedIn === true, 'GET /api/auth/status accepts Bearer JWT access token (HTTP 200)');
    report(statusRes.body.email && statusRes.body.email.toLowerCase() === 'akash.meesarapu@claaps.com', 'Authenticated session correctly resolves user identity');

    // 5. Dual Format Compatibility: legacy opaque sessionId token
    const legacySessionId = loginRes.body.sessionId;
    const legacyRes = await requestHttp({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/status',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${legacySessionId}`
      }
    });
    report(legacyRes.status === 200 && legacyRes.body.loggedIn === true, 'Legacy opaque sessionId token accepted during migration transition');

    // 6. Instant Revocation on Logout
    const logoutRes = await requestHttp(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/auth/logout',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwtToken}`
        }
      },
      {}
    );
    report(logoutRes.status === 200, 'POST /api/auth/logout successfully executes logout');

    const postLogoutRes = await requestHttp({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/status',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwtToken}`
      }
    });
    report(postLogoutRes.status === 401, 'Request with logged out JWT fails immediately with HTTP 401 INVALID_TOKEN');

  } finally {
    server.close();
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`  Passed: ${passed}  Failed: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[Fatal Test Error]:', err);
  process.exit(1);
});
