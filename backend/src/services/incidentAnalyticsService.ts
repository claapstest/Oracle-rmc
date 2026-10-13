import { query as dbQuery } from '../db.js';
import { config } from '../config.js';

// Incident Analytics aggregation.
// Reads the cached Oracle incident payloads (oracle_control_incidents) so
// ranking 60K+ incidents is a single indexed SQL pass, not per-control API fan-out.
// Always scoped to the active Oracle environment host; optionally narrowed to a
// set of control IDs (e.g. the active Access/Transaction domain tab).

function activeHost(): string {
  const rawUrl = (process.env.FUSION_HOST || config.oracle.baseUrl || 'mock.fusion.oracle.com').trim().toLowerCase();
  try {
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      return new URL(rawUrl).host;
    }
  } catch (_) {}
  return rawUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'default_env';
}

function cleanIds(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  return list.map((s) => String(s).trim()).filter(Boolean);
}

export interface RankedCount {
  label: string;
  incidents: number;
}

function clampLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : 10;
  if (Number.isNaN(n)) return 10;
  return Math.min(Math.max(n, 1), 50);
}

export async function topIncidentUsers(limitRaw?: unknown, controlsRaw?: unknown): Promise<{ success: boolean; items: Array<{ user: string; incidents: number }> }> {
  const limit = clampLimit(limitRaw);
  const ids = cleanIds(controlsRaw);
  const scope = ids.length > 0 ? 'AND control_id = ANY($3)' : '';
  const params: any[] = ids.length > 0 ? [activeHost(), limit, ids] : [activeHost(), limit];
  const res = await dbQuery(
    `SELECT COALESCE(NULLIF(TRIM(el->>'GlobalUserName'), ''), 'Unknown') AS user,
            COUNT(*)::int AS incidents
     FROM oracle_control_incidents, jsonb_array_elements(raw_incidents) AS el
     WHERE environment_host = $1 ${scope}
     GROUP BY 1
     ORDER BY 2 DESC, 1 ASC
     LIMIT $2`,
    params
  );
  return { success: true, items: res.rows };
}

export async function topIncidentRoles(limitRaw?: unknown, controlsRaw?: unknown): Promise<{ success: boolean; items: Array<{ role: string; incidents: number }> }> {
  const limit = clampLimit(limitRaw);
  const ids = cleanIds(controlsRaw);
  const scope = ids.length > 0 ? 'AND control_id = ANY($3)' : '';
  const params: any[] = ids.length > 0 ? [activeHost(), limit, ids] : [activeHost(), limit];
  const res = await dbQuery(
    `SELECT COALESCE(NULLIF(TRIM(el->>'Role'), ''), 'Unknown') AS role,
            COUNT(*)::int AS incidents
     FROM oracle_control_incidents, jsonb_array_elements(raw_incidents) AS el
     WHERE environment_host = $1 ${scope}
     GROUP BY 1
     ORDER BY 2 DESC, 1 ASC
     LIMIT $2`,
    params
  );
  return { success: true, items: res.rows };
}
