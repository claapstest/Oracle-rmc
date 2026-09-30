import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  LayoutDashboard,
  MessageSquareCode,
  Users,
  Award,
  FileClock,
  ShieldAlert,
  Settings as SettingsIcon,
  LogOut,
  Lock,
  PanelLeft,
  Bell,
  Terminal,
  FileSpreadsheet,
  FileText,
  Scale,
  ChevronDown,
  ChevronRight,
  ArrowLeft
} from 'lucide-react';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Assistant from './pages/Assistant';
import UsersPage from './pages/Users';
import RolesPage from './pages/Roles';
import AuditPage from './pages/Audit';
import AdvancedAccessRequestsPage from './pages/AdvancedAccessRequests';
import AdvancedControlsPage from './pages/AdvancedControls';
import AccessCertificatesPage from './pages/AccessCertificates';
import ReportsPage from './pages/Reports';
import SettingsPage from './pages/Settings';
import CommandCenter from './pages/CommandCenter';
import InvestigationWorkspace from './pages/InvestigationWorkspace';
import FullInvestigationView from './pages/FullInvestigationView';

import { api, getActiveAuthToken, getActiveUserEmail, getActiveUserRole, getActiveUserPermissions, setActiveAuthSession, clearActiveAuthSession, clearClientApiCache } from './services/api';
import { canAccessPage, type AuthContext } from './utils/authorization';
import { clearSecuritySession } from './services/securitySessionService';
import { SessionTimeoutModal } from './components/SessionTimeoutModal';
import { useSessionTimeout } from './hooks/useSessionTimeout';

// Risk Management is a parent navigation group (no content page of its own).
// Its three child pages are distinct application page states.
interface RiskChildNavItem {
  id: string;
  label: string;
  icon: any;
}

const RISK_CHILDREN: RiskChildNavItem[] = [
  { id: 'risk-access-requests', label: 'Advanced Access Requests', icon: FileText },
  { id: 'risk-controls', label: 'Advanced Controls', icon: Scale },
  { id: 'risk-certificates', label: 'Access Certificates', icon: Award }
];

const RISK_CHILD_IDS = new Set(RISK_CHILDREN.map(c => c.id));

const TOP_LEVEL_PAGE_IDS = new Set([
  'dashboard',
  'assistant',
  'users',
  'roles',
  'audit',
  'reports',
  'settings',
  'command-center'
]);

function resolveStoredPage(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlPage = params.get('page');
    if (urlPage && (TOP_LEVEL_PAGE_IDS.has(urlPage) || RISK_CHILD_IDS.has(urlPage))) {
      return urlPage;
    }
    const stored = sessionStorage.getItem('activePage') || 'dashboard';
    // Migrate the retired Risk Management landing-page route to its first child
    if (stored === 'risk') return 'risk-access-requests';
    // Migrate the retired Overview route to Dashboard
    if (stored === 'overview') return 'dashboard';
    if (TOP_LEVEL_PAGE_IDS.has(stored) || RISK_CHILD_IDS.has(stored)) return stored;
  } catch (_) {
    /* fall through to default */
  }
  return 'dashboard';
}

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState('');
  const [currentPage, setCurrentPage] = useState(() => {
    return resolveStoredPage();
  });
  const [visitedPages, setVisitedPages] = useState<Set<string>>(() => {
    const initial = resolveStoredPage();
    const pages = new Set([initial]);
    // AC4 — never pre-mount Ask Veyra for sessions that may not access it.
    // Re-verified against live backend session on mount; navigation re-adds it when allowed.
    const storedRole = getActiveUserRole();
    const storedPerms = getActiveUserPermissions();
    if (canAccessPage('assistant', { isAdmin: false, role: storedRole, permissions: storedPerms })) {
      pages.add('assistant');
    }
    return pages;
  });
  const [environmentMode, setEnvironmentMode] = useState<'DEMO' | 'ORACLE_FUSION'>(() => {
    return (localStorage.getItem('environmentMode') as 'DEMO' | 'ORACLE_FUSION') || 'ORACLE_FUSION';
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [userRole, setUserRole] = useState(() => getActiveUserRole());
  const [userPermissions, setUserPermissions] = useState<string[]>(() => getActiveUserPermissions());
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    return sessionStorage.getItem('activePage') !== 'assistant';
  });
  // Manual expand/collapse for the Risk Management parent group.
  // The group is additionally force-expanded whenever a Risk child page is active.
  const [riskGroupOpen, setRiskGroupOpen] = useState(false);

  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<string>('');

  // Topbar user account dropdown menu state
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Restore authenticated session and environment mode from active session storage on mount,
  // verifying session validity with the backend
  useEffect(() => {
    const token = getActiveAuthToken();
    const user = getActiveUserEmail();
    const savedEnv = (localStorage.getItem('environmentMode') || sessionStorage.getItem('environmentMode')) as 'DEMO' | 'ORACLE_FUSION' | null;
    if (savedEnv) {
      setEnvironmentMode(savedEnv);
    }

    if (!token || !user) {
      clearActiveAuthSession();
      setIsLoggedIn(false);
      setCurrentUser('');
      setIsAdmin(false);
      setUserRole('');
      setUserPermissions([]);
      setAuthChecked(true);
      return;
    }

    async function verifyAuth() {
      try {
        const res = await api.getSessionStatus();
        if (res && res.loggedIn && res.email) {
          setIsLoggedIn(true);
          setCurrentUser(res.email);
          setIsAdmin(!!res.isAdmin);
          setUserRole(res.role || '');
          setUserPermissions(Array.isArray(res.permissions) ? res.permissions : []);
          setActiveAuthSession(token, res.email, res.role || '', Array.isArray(res.permissions) ? res.permissions : []);
          if (res.environmentMode) {
            setEnvironmentMode(res.environmentMode);
            localStorage.setItem('environmentMode', res.environmentMode);
          }
        } else {
          clearActiveAuthSession();
          setIsLoggedIn(false);
          setCurrentUser('');
          setIsAdmin(false);
          setUserRole('');
          setUserPermissions([]);
        }
      } catch (err) {
        console.warn('Session verification failed, redirecting to login:', err);
        clearActiveAuthSession();
        setIsLoggedIn(false);
        setCurrentUser('');
        setIsAdmin(false);
        setUserRole('');
        setUserPermissions([]);
      } finally {
        setAuthChecked(true);
      }
    }

    verifyAuth();
  }, []);

  // Listen for session expiration events dispatched across the app
  useEffect(() => {
    const handleAuthExpired = () => {
      console.warn('Authentication session expired. Prompting for credentials.');
      handleLogout('EXPIRED');
    };
    window.addEventListener('auth:expired', handleAuthExpired);
    return () => window.removeEventListener('auth:expired', handleAuthExpired);
  }, [currentUser]);

  // Bridge state for FAQ clicking
  const [faqQuestion, setFaqQuestion] = useState('');

  // Stack navigation history item definition
  interface InvestigationHistoryItem {
    kind: 'entity' | 'query';
    type?: 'role' | 'user';
    id: string; // roleCode or username or investigationId
    name?: string; // displayName
    initialTab?: string;
  }

  // Active investigation workspace entity state
  const [activeInvestigation, setActiveInvestigation] = useState<{
    type: 'role' | 'user';
    id: string; // roleCode or username
    name: string; // displayName
    initialTab?: string;
  } | null>(null);

  // Active query-level investigation snapshot state (same tab)
  const [activeQueryInvestigation, setActiveQueryInvestigation] = useState<string | null>(null);

  // Stack navigation history state
  const [investigationHistory, setInvestigationHistory] = useState<InvestigationHistoryItem[]>([]);

  // URL synchronization helpers
  const updateUrlForInvestigation = (item: InvestigationHistoryItem) => {
    try {
      let newUrl = '';
      if (item.kind === 'query') {
        newUrl = `/?investigationId=${encodeURIComponent(item.id)}`;
      } else {
        newUrl = `/ask-veyra/investigation/${item.type || 'user'}/${encodeURIComponent(item.id)}`;
      }
      window.history.pushState({ investigation: item }, '', newUrl);
    } catch (_) { }
  };

  const resetUrlToCurrentPage = () => {
    try {
      window.history.pushState(null, '', `/?page=${currentPage}`);
    } catch (_) { }
  };

  const handleOpenQueryInvestigation = (invId: string, _payload?: any) => {
    const item: InvestigationHistoryItem = { kind: 'query', id: invId };
    setInvestigationHistory(prev => {
      // If navigating from another state, preserve it in stack
      return [...prev, item];
    });
    setActiveQueryInvestigation(invId);
    setActiveInvestigation(null);
    setIsSidebarOpen(false);
    updateUrlForInvestigation(item);
  };

  const handleInvestigate = (type: 'role' | 'user', id: string, name: string, initialTab?: string) => {
    const entity = { type, id, name, initialTab };
    const item: InvestigationHistoryItem = { kind: 'entity', type, id, name, initialTab };
    setInvestigationHistory([item]);
    setActiveInvestigation(entity);
    setActiveQueryInvestigation(null);
    setIsSidebarOpen(false); // Focused workspace collapses sidebar
    updateUrlForInvestigation(item);
  };

  const handleNavigate = (type: 'role' | 'user', id: string, name: string, initialTab?: string) => {
    const entity = { type, id, name, initialTab };
    const item: InvestigationHistoryItem = { kind: 'entity', type, id, name, initialTab };
    setInvestigationHistory(prev => [...prev, item]);
    setActiveInvestigation(entity);
    updateUrlForInvestigation(item);
  };

  const handleInvestigateFromQuery = (type: 'role' | 'user', id: string, name: string) => {
    const entity = { type, id, name };
    const item: InvestigationHistoryItem = { kind: 'entity', type, id, name };
    setInvestigationHistory(prev => {
      const base = prev.length > 0 ? prev : (activeQueryInvestigation ? [{ kind: 'query', id: activeQueryInvestigation } as InvestigationHistoryItem] : []);
      return [...base, item];
    });
    setActiveInvestigation(entity);
    updateUrlForInvestigation(item);
  };

  const handleBack = () => {
    setInvestigationHistory(prev => {
      const nextHistory = prev.slice(0, -1);
      if (nextHistory.length === 0) {
        setActiveInvestigation(null);
        setActiveQueryInvestigation(null);
        resetUrlToCurrentPage();
      } else {
        const top = nextHistory[nextHistory.length - 1];
        if (top.kind === 'query') {
          setActiveQueryInvestigation(top.id);
          setActiveInvestigation(null);
          updateUrlForInvestigation(top);
        } else {
          setActiveInvestigation({
            type: top.type || 'user',
            id: top.id,
            name: top.name || top.id,
            initialTab: top.initialTab
          });
          setActiveQueryInvestigation(null);
          updateUrlForInvestigation(top);
        }
      }
      return nextHistory;
    });
  };

  const handleClose = () => {
    setInvestigationHistory([]);
    setActiveInvestigation(null);
    setActiveQueryInvestigation(null);
    resetUrlToCurrentPage();
  };

  // Browser back & forward navigation listener (popstate)
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (e.state && e.state.investigation) {
        const item = e.state.investigation as InvestigationHistoryItem;
        if (item.kind === 'query') {
          setActiveQueryInvestigation(item.id);
          setActiveInvestigation(null);
        } else {
          setActiveInvestigation({
            type: item.type || 'user',
            id: item.id,
            name: item.name || item.id,
            initialTab: item.initialTab
          });
          setActiveQueryInvestigation(null);
        }
      } else {
        // Returned to base page state
        setActiveInvestigation(null);
        setActiveQueryInvestigation(null);
        setInvestigationHistory([]);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Check URL on startup for direct link or refresh
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invId = params.get('investigationId');
    const path = window.location.pathname;

    if (invId) {
      handleOpenQueryInvestigation(invId);
    } else if (path.includes('/investigation/user/')) {
      const username = decodeURIComponent(path.split('/investigation/user/')[1] || '').trim();
      if (username) {
        handleInvestigate('user', username, username);
      }
    } else if (path.includes('/investigation/role/')) {
      const roleCode = decodeURIComponent(path.split('/investigation/role/')[1] || '').trim();
      if (roleCode) {
        handleInvestigate('role', roleCode, roleCode);
      }
    }
  }, []);

  const handlePageSelect = (pageId: string) => {
    setCurrentPage(pageId);
    sessionStorage.setItem('activePage', pageId);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('page', pageId);
      window.history.replaceState(null, '', url.toString());
    } catch (_) {
      /* URL sync is best-effort; sessionStorage remains authoritative */
    }
    setVisitedPages(prev => {
      if (prev.has(pageId)) return prev;
      const next = new Set(prev);
      next.add(pageId);
      return next;
    });
    handleClose(); // Clear investigation when switching screens
    setInitialRolesCategory('ALL'); // Reset filters
    setInitialUsersFilter('ALL');
    if (pageId === 'assistant') {
      setIsSidebarOpen(false); // Ask VEYRA defaults to full width
    } else {
      setIsSidebarOpen(true); // Normal pages default to visible sidebar
    }
  };

  // States to pass down filters when navigating from cards
  const [initialRolesCategory, setInitialRolesCategory] = useState('ALL');
  const [initialUsersFilter, setInitialUsersFilter] = useState('ALL');

  // Synchronize settings and verify admin status on login
  useEffect(() => {
    async function fetchServerSettings() {
      if (!isLoggedIn || !currentUser) {
        setIsAdmin(false);
        return;
      }
      try {
        const settings = await api.getSettings();
        if (settings?.mode) {
          setEnvironmentMode(settings.mode);
          localStorage.setItem('environmentMode', settings.mode);
        }
        setIsAdmin(true);
      } catch (err) {
        console.error('Failed to sync server settings (unauthorized or network error):', err);
        setIsAdmin(false);
      }
    }
    fetchServerSettings();
  }, [isLoggedIn, currentUser]);

  const handleLoginSuccess = (
    username: string,
    token: string,
    envMode?: 'DEMO' | 'ORACLE_FUSION',
    auth?: { role?: string; permissions?: string[]; isAdmin?: boolean }
  ) => {
    const role = auth?.role || '';
    const permissions = Array.isArray(auth?.permissions) ? auth!.permissions! : [];
    setActiveAuthSession(token, username, role, permissions);
    setCurrentUser(username);
    setIsAdmin(auth?.isAdmin === true);
    setUserRole(role);
    setUserPermissions(permissions);
    setSessionExpiredNotice('');
    setIsLoggedIn(true);
    setAuthChecked(true);
    if (envMode) {
      setEnvironmentMode(envMode);
      localStorage.setItem('environmentMode', envMode);
    }
  };

  const handleLogout = async (reason: 'MANUAL' | 'EXPIRED' = 'MANUAL') => {
    try {
      await api.logout();
    } catch (err) {
      console.error('Failed to logout cleanly from server:', err);
    }
    clearActiveAuthSession();
    clearSecuritySession(currentUser);
    clearClientApiCache();
    setIsLoggedIn(false);
    setCurrentUser('');
    setIsAdmin(false);
    setUserRole('');
    setUserPermissions([]);
    setCurrentPage('dashboard');
    setIsSidebarOpen(true);
    handleClose();
    setVisitedPages(new Set(['dashboard']));
    setFaqQuestion('');
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch (_) { }

    if (reason === 'EXPIRED') {
      setSessionExpiredNotice('Your session has expired due to inactivity. Please log in again.');
    } else {
      setSessionExpiredNotice('');
    }
  };

  // Session Inactivity Monitoring & Warning Hook (AC1, AC2, AC3, AC4, AC5)
  const {
    isWarningOpen,
    secondsRemaining,
    handleStayLoggedIn,
    handleLogoutNow
  } = useSessionTimeout({
    isLoggedIn,
    onLogout: (reason) => handleLogout(reason),
    timeoutSeconds: 5 * 60, // 5 minutes inactivity (AC1)
    warningSeconds: 30       // 30 seconds warning (AC2)
  });

  // Browser Back Button Protection (AC8)
  useEffect(() => {
    const handlePopState = () => {
      const token = getActiveAuthToken();
      if (!token) {
        setIsLoggedIn(false);
        setCurrentUser('');
        setIsAdmin(false);
        setUserRole('');
        setUserPermissions([]);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleFAQSelect = (question: string) => {
    setFaqQuestion(question);
    handlePageSelect('assistant');
  };

  const urlParams = new URLSearchParams(window.location.search);
  const investigationId = urlParams.get('investigationId');

  if (!authChecked) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--bg-primary)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <ShieldCheck size={40} style={{ color: 'var(--accent-blue)' }} />
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 500 }}>
            Verifying secure session...
          </div>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Login sessionExpiredNotice={sessionExpiredNotice} onLoginSuccess={handleLoginSuccess} />;
  }

  // Helper to extract initials for user avatar
  const getUserInitials = (emailStr: string) => {
    if (!emailStr) return 'AU';
    const namePart = emailStr.split('@')[0];
    const segments = namePart.split('.');
    if (segments.length >= 2) {
      return (segments[0][0] + segments[1][0]).toUpperCase();
    }
    return namePart.substring(0, 2).toUpperCase();
  };

  // Helper to format user display name
  const getUserDisplayName = (emailStr: string) => {
    if (!emailStr) return 'Karthika Gundreddi';
    const namePart = emailStr.split('@')[0];
    const segments = namePart.split('.');
    if (segments.length >= 2) {
      return segments.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
    }
    return namePart.charAt(0).toUpperCase() + namePart.slice(1);
  };

  // Role label derived from the live session role (never hardcoded to one role).
  const getRoleLabel = (role?: string, upper = false) => {
    const norm = (role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    const labels: Record<string, string> = {
      SITE_ADMIN: 'Site Admin',
      AUDIT_MANAGER: 'Audit Manager',
      AUDIT_SUPERVISOR: 'Audit Supervisor',
      AUDIT_USER: 'Audit User',
      SECURITY_ANALYST: 'Security Analyst',
      COMPLIANCE_OFFICER: 'Compliance Officer',
    };
    const label = labels[norm] || (norm ? norm.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ') : 'Audit Manager');
    return upper ? label.toUpperCase() : label;
  };

  // Structured Navigation Hierarchy
  interface NavItem {
    id: string;
    label: string;
    icon: any;
    adminOnly?: boolean;
    isGroup?: boolean;
    onClick?: () => void;
  }

  const allNavItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'assistant', label: 'Ask VEYRA', icon: MessageSquareCode },
    { id: 'users', label: 'Users List', icon: Users },
    { id: 'roles', label: 'Roles Catalog', icon: Award },
    { id: 'audit', label: 'Audit Trail', icon: FileClock },
    { id: 'risk', label: 'Risk Management', icon: ShieldAlert, isGroup: true },
    { id: 'reports', label: 'Reports', icon: FileSpreadsheet },
    { id: 'settings', label: 'Oracle Integration', icon: SettingsIcon, adminOnly: true },
    { id: 'command-center', label: 'Oracle API Console', icon: Terminal }
  ];

  // Risk Management is a parent group: expanded while a child page is active,
  // otherwise follows the manual toggle. Clicking the parent never navigates.
  const isRiskChildActive = RISK_CHILD_IDS.has(currentPage) && !activeInvestigation;
  const isRiskGroupExpanded = riskGroupOpen || isRiskChildActive;

  const pageLabelMap = new Map<string, string>();
  allNavItems.forEach(n => pageLabelMap.set(n.id, n.label));
  RISK_CHILDREN.forEach(c => pageLabelMap.set(c.id, c.label));

  const authCtx: AuthContext = { isAdmin, role: userRole, permissions: userPermissions };
  // Risk group shows when any of its children is authorized (AC3).
  const riskVisible = RISK_CHILDREN.some((c) => canAccessPage(c.id, authCtx));
  // AC6 — denied manual/URL navigation renders access-denied, never protected data.
  const isDeniedPage = isLoggedIn && authChecked && !canAccessPage(currentPage, authCtx);

  return (
    <div className="app-container">

      {/* Redesigned Enterprise Dark Navy Navigation Sidebar */}
      <aside className={`sidebar ${!isSidebarOpen ? 'collapsed' : ''}`}>

        {/* Brand Header */}
        <div className="logo-container" style={{ cursor: 'pointer' }} onClick={() => handlePageSelect('dashboard')}>
          <img
            src="/logo.png"
            alt="CLAAPS VEYRA Logo"
            style={{
              width: '34px',
              height: '34px',
              objectFit: 'contain',
              flexShrink: 0,
              filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.25))'
            }}
          />
          <span className="logo-text" style={{ letterSpacing: '0.01em', fontSize: '1.14rem', fontWeight: 800 }}>
            CLAAPS <span className="logo-accent">VEYRA</span>
          </span>
        </div>

        {/* Clean Navigation Links */}
        <nav className="nav-links" aria-label="Primary">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {allNavItems
              .filter(item => item.isGroup ? riskVisible : canAccessPage(item.id, authCtx))
              .map(item => {
                // Risk Management parent group: expands/collapses, never navigates
                if (item.isGroup && item.id === 'risk') {
                  const GroupIcon = item.icon;
                  return (
                    <div key={item.id}>
                      <a
                        href="#risk"
                        className={`nav-link ${isRiskChildActive ? 'group-active' : ''}`}
                        aria-expanded={isRiskGroupExpanded}
                        aria-label="Risk Management navigation group"
                        onClick={(e) => {
                          e.preventDefault();
                          setRiskGroupOpen(prev => !prev);
                        }}
                        style={isRiskChildActive ? { backgroundColor: 'rgba(255, 255, 255, 0.06)', color: '#FFFFFF' } : undefined}
                      >
                        <GroupIcon size={17} strokeWidth={isRiskChildActive ? 2.2 : 1.8} style={{ flexShrink: 0 }} />
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{item.label}</span>
                        {isRiskGroupExpanded ? <ChevronDown size={14} style={{ flexShrink: 0 }} /> : <ChevronRight size={14} style={{ flexShrink: 0 }} />}
                      </a>
                      {isRiskGroupExpanded && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', marginTop: '0.15rem', marginLeft: '1.35rem', paddingLeft: '0.6rem', borderLeft: '1px solid rgba(255, 255, 255, 0.12)' }} role="group" aria-label="Risk Management pages">
                          {RISK_CHILDREN.filter(child => canAccessPage(child.id, authCtx)).map(child => {
                            const ChildIcon = child.icon;
                            const isChildActive = currentPage === child.id && !activeInvestigation;
                            return (
                              <a
                                key={child.id}
                                href={`#${child.id}`}
                                className={`nav-link nav-link-child ${isChildActive ? 'active' : ''}`}
                                aria-current={isChildActive ? 'page' : undefined}
                                onClick={(e) => {
                                  e.preventDefault();
                                  handlePageSelect(child.id);
                                }}
                                style={{ fontSize: '0.82rem', padding: '0.5rem 0.7rem' }}
                              >
                                <ChildIcon size={15} strokeWidth={isChildActive ? 2.2 : 1.8} style={{ flexShrink: 0 }} />
                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{child.label}</span>
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }
                const Icon = item.icon;
                const isActive = currentPage === item.id && !activeInvestigation;
                return (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className={`nav-link ${isActive ? 'active' : ''}`}
                    onClick={(e) => {
                      e.preventDefault();
                      if (item.onClick) {
                        item.onClick();
                      } else {
                        handlePageSelect(item.id);
                      }
                    }}
                  >
                    <Icon size={17} strokeWidth={isActive ? 2.2 : 1.8} style={{ flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                  </a>
                );
              })}
          </div>
        </nav>

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-brand-motto">A SAFER TOMORROW</div>
          <div className="sidebar-copyright">© 2026 CLAAPS VEYRA. All rights reserved.</div>
        </div>
      </aside>

      {/* Main Panel Viewport */}
      <main className="main-content">

        {/* Topbar matching Blue Gradient Theme */}
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <button
              onClick={() => setIsSidebarOpen(prev => !prev)}
              className="topbar-menu-btn"
              title={isSidebarOpen ? 'Collapse Navigation Sidebar' : 'Expand Navigation Sidebar'}
            >
              <PanelLeft size={16} />
            </button>

            {/* Drill-down Back Arrow (investigation views only) */}
            {(activeInvestigation || activeQueryInvestigation) && (
              <button
                onClick={handleBack}
                className="topbar-menu-btn"
                title={investigationHistory.length > 1 ? 'Back to previous profile' : 'Back to previous view'}
                aria-label="Go back to previous view"
              >
                <ArrowLeft size={16} />
              </button>
            )}

            {/* Breadcrumb Context Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.95rem', color: '#ffffff', fontWeight: 600, fontFamily: 'var(--font-header)' }}>
              {activeInvestigation ? (
                <>
                  <span style={{ color: 'rgba(255, 255, 255, 0.75)', cursor: 'pointer' }} onClick={handleClose}>Ask VEYRA</span>
                  <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>/</span>
                  <span>{activeInvestigation.name}</span>
                </>
              ) : activeQueryInvestigation ? (
                <span>Investigation Details</span>
              ) : currentPage === 'assistant' ? (
                <span>Ask VEYRA</span>
              ) : RISK_CHILD_IDS.has(currentPage) ? (
                <>
                  <span style={{ color: 'rgba(255, 255, 255, 0.75)' }}>Risk Management</span>
                  <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>/</span>
                  <span>{pageLabelMap.get(currentPage) || 'Dashboard'}</span>
                </>
              ) : (
                <span>{pageLabelMap.get(currentPage) || 'Dashboard'}</span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* Notification Bell with Badge matching Reference */}
          <div style={{
            position: 'relative',
            cursor: 'pointer',
            padding: '0.4rem',
            borderRadius: '8px',
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff'
          }} title="0 active alerts">
            <Bell size={15} />
            <span style={{
              position: 'absolute',
              top: '-3px',
              right: '-3px',
              backgroundColor: '#EF4444',
              color: '#ffffff',
              fontSize: '0.6rem',
              fontWeight: 800,
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #1D4ED8'
            }}>
              0
            </span>
          </div>

          {/* Topbar User Profile Dropdown Menu - Clean Unpill Layout */}
          <div ref={userMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setUserMenuOpen(prev => !prev)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.55rem',
                backgroundColor: 'transparent',
                border: 'none',
                padding: '0.2rem 0.3rem',
                color: '#ffffff',
                cursor: 'pointer',
                transition: 'opacity 0.18s ease',
                outline: 'none'
              }}
              title="User Account Options & Sign Out"
              aria-expanded={userMenuOpen}
            >
              {/* Vibrant Blue Avatar Circle */}
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: '#2563EB',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.78rem',
                fontWeight: 800,
                boxShadow: '0 2px 6px rgba(37, 99, 235, 0.3)',
                flexShrink: 0
              }}>
                {getUserInitials(currentUser)}
              </div>

              {/* User Name & Role Text Stack */}
              <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', lineHeight: 1.15 }}>
                <span style={{ fontSize: '0.86rem', fontWeight: 700, letterSpacing: '0.01em', color: '#ffffff' }}>
                  {getUserDisplayName(currentUser)}
                </span>
                <span style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.75)', fontWeight: 500, fontStyle: 'italic' }}>
                  {getRoleLabel(userRole)}
                </span>
              </div>

              <ChevronDown size={14} style={{ color: 'rgba(255, 255, 255, 0.8)', transform: userMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.18s ease', marginLeft: '0.15rem', flexShrink: 0 }} />
            </button>

            {/* Dropdown Menu Popup */}
            {userMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  width: '240px',
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: '12px',
                  boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.18), 0 8px 10px -6px rgba(15, 23, 42, 0.1)',
                  padding: '0.5rem',
                  zIndex: 1000,
                  animation: 'veyraMenuPop 0.15s ease-out'
                }}
              >
                <style>{`
                  @keyframes veyraMenuPop {
                    0% { opacity: 0; transform: translateY(-6px); }
                    100% { opacity: 1; transform: translateY(0); }
                  }
                  .veyra-menu-btn {
                    display: flex;
                    align-items: center;
                    gap: 0.65rem;
                    width: 100%;
                    padding: 0.6rem 0.85rem;
                    border-radius: 8px;
                    border: none;
                    background: transparent;
                    color: #0F172A;
                    font-size: 0.85rem;
                    font-weight: 500;
                    cursor: pointer;
                    text-align: left;
                    transition: background 0.15s ease;
                  }
                  .veyra-menu-btn:hover {
                    background-color: #F1F5F9;
                  }
                  .veyra-menu-logout {
                    color: #DC2626 !important;
                  }
                  .veyra-menu-logout:hover {
                    background-color: #FEF2F2 !important;
                  }
                `}</style>

                {/* Account Details Header */}
                <div style={{ padding: '0.65rem 0.85rem 0.55rem 0.85rem', borderBottom: '1px solid #F1F5F9', marginBottom: '0.35rem' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F172A' }}>
                    {getUserDisplayName(currentUser)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '0.15rem' }}>
                    {currentUser || 'admin@admin.com'}
                  </div>
                  <div style={{ marginTop: '0.4rem' }}>
                    <span style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      backgroundColor: isAdmin ? '#EFF6FF' : '#F1F5F9',
                      color: isAdmin ? '#1D4ED8' : '#475569',
                      border: isAdmin ? '1px solid #BFDBFE' : '1px solid #E2E8F0',
                      padding: '0.15rem 0.5rem',
                      borderRadius: '9999px',
                      display: 'inline-block'
                    }}>
                      {getRoleLabel(userRole, true)}
                    </span>
                  </div>
                </div>

                {/* Settings Item */}
                <button
                  type="button"
                  className="veyra-menu-btn"
                  onClick={() => {
                    setUserMenuOpen(false);
                  }}
                >
                  <SettingsIcon size={15} style={{ color: '#64748B' }} />
                  <span>Account Settings</span>
                </button>

                <div style={{ height: '1px', backgroundColor: '#F1F5F9', margin: '0.35rem 0' }} />

                {/* Explicit Logout Option */}
                <button
                  type="button"
                  className="veyra-menu-btn veyra-menu-logout"
                  onClick={() => {
                    setUserMenuOpen(false);
                    handleLogout('MANUAL');
                  }}
                >
                  <LogOut size={15} />
                  <span style={{ fontWeight: 600 }}>Sign Out / Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* View Switcher wrapper with display toggling to preserve component states */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

        {/* Main page content wrapper */}
        <div style={{
          flex: 1,
          display: (activeInvestigation || activeQueryInvestigation) ? 'none' : 'block',
          height: '100%',
          overflowY: 'auto'
        }}>
          {isDeniedPage ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '2rem' }}>
              <div className="glass-panel" role="alert" style={{ maxWidth: '460px', width: '100%', padding: '2.5rem', textAlign: 'center' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.1)', marginBottom: '1.25rem' }}>
                  <Lock size={26} style={{ color: 'var(--accent-red)' }} />
                </div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 0.5rem 0' }}>Access Denied</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '0 0 1.5rem 0' }}>
                  You don&apos;t have permission to view {pageLabelMap.get(currentPage) || 'this page'}. Contact your administrator if you need access.
                </p>
                <button type="button" className="btn btn-primary" style={{ padding: '0.65rem 1.5rem' }} onClick={() => handlePageSelect('dashboard')}>
                  Back to Dashboard
                </button>
              </div>
            </div>
          ) : (
          <>
          {visitedPages.has('dashboard') && (
            <div style={{ display: currentPage === 'dashboard' ? 'block' : 'none', height: '100%' }}>
              <Dashboard
                currentUser={currentUser}
                userRole={userRole}
                onFAQSelect={handleFAQSelect}
                environmentMode={environmentMode}
                onInvestigate={handleInvestigate}
                hasAccess={(pageId) => canAccessPage(pageId, authCtx)}
                onNavigatePage={(pageId, filter) => {
                  handlePageSelect(pageId);
                  if (pageId === 'roles' && filter) setInitialRolesCategory(filter);
                  if (pageId === 'users' && filter) setInitialUsersFilter(filter);
                }}
              />
            </div>
          )}
          <div style={{
            display: currentPage === 'assistant' ? 'flex' : 'none',
            height: '100%',
            flexDirection: 'column'
          }}>
            <Assistant
              currentUser={currentUser}
              initialQuestion={faqQuestion}
              clearInitialQuestion={() => setFaqQuestion('')}
              environmentMode={environmentMode}
              onNavigatePage={(pageId, filter) => {
                handlePageSelect(pageId);
                if (pageId === 'roles' && filter) setInitialRolesCategory(filter);
                if (pageId === 'users' && filter) setInitialUsersFilter(filter);
              }}
              onInvestigate={handleInvestigate}
              onOpenFullInvestigation={handleOpenQueryInvestigation}
            />
          </div>
          {visitedPages.has('users') && (
            <div style={{ display: currentPage === 'users' ? 'block' : 'none', height: '100%' }}>
              <UsersPage
                initialFilter={initialUsersFilter}
                onInvestigateUser={(userId, displayName) => handleInvestigate('user', userId, displayName)}
                onInspectRole={(roleCode, displayName) => handleInvestigate('role', roleCode, displayName)}
              />
            </div>
          )}
          {visitedPages.has('roles') && (
            <div style={{ display: currentPage === 'roles' ? 'block' : 'none', height: '100%' }}>
              <RolesPage
                initialCategory={initialRolesCategory}
                onInvestigateRole={(roleCode, displayName) => handleInvestigate('role', roleCode, displayName)}
              />
            </div>
          )}
          {visitedPages.has('audit') && (
            <div style={{ display: currentPage === 'audit' ? 'block' : 'none', height: '100%' }}>
              <AuditPage />
            </div>
          )}
          {visitedPages.has('risk-access-requests') && (
            <div style={{ display: currentPage === 'risk-access-requests' ? 'block' : 'none', height: '100%' }}>
              <AdvancedAccessRequestsPage environmentMode={environmentMode} />
            </div>
          )}
          {visitedPages.has('risk-controls') && (
            <div style={{ display: currentPage === 'risk-controls' ? 'block' : 'none', height: '100%' }}>
              <AdvancedControlsPage environmentMode={environmentMode} />
            </div>
          )}
          {visitedPages.has('risk-certificates') && (
            <div style={{ display: currentPage === 'risk-certificates' ? 'block' : 'none', height: '100%' }}>
              <AccessCertificatesPage environmentMode={environmentMode} />
            </div>
          )}
          {visitedPages.has('reports') && (
            <div style={{ display: currentPage === 'reports' ? 'block' : 'none', height: '100%' }}>
              <ReportsPage
                environmentMode={environmentMode}
                onInvestigateUser={(userId, displayName) => handleInvestigate('user', userId, displayName)}
                onInspectRole={(roleCode, displayName) => handleInvestigate('role', roleCode, displayName)}
              />
            </div>
          )}
          {visitedPages.has('settings') && (
            <div style={{ display: currentPage === 'settings' ? 'block' : 'none', height: '100%' }}>
              <SettingsPage
                environmentMode={environmentMode}
                setEnvironmentMode={setEnvironmentMode}
                currentUser={currentUser}
              />
            </div>
          )}
          {visitedPages.has('command-center') && (
            <div style={{ display: currentPage === 'command-center' ? 'block' : 'none', height: '100%' }}>
              <CommandCenter onNavigatePage={handlePageSelect} />
            </div>
          )}
          </>
          )}
        </div>

        {/* Query Investigation View Panel (Same Tab) */}
        {activeQueryInvestigation && !activeInvestigation && (
          <div style={{ flex: 1, height: '100%', overflowY: 'auto' }}>
            <FullInvestigationView
              investigationId={activeQueryInvestigation}
              environmentMode={environmentMode}
              onInvestigate={handleInvestigateFromQuery}
              onNavigatePage={(pageId, filter) => {
                handlePageSelect(pageId);
                if (pageId === 'roles' && filter) setInitialRolesCategory(filter);
                if (pageId === 'users' && filter) setInitialUsersFilter(filter);
                handleClose();
              }}
              onBack={handleBack}
            />
          </div>
        )}

        {/* Entity Investigation Workspace Panel */}
        {activeInvestigation && (
          <div style={{ flex: 1, height: '100%', overflowY: 'auto' }}>
            <InvestigationWorkspace
              entity={activeInvestigation}
              onClose={handleClose}
              onNavigate={handleNavigate}
              onBack={handleBack}
              historyCount={investigationHistory.length}
              onNavigateToPage={(pageId) => {
                setCurrentPage(pageId);
                handleClose();
              }}
              environmentMode={environmentMode}
            />
          </div>
        )}
      </div>
    </main>

      {/* Session Inactivity Timeout Warning Modal matching Mock Screen 3 */ }
  <SessionTimeoutModal
    isOpen={isWarningOpen}
    secondsRemaining={secondsRemaining}
    onStayLoggedIn={handleStayLoggedIn}
    onLogoutNow={handleLogoutNow}
  />
    </div >
  );
}
