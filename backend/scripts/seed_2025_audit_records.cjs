const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');
const pg = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../database/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const catalog = require('../src/config/auditProductCatalog.json');

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || '127.0.0.1'}:${process.env.POSTGRES_PORT || '5433'}/${process.env.POSTGRES_DB || 'veyra_db'}`;

const pool = new pg.Pool({
  connectionString,
  max: 5,
  connectionTimeoutMillis: 5000,
});

const ENV_HOST = 'eiiv-dev14.fa.us6.oraclecloud.com';

function generateHash(item) {
  const ts = item.date || item.timestamp || item.lastUpdateDate || '';
  const user = item.userInternalName || item.userName || item.userId || '';
  const id = item.identifier || item.objectIdentifier || item.id || '';
  const event = item.eventType || item.action || '';
  const desc = item.description || '';
  const seed = `${ts}|${user}|${id}|${event}|${desc}`;
  return crypto.createHash('md5').update(seed).digest('hex');
}

const USERS = [
  { internal: 'CASEY.BROWN', name: 'Casey Brown' },
  { internal: 'JSMITH', name: 'John Smith' },
  { internal: 'AUDIT_MGR', name: 'Akash Meesarapu (Audit Manager)' },
  { internal: 'FIN_ADMIN', name: 'Financial Administrator' },
  { internal: 'FUSION_APPS', name: 'Fusion Applications System' },
  { internal: 'HR_SPECIALIST', name: 'Jane Smith (HR Specialist)' },
  { internal: 'SCM_PLANNER', name: 'SCM Operations Lead' }
];

const MONTH_DAYS = [
  { month: '01', name: 'Jan', days: 31 },
  { month: '02', name: 'Feb', days: 28 },
  { month: '03', name: 'Mar', days: 31 },
  { month: '04', name: 'Apr', days: 30 },
  { month: '05', name: 'May', days: 31 },
  { month: '06', name: 'Jun', days: 30 },
  { month: '07', name: 'Jul', days: 31 },
  { month: '08', name: 'Aug', days: 31 },
  { month: '09', name: 'Sep', days: 30 },
  { month: '10', name: 'Oct', days: 31 },
  { month: '11', name: 'Nov', days: 30 },
  { month: '12', name: 'Dec', days: 31 },
];

function buildRecordsForTarget(productName, boDisplayName, boRestVo) {
  const records = [];

  MONTH_DAYS.forEach((mObj, mIdx) => {
    const monthNum = mIdx + 1;
    // Generate 3 events per month spread throughout the month
    const eventDays = [
      { day: '05', hour: '09:24:12', type: 'Insert', action: 'CREATE' },
      { day: '16', hour: '14:38:45', type: 'Object Data Update', action: 'UPDATE' },
      { day: '26', hour: '18:12:30', type: 'Update', action: 'UPDATE' }
    ];

    eventDays.forEach((ev, evIdx) => {
      const user = USERS[(mIdx * 3 + evIdx) % USERS.length];
      const dateStr = `2025-${mObj.month}-${ev.day} ${ev.hour}`;
      const identifier = `${boDisplayName || productName}: 2025-${mObj.month}-${100 + evIdx * 10 + mIdx}`;

      let attributeDetails = [];
      let desc = '';

      if (boDisplayName.toLowerCase().includes('control')) {
        desc = `Name:310${mObj.month}${evIdx}: ${ev.type === 'Insert' ? 'Added new Control Definition' : 'Updated Incident Evaluation Logic'}`;
        attributeDetails = [
          {
            attribute: 'Control Description',
            attributeInternalName: 'Description',
            oldValue: ev.type === 'Insert' ? null : `Prior risk mitigation control scope 2024`,
            newValue: `Automated transaction monitoring for high-value variances exceeding threshold ($50,000) - Period 2025-${mObj.month}`
          },
          {
            attribute: 'Investigation Priority',
            attributeInternalName: 'Priority',
            oldValue: 'MEDIUM',
            newValue: 'HIGH'
          },
          {
            attribute: 'Result Investigator',
            attributeInternalName: 'InvestigatorIds',
            oldValue: '0',
            newValue: user.internal
          }
        ];
      } else if (boDisplayName.toLowerCase().includes('journal') || productName.toLowerCase().includes('ledger')) {
        desc = `GL Batch ID: GL-2025-${mObj.month}-${evIdx + 1} (${ev.type} by ${user.name})`;
        attributeDetails = [
          {
            attribute: 'Batch Status',
            attributeInternalName: 'Status',
            oldValue: ev.type === 'Insert' ? 'UNPOSTED' : 'IN_REVIEW',
            newValue: 'POSTED'
          },
          {
            attribute: 'Total Debits',
            attributeInternalName: 'EnteredDebits',
            oldValue: `${(monthNum * 12500).toFixed(2)} USD`,
            newValue: `${(monthNum * 14200).toFixed(2)} USD`
          },
          {
            attribute: 'Approval Status',
            attributeInternalName: 'ApprovalStatus',
            oldValue: 'REQUIRED',
            newValue: 'APPROVED'
          }
        ];
      } else if (boDisplayName.toLowerCase().includes('document') || productName.toLowerCase().includes('human resources')) {
        desc = `Person Document Record: DOC-2025-${mObj.month}-${100 + evIdx} (${ev.type})`;
        attributeDetails = [
          {
            attribute: 'Document Type',
            attributeInternalName: 'DocumentTypeCode',
            oldValue: 'EMPLOYMENT_VERIFICATION',
            newValue: 'ANNUAL_CERTIFICATION_2025'
          },
          {
            attribute: 'Verification Status',
            attributeInternalName: 'Status',
            oldValue: 'PENDING',
            newValue: 'VERIFIED'
          },
          {
            attribute: 'Effective Date',
            attributeInternalName: 'EffectiveDate',
            oldValue: `2025-${mObj.month}-01`,
            newValue: `2025-${mObj.month}-${ev.day}`
          }
        ];
      } else if (boDisplayName.toLowerCase().includes('payment') || boDisplayName.toLowerCase().includes('invoice') || productName.toLowerCase().includes('payable')) {
        desc = `AP Terms Ref: NET${15 * (mIdx % 3 + 1)}_2025 - ${ev.type}`;
        attributeDetails = [
          {
            attribute: 'Terms Description',
            attributeInternalName: 'Description',
            oldValue: 'Standard Vendor Terms',
            newValue: `Net ${15 * (mIdx % 3 + 1)} Days Standard with 2% 10-day Discount - Effective 2025-${mObj.month}`
          },
          {
            attribute: 'Due Days',
            attributeInternalName: 'DueDays',
            oldValue: '30',
            newValue: String(15 * (mIdx % 3 + 1))
          },
          {
            attribute: 'Active Flag',
            attributeInternalName: 'EnabledFlag',
            oldValue: 'Y',
            newValue: 'Y'
          }
        ];
      } else {
        // Generic domain-aware attributes
        desc = `${boDisplayName || productName} Configuration: Ref 2025-${mObj.month}-${evIdx + 1} (${ev.type})`;
        attributeDetails = [
          {
            attribute: 'Status',
            attributeInternalName: 'StatusCode',
            oldValue: ev.type === 'Insert' ? 'INITIAL' : 'MODIFIED',
            newValue: 'ACTIVE'
          },
          {
            attribute: 'Configuration Scope',
            attributeInternalName: 'ScopeDefinition',
            oldValue: 'Local',
            newValue: `Enterprise Standard (FY2025-${mObj.name})`
          },
          {
            attribute: 'Last Updated User',
            attributeInternalName: 'LastUpdatedBy',
            oldValue: 'SYSTEM',
            newValue: user.internal
          }
        ];
      }

      const payload = {
        date: dateStr,
        timestamp: new Date(dateStr.replace(' ', 'T') + 'Z').toISOString(),
        userName: user.name,
        userInternalName: user.internal,
        eventType: ev.type,
        action: ev.action,
        product: productName,
        businessObject: boDisplayName,
        identifier,
        description: desc,
        attribute: attributeDetails[0]?.attribute || 'Status',
        attributeInternalName: attributeDetails[0]?.attributeInternalName || 'Status',
        oldValue: attributeDetails[0]?.oldValue || null,
        newValue: attributeDetails[0]?.newValue || null,
        attributeDetails,
        qualifiedBusinessObject: boRestVo || `oracle.apps.${productName.toLowerCase().replace(/[^a-z0-9]/g, '')}.${boDisplayName.toLowerCase().replace(/[^a-z0-9]/g, '')}VO`
      };

      records.push({
        product: productName,
        businessObject: boDisplayName,
        date: new Date(dateStr.replace(' ', 'T') + 'Z'),
        userInternalName: user.internal,
        eventType: ev.type,
        payload
      });
    });
  });

  return records;
}

async function main() {
  console.log('[Seed 2025 Audit] Starting backfill for all 78 products across all 12 months of 2025...');
  const client = await pool.connect();

  try {
    // 1. Ensure table exists
    await client.query(`
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
    `);

    let totalCreated = 0;
    let targetCount = 0;

    for (const prod of catalog) {
      const prodName = prod.productName || prod.displayName;
      const boList = prod.businessObjects && prod.businessObjects.length > 0
        ? prod.businessObjects
        : [{ displayName: 'All Events', restBusinessObjectType: null }];

      for (const bo of boList) {
        targetCount++;
        const boName = bo.displayName || 'All Events';
        const voName = bo.restBusinessObjectType || bo.restValue || null;

        const records = buildRecordsForTarget(prodName, boName, voName);

        // Batch insert records
        for (const r of records) {
          const hash = generateHash(r.payload);
          const rawJson = JSON.stringify(r.payload);

          const res = await client.query(`
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
          `, [
            ENV_HOST,
            r.product,
            r.businessObject,
            hash,
            r.date,
            r.userInternalName,
            r.eventType,
            rawJson
          ]);

          if (res.rowCount > 0) {
            totalCreated++;
          }
        }
      }
    }

    console.log(`[Seed 2025 Audit] Finished processing ${catalog.length} products (${targetCount} business objects).`);
    console.log(`[Seed 2025 Audit] Successfully inserted ${totalCreated} new audit records for year 2025!`);

    // Verify 2025 records in DB
    const checkRes = await client.query(`
      SELECT 
        EXTRACT(MONTH FROM event_timestamp) as month_num,
        COUNT(*) as record_count,
        COUNT(DISTINCT product) as distinct_products,
        COUNT(DISTINCT business_object) as distinct_bos
      FROM oracle_raw_audit_records
      WHERE event_timestamp >= '2025-01-01' AND event_timestamp <= '2025-12-31 23:59:59'
      GROUP BY EXTRACT(MONTH FROM event_timestamp)
      ORDER BY month_num;
    `);

    console.log('\n--- 2025 Monthly Audit Record Summary in PostgreSQL ---');
    console.table(checkRes.rows);

  } catch (err) {
    console.error('[Seed 2025 Audit] Error during seed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
