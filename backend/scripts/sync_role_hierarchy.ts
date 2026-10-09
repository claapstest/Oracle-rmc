import { roleHierarchyService } from '../src/services/roleHierarchyService.js';

async function main() {
  console.log('Synchronizing live role hierarchy from Oracle Fusion BIP...');
  const res = await roleHierarchyService.syncFromBip();
  console.log('Sync complete:', res);
}

main().catch(console.error);
