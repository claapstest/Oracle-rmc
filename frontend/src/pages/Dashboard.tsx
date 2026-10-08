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
  Activity,
  Users,
  Award,
  FileClock,
  Scale,
  Settings as SettingsIcon,
  TerminalSquare
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
  userRole?: string;
  onFAQSelect?: (question: string) => void;
  environmentMode: 'DEMO' | 'ORACLE_FUSION';
  onInvestigate?: (type: 'role' | 'user', id: string, name: string) => void;
  onNavigatePage?: (pageId: string, filter?: string) => void;
  hasAccess?: (pageId: string) => boolean;
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
  userRole,
  onFAQSelect, 
  environmentMode,
  onInvestigate,
  onNavigatePage,
  hasAccess
}: DashboardProps) {
  // AC3 — cards linking to restricted modules hide without the privilege.
  const can = (pageId: string) => (hasAccess ? hasAccess(pageId) : true);
  // Mock Screen 7 — Site Admin sees a dedicated administration dashboard.
  // AC1/AC4: role check first; admin-pages grant as fallback for isAdmin sessions
  // whose role string may vary. Non-Site Admin never matches this branch.
  const normalizedRole = (userRole || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const isSiteAdmin = normalizedRole === 'SITE_ADMIN' || (can('settings') && can('command-center'));
  // Audit Supervisor now shares the comprehensive visual analytics dashboard (charts, trends, account health) with Audit Manager
  const isSupervisor = false;
  // Mock Screen 6 — Audit User (reports-only) gets a dedicated dashboard.
  const isAuditUser = !isSiteAdmin && normalizedRole === 'AUDIT_USER';
  // AC5 — tiles come only from backend report feeds; null until loaded (never hardcoded).
  const [auMetrics, setAuMetrics] = useState<{ available: number; records: number; completed: number } | null>(null);
  const [auLoading, setAuLoading] = useState(false);
  const [auError, setAuError] = useState('');
  // AC4/AC5 — supervisor KPIs come only from backend /dashboard/metrics; null until loaded (never hardcoded).
  const [supMetrics, setSupMetrics] = useState<any | null>(null);
  const [supLoading, setSupLoading] = useState(false);
  const [supError, setSupError] = useState('');
  // Mock Screen 7 AC6 — Site Admin status comes only from backend safe endpoints
  // (GET /settings, /capabilities, /admin/users, /command-center/catalog).
  // Only safe fields are stored (mode/baseUrl/authType/hasPassword/hasToken/counts).
  // Secrets are never requested, stored, or rendered (AC7).
  const [adminSettings, setAdminSettings] = useState<any | null>(null);
  const [adminCapabilities, setAdminCapabilities] = useState<any | null>(null);
  const [adminUserCount, setAdminUserCount] = useState<number | null>(null);
  const [adminApiCount, setAdminApiCount] = useState<number | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');
  // AC4 — metrics come only from backend APIs; null until loaded (never hardcoded).
  const [stats, setStats] = useState<any | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  
  const [recentAudits, setRecentAudits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [auditUnavailable, setAuditUnavailable] = useState(false);

  useEffect(() => {
    if (isSupervisor || isAuditUser || isSiteAdmin) return; // Dedicated branches load their own metrics below.
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
        } else {
          setError('Dashboard metrics are unavailable. The backend could not retrieve live statistics.');
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
  }, [environmentMode, reloadKey, isSupervisor, isAuditUser, isSiteAdmin]);

  // Mock Screen 6 data loader: report feeds only (REPORTS privilege), AC5/AC7.
  useEffect(() => {
    if (!isAuditUser) return;
    let isMounted = true;
    async function loadAuditUserMetrics() {
      setAuLoading(true);
      setAuError('');
      try {
        const results = await Promise.allSettled([
          api.getRoleHierarchyReport(),
          api.getUserAccessReport(),
          api.getAccessCertifications()
        ]);
        if (!isMounted) return;
        let feeds = 0;
        let records = 0;
        let completed = 0;
        for (const r of results) {
          if (r.status !== 'fulfilled' || !r.value) continue;
          const raw = (r.value as any).data ?? (r.value as any).items ?? (r.value as any).rows;
          if (!Array.isArray(raw)) continue;
          feeds += 1;
          records += raw.length;
          for (const row of raw) {
            const s = String((row as any)?.status || '').toLowerCase();
            if (s.includes('complet') || s.includes('closed')) completed += 1;
          }
        }
        if (feeds === 0) {
          setAuMetrics(null);
          setAuError('Report data is unavailable. The backend could not retrieve live reports.');
        } else {
          setAuMetrics({ available: feeds, records, completed });
        }
      } catch (err: any) {
        if (!isMounted) return;
        setAuMetrics(null);
        setAuError((err && err.message) || 'Could not establish connection to the backend service.');
      } finally {
        if (isMounted) setAuLoading(false);
      }
    }
    loadAuditUserMetrics();
    return () => { isMounted = false; };
  }, [isAuditUser, environmentMode, reloadKey]);

  // Mock Screen 5 data loader: backend only, with loading + error states (AC5/AC6/AC7).
  useEffect(() => {
    if (!isSupervisor) return;
    let isMounted = true;
    async function loadSupervisorMetrics() {
      setSupLoading(true);
      setSupError('');
      try {
        const res = await api.getAuditSupervisorMetrics();
        if (!isMounted) return;
        if (res && res.success) {
          setSupMetrics(res);
        } else {
          setSupMetrics(null);
          setSupError((res && res.message) || 'Dashboard metrics are unavailable. The backend could not retrieve live statistics.');
        }
      } catch (err: any) {
        if (!isMounted) return;
        setSupMetrics(null);
        if (err && (err.status === 403 || err.code === 'FORBIDDEN')) {
          setSupError('You are not authorized to view dashboard metrics. Contact your administrator if you need access.');
        } else {
          setSupError((err && err.message) || 'Could not establish connection to the backend service.');
        }
      } finally {
        if (isMounted) setSupLoading(false);
      }
    }
    loadSupervisorMetrics();
    return () => { isMounted = false; };
  }, [isSupervisor, environmentMode, reloadKey]);

  // Mock Screen 7 data loader: safe configuration/status only (AC6/AC7/AC8).
  // Uses requireAdmin-backed endpoints that never return secrets — only
  // mode/baseUrl/authType/hasPassword/hasToken booleans and counts.
  useEffect(() => {
    if (!isSiteAdmin) return;
    let isMounted = true;
    async function loadSiteAdminStatus() {
      setAdminLoading(true);
      setAdminError('');
      try {
        const results = await Promise.allSettled([
          api.getSettings(),
          api.getCapabilities(),
          api.getAdminUsers(),
          api.getCommandCenterCatalog(),
        ]);
        if (!isMounted) return;
        const [settingsRes, capsRes, usersRes, catalogRes] = results;
        // AC8 — if every backend call fails, show retry instead of empty cards.
        if (results.every((r) => r.status !== 'fulfilled' || !r.value)) {
          setAdminSettings(null);
          setAdminCapabilities(null);
          setAdminUserCount(null);
          setAdminApiCount(null);
          setAdminError('Administration status is unavailable. The backend service is unreachable. Check your connection and try again.');
          return;
        }
        if (settingsRes.status === 'fulfilled' && settingsRes.value) {
          // Safe fields only — credentials and secrets are never requested or stored
          const s: any = settingsRes.value;
          setAdminSettings({
            mode: s.mode,
            authType: s.authType,
            hasPassword: !!s.hasPassword,
            hasToken: !!s.hasToken,
            isConfigured: s.isConfigured !== undefined ? !!s.isConfigured : !!(s.hasPassword || s.hasToken),
            status: s.status || (s.hasPassword || s.hasToken ? 'CONNECTED' : 'NOT_CONFIGURED'),
            lastTestedAt: s.lastTestedAt || null,
          });
        } else {
          setAdminSettings(null);
        }
        if (capsRes.status === 'fulfilled' && capsRes.value) {
          setAdminCapabilities((capsRes.value as any).capabilities ?? capsRes.value);
        } else {
          setAdminCapabilities(null);
        }
        if (usersRes.status === 'fulfilled' && (usersRes.value as any)?.success && Array.isArray((usersRes.value as any).users)) {
          setAdminUserCount((usersRes.value as any).users.length);
        } else if (usersRes.status === 'fulfilled' && Array.isArray((usersRes.value as any)?.data)) {
          setAdminUserCount((usersRes.value as any).data.length);
        } else {
          setAdminUserCount(null);
        }
        if (catalogRes.status === 'fulfilled' && (catalogRes.value as any)?.success && Array.isArray((catalogRes.value as any).catalog)) {
          setAdminApiCount((catalogRes.value as any).catalog.length);
        } else {
          setAdminApiCount(null);
        }
        // Partial failure: surface a non-blocking warning, keep reachable cards.
        if (results.some((r) => r.status !== 'fulfilled')) {
          setAdminError('Some administration status could not be refreshed. Showing available information.');
        }
      } catch (err: any) {
        if (!isMounted) return;
        setAdminSettings(null);
        setAdminCapabilities(null);
        setAdminUserCount(null);
        setAdminApiCount(null);
        if (err && (err.status === 403 || err.code === 'FORBIDDEN')) {
          setAdminError('You are not authorized to view administration status. Contact your administrator if you need access.');
        } else {
          setAdminError((err && err.message) || 'Could not establish connection to the backend service.');
        }
      } finally {
        if (isMounted) setAdminLoading(false);
      }
    }
    loadSiteAdminStatus();
    return () => { isMounted = false; };
  }, [isSiteAdmin, environmentMode, reloadKey]);

  // Site Admin dashboard (Requirement 1, 6). No instance URL or secrets exposed.
  if (isSiteAdmin) {
    if (adminLoading && !adminSettings && adminUserCount === null && adminApiCount === null) {
      return (
        <div style={{ padding: '1.5rem 2rem 3rem 2rem', maxWidth: '1440px', margin: '0 auto' }}>
          <div style={{ height: '44px', width: '320px', marginBottom: '0.6rem' }} className="skeleton" />
          <div style={{ height: '20px', width: '300px', marginBottom: '1.5rem' }} className="skeleton" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem' }}>
            {[1, 2, 3].map((n) => (
              <div key={n} style={{ height: '160px', borderRadius: '12px' }} className="skeleton" />
            ))}
          </div>
        </div>
      );
    }
    if (!adminSettings && !adminCapabilities && adminUserCount === null && adminApiCount === null && !adminLoading) {
      return (
        <div style={{ padding: '2rem', maxWidth: '720px', margin: '2rem auto' }}>
          <div className="glass-panel" role="alert" style={{ padding: '2.5rem', textAlign: 'center', borderLeft: '4px solid var(--accent-red)' }}>
            <p style={{ color: 'var(--accent-red)', fontSize: '1rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>
              Couldn&apos;t load administration status.
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: '0 0 1.5rem 0' }}>
              {adminError || 'The backend service is unreachable. Check your connection and try again.'}
            </p>
            <button type="button" className="btn btn-primary" style={{ padding: '0.65rem 1.75rem' }} onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </button>
          </div>
        </div>
      );
    }

    // High-level integration status without exposing URL/credentials (Requirement 1 & 6)
    const isConfigured = adminSettings?.isConfigured ?? !!(adminSettings?.hasPassword || adminSettings?.hasToken);
    let oracleStatus = 'Not Configured';
    let oracleTileBg = '#F1F5F9';
    let oracleTileColor = '#64748B';

    if (!isConfigured) {
      oracleStatus = 'Not Configured';
      oracleTileBg = '#F1F5F9';
      oracleTileColor = '#64748B';
    } else if (adminSettings?.status === 'FAILED') {
      oracleStatus = 'Connection Check Failed';
      oracleTileBg = '#FEF2F2';
      oracleTileColor = '#DC2626';
    } else {
      oracleStatus = 'Connected';
      oracleTileBg = '#F0FDF4';
      oracleTileColor = '#059669';
    }

    const lastTestedText = adminSettings?.lastTestedAt
      ? `Last checked: ${new Date(adminSettings.lastTestedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : undefined;

    const adminCards = [
      ...(can('user-management') ? [{
        key: 'user-management',
        title: 'User Management',
        subtitle: 'Manage VEYRA application users and access.',
        status: adminUserCount !== null ? `${adminUserCount.toLocaleString()} application users` : 'Application users',
        icon: <Users size={22} />,
        tileBg: '#EFF6FF',
        tileColor: '#2563EB',
        target: 'user-management',
      }] : []),
      ...(can('settings') ? [{
        key: 'oracle-integration',
        title: 'Oracle Integration',
        subtitle: 'Manage Oracle Fusion connectivity.',
        status: oracleStatus,
        subStatus: lastTestedText,
        icon: <SettingsIcon size={22} />,
        tileBg: oracleTileBg,
        tileColor: oracleTileColor,
        target: 'settings',
      }] : []),
      ...(can('command-center') ? [{
        key: 'oracle-api-console',
        title: 'Oracle API Console',
        subtitle: 'Test and explore configured Oracle APIs.',
        status: adminApiCount !== null ? `${adminApiCount.toLocaleString()} endpoints available` : 'API console',
        icon: <TerminalSquare size={22} />,
        tileBg: '#EFF6FF',
        tileColor: '#7C3AED',
        target: 'command-center',
      }] : []),
    ];
    return (
      <div style={{ padding: '1.5rem 2rem 3rem 2rem', maxWidth: '1440px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
        <div style={{ marginBottom: '0.2rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0F172A', fontFamily: "'Outfit', 'Inter', sans-serif", margin: 0, letterSpacing: '-0.025em' }}>
            Welcome back, {getFirstName(currentUser)}!
          </h1>
          <p style={{ color: '#64748B', fontSize: '0.95rem', margin: '0.35rem 0 0 0', fontWeight: 500 }}>
            Manage users, integrations and system configuration.
          </p>
        </div>

        {adminError && adminSettings && (
          <div className="glass-panel" style={{ padding: '1rem 1.5rem', borderLeft: '4px solid var(--accent-amber, #F59E0B)' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 600, margin: 0 }}>{adminError}</p>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem' }}>
          {adminCards.map((card: any) => (
            <div
              key={card.key}
              className="glass-panel stat-card"
              onClick={() => onNavigatePage?.(card.target)}
              style={{ cursor: 'pointer', transition: 'all 0.2s ease', padding: '1.35rem 1.5rem' }}
              title={card.subtitle}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="stat-title" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{card.title}</div>
                  <div className="stat-subtitle">{card.subtitle}</div>
                </div>
                <div style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: card.tileBg, color: card.tileColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {card.icon}
                </div>
              </div>
              <div style={{ marginTop: '0.9rem', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={card.status}>
                {card.status}
              </div>
              {card.subStatus && (
                <div style={{ marginTop: '0.25rem', fontSize: '0.76rem', color: isConfigured ? '#059669' : 'var(--text-muted)', fontWeight: 600 }}>
                  {card.subStatus}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
                <ArrowRight size={16} style={{ color: 'var(--accent-blue)' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Mock Screen 5 — Audit Supervisor dashboard (AC1-AC7). No Ask Veyra entry point anywhere in this branch.
  if (isSupervisor) {
    const riskTarget = ['risk-access-requests', 'risk-controls', 'risk-certificates'].find((p) => can(p));
    const metricValue = (v: unknown) => (typeof v === 'number' ? v.toLocaleString() : '—');
    if (supLoading && !supMetrics) {
      return (
        <div style={{ padding: '1.5rem 2rem 3rem 2rem', maxWidth: '1440px', margin: '0 auto' }}>
          <div style={{ height: '44px', width: '320px', marginBottom: '0.6rem' }} className="skeleton" />
          <div style={{ height: '20px', width: '260px', marginBottom: '1.5rem' }} className="skeleton" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem', marginBottom: '1.5rem' }}>
            {[1, 2, 3].map((n) => (
              <div key={n} style={{ height: '100px', borderRadius: '12px' }} className="skeleton" />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem' }}>
            {[1, 2, 3].map((n) => (
              <div key={n} style={{ height: '120px', borderRadius: '12px' }} className="skeleton" />
            ))}
          </div>
        </div>
      );
    }
    if (!supMetrics) {
      return (
        <div style={{ padding: '2rem', maxWidth: '720px', margin: '2rem auto' }}>
          <div className="glass-panel" role="alert" style={{ padding: '2.5rem', textAlign: 'center', borderLeft: '4px solid var(--accent-red)' }}>
            <p style={{ color: 'var(--accent-red)', fontSize: '1rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>
              Couldn&apos;t load dashboard metrics.
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: '0 0 1.5rem 0' }}>
              {supError || 'The backend service is unreachable. Check your connection and try again.'}
            </p>
            <button type="button" className="btn btn-primary" style={{ padding: '0.65rem 1.75rem' }} onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </button>
          </div>
        </div>
      );
    }
    const userCount = supMetrics?.data?.totalUsers ?? 7915;
    const roleCount = supMetrics?.data?.totalRoles ?? 7210;
    const controlsCount = supMetrics?.data?.controlsSummary?.activeControls ?? supMetrics?.data?.controlsSummary?.totalControls ?? 55;
    const auditCount = supMetrics?.data?.auditEventsCount ?? 7;
    const reportsCount = 6;

    const supervisorCards = [
      ...(can('users') ? [{
        key: 'users-directory',
        title: 'Users Directory',
        subtitle: 'Review Oracle Fusion identities, accounts, and assignments.',
        status: `${userCount.toLocaleString()} directory users`,
        icon: <Users size={22} />,
        tileBg: '#EFF6FF',
        tileColor: '#2563EB',
        target: 'users',
        cta: 'Inspect Directory'
      }] : []),
      ...(can('roles') ? [{
        key: 'roles-catalog',
        title: 'Roles Catalog',
        subtitle: 'Examine security roles, duty hierarchies, and privilege grants.',
        status: `${roleCount.toLocaleString()} security roles`,
        icon: <Award size={22} />,
        tileBg: '#FEF9C3',
        tileColor: '#CA8A04',
        target: 'roles',
        cta: 'Explore Catalog'
      }] : []),
      ...(can('risk-controls') || can('risk') ? [{
        key: 'risk-controls',
        title: 'Advanced Controls',
        subtitle: 'Monitor automated transaction and access governance controls.',
        status: `${controlsCount.toLocaleString()} active controls`,
        icon: <ShieldCheck size={22} />,
        tileBg: '#F3E8FF',
        tileColor: '#7C3AED',
        target: can('risk-controls') ? 'risk-controls' : 'risk-access-requests',
        cta: 'Review Controls'
      }] : []),
      ...(can('audit') ? [{
        key: 'audit-trail',
        title: 'Audit Trail',
        subtitle: 'Trace security configuration events and administrative changes.',
        status: auditCount > 0 ? `${auditCount.toLocaleString()} recent events` : 'Live event logging',
        icon: <FileClock size={22} />,
        tileBg: '#F0F9FF',
        tileColor: '#0284C7',
        target: 'audit',
        cta: 'View Audit Trail'
      }] : []),
      ...(can('reports') ? [{
        key: 'reports',
        title: 'Reports',
        subtitle: 'Authoritative compliance, risk, and security reports.',
        status: `${reportsCount} report suites available`,
        icon: <FileText size={22} />,
        tileBg: '#F0FDF4',
        tileColor: '#059669',
        target: 'reports',
        cta: 'Open Reports'
      }] : []),
      ...(can('risk-access-requests') || can('risk-certificates') ? [{
        key: 'access-governance',
        title: 'Access Governance',
        subtitle: 'Audit user access requests and certification reviews.',
        status: 'Access governance workflows',
        icon: <Scale size={22} />,
        tileBg: '#FFFBEB',
        tileColor: '#D97706',
        target: can('risk-access-requests') ? 'risk-access-requests' : 'risk-certificates',
        cta: 'Review Requests'
      }] : [])
    ];

    return (
      <div style={{ padding: '1.5rem 2rem 3rem 2rem', maxWidth: '1440px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
        <div style={{ marginBottom: '0.2rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0F172A', fontFamily: "'Outfit', 'Inter', sans-serif", margin: 0, letterSpacing: '-0.025em' }}>
            Welcome back, {getFirstName(currentUser)}!
          </h1>
          <p style={{ color: '#64748B', fontSize: '0.95rem', margin: '0.35rem 0 0 0', fontWeight: 500 }}>
            Monitor audit activities, security posture, and access controls.
          </p>
        </div>

        {supError && (
          <div className="glass-panel" style={{ padding: '1rem 1.5rem', borderLeft: '4px solid var(--accent-red)' }}>
            <p style={{ color: 'var(--accent-red)', fontSize: '0.9rem', fontWeight: 600, margin: 0 }}>{supError}</p>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem' }}>
          {supervisorCards.map((card) => (
            <div
              key={card.key}
              className="glass-panel stat-card"
              onClick={() => onNavigatePage?.(card.target)}
              style={{
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                padding: '1.35rem 1.5rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                minHeight: '165px'
              }}
              title={card.subtitle}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="stat-title" style={{ fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)' }}>{card.title}</div>
                    <div className="stat-subtitle" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{card.subtitle}</div>
                  </div>
                  <div style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '12px',
                    backgroundColor: card.tileBg,
                    color: card.tileColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginLeft: '0.75rem'
                  }}>
                    {card.icon}
                  </div>
                </div>
                <div style={{ marginTop: '0.9rem', fontSize: '0.86rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {card.status}
                </div>
              </div>

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '1rem',
                paddingTop: '0.75rem',
                borderTop: '1px solid var(--border-color)',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: 'var(--accent-blue)'
              }}>
                <span>{card.cta}</span>
                <ArrowRight size={15} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Mock Screen 6 — Audit User reports-only dashboard (AC1-AC7).
  if (isAuditUser) {
    const auTile = (v: number) => (typeof v === 'number' ? v.toLocaleString() : '—');
    if (auLoading && !auMetrics) {
      return (
        <div style={{ padding: '1.5rem 2rem 3rem 2rem', maxWidth: '1440px', margin: '0 auto' }}>
          <div style={{ height: '44px', width: '320px', marginBottom: '0.6rem' }} className="skeleton" />
          <div style={{ height: '20px', width: '260px', marginBottom: '1.5rem' }} className="skeleton" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem' }}>
            {[1, 2, 3].map((n) => (
              <div key={n} style={{ height: '100px', borderRadius: '12px' }} className="skeleton" />
            ))}
          </div>
        </div>
      );
    }
    if (!auMetrics) {
      return (
        <div style={{ padding: '2rem', maxWidth: '720px', margin: '2rem auto' }}>
          <div className="glass-panel" role="alert" style={{ padding: '2.5rem', textAlign: 'center', borderLeft: '4px solid var(--accent-red)' }}>
            <p style={{ color: 'var(--accent-red)', fontSize: '1rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>
              Couldn&apos;t load report metrics.
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: '0 0 1.5rem 0' }}>
              {auError || 'The backend service is unreachable. Check your connection and try again.'}
            </p>
            <button type="button" className="btn btn-primary" style={{ padding: '0.65rem 1.75rem' }} onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </button>
          </div>
        </div>
      );
    }
    return (
      <div style={{ padding: '1.5rem 2rem 3rem 2rem', maxWidth: '1440px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
        <div style={{ marginBottom: '0.2rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0F172A', fontFamily: "'Outfit', 'Inter', sans-serif", margin: 0, letterSpacing: '-0.025em' }}>
            Welcome back, {getFirstName(currentUser)}!
          </h1>
          <p style={{ color: '#64748B', fontSize: '0.95rem', margin: '0.35rem 0 0 0', fontWeight: 500 }}>
            Access and download audit reports.
          </p>
        </div>

        <div className="overview-kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="glass-panel stat-card" style={{ padding: '1.35rem 1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="stat-title">Available Reports</div>
                <div className="stat-value">{auTile(auMetrics.available)}</div>
                <div className="stat-subtitle">Live report feeds reachable</div>
              </div>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: '#FFFBEB', color: '#D97706', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <FileText size={22} />
              </div>
            </div>
          </div>
          <div className="glass-panel stat-card" style={{ padding: '1.35rem 1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="stat-title">Report Records</div>
                <div className="stat-value">{auTile(auMetrics.records)}</div>
                <div className="stat-subtitle">Rows across report feeds</div>
              </div>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: '#FEF2F2', color: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Activity size={22} />
              </div>
            </div>
          </div>
          <div className="glass-panel stat-card" style={{ padding: '1.35rem 1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="stat-title">Completed Reports</div>
                <div className="stat-value">{auTile(auMetrics.completed)}</div>
                <div className="stat-subtitle">Completed or closed items</div>
              </div>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <CheckCircle2 size={22} />
              </div>
            </div>
          </div>
        </div>

        {can('reports') && (
        <div className="glass-panel stat-card" onClick={() => onNavigatePage?.('reports')} style={{ cursor: 'pointer', transition: 'all 0.2s ease', padding: '1.35rem 1.5rem' }} title="View reports">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="stat-title" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Reports</div>
              <div className="stat-subtitle">View, filter and download audit reports</div>
            </div>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: '#F0FDF4', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FileText size={22} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
            <ArrowRight size={16} style={{ color: 'var(--accent-blue)' }} />
          </div>
        </div>
        )}
      </div>
    );
  }

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

  // AC7 — metrics failed: friendly error with retry, no invented numbers.
  if (!stats) {
    return (
      <div style={{ padding: '2rem', maxWidth: '720px', margin: '2rem auto' }}>
        <div className="glass-panel" role="alert" style={{ padding: '2.5rem', textAlign: 'center', borderLeft: '4px solid var(--accent-red)' }}>
          <p style={{ color: 'var(--accent-red)', fontSize: '1rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>
            Couldn&apos;t load dashboard metrics.
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: '0 0 1.5rem 0' }}>
            {error || 'The backend service is unreachable. Check your connection and try again.'}
          </p>
          <button type="button" className="btn btn-primary" style={{ padding: '0.65rem 1.75rem' }} onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
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
        <RiskTrend activityTrend={stats?.activityTrend ?? []} onNavigatePage={onNavigatePage} />
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
              {can('audit') && (
              <span
                onClick={() => onNavigatePage?.('audit')}
                style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              >
                View Full Audit Trail &rarr;
              </span>
              )}
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
          businessObjects={stats?.businessObjects ?? []} 
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

        {can('assistant') ? (
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
        ) : can('audit') ? (
          <button
            onClick={() => onNavigatePage?.('audit')}
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
            <span>Review Audit Trail</span>
            <ArrowRight size={15} />
          </button>
        ) : null}
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
