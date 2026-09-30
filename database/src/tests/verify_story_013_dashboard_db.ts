/**
 * Automated Database Verification Suite for VY-STRY-013:
 * DB: Create Database Structures for VEYRA Dashboard Metrics
 *
 * Verifies all Acceptance Criteria:
 * 1. Database must support storing/retrieving dashboard metrics.
 * 2. Dashboard-related records must have appropriate timestamps (TIMESTAMPTZ).
 * 3. Records must support filtering by user/application scope where applicable.
 * 4. Data must not be duplicated solely for frontend presentation unless required for performance.
 * 5. Appropriate indexes must be created for dashboard queries.
 * 6. Sample/mock data must be clearly separated from production data.
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { execSync } from 'child_process';
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
  console.log('===========================================================');
  console.log('  VEYRA Database Verification Suite: Story 13 Dashboard DB');
  console.log(`  Connecting to: ${connectionString.replace(/:[^:@]+@/, ':****@')}`);
  console.log('===========================================================\n');

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Table Existence
    // -------------------------------------------------------------------------
    const tableRes = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'veyra_dashboard_metric'
    `);
    assert(tableRes.rows.length === 1, 'TEST 1: veyra_dashboard_metric table exists');

    // -------------------------------------------------------------------------
    // TEST 2: Column Schema Verification
    // -------------------------------------------------------------------------
    const colsRes = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'veyra_dashboard_metric'
      ORDER BY ordinal_position
    `);

    const colMap = new Map(colsRes.rows.map(r => [r.column_name, r]));
    const expectedCols = [
      'metric_id',
      'metric_key',
      'metric_value',
      'metric_type',
      'scope_type',
      'scope_id',
      'user_id',
      'application_scope',
      'metric_payload',
      'source',
      'is_mock',
      'captured_at',
      'created_at',
      'updated_at'
    ];

    const hasAllCols = expectedCols.every(c => colMap.has(c));
    assert(hasAllCols, 'TEST 2: All 14 required columns exist in veyra_dashboard_metric',
      `Missing: ${expectedCols.filter(c => !colMap.has(c)).join(', ')}`);

    // -------------------------------------------------------------------------
    // TEST 3: Primary Key Verification
    // -------------------------------------------------------------------------
    const pkRes = await pool.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_name = 'veyra_dashboard_metric'
    `);
    assert(
      pkRes.rows.length === 1 && pkRes.rows[0].column_name === 'metric_id',
      'TEST 3: Primary key exists and is on column "metric_id"'
    );

    // -------------------------------------------------------------------------
    // TEST 4: Foreign Key Verification (user_id -> veyra_user(id))
    // -------------------------------------------------------------------------
    const fkRes = await pool.query(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'veyra_dashboard_metric'
        AND kcu.column_name = 'user_id'
    `);
    assert(
      fkRes.rows.length === 1 &&
      fkRes.rows[0].foreign_table_name === 'veyra_user' &&
      fkRes.rows[0].foreign_column_name === 'id' &&
      fkRes.rows[0].delete_rule === 'SET NULL',
      'TEST 4: user_id foreign key references veyra_user(id) with ON DELETE SET NULL'
    );

    // -------------------------------------------------------------------------
    // TEST 5: Timestamp Types Verification (TIMESTAMPTZ)
    // -------------------------------------------------------------------------
    const capturedAtCol = colMap.get('captured_at');
    const createdAtCol = colMap.get('created_at');
    const updatedAtCol = colMap.get('updated_at');

    assert(
      capturedAtCol?.data_type === 'timestamp with time zone' &&
      createdAtCol?.data_type === 'timestamp with time zone' &&
      updatedAtCol?.data_type === 'timestamp with time zone',
      'TEST 5: Timestamp fields use PostgreSQL TIMESTAMPTZ (with time zone)'
    );

    // -------------------------------------------------------------------------
    // TEST 6: Scope Check Constraint (ck_veyra_dashboard_metric_scope_type)
    // -------------------------------------------------------------------------
    const validScopes = ['GLOBAL', 'USER', 'APPLICATION', 'TENANT'];
    let allScopesAccepted = true;
    for (const scope of validScopes) {
      try {
        await pool.query(`
          INSERT INTO veyra_dashboard_metric (metric_key, metric_value, scope_type, is_mock)
          VALUES ('TEST_SCOPE_METRIC', 1, $1, true)
        `, [scope]);
      } catch (err) {
        allScopesAccepted = false;
        console.error(`Rejected valid scope: ${scope}`, err);
      }
    }
    assert(allScopesAccepted, 'TEST 6a: Check constraint accepts all 4 valid scope types');

    let invalidScopeRejected = false;
    try {
      await pool.query(`
        INSERT INTO veyra_dashboard_metric (metric_key, metric_value, scope_type, is_mock)
        VALUES ('TEST_INVALID_SCOPE', 1, 'INVALID_SCOPE', true)
      `);
    } catch (err: any) {
      invalidScopeRejected = err.code === '23514'; // check_violation
    }
    assert(invalidScopeRejected, 'TEST 6b: Check constraint rejects invalid scope_type');

    // -------------------------------------------------------------------------
    // TEST 7: Metric Type Check Constraint (ck_veyra_dashboard_metric_type)
    // -------------------------------------------------------------------------
    const validTypes = ['COUNTER', 'GAUGE', 'AGGREGATE', 'SUMMARY_SNAPSHOT'];
    let allTypesAccepted = true;
    for (const mtype of validTypes) {
      try {
        await pool.query(`
          INSERT INTO veyra_dashboard_metric (metric_key, metric_value, metric_type, is_mock)
          VALUES ('TEST_TYPE_METRIC', 10, $1, true)
        `, [mtype]);
      } catch (err) {
        allTypesAccepted = false;
        console.error(`Rejected valid metric_type: ${mtype}`, err);
      }
    }
    assert(allTypesAccepted, 'TEST 7a: Check constraint accepts all 4 valid metric types');

    let invalidTypeRejected = false;
    try {
      await pool.query(`
        INSERT INTO veyra_dashboard_metric (metric_key, metric_value, metric_type, is_mock)
        VALUES ('TEST_INVALID_TYPE', 1, 'INVALID_METRIC_TYPE', true)
      `);
    } catch (err: any) {
      invalidTypeRejected = err.code === '23514';
    }
    assert(invalidTypeRejected, 'TEST 7b: Check constraint rejects invalid metric_type');

    // -------------------------------------------------------------------------
    // TEST 8: Source Check Constraint (ck_veyra_dashboard_metric_source)
    // -------------------------------------------------------------------------
    const validSources = ['VEYRA_POSTGRES', 'ORACLE_FUSION', 'VEYRA_CALCULATED', 'MANUAL', 'DEMO_SEED'];
    let allSourcesAccepted = true;
    for (const src of validSources) {
      try {
        await pool.query(`
          INSERT INTO veyra_dashboard_metric (metric_key, metric_value, source, is_mock)
          VALUES ('TEST_SRC_METRIC', 5, $1, true)
        `, [src]);
      } catch (err) {
        allSourcesAccepted = false;
        console.error(`Rejected valid source: ${src}`, err);
      }
    }
    assert(allSourcesAccepted, 'TEST 8a: Check constraint accepts all 5 valid source types');

    let invalidSourceRejected = false;
    try {
      await pool.query(`
        INSERT INTO veyra_dashboard_metric (metric_key, metric_value, source, is_mock)
        VALUES ('TEST_INVALID_SRC', 1, 'UNKNOWN_SOURCE', true)
      `);
    } catch (err: any) {
      invalidSourceRejected = err.code === '23514';
    }
    assert(invalidSourceRejected, 'TEST 8b: Check constraint rejects invalid source');

    // Clean up temporary check rows
    await pool.query(`DELETE FROM veyra_dashboard_metric WHERE metric_key LIKE 'TEST_%'`);

    // -------------------------------------------------------------------------
    // TEST 9: Store and Retrieve Numeric GAUGE metric (AC1)
    // -------------------------------------------------------------------------
    const insertGauge = await pool.query(`
      INSERT INTO veyra_dashboard_metric (
        metric_key, metric_value, metric_type, scope_type, application_scope, source, is_mock
      ) VALUES (
        'ACTIVE_RISKS', 12.0000, 'GAUGE', 'GLOBAL', 'ORACLE_FUSION', 'ORACLE_FUSION', false
      ) RETURNING metric_id, captured_at
    `);

    const gaugeRow = insertGauge.rows[0];
    const fetchGauge = await pool.query(`
      SELECT metric_key, metric_value, metric_type, scope_type, is_mock
      FROM veyra_dashboard_metric
      WHERE metric_id = $1
    `, [gaugeRow.metric_id]);

    assert(
      fetchGauge.rows.length === 1 &&
      fetchGauge.rows[0].metric_key === 'ACTIVE_RISKS' &&
      Number(fetchGauge.rows[0].metric_value) === 12 &&
      fetchGauge.rows[0].is_mock === false,
      'TEST 9: Store and retrieve numeric GAUGE metric (ACTIVE_RISKS)'
    );

    // -------------------------------------------------------------------------
    // TEST 10: Store and Retrieve AGGREGATE metric with structured JSONB payload (AC1 & AC4)
    // -------------------------------------------------------------------------
    const payload = {
      roleDistribution: [
        { roleType: 'Job Roles', count: 6014, percentage: 86 },
        { roleType: 'Duty Roles', count: 55, percentage: 1 }
      ]
    };

    const insertAgg = await pool.query(`
      INSERT INTO veyra_dashboard_metric (
        metric_key, metric_value, metric_type, scope_type, metric_payload, source, is_mock
      ) VALUES (
        'ROLE_DISTRIBUTION', 6069, 'AGGREGATE', 'GLOBAL', $1, 'VEYRA_CALCULATED', false
      ) RETURNING metric_id, metric_payload
    `, [JSON.stringify(payload)]);

    const fetchAgg = await pool.query(`
      SELECT metric_payload->'roleDistribution'->0->>'roleType' AS first_role
      FROM veyra_dashboard_metric
      WHERE metric_id = $1
    `, [insertAgg.rows[0].metric_id]);

    assert(
      fetchAgg.rows[0]?.first_role === 'Job Roles',
      'TEST 10: Store and query structured JSONB metric payload without UI presentation pollution'
    );

    // -------------------------------------------------------------------------
    // TEST 11: USER Scoping & Foreign Key Constraint (AC3)
    // -------------------------------------------------------------------------
    // Create a temporary test user
    const userRes = await pool.query(`
      INSERT INTO veyra_user (email, display_name, status, is_local_user, created_by)
      VALUES ('dash_test_user@claaps.com', 'Dashboard Test User', 'ACTIVE', true, 'TEST')
      ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `);
    const testUserId = userRes.rows[0].id;

    const userMetric = await pool.query(`
      INSERT INTO veyra_dashboard_metric (
        metric_key, metric_value, metric_type, scope_type, scope_id, user_id, source, is_mock
      ) VALUES (
        'USER_SECURITY_SCORE', 95.5, 'GAUGE', 'USER', $1, $2, 'VEYRA_CALCULATED', false
      ) RETURNING metric_id
    `, [String(testUserId), testUserId]);

    const fetchUserMetric = await pool.query(`
      SELECT m.metric_key, m.metric_value, u.email
      FROM veyra_dashboard_metric m
      JOIN veyra_user u ON m.user_id = u.id
      WHERE m.user_id = $1
    `, [testUserId]);

    assert(
      fetchUserMetric.rows.length === 1 &&
      fetchUserMetric.rows[0].email === 'dash_test_user@claaps.com' &&
      Number(fetchUserMetric.rows[0].metric_value) === 95.5,
      'TEST 11: User-scoped metric accurately references and joins with veyra_user'
    );

    // -------------------------------------------------------------------------
    // TEST 12: APPLICATION Scoping (AC3)
    // -------------------------------------------------------------------------
    await pool.query(`
      INSERT INTO veyra_dashboard_metric (
        metric_key, metric_value, scope_type, application_scope, source, is_mock
      ) VALUES
        ('PENDING_REVIEWS', 7, 'APPLICATION', 'ORACLE_RMC', 'ORACLE_FUSION', false),
        ('PENDING_REVIEWS', 2, 'APPLICATION', 'VEYRA_PLATFORM', 'VEYRA_POSTGRES', false)
    `);

    const appFiltered = await pool.query(`
      SELECT application_scope, metric_value
      FROM veyra_dashboard_metric
      WHERE metric_key = 'PENDING_REVIEWS' AND application_scope = 'ORACLE_RMC'
      ORDER BY captured_at DESC LIMIT 1
    `);

    assert(
      appFiltered.rows.length === 1 && Number(appFiltered.rows[0].metric_value) === 7,
      'TEST 12: Application-scoped metric filtering works accurately'
    );

    // -------------------------------------------------------------------------
    // TEST 13: Production vs Mock Separation (AC6)
    // -------------------------------------------------------------------------
    await pool.query(`
      INSERT INTO veyra_dashboard_metric (
        metric_key, metric_value, scope_type, source, is_mock
      ) VALUES
        ('PROD_VS_MOCK_TEST', 100, 'GLOBAL', 'VEYRA_POSTGRES', false),
        ('PROD_VS_MOCK_TEST', 9999, 'GLOBAL', 'DEMO_SEED', true)
    `);

    const prodQuery = await pool.query(`
      SELECT metric_value FROM veyra_dashboard_metric
      WHERE metric_key = 'PROD_VS_MOCK_TEST' AND is_mock = false
    `);
    const mockQuery = await pool.query(`
      SELECT metric_value FROM veyra_dashboard_metric
      WHERE metric_key = 'PROD_VS_MOCK_TEST' AND is_mock = true
    `);

    assert(
      prodQuery.rows.length === 1 && Number(prodQuery.rows[0].metric_value) === 100 &&
      mockQuery.rows.length === 1 && Number(mockQuery.rows[0].metric_value) === 9999,
      'TEST 13: Sample/mock data is strictly tagged (is_mock = true) and isolated from production'
    );

    // -------------------------------------------------------------------------
    // TEST 14: Index Existence Verification (AC5)
    // -------------------------------------------------------------------------
    const indexRes = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'veyra_dashboard_metric'
    `);
    const indexNames = indexRes.rows.map(r => r.indexname);

    const requiredIndexes = [
      'ix_veyra_dashboard_metric_key_scope_time',
      'ix_veyra_dashboard_metric_user_time',
      'ix_veyra_dashboard_metric_app_time',
      'ix_veyra_dashboard_metric_scope_captured',
      'ix_veyra_dashboard_metric_captured_at'
    ];

    const allIndexesExist = requiredIndexes.every(idx => indexNames.includes(idx));
    assert(
      allIndexesExist,
      'TEST 14: All 5 optimized query indexes exist on veyra_dashboard_metric',
      `Missing: ${requiredIndexes.filter(idx => !indexNames.includes(idx)).join(', ')}`
    );

    // -------------------------------------------------------------------------
    // TEST 15: User Deletion Preserves Metric History (ON DELETE SET NULL)
    // -------------------------------------------------------------------------
    await pool.query(`DELETE FROM veyra_user WHERE id = $1`, [testUserId]);

    const metricAfterUserDelete = await pool.query(`
      SELECT metric_id, user_id FROM veyra_dashboard_metric
      WHERE metric_id = $1
    `, [userMetric.rows[0].metric_id]);

    assert(
      metricAfterUserDelete.rows.length === 1 && metricAfterUserDelete.rows[0].user_id === null,
      'TEST 15: Deleting a user sets user_id to NULL, preserving metric history'
    );

    // Clean up test data
    await pool.query(`DELETE FROM veyra_dashboard_metric WHERE metric_key IN ('ACTIVE_RISKS', 'ROLE_DISTRIBUTION', 'USER_SECURITY_SCORE', 'PENDING_REVIEWS', 'PROD_VS_MOCK_TEST')`);

    // -------------------------------------------------------------------------
    // TEST 16 & 17: Migration Rollback (DOWN) and Re-Apply (UP) Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Testing Migration Reversibility ---');
    try {
      execSync('npm run migrate:down', {
        cwd: path.resolve(__dirname, '../..'),
        stdio: 'pipe'
      });

      const tableCheckAfterDown = await pool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'veyra_dashboard_metric'
      `);
      assert(tableCheckAfterDown.rows.length === 0, 'TEST 16: Migration DOWN cleanly removes veyra_dashboard_metric table');

      execSync('npm run migrate', {
        cwd: path.resolve(__dirname, '../..'),
        stdio: 'pipe'
      });

      const tableCheckAfterUp = await pool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'veyra_dashboard_metric'
      `);
      assert(tableCheckAfterUp.rows.length === 1, 'TEST 17: Migration UP cleanly re-creates veyra_dashboard_metric table');
    } catch (migErr) {
      assert(false, 'TEST 16/17: Migration DOWN/UP test encountered error', String(migErr));
    }

  } catch (err) {
    console.error('Unexpected error during verification:', err);
    failedTests++;
  } finally {
    await pool.end();
  }

  console.log('\n===========================================================');
  console.log(`  Summary: ${passedTests} passed, ${failedTests} failed.`);
  if (failedTests === 0) {
    console.log('  🎉 All Story 13 Database Requirements Successfully Verified!');
  }
  console.log('===========================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runVerification();
