const fs = require('fs');
const path = require('path');

const catalogPath = path.resolve(__dirname, '../src/config/auditProductCatalog.json');
const distCatalogPath = path.resolve(__dirname, '../dist/config/auditProductCatalog.json');

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

// Authoritative definitions from user's Postman tests
const updates = [
  // 1. Audit Policies (ORA_FND_AUDIT_POLICY)
  {
    targetId: 'audit_policies',
    productId: 'ORA_FND_AUDIT_POLICY',
    instanceProductName: 'ORA_FND_AUDIT_POLICY',
    restProduct: 'ORA_FND_AUDIT_POLICY',
    businessObjects: [
      {
        displayName: 'Oracle Fusion business objects and attributes',
        productId: 'ORA_FND_AUDIT_POLICY',
        businessObjectType: 'ORA_FND_FA_BO',
        isSupported: true
      },
      {
        displayName: 'Oracle Platform Security Services',
        productId: 'ORA_FND_AUDIT_POLICY',
        businessObjectType: 'ORA_FND_OPSS',
        isSupported: true
      }
    ]
  },

  // 2. Common CRM (sales)
  {
    targetId: 'common_crm',
    productId: '47110F64ABF608E2E040449823C60DB6',
    instanceProductName: 'sales',
    restProduct: 'sales',
    businessObjects: [
      {
        displayName: 'Household',
        productId: '08C1ABF048177E22E050F00A1720179C',
        businessObjectType: 'oracle.apps.crm.service.svcMgmt.srMgmt.srMgmtService.view.SrReferencesVO',
        isSupported: true
      },
      {
        displayName: 'Account',
        productId: '47110F64ABF608E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.cdm.foundation.parties.organizationService.view.OrganizationDVO',
        isSupported: true
      },
      {
        displayName: 'Sales Account',
        productId: '47110F64ABF608E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.crmCommon.salesParties.salesPartiesService.view.SalesAccountVO',
        isSupported: true
      }
    ]
  },

  // 3. General Ledger (Ledger)
  {
    targetId: 'general_ledger',
    productId: '47110F64AC0B08E2E040449823C60DB6',
    instanceProductName: 'Ledger',
    restProduct: 'Ledger',
    businessObjects: [
      {
        displayName: 'Accounting Calendar Setup',
        productId: '47110F64AC0B08E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.generalLedger.calendars.accounting.uiModel.view.CalendarVO',
        isSupported: true
      },
      {
        displayName: 'Period Status',
        productId: '47110F64AC0B08E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.generalLedger.calendars.accounting.uiModel.view.PeriodStatusAuditVO',
        isSupported: true
      },
      {
        displayName: 'Period Details',
        productId: '47110F64AC0B08E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.generalLedger.calendars.accounting.uiModel.view.PeriodVO',
        isSupported: true
      },
      {
        displayName: 'Journal Batch',
        productId: '47110F64AC0B08E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.generalLedger.journals.journalEntries.uiModel.view.JournalBatchVO',
        isSupported: true
      },
      {
        displayName: 'Journal Header',
        productId: '47110F64AC0B08E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.generalLedger.journals.journalEntries.uiModel.view.JournalHeaderVO',
        isSupported: true
      },
      {
        displayName: 'Journal Line',
        productId: '47110F64AC0B08E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.generalLedger.journals.journalEntries.uiModel.view.JournalLineVO',
        isSupported: true
      },
      {
        displayName: 'Chart of Accounts Options Setup',
        productId: '47110F64AC0B08E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.generalLedger.shared.flexfield.uiModel.view.ChartOfAccountsOptionsVO',
        isSupported: true
      },
      {
        displayName: 'Combination Set',
        productId: '47110F64AC0B08E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.generalLedger.shared.flexfield.uiModel.view.PacsDefinitionVO',
        isSupported: true
      }
    ]
  },

  // 4. Global Human Resources (hcmCoreSetup / hcmCore)
  {
    targetId: 'hcm',
    productId: '47110F64AC2A08E2E040449823C60DB6',
    instanceProductName: 'hcmCore',
    restProduct: 'hcmCore',
    businessObjects: [
      {
        displayName: 'Document Records',
        productId: '47110F64AC2A08E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.hcm.documentsOfRecord.core.protectedUiModel.view.DocumentsOfRecordVO',
        isSupported: true
      }
    ]
  },

  // 5. HCM Common Architecture
  {
    targetId: 'hcm_common_architecture',
    productId: null,
    businessObjects: [
      {
        displayName: 'Configure HCM Data Loader Parameters',
        businessObjectType: 'oracle.apps.hcm.common.core.uiModel.view.HcmDataLoaderParamVO',
        isSupported: true
      },
      {
        displayName: 'HCM Data Loader Business Objects Access',
        businessObjectType: 'oracle.apps.hcm.common.core.uiModel.view.HcmDataLoaderParamVO',
        isSupported: true
      }
    ]
  },

  // 6. Inventory Management
  {
    targetId: 'inventory_management',
    productId: '47110F64AC8A08E2E040449823C60DB6',
    instanceProductName: 'invLotsAndSerials',
    restProduct: 'invLotsAndSerials',
    businessObjects: [
      {
        displayName: 'Interorganization Parameter',
        productId: '47110F64AC8A08E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.scm.inventory.coreSetup.interOrganizationParameters.uiModel.view.InterOrganizationParametersAuditVO',
        isSupported: true
      },
      {
        displayName: 'Subinventory',
        productId: '47110F64AC8A08E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.scm.inventory.coreSetup.subinventories.uiModel.view.InventorySubinventoryAuditVO',
        isSupported: true
      },
      {
        displayName: 'Lot',
        productId: '47110F64AC8A08E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.scm.inventory.lotsAndSerials.maintenance.uiModel.view.LotAuditVO',
        isSupported: true
      },
      {
        displayName: 'Serial Number',
        productId: '47110F64AC8A08E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.scm.inventory.lotsAndSerials.maintenance.uiModel.view.SerialAuditVO',
        isSupported: true
      }
    ]
  },

  // 7. Payables
  {
    targetId: 'payables',
    productId: '47110F64AC0308E2E040449823C60DB6',
    instanceProductName: 'Payables',
    restProduct: 'Payables',
    businessObjects: [
      {
        displayName: 'Invoice',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.invoices.transactions.uiModel.view.InvoiceHeaderVO',
        isSupported: true
      },
      {
        displayName: 'Aging Periods',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.invoicesSetup.agingPeriods.uiModel.view.AgingPeriodHeaderVO',
        isSupported: true
      },
      {
        displayName: 'Aging Period Details',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.invoicesSetup.agingPeriods.uiModel.view.AgingPeriodLineVO',
        isSupported: true
      },
      {
        displayName: 'Distribution Sets',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.invoicesSetup.distributionSets.uiModel.view.DistributionSetHeaderVO',
        isSupported: true
      },
      {
        displayName: 'Distribution Set Details',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.invoicesSetup.distributionSets.uiModel.view.DistributionSetLineVO',
        isSupported: true
      },
      {
        displayName: 'Invoice Holds and Releases',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.invoicesSetup.invoiceHolds.uiModel.view.ApprovalCodeVO',
        isSupported: true
      },
      {
        displayName: 'Invoice Tolerances',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.invoicesSetup.invoiceToleranceSets.uiModel.view.InvoiceToleranceSetVO',
        isSupported: true
      },
      {
        displayName: 'Set Assignments',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.invoicesSetup.paymentTerms.uiModel.view.PaymentTermHeaderSTVO',
        isSupported: true
      },
      {
        displayName: 'Payment Terms',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.invoicesSetup.paymentTerms.uiModel.view.PaymentTermHeaderVO',
        isSupported: true
      },
      {
        displayName: 'Installments',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.invoicesSetup.paymentTerms.uiModel.view.PaymentTermLineVO',
        isSupported: true
      },
      {
        displayName: 'Reporting Entities',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.invoicesSetup.reportingEntities.uiModel.view.ReportingEntityHeaderVO',
        isSupported: true
      },
      {
        displayName: 'Balancing Segment Values',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.invoicesSetup.reportingEntities.uiModel.view.ReportingEntityLineVO',
        isSupported: true
      },
      {
        displayName: 'Bank Charge Details',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.paymentsSetup.bankCharges.uiModel.view.BankChargeLineVO',
        isSupported: true
      },
      {
        displayName: 'Interest Rates',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.paymentsSetup.interestRates.uiModel.view.InterestPeriodVO',
        isSupported: true
      },
      {
        displayName: 'Intelligent Document Recognition Options',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.shared.uiModel.view.IdrSetupOptionVO',
        isSupported: true
      },
      {
        displayName: 'Common Options for Payables and Procurement',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.sharedSetup.financialsOptions.uiModel.view.FinancialsOptionVO',
        isSupported: true
      },
      {
        displayName: 'General Payables Options',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.sharedSetup.payablesSystemOptions.uiModel.view.SystemOptionVO',
        isSupported: true
      },
      {
        displayName: 'Period Information',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.sharedSetup.specialCalendar.uiModel.view.SpecialCalendarPeriodVO',
        isSupported: true
      },
      {
        displayName: 'Payables Calendars',
        productId: '47110F64AC0308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.payables.sharedSetup.specialCalendar.uiModel.view.SpecialCalendarTypeVO',
        isSupported: true
      }
    ]
  },

  // 8. Profile Management
  {
    targetId: 'profile_management',
    productId: '47110F64AC2308E2E040449823C60DB6',
    instanceProductName: 'HcmTalent',
    restProduct: 'HcmTalent',
    businessObjects: [
      {
        displayName: 'Model Certification Profile Items',
        productId: '47110F64AC2308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.hcm.profiles.core.protectedUiModel.view.CertificationModelItemAuditVO',
        isSupported: true
      },
      {
        displayName: 'Person Certification Profile Items',
        productId: '47110F64AC2308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.hcm.profiles.core.protectedUiModel.view.CertificationProfileItemAuditVO',
        isSupported: true
      },
      {
        displayName: 'Person Skill Profile Items',
        productId: '47110F64AC2308E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.hcm.profiles.core.protectedUiModel.view.SkillProfileItemAuditVO',
        isSupported: true
      }
    ]
  },

  // 9. Public Sector Common Components
  {
    targetId: 'public_sector_common_components',
    productId: '5AE4C38131A16D3AE0531720F00A9CE7',
    instanceProductName: 'Public Sector Common Components',
    restProduct: 'Public Sector Common Components',
    businessObjects: [
      {
        displayName: 'Trading Community Customer Billing Account',
        productId: '5AE4C38131A16D3AE0531720F00A9CE7',
        businessObjectType: 'oracle.apps.cdm.foundation.parties.customerAccountService.view.CustomerAccountVO',
        isSupported: true
      },
      {
        displayName: 'Household',
        productId: '5AE4C38131A16D3AE0531720F00A9CE7',
        businessObjectType: 'oracle.apps.cdm.foundation.parties.groupService.view.GroupVO',
        isSupported: true
      },
      {
        displayName: 'Account',
        productId: '5AE4C38131A16D3AE0531720F00A9CE7',
        businessObjectType: 'oracle.apps.cdm.foundation.parties.organizationService.view.OrganizationDVO',
        isSupported: true
      }
    ]
  },

  // 10. Quality Issue and Action Management
  {
    targetId: 'quality_issue_and_action_management',
    productId: '13BFA4ABD1ACDBA4E050F00A17206E1D',
    instanceProductName: 'enqActions',
    restProduct: 'enqActions',
    businessObjects: [
      {
        displayName: 'Quality Action Affected Object',
        productId: '13BFA4ABD1ACDBA4E050F00A17206E1D',
        businessObjectType: 'oracle.apps.scm.enterpriseQualityManagement.actions.publicUiModel.view.ActionAffectedObjectsAuditVO',
        isSupported: true
      },
      {
        displayName: 'Quality Action Attachment',
        productId: '13BFA4ABD1ACDBA4E050F00A17206E1D',
        businessObjectType: 'oracle.apps.scm.enterpriseQualityManagement.actions.publicUiModel.view.ActionAttachmentAuditVO',
        isSupported: true
      },
      {
        displayName: 'Source Quality Action',
        productId: '13BFA4ABD1ACDBA4E050F00A17206E1D',
        businessObjectType: 'oracle.apps.scm.enterpriseQualityManagement.actions.publicUiModel.view.ActionSrcReferencesAuditVO',
        isSupported: true
      },
      {
        displayName: 'Quality Action',
        productId: '13BFA4ABD1ACDBA4E050F00A17206E1D',
        businessObjectType: 'oracle.apps.scm.enterpriseQualityManagement.actions.publicUiModel.view.ActionVO',
        isSupported: true
      },
      {
        displayName: 'Quality Issue Affected Object',
        productId: '13BFA4ABD1ACDBA4E050F00A17206E1D',
        businessObjectType: 'oracle.apps.scm.enterpriseQualityManagement.issues.publicUiModel.view.IssueAffectedObjectsAuditVO',
        includeChildObjects: 'false',
        isSupported: true
      },
      {
        displayName: 'Quality Issue Attachment',
        productId: '13BFA4ABD1ACDBA4E050F00A17206E1D',
        businessObjectType: 'oracle.apps.scm.enterpriseQualityManagement.issues.publicUiModel.view.IssueAttachmentAuditVO',
        isSupported: true
      },
      {
        displayName: 'Destination Quality Issue',
        productId: '13BFA4ABD1ACDBA4E050F00A17206E1D',
        businessObjectType: 'oracle.apps.scm.enterpriseQualityManagement.issues.publicUiModel.view.IssueDestReferencesAuditVO',
        isSupported: true
      },
      {
        displayName: 'Quality Issue',
        productId: '13BFA4ABD1ACDBA4E050F00A17206E1D',
        businessObjectType: 'oracle.apps.scm.enterpriseQualityManagement.issues.publicUiModel.view.IssueVO',
        isSupported: true
      }
    ]
  },

  // 11. Receivables
  {
    targetId: 'receivables',
    productId: '47110F64AC0408E2E040449823C60DB6',
    instanceProductName: 'Receivables',
    restProduct: 'Receivables',
    businessObjects: [
      {
        displayName: 'Trading Community Customer Billing Account',
        productId: '47110F64AC0408E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.cdm.foundation.parties.customerAccountService.view.CustomerAccountVO',
        isSupported: true
      },
      {
        displayName: 'Receivables Customer Profile Class Amount',
        productId: '47110F64AC0408E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.receivables.customerSetup.customerProfileClasses.uiModel.view.CustomerProfileClassAmountUIVO',
        isSupported: true
      },
      {
        displayName: 'Receivables Customer Profile Class',
        productId: '47110F64AC0408E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.receivables.customerSetup.customerProfileClasses.uiModel.view.CustomerProfileClassCreateUIVO',
        isSupported: true
      },
      {
        displayName: 'Customer Profile Amount',
        productId: '47110F64AC0408E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.receivables.customerSetup.customerProfiles.model.view.CustomerProfileAmountAuditVO',
        isSupported: true
      },
      {
        displayName: 'Customer Profile',
        productId: '47110F64AC0408E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.receivables.customerSetup.customerProfiles.model.view.CustomerProfileAuditVO',
        isSupported: true
      },
      {
        displayName: 'Receivables User Approval Limit',
        productId: '47110F64AC0408E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.receivables.sharedSetup.uiModel.view.ApprovalUserLimitAuditVO',
        isSupported: true
      },
      {
        displayName: 'Payment Terms',
        productId: '47110F64AC0408E2E040449823C60DB6',
        businessObjectType: 'oracle.apps.financials.receivables.transactionSetup.paymentTerms.uiModel.view.CreatePaymentTermAuditVO',
        isSupported: true
      }
    ]
  },

  // 12. Service
  {
    targetId: 'service',
    productId: '08C1ABF048177E22E050F00A1720179C',
    instanceProductName: 'ORA_SERVICE',
    restProduct: 'ORA_SERVICE',
    businessObjects: [
      {
        displayName: 'Service Request',
        productId: '08C1ABF048177E22E050F00A1720179C',
        businessObjectType: 'oracle.apps.crm.service.svcMgmt.srMgmt.srMgmtService.view.ServiceRequestVO',
        isSupported: true
      },
      {
        displayName: 'Category',
        productId: '08C1ABF048177E22E050F00A1720179C',
        businessObjectType: 'oracle.apps.crm.service.svcMgmt.srMgmt.srMgmtService.view.SrCategoryVO',
        isSupported: true
      },
      {
        displayName: 'Service Request Reference',
        productId: '08C1ABF048177E22E050F00A1720179C',
        businessObjectType: 'oracle.apps.crm.service.svcMgmt.srMgmt.srMgmtService.view.SrReferencesVO',
        isSupported: true
      }
    ]
  },

  // 18. Risks and Controls (RACM / RMC)
  {
    targetId: 'risks_and_controls',
    productId: 'ACB976486A76EF21E0401490D3C5320F',
    instanceProductName: 'RMC',
    restProduct: 'RMC',
    requiresBusinessObjectType: true,
    businessObjects: [
      {
        displayName: 'Advanced Controls',
        productId: 'ACB976486A76EF21E0401490D3C5320F',
        businessObjectType: 'oracle.apps.gtg.ac.uiModel.control.protectedModel.view.AuditAdvancedControlVO',
        isSupported: true
      }
    ]
  }
];

let appliedProds = 0;
let appliedBOs = 0;

updates.forEach(u => {
  const prod = catalog.find(p => p.id === u.targetId);
  if (!prod) {
    console.warn(`Product matching targetId ${u.targetId} not found!`);
    return;
  }

  appliedProds++;
  if (u.productId !== undefined && u.productId !== null) prod.productId = u.productId;
  if (u.instanceProductName) prod.instanceProductName = u.instanceProductName;
  if (u.restProduct) prod.restProduct = u.restProduct;
  if (u.requiresBusinessObjectType !== undefined) prod.requiresBusinessObjectType = u.requiresBusinessObjectType;

  if (!prod.businessObjects) prod.businessObjects = [];

  u.businessObjects.forEach(newBo => {
    let existingBo = prod.businessObjects.find(
      b => b.displayName.trim().toLowerCase() === newBo.displayName.trim().toLowerCase()
    );

    const boId = newBo.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    const payloadTemplate = {
      productId: newBo.productId || prod.productId || undefined,
      product: prod.instanceProductName || prod.restProduct || undefined,
      businessObjectType: newBo.businessObjectType,
      eventType: 'ALL',
      timeZone: 'UTC',
      includeChildObjects: newBo.includeChildObjects || 'true',
      includeImpersonator: 'false',
      includeExtendedObjectIdentiferColumns: 'true',
      includeAttributes: 'true',
      attributeDetailMode: 'true'
    };

    if (!existingBo) {
      existingBo = {
        id: boId,
        displayName: newBo.displayName,
        isSupported: newBo.isSupported !== false,
        status: newBo.isSupported !== false ? 'SUPPORTED' : 'UNSUPPORTED',
        restBusinessObjectType: newBo.businessObjectType,
        restValue: newBo.businessObjectType,
        payloadTemplate,
        aliases: [newBo.displayName, boId]
      };
      prod.businessObjects.push(existingBo);
    } else {
      existingBo.isSupported = newBo.isSupported !== false;
      existingBo.status = newBo.isSupported !== false ? 'SUPPORTED' : 'UNSUPPORTED';
      existingBo.restBusinessObjectType = newBo.businessObjectType;
      existingBo.restValue = newBo.businessObjectType;
      existingBo.payloadTemplate = payloadTemplate;
    }
    appliedBOs++;
  });
});

console.log(`Successfully applied authoritative payloads: ${appliedProds} products, ${appliedBOs} business objects.`);

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
console.log(`Updated: ${catalogPath}`);

if (fs.existsSync(distCatalogPath)) {
  fs.writeFileSync(distCatalogPath, JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`Updated: ${distCatalogPath}`);
}
