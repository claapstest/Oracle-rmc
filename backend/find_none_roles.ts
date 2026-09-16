import { OracleFusionClient } from './src/oracle/client.js';
import { loadPersistedConfig } from './src/config.js';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
loadPersistedConfig();

async function findNoneRoles() {
  const client = new OracleFusionClient();
  const res = await client.getRoles({ 
    filter: 'category eq "NONE"',
    count: 20 
  });
  console.log("Roles with category eq 'NONE':", res?.Resources?.length);
  if (res?.Resources?.length) {
    res.Resources.slice(0, 15).forEach(r => {
      console.log(`name: "${r.name}" | displayName: "${r.displayName}" | desc: "${(r.description || '').substring(0, 40)}"`);
    });
  }
}

findNoneRoles().catch(console.error);
