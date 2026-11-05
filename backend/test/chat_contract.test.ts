/**
 * Ask VEYRA Automated API Contract Regression Test Suite
 * Story Reference: VEYRA-101.5
 * 
 * Verifies the POST /api/chat contract against the specifications established in:
 * - VEYRA-101.2 (Endpoint Contract Specification)
 * - VEYRA-101.3 (Authentication & Authorization Verification)
 * - VEYRA-101.4 (Chatbot Success & Failure Response Fixtures)
 * 
 * Invariants Enforced:
 * 1. Authentication & Authorization pipeline precedes route-level message validation.
 * 2. Rejected requests (401, 403, 400) NEVER invoke orchestrator processing or tools.
 * 3. Successful responses strictly satisfy AIResponse and ToolExecutionResult interfaces.
 * 4. Error response bodies strictly conform to their designated shapes.
 * 5. Isolated and deterministic: zero live Oracle, zero paid LLM calls, zero DB dependency.
 */

import http from 'http';
import express, { Request, Response } from 'express';
import { authService } from '../src/services/authService.js';
import { requireAuth, requireAskVeyra } from '../src/routes/api.js';
import {
  validateAIResponse,
  validateErrorResponse,
  loadFixture
} from './contractValidator.js';

interface TestCaseResult {
  id: string;
  name: string;
  expectedStatus: number;
  actualStatus: number;
  expectedCondition: string;
  passed: boolean;
  error?: string;
}

const testResults: TestCaseResult[] = [];

// Track orchestrator calls to prove authorization / validation precedence
let orchestratorCallCount = 0;
let lastOrchestratorPayload: { message: string; context?: any } | null = null;
let orchestratorMockMode: 'DEFAULT' | 'STRUCTURED' | 'NULL_TOOL' | 'TOOL_FAIL' | 'ORACLE_UNAVAIL' | 'LLM_FALLBACK' | 'THROW_ERROR' = 'DEFAULT';

// Controlled test session tokens
const TOKENS = {
  ADMIN: 'test_token_site_admin_valid',
  ASK_VEYRA_USER: 'test_token_ask_veyra_valid',
  SUPERVISOR: 'test_token_audit_supervisor',
  SUPERVISOR_WITH_ALL: 'test_token_supervisor_with_all',
  NO_ASK_VEYRA: 'test_token_no_privileges',
  EXPIRED: 'test_token_expired_session',
  UNKNOWN: 'invalid_token_9999',
  EMPTY: ''
};

// Setup stub for authService.validateSession
function installAuthServiceStub() {
  const originalValidate = authService.validateSession.bind(authService);

  (authService as any).validateSession = async (token: string, touch = true) => {
    if (!token || token.trim() === '') {
      return {
        valid: false,
        code: 'INVALID_TOKEN',
        message: 'Authentication required. Missing or malformed token.'
      };
    }

    if (token === TOKENS.ADMIN) {
      return {
        valid: true,
        session: {
          userId: 'usr_admin_01',
          email: 'admin@claaps.com',
          displayName: 'Site Administrator',
          role: 'SITE_ADMIN',
          permissions: ['ALL'],
          isAdmin: true
        }
      };
    }

    if (token === TOKENS.ASK_VEYRA_USER) {
      return {
        valid: true,
        session: {
          userId: 'usr_audit_02',
          email: 'auditor@claaps.com',
          displayName: 'Security Auditor',
          role: 'AUDIT_USER',
          permissions: ['ASK_VEYRA'],
          isAdmin: false
        }
      };
    }

    if (token === TOKENS.SUPERVISOR) {
      return {
        valid: true,
        session: {
          userId: 'usr_sup_03',
          email: 'supervisor@claaps.com',
          displayName: 'Audit Supervisor',
          role: 'AUDIT_SUPERVISOR',
          permissions: [],
          isAdmin: false
        }
      };
    }

    if (token === TOKENS.SUPERVISOR_WITH_ALL) {
      return {
        valid: true,
        session: {
          userId: 'usr_sup_04',
          email: 'supervisor.all@claaps.com',
          displayName: 'Supervisor With All',
          role: 'AUDIT_SUPERVISOR',
          permissions: ['ALL', 'ASK_VEYRA'],
          isAdmin: true
        }
      };
    }

    if (token === TOKENS.NO_ASK_VEYRA) {
      return {
        valid: true,
        session: {
          userId: 'usr_basic_05',
          email: 'basic.user@claaps.com',
          displayName: 'Basic User',
          role: 'AUDIT_USER',
          permissions: ['ROLES_CATALOG'],
          isAdmin: false
        }
      };
    }

    if (token === TOKENS.EXPIRED) {
      return {
        valid: false,
        code: 'SESSION_EXPIRED',
        message: 'Your session has expired. Please log in again.',
        session: { email: 'expired.user@claaps.com' }
      };
    }

    // Default unknown token
    return {
      valid: false,
      code: 'SESSION_NOT_FOUND',
      message: 'Session expired or invalid. Please sign in again.'
    };
  };

  return () => {
    (authService as any).validateSession = originalValidate;
  };
}

// Orchestrator mock handler simulating the exact logic from backend/src/routes/api.ts
async function mockProcessUserMessage(message: string, context?: any) {
  orchestratorCallCount++;
  lastOrchestratorPayload = { message, context };

  if (orchestratorMockMode === 'THROW_ERROR') {
    throw new Error('Unexpected null reference in intent classifier pipeline');
  }

  if (orchestratorMockMode === 'STRUCTURED') {
    return loadFixture('scenario_2_structured_data_response.json');
  }

  if (orchestratorMockMode === 'NULL_TOOL') {
    return loadFixture('scenario_3_null_tool_result.json');
  }

  if (orchestratorMockMode === 'TOOL_FAIL') {
    return loadFixture('scenario_4_tool_execution_failure.json');
  }

  if (orchestratorMockMode === 'ORACLE_UNAVAIL') {
    return loadFixture('scenario_5_oracle_integration_unavailable.json');
  }

  if (orchestratorMockMode === 'LLM_FALLBACK') {
    return loadFixture('scenario_6_llm_provider_failure_fallback.json');
  }

  // DEFAULT is text-only
  return loadFixture('scenario_1_text_only_response.json');
}

// Helper to make HTTP requests against local ephemeral server
function makeRequest(
  port: number,
  options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: any;
  }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const postData = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (postData !== undefined) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData).toString();
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method,
        headers: reqHeaders
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let parsed: any = null;
          try {
            parsed = rawData ? JSON.parse(rawData) : null;
          } catch {
            parsed = rawData;
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: parsed
          });
        });
      }
    );

    req.on('error', reject);
    if (postData !== undefined) {
      req.write(postData);
    }
    req.end();
  });
}

function recordTest(
  id: string,
  name: string,
  expectedStatus: number,
  actualStatus: number,
  expectedCondition: string,
  passed: boolean,
  error?: string
) {
  testResults.push({ id, name, expectedStatus, actualStatus, expectedCondition, passed, error });
  const icon = passed ? '✅ [PASS]' : '❌ [FAIL]';
  console.log(`  ${icon} [${id}] ${name} (HTTP ${actualStatus})`);
  if (!passed && error) {
    console.error(`      Error: ${error}`);
  }
}

// Main Test Execution Runner
async function runTestSuite() {
  console.log('╔═════════════════════════════════════════════════════════════════════════════╗');
  console.log('║        Ask VEYRA Automated API Contract Regression Test Suite (101.5)       ║');
  console.log('║                 Target Endpoint: POST /api/chat                             ║');
  console.log('╚═════════════════════════════════════════════════════════════════════════════╝\n');

  const restoreAuth = installAuthServiceStub();

  // Initialize Express App with real route handler pipeline
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Mount identical route pipeline as backend/src/routes/api.ts
  app.post('/api/chat', requireAskVeyra, async (req: Request, res: Response) => {
    try {
      const { message, context } = req.body;
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }
      const aiResponse = await mockProcessUserMessage(message, context);
      res.json(aiResponse);
    } catch (err: any) {
      res.status(500).json({ error: 'AI Orchestration failed', details: err.message || 'Unknown error' });
    }
  });

  // Start test server on ephemeral port (OS picks free port)
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const address = server.address() as any;
  const port = address.port;
  console.log(`🚀 Ephemeral Test Harness listening on http://127.0.0.1:${port}\n`);

  try {
    // -------------------------------------------------------------------------
    // GROUP 1: Stored Fixture Validation (Ensures Hemanth's 101.4 fixtures match contract)
    // -------------------------------------------------------------------------
    console.log('─── [GROUP 1] Verified Stored Fixture Validation (101.4 Manifest) ────────');
    
    const sc1 = loadFixture('scenario_1_text_only_response.json');
    const v1 = validateAIResponse(sc1);
    recordTest('FIX-01', 'Scenario 1 fixture matches AIResponse text-only contract', 200, 200, 'Valid schema', v1.valid, v1.errors.join('; '));

    const sc2 = loadFixture('scenario_2_structured_data_response.json');
    const v2 = validateAIResponse(sc2);
    recordTest('FIX-02', 'Scenario 2 fixture matches AIResponse structured contract', 200, 200, 'Valid schema', v2.valid, v2.errors.join('; '));

    const sc3 = loadFixture('scenario_3_null_tool_result.json');
    const v3 = validateAIResponse(sc3);
    recordTest('FIX-03', 'Scenario 3 fixture matches AIResponse null-toolResult contract', 200, 200, 'Valid schema', v3.valid && sc3.toolResult === null, v3.errors.join('; '));

    const sc4 = loadFixture('scenario_4_tool_execution_failure.json');
    const v4 = validateAIResponse(sc4);
    recordTest('FIX-04', 'Scenario 4 fixture matches AIResponse tool-failure contract', 200, 200, 'Valid schema', v4.valid && sc4.toolResult.success === false, v4.errors.join('; '));

    const sc5 = loadFixture('scenario_5_oracle_integration_unavailable.json');
    const v5 = validateAIResponse(sc5);
    recordTest('FIX-05', 'Scenario 5 fixture matches AIResponse integrationRequired contract', 200, 200, 'Valid schema', v5.valid && sc5.toolResult.integrationRequired === true, v5.errors.join('; '));

    const sc6a = loadFixture('scenario_6_llm_provider_failure_fallback.json');
    const v6a = validateAIResponse(sc6a);
    recordTest('FIX-06', 'Scenario 6A fixture matches AIResponse LLM-fallback contract', 200, 200, 'Valid schema', v6a.valid, v6a.errors.join('; '));

    // -------------------------------------------------------------------------
    // GROUP 2: Authentication Pipeline Tests (401 Statuses & 4 Distinct Shapes)
    // -------------------------------------------------------------------------
    console.log('\n─── [GROUP 2] Authentication Pipeline Tests (401 Shapes & Precedence) ───');
    
    // AV-005: Missing Authorization header
    const initialOrchCount = orchestratorCallCount;
    const resAV005 = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      body: { message: 'What is a duty role?' }
    });
    const vAV005 = validateErrorResponse(resAV005.status, resAV005.body, 'MISSING_HEADER');
    recordTest('AV-005', 'Missing Authorization header returns 401 (no code property)', 401, resAV005.status, 'Shape matches AV-005', resAV005.status === 401 && vAV005.valid, vAV005.errors.join('; '));

    // AV-005b: Malformed Authorization header (Basic auth)
    const resAV005b = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      body: { message: 'What is a duty role?' }
    });
    const vAV005b = validateErrorResponse(resAV005b.status, resAV005b.body, 'MALFORMED_HEADER');
    recordTest('AV-005b', 'Malformed Authorization header (Basic) returns 401 (no code property)', 401, resAV005b.status, 'Shape matches AV-005b', resAV005b.status === 401 && vAV005b.valid, vAV005b.errors.join('; '));

    // AV-006: Unknown / Invalid session token
    const resAV006 = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.UNKNOWN}` },
      body: { message: 'What is a duty role?' }
    });
    const vAV006 = validateErrorResponse(resAV006.status, resAV006.body, 'UNKNOWN_TOKEN');
    recordTest('AV-006', 'Unknown token returns 401 with code SESSION_NOT_FOUND', 401, resAV006.status, 'code === SESSION_NOT_FOUND', resAV006.status === 401 && vAV006.valid, vAV006.errors.join('; '));

    // AV-006b: Empty token ('Bearer ')
    // Note: On the HTTP wire, HTTP parsers strip trailing whitespace from headers, so 'Bearer ' arrives as 'Bearer'
    // and is caught by the header guard. We assert HTTP 401 with authentication required message.
    const resAV006b = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: 'Bearer ' },
      body: { message: 'What is a duty role?' }
    });
    const vAV006b = validateErrorResponse(resAV006b.status, resAV006b.body, 'EMPTY_TOKEN');
    recordTest('AV-006b', 'Empty Bearer token returns HTTP 401 Authentication Required', 401, resAV006b.status, '401 with Authentication Required message', resAV006b.status === 401 && vAV006b.valid, vAV006b.errors.join('; '));

    // AV-006c: Direct INVALID_TOKEN code emission verification
    // Proves requireAuth emits code: INVALID_TOKEN when authService returns code: INVALID_TOKEN
    const mockReq: any = {
      header: (name: string) => (name.toLowerCase() === 'authorization' ? 'Bearer placeholder_for_invalid' : undefined)
    };
    let capturedStatus = 0;
    let capturedBody: any = null;
    const mockRes: any = {
      status: (s: number) => {
        capturedStatus = s;
        return {
          json: (b: any) => {
            capturedBody = b;
          }
        };
      },
      locals: {}
    };
    // Temporarily have validateSession return INVALID_TOKEN
    const prevValidate = (authService as any).validateSession;
    (authService as any).validateSession = async () => ({
      valid: false,
      code: 'INVALID_TOKEN',
      message: 'Authentication required. Missing or malformed token.'
    });
    await requireAuth(mockReq, mockRes, () => {});
    (authService as any).validateSession = prevValidate;
    const passedAV006c = capturedStatus === 401 && capturedBody?.code === 'INVALID_TOKEN' && capturedBody?.success === false;
    recordTest('AV-006c', 'requireAuth middleware emits code: INVALID_TOKEN when session validation returns INVALID_TOKEN', 401, capturedStatus, 'code === INVALID_TOKEN', passedAV006c, passedAV006c ? undefined : `Captured: ${JSON.stringify(capturedBody)}`);

    // AV-007: Genuinely expired session
    const resAV007 = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.EXPIRED}` },
      body: { message: 'What is a duty role?' }
    });
    const vAV007 = validateErrorResponse(resAV007.status, resAV007.body, 'EXPIRED_SESSION');
    recordTest('AV-007', 'Expired session returns 401 with code SESSION_EXPIRED (success key absent)', 401, resAV007.status, 'code === SESSION_EXPIRED && success === undefined', resAV007.status === 401 && vAV007.valid, vAV007.errors.join('; '));

    // AV-011: Precedence test: Invalid token AND missing message body ({})
    const resAV011 = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.UNKNOWN}` },
      body: {}
    });
    const passedAV011 = resAV011.status === 401; // Must be 401, NOT 400
    recordTest('AV-011', 'Authentication precedes body validation: invalid token + missing message returns 401 (never 400)', 401, resAV011.status, 'Status is 401, not 400', passedAV011, passedAV011 ? undefined : `Got HTTP ${resAV011.status} instead of 401`);

    // Verify Invariant: Zero calls to orchestrator across all 401 rejections
    const authOrchCalls = orchestratorCallCount - initialOrchCount;
    recordTest('INV-01', 'Invariant: Denied 401 authentication requests NEVER invoke orchestrator', 0, authOrchCalls, 'orchestratorCallCount === 0', authOrchCalls === 0, `Orchestrator was called ${authOrchCalls} times`);

    // -------------------------------------------------------------------------
    // GROUP 3: Authorization Pipeline Tests (403 Statuses & Role Hierarchy)
    // -------------------------------------------------------------------------
    console.log('\n─── [GROUP 3] Authorization Pipeline Tests (403 Forbidden & Roles) ──────');
    
    const preAuthzOrchCount = orchestratorCallCount;

    // AV-008: AUDIT_SUPERVISOR role unconditional deny
    const resAV008 = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.SUPERVISOR}` },
      body: { message: 'Show me user count' }
    });
    const vAV008 = validateErrorResponse(resAV008.status, resAV008.body, 'AUDIT_SUPERVISOR');
    recordTest('AV-008', 'AUDIT_SUPERVISOR receives 403 Forbidden with supervisor denial message', 403, resAV008.status, 'code === FORBIDDEN', resAV008.status === 403 && vAV008.valid, vAV008.errors.join('; '));

    // AV-008b: AUDIT_SUPERVISOR with ALL and ASK_VEYRA permissions (Supervisor block precedes permissions)
    const resAV008b = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.SUPERVISOR_WITH_ALL}` },
      body: { message: 'Show me user count' }
    });
    const vAV008b = validateErrorResponse(resAV008b.status, resAV008b.body, 'AUDIT_SUPERVISOR');
    recordTest('AV-008b', 'AUDIT_SUPERVISOR check outranks ALL/ASK_VEYRA permissions (still 403)', 403, resAV008b.status, 'Status is 403 even with ALL permissions', resAV008b.status === 403 && vAV008b.valid, vAV008b.errors.join('; '));

    // AV-009: User lacking ASK_VEYRA permission (AUDIT_USER without ASK_VEYRA)
    const resAV009 = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.NO_ASK_VEYRA}` },
      body: { message: 'Show me user count' }
    });
    const vAV009 = validateErrorResponse(resAV009.status, resAV009.body, 'MISSING_ASK_VEYRA');
    recordTest('AV-009', 'User lacking ASK_VEYRA permission receives 403 with privilege message', 403, resAV009.status, 'code === FORBIDDEN', resAV009.status === 403 && vAV009.valid, vAV009.errors.join('; '));

    // Verify Invariant: Zero calls to orchestrator across all 403 rejections
    const authzOrchCalls = orchestratorCallCount - preAuthzOrchCount;
    recordTest('INV-02', 'Invariant: Denied 403 authorization requests NEVER invoke orchestrator', 0, authzOrchCalls, 'orchestratorCallCount === 0', authzOrchCalls === 0, `Orchestrator was called ${authzOrchCalls} times`);

    // -------------------------------------------------------------------------
    // GROUP 4: Route-Level Request Validation Tests (400 Bad Request)
    // -------------------------------------------------------------------------
    console.log('\n─── [GROUP 4] Request Body Validation Tests (400 Bad Request) ──────────');
    
    const preValOrchCount = orchestratorCallCount;

    // AV-003: Missing message field
    const resAV003 = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.ADMIN}` },
      body: {}
    });
    const vAV003 = validateErrorResponse(resAV003.status, resAV003.body);
    recordTest('AV-003', 'Missing message field ({}) returns HTTP 400 { error: "Message is required" }', 400, resAV003.status, 'error === "Message is required"', resAV003.status === 400 && vAV003.valid, vAV003.errors.join('; '));

    // AV-004a: Null message
    const resAV004a = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.ADMIN}` },
      body: { message: null }
    });
    const vAV004a = validateErrorResponse(resAV004a.status, resAV004a.body);
    recordTest('AV-004a', 'Null message ({ message: null }) returns HTTP 400', 400, resAV004a.status, 'error === "Message is required"', resAV004a.status === 400 && vAV004a.valid, vAV004a.errors.join('; '));

    // AV-004b: Empty string message
    const resAV004b = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.ADMIN}` },
      body: { message: '' }
    });
    const vAV004b = validateErrorResponse(resAV004b.status, resAV004b.body);
    recordTest('AV-004b', 'Empty string message ({ message: "" }) returns HTTP 400', 400, resAV004b.status, 'error === "Message is required"', resAV004b.status === 400 && vAV004b.valid, vAV004b.errors.join('; '));

    // Verify Invariant: Zero calls to orchestrator across all 400 rejections
    const valOrchCalls = orchestratorCallCount - preValOrchCount;
    recordTest('INV-03', 'Invariant: Rejected 400 requests NEVER reach orchestrator processing', 0, valOrchCalls, 'orchestratorCallCount === 0', valOrchCalls === 0, `Orchestrator was called ${valOrchCalls} times`);

    // -------------------------------------------------------------------------
    // GROUP 5: Successful Response & Contract Regression Tests (200 OK)
    // -------------------------------------------------------------------------
    console.log('\n─── [GROUP 5] Successful Response Contract Tests (200 OK Scenarios) ─────');
    
    // AV-001 / AV-010: Authorized user (SITE_ADMIN) without context -> Text-only 200
    orchestratorMockMode = 'DEFAULT';
    const resAV001 = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.ADMIN}` },
      body: { message: 'What is a duty role in Oracle Fusion?' }
    });
    const vAV001 = validateAIResponse(resAV001.body);
    recordTest('AV-001', 'Authorized request without context yields 200 text-only AIResponse', 200, resAV001.status, 'Valid AIResponse schema', resAV001.status === 200 && vAV001.valid && resAV001.body.structuredData === undefined, vAV001.errors.join('; '));

    // AV-002 / AV-017: Authorized user (ASK_VEYRA) with context -> Structured Data 200
    orchestratorMockMode = 'STRUCTURED';
    const resAV002 = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.ASK_VEYRA_USER}` },
      body: {
        message: 'List the users who are having multiple roles',
        context: { entityType: 'USER', currentView: 'USERS_CATALOG' }
      }
    });
    const vAV002 = validateAIResponse(resAV002.body);
    const hasStructured = !!resAV002.body.structuredData && Array.isArray(resAV002.body.structuredData.keyFindings);
    recordTest('AV-002', 'Authorized request with context yields 200 structuredData AIResponse', 200, resAV002.status, 'structuredData is populated', resAV002.status === 200 && vAV002.valid && hasStructured, vAV002.errors.join('; '));

    // Verify context passthrough
    const contextPassed = lastOrchestratorPayload?.context?.entityType === 'USER';
    recordTest('AV-002b', 'Context parameter reaches orchestrator pipeline intact', 200, 200, 'context.entityType === USER', contextPassed);

    // AV-012: Valid null toolResult response
    orchestratorMockMode = 'NULL_TOOL';
    const resAV012 = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.ADMIN}` },
      body: { message: 'Hello, how can you help me today?' }
    });
    const vAV012 = validateAIResponse(resAV012.body);
    recordTest('AV-012', 'Conversational query yields 200 with strictly null toolResult', 200, resAV012.status, 'toolResult === null', resAV012.status === 200 && vAV012.valid && resAV012.body.toolResult === null, vAV012.errors.join('; '));

    // AV-013: Tool execution failure
    orchestratorMockMode = 'TOOL_FAIL';
    const resAV013 = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.ADMIN}` },
      body: { message: 'What privileges does user UNKNOWN_USER_404 have?' }
    });
    const vAV013 = validateAIResponse(resAV013.body);
    const toolFailed = resAV013.body.toolResult?.success === false && typeof resAV013.body.toolResult?.error === 'string';
    recordTest('AV-013', 'Backend tool failure returns 200 with toolResult.success: false', 200, resAV013.status, 'toolResult.success === false', resAV013.status === 200 && vAV013.valid && toolFailed, vAV013.errors.join('; '));

    // AV-014: Oracle integration unavailable
    orchestratorMockMode = 'ORACLE_UNAVAIL';
    const resAV014 = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.ADMIN}` },
      body: { message: 'Show me Segregation of Duties conflicts from Oracle Risk Management Cloud' }
    });
    const vAV014 = validateAIResponse(resAV014.body);
    const integrationReq = resAV014.body.toolResult?.integrationRequired === true;
    recordTest('AV-014', 'Oracle integration unavailable returns 200 with integrationRequired: true', 200, resAV014.status, 'toolResult.integrationRequired === true', resAV014.status === 200 && vAV014.valid && integrationReq, vAV014.errors.join('; '));

    // AV-015a: LLM provider failure fallback (Variant A)
    orchestratorMockMode = 'LLM_FALLBACK';
    const resAV015a = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.ADMIN}` },
      body: { message: 'Give me count of duty roles' }
    });
    const vAV015a = validateAIResponse(resAV015a.body);
    recordTest('AV-015a', 'LLM failure fallback returns 200 authoritative deterministic response', 200, resAV015a.status, 'Valid fallback AIResponse', resAV015a.status === 200 && vAV015a.valid, vAV015a.errors.join('; '));

    // Extra unrecognized fields accepted without 400
    orchestratorMockMode = 'DEFAULT';
    const resExtra = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.ADMIN}` },
      body: { message: 'What is a duty role?', extraParam: 'ignored_by_backend', debugMode: true }
    });
    recordTest('EXT-01', 'Extra unrecognized request fields are accepted gracefully without 400', 200, resExtra.status, 'HTTP 200 OK', resExtra.status === 200);

    // -------------------------------------------------------------------------
    // GROUP 6: Error Handling & Internal Server Error Tests (500 Scenarios)
    // -------------------------------------------------------------------------
    console.log('\n─── [GROUP 6] Unhandled Error & Timeout Tests (500 Internal Error) ─────');
    
    // AV-016: Unexpected orchestration exception
    orchestratorMockMode = 'THROW_ERROR';
    const resAV016 = await makeRequest(port, {
      method: 'POST',
      path: '/api/chat',
      headers: { Authorization: `Bearer ${TOKENS.ADMIN}` },
      body: { message: 'Trigger unhandled orchestration failure' }
    });
    const vAV016 = validateErrorResponse(resAV016.status, resAV016.body);
    recordTest('AV-016', 'Unhandled orchestration exception returns HTTP 500 error payload', 500, resAV016.status, 'error === "AI Orchestration failed"', resAV016.status === 500 && vAV016.valid, vAV016.errors.join('; '));

  } finally {
    restoreAuth();
    server.close();
  }

  // ---------------------------------------------------------------------------
  // Summary & Test Report Matrix
  // ---------------------------------------------------------------------------
  const total = testResults.length;
  const passed = testResults.filter((r) => r.passed).length;
  const failed = total - passed;
  const passRate = ((passed / total) * 100).toFixed(1);

  console.log('\n═════════════════════════════════════════════════════════════════════════════');
  console.log('🏁 VEYRA-101.5 Automated Contract Regression Test Report');
  console.log('═════════════════════════════════════════════════════════════════════════════');
  console.log(`Total Test Scenarios: ${total}`);
  console.log(`Passed:               ${passed}`);
  console.log(`Failed:               ${failed}`);
  console.log(`Pass Rate:            ${passRate}%`);
  console.log('═════════════════════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    console.error(`❌ REGRESSION DETECTED: ${failed} contract scenario(s) failed.`);
    process.exit(1);
  } else {
    console.log('🎉 ALL CONTRACT REGRESSION SCENARIOS PASSED SUCCESSFULLY!');
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal execution error running contract test suite:', err);
  process.exit(1);
});
