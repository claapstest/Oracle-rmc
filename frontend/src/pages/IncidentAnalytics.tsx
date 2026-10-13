import React, { useEffect, useState } from 'react';
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

function RankedBars({ title, subtitle, items, color }: { title: string; subtitle: string; items: RankedItem[]; color: string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const axisMax = niceCeil(max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(axisMax * f));
  const rowH = 34;
  const labelW = 190;
  const chartW = 460;
  const height = items.length * rowH + 34;
  const x = (v: number) => labelW + (v / axisMax) * chartW;
  return (
    <div className="glass-panel" style={{ padding: '1.5rem 1.6rem' }}>
      <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: '0 0 0.25rem 0', color: '#0F172A' }}>{title}</h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 1rem 0' }}>{subtitle}</p>
      <svg viewBox={`0 0 ${labelW + chartW + 70} ${height}`} width="100%" role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={0} x2={x(t)} y2={items.length * rowH} stroke="#E2E8F0" strokeWidth={1} />
            <text x={x(t)} y={items.length * rowH + 16} textAnchor="middle" fontSize="10" fill="#94A3B8">{t >= 1000 ? `${t / 1000}K` : t}</text>
          </g>
        ))}
        {items.map((item, idx) => {
          const y = idx * rowH;
          const bw = Math.max((item.value / axisMax) * chartW, item.value > 0 ? 3 : 0);
          return (
            <g key={`${item.label}_${idx}`}>
              <text x={labelW - 10} y={y + 15} textAnchor="end" fontSize="11" fontWeight={600} fill="#0F172A">
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
    </div>
  );
}

export default function IncidentAnalytics({ environmentMode }: { environmentMode?: 'DEMO' | 'ORACLE_FUSION' }) {
  const [users, setUsers] = useState<RankedItem[] | null>(null);
  const [roles, setRoles] = useState<RankedItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [uRes, rRes] = await Promise.allSettled([api.getTopIncidentUsers(10), api.getTopIncidentRoles(10)]);
        if (!isMounted) return;
        const uItems = uRes.status === 'fulfilled' ? uRes.value?.items : undefined;
        const rItems = rRes.status === 'fulfilled' ? rRes.value?.items : undefined;
        if (!Array.isArray(uItems) || !Array.isArray(rItems)) {
          setUsers(null);
          setRoles(null);
          setError('Incident analytics are unavailable. The aggregation service is pending backend implementation.');
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
  }, [environmentMode, reloadKey]);

  return (
    <div style={{ padding: '1.75rem 2rem', maxWidth: '1600px', width: '100%', margin: '0 auto' }}>
      <div
        className="page-header-banner animate-fade-in"
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 50%, #3b82f6 100%)',
          borderRadius: '16px', padding: '2rem 2.25rem', color: '#ffffff', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{ width: '52px', height: '52px', borderRadius: '12px', backgroundColor: 'rgba(255, 255, 255, 0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <BarChart3 size={30} style={{ color: '#ffffff' }} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>Incident Analytics</h1>
            <p style={{ margin: '0.25rem 0 0 0', color: 'rgba(255,255,255,0.85)', fontSize: '0.92rem' }}>
              Top users and roles by continuous monitoring incidents.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '8px', padding: '0.55rem 1.1rem', cursor: 'pointer', fontWeight: 700 }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          {[1, 2].map((n) => (
            <div key={n} style={{ height: '320px', borderRadius: '12px' }} className="skeleton" />
          ))}
        </div>
      ) : error || !users || !roles ? (
        <div style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
          <div className="glass-panel" role="alert" style={{ padding: '2.5rem', textAlign: 'center', borderLeft: '4px solid var(--accent-red)' }}>
            <p style={{ color: 'var(--accent-red)', fontSize: '1rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>
              Couldn&apos;t load incident analytics.
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: '0 0 1.5rem 0' }}>
              {error || 'The aggregation service is pending backend implementation.'}
            </p>
            <button type="button" className="btn btn-primary" style={{ padding: '0.65rem 1.75rem' }} onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </button>
          </div>
        </div>
      ) : users.length === 0 && roles.length === 0 ? (
        <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: '#64748B' }}>
          <Users size={30} style={{ color: '#94A3B8', margin: '0 auto 0.6rem auto' }} />
          <div style={{ fontWeight: 600, color: '#334155' }}>No incident analytics available yet.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          <RankedBars title="Top 10 Users with Most Incidents" subtitle="Ranked by continuous monitoring incident count." items={users} color="#1D4ED8" />
          <RankedBars title="Top 10 Roles with Most Incidents" subtitle="Ranked by continuous monitoring incident count." items={roles} color="#7C3AED" />
        </div>
      )}

    </div>
  );
}
