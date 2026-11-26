/**
 * Automated Verification Suite: Story VYR-059
 * Epic 7: Security, branch, regression and release testing
 * Story Title: Verify PostgreSQL contains no sensitive plaintext raw payloads
 *
 * Acceptance Criteria Verified:
 *  1. No sensitive raw JSON is readable through direct database queries.
 *  2. Any retained cleartext field has approved classification and justification.
 *
 * Test Sections:
 *  1.  Database connectivity and table existence.
 *  2.  oracle_raw_audit_records — raw_payload encrypted or empty.
 *  3.  oracle_raw_users — raw_user encrypted or empty.
 *  4.  oracle_raw_roles — raw_role encrypted or empty.
 *  5.  oracle_raw_role_hierarchy — raw_record encrypted or empty.
 *  6.  oracle_raw_controls — raw_payload encrypted or empty.
 *  7.  oracle_control_incidents — raw_incidents encrypted or empty.
 *  8.  oracle_incident_rows — raw encrypted or empty.
 *  9.  oracle_raw_access_certifications — raw_data encrypted or empty.
 * 10.  oracle_raw_certifier_worksheets — raw_data encrypted or empty.
 * 11.  oracle_raw_user_access — raw_payload encrypted or empty.
 * 12.  Sentinel value sweep — no known PII patterns in any raw column.
 * 13.  Encryption tracking column consistency (is_encrypted, encryption_key_id).
 * 14.  Approved queryable metadata fields — classification justification.
 * 15.  Encryption migration ledger — no PENDING plaintext batches remain.
 *
 * Run: npm --prefix backend run test:vyr59
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

let passed = 0;
let failed = 0;
let skipped = 0;
const sections = [];
let currentSection = null;

function report(condition, message, details) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    if (details !== undefined) console.error('        Details:', typeof details === 'object' ? JSON.stringify(details) : details);
    failed++;
  }
}

function skip(message) {
  console.log(`  SKIP: ${message}`);
  skipped++;
}

function section(name) {
  currentSection = { name, startPassed: passed, startFailed: failed };
  console.log(`\n--- ${name} ---`);
}

function sectionEnd() {
  if (currentSection) {
    const p = passed - currentSection.startPassed;
    const f = failed - currentSection.startFailed;
    sections.push({ name: currentSection.name, passed: p, failed: f });
    currentSection = null;
  }
}

// ---------------------------------------------------------------------------
// Raw table catalog: table name → JSONB column(s) that must be encrypted
// ---------------------------------------------------------------------------
const RAW_TABLE_CATALOG = [
  { table: 'oracle_raw_audit_records',        rawColumn: 'raw_payload',   naturalIdExpr: 'record_unique_hash' },
  { table: 'oracle_raw_users',                rawColumn: 'raw_user',      naturalIdExpr: 'username' },
  { table: 'oracle_raw_roles',                rawColumn: 'raw_role',      naturalIdExpr: 'role_code' },
  { table: 'oracle_raw_role_hierarchy',       rawColumn: 'raw_record',    naturalIdExpr: "parent_role_name || ':' || child_role_name" },
  { table: 'oracle_raw_controls',             rawColumn: 'raw_payload',   naturalIdExpr: 'control_id' },
  { table: 'oracle_control_incidents',        rawColumn: 'raw_incidents', naturalIdExpr: 'control_id' },
  { table: 'oracle_incident_rows',            rawColumn: 'raw',           naturalIdExpr: "control_id || ':' || ord" },
  { table: 'oracle_raw_access_certifications', rawColumn: 'raw_data',    naturalIdExpr: 'certification_id' },
  { table: 'oracle_raw_certifier_worksheets', rawColumn: 'raw_data',      naturalIdExpr: 'id::text' },
  { table: 'oracle_raw_user_access',          rawColumn: 'raw_payload',   naturalIdExpr: 'username' },
];

// Sentinel values: known PII / sensitive patterns that must never appear in
// plaintext raw JSON columns. These are realistic field names and patterns
// from Oracle Fusion SCIM, auditData, and GRC payloads.
const SENTINEL_FIELD_NAMES = [
  'emailAddress',
  'PersonEmail',
  'HomePhone',
  'WorkPhone',
  'NationalIdentifier',
  'TaxpayerIdentificationNumber',
  'BankAccountNumber',
  'RoutingNumber',
  'CreditCardNumber',
  'socialSecurityNumber',
  'DateOfBirth',
  'homeAddress',
  'salary',
  'compensation',
];

// Regex patterns that indicate plaintext Oracle Fusion JSON structures
const PLAINTEXT_JSON_PATTERNS = [
  // SCIM user resource schema URI
  'urn:ietf:params:scim:schemas:core:2.0:User',
  // Oracle SCIM extension schema
  'urn:ietf:params:scim:schemas:extension:oracle',
  // auditData payload indicators
  '"auditData"',
  '"AttributeChangeHistory"',
  '"beforeValue"',
  '"afterValue"',
  // GRC Control structures
  '"AnalysisType"',
  '"ControlPoint"',
  '"IncidentResult"',
];

/**
 * Checks whether a raw column value looks like an EncryptedPayload container.
 * An encrypted payload has: formatVersion, algorithm, keyId, ciphertext, nonce, authTag.
 */
function looksEncrypted(val) {
  if (val === null || val === undefined) return true; // No data = no exposure
  if (typeof val === 'string') {
    try { val = JSON.parse(val); } catch { return false; }
  }
  if (typeof val !== 'object') return false;
  return (
    val.formatVersion !== undefined &&
    val.algorithm === 'AES-256-GCM' &&
    typeof val.keyId === 'string' &&
    typeof val.ciphertext === 'string' &&
    typeof val.nonce === 'string' &&
    typeof val.authTag === 'string'
  );
}

/**
 * Checks whether a value contains plaintext JSON (not encrypted).
 * Returns true for genuine Oracle Fusion payloads that should have been encrypted.
 */
function containsPlaintextSensitive(val) {
  if (val === null || val === undefined) return false;
  const str = typeof val === 'string' ? val : JSON.stringify(val);
  if (str === '{}' || str === '[]' || str === 'null') return false;
  // If it's an encrypted container, it's not plaintext
  if (looksEncrypted(val)) return false;
  // Check for sentinel patterns
  for (const pattern of PLAINTEXT_JSON_PATTERNS) {
    if (str.includes(pattern)) return true;
  }
  for (const field of SENTINEL_FIELD_NAMES) {
    if (str.includes(`"${field}"`)) return true;
  }
  return false;
}


async function main() {
  console.log('================================================================');
  console.log('  VYR-059: Verify PostgreSQL Contains No Sensitive');
  console.log('           Plaintext Raw Payloads');
  console.log('================================================================\n');

  // =========================================================================
  // Connect to PostgreSQL
  // =========================================================================
  let pool;
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    });
    await pool.query('SELECT 1');
  } catch (err) {
    console.error(`\n  FATAL: Cannot connect to PostgreSQL: ${err.message}`);
    console.error('         Set DATABASE_URL in .env and ensure the database is running.\n');
    process.exit(2);
  }

  // =========================================================================
  // SECTION 1: Database Connectivity & Table Existence
  // =========================================================================
  section('Section 1: Database Connectivity & Table Existence');

  report(true, 'PostgreSQL connection established');

  for (const { table } of RAW_TABLE_CATALOG) {
    const { rows } = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [table]
    );
    report(rows[0].exists, `Table "${table}" exists`);
  }

  sectionEnd();

  // =========================================================================
  // SECTIONS 2-11: Per-Table Raw Payload Encryption Verification
  // =========================================================================
  const tableResults = {};

  for (let i = 0; i < RAW_TABLE_CATALOG.length; i++) {
    const { table, rawColumn, naturalIdExpr } = RAW_TABLE_CATALOG[i];
    const sectionNum = i + 2;
    section(`Section ${sectionNum}: ${table} — ${rawColumn}`);

    // Check if column exists
    const colCheck = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
       ) AS exists`,
      [table, rawColumn]
    );

    if (!colCheck.rows[0].exists) {
      skip(`Column "${rawColumn}" does not exist in "${table}" — table may use structured columns only`);
      tableResults[table] = { total: 0, encrypted: 0, plaintext: 0, empty: 0, skipped: true };
      sectionEnd();
      continue;
    }

    // Count total rows
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM ${table}`);
    const totalRows = countResult.rows[0].total;

    if (totalRows === 0) {
      report(true, `Table "${table}" has 0 rows — no plaintext exposure possible`);
      tableResults[table] = { total: 0, encrypted: 0, plaintext: 0, empty: 0 };
      sectionEnd();
      continue;
    }

    report(true, `Table "${table}" has ${totalRows} rows — scanning raw column`);

    // Count rows where raw column is NULL or empty
    const emptyResult = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM ${table}
       WHERE ${rawColumn} IS NULL OR ${rawColumn}::text IN ('{}', '[]', 'null', '')`
    );
    const emptyRows = emptyResult.rows[0].cnt;

    // Count rows where is_encrypted = true (if column exists)
    const encFlagCheck = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'is_encrypted'
       ) AS exists`,
      [table]
    );

    let encryptedByFlag = 0;
    if (encFlagCheck.rows[0].exists) {
      const encFlagResult = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM ${table} WHERE is_encrypted = true`
      );
      encryptedByFlag = encFlagResult.rows[0].cnt;
    }

    // Sample up to 100 non-empty rows to inspect raw payloads directly
    const sampleResult = await pool.query(
      `SELECT ${rawColumn} AS raw_val, ${naturalIdExpr} AS record_id
       FROM ${table}
       WHERE ${rawColumn} IS NOT NULL
         AND ${rawColumn}::text NOT IN ('{}', '[]', 'null', '')
       LIMIT 100`
    );

    let encryptedCount = 0;
    let plaintextCount = 0;
    const plaintextSamples = [];

    for (const row of sampleResult.rows) {
      if (looksEncrypted(row.raw_val)) {
        encryptedCount++;
      } else {
        plaintextCount++;
        if (plaintextSamples.length < 3) {
          plaintextSamples.push(row.record_id);
        }
      }
    }

    const nonEmptyRows = totalRows - emptyRows;
    tableResults[table] = {
      total: totalRows,
      encrypted: encryptedByFlag,
      plaintext: plaintextCount,
      empty: emptyRows,
      sampleSize: sampleResult.rows.length,
      nonEmpty: nonEmptyRows,
    };

    if (nonEmptyRows === 0) {
      report(true, `All ${totalRows} rows have NULL or empty "${rawColumn}" — no plaintext exposure`);
    } else if (plaintextCount === 0) {
      report(true, `All ${sampleResult.rows.length} sampled non-empty rows are encrypted containers`);
    } else {
      report(false, `Found ${plaintextCount} plaintext rows out of ${sampleResult.rows.length} sampled`, {
        plaintextSamples,
        note: 'These rows contain unencrypted raw payloads',
      });
    }

    // Cross-check: encrypted flag consistency
    if (encFlagCheck.rows[0].exists && encryptedByFlag > 0) {
      report(encryptedByFlag >= encryptedCount,
        `is_encrypted flag (${encryptedByFlag}) consistent with payload inspection (${encryptedCount} encrypted in sample)`);
    }

    sectionEnd();
  }

  // =========================================================================
  // SECTION 12: Sentinel Value Sweep
  // =========================================================================
  section('Section 12: Sentinel Value Sweep — No Known PII Patterns in Raw Columns');

  let sentinelHits = 0;

  for (const { table, rawColumn } of RAW_TABLE_CATALOG) {
    // Check column exists first
    const colCheck = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
       ) AS exists`,
      [table, rawColumn]
    );
    if (!colCheck.rows[0].exists) continue;

    // Sample non-empty, non-encrypted rows and search for sentinel patterns
    const sampleRows = await pool.query(
      `SELECT ${rawColumn}::text AS raw_text
       FROM ${table}
       WHERE ${rawColumn} IS NOT NULL
         AND ${rawColumn}::text NOT IN ('{}', '[]', 'null', '')
       LIMIT 50`
    );

    for (const row of sampleRows.rows) {
      if (containsPlaintextSensitive(row.raw_text)) {
        sentinelHits++;
        if (sentinelHits <= 3) {
          report(false, `Sentinel PII pattern found in "${table}.${rawColumn}"`, {
            snippet: row.raw_text.slice(0, 200) + '...',
          });
        }
      }
    }
  }

  if (sentinelHits === 0) {
    report(true, 'No sentinel PII patterns found in any raw column across all tables');
  } else if (sentinelHits > 3) {
    report(false, `${sentinelHits} total sentinel PII hits across all tables (first 3 shown above)`);
  }

  sectionEnd();

  // =========================================================================
  // SECTION 13: Encryption Tracking Column Consistency
  // =========================================================================
  section('Section 13: Encryption Tracking Column Consistency');

  for (const { table, rawColumn } of RAW_TABLE_CATALOG) {
    // Check if tracking columns exist
    const trackingCheck = await pool.query(
      `SELECT
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'is_encrypted') AS has_flag,
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'encryption_key_id') AS has_key_id,
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'encrypted_at') AS has_enc_at,
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'encryption_format_version') AS has_fmt_ver`,
      [table]
    );

    const tr = trackingCheck.rows[0];

    if (!tr.has_flag) {
      skip(`"${table}" has no encryption tracking columns — may be pre-migration`);
      continue;
    }

    report(tr.has_flag && tr.has_key_id && tr.has_enc_at && tr.has_fmt_ver,
      `"${table}" has all 4 encryption tracking columns`);

    // Check for inconsistencies: is_encrypted=true but no key_id
    const inconsistent1 = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM ${table}
       WHERE is_encrypted = true AND (encryption_key_id IS NULL OR encryption_key_id = '')`
    );
    report(inconsistent1.rows[0].cnt === 0,
      `"${table}" — no rows with is_encrypted=true but missing encryption_key_id`,
      inconsistent1.rows[0].cnt > 0 ? { count: inconsistent1.rows[0].cnt } : undefined);

    // Check for inconsistencies: is_encrypted=true but no encrypted_at
    const inconsistent2 = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM ${table}
       WHERE is_encrypted = true AND encrypted_at IS NULL`
    );
    report(inconsistent2.rows[0].cnt === 0,
      `"${table}" — no rows with is_encrypted=true but missing encrypted_at`,
      inconsistent2.rows[0].cnt > 0 ? { count: inconsistent2.rows[0].cnt } : undefined);

    // Check for inconsistencies: is_encrypted=false but has encryption_key_id
    const inconsistent3 = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM ${table}
       WHERE is_encrypted = false AND encryption_key_id IS NOT NULL AND encryption_key_id != ''`
    );
    report(inconsistent3.rows[0].cnt === 0,
      `"${table}" — no rows with is_encrypted=false but non-null encryption_key_id`,
      inconsistent3.rows[0].cnt > 0 ? { count: inconsistent3.rows[0].cnt } : undefined);
  }

  sectionEnd();

  // =========================================================================
  // SECTION 14: Approved Queryable Metadata Fields — Classification Justification
  // =========================================================================
  section('Section 14: Approved Queryable Metadata — Classification Check');

  // Load the data classification matrix from the built backend
  let classificationMatrix = null;
  try {
    const distPath = path.join(__dirname, '..', 'dist', 'security', 'dataClassification.js');
    const fs = require('fs');
    if (fs.existsSync(distPath)) {
      const dcModule = require(distPath);
      classificationMatrix = dcModule.ORACLE_DATA_CLASSIFICATION_MATRIX;
    }
  } catch (e) {
    console.warn(`  WARN: Could not load dataClassification from dist: ${e.message}`);
  }

  if (classificationMatrix) {
    let approvedCleartext = 0;
    let unapprovedCleartext = 0;

    for (const [tableName, classification] of Object.entries(classificationMatrix)) {
      for (const [colName, colDef] of Object.entries(classification.columns)) {
        if (colDef.requiresEncryption === false && colDef.isQueryableMetadata === true) {
          approvedCleartext++;
        } else if (colDef.requiresEncryption === true && colDef.isQueryableMetadata === true) {
          // A column that requires encryption but is also queryable metadata is a conflict
          unapprovedCleartext++;
          report(false, `Classification conflict: "${tableName}.${colName}" is both requiresEncryption AND isQueryableMetadata`);
        }
      }

      // Verify the raw JSON column is marked as requiresEncryption
      if (classification.rawJsonColumn) {
        const rawColDef = classification.columns[classification.rawJsonColumn];
        if (rawColDef) {
          report(rawColDef.requiresEncryption === true,
            `"${tableName}.${classification.rawJsonColumn}" is classified as requiresEncryption`);
          report(rawColDef.isQueryableMetadata === false,
            `"${tableName}.${classification.rawJsonColumn}" is NOT classified as queryable metadata`);
        }
      }
    }

    report(approvedCleartext > 0,
      `${approvedCleartext} columns are approved queryable metadata (cleartext with justification)`);
    report(unapprovedCleartext === 0,
      `No classification conflicts found (requiresEncryption + isQueryableMetadata)`);
  } else {
    skip('Data classification matrix not available in dist — build backend first');
  }

  sectionEnd();

  // =========================================================================
  // SECTION 15: Encryption Migration Ledger — No Stale PENDING Batches
  // =========================================================================
  section('Section 15: Encryption Migration Ledger Status');

  const ledgerExists = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'oracle_encryption_migration_ledger'
     ) AS exists`
  );

  if (!ledgerExists.rows[0].exists) {
    skip('Migration ledger table does not exist — VYR-031 migration may not have run yet');
  } else {
    // Check for PENDING or IN_PROGRESS migrations that should have completed
    const stalePending = await pool.query(
      `SELECT table_name, environment_host, status, plaintext_records, started_at
       FROM oracle_encryption_migration_ledger
       WHERE status IN ('PENDING', 'IN_PROGRESS')
       ORDER BY started_at ASC`
    );

    if (stalePending.rows.length === 0) {
      report(true, 'No PENDING or IN_PROGRESS migration batches in ledger');
    } else {
      for (const row of stalePending.rows) {
        report(false, `Stale migration: "${row.table_name}" for ${row.environment_host} is ${row.status}`, {
          plaintextRecords: row.plaintext_records,
          startedAt: row.started_at,
        });
      }
    }

    // Check completed migrations
    const completed = await pool.query(
      `SELECT table_name, environment_host, total_records, encrypted_records, plaintext_records
       FROM oracle_encryption_migration_ledger
       WHERE status = 'COMPLETED'`
    );

    for (const row of completed.rows) {
      report(row.plaintext_records === 0,
        `Ledger "${row.table_name}" (${row.environment_host}): ${row.encrypted_records}/${row.total_records} encrypted, ${row.plaintext_records} plaintext remaining`,
        row.plaintext_records > 0 ? { plaintext: row.plaintext_records } : undefined);
    }

    if (completed.rows.length === 0 && stalePending.rows.length === 0) {
      skip('Migration ledger is empty — no migration batches have been executed');
    }
  }

  sectionEnd();

  // =========================================================================
  // SUMMARY
  // =========================================================================
  await pool.end();

  console.log('\n================================================================');
  console.log('  VYR-059 RESULTS SUMMARY');
  console.log('================================================================');

  // Per-table summary
  console.log('\n  TABLE SCAN SUMMARY:');
  for (const { table, rawColumn } of RAW_TABLE_CATALOG) {
    const r = tableResults[table];
    if (!r) continue;
    if (r.skipped) {
      console.log(`    ${table}.${rawColumn}: SKIPPED (column absent)`);
    } else if (r.total === 0) {
      console.log(`    ${table}.${rawColumn}: EMPTY (0 rows)`);
    } else {
      const status = r.plaintext === 0 ? 'PASS' : 'FAIL';
      console.log(`    [${status}] ${table}.${rawColumn}: ${r.total} rows, ${r.encrypted} encrypted, ${r.empty} empty/null, ${r.plaintext} plaintext in sample`);
    }
  }

  console.log('\n  SECTION RESULTS:');
  for (const s of sections) {
    const status = s.failed === 0 ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${s.name}: ${s.passed} passed, ${s.failed} failed`);
  }
  console.log('----------------------------------------------------------------');
  console.log(`  TOTAL: ${passed} passed, ${failed} failed, ${skipped} skipped out of ${passed + failed + skipped} assertions`);
  console.log('================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error in VYR-059 test suite:', err);
  process.exit(2);
});
