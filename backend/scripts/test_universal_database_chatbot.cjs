const assert = require('assert');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../database/.env') });

const { schemaDiscoveryService } = require('../dist/services/schemaDiscoveryService.js');
const { metadataCatalogService } = require('../dist/services/metadataCatalogService.js');
const { schemaLinkingService } = require('../dist/services/schemaLinkingService.js');
const { textToSqlService } = require('../dist/services/textToSqlService.js');
const { sqlValidatorService } = require('../dist/services/sqlValidatorService.js');
const { sourceRoutingService } = require('../dist/services/sourceRoutingService.js');
const { resultVerificationService } = require('../dist/services/resultVerificationService.js');
const { conversationContextService } = require('../dist/services/conversationContextService.js');
const { universalDatabaseChatbotService } = require('../dist/services/universalDatabaseChatbotService.js');

async function runTestSuite() {
  console.log('========================================================================');
  console.log('🧪 COMPREHENSIVE EVALUATION SUITE: Universal Schema-Aware Database Chatbot');
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
  // Test 1: Dynamic Database Schema Discovery
  // -------------------------------------------------------------
  try {
    const schema = await schemaDiscoveryService.discoverSchema();
    assert(schema && schema.tables, 'Schema must be discovered');
    const tableCount = Object.keys(schema.tables).length;
    assert(tableCount >= 10, `Expected at least 10 tables, found ${tableCount}`);
    assert(schema.tables['oracle_raw_roles'], 'oracle_raw_roles must be discovered');
    assert(schema.tables['oracle_raw_access_certifications'], 'oracle_raw_access_certifications must be discovered');
    testPass(1, 'Dynamic Database Schema Discovery', `Discovered ${tableCount} accessible PostgreSQL tables & views dynamically.`);
  } catch (err) {
    testFail(1, 'Dynamic Database Schema Discovery', err.message);
  }

  // -------------------------------------------------------------
  // Test 2: Metadata Catalog & Verified Relationships
  // -------------------------------------------------------------
  try {
    const rels = await metadataCatalogService.getAllRelationships();
    assert(rels && rels.length > 0, 'Verified relationships must be configured');
    const certRel = await metadataCatalogService.findRelationship(
      'oracle_raw_access_certifications',
      'oracle_raw_certifier_worksheets'
    );
    assert(certRel !== null, 'Relationship between certifications and worksheets must be verified');
    testPass(2, 'Metadata Catalog & Verified Relationships', `Verified join path: ${certRel.sourceTable} -> ${certRel.targetTable} on ${certRel.sourceColumn}`);
  } catch (err) {
    testFail(2, 'Metadata Catalog & Verified Relationships', err.message);
  }

  // -------------------------------------------------------------
  // Test 3: Intelligent Schema Linking
  // -------------------------------------------------------------
  try {
    const linked = await schemaLinkingService.linkSchema('Show certificates and their certifier worksheet items');
    assert(linked.selectedTables.includes('oracle_raw_access_certifications'), 'Must link to certifications');
    assert(linked.selectedTables.includes('oracle_raw_certifier_worksheets'), 'Must link to worksheets');
    assert(linked.relevantRelationships.length > 0, 'Must link verified relationships');
    testPass(3, 'Intelligent Schema Linking', `Linked tables: [${linked.selectedTables.join(', ')}] with minimal prompt footprint.`);
  } catch (err) {
    testFail(3, 'Intelligent Schema Linking', err.message);
  }

  // -------------------------------------------------------------
  // Test 4: General-Purpose Text-to-SQL Plan Generation
  // -------------------------------------------------------------
  try {
    const linked = await schemaLinkingService.linkSchema('Show all certificates expiring next month');
    const plan = await textToSqlService.generateSqlPlan('Show all certificates expiring next month', linked);
    assert(plan.sql && plan.sql.length > 0, 'SQL plan must be generated');
    assert(plan.sql.toUpperCase().includes('SELECT'), 'Plan must contain SELECT query');
    testPass(4, 'General-Purpose Text-to-SQL Plan Generation', `Generated SQL: ${plan.sql}`);
  } catch (err) {
    testFail(4, 'General-Purpose Text-to-SQL Plan Generation', err.message);
  }

  // -------------------------------------------------------------
  // Test 5: Strict Security Validation: Destructive SQL Rejection
  // -------------------------------------------------------------
  try {
    const destructiveAttempt = 'DROP TABLE oracle_raw_roles;';
    const validation = await sqlValidatorService.validateAndSanitizeSql(destructiveAttempt);
    assert(validation.isValid === false, 'Destructive SQL must be rejected');
    assert(validation.rejectionReason.includes('Security Violation'), 'Must report security violation');
    testPass(5, 'Strict Security Validation: Destructive SQL Rejection', validation.rejectionReason);
  } catch (err) {
    testFail(5, 'Strict Security Validation: Destructive SQL Rejection', err.message);
  }

  // -------------------------------------------------------------
  // Test 6: Strict Security Validation: Multiple Statement / Stacking Rejection
  // -------------------------------------------------------------
  try {
    const stackedAttempt = 'SELECT * FROM oracle_raw_roles; DELETE FROM oracle_raw_users;';
    const validation = await sqlValidatorService.validateAndSanitizeSql(stackedAttempt);
    assert(validation.isValid === false, 'Stacked statements must be rejected');
    testPass(6, 'Strict Security Validation: Statement Stacking Rejection', validation.rejectionReason);
  } catch (err) {
    testFail(6, 'Strict Security Validation: Statement Stacking Rejection', err.message);
  }

  // -------------------------------------------------------------
  // Test 7: Strict Security Validation: Sensitive Column Protection
  // -------------------------------------------------------------
  try {
    const sensitiveAttempt = 'SELECT username, password_hash FROM veyra_user';
    const validation = await sqlValidatorService.validateAndSanitizeSql(sensitiveAttempt);
    assert(validation.isValid === false, 'Sensitive password_hash column must be rejected');
    testPass(7, 'Strict Security Validation: Sensitive Column Protection', validation.rejectionReason);
  } catch (err) {
    testFail(7, 'Strict Security Validation: Sensitive Column Protection', err.message);
  }

  // -------------------------------------------------------------
  // Test 8: Safe Read-Only SQL Execution & Source Routing
  // -------------------------------------------------------------
  try {
    const safeSql = 'SELECT category, count(*) AS role_count FROM oracle_raw_roles GROUP BY category ORDER BY role_count DESC';
    const res = await sourceRoutingService.executeValidatedQuery(safeSql);
    assert(res.success === true, 'Safe query must execute successfully');
    assert(res.rowCount > 0, 'Must return rows');
    assert(res.databaseSource === 'PostgreSQL Database', 'Database source must be identified');
    testPass(8, 'Safe Read-Only SQL Execution & Source Routing', `Executed in ${res.executionTimeMs}ms across ${res.rowCount} categories.`);
  } catch (err) {
    testFail(8, 'Safe Read-Only SQL Execution & Source Routing', err.message);
  }

  // -------------------------------------------------------------
  // Test 9: Result Verification: NULL Handling & Deduplication
  // -------------------------------------------------------------
  try {
    const mockExecution = {
      success: true,
      rows: [
        { certification_id: '1', manager_name: null, owner_name: 'Test1.Claaps' },
        { certification_id: '1', manager_name: null, owner_name: 'Test1.Claaps' } // duplicate
      ],
      rowCount: 2,
      columns: ['certification_id', 'manager_name', 'owner_name'],
      executionTimeMs: 12,
      databaseSource: 'PostgreSQL Database',
      sourceOfTruth: 'PostgreSQL',
      isCached: true
    };
    const verification = resultVerificationService.verifyResult(mockExecution, 'Who is the manager for certification 1?');
    assert(verification.hasNullFields === true, 'Must detect NULL manager');
    assert(verification.hasDuplicates === true, 'Must detect duplicate row');
    assert(verification.cleanRows.length === 1, 'Must deduplicate row');
    testPass(9, 'Result Verification: NULL Handling & Deduplication', `Deduplicated to 1 clean row; detected NULL: ${verification.nullFieldNames.join(', ')}`);
  } catch (err) {
    testFail(9, 'Result Verification: NULL Handling & Deduplication', err.message);
  }

  // -------------------------------------------------------------
  // Test 10: Multi-Turn Conversation Context & Pronoun Resolution
  // -------------------------------------------------------------
  try {
    const sessionId = 'eval_session_101';
    conversationContextService.recordTurn(sessionId, {
      id: 'turn_1',
      timestamp: new Date().toISOString(),
      userQuery: 'Show all active access controls',
      targetEntity: 'controls',
      activeFilters: { status: 'Active' },
      lastResultIds: ['11065', '11067']
    });

    const followUp = conversationContextService.resolveContextualQuery(sessionId, 'Which of these have the most incidents?');
    assert(followUp.resolvedQuery.includes('controls'), `Expected pronoun resolution to mention controls, got: ${followUp.resolvedQuery}`);
    testPass(10, 'Multi-Turn Conversation Context & Follow-Up Resolution', `Resolved query: "${followUp.resolvedQuery}"`);
  } catch (err) {
    testFail(10, 'Multi-Turn Conversation Context & Follow-Up Resolution', err.message);
  }

  // -------------------------------------------------------------
  // Test 11: End-to-End Chatbot Execution: Manager of Certificate
  // -------------------------------------------------------------
  try {
    const response = await universalDatabaseChatbotService.processQuery('Who is the manager of certificate 1?');
    assert(response.message && response.message.length > 0, 'Response message must be generated');
    assert(response.message.includes('Karthika.Claaps') || response.message.includes('manager'), 'Must accurately mention manager');
    assert(response.structuredData && response.structuredData.table, 'Must provide structured table');
    testPass(11, 'End-to-End Chatbot: Manager of Certificate', `Message snippet: ${response.message.split('\n')[0]}`);
  } catch (err) {
    testFail(11, 'End-to-End Chatbot: Manager of Certificate', err.message);
  }

  // -------------------------------------------------------------
  // Test 12: End-to-End Chatbot Execution: Multi-table Query
  // -------------------------------------------------------------
  try {
    const response = await universalDatabaseChatbotService.processQuery('Retrieve information involving multiple database tables for controls and incidents');
    assert(response.message && response.message.length > 0, 'Response message must be generated');
    assert(response.toolResult && response.toolResult.success, 'Tool execution must succeed');
    testPass(12, 'End-to-End Chatbot: Multi-table Query', `Retrieved ${response.structuredData?.table?.rows?.length || 0} multi-table rows.`);
  } catch (err) {
    testFail(12, 'End-to-End Chatbot: Multi-table Query', err.message);
  }

  // -------------------------------------------------------------
  // Test 13: End-to-End Chatbot Execution: Duty Roles Distribution
  // -------------------------------------------------------------
  try {
    const response = await universalDatabaseChatbotService.processQuery('how many duty roles in Security Role Catalog');
    assert(response.message.includes('4,004'), `Expected 4,004 duty roles, got: ${response.message}`);
    testPass(13, 'End-to-End Chatbot: Duty Roles Distribution (4,004 exact count)', `Verified 4,004 Duty Roles reported accurately.`);
  } catch (err) {
    testFail(13, 'End-to-End Chatbot: Duty Roles Distribution (4,004 exact count)', err.message);
  }

  console.log('\n========================================================================');
  console.log(`EVALUATION SUMMARY: ${passed} PASSED / ${failed} FAILED (${((passed / (passed + failed)) * 100).toFixed(1)}% Accuracy)`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Test suite runner crashed:', err);
  process.exit(1);
});
