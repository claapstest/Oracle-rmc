const assert = Object.assign(
  (condition: any, message?: string) => {
    if (!condition) throw new Error(message || 'Assertion failed');
  },
  {
    strictEqual: (actual: any, expected: any, msg?: string) => {
      if (actual !== expected) throw new Error(msg || `Expected ${expected} but got ${actual}`);
    },
    deepStrictEqual: (actual: any, expected: any, msg?: string) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(msg || `Deep equal mismatch`);
    },
    ok: (condition: any, msg?: string) => {
      if (!condition) throw new Error(msg || 'Expected truthy value');
    }
  }
);
import { normalizeEmail, validateLoginInputs, mapLoginError, isActiveSessionError } from './loginValidation';
import { ApiError } from '../services/api';

console.log('--- RUNNING VY-STRY-002 TEST SUITE ---');

// TEST 1: Input validation & normalization
console.log('\n[TEST 1] Validation & Normalization:');
assert.strictEqual(normalizeEmail('  Admin@Admin.COM '), 'admin@admin.com');
const emptyErrs = validateLoginInputs('', '');
assert.ok(emptyErrs.email, 'Email required error should be present');
assert.ok(emptyErrs.password, 'Password required error should be present');
const validErrs = validateLoginInputs('user@claaps.com', 'SecureP@ss123');
assert.deepStrictEqual(validErrs, {});
console.log('✓ Validation and email normalization passed');

// TEST 2: 401 Invalid Credentials
console.log('\n[TEST 2] 401 Invalid Credentials Handling:');
const err401Status = new ApiError('Invalid email or password.', 401);
assert.strictEqual(mapLoginError(err401Status), 'Invalid email or password.');

const err401Code = { status: 401, code: 'INVALID_CREDENTIALS', message: 'Bad auth' };
assert.strictEqual(mapLoginError(err401Code), 'Invalid email or password.');

const err401String = 'invalid email or password';
assert.strictEqual(mapLoginError(err401String), 'Invalid email or password.');
console.log('✓ 401 correctly maps to generic "Invalid email or password." without leaking user existence');

// TEST 3: 403 User Disabled / Suspended
console.log('\n[TEST 3] 403 Disabled / Suspended Handling:');
const err403Status = new ApiError('Your account is not active. Please contact a system administrator.', 403);
assert.strictEqual(mapLoginError(err403Status), 'Your account has been disabled. Please contact your administrator.');

const err403Code = { status: 403, code: 'USER_DISABLED', message: 'Account is disabled' };
assert.strictEqual(mapLoginError(err403Code), 'Your account has been disabled. Please contact your administrator.');

const err403String = 'account deactivated by admin';
assert.strictEqual(mapLoginError(err403String), 'Your account has been disabled. Please contact your administrator.');
console.log('✓ 403 correctly maps to "Your account has been disabled. Please contact your administrator."');

// TEST 4: 409 Active Session Conflict Detection
console.log('\n[TEST 4] 409 Active Session Detection across various wrapping structures:');

// Structure A: Direct 409 ApiError with code
const conflictErrA = new ApiError('An active session already exists for this user.', 409, 'ACTIVE_SESSION_EXISTS');
assert.strictEqual(isActiveSessionError(conflictErrA), true, 'Conflict A should be detected');

// Structure B: Standard JSON error object
const conflictErrB = { status: 409, code: 'ACTIVE_SESSION_EXISTS', message: 'An active session already exists for this user.' };
assert.strictEqual(isActiveSessionError(conflictErrB), true, 'Conflict B should be detected');

// Structure C: Wrapped in data
const conflictErrC = { status: 409, data: { code: 'ACTIVE_SESSION_EXISTS', message: 'Session conflict' } };
assert.strictEqual(isActiveSessionError(conflictErrC), true, 'Conflict C should be detected');

// Structure D: HTTP 409 status alone
const conflictErrD = { status: 409, message: 'Conflict' };
assert.strictEqual(isActiveSessionError(conflictErrD), true, 'Conflict D should be detected by status 409');

// Structure E: 200 payload wrapper with code
const conflictErrE = { success: false, code: 'ACTIVE_SESSION_EXISTS' };
assert.strictEqual(isActiveSessionError(conflictErrE), true, 'Conflict E should be detected by code');

// Non-conflicts should not be detected
assert.strictEqual(isActiveSessionError(err401Status), false, '401 should NOT be active session error');
assert.strictEqual(isActiveSessionError(err403Status), false, '403 should NOT be active session error');
assert.strictEqual(isActiveSessionError(new Error('Generic failure')), false, 'Generic error should NOT be active session error');
console.log('✓ 409 / ACTIVE_SESSION_EXISTS correctly identified in all response variations without false positives');

// TEST 5: 5xx System / Oracle / DB Error masking
console.log('\n[TEST 5] 5xx System Error Masking:');
const err500 = new ApiError('ORA-00001: unique constraint violated', 500);
assert.strictEqual(mapLoginError(err500), 'Something went wrong. Please try again later.');

const errDb = new Error('PostgreSQL connection timeout at tcp:5432');
assert.strictEqual(mapLoginError(errDb), 'Something went wrong. Please try again later.');
console.log('✓ 5xx and internal errors safely masked without exposing technical/database details');

console.log('\n--- ALL UNIT ASSERTIONS PASSED SUCCESSFULLY ---');
