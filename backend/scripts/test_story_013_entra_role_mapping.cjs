/**
 * Story 13: Entra-to-Veyra Role & Privilege Mapping (VYR-013)
 * Comprehensive Acceptance Criteria & Security Verification Suite
 */

const assert = require('assert');
const { pool } = require('../dist/db.js');
const { entraIdentityService, VEYRA_ROLE_RANKS } = require('../dist/services/entraIdentityService.js');
const { authService } = require('../dist/services/authService.js');
const { config } = require('../dist/config.js');

let passed = 0;
let failed = 0;

function pass(desc) {
  passed++;
  console.log(`  ✅ [PASS] ${desc}`);
}

function fail(desc, err) {
  failed++;
  console.error(`  ❌ [FAIL] ${desc}:`, err?.message || err);
}

async function run() {
  console.log('================================================================');
  console.log('  Story 13: Entra-to-Veyra Role & Privilege Mapping (VYR-013)');
  console.log('  Acceptance Criteria & Security Verification Suite');
  console.log('================================================================\n');

  const originalTenantId = config.entra.tenantId;
  const originalJit = config.entra.jitProvisioning;
  const originalRoleMapping = config.entra.roleMapping;
  const originalRequireRoleMapping = config.entra.requireRoleMapping;
  const originalDefaultRole = config.entra.defaultRole;

  const TEST_TENANT = '00000000-0000-0000-0000-000000000013';
  const GROUP_SUPERVISOR_OID = '77777777-7777-7777-7777-777777777777';

  try {
    config.entra.tenantId = TEST_TENANT;
    config.entra.jitProvisioning = true;
    config.entra.defaultRole = 'AUDIT_USER';
    config.entra.roleMapping = {
      'Veyra.Admin': 'SITE_ADMIN',
      'Veyra.AuditManager': 'AUDIT_MANAGER',
      [GROUP_SUPERVISOR_OID]: 'AUDIT_SUPERVISOR',
      'Veyra.Basic': 'AUDIT_USER',
    };
    config.entra.requireRoleMapping = false;

    // --- Section 1: Role Precedence & Hierarchy Constants ---
    console.log('--- Section 1: Role Precedence & Hierarchy Constants ---');
    try {
      assert.equal(typeof VEYRA_ROLE_RANKS, 'object', 'VEYRA_ROLE_RANKS must be defined');
      assert.ok(VEYRA_ROLE_RANKS.SITE_ADMIN > VEYRA_ROLE_RANKS.AUDIT_MANAGER, 'SITE_ADMIN must outrank AUDIT_MANAGER');
      assert.ok(VEYRA_ROLE_RANKS.AUDIT_MANAGER > VEYRA_ROLE_RANKS.AUDIT_SUPERVISOR, 'AUDIT_MANAGER must outrank AUDIT_SUPERVISOR');
      assert.ok(VEYRA_ROLE_RANKS.AUDIT_SUPERVISOR > VEYRA_ROLE_RANKS.AUDIT_USER, 'AUDIT_SUPERVISOR must outrank AUDIT_USER');
      pass('Role hierarchy correctly defined (SITE_ADMIN > AUDIT_MANAGER > AUDIT_SUPERVISOR > AUDIT_USER)');
    } catch (e) { fail('Role hierarchy ranks check', e); }

    // --- Section 2: Entra Claim -> Role Resolution (AC1) ---
    console.log('\n--- Section 2: Entra Claim -> Role Resolution (AC1) ---');
    try {
      const res1 = entraIdentityService.resolveEntraRole({
        email: 'mgr@test13.com',
        subject: 'oid-mgr',
        tenantId: TEST_TENANT,
        roles: ['Veyra.AuditManager'],
      });
      assert.equal(res1.roleCode, 'AUDIT_MANAGER');
      assert.equal(res1.source, 'CLAIM_MAPPING');
      pass('App Role claim "Veyra.AuditManager" maps to AUDIT_MANAGER');
    } catch (e) { fail('App Role claim mapping', e); }

    try {
      const res2 = entraIdentityService.resolveEntraRole({
        email: 'sup@test13.com',
        subject: 'oid-sup',
        tenantId: TEST_TENANT,
        groups: [GROUP_SUPERVISOR_OID],
      });
      assert.equal(res2.roleCode, 'AUDIT_SUPERVISOR');
      assert.equal(res2.source, 'CLAIM_MAPPING');
      pass('Security Group OID claim maps to AUDIT_SUPERVISOR');
    } catch (e) { fail('Security Group OID claim mapping', e); }

    try {
      const res3 = entraIdentityService.resolveEntraRole({
        email: 'direct@test13.com',
        subject: 'oid-direct',
        tenantId: TEST_TENANT,
        roles: ['SITE_ADMIN'],
      });
      assert.equal(res3.roleCode, 'SITE_ADMIN');
      assert.equal(res3.source, 'DIRECT_ROLE');
      pass('Direct role code "SITE_ADMIN" claim resolves to SITE_ADMIN');
    } catch (e) { fail('Direct role code claim mapping', e); }

    try {
      const res4 = entraIdentityService.resolveEntraRole({
        email: 'conv@test13.com',
        subject: 'oid-conv',
        tenantId: TEST_TENANT,
        roles: ['Veyra.SiteAdmin'],
      });
      assert.equal(res4.roleCode, 'SITE_ADMIN');
      pass('Convention "Veyra.SiteAdmin" maps to SITE_ADMIN');
    } catch (e) { fail('Convention claim mapping', e); }

    try {
      const caseRes = entraIdentityService.resolveEntraRole({
        email: 'case@test13.com',
        subject: 'oid-case',
        tenantId: TEST_TENANT,
        roles: ['  veyra.auditmanager  '],
      });
      assert.equal(caseRes.roleCode, 'AUDIT_MANAGER');
      pass('Case-insensitivity and whitespace trimming applied to claim matching');
    } catch (e) { fail('Case-insensitivity claim matching', e); }

    try {
      const bogusRes = entraIdentityService.resolveEntraRole({
        email: 'bogus@test13.com',
        subject: 'oid-bogus',
        tenantId: TEST_TENANT,
        roles: ['SuperAdmin', 'Root', 'SystemAdministrator', 'DropDatabase'],
      });
      assert.equal(bogusRes.roleCode, 'AUDIT_USER');
      assert.equal(bogusRes.source, 'DEFAULT_FALLBACK');
      pass('Arbitrary/unrecognized role claims are ignored (prevents privilege escalation)');
    } catch (e) { fail('Privilege escalation prevention', e); }

    // --- Section 3: Hierarchy Precedence When User Has Multiple Claims ---
    console.log('\n--- Section 3: Hierarchy Precedence (Multiple Claims) ---');
    try {
      const multi = entraIdentityService.resolveEntraRole({
        email: 'multi@test13.com',
        subject: 'oid-multi',
        tenantId: TEST_TENANT,
        roles: ['Veyra.Basic', 'Veyra.AuditManager'],
        groups: [GROUP_SUPERVISOR_OID],
      });
      assert.equal(multi.roleCode, 'AUDIT_MANAGER', 'AUDIT_MANAGER should outrank AUDIT_SUPERVISOR and AUDIT_USER');
      pass('Highest-privilege role is selected when multiple claims match (AUDIT_MANAGER)');
    } catch (e) { fail('Multiple claims hierarchy precedence', e); }

    try {
      const adminMulti = entraIdentityService.resolveEntraRole({
        email: 'adminmulti@test13.com',
        subject: 'oid-adminmulti',
        tenantId: TEST_TENANT,
        roles: ['Veyra.AuditManager', 'Veyra.Admin'],
      });
      assert.equal(adminMulti.roleCode, 'SITE_ADMIN', 'SITE_ADMIN should outrank AUDIT_MANAGER');
      pass('Highest-privilege role is selected when SITE_ADMIN claim is present');
    } catch (e) { fail('SITE_ADMIN hierarchy dominance', e); }

    // --- Section 4: Strict Role Mapping vs Flexible Fallback Policy ---
    console.log('\n--- Section 4: Strict Role Mapping vs Flexible Fallback Policy ---');
    try {
      config.entra.requireRoleMapping = false;
      const flex = entraIdentityService.resolveEntraRole({
        email: 'unmapped@test13.com',
        subject: 'oid-unmapped',
        tenantId: TEST_TENANT,
        roles: ['UnknownCorpRole'],
      });
      assert.equal(flex.roleCode, 'AUDIT_USER');
      assert.equal(flex.source, 'DEFAULT_FALLBACK');
      pass('When requireRoleMapping=false, unmapped claim safely falls back to AUDIT_USER');
    } catch (e) { fail('Flexible role mapping fallback', e); }

    try {
      config.entra.requireRoleMapping = true;
      const strict = entraIdentityService.resolveEntraRole({
        email: 'unmapped@test13.com',
        subject: 'oid-unmapped',
        tenantId: TEST_TENANT,
        roles: ['UnknownCorpRole'],
      });
      assert.equal(strict.roleCode, null);
      assert.equal(strict.source, 'UNMAPPED');
      pass('When requireRoleMapping=true, unmapped claim evaluates to null (fails closed)');
    } catch (e) { fail('Strict role mapping rejection', e); }

    try {
      config.entra.requireRoleMapping = true;
      const deniedLogin = await entraIdentityService.resolveOrProvision({
        email: 'strict_denied@test13.com',
        subject: 'oid-strict-denied',
        tenantId: TEST_TENANT,
        roles: ['SomeOtherAppRole'],
      }, { ipAddress: '127.0.0.1', userAgent: 'test-agent' });
      assert.equal(deniedLogin.success, false);
      assert.equal(deniedLogin.code, 'ROLE_NOT_MAPPED');
      pass('Strict unmapped user login is rejected with 403 ROLE_NOT_MAPPED');
    } catch (e) { fail('Strict unmapped user login rejection', e); }

    // Reset requireRoleMapping to false for remaining integration tests
    config.entra.requireRoleMapping = false;

    // --- Section 5: End-to-End JIT Provisioning with Role Mapping ---
    console.log('\n--- Section 5: JIT Provisioning with Role Mapping ---');
    const jitEmail = `jit_mgr_${Date.now()}@test13.com`;
    let jitUserId = null;
    try {
      const jitRes = await entraIdentityService.resolveOrProvision({
        email: jitEmail,
        subject: `oid-jit-${Date.now()}`,
        tenantId: TEST_TENANT,
        roles: ['Veyra.AuditManager'],
      }, { ipAddress: '127.0.0.1', userAgent: 'test-agent' });

      assert.equal(jitRes.success, true);
      assert.ok(jitRes.user?.id);
      jitUserId = jitRes.user.id;

      // Verify assigned role in database
      const roleDbRes = await pool.query(
        `SELECT r.role_code 
         FROM veyra_role r 
         JOIN veyra_user_role ur ON ur.role_id = r.id 
         WHERE ur.user_id = $1`,
        [jitUserId]
      );
      assert.equal(roleDbRes.rows.length, 1);
      assert.equal(roleDbRes.rows[0].role_code, 'AUDIT_MANAGER');
      pass('JIT provisioned user automatically assigned AUDIT_MANAGER from Entra claim');
    } catch (e) { fail('JIT provisioning with mapped role', e); }

    // --- Section 6: Dynamic Role Synchronization on Subsequent Login ---
    console.log('\n--- Section 6: Dynamic Role Synchronization on Subsequent Login ---');
    try {
      // User is currently AUDIT_MANAGER. Now user logs in with promoted claim: Veyra.Admin
      const syncRes = await entraIdentityService.resolveOrProvision({
        email: jitEmail,
        subject: `oid-jit-${Date.now()}`,
        tenantId: TEST_TENANT,
        roles: ['Veyra.Admin'],
      }, { ipAddress: '127.0.0.1', userAgent: 'test-agent' });

      assert.equal(syncRes.success, true);

      // Verify role in database was synchronized to SITE_ADMIN
      const roleUpdatedRes = await pool.query(
        `SELECT r.role_code 
         FROM veyra_role r 
         JOIN veyra_user_role ur ON ur.role_id = r.id 
         WHERE ur.user_id = $1`,
        [jitUserId]
      );
      assert.equal(roleUpdatedRes.rows.length, 1);
      assert.equal(roleUpdatedRes.rows[0].role_code, 'SITE_ADMIN');
      pass('Promoted user claim dynamically updates database role to SITE_ADMIN');
    } catch (e) { fail('Dynamic role synchronization promotion', e); }

    try {
      // Now demote user in Entra: user logs in with group claim for AUDIT_SUPERVISOR
      const demoteRes = await entraIdentityService.resolveOrProvision({
        email: jitEmail,
        subject: `oid-jit-${Date.now()}`,
        tenantId: TEST_TENANT,
        groups: [GROUP_SUPERVISOR_OID],
      }, { ipAddress: '127.0.0.1', userAgent: 'test-agent' });

      assert.equal(demoteRes.success, true);

      const roleDemotedRes = await pool.query(
        `SELECT r.role_code 
         FROM veyra_role r 
         JOIN veyra_user_role ur ON ur.role_id = r.id 
         WHERE ur.user_id = $1`,
        [jitUserId]
      );
      assert.equal(roleDemotedRes.rows.length, 1);
      assert.equal(roleDemotedRes.rows[0].role_code, 'AUDIT_SUPERVISOR');
      pass('Demoted user claim dynamically updates database role to AUDIT_SUPERVISOR');
    } catch (e) { fail('Dynamic role synchronization demotion', e); }

    // --- Section 7: AuthService Integration & Effective Privilege Resolution ---
    console.log('\n--- Section 7: AuthService Integration & Effective Privileges ---');
    try {
      const loginResult = await authService.loginWithExternalIdentity({
        email: jitEmail,
        subject: `oid-jit-${Date.now()}`,
        tenantId: TEST_TENANT,
        roles: ['Veyra.AuditManager'],
      }, { ipAddress: '127.0.0.1', userAgent: 'test-agent' });

      assert.equal(loginResult.success, true);
      assert.equal(loginResult.role, 'AUDIT_MANAGER');
      assert.ok(Array.isArray(loginResult.permissions));
      assert.ok(loginResult.permissions.length > 0);
      assert.ok(loginResult.permissions.includes('AUDIT_TRAIL'), 'Must have AUDIT_TRAIL privilege');
      assert.ok(loginResult.permissions.includes('REPORTS'), 'Must have REPORTS privilege');
      assert.ok(!loginResult.isAdmin, 'AUDIT_MANAGER is not site admin');
      pass('AuthService login successfully resolves effective AUDIT_MANAGER permissions');
    } catch (e) { fail('AuthService effective privilege resolution', e); }

    // --- Section 8: Audit Trail Invariants & Zero Secret Leakage (AC2) ---
    console.log('\n--- Section 8: Audit Trail Invariants (AC2) ---');
    try {
      const auditRes = await pool.query(
        `SELECT event_type, details 
         FROM veyra_audit_event 
         WHERE user_id = $1 AND event_type = 'ROLE_ASSIGNED'
         ORDER BY event_time DESC`,
        [jitUserId]
      );
      assert.ok(auditRes.rows.length >= 2, 'Must record ROLE_ASSIGNED audit events');
      const latestAudit = auditRes.rows[0];
      assert.equal(latestAudit.event_type, 'ROLE_ASSIGNED');
      assert.ok(latestAudit.details.newRole, 'Audit details must record newRole');

      // Verify no sensitive tokens or secrets are logged in details
      const auditString = JSON.stringify(auditRes.rows);
      assert.ok(!auditString.includes('access_token'), 'No access_token in audit log');
      assert.ok(!auditString.includes('id_token'), 'No id_token in audit log');
      assert.ok(!auditString.includes('client_secret'), 'No client_secret in audit log');
      pass('ROLE_ASSIGNED audit trail recorded with zero sensitive token or secret leakage');
    } catch (e) { fail('Audit trail verification', e); }

    // Clean up test user
    if (jitUserId) {
      await pool.query(`DELETE FROM veyra_user WHERE id = $1`, [jitUserId]).catch(() => {});
    }

  } finally {
    config.entra.tenantId = originalTenantId;
    config.entra.jitProvisioning = originalJit;
    config.entra.roleMapping = originalRoleMapping;
    config.entra.requireRoleMapping = originalRequireRoleMapping;
    config.entra.defaultRole = originalDefaultRole;
  }

  console.log('\n================================================================');
  console.log(`  Story 13 Summary: ${passed} passed, ${failed} failed.`);
  if (failed === 0) {
    console.log('  🎉 All Story 13 Role & Privilege Mapping Tests Passed!');
  } else {
    console.error('  ⚠️ Some Story 13 tests failed.');
  }
  console.log('================================================================\n');

  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
