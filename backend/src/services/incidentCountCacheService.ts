import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { OracleFusionClient } from '../oracle/client.js';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.resolve(__dirname, '../../cache/risk-summary');

export interface CachedCountEntry {
  controlId: string;
  count: number | null;
  updatedAt: string;
  status: 'READY' | 'CALCULATING' | 'ERROR';
  error?: string;
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
  }

  public recreateClient(client: OracleFusionClient) {
    this.client = client;
    this.inFlightFetches.clear();
    this.memoryCache.clear();
    this.loadFromDisk();
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
      } catch (_) {}
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

  public setCount(controlId: string, count: number, status: 'READY' | 'ERROR' = 'READY'): CachedCountEntry {
    const cleanId = String(controlId).trim();
    const entry: CachedCountEntry = {
      controlId: cleanId,
      count,
      status,
      updatedAt: new Date().toISOString()
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
        console.log(`[IncidentCountCache] Fetching authoritative count for control "${cleanId}" from Oracle...`);
        const res = await this.client.getAdvancedControlIncidents(cleanId, {
          offset: 0,
          limit: 1,
          totalResults: true,
          timeout: 60000
        });

        let totalResults: number | null = null;
        if (res?.totalResults !== undefined && res?.totalResults !== null) {
          totalResults = parseInt(String(res.totalResults), 10);
        } else if (Array.isArray(res?.items)) {
          totalResults = res.items.length;
        }

        if (totalResults !== null && !isNaN(totalResults)) {
          const readyEntry: CachedCountEntry = {
            controlId: cleanId,
            count: totalResults,
            status: 'READY',
            updatedAt: new Date().toISOString()
          };
          this.memoryCache.set(cleanId, readyEntry);
          this.saveToDisk();
          console.log(`[IncidentCountCache] Control "${cleanId}" count updated: ${totalResults}`);
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
   * Syncs missing or stale counts across a list of controls in the background.
   * Uses throttled concurrency (2 concurrent requests) to avoid stressing Oracle.
   */
  public syncMissingOrStaleCounts(controlIds: string[]): void {
    const toSync = controlIds.filter(id => {
      const cleanId = String(id).trim();
      const existing = this.memoryCache.get(cleanId);
      return !this.isFresh(existing) && !this.inFlightFetches.has(cleanId);
    });

    if (toSync.length === 0) return;

    for (const id of toSync) {
      if (!this.queue.includes(id)) {
        this.queue.push(id);
      }
    }

    if (!this.isSyncingQueue) {
      this.processQueue();
    }
  }

  private async processQueue() {
    if (this.isSyncingQueue) return;
    this.isSyncingQueue = true;

    try {
      while (this.queue.length > 0) {
        // Take a batch of 2
        const batch = this.queue.splice(0, 2);
        await Promise.allSettled(batch.map(id => this.fetchCount(id, false)));
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
