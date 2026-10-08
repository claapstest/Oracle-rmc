import { query } from '../db.js';
import { config } from '../config.js';
import { OracleFusionClient } from '../oracle/client.js';

export interface ProductSyncPolicyRecord {
  product_code: string;
  display_name: string;
  sync_cadence: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MANUAL_ONLY';
  sync_interval_hours: number;
  auto_sync_enabled: boolean;
  last_run_at: string | null;
  next_scheduled_at: string | null;
  last_status: 'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ControlWatermarkRecord {
  environment_host: string;
  control_id: string;
  control_name: string | null;
  total_incidents: number;
  synced_incidents: number;
  last_oracle_update_date: string | null;
  last_synced_at: string | null;
  last_checked_at: string;
  sync_status: 'NOT_SYNCED' | 'SYNCING' | 'READY' | 'PARTIAL' | 'ERROR';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface MicroProbeResult {
  hasUpdates: boolean;
  needsInitialSync: boolean;
  oracleLatestUpdateDate: string | null;
  dbLatestUpdateDate: string | null;
  totalOracleCount: number | null;
  syncedDbCount: number;
  syncStatus: string;
  lastSyncedAt: string | null;
}

export class ControlRawDbService {
  private schedulerTimer: NodeJS.Timeout | null = null;
  private isSchedulerRunning = false;

  /**
   * Normalizes the host string for environment isolation (e.g. eiiv-dev14.fa.us6.oraclecloud.com)
   */
  public getHost(): string {
    const rawUrl = (process.env.FUSION_HOST || config.oracle.baseUrl || 'mock.fusion.oracle.com').trim().toLowerCase();
    try {
      if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
        return new URL(rawUrl).host;
      }
    } catch (_) {}
    return rawUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'default_env';
  }

  // =============================================================
  // Raw Control Definition Methods (1 Row per Control)
  // =============================================================

  /**
   * Saves a raw Oracle control definition object into PostgreSQL using atomic UPSERT.
   */
  public async saveRawControl(controlId: string, rawControl: any): Promise<void> {
    if (!rawControl || typeof rawControl !== 'object') return;

    const host = this.getHost();
    const cleanId = String(controlId).trim();
    const name = rawControl.Name ?? rawControl.name ?? null;
    const state = rawControl.StateCode ?? rawControl.State ?? rawControl.state ?? null;
    const status = rawControl.StatusId !== undefined ? String(rawControl.StatusId) : (rawControl.Status ?? rawControl.status ?? null);

    let lastRunDate: Date | null = null;
    if (rawControl.LastRunDate || rawControl.lastRunDate) {
      const d = new Date(rawControl.LastRunDate || rawControl.lastRunDate);
      if (!isNaN(d.getTime())) lastRunDate = d;
    }

    let lastUpdateDate: Date | null = null;
    if (rawControl.LastUpdateDate || rawControl.lastUpdateDate) {
      const d = new Date(rawControl.LastUpdateDate || rawControl.lastUpdateDate);
      if (!isNaN(d.getTime())) lastUpdateDate = d;
    }

    const rawJson = JSON.stringify(rawControl);

    const sql = `
      INSERT INTO oracle_raw_controls (
        environment_host,
        control_id,
        name,
        state,
        status,
        oracle_last_run_date,
        oracle_last_update_date,
        raw_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      ON CONFLICT (environment_host, control_id)
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, oracle_raw_controls.name),
        state = COALESCE(EXCLUDED.state, oracle_raw_controls.state),
        status = COALESCE(EXCLUDED.status, oracle_raw_controls.status),
        oracle_last_run_date = COALESCE(EXCLUDED.oracle_last_run_date, oracle_raw_controls.oracle_last_run_date),
        oracle_last_update_date = COALESCE(EXCLUDED.oracle_last_update_date, oracle_raw_controls.oracle_last_update_date),
        raw_payload = EXCLUDED.raw_payload,
        updated_at = NOW()
    `;

    await query(sql, [host, cleanId, name, state, status, lastRunDate, lastUpdateDate, rawJson]);
  }

  /**
   * Retrieves raw control definition from PostgreSQL in <5ms.
   */
  public async getRawControl(controlId: string): Promise<any | null> {
    const host = this.getHost();
    const cleanId = String(controlId).trim();

    const res = await query<{ raw_payload: any }>(
      `SELECT raw_payload FROM oracle_raw_controls WHERE environment_host = $1 AND control_id = $2`,
      [host, cleanId]
    );

    return res.rows[0]?.raw_payload || null;
  }

  /**
   * Retrieves all raw control definitions from PostgreSQL for current environment.
   */
  public async getAllRawControls(): Promise<any[]> {
    const host = this.getHost();

    const res = await query<{ raw_payload: any }>(
      `SELECT raw_payload FROM oracle_raw_controls WHERE environment_host = $1 ORDER BY name ASC`,
      [host]
    );

    return res.rows.map((r) => r.raw_payload);
  }

  // =============================================================
  // Single-Cell Raw Incidents Storage (EXACTLY 1 Row per Control)
  // =============================================================

  /**
   * Saves ALL incidents for a control into a SINGLE cell (`raw_incidents` JSONB).
   * Ensures exactly ONE row exists per control ID in `oracle_control_incidents`.
   */
  public async saveControlRawIncidents(
    controlId: string,
    rawIncidents: any[],
    controlName?: string,
    totalCount?: number,
    lastOracleUpdateDate?: Date | null
  ): Promise<number> {
    if (!Array.isArray(rawIncidents)) return 0;

    const host = this.getHost();
    const cleanId = String(controlId).trim();
    const total = typeof totalCount === 'number' ? totalCount : rawIncidents.length;

    // Detect latest update date if not provided
    let maxDate = lastOracleUpdateDate || null;
    if (!maxDate) {
      for (const item of rawIncidents) {
        const dtStr = item?.LastUpdateDate || item?.lastUpdateDate;
        if (dtStr) {
          const d = new Date(dtStr);
          if (!isNaN(d.getTime()) && (!maxDate || d > maxDate)) {
            maxDate = d;
          }
        }
      }
    }

    const rawJson = JSON.stringify(rawIncidents);

    const sql = `
      INSERT INTO oracle_control_incidents (
        environment_host,
        control_id,
        control_name,
        total_incidents,
        last_oracle_update_date,
        last_synced_at,
        sync_status,
        raw_incidents,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), 'READY', $6::jsonb, NOW())
      ON CONFLICT (environment_host, control_id)
      DO UPDATE SET
        control_name = COALESCE(EXCLUDED.control_name, oracle_control_incidents.control_name),
        total_incidents = EXCLUDED.total_incidents,
        last_oracle_update_date = COALESCE(EXCLUDED.last_oracle_update_date, oracle_control_incidents.last_oracle_update_date),
        last_synced_at = NOW(),
        sync_status = 'READY',
        raw_incidents = EXCLUDED.raw_incidents,
        updated_at = NOW()
    `;

    await query(sql, [host, cleanId, controlName || null, total, maxDate, rawJson]);
    return rawIncidents.length;
  }

  /**
   * Appends or replaces raw incidents in the single cell.
   */
  public async saveRawIncidentsBatch(
    controlId: string,
    rawIncidents: any[],
    controlName?: string
  ): Promise<number> {
    return this.saveControlRawIncidents(controlId, rawIncidents, controlName);
  }

  /**
   * Retrieves raw incidents directly from the single JSONB cell in <5ms.
   * Performs in-memory filtering and pagination on the raw Oracle JSON array.
   */
  public async getRawIncidents(
    controlId: string,
    options: {
      offset?: number;
      limit?: number;
      status?: string;
      search?: string;
    } = {}
  ): Promise<{ total: number; rawItems: any[]; count: number }> {
    const host = this.getHost();
    const cleanId = String(controlId).trim();
    const limit = Math.min(500, Math.max(1, options.limit || 50));
    const offset = Math.max(0, options.offset || 0);

    const res = await query<{
      raw_incidents: any;
      total_incidents: number;
    }>(
      `SELECT raw_incidents, total_incidents FROM oracle_control_incidents
       WHERE environment_host = $1 AND control_id = $2`,
      [host, cleanId]
    );

    const row = res.rows[0];
    if (!row || !Array.isArray(row.raw_incidents)) {
      return { total: 0, rawItems: [], count: 0 };
    }

    let allItems: any[] = row.raw_incidents;

    // Optional in-memory status filter
    if (options.status && options.status !== 'ALL') {
      const st = options.status.trim().toUpperCase();
      allItems = allItems.filter(
        (it) => String(it.Status || it.status || it.StatusId || '').toUpperCase() === st
      );
    }

    // Optional in-memory search filter
    if (options.search && options.search.trim()) {
      const q = options.search.trim().toLowerCase();
      allItems = allItems.filter((it) => {
        const u = String(it.GlobalUserName || it.globalUserName || '').toLowerCase();
        const r = String(it.Role || it.role || '').toLowerCase();
        const id = String(it.Id || it.id || '').toLowerCase();
        return u.includes(q) || r.includes(q) || id.includes(q);
      });
    }

    const total = allItems.length;
    const rawItems = allItems.slice(offset, offset + limit);
    return { total, rawItems, count: rawItems.length };
  }

  /**
   * Retrieves the raw incidents array directly in its exact raw form as returned from Oracle Fusion.
   */
  public async getAllRawIncidentsForControl(controlId: string): Promise<any[]> {
    const host = this.getHost();
    const cleanId = String(controlId).trim();

    const res = await query<{ raw_incidents: any }>(
      `SELECT raw_incidents FROM oracle_control_incidents WHERE environment_host = $1 AND control_id = $2`,
      [host, cleanId]
    );

    return Array.isArray(res.rows[0]?.raw_incidents) ? res.rows[0].raw_incidents : [];
  }

  // =============================================================
  // Watermark & Change Detection
  // =============================================================

  /**
   * Retrieves the current watermark metadata for a given control.
   */
  public async getWatermark(controlId: string): Promise<ControlWatermarkRecord | null> {
    const host = this.getHost();
    const cleanId = String(controlId).trim();

    const res = await query<any>(
      `SELECT
        environment_host,
        control_id,
        control_name,
        total_incidents,
        COALESCE(jsonb_array_length(raw_incidents), 0) as synced_incidents,
        last_oracle_update_date,
        last_synced_at,
        updated_at as last_checked_at,
        sync_status,
        NULL as error_message,
        created_at,
        updated_at
       FROM oracle_control_incidents
       WHERE environment_host = $1 AND control_id = $2`,
      [host, cleanId]
    );

    return res.rows[0] || null;
  }

  /**
   * Updates or initializes control sync watermark metadata.
   */
  public async upsertWatermark(
    controlId: string,
    data: {
      controlName?: string;
      totalIncidents?: number;
      syncedIncidents?: number;
      lastOracleUpdateDate?: Date | null;
      syncStatus?: 'NOT_SYNCED' | 'SYNCING' | 'READY' | 'PARTIAL' | 'ERROR';
      errorMessage?: string | null;
    }
  ): Promise<void> {
    const host = this.getHost();
    const cleanId = String(controlId).trim();

    const sql = `
      INSERT INTO oracle_control_incidents (
        environment_host,
        control_id,
        control_name,
        total_incidents,
        last_oracle_update_date,
        last_synced_at,
        sync_status,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5,
        CASE WHEN $6::varchar IN ('READY', 'PARTIAL') THEN NOW() ELSE NULL END,
        COALESCE($6, 'SYNCING'),
        NOW()
      )
      ON CONFLICT (environment_host, control_id)
      DO UPDATE SET
        control_name = COALESCE(EXCLUDED.control_name, oracle_control_incidents.control_name),
        total_incidents = COALESCE(EXCLUDED.total_incidents, oracle_control_incidents.total_incidents),
        last_oracle_update_date = COALESCE(EXCLUDED.last_oracle_update_date, oracle_control_incidents.last_oracle_update_date),
        last_synced_at = CASE WHEN EXCLUDED.sync_status IN ('READY', 'PARTIAL') THEN NOW() ELSE oracle_control_incidents.last_synced_at END,
        sync_status = COALESCE(EXCLUDED.sync_status, oracle_control_incidents.sync_status),
        updated_at = NOW()
    `;

    await query(sql, [
      host,
      cleanId,
      data.controlName || null,
      data.totalIncidents ?? 0,
      data.lastOracleUpdateDate || null,
      data.syncStatus || 'SYNCING',
    ]);
  }

  /**
   * Executes the Micro-Watermark Probe against Oracle Fusion REST API.
   * Performs a lightweight 1-record check (<150ms) to detect if Oracle has newer data.
   */
  public async checkMicroProbe(
    controlId: string,
    client: OracleFusionClient
  ): Promise<MicroProbeResult> {
    const cleanId = String(controlId).trim();
    const watermark = await this.getWatermark(cleanId);
    const syncedDbCount = watermark?.synced_incidents || 0;

    if (syncedDbCount === 0 || !watermark) {
      return {
        hasUpdates: true,
        needsInitialSync: true,
        oracleLatestUpdateDate: null,
        dbLatestUpdateDate: watermark?.last_oracle_update_date || null,
        totalOracleCount: null,
        syncedDbCount,
        syncStatus: watermark?.sync_status || 'NOT_SYNCED',
        lastSyncedAt: watermark?.last_synced_at || null,
      };
    }

    try {
      const probeRes = await client.getAdvancedControlIncidents(cleanId, {
        offset: 0,
        limit: 1,
        totalResults: true,
        timeout: 15000,
      });

      const firstItem = Array.isArray(probeRes?.items) ? probeRes.items[0] : null;
      const oracleLatestStr = firstItem?.LastUpdateDate || firstItem?.lastUpdateDate || null;
      const totalOracleCount = typeof probeRes?.totalResults === 'number' ? probeRes.totalResults : null;

      await query(
        `UPDATE oracle_control_incidents SET updated_at = NOW(), total_incidents = COALESCE($1, total_incidents) WHERE environment_host = $2 AND control_id = $3`,
        [totalOracleCount, this.getHost(), cleanId]
      );

      if (!oracleLatestStr) {
        return {
          hasUpdates: false,
          needsInitialSync: false,
          oracleLatestUpdateDate: null,
          dbLatestUpdateDate: watermark.last_oracle_update_date,
          totalOracleCount: 0,
          syncedDbCount,
          syncStatus: watermark.sync_status,
          lastSyncedAt: watermark.last_synced_at,
        };
      }

      const oracleLatestTime = new Date(oracleLatestStr).getTime();
      const dbLatestTime = watermark.last_oracle_update_date
        ? new Date(watermark.last_oracle_update_date).getTime()
        : 0;

      const countMismatch = totalOracleCount !== null && totalOracleCount > syncedDbCount;
      const hasNewerTimestamp = oracleLatestTime > dbLatestTime + 1000;
      const hasUpdates = hasNewerTimestamp || countMismatch;

      return {
        hasUpdates,
        needsInitialSync: false,
        oracleLatestUpdateDate: oracleLatestStr,
        dbLatestUpdateDate: watermark.last_oracle_update_date,
        totalOracleCount,
        syncedDbCount,
        syncStatus: watermark.sync_status,
        lastSyncedAt: watermark.last_synced_at,
      };
    } catch (err: any) {
      return {
        hasUpdates: false,
        needsInitialSync: false,
        oracleLatestUpdateDate: null,
        dbLatestUpdateDate: watermark.last_oracle_update_date,
        totalOracleCount: watermark.total_incidents,
        syncedDbCount,
        syncStatus: watermark.sync_status,
        lastSyncedAt: watermark.last_synced_at,
      };
    }
  }

  /**
   * Synchronizes all incidents for a control from Oracle Fusion into the single JSONB cell in PostgreSQL.
   * Efficiently streams in batches, compiles into a single raw array, and updates the single control row.
   */
  public async syncControlIncidents(
    controlId: string,
    client: OracleFusionClient,
    controlName?: string
  ): Promise<{ totalSynced: number; syncStatus: 'READY' | 'PARTIAL' | 'ERROR'; errorMessage?: string }> {
    const cleanId = String(controlId).trim();

    await this.upsertWatermark(cleanId, {
      controlName,
      syncStatus: 'SYNCING'
    });

    let pageSize = 500;
    let offset = 0;
    let hasMore = true;
    let totalResults = 0;
    let isFirstPage = true;
    let maxOracleUpdateDate: Date | null = null;
    const allRawItems: any[] = [];

    try {
      while (hasMore) {
        try {
          const res = await client.getAdvancedControlIncidents(cleanId, {
            offset,
            limit: pageSize,
            totalResults: isFirstPage
          });

          if (isFirstPage) {
            if (res?.totalResults !== undefined && res?.totalResults !== null) {
              totalResults = parseInt(String(res.totalResults), 10) || 0;
            } else {
              totalResults = Array.isArray(res?.items) ? res.items.length : 0;
            }
            isFirstPage = false;
          }

          const rawItems: any[] = Array.isArray(res?.items) ? res.items : [];
          if (rawItems.length > 0) {
            allRawItems.push(...rawItems);
            for (const item of rawItems) {
              const dtStr = item.LastUpdateDate || item.lastUpdateDate;
              if (dtStr) {
                const dt = new Date(dtStr);
                if (!isNaN(dt.getTime()) && (!maxOracleUpdateDate || dt > maxOracleUpdateDate)) {
                  maxOracleUpdateDate = dt;
                }
              }
            }
          }

          hasMore = res?.hasMore === true && (totalResults > 0 ? allRawItems.length < totalResults : rawItems.length >= pageSize);
          offset += rawItems.length;

          if (rawItems.length === 0 || !hasMore || (totalResults > 0 && allRawItems.length >= totalResults)) {
            break;
          }
        } catch (batchErr: any) {
          if (pageSize > 100) {
            pageSize = 100;
            continue;
          } else if (pageSize > 25) {
            pageSize = 25;
            continue;
          }
          throw batchErr;
        }
      }

      // Store ALL raw incidents into that single cell in 1 single row!
      await this.saveControlRawIncidents(cleanId, allRawItems, controlName, totalResults || allRawItems.length, maxOracleUpdateDate);

      return { totalSynced: allRawItems.length, syncStatus: 'READY' };
    } catch (err: any) {
      if (allRawItems.length > 0) {
        await this.saveControlRawIncidents(cleanId, allRawItems, controlName, totalResults, maxOracleUpdateDate);
      }
      return { totalSynced: allRawItems.length, syncStatus: allRawItems.length > 0 ? 'PARTIAL' : 'ERROR', errorMessage: err.message };
    }
  }

  // =============================================================
  // Automatic Background Sync Scheduler
  // =============================================================

  /**
   * Starts the automatic background synchronization scheduler.
   * Periodically checks controls for updates in Oracle Fusion Cloud and updates the database automatically.
   */
  public startAutoSyncScheduler(oracleServiceOrClient: any, intervalMinutes = 15): void {
    if (this.schedulerTimer) return;

    console.log(`[AutoSyncScheduler] Initialized. Background sync interval: ${intervalMinutes} minutes.`);

    // Run first check after 20 seconds of server startup
    setTimeout(() => {
      this.runAutoSyncCycle(oracleServiceOrClient).catch((err) => {
        console.error('[AutoSyncScheduler] Initial run error:', err.message);
      });
    }, 20000);

    // Run recurring periodic checks
    this.schedulerTimer = setInterval(() => {
      this.runAutoSyncCycle(oracleServiceOrClient).catch((err) => {
        console.error('[AutoSyncScheduler] Cycle error:', err.message);
      });
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Runs an automated update cycle across all stored controls.
   */
  public async runAutoSyncCycle(oracleServiceOrClient: any): Promise<void> {
    if (this.isSchedulerRunning) return;
    this.isSchedulerRunning = true;

    try {
      const client: OracleFusionClient =
        typeof oracleServiceOrClient.getClient === 'function'
          ? oracleServiceOrClient.getClient()
          : oracleServiceOrClient;

      // 1. Get all controls currently stored in database
      const host = this.getHost();
      const res = await query<{ control_id: string; control_name: string }>(
        `SELECT control_id, control_name FROM oracle_control_incidents WHERE environment_host = $1`,
        [host]
      );

      const controls = res.rows;
      if (controls.length === 0) {
        return;
      }

      console.log(`[AutoSyncScheduler] Checking ${controls.length} controls for Oracle updates...`);

      for (const ctrl of controls) {
        try {
          const probe = await this.checkMicroProbe(ctrl.control_id, client);
          if (probe.hasUpdates) {
            console.log(
              `[AutoSyncScheduler] Control ${ctrl.control_id} has newer data in Oracle. Updating database automatically...`
            );
            await this.syncControlIncidents(ctrl.control_id, client, ctrl.control_name);
            console.log(`[AutoSyncScheduler] Control ${ctrl.control_id} successfully auto-synced.`);
          }
        } catch (probeErr: any) {
          console.warn(`[AutoSyncScheduler] Probe check warning for control ${ctrl.control_id}:`, probeErr.message);
        }
      }

      await this.recordProductSyncRun('RISK_CONTROLS', 'SUCCESS');
    } catch (err: any) {
      console.error('[AutoSyncScheduler] Auto-sync cycle error:', err.message);
      await this.recordProductSyncRun('RISK_CONTROLS', 'FAILED', err.message);
    } finally {
      this.isSchedulerRunning = false;
    }
  }

  // =============================================================
  // Product-Level Sync Policy Management
  // =============================================================

  public async getProductSyncPolicies(): Promise<ProductSyncPolicyRecord[]> {
    const res = await query<ProductSyncPolicyRecord>(
      `SELECT * FROM product_sync_policy ORDER BY product_code ASC`
    );
    return res.rows;
  }

  public async getProductSyncPolicy(productCode: string): Promise<ProductSyncPolicyRecord | null> {
    const res = await query<ProductSyncPolicyRecord>(
      `SELECT * FROM product_sync_policy WHERE product_code = $1`,
      [productCode.trim().toUpperCase()]
    );
    return res.rows[0] || null;
  }

  public async updateProductSyncPolicy(
    productCode: string,
    updates: {
      syncCadence?: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MANUAL_ONLY';
      syncIntervalHours?: number;
      autoSyncEnabled?: boolean;
    }
  ): Promise<ProductSyncPolicyRecord | null> {
    const code = productCode.trim().toUpperCase();
    const setClauses: string[] = ['updated_at = NOW()'];
    const params: any[] = [code];

    if (updates.syncCadence) {
      params.push(updates.syncCadence);
      setClauses.push(`sync_cadence = $${params.length}`);
    }

    if (typeof updates.syncIntervalHours === 'number' && updates.syncIntervalHours > 0) {
      params.push(updates.syncIntervalHours);
      setClauses.push(`sync_interval_hours = $${params.length}`);
    }

    if (typeof updates.autoSyncEnabled === 'boolean') {
      params.push(updates.autoSyncEnabled);
      setClauses.push(`auto_sync_enabled = $${params.length}`);
    }

    const sql = `
      UPDATE product_sync_policy
      SET ${setClauses.join(', ')}
      WHERE product_code = $1
      RETURNING *
    `;

    const res = await query<ProductSyncPolicyRecord>(sql, params);
    return res.rows[0] || null;
  }

  public async recordProductSyncRun(
    productCode: string,
    status: 'RUNNING' | 'SUCCESS' | 'FAILED',
    errorMessage?: string | null
  ): Promise<void> {
    const code = productCode.trim().toUpperCase();
    const sql = `
      UPDATE product_sync_policy
      SET
        last_status = $2,
        last_error = $3,
        last_run_at = CASE WHEN $2 IN ('SUCCESS', 'FAILED') THEN NOW() ELSE last_run_at END,
        next_scheduled_at = CASE
          WHEN $2 = 'SUCCESS' THEN NOW() + (sync_interval_hours || ' hours')::interval
          ELSE next_scheduled_at
        END,
        updated_at = NOW()
      WHERE product_code = $1
    `;

    await query(sql, [code, status, errorMessage || null]);
  }
}

export const controlRawDbService = new ControlRawDbService();
