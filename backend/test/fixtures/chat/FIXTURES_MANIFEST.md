# Ask VEYRA Chatbot API - Response Fixtures Manifest

**Task Reference**: VEYRA-101.4 ("Capture chatbot success and failure response fixtures")  
**Target Branch**: `veyra-application-101`  
**Generated At**: `2026-11-04T11:12:13.028Z`  
**Fixtures Directory**: `backend/test/fixtures/chat/`  

## Target Response Contract Overview

### 1. Successful Response Contract (`AIResponse`)
```typescript+
export interface AIResponse {
  message: string;
  intent: string;
  parameters: any;
  toolResult: ToolExecutionResult | null;
  structuredData?: {
    title: string;
    summary: string;
    keyFindings: string[];
    riskHighlights: string[];
    table?: { type: string; columns: string[]; rows: any[] };
    actions: Array<{ label: string; actionType: string; params: any }>;
    metadata: { source: string; retrievedAt: string; totalCount: number; matchingCount: number };
  };
  aiExplanation?: string;
}
```

### 2. Tool Execution Contract (`ToolExecutionResult`)
```typescript
export interface ToolExecutionResult {
  tool: string;
  parameters: any;
  dataSource: string;
  timestamp: string;
  success: boolean;
  data?: any;
  error?: string;
  integrationRequired?: boolean;
  ambiguous?: boolean;
}
```

### 3. Route Error Contracts
- **HTTP 400 Bad Request**: `{ "error": "Message is required" }`
- **HTTP 500 Internal Server Error**: `{ "error": "AI Orchestration failed", "details": string }`

## Fixtures Summary Table

| # | Fixture File | Scenario ID | Description | HTTP Method & Status | Expected Structure | Verification Status | Sanitization Status |
|---|---|---|---|---|---|---|---|
| 1 | [`scenario_1_text_only_response.json`](./scenario_1_text_only_response.json) | **AV-001 / AV-010** | Successful text-only response: Chatbot delivers authoritative textual explanation without tabular/grid data (structuredData is undefined/omitted). | `POST 200` | Text-only (structuredData omitted) | Verified via Runtime Trace | Clean (100% Sanitized) |
| 2 | [`scenario_2_structured_data_response.json`](./scenario_2_structured_data_response.json) | **AV-002 / AV-017** | Successful response containing structuredData: Chatbot delivers natural language answer alongside structured payload including title, summary, keyFindings, riskHighlights, table rows/columns, actions, and metadata. | `POST 200` | Structured (table & cards) | Verified via Runtime Trace | Clean (100% Sanitized) |
| 3 | [`scenario_3_null_tool_result.json`](./scenario_3_null_tool_result.json) | **AV-012** | Valid null toolResult response: Conversational or general response where no backend tool was invoked, yielding toolResult: null and structuredData: undefined. | `POST 200` | Text-only (structuredData omitted) | Verified via Mock Controller | Clean (100% Sanitized) |
| 4 | [`scenario_4_tool_execution_failure.json`](./scenario_4_tool_execution_failure.json) | **AV-013** | Tool execution failure: Backend tool encounters an internal execution error (e.g., query failure, pool exhaustion, or downstream error), returning toolResult.success: false with error details and omitting structuredData. | `POST 200` | Text-only (structuredData omitted) | Verified via Runtime Trace | Clean (100% Sanitized) |
| 5 | [`scenario_5_oracle_integration_unavailable.json`](./scenario_5_oracle_integration_unavailable.json) | **AV-014** | Oracle integration unavailable: Request targets live Oracle Fusion or Risk Management Cloud endpoints where integration is unconfigured or unavailable; returns integrationRequired: true flag. | `POST 200` | Text-only (structuredData omitted) | Verified via Runtime Trace | Clean (100% Sanitized) |
| 6 | [`scenario_6_llm_provider_failure_fallback.json`](./scenario_6_llm_provider_failure_fallback.json) | **AV-015 (Variant A - Graceful Fallback)** | LLM provider failure / timeout with graceful fallback: Upstream LLM call times out after 25s; orchestrator catches error and seamlessly generates authoritative deterministic response via local NLU and cached metrics. | `POST 200` | Structured (table & cards) | Verified via Runtime Trace | Clean (100% Sanitized) |
| 7 | [`scenario_6_llm_timeout_500.json`](./scenario_6_llm_timeout_500.json) | **AV-015 (Variant B - Gateway Timeout Error)** | LLM provider failure / timeout error payload: Upstream LLM gateway timeout (25s) propagating as HTTP 500 from /api/chat route catch block. | `POST 500` | Error object (error: "AI Orchestration failed", details: string) | Verified via Mock Controller | Clean (100% Sanitized) |
| 8 | [`scenario_7_missing_message_400.json`](./scenario_7_missing_message_400.json) | **AV-003** | Missing message error: HTTP 400 Bad Request triggered when the client POST request body omits the required "message" property. | `POST 400` | Error object (error: "Message is required") | Verified via Runtime Trace | Clean (100% Sanitized) |
| 9 | [`scenario_7_unexpected_orchestration_500.json`](./scenario_7_unexpected_orchestration_500.json) | **AV-016** | Unexpected orchestration failure: HTTP 500 Internal Server Error triggered when an unhandled exception occurs inside the AI orchestration pipeline. | `POST 500` | Error object (error: "AI Orchestration failed", details: string) | Verified via Mock Controller | Clean (100% Sanitized) |

## Scenario Details & Request / Response Mappings

### Scenario 1: AV-001 / AV-010 — Successful text-only response: Chatbot delivers authoritative textual explanation without tabular/grid data (structuredData is undefined/omitted).

- **Fixture File**: [`scenario_1_text_only_response.json`](./scenario_1_text_only_response.json)
- **HTTP Method & Status**: `POST 200`
- **Verification Mode**: `Verified via Runtime Trace`
- **Sample Request Payload**:
```json
{
  "message": "What is a duty role in Oracle Fusion?"
}
```
- **Expected Fields Present / Nullability**:
  * `message`: Present (string, non-empty)
  * `intent`: Present ("APPLICATION_KNOWLEDGE")
  * `parameters`: Present (object with topic and query)
  * `toolResult`: Present (ToolExecutionResult with success: true)
  * `structuredData`: Omitted / undefined
  * `aiExplanation`: Present (string)
- **Sanitization Checklist**:
  * [x] Real Bearer Tokens removed
  * [x] Passwords & API credentials removed
  * [x] Operational API keys (Together AI / Groq / OpenAI) removed
  * [x] Personally Identifiable Information (PII) sanitized to standard demonstration accounts
  * [x] Clean deterministic mock data verified

### Scenario 2: AV-002 / AV-017 — Successful response containing structuredData: Chatbot delivers natural language answer alongside structured payload including title, summary, keyFindings, riskHighlights, table rows/columns, actions, and metadata.

- **Fixture File**: [`scenario_2_structured_data_response.json`](./scenario_2_structured_data_response.json)
- **HTTP Method & Status**: `POST 200`
- **Verification Mode**: `Verified via Runtime Trace`
- **Sample Request Payload**:
```json
{
  "message": "List the users who are having multiple roles"
}
```
- **Expected Fields Present / Nullability**:
  * `message`: Present (string, non-empty)
  * `intent`: Present ("LIST_USERS")
  * `parameters`: Present (object with filterType: "MULTIPLE_ROLES")
  * `toolResult`: Present (ToolExecutionResult with success: true and data)
  * `structuredData`: Present (object with title, summary, keyFindings, riskHighlights, table, actions, metadata)
  * `aiExplanation`: Present (string)
- **Sanitization Checklist**:
  * [x] Real Bearer Tokens removed
  * [x] Passwords & API credentials removed
  * [x] Operational API keys (Together AI / Groq / OpenAI) removed
  * [x] Personally Identifiable Information (PII) sanitized to standard demonstration accounts
  * [x] Clean deterministic mock data verified

### Scenario 3: AV-012 — Valid null toolResult response: Conversational or general response where no backend tool was invoked, yielding toolResult: null and structuredData: undefined.

- **Fixture File**: [`scenario_3_null_tool_result.json`](./scenario_3_null_tool_result.json)
- **HTTP Method & Status**: `POST 200`
- **Verification Mode**: `Verified via Mock Controller`
- **Sample Request Payload**:
```json
{
  "message": "Hello, how can you help me today?"
}
```
- **Expected Fields Present / Nullability**:
  * `message`: Present (string, non-empty conversational text)
  * `intent`: Present ("GENERAL_CONVERSATION")
  * `parameters`: Present (empty object {})
  * `toolResult`: Strict null
  * `structuredData`: Omitted / undefined
  * `aiExplanation`: Present (string)
- **Sanitization Checklist**:
  * [x] Real Bearer Tokens removed
  * [x] Passwords & API credentials removed
  * [x] Operational API keys (Together AI / Groq / OpenAI) removed
  * [x] Personally Identifiable Information (PII) sanitized to standard demonstration accounts
  * [x] Clean deterministic mock data verified

### Scenario 4: AV-013 — Tool execution failure: Backend tool encounters an internal execution error (e.g., query failure, pool exhaustion, or downstream error), returning toolResult.success: false with error details and omitting structuredData.

- **Fixture File**: [`scenario_4_tool_execution_failure.json`](./scenario_4_tool_execution_failure.json)
- **HTTP Method & Status**: `POST 200`
- **Verification Mode**: `Verified via Runtime Trace`
- **Sample Request Payload**:
```json
{
  "message": "What privileges does user UNKNOWN_USER_404 have?"
}
```
- **Expected Fields Present / Nullability**:
  * `message`: Present (string explaining operation failure)
  * `intent`: Present ("PRIVILEGES_BY_USER")
  * `parameters`: Present (object with target user)
  * `toolResult`: Present (ToolExecutionResult with success: false and error string)
  * `structuredData`: Omitted / undefined
  * `aiExplanation`: Present (string)
- **Sanitization Checklist**:
  * [x] Real Bearer Tokens removed
  * [x] Passwords & API credentials removed
  * [x] Operational API keys (Together AI / Groq / OpenAI) removed
  * [x] Personally Identifiable Information (PII) sanitized to standard demonstration accounts
  * [x] Clean deterministic mock data verified

### Scenario 5: AV-014 — Oracle integration unavailable: Request targets live Oracle Fusion or Risk Management Cloud endpoints where integration is unconfigured or unavailable; returns integrationRequired: true flag.

- **Fixture File**: [`scenario_5_oracle_integration_unavailable.json`](./scenario_5_oracle_integration_unavailable.json)
- **HTTP Method & Status**: `POST 200`
- **Verification Mode**: `Verified via Runtime Trace`
- **Sample Request Payload**:
```json
{
  "message": "Show me Segregation of Duties conflicts from Oracle Risk Management Cloud"
}
```
- **Expected Fields Present / Nullability**:
  * `message`: Present (Markdown formatted message indicating integration requirement)
  * `intent`: Present ("RISK_INFORMATION")
  * `parameters`: Present (object)
  * `toolResult`: Present (ToolExecutionResult with success: false, integrationRequired: true, dataSource: "Oracle Fusion (Integration Needed)")
  * `structuredData`: Omitted / undefined
  * `aiExplanation`: Present (string)
- **Sanitization Checklist**:
  * [x] Real Bearer Tokens removed
  * [x] Passwords & API credentials removed
  * [x] Operational API keys (Together AI / Groq / OpenAI) removed
  * [x] Personally Identifiable Information (PII) sanitized to standard demonstration accounts
  * [x] Clean deterministic mock data verified

### Scenario 6: AV-015 (Variant A - Graceful Fallback) — LLM provider failure / timeout with graceful fallback: Upstream LLM call times out after 25s; orchestrator catches error and seamlessly generates authoritative deterministic response via local NLU and cached metrics.

- **Fixture File**: [`scenario_6_llm_provider_failure_fallback.json`](./scenario_6_llm_provider_failure_fallback.json)
- **HTTP Method & Status**: `POST 200`
- **Verification Mode**: `Verified via Runtime Trace`
- **Sample Request Payload**:
```json
{
  "message": "Give me count of duty roles"
}
```
- **Expected Fields Present / Nullability**:
  * `message`: Present (string with authoritative fallback response)
  * `intent`: Present ("SECURITY_STATISTICS")
  * `parameters`: Present (object)
  * `toolResult`: Present (ToolExecutionResult with success: true from local cache)
  * `structuredData`: Present (structured fallback table)
  * `aiExplanation`: Present (string indicating fallback activation)
- **Sanitization Checklist**:
  * [x] Real Bearer Tokens removed
  * [x] Passwords & API credentials removed
  * [x] Operational API keys (Together AI / Groq / OpenAI) removed
  * [x] Personally Identifiable Information (PII) sanitized to standard demonstration accounts
  * [x] Clean deterministic mock data verified

### Scenario 7: AV-015 (Variant B - Gateway Timeout Error) — LLM provider failure / timeout error payload: Upstream LLM gateway timeout (25s) propagating as HTTP 500 from /api/chat route catch block.

- **Fixture File**: [`scenario_6_llm_timeout_500.json`](./scenario_6_llm_timeout_500.json)
- **HTTP Method & Status**: `POST 500`
- **Verification Mode**: `Verified via Mock Controller`
- **Sample Request Payload**:
```json
{
  "message": "Analyze complex cross-module Segregation of Duties toxic combinations and why they occurred"
}
```
- **Expected Fields Present / Nullability**:
  * `message`: N/A (HTTP 500 Error Object)
  * `intent`: N/A
  * `parameters`: N/A
  * `toolResult`: N/A
  * `structuredData`: N/A
  * `aiExplanation`: N/A
  * `errorFields`: error: "AI Orchestration failed", details: string
- **Sanitization Checklist**:
  * [x] Real Bearer Tokens removed
  * [x] Passwords & API credentials removed
  * [x] Operational API keys (Together AI / Groq / OpenAI) removed
  * [x] Personally Identifiable Information (PII) sanitized to standard demonstration accounts
  * [x] Clean deterministic mock data verified

### Scenario 8: AV-003 — Missing message error: HTTP 400 Bad Request triggered when the client POST request body omits the required "message" property.

- **Fixture File**: [`scenario_7_missing_message_400.json`](./scenario_7_missing_message_400.json)
- **HTTP Method & Status**: `POST 400`
- **Verification Mode**: `Verified via Runtime Trace`
- **Sample Request Payload**:
```json
{
  "context": {
    "currentView": "users"
  }
}
```
- **Expected Fields Present / Nullability**:
  * `message`: N/A (HTTP 400 Error Object)
  * `intent`: N/A
  * `parameters`: N/A
  * `toolResult`: N/A
  * `structuredData`: N/A
  * `aiExplanation`: N/A
  * `errorFields`: error: "Message is required"
- **Sanitization Checklist**:
  * [x] Real Bearer Tokens removed
  * [x] Passwords & API credentials removed
  * [x] Operational API keys (Together AI / Groq / OpenAI) removed
  * [x] Personally Identifiable Information (PII) sanitized to standard demonstration accounts
  * [x] Clean deterministic mock data verified

### Scenario 9: AV-016 — Unexpected orchestration failure: HTTP 500 Internal Server Error triggered when an unhandled exception occurs inside the AI orchestration pipeline.

- **Fixture File**: [`scenario_7_unexpected_orchestration_500.json`](./scenario_7_unexpected_orchestration_500.json)
- **HTTP Method & Status**: `POST 500`
- **Verification Mode**: `Verified via Mock Controller`
- **Sample Request Payload**:
```json
{
  "message": "Trigger unhandled orchestration failure"
}
```
- **Expected Fields Present / Nullability**:
  * `message`: N/A (HTTP 500 Error Object)
  * `intent`: N/A
  * `parameters`: N/A
  * `toolResult`: N/A
  * `structuredData`: N/A
  * `aiExplanation`: N/A
  * `errorFields`: error: "AI Orchestration failed", details: string
- **Sanitization Checklist**:
  * [x] Real Bearer Tokens removed
  * [x] Passwords & API credentials removed
  * [x] Operational API keys (Together AI / Groq / OpenAI) removed
  * [x] Personally Identifiable Information (PII) sanitized to standard demonstration accounts
  * [x] Clean deterministic mock data verified

