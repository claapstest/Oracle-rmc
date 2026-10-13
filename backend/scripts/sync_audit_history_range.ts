import { oracleService } from '../src/services/oracleService.js';
import { auditProductCatalogService } from '../src/services/auditProductCatalogService.js';
import { auditRawDbService } from '../src/services/auditRawDbService.js';
import { pool } from '../src/db.js';

interface DateChunk {
  fromDate: string;
  toDate: string;
  label: string;
}

/**
 * Splits Jan 01, 2026 to Oct 12, 2026 into safe 28-day chunks (<= 30 days Oracle limit)
 */
function generateDateChunks(startDateStr: string, endDateStr: string): DateChunk[] {
  const chunks: DateChunk[] = [];
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  let currentStart = new Date(start);

  while (currentStart < end) {
    const currentEnd = new Date(currentStart.getTime() + 27 * 24 * 60 * 60 * 1000);
    const actualEnd = currentEnd > end ? end : currentEnd;

    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    const fromDate = formatDate(currentStart);
    const toDate = formatDate(actualEnd);

    chunks.push({
      fromDate,
      toDate,
      label: `${fromDate} to ${toDate}`
    });

    currentStart = new Date(actualEnd.getTime() + 24 * 60 * 60 * 1000);
  }

  return chunks;
}

async function runBackfill() {
  console.log('================================================================');
  console.log('  ORACLE FUSION RAW AUDIT TRAIL HISTORICAL BACKFILL (JAN - OCT)');
  console.log('================================================================');

  await auditRawDbService.initTable();

  const startDate = '2026-01-01';
  const endDate = '2026-10-12';
  const chunks = generateDateChunks(startDate, endDate);

  console.log(`Generated ${chunks.length} date slices (each <= 28 days) between ${startDate} and ${endDate}:\n`);
  chunks.forEach((c, idx) => console.log(`  [Chunk ${idx + 1}] ${c.label}`));
  console.log('----------------------------------------------------------------\n');

  // Complete list of authoritatively configured targets
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
    // Core Platform Objects
    { product: 'Applications Common Components', businessObject: 'Account' },
    { product: 'Oracle Platform Security Services', businessObject: undefined }
  ];

  console.log(`Starting historical sync across ${targets.length} business object targets...\n`);

  let grandTotalSaved = 0;
  const client = (oracleService as any).client;

  for (let tIdx = 0; tIdx < targets.length; tIdx++) {
    const target = targets[tIdx];
    const boDisplay = target.businessObject || '(All Middleware Events)';
    console.log(`\n[Target ${tIdx + 1}/${targets.length}] >> ${target.product} -> ${boDisplay}`);

    const resolution = auditProductCatalogService.resolveAuditRequest(
      target.product,
      target.businessObject
    );

    if (resolution.status !== 'CONFIRMED') {
      console.log(`  [SKIPPED: ${resolution.message || resolution.status}]`);
      continue;
    }

    const template = resolution.businessObject?.payloadTemplate || resolution.product?.defaultPayloadTemplate;
    const restProduct = resolution.product?.restProduct || resolution.product?.shortCodes?.[0] || target.product;
    const restBO = resolution.businessObject?.restBusinessObjectType || resolution.businessObject?.restValue;

    let targetTotalNew = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      try {
        const payload: any = {
          fromDate: chunk.fromDate,
          toDate: chunk.toDate,
          eventType: 'ALL'
        };

        if (template?.productId) payload.productId = template.productId;
        else if (resolution.product?.productId) payload.productId = resolution.product.productId;

        if (template?.product) payload.product = template.product;
        else if (!payload.productId && restProduct) payload.product = restProduct;

        if (template?.businessObjectType) payload.businessObjectType = template.businessObjectType;
        else if (restBO) payload.businessObjectType = restBO;

        if (template?.timeZone) payload.timeZone = template.timeZone;
        if (template?.includeChildObjects !== undefined) payload.includeChildObjects = template.includeChildObjects;
        if (template?.includeImpersonator !== undefined) payload.includeImpersonator = template.includeImpersonator;
        if (template?.includeAttributes !== undefined) payload.includeAttributes = template.includeAttributes;
        if (template?.attributeDetailMode !== undefined) payload.attributeDetailMode = template.attributeDetailMode;
        if (template?.includeExtendedObjectIdentiferColumns !== undefined) payload.includeExtendedObjectIdentiferColumns = template.includeExtendedObjectIdentiferColumns;

        const response = await client.getAuditHistory(payload, { pageNumber: 1, pageSize: 500 });
        const rawItems = Array.isArray(response?.auditData)
          ? response.auditData
          : (response?.auditHistory || response?.items || []);

        if (rawItems.length > 0) {
          const inserted = await auditRawDbService.saveRawAuditRecords(
            target.product,
            target.businessObject || 'All Platform Events',
            rawItems
          );
          targetTotalNew += inserted;
          grandTotalSaved += inserted;
          console.log(`    Slice ${chunk.label}: ${rawItems.length} records fetched, ${inserted} new inserted.`);
        }
      } catch (err: any) {
        // Silently skip or log brief error
        if (!err.message?.includes('0 records')) {
          console.log(`    Slice ${chunk.label}: ${err.message}`);
        }
      }

      // Small 250ms spacing to maintain optimal throughput without hitting gateway limits
      await new Promise(r => setTimeout(r, 250));
    }

    const watermark = await auditRawDbService.getWatermark(
      target.product,
      target.businessObject || 'All Platform Events'
    );
    console.log(`  Target finished: +${targetTotalNew} new rows. Total in DB: ${watermark.totalCount} (Latest: ${watermark.lastUpdateDate?.toISOString() || 'None'})`);
  }

  console.log(`\n================================================================`);
  console.log(`  HISTORICAL BACKFILL COMPLETED: Saved ${grandTotalSaved} new raw records.`);
  console.log(`================================================================`);

  await pool.end();
  process.exit(0);
}

runBackfill().catch(err => {
  console.error('Fatal backfill error:', err);
  process.exit(1);
});
