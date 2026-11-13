/**
 * Bulk incident sync: runs the same "Controls & Incidents" step (1/4) that the
 * nightly 11PM off-peak job performs, without waiting for 23:00 or needing the
 * API server to be running.
 *
 *   npx tsx scripts/sync_control_incidents_now.ts
 */
import { controlRawDbService } from '../src/services/controlRawDbService.js';
import { oracleService } from '../src/services/oracleService.js';
import { query } from '../src/db.js';

const started = Date.now();

async function counts() {
  const a = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM oracle_incident_rows`);
  const b = await query<{ n: string; t: string }>(
    `SELECT COUNT(*)::text AS n, COALESCE(SUM(total_incidents),0)::text AS t FROM oracle_control_incidents`
  );
  return { indexedRows: a.rows[0].n, controlRows: b.rows[0].n, totalIncidents: b.rows[0].t };
}

async function main() {
  console.log('[sync] host =', controlRawDbService.getHost());
  console.log('[sync] before:', await counts());

  const ticker = setInterval(async () => {
    try {
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      console.log(`[sync] +${mins}m`, await counts());
    } catch (_) {}
  }, 30000);

  try {
    await controlRawDbService.runAutoSyncCycle(oracleService);
    console.log('[sync] runAutoSyncCycle finished');
  } finally {
    clearInterval(ticker);
  }

  console.log('[sync] after:', await counts());
  console.log(`[sync] elapsed ${((Date.now() - started) / 60000).toFixed(1)} minutes`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[sync] FAILED:', e?.message || e);
  process.exit(1);
});
