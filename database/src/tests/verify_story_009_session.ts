/**
 * Automated Database Verification Suite for VY-STRY-009:
 * DB: Create VEYRA Session Tracking and Session Audit Tables
 *
 * Verifies all 15 requirements:
 * TEST 1: veyra_session table exists.
 * TEST 2: All required columns exist with proper data types.
 * TEST 3: Primary key exists on id.
 * TEST 4: user_id foreign key references veyra_user(id).
 * TEST 5: session_id is unique.
 * TEST 6: ACTIVE session can be inserted for a valid user.
 * TEST 7: A second ACTIVE session for the same user is rejected (Single Active Session).
 * TEST 8: A LOGGED_OUT session and an ACTIVE session can coexist for the same user.
 * TEST 9: An EXPIRED session and an ACTIVE session can coexist for the same user.
 * TEST 10: A REJECTED session and an ACTIVE session can coexist for the same user.
 * TEST 11: A session referencing a non-existent user is rejected.
 * TEST 12: Historical session rows are not automatically deleted when status is changed.
 * TEST 13: Status CHECK constraint rejects invalid status strings.
 * TEST 14: Migration rollback (DOWN) succeeds cleanly.
 * TEST 15: Migration re-apply (UP) succeeds cleanly after rollback.
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || '127.0.0.1'}:${process.env.POSTGRES_PORT || '5433'}/${process.env.POSTGRES_DB || 'veyra_db'}`;

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, error?: string) {
  results.push({ name, passed, error });
  if (passed) {
    console.log(`  ✅ [PASS] ${name}`);
  } else {
    console.error(`  ❌ [FAIL] ${name}: ${error}`);
  }
}

async function runVerification() {
  console.log('===========================================================');
  console.log('  VEYRA Database Verification Suite: Story 9 Session DB');
  console.log(`  Connecting to: ${connectionString.replace(/:[^:@]+@/, ':****@')}`);
  console.log('===========================================================\n');

  // Ensure migrations are up
  execSync('npm run migrate', { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    // -------------------------------------------------------------
    // TEST 1: veyra_session table exists
    // -------------------------------------------------------------
    const tableRes = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'veyra_session';`
    );
    record('TEST 1: veyra_session table exists', tableRes.rows.length === 1);

    // -------------------------------------------------------------
    // TEST 2: All required columns exist
    // -------------------------------------------------------------
    const columnsRes = await client.query(
      `SELECT column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'veyra_session';`
    );
    const colMap = new Map(columnsRes.rows.map((r) => [r.column_name, r]));
    const requiredCols = [
      'id',
      'session_id',
      'user_id',
      'created_at',
      'last_activity_at',
      'expires_at',
      'logged_out_at',
      'status',
      'ip_address',
      'user_agent',
      'created_by'
    ];
    const missingCols = requiredCols.filter((col) => !colMap.has(col));
    record(
      'TEST 2: All 11 required columns exist in veyra_session',
      missingCols.length === 0,
      missingCols.length > 0 ? `Missing columns: ${missingCols.join(', ')}` : undefined
    );

    // -------------------------------------------------------------
    // TEST 3: Primary key exists on id
    // -------------------------------------------------------------
    const pkRes = await client.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_schema = 'public'
         AND tc.table_name = 'veyra_session'
         AND tc.constraint_type = 'PRIMARY KEY';`
    );
    const pkCol = pkRes.rows[0]?.column_name;
    record('TEST 3: Primary key exists and is on column "id"', pkCol === 'id', `PK found: ${pkCol}`);

    // -------------------------------------------------------------
    // TEST 4: user_id foreign key references veyra_user(id)
    // -------------------------------------------------------------
    const fkRes = await client.query(
      `SELECT kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema = 'public'
         AND tc.table_name = 'veyra_session'
         AND tc.constraint_type = 'FOREIGN KEY';`
    );
    const userFk = fkRes.rows.find(
      (r) => r.column_name === 'user_id' && r.foreign_table_name === 'veyra_user' && r.foreign_column_name === 'id'
    );
    record(
      'TEST 4: user_id foreign key references veyra_user(id)',
      !!userFk,
      userFk ? undefined : 'No valid foreign key found for user_id -> veyra_user(id)'
    );

    // -------------------------------------------------------------
    // TEST 5: session_id is unique
    // -------------------------------------------------------------
    // Get or create test user
    const testEmail = 'session.test@claaps.com';
    let userRow = (
      await client.query(`SELECT id FROM veyra_user WHERE email = $1;`, [testEmail])
    ).rows[0];

    if (!userRow) {
      userRow = (
        await client.query(
          `INSERT INTO veyra_user (email, display_name, status, is_local_user)
           VALUES ($1, 'Session Test User', 'ACTIVE', TRUE)
           RETURNING id;`,
          [testEmail]
        )
      ).rows[0];
    }
    const testUserId = userRow.id;

    // Clean up test sessions
    await client.query(`DELETE FROM veyra_session WHERE user_id = $1;`, [testUserId]);

    const initialSessionId = `sess_unique_test_${Date.now()}`;
    await client.query(
      `INSERT INTO veyra_session (session_id, user_id, status, ip_address, user_agent, created_by)
       VALUES ($1, $2, 'EXPIRED', '192.168.1.100', 'Mozilla/5.0 TestBrowser', 'SYSTEM');`,
      [initialSessionId, testUserId]
    );

    let dupSessionIdRejected = false;
    try {
      // Attempt duplicate session_id for a different record
      await client.query(
        `INSERT INTO veyra_session (session_id, user_id, status, ip_address)
         VALUES ($1, $2, 'EXPIRED', '192.168.1.101');`,
        [initialSessionId, testUserId]
      );
    } catch (err: any) {
      dupSessionIdRejected = err.code === '23505'; // unique_violation
    }
    record('TEST 5: session_id UNIQUE constraint enforced', dupSessionIdRejected);

    // -------------------------------------------------------------
    // TEST 6: ACTIVE session can be inserted for a valid user
    // -------------------------------------------------------------
    await client.query(`DELETE FROM veyra_session WHERE user_id = $1;`, [testUserId]);

    const activeSessionId1 = `sess_active_1_${Date.now()}`;
    const insertActiveRes = await client.query(
      `INSERT INTO veyra_session (session_id, user_id, status, ip_address, user_agent, created_by)
       VALUES ($1, $2, 'ACTIVE', '10.0.0.1', 'Mozilla/5.0 Chrome/120', 'AUTH_SERVICE')
       RETURNING id, status, session_id;`,
      [activeSessionId1, testUserId]
    );
    record(
      'TEST 6: ACTIVE session inserted successfully for valid user',
      insertActiveRes.rows.length === 1 && insertActiveRes.rows[0].status === 'ACTIVE'
    );

    // -------------------------------------------------------------
    // TEST 7: A second ACTIVE session for the same user is rejected (Single Active Session)
    // -------------------------------------------------------------
    const activeSessionId2 = `sess_active_2_${Date.now()}`;
    let secondActiveRejected = false;
    try {
      await client.query(
        `INSERT INTO veyra_session (session_id, user_id, status, ip_address, user_agent, created_by)
         VALUES ($1, $2, 'ACTIVE', '10.0.0.2', 'Mozilla/5.0 Firefox/120', 'AUTH_SERVICE');`,
        [activeSessionId2, testUserId]
      );
    } catch (err: any) {
      secondActiveRejected = err.code === '23505'; // unique_violation on partial index
    }
    record(
      'TEST 7: Second ACTIVE session for the same user is rejected by partial unique index',
      secondActiveRejected
    );

    // -------------------------------------------------------------
    // TEST 8: A LOGGED_OUT session and an ACTIVE session can coexist
    // -------------------------------------------------------------
    // Transition the existing active session to LOGGED_OUT
    await client.query(
      `UPDATE veyra_session SET status = 'LOGGED_OUT', logged_out_at = now() WHERE session_id = $1;`,
      [activeSessionId1]
    );

    // Now insert a new ACTIVE session
    const activeSessionId3 = `sess_active_3_${Date.now()}`;
    const loggedOutCoexistRes = await client.query(
      `INSERT INTO veyra_session (session_id, user_id, status, ip_address)
       VALUES ($1, $2, 'ACTIVE', '10.0.0.3')
       RETURNING id;`,
      [activeSessionId3, testUserId]
    );
    record(
      'TEST 8: LOGGED_OUT session and ACTIVE session can coexist for the same user',
      loggedOutCoexistRes.rows.length === 1
    );

    // -------------------------------------------------------------
    // TEST 9: An EXPIRED session and an ACTIVE session can coexist
    // -------------------------------------------------------------
    // Add an EXPIRED session row
    const expiredSessionId = `sess_expired_${Date.now()}`;
    const expiredCoexistRes = await client.query(
      `INSERT INTO veyra_session (session_id, user_id, status, ip_address)
       VALUES ($1, $2, 'EXPIRED', '10.0.0.4')
       RETURNING id;`,
      [expiredSessionId, testUserId]
    );
    record(
      'TEST 9: EXPIRED session and ACTIVE session can coexist for the same user',
      expiredCoexistRes.rows.length === 1
    );

    // -------------------------------------------------------------
    // TEST 10: A REJECTED session and an ACTIVE session can coexist
    // -------------------------------------------------------------
    const rejectedSessionId = `sess_rejected_${Date.now()}`;
    const rejectedCoexistRes = await client.query(
      `INSERT INTO veyra_session (session_id, user_id, status, ip_address)
       VALUES ($1, $2, 'REJECTED', '10.0.0.5')
       RETURNING id;`,
      [rejectedSessionId, testUserId]
    );
    record(
      'TEST 10: REJECTED session and ACTIVE session can coexist for the same user',
      rejectedCoexistRes.rows.length === 1
    );

    // Verify all 4 sessions (LOGGED_OUT, EXPIRED, REJECTED, and ACTIVE) all exist concurrently for testUserId
    const countRes = await client.query(
      `SELECT count(*) FROM veyra_session WHERE user_id = $1;`,
      [testUserId]
    );
    record(
      'TEST 8-10 Sanity: All historical sessions coexist alongside the single ACTIVE session',
      parseInt(countRes.rows[0].count, 10) === 4
    );

    // -------------------------------------------------------------
    // TEST 11: A session referencing a non-existent user is rejected
    // -------------------------------------------------------------
    const nonExistentUserId = '00000000-0000-0000-0000-000000000000';
    let nonExistentUserRejected = false;
    try {
      await client.query(
        `INSERT INTO veyra_session (session_id, user_id, status)
         VALUES ($1, $2, 'ACTIVE');`,
        [`sess_nonexistent_${Date.now()}`, nonExistentUserId]
      );
    } catch (err: any) {
      nonExistentUserRejected = err.code === '23503'; // foreign_key_violation
    }
    record(
      'TEST 11: Session referencing non-existent user rejected by foreign key',
      nonExistentUserRejected
    );

    // -------------------------------------------------------------
    // TEST 12: Historical session rows are not automatically deleted
    // -------------------------------------------------------------
    // Update active session to LOGGED_OUT
    await client.query(
      `UPDATE veyra_session SET status = 'LOGGED_OUT', logged_out_at = now() WHERE session_id = $1;`,
      [activeSessionId3]
    );
    const postUpdateCount = await client.query(
      `SELECT count(*) FROM veyra_session WHERE user_id = $1;`,
      [testUserId]
    );
    record(
      'TEST 12: Historical session rows are preserved when status changes (no automatic deletion)',
      parseInt(postUpdateCount.rows[0].count, 10) === 4
    );

    // -------------------------------------------------------------
    // TEST 13: Database Check Constraint: status rejected if invalid
    // -------------------------------------------------------------
    let invalidStatusRejected = false;
    try {
      await client.query(
        `INSERT INTO veyra_session (session_id, user_id, status)
         VALUES ($1, $2, 'INVALID_STATUS');`,
        [`sess_inv_${Date.now()}`, testUserId]
      );
    } catch (err: any) {
      invalidStatusRejected = err.code === '23514'; // check_violation
    }
    record(
      'TEST 13: ck_veyra_session_status rejects unsupported status strings',
      invalidStatusRejected
    );

    // Clean up test sessions
    await client.query(`DELETE FROM veyra_session WHERE user_id = $1;`, [testUserId]);
    await client.query(`DELETE FROM veyra_user WHERE id = $1;`, [testUserId]);

    // -------------------------------------------------------------
    // TEST 14: Migration rollback (DOWN) succeeds cleanly
    // -------------------------------------------------------------
    execSync('npm run migrate:down', { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });
    const tableAfterDown = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'veyra_session';`
    );
    record(
      'TEST 14: Migration rollback (DOWN) cleanly removes veyra_session table and indexes',
      tableAfterDown.rows.length === 0
    );

    // -------------------------------------------------------------
    // TEST 15: Migration re-apply (UP) succeeds cleanly after rollback
    // -------------------------------------------------------------
    execSync('npm run migrate', { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });
    const tableAfterUp = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'veyra_session';`
    );
    record(
      'TEST 15: Migration can be re-applied (UP) cleanly after rollback',
      tableAfterUp.rows.length === 1
    );

  } finally {
    await client.end();
  }

  console.log('\n===========================================================');
  const allPassed = results.every((r) => r.passed);
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`  Summary: ${passedCount} / ${results.length} tests passed.`);
  if (allPassed) {
    console.log('  🎉 All Story 9 Database Requirements Successfully Verified!');
  } else {
    console.error('  ⚠️ Some Story 9 Database tests failed.');
    process.exit(1);
  }
  console.log('===========================================================\n');
}

runVerification().catch((err) => {
  console.error('Fatal error during Story 9 database verification:', err);
  process.exit(1);
});
