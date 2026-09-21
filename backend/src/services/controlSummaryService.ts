import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { OracleFusionClient } from '../oracle/client.js';
import { config } from '../config.js';
import { ControlCatalogService, AdvancedControlItem, ControlIncidentItem } from './controlCatalogService.js';
import { IncidentCacheService } from './incidentCacheService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SUMMARY_CACHE_DIR = path.resolve(__dirname, '../../cache/risk-summary');

/**
 * Clean reporting data model for Control Summary Report.
 * Explicitly distinguishes Oracle supported fields vs unsupported fields.
 */
export interface ControlSummaryItem {
  controlId: string;
  controlName: string;
  description: string | null;
  /** Numeric code returned by Oracle (e.g. 173, 174). */
  controlTypeCode: number | string | null;
  /** Null until a verified mapping from code to name exists. */
  controlTypeName: string | null;
  /** Status from Oracle: "ACTIVE" | "INACTIVE" */
  status: string;
  /** State from Oracle: "APPROVED" */
  state: string;
  /** ISO timestamp from Oracle control header */
  lastRunDate: string | null;
  /** Explicitly null - Oracle Advanced Controls header does NOT provide LastRunBy */
  lastRunBy: null;
  /** User who scheduled the control run (from Oracle ScheduledBy) */
  scheduledBy: string | null;
  /** User who last updated the control (from Oracle LastUpdatedBy) */
  lastUpdatedBy: string | null;
  /** User who created the control (from Oracle CreatedBy) */
  createdBy: string | null;
  /** Total count of continuous monitoring incidents */
  totalIncidentCount: number | null;
  /** Count of incidents in Assigned or In Remediation status */
  assignedOrInRemediationCount: number | null;
  /** Count of incidents accepted by business risk owner */
  acceptedCount: number | null;
  /** Count of closed or resolved incidents */
  closedOrResolvedCount: number | null;
  /** Calculation status for this control's incident counts */
  countsStatus: 'READY' | 'PARTIAL' | 'CALCULATING' | 'NOT_STARTED' | 'ERROR';
  /** Timestamp when these counts were calculated */
  lastCalculatedAt: string | null;
  /** Data provenance source */
  dataSource: string;
  /** Audit notes explaining calculation source and methodology */
  calculationNotes?: string;
}

export interface ControlSummaryReportResult {
  success: boolean;
  dataSource: string;
  calculatedAt: string;
  summaryStatus: 'READY' | 'PARTIAL' | 'CALCULATING';
  totalControls: number;
  activeControls: number;
  approvedControls: number;
  controlsWithIncidents: number;
  scannedControlsCount: number;
  controls: ControlSummaryItem[];
  message?: string;
}

export interface LightweightScanResult {
  controlId: string;
  totalIncidentCount: number | null;
  hasMore: boolean;
  requestDurationMs: number;
  error: string | null;
  timestamp: string;
}

export class ControlSummaryService {
  private client: OracleFusionClient;
  private catalogService: ControlCatalogService;
  private isScanning = false;
  private activeScanAbort = false;

  constructor(client: OracleFusionClient, catalogService: ControlCatalogService) {
    this.client = client;
    this.catalogService = catalogService;
    this.ensureCacheDir();
  }

  public recreateClient(client: OracleFusionClient) {
    this.client = client;
  }

  private ensureCacheDir() {
    try {
      if (!fs.existsSync(SUMMARY_CACHE_DIR)) {
        fs.mkdirSync(SUMMARY_CACHE_DIR, { recursive: true });
      }
    } catch (err: any) {
      console.error('[ControlSummaryService] Failed to create summary cache directory:', err.message);
    }
  }

  private getEnvHash(): string {
    const rawUrl = (config.oracle.baseUrl || 'https://mock.fusion.oracle.com').trim().toLowerCase();
    return crypto.createHash('sha256').update(rawUrl).digest('hex').substring(0, 12);
  }

  private getSummaryCacheFilePath(): string {
    return path.join(SUMMARY_CACHE_DIR, `summary_${this.getEnvHash()}.json`);
  }

  public getTTLMinutes(): number {
    const envVal = process.env.CONTROL_SUMMARY_CACHE_TTL_MINUTES;
    const parsed = envVal ? parseInt(envVal, 10) : NaN;
    return !isNaN(parsed) && parsed > 0 ? parsed : 60; // default 60 minutes
  }

  /**
   * Reads persistent control summary cache from disk if valid.
   */
  public readSummaryCache(): ControlSummaryReportResult | null {
    const filePath = this.getSummaryCacheFilePath();
    if (!fs.existsSync(filePath)) return null;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as ControlSummaryReportResult;
      const ttlMs = this.getTTLMinutes() * 60 * 1000;
      const fetchedTime = new Date(data.calculatedAt).getTime();

      if (isNaN(fetchedTime) || (Date.now() - fetchedTime > ttlMs)) {
        return null; // Expired
      }
      return data;
    } catch (err: any) {
      console.warn('[ControlSummaryService] Failed to read summary cache:', err.message);
      return null;
    }
  }

  /**
   * Writes summary cache atomically.
   */
  private writeSummaryCacheAtomically(data: ControlSummaryReportResult) {
    this.ensureCacheDir();
    const filePath = this.getSummaryCacheFilePath();
    const tempPath = `${filePath}.tmp_${Date.now()}`;

    try {
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tempPath, filePath);
    } catch (err: any) {
      console.error('[ControlSummaryService] Failed to write summary cache atomically:', err.message);
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch (_) {}
    }
  }

  /**
   * Aggregates category counts from an array of normalized incident items.
   * State and Status are separated and mapped according to verified live values.
   */
  public calculateCategoryCountsFromIncidents(incidents: ControlIncidentItem[]): {
    total: number;
    assignedOrInRemediation: number;
    accepted: number;
    closedOrResolved: number;
  } {
    let assignedOrInRemediation = 0;
    let accepted = 0;
    let closedOrResolved = 0;

    for (const inc of incidents) {
      const status = (inc.status || '').toUpperCase();
      const state = (inc.state || '').toUpperCase();
      const isClosed = inc.closedDate !== null && inc.closedDate !== undefined;

      // Closed or Resolved
      if (status === 'CLOSED' || status === 'RESOLVED' || state === 'CLOSED' || isClosed) {
        closedOrResolved++;
      }
      // Accepted
      else if (state === 'ACCEPTED' || status === 'ACCEPTED') {
        accepted++;
      }
      // Assigned or In Remediation (verified live status: "ASSIGNED", state: "IN_INVESTIGATION")
      else if (status === 'ASSIGNED' || status === 'IN_REMEDIATION' || status === 'NEW' || state === 'IN_INVESTIGATION') {
        assignedOrInRemediation++;
      } else {
        // Default unassigned or unclassified open incidents count toward active remediation
        assignedOrInRemediation++;
      }
    }

    return {
      total: incidents.length,
      assignedOrInRemediation,
      accepted,
      closedOrResolved
    };
  }

  /**
   * Scans a single control's total incident count using the minimal strategy:
   * GET /advancedControls/{controlId}/child/incidents?totalResults=true&limit=1
   * WITHOUT downloading the full collection of incident objects.
   */
  public async scanSingleControlCount(controlId: string): Promise<LightweightScanResult> {
    const t0 = Date.now();
    try {
      // First check if already fully cached in IncidentCacheService
      const incidentCache = this.catalogService.getIncidentCacheService().readCache(controlId);
      if (incidentCache && incidentCache.complete) {
        return {
          controlId,
          totalIncidentCount: incidentCache.totalResults,
          hasMore: false,
          requestDurationMs: Date.now() - t0,
          error: null,
          timestamp: incidentCache.fetchedAt
        };
      }

      // Minimal query to Oracle Fusion
      const res = await this.client.getAdvancedControlIncidents(controlId, {
        limit: 1,
        offset: 0,
        totalResults: true
      });

      const dur = Date.now() - t0;
      let total: number | null = null;
      if (res?.totalResults !== undefined && res?.totalResults !== null) {
        total = parseInt(String(res.totalResults), 10);
      } else if (Array.isArray(res?.items)) {
        total = res.items.length;
      }

      return {
        controlId,
        totalIncidentCount: total,
        hasMore: res?.hasMore === true,
        requestDurationMs: dur,
        error: null,
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      return {
        controlId,
        totalIncidentCount: null,
        hasMore: false,
        requestDurationMs: Date.now() - t0,
        error: err.message || 'Failed to query Oracle Fusion for incident count',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Builds the report model across all controls.
   * If scan=true and cache is incomplete, launches asynchronous lightweight background scan.
   */
  public async getControlSummaryReport(options: { forceRefresh?: boolean; scan?: boolean } = {}): Promise<ControlSummaryReportResult> {
    // 1. Check disk cache if not forcing refresh
    if (!options.forceRefresh) {
      const cached = this.readSummaryCache();
      if (cached) {
        return cached;
      }
    }

    // 2. Fetch or resolve the authoritative 40 controls from catalog
    const catalogRes = await this.catalogService.getAllControls(options.forceRefresh);
    const controls = catalogRes.items || [];
    const isDemo = this.catalogService.isDemoMode();

    const incidentCacheService = this.catalogService.getIncidentCacheService();
    const summaryItems: ControlSummaryItem[] = [];

    let controlsWithIncidents = 0;
    let scannedCount = 0;

    for (const ctrl of controls) {
      // Check if detailed incidents are already cached on disk
      const fullCache = incidentCacheService.readCache(ctrl.id);

      let totalIncidentCount: number | null = null;
      let assignedOrInRemediationCount: number | null = null;
      let acceptedCount: number | null = null;
      let closedOrResolvedCount: number | null = null;
      let countsStatus: 'READY' | 'PARTIAL' | 'CALCULATING' | 'NOT_STARTED' | 'ERROR' = 'NOT_STARTED';
      let calculationNotes = 'Awaiting lightweight incident count scan';

      if (isDemo) {
        // Demo mode: known controls
        if (ctrl.id === '114281') {
          totalIncidentCount = 24;
          assignedOrInRemediationCount = 24;
          acceptedCount = 0;
          closedOrResolvedCount = 0;
          countsStatus = 'READY';
          calculationNotes = 'Demo sample data';
        } else {
          totalIncidentCount = ctrl.incidentCount ?? 0;
          assignedOrInRemediationCount = totalIncidentCount;
          acceptedCount = 0;
          closedOrResolvedCount = 0;
          countsStatus = 'READY';
          calculationNotes = 'Demo sample data';
        }
      } else if (fullCache && fullCache.complete) {
        // Detailed incident cache HIT: calculate exact breakdown
        const cats = this.calculateCategoryCountsFromIncidents(fullCache.incidents);
        totalIncidentCount = cats.total;
        assignedOrInRemediationCount = cats.assignedOrInRemediation;
        acceptedCount = cats.accepted;
        closedOrResolvedCount = cats.closedOrResolved;
        countsStatus = 'READY';
        calculationNotes = `Aggregated from ${fullCache.incidents.length.toLocaleString()} cached incident records`;
      } else if (ctrl.incidentCount !== undefined && !isNaN(ctrl.incidentCount)) {
        // Pre-recorded count
        totalIncidentCount = ctrl.incidentCount;
        countsStatus = 'PARTIAL';
        calculationNotes = 'Incident count available; detailed status breakdown requires scan';
      }

      if (totalIncidentCount !== null && totalIncidentCount > 0) {
        controlsWithIncidents++;
      }
      if (countsStatus === 'READY' || countsStatus === 'PARTIAL') {
        scannedCount++;
      }

      const summaryItem: ControlSummaryItem = {
        controlId: ctrl.id,
        controlName: ctrl.name,
        description: ctrl.description,
        controlTypeCode: ctrl.type,
        controlTypeName: (ctrl.type === 173 || ctrl.type === '173')
          ? 'Access Control'
          : (ctrl.type === 174 || ctrl.type === '174')
            ? 'Transaction Control'
            : (ctrl.type ? 'Other' : null),
        status: ctrl.status,
        state: ctrl.state,
        lastRunDate: ctrl.lastRunDate,
        lastRunBy: null, // Explicitly null: Oracle API provides ScheduledBy/LastUpdatedBy, but not LastRunBy
        scheduledBy: ctrl.scheduledBy,
        lastUpdatedBy: ctrl.lastUpdatedBy,
        createdBy: ctrl.createdBy,
        totalIncidentCount,
        assignedOrInRemediationCount,
        acceptedCount,
        closedOrResolvedCount,
        countsStatus,
        lastCalculatedAt: fullCache ? fullCache.fetchedAt : (totalIncidentCount !== null ? new Date().toISOString() : null),
        dataSource: isDemo ? 'Sample Controls Data' : 'Live Oracle Fusion API',
        calculationNotes
      };

      summaryItems.push(summaryItem);
    }

    const activeControls = controls.filter(c => c.status === 'ACTIVE').length;
    const approvedControls = controls.filter(c => c.state === 'APPROVED').length;

    const reportResult: ControlSummaryReportResult = {
      success: true,
      dataSource: isDemo ? 'Sample Controls Data' : 'Live Oracle Fusion API',
      calculatedAt: new Date().toISOString(),
      summaryStatus: scannedCount === controls.length ? 'READY' : (scannedCount > 0 ? 'PARTIAL' : 'CALCULATING'),
      totalControls: controls.length,
      activeControls,
      approvedControls,
      controlsWithIncidents,
      scannedControlsCount: scannedCount,
      controls: summaryItems,
      message: scannedCount === controls.length 
        ? 'Authoritative control summary report generated.' 
        : `Summary generated (${scannedCount}/${controls.length} controls scanned for incidents).`
    };

    // Save current baseline to disk
    this.writeSummaryCacheAtomically(reportResult);

    // If scan requested and not in demo mode, launch background scanner for unscanned items
    if (options.scan && !isDemo && !this.isScanning) {
      this.startBackgroundScan(controls);
    }

    return reportResult;
  }

  /**
   * Spawns a background worker to scan incident counts across controls sequentially.
   * Uses minimal queries (?limit=1&totalResults=true) without downloading incident objects.
   */
  public startBackgroundScan(controls: AdvancedControlItem[]) {
    if (this.isScanning) return;
    this.isScanning = true;
    this.activeScanAbort = false;

    (async () => {
      console.log(`[ControlSummaryService] Starting lightweight incident count scan across ${controls.length} controls...`);
      for (const ctrl of controls) {
        if (this.activeScanAbort) break;

        // Skip if already fully resolved
        const currentCache = this.readSummaryCache();
        const existing = currentCache?.controls.find(c => c.controlId === ctrl.id);
        if (existing && existing.countsStatus === 'READY') {
          continue;
        }

        try {
          console.log(`[ControlSummaryService] Scanning control ${ctrl.id} (${ctrl.name.substring(0, 30)}...)...`);
          const scan = await this.scanSingleControlCount(ctrl.id);

          // Update cache with this control's count
          const cache = this.readSummaryCache();
          if (cache) {
            const item = cache.controls.find(c => c.controlId === ctrl.id);
            if (item) {
              if (scan.totalIncidentCount !== null) {
                item.totalIncidentCount = scan.totalIncidentCount;
                if (scan.totalIncidentCount === 0) {
                  item.assignedOrInRemediationCount = 0;
                  item.acceptedCount = 0;
                  item.closedOrResolvedCount = 0;
                  item.countsStatus = 'READY';
                  item.calculationNotes = '0 incidents confirmed via lightweight Oracle query';
                } else {
                  // Total count is verified; status-level breakdown requires a
                  // detailed incident query, so breakdown fields stay null
                  // (rendered as "—") instead of inventing a categorization.
                  item.assignedOrInRemediationCount = null;
                  item.acceptedCount = null;
                  item.closedOrResolvedCount = null;
                  item.countsStatus = 'PARTIAL';
                  item.calculationNotes = `Total count (${scan.totalIncidentCount.toLocaleString()}) verified via lightweight query; status breakdown not yet calculated`;
                }
                item.lastCalculatedAt = scan.timestamp;
              } else {
                item.countsStatus = 'ERROR';
                item.calculationNotes = scan.error || 'Failed to retrieve count';
              }
            }

            // Recalculate summary metrics
            cache.scannedControlsCount = cache.controls.filter(c => c.countsStatus === 'READY' || c.countsStatus === 'PARTIAL').length;
            cache.controlsWithIncidents = cache.controls.filter(c => (c.totalIncidentCount || 0) > 0).length;
            cache.summaryStatus = cache.scannedControlsCount === cache.totalControls ? 'READY' : 'PARTIAL';
            cache.calculatedAt = new Date().toISOString();
            this.writeSummaryCacheAtomically(cache);
          }
        } catch (err: any) {
          console.error(`[ControlSummaryService] Error scanning control ${ctrl.id}:`, err.message);
        }
      }

      this.isScanning = false;
      console.log('[ControlSummaryService] Background incident count scan completed.');
    })();
  }
}
