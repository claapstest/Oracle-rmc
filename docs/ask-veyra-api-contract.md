# Ask VEYRA POST `/api/chat` Contract Specification (Story VEYRA-101.2)

## 1. Purpose and Scope

This document establishes the verified, implementation-accurate API specification for the **Ask VEYRA** conversational security and access intelligence endpoint (`POST /api/chat`).

It serves as the contract baseline between the React frontend client (`frontend/src/pages/Assistant.tsx`, `frontend/src/services/api.ts`) and the Express backend orchestration pipeline (`backend/src/routes/api.ts`, `backend/src/ai/orchestrator.ts`, `backend/src/tools/index.ts`). Every detail herein has been verified through direct code inspection of the working branch and corroborated by controlled local runtime execution.

No functional behavior, business logic, or interface definitions are modified by this specification.

---

## 2. Endpoint and HTTP Method

| Attribute | Specification | Source Location |
| :--- | :--- | :--- |
| **HTTP Method** | `POST` | [`backend/src/routes/api.ts#L1735`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L1735) |
| **Route Path** | `/chat` | [`backend/src/routes/api.ts#L1735`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L1735) |
| **Router Prefix** | `/api` | [`backend/src/index.ts#L60`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/index.ts#L60) (`app.use('/api', apiRouter)`) |
| **Full URL** | `${API_BASE_URL}/api/chat` | [`frontend/src/services/api.ts#L1-L2, L246`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/frontend/src/services/api.ts#L1-L2) |
| **Middleware Chain** | `requireAskVeyra` -> `requireAuth` -> Route Handler | [`backend/src/routes/api.ts#L154-L179, L1735`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L154-L179) |

---

## 3. Authentication and Required Headers

### 3.1 Request Headers

| Header Name | Type | Required | Expected Value / Format | Description | Source Reference |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `Content-Type` | String | **Required** | `application/json` | Express `express.json({ limit: '50mb' })` body parser requirement | [`backend/src/index.ts#L25`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/index.ts#L25), [`frontend/src/services/api.ts#L147`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/frontend/src/services/api.ts#L147) |
| `Authorization` | String | **Required** | `Bearer <session_token>` | Cryptographically generated active session token | [`backend/src/routes/api.ts#L64-L67`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L64-L67), [`frontend/src/services/api.ts#L148`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/frontend/src/services/api.ts#L148) |

### 3.2 Authentication & Authorization Middleware Pipeline

The route is guarded by `requireAskVeyra` ([`backend/src/routes/api.ts#L154-L179`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L154-L179)), which encapsulates `requireAuth` ([`backend/src/routes/api.ts#L62-L104`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L62-L104)):

1. **Token Extraction**:
   - Inspects `req.header('Authorization')`.
   - If missing or does not start with `'Bearer '`, halts execution immediately with **HTTP 401 Unauthorized**:
     ```json
     { "success": false, "message": "Authentication required. Missing or malformed token." }
     ```
2. **Session Validation & Discrepancy Analysis (`SESSION_NOT_FOUND` vs `INVALID_TOKEN`)**:
   - Strips `'Bearer '` (index 7) and calls `authService.validateSession(token, true)` ([`backend/src/services/authService.ts#L1000-L1100`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/services/authService.ts#L1000-L1100)).
   - **Expired Session**: If `validation.code === 'SESSION_EXPIRED'`, logs audit and returns **HTTP 401**:
     ```json
     { "code": "SESSION_EXPIRED", "message": "Your session has expired. Please log in again." }
     ```
   - **Invalid or Non-Existent Token (`SESSION_NOT_FOUND`)**:
     - *Code Discrepancy Note*: In `backend/src/routes/api.ts#L82`, the route returns `code: validation.code || 'INVALID_TOKEN'`.
     - *Implementation Reality*: When an unknown or invalid token is supplied, `authService.validateSession` line 1072 explicitly produces `{ valid: false, code: 'SESSION_NOT_FOUND', message: 'Session expired or invalid. Please sign in again.' }`.
     - *Runtime Result*: Because `validation.code` is defined as `'SESSION_NOT_FOUND'`, the fallback `'INVALID_TOKEN'` is bypassed. The endpoint emits:
       ```json
       { "success": false, "code": "SESSION_NOT_FOUND", "message": "Session expired or invalid. Please sign in again." }
       ```
   - On valid session, populates `res.locals` (`userId`, `email`, `displayName`, `role`, `permissions`, `isAdmin`, `token`).
3. **Role & Permission Guard (`requireAskVeyra`)**:
   - **Access Control Rule AC8**: If `role === 'AUDIT_SUPERVISOR'`, request is unconditionally rejected with **HTTP 403 Forbidden**:
     ```json
     { "success": false, "code": "FORBIDDEN", "message": "Access denied. Audit Supervisor does not have privilege to access Ask Veyra." }
     ```
   - **Allowed Access**: Authorized if `isAdmin === true`, `role === 'SITE_ADMIN'`, or `permissions` includes `'ALL'` or `'ASK_VEYRA'`.
   - **Other Roles Blocked**: If none of the above are satisfied (e.g. `role === 'AUDIT_USER'` or `role === 'VIEWER'`), halts with **HTTP 403 Forbidden**:
     ```json
     { "success": false, "code": "FORBIDDEN", "message": "Access denied. Ask Veyra privileges required." }
     ```

---

## 4. Request Body Schema

The request body is received as JSON and parsed by `express.json()`. In [`backend/src/routes/api.ts#L1738`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L1738), the handler extracts:
```typescript
const { message, context } = req.body;
```

```json
{
  "type": "object",
  "properties": {
    "message": {
      "type": "string",
      "description": "User natural language prompt or query. Required and must be non-empty."
    },
    "context": {
      "type": "object",
      "description": "Active UI application context. Optional and nullable.",
      "properties": {
        "entityType": { "type": "string", "enum": ["ROLE", "USER", "PRIVILEGE"] },
        "entityName": { "type": "string" },
        "entityId": { "type": "string" },
        "currentView": { "type": "string" },
        "sessionId": { "type": "string" },
        "username": { "type": "string" },
        "userId": { "type": "string" }
      },
      "additionalProperties": true
    }
  },
  "required": ["message"],
  "additionalProperties": true
}
```

---

## 5. Context Object Verification & Functional Distinction

The request body allows an optional `context?: any` parameter. A full audit of all 7 context properties was conducted across the codebase to distinguish **active functional support** from **passive acceptance**:

| Property | Actively Supported By | Functional Role in Implementation | Source Verification |
| :--- | :--- | :--- | :--- |
| `entityType` | **Orchestrator Core** | Actively matched in `fallbackNLU` (`ROLE`, `USER`, `PRIVILEGE`) to resolve pronouns (`this role`, `this user`, `this privilege`) and in LLM prompt interpolation. | [`backend/src/ai/orchestrator.ts#L31, L37, L47, L2305`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L31) |
| `entityName` | **Orchestrator Core** | Injected in place of relative pronouns (`this role`, `it`), passed through into parameter targets (`roleName: context.entityName`), and interpolated into system prompt. | [`backend/src/ai/orchestrator.ts#L29, L1201, L1316, L1499, L2307`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L29) |
| `entityId` | **Orchestrator Core** | Substituted for user pronouns (`this user`, `them`), bound to parameter targets (`userId: context.entityId`), and interpolated into system prompt. | [`backend/src/ai/orchestrator.ts#L38, L993, L1534, L1590, L2306`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L38) |
| `currentView` | **Orchestrator Core (LLM Only)** | Interpolated into LLM system prompt (`Active Page View: ${context.currentView \|\| 'N/A'}`). Ignored by deterministic `fallbackNLU`. | [`backend/src/ai/orchestrator.ts#L2304`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L2304) |
| `sessionId` | **Universal Database Engine** | Primary multi-turn conversation session key in `universalDatabaseChatbotService.processQuery()`. Not read by standard Ask Veyra orchestrator. | [`backend/src/services/universalDatabaseChatbotService.ts#L26`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/services/universalDatabaseChatbotService.ts#L26) |
| `username` | **Universal Database Engine** | Secondary fallback session key in `universalDatabaseChatbotService`. Not read by standard Ask Veyra orchestrator. | [`backend/src/services/universalDatabaseChatbotService.ts#L26`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/services/universalDatabaseChatbotService.ts#L26) |
| `userId` | **Universal Database Engine** | Tertiary fallback session key in `universalDatabaseChatbotService`. (Standard orchestrator reads `entityId` instead). | [`backend/src/services/universalDatabaseChatbotService.ts#L26`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/services/universalDatabaseChatbotService.ts#L26) |

*Any other context keys*: Accepted without runtime error because `context?: any`, but completely unread by backend logic.

---

## 6. Field-Level Classification

We strictly distinguish **compile-time TypeScript definitions** from **runtime null, undefined, and truthiness evaluation**:

### 6.1 Compile-Time TypeScript Optionality
- `field: T` = Declared as mandatory property; compile-time TypeScript error if omitted.
- `field?: T` = Declared as optional property; may be omitted or undefined at compile time.
- `field: T | null` = Declared as mandatory property that explicitly accepts `null`.
- `field?: T | null` = Declared as optional property that accepts `null` or `undefined`.

### 6.2 Runtime Null, Undefined & Truthiness Evaluation
- `if (!message)` checks JavaScript truthiness. It evaluates to `true` on `undefined`, `null`, `""`, `0`, and `false`, returning `400 Bad Request`.
- Whitespace string `"   "` is truthy (`!"   " === false`), passing route-level validation.
- `context && context.entityName` safely handles both `undefined` and `null`.

### 6.3 Request Body Field Matrix

| Field | TypeScript Interface Type | Nullable? | Optional? | Runtime Validation & Normalization Behavior | Source Location |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `message` | `string` | **No** | **No** | Falsy values (`undefined`, `null`, `""`) return `400 Bad Request` (`{ "error": "Message is required" }`). Whitespace (`"   "`) is truthy and accepted. Raw string is preserved in audit logs; trimmed inside NLU. | [`backend/src/routes/api.ts#L1739-L1741`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L1739-L1741) |
| `context` | `any? \| null` | **Yes** | **Yes** | If omitted or `null`, handled gracefully via `if (context && ...)`. In normal UI usage, `Assistant.tsx` omits this property entirely. | [`backend/src/ai/orchestrator.ts#L25, L2302`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L25) |
| `context.entityType` | `string?` | **No** | **Yes** | Checked against `'ROLE'`, `'USER'`, `'PRIVILEGE'`. Non-matching values bypassed without error. | [`backend/src/ai/orchestrator.ts#L31-L47`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L31-L47) |
| `context.entityName` | `string?` | **No** | **Yes** | Lowercased for pronoun substitution; passed through unchanged into extracted parameters. | [`backend/src/ai/orchestrator.ts#L29-L30`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L29-L30) |
| `context.entityId` | `string?` | **No** | **Yes** | Used as username target for user queries. Defaults to `'N/A'` in LLM prompt. | [`backend/src/ai/orchestrator.ts#L38, L2306`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L38) |
| `context.currentView` | `string?` | **No** | **Yes** | Interpolated into LLM prompt; defaults to `'N/A'`. | [`backend/src/ai/orchestrator.ts#L2304`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L2304) |
| Extra Body Fields | `any?` | **Yes** | **Yes** | Express JSON parser accepts extra fields; backend ignores them without error. | [`backend/src/routes/api.ts#L1738`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L1738) |

### 6.4 Response Body Field Matrix (`AIResponse`)

| Field | TypeScript Interface Type | Nullable? | Optional? | Runtime Return Rules | Source Location |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `message` | `string` | **No** | **No** | Always present. Contains natural language summary, Markdown explanation, or error/clarification. | [`backend/src/ai/orchestrator.ts#L9, L3120`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L9) |
| `intent` | `string` | **No** | **No** | Always present. Extracted intent string (e.g. `'SECURITY_STATISTICS'`, `'ROLE_PRIVILEGES'`). | [`backend/src/ai/orchestrator.ts#L10, L3121`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L10) |
| `parameters` | `any` (`Record<string, any>`) | **No** | **No** | Always present. Map of extracted query parameters. Empty object `{}` when no params. | [`backend/src/ai/orchestrator.ts#L11, L3122`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L11) |
| `toolResult` | `ToolExecutionResult \| null` | **Yes** | **No** | Present in interface as nullable. Contains tool execution details. `null` if no tool was run. | [`backend/src/ai/orchestrator.ts#L12, L3123`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L12) |
| `structuredData` | `any?` | **No** | **Yes** | Optional property. Present only when `toolResult && (toolResult.success \|\| toolResult.ambiguous) && !toolResult.integrationRequired`. Otherwise omitted (`undefined`). | [`backend/src/ai/orchestrator.ts#L13, L3124-L3129`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L13) |
| `aiExplanation` | `string?` | **No** | **Yes** | Optional property. Contains rationale string from intent classifier. *(Note: Discarded by `Assistant.tsx` in UI)*. | [`backend/src/ai/orchestrator.ts#L14, L3130`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L14) |

### 6.5 Tool Execution Result Field Matrix (`ToolExecutionResult`)

| Field | TypeScript Interface Type | Nullable? | Optional? | Runtime Return Rules | Source Location |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `tool` | `string` | **No** | **No** | Always present. Name of executed tool or intent. | [`backend/src/tools/index.ts#L27, L41`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/tools/index.ts#L27) |
| `parameters` | `any` | **No** | **No** | Always present. Input parameters passed into the tool. | [`backend/src/tools/index.ts#L28, L42`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/tools/index.ts#L28) |
| `dataSource` | `string` | **No** | **No** | Always present. Data source origin (`'PostgreSQL Authoritative Database'`, `'Live Oracle Fusion API'`, etc.). | [`backend/src/tools/index.ts#L29, L43`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/tools/index.ts#L29) |
| `timestamp` | `string` | **No** | **No** | Always present. ISO-8601 generation timestamp. | [`backend/src/tools/index.ts#L30, L44`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/tools/index.ts#L30) |
| `success` | `boolean` | **No** | **No** | Always present. Boolean flag indicating data retrieval success. | [`backend/src/tools/index.ts#L31, L45`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/tools/index.ts#L31) |
| `data` | `any?` | **No** | **Yes** | Defined when `success === true` or `ambiguous === true`. Otherwise `undefined`. | [`backend/src/tools/index.ts#L32, L46`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/tools/index.ts#L32) |
| `error` | `string?` | **No** | **Yes** | Defined when `success === false`. Otherwise `undefined`. | [`backend/src/tools/index.ts#L33, L47`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/tools/index.ts#L33) |
| `integrationRequired`| `boolean?` | **No** | **Yes** | Present when external Fusion GRC integration is needed. Defaults to `false`. | [`backend/src/tools/index.ts#L34, L48`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/tools/index.ts#L34) |
| `ambiguous` | `boolean?` | **No** | **Yes** | Present when disambiguation is required. Defaults to `false`. | [`backend/src/tools/index.ts#L35, L49`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/tools/index.ts#L35) |

---

## 7. Backend Validation and Normalization Behavior

### 7.1 Message Validation Logic

Inspection of [`backend/src/routes/api.ts#L1739-L1741`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L1739-L1741):
```typescript
const { message, context } = req.body;
if (!message) {
  return res.status(400).json({ error: 'Message is required' });
}
```

1. **Missing `message` (`undefined`)**: `!undefined === true` -> Returns **HTTP 400** `{ "error": "Message is required" }`.
2. **Null `message` (`null`)**: `!null === true` -> Returns **HTTP 400** `{ "error": "Message is required" }`.
3. **Empty String `message` (`""`)**: `!"" === true` -> Returns **HTTP 400** `{ "error": "Message is required" }`.
4. **Whitespace-Only `message` (`"   "`)**:
   - In JavaScript, `"   "` is truthy (`!"   " === false`). It **passes** the `if (!message)` check.
   - Inside `processUserMessage(message, context)`:
     - `cleanUserQuery = message.toLowerCase().trim();` results in `""`.
     - `fallbackNLU(message, context)` trims input to `""` and classifies it as `UNKNOWN`.
     - Because `toolResult` is null, line 3104 delegates the query to `universalDatabaseChatbotService.processQuery("   ", context)`.
     - `textToSqlService` marks the empty query as ambiguous and returns **HTTP 200** with `intent: 'UNIVERSAL_DATABASE_QUERY'`, `toolResult.success: false`, and clarification prompt.
5. **Length Restrictions**:
   - No explicit application-level length cap on `message`.
   - General Express body limit of `50mb` applies ([`backend/src/index.ts#L25`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/index.ts#L25)).
6. **Trimming & Normalization**:
   - The route handler does **not** trim `req.body.message`. Raw string is preserved in console audit logs (`console.log('User Question:    "${message}"')`).
   - Normalization occurs locally inside `processUserMessage` and `fallbackNLU` using `.toLowerCase().trim()`.
   - If Groq/Together LLM is called, the original un-normalized `message` is transmitted in `content: message`.

---

## 8. Frontend Token Handling

Detailed inspection of [`frontend/src/services/api.ts`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/frontend/src/services/api.ts):

### 8.1 Base URL Resolution (`API_BASE`)
```typescript
const API_BASE = (import.meta.env.VITE_API_BASE_URL 
  ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/+$/, '') 
  : '') + '/api';
```
- Trailing slashes are stripped and `'/api'` is appended. Defaults to `'/api'` when environment variable is omitted.

### 8.2 Token Retrieval & Investigation Tab Bridging (`getActiveAuthToken`)
1. **Primary Store**: Checks `sessionStorage.getItem('authToken')`.
2. **Child Tab Token Bridge**:
   - When opened with `?investigationId=<id>` in URL parameters, checks `localStorage.getItem('inv_tab_bridge')`.
   - Validates JSON payload: checks `bridge.targetId === currentInvId` and `Date.now() <= bridge.expiresAt` (15-second TTL).
   - Single-use hygiene: immediately calls `localStorage.removeItem('inv_tab_bridge')`.
   - Hydrates `sessionStorage` with `bridge.token` and `bridge.user`.
3. **Missing Token Fallback**: Returns `''` (empty string).

### 8.3 Wire Call Handling (`apiRequest` & `sendMessage`)
- **Headers Sent**:
  ```typescript
  'Content-Type': 'application/json',
  'Authorization': token ? `Bearer ${token}` : ''
  ```
  If `token` is empty string, `Authorization: ` (or empty header) is sent, resulting in backend 401 rejection.
- **Session Expiry Event**:
  On HTTP 401 with `code === 'SESSION_EXPIRED'` or `'INVALID_TOKEN'`, `apiRequest` clears active session storage and dispatches `window.dispatchEvent(new CustomEvent('auth:expired'))`.
- **Frontend Context Transmission Reality**:
  - `api.sendMessage(message: string, context?: any)` defines an optional `context` argument.
  - In `frontend/src/pages/Assistant.tsx` (`handleSend` line 436 and `handleEditAndResubmit` line 487), the UI invokes `api.sendMessage(text)` without passing `context`.
  - Consequently, `JSON.stringify({ message, context: undefined })` drops `context` and transmits `{"message": "..."}`.

---

## 9. Successful Response Interface (`AIResponse`)

### 9.1 Declared TypeScript Interface
In [`backend/src/ai/orchestrator.ts#L8-L15`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L8-L15):

```typescript
export interface AIResponse {
  message: string;
  intent: string;
  parameters: any;
  toolResult: ToolExecutionResult | null;
  structuredData?: any;
  aiExplanation?: string;
}
```

> [!IMPORTANT]
> In the source codebase, `structuredData?: any` is declared untyped (`any`). There is no exported `StructuredData` TypeScript interface. The schema in Section 9.2 below represents the **inferred runtime view model structure** dynamically constructed by `buildStructuredResponse()`.

### 9.2 Inferred Runtime View Model Schema (`structuredData`)
Constructed by `buildStructuredResponse()` ([`backend/src/ai/orchestrator.ts#L3135-L4168`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/ai/orchestrator.ts#L3135)):

```typescript
// Inferred runtime shape produced by buildStructuredResponse()
interface InferredStructuredData {
  title: string;
  summary: string;
  keyFindings: string[];
  riskHighlights: string[];
  table: {
    columns: Array<{
      key: string;
      label: string;
      type?: 'text' | 'badge' | 'action' | 'chips' | 'numeric';
      sortable?: boolean;
    }>;
    rows: Array<Record<string, any>>;
    emptyMessage?: string;
  } | null;
  actions: Array<{
    label: string;
    actionType: 'NAVIGATE' | 'FILTER' | 'EXPORT' | 'MODAL';
    params: Record<string, any>;
  }>;
  isAiInvestigation: boolean;
  briefingRaw: any | null;
  role: { name: string; code: string; category: string } | null;
  privilegeSummary: any | null;
  summaryMeta: any | null;
  user: any | null;
  metadata: {
    source: string;
    retrievedAt: string;
    totalCount: number;
    matchingCount: number;
  };
}
```

---

## 10. Tool Execution Result Interface (`ToolExecutionResult`)

Declared in [`backend/src/tools/index.ts#L26-L36`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/tools/index.ts#L26-L36):

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

---

## 11. Error Responses and HTTP Status Codes

| Status Code | Reason / Condition | Error Response Payload Shape | Source Location |
| :--- | :--- | :--- | :--- |
| **400 Bad Request** | `message` missing, null, or empty string `""` | `{ "error": "Message is required" }` | [`backend/src/routes/api.ts#L1740`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L1740) |
| **401 Unauthorized** | Missing or malformed `Authorization` header | `{ "success": false, "message": "Authentication required. Missing or malformed token." }` | [`backend/src/routes/api.ts#L66`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L66) |
| **401 Unauthorized** | Session token expired | `{ "code": "SESSION_EXPIRED", "message": "Your session has expired. Please log in again." }` | [`backend/src/routes/api.ts#L75-L78`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L75-L78) |
| **401 Unauthorized** | Session token not found or invalid | `{ "success": false, "code": "SESSION_NOT_FOUND", "message": "Session expired or invalid. Please sign in again." }` | [`backend/src/routes/api.ts#L80-L84`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L80-L84), [`authService.ts#L1072`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/services/authService.ts#L1072) |
| **401 Unauthorized** | Unexpected session validation error | `{ "success": false, "code": "AUTH_ERROR", "message": "Session validation error: <details>" }` | [`backend/src/routes/api.ts#L98-L102`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L98-L102) |
| **403 Forbidden** | `AUDIT_SUPERVISOR` role attempted Ask Veyra | `{ "success": false, "code": "FORBIDDEN", "message": "Access denied. Audit Supervisor does not have privilege to access Ask Veyra." }` | [`backend/src/routes/api.ts#L162-L166`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L162-L166) |
| **403 Forbidden** | Role lacks `ASK_VEYRA` permission and is not admin | `{ "success": false, "code": "FORBIDDEN", "message": "Access denied. Ask Veyra privileges required." }` | [`backend/src/routes/api.ts#L173-L177`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L173-L177) |
| **500 Internal Server Error**| Unhandled exception during orchestration | `{ "error": "AI Orchestration failed", "details": "<exception message>" }` | [`backend/src/routes/api.ts#L1805`](file:///c:/Users/Sravanth.claaps/Oracle-rmc/backend/src/routes/api.ts#L1805) |

---

## 12. Sanitized Request Examples

### Example 1: Standard Query with Only `message` `[Actual Runtime Capture - Sanitized]`
```http
POST /api/chat HTTP/1.1
Host: 127.0.0.1:5000
Content-Type: application/json
Authorization: Bearer <SANITIZED_SESSION_TOKEN>

{
  "message": "give me count of users without roles"
}
```

### Example 2: Contextual Follow-up Query with `message` and `context` `[Actual Runtime Capture - Sanitized]`
```http
POST /api/chat HTTP/1.1
Host: 127.0.0.1:5000
Content-Type: application/json
Authorization: Bearer <SANITIZED_SESSION_TOKEN>

{
  "message": "what are its privileges?",
  "context": {
    "entityType": "ROLE",
    "entityName": "IT Security Manager",
    "entityId": "ORA_IT_SEC_MGR",
    "currentView": "ROLE_CATALOG"
  }
}
```

### Example 3: User Detail Inquiry with `context` `[Illustrative Schema Example]`
```http
POST /api/chat HTTP/1.1
Host: 127.0.0.1:5000
Content-Type: application/json
Authorization: Bearer <SANITIZED_SESSION_TOKEN>

{
  "message": "Show their assigned roles",
  "context": {
    "entityType": "USER",
    "entityName": "Sample User",
    "entityId": "SAMPLE_USER",
    "currentView": "USERS_DIRECTORY"
  }
}
```

---

## 13. Sanitized Response Examples

### Example 1: Successful Factual Security Statistics Response `[Actual Runtime Capture - Sanitized]` (HTTP 200)
```json
{
  "message": "Users Without Assigned Roles: **2,046**\n\n**Additional Breakdown:**\n• Share of total users: **2,046 out of 3,058 users** (66.9%)\n• Users with Active Roles: **1,012** users\n• Governance Posture: Unassigned accounts retained for audit history or pending entitlement provisioning",
  "intent": "SECURITY_STATISTICS",
  "parameters": {
    "targetMetric": "USERS_WITHOUT_ROLES"
  },
  "toolResult": {
    "tool": "SECURITY_STATISTICS",
    "parameters": {
      "targetMetric": "USERS_WITHOUT_ROLES"
    },
    "dataSource": "PostgreSQL Authoritative Database",
    "timestamp": "2026-11-04T11:04:51.100Z",
    "success": true,
    "data": {
      "metric": "USERS_WITHOUT_ROLES",
      "count": 2046,
      "totalUsers": 3058
    },
    "integrationRequired": false,
    "ambiguous": false
  },
  "structuredData": {
    "title": "Users Without Assigned Roles",
    "summary": "Users Without Assigned Roles: **2,046**...",
    "keyFindings": [
      "2,046 user identities (66.9% of user base) have zero assigned security roles.",
      "Identities remain registered in directory without active system entitlements."
    ],
    "riskHighlights": [],
    "table": {
      "columns": [
        { "key": "metric", "label": "Governance Metric" },
        { "key": "count", "label": "Count" },
        { "key": "share", "label": "Share (%)" }
      ],
      "rows": [
        { "metric": "Users Without Roles", "count": 2046, "share": "66.9%" },
        { "metric": "Users With Assigned Roles", "count": 1012, "share": "33.1%" }
      ]
    },
    "actions": [
      { "label": "View User Directory", "actionType": "NAVIGATE", "params": { "page": "users" } }
    ],
    "isAiInvestigation": false,
    "briefingRaw": null,
    "role": null,
    "privilegeSummary": null,
    "summaryMeta": null,
    "user": null,
    "metadata": {
      "source": "PostgreSQL Authoritative Database",
      "retrievedAt": "04:34 PM",
      "totalCount": 2046,
      "matchingCount": 2046
    }
  },
  "aiExplanation": "Detected request for count of users without any assigned roles."
}
```

### Example 2: Contextual Privilege Resolution Response `[Actual Runtime Capture - Sanitized]` (HTTP 200)
```json
{
  "message": "Role **IT Security Manager** possesses **69** access privileges, allowing operations such as: Administer Student Group, Apply HCM Role Provisioning Rules, Assign Oracle Fusion General Ledger Data Access Set Definition.",
  "intent": "ROLE_PRIVILEGES",
  "parameters": {
    "roleName": "IT Security Manager"
  },
  "toolResult": {
    "tool": "getPrivilegesForRole",
    "parameters": {
      "roleName": "IT Security Manager"
    },
    "dataSource": "PostgreSQL Authoritative Database",
    "timestamp": "2026-11-04T11:04:52.200Z",
    "success": true,
    "data": {
      "roleName": "IT Security Manager",
      "roleCode": "ORA_IT_SECURITY_MANAGER_JOB",
      "privilegeCount": 69,
      "privileges": [
        "Administer Student Group",
        "Apply HCM Role Provisioning Rules",
        "Assign Oracle Fusion General Ledger Data Access Set Definition"
      ]
    },
    "integrationRequired": false,
    "ambiguous": false
  },
  "structuredData": {
    "title": "Role Privileges: IT Security Manager",
    "summary": "Role **IT Security Manager** possesses **69** access privileges...",
    "keyFindings": [
      "Total assigned functional privileges: 69."
    ],
    "riskHighlights": [],
    "table": {
      "columns": [
        { "key": "privilegeName", "label": "Privilege Name" }
      ],
      "rows": [
        { "privilegeName": "Administer Student Group" },
        { "privilegeName": "Apply HCM Role Provisioning Rules" },
        { "privilegeName": "Assign Oracle Fusion General Ledger Data Access Set Definition" }
      ]
    },
    "actions": [
      { "label": "View Role in Catalog", "actionType": "NAVIGATE", "params": { "page": "roles", "role": "IT Security Manager" } }
    ],
    "isAiInvestigation": false,
    "briefingRaw": null,
    "role": {
      "name": "IT Security Manager",
      "code": "ORA_IT_SECURITY_MANAGER_JOB",
      "category": "Job"
    },
    "privilegeSummary": null,
    "summaryMeta": null,
    "user": null,
    "metadata": {
      "source": "PostgreSQL Authoritative Database",
      "retrievedAt": "04:34 PM",
      "totalCount": 69,
      "matchingCount": 69
    }
  },
  "aiExplanation": "Detected request for privileges assigned to \"IT Security Manager\"."
}
```

### Example 3: Entity Not Found in Tool Result `[Actual Runtime Capture - Sanitized]` (HTTP 200)
```json
{
  "message": "User **non_existent_user_99999** was not found in PostgreSQL Authoritative Database.",
  "intent": "GET_USER",
  "parameters": {
    "userId": "non_existent_user_99999"
  },
  "toolResult": {
    "tool": "getUser",
    "parameters": {
      "userId": "non_existent_user_99999"
    },
    "dataSource": "PostgreSQL Authoritative Database",
    "timestamp": "2026-11-04T11:04:54.000Z",
    "success": true,
    "data": {
      "message": "User \"non_existent_user_99999\" was not found."
    },
    "integrationRequired": false,
    "ambiguous": false
  },
  "aiExplanation": "Detected request for details of user non_existent_user_99999."
}
```

---

## 14. Controlled Runtime Verification Evidence

### 14.1 Test Environment & Harness Setup
- **Operating System**: Windows 11 (win32 10.0.26100)
- **Node.js Version**: v25.0.0
- **TypeScript Runner**: tsx v4.7.1
- **Database**: Local PostgreSQL instance with 26 discovered tables, seeded control incidents, and 4,713 authoritative roles
- **Test Server Execution Command**:
  ```powershell
  npx tsx scratch/test_contract_runtime.ts
  ```
- **Harness Details**: The harness instantiates an Express app mounting `apiRouter` on port `5099`, authenticates test personas via `authService.login()`, and dispatches HTTP requests via `http.request`.

### 14.2 Execution Evidence Log Summary

```text
[Test Harness] Server listening at http://127.0.0.1:5099
=== Step 1: Authenticate users for test sessions ===
Admin session established: true role: SITE_ADMIN
Supervisor session established: true role: AUDIT_SUPERVISOR
Audit user session established: true role: AUDIT_USER

=== Scenario 1: Missing Authorization Header ===
Status: 401 Body: { success: false, message: 'Authentication required. Missing or malformed token.' }

=== Scenario 2: Malformed Authorization Header ===
Status: 401 Body: { success: false, message: 'Authentication required. Missing or malformed token.' }

=== Scenario 3: Invalid / Expired Token ===
Status: 401 Body: { success: false, code: 'SESSION_NOT_FOUND', message: 'Session expired or invalid. Please sign in again.' }

=== Scenario 4: Unauthorized Role (AUDIT_SUPERVISOR) ===
Status: 403 Body: { success: false, code: 'FORBIDDEN', message: 'Access denied. Audit Supervisor does not have privilege to access Ask Veyra.' }

=== Scenario 5: Unauthorized Role without ASK_VEYRA (AUDIT_USER) ===
Status: 403 Body: { success: false, code: 'FORBIDDEN', message: 'Access denied. Ask Veyra privileges required.' }

=== Scenario 6: Missing message field ===
Status: 400 Body: { error: 'Message is required' }

=== Scenario 7: Null message ===
Status: 400 Body: { error: 'Message is required' }

=== Scenario 8: Empty string message ===
Status: 400 Body: { error: 'Message is required' }

=== Scenario 9: Whitespace-only message ===
Status: 200 Intent: UNIVERSAL_DATABASE_QUERY Success: false

=== Scenario 10: Valid request with only message ===
Status: 200 Intent: SECURITY_STATISTICS Tool: SECURITY_STATISTICS

=== Scenario 11: Valid request with message and context ===
Status: 200 Intent: ROLE_PRIVILEGES Parameters: { roleName: 'IT Security Manager' }

=== Scenario 12: Tool execution with non-existent entity ===
Status: 200 Intent: GET_USER ToolResult.data: { message: 'User "non_existent_user_99999" was not found.' }

=== Scenario 13: Request with extra unrecognized fields ===
Status: 200 Intent: SECURITY_STATISTICS Accepted without 400: true
```

### 14.3 Verification Results Matrix

| Scenario # | Test Description | Input Payload / Header | Actual HTTP Status | Actual Response Body Structure | Verification Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **RT-1** | Missing Authorization header | No `Authorization` header, `{ "message": "List users" }` | **401 Unauthorized** | `{ "success": false, "message": "Authentication required. Missing or malformed token." }` | **VERIFIED (Runtime)** |
| **RT-2** | Malformed Authorization header | `Authorization: Basic invalid_creds` | **401 Unauthorized** | `{ "success": false, "message": "Authentication required. Missing or malformed token." }` | **VERIFIED (Runtime)** |
| **RT-3** | Invalid / expired session token | `Authorization: Bearer invalid_token_9999` | **401 Unauthorized** | `{ "success": false, "code": "SESSION_NOT_FOUND", "message": "Session expired or invalid. Please sign in again." }` | **VERIFIED (Runtime)** |
| **RT-4** | Unauthorized role: `AUDIT_SUPERVISOR` | Bearer token for `supervisor.user@claaps.com` | **403 Forbidden** | `{ "success": false, "code": "FORBIDDEN", "message": "Access denied. Audit Supervisor does not have privilege to access Ask Veyra." }` | **VERIFIED (Runtime)** |
| **RT-5** | Unauthorized role without `ASK_VEYRA` | Bearer token for `audit.user@claaps.com` (`AUDIT_USER`) | **403 Forbidden** | `{ "success": false, "code": "FORBIDDEN", "message": "Access denied. Ask Veyra privileges required." }` | **VERIFIED (Runtime)** |
| **RT-6** | Missing `message` property | `{}` with valid `SITE_ADMIN` token | **400 Bad Request** | `{ "error": "Message is required" }` | **VERIFIED (Runtime)** |
| **RT-7** | Null `message` property | `{ "message": null }` with valid token | **400 Bad Request** | `{ "error": "Message is required" }` | **VERIFIED (Runtime)** |
| **RT-8** | Empty string `message` | `{ "message": "" }` with valid token | **400 Bad Request** | `{ "error": "Message is required" }` | **VERIFIED (Runtime)** |
| **RT-9** | Whitespace-only `message` | `{ "message": "    " }` with valid token | **200 OK** | Evaluates as truthy, bypasses 400 guard, routes to Universal Database engine, returns clarification query with `intent: 'UNIVERSAL_DATABASE_QUERY'`. | **VERIFIED (Runtime)** |
| **RT-10**| Valid query with only `message` | `{ "message": "give me count of users without roles" }` | **200 OK** | Full `AIResponse` with `intent: 'SECURITY_STATISTICS'`, `toolResult.success: true`, and populated `structuredData`. | **VERIFIED (Runtime)** |
| **RT-11**| Valid query with `message` and `context` | `{ "message": "what are its privileges?", "context": { "entityType": "ROLE", "entityName": "IT Security Manager" } }` | **200 OK** | Full `AIResponse` with `intent: 'ROLE_PRIVILEGES'`, parameters `{ "roleName": "IT Security Manager" }`. Pronoun `"its"` correctly resolved. | **VERIFIED (Runtime)** |
| **RT-12**| Non-existent entity lookup | `{ "message": "who is NON_EXISTENT_USER_99999" }` | **200 OK** | `AIResponse` returned with `toolResult.success: true`, `data.notFound: true`, and user-friendly explanation. | **VERIFIED (Runtime)** |
| **RT-13**| Extra unrecognized fields | `{ "message": "...", "extraField": "ignored", "dummy": 123 }` | **200 OK** | Extra properties silently ignored. Response generated normally. | **VERIFIED (Runtime)** |

---

## 15. Known Gaps and Discrepancies

| Gap ID | Item | Implementation Reality | Impact / Risk | Alignment Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **GAP-1** | Whitespace-only `message` validation | `backend/src/routes/api.ts#L1739` checks `if (!message)`. In JS, `"   "` is truthy and passes to the orchestrator, incurring LLM/database round-trips. | Waste of downstream inference latency for whitespace queries. | Recommendation: update check to `if (!message \|\| !message.trim())` in future refactor story. |
| **GAP-2** | Frontend omits `context` parameter | `Assistant.tsx#L436` calls `api.sendMessage(text)` without `context`, even though `api.sendMessage` supports `context` and the backend orchestrator utilizes it. | Contextual pronoun queries (`"who has this role?"`) sent from general input cannot resolve entity context until UI passes active context. | Story VEYRA-102 should pass active table/card context to `handleSend`. |
| **GAP-3** | `aiExplanation` dropped by Frontend UI | Backend emits `aiExplanation: intentData.explanation` in `AIResponse`, but `Assistant.tsx#L442-L450` discards it when building the UI `Message` object. | Harmless, but unused network payload bytes. | Keep field for debugging/auditing; document as ignored in UI. |
| **GAP-4** | Inconsistent 401 error schema | Missing header returns `{ success: false, message: ... }`. Expired token returns `{ code: "SESSION_EXPIRED", message: ... }`. Invalid token returns `{ success: false, code: "SESSION_NOT_FOUND", message: ... }`. | Frontend `apiRequest` has to check `code \|\| error_code \|\| message`. | Contract consumers must handle both `{ code }` and `{ success: false }` shapes. |
| **GAP-5** | HTTP 500 error schema | On uncaught orchestrator exception, backend returns `{ "error": "AI Orchestration failed", "details": string }`, rather than an `AIResponse` shape. | Frontend catch block surfaces generic network error. | Document error shape as distinct from `AIResponse`. |

---

## 16. Source File References and Line Numbers

| Component / Responsibility | File Path | Verified Line Range |
| :--- | :--- | :--- |
| Express App Mounting & Route Registration | `backend/src/index.ts` | Lines 25, 60 |
| `POST /api/chat` Route Handler | `backend/src/routes/api.ts` | Lines 1735–1807 |
| `requireAuth` Middleware | `backend/src/routes/api.ts` | Lines 62–104 |
| `requireAskVeyra` Authorization Middleware | `backend/src/routes/api.ts` | Lines 154–179 |
| `AIResponse` Interface | `backend/src/ai/orchestrator.ts` | Lines 8–15 |
| Pronoun & Context Entity Resolution (`fallbackNLU`) | `backend/src/ai/orchestrator.ts` | Lines 25–50, 1201, 1316, 1499, 1534 |
| `processUserMessage` Pipeline Coordinator | `backend/src/ai/orchestrator.ts` | Lines 2298–3132 |
| Context Prompt Interpolation | `backend/src/ai/orchestrator.ts` | Lines 2302–2313 |
| `buildStructuredResponse` View Model Formatter | `backend/src/ai/orchestrator.ts` | Lines 3135–4169 |
| `ToolExecutionResult` Interface & Factory | `backend/src/tools/index.ts` | Lines 26–51 |
| Frontend `getActiveAuthToken` & Investigation Bridge | `frontend/src/services/api.ts` | Lines 5–39, 59–71 |
| Frontend `apiRequest` Transport & Error Handling | `frontend/src/services/api.ts` | Lines 124–197 |
| Frontend `api.sendMessage` Method | `frontend/src/services/api.ts` | Lines 245–250 |
| Frontend `handleSend` & Response State Assignment | `frontend/src/pages/Assistant.tsx` | Lines 420–469, 485–505 |
| Backend Session Store & Validation | `backend/src/services/authService.ts` | Lines 1000–1100 |
| Universal Database Chatbot Session Context | `backend/src/services/universalDatabaseChatbotService.ts` | Lines 20–75 |
