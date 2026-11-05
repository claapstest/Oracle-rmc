# VEYRA-101.5 Implementation & Contract Regression Testing Report

**Task Reference**: VEYRA-101.5 ("Introduce Automated API Contract Regression Tests")  
**Owner**: Backend / QA  
**Date**: November 5, 2026  
**Status**: COMPLETE (31 / 31 Test Scenarios Passing — 100% Pass Rate)  
**Target Endpoint**: `POST /api/chat` (Ask VEYRA Conversational Assistant)  

---

## 1. Executive Summary

As part of the Ask VEYRA stabilization and re-architecture initiative (Story **VEYRA-101**), subtask **101.5** establishes an automated, deterministic API contract regression test suite for `POST /api/chat`. 

This implementation consolidates the deliverables from prior subtasks:
* **101.1 (Akash)**: Request/response flow mapping and orchestrator inventory.
* **101.2 (Sravanth)**: Formal API contract specification and schema boundaries.
* **101.3 (Karthik)**: Authentication & authorization pipeline verification, including 4 distinct HTTP 401 shapes.
* **101.4 (Hemanth)**: Sanitized JSON response fixtures and scenario manifests.

With **101.5 complete**, the engineering team now possesses a zero-cost, offline, deterministic regression harness that runs in CI in seconds, shielding future changes from contract regressions ahead of **101.6** (Frontend Error Handling) and **101.7** (Orchestrator Decomposition).

---

## 2. Deliverables & Components Created

### 2.1 Sanitized Response Fixtures (`backend/test/fixtures/chat/`)
All representative scenarios identified in 101.3 and 101.4 have been formalized into version-controlled JSON fixtures on disk:

| Fixture File | Scenario ID | Expected Status | Contract Shape |
|---|---|---|---|
| `scenario_1_text_only_response.json` | **AV-001 / AV-010** | `POST 200` | Text-only `AIResponse` (`structuredData` omitted) |
| `scenario_2_structured_data_response.json` | **AV-002 / AV-017** | `POST 200` | Structured `AIResponse` (table, keyFindings, actions, metadata) |
| `scenario_3_null_tool_result.json` | **AV-012** | `POST 200` | Conversational query (`toolResult: null`, `structuredData: undefined`) |
| `scenario_4_tool_execution_failure.json` | **AV-013** | `POST 200` | Backend tool failure (`toolResult.success: false`, error string) |
| `scenario_5_oracle_integration_unavailable.json` | **AV-014** | `POST 200` | External Oracle requirement (`integrationRequired: true`) |
| `scenario_6_llm_provider_failure_fallback.json` | **AV-015a** | `POST 200` | Local rule fallback response on LLM timeout |
| `scenario_6_llm_timeout_500.json` | **AV-015b** | `POST 500` | Upstream provider timeout (`error: "AI Orchestration failed"`) |
| `scenario_7_missing_message_400.json` | **AV-003** | `POST 400` | Missing message payload (`error: "Message is required"`) |
| `scenario_7_unexpected_orchestration_500.json` | **AV-016** | `POST 500` | Unhandled orchestrator pipeline exception |
| `auth/401_missing_token.json` | **AV-005** | `POST 401` | Missing `Authorization` header (no `code` field) |
| `auth/401_malformed_header.json` | **AV-005b** | `POST 401` | Non-Bearer authorization (no `code` field) |
| `auth/401_empty_token.json` | **AV-006b** | `POST 401` | Empty Bearer token (`code: "INVALID_TOKEN"`) |
| `auth/401_unknown_token.json` | **AV-006** | `POST 401` | Unknown token (`code: "SESSION_NOT_FOUND"`) |
| `auth/401_expired_session.json` | **AV-007** | `POST 401` | Expired session (`code: "SESSION_EXPIRED"`, `success` absent) |
| `auth/403_audit_supervisor.json` | **AV-008** | `POST 403` | Audit Supervisor denial (`code: "FORBIDDEN"`) |
| `auth/403_missing_ask_veyra.json` | **AV-009** | `POST 403` | Missing Ask Veyra privilege (`code: "FORBIDDEN"`) |

### 2.2 Reusable Contract Validator (`backend/test/contractValidator.ts`)
A dedicated validation library enforcing:
* **`validateAIResponse(data)`**: Validates mandatory keys (`message`, `intent`, `parameters`, `toolResult`), ensures strict type safety, confirms conditional existence of `structuredData`, and validates `table`, `keyFindings`, `actions`, and `metadata` structures.
* **`validateToolExecutionResult(tr)`**: Validates mandatory keys (`tool`, `parameters`, `dataSource`, `timestamp`, `success`) and conditional flags (`integrationRequired`, `ambiguous`).
* **`validateErrorResponse(status, body, expectedType)`**: Validates exact JSON payloads for 400, 401, 403, and 500 responses, strictly enforcing the 4 distinct 401 payload shapes.
* **`loadFixture(filename)`**: Safe loader for version-controlled test fixtures.

### 2.3 Automated Contract Regression Suite (`backend/test/chat_contract.test.ts`)
An Express-based test harness that executes against an ephemeral local server (`127.0.0.1` on port `0`), providing:
* Complete end-to-end HTTP pipeline testing (`http.request`).
* Controlled session stubs for all authentication roles (`SITE_ADMIN`, `AUDIT_USER`, `AUDIT_SUPERVISOR`, expired, invalid).
* Orchestrator spy counters to prove authorization precedence.
* Zero external cloud/API dependencies (runs 100% offline).

### 2.4 CI Pipeline Scripts
Added script commands to run contract regression tests at both package and root levels:
* `backend/package.json`: `"test:chat-contract": "tsx test/chat_contract.test.ts"`
* Root `package.json`: `"test:chat-contract": "npm --prefix backend run test:chat-contract"`

---

## 3. Test Execution Results Matrix

Running `npm run test:chat-contract` produces the following verified execution trace:

| Group | Test ID | Description | Expected Status | Actual Status | Result |
|---|---|---|---|---|---|
| **Fixtures** | `FIX-01` | Scenario 1 fixture matches AIResponse text-only contract | `200` | `200` | **PASS** |
| **Fixtures** | `FIX-02` | Scenario 2 fixture matches AIResponse structured contract | `200` | `200` | **PASS** |
| **Fixtures** | `FIX-03` | Scenario 3 fixture matches AIResponse null-toolResult contract | `200` | `200` | **PASS** |
| **Fixtures** | `FIX-04` | Scenario 4 fixture matches AIResponse tool-failure contract | `200` | `200` | **PASS** |
| **Fixtures** | `FIX-05` | Scenario 5 fixture matches AIResponse integrationRequired contract | `200` | `200` | **PASS** |
| **Fixtures** | `FIX-06` | Scenario 6A fixture matches AIResponse LLM-fallback contract | `200` | `200` | **PASS** |
| **Auth 401** | `AV-005` | Missing Authorization header returns 401 (no `code` property) | `401` | `401` | **PASS** |
| **Auth 401** | `AV-005b` | Malformed Authorization header (`Basic`) returns 401 (no `code` property) | `401` | `401` | **PASS** |
| **Auth 401** | `AV-006` | Unknown token returns 401 with `code: "SESSION_NOT_FOUND"` | `401` | `401` | **PASS** |
| **Auth 401** | `AV-006b` | Empty Bearer token returns HTTP 401 Authentication Required | `401` | `401` | **PASS** |
| **Auth 401** | `AV-006c` | `requireAuth` emits `code: "INVALID_TOKEN"` on session validation error | `401` | `401` | **PASS** |
| **Auth 401** | `AV-007` | Expired session returns 401 with `code: "SESSION_EXPIRED"` (`success` absent) | `401` | `401` | **PASS** |
| **Precedence**| `AV-011` | Auth precedes validation: invalid token + missing message returns 401 (never 400) | `401` | `401` | **PASS** |
| **Invariant** | `INV-01` | Denied 401 authentication requests NEVER invoke orchestrator | `0 calls` | `0 calls` | **PASS** |
| **Authz 403** | `AV-008` | `AUDIT_SUPERVISOR` receives 403 Forbidden with supervisor denial message | `403` | `403` | **PASS** |
| **Authz 403** | `AV-008b` | `AUDIT_SUPERVISOR` check outranks `ALL`/`ASK_VEYRA` permissions (still 403) | `403` | `403` | **PASS** |
| **Authz 403** | `AV-009` | User lacking `ASK_VEYRA` permission receives 403 with privilege message | `403` | `403` | **PASS** |
| **Invariant** | `INV-02` | Denied 403 authorization requests NEVER invoke orchestrator | `0 calls` | `0 calls` | **PASS** |
| **Validation**| `AV-003` | Missing message field (`{}`) returns HTTP 400 `{ error: "Message is required" }` | `400` | `400` | **PASS** |
| **Validation**| `AV-004a`| Null message (`{ message: null }`) returns HTTP 400 | `400` | `400` | **PASS** |
| **Validation**| `AV-004b`| Empty string message (`{ message: "" }`) returns HTTP 400 | `400` | `400` | **PASS** |
| **Invariant** | `INV-03` | Rejected 400 requests NEVER reach orchestrator processing | `0 calls` | `0 calls` | **PASS** |
| **Success 200**| `AV-001` | Authorized request without context yields 200 text-only AIResponse | `200` | `200` | **PASS** |
| **Success 200**| `AV-002` | Authorized request with context yields 200 structuredData AIResponse | `200` | `200` | **PASS** |
| **Context**   | `AV-002b`| Context parameter reaches orchestrator pipeline intact | `200` | `200` | **PASS** |
| **Success 200**| `AV-012` | Conversational query yields 200 with strictly null `toolResult` | `200` | `200` | **PASS** |
| **Success 200**| `AV-013` | Backend tool failure returns 200 with `toolResult.success: false` | `200` | `200` | **PASS** |
| **Success 200**| `AV-014` | Oracle integration unavailable returns 200 with `integrationRequired: true` | `200` | `200` | **PASS** |
| **Success 200**| `AV-015a`| LLM failure fallback returns 200 authoritative deterministic response | `200` | `200` | **PASS** |
| **Tolerance** | `EXT-01` | Extra unrecognized request fields are accepted gracefully without 400 | `200` | `200` | **PASS** |
| **Error 500** | `AV-016` | Unhandled orchestration exception returns HTTP 500 error payload | `500` | `500` | **PASS** |

---

## 4. Key Architectural Invariants Proven

### 4.1 Authentication Precedes Route Validation (AV-011)
A request containing an invalid bearer token and an empty body `{}` was proven to return **HTTP 401 Unauthorized**, not HTTP 400 Bad Request. This guarantees that unauthenticated requests cannot probe schema or validation boundaries.

### 4.2 Supervisor Denial Outranks Admin Permissions (AV-008b)
When a user with `role: 'AUDIT_SUPERVISOR'` also possesses `isAdmin: true` or `permissions: ['ALL', 'ASK_VEYRA']`, the route unconditionally rejects the request with **HTTP 403 Forbidden**. The supervisor policy block takes precedence over permission evaluations.

### 4.3 Zero Side-Effects on Denied Requests (INV-01, INV-02, INV-03)
Orchestrator invocation counters recorded **0 executions** across all 401, 403, and 400 test cases. Neither the AI pipeline nor downstream tools/databases are ever invoked when access or parameters are invalid.

### 4.4 Header Trimming Discovery (AV-006b vs AV-006c)
RFC 7230 / Node.js HTTP parsers strip trailing whitespace from header values. Therefore, sending `Authorization: 'Bearer '` arrives at Express as `'Bearer'`. Because `'Bearer'` does not start with `'Bearer '` (with space), it is caught immediately by the header guard (`AV-005` shape). If an empty string is passed directly into `authService.validateSession`, it emits `code: "INVALID_TOKEN"` (`AV-006c`). Both paths are verified.

---

## 5. Handoff to Subsequent Subtasks

### 5.1 Handoff to VEYRA-101.6 (Frontend Error Handling & Consumption)
* **Optional Field Safety**: Frontend code in `Assistant.tsx` must never assume `structuredData` or `aiExplanation` exist. When `toolResult.success === false` or `toolResult === null`, `structuredData` is omitted (`undefined`).
* **401 Response Discrepancy**: Frontend error interceptors must check `body.code || body.error_code || body.message` defensively because missing headers omit `code`, while expired sessions omit `success`.

### 5.2 Handoff to VEYRA-101.7 (Orchestrator Decomposition)
* The test command `npm run test:chat-contract` must be executed before and after extracting `responseComposer.ts` from `orchestrator.ts`.
* Any breakage in response structure, intent mapping, or parameter passthrough will be flagged immediately by this suite.

---

## 6. Verification Command

To execute the test suite at any time:
```powershell
npm run test:chat-contract
```
Execution finishes in ~6 seconds with zero external network dependencies.

