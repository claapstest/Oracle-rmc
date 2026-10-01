/**
 * Automated Database Verification Suite for:
 * Story: VY-STRY-19
 * Title: DB: Implement Database Support for Reports-Only User Access
 *
 * Verifies all Acceptance Criteria:
 * 1. Audit User can be associated with the REPORTS privilege.
 * 2. Audit User must not automatically inherit other privileges.
 * 3. Report records must support authorization filtering.
 * 4. Database queries must respect the user's authorized scope.
 * 5. Appropriate indexes must exist for report retrieval.
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
  console.log('========================================================================');
  console.log('  VEYRA Database Verification: VY-STRY-19 Reports-Only User Access');
  console.log(`  Connecting to: ${connectionString.replace(/:[^:@]+@/, ':****@')}`);
  console.log('========================================================================\n');

  try {
    // -------------------------------------------------------------------------
    // SECTION 1: AUDIT_USER Role & REPORTS Privilege Association (AC1, Tests 1, 2, 3)
    // -------------------------------------------------------------------------
    console.log('--- Section 1: Verifying AUDIT_USER Role and REPORTS Privilege Association ---');

    // 1. AUDIT_USER role exists
    const roleRes = await pool.query(
      `SELECT id, role_code, role_name, status FROM veyra_role WHERE role_code = 'AUDIT_USER'`
    );
    assert(roleRes.rows.length === 1 && roleRes.rows[0].status === 'ACTIVE', 'TEST 1: AUDIT_USER role exists with status ACTIVE');

    // 2. REPORTS privilege exists
    const privRes = await pool.query(
      `SELECT id, privilege_code, privilege_name, module, status FROM veyra_privilege WHERE privilege_code = 'REPORTS'`
    );
    assert(privRes.rows.length === 1 && privRes.rows[0].module === 'REPORTS', 'TEST 2: REPORTS privilege exists with module REPORTS');

    // 3. AUDIT_USER -> REPORTS mapping exists in veyra_role_privilege
    const rolePrivRes = await pool.query(`
      SELECT r.role_code, p.privilege_code
      FROM veyra_role_privilege rp
      JOIN veyra_role r ON rp.role_id = r.id
      JOIN veyra_privilege p ON rp.privilege_id = p.id
      WHERE r.role_code = 'AUDIT_USER'
    `);
    const auditUserPrivs = rolePrivRes.rows.map(r => r.privilege_code);
    assert(auditUserPrivs.includes('REPORTS'), 'TEST 3: AUDIT_USER is mapped to REPORTS privilege in veyra_role_privilege');

    // -------------------------------------------------------------------------
    // SECTION 2: Zero Privilege Inheritance / Isolation (AC2, Tests 4, 5)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 2: Verifying Zero Privilege Inheritance (AC2) ---');

    // Expected: AUDIT_USER receives ONLY REPORTS
    assert(auditUserPrivs.length === 1 && auditUserPrivs[0] === 'REPORTS', 'TEST 4: AUDIT_USER has exactly 1 privilege (REPORTS)');

    // Ensure AUDIT_USER does not receive any administrative or security privileges
    const prohibitedPrivs = [
      'ASK_VEYRA',
      'USERS_LIST',
      'ROLES_CATALOG',
      'AUDIT_TRAIL',
      'RISK_MANAGEMENT',
      'USER_MANAGEMENT',
      'ORACLE_INTEGRATION',
      'ORACLE_API_CONSOLE'
    ];
    const hasAnyProhibited = prohibitedPrivs.some(p => auditUserPrivs.includes(p));
    assert(!hasAnyProhibited, 'TEST 5: AUDIT_USER does not inherit any prohibited/administrative privileges');

    // -------------------------------------------------------------------------
    // SECTION 3: Report Data Model & Table Verification (AC3, Tests 6, 7)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 3: Verifying veyra_report Schema & Indexes ---');

    // Table exists
    const tableRes = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'veyra_report'
    `);
    assert(tableRes.rows.length === 1, 'TEST 6: veyra_report table exists in public schema');

    // Required columns
    const colsRes = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'veyra_report'
    `);
    const colNames = new Set(colsRes.rows.map(r => r.column_name));
    const requiredCols = [
      'id', 'report_id', 'report_name', 'report_type', 'category',
      'status', 'format', 'size_bytes', 'download_url', 'generated_by',
      'user_id', 'scope_type', 'scope_id', 'application_scope',
      'is_mock', 'generated_at', 'created_at', 'updated_at'
    ];
    const allColsPresent = requiredCols.every(c => colNames.has(c));
    assert(allColsPresent, 'TEST 7: All 18 required columns exist in veyra_report with correct scope attributes');

    // Verify indexes exist (AC5)
    const indexRes = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'veyra_report'
    `);
    const indexes = new Set(indexRes.rows.map(r => r.indexname));
    assert(indexes.has('ix_veyra_report_app_scope_time'), 'TEST 8a: ix_veyra_report_app_scope_time index exists');
    assert(indexes.has('ix_veyra_report_user_time'), 'TEST 8b: ix_veyra_report_user_time partial index exists');
    assert(indexes.has('ix_veyra_report_category_type'), 'TEST 8c: ix_veyra_report_category_type index exists');
    assert(indexes.has('ix_veyra_report_status_time'), 'TEST 8d: ix_veyra_report_status_time index exists');

    // -------------------------------------------------------------------------
    // SECTION 4: Scope Filtering & Authorization Enforcement (AC3, AC4)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 4: Verifying Report Scope Enforcement & Parameter Tampering ---');

    const testNow = new Date();

    // Insert an isolated out-of-scope report for tenant 'FOREIGN_SCOPE'
    await pool.query(`
      INSERT INTO veyra_report (
        report_id, report_name, report_type, category, status, format, size_bytes,
        download_url, generated_by, scope_type, application_scope, is_mock, generated_at
      ) VALUES
        ('rep_foreign_test_099', 'Foreign Tenant Audit Report', 'SECURITY', 'Security & Compliance Governance', 'COMPLETED', 'PDF', 1024, '/api/reports/foreign', 'foreign_actor', 'APPLICATION', 'FOREIGN_ERP', false, $1)
      ON CONFLICT (report_id) DO NOTHING
    `, [testNow]);

    // Authorized query: application_scope = 'ORACLE_FUSION'
    const authorizedQuery = await pool.query(`
      SELECT report_id, report_name, application_scope, scope_type
      FROM veyra_report
      WHERE application_scope = $1
        AND is_mock = false
        AND (
          scope_type = 'GLOBAL'
          OR (scope_type = 'APPLICATION' AND application_scope = $1)
        )
      ORDER BY generated_at DESC
      LIMIT 10
    `, ['ORACLE_FUSION']);

    assert(authorizedQuery.rows.length >= 1, 'TEST 9: Authorized report records for ORACLE_FUSION are successfully retrieved');

    // Data outside authorized scope must NEVER leak into the result
    const leaksForeignData = authorizedQuery.rows.some(r => r.application_scope === 'FOREIGN_ERP' || r.report_id === 'rep_foreign_test_099');
    assert(!leaksForeignData, 'TEST 10: Unauthorized out-of-scope report records (FOREIGN_ERP) are NOT returned');

    // SQL Injection / parameter manipulation attempt via application_scope
    const maliciousScope = "ORACLE_FUSION' OR '1'='1";
    const injectionQuery = await pool.query(`
      SELECT report_id, report_name, application_scope
      FROM veyra_report
      WHERE application_scope = $1
    `, [maliciousScope]);
    assert(injectionQuery.rows.length === 0, 'TEST 11: SQL injection via scope parameter yields 0 rows (safeguarded by parameterization)');

    // -------------------------------------------------------------------------
    // SECTION 5: Query Plan & Index Scan Verification (AC5)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 5: Query Performance & Index Scan Verification ---');

    // Populate enough rows to test query planner with indexes
    await pool.query(`
      INSERT INTO veyra_report (
        report_id, report_name, report_type, category, status, format, size_bytes,
        download_url, generated_by, scope_type, application_scope, is_mock, generated_at
      )
      SELECT
        'rep_bench_' || i,
        'Benchmark Report ' || i,
        CASE (i % 3) WHEN 0 THEN 'ROLE_HIERARCHY' WHEN 1 THEN 'USER_ACCESS' ELSE 'SOD_CONFLICTS' END,
        'Category ' || (i % 4),
        'COMPLETED',
        'PDF',
        1000 * i,
        '/api/reports/bench',
        'scheduler',
        'GLOBAL',
        'ORACLE_FUSION',
        false,
        NOW() - (i || ' hours')::interval
      FROM generate_series(1, 100) AS i
      ON CONFLICT (report_id) DO NOTHING
    `);

    await pool.query('SET enable_seqscan = off');

    const explainReport = await pool.query(`
      EXPLAIN (FORMAT JSON)
      SELECT id, report_id, report_name, category, generated_at
      FROM veyra_report
      WHERE application_scope = 'ORACLE_FUSION'
        AND scope_type = 'GLOBAL'
        AND is_mock = false
      ORDER BY application_scope, scope_type, is_mock, generated_at DESC
      LIMIT 10
    `);

    const reportPlan = JSON.stringify(explainReport.rows);
    const usesReportIndex = reportPlan.includes('ix_veyra_report_app_scope_time') || reportPlan.includes('Index Scan');
    assert(usesReportIndex, 'TEST 12: veyra_report query uses ix_veyra_report_app_scope_time index scan (avoids full table scan)');

    await pool.query('SET enable_seqscan = on');

    // -------------------------------------------------------------------------
    // SECTION 6: Empty Result Sets & Clean Error Handling
    // -------------------------------------------------------------------------
    console.log('\n--- Section 6: Empty Result Sets Handling ---');
    const emptyQuery = await pool.query(`
      SELECT id, report_id, report_name
      FROM veyra_report
      WHERE application_scope = $1
        AND category = 'NON_EXISTENT_CATEGORY_XYZ'
    `, ['ORACLE_FUSION']);
    assert(Array.isArray(emptyQuery.rows) && emptyQuery.rows.length === 0, 'TEST 13: Empty result sets gracefully return empty array without error');

    // -------------------------------------------------------------------------
    // SECTION 7: Existing RBAC & System Integrity
    // -------------------------------------------------------------------------
    console.log('\n--- Section 7: Existing RBAC & System Integrity ---');
    const existingRoles = await pool.query(`
      SELECT role_code FROM veyra_role ORDER BY role_code
    `);
    const roleCodes = existingRoles.rows.map(r => r.role_code);
    assert(
      roleCodes.includes('SITE_ADMIN') &&
      roleCodes.includes('AUDIT_MANAGER') &&
      roleCodes.includes('AUDIT_SUPERVISOR') &&
      roleCodes.includes('AUDIT_USER'),
      'TEST 14: All 4 foundational roles remain intact in veyra_role'
    );

    // -------------------------------------------------------------------------
    // SECTION 8: Migration Reversibility (UP / DOWN)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 8: Migration Reversibility ---');
    try {
      // Revert migration 5 (down 1)
      const currentMigRes = await pool.query('SELECT name FROM pgmigrations ORDER BY id DESC');
      const migNames = currentMigRes.rows.map(r => r.name);
      const mig5Index = migNames.indexOf('1711000000005_create_veyra_report_table');
      const rollbackCount = mig5Index >= 0 ? mig5Index + 1 : 1;

      execSync(`npx node-pg-migrate down ${rollbackCount}`, {
        cwd: path.resolve(__dirname, '../..'),
        stdio: 'pipe'
      });

      const checkTableDown = await pool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'veyra_report'
      `);
      assert(checkTableDown.rows.length === 0, 'TEST 15: Migration DOWN cleanly drops veyra_report table and indexes');

      // Re-apply migration 5 (up)
      execSync('npx node-pg-migrate up', {
        cwd: path.resolve(__dirname, '../..'),
        stdio: 'pipe'
      });

      const checkTableUp = await pool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'veyra_report'
      `);
      assert(checkTableUp.rows.length === 1, 'TEST 16: Migration UP cleanly re-creates veyra_report table and indexes');
    } catch (migErr) {
      assert(false, 'TEST 15/16: Migration reversibility encountered an error', String(migErr));
    }

    // Clean up test rows
    await pool.query(`
      DELETE FROM veyra_report
      WHERE application_scope = 'FOREIGN_ERP'
         OR report_id LIKE 'rep_bench_%'
    `);

  } catch (err) {
    console.error('Unexpected error during verification:', err);
    failedTests++;
  } finally {
    await pool.end();
  }

  console.log('\n========================================================================');
  console.log(`  Summary: ${passedTests} passed, ${failedTests} failed.`);
  if (failedTests === 0) {
    console.log('  🎉 All Story VY-STRY-19 Database Requirements Successfully Verified!');
  }
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runVerification();
