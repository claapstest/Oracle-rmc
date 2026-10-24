const { userRoleRawDbService } = require('../dist/services/userRoleRawDbService.js');
const { oracleService } = require('../dist/services/oracleService.js');

async function main() {
  const usersA = await userRoleRawDbService.getUsersByRoleName('Advanced Access Controls Analyst');
  console.log('userRoleRawDbService for Advanced Access Controls Analyst:', usersA.users?.length, usersA.users?.slice(0, 3));

  const usersB = await oracleService.getUsersForRole('Advanced Access Controls Analyst');
  console.log('oracleService for Advanced Access Controls Analyst:', usersB.users?.length, usersB.users?.slice(0, 3));

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
