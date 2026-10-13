import { useEffect, useState } from 'react';
import { BarChart3, RefreshCw, Users } from 'lucide-react';
import { api } from '../services/api';

export interface RankedItem {
  label: string;
  value: number;
}

// Top-N descending by numeric count; invalid counts sort last, never crash.
export function topNByCount(rows: any[], labelKey: string, valueKey: string, n: number): RankedItem[] {
  const mapped = (rows || []).map((r) => {
    const raw = r?.[valueKey];
    const num = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
    return { label: String(r?.[labelKey] ?? '—'), value: Number.isNaN(num) ? -1 : num };
  });
  mapped.sort((a, b) => b.value - a.value);
  return mapped.slice(0, Math.max(n, 0)).map((m) => ({ label: m.label, value: Math.max(m.value, 0) }));
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const n = v / base;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * base;
}

export function RankedBars({ title, subtitle, items, color, bare }: { title: string; subtitle: string; items: RankedItem[]; color: string; bare?: boolean }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const axisMax = niceCeil(max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(axisMax * f));
  const rowH = 34;
  const labelW = 190;
  const chartW = 460;
  const height = items.length * rowH + 34;
  const x = (v: number) => labelW + (v / axisMax) * chartW;
  const chart = (
    <svg viewBox={`0 0 ${labelW + chartW + 70} ${height}`} width="100%" role="img" aria-label={title}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} y1={0} x2={x(t)} y2={items.length * rowH} stroke="var(--border-color)" strokeWidth={1} />
          <text x={x(t)} y={items.length * rowH + 16} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{t >= 1000 ? `${t / 1000}K` : t}</text>
        </g>
      ))}
      {items.map((item, idx) => {
        const y = idx * rowH;
        const bw = Math.max((item.value / axisMax) * chartW, item.value > 0 ? 3 : 0);
        return (
          <g key={`${item.label}_${idx}`}>
            <text x={labelW - 10} y={y + 15} textAnchor="end" fontSize="11" fontWeight={600} fill="var(--text-primary)">
              {item.label.length > 26 ? `${item.label.slice(0, 25)}…` : item.label}
              <title>{item.label}</title>
            </text>
            <rect x={labelW} y={y + 2} width={bw} height={18} rx={3} fill={color} opacity={0.92}>
              <title>{`${item.label}: ${item.value.toLocaleString()}`}</title>
            </rect>
            <text x={labelW + bw + 6} y={y + 16} fontSize="11" fontWeight={800} fill={color}>
              {item.value >= 1000 ? `${(item.value / 1000).toFixed(item.value >= 10000 ? 0 : 1)}K` : item.value.toLocaleString()}
            </text>
          </g>
        );
      })}
    </svg>
  );
  if (bare) return chart;
  return (
    <div className="glass-panel" style={{ padding: '1.25rem 1.4rem' }}>
      <h3 style={{ fontSize: '0.98rem', fontWeight: 800, margin: '0 0 0.25rem 0', color: 'var(--text-primary)' }}>{title}</h3>
      <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0 0 1rem 0' }}>{subtitle}</p>
      {chart}
    </div>
  );
}

export interface IncidentRankings {
  users: RankedItem[] | null;
  roles: RankedItem[] | null;
  loading: boolean;
  error: string;
  retry: () => void;
}

/**
 * Fetches top-10 users + roles for an optional set of control IDs
 * (omit/empty = all controls in the active environment).
 */
export function useIncidentRankings(controlIds?: string[]): IncidentRankings {
  const [users, setUsers] = useState<RankedItem[] | null>(null);
  const [roles, setRoles] = useState<RankedItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const scopeKey = (controlIds || []).join(',');

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const ids = scopeKey ? scopeKey.split(',') : undefined;
        const [uRes, rRes] = await Promise.allSettled([api.getTopIncidentUsers(10, ids), api.getTopIncidentRoles(10, ids)]);
        if (!isMounted) return;
        const uItems = uRes.status === 'fulfilled' ? uRes.value?.items : undefined;
        const rItems = rRes.status === 'fulfilled' ? rRes.value?.items : undefined;
        if (!Array.isArray(uItems) || !Array.isArray(rItems)) {
          setUsers(null);
          setRoles(null);
          setError('Incident analytics are unavailable for this scope.');
          return;
        }
        setUsers(topNByCount(uItems.map((r: any) => ({ user: r.user ?? r.label, incidents: r.incidents ?? r.value })), 'user', 'incidents', 10));
        setRoles(topNByCount(rItems.map((r: any) => ({ role: r.role ?? r.label, incidents: r.incidents ?? r.value })), 'role', 'incidents', 10));
      } catch (err: any) {
        if (!isMounted) return;
        setUsers(null);
        setRoles(null);
        setError((err && err.message) || 'Could not establish connection to the backend service.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    load();
    return () => { isMounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, reloadKey]);

  return { users, roles, loading, error, retry: () => setReloadKey((k) => k + 1) };
}

interface IncidentRankingPanelsProps {
  /** Control IDs to aggregate. Omit/empty = all controls in the environment. */
  controlIds?: string[];
  /** Short scope caption rendered under each panel subtitle, e.g. "Access domain · 34 controls". */
  scopeCaption?: string;
}

/**
 * Top-10 users + roles bar panels. Used embedded in the Advanced Controls
 * Incident Status card (following the active domain tab).
 */
export default function IncidentRankingPanels({ controlIds, scopeCaption }: IncidentRankingPanelsProps) {
  const { users, roles, loading, error, retry } = useIncidentRankings(controlIds);

  const subtitle = scopeCaption
    ? `Ranked by continuous monitoring incident count · ${scopeCaption}.`
    : 'Ranked by continuous monitoring incident count.';

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', width: '100%' }}>
        {[1, 2].map((n) => (
          <div key={n} style={{ height: '300px', borderRadius: '10px' }} className="skeleton" />
        ))}
      </div>
    );
  }

  if (error || !users || !roles) {
    return (
      <div className="glass-panel" role="alert" style={{ padding: '1.75rem', textAlign: 'center', borderLeft: '4px solid var(--accent-red)', width: '100%' }}>
        <p style={{ color: 'var(--accent-red)', fontSize: '0.92rem', fontWeight: 700, margin: '0 0 0.4rem 0' }}>
          Couldn&apos;t load incident analytics.
        </p>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 1rem 0' }}>
          {error || 'The aggregation service returned no data.'}
        </p>
        <button type="button" className="btn btn-secondary" style={{ padding: '0.45rem 1.25rem', fontSize: '0.8rem' }} onClick={retry}>
          <RefreshCw size={13} style={{ marginRight: '0.35rem' }} /> Retry
        </button>
      </div>
    );
  }

  if (users.length === 0 && roles.length === 0) {
    return (
      <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', width: '100%' }}>
        <Users size={26} style={{ margin: '0 auto 0.6rem auto' }} />
        <div style={{ fontWeight: 600 }}>No incident analytics available for this scope yet.</div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.85rem', color: 'var(--text-secondary)', fontSize: '0.78rem', fontWeight: 600 }}>
        <BarChart3 size={14} /> Top violators {scopeCaption ? `· ${scopeCaption}` : '· all controls'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem' }}>
        <RankedBars title="Top 10 Users with Most Incidents" subtitle={subtitle} items={users} color="#1D4ED8" />
        <RankedBars title="Top 10 Roles with Most Incidents" subtitle={subtitle} items={roles} color="#7C3AED" />
      </div>
    </div>
  );
}
