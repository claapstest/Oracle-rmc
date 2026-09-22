import React, { useState, useEffect } from 'react';
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
  Database,
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

import { api, getActiveAuthToken, getActiveUserEmail, setActiveAuthSession, clearActiveAuthSession } from './services/api';
import { clearSecuritySession } from './services/securitySessionService';

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
    return new Set([initial, 'assistant']);
  });
  const [environmentMode, setEnvironmentMode] = useState<'DEMO' | 'ORACLE_FUSION'>(() => {
    return (localStorage.getItem('environmentMode') as 'DEMO' | 'ORACLE_FUSION') || 'ORACLE_FUSION';
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    return sessionStorage.getItem('activePage') !== 'assistant';
  });
  // Manual expand/collapse for the Risk Management parent group.
  // The group is additionally force-expanded whenever a Risk child page is active.
  const [riskGroupOpen, setRiskGroupOpen] = useState(false);

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
          if (res.environmentMode) {
            setEnvironmentMode(res.environmentMode);
            localStorage.setItem('environmentMode', res.environmentMode);
          }
        } else {
          clearActiveAuthSession();
          setIsLoggedIn(false);
          setCurrentUser('');
        }
      } catch (err) {
        console.warn('Session verification failed, redirecting to login:', err);
        clearActiveAuthSession();
        setIsLoggedIn(false);
        setCurrentUser('');
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
      clearActiveAuthSession();
      setIsLoggedIn(false);
      setIsAdmin(false);
    };
    window.addEventListener('auth:expired', handleAuthExpired);
    return () => window.removeEventListener('auth:expired', handleAuthExpired);
  }, []);
  
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
    } catch (_) {}
  };

  const resetUrlToCurrentPage = () => {
    try {
      window.history.pushState(null, '', `/?page=${currentPage}`);
    } catch (_) {}
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

  const handleLoginSuccess = (username: string, token: string, envMode?: 'DEMO' | 'ORACLE_FUSION') => {
    setActiveAuthSession(token, username);
    setCurrentUser(username);
    setIsLoggedIn(true);
    setAuthChecked(true);
    if (envMode) {
      setEnvironmentMode(envMode);
      localStorage.setItem('environmentMode', envMode);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (err) {
      console.error('Failed to logout cleanly from server:', err);
    }
    clearActiveAuthSession();
    setIsLoggedIn(false);
    setCurrentUser('');
    setCurrentPage('dashboard');
    setIsSidebarOpen(true);
    handleClose();
  };

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
    return <Login onLoginSuccess={handleLoginSuccess} />;
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
              .filter(item => !item.adminOnly || isAdmin)
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
                          {RISK_CHILDREN.map(child => {
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

        {/* Sidebar Footer - Professional User Account Card */}
        <div className="sidebar-footer">
          <div className="user-profile-card">
            <div className="user-avatar-pill">
              {getUserInitials(currentUser)}
            </div>
            <div className="user-info-stack">
              <span className="user-email-text" title={currentUser}>
                {getUserDisplayName(currentUser)}
              </span>
              <span className="user-role-badge" title={currentUser || 'karthika.gundreddi@claaps.com'}>
                {currentUser || 'karthika.gundreddi@claaps.com'}
              </span>
            </div>
            <button 
              onClick={handleLogout}
              className="user-logout-btn"
              title="Sign Out of Session"
            >
              <LogOut size={15} />
            </button>
          </div>
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
            {/* Encrypted Session Product Status Pill */}
            <div className="topbar-status-pill">
              <Lock size={12} style={{ color: '#34D399' }} />
              <span>Encrypted Session Active</span>
            </div>

            {/* Environment Indicator Pill */}
            <div className={`topbar-env-pill ${environmentMode === 'DEMO' ? 'demo' : 'live'}`}>
              <Database size={12} />
              <span>{environmentMode === 'DEMO' ? 'SAMPLE DATA' : 'LIVE ORACLE API'}</span>
            </div>

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

            {/* Topbar User Avatar Circle */}
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: '#1D4ED8',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.75rem',
              fontWeight: 800,
              border: '2px solid rgba(255, 255, 255, 0.4)',
              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)'
            }} title={getUserDisplayName(currentUser)}>
              {getUserInitials(currentUser)}
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
            {visitedPages.has('dashboard') && (
              <div style={{ display: currentPage === 'dashboard' ? 'block' : 'none', height: '100%' }}>
                <Dashboard 
                  onFAQSelect={handleFAQSelect} 
                  environmentMode={environmentMode} 
                  onInvestigate={handleInvestigate}
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
    </div>
  );
}
