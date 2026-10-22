const fs = require('fs');
const path = require('path');

const hierPath = path.resolve(__dirname, '../oracle_role_hierarchy_cache.json');
const catalogPath = path.resolve(__dirname, '../oracle_roles_cache.json');

if (!fs.existsSync(hierPath) || !fs.existsSync(catalogPath)) {
  console.error('Required files not found:', { hierPath, catalogPath });
  process.exit(1);
}

const hierData = JSON.parse(fs.readFileSync(hierPath, 'utf8'));
const catalogData = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

console.log('Current catalog roles count:', catalogData.roles.length);
console.log('Current catalog counts:', catalogData.counts);

// Map existing roles by roleCode and displayName lowercase
const roleMapByCode = new Map();
const roleMapByName = new Map();

catalogData.roles.forEach(r => {
  if (r.roleCode) roleMapByCode.set(r.roleCode.toUpperCase().trim(), r);
  if (r.displayName) roleMapByName.set(r.displayName.toLowerCase().trim(), r);
});

// Extract Duty roles from hierarchy cache
const dutyRoles = new Map();

hierData.items.forEach(item => {
  // Case 1: item.parentRoleType === 'DUTY'
  if (item.parentRoleType === 'DUTY' && item.parentRole) {
    const dName = item.parentRole.trim();
    const dKey = dName.toLowerCase();
    
    // Clean canonical code
    let dCode = 'ORA_' + dName.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (dCode.length > 50) dCode = dCode.substring(0, 50);

    const parentJob = item.roleName || item.childRole;

    if (!dutyRoles.has(dKey)) {
      dutyRoles.set(dKey, {
        displayName: dName,
        roleCode: dCode,
        category: 'Duty',
        description: `Oracle Fusion Security Duty Role granting modular functional capabilities through role hierarchy.`,
        members: [],
        parentRoles: parentJob ? [parentJob] : [],
        childRoles: [],
        privileges: item.privileges || []
      });
    } else {
      const entry = dutyRoles.get(dKey);
      if (parentJob && !entry.parentRoles.includes(parentJob)) {
        entry.parentRoles.push(parentJob);
      }
      if ((!entry.privileges || entry.privileges.length === 0) && item.privileges && item.privileges.length > 0) {
        entry.privileges = item.privileges;
      }
    }
  }

  // Case 2: item.childRoleType === 'DUTY'
  if (item.childRoleType === 'DUTY' && item.childRole) {
    const dName = item.childRole.trim();
    const dKey = dName.toLowerCase();
    let dCode = item.roleCode || ('ORA_' + dName.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''));
    if (dCode.length > 50) dCode = dCode.substring(0, 50);

    const parentJob = item.parentRole;

    if (!dutyRoles.has(dKey)) {
      dutyRoles.set(dKey, {
        displayName: dName,
        roleCode: dCode,
        category: 'Duty',
        description: `Oracle Fusion Security Duty Role granting modular functional capabilities through role hierarchy.`,
        members: [],
        parentRoles: parentJob ? [parentJob] : [],
        childRoles: [],
        privileges: item.privileges || []
      });
    } else {
      const entry = dutyRoles.get(dKey);
      if (parentJob && !entry.parentRoles.includes(parentJob)) {
        entry.parentRoles.push(parentJob);
      }
      if ((!entry.privileges || entry.privileges.length === 0) && item.privileges && item.privileges.length > 0) {
        entry.privileges = item.privileges;
      }
    }
  }
});

console.log('Unique Duty Roles extracted from hierarchy:', dutyRoles.size);

// Merge into catalog
let newlyAdded = 0;
let existingUpdated = 0;

for (const [dKey, dRole] of dutyRoles.entries()) {
  const existingByName = roleMapByName.get(dKey);
  const existingByCode = roleMapByCode.get(dRole.roleCode.toUpperCase());
  const existing = existingByName || existingByCode;

  if (existing) {
    existingUpdated++;
    if (!existing.parentRoles) existing.parentRoles = [];
    dRole.parentRoles.forEach(p => {
      if (!existing.parentRoles.includes(p)) existing.parentRoles.push(p);
    });
    if ((!existing.privileges || existing.privileges.length === 0) && dRole.privileges?.length > 0) {
      existing.privileges = dRole.privileges;
    }
  } else {
    newlyAdded++;
    const newEntry = {
      id: `DUTY_${dRole.roleCode}`,
      displayName: dRole.displayName,
      roleCode: dRole.roleCode,
      category: 'Duty',
      description: dRole.description,
      members: [],
      parentRoles: dRole.parentRoles,
      childRoles: [],
      privileges: dRole.privileges
    };
    catalogData.roles.push(newEntry);
    roleMapByName.set(dKey, newEntry);
    roleMapByCode.set(dRole.roleCode.toUpperCase(), newEntry);
  }
}

// Recalculate category counts
const counts = {
  Job: 0,
  Duty: 0,
  Data: 0,
  Abstract: 0,
  GRC: 0,
  Other: 0
};

catalogData.roles.forEach(r => {
  const cat = r.category || 'Other';
  if (counts[cat] !== undefined) {
    counts[cat]++;
  } else {
    counts.Other++;
  }
});

catalogData.counts = counts;
catalogData.totalResults = catalogData.roles.length;
catalogData.syncedAt = new Date().toISOString();

console.log('Updated catalog summary:');
console.log('Total roles:', catalogData.totalResults);
console.log('Newly added duty roles:', newlyAdded);
console.log('Existing roles updated with hierarchy links:', existingUpdated);
console.log('Category counts:', catalogData.counts);

fs.writeFileSync(catalogPath, JSON.stringify(catalogData, null, 2), 'utf8');
console.log('Successfully written merged catalog to:', catalogPath);
