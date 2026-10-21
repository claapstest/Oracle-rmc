import crypto from 'crypto';
import { query } from '../db.js';
import { config } from '../config.js';

export interface RawAuditRecord {
  id: number;
  environment_host: string;
  product: string;
  business_object: string;
  record_unique_hash: string;
  event_timestamp: string | null;
  username: string | null;
  event_type: string | null;
  raw_payload: any;
  created_at: string;
}

export interface RawAuditQueryFilter {
  product?: string;
  businessObjectType?: string;
  fromDate?: string;
  toDate?: string;
  username?: string;
  action?: string;
  pageNumber?: number;
  pageSize?: number;
}

export class AuditRawDbService {
  private isInitialized = false;

  public getHost(): string {
    const rawUrl = (process.env.FUSION_HOST || config.oracle.baseUrl || 'mock.fusion.oracle.com').trim().toLowerCase();
    try {
      if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
        return new URL(rawUrl).host;
      }
    } catch (_) {}
    return rawUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'default_env';
  }

  public async initTable(): Promise<void> {
    if (this.isInitialized) return;
    const ddl = `
      CREATE TABLE IF NOT EXISTS oracle_raw_audit_records (
        id BIGSERIAL PRIMARY KEY,
        environment_host VARCHAR(255) NOT NULL,
        product VARCHAR(150) NOT NULL,
        business_object VARCHAR(255) NOT NULL,
        record_unique_hash VARCHAR(64) NOT NULL,
        event_timestamp TIMESTAMPTZ,
        username VARCHAR(150),
        event_type VARCHAR(100),
        raw_payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT uq_raw_audit UNIQUE(environment_host, product, business_object, record_unique_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_raw_audit_lookup 
      ON oracle_raw_audit_records(environment_host, product, business_object, event_timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_raw_audit_user
      ON oracle_raw_audit_records(environment_host, username);

      CREATE TABLE IF NOT EXISTS oracle_audit_sync_state (
        environment_host VARCHAR(255) NOT NULL,
        product VARCHAR(150) NOT NULL,
        last_synced_at TIMESTAMPTZ NOT NULL,
        records_synced INT DEFAULT 0,
        sync_status VARCHAR(50) DEFAULT 'SUCCESS',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT uq_audit_sync_state UNIQUE(environment_host, product)
      );

      CREATE INDEX IF NOT EXISTS idx_audit_sync_state_host
      ON oracle_audit_sync_state(environment_host);
    `;

    try {
      await query(ddl);
      this.isInitialized = true;
      console.log('[AuditRawDbService] Database tables oracle_raw_audit_records & oracle_audit_sync_state ready.');
    } catch (err: any) {
      console.error('[AuditRawDbService] Failed to initialize table:', err.message);
      throw err;
    }
  }

  /**
   * Normalizes Oracle product names to ensure consistent aggregation across tables.
   */
  public normalizeProductName(rawName?: string): string {
    if (!rawName) return 'Oracle Fusion';
    const s = String(rawName).trim();
    const lower = s.toLowerCase();
    if (lower.includes('risk') || lower.includes('racm') || lower.includes('rmc')) {
      return 'Risks and Controls';
    }
    if (lower.includes('human') || lower.includes('hcm') || lower.includes('per')) {
      return 'Global Human Resources';
    }
    if (lower.includes('security services') || lower.includes('opss') || lower === 'oracle platform security services') {
      return 'Oracle Platform Security Services';
    }
    return s;
  }

  /**
   * Retrieves the last successful sync timestamp for a product (or __GLOBAL__).
   * If none exists, defaults to 24 hours ago.
   */
  public async getLastSyncTime(product = '__GLOBAL__'): Promise<Date> {
    await this.initTable();
    const host = this.getHost();
    const normalizedProduct = product === '__GLOBAL__' ? '__GLOBAL__' : this.normalizeProductName(product);
    try {
      const res = await query<{ last_synced_at: Date }>(
        `SELECT last_synced_at FROM oracle_audit_sync_state WHERE environment_host = $1 AND product = $2 LIMIT 1`,
        [host, normalizedProduct]
      );
      if (res.rows.length > 0 && res.rows[0].last_synced_at) {
        return new Date(res.rows[0].last_synced_at);
      }
    } catch (err: any) {
      console.warn('[AuditRawDbService] getLastSyncTime error:', err.message);
    }
    // Default fallback: exactly 24 hours ago
    return new Date(Date.now() - 24 * 60 * 60 * 1000);
  }

  /**
   * Updates or inserts the sync timestamp watermark for a product or globally.
   */
  public async updateSyncState(product: string, recordsSynced = 0, syncStatus = 'SUCCESS'): Promise<void> {
    await this.initTable();
    const host = this.getHost();
    const normalizedProduct = product === '__GLOBAL__' ? '__GLOBAL__' : this.normalizeProductName(product);
    const sql = `
      INSERT INTO oracle_audit_sync_state (
        environment_host, product, last_synced_at, records_synced, sync_status, updated_at
      )
      VALUES ($1, $2, NOW(), $3, $4, NOW())
      ON CONFLICT (environment_host, product)
      DO UPDATE SET
        last_synced_at = NOW(),
        records_synced = EXCLUDED.records_synced,
        sync_status = EXCLUDED.sync_status,
        updated_at = NOW();
    `;
    try {
      await query(sql, [host, normalizedProduct, recordsSynced, syncStatus]);
    } catch (err: any) {
      console.error('[AuditRawDbService] updateSyncState error:', err.message);
    }
  }

  /**
   * Generates a deterministic hash for deduplicating raw Oracle audit items.
   */
  public generateHash(item: any): string {
    const ts = item.date || item.timestamp || item.lastUpdateDate || '';
    const user = item.userInternalName || item.userName || item.userId || '';
    const id = item.identifier || item.objectIdentifier || item.id || '';
    const event = item.eventType || item.action || '';
    const desc = item.description || '';
    const seed = `${ts}|${user}|${id}|${event}|${desc}`;
    return crypto.createHash('md5').update(seed).digest('hex');
  }

  /**
   * Inserts raw Oracle Fusion audit records in bulk with ON CONFLICT DO NOTHING.
   * Returns the count of newly inserted rows.
   */
  public async saveRawAuditRecords(
    product: string,
    businessObject: string,
    rawItems: any[]
  ): Promise<number> {
    if (!rawItems || rawItems.length === 0) return 0;
    await this.initTable();

    const host = this.getHost();
    const normalizedProduct = this.normalizeProductName(product);
    let insertedCount = 0;

    for (const item of rawItems) {
      if (!item || typeof item !== 'object') continue;

      const hash = this.generateHash(item);
      const rawTimestamp = item.date || item.timestamp || item.lastUpdateDate;
      let eventDate: Date | null = null;
      if (rawTimestamp) {
        const d = new Date(rawTimestamp);
        if (!isNaN(d.getTime())) eventDate = d;
      }

      const username = item.userInternalName || item.userName || item.userId || null;
      const eventType = item.eventType || item.action || null;
      const rawJson = JSON.stringify(item);

      const sql = `
        INSERT INTO oracle_raw_audit_records (
          environment_host,
          product,
          business_object,
          record_unique_hash,
          event_timestamp,
          username,
          event_type,
          raw_payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        ON CONFLICT (environment_host, product, business_object, record_unique_hash)
        DO NOTHING
        RETURNING id;
      `;

      try {
        const res = await query(sql, [
          host,
          normalizedProduct,
          businessObject,
          hash,
          eventDate,
          username,
          eventType,
          rawJson
        ]);
        if (res.rowCount && res.rowCount > 0) {
          insertedCount++;
        }
      } catch (err: any) {
        console.error('[AuditRawDbService] Insert error on item:', err.message);
      }
    }

    return insertedCount;
  }

  /**
   * Retrieves raw payload items from the database matching filter parameters.
   * Exact 1:1 format to Oracle Fusion's auditData array.
   */
  public async getRawAuditRecords(params: RawAuditQueryFilter): Promise<{
    rawItems: any[];
    totalCount: number;
    pageNumber: number;
    pageSize: number;
  }> {
    await this.initTable();
    const host = this.getHost();
    const pageNumber = params.pageNumber && params.pageNumber > 0 ? params.pageNumber : 1;
    const pageSize = params.pageSize && params.pageSize > 0 ? params.pageSize : 50;
    const offset = (pageNumber - 1) * pageSize;

    const conditions: string[] = ['environment_host = $1'];
    const values: any[] = [host];
    let paramIdx = 2;

    if (params.product) {
      conditions.push(`(product ILIKE $${paramIdx} OR product ILIKE $${paramIdx + 1})`);
      values.push(`%${params.product}%`);
      values.push(params.product);
      paramIdx += 2;
    }

    if (params.businessObjectType) {
      conditions.push(`(business_object ILIKE $${paramIdx} OR business_object = $${paramIdx + 1})`);
      values.push(`%${params.businessObjectType}%`);
      values.push(params.businessObjectType);
      paramIdx += 2;
    }

    if (params.fromDate) {
      conditions.push(`event_timestamp >= $${paramIdx}`);
      values.push(new Date(params.fromDate));
      paramIdx++;
    }

    if (params.toDate) {
      const toD = new Date(params.toDate);
      toD.setHours(23, 59, 59, 999);
      conditions.push(`event_timestamp <= $${paramIdx}`);
      values.push(toD);
      paramIdx++;
    }

    if (params.username) {
      conditions.push(`(username ILIKE $${paramIdx} OR raw_payload->>'userName' ILIKE $${paramIdx})`);
      values.push(`%${params.username}%`);
      paramIdx++;
    }

    if (params.action && params.action !== 'ALL') {
      conditions.push(`(event_type ILIKE $${paramIdx} OR raw_payload->>'eventType' ILIKE $${paramIdx})`);
      values.push(`%${params.action}%`);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    // 1. Get total count
    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM oracle_raw_audit_records WHERE ${whereClause}`,
      values
    );
    const totalCount = parseInt(countRes.rows[0]?.count || '0', 10);

    // 2. Fetch paginated raw_payload
    const querySql = `
      SELECT raw_payload 
      FROM oracle_raw_audit_records 
      WHERE ${whereClause}
      ORDER BY event_timestamp DESC NULLS LAST, id DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;
    values.push(pageSize, offset);

    const dataRes = await query<{ raw_payload: any }>(querySql, values);
    const rawItems = dataRes.rows.map(r => r.raw_payload);

    return {
      rawItems,
      totalCount,
      pageNumber,
      pageSize
    };
  }

  /**
   * Gets the latest timestamp and total count stored for a product/BO.
   */
  public async getWatermark(product: string, businessObject: string): Promise<{
    lastUpdateDate: Date | null;
    totalCount: number;
  }> {
    await this.initTable();
    const host = this.getHost();
    const res = await query<{ last_date: string | null; count: string }>(
      `SELECT MAX(event_timestamp) AS last_date, COUNT(*) AS count 
       FROM oracle_raw_audit_records 
       WHERE environment_host = $1 AND product = $2 AND business_object = $3`,
      [host, product, businessObject]
    );

    const row = res.rows[0];
    return {
      lastUpdateDate: row?.last_date ? new Date(row.last_date) : null,
      totalCount: parseInt(row?.count || '0', 10)
    };
  }

  /**
   * Aggregates risk trend time-series by product, event type, and date interval (7d, 30d, 90d, YTD Jan to Present, Custom).
   */
  public async getRiskTrend(filter: {
    product?: string;
    eventType?: string;
    range?: string;
    fromDate?: string;
    toDate?: string;
  } = {}): Promise<{
    trend: Array<{ date: string; count: number; inserts: number; updates: number; deletes: number }>;
    summary: {
      totalEvents: number;
      totalInserts: number;
      totalUpdates: number;
      totalDeletes: number;
      peakDate: string | null;
      peakCount: number;
    };
    products: string[];
    filterApplied: {
      product: string;
      eventType: string;
      range: string;
      fromDate: string;
      toDate: string;
    };
  }> {
    await this.initTable();
    const host = this.getHost();

    // Determine target date window
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    let range = filter.range || '30d';
    let fromDate = filter.fromDate;
    let toDate = filter.toDate || todayStr;

    if (range === '7d') {
      const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      fromDate = d.toISOString().split('T')[0];
    } else if (range === '30d') {
      const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      fromDate = d.toISOString().split('T')[0];
    } else if (range === '90d') {
      const d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      fromDate = d.toISOString().split('T')[0];
    } else if (range === 'ytd' || range === 'jan_to_now' || range === 'all') {
      fromDate = `${now.getFullYear()}-01-01`;
      range = 'jan_to_now';
    } else if (!fromDate) {
      const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      fromDate = d.toISOString().split('T')[0];
      range = '30d';
    }

    const conditions: string[] = ['environment_host = $1', 'event_timestamp IS NOT NULL'];
    const values: any[] = [host];
    let paramIdx = 2;

    const selectedProduct = filter.product || 'ALL';
    if (selectedProduct !== 'ALL') {
      conditions.push(`(product = $${paramIdx} OR product ILIKE $${paramIdx + 1})`);
      values.push(selectedProduct, `%${selectedProduct}%`);
      paramIdx += 2;
    }

    if (fromDate) {
      conditions.push(`event_timestamp >= $${paramIdx}::timestamptz`);
      values.push(`${fromDate} 00:00:00`);
      paramIdx++;
    }

    if (toDate) {
      conditions.push(`event_timestamp <= $${paramIdx}::timestamptz`);
      values.push(`${toDate} 23:59:59.999`);
      paramIdx++;
    }

    const selectedEventType = filter.eventType || 'ALL';
    if (selectedEventType !== 'ALL') {
      const et = selectedEventType.toUpperCase();
      if (et === 'INSERT' || et === 'INSERTS') {
        conditions.push(`(event_type ILIKE '%INSERT%' OR event_type ILIKE '%CREATE%' OR event_type ILIKE '%ADD%' OR event_type ILIKE '%GRANT%')`);
      } else if (et === 'UPDATE' || et === 'UPDATES') {
        conditions.push(`(event_type ILIKE '%UPDATE%' OR event_type ILIKE '%MODIFY%')`);
      } else if (et === 'DELETE' || et === 'DELETES') {
        conditions.push(`(event_type ILIKE '%DELETE%' OR event_type ILIKE '%REMOVE%' OR event_type ILIKE '%REVOKE%')`);
      } else {
        conditions.push(`event_type ILIKE $${paramIdx}`);
        values.push(`%${selectedEventType}%`);
        paramIdx++;
      }
    }

    const whereClause = conditions.join(' AND ');

    const sql = `
      SELECT 
        TO_CHAR(event_timestamp, 'YYYY-MM-DD') AS date,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE event_type ILIKE '%INSERT%' OR event_type ILIKE '%CREATE%' OR event_type ILIKE '%ADD%' OR event_type ILIKE '%GRANT%')::int AS inserts,
        COUNT(*) FILTER (WHERE event_type ILIKE '%UPDATE%' OR event_type ILIKE '%MODIFY%')::int AS updates,
        COUNT(*) FILTER (WHERE event_type ILIKE '%DELETE%' OR event_type ILIKE '%REMOVE%' OR event_type ILIKE '%REVOKE%')::int AS deletes
      FROM oracle_raw_audit_records
      WHERE ${whereClause}
      GROUP BY TO_CHAR(event_timestamp, 'YYYY-MM-DD')
      ORDER BY date ASC
    `;

    const [trendRes, productsRes] = await Promise.all([
      query<{ date: string; count: number; inserts: number; updates: number; deletes: number }>(sql, values),
      query<{ product: string }>(
        `SELECT DISTINCT product FROM oracle_raw_audit_records WHERE environment_host = $1 AND product IS NOT NULL ORDER BY product ASC`,
        [host]
      )
    ]);

    const trend = trendRes.rows;
    const products = productsRes.rows.map(r => r.product);

    let totalEvents = 0;
    let totalInserts = 0;
    let totalUpdates = 0;
    let totalDeletes = 0;
    let peakCount = 0;
    let peakDate: string | null = null;

    for (const item of trend) {
      const c = Number(item.count || 0);
      const ins = Number(item.inserts || 0);
      const upd = Number(item.updates || 0);
      const del = Number(item.deletes || 0);
      totalEvents += c;
      totalInserts += ins;
      totalUpdates += upd;
      totalDeletes += del;
      if (c > peakCount) {
        peakCount = c;
        peakDate = item.date;
      }
    }

    return {
      trend,
      summary: {
        totalEvents,
        totalInserts,
        totalUpdates,
        totalDeletes,
        peakDate,
        peakCount
      },
      products,
      filterApplied: {
        product: selectedProduct,
        eventType: selectedEventType,
        range,
        fromDate: fromDate || '',
        toDate: toDate || ''
      }
    };
  }

  /**
   * Aggregates active products that have audit records for today, yesterday, previous active day, or last 7/30 days.
   */
  /**
   * Aggregates active products that have audit records for 24h sync window, today, yesterday, previous active day, or last 7/30 days.
   */
  public async getProductActivitySummary(filter: {
    timeframe?: string;
  } = {}): Promise<{
    timeframe: string;
    effectiveDateLabel: string;
    targetDate: string;
    products: Array<{
      product: string;
      totalRecords: number;
      inserts: number;
      updates: number;
      deletes: number;
      latestEventTime: string | null;
      lastSyncedAt: string | null;
      businessObjects: Array<{
        businessObject: string;
        totalRecords: number;
        inserts: number;
        updates: number;
        deletes: number;
        latestEventTime: string | null;
      }>;
    }>;
    totalActiveProducts: number;
    totalRecordsAcrossProducts: number;
  }> {
    await this.initTable();
    const host = this.getHost();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const timeframe = filter.timeframe || '24h';
    let whereClause = 'environment_host = $1 AND event_timestamp IS NOT NULL';
    const values: any[] = [host];
    let effectiveDateLabel = 'Last 24 Hours (Daily Sync Window)';
    let targetDate = todayStr;

    if (timeframe === '24h' || timeframe === 'rolling_24h') {
      const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      whereClause += ` AND event_timestamp >= $2::timestamptz`;
      values.push(cutoff.toISOString());
      effectiveDateLabel = 'Last 24 Hours (Rolling)';
      targetDate = todayStr;
    } else if (timeframe === 'today') {
      whereClause += ` AND TO_CHAR(event_timestamp, 'YYYY-MM-DD') = $2`;
      values.push(todayStr);
      effectiveDateLabel = `Today (${todayStr})`;
      targetDate = todayStr;
    } else if (timeframe === 'yesterday') {
      whereClause += ` AND TO_CHAR(event_timestamp, 'YYYY-MM-DD') = $2`;
      values.push(yesterdayStr);
      effectiveDateLabel = `Yesterday (${yesterdayStr})`;
      targetDate = yesterdayStr;
    } else if (timeframe === 'previous_active') {
      // Find latest distinct date prior to today with records
      const prevDateRes = await query<{ day: string }>(
        `SELECT DISTINCT TO_CHAR(event_timestamp, 'YYYY-MM-DD') as day 
         FROM oracle_raw_audit_records 
         WHERE environment_host = $1 AND TO_CHAR(event_timestamp, 'YYYY-MM-DD') < $2
         ORDER BY day DESC LIMIT 1`,
        [host, todayStr]
      );
      const prevDay = prevDateRes.rows[0]?.day || yesterdayStr;
      whereClause += ` AND TO_CHAR(event_timestamp, 'YYYY-MM-DD') = $2`;
      values.push(prevDay);
      effectiveDateLabel = `Previous Active Day (${prevDay})`;
      targetDate = prevDay;
    } else if (timeframe === '7d') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      whereClause += ` AND event_timestamp >= $2::timestamptz`;
      values.push(`${sevenDaysAgo} 00:00:00`);
      effectiveDateLabel = `Last 7 Days (since ${sevenDaysAgo})`;
      targetDate = sevenDaysAgo;
    } else if (timeframe === '30d') {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      whereClause += ` AND event_timestamp >= $2::timestamptz`;
      values.push(`${thirtyDaysAgo} 00:00:00`);
      effectiveDateLabel = `Last 30 Days (since ${thirtyDaysAgo})`;
      targetDate = thirtyDaysAgo;
    } else {
      effectiveDateLabel = 'All Time';
    }

    // 1. Aggregate at product level with normalized names
    const sqlProducts = `
      WITH norm AS (
        SELECT 
          CASE 
            WHEN product ILIKE '%Risks and Controls%' THEN 'Risks and Controls'
            WHEN product ILIKE '%Global Human Resources%' THEN 'Global Human Resources'
            WHEN product ILIKE '%Security Services%' OR product ILIKE '%OPSS%' THEN 'Oracle Platform Security Services'
            ELSE product 
          END as norm_product,
          business_object,
          event_type,
          event_timestamp
        FROM oracle_raw_audit_records
        WHERE ${whereClause}
      )
      SELECT 
        norm_product as product,
        COUNT(*)::int as total_records,
        COUNT(*) FILTER (WHERE event_type ILIKE '%INSERT%' OR event_type ILIKE '%CREATE%' OR event_type ILIKE '%ADD%' OR event_type ILIKE '%GRANT%')::int as inserts,
        COUNT(*) FILTER (WHERE event_type ILIKE '%UPDATE%' OR event_type ILIKE '%MODIFY%')::int as updates,
        COUNT(*) FILTER (WHERE event_type ILIKE '%DELETE%' OR event_type ILIKE '%REMOVE%' OR event_type ILIKE '%REVOKE%')::int as deletes,
        MAX(event_timestamp) as latest_event_time
      FROM norm
      GROUP BY norm_product
      HAVING COUNT(*) > 0
      ORDER BY total_records DESC;
    `;

    // 2. Aggregate at business object level with normalized names
    const sqlBO = `
      WITH norm AS (
        SELECT 
          CASE 
            WHEN product ILIKE '%Risks and Controls%' THEN 'Risks and Controls'
            WHEN product ILIKE '%Global Human Resources%' THEN 'Global Human Resources'
            WHEN product ILIKE '%Security Services%' OR product ILIKE '%OPSS%' THEN 'Oracle Platform Security Services'
            ELSE product 
          END as norm_product,
          business_object,
          event_type,
          event_timestamp
        FROM oracle_raw_audit_records
        WHERE ${whereClause}
      )
      SELECT 
        norm_product as product,
        business_object,
        COUNT(*)::int as total_records,
        COUNT(*) FILTER (WHERE event_type ILIKE '%INSERT%' OR event_type ILIKE '%CREATE%' OR event_type ILIKE '%ADD%' OR event_type ILIKE '%GRANT%')::int as inserts,
        COUNT(*) FILTER (WHERE event_type ILIKE '%UPDATE%' OR event_type ILIKE '%MODIFY%')::int as updates,
        COUNT(*) FILTER (WHERE event_type ILIKE '%DELETE%' OR event_type ILIKE '%REMOVE%' OR event_type ILIKE '%REVOKE%')::int as deletes,
        MAX(event_timestamp) as latest_event_time
      FROM norm
      GROUP BY norm_product, business_object
      ORDER BY norm_product, total_records DESC;
    `;

    // 3. Query sync states
    const sqlSync = `
      SELECT product, last_synced_at, sync_status 
      FROM oracle_audit_sync_state 
      WHERE environment_host = $1;
    `;

    const [resProducts, resBO, resSync] = await Promise.all([
      query<any>(sqlProducts, values),
      query<any>(sqlBO, values),
      query<any>(sqlSync, [host]).catch(() => ({ rows: [] }))
    ]);

    const syncMap = new Map<string, string>();
    for (const s of resSync.rows) {
      if (s.last_synced_at) {
        syncMap.set(s.product, new Date(s.last_synced_at).toISOString());
      }
    }

    const boMap = new Map<string, any[]>();
    for (const b of resBO.rows) {
      const p = b.product;
      if (!boMap.has(p)) boMap.set(p, []);
      boMap.get(p)!.push({
        businessObject: b.business_object,
        totalRecords: Number(b.total_records || 0),
        inserts: Number(b.inserts || 0),
        updates: Number(b.updates || 0),
        deletes: Number(b.deletes || 0),
        latestEventTime: b.latest_event_time ? new Date(b.latest_event_time).toISOString() : null
      });
    }

    const products = resProducts.rows.map(r => {
      const prodName = r.product;
      const lastSync = syncMap.get(prodName) || syncMap.get('__GLOBAL__') || null;
      return {
        product: prodName,
        totalRecords: Number(r.total_records || 0),
        inserts: Number(r.inserts || 0),
        updates: Number(r.updates || 0),
        deletes: Number(r.deletes || 0),
        latestEventTime: r.latest_event_time ? new Date(r.latest_event_time).toISOString() : null,
        lastSyncedAt: lastSync,
        businessObjects: boMap.get(prodName) || []
      };
    });

    const totalRecordsAcrossProducts = products.reduce((sum, p) => sum + p.totalRecords, 0);

    return {
      timeframe,
      effectiveDateLabel,
      targetDate,
      products,
      totalActiveProducts: products.length,
      totalRecordsAcrossProducts
    };
  }

  private schedulerTimer: NodeJS.Timeout | null = null;

  /**
   * Synchronizes audit trail records for a specific product on-demand.
   * Uses rolling window from the product's last_synced_at to now.
   */
  public async syncProduct(
    productName: string,
    oracleClient?: any,
    catalogService?: any,
    options?: { fromDate?: string; toDate?: string; businessObject?: string }
  ): Promise<{
    product: string;
    syncedCount: number;
    savedCount: number;
    lastSyncedAt: string;
  }> {
    const normalizedProduct = this.normalizeProductName(productName);
    console.log(`[AuditRawDbService] Starting product-level sync for ${normalizedProduct}...`);

    const now = new Date();
    const lastSync = await this.getLastSyncTime(normalizedProduct);
    const formatDate = (d: Date) => d.toISOString().split('T')[0];
    const fromDateStr = options?.fromDate || formatDate(lastSync);
    const toDateStr = options?.toDate || formatDate(now);

    const client = oracleClient;
    if (!client) {
      throw new Error('Oracle Fusion client is not initialized.');
    }

    const allProducts = catalogService?.getAllProducts?.() || [];
    const prodDef = allProducts.find((p: any) =>
      p.displayName === normalizedProduct ||
      p.productName === normalizedProduct ||
      p.displayName === productName ||
      p.productName === productName ||
      (p.aliases && p.aliases.includes(productName))
    );

    let businessObjectsToSync: Array<{ businessObject?: string }> = [];
    if (options?.businessObject) {
      businessObjectsToSync = [{ businessObject: options.businessObject }];
    } else if (prodDef && Array.isArray(prodDef.businessObjects) && prodDef.businessObjects.length > 0) {
      businessObjectsToSync = prodDef.businessObjects
        .filter((b: any) => b.isSupported !== false)
        .map((b: any) => ({ businessObject: b.displayName }));
    } else {
      businessObjectsToSync = [{ businessObject: undefined }];
    }

    let totalSynced = 0;
    let totalSaved = 0;

    for (const boItem of businessObjectsToSync) {
      try {
        const resolution = catalogService?.resolveAuditRequest(normalizedProduct, boItem.businessObject);
        if (!resolution || resolution.status !== 'CONFIRMED') continue;

        const template = resolution.businessObject?.payloadTemplate || resolution.product?.defaultPayloadTemplate;
        const restProduct = resolution.product?.restProduct || resolution.product?.shortCodes?.[0] || normalizedProduct;
        const restBO = resolution.businessObject?.restBusinessObjectType || resolution.businessObject?.restValue;

        const payload: any = {
          fromDate: fromDateStr,
          toDate: toDateStr,
          eventType: 'ALL'
        };

        if (template?.productId) payload.productId = template.productId;
        else if (resolution.product?.productId) payload.productId = resolution.product.productId;

        if (template?.product) payload.product = template.product;
        else if (!payload.productId && restProduct) payload.product = restProduct;

        if (template?.businessObjectType) payload.businessObjectType = template.businessObjectType;
        else if (restBO) payload.businessObjectType = restBO;

        if (template?.timeZone) payload.timeZone = template.timeZone;

        const resp = await client.getAuditHistory(payload, { pageNumber: 1, pageSize: 500 });
        const rawItems = Array.isArray(resp?.auditData) ? resp.auditData : (resp?.auditHistory || resp?.items || []);
        totalSynced += rawItems.length;

        if (rawItems.length > 0) {
          const inserted = await this.saveRawAuditRecords(
            normalizedProduct,
            boItem.businessObject || 'All Platform Events',
            rawItems
          );
          totalSaved += inserted;
        }
      } catch (err: any) {
        console.warn(`[Product Sync Warning] Failed for ${normalizedProduct} -> ${boItem.businessObject}:`, err.message);
      }
    }

    await this.updateSyncState(normalizedProduct, totalSaved, 'SUCCESS');
    return {
      product: normalizedProduct,
      syncedCount: totalSynced,
      savedCount: totalSaved,
      lastSyncedAt: now.toISOString()
    };
  }

  /**
   * Performs an incremental sync of active products from the last sync timestamp up to current time.
   */
  public async runDailyIncrementalSync(
    oracleClient?: any,
    catalogService?: any,
    options?: { fromDate?: string; toDate?: string }
  ): Promise<{
    totalSynced: number;
    totalSaved: number;
    targetsProcessed: number;
    lastSyncedAt: string;
  }> {
    console.log('[AuditRawDbService] Starting automated daily audit incremental sync...');
    const now = new Date();
    const lastSync = await this.getLastSyncTime('__GLOBAL__');
    const formatDate = (d: Date) => d.toISOString().split('T')[0];
    const fromDateStr = options?.fromDate || formatDate(lastSync);
    const toDateStr = options?.toDate || now.toISOString().split('T')[0];

    console.log(`[Audit Daily Sync Window] Retrieving records from ${fromDateStr} (${lastSync.toISOString()}) to ${toDateStr} (${now.toISOString()})`);

    const targets = [
      // 1. Risks and Controls (RACM / RMC)
      { product: 'Risks and Controls', businessObject: 'Advanced Controls' },
      { product: 'Risks and Controls', businessObject: 'Entitlements' },
      { product: 'Risks and Controls', businessObject: 'Global Conditions' },
      { product: 'Risks and Controls', businessObject: 'Global Users' },
      { product: 'Risks and Controls', businessObject: 'User Groups' },
      { product: 'Risks and Controls', businessObject: 'Business Object Security' },
      // 2. Audit Policies
      { product: 'Audit Policies', businessObject: 'Oracle Fusion business objects and attributes' },
      { product: 'Audit Policies', businessObject: 'Oracle Platform Security Services' },
      // 3. Common CRM
      { product: 'Common CRM', businessObject: 'Household' },
      { product: 'Common CRM', businessObject: 'Account' },
      { product: 'Common CRM', businessObject: 'Sales Account' },
      // 4. General Ledger
      { product: 'General Ledger', businessObject: 'Accounting Calendar Setup' },
      { product: 'General Ledger', businessObject: 'Period Status' },
      { product: 'General Ledger', businessObject: 'Period Details' },
      { product: 'General Ledger', businessObject: 'Journal Batch' },
      { product: 'General Ledger', businessObject: 'Journal Header' },
      { product: 'General Ledger', businessObject: 'Journal Line' },
      { product: 'General Ledger', businessObject: 'Chart of Accounts Options Setup' },
      { product: 'General Ledger', businessObject: 'Combination Set' },
      // 5. Global Human Resources
      { product: 'Global Human Resources', businessObject: 'Document Records' },
      // 6. HCM Common Architecture
      { product: 'HCM Common Architecture', businessObject: 'Configure HCM Data Loader Parameters' },
      { product: 'HCM Common Architecture', businessObject: 'HCM Data Loader Business Objects Access' },
      // 7. Inventory Management
      { product: 'Inventory Management', businessObject: 'Interorganization Parameter' },
      { product: 'Inventory Management', businessObject: 'Subinventory' },
      { product: 'Inventory Management', businessObject: 'Lot' },
      { product: 'Inventory Management', businessObject: 'Serial Number' },
      // 8. Payables
      { product: 'Payables', businessObject: 'Invoice' },
      { product: 'Payables', businessObject: 'Aging Periods' },
      { product: 'Payables', businessObject: 'Aging Period Details' },
      { product: 'Payables', businessObject: 'Distribution Sets' },
      { product: 'Payables', businessObject: 'Distribution Set Details' },
      { product: 'Payables', businessObject: 'Invoice Holds and Releases' },
      { product: 'Payables', businessObject: 'Invoice Tolerances' },
      { product: 'Payables', businessObject: 'Set Assignments' },
      { product: 'Payables', businessObject: 'Payment Terms' },
      { product: 'Payables', businessObject: 'Installments' },
      { product: 'Payables', businessObject: 'Reporting Entities' },
      { product: 'Payables', businessObject: 'Balancing Segment Values' },
      { product: 'Payables', businessObject: 'Bank Charge Details' },
      { product: 'Payables', businessObject: 'Interest Rates' },
      { product: 'Payables', businessObject: 'Intelligent Document Recognition Options' },
      { product: 'Payables', businessObject: 'Common Options for Payables and Procurement' },
      { product: 'Payables', businessObject: 'General Payables Options' },
      { product: 'Payables', businessObject: 'Period Information' },
      { product: 'Payables', businessObject: 'Payables Calendars' },
      // 9. Profile Management
      { product: 'Profile Management', businessObject: 'Model Certification Profile Items' },
      { product: 'Profile Management', businessObject: 'Person Certification Profile Items' },
      { product: 'Profile Management', businessObject: 'Person Skill Profile Items' },
      // 10. Public Sector Common Components
      { product: 'Public Sector Common Components', businessObject: 'Trading Community Customer Billing Account' },
      { product: 'Public Sector Common Components', businessObject: 'Household' },
      { product: 'Public Sector Common Components', businessObject: 'Account' },
      // 11. Quality Issue and Action Management
      { product: 'Quality Issue and Action Management', businessObject: 'Quality Action Affected Object' },
      { product: 'Quality Issue and Action Management', businessObject: 'Quality Action Attachment' },
      { product: 'Quality Issue and Action Management', businessObject: 'Source Quality Action' },
      { product: 'Quality Issue and Action Management', businessObject: 'Quality Action' },
      { product: 'Quality Issue and Action Management', businessObject: 'Quality Issue Affected Object' },
      { product: 'Quality Issue and Action Management', businessObject: 'Quality Issue Attachment' },
      { product: 'Quality Issue and Action Management', businessObject: 'Destination Quality Issue' },
      { product: 'Quality Issue and Action Management', businessObject: 'Quality Issue' },
      // 12. Receivables
      { product: 'Receivables', businessObject: 'Trading Community Customer Billing Account' },
      { product: 'Receivables', businessObject: 'Receivables Customer Profile Class Amount' },
      { product: 'Receivables', businessObject: 'Receivables Customer Profile Class' },
      { product: 'Receivables', businessObject: 'Customer Profile Amount' },
      { product: 'Receivables', businessObject: 'Customer Profile' },
      { product: 'Receivables', businessObject: 'Receivables User Approval Limit' },
      { product: 'Receivables', businessObject: 'Payment Terms' },
      // 13. Service
      { product: 'Service', businessObject: 'Service Request' },
      { product: 'Service', businessObject: 'Category' },
      { product: 'Service', businessObject: 'Service Request Reference' },
      // Common Components & OPSS
      { product: 'Applications Common Components', businessObject: 'Account' },
      { product: 'Oracle Platform Security Services', businessObject: undefined }
    ];

    let totalSynced = 0;
    let totalNew = 0;
    let targetsProcessed = 0;

    for (const t of targets) {
      try {
        const client = oracleClient;
        if (!client) continue;

        const resolution = catalogService?.resolveAuditRequest(t.product, t.businessObject);
        if (!resolution || resolution.status !== 'CONFIRMED') continue;

        const template = resolution.businessObject?.payloadTemplate || resolution.product?.defaultPayloadTemplate;
        const restProduct = resolution.product?.restProduct || resolution.product?.shortCodes?.[0] || t.product;
        const restBO = resolution.businessObject?.restBusinessObjectType || resolution.businessObject?.restValue;

        const payload: any = {
          fromDate: fromDateStr,
          toDate: toDateStr,
          eventType: 'ALL'
        };

        if (template?.productId) payload.productId = template.productId;
        else if (resolution.product?.productId) payload.productId = resolution.product.productId;

        if (template?.product) payload.product = template.product;
        else if (!payload.productId && restProduct) payload.product = restProduct;

        if (template?.businessObjectType) payload.businessObjectType = template.businessObjectType;
        else if (restBO) payload.businessObjectType = restBO;

        if (template?.timeZone) payload.timeZone = template.timeZone;

        const resp = await client.getAuditHistory(payload, { pageNumber: 1, pageSize: 500 });
        const rawItems = Array.isArray(resp?.auditData) ? resp.auditData : (resp?.auditHistory || resp?.items || []);
        totalSynced += rawItems.length;
        targetsProcessed++;

        if (rawItems.length > 0) {
          const inserted = await this.saveRawAuditRecords(t.product, t.businessObject || 'All Platform Events', rawItems);
          totalNew += inserted;
          console.log(`[Audit Daily Sync] ${t.product}: fetched ${rawItems.length}, saved ${inserted} new records.`);
          await this.updateSyncState(t.product, inserted, 'SUCCESS');
        }
      } catch (err: any) {
        console.warn(`[Audit Daily Sync Warning] Failed for ${t.product}:`, err.message);
      }
    }

    await this.updateSyncState('__GLOBAL__', totalNew, 'SUCCESS');
    console.log(`[AuditRawDbService] Incremental sync complete. Total fetched: ${totalSynced}, total new records inserted: ${totalNew}`);
    return {
      totalSynced,
      totalSaved: totalNew,
      targetsProcessed,
      lastSyncedAt: now.toISOString()
    };
  }

  /**
   * Starts recurring 24-hour background scheduler.
   */
  public startDailyScheduler(oracleClient: any, catalogService: any, intervalHours = 24): void {
    if (this.schedulerTimer) return;
    const intervalMs = intervalHours * 60 * 60 * 1000;
    console.log(`[AuditRawDbService] Automated daily sync scheduler active (every ${intervalHours} hours). Next run scheduled.`);

    this.schedulerTimer = setInterval(() => {
      this.runDailyIncrementalSync(oracleClient, catalogService).catch(e => {
        console.error('[Audit Daily Sync Error]:', e.message);
      });
    }, intervalMs);

    if (this.schedulerTimer.unref) {
      this.schedulerTimer.unref();
    }
  }
}

export const auditRawDbService = new AuditRawDbService();
