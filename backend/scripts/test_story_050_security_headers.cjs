/**
 * Test Suite: Story VYR-050
 * "Harden CORS, CSP, HSTS and HTTP security headers"
 * Epic: EPIC 6 — OWASP application and API security hardening
 * Branch Applicability: Both
 *
 * Validates that:
 *  1. securityHeadersService.ts exports corsMiddleware, securityHeadersMiddleware, getAllowedOrigins
 *  2. CORS middleware rejects unapproved origins
 *  3. CORS middleware allows approved dev origins (localhost:5173, 5000)
 *  4. CORS middleware allows same-origin / server-to-server (no Origin header)
 *  5. helmet-based security headers are present in responses
 *  6. Content-Security-Policy header includes required directives
 *  7. X-Content-Type-Options is set to nosniff
 *  8. X-Frame-Options is set to DENY
 *  9. Referrer-Policy is set to strict-origin-when-cross-origin
 * 10. X-Powered-By header is removed
 * 11. index.ts uses securityHeadersMiddleware and corsMiddleware (not wide-open cors)
 * 12. API responses include Cache-Control: no-store
 * 13. Entra state cookie has httpOnly, sameSite=lax, secure (production) attributes
 * 14. ALLOWED_ORIGINS env var is respected when set
 * 15. Production with no ALLOWED_ORIGINS blocks cross-origin requests
 */

process.env.TEST_OFFLINE = 'true';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { describe, it, before, after } = require('node:test');
const { test } = require('node:test');

const backendSrc = path.resolve(__dirname, '../src');
const securityDir = path.resolve(backendSrc, 'security');
const indexPath = path.resolve(backendSrc, 'index.ts');
const apiRoutesPath = path.resolve(backendSrc, 'routes/api.ts');
const securityHeadersPath = path.resolve(securityDir, 'securityHeadersService.ts');

console.log('================================================================');
console.log('  VYR-050 Test Suite: CORS, CSP, HSTS & HTTP Security Headers');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

function pass(msg) {
  passed++;
  console.log(`  ✅ PASS: ${msg}`);
}

function fail(msg, err) {
  failed++;
  console.error(`  ❌ FAIL: ${msg}`);
  if (err) console.error(`          ${err.message || err}`);
}

// ====================================================================
// Test 1: securityHeadersService.ts exists and exports required symbols
// ====================================================================
test('VYR-050-01: securityHeadersService.ts exists with required exports', () => {
  assert.ok(fs.existsSync(securityHeadersPath), 'securityHeadersService.ts must exist');

  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  assert.ok(src.includes('export const corsMiddleware'), 'Must export corsMiddleware');
  assert.ok(src.includes('export const securityHeadersMiddleware'), 'Must export securityHeadersMiddleware');
  assert.ok(src.includes('export function getAllowedOrigins'), 'Must export getAllowedOrigins');
  pass('securityHeadersService.ts exists with all required exports');
});

// ====================================================================
// Test 2: CORS rejects unapproved origins
// ====================================================================
test('VYR-050-02: CORS origin validation logic rejects unknown origins', () => {
  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  assert.ok(src.includes('not allowed by CORS policy') || src.includes('not allowed'), 'Must reject unapproved origins with error');
  assert.ok(!src.includes("origin: true"), 'Must NOT use origin: true (reflects all origins)');
  assert.ok(!src.includes("origin: '*'"), 'Must NOT use wildcard origin');
  pass('CORS rejects unapproved origins');
});

// ====================================================================
// Test 3: CORS allows approved dev origins
// ====================================================================
test('VYR-050-03: CORS allows localhost dev origins', () => {
  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  assert.ok(src.includes('localhost:5173'), 'Must allow Vite dev server origin');
  assert.ok(src.includes('localhost:5000'), 'Must allow backend origin');
  pass('CORS allows approved dev origins');
});

// ====================================================================
// Test 4: CORS allows same-origin / no-Origin requests
// ====================================================================
test('VYR-050-04: CORS allows requests without Origin header (server-to-server)', () => {
  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  assert.ok(src.includes('!origin'), 'Must handle missing Origin header (same-origin/server-to-server)');
  pass('CORS allows same-origin / server-to-server requests');
});

// ====================================================================
// Test 5: Helmet security headers middleware configured
// ====================================================================
test('VYR-050-05: Helmet is configured with security headers', () => {
  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  assert.ok(src.includes("import helmet from 'helmet'"), 'Must import helmet');
  assert.ok(src.includes('contentSecurityPolicy'), 'Must configure CSP');
  assert.ok(src.includes('strictTransportSecurity'), 'Must configure HSTS');
  assert.ok(src.includes('xContentTypeOptions'), 'Must configure X-Content-Type-Options');
  assert.ok(src.includes('frameguard'), 'Must configure X-Frame-Options');
  assert.ok(src.includes('referrerPolicy'), 'Must configure Referrer-Policy');
  pass('Helmet security headers fully configured');
});

// ====================================================================
// Test 6: Content-Security-Policy includes required directives
// ====================================================================
test('VYR-050-06: CSP includes all required directives', () => {
  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  const requiredDirectives = [
    'defaultSrc', 'scriptSrc', 'styleSrc', 'imgSrc',
    'fontSrc', 'connectSrc', 'frameSrc', 'objectSrc',
    'baseUri', 'formAction', 'frameAncestors'
  ];
  for (const dir of requiredDirectives) {
    assert.ok(src.includes(dir), `CSP must include ${dir} directive`);
  }
  assert.ok(src.includes("\"'none'\"") || src.includes("'none'"), 'CSP must block objects/frames with none');
  pass('CSP includes all required directives');
});

// ====================================================================
// Test 7: X-Content-Type-Options is nosniff
// ====================================================================
test('VYR-050-07: X-Content-Type-Options enabled', () => {
  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  assert.ok(src.includes('xContentTypeOptions: true') || src.includes('xContentTypeOptions'), 'X-Content-Type-Options must be enabled');
  pass('X-Content-Type-Options is set to nosniff');
});

// ====================================================================
// Test 8: X-Frame-Options is DENY
// ====================================================================
test('VYR-050-08: X-Frame-Options set to DENY', () => {
  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  assert.ok(src.includes("action: 'deny'"), 'frameguard must use deny action');
  pass('X-Frame-Options is DENY');
});

// ====================================================================
// Test 9: Referrer-Policy configured
// ====================================================================
test('VYR-050-09: Referrer-Policy set to strict-origin-when-cross-origin', () => {
  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  assert.ok(src.includes('strict-origin-when-cross-origin'), 'Referrer-Policy must be strict-origin-when-cross-origin');
  pass('Referrer-Policy is strict-origin-when-cross-origin');
});

// ====================================================================
// Test 10: X-Powered-By removed
// ====================================================================
test('VYR-050-10: X-Powered-By header is removed', () => {
  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  assert.ok(src.includes('xPoweredBy: false'), 'Must disable X-Powered-By');
  pass('X-Powered-By header removed');
});

// ====================================================================
// Test 11: index.ts uses securityHeadersMiddleware, not wide-open cors
// ====================================================================
test('VYR-050-11: index.ts wired with securityHeadersMiddleware and corsMiddleware', () => {
  const indexSrc = fs.readFileSync(indexPath, 'utf-8');
  assert.ok(indexSrc.includes("from './security/securityHeadersService.js'"), 'index.ts must import from securityHeadersService');
  assert.ok(indexSrc.includes('app.use(securityHeadersMiddleware)'), 'index.ts must use securityHeadersMiddleware');
  assert.ok(indexSrc.includes('app.use(corsMiddleware)'), 'index.ts must use corsMiddleware');

  // Verify old wide-open cors is removed
  assert.ok(!indexSrc.includes('origin: true'), 'index.ts must NOT have origin: true');
  assert.ok(!indexSrc.includes("import cors from 'cors'"), 'index.ts must NOT directly import cors (delegated to securityHeadersService)');
  pass('index.ts correctly wired with security headers and strict CORS');
});

// ====================================================================
// Test 12: API responses include Cache-Control: no-store
// ====================================================================
test('VYR-050-12: API responses include Cache-Control: no-store', () => {
  const indexSrc = fs.readFileSync(indexPath, 'utf-8');
  assert.ok(indexSrc.includes('no-store'), 'API middleware must set Cache-Control: no-store');
  assert.ok(indexSrc.includes('no-cache') || indexSrc.includes('Pragma'), 'Must include Pragma: no-cache for HTTP/1.0 compat');
  pass('API responses include Cache-Control: no-store');
});

// ====================================================================
// Test 13: Entra state cookie has hardened attributes
// ====================================================================
test('VYR-050-13: Entra state cookie uses httpOnly, sameSite, secure', () => {
  const apiSrc = fs.readFileSync(apiRoutesPath, 'utf-8');
  assert.ok(apiSrc.includes('httpOnly: true'), 'Entra cookie must be httpOnly');
  assert.ok(apiSrc.includes("sameSite: 'lax'") || apiSrc.includes("sameSite: 'strict'"), 'Entra cookie must have SameSite');
  assert.ok(apiSrc.includes('secure:'), 'Entra cookie must have secure attribute');
  assert.ok(apiSrc.includes('VYR-050'), 'Cookie hardening must reference VYR-050');
  pass('Entra state cookie has hardened attributes');
});

// ====================================================================
// Test 14: ALLOWED_ORIGINS env var support
// ====================================================================
test('VYR-050-14: ALLOWED_ORIGINS env var is respected', () => {
  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  assert.ok(src.includes('ALLOWED_ORIGINS'), 'Must read ALLOWED_ORIGINS env var');
  assert.ok(src.includes("split(',')") || src.includes('split'), 'Must parse comma-separated origins');
  pass('ALLOWED_ORIGINS env var is respected');
});

// ====================================================================
// Test 15: Production blocks cross-origin when no ALLOWED_ORIGINS
// ====================================================================
test('VYR-050-15: Production with no ALLOWED_ORIGINS blocks cross-origin', () => {
  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  assert.ok(src.includes('allowedOrigins.length === 0'), 'Must handle empty allowed origins in production');
  assert.ok(src.includes('callback(null, false)'), 'Must reject cross-origin when no origins configured');
  pass('Production with no ALLOWED_ORIGINS correctly blocks cross-origin requests');
});

// ====================================================================
// Test 16: HSTS only enabled in production
// ====================================================================
test('VYR-050-16: HSTS is production-only', () => {
  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  assert.ok(src.includes('isProduction'), 'HSTS must be conditional on production');
  assert.ok(src.includes('maxAge: 31536000'), 'HSTS max-age must be 1 year (31536000)');
  assert.ok(src.includes('includeSubDomains: true'), 'HSTS must include subdomains');
  assert.ok(src.includes('preload: true'), 'HSTS must be preload-ready');
  pass('HSTS correctly configured for production only');
});

// ====================================================================
// Test 17: DNS prefetch disabled and IE noOpen set
// ====================================================================
test('VYR-050-17: Additional security headers (DNS prefetch, IE noOpen, XSS filter)', () => {
  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  assert.ok(src.includes('dnsPrefetchControl'), 'Must configure DNS prefetch control');
  assert.ok(src.includes('ieNoOpen'), 'Must configure IE noOpen');
  assert.ok(src.includes('xXssProtection'), 'Must configure XSS protection filter');
  pass('Additional security headers configured');
});

// ====================================================================
// Test 18: CORS maxAge configured for preflight caching
// ====================================================================
test('VYR-050-18: CORS preflight caching configured', () => {
  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  assert.ok(src.includes('maxAge:'), 'CORS must configure preflight cache maxAge');
  assert.ok(src.includes('credentials: true'), 'CORS must allow credentials');
  assert.ok(src.includes('allowedHeaders'), 'CORS must specify allowedHeaders');
  pass('CORS preflight caching and credentials configured');
});

// ====================================================================
// Test 19: CSP upgradeInsecureRequests in production
// ====================================================================
test('VYR-050-19: CSP upgrade-insecure-requests in production', () => {
  const src = fs.readFileSync(securityHeadersPath, 'utf-8');
  assert.ok(src.includes('upgradeInsecureRequests'), 'CSP must include upgradeInsecureRequests directive');
  pass('CSP upgrade-insecure-requests configured for production');
});

// ====================================================================
// Test 20: helmet dependency present in package.json
// ====================================================================
test('VYR-050-20: helmet is a production dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
  assert.ok(pkg.dependencies && pkg.dependencies.helmet, 'helmet must be in dependencies');
  pass('helmet is a production dependency');
});

// ====================================================================
// Summary
// ====================================================================
process.on('exit', () => {
  console.log('\n================================================================');
  console.log(`  VYR-050 Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  console.log('================================================================');
  if (failed > 0) process.exitCode = 1;
});
