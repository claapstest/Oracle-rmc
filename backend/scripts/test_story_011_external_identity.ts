// VYR-011: Entra-authenticated users must resolve to an existing ACTIVE VEYRA user.
import assert from 'node:assert/strict';
import { query } from '../src/db.js';
import { authService } from '../src/services/authService.js';

const TEST_EMAIL = 'audit.user@claaps.com';

async function expireSessions(email: string) {
  await query(
    `UPDATE veyra_session SET status = 'EXPIRED'
     WHERE status = 'ACTIVE' AND user_id = (SELECT id FROM veyra_user WHERE email = $1)`,
    [email]
  );
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

await expireSessions(TEST_EMAIL);

await test('provisioned Entra identity receives the local role and privileges', async () => {
  const result = await authService.loginWithExternalIdentity(TEST_EMAIL, {
    ipAddress: '127.0.0.1',
    userAgent: 'vyr-011-test',
  });
  assert.equal(result.success, true);
  assert.equal(result.normalizedEmail, TEST_EMAIL);
  assert.equal(result.role, 'AUDIT_USER');
  assert.deepEqual(result.permissions, ['REPORTS']);
  assert.ok(result.token);
  await authService.logout(result.token as string, { ipAddress: '127.0.0.1', userAgent: 'vyr-011-test' });
});

await test('unknown Entra identity is rejected without provisioning', async () => {
  const result = await authService.loginWithExternalIdentity('unknown@example.com', {
    ipAddress: '127.0.0.1',
    userAgent: 'vyr-011-test',
  });
  assert.equal(result.success, false);
  assert.equal(result.code, 'IDENTITY_NOT_PROVISIONED');
});

await test('Site Admin identity resolves through the same external path', async () => {
  const result = await authService.loginWithExternalIdentity('admin@admin.com', {
    ipAddress: '127.0.0.1',
    userAgent: 'vyr-011-test',
  });
  assert.equal(result.success, true);
  await authService.logout(result.token as string, { ipAddress: '127.0.0.1', userAgent: 'vyr-011-test' });
});

console.log(`\nVYR-011 external identity checks passed: ${passed} tests.`);
process.exit(0);
