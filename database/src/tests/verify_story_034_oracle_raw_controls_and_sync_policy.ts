/**
 * Automated Database Verification Suite for:
 * Story: VY-STRY-34
 * Title: DB: Raw Oracle Fusion JSON Storage, Watermarks, and Product-Level Sync Policy Schema
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
  console.log('  VEYRA Database Verification: Oracle Raw Incidents & Sync Policy Schema');
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

    // TEST 3: oracle_control_sync_watermark table exists
    const watermarkRes = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'oracle_control_sync_watermark'
    `);
    assert(watermarkRes.rows.length === 1, 'Table oracle_control_sync_watermark exists');

    // TEST 4: oracle_control_raw_incidents table exists with JSONB column
    const rawTableRes = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'oracle_control_raw_incidents'
    `);
    assert(rawTableRes.rows.length > 0, 'Table oracle_control_raw_incidents exists');
    const jsonbCol = rawTableRes.rows.find((c: any) => c.column_name === 'raw_payload');
    assert(jsonbCol && jsonbCol.data_type === 'jsonb', 'Column raw_payload is of type JSONB');

    // TEST 5: Verify Indexes exist (GIN, environment_host, control_id)
    const indexRes = await pool.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'oracle_control_raw_incidents'
    `);
    const indexNames = indexRes.rows.map((r: any) => r.indexname);
    assert(indexNames.includes('ix_oracle_raw_incidents_host_ctrl'), 'Composite index on host + control_id exists');
    assert(indexNames.includes('ix_oracle_raw_incidents_jsonb'), 'GIN index on raw_payload exists');

    // TEST 6: Insert & Upsert raw incident with JSONB data
    const testHost = 'test.fusion.oracle.com';
    const testControlId = 'TST_CTRL_1001';
    const testIncId = 'INC_TEST_999';
    const sampleRawOracle = {
      Id: testIncId,
      ControlId: testControlId,
      ControlName: 'Test Segregation of Duties Control',
      GlobalUserName: 'Audit.Tester',
      Status: 'Open',
      Priority: 'High',
      CreationDate: '2026-10-08T10:00:00Z',
      LastUpdateDate: '2026-10-08T11:00:00Z',
      ConflictingRoles: 'Purchasing Manager vs General Accountant'
    };

    await pool.query(`
      INSERT INTO oracle_control_raw_incidents (
        environment_host,
        control_id,
        incident_id,
        status,
        global_user_name,
        oracle_last_update_date,
        raw_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (environment_host, control_id, incident_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = NOW()
    `, [
      testHost,
      testControlId,
      testIncId,
      'Open',
      'Audit.Tester',
      new Date('2026-10-08T11:00:00Z'),
      JSON.stringify(sampleRawOracle)
    ]);

    const verifyInsert = await pool.query(`
      SELECT raw_payload FROM oracle_control_raw_incidents
      WHERE environment_host = $1 AND control_id = $2 AND incident_id = $3
    `, [testHost, testControlId, testIncId]);

    assert(verifyInsert.rows.length === 1, 'Incident successfully stored in PostgreSQL');
    assert(verifyInsert.rows[0].raw_payload.GlobalUserName === 'Audit.Tester', 'Raw JSONB preserves nested Oracle fields');

    // TEST 7: Query directly inside JSONB using PostgreSQL operators
    const jsonbQuery = await pool.query(`
      SELECT incident_id FROM oracle_control_raw_incidents
      WHERE raw_payload->>'ConflictingRoles' ILIKE '%Purchasing Manager%'
        AND environment_host = $1
    `, [testHost]);
    assert(jsonbQuery.rows.length >= 1, 'Native JSONB query on raw Oracle properties succeeds');

    // TEST 8: Watermark upsert
    await pool.query(`
      INSERT INTO oracle_control_sync_watermark (
        environment_host,
        control_id,
        control_name,
        total_incidents,
        synced_incidents,
        last_oracle_update_date,
        sync_status
      )
      VALUES ($1, $2, $3, 1, 1, NOW(), 'READY')
      ON CONFLICT (environment_host, control_id)
      DO UPDATE SET sync_status = 'READY', total_incidents = 1
    `, [testHost, testControlId, 'Test Segregation of Duties Control']);

    const verifyWatermark = await pool.query(`
      SELECT sync_status, total_incidents FROM oracle_control_sync_watermark
      WHERE environment_host = $1 AND control_id = $2
    `, [testHost, testControlId]);
    assert(verifyWatermark.rows[0]?.sync_status === 'READY', 'Control watermark status is READY');

    // TEST 9: oracle_raw_controls table exists with JSONB
    const ctrlTableRes = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'oracle_raw_controls'
    `);
    assert(ctrlTableRes.rows.length > 0, 'Table oracle_raw_controls exists');
    const ctrlJsonb = ctrlTableRes.rows.find((c: any) => c.column_name === 'raw_payload');
    assert(ctrlJsonb && ctrlJsonb.data_type === 'jsonb', 'oracle_raw_controls raw_payload is of type JSONB');

    // TEST 10: Insert and retrieve raw control
    const sampleRawControl = {
      Id: testControlId,
      Name: 'Users with Sensitive Privileges (Raw Test)',
      Status: 'Active',
      StateCode: 'APPROVED',
      Description: 'Raw Oracle control test payload'
    };
    await pool.query(`
      INSERT INTO oracle_raw_controls (
        environment_host,
        control_id,
        name,
        state,
        status,
        raw_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (environment_host, control_id)
      DO UPDATE SET raw_payload = EXCLUDED.raw_payload
    `, [testHost, testControlId, sampleRawControl.Name, 'APPROVED', 'Active', JSON.stringify(sampleRawControl)]);

    const verifyCtrl = await pool.query(`
      SELECT raw_payload FROM oracle_raw_controls
      WHERE environment_host = $1 AND control_id = $2
    `, [testHost, testControlId]);
    assert(verifyCtrl.rows.length === 1, 'Raw control stored and retrieved successfully');
    assert(verifyCtrl.rows[0].raw_payload.Name === sampleRawControl.Name, 'Raw control JSONB payload matches');

    // Clean up test records
    await pool.query(`DELETE FROM oracle_control_raw_incidents WHERE environment_host = $1 AND control_id = $2`, [testHost, testControlId]);
    await pool.query(`DELETE FROM oracle_control_sync_watermark WHERE environment_host = $1 AND control_id = $2`, [testHost, testControlId]);
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
