/**
 * Story 12 Verification Suite:
 * Implement Entra identity mapping and Veyra user provisioning (VYR-012)
 *
 * Acceptance Criteria:
 * AC1: Only identities from configured tenant and allowed policy are mapped.
 * AC2: Disabled Veyra users cannot gain access through Entra.
 * AC3: Identity mapping is deterministic and auditable.
 */

const assert = require('assert');
const path = require('path');
const { Pool } = require('pg');

const repoRoot = path.resolve(__dirname, '../..');
const distDb = path.join(repoRoot, 'backend/dist/db.js');
const distAuth = path.join(repoRoot, 'backend/dist/services/authService.js');
const distIdentity = path.join(repoRoot, 'backend/dist/services/entraIdentityService.js');
const distConfig = path.join(repoRoot, 'backend/dist/config.js');

const { query: dbQuery, pool } = require(distDb);
const { authService } = require(distAuth);
const { entraIdentityService } = require(distIdentity);
const { config } = require(distConfig);

let testsPassed = 0;
let testsFailed = 0;

function record(pass, title, details = null) {
  if (pass) {
    console.log(`  ✅ [PASS] ${title}`);
    testsPassed++;
  } else {
    console.error(`  ❌ [FAIL] ${title}`);
    if (details) console.error(`         Details:`, details);
    testsFailed++;
  }
}

async function runStory12Tests() {
  console.log('================================================================');
  console.log('  Story 12: Entra Identity Mapping & User Provisioning (VYR-012)');
  console.log('  Acceptance Criteria & Security Verification Suite');
  console.log('================================================================\n');

  const TEST_TENANT_ID = 'test-tenant-uuid-1234';
  const FOREIGN_TENANT_ID = 'foreign-untrusted-tenant-9999';

  // Configure test environment variables for the test suite
  config.entra.tenantId = TEST_TENANT_ID;
  config.entra.clientId = 'test-client-id-5678';
  config.entra.defaultRole = 'AUDIT_USER';

  // Clean any test data from previous runs
  await dbQuery("DELETE FROM veyra_user_identity_mapping WHERE external_user_id LIKE 'test_oid_%'").catch(() => {});
  await dbQuery("DELETE FROM veyra_user WHERE email LIKE 'test.entra.%@example.com'").catch(() => {});

  try {
    // ========================================================================
    // SECTION 1: Database Schema & Mapping Table Verification
    // ========================================================================
    console.log('--- Section 1: Database Schema & Mapping Table Verification ---');

    const tableCheck = await dbQuery(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'veyra_user_identity_mapping'"
    );
    record(tableCheck.rows.length === 1, 'Table veyra_user_identity_mapping exists in PostgreSQL schema');

    const columnCheck = await dbQuery(
      "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'veyra_user_identity_mapping'"
    );
    const columns = columnCheck.rows.map(r => r.column_name);
    const requiredCols = [
      'id', 'user_id', 'provider', 'tenant_id', 'external_user_id',
      'external_email', 'external_display_name', 'created_at', 'updated_at', 'last_authenticated_at'
    ];
    const missingCols = requiredCols.filter(c => !columns.includes(c));
    record(missingCols.length === 0, `All 10 required columns exist (Missing: ${missingCols.join(', ') || 'None'})`);

    const indexCheck = await dbQuery(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'veyra_user_identity_mapping'"
    );
    const indexes = indexCheck.rows.map(r => r.indexname);
    record(indexes.includes('ix_veyra_identity_lookup'), 'Lookup index ix_veyra_identity_lookup exists');
    record(indexes.includes('ix_veyra_identity_user_id'), 'Foreign key index ix_veyra_identity_user_id exists');
    record(indexes.includes('ix_veyra_identity_email'), 'Email lookup index ix_veyra_identity_email exists');

    // ========================================================================
    // SECTION 2: Tenant Isolation & Boundary Enforcement (AC1)
    // ========================================================================
    console.log('\n--- Section 2: Tenant Isolation & Boundary Enforcement (AC1) ---');

    const foreignTenantClaims = {
      email: 'test.entra.foreign@example.com',
      subject: 'test_oid_foreign_001',
      tenantId: FOREIGN_TENANT_ID,
      displayName: 'Foreign Tenant User'
    };

    const mismatchRes = await entraIdentityService.resolveOrProvision(foreignTenantClaims, {
      ipAddress: '127.0.0.1',
      userAgent: 'story12-test-agent'
    });

    record(mismatchRes.success === false, 'Untrusted cross-tenant identity is rejected (success: false)');
    record(mismatchRes.code === 'TENANT_MISMATCH', 'Rejection code is strictly TENANT_MISMATCH (403)');

    // Verify audit log recorded the failure with tenant info
    const auditMismatch = await dbQuery(
      "SELECT * FROM veyra_audit_event WHERE event_type = 'LOGIN_FAILED' AND (details->>'reason') = 'TENANT_MISMATCH' ORDER BY event_time DESC LIMIT 1"
    );
    record(auditMismatch.rows.length > 0, 'Audit event recorded for TENANT_MISMATCH rejection');

    // ========================================================================
    // SECTION 3: Disabled & Suspended User Access Gate (AC2)
    // ========================================================================
    console.log('\n--- Section 3: Disabled & Suspended User Access Gate (AC2) ---');

    // Create a disabled local user in veyra_user
    const disabledEmail = 'test.entra.disabled@example.com';
    const disabledUserRes = await dbQuery(
      `INSERT INTO veyra_user (email, display_name, status, is_local_user)
       VALUES ($1, 'Disabled Employee', 'DISABLED', true)
       RETURNING id, email, status`,
      [disabledEmail]
    );
    const disabledUserId = disabledUserRes.rows[0].id;

    const disabledClaims = {
      email: disabledEmail,
      subject: 'test_oid_disabled_001',
      tenantId: TEST_TENANT_ID,
      displayName: 'Disabled Employee'
    };

    const disabledLoginRes = await entraIdentityService.resolveOrProvision(disabledClaims, {
      ipAddress: '127.0.0.1',
      userAgent: 'story12-test-agent'
    });

    record(disabledLoginRes.success === false, 'Disabled user cannot access VEYRA via Entra (success: false)');
    record(disabledLoginRes.code === 'USER_DISABLED', 'Disabled user receives USER_DISABLED error code');
    record(disabledLoginRes.status === 'DISABLED', 'Response reports disabled status');

    // Create a suspended local user
    const suspendedEmail = 'test.entra.suspended@example.com';
    await dbQuery(
      `INSERT INTO veyra_user (email, display_name, status, is_local_user)
       VALUES ($1, 'Suspended Contractor', 'SUSPENDED', true)`,
      [suspendedEmail]
    );

    const suspendedRes = await entraIdentityService.resolveOrProvision({
      email: suspendedEmail,
      subject: 'test_oid_suspended_002',
      tenantId: TEST_TENANT_ID
    });
    record(suspendedRes.success === false && suspendedRes.code === 'USER_DISABLED',
      'Suspended user cannot access VEYRA via Entra (USER_DISABLED)');

    // ========================================================================
    // SECTION 4: Pre-Provisioned User Linking & Immutable Resolution (AC1 & AC3)
    // ========================================================================
    console.log('\n--- Section 4: Pre-Provisioned User Linking & Immutable Resolution ---');

    // Create an active local user (pre-provisioned)
    const activeEmail = 'test.entra.preprovisioned@example.com';
    const activeUserRes = await dbQuery(
      `INSERT INTO veyra_user (email, display_name, status, is_local_user)
       VALUES ($1, 'Preprovisioned User', 'ACTIVE', true)
       RETURNING id, email, status`,
      [activeEmail]
    );
    const activeUserId = activeUserRes.rows[0].id;

    const preprovClaims = {
      email: activeEmail,
      subject: 'test_oid_preprov_001',
      tenantId: TEST_TENANT_ID,
      displayName: 'Preprovisioned User'
    };

    // First login: links the Entra identity to existing user
    const firstLogin = await entraIdentityService.resolveOrProvision(preprovClaims);
    record(firstLogin.success === true, 'Pre-provisioned user resolves successfully (success: true)');
    record(firstLogin.user?.id === activeUserId, 'Resolved principal matches existing veyra_user id');
    record(firstLogin.isNewProvision === false, 'Flagged as linked existing account (isNewProvision: false)');

    // Verify mapping record created in database
    const mappingCheck = await entraIdentityService.findMapping(TEST_TENANT_ID, 'test_oid_preprov_001');
    record(Boolean(mappingCheck), 'Mapping row inserted into veyra_user_identity_mapping');
    record(mappingCheck?.userId === activeUserId, 'Mapping row references correct user_id');

    // Second login: updates last_authenticated_at without creating duplicate
    const secondLogin = await entraIdentityService.resolveOrProvision(preprovClaims);
    record(secondLogin.success === true, 'Second login resolves deterministically');
    const mappingCount = await dbQuery(
      "SELECT count(*) as count FROM veyra_user_identity_mapping WHERE external_user_id = 'test_oid_preprov_001'"
    );
    record(parseInt(mappingCount.rows[0].count, 10) === 1, 'Only exactly 1 mapping row exists (no duplicate entries)');

    // ========================================================================
    // SECTION 5: Immutable Key Stability vs. Mutable Email Test
    // ========================================================================
    console.log('\n--- Section 5: Immutable Key Stability vs. Mutable Email ---');

    // Simulate enterprise email change in Entra (marriage/name change)
    // Same tenantId and oid, but email changed
    const mutatedEmailClaims = {
      email: 'test.entra.newemail@example.com',
      subject: 'test_oid_preprov_001', // SAME OID
      tenantId: TEST_TENANT_ID,
      displayName: 'Preprovisioned User (Renamed)'
    };

    const mutatedLogin = await entraIdentityService.resolveOrProvision(mutatedEmailClaims);
    record(mutatedLogin.success === true, 'User with changed corporate email resolves via immutable OID');
    record(mutatedLogin.user?.id === activeUserId, 'Resolves to original veyra_user despite email change');
    record(mutatedLogin.mapping?.externalEmail === 'test.entra.newemail@example.com',
      'Identity mapping metadata updated with new email');

    // ========================================================================
    // SECTION 6: Just-In-Time (JIT) Provisioning Policy (AC1 & AC3)
    // ========================================================================
    console.log('\n--- Section 6: Just-In-Time (JIT) Provisioning Policy ---');

    const unmappedEmail = 'test.entra.jituser@example.com';
    const unmappedOid = 'test_oid_jit_001';

    // 6.1 Test JIT disabled policy
    config.entra.jitProvisioning = false;
    const jitDisabledRes = await entraIdentityService.resolveOrProvision({
      email: unmappedEmail,
      subject: unmappedOid,
      tenantId: TEST_TENANT_ID,
      displayName: 'Unmapped Entra Employee'
    });
    record(jitDisabledRes.success === false, 'When JIT disabled, unmapped user is rejected');
    record(jitDisabledRes.code === 'IDENTITY_NOT_PROVISIONED', 'Rejection code is IDENTITY_NOT_PROVISIONED');

    // 6.2 Test JIT enabled policy
    config.entra.jitProvisioning = true;
    const jitEnabledRes = await entraIdentityService.resolveOrProvision({
      email: unmappedEmail,
      subject: unmappedOid,
      tenantId: TEST_TENANT_ID,
      displayName: 'JIT Provisioned Employee'
    });

    record(jitEnabledRes.success === true, 'When JIT enabled, new user is provisioned successfully');
    record(jitEnabledRes.isNewProvision === true, 'Flagged as newly provisioned (isNewProvision: true)');
    record(jitEnabledRes.user?.isLocalUser === false, 'User marked as non-local federated user (is_local_user: false)');
    record(jitEnabledRes.user?.status === 'ACTIVE', 'Newly provisioned user status is ACTIVE');

    // Verify JIT user exists in database and has default role
    const jitUserDb = await dbQuery(
      `SELECT u.id, u.email, u.display_name, r.role_code 
       FROM veyra_user u
       LEFT JOIN veyra_user_role ur ON u.id = ur.user_id
       LEFT JOIN veyra_role r ON ur.role_id = r.id
       WHERE u.email = $1`,
      [unmappedEmail]
    );
    record(jitUserDb.rows.length > 0, 'New user persisted in veyra_user table');
    record(jitUserDb.rows[0].role_code === 'AUDIT_USER', 'New user automatically assigned default AUDIT_USER role');

    // ========================================================================
    // SECTION 7: End-to-End AuthService Integration & Session Issuance
    // ========================================================================
    console.log('\n--- Section 7: End-to-End AuthService Integration & Session Issuance ---');

    // Clear active sessions to prevent 409
    await dbQuery("UPDATE veyra_session SET status = 'EXPIRED' WHERE status = 'ACTIVE'").catch(() => {});

    // Authenticate via authService.loginWithExternalIdentity using claims object
    const authServiceRes = await authService.loginWithExternalIdentity({
      email: unmappedEmail,
      subject: unmappedOid,
      tenantId: TEST_TENANT_ID,
      displayName: 'JIT Provisioned Employee'
    }, {
      ipAddress: '127.0.0.1',
      userAgent: 'e2e-test-agent'
    });

    record(authServiceRes.success === true, 'authService.loginWithExternalIdentity succeeds with claims object');
    record(Boolean(authServiceRes.token), 'Valid JWT session token issued for Entra user');
    record(authServiceRes.role === 'AUDIT_USER', 'Session reflects resolved AUDIT_USER role');

    // Backward compatibility: Test calling with email string (Story 11 contract)
    const stringCallRes = await authService.loginWithExternalIdentity('admin@admin.com', {
      ipAddress: '127.0.0.1',
      userAgent: 'compat-test-agent',
      force: true
    });
    record(stringCallRes.success === true, 'Backward-compatible: calling loginWithExternalIdentity(string) succeeds');

    // ========================================================================
    // SECTION 8: Audit Trail Invariants & Zero Secret Leakage (AC3)
    // ========================================================================
    console.log('\n--- Section 8: Audit Trail Invariants & Zero Secret Leakage (AC3) ---');

    const recentAudits = await dbQuery(
      "SELECT event_type, details FROM veyra_audit_event ORDER BY event_time DESC LIMIT 15"
    );

    let foundJitCreatedAudit = false;
    let foundRoleAssignedAudit = false;
    let leakedSecrets = false;

    for (const row of recentAudits.rows) {
      const detailsStr = JSON.stringify(row.details || {});
      if (row.event_type === 'USER_CREATED' && (row.details?.provisionMode === 'JIT' || row.details?.action === 'JIT_PROVISIONED')) {
        foundJitCreatedAudit = true;
      }
      if (row.event_type === 'ROLE_ASSIGNED' && row.details?.assignedVia === 'ENTRA_JIT') {
        foundRoleAssignedAudit = true;
      }
      if (/password|clientSecret|client_secret|idToken|id_token|codeVerifier|code_verifier/i.test(detailsStr)) {
        leakedSecrets = true;
      }
    }

    record(foundJitCreatedAudit, 'USER_CREATED audit event logged for JIT provisioning');
    record(foundRoleAssignedAudit, 'ROLE_ASSIGNED audit event logged for JIT role mapping');
    record(!leakedSecrets, 'Zero sensitive tokens, secrets, or PKCE verifiers leaked in audit details');

  } finally {
    // Clean up test records
    await dbQuery("DELETE FROM veyra_user_identity_mapping WHERE external_user_id LIKE 'test_oid_%'").catch(() => {});
    await dbQuery("DELETE FROM veyra_user WHERE email LIKE 'test.entra.%@example.com'").catch(() => {});
    await dbQuery("UPDATE veyra_session SET status = 'EXPIRED' WHERE status = 'ACTIVE'").catch(() => {});
    await pool.end();
  }

  // ========================================================================
  // Summary
  // ========================================================================
  console.log('\n================================================================');
  console.log(`  Story 12 Summary: ${testsPassed} passed, ${testsFailed} failed.`);
  if (testsFailed === 0) {
    console.log('  🎉 All Story 12 Identity Mapping & Provisioning Tests Passed!');
  } else {
    console.error(`  ⚠️ Story 12 suite encountered ${testsFailed} failures.`);
  }
  console.log('================================================================');

  process.exit(testsFailed > 0 ? 1 : 0);
}

runStory12Tests().catch((err) => {
  console.error('Fatal error during Story 12 test execution:', err);
  process.exit(1);
});
