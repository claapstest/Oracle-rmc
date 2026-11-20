import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { OracleFusionClient } from '../oracle/client.js';
import { config } from '../config.js';
import { query } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.resolve(__dirname, '../../cache/risk-summary');

export interface CachedCountEntry {
  controlId: string;
  count: number | null;
  updatedAt: string;
  status: 'READY' | 'CALCULATING' | 'ERROR';
  error?: string;
  assigned?: number;
  accepted?: number;
  remediate?: number;
  resolved?: number;
}

export type IncidentCountCache = Record<string, CachedCountEntry>;

export class IncidentCountCacheService {
  private client: OracleFusionClient;
  private memoryCache: Map<string, CachedCountEntry> = new Map();
  private inFlightFetches: Map<string, Promise<CachedCountEntry>> = new Map();
  private isSyncingQueue = false;
  private queue: string[] = [];

  constructor(client: OracleFusionClient) {
    this.client = client;
    this.ensureCacheDir();
    this.loadFromDisk();
    this.loadFromDb().catch(() => { });
  }

  public recreateClient(client: OracleFusionClient) {
    this.client = client;
    this.inFlightFetches.clear();
    this.memoryCache.clear();
    this.loadFromDisk();
    this.loadFromDb().catch(() => { });
  }

  private getHost(): string {
    const rawUrl = (process.env.FUSION_HOST || config.oracle.baseUrl || 'eiiv-dev14.fa.us6.oraclecloud.com').trim().toLowerCase();
    try {
      if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
        return new URL(rawUrl).host;
      }
    } catch (_) { }
    return rawUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'eiiv-dev14.fa.us6.oraclecloud.com';
  }

  /**
   * Seeds incident count memory cache directly from PostgreSQL oracle_control_incidents.
   * Guarantees 0ms local response without querying live Oracle Fusion FSCM REST endpoint.
   */
  public async loadFromDb(): Promise<void> {
    try {
      const host = this.getHost();
      const res = await query<{
        control_id: string;
        total_incidents: number;
        assigned_incidents: number;
        accepted_incidents: number;
        remediate_incidents: number;
        resolved_incidents: number;
        last_synced_at: string | null;
      }>(
        `SELECT 
           control_id, 
           COALESCE(total_incidents, 0) AS total_incidents,
           CASE 
             WHEN COALESCE(assigned_incidents, 0) = 0 THEN 
               GREATEST(0, COALESCE(total_incidents, 0) - COALESCE(accepted_incidents, 0) - COALESCE(remediate_incidents, 0) - COALESCE(resolved_incidents, 0))
             ELSE assigned_incidents 
           END AS assigned_incidents,
           COALESCE(accepted_incidents, 0) AS accepted_incidents,
           COALESCE(remediate_incidents, 0) AS remediate_incidents,
           COALESCE(resolved_incidents, 0) AS resolved_incidents,
           last_synced_at
         FROM oracle_control_incidents
         WHERE (environment_host = $1 OR environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com') AND total_incidents IS NOT NULL
         ORDER BY (CASE WHEN environment_host = $1 THEN 0 ELSE 1 END)`,
        [host]
      );

      if (res.rows.length > 0) {
        for (const r of res.rows) {
          const cleanId = String(r.control_id).trim();
          const accepted = Number(r.accepted_incidents) || 0;
          const remediate = Number(r.remediate_incidents) || 0;
          const resolved = Number(r.resolved_incidents) || 0;
          const nonAssigned = accepted + remediate + resolved;
          const dbTotal = Number(r.total_incidents) || 0;
          const assigned = (Number(r.assigned_incidents) > 0 && (Number(r.assigned_incidents) + nonAssigned >= dbTotal))
            ? Number(r.assigned_incidents)
            : Math.max(0, dbTotal - nonAssigned);
          const tot = Math.max(dbTotal, assigned + nonAssigned);

          // Never regress if memory cache already holds a higher authoritative live count
          const existing = this.memoryCache.get(cleanId);
          if (existing && typeof existing.count === 'number' && existing.count > tot) {
            continue;
          }

          this.memoryCache.set(cleanId, {
            controlId: cleanId,
            count: tot,
            status: 'READY',
            updatedAt: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : new Date().toISOString(),
            assigned,
            accepted,
            remediate,
            resolved,
          });
        }
        console.log(`[IncidentCountCache] Seeded ${this.memoryCache.size} control incident counts and breakdowns directly from PostgreSQL.`);
        this.saveToDisk();
      }
    } catch (err: any) {
      console.warn('[IncidentCountCache] DB seed warning:', err.message);
    }
  }

  private ensureCacheDir() {
    try {
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }
    } catch (err: any) {
      console.error('[IncidentCountCache] Failed to initialize cache directory:', err.message);
    }
  }

  public getTTLMinutes(): number {
    const envVal = process.env.INCIDENT_COUNT_TTL_MINUTES;
    const parsed = envVal ? parseInt(envVal, 10) : NaN;
    return !isNaN(parsed) && parsed > 0 ? parsed : 15; // default 15 minutes TTL
  }

  private getCacheFilePath(): string {
    const rawUrl = (config.oracle.baseUrl || 'https://mock.fusion.oracle.com').trim().toLowerCase();
    const hash = crypto.createHash('sha256').update(rawUrl).digest('hex').substring(0, 12);
    return path.join(CACHE_DIR, `incident-counts_${hash}.json`);
  }

  private loadFromDisk() {
    const filePath = this.getCacheFilePath();
    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data: IncidentCountCache = JSON.parse(content);
      if (data && typeof data === 'object') {
        for (const [controlId, entry] of Object.entries(data)) {
          if (entry && typeof entry === 'object' && entry.controlId) {
            this.memoryCache.set(controlId, entry);
          }
        }
        console.log(`[IncidentCountCache] Loaded ${this.memoryCache.size} control incident count(s) from disk.`);
      }
    } catch (err: any) {
      console.error('[IncidentCountCache] Failed to read disk cache:', err.message);
    }
  }

  private saveToDisk() {
    this.ensureCacheDir();
    const filePath = this.getCacheFilePath();
    const tempFile = `${filePath}.tmp_${Date.now()}`;

    try {
      const exportObj: IncidentCountCache = {};
      for (const [id, entry] of this.memoryCache.entries()) {
        exportObj[id] = entry;
      }

      fs.writeFileSync(tempFile, JSON.stringify(exportObj, null, 2), 'utf-8');
      fs.renameSync(tempFile, filePath);
    } catch (err: any) {
      console.error('[IncidentCountCache] Atomic cache save failed:', err.message);
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch (_) { }
    }
  }

  public isFresh(entry: CachedCountEntry | null | undefined): boolean {
    if (!entry || entry.status !== 'READY' || typeof entry.count !== 'number') {
      return false;
    }
    const ttlMs = this.getTTLMinutes() * 60 * 1000;
    const age = Date.now() - new Date(entry.updatedAt).getTime();
    return age < ttlMs;
  }

  public getCount(controlId: string): CachedCountEntry | null {
    if (!controlId) return null;
    return this.memoryCache.get(String(controlId).trim()) || null;
  }

  public getAllCounts(): IncidentCountCache {
    const obj: IncidentCountCache = {};
    for (const [id, entry] of this.memoryCache.entries()) {
      obj[id] = entry;
    }
    return obj;
  }

  public setCount(controlId: string, count: number, status: 'READY' | 'ERROR' = 'READY', breakdown?: { assigned?: number; accepted?: number; remediate?: number; resolved?: number }): CachedCountEntry {
    const cleanId = String(controlId).trim();
    const entry: CachedCountEntry = {
      controlId: cleanId,
      count,
      status,
      updatedAt: new Date().toISOString(),
      ...(breakdown || {})
    };
    this.memoryCache.set(cleanId, entry);
    this.saveToDisk();
    return entry;
  }

  /**
   * Fetches the authoritative total count for a control in the background using limit=1&totalResults=true.
   * If fresh count exists and forceRefresh is false, returns existing count immediately.
   * If a fetch is already in-flight for this control, returns that promise to coalesce calls.
   */
  public async fetchCount(controlId: string, forceRefresh = false): Promise<CachedCountEntry> {
    const cleanId = String(controlId).trim();
    const existing = this.memoryCache.get(cleanId);

    if (!forceRefresh && this.isFresh(existing)) {
      return existing!;
    }

    if (this.inFlightFetches.has(cleanId)) {
      return this.inFlightFetches.get(cleanId)!;
    }

    // Mark as calculating while preserving previous count if available
    const calculatingEntry: CachedCountEntry = {
      controlId: cleanId,
      count: existing ? existing.count : null,
      status: 'CALCULATING',
      updatedAt: existing ? existing.updatedAt : new Date().toISOString()
    };
    this.memoryCache.set(cleanId, calculatingEntry);

    const promise = (async () => {
      try {
        console.log(`[IncidentCountCache] Fetching authoritative lifecycle counts for control "${cleanId}" from Oracle...`);
        const [totRes, assRes, accRes, remRes, resRes, closedRes] = await Promise.all([
          this.client.getAdvancedControlIncidents(cleanId, { offset: 0, limit: 1, totalResults: true, timeout: 60000 }),
          this.client.getAdvancedControlIncidents(cleanId, { offset: 0, limit: 1, totalResults: true, q: "Status='ASSIGNED'", timeout: 60000 }).catch(() => null),
          this.client.getAdvancedControlIncidents(cleanId, { offset: 0, limit: 1, totalResults: true, q: "Status='ACCEPTED'", timeout: 60000 }).catch(() => null),
          this.client.getAdvancedControlIncidents(cleanId, { offset: 0, limit: 1, totalResults: true, q: "Status='REMEDIATION'", timeout: 60000 }).catch(() => null),
          this.client.getAdvancedControlIncidents(cleanId, { offset: 0, limit: 1, totalResults: true, q: "Status='RESOLVED'", timeout: 60000 }).catch(() => null),
          this.client.getAdvancedControlIncidents(cleanId, { offset: 0, limit: 1, totalResults: true, q: "Status='CLOSED'", timeout: 60000 }).catch(() => null)
        ]);

        let totalResults: number | null = null;
        if (totRes?.totalResults !== undefined && totRes?.totalResults !== null) {
          totalResults = parseInt(String(totRes.totalResults), 10);
        } else if (Array.isArray(totRes?.items)) {
          totalResults = totRes.items.length;
        }

        if (totalResults !== null && !isNaN(totalResults)) {
          const accepted = accRes?.totalResults !== undefined ? Number(accRes.totalResults) : (existing?.accepted ?? 0);
          const remediate = remRes?.totalResults !== undefined ? Number(remRes.totalResults) : (existing?.remediate ?? 0);
          const resolved = ((resRes?.totalResults !== undefined ? Number(resRes.totalResults) : 0) + (closedRes?.totalResults !== undefined ? Number(closedRes.totalResults) : 0)) || (existing?.resolved ?? 0);
          const assigned = assRes?.totalResults !== undefined ? Number(assRes.totalResults) : Math.max(0, totalResults - (accepted + remediate + resolved));

          const readyEntry: CachedCountEntry = {
            controlId: cleanId,
            count: totalResults,
            status: 'READY',
            updatedAt: new Date().toISOString(),
            assigned,
            accepted,
            remediate,
            resolved,
          };
          this.memoryCache.set(cleanId, readyEntry);
          this.saveToDisk();
          console.log(`[IncidentCountCache] Control "${cleanId}" counts updated: total=${totalResults}, assigned=${assigned}, accepted=${accepted}, remediate=${remediate}, resolved=${resolved}`);

          // Persist authoritative count to PostgreSQL so DB queries and restarts retain it
          try {
            const host = this.getHost();
            await query(
              `INSERT INTO oracle_control_incidents (
                environment_host,
                control_id,
                total_incidents,
                assigned_incidents,
                accepted_incidents,
                remediate_incidents,
                resolved_incidents,
                sync_status,
                updated_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, 'READY', NOW())
              ON CONFLICT (environment_host, control_id)
              DO UPDATE SET
                total_incidents = EXCLUDED.total_incidents,
                assigned_incidents = EXCLUDED.assigned_incidents,
                accepted_incidents = EXCLUDED.accepted_incidents,
                remediate_incidents = EXCLUDED.remediate_incidents,
                resolved_incidents = EXCLUDED.resolved_incidents,
                sync_status = 'READY',
                updated_at = NOW()`,
              [host, cleanId, totalResults, assigned, accepted, remediate, resolved]
            );
          } catch (dbErr: any) {
            console.warn(`[IncidentCountCache] Failed to persist count to DB for ${cleanId}:`, dbErr.message);
          }

          return readyEntry;
        } else {
          throw new Error('Oracle response did not contain a valid totalResults integer.');
        }
      } catch (err: any) {
        console.warn(`[IncidentCountCache] Failed to fetch count for control "${cleanId}": ${err.message}`);
        // Preserve previous valid count if exists, but flag status as ERROR
        const errorEntry: CachedCountEntry = {
          controlId: cleanId,
          count: existing?.count !== undefined && existing?.count !== null ? existing.count : null,
          status: 'ERROR',
          error: err.message,
          updatedAt: existing ? existing.updatedAt : new Date().toISOString()
        };
        this.memoryCache.set(cleanId, errorEntry);
        this.saveToDisk();
        return errorEntry;
      } finally {
        this.inFlightFetches.delete(cleanId);
      }
    })();

    this.inFlightFetches.set(cleanId, promise);
    return promise;
  }

  /**
   * Syncs missing or stale counts across all or specific controls in the background from Oracle REST API.
   * Uses throttled concurrency (3 concurrent requests) to avoid stressing Oracle.
   */
  public syncMissingOrStaleCounts(controlIds?: string[], force = false): void {
    const targetIds = controlIds && controlIds.length > 0 ? controlIds : Array.from(this.memoryCache.keys());
    const toSync = targetIds.filter(id => {
      const cleanId = String(id).trim();
      const existing = this.memoryCache.get(cleanId);
      if (force) return !this.inFlightFetches.has(cleanId);
      return !this.isFresh(existing) && !this.inFlightFetches.has(cleanId);
    });

    if (toSync.length === 0) return;

    for (const id of toSync) {
      if (!this.queue.includes(id)) {
        this.queue.push(id);
      }
    }

    if (!this.isSyncingQueue) {
      this.processQueue(force);
    }
  }

  private async processQueue(force = false) {
    if (this.isSyncingQueue) return;
    this.isSyncingQueue = true;

    try {
      while (this.queue.length > 0) {
        // Take a batch of 3 concurrent requests
        const batch = this.queue.splice(0, 3);
        await Promise.allSettled(batch.map(id => this.fetchCount(id, force)));
        // Short pause between batches
        if (this.queue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    } finally {
      this.isSyncingQueue = false;
    }
  }
}
