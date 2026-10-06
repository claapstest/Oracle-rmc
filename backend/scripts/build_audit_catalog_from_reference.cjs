const fs = require('fs');
const path = require('path');

// Authoritative Reference Table from User Request (78 entries)
const referenceData = [
  {
    sno: 1,
    name: "Pages and Business Objects Extensibility (ADF)",
    shortCodes: ["ADF"],
    instanceBOList: [],
    instanceProductName: "ADF",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-22",
      product: "ADF",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.fnd.applcore.flex.model.view.FlexFieldUsageVO"
    }
  },
  {
    sno: 2,
    name: "Oracle Enterprise Scheduler Service",
    shortCodes: ["ESS"],
    instanceBOList: [],
    instanceProductName: "ESS",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-22",
      product: "ESS",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.fnd.applcore.flex.model.view.FlexFieldUsageVO"
    }
  },
  {
    sno: 3,
    name: "Oracle Platform Security Services",
    shortCodes: ["OPSS"],
    instanceBOList: [],
    instanceProductName: "OPSS",
    isMiddleware: true,
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-22",
      product: "OPSS",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.fnd.applcore.flex.model.view.FlexFieldUsageVO"
    }
  },
  {
    sno: 4,
    name: "Oracle SOA Suite (SOA)",
    shortCodes: ["SOA"],
    instanceBOList: [],
    instanceProductName: "SOA",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-22",
      product: "SOA",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.fnd.applcore.flex.model.view.FlexFieldUsageVO"
    }
  },
  {
    sno: 5,
    name: "Oracle Data Integrator (ODI)",
    shortCodes: ["ODI"],
    instanceBOList: [],
    instanceProductName: "ODI",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-22",
      product: "ODI",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.fnd.applcore.flex.model.view.FlexFieldUsageVO"
    }
  },
  {
    sno: 6,
    name: "Oracle Metadata Services (MDS)",
    shortCodes: ["MDS"],
    instanceBOList: [],
    instanceProductName: "MDS",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-22",
      product: "MDS",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.fnd.applcore.flex.model.view.FlexFieldUsageVO"
    }
  },
  {
    sno: 7,
    name: "Oracle Business Intelligence Enterprise Edition",
    shortCodes: ["OBIEE"],
    instanceBOList: [],
    instanceProductName: "OBIEE",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-22",
      product: "OBIEE",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: ""
    }
  },
  {
    sno: 8,
    name: "Audit Policies",
    shortCodes: ["ORA_FND_AUDIT_POLICY"],
    instanceBOList: [
      "Oracle Fusion business objects and attributes",
      "Pages and business object modifications",
      "Oracle Enterprise Scheduling Service",
      "Oracle Metadata Services",
      "Oracle Data Integrator",
      "Oracle Platform Security Services",
      "Oracle SOA Suite"
    ],
    instanceProductName: "ORA_FND_AUDIT_POLICY",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-22",
      product: "ORA_FND_AUDIT_POLICY",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "ORA_FND_FA_BO"
    }
  },
  {
    sno: 9,
    name: "AI",
    shortCodes: ["AI"],
    instanceBOList: [],
    instanceProductName: "AI",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-22",
      product: "AI",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.fnd.applcore.flex.model.view.FlexFieldUsageVO"
    }
  },
  {
    sno: 10,
    name: "Absence Management",
    shortCodes: ["ANC"],
    instanceBOList: [],
    instanceProductName: "ANC",
    errorState: true
  },
  {
    sno: 11,
    name: "Advanced Collections",
    shortCodes: ["IEX"],
    instanceBOList: [],
    instanceProductName: "IEX",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-22",
      product: "IEX",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.fnd.applcore.flex.model.view.FlexFieldUsageVO"
    }
  },
  {
    sno: 12,
    name: "Applications Common Components",
    shortCodes: ["ACR"],
    instanceBOList: ["Account", "Contact"],
    instanceProductName: "customer",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-25",
      productId: "47110F64ABFD08E2E040449823C60DB6",
      eventType: "ALL",
      businessObjectType: "oracle.apps.cdm.foundation.parties.organizationService.view.OrganizationDVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  {
    sno: 13,
    name: "Assets",
    shortCodes: ["OFA", "FA"],
    instanceBOList: [],
    instanceProductName: "OFA",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-22",
      product: "OFA",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.fnd.applcore.flex.model.view.FlexFieldUsageVO"
    }
  },
  {
    sno: 14,
    name: "Benefits",
    shortCodes: ["BEN"],
    instanceBOList: [],
    instanceProductName: "BEN",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-22",
      product: "BEN",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.fnd.applcore.flex.model.view.FlexFieldUsageVO"
    }
  },
  {
    sno: 15,
    name: "Bill Management",
    shortCodes: ["BILL"],
    instanceBOList: [],
    instanceProductName: "BILL",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-22",
      product: "BILL",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "Bill"
    }
  },
  {
    sno: 16,
    name: "Budgetary Control",
    shortCodes: ["XCC"],
    instanceBOList: [],
    instanceProductName: "XCC",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-25",
      product: "XCC",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.financials.generalLedger.calendars.accounting.uiModel.view.PeriodStatusAuditVO"
    }
  },
  {
    sno: 17,
    name: "CRM Application Composer",
    shortCodes: ["CRM"],
    instanceBOList: [],
    instanceProductName: "CRM",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-25",
      product: "CRM",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.financials.generalLedger.calendars.accounting.uiModel.view.PeriodStatusAuditVO"
    }
  },
  {
    sno: 18,
    name: "Campus Community",
    shortCodes: ["ORA_CAMPUSCOMMUNITY"],
    instanceBOList: [],
    instanceProductName: "ORA_CAMPUSCOMMUNITY",
    payload: {
      fromDate: "2026-09-28",
      toDate: "2026-09-28",
      productId: "F72168F6CC3A391AE040F00A17205E86",
      eventType: "ALL",
      businessObjectType: "oracle.apps.hed.campusCommunity.calendar.model.r131805.view.SystemCalendarVO",
      timeZone: "UTC",
      attributeDetailMode: "true",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      includeImpersonator: "false",
      includeChildObjects: "true"
    }
  },
  {
    sno: 19,
    name: "Cash Management",
    shortCodes: ["CE"],
    instanceBOList: [],
    instanceProductName: "CE",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-25",
      product: "CE",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.financials.generalLedger.calendars.accounting.uiModel.view.PeriodStatusAuditVO"
    }
  },
  {
    sno: 20,
    name: "Common CRM",
    shortCodes: ["CRM"],
    instanceBOList: [
      "Account",
      "Household",
      "Contact",
      "Account Extension Base"
    ],
    instanceProductName: "sales",
    payload: {
      fromDate: "2026-09-23",
      toDate: "2026-09-23",
      productId: "47110F64ABF608E2E040449823C60DB6",
      eventType: "ALL",
      businessObjectType: "oracle.apps.cdm.foundation.parties.organizationService.view.OrganizationDVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  { sno: 21, name: "Common Work Execution", shortCodes: [], instanceBOList: [], errorState: true },
  { sno: 22, name: "Common Work Setup", shortCodes: [], instanceBOList: [], errorState: true },
  {
    sno: 23,
    name: "Compensation",
    shortCodes: ["CMP"],
    instanceBOList: ["Salary", "Salary Component"],
    instanceProductName: "HcmCompensation",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-26",
      productId: "47110F64AC1D08E2E040449823C60DB6",
      eventType: "ALL",
      businessObjectType: "oracle.apps.hcm.compensation.salary.core.protectedUiModel.view.SalaryAuditVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  { sno: 24, name: "E-Signatures and E-Records", shortCodes: [], instanceBOList: [], errorState: true },
  { sno: 25, name: "Employee Wellness", shortCodes: [], instanceBOList: [], errorState: true },
  { sno: 26, name: "Enterprise Contracts", shortCodes: ["OKC"], instanceBOList: [], errorState: true },
  { sno: 27, name: "Expenses", shortCodes: ["EXM"], instanceBOList: [], errorState: true },
  {
    sno: 28,
    name: "Financials Common Module",
    shortCodes: ["FUN"],
    instanceBOList: [
      "Sequences Assignment",
      "Sequences Context",
      "Sequences Header",
      "Sequences Version",
      "Intercompany Rule Setup",
      "Additional Intercompany Balancing and Clearing Options Setup",
      "Organization Setup",
      "Customer and Supplier Association Setup",
      "Receivables Assignment Setup",
      "System Option Setup",
      "Transaction Type Setup",
      "User Role Data Assignments"
    ],
    instanceProductName: "FinancialCommon / Ledger",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-26",
      productId: "47110F64AC0808E2E040449823C60DB6",
      eventType: "ALL",
      businessObjectType: "oracle.apps.financials.commonModules.accountingSequencing.uiModel.view.SeqAssignmentAuditVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  { sno: 29, name: "Financials for Regional Localizations", shortCodes: ["JG"], instanceBOList: [], errorState: true },
  { sno: 30, name: "Financials for the Americas", shortCodes: ["JL"], instanceBOList: [], errorState: true },
  {
    sno: 31,
    name: "General Ledger",
    shortCodes: ["Ledger", "GL"],
    instanceBOList: ["Period Status", "Combinations", "Combination Set"],
    instanceProductName: "Ledger",
    payload: {
      fromDate: "2026-09-11",
      toDate: "2026-09-22",
      product: "Ledger",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.financials.generalLedger.calendars.accounting.uiModel.view.PeriodStatusAuditVO"
    }
  },
  {
    sno: 32,
    name: "Global Human Resources",
    shortCodes: ["PER", "HCM"],
    instanceBOList: [
      "Document Records",
      "Person",
      "Person Allocated Checklist Tasks",
      "Worker Assignment Grade Step",
      "Worker Assignment Supervisor",
      "Worker Assignment Work Measure",
      "Worker Assignment",
      "Worker Work Term",
      "Worker Employment Contract",
      "Worker Relationship",
      "Person Address",
      "Person Citizenship",
      "Person Contact",
      "Person Other Communication Methods",
      "Person Detail",
      "Person Drivers License",
      "Person Email",
      "Person Ethnicity",
      "Person Image",
      "Person Legislative Information",
      "Person Name",
      "Person National Identifier",
      "Person Passport",
      "Person Phone",
      "Person Religion",
      "Person Type Usage",
      "Person Visa",
      "Person Disability",
      "Security Profiles",
      "Data Role",
      "Grade Step Rate Value"
    ],
    instanceProductName: "hcmCoreSetup / hcmCore",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-26",
      productId: "47110F64AC2A08E2E040449823C60DB6",
      eventType: "ALL",
      businessObjectType: "oracle.apps.hcm.documentsOfRecord.core.protectedUiModel.view.DocumentsOfRecordVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  {
    sno: 33,
    name: "Global Payroll",
    shortCodes: ["PAY"],
    instanceBOList: ["Element Entry", "Element Entry Value", "Personal Payment Method"],
    instanceProductName: "HcmPayroll",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-25",
      productId: "47110F64AC2908E2E040449823C60DB6",
      eventType: "ALL",
      businessObjectType: "oracle.apps.hcm.payrolls.core.audit.model.view.ElementEntryDVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  { sno: 34, name: "Goal Management", shortCodes: ["HRG"], instanceBOList: [], instanceProductName: "HRG" },
  { sno: 35, name: "Grants Management", shortCodes: ["PJF"], instanceBOList: [], instanceProductName: "PJF" },
  {
    sno: 36,
    name: "HCM Common Architecture",
    shortCodes: ["HCM", "HCA"],
    instanceBOList: ["Configure HCM Data Loader Parameters"],
    instanceProductName: "HCM",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-22",
      product: "HCM",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.hcm.common.core.uiModel.view.HcmDataLoaderParamVO"
    }
  },
  { sno: 37, name: "Incentive Compensation", shortCodes: ["CN"], instanceBOList: [], instanceProductName: "CN" },
  {
    sno: 38,
    name: "Inventory Management",
    shortCodes: ["INV"],
    instanceBOList: [
      "invStockLocators",
      "invLotsAndSerials",
      "invSubinventories",
      "invInterOrgParameters",
      "invInterSubParameters"
    ],
    instanceProductName: "INV",
    payload: {
      fromDate: "2026-09-28",
      toDate: "2026-09-28",
      productId: "47110F64AC8A08E2E040449823C60DB6",
      eventType: "ALL",
      businessObjectType: "oracle.apps.scm.inventory.coreSetup.stockLocators.protectedModel.view.InventoryLocatorAuditVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  { sno: 39, name: "Joint Venture Management", shortCodes: ["JVM"], instanceBOList: [], instanceProductName: "JVM" },
  { sno: 40, name: "Lease Accounting", shortCodes: ["OKL"], instanceBOList: [], instanceProductName: "OKL" },
  { sno: 41, name: "Legal Entity Configurator", shortCodes: ["XLE"], instanceBOList: [], instanceProductName: "XLE" },
  { sno: 42, name: "Loyalty", shortCodes: ["LOY"], instanceBOList: [], instanceProductName: "LOY" },
  { sno: 43, name: "Marketing", shortCodes: ["MKT"], instanceBOList: [], instanceProductName: "MKT" },
  {
    sno: 44,
    name: "Oracle Middleware Extensions for Applications",
    shortCodes: ["FND"],
    instanceBOList: [
      "Key Flexfield",
      "Descriptive Flexfield Secondary Usage",
      "Descriptive Flexfield",
      "RelatedValueSetVO",
      "RelatedValueSetValueVO",
      "Value Set",
      "Value Set Value"
    ],
    instanceProductName: "fndSetup",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-24",
      productId: "40B3FA7250D19380E040449823C67A1A",
      eventType: "ALL",
      businessObjectType: "oracle.apps.fnd.applcore.flex.kff.keyFlexfieldService.view.KeyFlexfieldVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  { sno: 45, name: "Partner Management", shortCodes: ["ZPM"], instanceBOList: [], errorState: true },
  { sno: 46, name: "Payables", shortCodes: ["AP", "SQLAP"], instanceBOList: ["Invoice", "Payment", "Supplier"], instanceProductName: "AP" },
  { sno: 47, name: "Payments", shortCodes: ["IBY"], instanceBOList: ["Payment", "Payment Process Request"], instanceProductName: "IBY" },
  {
    sno: 48,
    name: "Performance Management",
    shortCodes: ["PER"],
    instanceBOList: ["Evaluation Item Ratings", "Evaluation Section Ratings"],
    instanceProductName: "HcmTalent",
    payload: {
      fromDate: "2026-09-25",
      toDate: "2026-09-25",
      productId: "47110F64AC2108E2E040449823C60DB6",
      eventType: "ALL",
      businessObjectType: "oracle.apps.hcm.performance.documents.protectedUiModel.view.EvalItemRatingAuditVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  {
    sno: 49,
    name: "Product Hub",
    shortCodes: ["EGP"],
    instanceBOList: [
      "Value Set",
      "Change Object Attachments",
      "Affected Objects",
      "Change Object",
      "Change Object Tasks",
      "Destination Change Object",
      "Source Change Object",
      "Item Extensible Flexfield",
      "Item Revision Extensible Flexfield",
      "Manufacturer Item Relationship",
      "Linked MPN Relationships",
      "Item Supplier Extensible Flexfield",
      "Linked Supplier Item Relationships",
      "Supplier Item Relationship",
      "Item Revision Attachments",
      "Item Attachments",
      "Item",
      "Structure Attachments",
      "Item Structure Component",
      "Item Structure",
      "Manufacturer Items"
    ],
    instanceProductName: "egpItemSearch",
    payload: {
      fromDate: "2026-09-25",
      toDate: "2026-09-25",
      productId: "47110F64AC8108E2E040449823C60DB6",
      eventType: "ALL",
      businessObjectType: "oracle.apps.fnd.applcore.flex.vst.valueSetService.view.ValueSetVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  {
    sno: 50,
    name: "Profile Management",
    shortCodes: ["PER"],
    instanceBOList: [
      "Content Items",
      "Rating Levels",
      "Rating Models",
      "Model Profile Items",
      "Person Profile Items",
      "Profile Keywords",
      "Talent Pool Members",
      "Profile Type Section Properties"
    ],
    instanceProductName: "HcmTalent",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-24",
      productId: "47110F64AC2308E2E040449823C60DB6",
      eventType: "ALL",
      businessObjectType: "oracle.apps.hcm.profiles.contentLibrary.uiModel.view.ContentItemAuditVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  { sno: 51, name: "Project Foundation", shortCodes: ["PJF"], instanceBOList: [], instanceProductName: "PJF" },
  {
    sno: 52,
    name: "Public Sector Common Components",
    shortCodes: ["PSB"],
    instanceBOList: [
      "Trading Community Customer Billing Account",
      "Household",
      "Account",
      "Contact",
      "Account Extension Base",
      "Business",
      "Locations",
      "Owners"
    ],
    instanceProductName: "Public Sector Common Components",
    payload: {
      fromDate: "2026-09-24",
      toDate: "2026-09-24",
      productId: "5AE4C38131A16D3AE0531720F00A9CE7",
      eventType: "ALL",
      businessObjectType: "oracle.apps.cdm.foundation.parties.customerAccountService.view.CustomerAccountVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  {
    sno: 53,
    name: "Quality Issue and Action Management",
    shortCodes: ["QIM"],
    instanceBOList: ["Quality Issue Attachment", "Quality Issue"],
    instanceProductName: "enqActions",
    payload: {
      fromDate: "2026-09-24",
      toDate: "2026-09-24",
      productId: "13BFA4ABD1ACDBA4E050F00A17206E1D",
      eventType: "ALL",
      businessObjectType: "oracle.apps.scm.enterpriseQualityManagement.issues.publicUiModel.view.IssueAttachmentAuditVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  {
    sno: 54,
    name: "Receivables",
    shortCodes: ["AR"],
    instanceBOList: ["Trading Community Customer Billing Account"],
    instanceProductName: "Receivables",
    payload: {
      fromDate: "2026-09-24",
      toDate: "2026-09-24",
      productId: "47110F64AC0408E2E040449823C60DB6",
      eventType: "ALL",
      businessObjectType: "oracle.apps.cdm.foundation.parties.customerAccountService.view.CustomerAccountVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  { sno: 55, name: "Receiving", shortCodes: ["RCV"], instanceBOList: [], instanceProductName: "RCV" },
  { sno: 56, name: "Recruiting", shortCodes: ["IRC"], instanceBOList: [], instanceProductName: "IRC" },
  { sno: 57, name: "Revenue Management", shortCodes: ["ORA-REV"], instanceBOList: [], instanceProductName: "ORA-REV" },
  { sno: 58, name: "Risks and Controls", shortCodes: ["RACM", "RMC"], instanceBOList: ["Advanced Controls", "Entitlements", "Global Conditions", "Global Users", "User Groups", "Business Object Security"], instanceProductName: "RMC" },
  { sno: 59, name: "Sales", shortCodes: ["ZSF", "CRM"], instanceBOList: [], instanceProductName: "ZSF" },
  {
    sno: 60,
    name: "Sales Catalog",
    shortCodes: ["QSC"],
    instanceBOList: ["Product", "Item Attachments"],
    instanceProductName: "sales",
    payload: {
      fromDate: "2026-09-28",
      toDate: "2026-09-28",
      productId: "47110F64ABF408E2E040449823C60DB6",
      eventType: "ALL",
      businessObjectType: "oracle.apps.orderCapture.product.productService.view.ProductVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  { sno: 61, name: "Sales for Communications", shortCodes: [], instanceBOList: [], errorState: true },
  {
    sno: 62,
    name: "Service",
    shortCodes: ["CS"],
    instanceBOList: [
      "Work Order",
      "Queue",
      "Service Request",
      "Category",
      "Service Request Reference"
    ],
    instanceProductName: "ORA_SERVICE",
    payload: {
      fromDate: "2026-09-28",
      toDate: "2026-09-28",
      productId: "08C1ABF048177E22E050F00A1720179C",
      eventType: "ALL",
      businessObjectType: "oracle.apps.crm.service.fieldservice.workOrderService.view.WorkOrderVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  {
    sno: 63,
    name: "Sourcing",
    shortCodes: ["PON"],
    instanceBOList: ["Supplier Negotiation"],
    instanceProductName: "procurement",
    payload: {
      fromDate: "2026-09-27",
      toDate: "2026-09-27",
      productId: "47110F64AC6408E2E040449823C60DB6",
      eventType: "ALL",
      businessObjectType: "oracle.apps.prc.pon.commonPon.protectedModel.view.AuditNegotiationCreationHeaderVO",
      timeZone: "UTC",
      includeChildObjects: "true",
      includeImpersonator: "false",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      attributeDetailMode: "true"
    }
  },
  { sno: 64, name: "Student Admissions", shortCodes: ["SAD"], instanceBOList: [], instanceProductName: "SAD" },
  { sno: 65, name: "Student Financials", shortCodes: ["SFA"], instanceBOList: [], instanceProductName: "SFA" },
  {
    sno: 66,
    name: "Student Records",
    shortCodes: ["SSR"],
    instanceBOList: [
      "Account",
      "Contact",
      "External Organization Accrediting Entity",
      "External Organization Location",
      "External Organization Contact",
      "External Organization Identifier",
      "External Organization Tag",
      "External Organization"
    ],
    instanceProductName: "ORA_RECORDSMANAGEMENT",
    payload: {
      fromDate: "2026-09-27",
      toDate: "2026-09-27",
      productId: "F72168F6CC3D391AE040F00A17205E86",
      eventType: "ALL",
      businessObjectType: "oracle.apps.cdm.foundation.parties.organizationService.view.OrganizationDVO",
      timeZone: "UTC",
      attributeDetailMode: "true",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      includeImpersonator: "false",
      includeChildObjects: "true"
    }
  },
  { sno: 67, name: "Subledger Accounting", shortCodes: ["XLA"], instanceBOList: ["Journal Entry Rule Set Assignment Audit"], instanceProductName: "XLA" },
  {
    sno: 68,
    name: "Subscription Management",
    shortCodes: ["OSS"],
    instanceBOList: ["Subscription Product", "Subscription"],
    instanceProductName: "ORA_CRM_UI",
    payload: {
      fromDate: "2026-09-27",
      toDate: "2026-09-27",
      productId: "6441A454211447B1E0531720F00A79D9",
      eventType: "ALL",
      businessObjectType: "oracle.apps.subscriptions.subscriptionManagement.subscriptionService.view.ProductsVO",
      timeZone: "UTC",
      attributeDetailMode: "true",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      includeImpersonator: "false",
      includeChildObjects: "true"
    }
  },
  { sno: 69, name: "Succession Management", shortCodes: ["PER"], instanceBOList: [], instanceProductName: "PER" },
  {
    sno: 70,
    name: "Supplier Model",
    shortCodes: ["POS"],
    instanceBOList: ["Supplier Negotiation"],
    instanceProductName: "procurement",
    payload: {
      fromDate: "2026-09-28",
      toDate: "2026-09-28",
      productId: "47110F64AC6708E2E040449823C60DB6",
      eventType: "ALL",
      businessObjectType: "oracle.apps.prc.poz.suppliers.protectedModel.core.view.AuditSupplierVO",
      timeZone: "UTC",
      attributeDetailMode: "true",
      includeExtendedObjectIdentiferColumns: "true",
      includeAttributes: "true",
      includeImpersonator: "false",
      includeChildObjects: "true"
    }
  },
  {
    sno: 71,
    name: "Supply Chain Management Common Components",
    shortCodes: ["RCS"],
    instanceBOList: [
      "Locator",
      "Retail License Individual Owner",
      "Accessory Dwelling Unit Permit",
      "PreApplication"
    ],
    instanceProductName: "RCS"
  },
  { sno: 72, name: "Tax", shortCodes: ["ZX"], instanceBOList: [], instanceProductName: "ZX" },
  { sno: 73, name: "Territory Management", shortCodes: ["JTM"], instanceBOList: [], instanceProductName: "JTM" },
  { sno: 74, name: "Time and Labor", shortCodes: ["HXT", "TLM"], instanceBOList: [], instanceProductName: "HXT" },
  { sno: 75, name: "Trading Community Model", shortCodes: ["HZ"], instanceBOList: [], instanceProductName: "HZ" },
  { sno: 76, name: "U.S. Federal Financials", shortCodes: ["FV"], instanceBOList: [], instanceProductName: "FV" },
  {
    sno: 77,
    name: "Workforce Health and Safety Incidents",
    shortCodes: ["HNS"],
    instanceBOList: [],
    instanceProductName: "HNS",
    payload: {
      fromDate: "2026-09-11",
      toDate: "2026-09-22",
      product: "HNS",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "oracle.apps.financials.generalLedger.calendars.accounting.uiModel.view.PeriodStatusAuditVO"
    }
  },
  {
    sno: 78,
    name: "Workforce Scheduling",
    shortCodes: ["WFM"],
    instanceBOList: ["Value set"],
    instanceProductName: "WFM",
    payload: {
      fromDate: "2026-09-01",
      toDate: "2026-09-25",
      product: "WFM",
      eventType: "ALL",
      timeZone: "UTC",
      includeChildObjects: "false",
      includeImpersonator: "false",
      includeAttributes: "false",
      attributeDetailMode: "false",
      includeExtendedObjectIdentiferColumns: "false",
      businessObjectType: "Work Shift"
    }
  }
];

function generateId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Convert each item into the canonical AuditProduct structure
const catalog = referenceData.map(ref => {
  const pId = ref.sno === 3 ? 'opss' : ref.sno === 32 ? 'hcm' : generateId(ref.name);
  const requiresBO = ref.isMiddleware ? false : (ref.instanceBOList.length > 0 || (ref.payload && ref.payload.businessObjectType ? true : false));

  // Build Business Objects:
  // Source is exclusively the instance business-object list!
  const businessObjects = [];

  if (ref.instanceBOList && ref.instanceBOList.length > 0) {
    ref.instanceBOList.forEach((boName, idx) => {
      const boId = generateId(boName);
      // FIRST business object is supported IF a tested payload exists
      const isFirst = (idx === 0);
      const isSupported = isFirst && !!ref.payload;
      
      const boObj = {
        id: boId,
        displayName: boName,
        isSupported: isSupported,
        status: isSupported ? 'SUPPORTED' : 'UNSUPPORTED',
        aliases: [boName, boId]
      };

      if (isSupported && ref.payload) {
        boObj.restBusinessObjectType = ref.payload.businessObjectType;
        boObj.restValue = ref.payload.businessObjectType;
        boObj.payloadTemplate = {
          productId: ref.payload.productId,
          product: ref.payload.product,
          businessObjectType: ref.payload.businessObjectType,
          timeZone: ref.payload.timeZone || 'UTC',
          includeChildObjects: ref.payload.includeChildObjects || 'true',
          includeImpersonator: ref.payload.includeImpersonator || 'false',
          includeAttributes: ref.payload.includeAttributes || 'true',
          attributeDetailMode: ref.payload.attributeDetailMode || 'true',
          includeExtendedObjectIdentiferColumns: ref.payload.includeExtendedObjectIdentiferColumns || 'true'
        };
      }

      // Backward-compatibility: if this is Global Human Resources (sno 32) and the item is "Person",
      // configure Person with ManagePersonVO so legacy Person queries still resolve!
      if (ref.sno === 32 && boName.toLowerCase() === 'person') {
        boObj.isSupported = true;
        boObj.status = 'SUPPORTED';
        boObj.restBusinessObjectType = 'oracle.apps.hcm.people.core.uiModel.view.ManagePersonVO';
        boObj.restValue = 'oracle.apps.hcm.people.core.uiModel.view.ManagePersonVO';
        boObj.payloadTemplate = {
          product: 'hcmCore',
          businessObjectType: 'oracle.apps.hcm.people.core.uiModel.view.ManagePersonVO',
          includeChildObjects: 'true',
          includeImpersonator: 'true',
          includeAttributes: 'true',
          attributeDetailMode: 'true',
          includeExtendedObjectIdentiferColumns: 'true'
        };
      }

      businessObjects.push(boObj);
    });
  } else if (ref.payload && ref.payload.businessObjectType && !ref.isMiddleware) {
    // If instanceBOList is empty (NA), but a payload exists with a businessObjectType,
    // configure a standard business object with the tested payload
    const boName = ref.payload.businessObjectType.includes('.')
      ? ref.payload.businessObjectType.split('.').pop().replace(/VO$/, '')
      : (ref.payload.businessObjectType || 'Standard Object');
    const boId = generateId(boName);
    businessObjects.push({
      id: boId,
      displayName: boName,
      isSupported: true,
      status: 'SUPPORTED',
      restBusinessObjectType: ref.payload.businessObjectType,
      restValue: ref.payload.businessObjectType,
      payloadTemplate: {
        productId: ref.payload.productId,
        product: ref.payload.product,
        businessObjectType: ref.payload.businessObjectType,
        timeZone: ref.payload.timeZone || 'UTC',
        includeChildObjects: ref.payload.includeChildObjects || 'false',
        includeImpersonator: ref.payload.includeImpersonator || 'false',
        includeAttributes: ref.payload.includeAttributes || 'false',
        attributeDetailMode: ref.payload.attributeDetailMode || 'false',
        includeExtendedObjectIdentiferColumns: ref.payload.includeExtendedObjectIdentiferColumns || 'false'
      },
      aliases: [boName, boId]
    });
  }

  const shortCodes = ref.shortCodes || [];
  const aliases = [
    ref.name,
    ref.instanceProductName,
    ...shortCodes,
    pId
  ].filter(Boolean);

  const productObj = {
    sno: ref.sno,
    id: pId,
    displayName: `${ref.name}${shortCodes.length > 0 ? ` (${shortCodes.join(' / ')})` : ''}`,
    productName: ref.name,
    shortCodes: shortCodes,
    aliases: Array.from(new Set(aliases)),
    instanceProductName: ref.instanceProductName || shortCodes[0] || ref.name,
    restProduct: ref.sno === 3 ? 'OPSS' : (ref.payload?.product || ref.instanceProductName || shortCodes[0] || null),
    productId: ref.payload?.productId || null,
    mappingStatus: ref.errorState ? 'UNRESOLVED' : 'CONFIRMED',
    requiresBusinessObjectType: requiresBO,
    businessObjects: businessObjects
  };

  // If this product has a default payload template (like OPSS or single-object products)
  if (ref.payload) {
    productObj.defaultPayloadTemplate = {
      productId: ref.payload.productId,
      product: ref.payload.product,
      businessObjectType: ref.payload.businessObjectType,
      timeZone: ref.payload.timeZone || 'UTC',
      includeChildObjects: ref.payload.includeChildObjects || 'false',
      includeImpersonator: ref.payload.includeImpersonator || 'false',
      includeAttributes: ref.payload.includeAttributes || 'false',
      attributeDetailMode: ref.payload.attributeDetailMode || 'false',
      includeExtendedObjectIdentiferColumns: ref.payload.includeExtendedObjectIdentiferColumns || 'false'
    };
  }

  return productObj;
});

const outputPath = path.resolve(__dirname, '../src/config/auditProductCatalog.json');
fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2), 'utf-8');
console.log(`Successfully generated ${catalog.length} products to ${outputPath}`);
