import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded from backend, database, or workspace root
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../database/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function normalizeConnectionString(rawUrl?: string): string {
  if (!rawUrl) return '';
  // Fix Render short hostname when DNS cannot resolve across regions or without region suffix
  // e.g. @dpg-dbcpkhqvcj2c73fes340-a:5432/ or @dpg-dbcpkhqvcj2c73fes340-a/
  return rawUrl.replace(/@(dpg-[a-z0-9]+-[a-z0-9]+)(:\d+|\/|$)/i, (match, host, suffix) => {
    if (!host.includes('.')) {
      return `@${host}.singapore-postgres.render.com${suffix}`;
    }
    return match;
  });
}

const rawConnectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || '127.0.0.1'}:${process.env.POSTGRES_PORT || '5433'}/${process.env.POSTGRES_DB || 'veyra_db'}`;

const connectionString = normalizeConnectionString(rawConnectionString);

const isRemoteDb = Boolean(
  connectionString &&
  !connectionString.includes('127.0.0.1') &&
  !connectionString.includes('localhost')
);

export const pool = new pg.Pool({
  connectionString,
  max: isRemoteDb ? 4 : 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: isRemoteDb || process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  console.error('[PostgreSQL Pool Error]:', err.message);
});

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[],
  retries = 2
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await pool.query<T>(text, params);
      return res;
    } catch (err: any) {
      const isConnectionError =
        err.message?.includes('ECONNREFUSED') ||
        err.message?.includes('ECONNRESET') ||
        err.message?.includes('Connection terminated') ||
        err.message?.includes('timeout');

      if (isConnectionError && attempt < retries) {
        console.warn(`[PostgreSQL Transient Notice] Retrying query due to connection blip (attempt ${attempt + 1}/${retries})...`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      const duration = Date.now() - start;
      console.error('[PostgreSQL Query Error]', {
        text,
        duration,
        error: err.message,
      });
      throw err;
    }
  }
  throw new Error('PostgreSQL query failed after retries');
}
