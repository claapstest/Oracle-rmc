# Ask VEYRA Chatbot Removal & Dual-Branch Pre-Removal Inventory

**Jira Story:** AI-Enabled and AI-Free Branch Creation & Chatbot Code Removal  
**Target Branches:**  
- **AI-Enabled Branch:** `veyra-application-dev` / `veyra-application-101` (Retains complete AI capability)  
- **AI-Free Branch:** `standard-veyra-application-dev` (Purged of all AI code, models, and endpoints)  
**Status:** Audit & Pre-Removal Inventory Phase (No code deleted until review sign-off)  
**Classification Schema:**  
- 🔴 **`[AI-Only]`**: Component exists solely for the Ask VEYRA chatbot / LLM pipeline. Safe to delete or purge on the AI-free branch.  
- 🟡 **`[Shared]`**: Utility, component, or configuration used by non-AI features. **Must remain**, with AI references cleanly decoupled.  
- ⚪ **`[Uncertain]`**: Requires stakeholder / architectural sign-off before deletion.  

---

## 1. Frontend Layer Inventory

| File / Symbol | Location / Lines | Classification | Current Role & Usage | Removal / Decoupling Action on AI-Free Branch |
|---|---|---|---|---|
| `frontend/src/pages/Assistant.tsx` | Entire file (~2,140 lines) | 🔴 **AI-Only** | Full Ask VEYRA chatbot UI, query input, conversation history, card renderers. | **Delete file entirely.** |
| `frontend/src/test/assistant_consumption.test.ts` | Entire file (~400 lines) | 🔴 **AI-Only** | Verification test suite for frontend chatbot response consumption. | **Delete file entirely.** |
| `frontend/src/App.tsx` (Import & Route) | L28, L1250–L1258 | 🟡 **Shared** | Imports `Assistant` and renders `<Assistant ... />` when `currentPage === 'assistant'`. | **Remove import** and conditional JSX block. |
| `frontend/src/App.tsx` (Navigation Menu) | L64, L76, L776 | 🟡 **Shared** | Sidebar item `{ id: 'assistant', label: 'Ask VEYRA', icon: MessageSquareCode }`. | **Remove menu entry** and page title map entry. |
| `frontend/src/App.tsx` (RBAC & Back Nav) | L121, L136, L332, L358, L369, L379, L586, L700, L973–L975 | 🟡 **Shared** | Checks `canAccessPage('assistant')`, stores active page, handles back navigation from investigation. | **Remove `assistant` checks** and default fallback page references. |
| `frontend/src/pages/Dashboard.tsx` (Hero Banner Card) | L881–L904 | 🟡 **Shared** | `{can('assistant') ? (<button ...>Ask VEYRA</button>) : can('audit') ...}`. | **Remove Ask VEYRA button block**; retain fallback to audit/standard pages. |
| `frontend/src/pages/InvestigationWorkspace.tsx` | L576–L585 | 🟡 **Shared** | Navigation breadcrumb button returning to `'assistant'`. | **Remove or redirect** back-button target to Dashboard / Audit. |
| `frontend/src/pages/FullInvestigationView.tsx` | L162, L177, L265, L307, L324, L337 | 🟡 **Shared** | References `sourcePage: 'assistant'`, labels "Return to Assistant", "Ask VEYRA Investigation". | **Decouple labels**; replace with generic "Return to Previous Page" and default investigation title. |
| `frontend/src/pages/Settings.tsx` (LLM Config) | L525–L581 | 🟡 **Shared** | "AI Language Model Configuration" section, Together AI model selector dropdown, status badge. | **Remove AI config panel**; retain all Oracle Fusion credentials and connection settings. |
| `frontend/src/services/api.ts` (`sendMessage`) | L244–L250 | 🟡 **Shared** | `sendMessage(message, context)` posting to `/chat`. | **Remove `sendMessage` method**; retain all other API client endpoints (`/users`, `/roles`, `/reports`, etc.). |
| `frontend/src/utils/authorization.ts` & `authorization.check.ts` | L14 / L13 | 🟡 **Shared** | Maps `assistant: ['ASK_VEYRA']` route privilege. | **Remove `assistant` entry** from route permissions object. |
| `frontend/src/index.css` | L838, L1373 | 🟡 **Shared** | CSS rules for `.assistant-hero-*`, `.assistant-search-box`, `.assistant-categories-grid`. | **Purge unused chatbot CSS selectors** to reduce bundle size. |

---

## 2. Backend Routes, Middleware & Endpoints

| File / Route / Symbol | Location / Lines | Classification | Current Role & Usage | Removal / Decoupling Action on AI-Free Branch |
|---|---|---|---|---|
| `POST /api/chat` | `backend/src/routes/api.ts` (L1735–L1807) | 🔴 **AI-Only** | Primary Ask VEYRA conversational entry point; calls `orchestrator.processUserMessage`. | **Delete route handler entirely.** |
| `requireAskVeyra` | `backend/src/routes/api.ts` (L154–L179) | 🔴 **AI-Only** | Middleware checking `role !== AUDIT_SUPERVISOR` and requiring `ASK_VEYRA` or `ALL`. | **Delete middleware function.** |
| `POST /api/ai/universal-query` | `backend/src/routes/api.ts` (L1848–L1859) | 🔴 **AI-Only** | Experimental universal database query endpoint delegating to `universalDatabaseChatbotService`. | **Delete route handler.** |
| `GET /api/ai/universal-traces` | `backend/src/routes/api.ts` (L1838–L1846) | 🔴 **AI-Only** | Retrieves observability traces from `observabilityTraceService`. | **Delete route handler.** |
| `GET /api/database/schema`, `POST /refresh`, `GET /relationships` | `backend/src/routes/api.ts` (L1810–L1836) | ⚪ **Uncertain** | Metadata discovery endpoints used by Text-to-SQL engine. Not currently invoked by frontend UI. | **Review with team:** Delete if purely AI Text-to-SQL support; retain only if needed for general admin DB inspector. |
| `GET /api/settings` & `POST /api/settings` | `backend/src/routes/api.ts` (L667–L669, L719, L748–L750, L768–L770) | 🟡 **Shared** | Exposes and persists `hasGeminiKey`, `groqModel`, and Together model settings. | **Strip AI properties** (`groqModel`, `hasGeminiKey`) from request/response payloads; preserve Oracle settings. |
| Unused `import { tools }` | `backend/src/routes/api.ts` L9 | 🟡 **Shared** | Dead import from `../tools/index.js`. | **Remove dead import.** |
| `requireAuth` | `backend/src/routes/api.ts` L105 | 🟡 **Shared** | Session token validator for all authenticated endpoints. | **RETAIN UNCHANGED** (Used by all core API endpoints). |
| `apiRouter.get('/capabilities')` | `backend/src/routes/api.ts` L797–L809 | 🟡 **Shared** | Demo mode feature flags (users, roles, audit, sod). | **RETAIN UNCHANGED** (Standard platform capability flags). |

---

## 3. Backend AI Orchestration, Services & Tools

| Module / File | Size | Classification | Internal Dependencies | Action on AI-Free Branch |
|---|---|---|---|---|
| `backend/src/ai/orchestrator.ts` | 196 KB | 🔴 **AI-Only** | `TOOLS_REGISTRY`, `universalDatabaseChatbotService`, Together AI completions, rule engine. | **Delete file entirely.** |
| `backend/src/ai/responseComposer.ts` | 45 KB | 🔴 **AI-Only** | Formats `structuredData` card view models for chatbot. | **Delete file entirely.** |
| `backend/src/tools/index.ts` | 111 KB | 🔴 **AI-Only** | Tool execution wrappers (`TOOLS_REGISTRY`) adapting backend services for AI consumption. | **Delete file entirely.** (Backend services like `oracleService`, `auditRawDbService` remain intact). |
| `backend/src/services/universalDatabaseChatbotService.ts` | 9.1 KB | 🔴 **AI-Only** | Universal natural-language to SQL coordinator. | **Delete file entirely.** |
| `backend/src/services/groundedAnswerService.ts` | 11.7 KB | 🔴 **AI-Only** | LLM synthesis of SQL rows into grounded explanations. | **Delete file entirely.** |
| `backend/src/services/textToSqlService.ts` | 9.6 KB | 🔴 **AI-Only** | LLM / AST SQL generator for natural language queries. | **Delete file entirely.** |
| `backend/src/services/certificateHybridRagService.ts` | 26.1 KB | 🔴 **AI-Only** | Hybrid semantic vector + keyword RAG for access certs. | **Delete file entirely.** |
| `backend/src/services/conversationContextService.ts` | 3.0 KB | 🔴 **AI-Only** | Chat session multi-turn context tracking. | **Delete file entirely.** |
| `backend/src/services/observabilityTraceService.ts` | 2.1 KB | 🔴 **AI-Only** | Observability logging for LLM prompts and executions. | **Delete file entirely.** |
| `backend/src/services/resultVerificationService.ts` | 3.8 KB | 🔴 **AI-Only** | Hallucination and output guardrail verification. | **Delete file entirely.** |
| `backend/src/services/schemaDiscoveryService.ts` | 6.7 KB | ⚪ **Uncertain** | Database catalog schema reflector. | **Review:** If solely used by Text-to-SQL, delete. |
| `backend/src/services/schemaLinkingService.ts` | 6.1 KB | ⚪ **Uncertain** | Schema linking for Text-to-SQL prompts. | **Review:** If solely used by Text-to-SQL, delete. |
| `backend/src/services/sourceRoutingService.ts` | 2.9 KB | ⚪ **Uncertain** | Heuristic routing between Oracle Live and PostgreSQL. | **Review:** If solely used by chatbot query planner, delete. |
| `backend/src/services/sqlValidatorService.ts` | 5.4 KB | ⚪ **Uncertain** | AST SQL injection / safety validator (uses `node-sql-parser`). | **Review:** If raw SQL execution is removed, delete. |

---

## 4. Shared Backend Services (Must Remain Intact)

The following services provide core Oracle RMC business logic, reporting, and RBAC functionality. **They are Shared and must NOT be removed**:

| Module / File | Shared Usage Across Platform | Action Required |
|---|---|---|
| `backend/src/services/oracleService.ts` | Core Oracle Fusion SCIM, REST, and BIP client. Used by Users, Roles, Controls, and Sync. | **RETAIN IN FULL.** |
| `backend/src/services/authService.ts` | Manages authentication, session tokens, password hashing, and user permissions. | **RETAIN.** (Unused dead reference to `priv_ask_veyra` can be deprecated cleanly without breaking role structures). |
| `backend/src/services/auditDashboardService.ts` | Backing service for Audit Manager Dashboard (`GET /api/dashboard/audit-manager`). | **RETAIN.** Remove dead import `import { tools }` and simplify `authorizedModules` / `hasAskVeyraAccess` flags. |
| `backend/src/services/controlCatalogService.ts` & `controlRawDbService.ts` | Advanced Controls (SoD) catalog, rules, and incident tracking. | **RETAIN IN FULL.** |
| `backend/src/services/auditRawDbService.ts` & `auditService.ts` | Audit trail events, timeline, and DB persistence. | **RETAIN IN FULL.** |
| `backend/src/services/reportDbService.ts` & `userAccessReportService.ts` | Scheduled and ad-hoc compliance report generation. | **RETAIN IN FULL.** |
| `backend/src/services/roleHierarchyService.ts` | Role hierarchy tree expansion and privilege inheritance. | **RETAIN IN FULL.** |
| `backend/src/services/scheduledSyncService.ts` | Nightly automated synchronization with Oracle Fusion Cloud. | **RETAIN IN FULL.** |
| `backend/src/db.ts` | PostgreSQL connection pool and query helpers. | **RETAIN IN FULL.** |

---

## 5. Configuration, Secrets & Environment Variables

| Variable / Config Key | Location | Classification | Action on AI-Free Branch |
|---|---|---|---|
| `TOGETHER_API_KEY` | `.env`, `.env.example`, `backend/.env` | 🔴 **AI-Only** | Remove from `.env` and `.env.example`. |
| `TOGETHER_MODEL` | `.env`, `.env.example`, `backend/.env` | 🔴 **AI-Only** | Remove from `.env` and `.env.example`. |
| `LLM_ENDPOINT` | `.env`, `.env.example`, `backend/.env` | 🔴 **AI-Only** | Remove from `.env` and `.env.example`. |
| `GROQ_API_KEY`, `GROQ_MODEL` | `.env`, `.env.example`, `backend/.env` | 🔴 **AI-Only** | Remove compatibility aliases. |
| `config.togetherApiKey`, `config.togetherModel`, `config.llmEndpoint`, `config.groqApiKey`, `config.groqModel` | `backend/src/config.ts` (L22–L26, L81–L86, L112–L113, L141–L146) | 🟡 **Shared** | Remove LLM fields from `config` object, persistence logic, and startup console log. Retain Oracle and DB configs. |
| `Dockerfile`, `railway.json`, `railpack.json`, `nixpacks.toml` | Project Root | 🟡 **Shared** | Standard Node.js multi-tier build. **No AI commands exist**; retain unchanged. |

---

## 6. Package Dependencies

| Package | Location | Classification | Justification & Action |
|---|---|---|---|
| `@google/generative-ai` | `backend/package.json` | 🔴 **AI-Only** | Legacy Gemini SDK. Run `npm uninstall @google/generative-ai` in `backend/`. |
| `node-sql-parser` | Root `package.json` & `backend/package.json` | ⚪ **Uncertain / AI-Only** | Used solely by `sqlValidatorService.ts` for AI Text-to-SQL AST parsing. If Text-to-SQL is removed, run `npm uninstall node-sql-parser`. |
| `concurrently`, `axios`, `bcryptjs`, `cors`, `dotenv`, `express`, `pg`, `xlsx`, `xml2js`, `tsx`, `typescript` | Root, backend, frontend | 🟡 **Shared** | Core web framework, utilities, and build toolchain. **RETAIN ALL.** |

---

## 7. Database Migrations & Seeds

| Database Asset | Location | Classification | Architectural Impact & Recommendation |
|---|---|---|---|
| Migration `1711000000017_create_certificate_knowledge_vectors_table.cjs` | `database/migrations/` | ⚪ **Uncertain** | Creates `certificate_knowledge_vector` and pgvector cosine function. **Options:** (A) Keep migration file so migration histories match across branches, but leave table unqueried; OR (B) Create down-migration on AI-free branch. *Recommendation: Option A for schema consistency across shared DB instances.* |
| `ASK_VEYRA` Privilege Seed | `database/src/seeds/rbac_seed.ts` (L6, L52, L110) | 🟡 **Shared** | Seeds `ASK_VEYRA` privilege in `veyra_privilege`. Retain in seed or leave unassigned to prevent DB migration drift. |
| `backend/users_auth.json` | `backend/` | 🟡 **Shared** | Contains local demo user accounts. Safe to leave permissions or remove `ASK_VEYRA` from demo users. |

---

## 8. Test Suites, Scripts & Mocks

| Test File / Script | Location | Classification | Action on AI-Free Branch |
|---|---|---|---|
| `backend/test/chat_contract.test.ts` | Backend test suite | 🔴 **AI-Only** | Delete file. Remove `"test:chat-contract"` script from `package.json`. |
| `backend/test/responseComposer.test.ts` | Backend test suite | 🔴 **AI-Only** | Delete file. Remove `"test:response-composer"` script from `package.json`. |
| `backend/test/capture_chat_fixtures.ts` | Test utility | 🔴 **AI-Only** | Delete file. |
| `backend/test/verify_chat_fixtures.test.ts` | Test suite | 🔴 **AI-Only** | Delete file. |
| `backend/test/contractValidator.ts` | Test helper | 🔴 **AI-Only** | Delete file. |
| `backend/test/fixtures/chat/*` | Fixtures directory | 🔴 **AI-Only** | Delete directory and JSON fixtures. |
| `frontend/src/test/assistant_consumption.test.ts` | Frontend test suite | 🔴 **AI-Only** | Delete file. Remove `"test:frontend-consumption"` script from `package.json`. |
| `backend/scripts/test_user_questions.cjs` | Verification script | 🔴 **AI-Only** | Delete file. |
| `backend/scripts/test_user_spec_questions.cjs` | Verification script | 🔴 **AI-Only** | Delete file. |
| `backend/scripts/test_hybrid_rag_certificate.cjs` | Verification script | 🔴 **AI-Only** | Delete file. |
| `backend/scripts/test_universal_database_chatbot.cjs` | Verification script | 🔴 **AI-Only** | Delete file. |
| `backend/scripts/test_story_*.cjs` (006, 007, 012, 015, 018, 019, 021, 024, 027, 030, etc.) | Backend scripts | 🟡 **Shared** | Non-AI functional and regression test scripts. **RETAIN ALL.** |

