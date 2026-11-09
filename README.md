# Oracle Fusion Security & Risk Intelligence Assistant

An enterprise-grade compliance and security-intelligence platform. It provides business users, auditors, and managers with dashboards and reports for querying Oracle Fusion Cloud security identities, role catalogs, access privileges, audit trail logs, and GRC risk boundaries.

> **This is the AI-free product variant.** It contains no chatbot, LLM provider integration, AI orchestrator, or tool registry, and requires no AI credentials.

---

## 🏗️ Architecture & Flow

All data access is deterministic and served from the backend API. Oracle Fusion is the system of record; PostgreSQL holds the synchronized cache used by the dashboards.

```text
Browser (dashboard / reports UI)
        ↓
Backend API (Express + TypeScript)
        ↓
Service layer (Oracle sync + PostgreSQL cache)
        ↓
Oracle Service Layer
       ├── [DEMO Mode] ──→ Offline seed data (high-fidelity GRC schemas)
       └── [LIVE Mode] ──→ OracleFusionClient (Axios REST to SCIM & FSCM APIs)
        ↓
Structured API response → dashboard tables and charts
```

---

## 📁 Repository Structure

*   `backend/` - Node.js + Express + TypeScript API server
    *   `src/index.ts` - Express app server and static router
    *   `src/oracle/client.ts` - HTTP client for SCIM & FSCM Audit REST APIs
    *   `src/services/oracleService.ts` - Modes coordinator & mapper profiles
*   `frontend/` - React + Vite + TypeScript Client App
    *   `src/index.css` - Custom enterprise design system (Deep Slate & Gold theme, glassmorphism, responsive styles)
    *   `src/App.tsx` - App session coordinator & sidebar router
    *   `src/pages/` - Login, Overview Dashboard, Users grid, Roles browser, Audit logs, Risk charts, and API Settings
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
ORACLE_FUSION_BASE_URL=
ORACLE_AUTH_TYPE=BASIC
ORACLE_USERNAME=
ORACLE_PASSWORD=
```
*   `ENVIRONMENT_MODE`: Set to `DEMO` to run offline with sample data. Set to `ORACLE_FUSION` to query a live Oracle Cloud environment.
*   No LLM or AI provider credentials are required by this variant.

### 4. Running the Application
To run both the backend Express server and the Vite dev server concurrently, run:
```bash
npm run dev
```
Open your browser to: **`http://localhost:5173`** (the Vite proxy is automatically set to route API queries to port 5000).

---

## 💡 Product Modules

Log in with a provisioned VEYRA account. The AI-free variant exposes the following modules, all driven by the synchronized Oracle Fusion data:

1.  **Users & Roles** — user directory, role catalog, role hierarchy and privilege mappings.
2.  **Audit Trail** — searchable audit history with operator and object filters.
3.  **Risk Management** — advanced access requests, controls, certifications and incident analytics.
4.  **Reports** — report catalogue with search, filters and downloads.
5.  **Oracle Integration** — connection settings, sync status and catalogue health.

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
