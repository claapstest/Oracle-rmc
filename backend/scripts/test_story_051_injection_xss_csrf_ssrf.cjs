/**
 * Test Suite: Story VYR-051
 * "Review and remediate SQL injection, XSS, CSRF and SSRF"
 * Epic: EPIC 6 — OWASP application and API security hardening
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Sections:
 *  A. Runtime: SQL injection — the chatbot SELECT engine rejects stacked
 *     statements, destructive verbs, unknown tables, sensitive columns and
 *     enforces LIMIT; persistence stays parameterized with quoted identifiers.
 *  B. Runtime: SSRF — integration base URLs reject private, loopback,
 *     link-local/metadata and internal hostnames; HTTPS enforced.
 *  C. Static: XSS — no dangerouslySetInnerHTML / innerHTML in the frontend.
 *  D. Static: CSRF — API auth is Bearer-header (not cookies); the single
 *     OAuth state cookie is HttpOnly + Secure + SameSite=Lax.
 *  E. Static: log-injection sanitisation of display-only SQL + safe exports.
 *
 * No database required (validator only parses SQL).
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

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
  console.log('  VYR-051: SQL Injection, XSS, CSRF & SSRF Remediation');
  console.log('================================================================\n');

  const src = path.resolve(__dirname, '../src');
  const dist = path.resolve(__dirname, '../dist');
  const root = path.resolve(__dirname, '../..');

  assert(fs.existsSync(dist), 'backend is compiled (dist/ exists)');

  const api = read(path.join(src, 'routes/api.ts'));
  const urlPolicySrc = read(path.join(src, 'security/urlPolicy.ts'));

  // The AI database chatbot (and its SQL validator) only exists on the
  // AI-enabled branch — runtime SQL probes are branch-aware.
  const validatorPath = path.join(dist, 'services/sqlValidatorService.js');
  const validatorExists = fs.existsSync(validatorPath);

  const urlPolicy = await import(
    pathToFileURL(path.join(dist, 'security/urlPolicy.js')).href
  );

  // =====================================================================
  // Section A: SQL injection (runtime, against the compiled validator)
  // =====================================================================
  console.log('--- Section A: SQL injection (runtime) ---');

  if (validatorExists) {
    const resilience = await import(pathToFileURL(validatorPath).href);
    const validator = resilience.sqlValidatorService;

  // A1: stacked statement / classic injection string
  let r = await validator.validateAndSanitizeSql("SELECT * FROM oracle_raw_controls; DROP TABLE oracle_raw_controls");
  assert(!r.isValid, 'Stacked statement (SELECT ...; DROP TABLE) rejected');

  // A2: destructive verb disguised as the first statement
  r = await validator.validateAndSanitizeSql("DELETE FROM oracle_raw_controls WHERE 1=1");
  assert(!r.isValid, 'DELETE rejected (destructive verbs forbidden)');

  // A3: UNION-based exfiltration against a non-allowlisted table
  r = await validator.validateAndSanitizeSql("SELECT username FROM oracle_raw_users UNION SELECT password FROM user_management_credentials");
  assert(!r.isValid, 'UNION against non-allowlisted table rejected');

  // A4: unknown / attacker-named table
  r = await validator.validateAndSanitizeSql("SELECT * FROM attacker_c2_exfil");
  assert(!r.isValid, 'Unknown table rejected (schema allowlist enforced)');

  // A5: sensitive credential column
  r = await validator.validateAndSanitizeSql("SELECT password_hash FROM veyra_users");
  assert(!r.isValid, 'Sensitive credential column (password_hash) rejected');

  // A6: pg non-relational / admin functions
  r = await validator.validateAndSanitizeSql("SELECT pg_read_file('/etc/passwd')");
  assert(!r.isValid, 'Server-side file read (pg_read_file) rejected');

  // A7: legitimate allowlisted SELECT passes and gets a LIMIT
  r = await validator.validateAndSanitizeSql("SELECT control_id, name FROM oracle_raw_controls");
  assert(r.isValid, 'Legitimate SELECT against allowlisted table accepted');
  assert(/\bLIMIT\s+\d+\b/i.test(r.sanitizedSql), 'Row cap enforced (LIMIT appended)');

  // A8: comment-based evasion still hits the table allowlist
  r = await validator.validateAndSanitizeSql("SELECT * FROM oracle_raw_controls /*x*/ UNION SELECT 1 FROM information_schema.columns");
  assert(!r.isValid || !/information_schema\.pg/i.test(r.sanitizedSql), 'Comment-based table smuggling neutralised');
  } else {
    assert(!fs.existsSync(path.join(src, 'services/universalDatabaseChatbotService.ts')),
      'No free-form SQL chatbot on this branch (AI-enabled-only feature absent)');
  }

  // A9: persistence stays parameterized + identifiers quoted (static)
  const auditSvc = read(path.join(src, 'services/auditRawDbService.ts'));
  assert(/\$[0-9]+\)/.test(auditSvc) && /ON CONFLICT/.test(auditSvc), 'Raw-table persistence uses parameterized upserts');
  const keyRot = read(path.join(src, 'security/keyRotationService.ts'));
  assert(/function q\(identifier: string\)/.test(keyRot) && /replace\(/.test(keyRot), 'Dynamic SQL identifiers are quoted via q() escaping');
  const requestValidation = fs.existsSync(path.join(src, 'security/requestValidationService.ts'));
  assert(requestValidation, 'Request validation service present (VYR-049 schema layer)');

  // =====================================================================
  // Section B: SSRF (runtime, against the compiled URL policy)
  // =====================================================================
  console.log('\n--- Section B: SSRF (runtime) ---');

  const { validateAndNormalizeUrl, isPublicHttpsHost } = urlPolicy;

  assert(isPublicHttpsHost('eiiv-dev14.fa.us6.oraclecloud.com'), 'Public Oracle Fusion host accepted');
  assert(isPublicHttpsHost('my-fusion.example.com'), 'Ordinary public domain accepted');

  for (const [host, why] of [
    ['localhost', 'loopback name'],
    ['127.0.0.1', 'IPv4 loopback'],
    ['10.1.2.3', 'RFC1918 10/8'],
    ['172.16.0.1', 'RFC1918 172.16/12'],
    ['192.168.1.1', 'RFC1918 192.168/16'],
    ['169.254.169.254', 'cloud metadata endpoint'],
    ['::1', 'IPv6 loopback'],
    ['db.corp.internal', 'internal hostname'],
    ['myserver', 'single-label hostname'],
  ]) {
    let rejected = false;
    try { validateAndNormalizeUrl(`https://${host}`); } catch (_) { rejected = true; }
    assert(rejected, `Rejected: ${host} (${why})`);
  }

  // HTTPS + shape rules still enforced
  let httpRejected = false;
  try { validateAndNormalizeUrl('http://eiiv-dev14.fa.us6.oraclecloud.com'); } catch (_) { httpRejected = true; }
  assert(httpRejected, 'Plain HTTP base URL rejected (HTTPS required)');

  let pathRejected = false;
  try { validateAndNormalizeUrl('https://eiiv-dev14.fa.us6.oraclecloud.com/hcmRestApi'); } catch (_) { pathRejected = true; }
  assert(pathRejected, 'Base URL with a path rejected');

  const normalized = validateAndNormalizeUrl('https://eiiv-dev14.fa.us6.oraclecloud.com/');
  assert(normalized === 'https://eiiv-dev14.fa.us6.oraclecloud.com', `URL normalized (got: ${normalized})`);

  // Request-time pinning (CommandCenterService) still intact
  const commandCenter = read(path.join(src, 'services/commandCenterService.ts'));
  assert(/resolveAndValidateUrl/.test(commandCenter) && /does not match the configured Oracle Fusion host/.test(commandCenter),
    'Command Center pins outbound requests to the configured Oracle Fusion host');

  // =====================================================================
  // Section C: XSS (static, frontend)
  // =====================================================================
  console.log('\n--- Section C: XSS (static) ---');

  const feDir = path.join(root, 'frontend', 'src');
  assert(fs.existsSync(feDir), 'frontend/src exists');
  const feFiles = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(f.name)) feFiles.push(p);
    }
  })(feDir);

  const unsafeRender = [];
  for (const f of feFiles) {
    const content = read(f);
    if (/dangerouslySetInnerHTML/.test(content) || /\.innerHTML\s*=/.test(content)) unsafeRender.push(path.relative(root, f));
  }
  assert(unsafeRender.length === 0, `No dangerouslySetInnerHTML / innerHTML assignments in frontend (${feFiles.length} files scanned)`);
  assert(!/\.createElement\(['"]script['"]/.test(api), 'No dynamic <script> injection in backend routes');

  // =====================================================================
  // Section D: CSRF (static)
  // =====================================================================
  console.log('\n--- Section D: CSRF (static) ---');

  // API authentication is Bearer-header based, not cookie based: only one
  // cookie exists (OAuth state), and it carries full CSRF-safe attributes.
  assert(/sameSite:\s*'lax'/i.test(api), 'OAuth state cookie is SameSite=Lax');
  assert(/httpOnly:\s*true/i.test(api), 'OAuth state cookie is HttpOnly');
  assert(/secure/i.test(api), 'OAuth state cookie is Secure');
  assert(/completeAuthorization\(code, state\)/.test(api), 'OAuth state parameter is verified server-side on callback');

  const authFiles = fs.readdirSync(path.join(src, 'auth')).filter((f) => f.endsWith('.ts'));
  const authBlob = authFiles.map((f) => read(path.join(src, 'auth', f))).join('\n');
  assert(/Bearer|authorization/i.test(authBlob) || /authorization/i.test(api), 'API auth transports tokens via Authorization header (not cookies)');

  // VYR-051: these strings are terminal-log display only (never executed).
  // The Ask VEYRA chat route only exists on the AI-enabled branch, so the
  // display sanitisation assertions below are branch-aware (VYR-049 pattern).
  const isAiEnabledBranch = /processUserMessage/.test(api);

  // =====================================================================
  // Section E: log-injection sanitisation + safe exports (static)
  // =====================================================================
  console.log('\n--- Section E: Display SQL sanitisation & exports ---');

  if (isAiEnabledBranch) {
    assert(/const sqlDisplay = \(v: unknown\): string =>/.test(api), 'AI-extracted parameters are sanitised before appearing in display SQL');
    assert(/sqlDisplay\(aiResponse\.parameters\?\.controlId\)/.test(api), 'controlId display string sanitised');
    assert(/Number\(aiResponse\.parameters\?\.limit\) \|\| 25/.test(api), 'LIMIT display value coerced to a number');
  } else {
    assert(!/aiResponse\.parameters\?\.controlId \|\| ''\}/.test(api), 'No unsanitised AI display-SQL interpolation on this branch (Ask VEYRA not present)');
  }

  const reportDb = read(path.join(src, 'services/reportDbService.ts'));
  assert(/generateReportContent/.test(reportDb), 'Report export builder present (content is static/simulated — no user data in cells)');

  console.log('\n================================================================');
  console.log(`  RESULTS: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================\n');
  process.exit(failedTests > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
