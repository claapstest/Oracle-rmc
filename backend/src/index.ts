import express from 'express';
import cors from 'cors';
import zlib from 'zlib';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config, validateConfig, loadPersistedConfig } from './config.js';
import { oracleService } from './services/oracleService.js';
import { rolePrivilegeCatalogService } from './services/rolePrivilegeCatalogService.js';
import { privilegeRoleCatalogService } from './services/privilegeRoleCatalogService.js';
import { controlRawDbService } from './services/controlRawDbService.js';
import { auditRawDbService } from './services/auditRawDbService.js';
import { auditProductCatalogService } from './services/auditProductCatalogService.js';
import { scheduledSyncService } from './services/scheduledSyncService.js';
import { roleHierarchyService } from './services/roleHierarchyService.js';
import { userAccessReportService } from './services/userAccessReportService.js';
import { apiRouter } from './routes/api.js';
import { initializeAuthProvider, keyManager } from './auth/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middlewares
app.use(cors({
  origin: true,
  credentials: true
}));
// Compress large JSON payloads (>= 2KB) with gzip when client supports it
app.use((req, res, next) => {
  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  if (!acceptEncoding.includes('gzip')) {
    return next();
  }
  const origJson = res.json.bind(res);
  res.json = (body: any) => {
    try {
      const jsonStr = JSON.stringify(body);
      if (Buffer.byteLength(jsonStr, 'utf8') < 2048) {
        return origJson(body);
      }
      zlib.gzip(jsonStr, (err, compressed) => {
        if (res.headersSent) return;
        if (err) {
          origJson(body);
          return;
        }
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', String(compressed.length));
        res.end(compressed);
      });
      return res;
    } catch {
      return origJson(body);
    }
  };
  next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Logger middleware
app.use((req, res, next) => {
  // Never log passwords, tokens, or credentials
  const bodyCopy = { ...req.body };
  if (bodyCopy.password) bodyCopy.password = '******';
  if (bodyCopy.token) bodyCopy.token = '******';
  if (bodyCopy.payload && typeof bodyCopy.payload === 'object') {
    bodyCopy.payload = '[Investigation Payload Object]';
  }
  
  let bodyStr = '';
  if (req.method !== 'GET') {
    try {
      bodyStr = JSON.stringify(bodyCopy);
      if (bodyStr.length > 300) {
        bodyStr = bodyStr.substring(0, 300) + '... (truncated)';
      }
    } catch (_) {
      bodyStr = '[Unserializable body]';
    }
  }

  console.log(`[API Log] ${new Date().toISOString()} - ${req.method} ${req.path}`, bodyStr);
  next();
});

// Healthcheck endpoint for cloud platforms (Render, Railway, AWS)
app.get(['/health', '/api/health'], (_req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// RFC 7517 JSON Web Key Set endpoint (VYR-020)
app.get(['/.well-known/jwks.json', '/api/.well-known/jwks.json'], async (_req, res) => {
  try {
    const jwks = await keyManager.getJwks();
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(jwks);
  } catch (err: any) {
    console.error('[JWKS Error]:', err);
    res.status(500).json({ error: 'Failed to retrieve JWKS' });
  }
});

// API Routes
app.use('/api', apiRouter);

// Check if frontend build exists for unified Single Web Service deployment
const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
const hasFrontendBuild = fs.existsSync(frontendDistPath) && fs.existsSync(path.join(frontendDistPath, 'index.html'));

if (hasFrontendBuild) {
  console.log(`[Static Serving] Serving production frontend build from: ${frontendDistPath}`);
  app.use(express.static(frontendDistPath));
  // Single Page Application (SPA) catch-all fallback for client-side routing
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/health') || req.path.startsWith('/.well-known')) {
      return next();
    }
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
} else {
  // Standalone API Mode: Root Service Status
  app.get('/', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'Oracle Fusion Security & Risk Intelligence Assistant API',
      version: '1.0.0',
      mode: config.environmentMode,
      endpoints: {
        health: '/health',
        apiDocs: '/api',
        authStatus: '/api/auth/status',
        users: '/api/users'
      }
    });
  });

  // 404 handler for unknown routes in API mode
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `API endpoint ${req.method} ${req.path} does not exist.`
    });
  });
}

// Start Server
loadPersistedConfig();
oracleService.recreateClient();
validateConfig();
const authProvider = initializeAuthProvider();
rolePrivilegeCatalogService.initialize(oracleService);
privilegeRoleCatalogService.initialize();
app.listen(config.port, '0.0.0.0', () => {
  console.log(`===========================================================`);
  console.log(`  Oracle Fusion Security & Risk Intelligence Assistant`);
  console.log(`  Server is listening on port: http://localhost:${config.port}`);
  console.log(`  Environment Mode: ${config.environmentMode}`);
  console.log(`  Auth Provider:    ${authProvider.getMetadata().name} (${authProvider.getMetadata().type})`);
  console.log(`===========================================================`);
  // Scheduled Off-Peak Sync: Syncs full Oracle baseline data daily at 11:00 PM during non-working hours.
  // Sync is NEVER triggered on user login or by multiple concurrent users.
  scheduledSyncService.initialize(oracleService, 23);

  // Non-blocking background warm-up of heavy PostgreSQL report caches on boot
  setTimeout(() => {
    controlRawDbService.ensureIncidentRowsInitialized().catch(() => {});
    userAccessReportService.getUserAccessReport().catch(() => {});
    roleHierarchyService.getHierarchyReport({ compact: true }).catch(() => {});
  }, 500);
});
