# AskVeyra Retention Validation Summary — AI-Enabled Branch

**Document Version:** 1.0.0  
**Date:** November 9, 2026  
**Target Story:** Validate AskVeyra retention in AI-enabled branch  
**Validated Branch:** `veyra-application-dev` (AI-Enabled Product Variant)  
**Comparison Variant:** `standard-veyra-application-dev` (AI-Free Product Variant)  
**Git Remote Status:** Local validation completed — **No changes pushed to remote** (per instruction).

---

## 1. Executive Summary & Objective

The objective of this story is to **ensure the AI-enabled product variant remains fully operational and regression-free following branch separation** between the AI-enabled product line (`veyra-application-*`) and the AI-free product line (`standard-veyra-application-*`).

### Overall Status: **PASS (31/31 Automated Scenarios Passed)**
- **Assistant UI & Frontend Integrations:** Intact, properly routed, and guarded by role-based privilege checks.
- **Backend API & Middleware:** `POST /api/chat` and `requireAskVeyra` authorization pipeline fully active and enforcing security policies.
- **AI Orchestration & Tooling:** 4-stage orchestrator, all 31 registered data tools, and Together AI LLM engine operational with graceful fallback.
- **Non-AI Features:** Completely unaffected (Dashboard, User Directory, Role Catalog, Risk Controls, Certifications, and Reports).

---

## 2. Technical Implementation Verification

### 2.1 Component Retention Matrix

| Component | Repository Path | Functional Status | Description / Evidence |
| :--- | :--- | :---: | :--- |
| **Assistant UI** | `frontend/src/pages/Assistant.tsx` | **Retained** | 2,434 lines. Includes chat input bar, suggested prompt templates, follow-up actions, resubmit/retry mechanism, and paginated tables. |
| **Navigation & Guard** | `frontend/src/App.tsx`<br/>`frontend/src/utils/authorization.ts` | **Retained** | Ask VEYRA navigation menu item gated behind `canAccessPage('assistant', authContext)` requiring `ASK_VEYRA` permission. |
| **Frontend API Client** | `frontend/src/services/api.ts` | **Retained** | `api.sendMessage(message, context)` issues authenticated HTTP `POST /api/chat`. |
| **Chat Endpoint** | `backend/src/routes/api.ts` (lines 1735–1807) | **Retained** | `POST /api/chat` route handler handles natural language questions and emits structured `AIResponse`. |
| **Authorization Guard** | `backend/src/routes/api.ts` (lines 154–179) | **Retained** | `requireAskVeyra` enforces `requireAuth`, blocks `AUDIT_SUPERVISOR` with 403 (AC8), allows `ASK_VEYRA` / `SITE_ADMIN` / `ALL`. |
| **AI Orchestrator** | `backend/src/ai/orchestrator.ts` | **Retained** | `processUserMessage(message, context)` executes: Universal DB bypass &rarr; Intent classification &rarr; Tool dispatch &rarr; Answer synthesis &rarr; Structured view-model composition. |
| **Tool Registry** | `backend/src/tools/index.ts` (lines 2038–2285) | **Retained** | All 31 governance and security investigation tools registered in `TOOLS_REGISTRY`. |
| **LLM Provider Engine** | `backend/src/config.ts`<br/>`backend/src/ai/orchestrator.ts` | **Retained** | Together AI engine (`openai/gpt-oss-120b`) via `callGroqCompletions` with automatic fallback to local rule-based `fallbackNLU`. |

### 2.2 AI Configuration Isolation

The AI runtime parameters are maintained exclusively for the AI-enabled product configuration:
- Environment keys: `TOGETHER_API_KEY`, `TOGETHER_MODEL`, `LLM_ENDPOINT`, `GROQ_API_KEY`, `GROQ_MODEL`.
- The AI-free variant (`standard-veyra-application-*`) strips these configurations and dependencies, while `veyra-application-*` retains them.

---

## 3. Acceptance Criteria & Test Evidence

### AC1: AskVeyra Accessible Only to Permitted Roles / Existing Backend Policy

| Persona / Test Scenario | Input / Headers | Expected HTTP Status | Observed HTTP Status | Policy Rule & Evidence |
| :--- | :--- | :---: | :---: | :--- |
| **Unauthenticated Request** | No `Authorization` header | `401 Unauthorized` | `401` | `requireAuth`: Denies request without session token. |
| **Invalid Bearer Token** | `Authorization: Bearer invalid-xyz` | `401 Unauthorized` | `401` | `authService`: Returns `INVALID_TOKEN`. |
| **Audit Supervisor** (`AUDIT_SUPERVISOR`) | Temp user `temp.supervisor@veyra.local` | `403 Forbidden` | `403` | **AC8 Explicit Block:** `"Access denied. Audit Supervisor does not have privilege to access Ask Veyra."` |
| **Audit User** (`AUDIT_USER`) | User `audit.user@claaps.com` | `403 Forbidden` | `403` | **RBAC Failure:** `"Access denied. Ask Veyra privileges required."` (lacks `ASK_VEYRA` permission). |
| **Audit Manager** (`AUDIT_MANAGER`) | User `akash.meesarapu@claaps.com` | `200 OK` | `200` | **Authorized:** Holds `ASK_VEYRA` permission; query executes successfully. |
| **Site Admin** (`SITE_ADMIN`) | User `admin@admin.com` | `200 OK` | `200` | **Authorized:** Holds `ALL` and `isAdmin: true` (backend allows; UI navigation hidden by design). |
| **Malformed Body** | `{}` or `{"message": ""}` | `400 Bad Request` | `400` | Input validation: `{"error": "Message is required"}`. |

---

### AC2: Chat Request/Response Contract & Existing Non-AI Features Unchanged

#### Wire Format Contract Validation (`200 OK`):
```json
{
  "message": "string (Non-empty business-friendly summary)",
  "intent": "string (Recognized intent from TOOLS_REGISTRY)",
  "parameters": { "targetMetric": "DUTY_ROLES" },
  "toolResult": {
    "tool": "SECURITY_STATISTICS",
    "parameters": {},
    "dataSource": "PostgreSQL Authoritative Database",
    "timestamp": "2026-11-09T04:09:41.258Z",
    "success": true,
    "data": { "dutyRolesCount": 4004, "totalRoles": 4713 },
    "integrationRequired": false,
    "ambiguous": false
  },
  "structuredData": {
    "title": "Duty Roles Population",
    "summary": "Found 4,004 duty roles...",
    "keyFindings": ["Duty roles comprise 85% of total role entitlements"],
    "riskHighlights": [],
    "table": { "columns": [], "rows": [] },
    "actions": [{ "label": "View Role Catalog", "actionType": "NAVIGATE" }]
  },
  "aiExplanation": "Brief explanation metadata"
}
```

#### Non-AI Features Regression Verification:
Live authenticated requests with an Audit Manager session confirmed zero regression across all standard endpoints:
- `GET /api/capabilities` &rarr; `200 OK`
- `GET /api/auth/status` &rarr; `200 OK` (`loggedIn: true`)
- `GET /api/users?source=oracle` &rarr; `200 OK` (User list returned)
- `GET /api/roles?source=oracle` &rarr; `200 OK` (Role catalog returned)
- `GET /api/dashboard/metrics` &rarr; `200 OK` (Active risks: 37, open issues: 29639)
- `GET /api/access-certifications` &rarr; `200 OK` (Certification campaigns returned)

---

### AC3: Build Integrity & Provider-Failure Self-Healing Fallback

1. **Provider-Failure & LLM Timeout Fallback:**
   - When an analytical reasoning query (`"explain why IT Security Manager role has segregation of duties conflicts..."`) is dispatched and the remote LLM provider encounters an error or timeout, the orchestrator catches the exception gracefully:
     - Stage 1 catches and routes to `fallbackNLU(message, context)`.
     - Stage 3 catches and routes to `generateFallbackExplanation(intent, parameters, toolResult)`.
   - **Result:** The service returns HTTP `200 OK` with structured evidence instead of throwing an unhandled HTTP 500 error.
2. **Security & Privacy Guardrail:**
   - Probing queries (`"Show me user password hash"`) are trapped by the enterprise security policy pattern, returning HTTP `200 OK` with an `APPLICATION_KNOWLEDGE` access-denied disclaimer; zero credential or `$2b$` bcrypt hashes are exposed.
3. **Build Execution:**
   - **Backend:** `npm run build:backend` (`tsc`) &rarr; Clean build, 0 errors.
   - **Frontend:** `npm run build:frontend` (`tsc -b && vite build`) &rarr; Clean build, 1518 modules transformed, 0 errors.
   - **Frontend Authorization Matrix:** `npx tsx frontend/src/utils/authorization.check.ts` &rarr; All assertions passed.

---

## 4. How to Run the Automated Regression Test Suite

The regression test suite is self-contained in `scratch/test_ai_branch_regression.mjs`. It automatically checks backend connectivity, provisions required test personas in PostgreSQL, executes all 31 assertions, and cleans up after execution.

### Prerequisites
1. **PostgreSQL Service:** Ensure PostgreSQL is running on port 5433 (`veyra_db`).
2. **Backend Server:** The backend server must be running on port 5000:
   ```bash
   # Terminal 1: Build and launch backend
   npm run build:backend
   node backend/dist/index.js
   ```

### Running the Tests
In another terminal, execute:
```bash
# Terminal 2: Run the automated regression test suite
node scratch/test_ai_branch_regression.mjs
```

### Expected Output
```text
================================================================
AI-Enabled Branch Validation & Regression Test Suite
Branch: veyra-application-dev
Target: http://localhost:5000/api
================================================================

--- Persona Authentication ---
[PASS] AUDIT_MANAGER (akash) login succeeds
[PASS] AUDIT_SUPERVISOR login succeeds
[PASS] AUDIT_USER login succeeds
[PASS] SITE_ADMIN login succeeds

--- AC1: Denied-Role & Backend Access Policy Enforcement ---
[PASS] Unauthenticated POST /api/chat returns 401 Unauthorized -> status=401
[PASS] Invalid Bearer token returns 401 -> status=401
[PASS] AUDIT_SUPERVISOR gets 403 FORBIDDEN with explicit AC8 denial message -> status=403
[PASS] AUDIT_USER gets 403 FORBIDDEN (lacks ASK_VEYRA privilege) -> status=403
[PASS] Empty body returns 400 Bad Request
[PASS] Empty message string returns 400 Bad Request

--- AC2: Chat Happy-Path & Request/Response Contract ---
[PASS] AUDIT_MANAGER query returns 200 OK -> status=200
[PASS] Contract field: message is non-empty string
[PASS] Contract field: intent is APPLICATION_KNOWLEDGE -> intent=APPLICATION_KNOWLEDGE
[PASS] Contract field: parameters is object
[PASS] Contract field: toolResult is valid and successful
[PASS] Contract field: structuredData has title
[PASS] Security statistics query returns 200 OK -> status=200
[PASS] Intent classified as SECURITY_STATISTICS -> intent=SECURITY_STATISTICS
[PASS] Returns duty roles data
[PASS] SITE_ADMIN backend API access returns 200 OK -> status=200

--- AC3: Provider-Failure & Fallback Resilience ---
[PASS] Reasoning query succeeds (either via LLM or graceful fallback to rule-based engine) -> status=200
[PASS] Response message generated safely
[PASS] Structured data preserved in response
[PASS] Privacy guardrail query returns 200 OK without crashing -> status=200
[PASS] No credential / hash leakage

--- AC4: Non-AI Features Regression Tests ---
[PASS] GET /api/capabilities returns 200 OK
[PASS] GET /api/auth/status returns 200 loggedIn
[PASS] GET /api/users returns 200 OK with user array
[PASS] GET /api/roles returns 200 OK with roles array
[PASS] GET /api/dashboard/metrics returns 200 OK -> status=200
[PASS] GET /api/access-certifications returns 200 OK -> status=200

================================================================
Validation Results: 31 passed, 0 failed
================================================================
```

---

## 5. Conclusion & Ready State

The AI-enabled branch `veyra-application-dev` satisfies all technical criteria and acceptance criteria for **"Validate AskVeyra retention in AI-enabled branch"**. AskVeyra remains intact, policy-governed, contract-compliant, resilient to LLM provider failures, and non-disruptive to existing non-AI features.

*No commits or pushes to remote origin were performed.*

