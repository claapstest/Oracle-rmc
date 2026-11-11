/**
 * Automated Verification Suite: Story VYR-019
 * Epic 3: JWT/JWS issuance, verification and session integration
 * Story Title: Define Veyra JWT claims, token lifetime and signing policy
 *
 * Acceptance Criteria Verified:
 *  1. The token contract is versioned and documented.
 *  2. Required claims and validation rules are agreed.
 *  3. The token contains no secrets or raw business data (no PII claims).
 *  4. The specification document and the code constants cannot drift apart.
 *
 * Run: npm --prefix backend run test:vyr19
 * Note: the npm script is test:vyr19 because test:story19 already belongs to the
 * unrelated internal reports story (test_story_019_reports_db.cjs).
 */

const path = require('path');
const fs = require('fs');

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

const EXPECTED_CLAIMS = ['iss', 'sub', 'aud', 'iat', 'nbf', 'exp', 'jti', 'sid'];
const EXPECTED_FORBIDDEN = [
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
];

function main() {
  console.log('================================================================');
  console.log('  VYR-019: Veyra JWT Access Token Contract');
  console.log('================================================================\n');

  const contract = requireDist('auth/jwtContract.js');
  const docPath = path.resolve(__dirname, '../../docs/architecture/jwt_token_contract.md');

  // -----------------------------------------------------------------------
  // Section 1: Contract constants
  // -----------------------------------------------------------------------
  console.log('--- Section 1: Contract constants ---');

  report(contract.VEYRA_JWT_CONTRACT_VERSION === 'v1', 'Contract version is v1', contract.VEYRA_JWT_CONTRACT_VERSION);
  report(contract.VEYRA_JWT_ALGORITHM === 'RS256', 'Signing algorithm is RS256', contract.VEYRA_JWT_ALGORITHM);
  report(contract.VEYRA_JWT_TYPE === 'at+jwt', 'Token type header is at+jwt', contract.VEYRA_JWT_TYPE);
  report(
    contract.VEYRA_JWT_LIFETIME_SECONDS === 900,
    'Access token lifetime is 900 seconds (15 minutes)',
    contract.VEYRA_JWT_LIFETIME_SECONDS
  );
  report(
    contract.VEYRA_JWT_LIFETIME_SECONDS > 0 && contract.VEYRA_JWT_LIFETIME_SECONDS <= 15 * 60,
    'Lifetime is bounded by the 15-minute session inactivity window'
  );
  report(
    typeof contract.VEYRA_JWT_ISSUER === 'string' && contract.VEYRA_JWT_ISSUER.length > 0,
    'Issuer default is defined'
  );
  report(
    typeof contract.VEYRA_JWT_AUDIENCE === 'string' && contract.VEYRA_JWT_AUDIENCE.length > 0,
    'Audience default is defined'
  );

  // -----------------------------------------------------------------------
  // Section 2: Required claims
  // -----------------------------------------------------------------------
  console.log('\n--- Section 2: Required claims ---');

  const required = Array.from(contract.VEYRA_JWT_REQUIRED_CLAIMS || []);
  report(
    required.length === EXPECTED_CLAIMS.length && EXPECTED_CLAIMS.every((c) => required.includes(c)),
    'Required claim set is exactly iss, sub, aud, iat, nbf, exp, jti, sid',
    required
  );
  report(
    new Set(required).size === required.length,
    'Required claim list contains no duplicates'
  );
  report(
    ['iss', 'sub', 'aud', 'iat', 'nbf', 'exp', 'jti', 'sid'].every((c) => typeof c === 'string' && c.trim() !== ''),
    'Every required claim name is a non-empty string'
  );

  // -----------------------------------------------------------------------
  // Section 3: No PII or secret claims
  // -----------------------------------------------------------------------
  console.log('\n--- Section 3: No PII or secret claims ---');

  const forbidden = Array.from(contract.VEYRA_JWT_FORBIDDEN_CLAIMS || []);
  report(
    EXPECTED_FORBIDDEN.every((c) => forbidden.includes(c)),
    'Forbidden claim list covers PII, roles, permissions and credentials',
    forbidden
  );
  report(
    required.every((c) => !forbidden.includes(c)),
    'No forbidden claim appears in the required claim set'
  );
  report(
    !required.some((c) => ['email', 'roles', 'permissions', 'password'].includes(c)),
    'Required claims contain no email, role, permission or password fields'
  );

  // -----------------------------------------------------------------------
  // Section 4: Specification document exists and matches the code
  // -----------------------------------------------------------------------
  console.log('\n--- Section 4: Specification document matches the code ---');

  const docExists = fs.existsSync(docPath);
  report(docExists, 'docs/architecture/jwt_token_contract.md exists', docPath);

  if (!docExists) {
    console.error('\n  Cannot continue: specification document is missing.');
  } else {
    const doc = fs.readFileSync(docPath, 'utf8');

    report(doc.includes(contract.VEYRA_JWT_CONTRACT_VERSION), 'Document states the contract version v1');
    report(doc.includes(contract.VEYRA_JWT_ALGORITHM), 'Document states the signing algorithm RS256');
    report(doc.includes(contract.VEYRA_JWT_TYPE), 'Document states the token type at+jwt');
    report(
      doc.includes(String(contract.VEYRA_JWT_LIFETIME_SECONDS)) && /15 minutes/i.test(doc),
      'Document states the 900 second / 15 minute lifetime'
    );

    const missingClaims = required.filter((c) => !doc.includes(`\`${c}\``));
    report(
      missingClaims.length === 0,
      'Document names every required claim in its claim table',
      missingClaims
    );

    report(doc.includes('kid'), 'Document specifies the required kid header for key rotation');
    report(
      /jwks/i.test(doc),
      'Document specifies the public JWKS publication and key rotation policy'
    );
    report(
      /INVALID_TOKEN/.test(doc),
      'Document defines the fail-closed rejection code INVALID_TOKEN'
    );
    report(
      /veyra_session/.test(doc),
      'Document binds the sid claim to veyra_session'
    );
    report(
      /RS256 only|RS256` only/i.test(doc),
      'Document pins the accepted algorithm and rejects none/HS256'
    );
    report(
      !/BEGIN [A-Z ]*PRIVATE KEY/.test(doc),
      'Document contains no private key material'
    );
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`  Passed: ${passed}  Failed: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error('[Fatal Test Error]:', err && err.message ? err.message : err);
  process.exit(1);
}
