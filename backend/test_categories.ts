import { OracleFusionClient } from './src/oracle/client.js';
import { loadPersistedConfig } from './src/config.js';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
loadPersistedConfig();

async function run() {
  const client = new OracleFusionClient();
  const cats = ['JOB', 'DUTY', 'ABSTRACT', 'DATA', 'GRC', 'NONE'];
  for (const cat of cats) {
    try {
      const res = await client.getRoles({ filter: `category eq "${cat}"`, count: 5 });
      console.log(`category eq "${cat}": totalResults = ${res?.totalResults}, returned = ${res?.Resources?.length}`);
      if (res?.Resources?.length) {
        res.Resources.slice(0, 3).forEach((r: any) => console.log(`   ${r.name} | ${r.displayName} | category: ${r.category}`));
      }
    } catch (err: any) {
      console.log(`category eq "${cat}": ERROR`, err.message);
    }
  }
}

run();
