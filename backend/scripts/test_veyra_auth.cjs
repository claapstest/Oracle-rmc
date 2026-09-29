const http = require('http');
const path = require('path');
const fs = require('fs');

// We will start the backend Express server locally or test via internal module import
const { authService } = require('../dist/services/authService.js');

async function runTests() {
  console.log('===========================================================');
  console.log('🧪 Starting Claaps Veyra Authentication Test Suite (AC1-AC8)');
  console.log('===========================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Test AC1 & AC6: Site Admin Login (admin@admin.com)
    // -------------------------------------------------------------
    console.log('\n[Testing AC1 & AC6: Site Admin Authentication]');
    const adminLogin = await authService.login('admin@admin.com', 'Admin@123');
    assert(adminLogin.success === true, 'admin@admin.com authenticates successfully');
    assert(adminLogin.role === 'SITE_ADMIN', 'admin@admin.com has SITE_ADMIN role');
    assert(adminLogin.isAdmin === true, 'admin@admin.com has isAdmin = true');
    assert(Array.isArray(adminLogin.permissions) && adminLogin.permissions.includes('ALL'), 'admin@admin.com has ALL permission');
    assert(adminLogin.token && adminLogin.token.length > 20, 'Session token is created');

    // -------------------------------------------------------------
    // Test AC2: Email Normalization (Casing and Whitespace)
    // -------------------------------------------------------------
    console.log('\n[Testing AC2: Email Normalization]');
    await authService.logout(adminLogin.token);
    const normLogin = await authService.login('   Admin@Admin.COM   ', 'Admin@123');
    assert(normLogin.success === true, 'Normalized email with mixed case & spaces logs in successfully');
    assert(normLogin.normalizedEmail === 'admin@admin.com', 'Email normalized to lowercase and trimmed');

    // -------------------------------------------------------------
    // Test AC3: Secure Password Verification (Wrong Password)
    // -------------------------------------------------------------
    console.log('\n[Testing AC3 & AC5: Password Verification and Generic Failure]');
    const wrongPassLogin = await authService.login('admin@admin.com', 'WrongPassword!123');
    assert(wrongPassLogin.success === false, 'Wrong password returns failure');
    assert(wrongPassLogin.message === 'Invalid email or password.', 'Generic error message returned on wrong password');

    // -------------------------------------------------------------
    // Test AC5: Generic Error for Non-Existent User (No Enumeration)
    // -------------------------------------------------------------
    console.log('\n[Testing AC5: Non-Existent User Generic Error]');
    const nonExistentLogin = await authService.login('does.not.exist@claaps.com', 'RandomPass123!');
    assert(nonExistentLogin.success === false, 'Non-existent user returns failure');
    assert(nonExistentLogin.message === 'Invalid email or password.', 'Generic error message identical to wrong password (no user leakage)');

    // -------------------------------------------------------------
    // Test AC4: User Status Verification (INVITED, SUSPENDED, DISABLED, EXPIRED)
    // -------------------------------------------------------------
    console.log('\n[Testing AC4: User Status Checks]');
    const suspendedLogin = await authService.login('suspended.user@claaps.com', 'Password@123');
    assert(suspendedLogin.success === false, 'SUSPENDED user is rejected');

    const disabledLogin = await authService.login('disabled.user@claaps.com', 'Password@123');
    assert(disabledLogin.success === false, 'DISABLED user is rejected');

    const expiredLogin = await authService.login('expired.user@claaps.com', 'Password@123');
    assert(expiredLogin.success === false, 'EXPIRED user is rejected');

    const invitedLogin = await authService.login('invited.user@claaps.com', 'Password@123');
    assert(invitedLogin.success === false, 'INVITED user (uncompleted setup) is rejected');

    // -------------------------------------------------------------
    // Test AC7: Session Validation & Verification
    // -------------------------------------------------------------
    console.log('\n[Testing AC7: Session Validation]');
    const session = authService.verifySession(normLogin.token);
    assert(session !== null, 'Session token is verified in active session store');
    assert(session.email === 'admin@admin.com', 'Session matches user email');
    assert(session.role === 'SITE_ADMIN', 'Session contains user role');

    // -------------------------------------------------------------
    // Test AC8: Authorization Context Structure (No Sensitive Data)
    // -------------------------------------------------------------
    console.log('\n[Testing AC8: Authorization Context & Sensitive Data Exclusion]');
    const auditManagerLogin = await authService.login('akash.meesarapu@claaps.com', 'Password@123');
    assert(auditManagerLogin.success === true, 'Audit Manager logs in');
    assert(auditManagerLogin.userId === 'usr_0002', 'Contains userId');
    assert(auditManagerLogin.displayName === 'Akash Meesarapu', 'Contains displayName');
    assert(auditManagerLogin.role === 'AUDIT_MANAGER', 'Contains role AUDIT_MANAGER');
    assert(Array.isArray(auditManagerLogin.permissions) && auditManagerLogin.permissions.includes('AUDIT_READ'), 'Contains specific role permissions');
    assert(auditManagerLogin.passwordHash === undefined, 'passwordHash is NOT exposed in response');
    assert(auditManagerLogin.resetCode === undefined, 'resetCode is NOT exposed in response');

    // -------------------------------------------------------------
    // Test Summary
    // -------------------------------------------------------------
    console.log('\n===========================================================');
    console.log(`📊 Test Summary: ${passed} Passed, ${failed} Failed`);
    console.log('===========================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Unexpected test failure:', err);
    process.exit(1);
  }
}

runTests();
