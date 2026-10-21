import React from 'react';
import { TableExportControl } from './TableExportControl';
import { api } from '../services/api';
import { 
  Users, 
  ShieldAlert, 
  Award, 
  Key, 
  FileText, 
  AlertTriangle,
  ArrowRight,
  Lock,
  Layers,
  Calendar,
  Filter,
  RefreshCw,
  TrendingUp,
  Activity,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  UserX
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
  const roleCategories: Array<{ id: string; label: string; count: number; desc: string; icon: any; color: string; bg: string; isHighlight?: boolean }> = [
    { id: 'JOB', label: 'Job Roles', count: stats.jobRolesCount || 6014, desc: 'Business responsibilities', icon: Award, color: '#2563EB', bg: '#EFF6FF' },
    { id: 'DUTY', label: 'Duty Roles', count: stats.dutyRolesCount || 55, desc: 'Tasks & granular permissions', icon: Key, color: '#EC4899', bg: '#FDF2F8' },
    { id: 'DATA', label: 'Data Roles', count: stats.dataRolesCount || 336, desc: 'Data security & visibility', icon: FileText, color: '#F59E0B', bg: '#FFFBEB' },
    { id: 'ABSTRACT', label: 'Abstract Roles', count: stats.abstractRolesCount || 521, desc: 'Standard employee identities', icon: Layers, color: '#8B5CF6', bg: '#F5F3FF' },
    { id: 'GRC', label: 'GRC Roles', count: stats.grcRolesCount || 12, desc: 'Governance & SoD definitions', icon: Lock, color: '#10B981', bg: '#ECFDF5' },
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
    singleRoleUsersCount?: number;
    activeUsersWithoutRolesCount?: number;
    securityAdminsCount?: number;
    highRiskRolesCount?: number;
    highRiskUsersCount?: number;
    grcRolesCount?: number;
    rolesWithoutUsersCount?: number;
    userAccountHealth?: any;
  };
  onNavigatePage?: (pageId: string, filter?: string) => void;
}

export function UserAccountHealth({ stats, onNavigatePage }: UserAccountHealthProps) {
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);
  const [activeFilter, setActiveFilter] = React.useState<string | null>(null);
  const [mousePos, setMousePos] = React.useState<{ x: number; y: number } | null>(null);

  const total = stats.totalUsers || 2993;
  const inactive = stats.inactiveUsers !== undefined 
    ? stats.inactiveUsers 
    : (stats.userAccountHealth?.inactiveUsers !== undefined ? stats.userAccountHealth.inactiveUsers : 2035);
  const usersNoRoles = stats.usersWithoutRolesCount !== undefined ? stats.usersWithoutRolesCount : 2018;
  const activeUsersWithoutRoles = stats.activeUsersWithoutRolesCount !== undefined 
    ? stats.activeUsersWithoutRolesCount 
    : (stats.userAccountHealth?.activeUsersWithoutRoles !== undefined ? stats.userAccountHealth.activeUsersWithoutRoles : 3);
  const multipleRoles = stats.multipleRoleUsersCount !== undefined 
    ? stats.multipleRoleUsersCount 
    : (stats.userAccountHealth?.multipleRoleUsers !== undefined ? stats.userAccountHealth.multipleRoleUsers : 881);
  const singleRole = stats.singleRoleUsersCount !== undefined 
    ? stats.singleRoleUsersCount 
    : (stats.userAccountHealth?.singleRoleUsers !== undefined ? stats.userAccountHealth.singleRoleUsers : 94);
  const securityAdmins = stats.securityAdminsCount !== undefined ? stats.securityAdminsCount : 446;
  const highRiskRoles = stats.highRiskRolesCount || stats.grcRolesCount || 12;
  const rolesWithoutUsers = stats.rolesWithoutUsersCount !== undefined ? stats.rolesWithoutUsersCount : 249;

  // Mutually-exclusive user access breakdown for donut (Single + Multiple + Without Roles = Total)
  const accessSegments = [
    { label: 'Single Role Users', count: singleRole, color: '#10B981', filter: 'SINGLE_ROLE' },
    { label: 'Multiple Role Users', count: multipleRoles, color: '#2563EB', filter: 'MULTIPLE_ROLES' },
    { label: 'Users Without Roles', count: usersNoRoles, color: '#EF4444', filter: 'NO_ROLES' }
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
      label: 'Inactive Users',
      count: inactive,
      desc: 'Dormant or de-provisioned accounts',
      filter: 'INACTIVE',
      page: 'users',
      color: '#EF4444',
      bg: '#FEF2F2',
      icon: UserX
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
    },
    {
      label: 'Roles Without Users',
      count: rolesWithoutUsers,
      desc: 'Not assigned to any user',
      filter: 'UNASSIGNED',
      page: 'roles',
      color: '#7C3AED',
      bg: '#F5F3FF',
      icon: Users
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

  const segments = [
    { label: 'Job Roles', count: stats.jobRolesCount || 6014, color: '#2563EB', category: 'JOB' },
    { label: 'Duty Roles', count: stats.dutyRolesCount || 55, color: '#EC4899', category: 'DUTY' },
    { label: 'Data Roles', count: stats.dataRolesCount || 336, color: '#F59E0B', category: 'DATA' },
    { label: 'Abstract Roles', count: stats.abstractRolesCount || 521, color: '#8B5CF6', category: 'ABSTRACT' },
    { label: 'GRC Roles', count: stats.grcRolesCount || 12, color: '#10B981', category: 'GRC' }
  ];

  const segmentSum = segments.reduce((acc, s) => acc + (s.count || 0), 0);
  const total = segmentSum > 0 ? (stats.totalRoles && stats.totalRoles >= segmentSum ? stats.totalRoles : segmentSum) : (stats.totalRoles || 6989);

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
   6. RISK TREND - PRODUCT-LEVEL & EVENT-TYPE TIME SERIES
   ========================================================== */
interface RiskTrendProps {
  activityTrend?: Array<{ date: string; count: number; inserts: number; updates: number; deletes: number }>;
  onNavigatePage?: (pageId: string) => void;
}

const DEFAULT_PRODUCTS = [
  'Applications Common Components',
  'Audit Policies',
  'Common CRM',
  'General Ledger',
  'Global Human Resources',
  'Inventory Management',
  'Oracle Platform Security Services',
  'Payables',
  'Profile Management',
  'Public Sector Common Components',
  'Quality Issue and Action Management',
  'Receivables',
  'Service'
];

export function RiskTrend({ activityTrend = [], onNavigatePage }: RiskTrendProps) {
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);
  const [activeSeries, setActiveSeries] = React.useState<'ALL' | 'TOTAL' | 'INSERTS' | 'UPDATES' | 'DELETES'>('ALL');

  // Interactive filters
  const [selectedProduct, setSelectedProduct] = React.useState<string>('ALL');
  const [selectedEventType, setSelectedEventType] = React.useState<string>('ALL');
  const [selectedInterval, setSelectedInterval] = React.useState<'7d' | '30d' | '90d' | 'jan_to_now' | 'custom'>('30d');
  const [customFrom, setCustomFrom] = React.useState<string>('2026-01-01');
  const [customTo, setCustomTo] = React.useState<string>(() => new Date().toISOString().split('T')[0]);
  const [isCustomDateOpen, setIsCustomDateOpen] = React.useState<boolean>(false);

  const [productsList, setProductsList] = React.useState<string[]>(DEFAULT_PRODUCTS);
  const [trendData, setTrendData] = React.useState<Array<{ date: string; count: number; inserts: number; updates: number; deletes: number }>>(activityTrend);
  const [summaryData, setSummaryData] = React.useState<{
    totalEvents: number;
    totalInserts: number;
    totalUpdates: number;
    totalDeletes: number;
    peakDate: string | null;
    peakCount: number;
  }>({
    totalEvents: 0,
    totalInserts: 0,
    totalUpdates: 0,
    totalDeletes: 0,
    peakDate: null,
    peakCount: 0
  });
  const [isLoading, setIsLoading] = React.useState<boolean>(false);

  // Sync initial props
  React.useEffect(() => {
    if (activityTrend.length > 0 && trendData.length === 0) {
      setTrendData(activityTrend);
    }
  }, [activityTrend]);

  // Fetch updated trend whenever filter changes
  const fetchTrend = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getRiskTrend({
        product: selectedProduct,
        eventType: selectedEventType,
        range: selectedInterval,
        fromDate: selectedInterval === 'custom' ? customFrom : undefined,
        toDate: selectedInterval === 'custom' ? customTo : undefined
      });

      if (res?.success && res?.data) {
        setTrendData(res.data.trend || []);
        if (res.data.summary) {
          setSummaryData(res.data.summary);
        }
        if (Array.isArray(res.data.products) && res.data.products.length > 0) {
          setProductsList(res.data.products);
        }
      }
    } catch (err) {
      console.error('[RiskTrend] Failed to fetch updated risk trend:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedProduct, selectedEventType, selectedInterval, customFrom, customTo]);

  React.useEffect(() => {
    fetchTrend();
  }, [fetchTrend]);

  // Fallback data if completely empty
  const data = trendData.length > 0 ? trendData : (activityTrend.length > 0 ? activityTrend : [
    { date: '2026-09-28', count: 68, inserts: 55, updates: 13, deletes: 0 },
    { date: '2026-09-30', count: 147, inserts: 120, updates: 27, deletes: 0 },
    { date: '2026-10-01', count: 289, inserts: 260, updates: 29, deletes: 0 },
    { date: '2026-10-02', count: 144, inserts: 135, updates: 9, deletes: 0 },
    { date: '2026-10-06', count: 201, inserts: 195, updates: 6, deletes: 0 },
    { date: '2026-10-07', count: 204, inserts: 198, updates: 6, deletes: 0 }
  ]);

  const totalEvents = summaryData.totalEvents > 0 ? summaryData.totalEvents : data.reduce((a, b) => a + (b.count || 0), 0);
  const totalInserts = summaryData.totalInserts > 0 ? summaryData.totalInserts : data.reduce((a, b) => a + (b.inserts || 0), 0);
  const totalUpdates = summaryData.totalUpdates > 0 ? summaryData.totalUpdates : data.reduce((a, b) => a + (b.updates || 0), 0);
  const totalDeletes = summaryData.totalDeletes > 0 ? summaryData.totalDeletes : data.reduce((a, b) => a + (b.deletes || 0), 0);

  // Dynamic scaling
  const highestDaily = Math.max(...data.map(d => Math.max(d.count || 0, d.inserts || 0, d.updates || 0, d.deletes || 0)), 1);
  const maxVal = highestDaily > 30 ? Math.ceil(highestDaily * 1.25) : highestDaily > 8 ? Math.ceil(highestDaily * 1.35) : Math.max(highestDaily + 2, 5);

  const width = 720;
  const height = 150;
  const paddingX = 40;
  const paddingY = 22;

  const points = data.map((d, index) => {
    const x = paddingX + (index / (data.length - 1 || 1)) * (width - 2 * paddingX);
    const yTotal = height - paddingY - (d.count / maxVal) * (height - 2 * paddingY);
    const yInserts = height - paddingY - ((d.inserts || 0) / maxVal) * (height - 2 * paddingY);
    const yUpdates = height - paddingY - ((d.updates || 0) / maxVal) * (height - 2 * paddingY);
    const yDeletes = height - paddingY - ((d.deletes || 0) / maxVal) * (height - 2 * paddingY);
    return { ...d, x, yTotal, yInserts, yUpdates, yDeletes };
  });

  const pathTotal = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.yTotal}`, '');
  const areaTotal = `${pathTotal} L ${points[points.length - 1]?.x || width} ${height - paddingY} L ${points[0]?.x || paddingX} ${height - paddingY} Z`;
  
  const pathInserts = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.yInserts}`, '');
  const areaInserts = `${pathInserts} L ${points[points.length - 1]?.x || width} ${height - paddingY} L ${points[0]?.x || paddingX} ${height - paddingY} Z`;

  const pathUpdates = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.yUpdates}`, '');
  const pathDeletes = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.yDeletes}`, '');

  const hoveredPoint = hoveredIdx !== null && points[hoveredIdx] ? points[hoveredIdx] : null;

  // Smart tick decimation to avoid overcrowded X-axis
  const tickStep = data.length > 50 ? Math.ceil(data.length / 8) : data.length > 20 ? Math.ceil(data.length / 7) : 1;
  const isTickVisible = (i: number) => i === 0 || i === data.length - 1 || i % tickStep === 0;

  // Format date interval label for header
  const getIntervalLabel = () => {
    switch (selectedInterval) {
      case '7d': return 'Last 7 Days';
      case '30d': return 'Last 30 Days';
      case '90d': return 'Last 90 Days';
      case 'jan_to_now': return '2026 Full Range (Jan 01 – Present)';
      case 'custom': return `${customFrom} to ${customTo}`;
      default: return 'Last 30 Days';
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.9rem', position: 'relative' }}>
      
      {/* 1. Header Bar: Title + Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.8rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h3 style={{ fontSize: '1.12rem', fontWeight: 700, fontFamily: 'var(--font-header)', margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <TrendingUp style={{ width: 19, height: 19, color: '#EF4444' }} />
              Risk Trend
            </h3>
            <span style={{ 
              fontSize: '0.74rem', 
              fontWeight: 600, 
              color: '#3B82F6', 
              backgroundColor: '#EFF6FF', 
              border: '1px solid #BFDBFE',
              padding: '0.15rem 0.6rem', 
              borderRadius: '9999px' 
            }}>
              {getIntervalLabel()}
            </span>
            {isLoading && (
              <RefreshCw style={{ width: 14, height: 14, color: '#64748B', animation: 'spin 1s linear infinite' }} />
            )}
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.2rem 0 0 0' }}>
            Multi-tier event security changes & audit activity tracking in Oracle Fusion
          </p>
        </div>

        {/* View Details Link */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          {activeSeries !== 'ALL' && (
            <button
              onClick={() => setActiveSeries('ALL')}
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                color: '#475569',
                backgroundColor: '#F8FAFC',
                border: '1px solid #CBD5E1',
                padding: '0.22rem 0.55rem',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Reset Series Filter
            </button>
          )}
          <span
            onClick={() => onNavigatePage?.('audit')}
            style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          >
            Audit Trail &rarr;
          </span>
        </div>
      </div>

      {/* 2. Interactive Scope & Interval Controls Bar */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        flexWrap: 'wrap', 
        gap: '0.85rem',
        padding: '0.65rem 0.85rem',
        backgroundColor: 'rgba(248, 250, 252, 0.85)',
        border: '1px solid #E2E8F0',
        borderRadius: '10px'
      }}>
        {/* Left: Product & Event Type Dropdowns */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap' }}>
          
          {/* Product Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Product:
            </span>
            <select
              value={selectedProduct}
              onChange={(e) => setSelectedProduct(e.target.value)}
              style={{
                fontSize: '0.78rem',
                fontWeight: 600,
                color: '#1E293B',
                backgroundColor: '#FFFFFF',
                border: '1px solid #CBD5E1',
                borderRadius: '6px',
                padding: '0.28rem 0.65rem',
                cursor: 'pointer',
                outline: 'none',
                maxWidth: '230px'
              }}
            >
              <option value="ALL">All Products (Enterprise Scope)</option>
              {productsList.map((prod) => (
                <option key={prod} value={prod}>{prod}</option>
              ))}
            </select>
          </div>

          {/* Event Type Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Event Type:
            </span>
            <select
              value={selectedEventType}
              onChange={(e) => setSelectedEventType(e.target.value)}
              style={{
                fontSize: '0.78rem',
                fontWeight: 600,
                color: selectedEventType === 'INSERT' ? '#DC2626' : selectedEventType === 'UPDATE' ? '#2563EB' : selectedEventType === 'DELETE' ? '#7C3AED' : '#1E293B',
                backgroundColor: '#FFFFFF',
                border: selectedEventType === 'INSERT' ? '1px solid #FCA5A5' : '1px solid #CBD5E1',
                borderRadius: '6px',
                padding: '0.28rem 0.65rem',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              <option value="ALL">All Events</option>
              <option value="INSERT">🔴 Inserts / Additions (New Records)</option>
              <option value="UPDATE">🔵 Updates / Modifications</option>
              <option value="DELETE">🟣 Deletions / Revocations</option>
            </select>
          </div>
        </div>

        {/* Right: Date Interval Selector (Pills) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.03em', marginRight: '0.25rem' }}>
            Interval:
          </span>

          {[
            { id: '7d', label: '7 Days' },
            { id: '30d', label: '30 Days' },
            { id: '90d', label: '90 Days' },
            { id: 'jan_to_now', label: 'Jan to Now (YTD)' },
            { id: 'custom', label: 'Custom' }
          ].map((item) => {
            const isSelected = selectedInterval === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setSelectedInterval(item.id as any);
                  if (item.id === 'custom') {
                    setIsCustomDateOpen(true);
                  } else {
                    setIsCustomDateOpen(false);
                  }
                }}
                style={{
                  fontSize: '0.74rem',
                  fontWeight: isSelected ? 700 : 500,
                  color: isSelected ? '#FFFFFF' : '#475569',
                  backgroundColor: isSelected ? '#2563EB' : '#FFFFFF',
                  border: isSelected ? '1px solid #1D4ED8' : '1px solid #E2E8F0',
                  padding: '0.24rem 0.6rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2B. Custom Date Input Drawer (Shown when Custom is selected) */}
      {(selectedInterval === 'custom' || isCustomDateOpen) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          padding: '0.55rem 0.85rem',
          backgroundColor: '#EFF6FF',
          border: '1px dashed #93C5FD',
          borderRadius: '8px',
          fontSize: '0.75rem',
          flexWrap: 'wrap'
        }}>
          <span style={{ fontWeight: 600, color: '#1E40AF', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Calendar style={{ width: 14, height: 14 }} /> Custom Date Range:
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ color: '#475569' }}>From:</span>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              style={{
                fontSize: '0.74rem',
                border: '1px solid #CBD5E1',
                borderRadius: '5px',
                padding: '0.2rem 0.45rem',
                backgroundColor: '#FFFFFF'
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ color: '#475569' }}>To:</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              style={{
                fontSize: '0.74rem',
                border: '1px solid #CBD5E1',
                borderRadius: '5px',
                padding: '0.2rem 0.45rem',
                backgroundColor: '#FFFFFF'
              }}
            />
          </div>
          <button
            onClick={() => fetchTrend()}
            style={{
              fontSize: '0.72rem',
              fontWeight: 600,
              color: '#FFFFFF',
              backgroundColor: '#1D4ED8',
              border: 'none',
              padding: '0.25rem 0.75rem',
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            Apply Range
          </button>
        </div>
      )}

      {/* 3. Summary Metric Stat Chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ 
          fontSize: '0.75rem', 
          backgroundColor: '#F8FAFC', 
          border: '1px solid #E2E8F0', 
          borderRadius: '6px', 
          padding: '0.22rem 0.6rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}>
          <span style={{ color: '#64748B' }}>Total Events:</span>
          <strong style={{ color: '#0F172A' }}>{totalEvents.toLocaleString()}</strong>
        </div>

        {/* REQUIRED: Insertions Highlighted in RED */}
        <div style={{ 
          fontSize: '0.75rem', 
          backgroundColor: '#FEF2F2', 
          border: '1px solid #FECACA', 
          borderRadius: '6px', 
          padding: '0.22rem 0.6rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#EF4444' }} />
          <span style={{ color: '#991B1B', fontWeight: 600 }}>Inserts / Additions:</span>
          <strong style={{ color: '#DC2626' }}>{totalInserts.toLocaleString()}</strong>
        </div>

        <div style={{ 
          fontSize: '0.75rem', 
          backgroundColor: '#EFF6FF', 
          border: '1px solid #BFDBFE', 
          borderRadius: '6px', 
          padding: '0.22rem 0.6rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#3B82F6' }} />
          <span style={{ color: '#1E40AF', fontWeight: 600 }}>Updates:</span>
          <strong style={{ color: '#2563EB' }}>{totalUpdates.toLocaleString()}</strong>
        </div>

        <div style={{ 
          fontSize: '0.75rem', 
          backgroundColor: '#F5F3FF', 
          border: '1px solid #DDD6FE', 
          borderRadius: '6px', 
          padding: '0.22rem 0.6rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#8B5CF6' }} />
          <span style={{ color: '#5B21B6', fontWeight: 600 }}>Deletions:</span>
          <strong style={{ color: '#7C3AED' }}>{totalDeletes.toLocaleString()}</strong>
        </div>

        {summaryData.peakDate && (
          <div style={{ 
            fontSize: '0.75rem', 
            backgroundColor: '#FFFBEB', 
            border: '1px solid #FDE68A', 
            borderRadius: '6px', 
            padding: '0.22rem 0.6rem',
            marginLeft: 'auto',
            color: '#92400E'
          }}>
            Peak: <strong>{summaryData.peakCount}</strong> events on <strong>{summaryData.peakDate}</strong>
          </div>
        )}
      </div>

      {/* 4. SVG Multi-Series Interactive Chart */}
      <div style={{ width: '100%', margin: '0 auto', flex: 1, display: 'flex', alignItems: 'center', position: 'relative' }}>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', maxHeight: '220px', display: 'block' }}>
          <defs>
            {/* Total Area Gradient */}
            <linearGradient id="riskTotalAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#EAB308" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#EAB308" stopOpacity="0.01" />
            </linearGradient>

            {/* REQUIRED: Inserts Area Gradient in RED */}
            <linearGradient id="riskInsertAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#EF4444" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#EF4444" stopOpacity="0.01" />
            </linearGradient>

            {/* Updates Area Gradient in Blue */}
            <linearGradient id="riskUpdateAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.20" />
              <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.01" />
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

          {/* Area fill for Inserts (RED) when selected or in ALL */}
          {(activeSeries === 'INSERTS' || selectedEventType === 'INSERT') && totalInserts > 0 && (
            <path d={areaInserts} fill="url(#riskInsertAreaGrad)" />
          )}

          {/* Area fill for total changes */}
          {(activeSeries === 'ALL' || activeSeries === 'TOTAL') && selectedEventType === 'ALL' && (
            <path d={areaTotal} fill="url(#riskTotalAreaGrad)" />
          )}

          {/* 1. Total Activity Line (Amber Gold) */}
          {(activeSeries === 'ALL' || activeSeries === 'TOTAL') && selectedEventType === 'ALL' && (
            <path
              d={pathTotal}
              fill="none"
              stroke="#EAB308"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={activeSeries === 'ALL' || activeSeries === 'TOTAL' ? 0.85 : 0.2}
            />
          )}

          {/* 2. REQUIRED: Inserts / Additions Line in VIBRANT RED (#EF4444) */}
          {(activeSeries === 'ALL' || activeSeries === 'INSERTS' || selectedEventType === 'INSERT') && totalInserts > 0 && (
            <path
              d={pathInserts}
              fill="none"
              stroke="#EF4444"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={totalInserts === totalEvents && selectedEventType === 'ALL' ? "4 3" : "none"}
            />
          )}

          {/* 3. Updates Line in Electric Blue (#3B82F6) */}
          {(activeSeries === 'ALL' || activeSeries === 'UPDATES' || selectedEventType === 'UPDATE') && totalUpdates > 0 && (
            <path
              d={pathUpdates}
              fill="none"
              stroke="#3B82F6"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* 4. Deletions Line in Purple (#8B5CF6) */}
          {(activeSeries === 'ALL' || activeSeries === 'DELETES' || selectedEventType === 'DELETE') && totalDeletes > 0 && (
            <path
              d={pathDeletes}
              fill="none"
              stroke="#8B5CF6"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Data Points on Line with hover interactions */}
          {points.map((p, i) => {
            const isHovered = hoveredIdx === i;
            const showPoint = points.length <= 40 || isHovered;

            return (
              <g
                key={i}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Invisible hover target */}
                <rect x={p.x - 8} y={10} width={16} height={height - 25} fill="transparent" />

                {/* Vertical guide line on hover */}
                {isHovered && (
                  <line x1={p.x} y1={paddingY} x2={p.x} y2={height - paddingY} stroke="#94A3B8" strokeWidth="1" strokeDasharray="2 2" />
                )}

                {/* Total points (Amber) */}
                {(activeSeries === 'ALL' || activeSeries === 'TOTAL') && selectedEventType === 'ALL' && showPoint && (
                  <circle
                    cx={p.x}
                    cy={p.yTotal}
                    r={isHovered ? 4.5 : 3}
                    fill="#FFFFFF"
                    stroke="#EAB308"
                    strokeWidth={isHovered ? 2.5 : 1.8}
                  />
                )}

                {/* REQUIRED: Inserts points in RED (#EF4444) */}
                {(activeSeries === 'ALL' || activeSeries === 'INSERTS' || selectedEventType === 'INSERT') && (p.inserts || 0) > 0 && showPoint && (
                  <circle
                    cx={p.x}
                    cy={p.yInserts}
                    r={isHovered ? 4.8 : 3.2}
                    fill="#EF4444"
                    stroke="#FFFFFF"
                    strokeWidth="1.6"
                  />
                )}

                {/* Updates points in Electric Blue (#3B82F6) */}
                {(activeSeries === 'ALL' || activeSeries === 'UPDATES' || selectedEventType === 'UPDATE') && (p.updates || 0) > 0 && showPoint && (
                  <circle
                    cx={p.x}
                    cy={p.yUpdates}
                    r={isHovered ? 4.2 : 2.8}
                    fill="#3B82F6"
                    stroke="#FFFFFF"
                    strokeWidth="1.5"
                  />
                )}

                {/* Deletions points in Purple (#8B5CF6) */}
                {(activeSeries === 'ALL' || activeSeries === 'DELETES' || selectedEventType === 'DELETE') && (p.deletes || 0) > 0 && showPoint && (
                  <circle
                    cx={p.x}
                    cy={p.yDeletes}
                    r={isHovered ? 4.2 : 2.8}
                    fill="#8B5CF6"
                    stroke="#FFFFFF"
                    strokeWidth="1.5"
                  />
                )}

                {/* X-axis date tick */}
                {isTickVisible(i) && (
                  <text 
                    x={p.x} 
                    y={height - 6} 
                    textAnchor="middle" 
                    fontSize="9" 
                    fill={isHovered ? "#0F172A" : "#64748B"} 
                    fontWeight={isHovered ? 700 : 500}
                  >
                    {p.date.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip Card */}
        {hoveredPoint && (
          <div style={{
            position: 'absolute',
            left: `${Math.min(Math.max(hoveredPoint.x, 80), width - 80)}px`,
            top: '8px',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            color: '#FFFFFF',
            padding: '7px 11px',
            borderRadius: '7px',
            fontSize: '0.74rem',
            boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
            pointerEvents: 'none',
            zIndex: 10,
            whiteSpace: 'nowrap'
          }}>
            <div style={{ fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: '3px', marginBottom: '4px' }}>
              {hoveredPoint.date}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.72rem' }}>
              <span style={{ color: '#FDE047', fontWeight: 600 }}>Total Events: {hoveredPoint.count}</span>
              {/* REQUIRED: Inserts highlighted in RED */}
              <span style={{ color: '#F87171', fontWeight: 700 }}>🔴 Inserts / Additions: {hoveredPoint.inserts || 0}</span>
              <span style={{ color: '#93C5FD' }}>🔵 Updates: {hoveredPoint.updates || 0}</span>
              <span style={{ color: '#C4B5FD' }}>🟣 Deletions: {hoveredPoint.deletes || 0}</span>
            </div>
          </div>
        )}
      </div>

      {/* 5. Series Legend with Interactive Series Toggling */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.6rem', marginTop: '0.2rem', fontSize: '0.76rem', flexWrap: 'wrap' }}>
        
        {/* Total Security Changes */}
        <div
          onClick={() => setActiveSeries(activeSeries === 'TOTAL' ? 'ALL' : 'TOTAL')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', opacity: activeSeries === 'ALL' || activeSeries === 'TOTAL' ? 1 : 0.4 }}
          title="Click to focus on Total Security Events"
        >
          <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#EAB308' }} />
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Total Changes ({totalEvents})</span>
        </div>

        {/* REQUIRED: Inserts in RED */}
        <div
          onClick={() => setActiveSeries(activeSeries === 'INSERTS' ? 'ALL' : 'INSERTS')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', opacity: activeSeries === 'ALL' || activeSeries === 'INSERTS' ? 1 : 0.4 }}
          title="Click to focus on Inserts / Additions series"
        >
          <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#EF4444' }} />
          <span style={{ color: '#DC2626', fontWeight: 700 }}>Inserts / Additions ({totalInserts})</span>
        </div>

        {/* Updates */}
        <div
          onClick={() => setActiveSeries(activeSeries === 'UPDATES' ? 'ALL' : 'UPDATES')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', opacity: activeSeries === 'ALL' || activeSeries === 'UPDATES' ? 1 : 0.4 }}
          title="Click to focus on Updates series"
        >
          <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#3B82F6' }} />
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Updates ({totalUpdates})</span>
        </div>

        {/* Deletions */}
        <div
          onClick={() => setActiveSeries(activeSeries === 'DELETES' ? 'ALL' : 'DELETES')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', opacity: activeSeries === 'ALL' || activeSeries === 'DELETES' ? 1 : 0.4 }}
          title="Click to focus on Deletions series"
        >
          <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#8B5CF6' }} />
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Deletions ({totalDeletes})</span>
        </div>
      </div>
    </div>
  );
}

// Backward compatibility alias
export const SecurityActivityTrend = RiskTrend;

/* ==========================================================
   7. PRODUCT-LEVEL AUDIT ACTIVITY MONITOR
   ========================================================== */
interface ProductActivityMonitorProps {
  onNavigatePage?: (pageId: string, filter?: any) => void;
  onInvestigateProduct?: (productName: string) => void;
  businessObjects?: any; // Backward compatibility prop
}

export function ProductActivityMonitor({ onNavigatePage }: ProductActivityMonitorProps) {
  const [timeframe, setTimeframe] = React.useState<string>('24h');
  const [loading, setLoading] = React.useState<boolean>(false);
  const [syncingProduct, setSyncingProduct] = React.useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = React.useState<string | null>(null);
  const [expandedProducts, setExpandedProducts] = React.useState<Set<string>>(new Set());

  const [data, setData] = React.useState<{
    timeframe: string;
    effectiveDateLabel: string;
    targetDate: string;
    products: Array<{
      product: string;
      totalRecords: number;
      inserts: number;
      updates: number;
      deletes: number;
      latestEventTime: string | null;
      lastSyncedAt?: string | null;
      businessObjects?: Array<{
        businessObject: string;
        totalRecords: number;
        inserts: number;
        updates: number;
        deletes: number;
        latestEventTime: string | null;
      }>;
    }>;
    totalActiveProducts: number;
    totalRecordsAcrossProducts: number;
  }>({
    timeframe: '24h',
    effectiveDateLabel: 'Last 24 Hours (Daily Sync Window)',
    targetDate: '',
    products: [],
    totalActiveProducts: 0,
    totalRecordsAcrossProducts: 0
  });

  const loadData = React.useCallback(async (tf: string) => {
    setLoading(true);
    try {
      const res = await api.getProductActivity({ timeframe: tf });
      if (res?.success && res?.data) {
        setData(res.data);
      }
    } catch (err) {
      console.error('[ProductActivityMonitor] Failed to load product activity:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData(timeframe);
  }, [timeframe, loadData]);

  const handleInspect = (productName: string, businessObject?: string) => {
    const today = new Date().toISOString().split('T')[0];
    let fromDate = today;
    let toDate = today;

    if (timeframe === '24h') {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      fromDate = yesterday;
      toDate = today;
    } else if (timeframe === 'yesterday') {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      fromDate = yesterday;
      toDate = yesterday;
    } else if (timeframe === 'previous_active') {
      fromDate = data.targetDate || today;
      toDate = data.targetDate || today;
    } else if (timeframe === '7d') {
      fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      toDate = today;
    } else if (timeframe === '30d') {
      fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      toDate = today;
    }

    onNavigatePage?.('audit', {
      product: productName,
      businessObject,
      fromDate,
      toDate
    });
  };

  const handleSyncProduct = async (productName: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSyncingProduct(productName);
    setSyncFeedback(null);
    try {
      const res = await api.syncProductActivity(productName);
      if (res?.success) {
        setSyncFeedback(`Successfully synchronized ${productName} (${res.savedCount || 0} new records persisted).`);
        await loadData(timeframe);
      } else {
        setSyncFeedback(`Sync note: ${res?.message || 'Completed'}`);
      }
    } catch (err: any) {
      console.error('Failed to sync product:', err);
      setSyncFeedback(`Failed to sync ${productName}: ${err.message || 'Error'}`);
    } finally {
      setSyncingProduct(null);
      setTimeout(() => setSyncFeedback(null), 5000);
    }
  };

  const handleSyncAll = async () => {
    setSyncingProduct('__ALL__');
    setSyncFeedback(null);
    try {
      const res = await api.syncAuditTrail();
      if (res?.success) {
        setSyncFeedback(`Audit upgrade sync complete: ${res.syncedCount || 0} records fetched (${res.savedCount || 0} newly saved).`);
        await loadData(timeframe);
      }
    } catch (err: any) {
      setSyncFeedback(`Sync failed: ${err.message}`);
    } finally {
      setSyncingProduct(null);
      setTimeout(() => setSyncFeedback(null), 5000);
    }
  };

  const toggleExpand = (prodName: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(prodName)) next.delete(prodName);
      else next.add(prodName);
      return next;
    });
  };

  const totalInserts = data.products.reduce((acc, p) => acc + p.inserts, 0);
  const totalUpdates = data.products.reduce((acc, p) => acc + p.updates, 0);
  const totalDeletes = data.products.reduce((acc, p) => acc + p.deletes, 0);

  const getProductCategory = (prodName: string) => {
    const p = prodName.toLowerCase();
    if (p.includes('risk') || p.includes('racm') || p.includes('rmc')) return { category: 'RMC', color: '#059669', bg: '#ECFDF5' };
    if (p.includes('human') || p.includes('hcm') || p.includes('profile')) return { category: 'HCM', color: '#10B981', bg: '#ECFDF5' };
    if (p.includes('ledger') || p.includes('payables') || p.includes('receivables') || p.includes('financial')) return { category: 'FIN', color: '#2563EB', bg: '#EFF6FF' };
    if (p.includes('crm') || p.includes('service') || p.includes('sales')) return { category: 'CRM', color: '#8B5CF6', bg: '#F5F3FF' };
    if (p.includes('security') || p.includes('platform')) return { category: 'SEC', color: '#EF4444', bg: '#FEF2F2' };
    if (p.includes('inventory') || p.includes('procurement')) return { category: 'SCM', color: '#F59E0B', bg: '#FFFBEB' };
    return { category: 'COMMON', color: '#64748B', bg: '#F8FAFC' };
  };

  const todayDateStr = new Date().toISOString().split('T')[0];
  const yesterdayDateStr = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  return (
    <div className="glass-panel" style={{ padding: '1.4rem 1.6rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.8rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-header)', margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Layers style={{ width: 19, height: 19, color: '#2563EB' }} />
              Active Products Audit Activity
            </h3>
            <span style={{
              fontSize: '0.74rem',
              fontWeight: 600,
              color: '#2563EB',
              backgroundColor: '#EFF6FF',
              border: '1px solid #BFDBFE',
              padding: '0.15rem 0.6rem',
              borderRadius: '9999px'
            }}>
              {data.effectiveDateLabel}
            </span>
            {loading && <RefreshCw style={{ width: 14, height: 14, color: '#64748B', animation: 'spin 1s linear infinite' }} />}
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.2rem 0 0 0' }}>
            Oracle Fusion applications with recorded transactions, security changes, and synchronized event volume
          </p>
        </div>

        {/* Right Controls: Timeframe Selector, Sync All, Export & Audit Trail Link */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          {/* Timeframe Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
              Timeframe:
            </span>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              style={{
                fontSize: '0.78rem',
                fontWeight: 600,
                color: '#1E293B',
                backgroundColor: '#FFFFFF',
                border: '1px solid #CBD5E1',
                borderRadius: '6px',
                padding: '0.28rem 0.65rem',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              <option value="24h">Last 24 Hours (Daily Sync Window)</option>
              <option value="today">Today ({todayDateStr})</option>
              <option value="yesterday">Yesterday ({yesterdayDateStr})</option>
              <option value="previous_active">Previous Active Day</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>

          {/* Sync All Button */}
          <button
            onClick={handleSyncAll}
            disabled={syncingProduct === '__ALL__'}
            title="Synchronize audit trail for all active products from Oracle Fusion"
            style={{
              fontSize: '0.76rem',
              fontWeight: 600,
              backgroundColor: '#EFF6FF',
              color: '#1E40AF',
              border: '1px solid #BFDBFE',
              borderRadius: '6px',
              padding: '0.28rem 0.65rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              cursor: syncingProduct === '__ALL__' ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <RefreshCw style={{ width: 13, height: 13, animation: syncingProduct === '__ALL__' ? 'spin 1s linear infinite' : 'none', color: '#2563EB' }} />
            {syncingProduct === '__ALL__' ? 'Syncing...' : 'Sync All'}
          </button>

          {data.products.length > 0 && (
            <TableExportControl
              filename={`product_audit_activity_${timeframe}`}
              data={data.products}
              totalCount={data.products.length}
              columns={[
                { key: 'product', label: 'Oracle Product', getValue: (p: any) => (p.product || '').replace(/\s*\([^)]*\)$/, '').trim() },
                { key: 'totalRecords', label: 'Total Records' },
                { key: 'inserts', label: 'Inserts / Additions' },
                { key: 'updates', label: 'Updates' },
                { key: 'deletes', label: 'Deletions' },
                { key: 'latestEventTime', label: 'Latest Event', getValue: (p: any) => p.latestEventTime ? new Date(p.latestEventTime).toLocaleString() : '' },
                { key: 'lastSyncedAt', label: 'Last Synced', getValue: (p: any) => p.lastSyncedAt ? new Date(p.lastSyncedAt).toLocaleString() : 'N/A' }
              ]}
            />
          )}

          <span
            onClick={() => handleInspect('')}
            style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          >
            Full Audit Trail &rarr;
          </span>
        </div>
      </div>

      {/* Sync Feedback Toast */}
      {syncFeedback && (
        <div style={{
          fontSize: '0.78rem',
          backgroundColor: '#F0FDF4',
          border: '1px solid #BBF7D0',
          color: '#166534',
          padding: '0.35rem 0.8rem',
          borderRadius: '6px',
          display: 'flex',
          alignItems: 'center',
          gap: '0.45rem'
        }}>
          <CheckCircle2 style={{ width: 15, height: 15, color: '#16A34A' }} />
          <span>{syncFeedback}</span>
        </div>
      )}

      {/* Summary KPI Chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{
          fontSize: '0.75rem',
          backgroundColor: '#F8FAFC',
          border: '1px solid #E2E8F0',
          borderRadius: '6px',
          padding: '0.22rem 0.65rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}>
          <span style={{ color: '#64748B' }}>Active Products:</span>
          <strong style={{ color: '#0F172A' }}>{data.totalActiveProducts}</strong>
        </div>

        <div style={{
          fontSize: '0.75rem',
          backgroundColor: '#F1F5F9',
          border: '1px solid #CBD5E1',
          borderRadius: '6px',
          padding: '0.22rem 0.65rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}>
          <span style={{ color: '#475569' }}>Total Records Logged:</span>
          <strong style={{ color: '#0F172A' }}>{data.totalRecordsAcrossProducts.toLocaleString()}</strong>
        </div>

        {/* Inserts in Red */}
        <div style={{
          fontSize: '0.75rem',
          backgroundColor: '#FEF2F2',
          border: '1px solid #FECACA',
          borderRadius: '6px',
          padding: '0.22rem 0.65rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#EF4444' }} />
          <span style={{ color: '#991B1B', fontWeight: 600 }}>Inserts / Additions:</span>
          <strong style={{ color: '#DC2626' }}>{totalInserts.toLocaleString()}</strong>
        </div>

        {/* Updates in Blue */}
        <div style={{
          fontSize: '0.75rem',
          backgroundColor: '#EFF6FF',
          border: '1px solid #BFDBFE',
          borderRadius: '6px',
          padding: '0.22rem 0.65rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#3B82F6' }} />
          <span style={{ color: '#1E40AF', fontWeight: 600 }}>Updates:</span>
          <strong style={{ color: '#2563EB' }}>{totalUpdates.toLocaleString()}</strong>
        </div>

        {/* Deletes in Purple */}
        {totalDeletes > 0 && (
          <div style={{
            fontSize: '0.75rem',
            backgroundColor: '#F5F3FF',
            border: '1px solid #DDD6FE',
            borderRadius: '6px',
            padding: '0.22rem 0.65rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#8B5CF6' }} />
            <span style={{ color: '#5B21B6', fontWeight: 600 }}>Deletions:</span>
            <strong style={{ color: '#7C3AED' }}>{totalDeletes.toLocaleString()}</strong>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="table-container" style={{ margin: 0, flex: 1, minHeight: '160px' }}>
        <table className="enterprise-table">
          <thead>
            <tr>
              <th>Oracle Product</th>
              <th style={{ textAlign: 'center' }}>Total Records</th>
              <th>Event Types Breakdown</th>
              <th>Latest Event &amp; Sync Status</th>
              <th style={{ textAlign: 'right' }}>Activity Level</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.products.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#475569' }}>
                      No audit records logged for this timeframe ({data.effectiveDateLabel}).
                    </span>
                    <span style={{ fontSize: '0.78rem', color: '#64748B' }}>
                      Try selecting the Daily Sync Interval or Yesterday, or trigger an on-demand sync above.
                    </span>
                    <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem' }}>
                      <button
                        onClick={() => setTimeframe('24h')}
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          backgroundColor: '#2563EB',
                          color: '#FFFFFF',
                          border: 'none',
                          padding: '0.3rem 0.75rem',
                          borderRadius: '6px',
                          cursor: 'pointer'
                        }}
                      >
                        View Daily Sync Interval (Last 24h)
                      </button>
                      <button
                        onClick={() => setTimeframe('yesterday')}
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          backgroundColor: '#F1F5F9',
                          color: '#334155',
                          border: '1px solid #CBD5E1',
                          padding: '0.3rem 0.75rem',
                          borderRadius: '6px',
                          cursor: 'pointer'
                        }}
                      >
                        View Yesterday ({yesterdayDateStr})
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              data.products.map((p, idx) => {
                const cat = getProductCategory(p.product);
                const isHigh = p.totalRecords > 30;
                const isMed = p.totalRecords > 5;
                const isExpanded = expandedProducts.has(p.product);
                const hasBOs = Array.isArray(p.businessObjects) && p.businessObjects.length > 0;
                const isSyncingThis = syncingProduct === p.product;

                return (
                  <React.Fragment key={idx}>
                    <tr>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                          {hasBOs ? (
                            <button
                              onClick={() => toggleExpand(p.product)}
                              title={isExpanded ? 'Collapse business objects' : 'Expand business objects'}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                color: '#64748B'
                              }}
                            >
                              {isExpanded ? (
                                <ChevronDown style={{ width: 16, height: 16 }} />
                              ) : (
                                <ChevronRight style={{ width: 16, height: 16 }} />
                              )}
                            </button>
                          ) : (
                            <span style={{ width: 16 }} />
                          )}
                          <span style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            backgroundColor: cat.bg,
                            color: cat.color,
                            padding: '0.12rem 0.45rem',
                            borderRadius: '4px',
                            border: `1px solid ${cat.color}30`
                          }}>
                            {cat.category}
                          </span>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                            {(p.product || '').replace(/\s*\([^)]*\)$/, '').trim()}
                          </span>
                        </div>
                      </td>

                      <td style={{ textAlign: 'center' }}>
                        <span style={{ 
                          display: 'inline-block',
                          padding: '0.2rem 0.6rem',
                          borderRadius: '6px',
                          backgroundColor: '#F8FAFC',
                          border: '1px solid #E2E8F0',
                          fontWeight: 700,
                          color: '#0F172A',
                          fontSize: '0.85rem'
                        }}>
                          {p.totalRecords.toLocaleString()}
                        </span>
                      </td>

                      {/* Event Types Breakdown: Clean badges */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                          {p.inserts > 0 && (
                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              color: '#DC2626',
                              backgroundColor: '#FEF2F2',
                              border: '1px solid #FECACA',
                              padding: '0.12rem 0.45rem',
                              borderRadius: '5px'
                            }}>
                              🔴 {p.inserts} Inserts
                            </span>
                          )}
                          {p.updates > 0 && (
                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              color: '#2563EB',
                              backgroundColor: '#EFF6FF',
                              border: '1px solid #BFDBFE',
                              padding: '0.12rem 0.45rem',
                              borderRadius: '5px'
                            }}>
                              🔵 {p.updates} Updates
                            </span>
                          )}
                          {p.deletes > 0 && (
                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              color: '#7C3AED',
                              backgroundColor: '#F5F3FF',
                              border: '1px solid #DDD6FE',
                              padding: '0.12rem 0.45rem',
                              borderRadius: '5px'
                            }}>
                              🟣 {p.deletes} Deletes
                            </span>
                          )}
                          {p.inserts === 0 && p.updates === 0 && p.deletes === 0 && (
                            <span style={{ fontSize: '0.72rem', color: '#64748B' }}>Standard Logs</span>
                          )}
                        </div>
                      </td>

                      <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        <div>
                          <strong>{p.latestEventTime ? new Date(p.latestEventTime).toLocaleString() : 'N/A'}</strong>
                        </div>
                        {p.lastSyncedAt && (
                          <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: '0.15rem' }}>
                            Synced: {new Date(p.lastSyncedAt).toLocaleString()}
                          </div>
                        )}
                      </td>

                      <td style={{ textAlign: 'right' }}>
                        <span className={
                          isHigh
                            ? 'badge badge-level-high'
                            : isMed
                            ? 'badge badge-level-med'
                            : 'badge badge-level-low'
                        }>
                          {isHigh ? 'High Activity' : isMed ? 'Moderate' : 'Low Activity'}
                        </span>
                      </td>

                      {/* Actions: Sync Button + Inspect */}
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.65rem' }}>
                          <button
                            onClick={(e) => handleSyncProduct(p.product, e)}
                            disabled={isSyncingThis}
                            title={`Sync audit records for ${p.product} on-demand`}
                            style={{
                              fontSize: '0.73rem',
                              fontWeight: 600,
                              color: '#2563EB',
                              backgroundColor: '#EFF6FF',
                              border: '1px solid #BFDBFE',
                              borderRadius: '5px',
                              padding: '0.18rem 0.5rem',
                              cursor: isSyncingThis ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.3rem'
                            }}
                          >
                            <RefreshCw style={{ width: 11, height: 11, animation: isSyncingThis ? 'spin 1s linear infinite' : 'none' }} />
                            {isSyncingThis ? 'Syncing...' : 'Sync'}
                          </button>

                          <span
                            onClick={() => handleInspect(p.product)}
                            style={{
                              fontSize: '0.78rem',
                              color: 'var(--accent-blue)',
                              cursor: 'pointer',
                              fontWeight: 600,
                              textDecoration: 'none'
                            }}
                          >
                            Inspect &rarr;
                          </span>
                        </div>
                      </td>
                    </tr>

                    {/* Expandable Business Object Breakdown Sub-Row */}
                    {isExpanded && hasBOs && (
                      <tr style={{ backgroundColor: '#F8FAFC' }}>
                        <td colSpan={6} style={{ padding: '0.75rem 1.2rem 0.75rem 2.8rem' }}>
                          <div style={{
                            borderLeft: '3px solid #2563EB',
                            paddingLeft: '0.85rem',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.45rem'
                          }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase' }}>
                              Business Objects Activity Breakdown for {p.product}:
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                              {p.businessObjects!.map((bo, boIdx) => (
                                <div
                                  key={boIdx}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    backgroundColor: '#FFFFFF',
                                    border: '1px solid #E2E8F0',
                                    borderRadius: '6px',
                                    padding: '0.35rem 0.75rem',
                                    fontSize: '0.78rem'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontWeight: 600, color: '#0F172A' }}>
                                      {bo.businessObject}
                                    </span>
                                    <span style={{
                                      fontSize: '0.7rem',
                                      backgroundColor: '#F1F5F9',
                                      color: '#475569',
                                      padding: '0.1rem 0.4rem',
                                      borderRadius: '4px',
                                      fontWeight: 600
                                    }}>
                                      {bo.totalRecords} records
                                    </span>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    {bo.inserts > 0 && <span style={{ color: '#DC2626', fontSize: '0.72rem', fontWeight: 600 }}>{bo.inserts} Inserts</span>}
                                    {bo.updates > 0 && <span style={{ color: '#2563EB', fontSize: '0.72rem', fontWeight: 600 }}>{bo.updates} Updates</span>}
                                    {bo.deletes > 0 && <span style={{ color: '#7C3AED', fontSize: '0.72rem', fontWeight: 600 }}>{bo.deletes} Deletes</span>}
                                    {bo.latestEventTime && (
                                      <span style={{ color: '#64748B', fontSize: '0.7rem', marginLeft: '0.3rem' }}>
                                        Latest: {new Date(bo.latestEventTime).toLocaleTimeString()}
                                      </span>
                                    )}
                                    <span
                                      onClick={() => handleInspect(p.product, bo.businessObject)}
                                      style={{
                                        fontSize: '0.72rem',
                                        color: '#2563EB',
                                        backgroundColor: '#EFF6FF',
                                        border: '1px solid #BFDBFE',
                                        borderRadius: '4px',
                                        padding: '0.12rem 0.45rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        marginLeft: '0.4rem'
                                      }}
                                      title={`Inspect ${bo.businessObject} in Audit Trail`}
                                    >
                                      Inspect BO &rarr;
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Backward compatibility alias
export const TopAtRiskBusinessObjects = ProductActivityMonitor;
export const MostActiveBusinessObjects = ProductActivityMonitor;
