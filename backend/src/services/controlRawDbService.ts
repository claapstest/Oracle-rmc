import { query } from '../db.js';
import { config } from '../config.js';
import { OracleFusionClient } from '../oracle/client.js';
import { encryptRawField, decryptRawField, trackingColumns } from '../security/encryptedRecordWriter.js';
import { decryptRawRows, decryptSingleRawField } from '../security/decryptedRecordReader.js';

/**
 * Largest page the cross-control incident reader will serve in one round trip.
 * Interactive tables ask for 25-100; bulk exports ask for this value and page
 * through the result set until the filtered total is reached.
 */
export const MAX_BULK_INCIDENT_PAGE_SIZE = 5000;

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

export interface IncidentQueryFilters {
  statuses?: string[];
  status?: string;
  states?: string[];
  state?: string;
  search?: string;
  searchTerms?: string[];
  priority?: string;
  user?: string;
  role?: string;
  globalUser?: string;
  accessEntitlement?: string;
  accessPointName?: string;
  accessPointType?: string;
  groupingValue?: string;
  group?: string;
  dataSource?: string;
  incidentInformation?: string;
  createdBy?: string;
  investigator?: string;
  lastUpdatedBy?: string;
}

export interface ControlIncidentFacets {
  createdBy: string[];
  investigator: string[];
  lastUpdatedBy: string[];
  states: string[];
  accessPointTypes: string[];
  dataSources: string[];
  groups: string[];
  priorities: string[];
}

export class ControlRawDbService {
  private schedulerTimer: NodeJS.Timeout | null = null;
  private isSchedulerRunning = false;
  private incidentCountCacheService: any = null;
  private summaryHealedOnce = false;
  private facetsCache = new Map<string, { facets: ControlIncidentFacets; cachedAt: number }>();
  private incidentRowsInitPromise: Promise<void> | null = null;
  private incidentRowsReady = false;

  public setIncidentCountCacheService(service: any): void {
    this.incidentCountCacheService = service;
  }

  /**
   * Normalizes the host string for environment isolation (e.g. eiiv-dev14.fa.us6.oraclecloud.com)
   */
  public getHost(): string {
    const rawUrl = (process.env.FUSION_HOST || config.oracle.baseUrl || 'eiiv-dev14.fa.us6.oraclecloud.com').trim().toLowerCase();
    try {
      if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
        return new URL(rawUrl).host;
      }
    } catch (_) {}
    return rawUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'eiiv-dev14.fa.us6.oraclecloud.com';
  }

  // =============================================================
  // Raw Control Definition Methods (1 Row per Control)
  // =============================================================

  /**
   * Breakdown columns are already migrated in PostgreSQL schema.
   * Runtime execution is disabled to prevent AccessExclusiveLock table deadlocks.
   */
  public async initSchema(): Promise<void> {
    return;
  }


  /**
   * Categorizes raw incidents into the 4 Oracle Incident Lifecycle Statuses:
   * Assigned, Accepted, Remediate, Resolved
   */
  public calculateIncidentBreakdown(rawIncidents: any[]): {
    assigned: number;
    accepted: number;
    remediate: number;
    resolved: number;
  } {
    let assigned = 0;
    let accepted = 0;
    let remediate = 0;
    let resolved = 0;

    if (!Array.isArray(rawIncidents)) {
      return { assigned, accepted, remediate, resolved };
    }

    for (const item of rawIncidents) {
      if (!item) continue;
      const statusStr = String(item.Status ?? item.status ?? '').trim().toUpperCase();
      const stateStr = String(item.State ?? item.state ?? item.StateCode ?? '').trim().toUpperCase();
      const isClosed = Boolean(item.ClosedDate || item.closedDate);

      if (statusStr.includes('ACCEPT') || stateStr.includes('ACCEPT')) {
        accepted++;
      } else if (statusStr.includes('REMEDIAT') || stateStr.includes('REMEDIAT')) {
        remediate++;
      } else if (
        statusStr.includes('RESOLV') ||
        statusStr.includes('CLOSE') ||
        stateStr.includes('RESOLV') ||
        stateStr.includes('CLOSE') ||
        isClosed
      ) {
        resolved++;
      } else {
        assigned++;
      }
    }

    return { assigned, accepted, remediate, resolved };
  }

  /**
   * Saves a raw Oracle control definition object into PostgreSQL using atomic UPSERT.
   * Accurately preserves and normalizes ACTIVE vs INACTIVE control status.
   */
  public async saveRawControl(controlId: string, rawControl: any): Promise<void> {
    if (!rawControl || typeof rawControl !== 'object') return;

    const host = this.getHost();
    const cleanId = String(controlId).trim();
    const name = rawControl.Name ?? rawControl.name ?? null;
    const state = rawControl.StateCode ?? rawControl.State ?? rawControl.state ?? null;

    // Accurately normalize status to ACTIVE or INACTIVE
    let status = rawControl.Status ?? rawControl.status ?? null;
    if (rawControl.StatusId !== undefined && rawControl.StatusId !== null) {
      status = Number(rawControl.StatusId) === 1 ? 'ACTIVE' : 'INACTIVE';
    }
    if (typeof status === 'string') {
      status = status.toUpperCase();
    }

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

    // Ensure Priority is mapped from EnforcementType
    if (rawControl.Priority === undefined && rawControl.EnforcementType !== undefined) {
      rawControl.Priority = rawControl.EnforcementType;
    }
    delete rawControl.ScheduledBy;
    delete rawControl.LatestJobId;

    const write = await encryptRawField('oracle_raw_controls', { control_id: cleanId }, rawControl, host);

    const sql = `
      INSERT INTO oracle_raw_controls (
        environment_host,
        control_id,
        name,
        state,
        status,
        oracle_last_run_date,
        oracle_last_update_date,
        raw_payload,
        is_encrypted,
        encryption_format_version,
        encryption_key_id,
        encrypted_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
      ON CONFLICT (environment_host, control_id)
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, oracle_raw_controls.name),
        state = COALESCE(EXCLUDED.state, oracle_raw_controls.state),
        status = COALESCE(EXCLUDED.status, oracle_raw_controls.status),
        oracle_last_run_date = COALESCE(EXCLUDED.oracle_last_run_date, oracle_raw_controls.oracle_last_run_date),
        oracle_last_update_date = COALESCE(EXCLUDED.oracle_last_update_date, oracle_raw_controls.oracle_last_update_date),
        raw_payload = EXCLUDED.raw_payload,
        is_encrypted = EXCLUDED.is_encrypted,
        encryption_format_version = EXCLUDED.encryption_format_version,
        encryption_key_id = EXCLUDED.encryption_key_id,
        encrypted_at = EXCLUDED.encrypted_at,
        updated_at = NOW()
    `;

    await query(sql, [host, cleanId, name, state, status, lastRunDate, lastUpdateDate, write.rawValue, ...trackingColumns(write)]);
  }

  /**
   * Retrieves raw control definition from PostgreSQL in <5ms.
   */
  public async getRawControl(controlId: string): Promise<any | null> {
    const host = this.getHost();
    const cleanId = String(controlId).trim();

    const res = await query<{ raw_payload: any; is_encrypted: boolean; control_id: string }>(
      `SELECT raw_payload, is_encrypted, control_id FROM oracle_raw_controls
       WHERE (environment_host = $1 OR environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com') AND control_id = $2
       ORDER BY (CASE WHEN environment_host = $1 THEN 0 ELSE 1 END) LIMIT 1`,
      [host, cleanId]
    );

    if (!res.rows[0]) return null;
    return decryptSingleRawField('oracle_raw_controls', 'raw_payload', res.rows[0], host);
  }

  /**
   * Retrieves all raw control definitions from PostgreSQL for current environment.
   */
  public async getAllRawControls(): Promise<any[]> {
    const host = this.getHost();

    const res = await query<{ raw_payload: any; is_encrypted: boolean; control_id: string }>(
      `SELECT raw_payload, is_encrypted, control_id FROM oracle_raw_controls
       WHERE (environment_host = $1 OR environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com')
       ORDER BY (CASE WHEN environment_host = $1 THEN 0 ELSE 1 END), name ASC`,
      [host]
    );

    const decrypted = await decryptRawRows('oracle_raw_controls', 'raw_payload', res.rows, host);
    return decrypted.map((r) => r.raw_payload);
  }

  /**
   * Retrieves high-level incident breakdown and totals for all saved controls in <5ms.
   */
  public async getAllControlIncidentsSummary(): Promise<Array<{
    control_id: string;
    control_name: string | null;
    total_incidents: number;
    assigned_incidents: number;
    accepted_incidents: number;
    remediate_incidents: number;
    resolved_incidents: number;
    last_oracle_update_date: string | null;
    last_synced_at: string | null;
  }>> {
    const host = this.getHost();
    // One-time startup auto-heal for controls where raw_incidents exceeds total_incidents (avoids per-request TOAST scans)
    if (!this.summaryHealedOnce) {
      this.summaryHealedOnce = true;
      try {
        await query(
          `UPDATE oracle_control_incidents
           SET total_incidents = jsonb_array_length(raw_incidents),
               assigned_incidents = CASE 
                 WHEN COALESCE(assigned_incidents, 0) = 0 THEN 
                   GREATEST(0, jsonb_array_length(raw_incidents) - COALESCE(accepted_incidents, 0) - COALESCE(remediate_incidents, 0) - COALESCE(resolved_incidents, 0))
                 ELSE assigned_incidents 
               END,
               updated_at = NOW()
           WHERE jsonb_typeof(raw_incidents) = 'array' 
             AND jsonb_array_length(raw_incidents) > COALESCE(total_incidents, 0)`
        );
      } catch (_) {}
    }

    const res = await query<{
      control_id: string;
      control_name: string | null;
      total_incidents: number;
      assigned_incidents: number;
      accepted_incidents: number;
      remediate_incidents: number;
      resolved_incidents: number;
      last_oracle_update_date: string | null;
      last_synced_at: string | null;
    }>(
      `SELECT 
         control_id, 
         control_name, 
         COALESCE(total_incidents, 0) AS total_incidents,
         CASE 
           WHEN COALESCE(assigned_incidents, 0) = 0 THEN 
             GREATEST(0, COALESCE(total_incidents, 0) - COALESCE(accepted_incidents, 0) - COALESCE(remediate_incidents, 0) - COALESCE(resolved_incidents, 0))
           ELSE assigned_incidents 
         END AS assigned_incidents,
         COALESCE(accepted_incidents, 0) AS accepted_incidents,
         COALESCE(remediate_incidents, 0) AS remediate_incidents,
         COALESCE(resolved_incidents, 0) AS resolved_incidents,
         last_oracle_update_date, 
         last_synced_at
       FROM oracle_control_incidents
       WHERE (environment_host = $1 OR environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com')
       ORDER BY (CASE WHEN environment_host = $1 THEN 0 ELSE 1 END), control_id ASC`,
      [host]
    );

    return res.rows;
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

    const breakdown = this.calculateIncidentBreakdown(rawIncidents);

    const write = await encryptRawField('oracle_control_incidents', { control_id: cleanId }, rawIncidents, host);

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
        assigned_incidents,
        accepted_incidents,
        remediate_incidents,
        resolved_incidents,
        is_encrypted,
        encryption_format_version,
        encryption_key_id,
        encrypted_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), 'READY', $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
      ON CONFLICT (environment_host, control_id)
      DO UPDATE SET
        control_name = COALESCE(EXCLUDED.control_name, oracle_control_incidents.control_name),
        total_incidents = EXCLUDED.total_incidents,
        last_oracle_update_date = COALESCE(EXCLUDED.last_oracle_update_date, oracle_control_incidents.last_oracle_update_date),
        last_synced_at = NOW(),
        sync_status = 'READY',
        raw_incidents = EXCLUDED.raw_incidents,
        assigned_incidents = EXCLUDED.assigned_incidents,
        accepted_incidents = EXCLUDED.accepted_incidents,
        remediate_incidents = EXCLUDED.remediate_incidents,
        resolved_incidents = EXCLUDED.resolved_incidents,
        is_encrypted = EXCLUDED.is_encrypted,
        encryption_format_version = EXCLUDED.encryption_format_version,
        encryption_key_id = EXCLUDED.encryption_key_id,
        encrypted_at = EXCLUDED.encrypted_at,
        updated_at = NOW()
    `;

    await query(sql, [
      host,
      cleanId,
      controlName || null,
      total,
      maxDate,
      write.rawValue,
      breakdown.assigned,
      breakdown.accepted,
      breakdown.remediate,
      breakdown.resolved,
      ...trackingColumns(write)
    ]);

    // Update fast incident count cache immediately with exact 4-status distribution
    if (this.incidentCountCacheService && typeof this.incidentCountCacheService.setCount === 'function') {
      try {
        this.incidentCountCacheService.setCount(cleanId, total, 'READY', breakdown);
      } catch (_) {}
    }

    // Invalidate facets cache and sync indexed row table for this control
    this.facetsCache.delete(`${host}|${cleanId}`);
    this.syncSingleControlRowsFromDb(host, cleanId).catch(() => {});

    return rawIncidents.length;
  }

  /**
   * Ensures normalized indexed table `oracle_incident_rows` exists and is backfilled
   * from `oracle_control_incidents` (idempotent, runs once in background or on boot).
   */
  public async ensureIncidentRowsInitialized(): Promise<void> {
    if (this.incidentRowsReady) return;
    if (this.incidentRowsInitPromise) return this.incidentRowsInitPromise;

    this.incidentRowsInitPromise = (async () => {
      try {
        await query(`
          CREATE TABLE IF NOT EXISTS oracle_incident_rows (
            environment_host TEXT NOT NULL,
            control_id TEXT NOT NULL,
            control_name TEXT,
            ord INTEGER NOT NULL,
            result_id TEXT DEFAULT '',
            status TEXT DEFAULT '',
            state TEXT DEFAULT '',
            lifecycle VARCHAR(16) NOT NULL DEFAULT 'ASSIGNED',
            priority TEXT DEFAULT '',
            global_user TEXT DEFAULT '',
            role_name TEXT DEFAULT '',
            access_entitlement TEXT DEFAULT '',
            access_point_name TEXT DEFAULT '',
            access_point_type TEXT DEFAULT '',
            grouping_value TEXT DEFAULT '',
            group_name TEXT DEFAULT '',
            data_source TEXT DEFAULT '',
            incident_information TEXT DEFAULT '',
            created_by TEXT DEFAULT '',
            investigator TEXT DEFAULT '',
            last_updated_by TEXT DEFAULT '',
            raw JSONB NOT NULL,
            PRIMARY KEY (environment_host, control_id, ord)
          );
          CREATE INDEX IF NOT EXISTS ix_oracle_inc_rows_ctrl_life_ord
            ON oracle_incident_rows (environment_host, control_id, lifecycle, ord);
          CREATE INDEX IF NOT EXISTS ix_oracle_inc_rows_life_ctrl_ord
            ON oracle_incident_rows (environment_host, lifecycle, control_id, ord);
          CREATE INDEX IF NOT EXISTS ix_oracle_inc_rows_ctrl_resid
            ON oracle_incident_rows (environment_host, control_id, result_id);
          CREATE TABLE IF NOT EXISTS oracle_incident_rows_sync (
            environment_host TEXT NOT NULL,
            control_id TEXT NOT NULL,
            control_name TEXT,
            row_count INTEGER NOT NULL DEFAULT 0,
            last_synced_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (environment_host, control_id)
          );
        `);

        const pendingRes = await query<{ environment_host: string; control_id: string }>(`
          SELECT c.environment_host, c.control_id
          FROM oracle_control_incidents c
          LEFT JOIN oracle_incident_rows_sync s
            ON s.environment_host = c.environment_host AND s.control_id = c.control_id
          WHERE (jsonb_typeof(c.raw_incidents) = 'array'
             OR (jsonb_typeof(c.raw_incidents) = 'object' AND COALESCE(c.is_encrypted, false) = true))
            AND (s.control_id IS NULL OR (c.last_synced_at IS NOT NULL AND s.last_synced_at < c.last_synced_at))
          ORDER BY c.control_id
        `);

        if (pendingRes.rows.length > 0) {
          console.log(`[ControlRawDbService] Indexing ${pendingRes.rows.length} control(s) into oracle_incident_rows...`);
          for (const row of pendingRes.rows) {
            await this.syncSingleControlRowsFromDb(row.environment_host, row.control_id);
          }
          console.log(`[ControlRawDbService] Finished indexing ${pendingRes.rows.length} control(s) into oracle_incident_rows.`);
        }

        this.incidentRowsReady = true;
      } catch (err: any) {
        console.warn('[ControlRawDbService] Incident row index initialization note:', err?.message);
      } finally {
        this.incidentRowsInitPromise = null;
      }
    })();

    return this.incidentRowsInitPromise;
  }

  /**
   * Populates/refreshes `oracle_incident_rows` for a single (environment_host, control_id) inside PostgreSQL.
   */
  public async syncSingleControlRowsFromDb(environmentHost: string, controlId: string): Promise<number> {
    const cleanHost = String(environmentHost || '').trim();
    const cleanId = String(controlId || '').trim();
    if (!cleanHost || !cleanId) return 0;

    await query(
      `DELETE FROM oracle_incident_rows WHERE environment_host = $1 AND control_id = $2`,
      [cleanHost, cleanId]
    );

    // VYR-032: raw_incidents may be an encrypted container, so the element
    // mapping previously done in a SQL CTE now happens here in Node.js.
    const srcRes = await query<{ environment_host: string; control_id: string; control_name: string | null; raw_incidents: any }>(`
      SELECT environment_host, control_id, control_name, raw_incidents
      FROM oracle_control_incidents
      WHERE environment_host = $1 AND control_id = $2
      LIMIT 1
    `, [cleanHost, cleanId]);
    const src = srcRes.rows[0];

    let incidents: any[] = [];
    if (src && src.raw_incidents !== null && src.raw_incidents !== undefined) {
      const decoded = await decryptRawField<any[]>(
        'oracle_control_incidents',
        { control_id: src.control_id },
        src.raw_incidents,
        src.environment_host
      );
      incidents = Array.isArray(decoded) ? decoded : [];
    }

    const pick = (el: any, keys: string[]): string => {
      for (const k of keys) {
        const v = el?.[k];
        if (v !== undefined && v !== null) return String(v);
      }
      return '';
    };
    const lifecycleOf = (el: any): string => {
      const status = pick(el, ['Status', 'status']).toUpperCase();
      const state = pick(el, ['State', 'StateCode', 'state']).toUpperCase();
      const closedDate = pick(el, ['ClosedDate', 'closedDate']).trim();
      if (status.includes('ACCEPT') || state.includes('ACCEPT')) return 'ACCEPTED';
      if (status.includes('REMEDIAT') || state.includes('REMEDIAT')) return 'REMEDIATE';
      if (status.includes('RESOLV') || status.includes('CLOSE') || state.includes('RESOLV') || state.includes('CLOSE') || closedDate !== '') return 'RESOLVED';
      return 'ASSIGNED';
    };

    const values: any[] = [];
    const clauses: string[] = [];
    for (let i = 0; i < incidents.length; i++) {
      const el = incidents[i];
      if (!el || typeof el !== 'object') continue;
      const ord = i + 1; // matches the SQL ordinality the CTE previously used
      const write = await encryptRawField(
        'oracle_incident_rows',
        { control_id: cleanId, ord },
        el,
        src?.environment_host || cleanHost
      );
      const base = values.length + 1;
      clauses.push(
        `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}, $${base + 20}, $${base + 21}::jsonb, $${base + 22}, $${base + 23}, $${base + 24}, $${base + 25})`
      );
      values.push(
        src?.environment_host || cleanHost,
        src?.control_id || cleanId,
        src?.control_name || null,
        ord,
        pick(el, ['Id', 'id', 'IncidentId', 'ResultId']),
        pick(el, ['Status', 'status']),
        pick(el, ['State', 'StateCode', 'state']),
        lifecycleOf(el),
        pick(el, ['Priority', 'priority']),
        pick(el, ['GlobalUserName', 'globalUserName']),
        pick(el, ['Role', 'role']),
        pick(el, ['AccessEntitlement', 'accessEntitlement', 'Entitlement', 'entitlement']),
        pick(el, ['AccessPointName', 'accessPointName', 'AccessPoint', 'accessPoint']),
        pick(el, ['AccessPointType', 'accessPointType']),
        pick(el, ['GroupingValue', 'groupingValue']),
        pick(el, ['ResultGroup', 'resultGroup', 'Group', 'group', 'GroupName']),
        pick(el, ['DataSource', 'TransactionDataSource', 'dataSource']),
        pick(el, ['IncidentInformation', 'incidentInformation', 'Description', 'description']),
        pick(el, ['CreatedBy', 'createdBy']),
        pick(el, ['ResultInvestigator', 'Investigator', 'resultInvestigator', 'investigator']),
        pick(el, ['LastUpdatedBy', 'lastUpdatedBy']),
        write.rawValue,
        ...trackingColumns(write)
      );
    }

    let rowCount = 0;
    if (clauses.length > 0) {
      const ins = await query<{ cnt: number }>(`
        WITH inserted AS (
          INSERT INTO oracle_incident_rows (
            environment_host, control_id, control_name, ord,
            result_id, status, state, lifecycle, priority,
            global_user, role_name, access_entitlement, access_point_name, access_point_type,
            grouping_value, group_name, data_source, incident_information,
            created_by, investigator, last_updated_by, raw,
            is_encrypted, encryption_format_version, encryption_key_id, encrypted_at
          )
          VALUES ${clauses.join(', ')}
          ON CONFLICT (environment_host, control_id, ord) DO NOTHING
          RETURNING 1
        )
        SELECT COUNT(*)::int AS cnt FROM inserted
      `, values);
      rowCount = Number(ins.rows[0]?.cnt || 0);
    }
    await query(`
      INSERT INTO oracle_incident_rows_sync (environment_host, control_id, control_name, row_count, last_synced_at)
      SELECT environment_host, control_id, control_name, $3, COALESCE(last_synced_at, NOW())
      FROM oracle_control_incidents
      WHERE environment_host = $1 AND control_id = $2
      ON CONFLICT (environment_host, control_id) DO UPDATE SET
        control_name = COALESCE(EXCLUDED.control_name, oracle_incident_rows_sync.control_name),
        row_count = EXCLUDED.row_count,
        last_synced_at = EXCLUDED.last_synced_at
    `, [cleanHost, cleanId, rowCount]);

    return rowCount;
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
   * Resolves the winning indexed row-sync record for a single control if `oracle_incident_rows` is synced.
   */
  private async getIndexedControlMeta(host: string, cleanId: string): Promise<{ environment_host: string; control_name: string | null; row_count: number } | null> {
    try {
      const res = await query<{ environment_host: string; control_name: string | null; row_count: number }>(
        `SELECT environment_host, control_name, row_count
         FROM oracle_incident_rows_sync
         WHERE (environment_host = $1 OR environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com') AND control_id = $2
         ORDER BY (CASE WHEN environment_host = $1 THEN 0 ELSE 1 END)
         LIMIT 1`,
        [host, cleanId]
      );
      return res.rows[0] || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Builds SQL predicates targeting flat columns on `oracle_incident_rows r`.
   */
  private buildNormalizedRowFilterConditions(
    options: IncidentQueryFilters,
    startParamIdx = 3,
    includeTableControlCols = true
  ): { conds: string[]; params: any[]; nextParam: number } {
    const conds: string[] = [];
    const params: any[] = [];
    let p = startParamIdx;

    // Multi-select statuses (preferred) or legacy single status
    const rawStatuses = Array.isArray(options.statuses) && options.statuses.length > 0
      ? options.statuses
      : (options.status && options.status !== 'ALL' ? options.status.split(',') : []);
    const cleanStatuses = rawStatuses
      .map(s => String(s || '').trim().toUpperCase())
      .filter(s => s && s !== 'ALL');

    if (cleanStatuses.length > 0) {
      const lifecycles = new Set<string>();
      const rawStatusLiterals: string[] = [];
      for (const statusKey of cleanStatuses) {
        if (statusKey === 'ACCEPTED') lifecycles.add('ACCEPTED');
        else if (statusKey === 'REMEDIATE' || statusKey === 'IN_REMEDIATION' || statusKey === 'REMEDIATION') lifecycles.add('REMEDIATE');
        else if (statusKey === 'RESOLVED' || statusKey === 'CLOSED') lifecycles.add('RESOLVED');
        else if (statusKey === 'ASSIGNED') lifecycles.add('ASSIGNED');
        else rawStatusLiterals.push(statusKey);
      }

      const statusOrParts: string[] = [];
      if (lifecycles.size > 0) {
        statusOrParts.push(`r.lifecycle = ANY($${p})`);
        params.push(Array.from(lifecycles));
        p++;
      }
      for (const lit of rawStatusLiterals) {
        statusOrParts.push(`(UPPER(r.status) = $${p} OR UPPER(r.state) = $${p})`);
        params.push(lit);
        p++;
      }
      if (statusOrParts.length > 0) {
        conds.push(`(${statusOrParts.join(' OR ')})`);
      }
    }

    // Multi-select or single state
    const rawStates = Array.isArray(options.states) && options.states.length > 0
      ? options.states
      : (options.state && options.state !== 'ALL' ? options.state.split(',') : []);
    const cleanStates = rawStates
      .map(s => String(s || '').trim().toUpperCase())
      .filter(s => s && s !== 'ALL');

    if (cleanStates.length > 0) {
      const stateOrParts: string[] = [];
      for (const stateKey of cleanStates) {
        if (stateKey === 'APPROVED') {
          stateOrParts.push(`(UPPER(r.state) LIKE '%APPROV%')`);
        } else if (stateKey === 'IN_INVESTIGATION' || stateKey === 'INVESTIGATION' || stateKey === 'IN INVESTIGATION') {
          stateOrParts.push(`(UPPER(r.state) LIKE '%INVESTIGAT%')`);
        } else {
          stateOrParts.push(`(UPPER(r.state) = $${p})`);
          params.push(stateKey);
          p++;
        }
      }
      if (stateOrParts.length > 0) {
        conds.push(`(${stateOrParts.join(' OR ')})`);
      }
    }

    // Quick free-text search across key incident columns
    const q = (options.search || '').trim().toLowerCase();
    if (q) {
      const baseSearch = `(LOWER(r.global_user) LIKE $${p} OR LOWER(COALESCE(r.raw->>'UserFirstName','')) LIKE $${p} OR LOWER(COALESCE(r.raw->>'UserLastName','')) LIKE $${p} OR LOWER(r.role_name) LIKE $${p} OR LOWER(r.result_id) LIKE $${p} OR LOWER(r.incident_information) LIKE $${p} OR LOWER(r.grouping_value) LIKE $${p} OR LOWER(r.group_name) LIKE $${p} OR LOWER(r.access_entitlement) LIKE $${p} OR LOWER(COALESCE(r.raw->>'ControlName',r.control_name,'')) LIKE $${p}`;
      if (includeTableControlCols) {
        conds.push(`${baseSearch} OR LOWER(r.control_id) LIKE $${p})`);
      } else {
        conds.push(`${baseSearch})`);
      }
      params.push(`%${q}%`);
      p++;
    }

    // Multi-term AND search
    for (const rawTerm of options.searchTerms || []) {
      const term = String(rawTerm || '').trim().toLowerCase();
      if (!term) continue;
      conds.push(`(LOWER(r.global_user) LIKE $${p} OR LOWER(r.role_name) LIKE $${p} OR LOWER(r.result_id) LIKE $${p} OR LOWER(r.incident_information) LIKE $${p} OR LOWER(r.access_point_name) LIKE $${p} OR LOWER(r.access_entitlement) LIKE $${p})`);
      params.push(`%${term}%`);
      p++;
    }

    const addContains = (val: string | undefined, expr: string) => {
      const trimmed = (val || '').trim().toLowerCase();
      if (!trimmed) return;
      conds.push(`(${expr} LIKE $${p})`);
      params.push(`%${trimmed}%`);
      p++;
    };

    addContains(options.globalUser, `LOWER(COALESCE(NULLIF(r.global_user,''), COALESCE(r.raw->>'GlobalUser', r.raw->>'globalUser', r.raw->>'UserFirstName', '')) || ' ' || COALESCE(r.raw->>'UserLastName', ''))`);
    if (!includeTableControlCols) {
      addContains(options.role, `LOWER(r.role_name || ' ' || COALESCE(r.raw->>'ConflictingRoles', r.raw->>'conflictingRoles', ''))`);
    }
    addContains(options.accessEntitlement, `LOWER(r.access_entitlement)`);
    addContains(options.accessPointName, `LOWER(r.access_point_name)`);
    addContains(options.groupingValue, `LOWER(r.grouping_value)`);
    addContains(options.group, `LOWER(r.group_name)`);
    addContains(options.incidentInformation, `LOWER(r.incident_information)`);

    const addExactTrim = (val: string | undefined, expr: string) => {
      const trimmed = (val || '').trim();
      if (!trimmed || trimmed.toUpperCase() === 'ALL') return;
      conds.push(`(LOWER(TRIM(${expr})) = LOWER($${p}))`);
      params.push(trimmed);
      p++;
    };

    addExactTrim(options.accessPointType, `r.access_point_type`);
    addExactTrim(options.dataSource, `COALESCE(NULLIF(r.data_source, ''), 'Oracle Cloud')`);
    addExactTrim(options.createdBy, `r.created_by`);
    addExactTrim(options.investigator, `r.investigator`);
    addExactTrim(options.lastUpdatedBy, `r.last_updated_by`);

    const exactUser = (options.user || '').trim();
    if (exactUser) {
      if (exactUser.toLowerCase() === 'unknown') {
        conds.push(`(COALESCE(NULLIF(TRIM(r.global_user), ''), NULLIF(TRIM(REGEXP_REPLACE(r.incident_information, '^Person\\.Full Name:\\s*', '', 'i')), ''), 'Unknown') = 'Unknown')`);
      } else {
        conds.push(`(
          LOWER(TRIM(r.global_user)) = LOWER($${p})
          OR LOWER(TRIM(REGEXP_REPLACE(r.incident_information, '^Person\\.Full Name:\\s*', '', 'i'))) = LOWER($${p})
          OR LOWER(TRIM(COALESCE(r.raw->>'UserFirstName', ''))) = LOWER($${p})
        )`);
        params.push(exactUser);
        p++;
      }
    }

    const exactRole = (options.role || '').trim();
    if (includeTableControlCols && exactRole) {
      if (exactRole.toLowerCase() === 'unknown') {
        conds.push(`(COALESCE(NULLIF(TRIM(r.role_name), ''), NULLIF(TRIM(r.control_name), ''), NULLIF(TRIM(r.raw->>'ControlName'), ''), 'Unknown') = 'Unknown')`);
      } else {
        conds.push(`(
          LOWER(TRIM(r.role_name)) = LOWER($${p})
          OR LOWER(TRIM(COALESCE(r.control_name, ''))) = LOWER($${p})
          OR LOWER(TRIM(COALESCE(r.raw->>'ControlName', ''))) = LOWER($${p})
          OR LOWER(TRIM(r.group_name)) = LOWER($${p})
        )`);
        params.push(exactRole);
        p++;
      }
    }

    const prio = (options.priority || '').trim().toUpperCase();
    if (prio && prio !== 'ALL') {
      const prioMap: Record<string, string> = { HIGH: '1', MEDIUM: '2', LOW: '3' };
      const prioVal = prioMap[prio] || prio;
      conds.push(`(r.priority = $${p})`);
      params.push(prioVal);
      p++;
    }

    return { conds, params, nextParam: p };
  }

  /**
   * Retrieves raw incidents for a single control directly in PostgreSQL using indexed `oracle_incident_rows`
   * when synced (<15ms), falling back safely to `oracle_control_incidents` JSONB filtering otherwise.
   */
  public async getRawIncidents(
    controlId: string,
    options: IncidentQueryFilters & {
      offset?: number;
      limit?: number;
    } = {}
  ): Promise<{ total: number; rawItems: any[]; count: number; isFiltered: boolean; fullSyncedTotal: number }> {
    const host = this.getHost();
    const cleanId = String(controlId).trim();
    const limit = Math.min(250, Math.max(1, options.limit || 25));
    const offset = Math.max(0, options.offset || 0);

    // Fast indexed path from normalized `oracle_incident_rows`
    const indexedMeta = await this.getIndexedControlMeta(host, cleanId);
    if (indexedMeta && indexedMeta.row_count > 0) {
      const { conds, params, nextParam } = this.buildNormalizedRowFilterConditions(options, 3, false);
      const isFiltered = conds.length > 0;
      const fullSyncedTotal = Number(indexedMeta.row_count);

      if (!isFiltered) {
        const fastRes = await query<{ raw: any }>(
          `SELECT raw
           FROM oracle_incident_rows
           WHERE environment_host = $1 AND control_id = $2
           ORDER BY ord
           LIMIT $3 OFFSET $4`,
          [indexedMeta.environment_host, cleanId, limit, offset]
        );
        const rawItems = fastRes.rows.map(r => r.raw);
        return { total: fullSyncedTotal, rawItems, count: rawItems.length, isFiltered: false, fullSyncedTotal };
      }

      const whereClause = `WHERE r.environment_host = $1 AND r.control_id = $2 AND ${conds.join(' AND ')}`;
      const filteredRes = await query<{ raw: any; filtered_total: string }>(
        `SELECT r.raw, COUNT(*) OVER() AS filtered_total
         FROM oracle_incident_rows r
         ${whereClause}
         ORDER BY r.ord
         LIMIT $${nextParam} OFFSET $${nextParam + 1}`,
        [indexedMeta.environment_host, cleanId, ...params, limit, offset]
      );
      const total = filteredRes.rows.length > 0 ? Number(filteredRes.rows[0].filtered_total || 0) : 0;
      const rawItems = filteredRes.rows.map(r => r.raw);
      return { total, rawItems, count: rawItems.length, isFiltered: true, fullSyncedTotal };
    }

    // Kick off non-blocking indexing if not synced yet
    this.ensureIncidentRowsInitialized().catch(() => {});

    const { conds, params, nextParam } = this.buildIncidentFilterConditions(options, 3, false);
    const isFiltered = conds.length > 0;
    const whereExtra = isFiltered ? `WHERE ${conds.join(' AND ')}` : '';

    // Fallback to raw JSONB cell if normalized rows aren't populated for this control yet
    const sql = `
      WITH target AS (
        SELECT control_id, control_name, raw_incidents, total_incidents,
               jsonb_array_length(COALESCE(raw_incidents, '[]'::jsonb)) AS synced_len
        FROM oracle_control_incidents
        WHERE (environment_host = $1 OR environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com') AND control_id = $2
        ORDER BY (CASE WHEN environment_host = $1 THEN 0 ELSE 1 END)
        LIMIT 1
      )
      SELECT t.synced_len, elem.el AS raw, COUNT(*) OVER() AS filtered_total
      FROM target t
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.raw_incidents, '[]'::jsonb)) WITH ORDINALITY AS elem(el, ord)
      ${whereExtra}
      ORDER BY elem.ord
      LIMIT $${nextParam} OFFSET $${nextParam + 1}
    `;

    const res = await query<{
      synced_len: number;
      raw: any;
      filtered_total: string;
    }>(sql, [host, cleanId, ...params, limit, offset]);

    if (res.rows.length > 0) {
      const total = Number(res.rows[0].filtered_total || 0);
      const fullSyncedTotal = Number(res.rows[0].synced_len || total);
      const rawItems = res.rows.map(r => r.raw);
      return { total, rawItems, count: rawItems.length, isFiltered, fullSyncedTotal };
    }

    // Either no row exists in DB, offset exceeded, or filter matched 0 items — check fullSyncedTotal cheaply
    const metaRes = await query<{ synced_len: number }>(
      `SELECT jsonb_array_length(COALESCE(raw_incidents, '[]'::jsonb))::int AS synced_len
       FROM oracle_control_incidents
       WHERE (environment_host = $1 OR environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com') AND control_id = $2
       ORDER BY (CASE WHEN environment_host = $1 THEN 0 ELSE 1 END)
       LIMIT 1`,
      [host, cleanId]
    );
    const fullSyncedTotal = Number(metaRes.rows[0]?.synced_len || 0);
    return { total: 0, rawItems: [], count: 0, isFiltered, fullSyncedTotal };
  }

  /**
   * Returns distinct dropdown filter values (Investigator, Created By, Last Updated By, State, etc.)
   * with in-memory TTL cache + fast flat-column query on `oracle_incident_rows` when available.
   */
  public async getControlIncidentFacets(controlId: string): Promise<ControlIncidentFacets> {
    const host = this.getHost();
    const cleanId = String(controlId).trim();
    const cacheKey = `${host}|${cleanId}`;
    const cached = this.facetsCache.get(cacheKey);
    if (cached && (Date.now() - cached.cachedAt) < 10 * 60 * 1000) {
      return cached.facets;
    }

    const emptyFacets: ControlIncidentFacets = {
      createdBy: [],
      investigator: [],
      lastUpdatedBy: [],
      states: [],
      accessPointTypes: [],
      dataSources: [],
      groups: [],
      priorities: []
    };

    const indexedMeta = await this.getIndexedControlMeta(host, cleanId);
    if (indexedMeta && indexedMeta.row_count > 0) {
      const res = await query<{
        created_by: string[] | null;
        investigator: string[] | null;
        last_updated_by: string[] | null;
        states: string[] | null;
        access_point_types: string[] | null;
        data_sources: string[] | null;
        groups: string[] | null;
        priorities: string[] | null;
      }>(
        `WITH scoped AS (
           SELECT created_by, investigator, last_updated_by, state, access_point_type, data_source, group_name, priority
           FROM oracle_incident_rows
           WHERE environment_host = $1 AND control_id = $2
         )
         SELECT
           (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(created_by), '') AS v FROM scoped LIMIT 200) s WHERE v IS NOT NULL) AS created_by,
           (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(investigator), '') AS v FROM scoped LIMIT 200) s WHERE v IS NOT NULL) AS investigator,
           (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(last_updated_by), '') AS v FROM scoped LIMIT 200) s WHERE v IS NOT NULL) AS last_updated_by,
           (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(state), '') AS v FROM scoped LIMIT 50) s WHERE v IS NOT NULL) AS states,
           (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(access_point_type), '') AS v FROM scoped LIMIT 50) s WHERE v IS NOT NULL) AS access_point_types,
           (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(data_source), '') AS v FROM scoped LIMIT 50) s WHERE v IS NOT NULL) AS data_sources,
           (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(group_name), '') AS v FROM scoped LIMIT 200) s WHERE v IS NOT NULL) AS groups,
           (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(priority), '') AS v FROM scoped LIMIT 20) s WHERE v IS NOT NULL) AS priorities`,
        [indexedMeta.environment_host, cleanId]
      );
      const r = res.rows[0];
      const facets: ControlIncidentFacets = r ? {
        createdBy: r.created_by || [],
        investigator: r.investigator || [],
        lastUpdatedBy: r.last_updated_by || [],
        states: r.states || [],
        accessPointTypes: r.access_point_types || [],
        dataSources: r.data_sources || [],
        groups: r.groups || [],
        priorities: r.priorities || []
      } : emptyFacets;
      this.facetsCache.set(cacheKey, { facets, cachedAt: Date.now() });
      return facets;
    }

    const res = await query<{
      created_by: string[] | null;
      investigator: string[] | null;
      last_updated_by: string[] | null;
      states: string[] | null;
      access_point_types: string[] | null;
      data_sources: string[] | null;
      groups: string[] | null;
      priorities: string[] | null;
    }>(
      `WITH target AS (
         SELECT raw_incidents
         FROM oracle_control_incidents
         WHERE (environment_host = $1 OR environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com') AND control_id = $2
         ORDER BY (CASE WHEN environment_host = $1 THEN 0 ELSE 1 END)
         LIMIT 1
       ),
       elems AS (
         SELECT el
         FROM target t,
              LATERAL jsonb_array_elements(COALESCE(t.raw_incidents, '[]'::jsonb)) AS el
       )
       SELECT
         (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(COALESCE(el->>'CreatedBy', el->>'createdBy', '')), '') AS v FROM elems LIMIT 200) s WHERE v IS NOT NULL) AS created_by,
         (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(COALESCE(el->>'ResultInvestigator', el->>'Investigator', el->>'resultInvestigator', el->>'investigator', '')), '') AS v FROM elems LIMIT 200) s WHERE v IS NOT NULL) AS investigator,
         (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(COALESCE(el->>'LastUpdatedBy', el->>'lastUpdatedBy', '')), '') AS v FROM elems LIMIT 200) s WHERE v IS NOT NULL) AS last_updated_by,
         (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(COALESCE(el->>'State', el->>'StateCode', el->>'state', '')), '') AS v FROM elems LIMIT 50) s WHERE v IS NOT NULL) AS states,
         (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(COALESCE(el->>'AccessPointType', el->>'accessPointType', '')), '') AS v FROM elems LIMIT 50) s WHERE v IS NOT NULL) AS access_point_types,
         (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(COALESCE(el->>'DataSource', el->>'TransactionDataSource', el->>'dataSource', '')), '') AS v FROM elems LIMIT 50) s WHERE v IS NOT NULL) AS data_sources,
         (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(COALESCE(el->>'ResultGroup', el->>'Group', el->>'GroupName', el->>'resultGroup', el->>'group', '')), '') AS v FROM elems LIMIT 200) s WHERE v IS NOT NULL) AS groups,
         (SELECT ARRAY_AGG(v ORDER BY v) FROM (SELECT DISTINCT NULLIF(TRIM(COALESCE(el->>'Priority', el->>'priority', '')), '') AS v FROM elems LIMIT 20) s WHERE v IS NOT NULL) AS priorities`,
      [host, cleanId]
    );

    const r = res.rows[0];
    if (!r) return emptyFacets;
    const facets: ControlIncidentFacets = {
      createdBy: r.created_by || [],
      investigator: r.investigator || [],
      lastUpdatedBy: r.last_updated_by || [],
      states: r.states || [],
      accessPointTypes: r.access_point_types || [],
      dataSources: r.data_sources || [],
      groups: r.groups || [],
      priorities: r.priorities || []
    };
    this.facetsCache.set(cacheKey, { facets, cachedAt: Date.now() });
    return facets;
  }

  /**
   * Lifecycle predicates shared by cross-control coverage + reads.
   * Mirrors calculateIncidentBreakdown / getRawIncidents contains-logic in SQL.
   */
  private lifecycleCondition(alias = 'el'): { accepted: string; remediate: string; resolved: string } {
    const st = `UPPER(COALESCE(${alias}->>'Status',''))`;
    const se = `UPPER(COALESCE(${alias}->>'State',${alias}->>'StateCode',''))`;
    const accepted = `(${st} LIKE '%ACCEPT%' OR ${se} LIKE '%ACCEPT%')`;
    const remediate = `(NOT ${accepted} AND (${st} LIKE '%REMEDIAT%' OR ${se} LIKE '%REMEDIAT%'))`;
    const closedDt = `NULLIF(TRIM(COALESCE(${alias}->>'ClosedDate',${alias}->>'closedDate','')),'') IS NOT NULL`;
    const resolved = `(NOT ${accepted} AND NOT (${st} LIKE '%REMEDIAT%' OR ${se} LIKE '%REMEDIAT%') AND (${st} LIKE '%RESOLV%' OR ${st} LIKE '%CLOSE%' OR ${se} LIKE '%RESOLV%' OR ${se} LIKE '%CLOSE%' OR ${closedDt}))`;
    return { accepted, remediate, resolved };
  }

  /**
   * Shared SQL JSONB predicate builder used by both single-control and cross-control incident queries.
   */
  private buildIncidentFilterConditions(
    options: IncidentQueryFilters,
    startParamIdx = 3,
    includeTableControlCols = true
  ): { conds: string[]; params: any[]; nextParam: number } {
    const conds: string[] = [];
    const params: any[] = [];
    let p = startParamIdx;
    const lc = this.lifecycleCondition('el');

    // Multi-select statuses (preferred) or legacy single status
    const rawStatuses = Array.isArray(options.statuses) && options.statuses.length > 0
      ? options.statuses
      : (options.status && options.status !== 'ALL' ? options.status.split(',') : []);
    const cleanStatuses = rawStatuses
      .map(s => String(s || '').trim().toUpperCase())
      .filter(s => s && s !== 'ALL');

    if (cleanStatuses.length > 0) {
      const orParts: string[] = [];
      for (const statusKey of cleanStatuses) {
        if (statusKey === 'ACCEPTED') orParts.push(`(${lc.accepted})`);
        else if (statusKey === 'REMEDIATE' || statusKey === 'IN_REMEDIATION' || statusKey === 'REMEDIATION') orParts.push(`(${lc.remediate})`);
        else if (statusKey === 'RESOLVED' || statusKey === 'CLOSED') orParts.push(`(${lc.resolved})`);
        else if (statusKey === 'ASSIGNED') orParts.push(`(NOT (${lc.accepted} OR ${lc.remediate} OR ${lc.resolved}))`);
        else {
          orParts.push(`(UPPER(COALESCE(el->>'Status','')) = $${p} OR UPPER(COALESCE(el->>'State',el->>'StateCode','')) = $${p})`);
          params.push(statusKey);
          p++;
        }
      }
      if (orParts.length > 0) {
        conds.push(`(${orParts.join(' OR ')})`);
      }
    }

    // Multi-select or single state
    const rawStates = Array.isArray(options.states) && options.states.length > 0
      ? options.states
      : (options.state && options.state !== 'ALL' ? options.state.split(',') : []);
    const cleanStates = rawStates
      .map(s => String(s || '').trim().toUpperCase())
      .filter(s => s && s !== 'ALL');

    if (cleanStates.length > 0) {
      const stateOrParts: string[] = [];
      for (const stateKey of cleanStates) {
        if (stateKey === 'APPROVED') {
          stateOrParts.push(`(UPPER(COALESCE(el->>'State',el->>'StateCode','')) LIKE '%APPROV%')`);
        } else if (stateKey === 'IN_INVESTIGATION' || stateKey === 'INVESTIGATION' || stateKey === 'IN INVESTIGATION') {
          stateOrParts.push(`(UPPER(COALESCE(el->>'State',el->>'StateCode','')) LIKE '%INVESTIGAT%')`);
        } else {
          stateOrParts.push(`(UPPER(COALESCE(el->>'State',el->>'StateCode','')) = $${p})`);
          params.push(stateKey);
          p++;
        }
      }
      if (stateOrParts.length > 0) {
        conds.push(`(${stateOrParts.join(' OR ')})`);
      }
    }

    // Quick free-text search across key incident columns
    const q = (options.search || '').trim().toLowerCase();
    if (q) {
      const baseSearch = `(LOWER(COALESCE(el->>'GlobalUserName',el->>'globalUserName','')) LIKE $${p} OR LOWER(COALESCE(el->>'UserFirstName','')) LIKE $${p} OR LOWER(COALESCE(el->>'UserLastName','')) LIKE $${p} OR LOWER(COALESCE(el->>'Role',el->>'role','')) LIKE $${p} OR LOWER(COALESCE(el->>'Id',el->>'id','')) LIKE $${p} OR LOWER(COALESCE(el->>'IncidentInformation',el->>'incidentInformation','')) LIKE $${p} OR LOWER(COALESCE(el->>'GroupingValue',el->>'groupingValue','')) LIKE $${p} OR LOWER(COALESCE(el->>'ResultGroup',el->>'resultGroup','')) LIKE $${p} OR LOWER(COALESCE(el->>'Entitlement',el->>'AccessEntitlement','')) LIKE $${p}`;
      if (includeTableControlCols) {
        conds.push(`${baseSearch} OR LOWER(COALESCE(el->>'ControlName',t.control_name,'')) LIKE $${p} OR LOWER(t.control_id) LIKE $${p})`);
      } else {
        conds.push(`${baseSearch} OR LOWER(COALESCE(el->>'ControlName',t.control_name,'')) LIKE $${p})`);
      }
      params.push(`%${q}%`);
      p++;
    }

    // Multi-term AND search
    for (const rawTerm of options.searchTerms || []) {
      const term = String(rawTerm || '').trim().toLowerCase();
      if (!term) continue;
      conds.push(`(LOWER(COALESCE(el->>'GlobalUserName',el->>'globalUserName','')) LIKE $${p} OR LOWER(COALESCE(el->>'Role',el->>'role','')) LIKE $${p} OR LOWER(COALESCE(el->>'Id',el->>'id','')) LIKE $${p} OR LOWER(COALESCE(el->>'IncidentInformation',el->>'incidentInformation','')) LIKE $${p} OR LOWER(COALESCE(el->>'AccessPointName',el->>'accessPointName','')) LIKE $${p} OR LOWER(COALESCE(el->>'Entitlement',el->>'entitlement','')) LIKE $${p})`);
      params.push(`%${term}%`);
      p++;
    }

    // Field-level Access & Transaction filters (text contains / case-insensitive)
    const addContains = (val: string | undefined, expr: string) => {
      const trimmed = (val || '').trim().toLowerCase();
      if (!trimmed) return;
      conds.push(`(${expr} LIKE $${p})`);
      params.push(`%${trimmed}%`);
      p++;
    };

    addContains(options.globalUser, `LOWER(COALESCE(el->>'GlobalUserName', el->>'globalUserName', el->>'GlobalUser', el->>'globalUser', el->>'UserFirstName', '') || ' ' || COALESCE(el->>'UserLastName', ''))`);
    if (!includeTableControlCols) {
      addContains(options.role, `LOWER(COALESCE(el->>'Role', el->>'role', el->>'ConflictingRoles', el->>'conflictingRoles', ''))`);
    }
    addContains(options.accessEntitlement, `LOWER(COALESCE(el->>'AccessEntitlement', el->>'accessEntitlement', el->>'Entitlement', el->>'entitlement', ''))`);
    addContains(options.accessPointName, `LOWER(COALESCE(el->>'AccessPointName', el->>'accessPointName', el->>'AccessPoint', el->>'accessPoint', ''))`);
    addContains(options.groupingValue, `LOWER(COALESCE(el->>'GroupingValue', el->>'groupingValue', ''))`);
    addContains(options.group, `LOWER(COALESCE(el->>'ResultGroup', el->>'resultGroup', el->>'Group', el->>'group', el->>'GroupName', ''))`);
    addContains(options.incidentInformation, `LOWER(COALESCE(el->>'IncidentInformation', el->>'incidentInformation', el->>'Description', el->>'description', ''))`);

    const addExactTrim = (val: string | undefined, expr: string) => {
      const trimmed = (val || '').trim();
      if (!trimmed || trimmed.toUpperCase() === 'ALL') return;
      conds.push(`(LOWER(TRIM(${expr})) = LOWER($${p}))`);
      params.push(trimmed);
      p++;
    };

    addExactTrim(options.accessPointType, `COALESCE(el->>'AccessPointType', el->>'accessPointType', '')`);
    addExactTrim(options.dataSource, `COALESCE(el->>'DataSource', el->>'TransactionDataSource', el->>'dataSource', 'Oracle Cloud')`);
    addExactTrim(options.createdBy, `COALESCE(el->>'CreatedBy', el->>'createdBy', '')`);
    addExactTrim(options.investigator, `COALESCE(el->>'ResultInvestigator', el->>'Investigator', el->>'resultInvestigator', el->>'investigator', '')`);
    addExactTrim(options.lastUpdatedBy, `COALESCE(el->>'LastUpdatedBy', el->>'lastUpdatedBy', '')`);

    // Exact (case-insensitive) drill-down filters for Top-10 bar clicks
    const exactUser = (options.user || '').trim();
    if (exactUser) {
      if (exactUser.toLowerCase() === 'unknown') {
        conds.push(`(COALESCE(NULLIF(TRIM(el->>'GlobalUserName'), ''), NULLIF(TRIM(REGEXP_REPLACE(el->>'IncidentInformation', '^Person\\.Full Name:\\s*', '', 'i')), ''), 'Unknown') = 'Unknown')`);
      } else {
        conds.push(`(
          LOWER(TRIM(COALESCE(el->>'GlobalUserName', el->>'globalUserName', ''))) = LOWER($${p})
          OR LOWER(TRIM(REGEXP_REPLACE(COALESCE(el->>'IncidentInformation', ''), '^Person\\.Full Name:\\s*', '', 'i'))) = LOWER($${p})
          OR LOWER(TRIM(COALESCE(el->>'UserFirstName', ''))) = LOWER($${p})
        )`);
        params.push(exactUser);
        p++;
      }
    }
    const exactRole = (options.role || '').trim();
    if (includeTableControlCols && exactRole) {
      if (exactRole.toLowerCase() === 'unknown') {
        conds.push(`(COALESCE(NULLIF(TRIM(el->>'Role'), ''), NULLIF(TRIM(t.control_name), ''), NULLIF(TRIM(el->>'ControlName'), ''), 'Unknown') = 'Unknown')`);
      } else {
        conds.push(`(
          LOWER(TRIM(COALESCE(el->>'Role', el->>'role', ''))) = LOWER($${p})
          OR LOWER(TRIM(COALESCE(t.control_name, ''))) = LOWER($${p})
          OR LOWER(TRIM(COALESCE(el->>'ControlName', ''))) = LOWER($${p})
          OR LOWER(TRIM(COALESCE(el->>'ResultGroup', ''))) = LOWER($${p})
        )`);
        params.push(exactRole);
        p++;
      }
    }

    const prio = (options.priority || '').trim().toUpperCase();
    if (prio && prio !== 'ALL') {
      const prioMap: Record<string, string> = { HIGH: '1', MEDIUM: '2', LOW: '3' };
      const prioVal = prioMap[prio] || prio;
      conds.push(`(COALESCE(el->>'Priority',el->>'priority','') = $${p})`);
      params.push(prioVal);
      p++;
    }

    return { conds, params, nextParam: p };
  }

  /**
   * Exact 4-way lifecycle coverage across a set of controls, computed in a
   * single SQL pass over the synced raw_incidents payloads.
   */
  public async getIncidentCoverage(controlIds: string[]): Promise<{
    controls: number;
    synced: number;
    assigned: number;
    accepted: number;
    remediate: number;
    resolved: number;
  }> {
    const host = this.getHost();
    const ids = (controlIds || []).map((s) => String(s).trim()).filter(Boolean);
    if (ids.length === 0) {
      return { controls: 0, synced: 0, assigned: 0, accepted: 0, remediate: 0, resolved: 0 };
    }
    const lc = this.lifecycleCondition('el');
    const res = await query<{
      controls: string;
      synced: string;
      accepted: string;
      remediate: string;
      resolved: string;
    }>(
      `SELECT COUNT(DISTINCT t.control_id)::int AS controls,
              COALESCE(SUM(t.total_incidents), 0)::int AS synced,
              COALESCE(SUM(t.accepted_incidents), 0)::int AS accepted,
              COALESCE(SUM(t.remediate_incidents), 0)::int AS remediate,
              COALESCE(SUM(t.resolved_incidents), 0)::int AS resolved,
              COALESCE(SUM(t.assigned_incidents), 0)::int AS assigned
       FROM oracle_control_incidents t
       WHERE (t.environment_host = $1 OR t.environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com') AND t.control_id = ANY($2)`,
      [host, ids]
    );
    const row = res.rows[0] as any;
    const synced = Number(row?.synced || 0);
    const accepted = Number(row?.accepted || 0);
    const remediate = Number(row?.remediate || 0);
    const resolved = Number(row?.resolved || 0);
    const assignedCol = Number(row?.assigned || 0);
    return {
      controls: Number(row?.controls || 0),
      synced,
      accepted,
      remediate,
      resolved,
      assigned: assignedCol > 0 ? assignedCol : Math.max(0, synced - accepted - remediate - resolved)
    };
  }

  /**
   * Cross-control paginated incident read (for "All controls" views).
   * Uses indexed `oracle_incident_rows` when all active controls in scope are synced (<30ms),
   * falling back cleanly to `oracle_control_incidents` JSONB filtering otherwise.
   */
  public async getAllRawIncidentsAcrossControls(options: IncidentQueryFilters & {
    controlIds: string[];
    offset?: number;
    limit?: number;
  }): Promise<{
    filteredTotal: number;
    rows: Array<{ control_id: string; control_name: string | null; raw: any }>;
  }> {
    const host = this.getHost();
    const ids = (options.controlIds || []).map((s) => String(s).trim()).filter(Boolean);
    if (ids.length === 0) return { filteredTotal: 0, rows: [] };
    // UI pages request <= 100 rows; bulk exports request large chunks and are
    // capped at MAX_BULK_INCIDENT_PAGE_SIZE so a 60K+ export needs ~13 round trips
    // instead of ~620 at the old hard cap of 100.
    const limit = Math.min(MAX_BULK_INCIDENT_PAGE_SIZE, Math.max(1, options.limit || 25));
    const offset = Math.max(0, options.offset || 0);

    try {
      const [metaRes, syncRes] = await Promise.all([
        query<{ control_id: string }>(
          `SELECT DISTINCT control_id
           FROM oracle_control_incidents
           WHERE (environment_host = $1 OR environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com')
             AND control_id = ANY($2)
             AND COALESCE(total_incidents, 0) > 0`,
          [host, ids]
        ),
        query<{ environment_host: string; control_id: string; control_name: string | null; row_count: number }>(
          `SELECT DISTINCT ON (control_id) environment_host, control_id, control_name, row_count
           FROM oracle_incident_rows_sync
           WHERE (environment_host = $1 OR environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com')
             AND control_id = ANY($2)
           ORDER BY control_id, (CASE WHEN environment_host = $1 THEN 0 ELSE 1 END)`,
          [host, ids]
        ),
      ]);

      const syncedByCtrl = new Map(syncRes.rows.map(r => [r.control_id, r]));
      const allCovered = metaRes.rows.every(r => {
        const s = syncedByCtrl.get(r.control_id);
        return s !== undefined && Number(s.row_count) > 0;
      });

      if (allCovered) {
        const activeSynced = syncRes.rows.filter(r => Number(r.row_count) > 0);
        if (activeSynced.length === 0) {
          return { filteredTotal: 0, rows: [] };
        }

        const { conds, params, nextParam } = this.buildNormalizedRowFilterConditions(options, 3, true);
        if (conds.length === 0) {
          let filteredTotal = 0;
          const slices: Array<{ envHost: string; controlId: string; localOffset: number; localLimit: number }> = [];
          let remainingSkip = offset;
          let remainingTake = limit;

          for (const s of activeSynced) {
            const cnt = Number(s.row_count || 0);
            filteredTotal += cnt;
            if (remainingTake <= 0) continue;
            if (remainingSkip >= cnt) {
              remainingSkip -= cnt;
              continue;
            }
            const takeHere = Math.min(remainingTake, cnt - remainingSkip);
            slices.push({
              envHost: s.environment_host,
              controlId: s.control_id,
              localOffset: remainingSkip,
              localLimit: takeHere,
            });
            remainingSkip = 0;
            remainingTake -= takeHere;
          }

          if (slices.length === 0) {
            return { filteredTotal, rows: [] };
          }

          const sliceResults = await Promise.all(
            slices.map(sl =>
              query<{ control_id: string; control_name: string | null; raw: any }>(
                `SELECT control_id, control_name, raw
                 FROM oracle_incident_rows
                 WHERE environment_host = $1 AND control_id = $2
                 ORDER BY ord
                 LIMIT $3 OFFSET $4`,
                [sl.envHost, sl.controlId, sl.localLimit, sl.localOffset]
              )
            )
          );
          return {
            filteredTotal,
            rows: sliceResults.flatMap(r => r.rows),
          };
        }

        const scopeHosts = activeSynced.map(s => s.environment_host);
        const scopeCtrls = activeSynced.map(s => s.control_id);
        const filteredRes = await query<{
          control_id: string;
          control_name: string | null;
          raw: any;
          filtered_total: string;
        }>(
          `SELECT r.control_id, r.control_name, r.raw, COUNT(*) OVER() AS filtered_total
           FROM UNNEST($1::text[], $2::text[]) AS scope(env_host, ctrl_id)
           JOIN oracle_incident_rows r
             ON r.environment_host = scope.env_host AND r.control_id = scope.ctrl_id
           WHERE ${conds.join(' AND ')}
           ORDER BY r.control_id, r.ord
           LIMIT $${nextParam} OFFSET $${nextParam + 1}`,
          [scopeHosts, scopeCtrls, ...params, limit, offset]
        );
        return {
          filteredTotal: Number(filteredRes.rows[0]?.filtered_total || 0),
          rows: filteredRes.rows.map(r => ({ control_id: r.control_id, control_name: r.control_name, raw: r.raw })),
        };
      }
    } catch (_) {
      // Fall back to JSONB path if normalized table is missing or incomplete
    }

    this.ensureIncidentRowsInitialized().catch(() => {});

    const { conds, params, nextParam } = this.buildIncidentFilterConditions(options, 3, true);
    const whereExtra = conds.length > 0 ? `AND ${conds.join(' AND ')}` : '';
    const res = await query<{
      control_id: string;
      control_name: string | null;
      raw: any;
      filtered_total: string;
    }>(
      `SELECT t.control_id, t.control_name, el AS raw, COUNT(*) OVER() AS filtered_total
       FROM oracle_control_incidents t,
            LATERAL jsonb_array_elements(COALESCE(t.raw_incidents,'[]'::jsonb)) AS el
       WHERE (t.environment_host = $1 OR t.environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com') AND t.control_id = ANY($2) ${whereExtra}
       ORDER BY t.control_id, COALESCE(el->>'Id',el->>'id','')
       LIMIT $${nextParam} OFFSET $${nextParam + 1}`,
      [host, ids, ...params, limit, offset]
    );
    return {
      filteredTotal: Number(res.rows[0]?.filtered_total || 0),
      rows: res.rows.map((r) => ({ control_id: r.control_id, control_name: r.control_name, raw: r.raw }))
    };
  }

  /**
   * Retrieves the raw incidents array directly in its exact raw form as returned from Oracle Fusion.
   */
  public async getAllRawIncidentsForControl(controlId: string): Promise<any[]> {
    const host = this.getHost();
    const cleanId = String(controlId).trim();

    const res = await query<{ raw_incidents: any; is_encrypted: boolean; control_id: string }>(
      `SELECT raw_incidents, is_encrypted, control_id FROM oracle_control_incidents
       WHERE (environment_host = $1 OR environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com') AND control_id = $2
       ORDER BY (CASE WHEN environment_host = $1 THEN 0 ELSE 1 END) LIMIT 1`,
      [host, cleanId]
    );

    if (!res.rows[0]) return [];
    const decrypted = await decryptSingleRawField('oracle_control_incidents', 'raw_incidents', res.rows[0], host);
    return Array.isArray(decrypted) ? decrypted : [];
  }

  /**
   * Finds a single incident by its Oracle ID ("<controlId>:<seq>", e.g. "11067:1").
   * Searches the owning control's synced payload; falls back to a cross-control
   * scan when the ID prefix does not resolve to a known control.
   */
  public async getIncidentById(incidentId: string): Promise<{ controlId: string; controlName: string | null; raw: any } | null> {
    const host = this.getHost();
    const clean = String(incidentId || '').trim();
    if (!clean) return null;

    const prefixMatch = clean.match(/^(\d{3,7}):(.+)$/);
    const candidateControls: string[] = prefixMatch && prefixMatch[1] ? [prefixMatch[1]] : [];
    const seqPart = prefixMatch ? prefixMatch[2] : clean;

    // Exact ID match only. A loose suffix match would return a different
    // control's incident (e.g. "99999:1" must never resolve to "11055:1").
    const matches = (el: any): boolean => {
      if (!el || typeof el !== 'object') return false;
      const id = String(el.Id ?? el.id ?? el.IncidentId ?? el.ResultId ?? '');
      return id === clean || (!prefixMatch && id === seqPart);
    };

    // 1. Direct control lookup from the ID prefix
    for (const cid of candidateControls) {
      const items = await this.getAllRawIncidentsForControl(cid);
      const hit = items.find(matches);
      if (hit) {
        const nameRes = await query<{ control_name: string | null }>(
          `SELECT control_name FROM oracle_control_incidents WHERE environment_host = $1 AND control_id = $2`,
          [host, cid]
        );
        return { controlId: cid, controlName: nameRes.rows[0]?.control_name || null, raw: hit };
      }
    }

    // 2. Cross-control scan (bounded: newest-synced controls first)
    const list = await query<{ control_id: string; control_name: string | null }>(
      `SELECT control_id, control_name FROM oracle_control_incidents
       WHERE environment_host = $1 ORDER BY last_synced_at DESC NULLS LAST LIMIT 60`,
      [host]
    );
    for (const row of list.rows) {
      if (candidateControls.includes(row.control_id)) continue;
      const items = await this.getAllRawIncidentsForControl(row.control_id);
      const hit = items.find(matches);
      if (hit) return { controlId: row.control_id, controlName: row.control_name, raw: hit };
    }
    return null;
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
        COALESCE(assigned_incidents, 0) as assigned_incidents,
        COALESCE(accepted_incidents, 0) as accepted_incidents,
        COALESCE(remediate_incidents, 0) as remediate_incidents,
        COALESCE(resolved_incidents, 0) as resolved_incidents,
        created_at,
        updated_at
       FROM oracle_control_incidents
       WHERE (environment_host = $1 OR environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com') AND control_id = $2
       ORDER BY (CASE WHEN environment_host = $1 THEN 0 ELSE 1 END) LIMIT 1`,
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

    if (!watermark) {
      return {
        hasUpdates: true,
        needsInitialSync: true,
        oracleLatestUpdateDate: null,
        dbLatestUpdateDate: null,
        totalOracleCount: null,
        syncedDbCount: 0,
        syncStatus: 'NOT_SYNCED',
        lastSyncedAt: null,
      };
    }

    try {
      const probeRes = await client.getAdvancedControlIncidents(cleanId, {
        offset: 0,
        limit: 1,
        totalResults: true,
        orderBy: 'LastUpdateDate:desc',
        timeout: 15000,
      });

      const firstItem = Array.isArray(probeRes?.items) ? probeRes.items[0] : null;
      const oracleLatestStr = firstItem?.LastUpdateDate || firstItem?.lastUpdateDate || null;
      const totalOracleCount = typeof probeRes?.totalResults === 'number' ? probeRes.totalResults : (probeRes?.items?.length || 0);

      await query(
        `UPDATE oracle_control_incidents SET updated_at = NOW(), total_incidents = COALESCE($1, total_incidents) WHERE environment_host = $2 AND control_id = $3`,
        [totalOracleCount, this.getHost(), cleanId]
      );

      // If Oracle has 0 incidents (or analysis not run in Oracle), mark as READY and stop probing
      if (!oracleLatestStr || totalOracleCount === 0) {
        if (watermark.sync_status === 'SYNCING' || watermark.sync_status === 'NOT_SYNCED') {
          await this.upsertWatermark(cleanId, {
            totalIncidents: 0,
            syncedIncidents: 0,
            syncStatus: 'READY',
          });
        }
        return {
          hasUpdates: false,
          needsInitialSync: false,
          oracleLatestUpdateDate: null,
          dbLatestUpdateDate: watermark.last_oracle_update_date,
          totalOracleCount: 0,
          syncedDbCount,
          syncStatus: 'READY',
          lastSyncedAt: watermark.last_synced_at,
        };
      }

      const oracleLatestTime = new Date(oracleLatestStr).getTime();
      const dbLatestTime = watermark.last_oracle_update_date
        ? new Date(watermark.last_oracle_update_date).getTime()
        : 0;

      // Status change detection:
      // Even if total count did not change, if an incident changed status (e.g. to Accepted/Remediate/Resolved),
      // oracleLatestTime will be newer than dbLatestTime!
      const countMismatch = totalOracleCount !== syncedDbCount;
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
  public startAutoSyncScheduler(oracleServiceOrClient: any, intervalMinutes = 360): void {
    if (this.schedulerTimer) return;

    console.log(`[AutoSyncScheduler] Initialized. Background sync interval: ${intervalMinutes} minutes.`);

    // Delay initial sync by 5 minutes after server startup to allow clean boot and steady-state memory
    setTimeout(() => {
      this.runAutoSyncCycle(oracleServiceOrClient).catch((err) => {
        console.error('[AutoSyncScheduler] Initial run error:', err.message);
      });
    }, 5 * 60 * 1000);

    // Run recurring periodic checks (every 6 hours)
    this.schedulerTimer = setInterval(() => {
      this.runAutoSyncCycle(oracleServiceOrClient).catch((err) => {
        console.error('[AutoSyncScheduler] Cycle error:', err.message);
      });
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Runs an automated update cycle across all controls from Oracle Fusion.
   * Discovers all controls in Oracle Fusion, saves their headers, and automatically syncs
   * their incidents into the single-cell database storage.
   */
  public async runAutoSyncCycle(oracleServiceOrClient: any): Promise<void> {
    if (this.isSchedulerRunning) return;
    this.isSchedulerRunning = true;

    try {
      const client: OracleFusionClient =
        typeof oracleServiceOrClient.getClient === 'function'
          ? oracleServiceOrClient.getClient()
          : oracleServiceOrClient;

      const host = this.getHost();

      // 1. Discover ALL controls directly from Oracle Fusion Catalog (all controls in Oracle)
      let catalogControls: Array<{ id: string; name: string; raw?: any }> = [];
      try {
        if (oracleServiceOrClient && typeof oracleServiceOrClient.getControlCatalogService === 'function') {
          const catalogRes = await oracleServiceOrClient.getControlCatalogService().getAllControls(true);
          if (Array.isArray(catalogRes?.items)) {
            catalogControls = catalogRes.items.map((c: any) => ({
              id: String(c.id).trim(),
              name: c.name || `Control ${c.id}`,
              raw: c.raw || c,
            }));
          }
        } else {
          const res = await client.getAdvancedControls({ limit: 100 });
          if (Array.isArray(res?.items)) {
            catalogControls = res.items.map((c: any) => ({
              id: String(c.Id ?? c.id).trim(),
              name: c.Name ?? c.name ?? `Control ${c.Id ?? c.id}`,
              raw: c,
            }));
          }
        }
      } catch (catErr: any) {
        console.warn('[AutoSyncScheduler] Could not fetch Oracle catalog list:', catErr.message);
      }

      // If catalog discovery didn't find any, fall back to existing database controls
      if (catalogControls.length === 0) {
        const dbFallback = await query<{ control_id: string; control_name: string }>(
          `SELECT control_id, control_name FROM oracle_control_incidents WHERE environment_host = $1`,
          [host]
        );
        catalogControls = dbFallback.rows.map((r) => ({
          id: r.control_id,
          name: r.control_name || `Control ${r.control_id}`,
        }));
      }

      if (catalogControls.length === 0) {
        console.log('[AutoSyncScheduler] No controls available to synchronize.');
        return;
      }

      // 2. Query what is currently saved in PostgreSQL
      const dbRes = await query<{ control_id: string; sync_status: string }>(
        `SELECT control_id, sync_status FROM oracle_control_incidents WHERE environment_host = $1`,
        [host]
      );
      const existingControls = new Set(dbRes.rows.map((r) => r.control_id));

      console.log(
        `[AutoSyncScheduler] Auto-sync cycle started: ${catalogControls.length} total controls discovered in Oracle (${existingControls.size} already in DB).`
      );

      for (let i = 0; i < catalogControls.length; i++) {
        const ctrl = catalogControls[i];
        try {
          // Persist raw control definition to oracle_raw_controls
          if (ctrl.raw) {
            await this.saveRawControl(ctrl.id, ctrl.raw).catch(() => {});
          }

          const isAlreadyInDb = existingControls.has(ctrl.id);

          if (!isAlreadyInDb) {
            // Control was NEVER opened or saved -> Automatically fetch and store it now!
            console.log(
              `[AutoSyncScheduler] [${i + 1}/${catalogControls.length}] Auto-discovering and syncing control ${ctrl.id} ("${ctrl.name}")...`
            );
            await this.syncControlIncidents(ctrl.id, client, ctrl.name);
            console.log(
              `[AutoSyncScheduler] [${i + 1}/${catalogControls.length}] Control ${ctrl.id} stored in database.`
            );
          } else {
            // Already in DB -> Use lightweight micro-probe to detect if Oracle has newer data
            const probe = await this.checkMicroProbe(ctrl.id, client);
            if (probe.hasUpdates) {
              console.log(
                `[AutoSyncScheduler] [${i + 1}/${catalogControls.length}] Control ${ctrl.id} has updates in Oracle. Updating database...`
              );
              await this.syncControlIncidents(ctrl.id, client, ctrl.name);
              console.log(
                `[AutoSyncScheduler] [${i + 1}/${catalogControls.length}] Control ${ctrl.id} updated in database.`
              );
            }
          }
        } catch (ctrlErr: any) {
          console.warn(`[AutoSyncScheduler] Warning syncing control ${ctrl.id}:`, ctrlErr.message);
        }

        // Pacing delay between controls to allow PostgreSQL WAL and memory to clear smoothly
        await new Promise((r) => setTimeout(r, 1500));
      }

      console.log(`[AutoSyncScheduler] Auto-sync cycle completed across all ${catalogControls.length} controls.`);
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
        last_status = $2::varchar,
        last_error = $3,
        last_run_at = CASE WHEN $2::varchar IN ('SUCCESS', 'FAILED') THEN NOW() ELSE last_run_at END,
        next_scheduled_at = CASE
          WHEN $2::varchar = 'SUCCESS' THEN NOW() + (sync_interval_hours || ' hours')::interval
          ELSE next_scheduled_at
        END,
        updated_at = NOW()
      WHERE product_code = $1
    `;

    await query(sql, [code, status, errorMessage || null]);
  }
}

export const controlRawDbService = new ControlRawDbService();
