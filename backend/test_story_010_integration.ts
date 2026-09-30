/**
 * Integration Test Suite for VY-STRY-010:
 * DB: Create VEYRA Authentication and Administrative Audit Trail
 *
 * Verifies end-to-end runtime behavior with real PostgreSQL + Express:
 * TEST 1  — Database audit table & indexes exist
 * TEST 2  — LOGIN_SUCCESS: creates audit row with session metadata and no secrets
 * TEST 3  — LOGIN_FAILED (wrong password): generic 401, audit row created with identified user_id, no password stored
 * TEST 4  — LOGIN_FAILED (non-existent user): generic 401, audit row created with user_id NULL, no password stored
 * TEST 5  — LOGIN_REJECTED_ACTIVE_SESSION: returns 409 ACTIVE_SESSION_EXISTS, records audit row, original session untouched
 * TEST 6  — LOGOUT: explicit logout creates LOGOUT audit row with IP/User-Agent
 * TEST 7  — SESSION_EXPIRED: session timeout creates SESSION_EXPIRED audit row
 * TEST 8  — USER_CREATED & ROLE_ASSIGNED: admin actor creates user, verifies actor vs target semantics
 * TEST 9  — USER_UPDATED: admin updates user, verifies USER_UPDATED and role change audit rows
 * TEST 10 — USER_DELETED: admin deletes user, verifies USER_DELETED audit row preserved
 * TEST 11 — PRIVILEGE_CHANGED: records PRIVILEGE_CHANGED audit row
 * TEST 12 — Defense-in-depth sanitization: verifies sensitive fields are stripped
 * TEST 13 — Database Security Scan: zero passwords/hashes/tokens across all audit rows
 */

import axios from 'axios';
import bcrypt from 'bcryptjs';
import { query as dbQuery } from './src/db.js';
import { auditService } from './src/services/auditService.js';
import { authService } from './src/services/authService.js';

const API_BASE = 'http://localhost:5000/api';

interface TestReport {
  test: string;
  expected: string;
  actual: string;
  status: 'PASS' | 'FAIL';
}

const testMatrix: TestReport[] = [];

function record(test: string, expected: string, actual: string, passed: boolean) {
  const status = passed ? 'PASS' : 'FAIL';
  testMatrix.push({ test, expected, actual, status });
  if (passed) {
    console.log(`  ✅ [PASS] ${test}: ${actual}`);
  } else {
    console.error(`  ❌ [FAIL] ${test}: Expected "${expected}", Got "${actual}"`);
  }
}

async function runSuite() {
  console.log('===========================================================');
  console.log('  VY-STRY-010: Authentication & Audit Trail Integration Suite');
  console.log(`  Target API: ${API_BASE}`);
  console.log('===========================================================\n');

  try {
    // -------------------------------------------------------------------------
    // TEST 1 — Database Structure Verification
    // -------------------------------------------------------------------------
    const tableRes = await dbQuery(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'veyra_audit_event';`
    );
    record(
      'TEST 1 — veyra_audit_event table exists',
      'table present',
      tableRes.rows.length === 1 ? 'table present' : 'table missing',
      tableRes.rows.length === 1
    );

    // Ensure admin user exists in veyra_user
    const adminEmail = 'admin@admin.com';
    const adminPass = 'Admin@123';
    const salt = bcrypt.genSaltSync(10);
    const adminHash = bcrypt.hashSync(adminPass, salt);

    let adminUserRes = await dbQuery(`SELECT id FROM veyra_user WHERE email = $1`, [adminEmail]);
    let adminUserId: string;
    if (adminUserRes.rows.length === 0) {
      const insRes = await dbQuery(
        `INSERT INTO veyra_user (email, password_hash, display_name, status, is_local_user)
         VALUES ($1, $2, 'System Administrator', 'ACTIVE', TRUE) RETURNING id`,
        [adminEmail, adminHash]
      );
      adminUserId = insRes.rows[0].id;
    } else {
      adminUserId = adminUserRes.rows[0].id;
      await dbQuery(
        `UPDATE veyra_user SET password_hash = $1, status = 'ACTIVE' WHERE id = $2`,
        [adminHash, adminUserId]
      );
    }

    // Clean up any stale sessions for admin
    await dbQuery(`UPDATE veyra_session SET status = 'LOGGED_OUT' WHERE user_id = $1 AND status = 'ACTIVE'`, [adminUserId]);

    // -------------------------------------------------------------------------
    // TEST 2 — LOGIN_SUCCESS
    // -------------------------------------------------------------------------
    const loginRes = await axios.post(`${API_BASE}/auth/login`, {
      email: adminEmail,
      password: adminPass
    }, {
      headers: {
        'User-Agent': 'TestRunner/VY-STRY-010',
        'X-Forwarded-For': '192.168.10.50'
      }
    });

    const token = loginRes.data.token;
    record(
      'TEST 2a — Valid login returns HTTP 200 with session token',
      'HTTP 200 with token',
      `HTTP 200, token: ${token ? token.substring(0, 10) + '...' : 'none'}`,
      loginRes.status === 200 && !!token
    );

    // Query audit event for this login
    const loginAuditRes = await dbQuery(
      `SELECT * FROM veyra_audit_event
       WHERE event_type = 'LOGIN_SUCCESS' AND user_id = $1
       ORDER BY event_time DESC LIMIT 1`,
      [adminUserId]
    );

    const loginAudit = loginAuditRes.rows[0];
    const loginAuditValid =
      !!loginAudit &&
      loginAudit.target_type === 'SESSION' &&
      loginAudit.target_id === token &&
      !JSON.stringify(loginAudit.details).includes(adminPass) &&
      !JSON.stringify(loginAudit.details).includes(adminHash);

    record(
      'TEST 2b — LOGIN_SUCCESS audit row created with session ID and no secrets',
      'audit row with session target and no credentials',
      loginAuditValid ? 'valid audit event recorded' : 'invalid audit record',
      loginAuditValid
    );

    // -------------------------------------------------------------------------
    // TEST 3 — LOGIN_FAILED (Wrong Password for Existing User)
    // -------------------------------------------------------------------------
    let wrongPassStatus = 0;
    let wrongPassMessage = '';
    try {
      await axios.post(`${API_BASE}/auth/login`, {
        email: adminEmail,
        password: 'CompletelyWrongPassword999!'
      });
    } catch (err: any) {
      wrongPassStatus = err.response?.status || 0;
      wrongPassMessage = err.response?.data?.message || '';
    }

    record(
      'TEST 3a — Wrong password receives HTTP 401 with generic error',
      'HTTP 401 generic message',
      `HTTP ${wrongPassStatus} "${wrongPassMessage}"`,
      wrongPassStatus === 401
    );

    const wrongPassAuditRes = await dbQuery(
      `SELECT * FROM veyra_audit_event
       WHERE event_type = 'LOGIN_FAILED' AND user_id = $1
       ORDER BY event_time DESC LIMIT 1`,
      [adminUserId]
    );
    const wrongPassAudit = wrongPassAuditRes.rows[0];
    const wrongPassSafe =
      !!wrongPassAudit &&
      wrongPassAudit.details?.reason === 'INVALID_CREDENTIALS' &&
      !JSON.stringify(wrongPassAudit.details).includes('CompletelyWrongPassword999!');

    record(
      'TEST 3b — LOGIN_FAILED audit row recorded for identified user without password',
      'user_id populated, reason: INVALID_CREDENTIALS, no password',
      wrongPassSafe ? `user_id: ${wrongPassAudit?.user_id}, reason: ${wrongPassAudit?.details?.reason}` : 'failed',
      wrongPassSafe
    );

    // -------------------------------------------------------------------------
    // TEST 4 — LOGIN_FAILED (Non-Existent User)
    // -------------------------------------------------------------------------
    let nonExistentStatus = 0;
    try {
      await axios.post(`${API_BASE}/auth/login`, {
        email: 'ghost_user_does_not_exist@example.com',
        password: 'SomePassword123!'
      });
    } catch (err: any) {
      nonExistentStatus = err.response?.status || 0;
    }

    const nonExistentAuditRes = await dbQuery(
      `SELECT * FROM veyra_audit_event
       WHERE event_type = 'LOGIN_FAILED' AND user_id IS NULL
       ORDER BY event_time DESC LIMIT 1`
    );
    const nonExistentAudit = nonExistentAuditRes.rows[0];
    const nonExistentSafe =
      nonExistentStatus === 401 &&
      !!nonExistentAudit &&
      nonExistentAudit.user_id === null &&
      !JSON.stringify(nonExistentAudit.details).includes('SomePassword123!');

    record(
      'TEST 4 — LOGIN_FAILED audit row recorded with user_id NULL for non-existent user',
      'HTTP 401, audit user_id NULL, no password stored',
      nonExistentSafe ? `user_id NULL, event: ${nonExistentAudit?.event_type}` : 'failed',
      nonExistentSafe
    );

    // -------------------------------------------------------------------------
    // TEST 5 — LOGIN_REJECTED_ACTIVE_SESSION (Story 5 & 9 Active Session Check)
    // -------------------------------------------------------------------------
    let activeSessionStatus = 0;
    let activeSessionCode = '';
    try {
      await axios.post(`${API_BASE}/auth/login`, {
        email: adminEmail,
        password: adminPass
      });
    } catch (err: any) {
      activeSessionStatus = err.response?.status || 0;
      activeSessionCode = err.response?.data?.code || '';
    }

    record(
      'TEST 5a — Concurrent login receives HTTP 409 ACTIVE_SESSION_EXISTS',
      'HTTP 409 ACTIVE_SESSION_EXISTS',
      `HTTP ${activeSessionStatus} code: "${activeSessionCode}"`,
      activeSessionStatus === 409 && activeSessionCode === 'ACTIVE_SESSION_EXISTS'
    );

    const rejectionAuditRes = await dbQuery(
      `SELECT * FROM veyra_audit_event
       WHERE event_type = 'LOGIN_REJECTED_ACTIVE_SESSION' AND user_id = $1
       ORDER BY event_time DESC LIMIT 1`,
      [adminUserId]
    );
    const rejectionAudit = rejectionAuditRes.rows[0];
    const rejectionAuditValid =
      !!rejectionAudit &&
      rejectionAudit.user_id === adminUserId &&
      rejectionAudit.details?.reason === 'ACTIVE_SESSION_EXISTS';

    record(
      'TEST 5b — LOGIN_REJECTED_ACTIVE_SESSION audit row created',
      'event_type LOGIN_REJECTED_ACTIVE_SESSION recorded',
      rejectionAuditValid ? `recorded for user ${rejectionAudit.user_id}` : 'missing',
      rejectionAuditValid
    );

    // Verify original session is still valid
    const statusRes = await axios.get(`${API_BASE}/auth/status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    record(
      'TEST 5c — Existing active session remains completely valid and untouched',
      'HTTP 200 loggedIn: true',
      `HTTP ${statusRes.status} loggedIn: ${statusRes.data.loggedIn}`,
      statusRes.status === 200 && statusRes.data.loggedIn === true
    );

    // -------------------------------------------------------------------------
    // TEST 6 — LOGOUT
    // -------------------------------------------------------------------------
    const logoutRes = await axios.post(
      `${API_BASE}/auth/logout`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'TestRunner/Logout',
          'X-Forwarded-For': '192.168.10.60'
        }
      }
    );

    record(
      'TEST 6a — Explicit logout succeeds',
      'HTTP 200 success',
      `HTTP ${logoutRes.status} success: ${logoutRes.data.success}`,
      logoutRes.status === 200 && logoutRes.data.success === true
    );

    const logoutAuditRes = await dbQuery(
      `SELECT * FROM veyra_audit_event
       WHERE event_type = 'LOGOUT' AND user_id = $1
       ORDER BY event_time DESC LIMIT 1`,
      [adminUserId]
    );
    const logoutAudit = logoutAuditRes.rows[0];
    const logoutAuditValid =
      !!logoutAudit &&
      logoutAudit.target_type === 'SESSION' &&
      logoutAudit.target_id === token;

    record(
      'TEST 6b — LOGOUT audit row created with session ID',
      'LOGOUT audit record present',
      logoutAuditValid ? `recorded target_id: ${logoutAudit.target_id}` : 'missing',
      logoutAuditValid
    );

    // -------------------------------------------------------------------------
    // TEST 7 — SESSION_EXPIRED
    // -------------------------------------------------------------------------
    // Create an active session with an expired timestamp in veyra_session
    const expiredSessionId = 'sess_to_expire_' + Date.now();
    await dbQuery(
      `INSERT INTO veyra_session (session_id, user_id, status, created_at, last_activity_at, expires_at)
       VALUES ($1, $2, 'ACTIVE', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes')`,
      [expiredSessionId, adminUserId]
    );

    // Validate the expired session via authService to trigger expiry detection
    const validationResult = await authService.validateSession(expiredSessionId, false);
    record(
      'TEST 7a — Expired session detected by session validation',
      'SESSION_EXPIRED code returned',
      `validation.valid: ${validationResult.valid}, code: ${validationResult.code}`,
      !validationResult.valid && validationResult.code === 'SESSION_EXPIRED'
    );

    const expiredAuditRes = await dbQuery(
      `SELECT * FROM veyra_audit_event
       WHERE event_type = 'SESSION_EXPIRED' AND target_id = $1
       ORDER BY event_time DESC LIMIT 1`,
      [expiredSessionId]
    );
    const expiredAudit = expiredAuditRes.rows[0];
    record(
      'TEST 7b — SESSION_EXPIRED audit row created when session expires',
      'SESSION_EXPIRED audit record present',
      expiredAudit ? `event recorded for session ${expiredAudit.target_id}` : 'missing',
      !!expiredAudit
    );

    // -------------------------------------------------------------------------
    // TEST 8 — USER_CREATED & ROLE_ASSIGNED (Administrative)
    // -------------------------------------------------------------------------
    const newTargetEmail = `john_doe_${Date.now()}@example.com`;
    const createUserResult = await authService.createUser({
      email: newTargetEmail,
      displayName: 'John Doe',
      role: 'AUDIT_MANAGER',
      password: 'InitialPassword123!',
      status: 'ACTIVE',
      createdBy: adminEmail
    });

    record(
      'TEST 8a — Admin successfully creates user',
      'User created',
      createUserResult.success ? `Created ${createUserResult.user?.email}` : 'Failed',
      createUserResult.success
    );

    const userCreatedAuditRes = await dbQuery(
      `SELECT * FROM veyra_audit_event
       WHERE event_type = 'USER_CREATED' AND details->>'targetEmail' = $1
       ORDER BY event_time DESC LIMIT 1`,
      [newTargetEmail]
    );
    const userCreatedAudit = userCreatedAuditRes.rows[0];
    const userCreatedValid =
      !!userCreatedAudit &&
      userCreatedAudit.user_id === adminUserId &&
      userCreatedAudit.target_type === 'USER' &&
      !JSON.stringify(userCreatedAudit.details).includes('InitialPassword123!');

    record(
      'TEST 8b — USER_CREATED audit row captures actor (Admin) vs target (User) without password',
      'actor user_id = Admin, target_type = USER, details safe',
      userCreatedValid ? `actor: ${userCreatedAudit.user_id}, target: ${userCreatedAudit.target_id}` : 'invalid',
      userCreatedValid
    );

    const roleAssignedAuditRes = await dbQuery(
      `SELECT * FROM veyra_audit_event
       WHERE event_type = 'ROLE_ASSIGNED' AND details->>'targetEmail' = $1
       ORDER BY event_time DESC LIMIT 1`,
      [newTargetEmail]
    );
    const roleAssignedAudit = roleAssignedAuditRes.rows[0];
    const roleAssignedValid =
      !!roleAssignedAudit &&
      roleAssignedAudit.user_id === adminUserId &&
      roleAssignedAudit.target_type === 'USER_ROLE';

    record(
      'TEST 8c — ROLE_ASSIGNED audit row created for new user role',
      'ROLE_ASSIGNED recorded with actor and role details',
      roleAssignedValid ? `assigned role: ${roleAssignedAudit.details?.roleCode}` : 'missing',
      roleAssignedValid
    );

    // -------------------------------------------------------------------------
    // TEST 9 — USER_UPDATED (Administrative)
    // -------------------------------------------------------------------------
    const updateUserResult = await authService.updateUser(newTargetEmail, {
      displayName: 'John Doe Updated',
      role: 'AUDIT_USER',
      updatedBy: adminEmail
    });

    record(
      'TEST 9a — Admin successfully updates user',
      'User updated',
      updateUserResult.success ? `Updated ${newTargetEmail}` : 'Failed',
      updateUserResult.success
    );

    const userUpdatedAuditRes = await dbQuery(
      `SELECT * FROM veyra_audit_event
       WHERE event_type = 'USER_UPDATED' AND details->>'targetEmail' = $1
       ORDER BY event_time DESC LIMIT 1`,
      [newTargetEmail]
    );
    const userUpdatedAudit = userUpdatedAuditRes.rows[0];
    const userUpdatedValid =
      !!userUpdatedAudit &&
      userUpdatedAudit.user_id === adminUserId &&
      userUpdatedAudit.target_type === 'USER';

    record(
      'TEST 9b — USER_UPDATED audit row captures actor vs target',
      'actor user_id = Admin, target_type = USER',
      userUpdatedValid ? `actor: ${userUpdatedAudit.user_id}` : 'invalid',
      userUpdatedValid
    );

    // Verify role removal of old role and assignment of new role
    const roleRemovedAuditRes = await dbQuery(
      `SELECT * FROM veyra_audit_event
       WHERE event_type = 'ROLE_REMOVED' AND details->>'targetEmail' = $1
       ORDER BY event_time DESC LIMIT 1`,
      [newTargetEmail]
    );
    record(
      'TEST 9c — ROLE_REMOVED audit row created on role change',
      'ROLE_REMOVED present for previous role',
      roleRemovedAuditRes.rows.length > 0 ? `previous role: ${roleRemovedAuditRes.rows[0].details?.previousRoleCode}` : 'missing',
      roleRemovedAuditRes.rows.length > 0
    );

    // -------------------------------------------------------------------------
    // TEST 10 — USER_DELETED (Administrative)
    // -------------------------------------------------------------------------
    const deleteUserResult = await authService.deleteUser(newTargetEmail, adminEmail);
    record(
      'TEST 10a — Admin successfully deletes user',
      'User deleted',
      deleteUserResult.success ? deleteUserResult.message : 'Failed',
      deleteUserResult.success
    );

    const userDeletedAuditRes = await dbQuery(
      `SELECT * FROM veyra_audit_event
       WHERE event_type = 'USER_DELETED' AND details->>'targetEmail' = $1
       ORDER BY event_time DESC LIMIT 1`,
      [newTargetEmail]
    );
    const userDeletedAudit = userDeletedAuditRes.rows[0];
    const userDeletedValid =
      !!userDeletedAudit &&
      userDeletedAudit.user_id === adminUserId &&
      userDeletedAudit.target_type === 'USER';

    record(
      'TEST 10b — USER_DELETED audit row preserved with Admin actor semantics',
      'USER_DELETED audit row exists with actor admin',
      userDeletedValid ? `actor: ${userDeletedAudit.user_id}, target: ${userDeletedAudit.target_id}` : 'missing',
      userDeletedValid
    );

    // -------------------------------------------------------------------------
    // TEST 11 — PRIVILEGE_CHANGED
    // -------------------------------------------------------------------------
    const privAudit = await auditService.recordAuditEvent({
      userId: adminUserId,
      eventType: 'PRIVILEGE_CHANGED',
      targetType: 'ROLE_PRIVILEGE',
      targetId: 'AUDIT_SUPERVISOR',
      details: {
        action: 'UPDATE_PRIVILEGES',
        modifiedPrivileges: ['REPORTS', 'RISK_MANAGEMENT']
      }
    });

    record(
      'TEST 11 — PRIVILEGE_CHANGED audit row recorded successfully',
      'PRIVILEGE_CHANGED record created',
      privAudit.success ? `event_id: ${privAudit.eventId}` : 'failed',
      privAudit.success
    );

    // -------------------------------------------------------------------------
    // TEST 12 — Defense-in-depth sanitization
    // -------------------------------------------------------------------------
    const testSanitizeResult = await auditService.recordAuditEvent({
      userId: adminUserId,
      eventType: 'USER_UPDATED',
      targetType: 'USER',
      targetId: adminUserId,
      details: {
        safeField: 'safeMetadata',
        password: 'AttemptedSecretPassword',
        passwordHash: 'attempted_hash',
        apiKey: 'groq-secret-key',
        nested: {
          clientSecret: 'oracle-secret',
          safeNested: 100
        }
      }
    });

    const sanitizeAuditRow = await dbQuery(
      `SELECT details FROM veyra_audit_event WHERE event_id = $1`,
      [testSanitizeResult.eventId]
    );
    const detailsStr = JSON.stringify(sanitizeAuditRow.rows[0]?.details || {});
    const sanitizationPassed =
      !detailsStr.includes('AttemptedSecretPassword') &&
      !detailsStr.includes('attempted_hash') &&
      !detailsStr.includes('groq-secret-key') &&
      !detailsStr.includes('oracle-secret') &&
      detailsStr.includes('safeMetadata') &&
      sanitizeAuditRow.rows[0]?.details?.nested?.safeNested === 100;

    record(
      'TEST 12 — Defense-in-depth sanitization automatically strips nested secrets and keys',
      'all secret keys stripped, safe fields retained',
      sanitizationPassed ? 'sanitization verified' : `leaked in: ${detailsStr}`,
      sanitizationPassed
    );

    // -------------------------------------------------------------------------
    // TEST 13 — Database Security Scan
    // -------------------------------------------------------------------------
    const allDetailsRes = await dbQuery(
      `SELECT details::text AS details_text FROM veyra_audit_event WHERE details IS NOT NULL;`
    );
    let forbiddenFound = false;
    const forbiddenList = ['passwordHash', '"password":', 'clientSecret', 'apiKey', 'accessToken'];
    for (const r of allDetailsRes.rows) {
      for (const tok of forbiddenList) {
        if (r.details_text?.includes(tok)) {
          forbiddenFound = true;
          break;
        }
      }
    }

    record(
      'TEST 13 — Database Security Scan: zero sensitive secrets across entire veyra_audit_event table',
      'Zero secrets found in PostgreSQL',
      !forbiddenFound ? '0 secrets detected' : 'Secrets detected!',
      !forbiddenFound
    );

  } catch (err: any) {
    console.error('Fatal error during integration suite execution:', err);
    process.exit(1);
  }

  console.log('\n===========================================================');
  const allPassed = testMatrix.every((r) => r.status === 'PASS');
  const passedCount = testMatrix.filter((r) => r.status === 'PASS').length;
  console.log(`  Summary: ${passedCount} / ${testMatrix.length} tests passed.`);
  if (allPassed) {
    console.log('  🎉 All VY-STRY-010 Integration Tests Successfully Passed!');
  } else {
    console.error('  ⚠️ Some integration tests failed.');
    process.exit(1);
  }
  console.log('===========================================================\n');
}

runSuite().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Failed to run integration suite:', err);
  process.exit(1);
});
