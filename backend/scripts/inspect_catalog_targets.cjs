const fs = require('fs');
const cat = JSON.parse(fs.readFileSync('src/config/auditProductCatalog.json'));

const mapping = {
  'Audit Policies': 'audit_policies',
  'Common CRM': 'common_crm',
  'General Ledger': 'ledger',
  'Global Human Resources': 'hcm',
  'HCM Common Architecture': 'hcm_common_architecture',
  'Inventory Management': 'inventory_management',
  'Payables': 'payables',
  'Profile Management': 'profile_management',
  'Public Sector Common Components': 'public_sector_common_components',
  'Quality Issue and Action Management': 'quality_issue_and_action_management',
  'Receivables': 'receivables',
  'Service': 'service'
};

for (const [name, id] of Object.entries(mapping)) {
  const p = cat.find(x => x.id === id || x.displayName.toLowerCase().startsWith(name.toLowerCase()));
  if (p) {
    console.log('=== ' + p.displayName + ' (id: ' + p.id + ', productId: ' + p.productId + ') ===');
    (p.businessObjects || []).forEach(bo => {
      console.log('  - ' + bo.displayName + ' [isSupported: ' + bo.isSupported + '] VO: ' + bo.restBusinessObjectType);
    });
  } else {
    console.log('NOT FOUND: ' + name);
  }
}
