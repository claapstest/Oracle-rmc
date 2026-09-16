import { OracleFusionClient } from './src/oracle/client.js';
import { loadPersistedConfig } from './src/config.js';
import { classifyRoleRecord } from './src/services/oracleService.js';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
loadPersistedConfig();

async function findUserWithDutyRoles() {
  const client = new OracleFusionClient();
  const res = await client.getUsers({ count: 100, startIndex: 1 });
  console.log("Checking 100 users for assigned Duty roles...");
  for (const u of res.Resources) {
    if (u.roles && u.roles.length > 0) {
      const dutyRoles = u.roles.filter(r => {
        const cat = classifyRoleRecord({ name: r.value, roleCode: r.value, displayName: r.displayName });
        return cat === 'Duty';
      });
      if (dutyRoles.length > 0) {
        console.log(`FOUND User with Duty Roles: ${u.userName} (${u.displayName}) has ${dutyRoles.length} duty roles:`, dutyRoles.map(r => r.value));
        return;
      }
    }
  }
  console.log("No users with direct duty roles found in first 100 users.");
}

findUserWithDutyRoles().catch(console.error);
