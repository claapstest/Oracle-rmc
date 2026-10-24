import { query, pool } from '../db.js';
import { oracleService } from './oracleService.js';

export interface ExecutedQueryResult {
  success: boolean;
  rows: any[];
  rowCount: number;
  columns: string[];
  executionTimeMs: number;
  databaseSource: 'PostgreSQL Database' | 'Oracle Cloud Fusion' | 'Hybrid Reconciled';
  sourceOfTruth: string;
  isCached: boolean;
  lastSyncedAt?: string;
  error?: string;
}

export class SourceRoutingService {
  /**
   * Executes a validated SQL query against PostgreSQL with statement timeout and read-only enforcement.
   */
  public async executeValidatedQuery(
    sql: string,
    params: any[] = [],
    options: { timeoutMs?: number; targetEntity?: string } = {}
  ): Promise<ExecutedQueryResult> {
    const start = Date.now();
    const timeoutMs = options.timeoutMs || 5000;

    let client: any = null;
    try {
      client = await pool.connect();

      // Begin read-only transaction with strict statement timeout
      await client.query(`BEGIN TRANSACTION READ ONLY;`);
      await client.query(`SET LOCAL statement_timeout = ${timeoutMs};`);

      const res = await client.query(sql, params);
      await client.query(`COMMIT;`);

      const executionTimeMs = Date.now() - start;
      const rows = res.rows || [];
      const columns = res.fields ? res.fields.map((f: any) => f.name) : (rows[0] ? Object.keys(rows[0]) : []);

      // Determine authoritative source based on entity
      let databaseSource: ExecutedQueryResult['databaseSource'] = 'PostgreSQL Database';
      let sourceOfTruth = 'PostgreSQL Authoritative Repository';

      if (options.targetEntity === 'certifications') {
        databaseSource = 'Hybrid Reconciled';
        sourceOfTruth = 'Oracle Cloud Fusion (Assignments) / PostgreSQL (Metrics)';
      } else if (oracleService.isConfigured() && configIsLive(options.targetEntity)) {
        databaseSource = 'PostgreSQL Database';
        sourceOfTruth = 'Synchronized Oracle Cloud Repository';
      }

      return {
        success: true,
        rows,
        rowCount: rows.length,
        columns,
        executionTimeMs,
        databaseSource,
        sourceOfTruth,
        isCached: true
      };
    } catch (err: any) {
      if (client) {
        try {
          await client.query(`ROLLBACK;`);
        } catch (_) {}
      }

      return {
        success: false,
        rows: [],
        rowCount: 0,
        columns: [],
        executionTimeMs: Date.now() - start,
        databaseSource: 'PostgreSQL Database',
        sourceOfTruth: 'PostgreSQL',
        isCached: false,
        error: err.message || 'Database query execution failed'
      };
    } finally {
      if (client) {
        client.release();
      }
    }
  }
}

function configIsLive(targetEntity?: string): boolean {
  return targetEntity === 'roles' || targetEntity === 'users' || targetEntity === 'audits';
}

export const sourceRoutingService = new SourceRoutingService();
