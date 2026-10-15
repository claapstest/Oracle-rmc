import { useEffect, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Key, MousePointerClick, RefreshCw, Users, X } from 'lucide-react';
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

export function RankedBars({ title, subtitle, items, color, bare, onSelect, selectedLabel }: {
  title: string;
  subtitle: string;
  items: RankedItem[];
  color: string;
  bare?: boolean;
  /** When provided, every bar becomes clickable and invokes this with the clicked row. */
  onSelect?: (item: RankedItem) => void;
  /** Label of the currently selected row (rendered with a highlight ring). */
  selectedLabel?: string | null;
}) {
  const clickable = typeof onSelect === 'function';
  const [hovered, setHovered] = useState<number | null>(null);
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
        const isSelected = selectedLabel != null && item.label === selectedLabel;
        const isHot = isSelected || hovered === idx;
        const activate = () => { if (clickable && onSelect) onSelect(item); };
        return (
          <g
            key={`${item.label}_${idx}`}
            onClick={clickable ? activate : undefined}
            onMouseEnter={clickable ? () => setHovered(idx) : undefined}
            onMouseLeave={clickable ? () => setHovered(null) : undefined}
            onFocus={clickable ? () => setHovered(idx) : undefined}
            onBlur={clickable ? () => setHovered(null) : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } } : undefined}
            tabIndex={clickable ? 0 : undefined}
            role={clickable ? 'button' : undefined}
            aria-label={clickable ? `View incidents for ${item.label}` : undefined}
            style={clickable ? { cursor: 'pointer', outline: 'none' } : undefined}
          >
            <text x={labelW - 10} y={y + 15} textAnchor="end" fontSize="11" fontWeight={isHot ? 800 : 600} fill="var(--text-primary)" textDecoration={isHot && clickable ? 'underline' : 'none'}>
              {item.label.length > 26 ? `${item.label.slice(0, 25)}…` : item.label}
              <title>{item.label}</title>
            </text>
            <rect x={labelW} y={y + 2} width={bw} height={18} rx={3} fill={color} opacity={isHot ? 1 : 0.92} stroke={isSelected ? '#0F172A' : 'none'} strokeWidth={isSelected ? 1.5 : 0}>
              <title>{`${item.label}: ${item.value.toLocaleString()}${clickable ? ' — Click to view incidents' : ''}`}</title>
            </rect>
            <text x={labelW + bw + 6} y={y + 16} fontSize="11" fontWeight={800} fill={color}>
              {item.value >= 1000 ? `${(item.value / 1000).toFixed(item.value >= 10000 ? 0 : 1)}K` : item.value.toLocaleString()}
            </text>
          </g>
        );
      })}
    </svg>
  );
  const hint = clickable && items.length > 0 ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.6rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
      <MousePointerClick size={12} /> Click a bar to view its incidents
    </div>
  ) : null;
  if (bare) return (<>{chart}{hint}</>);
  return (
    <div className="glass-panel" style={{ padding: '1.25rem 1.4rem' }}>
      <h3 style={{ fontSize: '0.98rem', fontWeight: 800, margin: '0 0 0.25rem 0', color: 'var(--text-primary)' }}>{title}</h3>
      <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0 0 1rem 0' }}>{subtitle}</p>
      {chart}
      {hint}
    </div>
  );
}

export interface RankingSelection {
  kind: 'user' | 'role';
  item: RankedItem;
}

function statusBadgeStyle(status: any): React.CSSProperties {
  const s = String(status || '').trim().toUpperCase();
  if (s.includes('RESOLV') || s.includes('CLOS')) return { backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#047857', border: '1px solid rgba(16, 185, 129, 0.3)' };
  if (s.includes('ACCEPT')) return { backgroundColor: 'rgba(245, 158, 11, 0.12)', color: '#B45309', border: '1px solid rgba(245, 158, 11, 0.3)' };
  if (s.includes('REMED')) return { backgroundColor: 'rgba(249, 115, 22, 0.12)', color: '#C2410C', border: '1px solid rgba(249, 115, 22, 0.3)' };
  return { backgroundColor: 'rgba(37, 99, 235, 0.1)', color: '#1D4ED8', border: '1px solid rgba(37, 99, 235, 0.25)' };
}

/**
 * Drill-down modal for a clicked Top-10 bar. Lists the underlying incidents
 * for that user/role scoped to the given control IDs (the active domain tab).
 */
export function RankingDrilldownModal({ selection, controlIds, scopeCaption, onClose }: {
  selection: RankingSelection;
  controlIds: string[];
  scopeCaption?: string;
  onClose: () => void;
}) {
  const pageSize = 15;
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [items, setItems] = useState<any[]>([]);
  const [filteredCount, setFilteredCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const scopeKey = (controlIds || []).join(',');

  useEffect(() => { setPage(1); }, [selection.kind, selection.item.label, scopeKey]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const ids = scopeKey ? scopeKey.split(',') : [];
        const res = await api.getRiskIncidents({
          controls: ids,
          user: selection.kind === 'user' ? selection.item.label : undefined,
          role: selection.kind === 'role' ? selection.item.label : undefined,
          page,
          limit: pageSize,
        });
        if (cancelled) return;
        if (!res || (res.success === false && !Array.isArray(res.items))) {
          throw new Error(res?.error || res?.message || 'Failed to load incidents.');
        }
        setItems(Array.isArray(res.items) ? res.items : []);
        setFilteredCount(typeof res.filteredCount === 'number' ? res.filteredCount : null);
      } catch (err: any) {
        if (!cancelled) {
          setItems([]);
          setFilteredCount(null);
          setError((err && err.message) || 'Could not load incidents.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, reloadKey, scopeKey, selection.kind, selection.item.label]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const total = filteredCount ?? selection.item.value;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const KindIcon = selection.kind === 'user' ? Users : Key;
  const accent = selection.kind === 'user' ? '#1D4ED8' : '#7C3AED';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Incidents for ${selection.item.label}`}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
      onClick={onClose}
    >
      <div
        className="glass-panel"
        style={{ width: '100%', maxWidth: '860px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '1.1rem 1.4rem', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
              <KindIcon size={16} style={{ color: accent }} />
              <span className="badge" style={{ fontSize: '0.7rem', backgroundColor: `${accent}1A`, color: accent, border: `1px solid ${accent}40`, fontWeight: 700 }}>
                {selection.kind === 'user' ? 'User drill-down' : 'Role drill-down'}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {total.toLocaleString()} incident{total === 1 ? '' : 's'}{scopeCaption ? ` · ${scopeCaption}` : ''}
              </span>
            </div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selection.item.label}>
              {selection.item.label}
            </h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close incident drill-down" className="btn btn-secondary" style={{ padding: '0.35rem 0.55rem' }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: '1rem 1.4rem', overflowY: 'auto' }}>
          {loading ? (
            <div style={{ height: '220px', borderRadius: '10px' }} className="skeleton" />
          ) : error ? (
            <div role="alert" style={{ padding: '1.5rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--accent-red)', fontSize: '0.88rem', fontWeight: 700, margin: '0 0 0.6rem 0' }}>{error}</p>
              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.4rem 1rem' }} onClick={() => setReloadKey((k) => k + 1)}>
                Retry
              </button>
            </div>
          ) : items.length === 0 ? (
            <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No synced incidents found for this {selection.kind} in this scope yet.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '0.5rem 0.6rem', fontWeight: 700 }}>Incident</th>
                    <th style={{ padding: '0.5rem 0.6rem', fontWeight: 700 }}>Control</th>
                    <th style={{ padding: '0.5rem 0.6rem', fontWeight: 700 }}>{selection.kind === 'user' ? 'Role' : 'User'}</th>
                    <th style={{ padding: '0.5rem 0.6rem', fontWeight: 700 }}>Status</th>
                    <th style={{ padding: '0.5rem 0.6rem', fontWeight: 700 }}>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((inc: any, idx: number) => {
                    const counterpart = selection.kind === 'user' ? (inc.role || '—') : (inc.globalUserName || inc.globalUser || '—');
                    const updated = inc.lastUpdateDate || inc.lastUpdatedDate || null;
                    return (
                      <tr key={`${inc.id || idx}_${idx}`} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.5rem 0.6rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{inc.id || '—'}</td>
                        <td style={{ padding: '0.5rem 0.6rem', color: 'var(--text-secondary)' }} title={inc.controlName || inc.controlId}>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{inc.controlId || '—'}</span>
                          {inc.controlName ? <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inc.controlName}</span> : null}
                        </td>
                        <td style={{ padding: '0.5rem 0.6rem', color: 'var(--text-primary)', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(counterpart)}>{counterpart}</td>
                        <td style={{ padding: '0.5rem 0.6rem' }}>
                          <span className="badge" style={{ fontSize: '0.68rem', fontWeight: 700, ...statusBadgeStyle(inc.status || inc.state) }}>
                            {inc.status || inc.state || '—'}
                          </span>
                        </td>
                        <td style={{ padding: '0.5rem 0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {updated ? new Date(updated).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.9rem' }}>
              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.76rem', padding: '0.35rem 0.8rem', opacity: page <= 1 ? 0.5 : 1 }} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft size={13} style={{ marginRight: '0.25rem' }} /> Prev
              </button>
              <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Page {page} of {totalPages} · {total.toLocaleString()} incidents</span>
              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.76rem', padding: '0.35rem 0.8rem', opacity: page >= totalPages ? 0.5 : 1 }} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Next <ChevronRight size={13} style={{ marginLeft: '0.25rem' }} />
              </button>
            </div>
          )}
        </div>
      </div>
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
  const [selection, setSelection] = useState<RankingSelection | null>(null);

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
        <RankedBars title="Top 10 Users with Most Incidents" subtitle={subtitle} items={users} color="#1D4ED8" onSelect={(item) => setSelection({ kind: 'user', item })} selectedLabel={selection?.kind === 'user' ? selection.item.label : null} />
        <RankedBars title="Top 10 Roles with Most Incidents" subtitle={subtitle} items={roles} color="#7C3AED" onSelect={(item) => setSelection({ kind: 'role', item })} selectedLabel={selection?.kind === 'role' ? selection.item.label : null} />
      </div>
      {selection && (
        <RankingDrilldownModal selection={selection} controlIds={controlIds || []} scopeCaption={scopeCaption} onClose={() => setSelection(null)} />
      )}
    </div>
  );
}
