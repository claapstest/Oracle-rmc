/**
 * Test Suite: Story VYR-031
 * "Implement PostgreSQL encrypted payload schema and migration support"
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Verifies PostgreSQL schema extensions across all 10 raw Oracle tables,
 * encryption tracking columns, performance indexes, migration ledger,
 * dual-mode storage, reporting query preservation, and log sanitization.
 */

const fs = require('fs');
const path = require('path');
const pg = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  FAIL: ${testName}`);
    failedTests++;
  }
}

async function run() {
  console.log('\n================================================================');
  console.log('  VYR-031: PostgreSQL Encrypted Payload Schema & Migration');
  console.log('================================================================\n');

  const migrationServicePath = path.resolve(__dirname, '../dist/security/encryptionMigrationService.js');
  const encryptionContractPath = path.resolve(__dirname, '../dist/security/encryptionContract.js');
  const migrationFilePath = path.resolve(__dirname, '../../database/migrations/1711000000021_create_oracle_raw_encrypted_payloads_and_columns.cjs');

  assert(fs.existsSync(migrationFilePath), 'Migration file 1711000000021 exists in database/migrations');
  assert(fs.existsSync(migrationServicePath), 'backend/dist/security/encryptionMigrationService.js compiled and exists');

  const {
    EncryptionMigrationService,
    encryptionMigrationService,
    RAW_ORACLE_PERSISTENCE_TABLES,
  } = require(migrationServicePath);

  const {
    isEncryptedPayload,
    CURRENT_ENCRYPTION_FORMAT_VERSION,
    ENCRYPTION_ALGORITHM_AES_256_GCM,
  } = require(encryptionContractPath);

  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'veyra_db'}`,
  });

  try {
    // -------------------------------------------------------------------------
    // Section 1: Database Schema Verification & Table Inventory (AC1, AC3)
    // -------------------------------------------------------------------------
    console.log('--- Section 1: Schema Verification & Table Inventory (AC1, AC3) ---');

    assert(RAW_ORACLE_PERSISTENCE_TABLES.length === 10, 'Catalog defines all 10 raw Oracle persistence tables');

    const schemaReport = await encryptionMigrationService.verifySchemaIntegrity(pool);
    assert(schemaReport.healthy === true, 'verifySchemaIntegrity reports schema is fully healthy');
    assert(schemaReport.missingColumns.length === 0, 'Zero missing encryption columns across all 10 tables');
    assert(schemaReport.ledgerTableExists === true, 'Table oracle_encryption_migration_ledger exists in PostgreSQL');

    // Verify each raw table columns and indexes individually
    for (const tableDesc of RAW_ORACLE_PERSISTENCE_TABLES) {
      const colRes = await pool.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        [tableDesc.tableName]
      );
      const cols = new Map(colRes.rows.map(r => [r.column_name, r.data_type]));

      assert(cols.has('is_encrypted'), `${tableDesc.tableName} has is_encrypted column`);
      assert(cols.get('is_encrypted') === 'boolean', `${tableDesc.tableName}.is_encrypted is boolean`);
      assert(cols.has('encryption_format_version'), `${tableDesc.tableName} has encryption_format_version column`);
      assert(cols.has('encryption_key_id'), `${tableDesc.tableName} has encryption_key_id column`);
      assert(cols.has('encrypted_at'), `${tableDesc.tableName} has encrypted_at column`);
      assert(cols.has(tableDesc.rawColumnName), `${tableDesc.tableName} has raw payload column ${tableDesc.rawColumnName}`);

      // Verify index existence
      const idxRes = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2`,
        [tableDesc.tableName, `ix_${tableDesc.tableName}_enc_status`]
      );
      assert(idxRes.rows.length === 1, `${tableDesc.tableName} has index ix_${tableDesc.tableName}_enc_status on (environment_host, is_encrypted)`);
    }

    // -------------------------------------------------------------------------
    // Section 2: Migration Ledger State & Tracking (AC1)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 2: Migration Ledger State & Tracking (AC1) ---');

    const testTenant = 'test-migration-env.oraclecloud.com';
    const testTable = 'oracle_raw_users';

    // 1. Initialize migration entry
    await encryptionMigrationService.updateMigrationLedger(pool, {
      tableName: testTable,
      environmentHost: testTenant,
      totalRecords: 500,
      encryptedRecords: 0,
      plaintextRecords: 500,
      batchSize: 100,
      status: 'PENDING',
    });

    let ledger = await encryptionMigrationService.getMigrationLedger(pool, testTenant);
    const entry = ledger.find(e => e.tableName === testTable);
    assert(entry !== undefined, 'Ledger entry found for test table and tenant');
    assert(entry.status === 'PENDING', 'Ledger status initialized as PENDING');
    assert(entry.totalRecords === 500, 'Ledger totalRecords matches 500');
    assert(entry.plaintextRecords === 500, 'Ledger plaintextRecords matches 500');

    // 2. Transition to IN_PROGRESS
    await encryptionMigrationService.updateMigrationLedger(pool, {
      tableName: testTable,
      environmentHost: testTenant,
      encryptedRecords: 200,
      plaintextRecords: 300,
      lastMigratedId: 'user-batch-2',
      status: 'IN_PROGRESS',
    });

    ledger = await encryptionMigrationService.getMigrationLedger(pool, testTenant);
    const inProgressEntry = ledger.find(e => e.tableName === testTable);
    assert(inProgressEntry.status === 'IN_PROGRESS', 'Ledger status updated to IN_PROGRESS');
    assert(inProgressEntry.encryptedRecords === 200, 'Ledger encryptedRecords updated to 200');
    assert(inProgressEntry.lastMigratedId === 'user-batch-2', 'Ledger cursor lastMigratedId updated');
    assert(inProgressEntry.startedAt !== null, 'Ledger startedAt timestamp recorded');

    // 3. Transition to COMPLETED
    await encryptionMigrationService.updateMigrationLedger(pool, {
      tableName: testTable,
      environmentHost: testTenant,
      encryptedRecords: 500,
      plaintextRecords: 0,
      lastMigratedId: 'user-batch-5',
      status: 'COMPLETED',
    });

    ledger = await encryptionMigrationService.getMigrationLedger(pool, testTenant);
    const completedEntry = ledger.find(e => e.tableName === testTable);
    assert(completedEntry.status === 'COMPLETED', 'Ledger status updated to COMPLETED');
    assert(completedEntry.completedAt !== null, 'Ledger completedAt timestamp recorded');

    // Clean up test ledger entry
    await pool.query(
      `DELETE FROM oracle_encryption_migration_ledger WHERE environment_host = $1`,
      [testTenant]
    );

    // -------------------------------------------------------------------------
    // Section 3: Dual-Mode Storage & Reporting Query Preservation (AC1, AC2, AC3)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 3: Dual-Mode Storage & Reporting Query Preservation (AC1, AC2, AC3) ---');

    const sampleHost = 'test-dual-mode.oraclecloud.com';
    const legacyUser = 'legacy.analyst.01';
    const encryptedUser = 'encrypted.executive.01';

    // Insert legacy plaintext record
    await pool.query(
      `INSERT INTO oracle_raw_users (
         environment_host, username, display_name, email, is_active, user_category,
         raw_user, is_encrypted, encryption_format_version, encryption_key_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, NULL, NULL)
       ON CONFLICT (environment_host, username) DO UPDATE SET raw_user = $7, is_encrypted = FALSE`,
      [
        sampleHost,
        legacyUser,
        'Legacy Analyst',
        'legacy.analyst@company.com',
        true,
        'ANALYST',
        JSON.stringify({ userName: legacyUser, department: 'Finance', salary: 90000 }),
      ]
    );

    // Insert encrypted record
    const mockEncryptedPayload = {
      formatVersion: CURRENT_ENCRYPTION_FORMAT_VERSION,
      algorithm: ENCRYPTION_ALGORITHM_AES_256_GCM,
      keyId: 'veyra-kms-k1-2026',
      encryptedDek: 'B64WrappedDekSampleBytes==',
      nonce: 'B64Nonce12Bytes==',
      authTag: 'B64AuthTag16Bytes==',
      ciphertext: 'B64EncryptedCiphertextSample==',
      aad: `tenant=${sampleHost}|table=oracle_raw_users|id=${encryptedUser}|v=1`,
      createdAt: new Date().toISOString(),
    };

    await pool.query(
      `INSERT INTO oracle_raw_users (
         environment_host, username, display_name, email, is_active, user_category,
         raw_user, is_encrypted, encryption_format_version, encryption_key_id, encrypted_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, NOW())
       ON CONFLICT (environment_host, username) DO UPDATE SET
         raw_user = $7, is_encrypted = TRUE, encryption_format_version = $8,
         encryption_key_id = $9, encrypted_at = NOW()`,
      [
        sampleHost,
        encryptedUser,
        'Encrypted Executive',
        'encrypted.vp@company.com',
        true,
        'EXECUTIVE',
        JSON.stringify(mockEncryptedPayload),
        1,
        'veyra-kms-k1-2026',
      ]
    );

    // Query 1: Reporting filter query on unencrypted relational columns
    const reportRes = await pool.query(
      `SELECT username, display_name, email, is_active, is_encrypted
       FROM oracle_raw_users
       WHERE environment_host = $1
       ORDER BY username ASC`,
      [sampleHost]
    );
    assert(reportRes.rows.length === 2, 'Reporting query returns both legacy and encrypted rows via unencrypted metadata columns');
    assert(reportRes.rows[0].username === encryptedUser && reportRes.rows[0].is_encrypted === true, 'Encrypted row preserves queryable metadata');
    assert(reportRes.rows[1].username === legacyUser && reportRes.rows[1].is_encrypted === false, 'Legacy row preserves queryable metadata');

    // Query 2: Discriminator distinguishes payload formats
    const rawBlobsRes = await pool.query(
      `SELECT username, raw_user, is_encrypted
       FROM oracle_raw_users
       WHERE environment_host = $1
       ORDER BY username ASC`,
      [sampleHost]
    );
    const encRow = rawBlobsRes.rows.find(r => r.username === encryptedUser);
    const legRow = rawBlobsRes.rows.find(r => r.username === legacyUser);

    assert(isEncryptedPayload(encRow.raw_user) === true, 'isEncryptedPayload correctly identifies encrypted JSON container');
    assert(isEncryptedPayload(legRow.raw_user) === false, 'isEncryptedPayload correctly identifies legacy plaintext JSON record');

    // Clean up sample records
    await pool.query(`DELETE FROM oracle_raw_users WHERE environment_host = $1`, [sampleHost]);

    // -------------------------------------------------------------------------
    // Section 4: Safe Serialization & Logging Hygiene (AC2)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 4: Safe Serialization & Logging Hygiene (AC2) ---');

    const sanitizedPayload = encryptionMigrationService.sanitizeForLogging(mockEncryptedPayload);
    assert(sanitizedPayload.formatVersion === 1, 'Sanitized payload keeps formatVersion');
    assert(sanitizedPayload.algorithm === 'AES-256-GCM', 'Sanitized payload keeps algorithm');
    assert(sanitizedPayload.keyId === 'veyra-kms-k1-2026', 'Sanitized payload keeps keyId');
    assert(sanitizedPayload.ciphertext.includes('[REDACTED_CIPHERTEXT:'), 'Ciphertext is safely redacted');
    assert(sanitizedPayload.encryptedDek === '[REDACTED_WRAPPED_DEK]', 'Wrapped DEK is safely redacted');
    assert(sanitizedPayload.nonce === '[REDACTED_NONCE]', 'Nonce is safely redacted');
    assert(sanitizedPayload.authTag === '[REDACTED_AUTH_TAG]', 'AuthTag is safely redacted');

    const sensitiveUserObj = {
      username: 'alice',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz',
      ssn: '123-45-6789',
      apiToken: 'secret_token_12345',
      displayName: 'Alice Smith',
    };
    const sanitizedUser = encryptionMigrationService.sanitizeForLogging(sensitiveUserObj);
    assert(sanitizedUser.displayName === 'Alice Smith', 'Non-sensitive metadata preserved');
    assert(sanitizedUser.passwordHash === '[REDACTED_SENSITIVE]', 'Password redacted');
    assert(sanitizedUser.ssn === '[REDACTED_SENSITIVE]', 'SSN redacted');
    assert(sanitizedUser.apiToken === '[REDACTED_SENSITIVE]', 'Token redacted');

    // -------------------------------------------------------------------------
    // Section 5: Architecture Spec & Regression Harness (AC1, AC2, AC3)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 5: Documentation & Regression Harness (AC1, AC2, AC3) ---');

    const archDocPath = path.resolve(__dirname, '../../docs/architecture/postgresql_encrypted_payload_schema_and_migration.md');
    assert(fs.existsSync(archDocPath), 'docs/architecture/postgresql_encrypted_payload_schema_and_migration.md exists');

    const archContent = fs.readFileSync(archDocPath, 'utf8');
    assert(archContent.includes('VYR-031'), 'Architecture doc explicitly references Story VYR-031');
    assert(archContent.includes('EPIC 4'), 'Architecture doc explicitly references EPIC 4');
    assert(archContent.includes('standard-veyra-application-dev'), 'Architecture doc documents applicability to standard branch');
    assert(archContent.includes('veyra-application-dev'), 'Architecture doc documents applicability to veyra dev branch');
    assert(archContent.includes('oracle_encryption_migration_ledger'), 'Architecture doc documents migration ledger table');
    assert(archContent.includes('Reporting Query Preservation'), 'Architecture doc documents queryable metadata preservation');
    assert(archContent.includes('Safe Logging & Debug Serializers'), 'Architecture doc documents safe logging hygiene');

    const packageJsonPath = path.resolve(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    assert(Boolean(pkg.scripts && pkg.scripts['test:vyr31']), 'package.json defines "test:vyr31" script');
    assert(Boolean(pkg.scripts && pkg.scripts['test:epic4'] && pkg.scripts['test:epic4'].includes('test:vyr31')), 'package.json wires test:vyr31 into "test:epic4"');

  } finally {
    await pool.end();
  }

  console.log('\n================================================================');
  console.log(`  Passed: ${passedTests}  Failed: ${failedTests}`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Unhandled test harness error:', err);
  process.exit(1);
});
