/**
 * Automated Database Verification Suite for:
 * Story: VY-STRY-22
 * Title: DB: Create Database Structures for Site Administration and Oracle Integration
 *
 * Verifies all Acceptance Criteria:
 * 1. Oracle environment configuration can be persisted (AC1).
 * 2. Environment must have a unique identifier/name (AC2).
 * 3. Configuration status must be maintained (AC3).
 * 4. Configuration changes must be auditable (AC4).
 * 5. Passwords/secrets must not be stored as plain text. Secrets should preferably be stored
 *    in a secure secret-management system, with only references/metadata persisted in PostgreSQL (AC5).
 * 6. Database must support multiple Oracle environments if required by the application (AC6).
 * 7. Indexes, query performance, and migration reversibility (UP/DOWN).
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
  console.log('  VEYRA Database Verification: VY-STRY-22 Site Admin & Oracle Integration');
  console.log(`  Connecting to: ${connectionString.replace(/:[^:@]+@/, ':****@')}`);
  console.log('========================================================================\n');

  try {
    // Ensure migrations are up to date
    execSync('npm run migrate', { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });

    // -------------------------------------------------------------------------
    // SECTION 1: Table & Schema Structure Verification (AC1, AC2)
    // -------------------------------------------------------------------------
    console.log('--- Section 1: Verifying Table & Schema Structures (AC1, AC2) ---');

    // 1. veyra_oracle_environment table exists
    const tableEnv = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'veyra_oracle_environment'
    `);
    assert(tableEnv.rows.length === 1, 'TEST 1: veyra_oracle_environment table exists in public schema');

    // 2. veyra_oracle_environment_audit table exists
    const tableAudit = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'veyra_oracle_environment_audit'
    `);
    assert(tableAudit.rows.length === 1, 'TEST 2: veyra_oracle_environment_audit table exists in public schema');

    // 3. Required columns for veyra_oracle_environment
    const envCols = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'veyra_oracle_environment'
    `);
    const envColNames = new Set(envCols.rows.map(r => r.column_name));
    const requiredEnvCols = [
      'id', 'env_code', 'name', 'description', 'base_url', 'auth_type',
      'username', 'api_version', 'timeout_ms', 'max_retries',
      'secret_vault_ref', 'secret_storage_type', 'secret_metadata', 'is_secret_configured',
      'status', 'health_status', 'health_message', 'last_sync_at', 'last_health_check_at',
      'is_default', 'is_active', 'custom_headers', 'metadata', 'version',
      'created_by', 'updated_by', 'created_at', 'updated_at'
    ];
    const allEnvColsPresent = requiredEnvCols.every(c => envColNames.has(c));
    assert(allEnvColsPresent, 'TEST 3: All 28 required columns exist in veyra_oracle_environment');

    // 4. Primary key is on column "id"
    const pkRes = await pool.query(`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'veyra_oracle_environment'::regclass AND i.indisprimary;
    `);
    assert(pkRes.rows.length === 1 && pkRes.rows[0].attname === 'id', 'TEST 4: Primary key exists on column "id"');

    // -------------------------------------------------------------------------
    // SECTION 2: Unique Identifier & Name Constraints (AC2)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 2: Unique Identifier & Environment Constraints (AC2) ---');

    // 5. Unique constraint on env_code
    const uqRes = await pool.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'veyra_oracle_environment'::regclass AND contype = 'u'
    `);
    const uqNames = uqRes.rows.map(r => r.conname);
    assert(uqNames.includes('uq_veyra_oracle_env_code'), 'TEST 5: Unique constraint uq_veyra_oracle_env_code exists on env_code');

    // 6. Test duplicate env_code rejection
    let duplicateRejected = false;
    try {
      await pool.query(`
        INSERT INTO veyra_oracle_environment (
          env_code, name, base_url, auth_type, username
        ) VALUES (
          'DEFAULT', 'Duplicate Default', 'https://duplicate.oraclecloud.com', 'BASIC', 'ADMIN'
        );
      `);
    } catch (err: any) {
      if (err.code === '23505') {
        duplicateRejected = true;
      }
    }
    assert(duplicateRejected, 'TEST 6: Unique identifier violation (23505) enforced when inserting duplicate env_code');

    // -------------------------------------------------------------------------
    // SECTION 3: Configuration Persistence & Multiple Environments (AC1, AC6)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 3: Configuration Persistence & Multi-Environment Support (AC1, AC6) ---');

    // 7. Insert new secondary Oracle environment (e.g. UAT / Stage)
    const testEnvCode = `TEST_STG_${Date.now()}`;
    const insertRes = await pool.query(`
      INSERT INTO veyra_oracle_environment (
        env_code, name, description, base_url, auth_type, username,
        api_version, timeout_ms, max_retries,
        secret_vault_ref, secret_storage_type, secret_metadata, is_secret_configured,
        status, is_default, is_active, metadata
      ) VALUES (
        $1, 'Oracle Fusion Stage Sandbox', 'Integration testing and staging environment',
        'https://fa-test-sandbox.oraclecloud.com', 'BEARER', 'TEST_FUSION_API',
        '11.13.18.05', 45000, 5,
        'vault://veyra/oracle/environments/sandbox/token', 'VAULT_REF',
        '{"key_version": "v2", "provider": "HASHICORP_VAULT"}'::jsonb, true,
        'STANDBY', false, true,
        '{"region": "eu-frankfurt-1", "rateLimitRps": 50}'::jsonb
      ) RETURNING id, env_code, base_url, status, is_default;
    `, [testEnvCode]);

    assert(insertRes.rows.length === 1 && insertRes.rows[0].env_code === testEnvCode, 'TEST 7: New Oracle environment configuration persisted successfully (AC1)');
    const createdEnvId = insertRes.rows[0].id;

    // 8. Multiple environments coexist simultaneously in database (AC6)
    const allEnvs = await pool.query(`
      SELECT env_code, name, base_url, is_default, is_active
      FROM veyra_oracle_environment
      WHERE is_active = true
      ORDER BY created_at ASC;
    `);
    assert(allEnvs.rows.length >= 2, `TEST 8: Multiple Oracle environments co-exist concurrently in database (count: ${allEnvs.rows.length}) (AC6)`);

    // 9. Default Environment Partial Unique Index enforcement (AC6)
    // Only one environment can have is_default = TRUE
    let secondDefaultRejected = false;
    try {
      await pool.query(`
        INSERT INTO veyra_oracle_environment (
          env_code, name, base_url, is_default
        ) VALUES (
          'CONFLICT_DEFAULT', 'Conflicting Default', 'https://conflict.oracle.com', true
        );
      `);
    } catch (err: any) {
      if (err.code === '23505') {
        secondDefaultRejected = true;
      }
    }
    assert(secondDefaultRejected, 'TEST 9: Partial unique index ix_veyra_oracle_env_default guarantees at most ONE default environment (AC6)');

    // -------------------------------------------------------------------------
    // SECTION 4: Configuration Status Maintenance (AC3)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 4: Configuration Status & Health Maintenance (AC3) ---');

    // 10. Update status to CONNECTED with health metrics
    const now = new Date();
    const updateStatusRes = await pool.query(`
      UPDATE veyra_oracle_environment
      SET status = 'CONNECTED',
          health_status = 'HEALTHY',
          health_message = 'Successfully completed handshake and REST catalog probe',
          last_sync_at = $1,
          last_health_check_at = $1,
          updated_by = 'site_admin@claaps.com',
          version = version + 1
      WHERE id = $2
      RETURNING status, health_status, version;
    `, [now, createdEnvId]);

    assert(
      updateStatusRes.rows.length === 1 &&
      updateStatusRes.rows[0].status === 'CONNECTED' &&
      updateStatusRes.rows[0].health_status === 'HEALTHY',
      'TEST 10: Configuration status & health metrics updated and maintained (AC3)'
    );

    // 11. Status check constraint rejects invalid status
    let invalidStatusRejected = false;
    try {
      await pool.query(`
        UPDATE veyra_oracle_environment
        SET status = 'NON_EXISTENT_STATUS'
        WHERE id = $1;
      `, [createdEnvId]);
    } catch (err: any) {
      if (err.code === '23514') { // check_violation
        invalidStatusRejected = true;
      }
    }
    assert(invalidStatusRejected, 'TEST 11: Invalid status string rejected by ck_veyra_oracle_env_status constraint');

    // -------------------------------------------------------------------------
    // SECTION 5: Auditing of Configuration Changes (AC4)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 5: Configuration Audit Trail & Trigger Verification (AC4) ---');

    // 12. Check that the automatic trigger recorded INSERT in audit table
    const auditInsertRes = await pool.query(`
      SELECT audit_id, env_code, action, changed_by, new_state, diff
      FROM veyra_oracle_environment_audit
      WHERE environment_id = $1 AND action = 'CREATE'
    `, [createdEnvId]);

    assert(
      auditInsertRes.rows.length >= 1 &&
      auditInsertRes.rows[0].action === 'CREATE' &&
      auditInsertRes.rows[0].env_code === testEnvCode,
      'TEST 12: Automated trigger recorded CREATE audit event in veyra_oracle_environment_audit (AC4)'
    );

    // 13. Check that the update triggered STATUS_CHANGE audit record
    const auditUpdateRes = await pool.query(`
      SELECT audit_id, env_code, action, changed_by, diff
      FROM veyra_oracle_environment_audit
      WHERE environment_id = $1 AND action = 'STATUS_CHANGE'
    `, [createdEnvId]);

    assert(
      auditUpdateRes.rows.length >= 1 &&
      auditUpdateRes.rows[0].diff?.status_changed === true,
      'TEST 13: Automated trigger recorded STATUS_CHANGE audit event with before/after diff (AC4)'
    );

    // 14. Manual / Application explicit audit entry (e.g., TEST_CONNECTION)
    await pool.query(`
      INSERT INTO veyra_oracle_environment_audit (
        environment_id, env_code, action, changed_by, ip_address, reason, diff
      ) VALUES (
        $1, $2, 'TEST_CONNECTION', 'site_admin@claaps.com', '192.168.1.100',
        'Admin triggered on-demand connection verification probe',
        '{"handshakeLatencyMs": 142, "httpStatus": 200}'::jsonb
      );
    `, [createdEnvId, testEnvCode]);

    const testConnAudit = await pool.query(`
      SELECT action, ip_address, reason
      FROM veyra_oracle_environment_audit
      WHERE environment_id = $1 AND action = 'TEST_CONNECTION'
    `, [createdEnvId]);
    assert(testConnAudit.rows.length === 1 && testConnAudit.rows[0].ip_address === '192.168.1.100', 'TEST 14: Explicit application audit actions (TEST_CONNECTION) can be recorded and tracked');

    // -------------------------------------------------------------------------
    // SECTION 6: Secrets Security & Plaintext Prevention (AC5)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 6: Zero Plaintext Secrets & Vault References (AC5) ---');

    // 15. Verify secret references & metadata are used instead of plain text passwords
    const defaultEnv = await pool.query(`
      SELECT env_code, secret_vault_ref, secret_storage_type, is_secret_configured, secret_metadata
      FROM veyra_oracle_environment
      WHERE env_code = 'DEFAULT'
    `);
    assert(
      defaultEnv.rows[0].secret_vault_ref.startsWith('vault://') &&
      defaultEnv.rows[0].secret_storage_type === 'VAULT_REF' &&
      defaultEnv.rows[0].is_secret_configured === true,
      'TEST 15: Secret references & vault pointers are persisted instead of plaintext secrets (AC5)'
    );

    // 16. Verify check constraint rejects any plain text password stored in secret_metadata
    let secretMetadataPlaintextRejected = false;
    try {
      await pool.query(`
        INSERT INTO veyra_oracle_environment (
          env_code, name, base_url, secret_metadata
        ) VALUES (
          'INSECURE_ENV', 'Insecure Environment', 'https://insecure.oracle.com',
          '{"password": "plainTextSecret123!"}'::jsonb
        );
      `);
    } catch (err: any) {
      if (err.code === '23514') { // check constraint violation
        secretMetadataPlaintextRejected = true;
      }
    }
    assert(secretMetadataPlaintextRejected, 'TEST 16: Check constraint ck_veyra_oracle_env_no_plaintext_passwords blocks plain text passwords in secret_metadata (AC5)');

    // 17. Verify check constraint blocks plaintext in audit diff / state
    let auditPlaintextBlocked = false;
    try {
      await pool.query(`
        INSERT INTO veyra_oracle_environment_audit (
          environment_id, env_code, action, changed_by, diff
        ) VALUES (
          $1, $2, 'UPDATE', 'attacker', '{"password": "leakedPassword"}'::jsonb
        );
      `, [createdEnvId, testEnvCode]);
    } catch (err: any) {
      if (err.code === '23514') {
        auditPlaintextBlocked = true;
      }
    }
    assert(auditPlaintextBlocked, 'TEST 17: Audit check constraint ck_veyra_oracle_audit_no_plaintext_passwords blocks plain text secrets in audit diff (AC5)');

    // 18. Verify NO column named password or token exists on veyra_oracle_environment
    const sensitiveCols = envCols.rows.filter(r =>
      ['password', 'token', 'secret', 'client_secret'].includes(r.column_name.toLowerCase())
    );
    assert(sensitiveCols.length === 0, 'TEST 18: Zero sensitive password/token columns exist on veyra_oracle_environment table schema (AC5)');

    // -------------------------------------------------------------------------
    // SECTION 7: Preservation of Audit Trail on Deletion (AC4)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 7: Audit Preservation on Decommissioning / Deletion (AC4) ---');

    // 19. Delete test environment and verify audit records are preserved with environment_id = NULL
    await pool.query(`DELETE FROM veyra_oracle_environment WHERE id = $1`, [createdEnvId]);

    const preservedAudit = await pool.query(`
      SELECT audit_id, env_code, action, environment_id
      FROM veyra_oracle_environment_audit
      WHERE env_code = $1
      ORDER BY changed_at ASC;
    `, [testEnvCode]);

    assert(
      preservedAudit.rows.length >= 3 &&
      preservedAudit.rows.every(r => r.environment_id === null),
      'TEST 19: Environment deletion preserves audit trail with ON DELETE SET NULL (AC4)'
    );

    // -------------------------------------------------------------------------
    // SECTION 8: Query Indexes & Performance
    // -------------------------------------------------------------------------
    console.log('\n--- Section 8: Query Index Verification ---');

    const indexRes = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename IN ('veyra_oracle_environment', 'veyra_oracle_environment_audit');
    `);
    const indexNames = new Set(indexRes.rows.map(r => r.indexname));

    assert(indexNames.has('ix_veyra_oracle_env_code'), 'TEST 20a: ix_veyra_oracle_env_code index exists');
    assert(indexNames.has('ix_veyra_oracle_env_status_active'), 'TEST 20b: ix_veyra_oracle_env_status_active index exists');
    assert(indexNames.has('ix_veyra_oracle_env_updated_at'), 'TEST 20c: ix_veyra_oracle_env_updated_at index exists');
    assert(indexNames.has('ix_veyra_oracle_env_default'), 'TEST 20d: ix_veyra_oracle_env_default unique partial index exists');
    assert(indexNames.has('ix_veyra_oracle_audit_env_time'), 'TEST 20e: ix_veyra_oracle_audit_env_time index exists');
    assert(indexNames.has('ix_veyra_oracle_audit_env_code_time'), 'TEST 20f: ix_veyra_oracle_audit_env_code_time index exists');
    assert(indexNames.has('ix_veyra_oracle_audit_action_time'), 'TEST 20g: ix_veyra_oracle_audit_action_time index exists');

    // -------------------------------------------------------------------------
    // SECTION 9: Migration Reversibility (DOWN and UP)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 9: Migration Reversibility ---');

    // Rollback migration
    execSync('npm run migrate:down', { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });

    const checkDropped = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('veyra_oracle_environment', 'veyra_oracle_environment_audit');
    `);
    assert(checkDropped.rows.length === 0, 'TEST 21: Migration DOWN cleanly drops veyra_oracle_environment and audit tables');

    // Re-apply migration
    execSync('npm run migrate', { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });

    const checkRestored = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('veyra_oracle_environment', 'veyra_oracle_environment_audit');
    `);
    assert(checkRestored.rows.length === 2, 'TEST 22: Migration UP cleanly re-creates veyra_oracle_environment and audit tables');

    // Verify seed is restored
    const seedCheck = await pool.query(`SELECT env_code, status FROM veyra_oracle_environment WHERE env_code = 'DEFAULT'`);
    assert(seedCheck.rows.length === 1 && seedCheck.rows[0].status === 'STANDBY', 'TEST 23: Default Oracle environment seed record is safely restored');

    // -------------------------------------------------------------------------
    // Final Summary
    // -------------------------------------------------------------------------
    console.log('\n========================================================================');
    console.log(`  Summary: ${passedTests} passed, ${failedTests} failed.`);
    if (failedTests === 0) {
      console.log('  🎉 All Story VY-STRY-22 Database Requirements Successfully Verified!');
    } else {
      console.error('  ⚠️ Some verification tests failed!');
    }
    console.log('========================================================================\n');

  } catch (error) {
    console.error('Fatal verification error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }

  if (failedTests > 0) {
    process.exit(1);
  }
}

runVerification();
