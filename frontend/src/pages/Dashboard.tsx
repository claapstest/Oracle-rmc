import React, { useEffect, useState } from 'react';
import {
  FileText,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Eye,
  Sparkles,
  ArrowRight,
  Lock,
  Compass,
  CheckCircle2,
  Activity
} from 'lucide-react';
import { api } from '../services/api';
import { TableExportControl } from '../components/TableExportControl';
import {
  UserAccountHealth,
  RoleDistributionDonut,
  RiskTrend,
  TopAtRiskBusinessObjects
} from '../components/DashboardComponents';

interface DashboardProps {
  currentUser?: string;
  onFAQSelect?: (question: string) => void;
  environmentMode: 'DEMO' | 'ORACLE_FUSION';
  onInvestigate?: (type: 'role' | 'user', id: string, name: string) => void;
  onNavigatePage?: (pageId: string, filter?: string) => void;
}

function getFirstName(str?: string): string {
  if (!str) return 'Admin';
  let clean = str.trim();
  if (clean.includes('@')) {
    clean = clean.split('@')[0];
  }
  if (clean.toLowerCase() === 'admin') return 'Admin';
  const parts = clean.split(/[\s._-]+/);
  const first = parts[0] || clean;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

const SUBTITLE_POOL = [
  "Here's what's happening in your audit environment.",
  "Monitor audit activities, security posture, and access risks.",
  "Track real-time security changes and user account health.",
  "Manage users, access permissions, and system compliance.",
  "Access governance insights and role distribution analytics."
];

function getSubtitleText(username?: string): string {
  if (!username) return SUBTITLE_POOL[0];
  const norm = username.trim().toLowerCase();

  if (norm.includes('admin')) {
    return "Manage users, integrations and system configuration.";
  }

  // Dynamic hash distribution for any new member logging into VEYRA
  let hash = 0;
  for (let i = 0; i < norm.length; i++) {
    hash = (hash << 5) - hash + norm.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % SUBTITLE_POOL.length;
  return SUBTITLE_POOL[index];
}

export default function Dashboard({ 
  currentUser,
  onFAQSelect, 
  environmentMode,
  onInvestigate,
  onNavigatePage 
}: DashboardProps) {
  const [stats, setStats] = useState<any>({
    totalUsers: 8544,
    activeUsers: 8461,
    inactiveUsers: 83,
    totalRoles: 6989,
    jobRolesCount: 6014,
    dutyRolesCount: 55,
    dataRolesCount: 336,
    abstractRolesCount: 521,
    grcRolesCount: 12,
    otherRolesCount: 51,
    rolesWithoutUsersCount: 4918,
    rolesWithUsersCount: 2071,
    highRiskRolesCount: 12,
    auditEventsCount: 219,
    riskIncidentsCount: 0,
    multipleRoleUsersCount: 47,
    usersWithoutRolesCount: 3,
    securityAdminsCount: 45,
    highRiskUsersCount: 45,
    businessObjects: [],
    activityTrend: []
  });
  
  const [recentAudits, setRecentAudits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [auditUnavailable, setAuditUnavailable] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadDashboardData() {
      setLoading(true);
      setError('');
      try {
        const [statResult, auditResult] = await Promise.allSettled([
          api.getOverviewStats(),
          api.getAuditLogs({ pageSize: 10 })
        ]);

        if (!isMounted) return;

        if (statResult.status === 'fulfilled' && statResult.value?.data) {
          setStats(statResult.value.data);
        }

        if (auditResult.status === 'fulfilled') {
          const auditRes = auditResult.value;
          if (auditRes?.auditUnavailable) {
            setAuditUnavailable(true);
            setRecentAudits([]);
          } else if (auditRes?.logs && Array.isArray(auditRes.logs)) {
            setRecentAudits(auditRes.logs.slice(0, 5));
            setAuditUnavailable(false);
          }
        }
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
        if (isMounted) setError('Could not establish connection to the backend service.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadDashboardData();
    return () => { isMounted = false; };
  }, [environmentMode]);

  if (loading) {
    return (
      <div style={{ padding: '2rem', maxWidth: '1440px', margin: '0 auto' }}>
        <div style={{ height: '140px', borderRadius: '14px', marginBottom: '1.5rem' }} className="skeleton" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.25rem', marginBottom: '1.5rem' }}>
          {[1, 2, 3, 4].map(n => (
            <div key={n} style={{ height: '100px', borderRadius: '12px' }} className="skeleton" />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
          <div style={{ height: '320px', borderRadius: '12px' }} className="skeleton" />
          <div style={{ height: '320px', borderRadius: '12px' }} className="skeleton" />
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem 2rem 3rem 2rem', maxWidth: '1440px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
      {/* ==========================================================
          WELCOME GREETING - Clean Canvas Typography (Mock Screens 4, 5, 6, 7)
          ========================================================== */}
      <div style={{ marginBottom: '0.2rem' }}>
        <h1 
          style={{
            fontSize: '1.75rem',
            fontWeight: 800,
            color: '#0F172A',
            fontFamily: "'Outfit', 'Inter', sans-serif",
            margin: 0,
            letterSpacing: '-0.025em'
          }}
        >
          Welcome back, {getFirstName(currentUser)}!
        </h1>
        <p style={{ color: '#64748B', fontSize: '0.95rem', margin: '0.35rem 0 0 0', fontWeight: 500 }}>
          {getSubtitleText(currentUser)}
        </p>
      </div>

      {error && (
        <div className="glass-panel" style={{ padding: '1rem 1.5rem', borderLeft: '4px solid var(--accent-red)' }}>
          <p style={{ color: 'var(--accent-red)', fontSize: '0.9rem', fontWeight: 600, margin: 0 }}>{error}</p>
        </div>
      )}

      {/* ==========================================================
          1. TOP KPI ROW: Operational & Intelligence Indicators
          (NO standalone Total Users / Total Roles repetition)
          ========================================================== */}
      <div className="overview-kpi-grid">
        
        {/* KPI 1: Security Changes (Real Audit Data) */}
        <div 
          className="glass-panel stat-card"
          onClick={() => onNavigatePage?.('audit')}
          style={{ cursor: 'pointer', transition: 'all 0.2s ease', padding: '1.35rem 1.5rem' }}
          title="View comprehensive Audit Trail"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="stat-title">Security Changes</div>
              <div className="stat-value">{stats.auditEventsCount.toLocaleString()}</div>
              <div className="stat-subtitle">Audit trail events captured</div>
            </div>
            <div style={{ 
              width: '44px', 
              height: '44px', 
              borderRadius: '12px', 
              backgroundColor: '#FFFBEB', 
              color: '#D97706', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <FileText size={22} />
            </div>
          </div>
        </div>

        {/* KPI 2: High-Risk Users / Elevated Privileges */}
        <div 
          className="glass-panel stat-card"
          onClick={() => onNavigatePage?.('users', 'ADMIN_ROLES')}
          style={{ cursor: 'pointer', transition: 'all 0.2s ease', padding: '1.35rem 1.5rem' }}
          title="Filter High Risk / Security Administrator Accounts"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="stat-title">High-Risk Users</div>
              <div className="stat-value">{(stats.highRiskUsersCount || stats.securityAdminsCount || 45).toLocaleString()}</div>
              <div className="stat-subtitle">Privileged accounts with elevated access</div>
            </div>
            <div style={{ 
              width: '44px', 
              height: '44px', 
              borderRadius: '12px', 
              backgroundColor: '#FEF2F2', 
              color: '#DC2626', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <ShieldAlert size={22} />
            </div>
          </div>
        </div>

        {/* KPI 3: Users Without Roles (Calculated Orphaned Accounts) */}
        <div 
          className="glass-panel stat-card"
          onClick={() => onNavigatePage?.('users', 'NO_ROLES')}
          style={{ cursor: 'pointer', transition: 'all 0.2s ease', padding: '1.35rem 1.5rem' }}
          title="Filter Users Without Any Assigned Role"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="stat-title">Users Without Roles</div>
              <div className="stat-value">{(stats.usersWithoutRolesCount ?? 3).toLocaleString()}</div>
              <div className="stat-subtitle">Accounts without any assigned role</div>
            </div>
            <div style={{ 
              width: '44px', 
              height: '44px', 
              borderRadius: '12px', 
              backgroundColor: '#FFF7ED', 
              color: '#EA580C', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <AlertTriangle size={22} />
            </div>
          </div>
        </div>

      </div>

      {/* ==========================================================
          3. TWO-COLUMN SECTION: Role Distribution & User Account Health
          ========================================================== */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.35rem' }}>
        <RoleDistributionDonut stats={stats} onNavigatePage={onNavigatePage} />
        <UserAccountHealth stats={stats} onNavigatePage={onNavigatePage} />
      </div>

      {/* ==========================================================
          4. FULL-WIDTH ANALYTICS: Risk Trend (Line)
          ========================================================== */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.35rem' }}>
        <RiskTrend activityTrend={stats.activityTrend} onNavigatePage={onNavigatePage} />
      </div>

      {/* ==========================================================
          5. TWO-COLUMN OPERATIONAL: Recent Security Changes & Top At-Risk Objects
          ========================================================== */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.35rem' }}>
        
        {/* LEFT: Recent Security Configuration Changes */}
        <div className="glass-panel" style={{ padding: '1.5rem 1.6rem', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.08rem', fontWeight: 700, fontFamily: 'var(--font-header)', margin: 0, color: 'var(--text-primary)' }}>
                Recent Security Configuration Changes
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.15rem 0 0 0' }}>
                Latest security audit records captured in Oracle Fusion
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {recentAudits.length > 0 && (
                <TableExportControl
                  filename="recent_security_changes"
                  data={recentAudits}
                  totalCount={recentAudits.length}
                  columns={[
                    { key: 'timestamp', label: 'Timestamp', getValue: (l: any) => l.timestamp ? new Date(l.timestamp).toLocaleString() : '' },
                    { key: 'username', label: 'User', getValue: (l: any) => l.username || 'System' },
                    { key: 'businessObject', label: 'Object Modified', getValue: (l: any) => l.businessObject || l.qualifiedBusinessObject || 'Security Configuration' },
                    { key: 'action', label: 'Action', getValue: (l: any) => l.action || l.event || 'UPDATE' }
                  ]}
                />
              )}
              <span 
                onClick={() => onNavigatePage?.('audit')}
                style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              >
                View Full Audit Trail &rarr;
              </span>
            </div>
          </div>

          <div className="table-container" style={{ margin: 0, flex: 1 }}>
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Object Modified</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {recentAudits.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                      {auditUnavailable 
                        ? 'Audit history API is disabled in this Oracle Fusion environment.'
                        : 'No recent security changes recorded.'
                      }
                    </td>
                  </tr>
                ) : (
                  recentAudits.map(log => {
                    const eventName = String(log.event || log.action || 'UPDATE').toUpperCase();
                    const isInsert = eventName.includes('INSERT') || eventName.includes('CREATE') || eventName.includes('ADD');
                    const isDelete = eventName.includes('DELETE') || eventName.includes('REMOVE') || eventName.includes('REVOKE');
                    const badgeClass = isInsert ? 'badge-insert' : isDelete ? 'badge-delete' : 'badge-update';
                    const badgeLabel = isInsert ? 'Object Data Insert' : isDelete ? 'Object Data Delete' : 'Object Data Update';

                    return (
                      <tr key={log.id}>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          <span 
                            onClick={() => onInvestigate?.('user', log.username, log.username)}
                            style={{ color: 'var(--accent-blue)', cursor: 'pointer', textDecoration: 'underline' }}
                          >
                            {log.username || 'System'}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                          {log.businessObject || log.qualifiedBusinessObject || 'Security Configuration'}
                        </td>
                        <td>
                          <span className={`badge ${badgeClass}`}>
                            {badgeLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: Top At-Risk Business Objects */}
        <TopAtRiskBusinessObjects 
          businessObjects={stats.businessObjects} 
          onNavigatePage={onNavigatePage} 
        />

      </div>

      {/* ==========================================================
          6. BOTTOM INTELLIGENCE CALL-TO-ACTION & TRUST FOOTER
          ========================================================== */}
      <div className="glass-panel" style={{
        padding: '1.4rem 2rem',
        borderRadius: '14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1.25rem',
        background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.05) 0%, rgba(255, 255, 255, 0.95) 100%)',
        border: '1px solid rgba(37, 99, 235, 0.15)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '10px',
            backgroundColor: '#EFF6FF',
            color: '#2563EB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <Sparkles size={22} />
          </div>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Turn data into a safer tomorrow.
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Use CLAAPS VEYRA to identify risks, monitor access, and ensure compliance — all in one place.
            </div>
          </div>
        </div>

        <button
          onClick={() => onFAQSelect?.('Who has administrative and security privileges in Oracle Fusion?')}
          style={{
            backgroundColor: '#1D4ED8',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '8px',
            padding: '0.65rem 1.35rem',
            fontSize: '0.86rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            boxShadow: '0 2px 8px rgba(29, 78, 216, 0.25)',
            transition: 'all 0.18s ease'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1E40AF'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#1D4ED8'; }}
        >
          <span>Ask VEYRA</span>
          <ArrowRight size={15} />
        </button>
      </div>

      {/* Trust & Governance Badges Footer */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.5rem 0.5rem 0 0.5rem',
        fontSize: '0.74rem',
        color: 'var(--text-muted)',
        borderTop: '1px solid var(--border-color)',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
            <ShieldCheck size={14} style={{ color: '#2563EB' }} />
            Stronger Identities
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
            <Lock size={14} style={{ color: '#10B981' }} />
            Safer Access
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
            <Activity size={14} style={{ color: '#F59E0B' }} />
            Lower Risk
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
            <CheckCircle2 size={14} style={{ color: '#7C3AED' }} />
            Greater Compliance
          </span>
        </div>

        <div style={{ fontWeight: 600, letterSpacing: '0.06em', fontSize: '0.72rem', color: '#94A3B8' }}>
          TRUST · VISIBILITY · CONTROL
        </div>
      </div>

    </div>
  );
}
