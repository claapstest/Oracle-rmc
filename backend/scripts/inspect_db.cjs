const { userRoleRawDbService } = require('../dist/services/userRoleRawDbService.js');

async function main() {
  try {
    const r = await userRoleRawDbService.getRawUsers({ businessUnit: 'US1' });
    console.log('Result:', r);
  } catch (e) {
    console.error('Error:', e);
  }
  process.exit(0);
}

main();
