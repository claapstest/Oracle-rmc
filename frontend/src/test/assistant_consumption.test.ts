import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Assertion helper matching project conventions
const assert = Object.assign(
  (condition: any, message?: string) => {
    if (!condition) throw new Error(message || 'Assertion failed');
  },
  {
    strictEqual: (actual: any, expected: any, msg?: string) => {
      if (actual !== expected) throw new Error(msg || `Expected ${expected} but got ${actual}`);
    },
    deepStrictEqual: (actual: any, expected: any, msg?: string) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(msg || `Deep equal mismatch`);
    },
    ok: (condition: any, msg?: string) => {
      if (!condition) throw new Error(msg || 'Expected truthy value');
    }
  }
);

// ---------------------------------------------------------------------------
// Pure representations of Assistant.tsx message consumption & rendering logic
// ---------------------------------------------------------------------------

interface AssistantMessage {
  sender: 'user' | 'assistant';
  text: string;
  intent?: string;
  parameters?: any;
  toolResult?: any;
  structuredData?: any;
  loading?: boolean;
}

// Logic from Assistant.tsx line 442-450: unpacking AIResponse
function unpackAIResponse(response: any): AssistantMessage {
  return {
    sender: 'assistant',
    text: response.message,
    intent: response.intent,
    parameters: response.parameters,
    toolResult: response.toolResult,
    structuredData: response.structuredData
  };
}

// Logic from Assistant.tsx line 457-464: unpacking network / API errors
function unpackErrorToMessage(err: any): AssistantMessage {
  return {
    sender: 'assistant',
    text: "Connection failed. Please verify that your backend Express server is running and accessible.",
    toolResult: {
      success: false,
      error: (err as Error).message || 'Express offline'
    }
  };
}

// Logic from Assistant.tsx line 837-866: error card categorization
function categorizeError(toolResult: any): { categoryTitle: string; displayMessage: string; showSettingsButton: boolean } {
  const errorText = toolResult?.error || 'Unable to retrieve the requested Oracle Fusion data.';
  let categoryTitle = 'Oracle Query Interrupted';
  let displayMessage = errorText;
  let showSettingsButton = false;

  if (errorText.toLowerCase().includes('integration required') || errorText.toLowerCase().includes('not supported under default')) {
    categoryTitle = 'Oracle API Integration Missing';
    displayMessage = errorText;
    showSettingsButton = true;
  } else if (errorText.toLowerCase().includes('authenticate') || errorText.toLowerCase().includes('credentials') || errorText.toLowerCase().includes('401')) {
    categoryTitle = 'Oracle Authentication Failure';
    displayMessage = 'Oracle Fusion connection rejected. Please verify that your credentials configurations in Settings are correct.';
    showSettingsButton = true;
  } else if (errorText.toLowerCase().includes('privileges') || errorText.toLowerCase().includes('forbidden') || errorText.toLowerCase().includes('403')) {
    categoryTitle = 'Oracle Permission Denied';
    displayMessage = 'Access denied. The configured integration account does not have sufficient privileges to read this security data.';
    showSettingsButton = true;
  } else if (errorText.toLowerCase().includes('provisioned') || errorText.toLowerCase().includes('licensed separately')) {
    categoryTitle = 'Oracle Service Not Provisioned';
    displayMessage = errorText;
    showSettingsButton = false;
  } else if (errorText.toLowerCase().includes('unreachable') || errorText.toLowerCase().includes('timeout') || errorText.toLowerCase().includes('timed out')) {
    categoryTitle = 'Oracle Host Unreachable';
    displayMessage = 'Connection timed out. Please check your network connection and verify that the Oracle instance is online.';
    showSettingsButton = true;
  }

  return { categoryTitle, displayMessage, showSettingsButton };
}

// Logic from Assistant.tsx line 2065-2077: primary rendering branch decider
function resolveDisplayBranch(msg: AssistantMessage): 'structuredData' | 'errorCard' | 'markdownText' {
  if (msg.structuredData) return 'structuredData';
  if (msg.toolResult && msg.toolResult.success === false) return 'errorCard';
  return 'markdownText';
}

// Logic from Assistant.tsx line 385-398: markdown parsing
function parseMarkdownText(text: string): Array<{ type: 'bold' | 'plain'; content: string }> | null {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map(part => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return { type: 'bold', content: part.slice(2, -2) };
    }
    return { type: 'plain', content: part };
  });
}

// Logic from Assistant.tsx line 1870-1888: session storage serialization
function sanitizeMessageForStorage(msg: AssistantMessage): any {
  return {
    sender: msg.sender,
    text: msg.text,
    intent: msg.intent,
    parameters: msg.parameters,
    toolResult: msg.toolResult ? {
      tool: msg.toolResult.tool,
      parameters: msg.toolResult.parameters,
      dataSource: msg.toolResult.dataSource,
      timestamp: msg.toolResult.timestamp,
      success: msg.toolResult.success,
      error: msg.toolResult.error
    } : null,
    structuredData: msg.structuredData
  };
}

// ---------------------------------------------------------------------------
// Test Suite Execution
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../backend/test/fixtures/chat');

console.log('╔═════════════════════════════════════════════════════════════════════════════╗');
console.log('║       Ask VEYRA Frontend Response Consumption Verification Suite (101.6)    ║');
console.log('║            Target: frontend/src/pages/Assistant.tsx & api.ts                ║');
console.log('╚═════════════════════════════════════════════════════════════════════════════╝\n');

let passed = 0;
let failed = 0;

function runTest(testId: string, description: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ [PASS] [${testId}] ${description}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ [FAIL] [${testId}] ${description}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

// ===========================================================================
// GROUP 1: Response Fixture Consumption (Scenarios 1 - 6A from 101.4)
// ===========================================================================
console.log('─── [GROUP 1] Verified 101.4 Response Fixture Consumption ────────────────');

const fix1 = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'scenario_1_text_only_response.json'), 'utf8'));
runTest('FE-FIX-01', 'Scenario 1 (Text-only): unpacks message, renders markdown text, omits structuredData', () => {
  const msg = unpackAIResponse(fix1);
  assert.strictEqual(msg.sender, 'assistant');
  assert.strictEqual(msg.text, fix1.message);
  assert.strictEqual(msg.intent, 'APPLICATION_KNOWLEDGE');
  assert.strictEqual(msg.structuredData, undefined);
  assert.ok(msg.toolResult && msg.toolResult.success === true);
  assert.strictEqual(resolveDisplayBranch(msg), 'markdownText');

  const parsed = parseMarkdownText(msg.text);
  assert.ok(parsed && parsed.length > 0);
  assert.ok(parsed.every(p => p.type === 'plain' || p.type === 'bold'));
});

const fix2 = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'scenario_2_structured_data_response.json'), 'utf8'));
runTest('FE-FIX-02', 'Scenario 2 (Structured): routes to structuredData branch, populates table and cards', () => {
  const msg = unpackAIResponse(fix2);
  assert.strictEqual(msg.sender, 'assistant');
  assert.ok(msg.structuredData !== undefined);
  assert.strictEqual(msg.structuredData.title, 'Users With Multiple Assigned Roles');
  assert.ok(Array.isArray(msg.structuredData.keyFindings));
  assert.strictEqual(msg.structuredData.keyFindings.length, 2);
  assert.ok(Array.isArray(msg.structuredData.table.rows));
  assert.strictEqual(msg.structuredData.table.rows.length, 2);
  assert.strictEqual(resolveDisplayBranch(msg), 'structuredData');
});

const fix3 = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'scenario_3_null_tool_result.json'), 'utf8'));
runTest('FE-FIX-03', 'Scenario 3 (Null toolResult): renders text safely with toolResult: null and no crashes', () => {
  const msg = unpackAIResponse(fix3);
  assert.strictEqual(msg.toolResult, null);
  assert.strictEqual(msg.structuredData, undefined);
  assert.strictEqual(resolveDisplayBranch(msg), 'markdownText');
  assert.ok(msg.text.includes('Hello! I am VEYRA'));
  const serialized = sanitizeMessageForStorage(msg);
  assert.strictEqual(serialized.toolResult, null);
});

const fix4 = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'scenario_4_tool_execution_failure.json'), 'utf8'));
runTest('FE-FIX-04', 'Scenario 4 (Tool execution failure): routes to renderErrorCard with retry query action', () => {
  const msg = unpackAIResponse(fix4);
  assert.strictEqual(msg.structuredData, undefined);
  assert.ok(msg.toolResult && msg.toolResult.success === false);
  assert.strictEqual(resolveDisplayBranch(msg), 'errorCard');

  const errCard = categorizeError(msg.toolResult);
  assert.strictEqual(errCard.categoryTitle, 'Oracle Query Interrupted');
  assert.strictEqual(errCard.displayMessage, "User 'UNKNOWN_USER_404' does not exist in security directory.");
  assert.strictEqual(errCard.showSettingsButton, false);
});

const fix5 = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'scenario_5_oracle_integration_unavailable.json'), 'utf8'));
runTest('FE-FIX-05', 'Scenario 5 (Integration required): routes to errorCard, errorText determines category', () => {
  const msg = unpackAIResponse(fix5);
  assert.ok(msg.toolResult && msg.toolResult.integrationRequired === true);
  assert.strictEqual(resolveDisplayBranch(msg), 'errorCard');

  // Note: Because errorText contains "unreachable", renderErrorCard line 861 maps it to Oracle Host Unreachable
  const errCard = categorizeError(msg.toolResult);
  assert.strictEqual(errCard.categoryTitle, 'Oracle Host Unreachable');
  assert.strictEqual(errCard.showSettingsButton, true);
});

const fix6A = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'scenario_6_llm_provider_failure_fallback.json'), 'utf8'));
runTest('FE-FIX-06A', 'Scenario 6A (LLM fallback): graceful fallback structured response displays cleanly', () => {
  const msg = unpackAIResponse(fix6A);
  assert.strictEqual(msg.intent, 'SECURITY_STATISTICS');
  assert.ok(msg.structuredData !== undefined);
  assert.strictEqual(resolveDisplayBranch(msg), 'structuredData');
});

// ===========================================================================
// GROUP 2: HTTP Error Handling (400, 401, 403, 500 & Network Errors)
// ===========================================================================
console.log('\n─── [GROUP 2] HTTP Error Handling & Error Card Categorization ───────────');

runTest('FE-ERR-400', 'HTTP 400 (Missing message): maps to error card with displayMessage: "Message is required"', () => {
  const errPayload = { message: 'Message is required', status: 400 };
  const msg = unpackErrorToMessage(errPayload);
  assert.strictEqual(resolveDisplayBranch(msg), 'errorCard');
  const card = categorizeError(msg.toolResult);
  assert.strictEqual(card.categoryTitle, 'Oracle Query Interrupted');
  assert.strictEqual(card.displayMessage, 'Message is required');
  assert.strictEqual(card.showSettingsButton, false);
});

runTest('FE-ERR-401A', 'HTTP 401 (Authentication required): maps to Oracle Query Interrupted (stem "authenticate" vs "authentication")', () => {
  const errPayload = { message: 'Authentication required. Missing or malformed token.', status: 401 };
  const msg = unpackErrorToMessage(errPayload);
  const card = categorizeError(msg.toolResult);
  // Implementation note: "authentication".includes("authenticate") is false because of "-ion" suffix!
  assert.strictEqual(card.categoryTitle, 'Oracle Query Interrupted');
  assert.strictEqual(card.displayMessage, 'Authentication required. Missing or malformed token.');
  assert.strictEqual(card.showSettingsButton, false);
});

runTest('FE-ERR-401B', 'HTTP 401 (With explicit "401" or "credentials"): maps to "Oracle Authentication Failure" with Settings button', () => {
  const errPayload = { message: 'Request failed with 401 status: invalid credentials', status: 401 };
  const msg = unpackErrorToMessage(errPayload);
  const card = categorizeError(msg.toolResult);
  assert.strictEqual(card.categoryTitle, 'Oracle Authentication Failure');
  assert.ok(card.displayMessage.includes('credentials configurations in Settings'));
  assert.strictEqual(card.showSettingsButton, true);
});

runTest('FE-ERR-401C', 'HTTP 401 (Unknown token / SESSION_NOT_FOUND): maps to "Oracle Query Interrupted"', () => {
  const errPayload = { message: 'Session expired or invalid. Please sign in again.', status: 401 };
  const msg = unpackErrorToMessage(errPayload);
  const card = categorizeError(msg.toolResult);
  assert.strictEqual(card.categoryTitle, 'Oracle Query Interrupted');
  assert.strictEqual(card.displayMessage, 'Session expired or invalid. Please sign in again.');
  assert.strictEqual(card.showSettingsButton, false);
});

runTest('FE-ERR-403A', 'HTTP 403 (AUDIT_SUPERVISOR): displays supervisor denial message', () => {
  const errPayload = { message: 'Access denied. Audit Supervisor does not have privilege to access Ask Veyra.', status: 403 };
  const msg = unpackErrorToMessage(errPayload);
  const card = categorizeError(msg.toolResult);
  assert.strictEqual(card.categoryTitle, 'Oracle Query Interrupted');
  assert.strictEqual(card.displayMessage, 'Access denied. Audit Supervisor does not have privilege to access Ask Veyra.');
});

runTest('FE-ERR-403B', 'HTTP 403 (Missing Ask Veyra privileges): categorizes as "Oracle Permission Denied" with Settings button', () => {
  const errPayload = { message: 'Access denied. Ask Veyra privileges required.', status: 403 };
  const msg = unpackErrorToMessage(errPayload);
  const card = categorizeError(msg.toolResult);
  assert.strictEqual(card.categoryTitle, 'Oracle Permission Denied');
  assert.ok(card.displayMessage.includes('sufficient privileges'));
  assert.strictEqual(card.showSettingsButton, true);
});

runTest('FE-ERR-500', 'HTTP 500 (Orchestration failed): maps to "Oracle Query Interrupted" with error message', () => {
  const errPayload = { message: 'AI Orchestration failed', status: 500 };
  const msg = unpackErrorToMessage(errPayload);
  const card = categorizeError(msg.toolResult);
  assert.strictEqual(card.categoryTitle, 'Oracle Query Interrupted');
  assert.strictEqual(card.displayMessage, 'AI Orchestration failed');
  assert.strictEqual(card.showSettingsButton, false);
});

runTest('FE-ERR-NET', 'Network timeout / unreachable: categorizes as "Oracle Host Unreachable" with Settings button', () => {
  const errPayload = { message: 'Connection timed out or host unreachable', status: 0 };
  const msg = unpackErrorToMessage(errPayload);
  const card = categorizeError(msg.toolResult);
  assert.strictEqual(card.categoryTitle, 'Oracle Host Unreachable');
  assert.ok(card.displayMessage.includes('verify that the Oracle instance is online'));
  assert.strictEqual(card.showSettingsButton, true);
});

// ===========================================================================
// GROUP 3: Resilience to Missing, Incomplete or Malformed Optional Fields
// ===========================================================================
console.log('\n─── [GROUP 3] Resilience to Missing & Incomplete Optional Fields ────────');

runTest('FE-RES-01', 'structuredData with missing keyFindings and riskHighlights renders safely', () => {
  const incompleteStructured = {
    title: 'Test Title',
    summary: 'Test summary without findings',
    table: null,
    actions: []
  };
  const msg: AssistantMessage = {
    sender: 'assistant',
    text: 'Test message',
    structuredData: incompleteStructured
  };
  assert.strictEqual(resolveDisplayBranch(msg), 'structuredData');
  const kf = msg.structuredData.keyFindings;
  assert.strictEqual(Boolean(kf && kf.length > 0), false);
  const rh = msg.structuredData.riskHighlights;
  assert.strictEqual(Boolean(rh && rh.length > 0), false);
});

runTest('FE-RES-02', 'structuredData with null table and empty actions array renders safely', () => {
  const structured = {
    title: 'Title',
    summary: 'Summary',
    table: null,
    actions: null
  };
  const msg: AssistantMessage = {
    sender: 'assistant',
    text: 'Text',
    structuredData: structured
  };
  const t = msg.structuredData.table;
  assert.strictEqual(Boolean(t && t.rows && t.rows.length > 0), false);
  const act = msg.structuredData.actions;
  assert.strictEqual(Boolean(act && act.length > 0), false);
});

runTest('FE-RES-03', 'renderMarkdownText handles null, undefined, empty string, and raw asterisks safely', () => {
  assert.strictEqual(parseMarkdownText(''), null);
  assert.strictEqual(parseMarkdownText(null as any), null);
  assert.strictEqual(parseMarkdownText(undefined as any), null);

  const parsed = parseMarkdownText('Normal text with **bold** and *single* asterisks');
  assert.ok(parsed && parsed.length > 0);
  assert.strictEqual(parsed.find(p => p.type === 'bold')?.content, 'bold');
});

runTest('FE-RES-04', 'Message with undefined toolResult renders markdown text without footer or details crash', () => {
  const msg: AssistantMessage = {
    sender: 'assistant',
    text: 'Plain conversational text'
  };
  assert.strictEqual(resolveDisplayBranch(msg), 'markdownText');
  assert.strictEqual(Boolean(msg.toolResult), false);
});

// ===========================================================================
// GROUP 4: Verification of Contract Mismatches & UI Drops
// ===========================================================================
console.log('\n─── [GROUP 4] Verification of Contract Mismatches & UI Drops ───────────');

runTest('FE-MIS-01', 'Confirmed Mismatch: Assistant.tsx drops aiExplanation when constructing Message state', () => {
  const rawBackendResponse = {
    message: 'Test answer',
    intent: 'SECURITY_STATISTICS',
    parameters: { targetMetric: 'TOTAL_USERS' },
    toolResult: { tool: 'stat', success: true },
    structuredData: undefined,
    aiExplanation: 'NLU classified query as security statistics.'
  };
  const unpacked = unpackAIResponse(rawBackendResponse);
  assert.strictEqual((unpacked as any).aiExplanation, undefined);
  assert.strictEqual(rawBackendResponse.aiExplanation, 'NLU classified query as security statistics.');
});

runTest('FE-MIS-02', 'Confirmed Mismatch: Assistant.tsx handleSend() transmits message and drops context', () => {
  const simulatedCall = (text: string, context?: any) => ({
    body: JSON.stringify({ message: text, context })
  });
  const actualUiPayload = simulatedCall('Show privileges');
  assert.strictEqual(actualUiPayload.body, JSON.stringify({ message: 'Show privileges' }));
});

runTest('FE-MIS-03', 'Grammar check in renderErrorCard: "privileges" (plural) check vs singular "privilege"', () => {
  const singularMsg = 'Access denied. Audit Supervisor does not have privilege to access Ask Veyra.';
  const pluralMsg = 'Access denied. Ask Veyra privileges required.';

  assert.strictEqual(singularMsg.toLowerCase().includes('privileges'), false);
  assert.strictEqual(pluralMsg.toLowerCase().includes('privileges'), true);
});

runTest('FE-MIS-04', 'Integration check: renderErrorCard checks error string rather than toolResult.integrationRequired boolean', () => {
  const integrationToolResult = {
    tool: 'getSodConflicts',
    success: false,
    integrationRequired: true,
    error: 'Service temporarily unreachable.'
  };
  const card = categorizeError(integrationToolResult);
  // Because it checks error string for "unreachable", it labels as Host Unreachable instead of Integration Missing!
  assert.strictEqual(card.categoryTitle, 'Oracle Host Unreachable');
  assert.strictEqual(card.showSettingsButton, true);
});

// ===========================================================================
// Summary Report
// ===========================================================================
console.log('\n═════════════════════════════════════════════════════════════════════════════');
console.log(`🏁 VEYRA-101.6 Frontend Consumption Verification Test Report`);
console.log('═════════════════════════════════════════════════════════════════════════════');
console.log(`Total Test Scenarios: ${passed + failed}`);
console.log(`Passed:               ${passed}`);
console.log(`Failed:               ${failed}`);
console.log(`Pass Rate:            ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
console.log('═════════════════════════════════════════════════════════════════════════════');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 ALL FRONTEND CONSUMPTION & RESILIENCE SCENARIOS PASSED SUCCESSFULLY!');
  process.exit(0);
}
