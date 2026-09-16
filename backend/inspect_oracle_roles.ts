import { OracleFusionClient } from './src/oracle/client.js';
import { loadPersistedConfig, config } from './src/config.js';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
loadPersistedConfig();

async function inspect() {
  const client = new OracleFusionClient();
  console.log("Environment Mode:", config.environmentMode);
  console.log("Active Base URL:", config.oracle.baseUrl);

  console.log("\n--- Fetching first batch of 100 roles ---");
  const res = await client.getRoles({ count: 100, startIndex: 1 });
  console.log("Total Results returned in this batch:", res?.Resources?.length);
  if (res?.Resources?.length > 0) {
    console.log("Sample role structure:", JSON.stringify(res.Resources[0], null, 2));
    
    // Sample categories
    const categories = new Set();
    res.Resources.forEach((r: any) => {
      categories.add(`category=${r.category} | name=${r.name}`);
    });
    console.log("\nSample 10 items:");
    Array.from(categories).slice(0, 10).forEach(c => console.log(" ", c));
  }

  // Search without filter by scanning 500 roles
  console.log("\n--- Scanning 500 roles across 5 batches to check categories and names ---");
  const allCategories = new Map<string, number>();
  let dutyCount = 0;
  const sampleDutyRoles: any[] = [];

  for (let page = 0; page < 5; page++) {
    const batch = await client.getRoles({ count: 100, startIndex: page * 100 + 1 });
    if (!batch?.Resources?.length) break;
    batch.Resources.forEach((r: any) => {
      const cat = r.category || 'NO_CATEGORY';
      allCategories.set(cat, (allCategories.get(cat) || 0) + 1);

      const upperName = (r.name || r.displayName || '').toUpperCase();
      const upperCat = (r.category || '').toUpperCase();

      const isDuty = upperCat === 'DUTY' || 
                     upperName.includes('_DUTY') || 
                     upperName.includes('_DY') || 
                     upperName.endsWith(' DUTY') || 
                     upperName.includes(' DUTY ') ||
                     (r.displayName && r.displayName.toLowerCase().includes('duty'));
      if (isDuty) {
        dutyCount++;
        if (sampleDutyRoles.length < 5) sampleDutyRoles.push(r);
      }
    });
  }

  console.log("Categories found in scan:", Object.fromEntries(allCategories));
  console.log(`Duty roles detected in scan: ${dutyCount}`);
  if (sampleDutyRoles.length > 0) {
    console.log("Sample detected duty roles:", sampleDutyRoles.map(r => ({ name: r.name, displayName: r.displayName, category: r.category })));
  }

  // Also check User role assignments
  console.log("\n--- Checking User role assignments (e.g. JSMITH or users) ---");
  const usersRes = await client.getUsers({ count: 5 });
  if (usersRes?.Resources?.length > 0) {
    for (const u of usersRes.Resources) {
      console.log(`User: ${u.userName} (${u.name?.formatted || u.displayName}) - Roles: ${u.roles?.length || 0}`);
      if (u.roles && u.roles.length > 0) {
        console.log("  Sample assigned role:", JSON.stringify(u.roles[0]));
      }
    }
  }
}

inspect().catch(err => {
  console.error("Inspection error:", err);
});
