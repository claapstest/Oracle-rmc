import { OracleFusionClient } from './src/oracle/client.js';
import { loadPersistedConfig } from './src/config.js';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
loadPersistedConfig();

async function inspectNoneRoles() {
  const client = new OracleFusionClient();
  const res = await client.getRoles({ count: 100, startIndex: 1 });
  
  console.log("All 100 roles from batch 1:");
  for (let i = 0; i < res.Resources.length; i++) {
    const r = res.Resources[i];
    if (r.category === 'NONE' || !r.category) {
      console.log(`[${i+1}] name: "${r.name}" | displayName: "${r.displayName}" | description: "${(r.description || '').substring(0, 60)}"`);
    }
  }
}

inspectNoneRoles().catch(console.error);
