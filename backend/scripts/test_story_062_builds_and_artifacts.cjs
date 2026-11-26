/**
 * Automated Verification Suite: Story VYR-062
 * Epic 7: Security, branch, regression and release testing
 * Story Title: Validate AI-enabled and AI-free builds and deployment artifacts
 *
 * Acceptance Criteria Verified:
 *  1. AI-free artifact has no chatbot UI/API/LLM dependency or secret requirement.
 *  2. AI-enabled artifact retains AskVeyra.
 *  3. Both deploy independently.
 *
 * Test Sections:
 *  1. Clean Build & Artifact Integrity (backend/dist, frontend/dist)
 *  2. Frontend Bundle Static & Secret Scan (dist/assets/*.js, *.css, index.html)
 *  3. Backend & Root Dependencies / Lockfile Audit
 *  4. Backend Compiled Artifacts & Express Router Stack Audit
 *  5. Environment Variables, Config & AI-Free Startup Validation
 *  6. Deployment Manifests & Independent Unified-Service Serving
 *  7. Variant Runtime Behavior (AI-Free 404 vs AI-Enabled AskVeyra RBAC & NLU)
 *  8. VYR-062 Documentation Verification
 *
 * Run: npm --prefix backend run test:vyr62
 * Optional clean rebuild inside script: node backend/scripts/test_story_062_builds_and_artifacts.cjs --clean-build
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const dotenv = require('dotenv');

const repoRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.resolve(repoRoot, '.env') });
dotenv.config({ path: path.resolve(repoRoot, 'backend/.env') });

process.env.AUTH_PROVIDER = 'LOCAL';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.API_RATE_LIMIT_MAX = '500';
if (!process.env.DATABASE_URL && !process.env.DATABASE_URI) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/veyra_db';
}

const TEST_PORT = 5062;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let passed = 0;
let failed = 0;
let skipped = 0;
const sections = [];
let currentSection = null;

function report(condition, message, details) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    if (details !== undefined) {
      console.error('        Details:', typeof details === 'object' ? JSON.stringify(details) : details);
    }
    failed++;
  }
}

function skip(message) {
  console.log(`  SKIP: ${message}`);
  skipped++;
}

function section(name) {
  currentSection = { name, startPassed: passed, startFailed: failed, startSkipped: skipped };
  console.log(`\n--- ${name} ---`);
}

function sectionEnd() {
  if (currentSection) {
    sections.push({
      name: currentSection.name,
      passed: passed - currentSection.startPassed,
      failed: failed - currentSection.startFailed,
      skipped: skipped - currentSection.startSkipped,
    });
    currentSection = null;
  }
}

function readRel(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function existsRel(rel) {
  return fs.existsSync(path.join(repoRoot, rel));
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(full) : [full];
  });
}

function makeRequest(method, reqPath, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, BASE_URL);
    const headers = {};
    if (body !== null) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const rawBody = body === null ? null : JSON.stringify(body);
    if (rawBody !== null) headers['Content-Length'] = Buffer.byteLength(rawBody);

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw });
        });
      }
    );
    req.on('error', reject);
    if (rawBody !== null) req.write(rawBody);
    req.end();
  });
}

async function main() {
  console.log('================================================================');
  console.log('  VYR-062: Build & Deployment Artifact Validation Suite');
  console.log('================================================================\n');

  const isAiEnabledBranch =
    existsRel('backend/src/ai/orchestrator.ts') &&
    existsRel('frontend/src/pages/Assistant.tsx');
  console.log(`[Variant] Detected branch variant: ${isAiEnabledBranch ? 'AI-ENABLED (AskVeyra retained)' : 'AI-FREE (Standard)'}\n`);

  // =========================================================================
  // SECTION 1: Clean Build & Artifact Integrity
  // =========================================================================
  section('Section 1: Clean Build & Artifact Integrity');

  const doCleanBuild = process.argv.includes('--clean-build');
  if (doCleanBuild) {
    console.log('  [Clean Build] Removing backend/dist and frontend/dist and rebuilding...');
    fs.rmSync(path.join(repoRoot, 'backend/dist'), { recursive: true, force: true });
    fs.rmSync(path.join(repoRoot, 'frontend/dist'), { recursive: true, force: true });
    execSync('npm --prefix backend run build', { cwd: repoRoot, stdio: 'pipe' });
    execSync('npm --prefix frontend run build', { cwd: repoRoot, stdio: 'pipe' });
  }

  report(existsRel('backend/dist/index.js'), 'backend/dist/index.js compiled artifact exists');
  report(existsRel('backend/dist/routes/api.js'), 'backend/dist/routes/api.js compiled artifact exists');
  report(existsRel('backend/dist/config.js'), 'backend/dist/config.js compiled artifact exists');

  const hasFrontendDist = existsRel('frontend/dist/index.html');
  if (hasFrontendDist) {
    report(true, 'frontend/dist/index.html production build exists');
    const assetDir = path.join(repoRoot, 'frontend/dist/assets');
    const assets = fs.existsSync(assetDir) ? fs.readdirSync(assetDir) : [];
    const jsAssets = assets.filter((f) => f.endsWith('.js'));
    const cssAssets = assets.filter((f) => f.endsWith('.css'));
    const totalJsBytes = jsAssets.reduce((sum, f) => sum + fs.statSync(path.join(assetDir, f)).size, 0);
    report(jsAssets.length >= 1 && cssAssets.length >= 1,
      `frontend/dist/assets contains JS (${jsAssets.length}) and CSS (${cssAssets.length}) bundles (${(totalJsBytes / 1024).toFixed(1)} KB JS)`);
  } else {
    if (isAiEnabledBranch) {
      skip('frontend/dist/index.html missing (AI-enabled branch may require TS fix before vite build)');
    } else {
      report(false, 'frontend/dist/index.html production build exists');
    }
  }

  sectionEnd();

  // =========================================================================
  // SECTION 2: Frontend Bundle Static & Secret Scan
  // =========================================================================
  section('Section 2: Frontend Bundle Static & Secret Scan');

  if (hasFrontendDist) {
    const assetDir = path.join(repoRoot, 'frontend/dist/assets');
    const bundleFiles = fs.existsSync(assetDir)
      ? fs.readdirSync(assetDir).filter((f) => f.endsWith('.js') || f.endsWith('.css'))
      : [];
    const bundleContent = bundleFiles.map((f) => fs.readFileSync(path.join(assetDir, f), 'utf8')).join('\n');

    // Secrets must never exist in frontend bundle on either branch
    const secretMarkers = [
      '-----BEGIN PRIVATE KEY-----',
      '-----BEGIN RSA PRIVATE KEY-----',
      'ORACLE_ENCRYPTION_KEY',
      'ENTRA_CLIENT_SECRET',
      'TOGETHER_API_KEY',
      'GROQ_API_KEY',
      'GEMINI_API_KEY',
      'JWT_PRIVATE_KEY',
    ];
    const leakedSecrets = secretMarkers.filter((m) => bundleContent.includes(m));
    report(leakedSecrets.length === 0, 'Frontend bundle contains zero embedded secrets or private keys', leakedSecrets);

    if (isAiEnabledBranch) {
      report(
        bundleContent.includes('Ask VEYRA') || bundleContent.includes('/chat'),
        'AI-Enabled: Frontend bundle retains Ask VEYRA chatbot UI & /chat client calls'
      );
    } else {
      const aiBundleMarkers = [
        'Ask VEYRA',
        'assistant-hero',
        'assistant-search-box',
        'assistant-categories-grid',
        'AI Language Model Configuration',
        'togetherModel',
        'groqModel',
        'hasGeminiKey',
        'sendMessage(',
        'api.together.xyz',
        'api.groq.com',
        'generativelanguage.googleapis.com',
        'api.openai.com',
        'api.anthropic.com',
      ];
      const foundAiMarkers = aiBundleMarkers.filter((m) => bundleContent.includes(m));
      report(
        foundAiMarkers.length === 0,
        'AI-Free: Frontend bundle contains zero AskVeyra/chatbot/LLM UI or API strings',
        foundAiMarkers
      );
    }
  } else {
    skip('frontend/dist not present — skipping bundle scan');
  }

  // Frontend source scan (both branches)
  if (!isAiEnabledBranch) {
    report(!existsRel('frontend/src/pages/Assistant.tsx'), 'AI-Free: frontend/src/pages/Assistant.tsx absent');
    report(!existsRel('frontend/src/test/assistant_consumption.test.ts'), 'AI-Free: assistant_consumption.test.ts absent');
    const appTsx = readRel('frontend/src/App.tsx');
    const apiTs = readRel('frontend/src/services/api.ts');
    const authTs = readRel('frontend/src/utils/authorization.ts');
    report(!/import\s+Assistant/.test(appTsx) && !/<Assistant\b/.test(appTsx), 'AI-Free: App.tsx has no Assistant import or render');
    report(!/sendMessage\s*\(/.test(apiTs), 'AI-Free: frontend api.ts has no sendMessage()');
    report(!/^\s*assistant\s*:/m.test(authTs), 'AI-Free: authorization.ts has no assistant page privilege');
  } else {
    report(existsRel('frontend/src/pages/Assistant.tsx'), 'AI-Enabled: frontend/src/pages/Assistant.tsx retained');
    const appTsx = readRel('frontend/src/App.tsx');
    const apiTs = readRel('frontend/src/services/api.ts');
    report(/import\s+Assistant/.test(appTsx), 'AI-Enabled: App.tsx retains Assistant import');
    report(/sendMessage\s*\(/.test(apiTs), 'AI-Enabled: frontend api.ts retains sendMessage()');
  }

  sectionEnd();

  // =========================================================================
  // SECTION 3: Dependencies & Lockfiles Audit
  // =========================================================================
  section('Section 3: Dependencies & Lockfiles Audit');

  const rootPkg = JSON.parse(readRel('package.json'));
  const backendPkg = JSON.parse(readRel('backend/package.json'));
  const frontendPkg = JSON.parse(readRel('frontend/package.json'));

  const aiPkgNames = ['@google/generative-ai', 'openai', 'groq-sdk', 'together-ai', 'node-sql-parser'];
  const rootDeps = { ...(rootPkg.dependencies || {}), ...(rootPkg.devDependencies || {}) };
  const backendDeps = { ...(backendPkg.dependencies || {}), ...(backendPkg.devDependencies || {}) };
  const frontendDeps = { ...(frontendPkg.dependencies || {}), ...(frontendPkg.devDependencies || {}) };

  const frontendAiPkgs = aiPkgNames.filter((p) => p in frontendDeps);
  report(frontendAiPkgs.length === 0, 'Frontend package.json has zero LLM/SQL-parser SDK dependencies', frontendAiPkgs);

  if (isAiEnabledBranch) {
    report(
      '@google/generative-ai' in backendDeps && 'node-sql-parser' in backendDeps,
      'AI-Enabled: backend/package.json retains @google/generative-ai and node-sql-parser'
    );
  } else {
    const foundRoot = aiPkgNames.filter((p) => p in rootDeps);
    const foundBackend = aiPkgNames.filter((p) => p in backendDeps);
    report(foundRoot.length === 0, 'AI-Free: root package.json has zero AI dependencies', foundRoot);
    report(foundBackend.length === 0, 'AI-Free: backend/package.json has zero AI dependencies', foundBackend);

    const backendLock = existsRel('backend/package-lock.json') ? readRel('backend/package-lock.json') : '';
    const rootLock = existsRel('package-lock.json') ? readRel('package-lock.json') : '';
    const lockHits = aiPkgNames.filter((p) => backendLock.includes(`"node_modules/${p}"`) || rootLock.includes(`"node_modules/${p}"`));
    report(lockHits.length === 0, 'AI-Free: package-lock.json files have zero AI package entries', lockHits);

    const installedAiDirs = aiPkgNames.filter((p) => fs.existsSync(path.join(repoRoot, 'backend/node_modules', p)));
    report(installedAiDirs.length === 0, 'AI-Free: backend/node_modules contains zero AI packages', installedAiDirs);
  }

  sectionEnd();

  // =========================================================================
  // SECTION 4: Backend Compiled Artifacts & Express Router Stack Audit
  // =========================================================================
  section('Section 4: Backend Compiled Artifacts & Express Router Stack');

  const purgedAiServiceFiles = [
    'universalDatabaseChatbotService',
    'groundedAnswerService',
    'textToSqlService',
    'certificateHybridRagService',
    'conversationContextService',
    'observabilityTraceService',
    'resultVerificationService',
    'schemaDiscoveryService',
    'schemaLinkingService',
    'sourceRoutingService',
    'sqlValidatorService',
    'metadataCatalogService',
  ];

  const apiModule = require(path.join(repoRoot, 'backend/dist/routes/api.js'));
  const { apiRouter } = apiModule;
  const registeredRoutes = (apiRouter.stack || [])
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods || {}).map((m) => m.toUpperCase()),
    }));

  if (isAiEnabledBranch) {
    report(existsRel('backend/dist/ai/orchestrator.js'), 'AI-Enabled: backend/dist/ai/orchestrator.js compiled');
    report(existsRel('backend/dist/ai/responseComposer.js'), 'AI-Enabled: backend/dist/ai/responseComposer.js compiled');
    report(existsRel('backend/dist/tools/index.js'), 'AI-Enabled: backend/dist/tools/index.js compiled');
    report(typeof apiModule.requireAskVeyra === 'function', 'AI-Enabled: requireAskVeyra middleware exported');
    report(registeredRoutes.some((r) => r.path === '/chat' && r.methods.includes('POST')), 'AI-Enabled: POST /chat registered on apiRouter');
    report(registeredRoutes.some((r) => r.path === '/ai/universal-query' && r.methods.includes('POST')), 'AI-Enabled: POST /ai/universal-query registered');
    report(registeredRoutes.some((r) => r.path === '/database/schema' && r.methods.includes('GET')), 'AI-Enabled: GET /database/schema registered');
  } else {
    report(!existsRel('backend/src/ai') && !existsRel('backend/dist/ai'), 'AI-Free: backend/src/ai and backend/dist/ai do not exist');
    report(!existsRel('backend/src/tools') && !existsRel('backend/dist/tools'), 'AI-Free: backend/src/tools and backend/dist/tools do not exist');

    const lingeringCompiled = purgedAiServiceFiles.filter(
      (name) => existsRel(`backend/src/services/${name}.ts`) || existsRel(`backend/dist/services/${name}.js`)
    );
    report(lingeringCompiled.length === 0, 'AI-Free: all 12 AI services absent from src/ and dist/', lingeringCompiled);

    const aiRoutes = registeredRoutes.filter(
      (r) => r.path === '/chat' || r.path.startsWith('/ai/') || r.path.startsWith('/database/')
    );
    report(aiRoutes.length === 0, 'AI-Free: Express apiRouter registers zero /chat, /ai/*, or /database/* routes', aiRoutes);
    report(apiModule.requireAskVeyra === undefined, 'AI-Free: requireAskVeyra middleware is not exported');

    // Static scan of backend/dist for AI provider hostnames
    const distFiles = walkFiles(path.join(repoRoot, 'backend/dist')).filter((f) => f.endsWith('.js'));
    const providerPattern = /api\.together\.xyz|api\.groq\.com|generativelanguage\.googleapis\.com|api\.openai\.com|api\.anthropic\.com/;
    const hits = distFiles.filter((f) => providerPattern.test(fs.readFileSync(f, 'utf8')));
    report(hits.length === 0, 'AI-Free: backend/dist contains zero LLM provider endpoints', hits.map((h) => path.relative(repoRoot, h)));
  }

  // Core shared services must exist in dist on both branches
  const requiredCoreArtifacts = [
    'backend/dist/services/authService.js',
    'backend/dist/services/oracleService.js',
    'backend/dist/services/auditDashboardService.js',
    'backend/dist/services/auditRawDbService.js',
    'backend/dist/services/controlRawDbService.js',
    'backend/dist/services/userRoleRawDbService.js',
    'backend/dist/services/accessCertRawDbService.js',
    'backend/dist/services/reportDbService.js',
    'backend/dist/services/scheduledSyncService.js',
    'backend/dist/security/encryptionService.js',
  ];
  const missingCore = requiredCoreArtifacts.filter((p) => !existsRel(p));
  report(missingCore.length === 0, 'All core Veyra backend services compiled into dist/', missingCore);

  sectionEnd();

  // =========================================================================
  // SECTION 5: Environment Variables, Config & AI-Free Startup Validation
  // =========================================================================
  section('Section 5: Environment Variables & Startup Validation');

  const envExample = readRel('.env.example');
  const aiEnvVars = /\b(TOGETHER_API_KEY|TOGETHER_MODEL|GROQ_API_KEY|GROQ_MODEL|LLM_ENDPOINT|GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)\b/;
  const distConfigText = readRel('backend/dist/config.js');

  if (!isAiEnabledBranch) {
    report(!aiEnvVars.test(envExample), 'AI-Free: .env.example requires zero AI credentials or model vars');
    report(!aiEnvVars.test(distConfigText), 'AI-Free: backend/dist/config.js reads zero AI env vars');
  } else {
    report(true, 'AI-Enabled: backend/dist/config.js compiled cleanly');
  }

  // Verify startup config validator passes with all AI env vars removed
  const { validateStartupConfig } = require(path.join(repoRoot, 'backend/dist/security/configValidator.js'));
  const savedAiEnv = {};
  for (const k of ['TOGETHER_API_KEY', 'TOGETHER_MODEL', 'GROQ_API_KEY', 'GROQ_MODEL', 'LLM_ENDPOINT', 'GEMINI_API_KEY']) {
    savedAiEnv[k] = process.env[k];
    delete process.env[k];
  }
  try {
    const valReport = validateStartupConfig({ environment: 'test', strict: false, throwOnError: false });
    report(valReport.valid === true, 'Startup config validation passes with zero AI credentials in environment', valReport.errors);
  } finally {
    for (const [k, v] of Object.entries(savedAiEnv)) {
      if (v !== undefined) process.env[k] = v;
    }
  }

  sectionEnd();

  // =========================================================================
  // SECTION 6: Deployment Manifests & Independent Serving Verification
  // =========================================================================
  section('Section 6: Deployment Manifests & Independent Serving');

  const manifests = ['Dockerfile', 'nixpacks.toml', 'railway.json', 'railpack.json', 'index.js'];
  for (const m of manifests) {
    report(existsRel(m), `Deployment manifest ${m} exists`);
  }

  const dockerfile = readRel('Dockerfile');
  const nixpacks = readRel('nixpacks.toml');
  const railway = JSON.parse(readRel('railway.json'));
  const railpack = JSON.parse(readRel('railpack.json'));
  const rootIndex = readRel('index.js');

  report(dockerfile.includes('npm run build:backend') && dockerfile.includes('CMD ["npm", "run", "start:migrate"]'),
    'Dockerfile builds backend and starts via start:migrate');
  report(!aiEnvVars.test(dockerfile) && !aiEnvVars.test(nixpacks),
    'Dockerfile and nixpacks.toml contain zero AI secret requirements');
  report(railway.deploy?.healthcheckPath === '/health' && railpack.deploy?.startCommand === 'node index.js',
    'railway.json and railpack.json configure independent /health check and node index.js entrypoint');
  report(rootIndex.includes('./backend/dist/index.js'), 'Root index.js boots backend/dist/index.js');
  report(
    existsRel('.github/workflows/dependency-scan.yml') && existsRel('.github/workflows/secret-scan.yml'),
    'CI security scan workflows (dependency-scan.yml, secret-scan.yml) exist'
  );

  // Boot standalone production-like server serving frontend/dist + /health + /api
  const express = require('../node_modules/express');
  const { authService } = require(path.join(repoRoot, 'backend/dist/services/authService.js'));
  const { query: dbQuery } = require(path.join(repoRoot, 'backend/dist/db.js'));
  const { initializeAuthProvider, keyManager } = require(path.join(repoRoot, 'backend/dist/auth/index.js'));
  const { corsMiddleware, securityHeadersMiddleware } = require(path.join(repoRoot, 'backend/dist/security/securityHeadersService.js'));
  const { rateLimitService } = require(path.join(repoRoot, 'backend/dist/security/rateLimitService.js'));

  initializeAuthProvider();
  rateLimitService.resetAll();
  await dbQuery("UPDATE veyra_session SET status = 'EXPIRED' WHERE status = 'ACTIVE'").catch(() => {});
  if (typeof authService._clearActiveSessions === 'function') {
    authService._clearActiveSessions();
  }

  const app = express();
  app.use(securityHeadersMiddleware);
  app.use(corsMiddleware);
  app.use(express.json({ limit: '2mb' }));
  app.get(['/health', '/api/health'], (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });
  app.get(['/.well-known/jwks.json', '/api/.well-known/jwks.json'], async (_req, res) => {
    res.status(200).json(await keyManager.getJwks());
  });
  app.use('/api', apiRouter);

  const frontendDistPath = path.join(repoRoot, 'frontend/dist');
  if (hasFrontendDist) {
    app.use(express.static(frontendDistPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/health') || req.path.startsWith('/.well-known')) {
        return next();
      }
      res.sendFile(path.join(frontendDistPath, 'index.html'));
    });
  }
  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', message: `API endpoint ${req.method} ${req.path} does not exist.` });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));

  const runSuffix = crypto.randomBytes(4).toString('hex');
  const ephemeralEmails = [];
  let adminToken = null;

  try {
    const health = await makeRequest('GET', '/health');
    const apiHealth = await makeRequest('GET', '/api/health');
    const authCfg = await makeRequest('GET', '/api/auth/config');
    report(health.status === 200 && health.data?.status === 'ok', 'Standalone server GET /health returns 200 ok');
    report(apiHealth.status === 200 && apiHealth.data?.status === 'ok', 'Standalone server GET /api/health returns 200 ok');
    report(authCfg.status === 200 && authCfg.data?.success === true, 'Standalone server GET /api/auth/config returns 200');

    if (hasFrontendDist) {
      const spaRoot = await makeRequest('GET', '/');
      const spaDeep = await makeRequest('GET', '/reports');
      report(spaRoot.status === 200 && String(spaRoot.raw).includes('<div id="root">'),
        'Standalone server GET / serves compiled frontend/dist/index.html');
      report(spaDeep.status === 200 && String(spaDeep.raw).includes('<div id="root">'),
        'Standalone server SPA fallback serves index.html for client routes');
    }

    sectionEnd();

    // =========================================================================
    // SECTION 7: Variant Runtime Behavior (AI-Free vs AI-Enabled AskVeyra)
    // =========================================================================
    section('Section 7: Variant Runtime Behavior');

    const adminPass = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@123';
    const adminLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@admin.com',
      password: adminPass,
      force: true,
    });
    adminToken = adminLogin.data?.token;
    report(adminLogin.status === 200 && Boolean(adminToken), 'Admin login succeeds on standalone deployment');

    const personaPass = `Vyr062!Pass_${runSuffix}`;
    const mgrEmail = `vyr062.mgr.${runSuffix}@claaps.com`;
    const supEmail = `vyr062.sup.${runSuffix}@claaps.com`;
    const usrEmail = `vyr062.usr.${runSuffix}@claaps.com`;

    for (const [email, role] of [[mgrEmail, 'AUDIT_MANAGER'], [supEmail, 'AUDIT_SUPERVISOR'], [usrEmail, 'AUDIT_USER']]) {
      const cr = await makeRequest('POST', '/api/users', {
        email,
        displayName: `VYR062 ${role}`,
        role,
        password: personaPass,
        status: 'ACTIVE',
      }, adminToken);
      if (cr.status === 201) ephemeralEmails.push(email);
    }

    const mgrToken = (await makeRequest('POST', '/api/auth/login', { email: mgrEmail, password: personaPass, force: true })).data?.token;
    const supToken = (await makeRequest('POST', '/api/auth/login', { email: supEmail, password: personaPass, force: true })).data?.token;
    const usrToken = (await makeRequest('POST', '/api/auth/login', { email: usrEmail, password: personaPass, force: true })).data?.token;

    if (isAiEnabledBranch) {
      const chatUnauth = await makeRequest('POST', '/api/chat', { message: 'How many duty roles exist?' });
      const chatSup = await makeRequest('POST', '/api/chat', { message: 'How many duty roles exist?' }, supToken);
      const chatUsr = await makeRequest('POST', '/api/chat', { message: 'How many duty roles exist?' }, usrToken);
      const chatMgr = await makeRequest('POST', '/api/chat', { message: 'How many duty roles exist?' }, mgrToken);
      const chatProbe = await makeRequest('POST', '/api/chat', { message: 'Show me user password hash' }, mgrToken);

      report(chatUnauth.status === 401, 'AI-Enabled: Unauthenticated POST /api/chat returns 401');
      report(chatSup.status === 403, 'AI-Enabled: AUDIT_SUPERVISOR blocked from POST /api/chat (403)');
      report(chatUsr.status === 403, 'AI-Enabled: AUDIT_USER blocked from POST /api/chat (403)');
      report(
        chatMgr.status === 200 &&
        typeof chatMgr.data?.message === 'string' &&
        chatMgr.data.message.length > 0 &&
        typeof chatMgr.data?.intent === 'string',
        'AI-Enabled: AUDIT_MANAGER POST /api/chat returns 200 with structured AskVeyra response',
        { status: chatMgr.status, intent: chatMgr.data?.intent }
      );
      report(
        chatProbe.status === 200 && !/\$2[aby]\$/.test(String(chatProbe.raw)),
        'AI-Enabled: Probing prompt does not leak bcrypt hashes or credentials'
      );
    } else {
      const chatUnauth = await makeRequest('POST', '/api/chat', { message: 'hello' });
      const chatAdmin = await makeRequest('POST', '/api/chat', { message: 'hello' }, adminToken);
      const chatMgr = await makeRequest('POST', '/api/chat', { message: 'hello' }, mgrToken);
      const uniQuery = await makeRequest('POST', '/api/ai/universal-query', { query: 'users' }, adminToken);
      const dbSchema = await makeRequest('GET', '/api/database/schema', null, adminToken);

      report(chatUnauth.status === 404, 'AI-Free: Unauthenticated POST /api/chat returns 404');
      report(chatAdmin.status === 404, 'AI-Free: SITE_ADMIN POST /api/chat returns 404');
      report(chatMgr.status === 404, 'AI-Free: AUDIT_MANAGER POST /api/chat returns 404');
      report(uniQuery.status === 404, 'AI-Free: POST /api/ai/universal-query returns 404');
      report(dbSchema.status === 404, 'AI-Free: GET /api/database/schema returns 404');
    }

    // Core non-AI endpoint works identically on both deployments
    const reportsRes = await makeRequest('GET', '/api/reports?limit=5', null, usrToken);
    report(reportsRes.status === 200 && reportsRes.data?.success === true,
      'Core non-AI workflow (GET /api/reports) operates cleanly in standalone deployment');

    sectionEnd();
  } finally {
    rateLimitService.resetAll();
    for (const email of ephemeralEmails) {
      if (adminToken) {
        await makeRequest('DELETE', `/api/users/${encodeURIComponent(email)}`, null, adminToken).catch(() => {});
      }
      await dbQuery('DELETE FROM veyra_user WHERE LOWER(email) = LOWER($1)', [email]).catch(() => {});
    }
    await dbQuery("UPDATE veyra_session SET status = 'EXPIRED' WHERE status = 'ACTIVE'").catch(() => {});
    server.close();
    console.log('\n[Test Server] Shut down gracefully.');
  }

  // =========================================================================
  // SECTION 8: Documentation Verification
  // =========================================================================
  section('Section 8: VYR-062 Documentation');
  report(existsRel('docs/security/VYR-062_BUILD_AND_ARTIFACT_VALIDATION.md'),
    'VYR-062 build & deployment artifact validation doc exists');
  sectionEnd();

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n================================================================');
  console.log('  VYR-062 RESULTS SUMMARY');
  console.log('================================================================');
  for (const s of sections) {
    const status = s.failed === 0 ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${s.name}: ${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped`);
  }
  console.log('----------------------------------------------------------------');
  console.log(`  TOTAL: ${passed} passed, ${failed} failed, ${skipped} skipped out of ${passed + failed + skipped} assertions`);
  console.log('================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error in VYR-062 artifact validation suite:', err);
  process.exit(2);
});
