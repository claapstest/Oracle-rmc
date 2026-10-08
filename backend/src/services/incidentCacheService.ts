import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { OracleFusionClient } from '../oracle/client.js';
import { config } from '../config.js';
import { ControlIncidentItem } from './controlCatalogService.js';
import { controlRawDbService } from './controlRawDbService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.resolve(__dirname, '../../cache/risk-incidents');

export interface CachedIncidentData {
  controlId: string;
  baseUrl: string;
  totalResults: number;
  fetchedResults: number;
  fetchedAt: string;
  source: string;
  complete: boolean;
  incidents: ControlIncidentItem[];
}

export interface IncidentSyncProgress {
  controlId: string;
  cacheStatus: 'NOT_CACHED' | 'SYNCING' | 'READY' | 'PARTIAL' | 'ERROR';
  totalCount?: number;
  fetchedCount?: number;
  incidentCount?: number;
  lastSyncedAt?: string;
  incidents?: ControlIncidentItem[];
  message?: string;
}

interface ActiveJob {
  controlId: string;
  jobKey: string;
  status: 'SYNCING' | 'READY' | 'PARTIAL' | 'ERROR';
  totalCount: number;
  fetchedCount: number;
  lastOffset: number;
  startedAt: number;
  error?: string;
  incidentsMap: Map<string, ControlIncidentItem>;
  promise: Promise<void>;
}

export class IncidentCacheService {
  private client: OracleFusionClient;
  private activeJobs = new Map<string, ActiveJob>();
  private memoryIncidentCache = new Map<string, { data: CachedIncidentData; timestamp: number }>();

  constructor(client: OracleFusionClient) {
    this.client = client;
    this.ensureCacheDir();
  }

  public recreateClient(client: OracleFusionClient) {
    this.client = client;
    this.memoryIncidentCache.clear();
  }

  private ensureCacheDir() {
    try {
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }
    } catch (err: any) {
      console.error('[IncidentCache] Failed to initialize cache directory:', err.message);
    }
  }

  public getTTLMinutes(): number {
    const envVal = process.env.INCIDENT_CACHE_TTL_MINUTES;
    const parsed = envVal ? parseInt(envVal, 10) : NaN;
    return !isNaN(parsed) && parsed > 0 ? parsed : 30; // default 30 minutes
  }

  private getJobKey(controlId: string): string {
    const rawUrl = (config.oracle.baseUrl || 'https://mock.fusion.oracle.com').trim().toLowerCase();
    const hash = crypto.createHash('sha256').update(rawUrl).digest('hex').substring(0, 12);
    return `${hash}_${controlId}`;
  }

  private getCacheFilePath(controlId: string): string {
    const key = this.getJobKey(controlId);
    return path.join(CACHE_DIR, `control_${key}.json`);
  }

  /**
   * Normalizes raw Oracle incident into ControlIncidentItem
   */
  private normalizeIncident(raw: any, controlId: string, controlName?: string): ControlIncidentItem {
    const id = String(raw.Id ?? raw.id ?? raw.IncidentId ?? `INC-${controlId}-${Math.random().toString(36).substring(2, 8)}`).trim();
    return {
      id,
      controlId: String(raw.ControlId ?? raw.controlId ?? controlId),
      controlName: raw.ControlName ?? raw.controlName ?? controlName,
      globalUserId: raw.GlobalUserId !== undefined && raw.GlobalUserId !== null ? String(raw.GlobalUserId) : null,
      globalUserName: raw.GlobalUserName ?? raw.globalUserName ?? null,
      userFirstName: raw.UserFirstName ?? raw.userFirstName ?? null,
      userLastName: raw.UserLastName ?? raw.userLastName ?? null,
      priority: raw.Priority !== undefined && raw.Priority !== null ? String(raw.Priority) : null,
      role: raw.Role ?? raw.role ?? null,
      conflictingRoles: raw.ConflictingRoles ?? raw.conflictingRoles ?? null,
      conflictingAccPointName: raw.ConflictingAccPointName ?? raw.conflictingAccPointName ?? null,
      entitlement: raw.Entitlement ?? raw.entitlement ?? null,
      accessPointName: raw.AccessPointName ?? raw.accessPointName ?? null,
      accessPointType: raw.AccessPointType ?? raw.accessPointType ?? null,
      state: raw.State ?? raw.state ?? raw.StateCode ?? null,
      status: raw.Status ?? raw.status ?? raw.StatusId ?? null,
      creationDate: raw.CreationDate ?? raw.creationDate ?? null,
      createdBy: raw.CreatedBy ?? raw.createdBy ?? null,
      lastUpdateDate: raw.LastUpdateDate ?? raw.lastUpdateDate ?? null,
      lastUpdatedBy: raw.LastUpdatedBy ?? raw.lastUpdatedBy ?? null,
      closedDate: raw.ClosedDate ?? raw.closedDate ?? null,
      closedBy: raw.ClosedBy ?? raw.closedBy ?? null,
      resultInvestigator: raw.ResultInvestigator ?? raw.resultInvestigator ?? null,
      incidentInformation: raw.IncidentInformation ?? raw.incidentInformation ?? raw.Description ?? null,
      dataSource: raw.DataSource ?? raw.dataSource ?? 'Oracle Fusion FSCM',
      groupingValue: raw.GroupingValue ?? raw.groupingValue ?? null,
      raw
    };
  }

  /**
   * Checks if an atomic disk cache exists and is valid.
   */
  public readCache(controlId: string): CachedIncidentData | null {
    const cacheFile = this.getCacheFilePath(controlId);

    // Check fast memory cache first (cached within 60 seconds)
    const mem = this.memoryIncidentCache.get(controlId);
    const ttlMs = this.getTTLMinutes() * 60 * 1000;
    const now = Date.now();

    if (mem && (now - mem.timestamp < 60000)) {
      if (now - new Date(mem.data.fetchedAt).getTime() < ttlMs) {
        console.log(`[IncidentCache] control=${controlId} cache HIT (memory)`);
        return mem.data;
      }
    }

    if (!fs.existsSync(cacheFile)) {
      console.log(`[IncidentCache] control=${controlId} cache MISS`);
      return null;
    }

    try {
      const content = fs.readFileSync(cacheFile, 'utf-8');
      const data: CachedIncidentData = JSON.parse(content);

      if (!data || !data.complete || !Array.isArray(data.incidents)) {
        console.warn(`[IncidentCache] control=${controlId} found invalid or incomplete cache file.`);
        return null;
      }

      const fetchedTime = new Date(data.fetchedAt).getTime();
      if (isNaN(fetchedTime) || (now - fetchedTime > ttlMs)) {
        console.log(`[IncidentCache] control=${controlId} cache EXPIRED`);
        return null;
      }

      console.log(`[IncidentCache] control=${controlId} cache HIT (disk: ${data.incidents.length} items)`);
      this.memoryIncidentCache.set(controlId, { data, timestamp: now });
      return data;
    } catch (err: any) {
      console.error(`[IncidentCache] control=${controlId} failed to read cache:`, err.message);
      return null;
    }
  }

  /**
   * Atomically writes complete incident data to temporary file and renames it.
   */
  private writeCacheAtomically(controlId: string, data: CachedIncidentData) {
    this.ensureCacheDir();
    const cacheFile = this.getCacheFilePath(controlId);
    const tempFile = `${cacheFile}.tmp_${Date.now()}`;

    try {
      fs.writeFileSync(tempFile, JSON.stringify(data), 'utf-8');
      fs.renameSync(tempFile, cacheFile);
      this.memoryIncidentCache.set(controlId, { data, timestamp: Date.now() });
      console.log(`[IncidentCache] control=${controlId} atomic cache saved (${data.incidents.length} items, file: ${path.basename(cacheFile)})`);
    } catch (err: any) {
      console.error(`[IncidentCache] control=${controlId} atomic cache write failed:`, err.message);
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch (_) {}
    }
  }

  /**
   * Retrieves current status or initiates background synchronization.
   * Enforces singleton sync: only ONE background worker per (Oracle env + controlId).
   */
  public getOrStartSync(controlId: string, options: { forceRefresh?: boolean; controlName?: string } = {}): IncidentSyncProgress {
    const jobKey = this.getJobKey(controlId);
    const activeJob = this.activeJobs.get(jobKey);

    // 1. If actively syncing, return current progress
    if (activeJob && activeJob.status === 'SYNCING') {
      return {
        controlId,
        cacheStatus: 'SYNCING',
        totalCount: activeJob.totalCount,
        fetchedCount: activeJob.fetchedCount,
        incidentCount: activeJob.totalCount || activeJob.fetchedCount,
        message: `Fetching incidents from Oracle Fusion: ${activeJob.fetchedCount.toLocaleString()} / ${activeJob.totalCount ? activeJob.totalCount.toLocaleString() : '...'}`
      };
    }

    // 2. If not forceRefresh, check existing cache
    if (!options.forceRefresh) {
      const cached = this.readCache(controlId);
      if (cached) {
        return {
          controlId,
          cacheStatus: 'READY',
          totalCount: cached.totalResults,
          fetchedCount: cached.fetchedResults,
          incidentCount: cached.totalResults,
          lastSyncedAt: cached.fetchedAt,
          incidents: cached.incidents
        };
      }
    }

    // 3. Cache missing or stale -> Start background synchronization job
    this.startBackgroundSync(controlId, options.controlName);

    const startingJob = this.activeJobs.get(jobKey);
    return {
      controlId,
      cacheStatus: 'SYNCING',
      totalCount: startingJob?.totalCount || 0,
      fetchedCount: startingJob?.fetchedCount || 0,
      incidentCount: startingJob?.totalCount || 0,
      message: 'Background synchronization started with Oracle Fusion.'
    };
  }

  /**
   * Spawns a resilient background worker to fetch all pages.
   */
  private startBackgroundSync(controlId: string, controlName?: string) {
    const jobKey = this.getJobKey(controlId);
    if (this.activeJobs.has(jobKey) && this.activeJobs.get(jobKey)?.status === 'SYNCING') {
      return;
    }

    const incidentsMap = new Map<string, ControlIncidentItem>();

    const job: ActiveJob = {
      controlId,
      jobKey,
      status: 'SYNCING',
      totalCount: 0,
      fetchedCount: 0,
      lastOffset: 0,
      startedAt: Date.now(),
      incidentsMap,
      promise: Promise.resolve()
    };

    this.activeJobs.set(jobKey, job);

    job.promise = (async () => {
      console.log(`[IncidentSync] control=${controlId} status=STARTED total=calculating...`);
      let pageSize = 500;
      let offset = 0;
      let hasMore = true;
      let totalResults = 0;
      let isFirstPage = true;
      let maxOracleUpdateDate: Date | null = null;

      // Initialize watermark in PostgreSQL
      controlRawDbService.upsertWatermark(controlId, { controlName, syncStatus: 'SYNCING' }).catch(() => {});

      try {
        while (hasMore) {
          try {
            const res = await this.client.getAdvancedControlIncidents(controlId, {
              offset,
              limit: pageSize,
              totalResults: isFirstPage // Only ask Oracle for expensive totalResults calculation on first call!
            });

            if (isFirstPage) {
              if (res?.totalResults !== undefined && res?.totalResults !== null) {
                totalResults = parseInt(String(res.totalResults), 10) || 0;
              } else {
                totalResults = Array.isArray(res?.items) ? res.items.length : 0;
              }
              job.totalCount = totalResults;
              console.log(`[IncidentSync] control=${controlId} status=STARTED total=${totalResults}`);
              isFirstPage = false;
            }

            const rawItems: any[] = Array.isArray(res?.items) ? res.items : [];
            const fetchedInBatch = rawItems.length;

            if (fetchedInBatch > 0) {
              // Track latest Oracle update date for change detection
              for (const item of rawItems) {
                const dtStr = item.LastUpdateDate || item.lastUpdateDate;
                if (dtStr) {
                  const dt = new Date(dtStr);
                  if (!isNaN(dt.getTime()) && (!maxOracleUpdateDate || dt > maxOracleUpdateDate)) {
                    maxOracleUpdateDate = dt;
                  }
                }
              }

              // Persist raw batch to PostgreSQL in background
              controlRawDbService.saveRawIncidentsBatch(controlId, rawItems, controlName).catch(dbErr => {
                console.warn(`[IncidentCache] DB raw batch save warning for control ${controlId}:`, dbErr.message);
              });
            }

            rawItems.forEach(item => {
              const norm = this.normalizeIncident(item, controlId, controlName);
              incidentsMap.set(norm.id, norm);
            });

            job.fetchedCount = incidentsMap.size;
            job.lastOffset = offset;

            console.log(`[IncidentSync] control=${controlId} offset=${offset} fetched=${fetchedInBatch} (accumulated: ${incidentsMap.size}/${totalResults})`);

            // Check pagination continuation
            hasMore = res?.hasMore === true && (totalResults > 0 ? incidentsMap.size < totalResults : fetchedInBatch >= pageSize);
            offset += fetchedInBatch;

            if (fetchedInBatch === 0 || !hasMore || (totalResults > 0 && incidentsMap.size >= totalResults)) {
              break;
            }
          } catch (batchErr: any) {
            // Dynamic fallback: if pageSize=500 was rejected, fall back to smaller page size
            if (pageSize > 100) {
              console.warn(`[IncidentSync] control=${controlId} pageSize=${pageSize} failed: ${batchErr.message}. Falling back to pageSize=100...`);
              pageSize = 100;
              continue;
            } else if (pageSize > 25) {
              console.warn(`[IncidentSync] control=${controlId} pageSize=${pageSize} failed: ${batchErr.message}. Falling back to pageSize=25...`);
              pageSize = 25;
              continue;
            }
            throw batchErr;
          }
        }

        // All pages fetched successfully
        const allIncidents = Array.from(incidentsMap.values());
        const finalTotal = totalResults || allIncidents.length;

        const cachedData: CachedIncidentData = {
          controlId,
          baseUrl: config.oracle.baseUrl,
          totalResults: finalTotal,
          fetchedResults: allIncidents.length,
          fetchedAt: new Date().toISOString(),
          source: 'Oracle Fusion',
          complete: true,
          incidents: allIncidents
        };

        this.writeCacheAtomically(controlId, cachedData);

        // Update watermark in PostgreSQL to READY
        controlRawDbService.upsertWatermark(controlId, {
          controlName,
          totalIncidents: finalTotal,
          syncedIncidents: allIncidents.length,
          lastOracleUpdateDate: maxOracleUpdateDate,
          syncStatus: 'READY'
        }).catch(dbErr => {
          console.warn(`[IncidentCache] DB watermark update warning for control ${controlId}:`, dbErr.message);
        });

        const partialFilePath = this.getCacheFilePath(controlId) + '.partial.json';
        if (fs.existsSync(partialFilePath)) {
          try { fs.unlinkSync(partialFilePath); } catch (_) {}
        }

        job.status = 'READY';
        job.totalCount = finalTotal;
        job.fetchedCount = allIncidents.length;
        console.log(`[IncidentSync] control=${controlId} status=COMPLETED total=${finalTotal} fetched=${allIncidents.length}`);
      } catch (err: any) {
        console.error(`[IncidentSync Error] control=${controlId} failed at offset=${offset}:`, err.message);
        job.status = incidentsMap.size > 0 ? 'PARTIAL' : 'ERROR';
        job.error = err.message || 'Failed to synchronize incidents from Oracle Fusion.';

        // Update watermark in PostgreSQL to PARTIAL or ERROR
        controlRawDbService.upsertWatermark(controlId, {
          controlName,
          totalIncidents: totalResults,
          syncedIncidents: incidentsMap.size,
          syncStatus: incidentsMap.size > 0 ? 'PARTIAL' : 'ERROR',
          errorMessage: err.message
        }).catch(() => {});

        // Record synchronization metadata on partial failure (Requirement J)
        if (incidentsMap.size > 0) {
          const partialData = {
            controlId,
            status: 'PARTIAL',
            totalResults,
            fetchedResults: incidentsMap.size,
            lastSuccessfulOffset: offset,
            error: err.message,
            complete: false,
            updatedAt: new Date().toISOString()
          };
          const partialFilePath = this.getCacheFilePath(controlId) + '.partial.json';
          try {
            fs.writeFileSync(partialFilePath, JSON.stringify(partialData, null, 2), 'utf-8');
            console.log(`[IncidentCache] control=${controlId} recorded partial sync metadata (${incidentsMap.size}/${totalResults})`);
          } catch (_) {}
        }
      } finally {
        // Clean up job from active map after 10 seconds so subsequent requests use disk cache
        setTimeout(() => {
          if (this.activeJobs.get(jobKey) === job) {
            this.activeJobs.delete(jobKey);
          }
        }, 10000);
      }
    })();
  }
}
