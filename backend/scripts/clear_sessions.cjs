const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5433/veyra_db'
});

async function clearActiveSessions() {
  try {
    const res = await pool.query("UPDATE veyra_session SET status = 'LOGGED_OUT' WHERE status = 'ACTIVE'");
    console.log(`Successfully cleared ${res.rowCount} active session(s).`);
    const countRes = await pool.query("SELECT count(id) FROM veyra_session WHERE status = 'ACTIVE'");
    console.log(`Remaining active sessions: ${countRes.rows[0].count}`);
  } catch (err) {
    console.error('Error clearing sessions:', err);
  } finally {
    await pool.end();
  }
}

clearActiveSessions();
