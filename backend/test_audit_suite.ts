import { oracleService } from './src/services/oracleService.js';
import { auditProductCatalogService } from './src/services/auditProductCatalogService.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: any) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testName}`, detail || '');
    failed++;
  }
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('STARTING AUDIT HISTORY COMPREHENSIVE TEST SUITE');
  console.log('====================================================\n');

  // TEST 1: OPSS - Reference implementation must remain unchanged
  console.log('--- TEST 1: OPSS Reference Implementation ---');
  try {
    const resOpss = await oracleService.getAuditHistory({
      product: 'Oracle Platform Security Services (OPSS)',
      pageSize: 50
    });
    assert(resOpss.success === true, 'TEST 1.1: OPSS returns success: true');
    assert(resOpss.logs && resOpss.logs.length > 0, `TEST 1.2: OPSS returns records (${resOpss.logs.length} returned)`);
    assert(resOpss.product === 'opss', 'TEST 1.3: OPSS product ID is opss');
    assert(!resOpss.businessObject, 'TEST 1.4: OPSS does not have a businessObject');
  } catch (err: any) {
    assert(false, 'TEST 1: OPSS failed with error', err.message);
  }

  // TEST 2: HCM - Reference implementation must remain unchanged
  console.log('\n--- TEST 2: HCM Reference Implementation ---');
  try {
    const resHcm = await oracleService.getAuditHistory({
      product: 'Global Human Resources',
      pageSize: 50
    });
    assert(resHcm.success === true, 'TEST 2.1: HCM returns success: true');
    assert(resHcm.logs && resHcm.logs.length > 0, `TEST 2.2: HCM returns records (${resHcm.logs.length} returned)`);
    assert(resHcm.product === 'hcm', 'TEST 2.3: HCM product ID is hcm');
    assert(resHcm.businessObject === 'person', 'TEST 2.4: HCM businessObject is person');
  } catch (err: any) {
    assert(false, 'TEST 2: HCM failed with error', err.message);
  }

  // TEST 3: Another product with a valid Business Object Type
  console.log('\n--- TEST 3: Another Product with Valid Business Object Type (Payables) ---');
  try {
    const resPayables = await oracleService.getAuditHistory({
      product: 'Payables',
      businessObjectType: 'Invoice',
      pageSize: 50
    });
    assert(resPayables.success === true, 'TEST 3.1: Payables query succeeds');
    assert(resPayables.businessObject === 'invoice', 'TEST 3.2: Payables resolves to invoice businessObject');
    assert(resPayables.productDisplayName?.includes('Payables'), 'TEST 3.3: Product display name is Payables');
  } catch (err: any) {
    assert(false, 'TEST 3: Payables query failed', err.message);
  }

  // TEST 4: Another product with valid Business Object Type but no matching data
  console.log('\n--- TEST 4: Valid Business Object Type with Empty Data (Benefits / Program) ---');
  try {
    const resBen = await oracleService.getAuditHistory({
      product: 'Benefits',
      businessObjectType: 'Program',
      pageSize: 50
    });
    assert(resBen.success === true, 'TEST 4.1: Benefits query returns success: true');
    assert(Array.isArray(resBen.logs), 'TEST 4.2: Benefits returns logs array');
    assert(resBen.logs.length === 0, 'TEST 4.3: Benefits returns 0 logs (empty result)');
    assert(resBen.totalRecords === 0, 'TEST 4.4: Benefits returns totalRecords: 0');
    assert(resBen.businessObject === 'program', 'TEST 4.5: Benefits resolved to program');
  } catch (err: any) {
    assert(false, 'TEST 4: Benefits empty data query threw unexpected error', err.message);
  }

  // TEST 5: Invalid or missing Business Object Type
  console.log('\n--- TEST 5: Invalid / Missing Business Object Type ---');
  try {
    // 5a. Missing BO for a product that requires one (General Ledger)
    let missingBoError = false;
    try {
      await oracleService.getAuditHistory({
        product: 'General Ledger',
        businessObjectType: ''
      });
    } catch (e: any) {
      missingBoError = true;
      assert(
        e.message.includes('requires a Business Object Type'),
        'TEST 5.1: Missing BO throws controlled validation error',
        e.message
      );
    }
    assert(missingBoError, 'TEST 5.1b: Missing BO threw error');

    // 5b. Invalid BO for a product (General Ledger with 'Invoice')
    let invalidBoError = false;
    try {
      await oracleService.getAuditHistory({
        product: 'General Ledger',
        businessObjectType: 'NonExistentObject'
      });
    } catch (e: any) {
      invalidBoError = true;
      assert(
        e.message.includes('Invalid Business Object Type') || e.message.includes('requires a Business Object Type'),
        'TEST 5.2: Invalid BO throws controlled validation error',
        e.message
      );
    }
    assert(invalidBoError, 'TEST 5.2b: Invalid BO threw error');
  } catch (err: any) {
    assert(false, 'TEST 5: Unexpected error in validation tests', err.message);
  }

  // TEST 6: Actual Oracle / API failure
  console.log('\n--- TEST 6: Unrecognized Product / Integration Error Handling ---');
  try {
    let unrecogError = false;
    try {
      await oracleService.getAuditHistory({
        product: 'CompletelyBogusProductNameThatDoesNotExist12345',
        businessObjectType: 'Something'
      });
    } catch (e: any) {
      unrecogError = true;
      assert(
        e.message.includes('not recognized'),
        'TEST 6.1: Unrecognized product produces safe descriptive error',
        e.message
      );
    }
    assert(unrecogError, 'TEST 6.1b: Unrecognized product threw error');
  } catch (err: any) {
    assert(false, 'TEST 6: Unexpected failure', err.message);
  }

  // TEST 7: Product switching & No leaking across products
  console.log('\n--- TEST 7: Product Switching & Isolation ---');
  try {
    // 7a. Query 1: Benefits with 'Plan Type'
    const r1 = auditProductCatalogService.resolveAuditRequest('Benefits', 'Plan Type');
    assert(r1.matched === true && r1.product?.id === 'benefits' && r1.businessObject?.id === 'plan_type', 'TEST 7.1: Resolves Benefits / Plan Type');

    // 7b. Query 2: General Ledger with 'Journal'
    const r2 = auditProductCatalogService.resolveAuditRequest('General Ledger', 'Journal');
    assert(r2.matched === true && r2.product?.id === 'gl' && r2.businessObject?.id === 'journal', 'TEST 7.2: Resolves General Ledger / Journal');

    // 7c. Leaking test: What if 'Plan Type' from previous selection is passed to General Ledger?
    const r3 = auditProductCatalogService.resolveAuditRequest('General Ledger', 'Plan Type');
    assert(r3.status === 'UNRESOLVED', 'TEST 7.3: General Ledger rejects leaked "Plan Type" from previous product');

    // 7d. Switch to OPSS: requiresBO is false, BO is null
    const r4 = auditProductCatalogService.resolveAuditRequest('Oracle Platform Security Services (OPSS)');
    assert(r4.matched === true && r4.product?.id === 'opss' && r4.businessObject === null, 'TEST 7.4: OPSS resolves with no BO');

    // 7e. Switch to Risks and Controls (RACM) with Advanced Controls
    const r5 = auditProductCatalogService.resolveAuditRequest('Risks and Controls', 'Advanced Controls');
    assert(r5.matched === true && r5.businessObject?.displayName === 'Advanced Controls', 'TEST 7.5: RACM resolves Advanced Controls');
  } catch (err: any) {
    assert(false, 'TEST 7: Product switching test failed', err.message);
  }

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');
}

runTestSuite();
