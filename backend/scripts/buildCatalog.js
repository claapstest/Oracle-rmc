import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rawCatalog = [
  { sno: 1, name: "Pages and Business Objects Extensibility (ADF)", shortcut: "ADF", bo: "Custom Metadata Operations" },
  { sno: 2, name: "Oracle Enterprise Scheduler Service", shortcut: "ESS", bo: "Job Request" },
  { sno: 3, name: "Oracle Platform Security Services", shortcut: "OPSS", bo: "N/A – Middleware Audit Events" },
  { sno: 4, name: "Oracle SOA Suite (SOA)", shortcut: "SOA", bo: "SOA DT@RT Change" },
  { sno: 5, name: "Oracle Data Integrator (ODI)", shortcut: "ODI", bo: "FirstClassObject" },
  { sno: 6, name: "Oracle Metadata Services (MDS)", shortcut: "MDS", bo: "Metadata Objects / Metadata Operations" },
  { sno: 7, name: "Oracle Business Intelligence Enterprise Edition", shortcut: "BI EE", bo: "ReportAccess" },
  { sno: 8, name: "Audit Policies", shortcut: "—", bo: "Oracle Fusion Business Objects and Attributes" },
  { sno: 9, name: "AI", shortcut: "AI", bo: "AI Agent / AI Agent Business Object / AI Agent Deep Link / AI Agent Tool / AI Agent Workflow" },
  { sno: 10, name: "Absence Management", shortcut: "ANC", bo: "Absence Records" },
  { sno: 11, name: "Advanced Collections", shortcut: "IEX", bo: "Collections Preferences / Collections Strategies / Customer Case Folders / Customer Collections Strategies" },
  { sno: 12, name: "Applications Common Components", shortcut: "ACR", bo: "Activities" },
  { sno: 13, name: "Assets", shortcut: "OFA / FA", bo: "Asset" },
  { sno: 14, name: "Benefits", shortcut: "BEN", bo: "Program / Plan Type / Plan / Option" },
  { sno: 15, name: "Bill Management", shortcut: "—", bo: "Bill" },
  { sno: 16, name: "Budgetary Control", shortcut: "XCC", bo: "Control Budget" },
  { sno: 17, name: "CRM Application Composer", shortcut: "CRM", bo: "Application Composer Metadata" },
  { sno: 18, name: "Campus Community", shortcut: "—", bo: "Person" },
  { sno: 19, name: "Cash Management", shortcut: "CE", bo: "Bank Account" },
  { sno: 20, name: "Common CRM", shortcut: "CRM", bo: "Customer / Contact / Activity" },
  { sno: 21, name: "Common Work Execution", shortcut: "—", bo: "Work Order" },
  { sno: 22, name: "Common Work Setup", shortcut: "—", bo: "Work Center / Work Area" },
  { sno: 23, name: "Compensation", shortcut: "CMP", bo: "Compensation Plan / Individual Compensation" },
  { sno: 24, name: "E-Signatures and E-Records", shortcut: "—", bo: "Electronic Signature / Electronic Record" },
  { sno: 25, name: "Employee Wellness", shortcut: "—", bo: "Wellness Program / Wellness Activity" },
  { sno: 26, name: "Enterprise Contracts", shortcut: "OKC", bo: "Contract / Contract Line" },
  { sno: 27, name: "Expenses", shortcut: "EXM", bo: "Expense Report / Expense Item" },
  { sno: 28, name: "Financials Common Module", shortcut: "FUN", bo: "Accounting Configuration / Financial Common Objects" },
  { sno: 29, name: "Financials for Regionalizations", shortcut: "JG", bo: "Regionalization / Localization Objects" },
  { sno: 30, name: "Financials for the Americas", shortcut: "JL", bo: "Americas Financial Objects" },
  { sno: 31, name: "General Ledger", shortcut: "GL", bo: "Journal / Ledger / Accounting Period" },
  { sno: 32, name: "Global Human Resources", shortcut: "PER / HCM", bo: "Person" },
  { sno: 33, name: "Global Payroll", shortcut: "PAY", bo: "Payroll / Element / Payroll Relationship" },
  { sno: 34, name: "Goal Management", shortcut: "HRG", bo: "Goal" },
  { sno: 35, name: "Grants Management", shortcut: "PJF", bo: "Grant / Award / Project" },
  { sno: 36, name: "HCM Common Architecture", shortcut: "HCA", bo: "Configure HCM Data Loader Parameters" },
  { sno: 37, name: "Incentive Compensation", shortcut: "CN", bo: "Incentive Compensation Plan / Participant" },
  { sno: 38, name: "Inventory Management", shortcut: "INV", bo: "Inventory Organization / Item / Lot / Serial" },
  { sno: 39, name: "Joint Venture Management", shortcut: "JVM", bo: "Joint Venture / Joint Venture Definition" },
  { sno: 40, name: "Lease Accounting", shortcut: "OKL", bo: "Lease / Lease Contract" },
  { sno: 41, name: "Legal Entity Configurator", shortcut: "XLE", bo: "Legal Entity / Legal Entity Registration" },
  { sno: 42, name: "Loyalty", shortcut: "LOY", bo: "Loyalty Program / Member" },
  { sno: 43, name: "Marketing", shortcut: "MKT", bo: "Campaign / Marketing Activity" },
  { sno: 44, name: "Oracle Middleware Extensions for Applications", shortcut: "—", bo: "Middleware Configuration Objects" },
  { sno: 45, name: "Partner Management", shortcut: "ZPM", bo: "Partner / Partner Organization" },
  { sno: 46, name: "Payables", shortcut: "AP / SQLAP", bo: "Invoice / Payment / Supplier" },
  { sno: 47, name: "Payments", shortcut: "IBY", bo: "Payment / Payment Process Request" },
  { sno: 48, name: "Performance Management", shortcut: "PER", bo: "Performance Document / Performance Goal" },
  { sno: 49, name: "Product Hub", shortcut: "EGP", bo: "Item / Item Class / Change Order" },
  { sno: 50, name: "Profile Management", shortcut: "PER", bo: "Talent Profile / Profile Item" },
  { sno: 51, name: "Project Foundation", shortcut: "PJF", bo: "Project / Project Task" },
  { sno: 52, name: "Public Sector Common Components", shortcut: "PSB", bo: "Public Sector Objects" },
  { sno: 53, name: "Quality Issue and Action Management", shortcut: "QIM", bo: "Quality Issue / Quality Action" },
  { sno: 54, name: "Receivables", shortcut: "AR", bo: "Invoice / Receipt / Customer Account" },
  { sno: 55, name: "Receiving", shortcut: "RCV", bo: "Receipt / Receiving Transaction" },
  { sno: 56, name: "Recruiting", shortcut: "IRC", bo: "Candidate / Job Requisition / Application" },
  { sno: 57, name: "Revenue Management", shortcut: "ORA-REV", bo: "Customer Contract / Revenue Contract" },
  { sno: 58, name: "Risks and Controls", shortcut: "RACM / RMC", bo: "Advanced Controls / Entitlements / Global Conditions / Global Users / User Groups / Business Object Security" },
  { sno: 59, name: "Sales", shortcut: "ZSF / CRM", bo: "Account / Opportunity / Lead" },
  { sno: 60, name: "Sales Catalog", shortcut: "QSC", bo: "Product / Product Group" },
  { sno: 61, name: "Sales for Communications", shortcut: "—", bo: "Communication Objects" },
  { sno: 62, name: "Service", shortcut: "CS", bo: "Service Request / Customer" },
  { sno: 63, name: "Sourcing", shortcut: "PON", bo: "Sourcing Event / Negotiation" },
  { sno: 64, name: "Student Admissions", shortcut: "SAD", bo: "Admission Application / Applicant" },
  { sno: 65, name: "Student Financials", shortcut: "SFA", bo: "Student Account / Financial Aid" },
  { sno: 66, name: "Student Records", shortcut: "SSR", bo: "Student / Academic Record" },
  { sno: 67, name: "Subledger Accounting", shortcut: "XLA", bo: "Subledger Journal Entry / Accounting Event" },
  { sno: 68, name: "Subscription Management", shortcut: "OSS", bo: "Subscription / Subscription Product" },
  { sno: 69, name: "Succession Management", shortcut: "PER", bo: "Succession Plan / Talent Pool" },
  { sno: 70, name: "Supplier Model", shortcut: "POS", bo: "Supplier / Supplier Site / Supplier Bank Account" },
  { sno: 71, name: "Supply Chain Management Common Components", shortcut: "RCS", bo: "SCM Common Objects" },
  { sno: 72, name: "Tax", shortcut: "ZX", bo: "Tax / Tax Regime / Tax Rate" },
  { sno: 73, name: "Territory Management", shortcut: "JTM", bo: "Territory / Territory Hierarchy" },
  { sno: 74, name: "Time and Labor", shortcut: "HXT / TLM", bo: "Time Card / Time Entry" },
  { sno: 75, name: "Trading Community Model", shortcut: "HZ", bo: "Party / Customer / Contact" },
  { sno: 76, name: "U.S. Federal Financials", shortcut: "FV", bo: "Federal Financial Objects" },
  { sno: 77, name: "Workforce Health and Safety Incidents", shortcut: "HNS", bo: "Health and Safety Incident" },
  { sno: 78, name: "Workforce Scheduling", shortcut: "WFM", bo: "Workforce Schedule / Work Shift" }
];

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const catalog = rawCatalog.map(item => {
  const shortCodes = item.shortcut && item.shortcut !== '—' && item.shortcut !== '-'
    ? item.shortcut.split('/').map(s => s.trim()).filter(Boolean)
    : [];

  // Display Name logic: "Product Name (SHORTCUT)" if shortcut exists and not already in name
  let displayName = item.name;
  if (item.name === 'Global Human Resources') {
    displayName = 'Global Human Resources (HCM)';
  } else if (shortCodes.length > 0) {
    const primaryShort = shortCodes.join(' / ');
    if (!item.name.includes(`(${primaryShort})`)) {
      displayName = `${item.name} (${primaryShort})`;
    }
  }

  // Generate unique stable ID
  let id = slugify(item.name);
  if (item.name === 'Global Human Resources') id = 'hcm';
  else if (item.name === 'Oracle Platform Security Services') id = 'opss';
  else if (item.name === 'General Ledger') id = 'gl';

  // REST Product code resolution
  let restProduct = null;
  if (item.name === 'Global Human Resources') {
    restProduct = 'hcmCore'; // CONFIRMED
  } else if (item.name === 'Oracle Platform Security Services') {
    restProduct = 'OPSS'; // CONFIRMED
  } else if (shortCodes.length > 0) {
    restProduct = shortCodes[0];
  } else {
    restProduct = item.name;
  }

  // Parse Business Objects
  const isOPSS = item.name === 'Oracle Platform Security Services';
  const requiresBO = !isOPSS && item.bo && !item.bo.startsWith('N/A');

  let businessObjects = [];
  if (item.name === 'Global Human Resources') {
    businessObjects = [
      {
        id: "person",
        displayName: "Person",
        restBusinessObjectType: "oracle.apps.hcm.people.core.uiModel.view.ManagePersonVO",
        restValue: "oracle.apps.hcm.people.core.uiModel.view.ManagePersonVO",
        aliases: ["Person", "person", "ManagePersonVO", "Manage Person"]
      }
    ];
  } else if (requiresBO) {
    const parts = item.bo.split('/').map(s => s.trim()).filter(Boolean);
    businessObjects = parts.map(part => {
      const boId = slugify(part);
      return {
        id: boId,
        displayName: part,
        aliases: [part, boId.replace(/_/g, ' ')]
      };
    });
  }

  // Aliases for natural language chatbot resolution
  const aliasesSet = new Set([
    item.name,
    displayName,
    ...shortCodes,
    id.replace(/_/g, ' ')
  ]);

  // Common aliases
  if (item.name === 'Global Human Resources') {
    aliasesSet.add('HCM');
    aliasesSet.add('Global Human Resources (HCM)');
    aliasesSet.add('Human Resources');
    aliasesSet.add('HR');
    aliasesSet.add('PER');
    aliasesSet.add('Person');
  } else if (item.name === 'HCM Common Architecture') {
    aliasesSet.delete('HCM');
    aliasesSet.delete('hcm');
  } else if (item.name === 'Oracle Platform Security Services') {
    aliasesSet.add('Platform Security Services');
    aliasesSet.add('Platform Security');
    aliasesSet.add('Security Services');
  } else if (item.name === 'General Ledger') {
    aliasesSet.add('Ledger');
    aliasesSet.add('GL');
  }

  return {
    sno: item.sno,
    id,
    displayName,
    productName: item.name,
    shortCodes,
    aliases: Array.from(aliasesSet),
    restProduct,
    mappingStatus: 'CONFIRMED', // Keep all products selectable and enabled!
    requiresBusinessObjectType: requiresBO,
    businessObjects
  };
});

const outputPath = path.resolve(__dirname, '../src/config/auditProductCatalog.json');
fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2), 'utf-8');
console.log(`Generated ${catalog.length} products to ${outputPath}`);

const distConfigDir = path.resolve(__dirname, '../dist/config');
if (fs.existsSync(path.resolve(__dirname, '../dist'))) {
  if (!fs.existsSync(distConfigDir)) {
    fs.mkdirSync(distConfigDir, { recursive: true });
  }
  fs.writeFileSync(path.join(distConfigDir, 'auditProductCatalog.json'), JSON.stringify(catalog, null, 2), 'utf-8');
  console.log(`Copied ${catalog.length} products to ${distConfigDir}`);
}
