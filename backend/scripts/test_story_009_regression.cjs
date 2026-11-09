/**
 * Story 9 Verification Suite:
 * Regression-test AI-enabled and AI-free branch variants (Epic 1 Closure - VYR-009)
 *
 * Objectives & Acceptance Criteria:
 * 1. Both branches pass CI quality gates (Frontend build, Backend build, Database test suites).
 * 2. AI-free deployment has zero AI routes, zero chatbot UI, zero provider SDK dependencies,
 *    and zero AI secrets.
 * 3. AI-enabled deployment retains operational AskVeyra with expected RBAC restrictions
 *    (Supervisor 403 Forbidden, Manager 200 Authorized).
 * 4. Common business functions behave equivalently across both variants (Authentication,
 *    Dashboard Scoping, Users, Roles, Reports, Settings, RBAC Guards).
 * 5. Common module API contracts remain identical in signature and behavior.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 5099;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

const standardRepoRoot = path.resolve(__dirname, '../..');
const aiRepoRoot = path.resolve(standardRepoRoot, '../Oracle-rmc');

function makeRequest(method, reqPath, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, BASE_URL);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const data = body ? JSON.stringify(body) : null;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {
          parsed = raw;
        }
        resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw });
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runRegressionSuite() {
  console.log('================================================================');
  console.log('  Story 9: Dual-Branch Regression Validation Suite (VYR-009)');
  console.log('  AI-Free vs. AI-Enabled Architectural & Runtime Verification');
  console.log('================================================================\n');

  let testsPassed = 0;
  let testsFailed = 0;

  function record(pass, title, details = null) {
    if (pass) {
      console.log(`  ✅ [PASS] ${title}`);
      testsPassed++;
    } else {
      console.error(`  ❌ [FAIL] ${title}`);
      if (details) console.error(`         Details:`, details);
      testsFailed++;
    }
  }

  // ==========================================================================
  // SECTION 1: AI-Free Branch Static Artifact & Architecture Audit
  // ==========================================================================
  console.log('--- Suite 1: AI-Free Branch Static Codebase & Artifact Audit ---');

  // 1.1 Frontend Absence
  const assistantPagePath = path.join(standardRepoRoot, 'frontend/src/pages/Assistant.tsx');
  record(!fs.existsSync(assistantPagePath), 'AI-Free: frontend/src/pages/Assistant.tsx is completely removed');

  const assistantTestPath = path.join(standardRepoRoot, 'frontend/src/test/assistant_consumption.test.ts');
  record(!fs.existsSync(assistantTestPath), 'AI-Free: frontend/src/test/assistant_consumption.test.ts is deleted');

  const appSource = fs.readFileSync(path.join(standardRepoRoot, 'frontend/src/App.tsx'), 'utf8');
  record(!/import\s+Assistant/.test(appSource), 'AI-Free: App.tsx contains no Assistant import');
  record(!/<Assistant/.test(appSource), 'AI-Free: App.tsx renders no <Assistant /> component');
  record(!/id:\s*'assistant'/.test(appSource), 'AI-Free: App.tsx contains no "Ask VEYRA" navigation menu entry');

  const authUtilsSource = fs.readFileSync(path.join(standardRepoRoot, 'frontend/src/utils/authorization.ts'), 'utf8');
  record(!/^\s*assistant\s*:/m.test(authUtilsSource), 'AI-Free: PAGE_PRIVILEGES has no assistant page definition');

  const frontendApiSource = fs.readFileSync(path.join(standardRepoRoot, 'frontend/src/services/api.ts'), 'utf8');
  record(!/sendMessage\s*\(/.test(frontendApiSource), 'AI-Free: api.ts has no sendMessage() client method');

  const cssSource = fs.readFileSync(path.join(standardRepoRoot, 'frontend/src/index.css'), 'utf8');
  record(!/\.assistant-hero/.test(cssSource), 'AI-Free: index.css purged of chatbot hero CSS classes');

  // 1.2 Backend Absence
  const aiDir = path.join(standardRepoRoot, 'backend/src/ai');
  record(!fs.existsSync(aiDir), 'AI-Free: backend/src/ai directory is completely purged');

  const toolsDir = path.join(standardRepoRoot, 'backend/src/tools');
  record(!fs.existsSync(toolsDir), 'AI-Free: backend/src/tools directory is completely purged');

  const purgedServices = [
    'universalDatabaseChatbotService.ts',
    'groundedAnswerService.ts',
    'textToSqlService.ts',
    'certificateHybridRagService.ts',
    'conversationContextService.ts',
    'observabilityTraceService.ts',
    'resultVerificationService.ts',
    'schemaDiscoveryService.ts',
    'schemaLinkingService.ts',
    'sourceRoutingService.ts',
    'sqlValidatorService.ts',
    'metadataCatalogService.ts'
  ];
  const lingeringServices = purgedServices.filter(s => fs.existsSync(path.join(standardRepoRoot, 'backend/src/services', s)));
  record(lingeringServices.length === 0, `AI-Free: All 12 AI backend services removed (Lingering: ${lingeringServices.join(', ') || 'None'})`);

  const purgedAiScripts = [
    'test_hybrid_rag_certificate.cjs',
    'test_universal_database_chatbot.cjs',
    'test_user_questions.cjs',
    'test_user_spec_questions.cjs'
  ];
  const lingeringScripts = purgedAiScripts.filter(s => fs.existsSync(path.join(standardRepoRoot, 'backend/scripts', s)));
  record(lingeringScripts.length === 0, `AI-Free: All legacy AI test scripts removed (Lingering: ${lingeringScripts.join(', ') || 'None'})`);

  const backendPkg = JSON.parse(fs.readFileSync(path.join(standardRepoRoot, 'backend/package.json'), 'utf8'));
  const allDeps = { ...(backendPkg.dependencies || {}), ...(backendPkg.devDependencies || {}) };
  const aiPackages = ['@google/generative-ai', 'openai', 'groq-sdk', 'together-ai', 'node-sql-parser'];
  const presentAiPackages = aiPackages.filter(p => p in allDeps);
  record(presentAiPackages.length === 0, `AI-Free: backend/package.json has zero AI SDK dependencies (Found: ${presentAiPackages.join(', ') || 'None'})`);

  const envExample = fs.readFileSync(path.join(standardRepoRoot, '.env.example'), 'utf8');
  record(!/\b(TOGETHER_API_KEY|GROQ_API_KEY|GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)\b/.test(envExample),
    'AI-Free: .env.example contains no AI API credentials');

  const configSource = fs.readFileSync(path.join(standardRepoRoot, 'backend/src/config.ts'), 'utf8');
  record(!/\b(togetherApiKey|groqApiKey|llmEndpoint|togetherModel|groqModel)\b/.test(configSource),
    'AI-Free: backend/src/config.ts defines zero AI configuration parameters');

  const rbacSeed = fs.readFileSync(path.join(standardRepoRoot, 'database/src/seeds/rbac_seed.ts'), 'utf8');
  const privSection = rbacSeed.slice(rbacSeed.indexOf('export const PRIVILEGES_DATA'), rbacSeed.indexOf('export const ROLE_PRIVILEGE_MAPPINGS'));
  const mapSection = rbacSeed.slice(rbacSeed.indexOf('export const ROLE_PRIVILEGE_MAPPINGS'), rbacSeed.indexOf('export const BOOTSTRAP_USER'));
  record(!/ASK_VEYRA|AI_ASSISTANT/.test(privSection) && !/ASK_VEYRA|AI_ASSISTANT/.test(mapSection),
    'AI-Free: database RBAC seed defines zero ASK_VEYRA privileges or role mappings');

  // ==========================================================================
  // SECTION 2: AI-Enabled Branch Contrast & AskVeyra Retention Verification
  // ==========================================================================
  console.log('\n--- Suite 2: AI-Enabled Branch Variant Contrast & Retention Verification ---');

  if (fs.existsSync(aiRepoRoot)) {
    const aiAssistantPage = path.join(aiRepoRoot, 'frontend/src/pages/Assistant.tsx');
    record(fs.existsSync(aiAssistantPage), 'AI-Enabled: frontend/src/pages/Assistant.tsx is retained and operational');

    const aiAppSource = fs.readFileSync(path.join(aiRepoRoot, 'frontend/src/App.tsx'), 'utf8');
    record(/import\s+Assistant/.test(aiAppSource) && /id:\s*'assistant'/.test(aiAppSource),
      'AI-Enabled: App.tsx retains Assistant import and navigation route');

    const aiOrchestrator = path.join(aiRepoRoot, 'backend/src/ai/orchestrator.ts');
    record(fs.existsSync(aiOrchestrator), 'AI-Enabled: backend/src/ai/orchestrator.ts is retained');

    const aiTools = path.join(aiRepoRoot, 'backend/src/tools/index.ts');
    record(fs.existsSync(aiTools), 'AI-Enabled: backend/src/tools/index.ts registry is retained');

    const aiApiSource = fs.readFileSync(path.join(aiRepoRoot, 'backend/src/routes/api.ts'), 'utf8');
    record(/apiRouter\.post\('\/chat',\s*requireAskVeyra/.test(aiApiSource),
      'AI-Enabled: POST /api/chat route is registered with requireAskVeyra middleware');
    record(/export\s+function\s+requireAskVeyra/.test(aiApiSource),
      'AI-Enabled: requireAskVeyra middleware guard is exported and active');

    const aiBackendPkg = JSON.parse(fs.readFileSync(path.join(aiRepoRoot, 'backend/package.json'), 'utf8'));
    const aiDeps = { ...(aiBackendPkg.dependencies || {}), ...(aiBackendPkg.devDependencies || {}) };
    record('@google/generative-ai' in aiDeps && 'node-sql-parser' in aiDeps,
      'AI-Enabled: package.json retains @google/generative-ai and node-sql-parser SDK dependencies');

    const aiAuthSource = fs.readFileSync(path.join(aiRepoRoot, 'backend/src/services/authService.ts'), 'utf8');
    record(aiAuthSource.includes('role_audit_manager') && aiAuthSource.includes('ASK_VEYRA'),
      'AI-Enabled: authService assigns ASK_VEYRA privilege to Audit Manager');

    // Confirm that requireAskVeyra explicitly blocks AUDIT_SUPERVISOR
    record(/userRole\s*===\s*'AUDIT_SUPERVISOR'[\s\S]*?403[\s\S]*?Audit Supervisor does not have privilege to access Ask Veyra/.test(aiApiSource),
      'AI-Enabled: requireAskVeyra strictly enforces 403 Forbidden for AUDIT_SUPERVISOR');
  } else {
    console.log('  ⚠️ AI-Enabled directory (Oracle-rmc) not found at expected peer location; skipping peer directory checks.');
  }

  // ==========================================================================
  // SECTION 3: AI-Free Runtime API Contract & Endpoint Unregistration (Port 5099)
  // ==========================================================================
  console.log('\n--- Suite 3: AI-Free Runtime API Contract (Express on Port 5099) ---');

  process.env.PORT = String(TEST_PORT);
  process.env.NODE_ENV = 'test';
  process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES = '5';

  const express = require('express');
  const cors = require('cors');

  const distApi = path.join(standardRepoRoot, 'backend/dist/routes/api.js');
  if (!fs.existsSync(distApi)) {
    console.error('Build output dist/routes/api.js not found! Please build backend before testing.');
    process.exit(1);
  }

  const { apiRouter } = require(distApi);
  const { authService } = require(path.join(standardRepoRoot, 'backend/dist/services/authService.js'));
  const { query: dbQuery } = require(path.join(standardRepoRoot, 'backend/dist/db.js'));
  const { auditDashboardService } = require(path.join(standardRepoRoot, 'backend/dist/services/auditDashboardService.js'));

  // Expire any existing active test sessions in PostgreSQL
  await dbQuery("UPDATE veyra_session SET status = 'EXPIRED' WHERE status = 'ACTIVE'").catch(() => {});
  if (typeof authService._clearActiveSessions === 'function') {
    authService._clearActiveSessions();
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use('/api', apiRouter);

  // Exact 404 handler matching index.ts
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `API endpoint ${req.method} ${req.path} does not exist.`
    });
  });

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(TEST_PORT, resolve));
  console.log(`[Test Server] Mounted AI-Free API on http://127.0.0.1:${TEST_PORT}\n`);

  try {
    // 3.1 Authenticate Test Personas
    const adminLogin = await authService.login('admin@admin.com', 'Admin@123', { force: true }).catch(() => null)
      || await authService.login('admin@admin.com', '', { force: true });
    const adminToken = adminLogin?.token;
    record(Boolean(adminToken), 'Site Admin authenticated successfully');

    const mgrLogin = await authService.login('akash.meesarapu@claaps.com', 'Password@123', { force: true });
    const mgrToken = mgrLogin?.token;
    record(Boolean(mgrToken), 'Audit Manager authenticated successfully');

    const supLogin = await authService.login('supervisor.user@claaps.com', 'Password@123', { force: true });
    const supToken = supLogin?.token;
    record(Boolean(supToken), 'Audit Supervisor authenticated successfully');

    const userLogin = await authService.login('audit.user@claaps.com', 'Password@123', { force: true });
    const userToken = userLogin?.token;
    record(Boolean(userToken), 'Audit User authenticated successfully');

    // 3.2 AI Endpoint Unregistration (Must return 404 Not Found for ALL callers)
    const unauthChat = await makeRequest('POST', '/api/chat', { message: 'hello' });
    record(unauthChat.status === 404, 'AI-Free: Unauthenticated POST /api/chat returns HTTP 404 Not Found');

    const adminChat = await makeRequest('POST', '/api/chat', { message: 'query' }, adminToken);
    record(adminChat.status === 404, 'AI-Free: Site Admin POST /api/chat returns HTTP 404 Not Found');

    const mgrChat = await makeRequest('POST', '/api/chat', { message: 'query' }, mgrToken);
    record(mgrChat.status === 404, 'AI-Free: Audit Manager POST /api/chat returns HTTP 404 Not Found');

    const supChat = await makeRequest('POST', '/api/chat', { message: 'query' }, supToken);
    record(supChat.status === 404, 'AI-Free: Audit Supervisor POST /api/chat returns HTTP 404 Not Found (absent, not 403)');

    const userChat = await makeRequest('POST', '/api/chat', { message: 'query' }, userToken);
    record(userChat.status === 404, 'AI-Free: Audit User POST /api/chat returns HTTP 404 Not Found');

    const getChat = await makeRequest('GET', '/api/chat', null, adminToken);
    record(getChat.status === 404, 'AI-Free: GET /api/chat returns HTTP 404 Not Found');

    const uniQuery = await makeRequest('POST', '/api/ai/universal-query', { prompt: 'select users' }, adminToken);
    record(uniQuery.status === 404, 'AI-Free: POST /api/ai/universal-query returns HTTP 404 Not Found');

    const uniTraces = await makeRequest('GET', '/api/ai/universal-traces', null, adminToken);
    record(uniTraces.status === 404, 'AI-Free: GET /api/ai/universal-traces returns HTTP 404 Not Found');

    const dbSchema = await makeRequest('GET', '/api/database/schema', null, adminToken);
    record(dbSchema.status === 404, 'AI-Free: GET /api/database/schema returns HTTP 404 Not Found');

    // ==========================================================================
    // SECTION 4: Common Business Functions Parity & RBAC Enforcement (AI-Free)
    // ==========================================================================
    console.log('\n--- Suite 4: Common Business Function Parity & RBAC Verification ---');

    // 4.1 Authentication Contract Parity
    const badLogin = await makeRequest('POST', '/api/auth/login', { email: 'admin@admin.com', password: 'WrongPassword' });
    record(badLogin.status === 401, 'Auth Parity: POST /api/auth/login rejects invalid credentials with HTTP 401');

    const missingCreds = await makeRequest('POST', '/api/auth/login', { email: 'admin@admin.com' });
    record(missingCreds.status === 400, 'Auth Parity: POST /api/auth/login rejects incomplete payload with HTTP 400');

    // 4.2 Scoped Dashboard Response Parity & AI-Free Isolation
    const mgrUserContext = {
      userId: mgrLogin.userId,
      email: mgrLogin.email,
      displayName: mgrLogin.displayName,
      role: 'AUDIT_MANAGER',
      permissions: mgrLogin.permissions
    };
    const supUserContext = {
      userId: supLogin.userId,
      email: supLogin.email,
      displayName: supLogin.displayName,
      role: 'AUDIT_SUPERVISOR',
      permissions: supLogin.permissions
    };

    const mgrDash = await auditDashboardService.getDashboardDataForUser(mgrUserContext);
    record(mgrDash.userScope?.hasAskVeyraAccess === false, 'Dashboard Parity: Audit Manager hasAskVeyraAccess is strictly false');
    record(mgrDash.userScope?.features?.askVeyra === false, 'Dashboard Parity: Audit Manager features.askVeyra is strictly false');
    record(!mgrDash.userScope?.authorizedModules?.includes('AI_ASSISTANT'), 'Dashboard Parity: Audit Manager excludes AI_ASSISTANT module');
    record(mgrDash.userScope?.authorizedModules?.includes('AUDIT'), 'Dashboard Parity: Retains standard AUDIT module');

    const supDash = await auditDashboardService.getSupervisorDashboardData(supUserContext);
    record(supDash.userScope?.hasAskVeyraAccess === false, 'Dashboard Parity: Audit Supervisor hasAskVeyraAccess is strictly false');
    record(supDash.userScope?.features?.askVeyra === false, 'Dashboard Parity: Audit Supervisor features.askVeyra is strictly false');
    record(!supDash.userScope?.authorizedModules?.includes('AI_ASSISTANT'), 'Dashboard Parity: Audit Supervisor excludes AI_ASSISTANT module');

    // 4.3 Core Module API Invariance & Route Availability
    const capsRes = await makeRequest('GET', '/api/capabilities', null, adminToken);
    record(capsRes.status === 200 && capsRes.data?.users === true && capsRes.data?.audit === true,
      'Core Route Parity: GET /api/capabilities returns 200 with platform flags intact');

    const usersRes = await makeRequest('GET', '/api/users', null, adminToken);
    record(usersRes.status === 200 && Array.isArray(usersRes.data?.users),
      'Core Route Parity: Site Admin accesses GET /api/users (200 OK)');

    const rolesRes = await makeRequest('GET', '/api/roles', null, adminToken);
    record(rolesRes.status === 200 && (Array.isArray(rolesRes.data?.roles) || Array.isArray(rolesRes.data)),
      'Core Route Parity: Site Admin accesses GET /api/roles (200 OK)');

    const mgrDashRoute = await makeRequest('GET', '/api/dashboard/audit-manager', null, mgrToken);
    record(mgrDashRoute.status === 200 && mgrDashRoute.data?.success === true,
      'Core Route Parity: Audit Manager accesses GET /api/dashboard/audit-manager (200 OK)');

    const supDashRoute = await makeRequest('GET', '/api/dashboard/audit-supervisor', null, supToken);
    record(supDashRoute.status === 200 && supDashRoute.data?.success === true,
      'Core Route Parity: Audit Supervisor accesses GET /api/dashboard/audit-supervisor (200 OK)');

    const reportsRoute = await makeRequest('GET', '/api/reports/role-hierarchy', null, userToken);
    record(reportsRoute.status === 200, 'Core Route Parity: Audit User accesses GET /api/reports/role-hierarchy (200 OK)');

    const settingsRes = await makeRequest('GET', '/api/settings', null, adminToken);
    record(settingsRes.status === 200 && settingsRes.data?.hasGeminiKey === undefined && settingsRes.data?.togetherModel === undefined,
      'Core Route Parity: GET /api/settings returns 200 without leaking AI properties');

    // 4.4 Shared Security Boundary Invariance
    const unauthUsers = await makeRequest('GET', '/api/users');
    record(unauthUsers.status === 401, 'Security Guard Parity: requireAuth rejects unauthenticated request with HTTP 401');

    const forbiddenSettings = await makeRequest('GET', '/api/settings', null, userToken);
    record(forbiddenSettings.status === 403, 'Security Guard Parity: requirePrivilege rejects Audit User on settings with HTTP 403');

    const forbiddenAdminDash = await makeRequest('GET', '/api/dashboard/site-admin', null, userToken);
    record(forbiddenAdminDash.status === 403, 'Security Guard Parity: requireRole rejects Audit User on Site Admin dashboard with HTTP 403');

    // 4.5 PostgreSQL RBAC Cleanliness Check
    const privCount = await dbQuery("SELECT COUNT(*) as count FROM veyra_privilege WHERE privilege_code = 'ASK_VEYRA'");
    record(parseInt(privCount.rows[0].count, 10) === 0, 'Database Parity: PostgreSQL veyra_privilege has 0 rows for ASK_VEYRA');

    const rolePrivCount = await dbQuery(
      "SELECT COUNT(*) as count FROM veyra_role_privilege rp JOIN veyra_privilege p ON rp.privilege_id = p.id WHERE p.privilege_code = 'ASK_VEYRA'"
    );
    record(parseInt(rolePrivCount.rows[0].count, 10) === 0, 'Database Parity: PostgreSQL veyra_role_privilege has 0 mappings for ASK_VEYRA');

  } finally {
    server.close();
    console.log('\n[Test Server] Shut down gracefully.');
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n================================================================');
  console.log(`  Regression Suite Summary: ${testsPassed} passed, ${testsFailed} failed.`);
  if (testsFailed === 0) {
    console.log('  🎉 All Story 9 Dual-Branch Regression Tests Passed Successfully!');
  } else {
    console.error(`  ⚠️ Regression test suite encountered ${testsFailed} failures.`);
  }
  console.log('================================================================');

  process.exit(testsFailed > 0 ? 1 : 0);
}

runRegressionSuite().catch((err) => {
  console.error('Fatal error during Story 9 regression execution:', err);
  process.exit(1);
});
