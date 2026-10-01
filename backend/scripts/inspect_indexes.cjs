const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/veyra_db' });

async function run() {
  const res = await pool.query(`
    SELECT tablename, indexname, indexdef 
    FROM pg_indexes 
    WHERE tablename IN ('veyra_dashboard_metric', 'veyra_audit_event', 'veyra_user', 'veyra_role', 'veyra_user_role')
    ORDER BY tablename, indexname
  `);
  for (const r of res.rows) {
    console.log(r.tablename, ':', r.indexname, '-->', r.indexdef);
  }
  await pool.end();
}

run();
