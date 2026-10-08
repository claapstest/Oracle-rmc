const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5433/veyra_db'
});

const BASE_URL = 'http://localhost:5000/api';

async function clearSessions() {
  await pool.query("UPDATE veyra_session SET status = 'LOGGED_OUT' WHERE status = 'ACTIVE'");
}

async function login(email, password) {
  await clearSessions();
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Login failed for ${email} (${res.status}): ${JSON.stringify(data)}`);
  }
  return { token: data.token, user: data.user || data };
}

async function run() {
  console.log('================================================================');
  console.log('   VEYRA SITE ADMIN PRODUCT-LEVEL UPGRADE VERIFICATION SUITE    ');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] ${message}`);
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: SITE_ADMIN Authentication & Token Validation
    // -------------------------------------------------------------
    console.log('--- 1. SITE_ADMIN Authentication ---');
    const adminSession = await login('admin@admin.com', 'Admin@123');
    assert(Boolean(adminSession.token), 'Site Admin logged in successfully with active JWT session');
    assert(adminSession.user.role === 'SITE_ADMIN', 'Session role is correctly identified as SITE_ADMIN');
    
    // Check permissions returned in session
    const statusRes = await fetch(`${BASE_URL}/auth/status`, {
      headers: { Authorization: `Bearer ${adminSession.token}` }
    });
    const statusData = await statusRes.json();
    assert(statusData.loggedIn === true, 'Session status confirms loggedIn: true');
    assert(Array.isArray(statusData.permissions), 'Permissions array is present in session');
    assert(
      statusData.permissions.includes('USER_MANAGEMENT') &&
      statusData.permissions.includes('ORACLE_INTEGRATION') &&
      statusData.permissions.includes('ORACLE_API_CONSOLE'),
      'Site Admin possesses USER_MANAGEMENT, ORACLE_INTEGRATION, and ORACLE_API_CONSOLE privileges'
    );

    // -------------------------------------------------------------
    // TEST 2: Security & Credential Protection on Settings API
    // -------------------------------------------------------------
    console.log('\n--- 2. Settings API & Credential Masking ---');
    const settingsRes = await fetch(`${BASE_URL}/settings`, {
      headers: { Authorization: `Bearer ${adminSession.token}` }
    });
    const settingsData = await settingsRes.json();
    assert(settingsRes.status === 200, 'GET /settings returns 200 OK for authorized Site Admin');
    assert(typeof settingsData.isConfigured === 'boolean', 'Settings returns boolean isConfigured');
    assert(typeof settingsData.status === 'string', `Settings returns high-level status: "${settingsData.status}"`);
    assert(settingsData.password === undefined, 'CRITICAL: Oracle password is NEVER exposed in GET /settings response');
    assert(settingsData.token === undefined, 'CRITICAL: Oracle auth token is NEVER exposed in GET /settings response');
    assert(settingsData.groqApiKey === undefined, 'CRITICAL: Groq API key is NEVER exposed in GET /settings response');
    assert(settingsData.hasPassword === true || settingsData.hasPassword === false, 'Settings provides safe boolean hasPassword');
    assert(settingsData.hasToken === true || settingsData.hasToken === false, 'Settings provides safe boolean hasToken');

    // Test connection probe updates timestamp and status
    const testConnRes = await fetch(`${BASE_URL}/settings/test-connection`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${adminSession.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    const testConnData = await testConnRes.json();
    assert(testConnRes.status === 200, 'POST /settings/test-connection returns 200 OK');
    assert(testConnData.success !== undefined, `Connection test completed with result: ${testConnData.success ? 'Success' : 'Failed'}`);

    // Re-verify GET /settings has timestamp recorded
    const settingsRecheck = await (await fetch(`${BASE_URL}/settings`, {
      headers: { Authorization: `Bearer ${adminSession.token}` }
    })).json();
    assert(Boolean(settingsRecheck.lastTestedAt), `Settings records lastTestedAt timestamp: ${settingsRecheck.lastTestedAt}`);

    // -------------------------------------------------------------
    // TEST 3: User Management Operations (Unified Page Backend)
    // -------------------------------------------------------------
    console.log('\n--- 3. Dedicated User Management Operations ---');
    const usersListRes = await fetch(`${BASE_URL}/admin/users`, {
      headers: { Authorization: `Bearer ${adminSession.token}` }
    });
    const usersListData = await usersListRes.json();
    assert(usersListRes.status === 200, 'GET /admin/users returns 200 OK');
    assert(Array.isArray(usersListData.users) && usersListData.users.length > 0, `Retrieved ${usersListData.users?.length} registered users`);

    // Verify safe fields only
    const sampleUser = usersListData.users[0];
    assert(sampleUser.password === undefined && sampleUser.password_hash === undefined, 'User list does not expose password hashes');
    assert(sampleUser.email !== undefined, 'User record carries email');
    assert(sampleUser.role !== undefined, 'User record carries role');

    // Test toggle status on non-admin user
    const targetUser = usersListData.users.find(u => u.email !== 'admin@admin.com') || { email: 'audit.user@claaps.com', isActive: true };
    const initialActive = targetUser.isActive;
    
    const toggleRes = await fetch(`${BASE_URL}/admin/users/toggle-status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminSession.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: targetUser.email, active: !initialActive })
    });
    const toggleData = await toggleRes.json();
    assert(toggleRes.status === 200 && toggleData.success === true, `Successfully toggled account status for ${targetUser.email}`);

    // Revert status
    await fetch(`${BASE_URL}/admin/users/toggle-status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminSession.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: targetUser.email, active: initialActive })
    });

    // Test self-deactivation guard
    const selfToggleRes = await fetch(`${BASE_URL}/admin/users/toggle-status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminSession.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: 'admin@admin.com', active: false })
    });
    assert(selfToggleRes.status === 400, 'Self-deactivation guard blocks administrator from deactivating own account (HTTP 400)');

    // Test generate reset code
    const resetCodeRes = await fetch(`${BASE_URL}/admin/users/generate-reset-code`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminSession.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: targetUser.email })
    });
    const resetCodeData = await resetCodeRes.json();
    assert(resetCodeRes.status === 200 && resetCodeData.success === true, `Generated 1-hour secure reset code: ${resetCodeData.resetCode}`);
    assert(typeof resetCodeData.resetCode === 'string' && resetCodeData.resetCode.length >= 6, 'Reset code format is valid alphanumeric');

    // Test revoke reset code
    const revokeCodeRes = await fetch(`${BASE_URL}/admin/users/revoke-reset-code`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminSession.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: targetUser.email })
    });
    const revokeCodeData = await revokeCodeRes.json();
    assert(revokeCodeRes.status === 200 && revokeCodeData.success === true, `Successfully revoked reset code for ${targetUser.email}`);

    // Test user creation, update, and deletion via /users endpoints
    const testEmail = `test.siteadmin.${Date.now()}@veyra.test`;
    const createRes = await fetch(`${BASE_URL}/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminSession.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: testEmail,
        displayName: 'Test Admin User',
        role: 'AUDIT_USER',
        status: 'ACTIVE'
      })
    });
    const createData = await createRes.json();
    assert(createRes.status === 201 && createData.success === true, `POST /users created new test user (${testEmail})`);

    const updateRes = await fetch(`${BASE_URL}/users/${encodeURIComponent(testEmail)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminSession.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        displayName: 'Updated Test User',
        role: 'AUDIT_USER',
        status: 'ACTIVE'
      })
    });
    const updateData = await updateRes.json();
    assert(updateRes.status === 200 && updateData.success === true, `PUT /users/:id updated user display name`);

    const deleteRes = await fetch(`${BASE_URL}/users/${encodeURIComponent(testEmail)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminSession.token}` }
    });
    const deleteData = await deleteRes.json();
    assert(deleteRes.status === 200 && deleteData.success === true, `DELETE /users/:id permanently deleted test user`);

    // -------------------------------------------------------------
    // TEST 4: Oracle API Console Access
    // -------------------------------------------------------------
    console.log('\n--- 4. Oracle API Console Module ---');
    const catalogRes = await fetch(`${BASE_URL}/command-center/catalog`, {
      headers: { Authorization: `Bearer ${adminSession.token}` }
    });
    const catalogData = await catalogRes.json();
    assert(catalogRes.status === 200 && catalogData.success === true, 'GET /command-center/catalog returns 200 OK for Site Admin');
    assert(Array.isArray(catalogData.catalog) && catalogData.catalog.length > 0, `Catalog contains ${catalogData.catalog?.length} available Oracle API endpoints`);

    const historyRes = await fetch(`${BASE_URL}/command-center/history`, {
      headers: { Authorization: `Bearer ${adminSession.token}` }
    });
    assert(historyRes.status === 200, 'GET /command-center/history returns 200 OK for Site Admin');

    // -------------------------------------------------------------
    // TEST 5: Backend Authorization Enforcement (Non-Admin Roles)
    // -------------------------------------------------------------
    console.log('\n--- 5. Backend Authorization Enforcement for Non-Admin Personas ---');
    
    // Test AUDIT_MANAGER
    const managerSession = await login('audit.manager@claaps.com', 'Manager@123');
    assert(Boolean(managerSession.token), 'Logged in as Audit Manager (audit.manager@claaps.com)');

    // Attempt to access administrative APIs
    const mgrSettingsRes = await fetch(`${BASE_URL}/settings`, {
      headers: { Authorization: `Bearer ${managerSession.token}` }
    });
    assert(mgrSettingsRes.status === 403, 'Audit Manager GET /settings is REJECTED with 403 Forbidden (requires ORACLE_INTEGRATION)');

    const mgrUsersRes = await fetch(`${BASE_URL}/admin/users`, {
      headers: { Authorization: `Bearer ${managerSession.token}` }
    });
    assert(mgrUsersRes.status === 403, 'Audit Manager GET /admin/users is REJECTED with 403 Forbidden (requires USER_MANAGEMENT)');

    // Audit Manager has USERS_LIST and can access Oracle users directory
    const mgrOracleUsersRes = await fetch(`${BASE_URL}/users?source=oracle&count=5`, {
      headers: { Authorization: `Bearer ${managerSession.token}` }
    });
    assert(mgrOracleUsersRes.status === 200, 'Audit Manager GET /users (Users List) succeeds with 200 OK (has USERS_LIST)');

    const mgrConsoleRes = await fetch(`${BASE_URL}/command-center/catalog`, {
      headers: { Authorization: `Bearer ${managerSession.token}` }
    });
    assert(mgrConsoleRes.status === 403, 'Audit Manager GET /command-center/catalog is REJECTED with 403 Forbidden (requires ORACLE_API_CONSOLE)');

    // Test AUDIT_SUPERVISOR
    const supervisorSession = await login('audit.supervisor@claaps.com', 'Supervisor@123');
    assert(Boolean(supervisorSession.token), 'Logged in as Audit Supervisor (audit.supervisor@claaps.com)');

    const supSettingsRes = await fetch(`${BASE_URL}/settings`, {
      headers: { Authorization: `Bearer ${supervisorSession.token}` }
    });
    assert(supSettingsRes.status === 403, 'Audit Supervisor GET /settings is REJECTED with 403 Forbidden');

    const supUsersRes = await fetch(`${BASE_URL}/admin/users`, {
      headers: { Authorization: `Bearer ${supervisorSession.token}` }
    });
    assert(supUsersRes.status === 403, 'Audit Supervisor GET /admin/users is REJECTED with 403 Forbidden');

    const supConsoleRes = await fetch(`${BASE_URL}/command-center/catalog`, {
      headers: { Authorization: `Bearer ${supervisorSession.token}` }
    });
    assert(supConsoleRes.status === 403, 'Audit Supervisor GET /command-center/catalog is REJECTED with 403 Forbidden');

    // Test AUDIT_USER
    // Check if audit.user@claaps.com can login or has password
    await clearSessions();
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('Auditor@123', 10);
    await pool.query("UPDATE veyra_user SET password_hash = $1, status = 'ACTIVE' WHERE email = 'audit.user@claaps.com'", [hash]);

    const auditorSession = await login('audit.user@claaps.com', 'Auditor@123');
    assert(Boolean(auditorSession.token), 'Logged in as Audit User (audit.user@claaps.com)');

    const audSettingsRes = await fetch(`${BASE_URL}/settings`, {
      headers: { Authorization: `Bearer ${auditorSession.token}` }
    });
    assert(audSettingsRes.status === 403, 'Audit User GET /settings is REJECTED with 403 Forbidden');

    const audUsersRes = await fetch(`${BASE_URL}/admin/users`, {
      headers: { Authorization: `Bearer ${auditorSession.token}` }
    });
    assert(audUsersRes.status === 403, 'Audit User GET /admin/users is REJECTED with 403 Forbidden');

    const audConsoleRes = await fetch(`${BASE_URL}/command-center/catalog`, {
      headers: { Authorization: `Bearer ${auditorSession.token}` }
    });
    assert(audConsoleRes.status === 403, 'Audit User GET /command-center/catalog is REJECTED with 403 Forbidden');

    // -------------------------------------------------------------
    // TEST 6: Unauthenticated Request Blocking
    // -------------------------------------------------------------
    console.log('\n--- 6. Unauthenticated Direct API Protection ---');
    const noAuthSettings = await fetch(`${BASE_URL}/settings`);
    assert(noAuthSettings.status === 401, 'Unauthenticated GET /settings rejected with 401 Unauthorized');

    const noAuthUsers = await fetch(`${BASE_URL}/admin/users`);
    assert(noAuthUsers.status === 401, 'Unauthenticated GET /admin/users rejected with 401 Unauthorized');

    const noAuthConsole = await fetch(`${BASE_URL}/command-center/catalog`);
    assert(noAuthConsole.status === 401, 'Unauthenticated GET /command-center/catalog rejected with 401 Unauthorized');

    console.log('\n================================================================');
    console.log(`TEST SUMMARY: ${passedTests} / ${totalTests} assertions passed (${Math.round((passedTests / totalTests) * 100)}%)`);
    console.log('================================================================\n');

    if (passedTests === totalTests) {
      console.log('ALL TESTS PASSED SUCCESSFULLY!');
    } else {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exitCode = 1;
  } finally {
    await clearSessions();
    await pool.end();
  }
}

run();
