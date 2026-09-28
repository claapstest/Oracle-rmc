import { normalizeEmail, validateLoginInputs, mapLoginError } from './loginValidation.js';

function eq(actual: unknown, expected: unknown, name: string): void {
  if (actual !== expected) throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// AC2 — email mandatory
eq(validateLoginInputs('', 'secret123').email, 'Email is required.', 'empty email');
eq(validateLoginInputs('   ', 'secret123').email, 'Email is required.', 'blank email');
// AC2 — invalid format rejected
eq(validateLoginInputs('not-an-email', 'secret123').email, 'Enter a valid email address.', 'bad format');
// AC2 — trim + case-insensitive (admin@admin.com must pass for Site Admin, AC8)
eq(normalizeEmail('  Admin@Admin.COM  '), 'admin@admin.com', 'normalize');
eq(JSON.stringify(validateLoginInputs('  Admin@Admin.COM  ', 'secret123')), '{}', 'admin valid');
// AC3 — password mandatory
eq(validateLoginInputs('user@company.com', '').password, 'Password is required.', 'empty password');
// AC4 — valid inputs produce no errors (API may be called)
eq(JSON.stringify(validateLoginInputs('user@company.com', 'secret123')), '{}', 'valid inputs');
// AC6 — invalid credentials stay generic, never reveal existence
eq(mapLoginError('Invalid credentials.'), 'Invalid email or password.', 'invalid creds');
// Backend domain/format rejections must also stay generic (no policy leak)
eq(mapLoginError('Invalid email address or format. Please use name.name@claaps.com.'), 'Invalid email or password.', 'backend format');
// AC7 — disabled user gets access-denied message
if (!/disabled/i.test(mapLoginError('Your account has been deactivated. Please contact an administrator.'))) {
  throw new Error('disabled mapping: expected access-denied message');
}
// Backend status rejection must also map to access-denied (Srikar's wording)
eq(mapLoginError('Your account is not active. Please contact a system administrator.'), 'Your account has been disabled. Please contact your administrator.', 'not-active mapping');
// AC10 — technical errors never leak
eq(mapLoginError('ECONNREFUSED connect to db:5432'), 'Something went wrong. Please try again later.', 'tech error');

console.log('loginValidation checks passed');
