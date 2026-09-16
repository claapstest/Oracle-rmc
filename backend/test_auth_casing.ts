import { authService } from './src/services/authService.js';

async function runTests() {
  console.log('--- Running Case-Insensitive Email Authentication Tests ---');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string) {
    total++;
    if (condition) {
      console.log(`[PASS] Test ${total}: ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${total}: ${testName}`);
    }
  }

  // Set known password for karthika.gundreddi@claaps.com
  const knownPassword = 'SecurePass123!@#';
  const initCode = authService.generateResetCode('karthika.gundreddi@claaps.com');
  authService.resetPassword('karthika.gundreddi@claaps.com', initCode, knownPassword);

  // Test 1: Normalize email helper trims and lowercases
  const normalized1 = authService.normalizeEmail('   Karthika.Gundreddi@Claaps.Com   ');
  assert(normalized1 === 'karthika.gundreddi@claaps.com', 'normalizeEmail trims leading/trailing spaces and lowercases domain/localpart');

  // Test 2: validateEmailFormat handles all casing and spaces
  assert(authService.validateEmailFormat('karthika.gundreddi@claaps.com'), 'validateEmailFormat with lowercase');
  assert(authService.validateEmailFormat('Karthika.Gundreddi@claaps.com'), 'validateEmailFormat with mixed case');
  assert(authService.validateEmailFormat('KARTHIKA.GUNDREDDI@CLAAPS.COM'), 'validateEmailFormat with UPPERCASE');
  assert(authService.validateEmailFormat('Karthika.Gundreddi@Claaps.Com'), 'validateEmailFormat with capitalized domain');
  assert(authService.validateEmailFormat('   Karthika.Gundreddi@claaps.com   '), 'validateEmailFormat with leading/trailing spaces');

  // Test 3: Authenticate with lowercase email
  const resSetup = await authService.login('karthika.gundreddi@claaps.com', knownPassword);
  assert(resSetup.success === true, 'Authenticate with lowercase email succeeds');

  // Test 4: Authenticate with MixedCase email
  const resMixed = await authService.login('Karthika.Gundreddi@claaps.com', knownPassword);
  assert(resMixed.success === true, 'Authenticate with mixed-case email succeeds');
  assert(resMixed.normalizedEmail === 'karthika.gundreddi@claaps.com', 'Login returns normalized email identity');

  // Test 5: Authenticate with ALL-CAPS email
  const resUpper = await authService.login('KARTHIKA.GUNDREDDI@CLAAPS.COM', knownPassword);
  assert(resUpper.success === true, 'Authenticate with ALL-CAPS email succeeds');
  assert(resUpper.normalizedEmail === 'karthika.gundreddi@claaps.com', 'ALL-CAPS login returns normalized email identity');

  // Test 6: Authenticate with capitalized domain
  const resDomain = await authService.login('Karthika.Gundreddi@Claaps.Com', knownPassword);
  assert(resDomain.success === true, 'Authenticate with capitalized domain succeeds');

  // Test 7: Authenticate with leading/trailing spaces
  const resSpaces = await authService.login('   Karthika.Gundreddi@claaps.com   ', knownPassword);
  assert(resSpaces.success === true, 'Authenticate with spaces around email succeeds');

  // Test 8: All sessions created identify as the same normalized user
  if (resSpaces.token) {
    const session = authService.verifySession(resSpaces.token);
    assert(session !== null && session.email === 'karthika.gundreddi@claaps.com', 'Session token resolves to normalized email karthika.gundreddi@claaps.com');
  } else {
    assert(false, 'Session token was not created');
  }

  // Test 9: Wrong password fails regardless of email casing
  const resWrongLower = await authService.login('karthika.gundreddi@claaps.com', 'WrongPassword123!');
  const resWrongUpper = await authService.login('KARTHIKA.GUNDREDDI@CLAAPS.COM', 'WrongPassword123!');
  assert(resWrongLower.success === false, 'Wrong password fails for lowercase email');
  assert(resWrongUpper.success === false, 'Wrong password fails for uppercase email');

  // Test 10: Session logout works properly
  if (resSpaces.token) {
    authService.logout(resSpaces.token);
    const sessionAfterLogout = authService.verifySession(resSpaces.token);
    assert(sessionAfterLogout === null, 'Session is invalidated on logout');
  }

  // Test 11: Admin password reset with mixed-cased email
  const rawCode = authService.generateResetCode('KARTHIKA.GUNDREDDI@CLAAPS.COM');
  assert(typeof rawCode === 'string' && rawCode.length === 8, 'generateResetCode works with uppercase email');

  const resetRes = authService.resetPassword('  Karthika.Gundreddi@Claaps.Com  ', rawCode, 'NewPass123!@#');
  assert(resetRes.success === true, 'resetPassword works with mixed-case and whitespace-padded email');

  // Test 12: Login with new password in uppercase
  const loginNewPass = await authService.login('KARTHIKA.GUNDREDDI@CLAAPS.COM', 'NewPass123!@#');
  assert(loginNewPass.success === true, 'Login with new password works with uppercase email');

  console.log(`\nResults: ${passed}/${total} tests passed.`);
  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
