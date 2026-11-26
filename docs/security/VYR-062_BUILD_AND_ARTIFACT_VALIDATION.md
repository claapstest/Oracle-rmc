# VYR-062: AI-Enabled & AI-Free Build and Deployment Artifact Validation

- **Story ID:** `VYR-062`
- **Epic:** `EPIC 7 — Security, branch, regression and release testing`
- **Branches Validated:**
  - `standard-veyra-application-dev` (AI-Free variant)
  - `veyra-application-dev` (AI-Enabled variant)
- **Verification Script:** `backend/scripts/test_story_062_builds_and_artifacts.cjs` (`npm --prefix backend run test:vyr62`)

---

## 1. Acceptance Criteria & Product Split Matrix

| Criterion | AI-Free Artifact (`standard-veyra-application-dev`) | AI-Enabled Artifact (`veyra-application-dev`) |
| :--- | :--- | :--- |
| **Frontend Bundle (`frontend/dist`)** | Built cleanly from `src/` with zero `Assistant.tsx`, zero `sendMessage()`, zero chatbot CSS/labels, and zero LLM provider URLs. | Retains `Assistant.tsx`, `sendMessage()`, and AskVeyra navigation/RBAC guards. |
| **Backend Dependencies (`package.json`, lockfiles, `node_modules`)** | Zero `@google/generative-ai`, `openai`, `groq-sdk`, `together-ai`, or `node-sql-parser` packages. | Retains `@google/generative-ai` and `node-sql-parser`. |
| **Backend Compiled Modules & Routes (`backend/dist`)** | `backend/dist/ai/` and `backend/dist/tools/` absent; `apiRouter.stack` has zero `/chat`, `/ai/*`, or `/database/*` routes; `requireAskVeyra` removed. | `backend/dist/ai/orchestrator.js`, `responseComposer.js`, and `tools/index.js` compiled; `POST /api/chat` protected by `requireAskVeyra`. |
| **Environment & Secrets** | `.env.example` and `backend/dist/config.js` require zero AI credentials; `validateStartupConfig()` passes with all AI env vars unset. | Supports AI env keys while falling back gracefully to local rule-based NLU if LLM keys are omitted. |
| **Independent Deployment** | `Dockerfile`, `nixpacks.toml`, `railway.json`, `railpack.json`, and `index.js` boot `/health`, `/api/*`, and `frontend/dist` SPA independently. | Identical deployment topology (`node index.js` / `/health`) serving `frontend/dist` + AskVeyra endpoints independently. |

---

## 2. Clean Build & Artifact Validation Results

Executed via `node backend/scripts/test_story_062_builds_and_artifacts.cjs --clean-build` on `standard-veyra-application-dev` and clean `tsc` + `vite build` + `test_story_062_builds_and_artifacts.cjs` on `veyra-application-dev` in an isolated worktree:

| Verification Gate | `standard-veyra-application-dev` (AI-Free) | `veyra-application-dev` (AI-Enabled) |
| :--- | :--- | :--- |
| Backend Clean Build (`tsc`) | **PASS** (0 errors; `ai/` and `tools/` absent) | **PASS** (0 errors; `ai/orchestrator.js`, `ai/responseComposer.js`, `tools/index.js` compiled) |
| Frontend Clean Build (`vite build` / `tsc -b`) | **PASS** (`tsc -b && vite build` 0 errors, 1,520 modules, 4 JS + 1 CSS bundle) | **PASS** (`vite build` 1,521 modules, 1,249.1 KB JS); note pre-existing `tsc -b` `TS2339` at `frontend/src/components/AdvancedControlsModule.tsx:2093` |
| Frontend Bundle Secret & AI Scan | **PASS** (0 secrets; 0 AskVeyra/chatbot/LLM UI or API strings) | **PASS** (0 secrets; retains Ask VEYRA UI & `/chat` client) |
| Dependencies & Lockfiles Audit | **PASS** (0 AI packages in `package.json`, `package-lock.json`, `node_modules`) | **PASS** (retains `@google/generative-ai` & `node-sql-parser` in `backend/package.json`) |
| Express Router & Middleware Audit | **PASS** (0 `/chat`, `/ai/*`, `/database/*` routes; `requireAskVeyra` absent) | **PASS** (`POST /chat`, `POST /ai/universal-query`, `GET /database/schema`, `requireAskVeyra` active) |
| Startup Config Without AI Secrets | **PASS** (`.env.example` & `config.js` free of AI vars; `validateStartupConfig` passes) | **PASS** (`validateStartupConfig` passes with local NLU fallback) |
| Standalone Production Serving (`/`, `/health`, `/api/health`, `/api/auth/config`) | **PASS** (serves compiled SPA + API independently) | **PASS** (serves compiled SPA + API independently) |
| Variant Runtime Behavior | **PASS** (`/api/chat` returns `404` for all roles) | **PASS** (`POST /api/chat` enforces `401` unauth, `403` Supervisor/User, `200` Audit Manager, no hash leak on probe) |
| **VYR-062 Suite Total** | **PASS (`50 / 50` assertions)** | **PASS (`45 / 45` assertions)** |
