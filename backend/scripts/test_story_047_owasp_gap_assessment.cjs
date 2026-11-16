/**
 * Test Suite: Story VYR-047
 * "Perform OWASP ASVS/API Security gap assessment"
 * Epic: EPIC 6 — OWASP application and API security hardening
 * Branch Applicability: Both
 *
 * Validates that:
 *  1. Gap register document exists with required structure
 *  2. All required sections are present (CRITICAL/HIGH/MEDIUM/LOW findings)
 *  3. Findings are mapped to OWASP categories and ASVS sections
 *  4. Remediation and verification evidence is provided for each finding
 *  5. Strengths/existing controls are documented
 *  6. Priority matrix exists for remediation planning
 *  7. Approval section exists for stakeholder sign-off
 *  8. ASVS Level 2 is the stated verification target
 *  9. Both OWASP Top 10 and API Security Top 10 are assessed
 * 10. Findings reference actual source files in the codebase
 */

process.env.TEST_OFFLINE = 'true';

const fs = require('fs');
const path = require('path');

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  FAIL: ${testName}`);
    failedTests++;
  }
}

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

async function run() {
  console.log('\n================================================================');
  console.log('  VYR-047: OWASP ASVS / API Security Gap Assessment');
  console.log('================================================================\n');

  const docsPath = path.resolve(__dirname, '../../docs/security');
  const gapRegisterPath = path.join(docsPath, 'VYR-047_OWASP_ASVS_GAP_REGISTER.md');

  // ====================================================================
  // Section 1: Document Existence
  // ====================================================================
  console.log('--- Section 1: Document Existence ---');

  assert(fs.existsSync(gapRegisterPath), 'Gap register document exists at docs/security/VYR-047_OWASP_ASVS_GAP_REGISTER.md');

  const doc = read(gapRegisterPath);

  // ====================================================================
  // Section 2: Document Header & Metadata
  // ====================================================================
  console.log('\n--- Section 2: Document Header & Metadata ---');

  assert(doc.includes('VYR-047'), 'Document references story VYR-047');
  assert(doc.includes('EPIC 6'), 'Document references Epic 6');
  assert(doc.includes('ASVS Level 2'), 'ASVS Level 2 is the stated verification target');
  assert(doc.includes('OWASP ASVS'), 'OWASP ASVS framework referenced');
  assert(doc.includes('2026-11-16'), 'Assessment date is recorded');

  // ====================================================================
  // Section 3: Severity Summary Table
  // ====================================================================
  console.log('\n--- Section 3: Severity Summary ---');

  assert(doc.includes('CRITICAL'), 'CRITICAL severity findings exist');
  assert(doc.includes('HIGH'), 'HIGH severity findings exist');
  assert(doc.includes('MEDIUM'), 'MEDIUM severity findings exist');
  assert(doc.includes('LOW'), 'LOW severity findings exist');

  const criticalCount = (doc.match(/CRITICAL/g) || []).length;
  assert(criticalCount >= 4, 'Multiple CRITICAL findings documented');

  // ====================================================================
  // Section 4: OWASP Top 10 Coverage
  // ====================================================================
  console.log('\n--- Section 4: OWASP Top 10 Coverage ---');

  assert(doc.includes('A01:2021') || doc.includes('Broken Access Control'), 'A01 Broken Access Control assessed');
  assert(doc.includes('A02:2021') || doc.includes('Cryptographic Failures'), 'A02 Cryptographic Failures assessed');
  assert(doc.includes('A03:2021') || doc.includes('Injection'), 'A03 Injection assessed');
  assert(doc.includes('A04:2021') || doc.includes('Insecure Design'), 'A04 Insecure Design assessed');
  assert(doc.includes('A05:2021') || doc.includes('Security Misconfiguration'), 'A05 Security Misconfiguration assessed');
  assert(doc.includes('A06:2021') || doc.includes('Vulnerable Components'), 'A06 Vulnerable Components assessed');
  assert(doc.includes('A07:2021') || doc.includes('Identification'), 'A07 Identification & Auth Failures assessed');
  assert(doc.includes('A08:2021') || doc.includes('Software.*Integrity'), 'A08 Software & Data Integrity assessed');
  assert(doc.includes('A09:2021') || doc.includes('Security Logging'), 'A09 Security Logging & Monitoring assessed');

  // ====================================================================
  // Section 5: OWASP API Security Top 10 Coverage
  // ====================================================================
  console.log('\n--- Section 5: OWASP API Security Top 10 Coverage ---');

  assert(doc.includes('API1') || doc.includes('Broken Object Level'), 'API1 Broken Object Level Auth assessed');
  assert(doc.includes('API3') || doc.includes('Broken Object Property'), 'API3 Broken Object Property Level Auth assessed');
  assert(doc.includes('API4') || doc.includes('Unrestricted Resource'), 'API4 Unrestricted Resource Consumption assessed');
  assert(doc.includes('API5') || doc.includes('Broken Function Level'), 'API5 Broken Function Level Auth assessed');
  assert(doc.includes('API8') || doc.includes('Security Misconfiguration'), 'API8 Security Misconfiguration assessed');

  // ====================================================================
  // Section 6: ASVS Section References
  // ====================================================================
  console.log('\n--- Section 6: ASVS Section References ---');

  assert(doc.includes('V2.'), 'ASVS V2 (Authentication) sections referenced');
  assert(doc.includes('V3.') || doc.includes('V4.'), 'ASVS V3/V4 (Session/Access Control) sections referenced');
  assert(doc.includes('V5.'), 'ASVS V5 (Validation) sections referenced');
  assert(doc.includes('V6.'), 'ASVS V6 (Cryptography) sections referenced');
  assert(doc.includes('V7.'), 'ASVS V7 (Error Handling) sections referenced');
  assert(doc.includes('V14.'), 'ASVS V14 (Configuration) sections referenced');

  // ====================================================================
  // Section 7: Finding Structure — Each finding has required fields
  // ====================================================================
  console.log('\n--- Section 7: Finding Structure ---');

  assert(doc.includes('GAP-001'), 'First finding has ID GAP-001');
  assert(doc.includes('Affected Component'), 'Findings have Affected Component column');
  assert(doc.includes('Finding'), 'Findings have Finding description column');
  assert(doc.includes('Remediation'), 'Findings have Remediation column');
  assert(doc.includes('Verification Evidence'), 'Findings have Verification Evidence column');

  // ====================================================================
  // Section 8: Findings Reference Actual Source Files
  // ====================================================================
  console.log('\n--- Section 8: Source File References ---');

  assert(doc.includes('backend/src/routes/api.ts'), 'Findings reference api.ts');
  assert(doc.includes('backend/src/index.ts'), 'Findings reference index.ts');
  assert(doc.includes('backend/src/services/authService.ts'), 'Findings reference authService.ts');
  assert(doc.includes('backend/src/config.ts'), 'Findings reference config.ts');
  assert(doc.includes('backend/package.json') || doc.includes('package.json'), 'Findings reference package.json');

  // ====================================================================
  // Section 9: Key Findings Content Validation
  // ====================================================================
  console.log('\n--- Section 9: Key Findings Content ---');

  assert(doc.includes('SQL Injection') || doc.includes('sql injection') || doc.includes('SQL injection'), 'SQL injection finding documented');
  assert(doc.includes('brute') || doc.includes('lockout') || doc.includes('rate limit'), 'Brute force / rate limiting finding documented');
  assert(doc.includes('CORS') || doc.includes('cors'), 'CORS misconfiguration finding documented');
  assert(doc.includes('helmet') || doc.includes('Helmet') || doc.includes('security header'), 'Missing security headers finding documented');
  assert(doc.includes('hardcoded') || doc.includes('fallback') || doc.includes('default'), 'Hardcoded secrets finding documented');

  // ====================================================================
  // Section 10: Strengths / Existing Controls
  // ====================================================================
  console.log('\n--- Section 10: Strengths Documentation ---');

  assert(doc.includes('Strengths') || doc.includes('Controls Already in Place'), 'Existing security controls section exists');
  assert(doc.includes('RS256') || doc.includes('JWT'), 'JWT/RS256 listed as existing control');
  assert(doc.includes('bcrypt'), 'Bcrypt password hashing listed as existing control');
  assert(doc.includes('VYR-041') || doc.includes('encryption preflight'), 'Encryption guard listed as existing control');
  assert(doc.includes('VYR-045') || doc.includes('sync monitoring'), 'Sync monitoring listed as existing control');
  assert(doc.includes('sqlValidatorService') || doc.includes('SQL validator'), 'SQL validator listed as existing control');

  // ====================================================================
  // Section 11: Remediation Priority Matrix
  // ====================================================================
  console.log('\n--- Section 11: Priority Matrix ---');

  assert(doc.includes('Priority') && doc.includes('Matrix'), 'Remediation priority matrix exists');
  assert(doc.includes('P0') || doc.includes('Fix immediately'), 'P0/immediate priority level defined');
  assert(doc.includes('P1') || doc.includes('Fix this epic'), 'P1/epic priority level defined');
  assert(doc.includes('P2') || doc.includes('Fix next'), 'P2/next priority level defined');

  // ====================================================================
  // Section 12: Approval Section
  // ====================================================================
  console.log('\n--- Section 12: Approval Section ---');

  assert(doc.includes('Approval'), 'Approval section exists');
  assert(doc.includes('Security Lead') || doc.includes('security'), 'Security lead approval slot');
  assert(doc.includes('Product Owner') || doc.includes('product'), 'Product owner approval slot');

  // ====================================================================
  // Section 13: No Raw Credentials in Document
  // ====================================================================
  console.log('\n--- Section 13: No Credentials in Document ---');

  assert(!doc.includes('Admin@123'), 'No actual default password in document');
  assert(!doc.includes('Bearer ey'), 'No actual JWT tokens in document');
  assert(!doc.includes('default-fallback-security-key'), 'Actual fallback key not exposed (only referenced)');

  // Wait — the remediation section may reference the key name. Let's check it doesn't appear as a usable secret.
  const keyAppearances = (doc.match(/default-fallback-security-key-oracle-fusion/g) || []).length;
  assert(keyAppearances <= 1, 'Hardcoded key value mentioned at most once (in finding reference, not as usable secret)');

  // ====================================================================
  // Section 14: Finding Count Validation
  // ====================================================================
  console.log('\n--- Section 14: Finding Count ---');

  const gapIds = doc.match(/GAP-\d{3}/g) || [];
  const uniqueGaps = new Set(gapIds);
  assert(uniqueGaps.size >= 20, `At least 20 unique findings documented (found ${uniqueGaps.size})`);
  assert(uniqueGaps.size <= 50, `Finding count is reasonable (not over-reported): ${uniqueGaps.size}`);

  // ====================================================================
  // Summary
  // ====================================================================
  console.log('\n================================================================');
  console.log(`  Results: ${passedTests} passed, ${failedTests} failed out of ${passedTests + failedTests} tests`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
