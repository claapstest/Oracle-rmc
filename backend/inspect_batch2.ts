import { OracleFusionClient } from './src/oracle/client.js';
import { loadPersistedConfig } from './src/config.js';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
loadPersistedConfig();

async function inspectBatches() {
  const client = new OracleFusionClient();
  const batch2 = await client.getRoles({ count: 100, startIndex: 101 });
  console.log("Batch 2 count:", batch2?.Resources?.length);
  for (let i = 0; i < Math.min(20, batch2.Resources.length); i++) {
    const r = batch2.Resources[i];
    console.log(`[${i+1}] name: "${r.name}" | displayName: "${r.displayName}" | category: "${r.category}"`);
  }
}

inspectBatches().catch(console.error);
