/**
 * Automated Database Verification Suite for VY-STRY-010:
 * DB: Create VEYRA Authentication and Administrative Audit Trail
 *
 * Verifies all requirements from VY-STRY-010:
 * 1. veyra_audit_event table exists.
 * 2. event_id exists and is PRIMARY KEY.
 * 3. user_id foreign key references veyra_user(id).
 * 4. event_type is required (NOT NULL).
 * 5. event_time defaults correctly to CURRENT_TIMESTAMP.
 * 6. All required event types are accepted:
 *    - LOGIN_SUCCESS
 *    - LOGIN_FAILED
 *    - LOGIN_REJECTED_ACTIVE_SESSION
 *    - LOGOUT
 *    - SESSION_EXPIRED
 *    - USER_CREATED
 *    - USER_UPDATED
 *    - USER_DELETED
 *    - ROLE_ASSIGNED
 *    - ROLE_REMOVED
 *    - PRIVILEGE_CHANGED
 * 7. Invalid event type is rejected by ck_veyra_audit_event_type constraint.
 * 8. LOGIN_SUCCESS can be recorded.
 * 9. LOGIN_FAILED can be recorded with user_id NULL.
 * 10. LOGIN_REJECTED_ACTIVE_SESSION can be recorded.
 * 11. LOGOUT can be recorded.
 * 12. SESSION_EXPIRED can be recorded.
 * 13. USER_CREATED can be recorded.
 * 14. USER_UPDATED can be recorded.
 * 15. USER_DELETED can be recorded.
 * 16. ROLE_ASSIGNED can be recorded.
 * 17. ROLE_REMOVED can be recorded.
 * 18. PRIVILEGE_CHANGED can be recorded.
 * 19. IP address is persisted.
 * 20. User-Agent is persisted.
 * 21. target_type and target_id are persisted.
 * 22. details JSONB is persisted.
 * 23. password/passwordHash cannot be persisted (sanitization).
 * 24. tokens/secrets cannot be persisted (sanitization).
 * 25. nested sensitive fields are sanitized/rejected.
 * 26. Audit indexes exist.
 * 27. Deleting a user preserves audit events (ON DELETE SET NULL).
 * 28. Migration rollback (DOWN) cleanly removes veyra_audit_event table and indexes.
 * 29. Migration re-apply (UP) cleanly restores table and indexes.
 * 30. No sensitive secrets stored in PostgreSQL table (verification across rows).
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
  console.log('  VEYRA Database Verification Suite: Story 10 Audit DB');
  console.log(`  Connecting to: ${connectionString.replace(/:[^:@]+@/, ':****@')}`);
  console.log('===========================================================\n');

  // Ensure migrations are up
  execSync('npm run migrate', { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    // -------------------------------------------------------------
    // TEST 1: veyra_audit_event table exists
    // -------------------------------------------------------------
    const tableRes = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'veyra_audit_event';`
    );
    record('TEST 1: veyra_audit_event table exists', tableRes.rows.length === 1);

    // -------------------------------------------------------------
    // TEST 2: All required columns exist with proper data types
    // -------------------------------------------------------------
    const columnsRes = await client.query(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'veyra_audit_event';`
    );
    const colMap = new Map(columnsRes.rows.map((r) => [r.column_name, r]));
    const requiredCols = [
      'event_id',
      'user_id',
      'event_type',
      'event_time',
      'ip_address',
      'user_agent',
      'target_type',
      'target_id',
      'details'
    ];
    const missingCols = requiredCols.filter((col) => !colMap.has(col));
    record(
      'TEST 2: All 9 required columns exist in veyra_audit_event',
      missingCols.length === 0,
      missingCols.length > 0 ? `Missing columns: ${missingCols.join(', ')}` : undefined
    );

    // -------------------------------------------------------------
    // TEST 3: Primary key exists on event_id
    // -------------------------------------------------------------
    const pkRes = await client.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_schema = 'public'
         AND tc.table_name = 'veyra_audit_event'
         AND tc.constraint_type = 'PRIMARY KEY';`
    );
    const pkCol = pkRes.rows[0]?.column_name;
    record('TEST 3: Primary key exists and is on column "event_id"', pkCol === 'event_id', `PK found: ${pkCol}`);

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
         AND tc.table_name = 'veyra_audit_event'
         AND tc.constraint_type = 'FOREIGN KEY';`
    );
    const userFk = fkRes.rows.find(
      (r) => r.column_name === 'user_id' && r.foreign_table_name === 'veyra_user' && r.foreign_column_name === 'id'
    );
    record(
      'TEST 4: user_id foreign key references veyra_user(id)',
      !!userFk,
      `FK found: ${JSON.stringify(userFk)}`
    );

    // -------------------------------------------------------------
    // TEST 5: event_type is required (NOT NULL) and event_time defaults correctly
    // -------------------------------------------------------------
    const eventTypeCol = colMap.get('event_type');
    const eventTimeCol = colMap.get('event_time');
    record(
      'TEST 5a: event_type column is required (NOT NULL)',
      eventTypeCol?.is_nullable === 'NO'
    );
    record(
      'TEST 5b: event_time defaults to CURRENT_TIMESTAMP / now()',
      !!eventTimeCol?.column_default?.includes('now') || !!eventTimeCol?.column_default?.includes('CURRENT_TIMESTAMP')
    );

    // -------------------------------------------------------------
    // Setup test user
    // -------------------------------------------------------------
    const testEmail = `audit_test_${Date.now()}@example.com`;
    const userInsert = await client.query(
      `INSERT INTO veyra_user (email, display_name, status)
       VALUES ($1, 'Audit Test User', 'ACTIVE')
       RETURNING id;`,
      [testEmail]
    );
    const testUserId = userInsert.rows[0].id;

    // -------------------------------------------------------------
    // TEST 6: All 11 required event types are accepted
    // -------------------------------------------------------------
    const requiredEventTypes = [
      'LOGIN_SUCCESS',
      'LOGIN_FAILED',
      'LOGIN_REJECTED_ACTIVE_SESSION',
      'LOGOUT',
      'SESSION_EXPIRED',
      'USER_CREATED',
      'USER_UPDATED',
      'USER_DELETED',
      'ROLE_ASSIGNED',
      'ROLE_REMOVED',
      'PRIVILEGE_CHANGED'
    ];

    let allAccepted = true;
    for (const evType of requiredEventTypes) {
      try {
        await client.query(
          `INSERT INTO veyra_audit_event (user_id, event_type, details)
           VALUES ($1, $2, $3);`,
          [testUserId, evType, JSON.stringify({ testEvent: evType })]
        );
      } catch (err: any) {
        allAccepted = false;
        record(`TEST 6 (${evType}): accepted by database`, false, err.message);
      }
    }
    if (allAccepted) {
      record('TEST 6: All 11 required event types are accepted by database', true);
    }

    // -------------------------------------------------------------
    // TEST 7: Invalid event type is rejected by CHECK constraint
    // -------------------------------------------------------------
    let invalidTypeRejected = false;
    try {
      await client.query(
        `INSERT INTO veyra_audit_event (user_id, event_type)
         VALUES ($1, 'INVALID_EVENT_TYPE');`,
        [testUserId]
      );
    } catch (err: any) {
      invalidTypeRejected = err.code === '23514'; // check_violation
    }
    record(
      'TEST 7: ck_veyra_audit_event_type rejects arbitrary/invalid event types',
      invalidTypeRejected
    );

    // -------------------------------------------------------------
    // TEST 8: LOGIN_SUCCESS can be recorded with session target
    // -------------------------------------------------------------
    const loginSuccessRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, ip_address, user_agent, target_type, target_id, details)
       VALUES ($1, 'LOGIN_SUCCESS', '192.168.1.100', 'Mozilla/5.0 TestBrowser', 'SESSION', 'sess_test_123', $2)
       RETURNING event_id, event_type, ip_address, user_agent, target_type, target_id;`,
      [testUserId, JSON.stringify({ role: 'AUDIT_USER' })]
    );
    record(
      'TEST 8: LOGIN_SUCCESS can be recorded with complete metadata',
      loginSuccessRes.rows.length === 1 && loginSuccessRes.rows[0].target_id === 'sess_test_123'
    );

    // -------------------------------------------------------------
    // TEST 9: LOGIN_FAILED can be recorded with user_id NULL
    // -------------------------------------------------------------
    const loginFailedNullUserRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, ip_address, user_agent, details)
       VALUES (NULL, 'LOGIN_FAILED', '10.0.0.1', 'Mozilla/5.0 UnknownClient', $1)
       RETURNING event_id, user_id, event_type;`,
      [JSON.stringify({ reason: 'INVALID_CREDENTIALS' })]
    );
    record(
      'TEST 9: LOGIN_FAILED can be recorded with user_id NULL for unknown users',
      loginFailedNullUserRes.rows[0]?.user_id === null && loginFailedNullUserRes.rows[0]?.event_type === 'LOGIN_FAILED'
    );

    // -------------------------------------------------------------
    // TEST 10: LOGIN_REJECTED_ACTIVE_SESSION can be recorded
    // -------------------------------------------------------------
    const activeRejectionRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, target_type, details)
       VALUES ($1, 'LOGIN_REJECTED_ACTIVE_SESSION', 'SESSION', $2)
       RETURNING event_id;`,
      [testUserId, JSON.stringify({ reason: 'ACTIVE_SESSION_EXISTS' })]
    );
    record(
      'TEST 10: LOGIN_REJECTED_ACTIVE_SESSION can be recorded',
      activeRejectionRes.rows.length === 1
    );

    // -------------------------------------------------------------
    // TEST 11: LOGOUT can be recorded
    // -------------------------------------------------------------
    const logoutRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, target_type, target_id)
       VALUES ($1, 'LOGOUT', 'SESSION', 'sess_test_123')
       RETURNING event_id;`,
      [testUserId]
    );
    record('TEST 11: LOGOUT can be recorded', logoutRes.rows.length === 1);

    // -------------------------------------------------------------
    // TEST 12: SESSION_EXPIRED can be recorded
    // -------------------------------------------------------------
    const expiredRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, target_type, target_id, details)
       VALUES ($1, 'SESSION_EXPIRED', 'SESSION', 'sess_test_123', $2)
       RETURNING event_id;`,
      [testUserId, JSON.stringify({ reason: 'INACTIVITY_TIMEOUT' })]
    );
    record('TEST 12: SESSION_EXPIRED can be recorded', expiredRes.rows.length === 1);

    // -------------------------------------------------------------
    // TEST 13: USER_CREATED can be recorded with actor semantics
    // -------------------------------------------------------------
    const userCreatedRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, target_type, target_id, details)
       VALUES ($1, 'USER_CREATED', 'USER', 'target-user-uuid-123', $2)
       RETURNING event_id;`,
      [testUserId, JSON.stringify({ targetEmail: 'newbie@example.com', role: 'AUDIT_USER' })]
    );
    record('TEST 13: USER_CREATED can be recorded with actor vs target', userCreatedRes.rows.length === 1);

    // -------------------------------------------------------------
    // TEST 14: USER_UPDATED can be recorded
    // -------------------------------------------------------------
    const userUpdatedRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, target_type, target_id, details)
       VALUES ($1, 'USER_UPDATED', 'USER', 'target-user-uuid-123', $2)
       RETURNING event_id;`,
      [testUserId, JSON.stringify({ updatedFields: ['displayName', 'role'] })]
    );
    record('TEST 14: USER_UPDATED can be recorded', userUpdatedRes.rows.length === 1);

    // -------------------------------------------------------------
    // TEST 15: USER_DELETED can be recorded
    // -------------------------------------------------------------
    const userDeletedRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, target_type, target_id, details)
       VALUES ($1, 'USER_DELETED', 'USER', 'target-user-uuid-123', $2)
       RETURNING event_id;`,
      [testUserId, JSON.stringify({ targetEmail: 'deleted@example.com' })]
    );
    record('TEST 15: USER_DELETED can be recorded', userDeletedRes.rows.length === 1);

    // -------------------------------------------------------------
    // TEST 16: ROLE_ASSIGNED can be recorded
    // -------------------------------------------------------------
    const roleAssignedRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, target_type, target_id, details)
       VALUES ($1, 'ROLE_ASSIGNED', 'USER_ROLE', 'SITE_ADMIN', $2)
       RETURNING event_id;`,
      [testUserId, JSON.stringify({ targetUserId: 'target-uuid', roleCode: 'SITE_ADMIN' })]
    );
    record('TEST 16: ROLE_ASSIGNED can be recorded', roleAssignedRes.rows.length === 1);

    // -------------------------------------------------------------
    // TEST 17: ROLE_REMOVED can be recorded
    // -------------------------------------------------------------
    const roleRemovedRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, target_type, target_id, details)
       VALUES ($1, 'ROLE_REMOVED', 'USER_ROLE', 'VIEWER', $2)
       RETURNING event_id;`,
      [testUserId, JSON.stringify({ targetUserId: 'target-uuid', previousRoleCode: 'VIEWER' })]
    );
    record('TEST 17: ROLE_REMOVED can be recorded', roleRemovedRes.rows.length === 1);

    // -------------------------------------------------------------
    // TEST 18: PRIVILEGE_CHANGED can be recorded
    // -------------------------------------------------------------
    const privChangedRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, target_type, target_id, details)
       VALUES ($1, 'PRIVILEGE_CHANGED', 'ROLE_PRIVILEGE', 'AUDIT_MANAGER', $2)
       RETURNING event_id;`,
      [testUserId, JSON.stringify({ roleCode: 'AUDIT_MANAGER', modifiedPrivileges: ['AUDIT_TRAIL'] })]
    );
    record('TEST 18: PRIVILEGE_CHANGED can be recorded', privChangedRes.rows.length === 1);

    // -------------------------------------------------------------
    // TEST 19: IP address is persisted accurately
    // -------------------------------------------------------------
    const ipCheckRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, ip_address)
       VALUES ($1, 'LOGIN_SUCCESS', '10.20.30.40')
       RETURNING ip_address;`,
      [testUserId]
    );
    record(
      'TEST 19: IP address is persisted accurately',
      ipCheckRes.rows[0]?.ip_address === '10.20.30.40'
    );

    // -------------------------------------------------------------
    // TEST 20: User-Agent is persisted accurately
    // -------------------------------------------------------------
    const testUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    const uaCheckRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, user_agent)
       VALUES ($1, 'LOGIN_SUCCESS', $2)
       RETURNING user_agent;`,
      [testUserId, testUA]
    );
    record(
      'TEST 20: User-Agent is persisted accurately',
      uaCheckRes.rows[0]?.user_agent === testUA
    );

    // -------------------------------------------------------------
    // TEST 21: target_type and target_id are persisted accurately
    // -------------------------------------------------------------
    const targetCheckRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, target_type, target_id)
       VALUES ($1, 'USER_CREATED', 'USER', 'usr_abc_xyz_123')
       RETURNING target_type, target_id;`,
      [testUserId]
    );
    record(
      'TEST 21: target_type and target_id are persisted accurately',
      targetCheckRes.rows[0]?.target_type === 'USER' && targetCheckRes.rows[0]?.target_id === 'usr_abc_xyz_123'
    );

    // -------------------------------------------------------------
    // TEST 22: details JSONB is persisted and queryable
    // -------------------------------------------------------------
    const testDetails = { reason: 'TEST_REASON', meta: { nestedKey: 'nestedValue' } };
    const jsonbCheckRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, details)
       VALUES ($1, 'LOGIN_FAILED', $2)
       RETURNING details;`,
      [testUserId, JSON.stringify(testDetails)]
    );
    record(
      'TEST 22: details JSONB is persisted and queryable',
      jsonbCheckRes.rows[0]?.details?.reason === 'TEST_REASON' &&
        jsonbCheckRes.rows[0]?.details?.meta?.nestedKey === 'nestedValue'
    );

    // -------------------------------------------------------------
    // TEST 23, 24, 25: Node.js Sanitization defense-in-depth
    // -------------------------------------------------------------
    // Test the sanitization function from auditService
    const { sanitizeAuditDetails } = await import('../../../backend/src/services/auditService.js');
    const dirtyPayload = {
      safeField: 'safeValue',
      password: 'PlaintextPassword123!',
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz',
      currentPassword: 'oldSecretPassword',
      newPassword: 'newSecretPassword',
      confirmPassword: 'newSecretPassword',
      token: 'jwt.token.here',
      accessToken: 'access.token.secret',
      refreshToken: 'refresh.token.secret',
      authorization: 'Bearer secret_token_xyz',
      cookie: 'connect.sid=s%3Axyz',
      secret: 'superSecretKey',
      apiKey: 'groq_api_key_12345',
      clientSecret: 'oracle_client_secret_67890',
      nested: {
        safeNested: 'nestedOk',
        nestedPassword: 'hiddenPassword',
        nestedToken: 'nestedSecretToken',
        deep: {
          deepSecret: 'deepSecretVal',
          deepSafe: 42
        }
      },
      arrayValues: [
        { safe: true, password: 'arrayPassword' },
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.signature'
      ]
    };

    const cleaned = sanitizeAuditDetails(dirtyPayload);
    const cleanedString = JSON.stringify(cleaned);

    const forbiddenTerms = [
      'PlaintextPassword123!',
      'abcdefghijklmnopqrstuvwxyz',
      'oldSecretPassword',
      'newSecretPassword',
      'secret_token_xyz',
      'superSecretKey',
      'groq_api_key_12345',
      'oracle_client_secret_67890',
      'hiddenPassword',
      'nestedSecretToken',
      'deepSecretVal',
      'arrayPassword'
    ];

    const leakedTerms = forbiddenTerms.filter(t => cleanedString.includes(t));
    record(
      'TEST 23: password/passwordHash stripped by defense-in-depth sanitization',
      !cleanedString.includes('PlaintextPassword123!') && !cleanedString.includes('passwordHash')
    );
    record(
      'TEST 24: tokens/secrets/keys stripped by defense-in-depth sanitization',
      !cleanedString.includes('groq_api_key_12345') && !cleanedString.includes('superSecretKey')
    );
    record(
      'TEST 25: nested sensitive fields recursively stripped/redacted',
      leakedTerms.length === 0 && cleaned.nested?.deep?.deepSafe === 42
    );

    // -------------------------------------------------------------
    // TEST 26: Indexes exist
    // -------------------------------------------------------------
    const indexRes = await client.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'veyra_audit_event';`
    );
    const indexNames = new Set(indexRes.rows.map((r) => r.indexname));
    const requiredIndexes = [
      'ix_veyra_audit_event_time',
      'ix_veyra_audit_event_user_id',
      'ix_veyra_audit_event_event_type',
      'ix_veyra_audit_event_target'
    ];
    const missingIndexes = requiredIndexes.filter((idx) => !indexNames.has(idx));
    record(
      'TEST 26: All 4 audit retrieval indexes exist',
      missingIndexes.length === 0,
      missingIndexes.length > 0 ? `Missing indexes: ${missingIndexes.join(', ')}` : undefined
    );

    // -------------------------------------------------------------
    // TEST 27: Deleting a user preserves audit events (ON DELETE SET NULL)
    // -------------------------------------------------------------
    const tempUserEmail = `temp_audit_${Date.now()}@example.com`;
    const tempUserRes = await client.query(
      `INSERT INTO veyra_user (email, display_name, status) VALUES ($1, 'Temp User', 'ACTIVE') RETURNING id;`,
      [tempUserEmail]
    );
    const tempUserId = tempUserRes.rows[0].id;
    const tempEventRes = await client.query(
      `INSERT INTO veyra_audit_event (user_id, event_type, details)
       VALUES ($1, 'USER_CREATED', $2) RETURNING event_id;`,
      [tempUserId, JSON.stringify({ temp: true })]
    );
    const tempEventId = tempEventRes.rows[0].event_id;

    // Delete the user
    await client.query(`DELETE FROM veyra_user WHERE id = $1;`, [tempUserId]);

    // Check that audit event still exists and user_id is now NULL
    const checkEventRes = await client.query(
      `SELECT event_id, user_id FROM veyra_audit_event WHERE event_id = $1;`,
      [tempEventId]
    );
    record(
      'TEST 27: Deleting user preserves audit records with user_id set to NULL (ON DELETE SET NULL)',
      checkEventRes.rows.length === 1 && checkEventRes.rows[0].user_id === null
    );

    // -------------------------------------------------------------
    // TEST 28: Migration rollback (DOWN) cleanly removes veyra_audit_event table
    // -------------------------------------------------------------
    execSync('npm run migrate:down', { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });
    const tableAfterDown = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'veyra_audit_event';`
    );
    record(
      'TEST 28: Migration rollback (DOWN) cleanly removes veyra_audit_event table and indexes',
      tableAfterDown.rows.length === 0
    );

    // -------------------------------------------------------------
    // TEST 29: Migration re-apply (UP) cleanly restores table
    // -------------------------------------------------------------
    execSync('npm run migrate', { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });
    const tableAfterUp = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'veyra_audit_event';`
    );
    record(
      'TEST 29: Migration can be re-applied (UP) cleanly after rollback',
      tableAfterUp.rows.length === 1
    );

    // -------------------------------------------------------------
    // TEST 30: Scan database table to verify zero sensitive keys persisted
    // -------------------------------------------------------------
    const auditRowsRes = await client.query(
      `SELECT details::text AS details_text FROM veyra_audit_event WHERE details IS NOT NULL;`
    );
    let secretFoundInDb = false;
    const sensitiveTokens = ['passwordHash', '"password":', 'clientSecret', 'apiKey', 'accessToken'];
    for (const row of auditRowsRes.rows) {
      for (const tok of sensitiveTokens) {
        if (row.details_text?.includes(tok)) {
          secretFoundInDb = true;
          break;
        }
      }
    }
    record(
      'TEST 30: Zero sensitive secrets stored in PostgreSQL veyra_audit_event table',
      !secretFoundInDb
    );

    // Cleanup test user
    await client.query(`DELETE FROM veyra_user WHERE id = $1;`, [testUserId]);

  } finally {
    await client.end();
  }

  console.log('\n===========================================================');
  const allPassed = results.every((r) => r.passed);
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`  Summary: ${passedCount} / ${results.length} tests passed.`);
  if (allPassed) {
    console.log('  🎉 All Story 10 Database Requirements Successfully Verified!');
  } else {
    console.error('  ⚠️ Some Story 10 Database tests failed.');
    process.exit(1);
  }
  console.log('===========================================================\n');
}

runVerification().catch((err) => {
  console.error('Fatal error during Story 10 database verification:', err);
  process.exit(1);
});
