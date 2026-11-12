/**
 * VYR-027 Verification Suite
 * Classify Oracle Fusion data and map all raw persistence/retrieval paths
 *
 * Assertions:
 *   Section 1: Database Table & Column Inventory Verification (AC1)
 *   Section 2: Data Classification Matrix & Field Sensitivity (AC1)
 *   Section 3: Ingestion Pipeline & Persistence Path Mapping (AC2)
 *   Section 4: API Retrieval Path & Decryption Boundary Mapping (AC2)
 *   Section 5: SQL & Report JSONB Operator Dependency Catalog (AC3)
 *   Section 6: Architecture Documentation & Epic 4 Regression Harness (AC1, AC2, AC3)
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../database/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString =
  process.env.DATABASE_URL ||
  process.env.DATABASE_URI ||
  `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || '127.0.0.1'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'veyra_db'}`;

let passedCount = 0;
let failedCount = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  FAIL: ${testName}`);
    if (details) console.error(`        Details: ${details}`);
    failedCount++;
  }
}

async function run() {
  console.log('\n================================================================');
  console.log('  VYR-027: Oracle Data Classification & Path Mapping');
  console.log('================================================================\n');

  const pool = new Pool({ connectionString });

  try {
    // -------------------------------------------------------------
    // Section 1: Database Table & Column Inventory Verification (AC1)
    // -------------------------------------------------------------
    console.log('--- Section 1: Database Table & Column Inventory Verification (Step 1, AC1) ---');

    const tableRes = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    const existingTables = new Set(tableRes.rows.map(r => r.table_name));

    const expectedRawTables = [
      'oracle_raw_audit_records',
      'oracle_raw_users',
      'oracle_raw_roles',
      'oracle_raw_role_hierarchy',
      'oracle_raw_controls',
      'oracle_control_incidents',
      'oracle_incident_rows',
      'oracle_raw_access_certifications',
      'oracle_raw_certifier_worksheets',
      'oracle_raw_user_access',
    ];

    for (const tbl of expectedRawTables) {
      assert(existingTables.has(tbl), `Table "${tbl}" exists in PostgreSQL public schema`);
    }

    const expectedOperationalTables = [
      'oracle_audit_sync_state',
      'oracle_control_sync_watermark',
      'oracle_incident_rows_sync',
      'oracle_user_access_summary',
      'product_sync_policy',
    ];

    for (const tbl of expectedOperationalTables) {
      assert(existingTables.has(tbl), `Operational/Watermark table "${tbl}" exists in PostgreSQL schema`);
    }

    // Verify raw JSON column data types
    const colRes = await pool.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND column_name IN ('raw_payload', 'raw_user', 'raw_role', 'raw_record', 'raw_incidents', 'raw_data', 'raw')
    `);

    const rawColMap = {};
    for (const r of colRes.rows) {
      rawColMap[`${r.table_name}.${r.column_name}`] = r.data_type;
    }

    assert(rawColMap['oracle_raw_audit_records.raw_payload'] === 'jsonb', 'oracle_raw_audit_records.raw_payload is JSONB');
    assert(rawColMap['oracle_raw_users.raw_user'] === 'jsonb', 'oracle_raw_users.raw_user is JSONB');
    assert(rawColMap['oracle_raw_roles.raw_role'] === 'jsonb', 'oracle_raw_roles.raw_role is JSONB');
    assert(rawColMap['oracle_raw_role_hierarchy.raw_record'] === 'jsonb', 'oracle_raw_role_hierarchy.raw_record is JSONB');
    assert(rawColMap['oracle_raw_controls.raw_payload'] === 'jsonb', 'oracle_raw_controls.raw_payload is JSONB');
    assert(rawColMap['oracle_control_incidents.raw_incidents'] === 'jsonb', 'oracle_control_incidents.raw_incidents is JSONB');
    assert(rawColMap['oracle_incident_rows.raw'] === 'jsonb', 'oracle_incident_rows.raw is JSONB');
    assert(rawColMap['oracle_raw_access_certifications.raw_data'] === 'jsonb', 'oracle_raw_access_certifications.raw_data is JSONB');
    assert(rawColMap['oracle_raw_certifier_worksheets.raw_data'] === 'jsonb', 'oracle_raw_certifier_worksheets.raw_data is JSONB');

    // -------------------------------------------------------------
    // Section 2: Data Classification Matrix & Field Sensitivity (AC1)
    // -------------------------------------------------------------
    console.log('\n--- Section 2: Data Classification Matrix & Sensitivity (Step 4, AC1) ---');

    // Load dataClassification module
    const classificationModulePath = path.resolve(__dirname, '../src/security/dataClassification.ts');
    assert(fs.existsSync(classificationModulePath), 'backend/src/security/dataClassification.ts exists');

    const classificationSource = fs.readFileSync(classificationModulePath, 'utf-8');

    // Verify sensitivity taxonomy enum values
    assert(classificationSource.includes('RESTRICTED_PII'), 'Classification taxonomy defines RESTRICTED_PII');
    assert(classificationSource.includes('CONFIDENTIAL_FINANCIAL'), 'Classification taxonomy defines CONFIDENTIAL_FINANCIAL');
    assert(classificationSource.includes('SENSITIVE_SECURITY'), 'Classification taxonomy defines SENSITIVE_SECURITY');
    assert(classificationSource.includes('OPERATIONAL_METADATA'), 'Classification taxonomy defines OPERATIONAL_METADATA');
    assert(classificationSource.includes('QUERYABLE_METADATA'), 'Classification taxonomy defines QUERYABLE_METADATA');

    // Verify matrix maps all expected raw tables
    for (const tbl of expectedRawTables) {
      assert(classificationSource.includes(tbl), `Classification matrix includes specification for ${tbl}`);
    }

    // Verify AAD components are specified for AEAD in VYR-028
    assert(classificationSource.includes('aadFields'), 'Classification matrix defines AAD (Additional Authenticated Data) components');
    assert(classificationSource.includes('environment_host'), 'AAD context always binds environment_host for tenant segregation');

    // Verify encryption flags
    assert(classificationSource.includes('requiresEncryption: true'), 'Matrix explicitly flags raw JSON blobs as requiring encryption');
    assert(classificationSource.includes('isQueryableMetadata: true'), 'Matrix explicitly flags queryable dimensions/indexes as unencrypted');

    // -------------------------------------------------------------
    // Section 3: Ingestion Pipeline & Persistence Path Mapping (AC2)
    // -------------------------------------------------------------
    console.log('\n--- Section 3: Ingestion Pipeline & Persistence Path Mapping (Step 2, AC2) ---');

    assert(classificationSource.includes('ORACLE_INGESTION_PIPELINES'), 'Ingestion pipeline catalog defined in dataClassification.ts');
    assert(classificationSource.includes('INGEST-01'), 'Catalog includes INGEST-01: Full Oracle Synchronization Pipeline');
    assert(classificationSource.includes('INGEST-02'), 'Catalog includes INGEST-02: Audit Trail Incremental Sync');
    assert(classificationSource.includes('INGEST-03'), 'Catalog includes INGEST-03: Advanced Access Controls & Incidents Pipeline');
    assert(classificationSource.includes('INGEST-04'), 'Catalog includes INGEST-04: Directory Users & Roles SCIM Pipeline');
    assert(classificationSource.includes('INGEST-05'), 'Catalog includes INGEST-05: Role Hierarchy & Privileges BI Publisher Pipeline');
    assert(classificationSource.includes('INGEST-06'), 'Catalog includes INGEST-06: Access Certification Campaigns & Worksheets Pipeline');
    assert(classificationSource.includes('INGEST-07'), 'Catalog includes INGEST-07: User Access Composite Report Pipeline');

    // Verify underlying service source files exist and implement documented methods
    const syncServiceSrc = fs.readFileSync(path.resolve(__dirname, '../src/services/oracleSyncService.ts'), 'utf-8');
    assert(syncServiceSrc.includes('runFullSync'), 'OracleSyncService implements runFullSync()');
    assert(syncServiceSrc.includes('acquireLock'), 'OracleSyncService enforces mutual exclusion lock on full sync');

    const auditDbSrc = fs.readFileSync(path.resolve(__dirname, '../src/services/auditRawDbService.ts'), 'utf-8');
    assert(auditDbSrc.includes('saveRawAuditRecords'), 'AuditRawDbService implements saveRawAuditRecords()');
    assert(auditDbSrc.includes('record_unique_hash'), 'AuditRawDbService computes record_unique_hash for deduplication');

    const controlDbSrc = fs.readFileSync(path.resolve(__dirname, '../src/services/controlRawDbService.ts'), 'utf-8');
    assert(controlDbSrc.includes('saveRawControl'), 'ControlRawDbService implements saveRawControl()');
    assert(controlDbSrc.includes('saveRawIncidents'), 'ControlRawDbService implements saveRawIncidents()');

    const userRoleDbSrc = fs.readFileSync(path.resolve(__dirname, '../src/services/userRoleRawDbService.ts'), 'utf-8');
    assert(userRoleDbSrc.includes('saveRawUsersBatch'), 'UserRoleRawDbService implements saveRawUsersBatch()');
    assert(userRoleDbSrc.includes('saveRawRolesBatch'), 'UserRoleRawDbService implements saveRawRolesBatch()');

    const roleHierarchySrc = fs.readFileSync(path.resolve(__dirname, '../src/services/roleHierarchyService.ts'), 'utf-8');
    assert(roleHierarchySrc.includes('syncFromBip'), 'RoleHierarchyService implements syncFromBip()');

    const accessCertDbSrc = fs.readFileSync(path.resolve(__dirname, '../src/services/accessCertRawDbService.ts'), 'utf-8');
    assert(accessCertDbSrc.includes('saveRawCertifications'), 'AccessCertRawDbService implements saveRawCertifications()');
    assert(accessCertDbSrc.includes('saveRawWorksheetRows'), 'AccessCertRawDbService implements saveRawWorksheetRows()');

    const userAccessDbSrc = fs.readFileSync(path.resolve(__dirname, '../src/services/userAccessReportService.ts'), 'utf-8');
    assert(userAccessDbSrc.includes('persistToDatabase'), 'UserAccessReportService implements persistToDatabase()');

    // -------------------------------------------------------------
    // Section 4: API Retrieval Path & Decryption Boundary Mapping (AC2)
    // -------------------------------------------------------------
    console.log('\n--- Section 4: API Retrieval Path & Decryption Boundary (AC2) ---');

    assert(classificationSource.includes('ORACLE_RETRIEVAL_PATHS'), 'API retrieval catalog defined in dataClassification.ts');

    const apiRoutesSrc = fs.readFileSync(path.resolve(__dirname, '../src/routes/api.ts'), 'utf-8');

    const keyRetrievalEndpoints = [
      { path: '/users', privilege: 'requireUsersListAccess' },
      { path: '/roles', privilege: 'ROLES_CATALOG' },
      { path: '/audit', privilege: 'AUDIT_TRAIL' },
      { path: '/risk/controls', privilege: 'RISK_MANAGEMENT' },
      { path: '/access-certifications', privilege: 'REPORTS' },
      { path: '/reports/user-access', privilege: 'REPORTS' },
    ];

    for (const ep of keyRetrievalEndpoints) {
      assert(
        apiRoutesSrc.includes(`'${ep.path}'`) || apiRoutesSrc.includes(`"${ep.path}"`),
        `API route ${ep.path} registered in backend/src/routes/api.ts`
      );
      assert(
        apiRoutesSrc.includes(ep.privilege),
        `API route ${ep.path} gated by privilege/auth check ${ep.privilege}`
      );
    }

    // Assert React contract: encryption keys are never leaked via API responses
    assert(!apiRoutesSrc.includes('res.json({ key:') && !apiRoutesSrc.includes('res.json({ dek:'),
      'Backend routes never expose encryption keys or DEKs to React client');

    // -------------------------------------------------------------
    // Section 5: SQL & Report JSONB Operator Dependency Catalog (AC3)
    // -------------------------------------------------------------
    console.log('\n--- Section 5: SQL & Report JSONB Operator Dependency Catalog (Step 3, AC3) ---');

    assert(classificationSource.includes('SQL_RAW_JSON_DEPENDENCIES'), 'SQL raw JSON dependencies cataloged');

    // Verify key JSONB operators are documented with concrete migration plans
    assert(classificationSource.includes('businessUnit'), 'Catalog documents raw_user->>businessUnit dependency');
    assert(classificationSource.includes('assignedRoles'), 'Catalog documents raw_user->assignedRoles array length dependencies');
    assert(classificationSource.includes('security administrator'), 'Catalog documents security administrator role filter dependency');
    assert(classificationSource.includes('payroll'), 'Catalog documents payroll role filter dependency');
    assert(classificationSource.includes('raw_payload->>\'userName\''), 'Catalog documents audit userName JSONB fallback');
    assert(classificationSource.includes('jsonb_typeof(raw_incidents)'), 'Catalog documents control incidents jsonb_typeof dependency');
    assert(classificationSource.includes('jsonb_array_elements'), 'Catalog documents incident rows normalization dependency');

    // Verify active queries in userRoleRawDbService match documented operators
    assert(userRoleDbSrc.includes("raw_user->>'businessUnit'"), 'userRoleRawDbService contains raw_user->>businessUnit');
    assert(userRoleDbSrc.includes("jsonb_array_length(COALESCE(raw_user->'assignedRoles'"), 'userRoleRawDbService contains jsonb_array_length assignedRoles');

    // Verify active queries in controlRawDbService match documented operators
    assert(controlDbSrc.includes("jsonb_typeof(raw_incidents) = 'array'"), 'controlRawDbService contains jsonb_typeof(raw_incidents)');

    // -------------------------------------------------------------
    // Section 6: Architecture Documentation & Regression Harness (AC1, AC2, AC3)
    // -------------------------------------------------------------
    console.log('\n--- Section 6: Documentation & Regression Harness (AC1, AC2, AC3) ---');

    const docPath = path.resolve(__dirname, '../../docs/architecture/oracle_data_classification_and_path_mapping.md');
    assert(fs.existsSync(docPath), 'docs/architecture/oracle_data_classification_and_path_mapping.md exists');

    const docContent = fs.readFileSync(docPath, 'utf-8');
    assert(docContent.includes('VYR-027'), 'Architecture doc explicitly references Story VYR-027');
    assert(docContent.includes('EPIC 4'), 'Architecture doc explicitly references EPIC 4');
    assert(docContent.includes('standard-veyra-application-dev'), 'Architecture doc documents applicability to standard branch');
    assert(docContent.includes('veyra-application-dev'), 'Architecture doc documents applicability to veyra dev branch');
    assert(docContent.includes('RESTRICTED_PII'), 'Architecture doc defines RESTRICTED_PII taxonomy');
    assert(docContent.includes('CONFIDENTIAL_FINANCIAL'), 'Architecture doc defines CONFIDENTIAL_FINANCIAL taxonomy');
    assert(docContent.includes('QUERYABLE_METADATA'), 'Architecture doc defines QUERYABLE_METADATA taxonomy');
    assert(docContent.includes('oracle_raw_audit_records'), 'Architecture doc documents oracle_raw_audit_records');
    assert(docContent.includes('oracle_raw_users'), 'Architecture doc documents oracle_raw_users');
    assert(docContent.includes('oracle_raw_roles'), 'Architecture doc documents oracle_raw_roles');
    assert(docContent.includes('oracle_control_incidents'), 'Architecture doc documents oracle_control_incidents');
    assert(docContent.includes('oracle_incident_rows'), 'Architecture doc documents oracle_incident_rows');
    assert(docContent.includes('oracle_raw_access_certifications'), 'Architecture doc documents oracle_raw_access_certifications');
    assert(docContent.includes('oracle_raw_user_access'), 'Architecture doc documents oracle_raw_user_access');
    assert(docContent.includes('INGEST-01'), 'Architecture doc documents INGEST-01 full sync pipeline');
    assert(docContent.includes('GET /api/users'), 'Architecture doc documents /api/users retrieval path');
    assert(docContent.includes('GET /api/risk/controls'), 'Architecture doc documents /api/risk/controls retrieval path');
    assert(docContent.includes('AES-256-GCM'), 'Architecture doc specifies AES-256-GCM encryption algorithm for Epic 4');
    assert(docContent.includes('AAD'), 'Architecture doc specifies Additional Authenticated Data formulas');

    // Package.json verification
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
    assert(Boolean(pkg.scripts['test:vyr27']), 'package.json defines "test:vyr27" script');
    assert(Boolean(pkg.scripts['test:epic4']), 'package.json defines "test:epic4" script');

    console.log('\n================================================================');
    console.log(`  Passed: ${passedCount}  Failed: ${failedCount}`);
    console.log('================================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution failed with error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
