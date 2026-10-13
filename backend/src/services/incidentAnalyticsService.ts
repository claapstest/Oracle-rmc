import { query as dbQuery } from '../db.js';

// Incident Analytics aggregation (KARTHIK: new-file addition for the
// Incident Analytics page — Srikar, keep/replace with your preferred home).
// Reads the cached Oracle incident payloads (oracle_control_incidents) so
// ranking 60K+ incidents is a single indexed SQL pass, not per-control API fan-out.

export interface RankedCount {
  label: string;
  incidents: number;
}

function clampLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : 10;
  if (Number.isNaN(n)) return 10;
  return Math.min(Math.max(n, 1), 50);
}

export async function topIncidentUsers(limitRaw?: unknown): Promise<{ success: boolean; items: Array<{ user: string; incidents: number }> }> {
  const limit = clampLimit(limitRaw);
  const res = await dbQuery(
    `SELECT COALESCE(NULLIF(TRIM(el->>'GlobalUserName'), ''), 'Unknown') AS user,
            COUNT(*)::int AS incidents
     FROM oracle_control_incidents, jsonb_array_elements(raw_incidents) AS el
     GROUP BY 1
     ORDER BY 2 DESC, 1 ASC
     LIMIT $1`,
    [limit]
  );
  return { success: true, items: res.rows };
}

export async function topIncidentRoles(limitRaw?: unknown): Promise<{ success: boolean; items: Array<{ role: string; incidents: number }> }> {
  const limit = clampLimit(limitRaw);
  const res = await dbQuery(
    `SELECT COALESCE(NULLIF(TRIM(el->>'Role'), ''), 'Unknown') AS role,
            COUNT(*)::int AS incidents
     FROM oracle_control_incidents, jsonb_array_elements(raw_incidents) AS el
     GROUP BY 1
     ORDER BY 2 DESC, 1 ASC
     LIMIT $1`,
    [limit]
  );
  return { success: true, items: res.rows };
}
