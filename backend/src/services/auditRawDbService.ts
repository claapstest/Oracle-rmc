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
    `;

    try {
      await query(ddl);
      this.isInitialized = true;
      console.log('[AuditRawDbService] Database table oracle_raw_audit_records ready.');
    } catch (err: any) {
      console.error('[AuditRawDbService] Failed to initialize table:', err.message);
      throw err;
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
          product,
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

    const timeframe = filter.timeframe || 'today';
    let whereClause = 'environment_host = $1 AND event_timestamp IS NOT NULL';
    const values: any[] = [host];
    let effectiveDateLabel = 'Today';
    let targetDate = todayStr;

    if (timeframe === 'today') {
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

    const sql = `
      SELECT 
        product,
        COUNT(*)::int as total_records,
        COUNT(*) FILTER (WHERE event_type ILIKE '%INSERT%' OR event_type ILIKE '%CREATE%' OR event_type ILIKE '%ADD%' OR event_type ILIKE '%GRANT%')::int as inserts,
        COUNT(*) FILTER (WHERE event_type ILIKE '%UPDATE%' OR event_type ILIKE '%MODIFY%')::int as updates,
        COUNT(*) FILTER (WHERE event_type ILIKE '%DELETE%' OR event_type ILIKE '%REMOVE%' OR event_type ILIKE '%REVOKE%')::int as deletes,
        MAX(event_timestamp) as latest_event_time
      FROM oracle_raw_audit_records
      WHERE ${whereClause}
      GROUP BY product
      HAVING COUNT(*) > 0
      ORDER BY total_records DESC
    `;

    const res = await query<any>(sql, values);
    const products = res.rows.map(r => ({
      product: r.product,
      totalRecords: Number(r.total_records || 0),
      inserts: Number(r.inserts || 0),
      updates: Number(r.updates || 0),
      deletes: Number(r.deletes || 0),
      latestEventTime: r.latest_event_time ? new Date(r.latest_event_time).toISOString() : null
    }));

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
   * Performs an incremental sync of the previous 48 hours for active products.
   */
  public async runDailyIncrementalSync(oracleClient?: any, catalogService?: any): Promise<number> {
    console.log('[AuditRawDbService] Starting automated daily audit incremental sync...');
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const fromDateStr = twoDaysAgo.toISOString().split('T')[0];
    const toDateStr = now.toISOString().split('T')[0];

    const targets = [
      // 1. Audit Policies
      { product: 'Audit Policies', businessObject: 'Oracle Fusion business objects and attributes' },
      { product: 'Audit Policies', businessObject: 'Oracle Platform Security Services' },
      // 2. Common CRM
      { product: 'Common CRM', businessObject: 'Household' },
      { product: 'Common CRM', businessObject: 'Account' },
      { product: 'Common CRM', businessObject: 'Sales Account' },
      // 3. General Ledger
      { product: 'General Ledger', businessObject: 'Accounting Calendar Setup' },
      { product: 'General Ledger', businessObject: 'Period Status' },
      { product: 'General Ledger', businessObject: 'Period Details' },
      { product: 'General Ledger', businessObject: 'Journal Batch' },
      { product: 'General Ledger', businessObject: 'Journal Header' },
      { product: 'General Ledger', businessObject: 'Journal Line' },
      { product: 'General Ledger', businessObject: 'Chart of Accounts Options Setup' },
      { product: 'General Ledger', businessObject: 'Combination Set' },
      // 4. Global Human Resources
      { product: 'Global Human Resources', businessObject: 'Document Records' },
      // 5. HCM Common Architecture
      { product: 'HCM Common Architecture', businessObject: 'Configure HCM Data Loader Parameters' },
      { product: 'HCM Common Architecture', businessObject: 'HCM Data Loader Business Objects Access' },
      // 6. Inventory Management
      { product: 'Inventory Management', businessObject: 'Interorganization Parameter' },
      { product: 'Inventory Management', businessObject: 'Subinventory' },
      { product: 'Inventory Management', businessObject: 'Lot' },
      { product: 'Inventory Management', businessObject: 'Serial Number' },
      // 7. Payables
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
      // 8. Profile Management
      { product: 'Profile Management', businessObject: 'Model Certification Profile Items' },
      { product: 'Profile Management', businessObject: 'Person Certification Profile Items' },
      { product: 'Profile Management', businessObject: 'Person Skill Profile Items' },
      // 9. Public Sector Common Components
      { product: 'Public Sector Common Components', businessObject: 'Trading Community Customer Billing Account' },
      { product: 'Public Sector Common Components', businessObject: 'Household' },
      { product: 'Public Sector Common Components', businessObject: 'Account' },
      // 10. Quality Issue and Action Management
      { product: 'Quality Issue and Action Management', businessObject: 'Quality Action Affected Object' },
      { product: 'Quality Issue and Action Management', businessObject: 'Quality Action Attachment' },
      { product: 'Quality Issue and Action Management', businessObject: 'Source Quality Action' },
      { product: 'Quality Issue and Action Management', businessObject: 'Quality Action' },
      { product: 'Quality Issue and Action Management', businessObject: 'Quality Issue Affected Object' },
      { product: 'Quality Issue and Action Management', businessObject: 'Quality Issue Attachment' },
      { product: 'Quality Issue and Action Management', businessObject: 'Destination Quality Issue' },
      { product: 'Quality Issue and Action Management', businessObject: 'Quality Issue' },
      // 11. Receivables
      { product: 'Receivables', businessObject: 'Trading Community Customer Billing Account' },
      { product: 'Receivables', businessObject: 'Receivables Customer Profile Class Amount' },
      { product: 'Receivables', businessObject: 'Receivables Customer Profile Class' },
      { product: 'Receivables', businessObject: 'Customer Profile Amount' },
      { product: 'Receivables', businessObject: 'Customer Profile' },
      { product: 'Receivables', businessObject: 'Receivables User Approval Limit' },
      { product: 'Receivables', businessObject: 'Payment Terms' },
      // 12. Service
      { product: 'Service', businessObject: 'Service Request' },
      { product: 'Service', businessObject: 'Category' },
      { product: 'Service', businessObject: 'Service Request Reference' },
      // Common Components & OPSS
      { product: 'Applications Common Components', businessObject: 'Account' },
      { product: 'Oracle Platform Security Services', businessObject: undefined }
    ];

    let totalNew = 0;
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
        else if (restProduct) payload.product = restProduct;

        if (template?.businessObjectType) payload.businessObjectType = template.businessObjectType;
        else if (restBO) payload.businessObjectType = restBO;

        if (template?.timeZone) payload.timeZone = template.timeZone;

        const resp = await client.getAuditHistory(payload, { pageNumber: 1, pageSize: 500 });
        const rawItems = Array.isArray(resp?.auditData) ? resp.auditData : (resp?.auditHistory || resp?.items || []);

        if (rawItems.length > 0) {
          const inserted = await this.saveRawAuditRecords(t.product, t.businessObject || 'All Platform Events', rawItems);
          totalNew += inserted;
          console.log(`[Audit Daily Sync] ${t.product}: fetched ${rawItems.length}, saved ${inserted} new records.`);
        }
      } catch (err: any) {
        console.warn(`[Audit Daily Sync Warning] Failed for ${t.product}:`, err.message);
      }
    }

    console.log(`[AuditRawDbService] Incremental sync complete. Total new records inserted: ${totalNew}`);
    return totalNew;
  }

  /**
   * Starts recurring 24-hour background scheduler.
   */
  public startDailyScheduler(oracleClient: any, catalogService: any, intervalHours = 24): void {
    if (this.schedulerTimer) return;
    const intervalMs = intervalHours * 60 * 60 * 1000;
    console.log(`[AuditRawDbService] Automated daily sync scheduler started (every ${intervalHours} hours).`);

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
