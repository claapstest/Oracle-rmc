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

  /**
   * Saves a batch of raw Oracle incident objects into PostgreSQL using atomic UPSERT.
   * Stores 100% of the raw JSON object in the `raw_payload` JSONB column.
   */
  public async saveRawIncidentsBatch(
    controlId: string,
    rawIncidents: any[],
    controlName?: string
  ): Promise<number> {
    if (!Array.isArray(rawIncidents) || rawIncidents.length === 0) return 0;

    const host = this.getHost();
    const cleanId = String(controlId).trim();
    const batchSize = 100;
    let totalSaved = 0;

    for (let i = 0; i < rawIncidents.length; i += batchSize) {
      const chunk = rawIncidents.slice(i, i + batchSize);
      const values: any[] = [];
      const rowSnippets: string[] = [];

      chunk.forEach((item, idx) => {
        const incidentId = String(
          item.Id ?? item.id ?? item.IncidentId ?? `INC-${cleanId}-${idx + i + 1}`
        ).trim();

        const status = item.Status ?? item.status ?? item.StatusId ?? null;
        const state = item.State ?? item.state ?? item.StateCode ?? null;
        const priority = item.Priority !== undefined && item.Priority !== null ? String(item.Priority) : null;
        const globalUserName = item.GlobalUserName ?? item.globalUserName ?? null;
        const roleName = item.Role ?? item.role ?? null;

        let creationDate: Date | null = null;
        if (item.CreationDate || item.creationDate) {
          const d = new Date(item.CreationDate || item.creationDate);
          if (!isNaN(d.getTime())) creationDate = d;
        }

        let lastUpdateDate: Date | null = null;
        if (item.LastUpdateDate || item.lastUpdateDate) {
          const d = new Date(item.LastUpdateDate || item.lastUpdateDate);
          if (!isNaN(d.getTime())) lastUpdateDate = d;
        }

        const rawJson = JSON.stringify(item);

        const offset = values.length;
        values.push(
          host,
          cleanId,
          incidentId,
          status,
          state,
          priority,
          globalUserName,
          roleName,
          creationDate,
          lastUpdateDate,
          rawJson
        );

        rowSnippets.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}::jsonb)`
        );
      });

      const sql = `
        INSERT INTO oracle_control_raw_incidents (
          environment_host,
          control_id,
          incident_id,
          status,
          state,
          priority,
          global_user_name,
          role_name,
          oracle_creation_date,
          oracle_last_update_date,
          raw_payload
        )
        VALUES ${rowSnippets.join(', ')}
        ON CONFLICT (environment_host, control_id, incident_id)
        DO UPDATE SET
          status = EXCLUDED.status,
          state = EXCLUDED.state,
          priority = EXCLUDED.priority,
          global_user_name = EXCLUDED.global_user_name,
          role_name = EXCLUDED.role_name,
          oracle_last_update_date = EXCLUDED.oracle_last_update_date,
          raw_payload = EXCLUDED.raw_payload,
          updated_at = NOW()
      `;

      await query(sql, values);
      totalSaved += chunk.length;
    }

    return totalSaved;
  }

  /**
   * Retrieves raw incidents directly from PostgreSQL in <10ms.
   * Returns exact Oracle raw_payload JSON objects preserved without transformation.
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

    const whereClauses = ['environment_host = $1', 'control_id = $2'];
    const params: any[] = [host, cleanId];

    if (options.status && options.status !== 'ALL') {
      params.push(options.status.trim());
      whereClauses.push(`status = $${params.length}`);
    }

    if (options.search && options.search.trim()) {
      params.push(`%${options.search.trim()}%`);
      whereClauses.push(
        `(global_user_name ILIKE $${params.length} OR role_name ILIKE $${params.length} OR incident_id ILIKE $${params.length})`
      );
    }

    const whereSql = whereClauses.join(' AND ');

    // 1. Get total count
    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM oracle_control_raw_incidents WHERE ${whereSql}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    // 2. Fetch page with index optimization
    params.push(limit, offset);
    const dataRes = await query<{ raw_payload: any }>(
      `SELECT raw_payload FROM oracle_control_raw_incidents
       WHERE ${whereSql}
       ORDER BY oracle_last_update_date DESC NULLS LAST, id ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const rawItems = dataRes.rows.map((r) => r.raw_payload);
    return { total, rawItems, count: rawItems.length };
  }

  /**
   * Retrieves the current watermark metadata for a given control.
   */
  public async getWatermark(controlId: string): Promise<ControlWatermarkRecord | null> {
    const host = this.getHost();
    const cleanId = String(controlId).trim();

    const res = await query<ControlWatermarkRecord>(
      `SELECT * FROM oracle_control_sync_watermark WHERE environment_host = $1 AND control_id = $2`,
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
      INSERT INTO oracle_control_sync_watermark (
        environment_host,
        control_id,
        control_name,
        total_incidents,
        synced_incidents,
        last_oracle_update_date,
        last_synced_at,
        last_checked_at,
        sync_status,
        error_message
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        CASE WHEN $7::varchar IN ('READY', 'PARTIAL') THEN NOW() ELSE NULL END,
        NOW(),
        COALESCE($7, 'SYNCING'),
        $8
      )
      ON CONFLICT (environment_host, control_id)
      DO UPDATE SET
        control_name = COALESCE(EXCLUDED.control_name, oracle_control_sync_watermark.control_name),
        total_incidents = COALESCE(EXCLUDED.total_incidents, oracle_control_sync_watermark.total_incidents),
        synced_incidents = COALESCE(EXCLUDED.synced_incidents, oracle_control_sync_watermark.synced_incidents),
        last_oracle_update_date = COALESCE(EXCLUDED.last_oracle_update_date, oracle_control_sync_watermark.last_oracle_update_date),
        last_synced_at = CASE WHEN EXCLUDED.sync_status IN ('READY', 'PARTIAL') THEN NOW() ELSE oracle_control_sync_watermark.last_synced_at END,
        last_checked_at = NOW(),
        sync_status = COALESCE(EXCLUDED.sync_status, oracle_control_sync_watermark.sync_status),
        error_message = EXCLUDED.error_message,
        updated_at = NOW()
    `;

    await query(sql, [
      host,
      cleanId,
      data.controlName || null,
      data.totalIncidents ?? 0,
      data.syncedIncidents ?? 0,
      data.lastOracleUpdateDate || null,
      data.syncStatus || 'SYNCING',
      data.errorMessage || null,
    ]);
  }

  /**
   * Executes the Micro-Watermark Probe against Oracle Fusion REST API.
   * Performs a lightweight 1-record check (<150ms) to detect if Oracle has newer data
   * without re-downloading entire incident datasets.
   */
  public async checkMicroProbe(
    controlId: string,
    client: OracleFusionClient
  ): Promise<MicroProbeResult> {
    const cleanId = String(controlId).trim();
    const watermark = await this.getWatermark(cleanId);
    const dbCountRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM oracle_control_raw_incidents WHERE environment_host = $1 AND control_id = $2`,
      [this.getHost(), cleanId]
    );
    const syncedDbCount = parseInt(dbCountRes.rows[0]?.count || '0', 10);

    // If no incidents exist in DB, initial sync is mandatory
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
      // Micro-Probe: Fetch top 1 record sorted by LastUpdateDate descending
      const probeRes = await client.getAdvancedControlIncidents(cleanId, {
        offset: 0,
        limit: 1,
        totalResults: true,
        timeout: 15000,
      });

      const firstItem = Array.isArray(probeRes?.items) ? probeRes.items[0] : null;
      const oracleLatestStr = firstItem?.LastUpdateDate || firstItem?.lastUpdateDate || null;
      const totalOracleCount = typeof probeRes?.totalResults === 'number' ? probeRes.totalResults : null;

      // Update last_checked_at timestamp in database
      await query(
        `UPDATE oracle_control_sync_watermark SET last_checked_at = NOW(), total_incidents = COALESCE($1, total_incidents) WHERE environment_host = $2 AND control_id = $3`,
        [totalOracleCount, this.getHost(), cleanId]
      );

      if (!oracleLatestStr) {
        // Oracle returned no items or count is 0
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

      // Also check if total count grew in Oracle
      const countMismatch = totalOracleCount !== null && totalOracleCount > syncedDbCount;
      const hasNewerTimestamp = oracleLatestTime > dbLatestTime + 1000; // 1s tolerance

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
      console.warn(`[ControlRawDbService] Micro-probe error for control ${cleanId}:`, err.message);
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
   * Synchronizes all incidents for a control from Oracle Fusion into PostgreSQL raw storage.
   * Efficiently streams in batches, computes latest update date watermark, and updates sync status.
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
    let totalSynced = 0;
    let isFirstPage = true;
    let maxOracleUpdateDate: Date | null = null;

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
            // Track max LastUpdateDate
            for (const item of rawItems) {
              const dtStr = item.LastUpdateDate || item.lastUpdateDate;
              if (dtStr) {
                const dt = new Date(dtStr);
                if (!isNaN(dt.getTime()) && (!maxOracleUpdateDate || dt > maxOracleUpdateDate)) {
                  maxOracleUpdateDate = dt;
                }
              }
            }

            const savedCount = await this.saveRawIncidentsBatch(cleanId, rawItems, controlName);
            totalSynced += savedCount;
          }

          hasMore = res?.hasMore === true && (totalResults > 0 ? totalSynced < totalResults : rawItems.length >= pageSize);
          offset += rawItems.length;

          if (rawItems.length === 0 || !hasMore || (totalResults > 0 && totalSynced >= totalResults)) {
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

      await this.upsertWatermark(cleanId, {
        controlName,
        totalIncidents: totalResults || totalSynced,
        syncedIncidents: totalSynced,
        lastOracleUpdateDate: maxOracleUpdateDate,
        syncStatus: 'READY'
      });

      return { totalSynced, syncStatus: 'READY' };
    } catch (err: any) {
      const status = totalSynced > 0 ? 'PARTIAL' : 'ERROR';
      await this.upsertWatermark(cleanId, {
        controlName,
        totalIncidents: totalResults,
        syncedIncidents: totalSynced,
        syncStatus: status,
        errorMessage: err.message
      });

      return { totalSynced, syncStatus: status, errorMessage: err.message };
    }
  }

  // -------------------------------------------------------------
  // Product-Level Sync Policy Management
  // -------------------------------------------------------------

  /**
   * Retrieves all product-level sync policies.
   */
  public async getProductSyncPolicies(): Promise<ProductSyncPolicyRecord[]> {
    const res = await query<ProductSyncPolicyRecord>(
      `SELECT * FROM product_sync_policy ORDER BY product_code ASC`
    );
    return res.rows;
  }

  /**
   * Retrieves a specific product's sync policy by product code.
   */
  public async getProductSyncPolicy(productCode: string): Promise<ProductSyncPolicyRecord | null> {
    const res = await query<ProductSyncPolicyRecord>(
      `SELECT * FROM product_sync_policy WHERE product_code = $1`,
      [productCode.trim().toUpperCase()]
    );
    return res.rows[0] || null;
  }

  /**
   * Updates a product-level synchronization policy.
   */
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

  /**
   * Records execution of a product-level synchronization run.
   */
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
