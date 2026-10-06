import { auditProductCatalogService } from './services/auditProductCatalogService.js';
import { oracleService } from './services/oracleService.js';

async function runAuditTestSuite() {
  console.log('====================================================');
  console.log('ORACLE AUDIT TRAIL VERIFICATION TEST SUITE');
  console.log('====================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`[PASS] ${msg}`);
      passed++;
    } else {
      console.error(`[FAIL] ${msg}`);
      failed++;
    }
  }

  // TEST 1: Catalog Loaded and Contains 78 Products
  const publicCatalog = auditProductCatalogService.getPublicCatalog();
  assert(publicCatalog.length === 78, `Catalog loaded 78 products (actual: ${publicCatalog.length})`);

  // TEST 2: Business Object Types come from "Business object type list present in instance"
  const appCommon = publicCatalog.find(p => p.sno === 12);
  assert(
    !!appCommon && appCommon.businessObjects.length === 2 && appCommon.businessObjects[0].displayName === 'Account' && appCommon.businessObjects[1].displayName === 'Contact',
    `Sno 12 (Applications Common Components) has 2 instance BOs: "Account" and "Contact"`
  );

  const commonCRM = publicCatalog.find(p => p.sno === 20);
  assert(
    !!commonCRM && commonCRM.businessObjects.length === 4 && commonCRM.businessObjects[0].displayName === 'Account',
    `Sno 20 (Common CRM) has 4 instance BOs with first supported: "${commonCRM?.businessObjects[0].displayName}"`
  );

  const productHub = publicCatalog.find(p => p.sno === 49);
  assert(
    !!productHub && productHub.businessObjects.length === 21 && productHub.businessObjects[0].displayName === 'Value Set',
    `Sno 49 (Product Hub) has 21 instance BOs starting with "Value Set"`
  );

  // TEST 3: Only First Business Object is Supported; Additional BOs are UNSUPPORTED
  assert(appCommon?.businessObjects[0].isSupported === true, 'Applications Common Components BO 1 (Account) isSupported === true');
  assert(appCommon?.businessObjects[1].isSupported === false, 'Applications Common Components BO 2 (Contact) isSupported === false');
  assert(appCommon?.businessObjects[1].status === 'UNSUPPORTED', 'Applications Common Components BO 2 status === UNSUPPORTED');

  // TEST 4: Resolution of Supported vs Unsupported BOs
  const resSupported = auditProductCatalogService.resolveAuditRequest('Applications Common Components', 'Account');
  assert(resSupported.status === 'CONFIRMED', 'Resolving supported BO (Account) returns CONFIRMED');
  assert(resSupported.businessObject?.payloadTemplate?.productId === '47110F64ABFD08E2E040449823C60DB6', 'Payload template contains productId');
  assert(resSupported.businessObject?.payloadTemplate?.businessObjectType === 'oracle.apps.cdm.foundation.parties.organizationService.view.OrganizationDVO', 'Payload template has correct VO');

  const resUnsupported = auditProductCatalogService.resolveAuditRequest('Applications Common Components', 'Contact');
  assert(resUnsupported.status === 'NOT_CONFIGURED', 'Resolving unsupported BO (Contact) returns NOT_CONFIGURED');
  assert(
    !!(resUnsupported.message?.includes('not yet configured') && resUnsupported.message?.includes('Account')),
    `Controlled message mentions not configured and supported first BO: "${resUnsupported.message}"`
  );

  // TEST 5: Preserve OPSS Working Case (Sno 3)
  const opss = publicCatalog.find(p => p.sno === 3 || p.id === 'opss');
  assert(!!opss && opss.requiresBusinessObjectType === false, 'OPSS has requiresBusinessObjectType === false');
  const opssRes = auditProductCatalogService.resolveAuditRequest('OPSS', undefined);
  assert(opssRes.status === 'CONFIRMED', 'OPSS resolves without business object type (status: CONFIRMED)');
  assert(opssRes.product?.defaultPayloadTemplate?.product === 'OPSS', 'OPSS payload template uses product: "OPSS"');

  // TEST 6: Preserve HCM Common Architecture Working Case (Sno 36)
  const hcmArch = publicCatalog.find(p => p.sno === 36 || p.id === 'hcm_common_architecture');
  assert(!!hcmArch, 'HCM Common Architecture exists in catalog');
  const hcmArchRes = auditProductCatalogService.resolveAuditRequest('HCM Common Architecture', 'Configure HCM Data Loader Parameters');
  assert(hcmArchRes.status === 'CONFIRMED', 'HCM Common Architecture resolves (status: CONFIRMED)');
  assert(
    hcmArchRes.businessObject?.payloadTemplate?.businessObjectType === 'oracle.apps.hcm.common.core.uiModel.view.HcmDataLoaderParamVO',
    'HCM Common Architecture uses HcmDataLoaderParamVO'
  );

  // TEST 7: Preserve Global Human Resources (Sno 32)
  const ghr = publicCatalog.find(p => p.sno === 32 || p.id === 'hcm');
  assert(!!ghr && ghr.businessObjects.length === 31, `Global Human Resources has 31 unique instance BOs (actual: ${ghr?.businessObjects.length})`);
  const ghrDocRes = auditProductCatalogService.resolveAuditRequest('Global Human Resources', 'Document Records');
  assert(ghrDocRes.status === 'CONFIRMED', 'GHR first BO (Document Records) resolves');
  assert(
    ghrDocRes.businessObject?.payloadTemplate?.businessObjectType === 'oracle.apps.hcm.documentsOfRecord.core.protectedUiModel.view.DocumentsOfRecordVO',
    'GHR Document Records uses DocumentsOfRecordVO'
  );
  // Backwards compatibility check
  const ghrPersonRes = auditProductCatalogService.resolveAuditRequest('Global Human Resources', 'Person');
  assert(ghrPersonRes.status === 'CONFIRMED', 'GHR Person backward-compat alias resolves');

  // TEST 8: Product-Specific Payloads: productId vs product
  const glRes = auditProductCatalogService.resolveAuditRequest('General Ledger', 'Period Status');
  assert(glRes.status === 'CONFIRMED', 'General Ledger Period Status resolves');
  assert(glRes.businessObject?.payloadTemplate?.product === 'Ledger', 'General Ledger uses product: "Ledger"');
  assert(!glRes.businessObject?.payloadTemplate?.productId, 'General Ledger does NOT use productId');

  const polRes = auditProductCatalogService.resolveAuditRequest('Audit Policies', 'Oracle Fusion business objects and attributes');
  assert(polRes.status === 'CONFIRMED', 'Audit Policies resolves');
  assert(polRes.businessObject?.payloadTemplate?.product === 'ORA_FND_AUDIT_POLICY', 'Audit Policies uses product: "ORA_FND_AUDIT_POLICY"');
  assert(polRes.businessObject?.payloadTemplate?.businessObjectType === 'ORA_FND_FA_BO', 'Audit Policies uses businessObjectType: "ORA_FND_FA_BO"');

  // TEST 9: oracleService.getAuditHistory handles NOT_CONFIGURED gracefully
  const notConfiguredResult = await oracleService.getAuditHistory({
    product: 'Applications Common Components',
    businessObjectType: 'Contact'
  });
  assert(notConfiguredResult.notConfigured === true, 'oracleService returns notConfigured: true for unsupported BO');
  assert(notConfiguredResult.success === false, 'oracleService returns success: false for unsupported BO');
  assert(notConfiguredResult.logs.length === 0, 'oracleService returns empty logs for unsupported BO');
  assert(!!notConfiguredResult.message?.includes('not yet configured'), `oracleService message is informative: "${notConfiguredResult.message}"`);

  // TEST 10: Demo Mode / Fallback with missing eventType / action does NOT throw .toUpperCase()
  const fallbackLogs = (oracleService as any).getFallbackAuditLogs({
    restBusinessObjectType: 'ORA_FND_FA_BO',
    boDisplayName: 'Oracle Fusion business objects and attributes',
    username: undefined,
    action: undefined
  });
  assert(Array.isArray(fallbackLogs), 'Fallback logs array generated without crashing');

  console.log('====================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuditTestSuite().catch(err => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
