import { OracleFusionClient } from './src/oracle/client.js';
import { loadPersistedConfig } from './src/config.js';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
loadPersistedConfig();

export function classifyRoleRecord(res: any): 'Job' | 'Duty' | 'Data' | 'Abstract' | 'GRC' | 'Other' {
  const cat = (res.category || '').toUpperCase();
  const name = (res.name || res.roleCode || res.value || '').toUpperCase();
  const displayName = (res.displayName || res.roleName || '').toUpperCase();

  // 1. GRC roles
  if (name.startsWith('ORA_GTG_') || name.startsWith('ORA_GTR_') || name.startsWith('CLAAPS_GTG_') || cat === 'GRC') {
    return 'GRC';
  }

  // 2. Duty roles (Must be checked before cat === 'JOB' or cat === 'ABSTRACT' because Oracle SCIM returns Duty roles with category JOB/ABSTRACT)
  if (
    cat === 'DUTY' ||
    name.endsWith('_DUTY') ||
    name.includes('_DUTY_') ||
    name.endsWith(' DUTY') ||
    name.includes(' DUTY ') ||
    displayName.endsWith(' DUTY') ||
    displayName.includes(' DUTY ') ||
    displayName.endsWith(' DUTYCOPY') ||
    displayName.includes(' DUTYCOPY') ||
    name.endsWith('_DY') ||
    name.includes('_DY_')
  ) {
    return 'Duty';
  }

  // 3. Abstract roles
  if (cat === 'ABSTRACT' || name.endsWith('_ABSTRACT') || name.includes('_ABSTRACT_')) {
    return 'Abstract';
  }

  // 4. Data roles
  if (
    cat === 'DATA' ||
    name.endsWith('_DATA') ||
    name.includes('_DATA_') ||
    name.endsWith('_DF') ||
    (cat === 'NONE' && (name.includes(' LEDGER') || name.includes(' ORG') || (res.description && res.description.includes('Data Access Set'))))
  ) {
    return 'Data';
  }

  // 5. Job roles
  if (cat === 'JOB' || name.endsWith('_JOB') || name.includes('_JOB_')) {
    return 'Job';
  }

  return 'Other';
}

async function fullCountTest() {
  const client = new OracleFusionClient();
  let totalRoles = 0;
  let jobRoles = 0;
  let dutyRoles = 0;
  let dataRoles = 0;
  let abstractRoles = 0;
  let grcRoles = 0;
  let otherRoles = 0;

  const dutySamples = [];

  let startIndex = 1;
  const count = 100;
  console.log("Starting full scan of Oracle Fusion roles...");
  // Let's scan first 30 batches (3000 roles) to see accurate breakdown
  for (let b = 0; b < 30; b++) {
    const res = await client.getRoles({ count, startIndex });
    const len = res?.Resources?.length || 0;
    totalRoles += len;

    res?.Resources?.forEach((r: any) => {
      const c = classifyRoleRecord(r);
      if (c === 'Job') jobRoles++;
      else if (c === 'Duty') {
        dutyRoles++;
        if (dutySamples.length < 5) dutySamples.push({ name: r.name, displayName: r.displayName, category: r.category });
      }
      else if (c === 'Data') dataRoles++;
      else if (c === 'Abstract') abstractRoles++;
      else if (c === 'GRC') grcRoles++;
      else otherRoles++;
    });

    if (len < count) break;
    startIndex += count;
  }

  console.log(`Scanned ${totalRoles} roles:`);
  console.log({
    jobRoles,
    dutyRoles,
    dataRoles,
    abstractRoles,
    grcRoles,
    otherRoles
  });
  console.log("Duty role samples:", dutySamples);
}

fullCountTest().catch(console.error);
