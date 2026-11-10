/**
 * CLI Runner: Controlled Local User & Development Persona Seeding
 * Story: VYR-015
 * 
 * Usage:
 *   node scripts/seed_local_users.cjs
 *   node scripts/seed_local_users.cjs --admin-only
 *   ALLOW_PRODUCTION_SEED=true node scripts/seed_local_users.cjs
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const distProvisioning = path.join(__dirname, '../dist/services/localUserProvisioningService.js');
  const { localUserProvisioningService } = await import(distProvisioning);

  const isProd = localUserProvisioningService.isProduction();
  const args = process.argv.slice(2);
  const adminOnly = args.includes('--admin-only');

  console.log('================================================================');
  console.log('  VEYRA Controlled Local-User Provisioning (VYR-015)');
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('================================================================\n');

  try {
    if (adminOnly) {
      console.log('👤 Provisioning Site Administrator...');
      const adminResult = await localUserProvisioningService.provisionAdministrator();
      console.log(`✅ ${adminResult.message} (Role: ${adminResult.role})`);
    } else {
      console.log('👥 Seeding Representative Development Personas...');
      const result = await localUserProvisioningService.seedDevelopmentUsers();
      console.log(`✅ ${result.message}`);
      for (const u of result.users) {
        console.log(`   - [${u.role}] ${u.email} (Status: ${u.status})`);
      }
    }
    console.log('\n🎉 Local user provisioning completed successfully.\n');
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Provisioning failed: ${err.message}\n`);
    process.exit(1);
  }
}

main();

