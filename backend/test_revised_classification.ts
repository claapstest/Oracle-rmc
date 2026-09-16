import { OracleFusionClient } from './src/oracle/client.js';
import { loadPersistedConfig } from './src/config.js';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
loadPersistedConfig();

function classify(res: any) {
  const upperCat = (res.category || '').toUpperCase();
  const upperName = (res.name || res.roleCode || '').toUpperCase();
  const upperDisplayName = (res.displayName || '').toUpperCase();

  if (upperName.startsWith('ORA_GTG_') || upperName.startsWith('ORA_GTR_') || upperName.startsWith('CLAAPS_GTG_') || upperCat === 'GRC') {
    return 'GRC';
  }

  if (
    upperCat === 'DUTY' ||
    upperName.endsWith('_DUTY') ||
    upperName.includes('_DUTY_') ||
    upperName.endsWith(' DUTY') ||
    upperName.includes(' DUTY ') ||
    upperDisplayName.endsWith(' DUTY') ||
    upperDisplayName.includes(' DUTY ') ||
    upperDisplayName.endsWith(' DUTYCOPY') ||
    upperDisplayName.includes(' DUTYCOPY')
  ) {
    return 'Duty';
  }

  if (upperCat === 'ABSTRACT' || upperName.endsWith('_ABSTRACT') || upperName.includes('_ABSTRACT_')) {
    return 'Abstract';
  }

  if (
    upperCat === 'DATA' || 
    upperName.endsWith('_DATA') || 
    upperName.includes('_DATA_') || 
    upperName.endsWith('_DF') ||
    (upperCat === 'NONE' && (upperName.includes(' LEDGER') || upperName.includes(' ORG') || (res.description && res.description.includes('Data Access Set'))))
  ) {
    return 'Data';
  }

  if (upperCat === 'JOB' || upperName.endsWith('_JOB') || upperName.includes('_JOB_')) {
    return 'Job';
  }

  return 'Other';
}

async function countAll() {
  const client = new OracleFusionClient();
  let counts = { Job: 0, Duty: 0, Data: 0, Abstract: 0, GRC: 0, Other: 0 };
  let total = 0;
  let startIndex = 1;
  const pageSize = 100;

  // Let's test on first 1000 roles (10 batches)
  for (let i = 0; i < 10; i++) {
    const res = await client.getRoles({ count: pageSize, startIndex });
    if (!res?.Resources?.length) break;
    total += res.Resources.length;
    res.Resources.forEach(r => {
      const cat = classify(r);
      counts[cat] = (counts[cat] || 0) + 1;
    });
    startIndex += pageSize;
  }

  console.log(`Scanned ${total} roles from Oracle:`);
  console.log(counts);
}

countAll().catch(console.error);
