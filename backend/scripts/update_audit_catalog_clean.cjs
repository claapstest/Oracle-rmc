const fs = require('fs');
const path = require('path');

// Raw user table parsed into structured data
const rawData = [
  { sno: 1, name: "Pages and Business Objects Extensibility (ADF)", code: "ADF", boDesc: "Custom Metadata Operations", boList: "NA" },
  { sno: 2, name: "Oracle Enterprise Scheduler Service", code: "ESS", boDesc: "Job Request", boList: "NA" },
  { sno: 3, name: "Oracle Platform Security Services", code: "OPSS", boDesc: "N/A – Middleware Audit Events", boList: "NA" },
  { sno: 4, name: "Oracle SOA Suite (SOA)", code: "SOA", boDesc: "SOA DT@RT Change", boList: "NA" },
  { sno: 5, name: "Oracle Data Integrator (ODI)", code: "ODI", boDesc: "FirstClassObject", boList: "NA" },
  { sno: 6, name: "Oracle Metadata Services (MDS)", code: "MDS", boDesc: "Metadata Objects / Metadata Operations", boList: "NA" },
  { sno: 7, name: "Oracle Business Intelligence Enterprise Edition", code: "OBIEE", boDesc: "ReportAccess", boList: "NA" },
  { sno: 8, name: "Audit Policies", code: "—", boDesc: "Oracle Fusion Business Objects and Attributes", boList: "Pages and business object modifications\nOracle Enterprise Scheduling Service\nOracle Fusion business objects and attributes\nOracle Metadata Services\nOracle Data Integrator\nOracle Platform Security Services\nOracle SOA Suite" },
  { sno: 9, name: "AI", code: "AI", boDesc: "AI Agent / AI Agent Business Object / AI Agent Deep Link / AI Agent Tool / AI Agent Workflow", boList: "NA" },
  { sno: 10, name: "Absence Management", code: "ANC", boDesc: "Absence Records", boList: "NA" },
  { sno: 11, name: "Advanced Collections", code: "IEX", boDesc: "Collections Preferences / Collections Strategies / Customer Case Folders / Customer Collections Strategies", boList: "NA" },
  { sno: 12, name: "Applications Common Components", code: "ACR", boDesc: "Activities", boList: "Account" },
  { sno: 13, name: "Assets", code: "OFA / FA", boDesc: "Asset", boList: "NA" },
  { sno: 14, name: "Benefits", code: "BEN", boDesc: "Program / Plan Type / Plan / Option", boList: "NA" },
  { sno: 15, name: "Bill Management", code: "—", boDesc: "Bill", boList: "NA" },
  { sno: 16, name: "Budgetary Control", code: "XCC", boDesc: "Control Budget", boList: "NA" },
  { sno: 17, name: "CRM Application Composer", code: "CRM", boDesc: "Application Composer Metadata", boList: "NA" },
  { sno: 18, name: "Campus Community", code: "—", boDesc: "Person", boList: "NA" },
  { sno: 19, name: "Cash Management", code: "CE", boDesc: "Bank Account", boList: "NA" },
  { sno: 20, name: "Common CRM", code: "CRM", boDesc: "Customer / Contact / Activity", boList: "Household\nAccount\nAccount Extension Base\nSales Account Resource\nSales Account" },
  { sno: 21, name: "Common Work Execution", code: "—", boDesc: "Work Order", boList: "NA" },
  { sno: 22, name: "Common Work Setup", code: "—", boDesc: "Work Center / Work Area", boList: "NA" },
  { sno: 23, name: "Compensation", code: "CMP", boDesc: "Compensation Plan / Individual Compensation", boList: "Salary(0)\nSalary Component (0)" },
  { sno: 24, name: "E-Signatures and E-Records", code: "—", boDesc: "Electronic Signature / Electronic Record", boList: "NA" },
  { sno: 25, name: "Employee Wellness", code: "—", boDesc: "Wellness Program / Wellness Activity", boList: "NA" },
  { sno: 26, name: "Enterprise Contracts", code: "OKC", boDesc: "Contract / Contract Line", boList: "NA" },
  { sno: 27, name: "Expenses", code: "EXM", boDesc: "Expense Report / Expense Item", boList: "NA" },
  { sno: 28, name: "Financials Common Module", code: "FUN", boDesc: "Accounting Configuration / Financial Common Objects", boList: "Sequences Assignment(0)\nSequences Context(0)\nSequences Header(0)\nSequences Version(0)\nIntercompany Rule Setup(0)\nAdditional Intercompany Balancing and Clearing Options Setup(0)\nOrganization Setup(0)\nCustomer and Supplier Association Setup(0)\nReceivables Assignment Setup(0)\nSystem Option Setup(0)\nTransaction Type Setup(0)\nUser Role Data Assignments(0)" },
  { sno: 29, name: "Financials for Regional Localizations", code: "JG", boDesc: "Regionalization / Localization Objects", boList: "NA" },
  { sno: 30, name: "Financials for the Americas", code: "JL", boDesc: "Americas Financial Objects", boList: "NA" },
  { sno: 31, name: "General Ledger", code: "Ledger/GL", boDesc: "Journal / Ledger / Accounting Period", boList: "Accounting Calendar Setup\nPeriod Status\nPeriod Details\nJournal Batch Attachments\nJournal Batch\nJournal Header Attachments\nJournal Header\nJournal Line\nChart of Accounts Options Setup\nCombinations\nCombination Set" },
  { sno: 32, name: "Global Human Resources", code: "PER / HCM", boDesc: "Person / Work Relationship / Assignment", boList: "Document Delivery Preferences\nDocument Records\nPerson Allocated Checklist Tasks(0)\nWorker Assignment Grade Step(0)\nWorker Assignment Supervisor(0)\nWorker Assignment Work Measure(0)\nWorker Assignment(0)\nWorker Work Term(0)\nWorker Employment Contract(0)\nWorker Relationship(0)\nPerson Address(0)\nPerson Citizenship(0)\nPerson Contact(0)\nPerson Other Communication Methods(0)\nPerson Detail(0)\nPerson Drivers License(0)\nPerson Email(0)\nPerson Ethnicity(0)\nPerson Image(0)\nPerson Legislative Information(0)\nPerson Name(0)\nPerson National Identifier(0)\nPerson Passport(0)\nPerson Phone(0)\nPerson Religion(0)\nPerson Type Usage(0)\nPerson(0)\nPerson Visa(0)\nPerson Disability(0)\nSecurity Profiles(0)\nData Role(0)\nGrade Step Rate Value(0)" },
  { sno: 33, name: "Global Payroll", code: "PAY", boDesc: "Payroll / Element / Payroll Relationship", boList: "Element Entry(0)\nElement Entry Value(0)\nPersonal Payment Method (0)" },
  { sno: 34, name: "Goal Management", code: "HRG", boDesc: "Goal", boList: "NA" },
  { sno: 35, name: "Grants Management", code: "PJF", boDesc: "Grant / Award / Project", boList: "NA" },
  { sno: 36, name: "HCM Common Architecture", code: "HCM", boDesc: "Configure HCM Data Loader Parameters", boList: "HCM Data Loader Business Objects Access\nConfigure HCM Data Loader Parameters" },
  { sno: 37, name: "Incentive Compensation", code: "CN", boDesc: "Incentive Compensation Plan / Participant", boList: "NA" },
  { sno: 38, name: "Inventory Management", code: "INV", boDesc: "Inventory Organization / Item / Lot / Serial", boList: "Interorganization Parameter\nLocator\nSubinventory\nLot\nSerial Number" },
  { sno: 39, name: "Joint Venture Management", code: "JVM", boDesc: "Joint Venture / Joint Venture Definition", boList: "NA" },
  { sno: 40, name: "Lease Accounting", code: "OKL", boDesc: "Lease / Lease Contract", boList: "NA" },
  { sno: 41, name: "Legal Entity Configurator", code: "XLE", boDesc: "Legal Entity / Legal Entity Registration", boList: "NA" },
  { sno: 42, name: "Loyalty", code: "LOY", boDesc: "Loyalty Program / Member", boList: "NA" },
  { sno: 43, name: "Marketing", code: "MKT", boDesc: "Campaign / Marketing Activity", boList: "NA" },
  { sno: 44, name: "Oracle Middleware Extensions for Applications", code: "—", boDesc: "Middleware Configuration Objects", boList: "Descriptive Flexfield Secondary Usage(0)\nDescriptive Flexfield(0)\nKey Flexfield(0)\nRelatedValueSetVO(0)\nRelatedValueSetValueVO(0)\nValue Set(0)\nValue Set Value (0)" },
  { sno: 45, name: "Partner Management", code: "ZPM", boDesc: "Partner / Partner Organization", boList: "NA" },
  { sno: 46, name: "Payables", code: "AP / SQLAP", boDesc: "Invoice / Payment / Supplier", boList: "Invoice\nAging Periods\nAging Period Details\nDistribution Sets\nDistribution Set Details\nIncome Tax Regions\nInvoice Holds and Releases\nInvoice Tolerances\nSet Assignments\nPayment Terms\nInstallments\nReporting Entities\nBalancing Segment Values\nBank Charge Details\nInterest Rates\nIntelligent Document Recognition Options\nCommon Options for Payables and Procurement\nGeneral Payables Options\nPeriod Information\nPayables Calendars" },
  { sno: 47, name: "Payments", code: "IBY", boDesc: "Payment / Payment Process Request", boList: "NA" },
  { sno: 48, name: "Performance Management", code: "PER", boDesc: "Performance Document / Performance Goal", boList: "Evaluation Item Ratings(0)\nEvaluation Section Ratings (0)" },
  { sno: 49, name: "Product Hub", code: "EGP", boDesc: "Item / Item Class / Change Order", boList: "Value Set(0)\nChange Object Attachments(0)\nAffected Objects(0)\nChange Object(0)\nChange Object Tasks(0)\nDestination Change Object(0)\nSource Change Object(0)\nItem Extensible Flexfield\nItem Revision Extensible Flexfield(0)\nManufacturer Item Relationship(0)\nLinked MPN Relationships(0)\nItem Supplier Extensible Flexfield(0)\nLinked Supplier Item Relationships(0)\nSupplier Item Relationship(0)\nItem Revision Attachments(0)\nItem Attachments(0)\nItem(0)\nStructure Attachments(0)\nItem Structure Component(0)\nItem Structure(0)\nManufacturer Items(0)" },
  { sno: 50, name: "Profile Management", code: "PER", boDesc: "Talent Profile / Profile Item", boList: "Model Certification Profile Items\nPerson Certification Profile Items\nPerson Skill Profile Items\nContent Items(0)\nRating Levels(0)\nRating Models(0)\nModel Profile Items(0)\nPerson Profile Items(0)\nProfile Keywords(0)\nTalent Pool Members(0)\nProfile Type Section Properties(0)" },
  { sno: 51, name: "Project Foundation", code: "PJF", boDesc: "Project / Project Task", boList: "NA" },
  { sno: 52, name: "Public Sector Common Components", code: "PSB", boDesc: "Public Sector Objects", boList: "Trading Community Customer Billing Account\nHousehold\nAccount\nAccount Extension Base\nBusiness(0)\nLocations(0)\nOwners(0)" },
  { sno: 53, name: "Quality Issue and Action Management", code: "QIM", boDesc: "Quality Issue / Quality Action", boList: "Quality Action Affected Object\nQuality Action Attachment\nDestination Quality Action\nSource Quality Action\nQuality Action\nQuality Issue Affected Object\nQuality Issue Attachment\nDestination Quality Issue\nSource Quality Issue\nQuality Issue" },
  { sno: 54, name: "Receivables", code: "AR", boDesc: "Invoice / Receipt / Customer Account", boList: "Trading Community Customer Billing Account\nReceivables Customer Profile Class Amount\nReceivables Customer Profile Class\nCustomer Profile Amount\nCustomer Profile\nReceivables User Approval Limit\nPayment Terms\nTransaction Interface Lines" },
  { sno: 55, name: "Receiving", code: "RCV", boDesc: "Receipt / Receiving Transaction", boList: "NA" },
  { sno: 56, name: "Recruiting", code: "IRC", boDesc: "Candidate / Job Requisition / Application", boList: "NA" },
  { sno: 57, name: "Revenue Management", code: "ORA-REV", boDesc: "Customer Contract / Revenue Contract", boList: "NA" },
  { sno: 58, name: "Risks and Controls", code: "RACM / RMC", boDesc: "Advanced Controls / Entitlements / Global Conditions / Global Users / User Groups / Business Object Security", boList: "NA" },
  { sno: 59, name: "Sales", code: "ZSF / CRM", boDesc: "Account / Opportunity / Lead", boList: "NA" },
  { sno: 60, name: "Sales Catalog", code: "QSC", boDesc: "Product / Product Group", boList: "Product(0)\nItem Attachments(0)" },
  { sno: 61, name: "Sales for Communications", code: "—", boDesc: "Communication Objects", boList: "NA" },
  { sno: 62, name: "Service", code: "CS", boDesc: "Service Request / Customer", boList: "Queue\nService Request\nCategory\nService Request Reference" },
  { sno: 63, name: "Sourcing", code: "PON", boDesc: "Sourcing Event / Negotiation", boList: "Supplier Negotiation (0)" },
  { sno: 64, name: "Student Admissions", code: "SAD", boDesc: "Admission Application / Applicant", boList: "NA" },
  { sno: 65, name: "Student Financials", code: "SFA", boDesc: "Student Account / Financial Aid", boList: "NA" },
  { sno: 66, name: "Student Records", code: "SSR", boDesc: "Student / Academic Record", boList: "Account\nContact(0)\nExternal Organization Accrediting Entity(0)\nExternal Organization Location(0)\nExternal Organization Contact(0)\nExternal Organization Identifier(0)\nExternal Organization Tag(0)\nExternal Organization(0)" },
  { sno: 67, name: "Subledger Accounting", code: "XLA", boDesc: "Subledger Journal Entry / Accounting Event", boList: "Journal Entry Rule Set Assignment Audit" },
  { sno: 68, name: "Subscription Management", code: "OSS", boDesc: "Subscription / Subscription Product", boList: "Subscription Product(0)\nSubscription(0)" },
  { sno: 69, name: "Succession Management", code: "PER", boDesc: "Succession Plan / Talent Pool", boList: "NA" },
  { sno: 70, name: "Supplier Model", code: "POS", boDesc: "Supplier / Supplier Site / Supplier Bank Account", boList: "Supplier" },
  { sno: 71, name: "Supply Chain Management Common Components", code: "RCS", boDesc: "SCM Common Objects", boList: "Locator\nRetail%20License%20Individual%20Owner(0)\nAccessory Dwelling Unit Permit(0)\nPreApplication(0)" },
  { sno: 72, name: "Tax", code: "ZX", boDesc: "Tax / Tax Regime / Tax Rate", boList: "NA" },
  { sno: 73, name: "Territory Management", code: "JTM", boDesc: "Territory / Territory Hierarchy", boList: "NA" },
  { sno: 74, name: "Time and Labor", code: "HXT / TLM", boDesc: "Time Card / Time Entry", boList: "NA" },
  { sno: 75, name: "Trading Community Model", code: "HZ", boDesc: "Party / Customer / Contact", boList: "NA" },
  { sno: 76, name: "U.S. Federal Financials", code: "FV", boDesc: "Federal Financial Objects", boList: "NA" },
  { sno: 77, name: "Workforce Health and Safety Incidents", code: "HNS", boDesc: "Health and Safety Incident", boList: "NA" },
  { sno: 78, name: "Workforce Scheduling", code: "WFM", boDesc: "Workforce Schedule / Work Shift", boList: "Value set (0)" }
];

// Helper to clean and format display name without duplicate parentheses
function cleanDisplayName(name, code) {
  let cleanName = name.trim();
  const cleanCode = (code || '').trim();

  if (!cleanCode || cleanCode === '—' || cleanCode === 'NA') {
    return cleanName;
  }

  // Split multi-codes like "OFA / FA", "PER / HCM", "Ledger/GL"
  const codes = cleanCode.split(/[\/\,]/).map(c => c.trim()).filter(Boolean);

  // If the product name already contains (CODE) or ends with (CODE), do NOT add another (CODE)!
  const alreadyHasCode = codes.some(c => cleanName.toLowerCase().includes(`(${c.toLowerCase()})`));
  if (alreadyHasCode) {
    return cleanName;
  }

  // If the product name IS the code (e.g. "AI"), don't add (AI)
  if (codes.some(c => cleanName.toLowerCase() === c.toLowerCase())) {
    return cleanName;
  }

  // Format nicely with normalized slash
  const formattedCode = codes.join(' / ');
  return `${cleanName} (${formattedCode})`;
}

// Generate clean id
function generateId(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Load existing catalog to preserve working payload templates and VO details
const existingCatalogPath = path.resolve(__dirname, '../src/config/auditProductCatalog.json');
let existingCatalog = [];
if (fs.existsSync(existingCatalogPath)) {
  try {
    existingCatalog = JSON.parse(fs.readFileSync(existingCatalogPath, 'utf8'));
  } catch (e) {
    console.warn('Could not read existing catalog, starting fresh');
  }
}

const existingMap = new Map();
existingCatalog.forEach(p => {
  existingMap.set(p.sno, p);
});

const updatedCatalog = rawData.map(item => {
  const existing = existingMap.get(item.sno) || {};
  const displayName = cleanDisplayName(item.name, item.code);
  const pId = existing.id || generateId(item.name);

  const shortCodes = (item.code && item.code !== '—' && item.code !== 'NA')
    ? item.code.split(/[\/\,]/).map(c => c.trim()).filter(Boolean)
    : [];

  // Parse BOs from user's instance list:
  // DELETE any business object containing "(0)"!
  let validBOStrings = [];
  if (item.boList && item.boList !== 'NA') {
    validBOStrings = item.boList
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .filter(s => !s.includes('(0)')); // Explicitly filter out (0)!
  }

  const existingBOMap = new Map();
  if (existing.businessObjects) {
    existing.businessObjects.forEach(b => {
      existingBOMap.set(b.displayName.toLowerCase(), b);
    });
  }

  const businessObjects = validBOStrings.map((boName, idx) => {
    const existingBO = existingBOMap.get(boName.toLowerCase());
    const boId = generateId(boName);

    // If it's a known tested business object, keep it supported!
    // Specifically Document Records (GHR), Account (Common), Period Status (GL), etc.
    const isSupported = (existingBO && existingBO.isSupported !== false) || idx === 0;

    return {
      id: boId,
      displayName: boName,
      isSupported: isSupported,
      status: isSupported ? 'SUPPORTED' : 'UNSUPPORTED',
      restBusinessObjectType: existingBO?.restBusinessObjectType || (existing?.defaultPayloadTemplate?.businessObjectType || ''),
      restValue: existingBO?.restValue || (existing?.defaultPayloadTemplate?.businessObjectType || ''),
      payloadTemplate: existingBO?.payloadTemplate || existing?.defaultPayloadTemplate || null,
      aliases: [boName, boId]
    };
  });

  // Preserve OPSS special handling
  const isOPSS = item.sno === 3;
  const requiresBO = isOPSS ? false : businessObjects.length > 0;

  return {
    sno: item.sno,
    id: pId,
    displayName: displayName,
    productName: item.name,
    shortCodes: shortCodes,
    aliases: Array.from(new Set([item.name, ...shortCodes, pId, displayName])).filter(Boolean),
    instanceProductName: existing.instanceProductName || shortCodes[0] || item.name,
    restProduct: existing.restProduct || (isOPSS ? 'OPSS' : (shortCodes[0] || item.name)),
    productId: existing.productId || null,
    mappingStatus: existing.mappingStatus || 'CONFIRMED',
    requiresBusinessObjectType: requiresBO,
    businessObjects: businessObjects,
    defaultPayloadTemplate: existing.defaultPayloadTemplate || null
  };
});

fs.writeFileSync(existingCatalogPath, JSON.stringify(updatedCatalog, null, 2), 'utf8');
console.log(`Updated ${updatedCatalog.length} products in ${existingCatalogPath}`);

// Print summary of changes
console.log('\n--- VERIFICATION OF PRODUCT NAMES ---');
[1, 4, 5, 6, 7, 9, 12, 31, 32].forEach(sno => {
  const p = updatedCatalog.find(x => x.sno === sno);
  console.log(`Sno ${sno}: "${p.displayName}" (BOs: ${p.businessObjects.length})`);
});

console.log('\n--- VERIFICATION OF BUSINESS OBJECTS REMOVED ---');
[23, 28, 32, 33, 44, 48, 49, 50].forEach(sno => {
  const p = updatedCatalog.find(x => x.sno === sno);
  console.log(`Sno ${sno} (${p.productName}): ${p.businessObjects.map(b => b.displayName).join(', ') || 'None (All (0) deleted)'}`);
});
