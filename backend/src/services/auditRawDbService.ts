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
