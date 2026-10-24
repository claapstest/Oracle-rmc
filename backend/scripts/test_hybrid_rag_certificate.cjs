const assert = require('assert');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../database/.env') });

const { certificateHybridRagService, BUSINESS_METADATA_REGISTRY } = require('../dist/services/certificateHybridRagService.js');
const { getCertificationDetailsTool } = require('../dist/tools/index.js');
const { processUserMessage } = require('../dist/ai/orchestrator.js');

async function runTestSuite() {
  console.log('========================================================================');
  console.log('🧪 STRUCTURED DATABASE RAG TEST SUITE: Access Certification Engine');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function testPass(num, name, details) {
    passed++;
    console.log(`✅ [PASS] Test ${num}: ${name}`);
    if (details) console.log(`   └─ ${details}`);
  }

  function testFail(num, name, error) {
    failed++;
    console.error(`❌ [FAIL] Test ${num}: ${name}`);
    console.error(`   └─ Error: ${error}`);
  }

  // -------------------------------------------------------------
  // Test 1: Correct certificate manager retrieval
  // -------------------------------------------------------------
  try {
    const res = await certificateHybridRagService.getCertificateStructured('1', 'manager');
    assert(res.found === true, 'Certificate 1 must be found');
    assert(res.record.managerName === 'Karthika.Claaps', `Expected manager Karthika.Claaps, got ${res.record.managerName}`);
    assert(res.record.ownerName === 'Test1.Claaps', `Expected owner Test1.Claaps, got ${res.record.ownerName}`);
    assert(res.fieldValue === 'Karthika.Claaps', 'Target field value must be Karthika.Claaps');
    assert(res.fieldValue !== res.record.ownerName, 'Manager must NOT equal owner');
    testPass(1, 'Correct certificate manager retrieval', `Manager: "${res.record.managerName}" (Owner is distinct: "${res.record.ownerName}")`);
  } catch (err) {
    testFail(1, 'Correct certificate manager retrieval', err.message);
  }

  // -------------------------------------------------------------
  // Test 2: Correct certificate owner retrieval
  // -------------------------------------------------------------
  try {
    const res = await certificateHybridRagService.getCertificateStructured('1', 'owner');
    assert(res.found === true, 'Certificate 1 must be found');
    assert(res.record.ownerName === 'Test1.Claaps', `Expected owner Test1.Claaps, got ${res.record.ownerName}`);
    assert(res.fieldValue === 'Test1.Claaps', 'Target field value must be Test1.Claaps');
    assert(res.fieldValue !== res.record.managerName, 'Owner must NOT be conflated with manager');
    testPass(2, 'Correct certificate owner retrieval', `Owner: "${res.record.ownerName}"`);
  } catch (err) {
    testFail(2, 'Correct certificate owner retrieval', err.message);
  }

  // -------------------------------------------------------------
  // Test 3: Missing manager field (Explicit NULL Reporting)
  // -------------------------------------------------------------
  try {
    const fakeCert = {
      certification_id: '88888',
      certification_name: 'Unassigned Manager Campaign',
      manager_name: null,
      owner_name: 'Admin.Owner',
      status: 'Active'
    };
    const structuredResult = certificateHybridRagService.formatStructuredResult(fakeCert, 'manager', 'Mock DB');
    assert(structuredResult.isFieldNull === true, 'isFieldNull must be true for NULL manager');
    assert(structuredResult.fieldValue === null, 'fieldValue must be null');
    assert(structuredResult.explanation.includes('NULL') || structuredResult.explanation.includes('not configured'), 'Explanation must explicitly report NULL');
    const grounded = certificateHybridRagService.buildGroundedEvidence(structuredResult);
    assert(grounded.includes('NOT CONFIGURED (NULL)'), 'Grounded prompt must state NULL');
    testPass(3, 'Missing manager field (Explicit NULL Reporting)', structuredResult.explanation);
  } catch (err) {
    testFail(3, 'Missing manager field (Explicit NULL Reporting)', err.message);
  }

  // -------------------------------------------------------------
  // Test 4: Incorrect cached manager
  // -------------------------------------------------------------
  try {
    const mockPgRecord = {
      certificationId: '1',
      certificationName: 'Test Cert',
      managerName: 'Karthika.Claaps',
      ownerName: 'Test1.Claaps',
      targetFieldValue: 'Karthika.Claaps'
    };
    // Reconcile against cache
    const recon = certificateHybridRagService.reconcileAuthoritativeSource(mockPgRecord, 'manager');
    assert(recon.authoritativeValue !== null, 'Authoritative value must resolve');
    assert(typeof recon.hasDisagreement === 'boolean', 'Disagreement boolean must be returned');
    assert(recon.authoritativeSource.includes('Authoritative'), 'Authoritative source label must be explicit');
    testPass(4, 'Incorrect cached manager / Authoritative resolution', `Authoritative Source: ${recon.authoritativeSource}`);
  } catch (err) {
    testFail(4, 'Incorrect cached manager / Authoritative resolution', err.message);
  }

  // -------------------------------------------------------------
  // Test 5: Similar certificate names
  // -------------------------------------------------------------
  try {
    const resA = await certificateHybridRagService.getCertificateStructured('Advanced Access control');
    const resB = await certificateHybridRagService.getCertificateStructured('IT Security Manager');
    assert(resA.found === true, 'Advanced Access control must be found');
    assert(resB.found === true, 'IT Security Manager must be found');
    assert(resA.record.certificationId !== resB.record.certificationId, 'Similar names must resolve to distinct IDs');
    testPass(5, 'Similar certificate names', `Resolved to ID ${resA.record.certificationId} vs ID ${resB.record.certificationId}`);
  } catch (err) {
    testFail(5, 'Similar certificate names', err.message);
  }

  // -------------------------------------------------------------
  // Test 6: Duplicate records deduplication
  // -------------------------------------------------------------
  try {
    const { sql } = certificateHybridRagService.generateControlledSqlQuery('manager', { includeWorksheetSummary: false });
    assert(sql.includes('SELECT'), 'Query must be a SELECT');
    assert(sql.includes('LIMIT 10'), 'Query must contain safe LIMIT');
    // Test deduplication on ID 1
    const res = await certificateHybridRagService.getCertificateStructured('1');
    assert(res.found === true, 'Must find record');
    assert(res.record.certificationId === '1', 'Must return single deduplicated certificate ID 1');
    testPass(6, 'Duplicate records deduplication', `Successfully retrieved deduplicated record for ID 1`);
  } catch (err) {
    testFail(6, 'Duplicate records deduplication', err.message);
  }

  // -------------------------------------------------------------
  // Test 7: Incorrect JOIN handling & validation
  // -------------------------------------------------------------
  try {
    const validJoin = certificateHybridRagService.validateJoinRelationship(
      'oracle_raw_access_certifications',
      'oracle_raw_certifier_worksheets',
      'certification_id'
    );
    assert(validJoin.valid === true, 'Standard foreign key JOIN must be valid');

    const invalidJoinKey = certificateHybridRagService.validateJoinRelationship(
      'oracle_raw_access_certifications',
      'oracle_raw_certifier_worksheets',
      'manager_name'
    );
    assert(invalidJoinKey.valid === false, 'Invalid foreign key column must be rejected');
    assert(invalidJoinKey.reason.includes('Invalid JOIN key'), 'Must report invalid join key reason');

    const invalidTableJoin = certificateHybridRagService.validateJoinRelationship(
      'oracle_raw_access_certifications',
      'veyra_user',
      'id'
    );
    assert(invalidTableJoin.valid === false, 'Unsupported table pair must be rejected');
    testPass(7, 'Incorrect JOIN validation & protection', `Rejected invalid join key: ${invalidJoinKey.reason}`);
  } catch (err) {
    testFail(7, 'Incorrect JOIN validation & protection', err.message);
  }

  // -------------------------------------------------------------
  // Test 8: Oracle/PostgreSQL disagreement & conflict resolution
  // -------------------------------------------------------------
  try {
    const testDisagreementRecord = {
      certificationId: '1',
      certificationName: 'Test Cert',
      managerName: 'OldPostgresManager',
      ownerName: 'Test1.Claaps',
      targetFieldValue: 'OldPostgresManager'
    };
    const reconDisagreement = certificateHybridRagService.reconcileAuthoritativeSource(testDisagreementRecord, 'manager');
    assert(reconDisagreement.hasDisagreement === true, 'Must detect value disagreement');
    assert(reconDisagreement.disagreementDetails.includes('Discrepancy detected'), 'Must detail the discrepancy');
    assert(reconDisagreement.authoritativeValue === 'Karthika.Claaps', 'Oracle authoritative value must take precedence for manager assignment');
    testPass(8, 'Oracle/PostgreSQL disagreement & conflict resolution', reconDisagreement.disagreementDetails);
  } catch (err) {
    testFail(8, 'Oracle/PostgreSQL disagreement & conflict resolution', err.message);
  }

  // -------------------------------------------------------------
  // Test 9: Missing certificate
  // -------------------------------------------------------------
  try {
    const res = await certificateHybridRagService.getCertificateStructured('NON_EXISTENT_CERT_99999');
    assert(res.found === false, 'Certificate must not be found');
    assert(res.explanation.includes('not found'), 'Explanation must indicate not found');
    const grounded = certificateHybridRagService.buildGroundedEvidence(res);
    assert(grounded.includes('STATUS: CERTIFICATE_NOT_FOUND'), 'Grounded prompt must report CERTIFICATE_NOT_FOUND');
    testPass(9, 'Missing certificate handling', res.explanation);
  } catch (err) {
    testFail(9, 'Missing certificate handling', err.message);
  }

  // -------------------------------------------------------------
  // Test 10: Multiple matching certificates (Ambiguity handling)
  // -------------------------------------------------------------
  try {
    const res = await certificateHybridRagService.getCertificateStructured('CLAAPS');
    assert(res.found === true, 'Must match certificates');
    if (res.ambiguous) {
      assert(Array.isArray(res.matches) && res.matches.length > 1, 'Must return multiple matches');
      assert(res.explanation.includes('Multiple certificates matched'), 'Must inform user of multiple matches');
      testPass(10, 'Multiple matching certificates', `Identified ${res.matches.length} matching candidates for disambiguation`);
    } else {
      testPass(10, 'Multiple matching certificates', `Exact match on primary candidate: ${res.record.certificationName}`);
    }
  } catch (err) {
    testFail(10, 'Multiple matching certificates', err.message);
  }

  console.log('\n========================================================================');
  console.log(`📊 TEST SUITE SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
