const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/veyra_db' });

async function run() {
  await pool.query('SET enable_seqscan = OFF');

  console.log('--- EXPLAIN: veyra_dashboard_metric by (application_scope, metric_key, captured_at DESC) ---');
  const plan1 = await pool.query(`
    EXPLAIN ANALYZE
    SELECT metric_id, metric_key, metric_value, application_scope, captured_at
    FROM veyra_dashboard_metric
    WHERE application_scope = 'ORACLE_FUSION' AND metric_key = 'ACTIVE_RISKS'
    ORDER BY captured_at DESC
    LIMIT 5;
  `);
  console.log(plan1.rows.map(r => r['QUERY PLAN']).join('\n'));

  console.log('\n--- EXPLAIN: veyra_audit_event by (user_id, event_time DESC) ---');
  const plan2 = await pool.query(`
    EXPLAIN ANALYZE
    SELECT event_id, event_type, event_time
    FROM veyra_audit_event
    WHERE user_id = '00000000-0000-0000-0000-000000000000'::uuid
    ORDER BY event_time DESC
    LIMIT 10;
  `);
  console.log(plan2.rows.map(r => r['QUERY PLAN']).join('\n'));

  console.log('\n--- EXPLAIN: veyra_audit_event by (event_type, event_time DESC) ---');
  const plan3 = await pool.query(`
    EXPLAIN ANALYZE
    SELECT event_id, event_type, event_time
    FROM veyra_audit_event
    WHERE event_type = 'DASHBOARD_ACCESS'
    ORDER BY event_time DESC
    LIMIT 10;
  `);
  console.log(plan3.rows.map(r => r['QUERY PLAN']).join('\n'));

  await pool.end();
}

run();
