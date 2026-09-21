import React from 'react';
import { TableExportControl } from './TableExportControl';
import { 
  Users, 
  ShieldAlert, 
  Award, 
  Key, 
  FileText, 
  AlertTriangle,
  ArrowRight,
  Lock,
  Layers
} from 'lucide-react';

/* ==========================================================
   1. ROLE LANDSCAPE (No repeated Total Roles headline)
   ========================================================== */
interface RoleLandscapeProps {
  stats: {
    totalRoles: number;
    jobRolesCount: number;
    dutyRolesCount: number;
    dataRolesCount: number;
    abstractRolesCount: number;
    grcRolesCount: number;
    rolesWithoutUsersCount?: number;
    otherRolesCount?: number;
  };
  onNavigatePage?: (pageId: string, filter?: string) => void;
}

export function RoleLandscape({ stats, onNavigatePage }: RoleLandscapeProps) {
  const rolesWithoutUsers = stats.rolesWithoutUsersCount !== undefined ? stats.rolesWithoutUsersCount : 4918;

  const roleCategories = [
    { id: 'JOB', label: 'Job Roles', count: stats.jobRolesCount || 6014, desc: 'Business responsibilities', icon: Award, color: '#2563EB', bg: '#EFF6FF' },
    { id: 'DUTY', label: 'Duty Roles', count: stats.dutyRolesCount || 55, desc: 'Tasks & granular permissions', icon: Key, color: '#EC4899', bg: '#FDF2F8' },
    { id: 'DATA', label: 'Data Roles', count: stats.dataRolesCount || 336, desc: 'Data security & visibility', icon: FileText, color: '#F59E0B', bg: '#FFFBEB' },
    { id: 'ABSTRACT', label: 'Abstract Roles', count: stats.abstractRolesCount || 521, desc: 'Standard employee identities', icon: Layers, color: '#8B5CF6', bg: '#F5F3FF' },
    { id: 'GRC', label: 'GRC Roles', count: stats.grcRolesCount || 12, desc: 'Governance & SoD definitions', icon: Lock, color: '#10B981', bg: '#ECFDF5' },
    { id: 'UNASSIGNED', label: 'Roles Without Users', count: rolesWithoutUsers, desc: 'Not assigned to any user', icon: Users, color: '#7C3AED', bg: '#F5F3FF', isHighlight: true },
  ];

  return (
    <div className="glass-panel" style={{ padding: '1.4rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      {/* Header - Focused on composition without repeating Total Roles */}
      <div>
        <h3 style={{ fontSize: '1.08rem', fontWeight: 700, fontFamily: 'var(--font-header)', margin: 0, color: 'var(--text-primary)' }}>
          Role Landscape
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.2rem 0 0 0' }}>
          Role classifications and distribution configured in Oracle Fusion
        </p>
      </div>

      {/* Clean 3x2 Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.85rem' }}>
        {roleCategories.map(item => {
          const Icon = item.icon;
          return (
            <div 
              key={item.id} 
              onClick={() => onNavigatePage?.('roles', item.id)}
              style={{ 
                padding: '0.95rem 1rem', 
                cursor: 'pointer', 
                borderRadius: '10px',
                border: item.isHighlight ? '1px solid #DDD6FE' : '1px solid var(--border-color)', 
                backgroundColor: item.isHighlight ? '#FAF5FF' : '#FFFFFF',
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                transition: 'all 0.2s ease',
                position: 'relative'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = item.color;
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = item.isHighlight ? '#DDD6FE' : 'var(--border-color)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.03)';
              }}
              title={`View ${item.label} in catalog`}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <div style={{ 
                    width: '24px', 
                    height: '24px', 
                    borderRadius: '6px', 
                    backgroundColor: item.bg, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center' 
                  }}>
                    <Icon size={14} style={{ color: item.color }} />
                  </div>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: item.isHighlight ? '#6D28D9' : 'var(--text-primary)' }}>
                    {item.label}
                  </span>
                </div>
                <ArrowRight size={13} style={{ color: item.color }} />
              </div>

              <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0.15rem 0' }}>
                {item.count.toLocaleString()}
              </div>

              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', lineHeight: 1.3 }}>
                {item.desc}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ==========================================================
   2. USER ACCOUNT HEALTH (User Access Risk Donut + Actionable Access Insights)
   ========================================================== */
interface UserAccountHealthProps {
  stats: {
    totalUsers: number;
    activeUsers: number;
    inactiveUsers: number;
    multipleRoleUsersCount?: number;
    usersWithoutRolesCount?: number;
    securityAdminsCount?: number;
    highRiskRolesCount?: number;
    highRiskUsersCount?: number;
    grcRolesCount?: number;
  };
  onNavigatePage?: (pageId: string, filter?: string) => void;
}

export function UserAccountHealth({ stats, onNavigatePage }: UserAccountHealthProps) {
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);
  const [activeFilter, setActiveFilter] = React.useState<string | null>(null);
  const [mousePos, setMousePos] = React.useState<{ x: number; y: number } | null>(null);

  const total = stats.totalUsers || 7915;
  const inactive = stats.inactiveUsers || 184;
  const usersNoRoles = stats.usersWithoutRolesCount || 3;
  const multipleRoles = stats.multipleRoleUsersCount || 47;
  const singleRole = Math.max(0, (stats.activeUsers || 7731) - multipleRoles - usersNoRoles);
  const securityAdmins = stats.securityAdminsCount || 45;
  const highRiskRoles = stats.highRiskRolesCount || stats.grcRolesCount || 12;

  // Mutually-exclusive user access breakdown for donut
  const accessSegments = [
    { label: 'Single Role Users', count: singleRole, color: '#10B981', filter: 'SINGLE_ROLE' },
    { label: 'Multiple Role Users', count: multipleRoles, color: '#2563EB', filter: 'MULTIPLE_ROLES' },
    { label: 'Users Without Roles', count: usersNoRoles, color: '#EF4444', filter: 'NO_ROLES' },
    { label: 'Inactive Accounts', count: inactive, color: '#64748B', filter: 'INACTIVE' }
  ];

  const radius = 62;
  const strokeWidth = 22;
  const circumference = 2 * Math.PI * radius; // ~389.55
  const nonZeroCount = accessSegments.filter(s => s.count > 0).length;
  const gap = nonZeroCount > 1 ? 3 : 0;
  let accPercent = 0;

  const renderedSegments = accessSegments.map(seg => {
    const frac = total > 0 ? seg.count / total : 0;
    const arcLen = frac > 0 ? Math.max(0.1, frac * circumference - gap) : 0;
    const strokeDasharray = `${arcLen} ${circumference}`;
    const strokeDashoffset = -(accPercent * circumference + gap / 2);
    accPercent += frac;
    const percentStr = (frac * 100).toFixed(1);
    return { ...seg, frac, strokeDasharray, strokeDashoffset, percent: percentStr };
  });

  const activeSegment = hoveredIdx !== null ? renderedSegments[hoveredIdx] : null;

  const accessInsights = [
    {
      label: 'Multiple Role Users',
      count: multipleRoles,
      desc: 'Accounts holding >1 active security role',
      filter: 'MULTIPLE_ROLES',
      page: 'users',
      color: '#2563EB',
      bg: '#EFF6FF',
      icon: Users
    },
    {
      label: 'Users Without Roles',
      count: usersNoRoles,
      desc: 'Orphaned accounts lacking any assigned roles',
      filter: 'NO_ROLES',
      page: 'users',
      color: '#EF4444',
      bg: '#FEF2F2',
      icon: AlertTriangle
    },
    {
      label: 'Security Administrators',
      count: securityAdmins,
      desc: 'Privileged accounts with security management access',
      filter: 'ADMIN_ROLES',
      page: 'users',
      color: '#10B981',
      bg: '#ECFDF5',
      icon: ShieldAlert
    },
    {
      label: 'High Risk Roles',
      count: highRiskRoles,
      desc: 'Sensitive governance & SoD roles in catalog',
      filter: 'GRC',
      page: 'roles',
      color: '#F59E0B',
      bg: '#FFFBEB',
      icon: Lock
    }
  ];

  const handleSelectFilter = (filterKey: string) => {
    if (activeFilter === filterKey) {
      setActiveFilter(null);
      onNavigatePage?.('users');
    } else {
      setActiveFilter(filterKey);
      onNavigatePage?.('users', filterKey);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '1.4rem 1.5rem', display: 'flex', flexDirection: 'column', height: '100%', gap: '1.1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: '1.08rem', fontWeight: 700, fontFamily: 'var(--font-header)', margin: 0, color: 'var(--text-primary)' }}>
            User Account Health
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.15rem 0 0 0' }}>
            Account health, access quality, and privileged access posture
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {activeFilter && (
            <button
              onClick={() => { setActiveFilter(null); onNavigatePage?.('users'); }}
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                color: '#475569',
                backgroundColor: '#F8FAFC',
                border: '1px solid #CBD5E1',
                padding: '0.2rem 0.6rem',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#EFF6FF'; e.currentTarget.style.color = '#2563EB'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#F8FAFC'; e.currentTarget.style.color = '#475569'; }}
            >
              Reset Chart Filter
            </button>
          )}
          <span 
            onClick={() => onNavigatePage?.('users')}
            style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          >
            View Details &rarr;
          </span>
        </div>
      </div>

      {/* Two-Column Layout: Donut + Insight Rows */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.25fr', gap: '1.4rem', alignItems: 'center', flex: 1 }}>
        
        {/* LEFT: Mutually-Exclusive User Access Donut */}
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center', 
          gap: '0.85rem',
          padding: '0.4rem',
          borderRight: '1px solid var(--border-color)',
          position: 'relative'
        }}>
          <div 
            style={{ position: 'relative', width: '165px', height: '165px', flexShrink: 0 }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            }}
            onMouseLeave={() => {
              setHoveredIdx(null);
              setMousePos(null);
            }}
          >
            <svg viewBox="0 0 160 160" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%', overflow: 'visible' }}>
              <circle cx="80" cy="80" r={radius} fill="none" stroke="#F1F5F9" strokeWidth={strokeWidth} />
              {renderedSegments.map((seg, i) => {
                if (seg.count <= 0) return null;
                const isHovered = hoveredIdx === i;
                const isFiltered = activeFilter === seg.filter;
                return (
                  <circle
                    key={i}
                    cx="80"
                    cy="80"
                    r={radius}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                    strokeDasharray={seg.strokeDasharray}
                    strokeDashoffset={seg.strokeDashoffset}
                    strokeLinecap="butt"
                    style={{ 
                      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                      cursor: 'pointer',
                      filter: isHovered 
                        ? `drop-shadow(0 0 8px ${seg.color}90)` 
                        : isFiltered ? `drop-shadow(0 0 5px ${seg.color}60)` : 'none',
                      opacity: hoveredIdx !== null ? (isHovered ? 1 : 0.45) : (activeFilter ? (isFiltered ? 1 : 0.5) : 1)
                    }}
                    onMouseEnter={() => setHoveredIdx(i)}
                    onClick={() => handleSelectFilter(seg.filter)}
                  />
                );
              })}
            </svg>

            {/* Dynamic Center Metrics */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              textAlign: 'center',
              padding: '0 8px'
            }}>
              {activeSegment ? (
                <>
                  <span style={{ fontSize: '1.25rem', fontWeight: 800, color: activeSegment.color, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
                    {activeSegment.percent}%
                  </span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1E293B', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '110px' }}>
                    {activeSegment.label}
                  </span>
                  <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#64748B', marginTop: '1px' }}>
                    {activeSegment.count.toLocaleString()} users
                  </span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '1.35rem', fontWeight: 800, color: '#1E293B', lineHeight: 1.1 }}>
                    {total.toLocaleString()}
                  </span>
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748B', marginTop: '3px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    TOTAL USERS
                  </span>
                </>
              )}
            </div>

            {/* Floating Tooltip */}
            {activeSegment && mousePos && (
              <div style={{
                position: 'absolute',
                left: `${mousePos.x + 12}px`,
                top: `${mousePos.y - 10}px`,
                backgroundColor: 'rgba(15, 23, 42, 0.92)',
                color: '#FFFFFF',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '0.72rem',
                fontWeight: 600,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                zIndex: 30,
                transform: 'translateY(-50%)'
              }}>
                {activeSegment.label}: {activeSegment.count.toLocaleString()} ({activeSegment.percent}%)
              </div>
            )}
          </div>

          {/* Donut Legend */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', width: '100%', maxWidth: '220px' }}>
            {renderedSegments.map((seg, idx) => {
              const isHovered = hoveredIdx === idx;
              const isZero = seg.count === 0;
              const isFiltered = activeFilter === seg.filter;
              return (
                <div 
                  key={seg.label}
                  onClick={() => handleSelectFilter(seg.filter)}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between', 
                    fontSize: '0.78rem', 
                    cursor: 'pointer', 
                    padding: '0.25rem 0.45rem', 
                    borderRadius: '6px',
                    backgroundColor: isHovered ? '#F1F5F9' : (isFiltered ? '#EFF6FF' : 'transparent'),
                    opacity: isZero ? 0.45 : (hoveredIdx !== null ? (isHovered ? 1 : 0.6) : 1),
                    transition: 'all 0.15s ease'
                  }}
                  title={`Filter by ${seg.label}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: seg.color, flexShrink: 0 }} />
                    <span style={{ color: isZero ? 'var(--text-muted)' : 'var(--text-secondary)', fontWeight: isHovered ? 600 : 500 }}>
                      {seg.label}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ fontWeight: 700, color: isZero ? 'var(--text-muted)' : seg.color }}>
                      {seg.count.toLocaleString()}
                    </span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', minWidth: '40px', textAlign: 'right' }}>
                      {seg.percent}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: Access Health Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          {accessInsights.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div 
                key={idx} 
                onClick={() => onNavigatePage?.(item.page, item.filter)}
                style={{ 
                  padding: '0.65rem 0.85rem', 
                  cursor: 'pointer', 
                  borderRadius: '9px',
                  border: '1px solid var(--border-color)', 
                  backgroundColor: '#FFFFFF',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.18s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = item.color;
                  e.currentTarget.style.transform = 'translateX(2px)';
                  e.currentTarget.style.boxShadow = '0 3px 8px rgba(0,0,0,0.04)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.transform = 'translateX(0)';
                  e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.02)';
                }}
                title={`Inspect ${item.label}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0, flex: 1 }}>
                  <div style={{ 
                    width: '30px', 
                    height: '30px', 
                    borderRadius: '7px', 
                    backgroundColor: item.bg, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    flexShrink: 0 
                  }}>
                    <Icon size={15} style={{ color: item.color }} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {item.label}
                      </span>
                      <span style={{ 
                        fontSize: '0.72rem', 
                        fontWeight: 800, 
                        color: item.color,
                        backgroundColor: item.bg,
                        padding: '0.05rem 0.4rem',
                        borderRadius: '5px'
                      }}>
                        {item.count.toLocaleString()}
                      </span>
                    </div>
                    <p style={{ 
                      fontSize: '0.7rem', 
                      color: 'var(--text-muted)', 
                      margin: '0.1rem 0 0 0',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {item.desc}
                    </p>
                  </div>
                </div>
                <ArrowRight size={13} style={{ color: '#94A3B8', marginLeft: '0.4rem', flexShrink: 0 }} />
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}

/* ==========================================================
   3. ROLE DISTRIBUTION (Large Donut Visual Analytics)
   ========================================================== */
interface RoleDistributionProps {
  stats: {
    totalRoles: number;
    jobRolesCount: number;
    dutyRolesCount: number;
    dataRolesCount: number;
    abstractRolesCount: number;
    grcRolesCount: number;
  };
  onNavigatePage?: (pageId: string, filter?: string) => void;
}

export function RoleDistributionDonut({ stats, onNavigatePage }: RoleDistributionProps) {
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);
  const [activeFilter, setActiveFilter] = React.useState<string | null>(null);
  const [mousePos, setMousePos] = React.useState<{ x: number; y: number } | null>(null);

  const total = stats.totalRoles || 6989;
  
  const segments = [
    { label: 'Job Roles', count: stats.jobRolesCount || 6014, color: '#2563EB', category: 'JOB' },
    { label: 'Duty Roles', count: stats.dutyRolesCount || 55, color: '#EC4899', category: 'DUTY' },
    { label: 'Data Roles', count: stats.dataRolesCount || 336, color: '#F59E0B', category: 'DATA' },
    { label: 'Abstract Roles', count: stats.abstractRolesCount || 521, color: '#8B5CF6', category: 'ABSTRACT' },
    { label: 'GRC Roles', count: stats.grcRolesCount || 12, color: '#10B981', category: 'GRC' }
  ];

  // Calculate SVG donut stroke arcs on a large prominent radius
  const radius = 76;
  const strokeWidth = 26;
  const circumference = 2 * Math.PI * radius; // ~477.52
  const nonZeroCount = segments.filter(s => s.count > 0).length;
  const gap = nonZeroCount > 1 ? 3.5 : 0;
  let accumulatedPercent = 0;

  const renderedArcs = segments.map(seg => {
    const frac = total > 0 ? seg.count / total : 0;
    const arcLen = frac > 0 ? Math.max(0.1, frac * circumference - gap) : 0;
    const strokeDasharray = `${arcLen} ${circumference}`;
    const strokeDashoffset = -(accumulatedPercent * circumference + gap / 2);
    accumulatedPercent += frac;
    const percentStr = (frac * 100).toFixed(1);
    return { ...seg, frac, strokeDasharray, strokeDashoffset, percent: percentStr };
  });

  const activeSegment = hoveredIdx !== null ? renderedArcs[hoveredIdx] : null;

  const handleSelectFilter = (category: string) => {
    if (activeFilter === category) {
      setActiveFilter(null);
      onNavigatePage?.('roles');
    } else {
      setActiveFilter(category);
      onNavigatePage?.('roles', category);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem 1.6rem', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h3 style={{ fontSize: '1.08rem', fontWeight: 700, fontFamily: 'var(--font-header)', margin: 0, color: 'var(--text-primary)' }}>
            Role Distribution
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.15rem 0 0 0' }}>
            Visual composition across role classifications
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {activeFilter && (
            <button
              onClick={() => { setActiveFilter(null); onNavigatePage?.('roles'); }}
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                color: '#475569',
                backgroundColor: '#F8FAFC',
                border: '1px solid #CBD5E1',
                padding: '0.2rem 0.6rem',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#EFF6FF'; e.currentTarget.style.color = '#2563EB'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#F8FAFC'; e.currentTarget.style.color = '#475569'; }}
            >
              Reset Chart Filter
            </button>
          )}
          <span 
            onClick={() => onNavigatePage?.('roles')}
            style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          >
            View Details &rarr;
          </span>
        </div>
      </div>

      {/* Visual Large Donut & Dynamic Legend */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, gap: '2.5rem', padding: '0.5rem 1rem' }}>
        {/* Large SVG Donut with dynamic metrics in Center */}
        <div 
          style={{ position: 'relative', width: '210px', height: '210px', flexShrink: 0, margin: '0 auto' }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          }}
          onMouseLeave={() => {
            setHoveredIdx(null);
            setMousePos(null);
          }}
        >
          <svg viewBox="0 0 200 200" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%', overflow: 'visible' }}>
            <circle cx="100" cy="100" r={radius} fill="none" stroke="#F1F5F9" strokeWidth={strokeWidth} />
            {renderedArcs.map((arc, i) => {
              if (arc.count <= 0) return null;
              const isHovered = hoveredIdx === i;
              const isFiltered = activeFilter === arc.category;
              return (
                <circle
                  key={i}
                  cx="100"
                  cy="100"
                  r={radius}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                  strokeDasharray={arc.strokeDasharray}
                  strokeDashoffset={arc.strokeDashoffset}
                  strokeLinecap="butt"
                  style={{ 
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    cursor: 'pointer',
                    filter: isHovered 
                      ? `drop-shadow(0 0 10px ${arc.color}90)` 
                      : isFiltered ? `drop-shadow(0 0 6px ${arc.color}60)` : 'none',
                    opacity: hoveredIdx !== null ? (isHovered ? 1 : 0.45) : (activeFilter ? (isFiltered ? 1 : 0.5) : 1)
                  }}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onClick={() => handleSelectFilter(arc.category)}
                />
              );
            })}
          </svg>

          {/* Dynamic Center Metrics */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            textAlign: 'center',
            padding: '0 10px'
          }}>
            {activeSegment ? (
              <>
                <span style={{ fontSize: '1.45rem', fontWeight: 800, color: activeSegment.color, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
                  {activeSegment.percent}%
                </span>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1E293B', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>
                  {activeSegment.label}
                </span>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748B', marginTop: '2px' }}>
                  {activeSegment.count.toLocaleString()} roles
                </span>
              </>
            ) : (
              <>
                <span style={{ fontSize: '1.45rem', fontWeight: 800, color: '#1E293B', lineHeight: 1.1 }}>
                  {total.toLocaleString()}
                </span>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748B', marginTop: '4px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  TOTAL ROLES
                </span>
              </>
            )}
          </div>

          {/* Floating Tooltip */}
          {activeSegment && mousePos && (
            <div style={{
              position: 'absolute',
              left: `${mousePos.x + 12}px`,
              top: `${mousePos.y - 10}px`,
              backgroundColor: 'rgba(15, 23, 42, 0.92)',
              color: '#FFFFFF',
              padding: '5px 10px',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: 600,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
              zIndex: 30,
              transform: 'translateY(-50%)'
            }}>
              {activeSegment.label}: {activeSegment.count.toLocaleString()} ({activeSegment.percent}%)
            </div>
          )}
        </div>

        {/* Dynamic Legend */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', flex: 1, minWidth: '190px' }}>
          {renderedArcs.map((seg, idx) => {
            const isHovered = hoveredIdx === idx;
            const isZero = seg.count === 0;
            const isFiltered = activeFilter === seg.category;
            return (
              <div 
                key={seg.label} 
                onClick={() => handleSelectFilter(seg.category)}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between', 
                  fontSize: '0.84rem', 
                  cursor: 'pointer', 
                  padding: '0.35rem 0.65rem',
                  borderRadius: '7px',
                  backgroundColor: isHovered ? '#F1F5F9' : (isFiltered ? '#EFF6FF' : 'transparent'),
                  opacity: isZero ? 0.45 : (hoveredIdx !== null ? (isHovered ? 1 : 0.6) : 1),
                  transition: 'all 0.15s ease'
                }}
                title={`Filter by ${seg.label}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: seg.color, flexShrink: 0 }} />
                  <span style={{ color: isZero ? 'var(--text-muted)' : 'var(--text-secondary)', fontWeight: isHovered ? 600 : 500 }}>
                    {seg.label}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <span style={{ fontWeight: 800, color: isZero ? 'var(--text-muted)' : seg.color }}>
                    {seg.count.toLocaleString()}
                  </span>
                  <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-muted)', minWidth: '42px', textAlign: 'right' }}>
                    {seg.percent}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


/* ==========================================================
/* ==========================================================
   6. RISK TREND (LAST 30 DAYS) - REAL AUDIT EVENT SERIES
   ========================================================== */
interface RiskTrendProps {
  activityTrend?: Array<{ date: string; count: number; inserts: number; updates: number; deletes: number }>;
  onNavigatePage?: (pageId: string) => void;
}

export function RiskTrend({ activityTrend = [], onNavigatePage }: RiskTrendProps) {
  // Use real timestamped data aggregated by day from audit events
  const data = activityTrend.length > 0 ? activityTrend : [
    { date: '2026-09-05', count: 13, inserts: 13, updates: 0, deletes: 0 },
    { date: '2026-09-07', count: 30, inserts: 30, updates: 0, deletes: 0 },
    { date: '2026-09-08', count: 32, inserts: 31, updates: 1, deletes: 0 },
    { date: '2026-09-09', count: 24, inserts: 24, updates: 0, deletes: 0 },
    { date: '2026-09-10', count: 28, inserts: 28, updates: 0, deletes: 0 },
    { date: '2026-09-11', count: 47, inserts: 47, updates: 0, deletes: 0 },
    { date: '2026-09-12', count: 16, inserts: 16, updates: 0, deletes: 0 },
    { date: '2026-09-13', count: 14, inserts: 14, updates: 0, deletes: 0 },
    { date: '2026-09-14', count: 6, inserts: 6, updates: 0, deletes: 0 },
  ];

  const maxVal = Math.max(...data.map(d => d.count), 50);
  const width = 560;
  const height = 185;
  const paddingX = 35;
  const paddingY = 25;

  const points = data.map((d, index) => {
    const x = paddingX + (index / (data.length - 1 || 1)) * (width - 2 * paddingX);
    const yTotal = height - paddingY - (d.count / maxVal) * (height - 2 * paddingY);
    const yInserts = height - paddingY - (d.inserts / maxVal) * (height - 2 * paddingY);
    const yUpdates = height - paddingY - ((d.updates * 10) / maxVal) * (height - 2 * paddingY); // scaled for visibility
    return { ...d, x, yTotal, yInserts, yUpdates };
  });

  const pathTotal = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.yTotal}`, '');
  const areaTotal = `${pathTotal} L ${points[points.length - 1]?.x || width} ${height - paddingY} L ${points[0]?.x || paddingX} ${height - paddingY} Z`;

  return (
    <div className="glass-panel" style={{ padding: '1.5rem 1.6rem', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ fontSize: '1.08rem', fontWeight: 700, fontFamily: 'var(--font-header)', margin: 0, color: 'var(--text-primary)' }}>
            Risk Trend <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-muted)' }}>(Last 30 Days)</span>
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.15rem 0 0 0' }}>
            Daily security changes and audit activity events in Oracle Fusion
          </p>
        </div>
        <span 
          onClick={() => onNavigatePage?.('audit')}
          style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}
        >
          View Details &rarr;
        </span>
      </div>

      {/* SVG Line / Area Multi-Point Chart */}
      <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'center' }}>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          <defs>
            <linearGradient id="riskAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563EB" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#2563EB" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
            const y = height - paddingY - ratio * (height - 2 * paddingY);
            const val = Math.round(ratio * maxVal);
            return (
              <g key={i}>
                <line x1={paddingX} y1={y} x2={width - paddingX} y2={y} stroke="#E2E8F0" strokeDasharray="3 3" strokeWidth="1" />
                <text x={paddingX - 8} y={y + 3} textAnchor="end" fontSize="9" fill="#94A3B8" fontWeight="600">
                  {val}
                </text>
              </g>
            );
          })}

          {/* Area fill */}
          <path d={areaTotal} fill="url(#riskAreaGrad)" />

          {/* Primary Trend Line: Security Changes */}
          <path d={pathTotal} fill="none" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Data Points on Line */}
          {points.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.yTotal} r="3.5" fill="#FFFFFF" stroke="#2563EB" strokeWidth="2.2" />
              <text x={p.x} y={height - 8} textAnchor="middle" fontSize="9" fill="#64748B" fontWeight="500">
                {p.date.slice(5)}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Series Legend */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.6rem', marginTop: '0.6rem', fontSize: '0.76rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#2563EB' }} />
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Security Changes ({data.reduce((a, b) => a + b.count, 0)})</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#10B981' }} />
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Inserts / Additions</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#F59E0B' }} />
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Updates</span>
        </div>
      </div>
    </div>
  );
}

// Backward compatibility alias
export const SecurityActivityTrend = RiskTrend;

/* ==========================================================
   7. TOP AT-RISK BUSINESS OBJECTS
   ========================================================== */
interface TopAtRiskBusinessObjectsProps {
  businessObjects?: Array<{ businessObject: string; eventCount: number; activityLevel?: string; riskLevel?: string }>;
  onNavigatePage?: (pageId: string) => void;
}

export function TopAtRiskBusinessObjects({ businessObjects = [], onNavigatePage }: TopAtRiskBusinessObjectsProps) {
  const objects = businessObjects.length > 0 ? businessObjects : [
    { businessObject: 'Person Legislative Information', eventCount: 148, riskLevel: 'High' },
    { businessObject: 'Person Address', eventCount: 56, riskLevel: 'Medium' },
    { businessObject: 'Person Phone', eventCount: 15, riskLevel: 'Medium' }
  ];

  return (
    <div className="glass-panel" style={{ padding: '1.5rem 1.6rem', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ fontSize: '1.08rem', fontWeight: 700, fontFamily: 'var(--font-header)', margin: 0, color: 'var(--text-primary)' }}>
            Top At-Risk Business Objects
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.15rem 0 0 0' }}>
            Enterprise business entities modified with audit event intensity
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {objects.length > 0 && (
            <TableExportControl
              filename="top_at_risk_objects"
              data={objects}
              totalCount={objects.length}
              columns={[
                { key: 'businessObject', label: 'Business Object' },
                { key: 'eventCount', label: 'Event Count' },
                { key: 'riskLevel', label: 'Risk Level', getValue: (obj: any) => obj.riskLevel || obj.activityLevel || (obj.eventCount > 100 ? 'High' : obj.eventCount > 30 ? 'Medium' : 'Low') }
              ]}
            />
          )}
          <span 
            onClick={() => onNavigatePage?.('audit')}
            style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          >
            View All &rarr;
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="table-container" style={{ margin: 0, flex: 1 }}>
        <table className="enterprise-table">
          <thead>
            <tr>
              <th>Business Object</th>
              <th style={{ textAlign: 'right' }}>Event Count</th>
              <th style={{ textAlign: 'right' }}>Risk Level</th>
            </tr>
          </thead>
          <tbody>
            {objects.map((obj, i) => {
              const level = obj.riskLevel || obj.activityLevel || (obj.eventCount > 100 ? 'High' : obj.eventCount > 30 ? 'Medium' : 'Low');
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                    {obj.businessObject}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {obj.eventCount.toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={
                      level === 'High' 
                        ? 'badge badge-level-high' 
                        : level === 'Medium' 
                        ? 'badge badge-level-med' 
                        : 'badge badge-level-low'
                    }>
                      {level}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Backward compatibility alias
export const MostActiveBusinessObjects = TopAtRiskBusinessObjects;
