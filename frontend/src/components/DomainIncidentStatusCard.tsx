import React, { useState } from 'react';
import { PieChart, UserCheck, CheckCircle, Wrench, ShieldCheck, X } from 'lucide-react';

export type LifecycleStatusKey = 'ALL' | 'ASSIGNED' | 'ACCEPTED' | 'REMEDIATE' | 'RESOLVED';

export interface DomainIncidentStats {
  total: number;
  assigned: number;
  accepted: number;
  remediate: number;
  resolved: number;
}

export interface DomainIncidentStatusCardProps {
  domain: 'ACCESS' | 'TRANSACTION';
  stats: DomainIncidentStats;
  activeFilter: LifecycleStatusKey;
  onFilterChange: (next: LifecycleStatusKey) => void;
  isActiveDomain?: boolean;
  onSelectDomain?: () => void;
}

export const DomainIncidentStatusCard: React.FC<DomainIncidentStatusCardProps> = ({
  domain,
  stats,
  activeFilter,
  onFilterChange,
  isActiveDomain,
  onSelectDomain,
}) => {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const isAccess = domain === 'ACCESS';
  const accentColor = isAccess ? '#3B82F6' : '#10B981';
  const accentBg = isAccess ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)';
  const accentBorder = isAccess ? 'rgba(59, 130, 246, 0.25)' : 'rgba(16, 185, 129, 0.25)';

  const total = stats.total || 0;
  const items: Array<{
    key: Exclude<LifecycleStatusKey, 'ALL'>;
    label: string;
    count: number;
    pct: number;
    color: string;
    bg: string;
    icon: any;
  }> = [
    {
      key: 'ASSIGNED',
      label: 'Assigned',
      count: stats.assigned || 0,
      pct: total > 0 ? ((stats.assigned || 0) / total) * 100 : 0,
      color: '#3B82F6',
      bg: 'rgba(59, 130, 246, 0.1)',
      icon: UserCheck,
    },
    {
      key: 'ACCEPTED',
      label: 'Accepted',
      count: stats.accepted || 0,
      pct: total > 0 ? ((stats.accepted || 0) / total) * 100 : 0,
      color: '#8B5CF6',
      bg: 'rgba(139, 92, 246, 0.1)',
      icon: CheckCircle,
    },
    {
      key: 'REMEDIATE',
      label: 'Remediate',
      count: stats.remediate || 0,
      pct: total > 0 ? ((stats.remediate || 0) / total) * 100 : 0,
      color: '#F59E0B',
      bg: 'rgba(245, 158, 11, 0.1)',
      icon: Wrench,
    },
    {
      key: 'RESOLVED',
      label: 'Resolved',
      count: stats.resolved || 0,
      pct: total > 0 ? ((stats.resolved || 0) / total) * 100 : 0,
      color: '#10B981',
      bg: 'rgba(16, 185, 129, 0.1)',
      icon: ShieldCheck,
    },
  ];

  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  let accOffset = 0;
  const activeHoveredItem = hoveredKey ? items.find(i => i.key === hoveredKey) : null;

  const handleStatusClick = (key: Exclude<LifecycleStatusKey, 'ALL'>) => {
    if (onSelectDomain && isActiveDomain === false) {
      onSelectDomain();
    }
    onFilterChange(activeFilter === key && isActiveDomain !== false ? 'ALL' : key);
  };

  return (
    <div
      className="glass-panel"
      onClick={onSelectDomain}
      style={{
        padding: '1.25rem 1.4rem',
        border: isActiveDomain
          ? `2px solid ${accentColor}`
          : '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        cursor: onSelectDomain ? 'pointer' : 'default',
        boxShadow: isActiveDomain ? `0 6px 20px -4px ${accentBg}` : undefined,
        transition: 'all 0.2s ease',
      }}
    >
      {/* Top Header Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '1.15rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <PieChart size={17} style={{ color: accentColor }} />
            <h4 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-header)' }}>
              {isAccess ? 'Access' : 'Transaction'} Controls Incident Status
            </h4>
            <span
              className="badge"
              style={{
                fontSize: '0.72rem',
                backgroundColor: accentBg,
                color: accentColor,
                border: `1px solid ${accentBorder}`,
                fontWeight: 600,
              }}
            >
              Oracle Lifecycle
            </span>
            {isActiveDomain && (
              <span
                className="badge"
                style={{
                  fontSize: '0.68rem',
                  backgroundColor: accentColor,
                  color: '#ffffff',
                  fontWeight: 700,
                }}
              >
                Viewing
              </span>
            )}
          </div>
          <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
            Continuous monitoring breakdown across 4 standard lifecycle statuses.
          </p>
        </div>

        {activeFilter !== 'ALL' && (isActiveDomain === undefined || isActiveDomain) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFilterChange('ALL');
            }}
            className="btn btn-secondary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.74rem',
              padding: '0.22rem 0.55rem',
              color: 'var(--accent-gold)',
              borderColor: 'var(--accent-gold)',
            }}
            title="Clear incident status filter"
          >
            <X size={12} /> Clear Filter ({activeFilter})
          </button>
        )}
      </div>

      {/* Donut Pie Chart + 4 Lifecycle Status Cards */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.25rem', flex: 1 }}>
        {/* SVG Donut Chart */}
        <div style={{ position: 'relative', width: '135px', height: '135px', flexShrink: 0, margin: '0 auto' }}>
          <svg viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%', overflow: 'visible' }}>
            <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--border-color)" strokeWidth={13} opacity={0.5} />

            {items.map(seg => {
              if (seg.pct <= 0) return null;
              const dash = (seg.pct / 100) * circumference;
              const offset = -accOffset;
              accOffset += dash;
              const isHovered = hoveredKey === seg.key;
              const isFiltered = (isActiveDomain === undefined || isActiveDomain) && activeFilter === seg.key;

              return (
                <circle
                  key={seg.key}
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={isHovered ? 16 : 13}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={offset}
                  style={{
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    cursor: 'pointer',
                    filter: isHovered
                      ? `drop-shadow(0 0 6px ${seg.color})`
                      : isFiltered ? `drop-shadow(0 0 4px ${seg.color})` : 'none',
                    opacity: hoveredKey !== null
                      ? (isHovered ? 1 : 0.4)
                      : ((isActiveDomain === undefined || isActiveDomain) && activeFilter !== 'ALL' ? (isFiltered ? 1 : 0.45) : 1),
                  }}
                  onMouseEnter={() => setHoveredKey(seg.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStatusClick(seg.key);
                  }}
                />
              );
            })}
          </svg>

          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              textAlign: 'center',
            }}
          >
            <span style={{ fontSize: '1.25rem', fontWeight: 800, color: activeHoveredItem ? activeHoveredItem.color : 'var(--text-primary)', lineHeight: 1.1, transition: 'color 0.2s ease' }}>
              {activeHoveredItem ? activeHoveredItem.count.toLocaleString() : total.toLocaleString()}
            </span>
            <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '0.15rem', transition: 'color 0.2s ease' }}>
              {activeHoveredItem ? activeHoveredItem.label : 'Incidents'}
            </span>
          </div>
        </div>

        {/* 4 Lifecycle Status Cards in 2x2 Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.65rem', flex: 1, minWidth: '240px' }}>
          {items.map(st => {
            const isSelected = (isActiveDomain === undefined || isActiveDomain) && activeFilter === st.key;
            const isHovered = hoveredKey === st.key;
            const IconComponent = st.icon;

            return (
              <div
                key={st.key}
                onClick={(e) => {
                  e.stopPropagation();
                  handleStatusClick(st.key);
                }}
                onMouseEnter={() => setHoveredKey(st.key)}
                onMouseLeave={() => setHoveredKey(null)}
                style={{
                  padding: '0.65rem 0.8rem',
                  backgroundColor: isSelected ? st.bg : (isHovered ? st.bg : 'var(--bg-primary)'),
                  border: isSelected ? `2px solid ${st.color}` : (isHovered ? `1px solid ${st.color}` : '1px solid var(--border-color)'),
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    <IconComponent size={13} style={{ color: st.color }} />
                    {st.label}
                  </span>
                  <span
                    className="badge"
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      backgroundColor: st.bg,
                      color: st.color,
                      border: `1px solid ${st.color}40`,
                      padding: '0.1rem 0.45rem',
                    }}
                  >
                    {st.pct.toFixed(1)}%
                  </span>
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>
                  {st.count.toLocaleString()}
                </div>
                <div style={{ width: '100%', height: '3px', backgroundColor: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden', marginTop: '0.1rem' }}>
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(st.pct, st.count > 0 ? 3 : 0))}%`,
                      height: '100%',
                      backgroundColor: st.color,
                      borderRadius: '2px',
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

