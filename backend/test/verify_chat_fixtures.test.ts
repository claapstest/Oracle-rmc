/**
 * Verification Test Suite for Chatbot Baseline Response Fixtures (Task VEYRA-101.4)
 *
 * Verifies that all captured JSON response fixtures:
 * 1. Load cleanly from disk and parse as valid JSON.
 * 2. Strictly adhere to backend contracts (AIResponse, ToolExecutionResult, and Route Error shapes).
 * 3. Have expected field presence, type safety, and nullability according to scenario specifications.
 * 4. Pass comprehensive security and sanitization checks (zero tokens, secrets, or keys).
 * 5. Exactly align with backend/test/fixtures/chat/manifest.json entries.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AIResponse } from '../src/ai/orchestrator.js';
import { validateAIResponse } from './contractValidator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures/chat');

function loadJson<T = any>(fileName: string): T {
  const filePath = path.join(FIXTURES_DIR, fileName);
  assert.ok(fs.existsSync(filePath), `Fixture file must exist on disk: ${filePath}`);
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

test('Manifest Verification: manifest.json is well-formed and covers all scenarios', () => {
  const manifest = loadJson('manifest.json');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.task, 'VEYRA-101.4');
  assert.ok(Array.isArray(manifest.fixtures), 'manifest.fixtures must be an array');
  assert.ok(manifest.fixtures.length >= 7, 'manifest must cover at least all 7 target scenarios');

  for (const entry of manifest.fixtures) {
    assert.ok(entry.fixtureFile, 'Each entry must have a fixtureFile');
    assert.ok(entry.scenarioId, 'Each entry must have a scenarioId');
    assert.ok(entry.description, 'Each entry must have a description');
    assert.ok(entry.httpMethod, 'Each entry must specify an httpMethod');
    assert.ok([200, 400, 500].includes(entry.httpStatus), `Valid HTTP status required: ${entry.httpStatus}`);
    assert.ok(entry.expectedFields, 'Each entry must specify expectedFields');
    assert.ok(entry.verificationStatus, 'Each entry must specify verificationStatus');
    assert.ok(entry.sanitizationChecklist, 'Each entry must include sanitizationChecklist');

    // Confirm file exists on disk
    const targetPath = path.join(FIXTURES_DIR, entry.fixtureFile);
    assert.ok(fs.existsSync(targetPath), `File in manifest must exist on disk: ${entry.fixtureFile}`);

    // Confirm sanitization checklist is fully checked
    assert.equal(entry.sanitizationChecklist.bearerTokensRemoved, true);
    assert.equal(entry.sanitizationChecklist.credentialsRemoved, true);
    assert.equal(entry.sanitizationChecklist.apiKeysRemoved, true);
    assert.equal(entry.sanitizationChecklist.piiRemoved, true);
    assert.equal(entry.sanitizationChecklist.deterministicMockData, true);
  }
});

test('Scenario 1 (AV-001 / AV-010): Successful text-only response adheres to AIResponse without structuredData', () => {
  const data = loadJson<AIResponse>('scenario_1_text_only_response.json');

  // Validate via shared contract validator
  const validation = validateAIResponse(data);
  assert.ok(validation.valid, `Contract errors: ${validation.errors.join(', ')}`);

  // Verify AIResponse contract properties
  assert.equal(typeof data.message, 'string');
  assert.ok(data.message.length > 0, 'message must be non-empty string');
  assert.equal(typeof data.intent, 'string');
  assert.equal(data.intent, 'APPLICATION_KNOWLEDGE');
  assert.ok(data.parameters && typeof data.parameters === 'object');
  assert.equal(data.parameters.topic, 'ROLE_ARCHITECTURE');

  // Verify ToolExecutionResult contract
  assert.ok(data.toolResult !== null, 'toolResult must not be null');
  assert.equal(typeof data.toolResult.tool, 'string');
  assert.equal(typeof data.toolResult.dataSource, 'string');
  assert.equal(typeof data.toolResult.timestamp, 'string');
  assert.equal(data.toolResult.success, true);

  // Verify text-only requirement: structuredData is omitted / undefined
  assert.equal(data.structuredData, undefined, 'structuredData must be omitted or undefined for text-only responses');
  assert.equal(typeof data.aiExplanation, 'string');
});

test('Scenario 2 (AV-002 / AV-017): Successful response containing structuredData adheres to AIResponse', () => {
  const data = loadJson<AIResponse>('scenario_2_structured_data_response.json');

  // Validate via shared contract validator
  const validation = validateAIResponse(data);
  assert.ok(validation.valid, `Contract errors: ${validation.errors.join(', ')}`);

  // Verify AIResponse contract properties
  assert.equal(typeof data.message, 'string');
  assert.equal(data.intent, 'LIST_USERS');
  assert.equal(data.parameters.filterType, 'MULTIPLE_ROLES');

  // Verify ToolExecutionResult contract
  assert.ok(data.toolResult !== null);
  assert.equal(data.toolResult.success, true);
  assert.equal(typeof data.toolResult.tool, 'string');
  assert.ok(Array.isArray(data.toolResult.data?.users));
  assert.ok(data.toolResult.data.users.length > 0);

  // Verify rich structuredData contract
  assert.ok(data.structuredData, 'structuredData must be defined');
  assert.equal(typeof data.structuredData.title, 'string');
  assert.equal(typeof data.structuredData.summary, 'string');
  assert.ok(Array.isArray(data.structuredData.keyFindings), 'keyFindings must be an array');
  assert.ok(Array.isArray(data.structuredData.riskHighlights), 'riskHighlights must be an array');

  // Verify table structure
  assert.ok(data.structuredData.table, 'table must be defined');
  assert.ok(Array.isArray(data.structuredData.table.columns));
  assert.ok(Array.isArray(data.structuredData.table.rows));
  assert.ok(data.structuredData.table.rows.length > 0);

  // Verify actions and metadata
  assert.ok(Array.isArray(data.structuredData.actions));
  assert.ok(data.structuredData.metadata);
  assert.equal(typeof data.structuredData.metadata.source, 'string');
});

test('Scenario 3 (AV-012): Valid null toolResult response adheres to AIResponse contract', () => {
  const data = loadJson<AIResponse>('scenario_3_null_tool_result.json');

  // Validate via shared contract validator
  const validation = validateAIResponse(data);
  assert.ok(validation.valid, `Contract errors: ${validation.errors.join(', ')}`);

  // Verify AIResponse contract properties
  assert.equal(typeof data.message, 'string');
  assert.ok(data.message.length > 0);
  assert.equal(typeof data.intent, 'string');
  assert.ok(data.parameters && typeof data.parameters === 'object');

  // Strict check on toolResult: must be strictly null
  assert.strictEqual(data.toolResult, null, 'toolResult must be strictly null');

  // structuredData must be omitted / undefined
  assert.equal(data.structuredData, undefined, 'structuredData must be omitted or undefined');
  assert.equal(typeof data.aiExplanation, 'string');
});

test('Scenario 4 (AV-013): Tool execution failure adheres to AIResponse failure structure', () => {
  const data = loadJson<AIResponse>('scenario_4_tool_execution_failure.json');

  // Validate via shared contract validator
  const validation = validateAIResponse(data);
  assert.ok(validation.valid, `Contract errors: ${validation.errors.join(', ')}`);

  // Verify AIResponse contract properties
  assert.equal(typeof data.message, 'string');
  assert.ok(data.toolResult !== null);

  // Verify failure flags
  assert.equal(data.toolResult.success, false, 'toolResult.success must be false');
  assert.equal(typeof data.toolResult.error, 'string', 'toolResult.error must be a string describing failure');
  assert.ok(data.toolResult.error!.length > 0);

  // structuredData must not be present on tool execution failure
  assert.equal(data.structuredData, undefined, 'structuredData must be omitted on execution failure');
});

test('Scenario 5 (AV-014): Oracle integration unavailable adheres to AIResponse with integrationRequired', () => {
  const data = loadJson<AIResponse>('scenario_5_oracle_integration_unavailable.json');

  // Validate via shared contract validator
  const validation = validateAIResponse(data);
  assert.ok(validation.valid, `Contract errors: ${validation.errors.join(', ')}`);

  // Verify AIResponse contract properties
  assert.equal(typeof data.message, 'string');
  assert.ok(data.message.toLowerCase().includes('oracle') || data.message.toLowerCase().includes('integration'));
  assert.equal(data.intent, 'RISK_INFORMATION');
  assert.ok(data.toolResult !== null);

  // Verify integrationRequired flag
  assert.equal(data.toolResult.success, false, 'toolResult.success must be false');
  assert.equal(data.toolResult.integrationRequired, true, 'toolResult.integrationRequired must be true');
  assert.ok(data.toolResult.dataSource.includes('Oracle Fusion'));
  assert.ok(data.toolResult.error && data.toolResult.error.length > 0);

  // structuredData must not be rendered when integrationRequired is true
  assert.equal(data.structuredData, undefined, 'structuredData must be omitted when integration is required');
});

test('Scenario 6 (AV-015): LLM provider failure adheres to graceful fallback (200) and gateway error (500)', () => {
  // Variant A: Graceful fallback
  const fallback = loadJson<AIResponse>('scenario_6_llm_provider_failure_fallback.json');
  const validation = validateAIResponse(fallback);
  assert.ok(validation.valid, `Contract errors: ${validation.errors.join(', ')}`);

  assert.equal(typeof fallback.message, 'string');
  assert.equal(fallback.intent, 'SECURITY_STATISTICS');
  assert.ok(fallback.toolResult !== null);
  assert.equal(fallback.toolResult.success, true);
  assert.ok(fallback.structuredData);

  // Variant B: Gateway error (HTTP 500)
  const err500 = loadJson<{ error: string; details: string }>('scenario_6_llm_timeout_500.json');
  assert.equal(err500.error, 'AI Orchestration failed');
  assert.ok(err500.details.includes('timeout'));
});

test('Scenario 7 (AV-003 / AV-016): Missing message (400) and unexpected failure (500) adhere to route error schemas', () => {
  // Variant A (AV-003): HTTP 400 Bad Request
  const err400 = loadJson<{ error: string }>('scenario_7_missing_message_400.json');
  assert.equal(err400.error, 'Message is required');

  // Variant B (AV-016): HTTP 500 Internal Server Error
  const err500 = loadJson<{ error: string; details: string }>('scenario_7_unexpected_orchestration_500.json');
  assert.equal(err500.error, 'AI Orchestration failed');
  assert.equal(typeof err500.details, 'string');
  assert.ok(err500.details.length > 0);
});

test('Security & Sanitization Scan: Zero passwords, bearer tokens, or operational secrets in fixtures', () => {
  const fixtureFiles = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));

  const sensitivePatterns = [
    /bearer\s+[a-zA-Z0-9_\-\.]{20,}/i,
    /ey[a-zA-Z0-9_-]{10,}\.ey[a-zA-Z0-9_-]{10,}/, // JWT token format
    /ghp_[a-zA-Z0-9]{20,}/, // GitHub token
    /sk-[a-zA-Z0-9]{20,}/,  // OpenAI/Together secret key
    /gsk_[a-zA-Z0-9]{20,}/, // Groq secret key
    /password["']?\s*:\s*["'][^"']+["']/i,
    /client_secret["']?\s*:\s*["'][^"']+["']/i,
    /private_key["']?\s*:\s*["'][^"']+["']/i
  ];

  for (const file of fixtureFiles) {
    const content = fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf-8');
    for (const pattern of sensitivePatterns) {
      assert.ok(!pattern.test(content), `Fixture file ${file} must not match sensitive pattern: ${pattern}`);
    }
  }
});
