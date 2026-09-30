import { query } from '../src/db.js';

async function main() {
  console.log('--- TOP 10 AUDIT RECORDS ---');
  const res = await query(`
    SELECT event_id, user_id, event_type, event_time, ip_address, user_agent, target_type, target_id, details
    FROM veyra_audit_event
    ORDER BY event_time DESC
    LIMIT 10
  `);
  console.table(res.rows.map(r => ({
    event_id: r.event_id.substring(0, 8) + '...',
    user_id: r.user_id ? r.user_id.substring(0, 8) + '...' : 'NULL',
    event_type: r.event_type,
    ip_address: r.ip_address,
    target_type: r.target_type,
    target_id: r.target_id ? r.target_id.substring(0, 15) + '...' : null,
    details: JSON.stringify(r.details)
  })));

  console.log('\n--- SCANNING ALL ROWS FOR SENSITIVE KEYS ---');
  const allRows = await query(`
    SELECT details::text AS details_text
    FROM veyra_audit_event
    WHERE details IS NOT NULL
  `);

  const forbiddenKeys = [
    'passwordHash',
    '"password":',
    'currentPassword',
    'newPassword',
    'confirmPassword',
    'clientSecret',
    'sessionSecret',
    'groqApiKey',
    'apiKey',
    'accessToken',
    'refreshToken',
    'Authorization',
    'cookie'
  ];

  let leaks = 0;
  for (const row of allRows.rows) {
    for (const key of forbiddenKeys) {
      if (row.details_text?.toLowerCase().includes(key.toLowerCase())) {
        console.error(`❌ LEAK DETECTED: Key "${key}" in details: ${row.details_text}`);
        leaks++;
      }
    }
  }

  if (leaks === 0) {
    console.log(`✅ SECURITY SCAN PASSED: Zero sensitive keys found across ${allRows.rows.length} audit records.`);
  } else {
    console.error(`❌ SECURITY SCAN FAILED: ${leaks} leak(s) detected.`);
  }

  process.exit(leaks > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Inspection failed:', err);
  process.exit(1);
});
