import { OracleFusionClient } from './src/oracle/client.js';
import { loadPersistedConfig } from './src/config.js';
import { classifyRoleRecord } from './src/services/oracleService.js';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
loadPersistedConfig();

async function inspectUserRoles() {
  const client = new OracleFusionClient();
  const res = await client.getUsers({ filter: 'userName eq "HCM_IMPL"' });
  const user = res?.Resources?.[0];
  console.log(`User: ${user?.userName}, total roles: ${user?.roles?.length}`);
  if (user?.roles) {
    const counts = {};
    user.roles.forEach(r => {
      const cat = classifyRoleRecord({ name: r.value, roleCode: r.value, displayName: r.displayName });
      counts[cat] = (counts[cat] || 0) + 1;
    });
    console.log("Categories of roles assigned to HCM_IMPL:", counts);
    console.log("\nSample roles:");
    user.roles.slice(0, 10).forEach(r => {
      const cat = classifyRoleRecord({ name: r.value, roleCode: r.value, displayName: r.displayName });
      console.log(`  [${cat}] ${r.value} (${r.displayName})`);
    });
  }
}

inspectUserRoles().catch(console.error);
