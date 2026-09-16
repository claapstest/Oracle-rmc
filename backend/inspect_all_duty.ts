import { OracleFusionClient } from './src/oracle/client.js';
import { loadPersistedConfig } from './src/config.js';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
loadPersistedConfig();

async function inspectAllDutyRoles() {
  const client = new OracleFusionClient();
  const res = await client.getRoles({ filter: 'name co "DUTY"', count: 100 });
  console.log("Total roles matching name co 'DUTY':", res?.Resources?.length);
  res?.Resources?.forEach((r, idx) => {
    console.log(`[${idx+1}] ID: ${r.id} | name: "${r.name}" | displayName: "${r.displayName}" | category: "${r.category}"`);
  });
}

inspectAllDutyRoles().catch(console.error);
