import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, validateConfig, loadPersistedConfig } from './config.js';
import { oracleService } from './services/oracleService.js';
import { rolePrivilegeCatalogService } from './services/rolePrivilegeCatalogService.js';
import { privilegeRoleCatalogService } from './services/privilegeRoleCatalogService.js';
import { apiRouter } from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middlewares
app.use(cors());
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

// API Routes
app.use('/api', apiRouter);

// Serve Frontend static assets in Production
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

// Fallback index.html for Single Page Application routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(frontendDistPath, 'index.html'), (err) => {
    if (err) {
      // In development, if dist is not compiled, show a simple helper landing page or let Vite handle it
      res.status(200).send(`
        <html>
          <head>
            <title>Oracle Fusion Security Assistant API</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f3f4f6; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              div { text-align: center; border: 1px solid #1e293b; padding: 2rem; border-radius: 12px; background: #111827; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
              h1 { color: #f59e0b; margin-top: 0; }
              p { color: #9ca3af; }
              code { background: #1f2937; padding: 0.2rem 0.4rem; border-radius: 4px; color: #a7f3d0; font-family: monospace; }
            </style>
          </head>
          <body>
            <div>
              <h1>Oracle Fusion Security Assistant</h1>
              <p>Express API Server is running successfully on port <code>${config.port}</code>.</p>
              <p>Frontend is running in Development mode or has not been compiled yet.</p>
              <p>Access the API endpoints directly at <code>/api/users</code> or <code>/api/settings</code>.</p>
            </div>
          </body>
        </html>
      `);
    }
  });
});

// Start Server
loadPersistedConfig();
oracleService.recreateClient();
validateConfig();
rolePrivilegeCatalogService.initialize(oracleService);
privilegeRoleCatalogService.initialize();
app.listen(config.port, () => {
  console.log(`===========================================================`);
  console.log(`  Oracle Fusion Security & Risk Intelligence Assistant`);
  console.log(`  Server is listening on port: http://localhost:${config.port}`);
  console.log(`  Environment Mode: ${config.environmentMode}`);
  console.log(`===========================================================`);
});
