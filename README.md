# Oracle Fusion Security & Risk Intelligence Assistant

An enterprise-grade compliance prototype and conversational assistant. It provides a centralized, natural-language interface for business users, auditors, and managers to query Oracle Fusion Cloud security identities, role catalogs, access privileges, audit trail logs, and GRC risk boundaries.

---

## 🏗️ Architecture & Flow

The application enforces a **Strict Controlled Tool Architecture**. The LLM (Gemini) is used solely for natural language understanding (intent and parameter extraction) and final answer synthesis. It cannot arbitrarily call endpoints or fabricate records.

```text
User Input (Chat UI)
        ↓
AI Orchestrator (NLU Intent & Entity Extraction)
        ↓
Controlled Backend Tool (getUsersByRole, getAuditHistory, etc.)
        ↓
Oracle Service Layer (Environment Check)
       ├── [DEMO Mode] ──→ Offline Mock Database (High-fidelity GRC Schemas)
       └── [LIVE Mode] ──→ OracleFusionClient (Axios REST to SCIM & FSCM APIs)
        ↓
Result Processing (Mappers & Status Wrappers)
        ↓
Response Synthesis (AI business-friendly summary + Structured UI Table rendering)
```

---

## 📁 Repository Structure

*   `backend/` - Node.js + Express + TypeScript API server
    *   `src/index.ts` - Express app server and static router
    *   `src/ai/orchestrator.ts` - Gemini API connection & Fallback NLU parser
    *   `src/oracle/client.ts` - HTTP client for SCIM & FSCM Audit REST APIs
    *   `src/services/oracleService.ts` - Modes coordinator & mapper profiles
    *   `src/tools/index.ts` - Registry matching intents to functions
*   `frontend/` - React + Vite + TypeScript Client App
    *   `src/index.css` - Custom enterprise design system (Deep Slate & Gold theme, glassmorphism, responsive styles)
    *   `src/App.tsx` - App session coordinator & sidebar router
    *   `src/pages/` - Login, Overview Dashboard, AI Assistant, Users grid, Roles browser, Audit logs, Risk charts, and API Settings
*   `api_mapping.md` - Business Questions to REST Endpoints mapping sheet
*   `.env` - Core configuration settings

---

## 🛠️ Quick Start

### 1. Prerequisites
Install [Node.js](https://nodejs.org/) (v18 or higher recommended).

### 2. Install Dependencies
Run the installation command from the repository root to configure the root workspace, backend, and frontend directories concurrently:
```bash
npm run install:all
```

### 3. Environment Variables (`.env`)
Create a `.env` file in the root workspace (automatically scaffolded by default):
```env
PORT=5000
ENVIRONMENT_MODE=DEMO
GEMINI_API_KEY=your_gemini_api_key_here
ORACLE_FUSION_BASE_URL=
ORACLE_AUTH_TYPE=BASIC
ORACLE_USERNAME=
ORACLE_PASSWORD=
```
*   `ENVIRONMENT_MODE`: Set to `DEMO` to run offline with sample data. Set to `ORACLE_FUSION` to query a live Oracle Cloud environment.
*   `GEMINI_API_KEY`: If provided, the assistant uses Gemini Pro for natural language processing. If left empty, the application falls back to a regex-based NLU engine and template processor, keeping the assistant fully operational offline!

### 4. Running the Application
To run both the backend Express server and the Vite dev server concurrently, run:
```bash
npm run dev
```
Open your browser to: **`http://localhost:5173`** (the Vite proxy is automatically set to route API queries to port 5000).

---

## 💡 Demo Mode & Representative Queries

Log in using any mock credentials (e.g. `admin / admin`). In **Demo Mode**, the AI Assistant is capable of answering the following questions:

1.  **Users & Roles**:
    *   *"Who has the Advanced Access Controls Analyst role?"* (Returns 1 user: Alice Johnson in a clean UI table)
    *   *"Which roles are assigned to user JSMITH?"* (Returns 3 roles: AP Manager, IT Security Manager, Employee)
    *   *"List all users."*
2.  **Audit Logs**:
    *   *"Show audit history for user JSMITH"*
    *   *"Who modified a security role?"*
3.  **Role Entitlements & Hierarchy**:
    *   *"What privileges does AP Manager have?"*
    *   *"Show the complete hierarchy of role AP Manager"* (Renders a nested duty role tree)
4.  **GRC Risk Analytics**:
    *   *Show all security statistics totals* (Fills out the dashboard stats)
    *   *Show Segregation of Duties conflicts* (Highlights the conflict where JSMITH holds both Invoice Creation and Invoice Approval roles)

---

## ⚙️ Live Oracle Fusion Connection & GRC Status

You can toggle between **DEMO** and **ORACLE_FUSION** modes inside the **API Settings** page in the application.

*   **SCIM Users & Roles APIs**: Mapped and operational. Direct requests for listing users, individual lookups, and member allocations query `/hcmRestApi/scim/Users` and `/hcmRestApi/scim/Roles`.
*   **FSCM Audit Trail REST API**: Mapped and operational. Calls `/fscmRestApi/fndAuditRESTService` to search logs.
*   **GRC / Security Console Features**: Under live mode, since SCIM does not support tree traversal or raw privilege mappings, the application displays a detailed **"Integration Required"** card rather than misleading mock data. This covers:
    *   Role Hierarchy trees
    *   Privilege mappings
    *   Segregation of Duties rules
    *   Access Certifications campaigns
