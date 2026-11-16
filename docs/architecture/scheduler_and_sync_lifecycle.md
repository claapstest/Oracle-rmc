# Scheduler & Sync Lifecycle Inspection (VYR-039)

**Story ID:** VYR-039
**Epic:** EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
**Branch Applicability:** Both (standard-veyra-application-dev & veyra-application-dev)

Inspection of what scheduled synchronization exists today. No new cron/queue
service is assumed to be required — this document records what is actually
deployed, verified against source (`test:vyr39` re-checks these facts).

## 1. Deployment Model (single-instance today)

| Aspect | Finding |
|---|---|
| Platform | Railway (`railway.json`), built from `Dockerfile` |
| Process | **One web service.** `Dockerfile` CMD `npm run start:migrate` → Express API **and** all schedulers in the same Node process |
| Migrations | Run at container start (`start:migrate`) |
| Health | `/health`, 120s timeout, restart ON_FAILURE max 10 retries |
| Replicas | No replica/worker configuration — single instance by default |
| Scheduler libraries | None installed — no node-cron, Bull, or queue; plain `setTimeout`/`setInterval` |

Consequence: schedulers are safe today **only because** deployment is a single
replica. Nothing structural prevents scale-out (VYR-043 gap).

## 2. Active Scheduled Jobs (in the web process)

### 2.1 Nightly off-peak full sync — `ScheduledSyncService` (ACTIVE)
- Boot: `index.ts` → `scheduledSyncService.initialize(oracleService, 23)`.
- Cadence: daily at `SYNC_OFFPEAK_HOUR` (default **23:00** server time).
- Mechanism: `setTimeout` to next occurrence, re-armed after each run, timer
  `unref`'d so it never keeps the process alive.
- Action: `oracleSyncService.runFullSync(oracleService, 'SCHEDULED_OFFPEAK_CRON')`.
- Retry: **none.** One attempt; failure is logged, next attempt 24h later.
  A restart shortly after the window misses the run until the next day.

### 2.2 Session cleanup — `AuthService` (ACTIVE, not Oracle sync)
- Every 60s, expires stale sessions. Timer `unref`'d.

### 2.3 Boot warm-up timers (ACTIVE)
- 500ms after listen: incident-row index init, user-access report refresh,
  role-hierarchy cache warm.

### 2.4 Other background timers (NOT schedulers — inventoried for completeness)

A full sweep of every `setTimeout`/`setInterval` in `backend/src` confirms none of
these are Oracle-sync schedulers:

| Timer | Where | Purpose |
|---|---|---|
| Audit flush debounce | `security/cryptoAuditService.ts` | Batches pending audit rows; flushes after a short delay, `unref`'d |
| Catalog background sync | `services/rolePrivilegeCatalogService.ts` (`syncCatalogInBackground`) | User-triggered (API) catalog rebuild with its own `isSyncing` flag — no cadence |
| Boot connection test | `services/oracleService.ts` | One-shot 1.5s delayed connectivity check at startup |
| Boot warm-ups | `index.ts`, `incidentCacheService.ts`, `incidentCountCacheService.ts` | One-shot cache/index warm or job-map cleanup |
| Route background work | `routes/api.ts` (product sync route) | Fire-and-forget per-product sync on demand — same services as §6 |
| DB retry / pacing | `db.ts`, `controlRawDbService.ts`, `oracleService.ts` | One-shot retry/pacing sleeps inside request paths |

Every recurring timer in the codebase is accounted for in §2 or is internal
housekeeping like the above.

## 3. Dormant Schedulers (dead code — never started)

| Scheduler | Where | Default cadence | Status |
|---|---|---|---|
| `auditRawDbService.startDailyScheduler` | auditRawDbService.ts | 24h incremental audit sync | **No caller** — audit sync only runs inside full sync |
| `controlRawDbService.startAutoSyncScheduler` | controlRawDbService.ts | 6h control auto-sync | **No caller** — controls sync only inside full sync |

Both are candidate deletions or candidate wiring for VYR-040/041; the decision
must be explicit either way.

## 4. Full Sync Pipeline (`runFullSync`, 5 sequential domains)

| # | Domain | Method | Watermark | Pagination | Failure handling |
|---|---|---|---|---|---|
| 1 | Controls & Incidents | `controlRawDbService.runAutoSyncCycle` | Per-control micro-probe on `LastUpdateDate`; catalog discovery with DB fallback | Catalog 100/page fallback; per-control incident pagination | Per-control try/catch + 1.5s pacing; partial saves marked `PARTIAL`; run recorded `SUCCESS`/`FAILED` |
| 2 | Role Hierarchy & Privileges | `roleHierarchyService.syncFromBip` (BIP report) | None — full refresh, upsert | Batch 500 | try/catch, continue |
| 3 | Audit Trail | `auditRawDbService.runDailyIncrementalSync` | `oracle_audit_sync_state` per product (`__GLOBAL__`), window defaults to last 24h | **Page 1 only** (500 rows) per business object — gap | Per-target try/catch, continue |
| 4 | Users & Roles | SCIM via `client.getUsers/getRoles` → `saveRawUsersBatch/RolesBatch` | None — full refresh, upsert | 500/page until short page | try/catch, continue |
| 5 | User Access Report | `userAccessReportService.getUserAccessReport({ syncFromOracle: true })` | None — full refresh, delete+insert | SCIM + HCM workers + BIP auto-provisioning | try/catch, continue |

Each domain failure is contained: the overall sync reports `success: true` with
per-domain error details.

## 5. Concurrency Control

- **In-process mutex only**: `oracleSyncService.acquireLock` is a boolean
  (`isSyncing`); control cycle uses `isSchedulerRunning`. Both reset in
  `finally` (crash of the whole process clears them trivially — single instance).
- User-triggered duplicate syncs get **409 `SYNC_IN_PROGRESS`** (API route).
- **No distributed lock** (no advisory lock, lock table, or queue uniqueness).
  Two replicas — or two deployments sharing one DB — would double-run.

## 6. Ingestion Side-Channels (not scheduled, but write raw tables)

- `oracleService.getAuditHistory` auto-saves fetched audit pages to
  `oracle_raw_audit_records` (fire-and-forget) on live dashboard queries.
- On-demand routes: `POST /api/audit/sync`, `POST /api/audit/sync/product`,
  admin full sync `POST` (adminUser trigger) — same underlying services.

## 7. Gaps (feeding VYR-040/041/042/043)

1. **No distributed locking** — in-process mutex only (VYR-043).
2. **Audit pagination truncation** — only the first 500 rows per business
   object per window are fetched; older/later pages are silently skipped.
3. **No retry/backoff** for the nightly run; a transient Oracle outage loses
   the whole day's window until the next 23:00.
4. **Missed-run behaviour** — `setTimeout` scheduling does not catch up after
   restarts or downtime.
5. **Dead schedulers** — `startDailyScheduler` / `startAutoSyncScheduler`
   are unreachable; either wire or delete (decision for VYR-040/041).
6. **Scheduler lives in the web process** — a long sync competes with request
   serving; a separate worker is an option but *not* assumed required.
7. **Credentials** — Oracle Fusion credentials come from config/env, not a
   secret manager at runtime, and scheduled work uses the same client as
   interactive features (VYR-042).

## 8. Verification

`npm run test:vyr39` — a drift check asserting every fact in this document
against the current source (file presence, env var names, defaults, pipeline
order, mutex behaviour, dead-scheduler status, deployment manifest contents).
