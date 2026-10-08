/**
 * Automated Database Verification Suite for:
 * Story: VY-STRY-34
 * Title: DB: Single-Row-Per-Control Raw JSON Storage, Watermarks, and Product-Level Sync Policy Schema
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || '127.0.0.1'}:${process.env.POSTGRES_PORT || '5433'}/${process.env.POSTGRES_DB || 'veyra_db'}`;

const pool = new pg.Pool({ connectionString });

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}`);
    if (details) {
      console.error(`     Details: ${details}`);
    }
    failedTests++;
  }
}

async function runVerification() {
  console.log('========================================================================');
  console.log('  VEYRA Database Verification: Single-Row-Per-Control Raw JSON Storage');
  console.log(`  Connecting to: ${connectionString.replace(/:[^:@]+@/, ':****@')}`);
  console.log('========================================================================\n');

  try {
    // TEST 1: product_sync_policy table exists
    const tablePolicyRes = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'product_sync_policy'
    `);
    assert(tablePolicyRes.rows.length === 1, 'Table product_sync_policy exists');

    // TEST 2: Seeded default product policies exist
    const seededPolicies = await pool.query(`
      SELECT product_code, sync_cadence, sync_interval_hours FROM product_sync_policy
    `);
    assert(seededPolicies.rows.length >= 4, 'Default product-level sync policies are seeded (>= 4)');
    const codes = seededPolicies.rows.map((r: any) => r.product_code);
    assert(codes.includes('RISK_CONTROLS'), 'RISK_CONTROLS product policy seeded');
    assert(codes.includes('AUDIT_TRAIL'), 'AUDIT_TRAIL product policy seeded');
    assert(codes.includes('ACCESS_CERTS'), 'ACCESS_CERTS product policy seeded');
    assert(codes.includes('USER_ROLES'), 'USER_ROLES product policy seeded');

    // TEST 3: oracle_control_incidents table exists (1 row per control ID)
    const ctrlIncidentsRes = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'oracle_control_incidents'
    `);
    assert(ctrlIncidentsRes.rows.length > 0, 'Table oracle_control_incidents exists');
    const rawIncidentsCol = ctrlIncidentsRes.rows.find((c: any) => c.column_name === 'raw_incidents');
    assert(rawIncidentsCol && rawIncidentsCol.data_type === 'jsonb', 'Column raw_incidents is of type JSONB');

    // TEST 4: Verify single-row per control ID constraint (composite primary key)
    const pkRes = await pool.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'oracle_control_incidents' AND tc.constraint_type = 'PRIMARY KEY'
    `);
    const pkCols = pkRes.rows.map((r: any) => r.column_name);
    assert(pkCols.includes('environment_host') && pkCols.includes('control_id'), 'Primary key enforces exactly 1 row per (environment_host, control_id)');

    // TEST 5: Insert exactly 1 row containing an entire array of raw incidents
    const testHost = 'test.fusion.oracle.com';
    const testControlId = 'TST_CTRL_1001';
    const sampleIncidentsArray = [
      {
        Id: '1001:1',
        ControlId: testControlId,
        GlobalUserName: 'User.One@deloitte.com',
        Status: 'ASSIGNED',
        State: 'IN_INVESTIGATION',
        Priority: '1',
        LastUpdateDate: '2026-10-08T11:00:00Z'
      },
      {
        Id: '1001:2',
        ControlId: testControlId,
        GlobalUserName: 'User.Two@deloitte.com',
        Status: 'ASSIGNED',
        State: 'IN_INVESTIGATION',
        Priority: '1',
        LastUpdateDate: '2026-10-08T11:05:00Z'
      },
      {
        Id: '1001:3',
        ControlId: testControlId,
        GlobalUserName: 'User.Three@deloitte.com',
        Status: 'CLOSED',
        State: 'RESOLVED',
        Priority: '2',
        LastUpdateDate: '2026-10-08T11:10:00Z'
      }
    ];

    await pool.query(`
      INSERT INTO oracle_control_incidents (
        environment_host,
        control_id,
        control_name,
        total_incidents,
        last_oracle_update_date,
        raw_incidents,
        sync_status
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'READY')
      ON CONFLICT (environment_host, control_id)
      DO UPDATE SET
        total_incidents = EXCLUDED.total_incidents,
        last_oracle_update_date = EXCLUDED.last_oracle_update_date,
        raw_incidents = EXCLUDED.raw_incidents,
        updated_at = NOW()
    `, [
      testHost,
      testControlId,
      'Test Single Row Control',
      sampleIncidentsArray.length,
      new Date('2026-10-08T11:10:00Z'),
      JSON.stringify(sampleIncidentsArray)
    ]);

    // TEST 6: Verify exactly 1 row exists for this control ID
    const countCheck = await pool.query(`
      SELECT COUNT(*)::int as row_count FROM oracle_control_incidents
      WHERE environment_host = $1 AND control_id = $2
    `, [testHost, testControlId]);
    assert(countCheck.rows[0].row_count === 1, 'Exactly 1 row stored for control ID');

    // TEST 7: Verify all incidents are stored in the single raw_incidents cell
    const cellCheck = await pool.query(`
      SELECT jsonb_array_length(raw_incidents) as incidents_count, total_incidents, raw_incidents
      FROM oracle_control_incidents
      WHERE environment_host = $1 AND control_id = $2
    `, [testHost, testControlId]);
    assert(cellCheck.rows[0].incidents_count === 3, 'Single cell contains all 3 raw incidents');
    assert(cellCheck.rows[0].raw_incidents[0].GlobalUserName === 'User.One@deloitte.com', 'Raw Oracle fields preserved in single cell');

    // TEST 8: Native JSONB array operations on the single cell
    const jsonFilterRes = await pool.query(`
      SELECT jsonb_path_query_array(raw_incidents, '$[*] ? (@.Status == "ASSIGNED")') as assigned_items
      FROM oracle_control_incidents
      WHERE environment_host = $1 AND control_id = $2
    `, [testHost, testControlId]);
    assert(jsonFilterRes.rows[0]?.assigned_items?.length === 2, 'Native JSONB filtering inside single cell succeeds');

    // TEST 9: Table oracle_raw_controls exists with JSONB
    const ctrlTableRes = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'oracle_raw_controls'
    `);
    assert(ctrlTableRes.rows.length > 0, 'Table oracle_raw_controls exists');

    // Clean up test records
    await pool.query(`DELETE FROM oracle_control_incidents WHERE environment_host = $1 AND control_id = $2`, [testHost, testControlId]);
    await pool.query(`DELETE FROM oracle_raw_controls WHERE environment_host = $1 AND control_id = $2`, [testHost, testControlId]);

    console.log(`\n========================================================================`);
    console.log(`  Tests Passed: ${passedTests} | Tests Failed: ${failedTests}`);
    console.log(`========================================================================\n`);

    if (failedTests > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Verification failed with error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runVerification();
