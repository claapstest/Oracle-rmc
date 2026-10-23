import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, validateConfig, loadPersistedConfig } from './config.js';
import { oracleService } from './services/oracleService.js';
import { rolePrivilegeCatalogService } from './services/rolePrivilegeCatalogService.js';
import { privilegeRoleCatalogService } from './services/privilegeRoleCatalogService.js';
import { controlRawDbService } from './services/controlRawDbService.js';
import { auditRawDbService } from './services/auditRawDbService.js';
import { auditProductCatalogService } from './services/auditProductCatalogService.js';
import { scheduledSyncService } from './services/scheduledSyncService.js';
import { apiRouter } from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middlewares
app.use(cors({
  origin: true,
  credentials: true
}));
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

// API Routes
app.use('/api', apiRouter);

// Root Service Status
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

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `API endpoint ${req.method} ${req.path} does not exist.`
  });
});

// Start Server
loadPersistedConfig();
oracleService.recreateClient();
validateConfig();
rolePrivilegeCatalogService.initialize(oracleService);
privilegeRoleCatalogService.initialize();
app.listen(config.port, '0.0.0.0', () => {
  console.log(`===========================================================`);
  console.log(`  Oracle Fusion Security & Risk Intelligence Assistant`);
  console.log(`  Server is listening on port: http://localhost:${config.port}`);
  console.log(`  Environment Mode: ${config.environmentMode}`);
  console.log(`===========================================================`);
  // Scheduled Off-Peak Sync: Syncs full Oracle baseline data daily at 11:00 PM during non-working hours.
  // Sync is NEVER triggered on user login or by multiple concurrent users.
  scheduledSyncService.initialize(oracleService, 23);
});
