import { RequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// VYR-050: CORS, CSP, HSTS and HTTP security headers
// ---------------------------------------------------------------------------

/**
 * Resolves the set of allowed origins for CORS.
 *
 * Production: only explicitly listed origins via ALLOWED_ORIGINS env var.
 * Development: localhost on common dev ports (Vite 5173, backend 5000).
 */
function resolveAllowedOrigins(): string[] {
  const envOrigins = (process.env.ALLOWED_ORIGINS || '').trim();
  if (envOrigins) {
    return envOrigins
      .split(',')
      .map(o => o.trim())
      .filter(Boolean);
  }

  if (config.nodeEnv === 'production') {
    const frontendUrl = (process.env.FRONTEND_URL || '').trim();
    if (frontendUrl) return [frontendUrl];
    return [];
  }

  return [
    'http://localhost:5173',
    'http://localhost:5000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5000',
  ];
}

const allowedOrigins = resolveAllowedOrigins();

/**
 * Strict CORS middleware: only approved origins can call credentialed APIs.
 * In production with no configured origins, same-origin requests only.
 */
export const corsMiddleware: RequestHandler = cors({
  origin: (origin, callback) => {
    // Allow server-to-server requests (no Origin header) and same-origin
    if (!origin) return callback(null, true);

    if (allowedOrigins.length === 0) {
      // Production with no ALLOWED_ORIGINS: same-origin only
      return callback(null, false);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, origin);
    }

    callback(new Error(`Origin ${origin} not allowed by CORS policy`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Encoding', 'Content-Length'],
  maxAge: 600,
});

const isProduction = config.nodeEnv === 'production';

/**
 * Helmet-based security headers with a strict Content-Security-Policy.
 *
 * CSP directives are tuned to what the Veyra SPA actually requires:
 * - Scripts/styles from self only (inline styles allowed for component libs)
 * - Connect back to self (API) and to the Oracle Fusion host
 * - Fonts from Google Fonts CDN
 * - Images from self and data: URIs (chart/avatar inlining)
 * - No iframing by third parties
 */
export const securityHeadersMiddleware: RequestHandler = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: [
        "'self'",
        ...(process.env.FUSION_HOST
          ? [`https://${process.env.FUSION_HOST.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`]
          : []),
      ],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  },
  // HSTS: 1 year, includeSubDomains, preload-ready — only in production over HTTPS
  strictTransportSecurity: isProduction
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  // Prevent MIME-type sniffing
  xContentTypeOptions: true,
  // Block framing entirely (defense-in-depth alongside CSP frame-ancestors)
  frameguard: { action: 'deny' },
  // Referrer: send origin only on cross-origin, full on same-origin
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Disable browser DNS prefetching to prevent privacy leaks
  dnsPrefetchControl: { allow: false },
  // Remove X-Powered-By header
  xPoweredBy: false,
  // Prevent IE from opening downloads in the site's context
  ieNoOpen: true,
  // XSS filter — legacy but still useful for older browsers
  xXssProtection: true,
}) as unknown as RequestHandler;

/**
 * Returns the currently resolved allowed origins (useful for diagnostics/tests).
 */
export function getAllowedOrigins(): string[] {
  return [...allowedOrigins];
}
