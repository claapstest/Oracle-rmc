const { Client } = require('pg');

const BACKEND_URL = 'http://localhost:5000/api';

async function run() {
  console.log('====================================================');
  console.log('VERIFYING 5-MINUTE INACTIVITY SESSION SYSTEM');
  console.log('====================================================\n');

  const pgClient = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/veyra_db'
  });
  await pgClient.connect();
  console.log('✓ Connected to PostgreSQL');

  // Clear existing active sessions for admin@admin.com to ensure clean test state
  await pgClient.query(`
    UPDATE veyra_session 
    SET status = 'EXPIRED' 
    WHERE user_id = (SELECT id FROM veyra_user WHERE email = 'admin@admin.com') AND status = 'ACTIVE'
  `);

  // Test 1 & 2: Login and check initial 5-minute inactivity expiry (NOT 24h)
  console.log('\n--- TEST 1: Login & Initial Inactivity Expiry Calculation ---');
  const loginRes = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@admin.com', password: 'Admin@123' })
  });

  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    throw new Error(`Login failed: ${loginRes.status} ${JSON.stringify(loginData)}`);
  }
  const token = loginData.token;
  console.log('✓ Login successful. Session token:', token.substring(0, 10) + '...');

  // Inspect DB session row
  const sessionDbRes = await pgClient.query(
    `SELECT session_id, user_id, status, created_at, last_activity_at, expires_at 
     FROM veyra_session WHERE session_id = $1`,
    [token]
  );
  const sessionRow = sessionDbRes.rows[0];
  console.log('DB Session Row:', {
    status: sessionRow.status,
    created_at: sessionRow.created_at,
    last_activity_at: sessionRow.last_activity_at,
    expires_at: sessionRow.expires_at
  });

  const initialCreated = new Date(sessionRow.created_at).getTime();
  const initialExpiry = new Date(sessionRow.expires_at).getTime();
  const initialDurationMinutes = (initialExpiry - initialCreated) / (60 * 1000);
  console.log(`Initial expiry delta from creation: ${initialDurationMinutes.toFixed(2)} minutes`);
  if (Math.abs(initialDurationMinutes - 5) > 0.5) {
    throw new Error(`Expected ~5 minutes initial expiry, but got ${initialDurationMinutes} minutes!`);
  }
  console.log('✓ Initial expires_at correctly set to last_activity_at + 5 minutes (NOT 24 hours).');

  // Test 2 & 3 & 4 & 5: Activity sliding (mousemove / keyboard / click refreshes)
  console.log('\n--- TEST 2, 3, 4, 5: Continuous User Activity Sliding Expiry Forward ---');
  // Wait 1.5 seconds to simulate passage of time
  await new Promise(r => setTimeout(r, 1500));

  const refreshRes = await fetch(`${BACKEND_URL}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });
  const refreshData = await refreshRes.json();
  console.log('Refresh API Response:', refreshData);
  if (!refreshRes.ok || !refreshData.success) {
    throw new Error(`Refresh failed: ${JSON.stringify(refreshData)}`);
  }

  const updatedDbRes = await pgClient.query(
    `SELECT session_id, status, created_at, last_activity_at, expires_at 
     FROM veyra_session WHERE session_id = $1`,
    [token]
  );
  const updatedRow = updatedDbRes.rows[0];
  const newExpiry = new Date(updatedRow.expires_at).getTime();
  const newLastAct = new Date(updatedRow.last_activity_at).getTime();
  console.log(`Slid DB Expiry: ${updatedRow.expires_at} (last activity: ${updatedRow.last_activity_at})`);
  if (newExpiry <= initialExpiry) {
    throw new Error(`Expected new expiry (${newExpiry}) to slide forward past initial expiry (${initialExpiry})!`);
  }
  console.log('✓ User activity successfully slid expires_at forward in PostgreSQL!');

  // Test protected API access with active session
  const statusRes = await fetch(`${BACKEND_URL}/auth/status`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!statusRes.ok) {
    throw new Error(`Protected API returned ${statusRes.status}`);
  }
  console.log('✓ Protected API accessible while session is active.');

  // Test 6, 8, 9: Inactivity Expiration (5 continuous minutes of no activity)
  console.log('\n--- TEST 6, 8, 9: Session Expiration on 5 Continuous Minutes of Inactivity ---');
  // Manually fast-forward DB last_activity_at and expires_at past 5 minutes ago to simulate inactivity
  await pgClient.query(
    `UPDATE veyra_session 
     SET last_activity_at = NOW() - INTERVAL '5 minutes 10 seconds',
         expires_at = NOW() - INTERVAL '10 seconds'
     WHERE session_id = $1`,
    [token]
  );

  // Attempt protected API request after inactivity timeout
  const expiredStatusRes = await fetch(`${BACKEND_URL}/auth/status`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const expiredBody = await expiredStatusRes.json();
  console.log(`Protected API response after inactivity: HTTP ${expiredStatusRes.status}`, expiredBody);

  if (expiredStatusRes.status !== 401) {
    throw new Error(`Expected HTTP 401 for expired session, got ${expiredStatusRes.status}`);
  }
  if (expiredBody.code !== 'SESSION_EXPIRED') {
    throw new Error(`Expected code "SESSION_EXPIRED", got "${expiredBody.code}"`);
  }
  console.log('✓ HTTP 401 SESSION_EXPIRED correctly returned by backend for inactive session.');

  // Verify backend transitioned DB status to EXPIRED
  const finalDbRes = await pgClient.query(
    `SELECT session_id, status FROM veyra_session WHERE session_id = $1`,
    [token]
  );
  console.log('DB Session status after backend detection:', finalDbRes.rows[0].status);
  if (finalDbRes.rows[0].status !== 'EXPIRED') {
    throw new Error(`Expected DB status to be EXPIRED, got ${finalDbRes.rows[0].status}`);
  }
  console.log('✓ veyra_session status successfully marked EXPIRED in PostgreSQL.');

  // Test 7: Warning Dismissal & Reset via Activity
  console.log('\n--- TEST 7: Warning Window & Activity Reset ---');
  // Log in fresh session
  const login2Res = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@admin.com', password: 'Admin@123' })
  });
  const login2Data = await login2Res.json();
  const token2 = login2Data.token;
  console.log('✓ Fresh session established:', token2.substring(0, 10) + '...');

  // Set last_activity_at to 4m 35s ago (inside 30s warning window)
  await pgClient.query(
    `UPDATE veyra_session 
     SET last_activity_at = NOW() - INTERVAL '4 minutes 35 seconds',
         expires_at = NOW() + INTERVAL '25 seconds'
     WHERE session_id = $1`,
    [token2]
  );

  // Simulate mouse movement detected in frontend calling refresh
  const rescueRes = await fetch(`${BACKEND_URL}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token2}`
    }
  });
  const rescueData = await rescueRes.json();
  if (!rescueRes.ok || !rescueData.success) {
    throw new Error(`Rescue refresh failed: ${JSON.stringify(rescueData)}`);
  }
  console.log('✓ Activity detected during warning window successfully refreshed session!');

  // Check DB expiry now
  const rescueDbRes = await pgClient.query(
    `SELECT status, expires_at FROM veyra_session WHERE session_id = $1`,
    [token2]
  );
  const rescuedExpiry = new Date(rescueDbRes.rows[0].expires_at).getTime();
  const remainingSecs = Math.round((rescuedExpiry - Date.now()) / 1000);
  console.log(`Rescued session remaining time: ${remainingSecs}s (~300s expected)`);
  if (remainingSecs < 280) {
    throw new Error(`Expected remaining time ~300s, got ${remainingSecs}s`);
  }
  console.log('✓ Inactivity timer successfully reset back to 5 full minutes on activity during warning!');

  // Cleanup
  await pgClient.query(`UPDATE veyra_session SET status = 'EXPIRED' WHERE session_id = $1`, [token2]);
  await pgClient.end();
  console.log('\n====================================================');
  console.log('ALL MANDATORY TESTS PASSED SUCCESSFULLY! ✓✓✓');
  console.log('====================================================');
}

run().catch(err => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
