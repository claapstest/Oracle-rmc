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
    !!appCommon && appCommon.businessObjects.length === 1 && appCommon.businessObjects[0].displayName === 'Account',
    `Sno 12 (Applications Common Components) has 1 instance BO: "Account"`
  );

  const commonCRM = publicCatalog.find(p => p.sno === 20);
  assert(
    !!commonCRM && commonCRM.businessObjects.length === 5 && commonCRM.businessObjects[0].displayName === 'Household',
    `Sno 20 (Common CRM) has 5 instance BOs starting with "${commonCRM?.businessObjects[0].displayName}"`
  );

  const productHub = publicCatalog.find(p => p.sno === 49);
  assert(
    !!productHub && productHub.businessObjects.length === 1 && productHub.businessObjects[0].displayName === 'Item Extensible Flexfield',
    `Sno 49 (Product Hub) has 1 instance BO: "Item Extensible Flexfield" (all (0) deleted)`
  );

  // TEST 3: Only Supported Business Objects are marked SUPPORTED
  assert(appCommon?.businessObjects[0].isSupported === true, 'Applications Common Components BO 1 (Account) isSupported === true');

  // TEST 4: Resolution of Supported vs Unsupported BOs
  const resSupported = auditProductCatalogService.resolveAuditRequest('Applications Common Components', 'Account');
  assert(resSupported.status === 'CONFIRMED', 'Resolving supported BO (Account) returns CONFIRMED');
  assert(resSupported.businessObject?.payloadTemplate?.productId === '47110F64ABFD08E2E040449823C60DB6', 'Payload template contains productId');

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

  // TEST 7: Preserve Global Human Resources (Sno 32)
  const ghr = publicCatalog.find(p => p.sno === 32 || p.id === 'hcm');
  assert(!!ghr && ghr.businessObjects.length === 2, `Global Human Resources has 2 instance BOs (actual: ${ghr?.businessObjects.length})`);
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

  // TEST 8b: Risks and Controls (RACM) - Advanced Controls
  const racmRes = auditProductCatalogService.resolveAuditRequest('Risks and Controls', 'Advanced Controls');
  assert(racmRes.status === 'CONFIRMED', 'Risks and Controls Advanced Controls resolves');
  assert(racmRes.businessObject?.displayName === 'Advanced Controls', 'RACM businessObject is "Advanced Controls"');
  assert(racmRes.businessObject?.payloadTemplate?.productId === 'ACB976486A76EF21E0401490D3C5320F', 'RACM payloadTemplate contains productId');
  assert(racmRes.businessObject?.payloadTemplate?.businessObjectType === 'oracle.apps.gtg.ac.uiModel.control.protectedModel.view.AuditAdvancedControlVO', 'RACM uses AuditAdvancedControlVO');

  // TEST 9: oracleService.getAuditHistory handles NOT_CONFIGURED gracefully
  const notConfiguredResult = await oracleService.getAuditHistory({
    product: 'Applications Common Components',
    businessObjectType: 'Contact'
  });
  assert(notConfiguredResult.notConfigured === true, 'oracleService returns notConfigured: true for unsupported BO');
  assert(notConfiguredResult.success === false, 'oracleService returns success: false for unsupported BO');
  assert(!!notConfiguredResult.message && (notConfiguredResult.message.includes('not configured') || notConfiguredResult.message.includes('Invalid')), `oracleService message is informative: "${notConfiguredResult.message}"`);

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
