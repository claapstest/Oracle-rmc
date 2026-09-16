import { OracleFusionClient } from './src/oracle/client.js';
import { loadPersistedConfig, config } from './src/config.js';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
loadPersistedConfig();

async function inspectUndefinedCategory() {
  const client = new OracleFusionClient();
  const res = await client.getRoles({ count: 100, startIndex: 1 });
  
  console.log("Roles with category === undefined or not JOB/ABSTRACT/DATA:");
  let count = 0;
  for (const r of res.Resources) {
    if (!r.category || (r.category !== 'JOB' && r.category !== 'ABSTRACT' && r.category !== 'DATA')) {
      count++;
      console.log(`[${count}] name: "${r.name}", displayName: "${r.displayName}", category: "${r.category}"`);
      if (count >= 25) break;
    }
  }
}

inspectUndefinedCategory().catch(console.error);
