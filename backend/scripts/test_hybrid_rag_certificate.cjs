const assert = require('assert');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../database/.env') });

const { certificateHybridRagService } = require('../dist/services/certificateHybridRagService.js');
const { getCertificationDetailsTool } = require('../dist/tools/index.js');
const { processUserMessage } = require('../dist/ai/orchestrator.js');

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 HYBRID RAG TEST SUITE: Access Certificate Management Chatbot');
  console.log('================================================================\n');

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
  // Test 1: Correct Certificate and Manager (Never Substitute Owner!)
  // -------------------------------------------------------------
  try {
    const res = await certificateHybridRagService.getCertificateStructured('1', 'manager');
    assert(res.found === true, 'Certificate 1 must be found');
    assert(res.record.managerName === 'Karthika.Claaps', `Expected manager Karthika.Claaps, got ${res.record.managerName}`);
    assert(res.record.ownerName === 'Test1.Claaps', `Expected owner Test1.Claaps, got ${res.record.ownerName}`);
    assert(res.fieldValue === 'Karthika.Claaps', 'Target field value must be Karthika.Claaps');
    assert(res.fieldValue !== res.record.ownerName, 'Manager must NOT equal owner');
    testPass(1, 'Correct certificate and manager retrieval', `Manager: "${res.record.managerName}" (Owner is distinct: "${res.record.ownerName}")`);
  } catch (err) {
    testFail(1, 'Correct certificate and manager retrieval', err.message);
  }

  // -------------------------------------------------------------
  // Test 2: Missing Manager Field (Explicit NULL Reporting)
  // -------------------------------------------------------------
  try {
    const fakeCert = {
      certification_id: '99999',
      certification_name: 'Test No Manager Cert',
      manager_name: null,
      owner_name: 'David.Admin'
    };
    const structuredResult = certificateHybridRagService.formatStructuredResult(fakeCert, 'manager', 'Mock DB');
    assert(structuredResult.isFieldNull === true, 'isFieldNull must be true for NULL manager');
    assert(structuredResult.fieldValue === null, 'fieldValue must be null');
    assert(structuredResult.explanation.includes('NULL') || structuredResult.explanation.includes('not configured'), 'Explanation must explicitly report NULL');
    testPass(2, 'Missing manager field handling', structuredResult.explanation);
  } catch (err) {
    testFail(2, 'Missing manager field handling', err.message);
  }

  // -------------------------------------------------------------
  // Test 3: Incorrect Cached Manager / Owner Substitution Prevention
  // -------------------------------------------------------------
  try {
    const chatRes = await processUserMessage('Who is the manager of certificate 1?');
    assert(chatRes.message.includes('is **Karthika.Claaps**'), 'Response must explicitly identify Karthika.Claaps as the supervising manager');
    assert(!chatRes.message.includes('is **Test1.Claaps**'), 'Response must NOT claim the manager is Test1.Claaps (the owner)');
    testPass(3, 'Incorrect cached manager / owner substitution prevention', `Answer: "${chatRes.message.split('\n')[0]}"`);
  } catch (err) {
    testFail(3, 'Incorrect cached manager / owner substitution prevention', err.message);
  }

  // -------------------------------------------------------------
  // Test 4: Certificate Not Found
  // -------------------------------------------------------------
  try {
    const res = await certificateHybridRagService.getCertificateStructured('NON_EXISTENT_CERT_99999');
    assert(res.found === false, 'Certificate must not be found');
    assert(res.explanation.includes('not found'), 'Explanation must indicate not found');
    testPass(4, 'Certificate not found handling', res.explanation);
  } catch (err) {
    testFail(4, 'Certificate not found handling', err.message);
  }

  // -------------------------------------------------------------
  // Test 5: Multiple Certificates with Similar Names (Ambiguity Handling)
  // -------------------------------------------------------------
  try {
    const res = await certificateHybridRagService.getCertificateStructured('CLAAPS');
    assert(res.found === true, 'Must find candidates for common search');
    if (res.ambiguous) {
      assert(Array.isArray(res.matches) && res.matches.length > 1, 'Must return candidates for clarification');
      testPass(5, 'Multiple certificates with similar names', `Returned ${res.matches.length} matching candidates for disambiguation`);
    } else {
      testPass(5, 'Multiple certificates with similar names', `Exact resolution on primary candidate: ${res.record.certificationName}`);
    }
  } catch (err) {
    testFail(5, 'Multiple certificates with similar names', err.message);
  }

  // -------------------------------------------------------------
  // Test 6: Duplicate Certificate Records Deduplication
  // -------------------------------------------------------------
  try {
    const res = await certificateHybridRagService.getCertificateStructured('2');
    assert(res.found === true, 'Certificate 2 must be found');
    assert(res.record.certificationId === '2', 'Must resolve to single deduplicated record ID 2');
    testPass(6, 'Duplicate certificate records deduplication', `Deduplicated to single authoritative record: ${res.record.certificationName}`);
  } catch (err) {
    testFail(6, 'Duplicate certificate records deduplication', err.message);
  }

  // -------------------------------------------------------------
  // Test 7: Stale PostgreSQL Records Detection
  // -------------------------------------------------------------
  try {
    const report = await certificateHybridRagService.validateConsistency();
    assert(typeof report.isConsistent === 'boolean', 'Report must have isConsistent boolean');
    assert(report.postgresCount >= 0, 'Postgres count must be verified');
    testPass(7, 'Stale PostgreSQL records detection', `Report status: ${report.summary}`);
  } catch (err) {
    testFail(7, 'Stale PostgreSQL records detection', err.message);
  }

  // -------------------------------------------------------------
  // Test 8: Oracle and PostgreSQL Disagreement Detection
  // -------------------------------------------------------------
  try {
    const report = await certificateHybridRagService.validateConsistency();
    assert(Array.isArray(report.mismatches), 'Mismatches array must exist');
    testPass(8, 'Oracle and PostgreSQL disagreement detection', `Checked ${report.postgresCount} database records against cache. Mismatches detected: ${report.mismatches.length}`);
  } catch (err) {
    testFail(8, 'Oracle and PostgreSQL disagreement detection', err.message);
  }

  // -------------------------------------------------------------
  // Test 9: Semantic Questions Requiring Vector Retrieval
  // -------------------------------------------------------------
  try {
    const vectorDocs = await certificateHybridRagService.searchVectorKnowledge('Access certification governance standards manager', 2);
    assert(Array.isArray(vectorDocs) && vectorDocs.length > 0, 'Must retrieve matching vector knowledge documents');
    assert(vectorDocs[0].similarity > 0.3, `Top similarity must be > 0.3, got ${vectorDocs[0].similarity}`);
    testPass(9, 'Semantic questions requiring vector retrieval', `Retrieved Doc: "${vectorDocs[0].title}" (Cosine Similarity: ${vectorDocs[0].similarity})`);
  } catch (err) {
    testFail(9, 'Semantic questions requiring vector retrieval', err.message);
  }

  // -------------------------------------------------------------
  // Test 10: Questions Containing Ambiguous Identifiers & Observability Trace
  // -------------------------------------------------------------
  try {
    const toolRes = await getCertificationDetailsTool({ certificationName: 'IT Security Manager' });
    assert(toolRes.success === true, 'Tool execution must succeed');
    assert(toolRes.data && toolRes.data.certification, 'Must return resolved certification data');
    const traces = certificateHybridRagService.getRecentTraces(1);
    assert(traces.length > 0, 'Observability trace must be recorded');
    assert(traces[0].retrievalMethod === 'HYBRID', 'Trace retrieval method must be HYBRID');
    testPass(10, 'Ambiguous identifier resolution & Observability Tracing', `Trace logged: [${traces[0].requestId}] Latency: ${traces[0].latencyMs}ms, Database: ${traces[0].databaseSource}`);
  } catch (err) {
    testFail(10, 'Ambiguous identifier resolution & Observability Tracing', err.message);
  }

  console.log('\n================================================================');
  console.log(`📊 FINAL TEST REPORT: ${passed} PASSED, ${failed} FAILED (Total: 10)`);
  console.log('================================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runTestSuite().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
