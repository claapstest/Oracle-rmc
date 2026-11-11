/**
 * Automated Verification Suite: Story VYR-022
 * Epic 3: JWT/JWS issuance, verification and session integration
 * Story Title: Implement signing key ID, JWKS and key rotation
 *
 * Acceptance Criteria Verified:
 *  1. Verifier accepts the current and approved retiring public keys only.
 *  2. The rotation procedure is exercised end to end (activate, overlap, retire).
 *  3. Private signing material is never exposed through JWKS.
 *  4. Emergency revocation removes a signing key immediately and fail-closed.
 *
 * Run: npm --prefix backend run test:vyr22
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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

const ENV_KEYS = [
  'JWT_KEY_ID',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'JWT_PRIVATE_KEY_PATH',
  'JWT_PUBLIC_KEY_PATH',
  'JWT_PREVIOUS_PUBLIC_KEY',
  'JWT_PREVIOUS_PUBLIC_KEY_PATH',
  'JWT_PREVIOUS_KEY_ID',
  'JWT_REVOKED_KEY_IDS',
];

function snapshotEnv() {
  const saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function clearKeyEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function makeKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'];

function exposesPrivateMaterial(jwk) {
  return PRIVATE_JWK_FIELDS.some((field) => jwk[field] !== undefined);
}

async function main() {
  console.log('================================================================');
  console.log('  VYR-022: Signing Key ID, JWKS and Key Rotation');
  console.log('================================================================\n');

  const jose = await import('jose');
  const { keyManager } = requireDist('auth/keyManager.js');
  const { tokenService } = requireDist('auth/tokenService.js');
  const { VEYRA_JWT_ALGORITHM, VEYRA_JWT_TYPE, VEYRA_JWT_ISSUER, VEYRA_JWT_AUDIENCE } =
    requireDist('auth/jwtContract.js');

  const saved = snapshotEnv();
  clearKeyEnv();

  const kids = (jwks) => jwks.keys.map((k) => k.kid).sort();

  try {
    // ---------------------------------------------------------------------
    // Section 1: Baseline key, kid header and clean JWKS
    // ---------------------------------------------------------------------
    console.log('--- Section 1: Baseline key and JWKS ---');

    const k1 = makeKeyPair();
    process.env.JWT_KEY_ID = 'veyra-key-1';
    process.env.JWT_PRIVATE_KEY = k1.privateKey;
    process.env.JWT_PUBLIC_KEY = k1.publicKey;
    keyManager.reset();

    const jwks1 = await keyManager.getJwks();
    report(
      jwks1.keys.length === 1 && jwks1.keys[0].kid === 'veyra-key-1',
      'JWKS publishes exactly the active signing key',
      kids(jwks1)
    );
    report(
      jwks1.keys[0].kty === 'RSA' &&
        jwks1.keys[0].alg === VEYRA_JWT_ALGORITHM &&
        jwks1.keys[0].use === 'sig',
      'Published JWK declares kty=RSA, alg=RS256 and use=sig'
    );
    report(
      !exposesPrivateMaterial(jwks1.keys[0]),
      'Published JWK contains no private RSA components'
    );

    const t1 = await tokenService.issueAccessToken({ userId: 'user-vyr022', sessionId: 'sid-vyr022' });
    const h1 = jose.decodeProtectedHeader(t1);
    report(
      h1.kid === 'veyra-key-1' && h1.alg === VEYRA_JWT_ALGORITHM && h1.typ === VEYRA_JWT_TYPE,
      'Issued token header carries kid, alg and typ',
      h1
    );
    report(
      (await tokenService.verifyAccessToken(t1)).valid === true,
      'Token signed by the active key verifies'
    );

    // ---------------------------------------------------------------------
    // Section 2: Rotation with overlap (activate new key, keep old one)
    // ---------------------------------------------------------------------
    console.log('\n--- Section 2: Rotation with overlap ---');

    const k2 = makeKeyPair();
    process.env.JWT_KEY_ID = 'veyra-key-2';
    process.env.JWT_PRIVATE_KEY = k2.privateKey;
    process.env.JWT_PUBLIC_KEY = k2.publicKey;
    process.env.JWT_PREVIOUS_PUBLIC_KEY = k1.publicKey;
    process.env.JWT_PREVIOUS_KEY_ID = 'veyra-key-1';
    keyManager.reset();

    const jwks2 = await keyManager.getJwks();
    report(
      kids(jwks2).join(',') === 'veyra-key-1,veyra-key-2',
      'JWKS publishes both the active and the retiring key during overlap',
      kids(jwks2)
    );
    report(
      jwks2.keys.every((k) => !exposesPrivateMaterial(k)),
      'Retiring key is published without private components'
    );
    report(
      (await tokenService.verifyAccessToken(t1)).valid === true,
      'Token signed by the retiring key still verifies during overlap'
    );

    const t2 = await tokenService.issueAccessToken({ userId: 'user-vyr022', sessionId: 'sid-vyr022' });
    report(
      jose.decodeProtectedHeader(t2).kid === 'veyra-key-2',
      'New tokens are signed with the new active kid'
    );
    report(
      (await tokenService.verifyAccessToken(t2)).valid === true,
      'Token signed by the new active key verifies'
    );

    // ---------------------------------------------------------------------
    // Section 3: Retirement and emergency revocation
    // ---------------------------------------------------------------------
    console.log('\n--- Section 3: Retirement and emergency revocation ---');

    // After the grace window the operator drops JWT_PREVIOUS_PUBLIC_KEY.
    delete process.env.JWT_PREVIOUS_PUBLIC_KEY;
    delete process.env.JWT_PREVIOUS_KEY_ID;
    keyManager.reset();
    const jwksRetired = await keyManager.getJwks();
    report(
      kids(jwksRetired).join(',') === 'veyra-key-2',
      'Retired key is dropped from JWKS once the overlap window ends',
      kids(jwksRetired)
    );
    report(
      (await tokenService.verifyAccessToken(t1)).valid === false,
      'Token signed by the retired key is rejected after overlap ends'
    );

    // Emergency revocation must work even while the key is still configured.
    process.env.JWT_PREVIOUS_PUBLIC_KEY = k1.publicKey;
    process.env.JWT_PREVIOUS_KEY_ID = 'veyra-key-1';
    process.env.JWT_REVOKED_KEY_IDS = ' veyra-key-1 , ';
    keyManager.reset();
    const jwksRevoked = await keyManager.getJwks();
    report(
      kids(jwksRevoked).join(',') === 'veyra-key-2',
      'Emergency revocation removes a configured retiring key from JWKS immediately',
      kids(jwksRevoked)
    );

    const revokedResult = await tokenService.verifyAccessToken(t1);
    report(
      revokedResult.valid === false && revokedResult.code === 'INVALID_TOKEN',
      'Token signed by a revoked key fails closed with INVALID_TOKEN',
      revokedResult
    );
    report(
      (await tokenService.verifyAccessToken(t2)).valid === true,
      'Revoking a retiring key does not disturb the active key'
    );

    process.env.JWT_REVOKED_KEY_IDS = 'veyra-key-2';
    keyManager.reset();
    const jwksActiveRevoked = await keyManager.getJwks();
    report(
      !kids(jwksActiveRevoked).includes('veyra-key-2'),
      'Revoking the active key removes it from JWKS (fail closed)',
      kids(jwksActiveRevoked)
    );
    report(
      (await tokenService.verifyAccessToken(t2)).valid === false,
      'Tokens are rejected when the active key is revoked'
    );

    // Restore a healthy state for the remaining sections.
    delete process.env.JWT_REVOKED_KEY_IDS;
    delete process.env.JWT_PREVIOUS_PUBLIC_KEY;
    delete process.env.JWT_PREVIOUS_KEY_ID;
    keyManager.reset();
    const jwksHealthy = await keyManager.getJwks();
    report(
      kids(jwksHealthy).join(',') === 'veyra-key-2',
      'JWKS returns to the active key once revocation is lifted'
    );

    // ---------------------------------------------------------------------
    // Section 4: Key substitution and algorithm confusion
    // ---------------------------------------------------------------------
    console.log('\n--- Section 4: Key substitution and algorithm confusion ---');

    const k3 = makeKeyPair();
    const k3Private = await jose.importPKCS8(k3.privateKey, VEYRA_JWT_ALGORITHM);

    const forged = await new jose.SignJWT({
      iss: VEYRA_JWT_ISSUER,
      sub: 'user-vyr022',
      aud: VEYRA_JWT_AUDIENCE,
      jti: crypto.randomUUID(),
      sid: 'sid-vyr022',
    })
      .setProtectedHeader({ alg: VEYRA_JWT_ALGORITHM, typ: VEYRA_JWT_TYPE, kid: 'veyra-key-2' })
      .setIssuedAt()
      .setNotBefore(Math.floor(Date.now() / 1000))
      .setExpirationTime('5m')
      .sign(k3Private);
    report(
      (await tokenService.verifyAccessToken(forged)).valid === false,
      'A token signed by an untrusted key but claiming the active kid is rejected'
    );

    const unknownKid = await new jose.SignJWT({
      iss: VEYRA_JWT_ISSUER,
      sub: 'user-vyr022',
      aud: VEYRA_JWT_AUDIENCE,
      jti: crypto.randomUUID(),
      sid: 'sid-vyr022',
    })
      .setProtectedHeader({ alg: VEYRA_JWT_ALGORITHM, typ: VEYRA_JWT_TYPE, kid: 'not-published' })
      .setIssuedAt()
      .setNotBefore(Math.floor(Date.now() / 1000))
      .setExpirationTime('5m')
      .sign(k3Private);
    report(
      (await tokenService.verifyAccessToken(unknownKid)).valid === false,
      'A token referencing an unpublished kid is rejected'
    );

    const hsToken = await new jose.SignJWT({ sub: 'user-vyr022', sid: 'sid-vyr022' })
      .setProtectedHeader({ alg: 'HS256', typ: VEYRA_JWT_TYPE, kid: 'veyra-key-2' })
      .setIssuer(VEYRA_JWT_ISSUER)
      .setAudience(VEYRA_JWT_AUDIENCE)
      .setIssuedAt()
      .setNotBefore(Math.floor(Date.now() / 1000))
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('shared-secret-value'));
    report(
      (await tokenService.verifyAccessToken(hsToken)).valid === false,
      'HS256 algorithm confusion is rejected'
    );

    // ---------------------------------------------------------------------
    // Section 5: Private material never leaves the process
    // ---------------------------------------------------------------------
    console.log('\n--- Section 5: Private material exposure ---');

    const serialized = JSON.stringify(await keyManager.getJwks());
    report(
      !/BEGIN [A-Z ]*PRIVATE KEY/.test(serialized),
      'JWKS response contains no PEM private key'
    );
    report(
      PRIVATE_JWK_FIELDS.every((field) => !serialized.includes(`"${field}"`)),
      'JWKS response contains no private JWK members (d, p, q, dp, dq, qi, oth)'
    );
    report(
      !serialized.includes(k2.privateKey.split('\n')[1].slice(0, 32)),
      'JWKS response contains no fragment of the configured private key'
    );

    // ---------------------------------------------------------------------
    // Section 6: Rotation runbook is documented
    // ---------------------------------------------------------------------
    console.log('\n--- Section 6: Rotation runbook documentation ---');

    const docPath = path.resolve(__dirname, '../../docs/architecture/jwt_key_rotation.md');
    const docExists = fs.existsSync(docPath);
    report(docExists, 'docs/architecture/jwt_key_rotation.md exists', docPath);

    if (docExists) {
      const doc = fs.readFileSync(docPath, 'utf8');
      report(doc.includes('JWT_KEY_ID'), 'Runbook documents key generation and activation variables');
      report(
        doc.includes('JWT_PREVIOUS_PUBLIC_KEY') && doc.includes('JWT_PREVIOUS_KEY_ID'),
        'Runbook documents the overlap window for the retiring key'
      );
      report(
        doc.includes('JWT_REVOKED_KEY_IDS'),
        'Runbook documents emergency revocation'
      );
      report(
        /900|15 minutes/i.test(doc),
        'Runbook states the overlap window equals the token lifetime'
      );
      report(
        /private key/i.test(doc) && /never/i.test(doc),
        'Runbook states private key material is never published'
      );
    }
  } finally {
    restoreEnv(saved);
    keyManager.reset();
  }

  console.log('\n================================================================');
  console.log(`  Passed: ${passed}  Failed: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('[Fatal Test Error]:', err && err.stack ? err.stack : err);
  process.exit(1);
});
