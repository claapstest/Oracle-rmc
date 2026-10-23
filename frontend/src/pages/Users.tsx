import React, { useEffect, useState, useMemo } from 'react';
import { Search, UserCheck, ShieldAlert, ArrowRight, User as UserIcon, X, Mail, Shield, Sparkles, ChevronLeft, ChevronRight, KeyRound } from 'lucide-react';
import { api } from '../services/api.js';
import { EnterpriseExportControl } from '../components/EnterpriseExportControl';
import { TableLoadingState } from '../components/TableLoadingState';

interface UsersProps {
  initialFilter?: string;
  isActive?: boolean;
  onInvestigateUser?: (userId: string, displayName: string) => void;
  onInspectRole?: (roleCode: string, displayName: string) => void;
  hasAccess?: (pageId: string) => boolean;
  onBack?: () => void;
  onRegisterBack?: (config: { canGoBack: boolean; onBack: () => void; label?: string } | null) => void;
}

export default function Users({
  initialFilter = 'ALL',
  isActive = true,
  onInvestigateUser,
  onInspectRole,
  hasAccess,
  onBack,
  onRegisterBack
}: UsersProps) {
  void hasAccess;
  const [users, setUsers] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const [dataSource, setDataSource] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalResults, setTotalResults] = useState(0);
  const [directoryTotal, setDirectoryTotal] = useState(0);
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [inactiveCount, setInactiveCount] = useState<number | null>(null);

  const [activeCategoryFilter, setActiveCategoryFilter] = useState(initialFilter);
  const [drawerRoleSearch, setDrawerRoleSearch] = useState('');
  const [drawerTab, setDrawerTab] = useState<'ROLES' | 'PRIVILEGES'>('ROLES');
  const [userPrivileges, setUserPrivileges] = useState<any[]>([]);
  const [privilegesLoading, setPrivilegesLoading] = useState(false);
  const [drawerPrivilegeSearch, setDrawerPrivilegeSearch] = useState('');
  const [totalUserPrivileges, setTotalUserPrivileges] = useState(0);

  // Filtered assigned roles in drawer
  const filteredDrawerRoles = useMemo(() => {
    const roles: any[] = selectedUser?.assignedRoles || [];
    const q = drawerRoleSearch.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((role: any) => {
      const rName = typeof role === 'string' ? role : (role.roleName || role.displayName || role.roleCode || '');
      const rCode = typeof role === 'string' ? role : (role.roleCode || role.value || '');
      return rName.toLowerCase().includes(q) || rCode.toLowerCase().includes(q);
    });
  }, [selectedUser?.assignedRoles, drawerRoleSearch]);

  // Filtered privileges in drawer
  const filteredDrawerPrivileges = useMemo(() => {
    const q = drawerPrivilegeSearch.trim().toLowerCase();
    if (!q) return userPrivileges;
    return userPrivileges.filter((p: any) => {
      const pName = (p.privilegeName || '').toLowerCase();
      const pCode = (p.privilegeCode || '').toLowerCase();
      const pRole = (p.grantedViaRoleName || '').toLowerCase();
      const pDesc = (p.description || '').toLowerCase();
      return pName.includes(q) || pCode.includes(q) || pRole.includes(q) || pDesc.includes(q);
    });
  }, [userPrivileges, drawerPrivilegeSearch]);

  // Lazy-load effective privileges on demand when Privileges tab is clicked
  useEffect(() => {
    if (selectedUser && drawerTab === 'PRIVILEGES') {
      let isCancelled = false;
      setPrivilegesLoading(true);
      api.getPrivilegesByUser(selectedUser.userName, 1, 200)
        .then((res: any) => {
          if (!isCancelled && res?.privileges) {
            setUserPrivileges(res.privileges);
            setTotalUserPrivileges(res.total || res.privileges.length);
          }
        })
        .catch((err: any) => {
          console.error('[User Privileges Error]:', err);
        })
        .finally(() => {
          if (!isCancelled) setPrivilegesLoading(false);
        });
      return () => { isCancelled = true; };
    }
  }, [selectedUser, drawerTab]);

  // Synchronize internal selected user drawer with topbar Back button
  useEffect(() => {
    if (onRegisterBack) {
      if (isActive && selectedUser) {
        onRegisterBack({
          canGoBack: true,
          onBack: () => setSelectedUser(null),
          label: 'Users List'
        });
      } else if (isActive) {
        onRegisterBack(null);
      }
    }
  }, [isActive, selectedUser, onRegisterBack]);

  useEffect(() => {
    return () => {
      if (onRegisterBack) {
        onRegisterBack(null);
      }
    };
  }, [onRegisterBack]);

  useEffect(() => {
    setActiveCategoryFilter(initialFilter);
    setStatusFilter('ALL');
    setSearchTerm('');
    setDrawerRoleSearch('');
    setCurrentPage(1);
    setSelectedUser(null);
  }, [initialFilter]);

  useEffect(() => {
    setDrawerRoleSearch('');
    setDrawerPrivilegeSearch('');
    setDrawerTab('ROLES');
    setUserPrivileges([]);
    setTotalUserPrivileges(0);
  }, [selectedUser]);

  // Helper for human-readable category filter label
  const getCategoryBadgeLabel = (filterKey: string) => {
    const norm = (filterKey || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (norm === 'NO_ROLES' || norm === 'WITHOUT_ROLES' || norm === 'USERS_WITHOUT_ROLES') return 'Users Without Roles';
    if (norm === 'ADMIN_ROLES' || norm === 'SECURITY_ADMINISTRATORS' || norm === 'SECURITY_ADMINS') return 'Security Administrators';
    if (norm === 'HIGH_RISK' || norm === 'HIGH_RISK_USERS' || norm === 'HIGH_RISK_ROLE_USERS') return 'High-Risk Users';
    if (norm === 'MULTIPLE_ROLES' || norm === 'MULTIPLE_ROLE_USERS') return 'Multiple Role Users';
    if (norm === 'SINGLE_ROLE' || norm === 'SINGLE_ROLE_USERS') return 'Single Role Users';
    if (norm === 'INACTIVE' || norm === 'INACTIVE_ACCOUNTS') return 'Inactive Accounts';
    return filterKey;
  };

  useEffect(() => {
    let isCancelled = false;
    const delay = searchTerm ? 300 : 0;
    const delayDebounceFn = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const startIndex = (currentPage - 1) * pageSize + 1;
        const res = await api.getUsers(
          searchTerm || undefined,
          startIndex,
          pageSize,
          activeCategoryFilter !== 'ALL' ? activeCategoryFilter : undefined,
          statusFilter !== 'ALL' ? statusFilter : undefined
        );
        if (!isCancelled && res?.users) {
          setUsers(res.users);
          setTotalResults(res.totalResults !== undefined ? res.totalResults : res.users.length);
          if (res.directoryTotal) setDirectoryTotal(res.directoryTotal);
          if (res.activeCount !== undefined) setActiveCount(res.activeCount);
          if (res.inactiveCount !== undefined) setInactiveCount(res.inactiveCount);
          setDataSource(res.dataSource || 'Oracle Fusion SCIM API');
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('Failed to load users:', err);
          setError('Unable to fetch users from security service.');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
          setInitialLoading(false);
        }
      }
    }, delay);

    return () => {
      isCancelled = true;
      clearTimeout(delayDebounceFn);
    };
  }, [searchTerm, currentPage, pageSize, activeCategoryFilter, statusFilter]);

  // Client-side filtering on current page items for status/insight tags if applicable
  const filteredUsers = useMemo(() => {
    const normCat = (activeCategoryFilter || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    return users.filter(user => {
      const matchesStatus = 
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && user.active) ||
        (statusFilter === 'INACTIVE' && !user.active);

      let matchesInsight = true;
      if (normCat && normCat !== 'ALL') {
        if (normCat === 'NO_ROLES' || normCat === 'WITHOUT_ROLES' || normCat === 'USERS_WITHOUT_ROLES') {
          matchesInsight = !user.assignedRoles || user.assignedRoles.length === 0;
        } else if (normCat === 'ADMIN_ROLES' || normCat === 'SECURITY_ADMINISTRATORS' || normCat === 'SECURITY_ADMINS' || normCat === 'HIGH_RISK' || normCat === 'HIGH_RISK_USERS' || normCat === 'HIGH_RISK_ROLE_USERS') {
          matchesInsight = Boolean(user.assignedRoles && user.assignedRoles.some((r: any) => {
            const val = typeof r === 'string' ? r : (r.roleName || r.roleCode || '');
            return val.includes('Security Administrator') || val.includes('IT Security Manager') || val.includes('AP Manager');
          }));
        } else if (normCat === 'MULTIPLE_ROLES' || normCat === 'MULTIPLE_ROLE_USERS') {
          matchesInsight = Boolean(user.assignedRoles && user.assignedRoles.length > 1);
        } else if (normCat === 'SINGLE_ROLE' || normCat === 'SINGLE_ROLE_USERS') {
          matchesInsight = Boolean(user.assignedRoles && user.assignedRoles.length === 1);
        } else if (normCat === 'INACTIVE' || normCat === 'INACTIVE_ACCOUNTS') {
          matchesInsight = !user.active;
        }
      }

      return matchesStatus && matchesInsight;
    });
  }, [users, statusFilter, activeCategoryFilter]);

  const displayCount = filteredUsers.length;
  const startItem = displayCount > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const endItem = displayCount > 0 ? (currentPage - 1) * pageSize + displayCount : 0;
  // If first page has fewer results than pageSize and totalResults was not returned or 0, fallback to displayCount
  const effectiveTotal = (currentPage === 1 && displayCount < pageSize && (totalResults === 0 || totalResults < pageSize))
    ? displayCount
    : totalResults;

  const totalPages = Math.max(1, Math.ceil(effectiveTotal / pageSize));

  // Live-only pagination guard: if total shrinks below current page (e.g. instance switch), reset to page 1
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  const getPrimaryRole = (user: any) => {
    const roles = user?.assignedRoles || [];
    if (!roles.length) return null;
    const r = roles[0];
    if (typeof r === 'string') return { roleName: r, roleCode: r, autoProvisioned: null };
    return {
      roleName: r.roleName || r.displayName || r.roleCode || '',
      roleCode: r.roleCode || r.value || '',
      autoProvisioned: r.autoProvisioned ?? null,
    };
  };

  // Applied filters list for export metadata
  const activeFilters = useMemo(() => {
    const list: { label: string; value: string }[] = [];
    if (searchTerm) list.push({ label: 'Search', value: `"${searchTerm}"` });
    if (statusFilter !== 'ALL') list.push({ label: 'Status', value: statusFilter });
    if (activeCategoryFilter && activeCategoryFilter !== 'ALL') {
      list.push({ label: 'Category Filter', value: getCategoryBadgeLabel(activeCategoryFilter) });
    }
    return list;
  }, [searchTerm, statusFilter, activeCategoryFilter]);

  // Page numbering helper
  const renderPaginationButtons = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
          className="btn btn-secondary"
          style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          title="Previous Page"
        >
          <ChevronLeft size={14} />
          <span>Prev</span>
        </button>

        {pages.map((p, idx) => {
          if (p === '...') {
            return <span key={`ellipsis-${idx}`} style={{ padding: '0 0.35rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>…</span>;
          }
          const pageNum = p as number;
          const isCurrent = pageNum === currentPage;
          return (
            <button
              key={pageNum}
              type="button"
              onClick={() => setCurrentPage(pageNum)}
              style={{
                minWidth: '28px',
                height: '28px',
                padding: '0 0.35rem',
                fontSize: '0.78rem',
                fontWeight: isCurrent ? 700 : 500,
                borderRadius: '6px',
                border: isCurrent ? '1px solid #2563EB' : '1px solid var(--border-color)',
                backgroundColor: isCurrent ? '#2563EB' : 'var(--bg-secondary)',
                color: isCurrent ? '#FFFFFF' : 'var(--text-primary)',
                cursor: 'pointer'
              }}
            >
              {pageNum}
            </button>
          );
        })}

        <button
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
          className="btn btn-secondary"
          style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          title="Next Page"
        >
          <span>Next</span>
          <ChevronRight size={14} />
        </button>
      </div>
    );
  };

  const renderRowsPerPageSelect = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
      <span>Rows per page:</span>
      <select
        value={pageSize}
        onChange={(e) => {
          setPageSize(Number(e.target.value));
          setCurrentPage(1);
        }}
        className="form-select"
        style={{ width: '80px', padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
      >
        <option value={25}>25</option>
        <option value={50}>50</option>
        <option value={100}>100</option>
        <option value={250}>250</option>
      </select>
    </div>
  );

  if (initialLoading && users.length === 0) {
    return (
      <div style={{ padding: '2rem', maxWidth: '1400px', width: '100%', margin: '0 auto' }}>
        <div style={{ height: '35px', width: '220px', marginBottom: '1.5rem' }} className="skeleton" />
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ height: '40px', width: '250px' }} className="skeleton" />
          <div style={{ height: '40px', width: '150px' }} className="skeleton" />
        </div>
        <div style={{ height: '300px' }} className="skeleton" />
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', width: '100%', margin: '0 auto', display: 'flex', gap: '2rem' }}>
      
      {/* Left Column: List */}
      <div style={{ flex: 1, minWidth: 0 }}>

        <div className="page-header-banner animate-fade-in" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #1E40AF 0%, #2563EB 60%, #3B82F6 100%)',
          position: 'relative'
        }}>
          {/* Subtle Wave Curve overlay */}
          <svg 
            viewBox="0 0 1440 240" 
            preserveAspectRatio="none" 
            style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, opacity: 0.9 }}
          >
            <path fill="rgba(255, 255, 255, 0.08)" d="M0,120 C320,190,480,50,800,130 C1120,210,1280,80,1440,120 L1440,240 L0,240 Z" />
            <path fill="rgba(96, 165, 250, 0.15)" d="M0,170 C360,90,600,210,960,140 C1200,90,1360,180,1440,150 L1440,240 L0,240 Z" />
          </svg>

          <div style={{ position: 'relative', zIndex: 2 }}>
            <h1 style={{ fontSize: '1.85rem', fontWeight: 800, fontFamily: 'var(--font-header)', marginBottom: '0.35rem', letterSpacing: '-0.02em', color: '#ffffff' }}>
              Identity & Access Management
            </h1>
            <p style={{ color: '#E0E7FF', fontSize: '0.92rem', margin: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <span>Verify user statuses and trace role entitlements inside the {dataSource || 'Oracle Fusion'} catalog.</span>
              {activeCategoryFilter && activeCategoryFilter !== 'ALL' && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.15rem 0.65rem',
                  backgroundColor: 'rgba(255, 255, 255, 0.22)',
                  borderRadius: '9999px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  backdropFilter: 'blur(4px)'
                }}>
                  <span>Filter: {getCategoryBadgeLabel(activeCategoryFilter)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCategoryFilter('ALL');
                      setStatusFilter('ALL');
                      setCurrentPage(1);
                    }}
                    style={{
                      border: 'none',
                      background: 'rgba(0, 0, 0, 0.25)',
                      color: '#ffffff',
                      borderRadius: '50%',
                      width: '16px',
                      height: '16px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.75rem',
                      lineHeight: 1,
                      padding: 0
                    }}
                    title="Clear category filter"
                  >
                    ×
                  </button>
                </span>
              )}
            </p>
          </div>
          <div style={{ position: 'relative', zIndex: 2 }}>
            <div style={{
              padding: '0.4rem 0.95rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              borderRadius: '9999px',
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              color: '#ffffff',
              backdropFilter: 'blur(8px)'
            }}>
              {activeCategoryFilter && activeCategoryFilter !== 'ALL'
                ? `${(directoryTotal > 0 ? directoryTotal : totalResults).toLocaleString()} ${getCategoryBadgeLabel(activeCategoryFilter)}`
                : (directoryTotal > 0
                    ? `${directoryTotal.toLocaleString()} Users in Directory`
                    : totalResults > 0
                      ? `${totalResults.toLocaleString()} Users in Directory`
                      : 'Loading directory...')}
            </div>
          </div>
        </div>

        {error && (
          <div className="glass-panel" style={{ padding: '1rem', borderLeft: '4px solid var(--accent-red)', marginBottom: '1.5rem' }}>
            <p style={{ color: 'var(--accent-red)', fontSize: '0.85rem' }}>{error}</p>
          </div>
        )}

        {/* Search & Filter Bar */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
            <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
              <Search size={16} />
            </span>
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: '2.5rem' }}
              placeholder="Search by username or display name..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
            {searchTerm && (
              <button
                onClick={() => { setSearchTerm(''); setCurrentPage(1); }}
                style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <select
            className="form-select"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            style={{ minWidth: '185px' }}
          >
            <option value="ALL">All Statuses {directoryTotal > 0 ? `(${directoryTotal.toLocaleString()})` : ''}</option>
            <option value="ACTIVE">Active Users {activeCount !== null ? `(${activeCount.toLocaleString()})` : ''}</option>
            <option value="INACTIVE">Inactive Users {inactiveCount !== null ? `(${inactiveCount.toLocaleString()})` : ''}</option>
          </select>

          {/* Enterprise Export Control */}
          <EnterpriseExportControl
            filename={statusFilter === 'INACTIVE' ? 'inactive_users_directory' : statusFilter === 'ACTIVE' ? 'active_users_directory' : 'users_directory'}
            sheetName="Users Directory"
            reportTitle={`Oracle Fusion Identity & Access Management Directory${statusFilter === 'INACTIVE' ? ' (Inactive Users)' : statusFilter === 'ACTIVE' ? ' (Active Users)' : ''}`}
            dataSource={dataSource}
            entityName="Users"
            buttonText="Export Excel"
            currentPageData={filteredUsers}
            filteredCount={effectiveTotal}
            totalCount={directoryTotal || effectiveTotal}
            appliedFilters={activeFilters}
            availableColumns={[
              { key: 'userName', label: 'Username', defaultSelected: true },
              { key: 'userCategory', label: 'User Category', defaultSelected: true, getValue: (u: any) => u.userCategory || '' },
              { key: 'firstName', label: 'First Name', defaultSelected: true, getValue: (u: any) => u.firstName || '' },
              { key: 'lastName', label: 'Last Name', defaultSelected: true, getValue: (u: any) => u.lastName || '' },
              { key: 'displayName', label: 'Display Name', defaultSelected: false },
              { key: 'email', label: 'Email Address', defaultSelected: true, getValue: (u: any) => u.email || 'N/A' },
              { key: 'status', label: 'Active', defaultSelected: true, getValue: (u: any) => u.active ? 'Active' : 'Inactive' },
              { key: 'roleCount', label: 'Number of Roles', defaultSelected: true, getValue: (u: any) => Array.isArray(u.assignedRoles) ? u.assignedRoles.length : (typeof u.roleCount === 'number' ? u.roleCount : 0) },
              { key: 'personNumber', label: 'Person Number', defaultSelected: true, getValue: (u: any) => u.personNumber || '' },
              { key: 'department', label: 'Department', defaultSelected: true, getValue: (u: any) => u.department || '' },
              { key: 'job', label: 'Job', defaultSelected: true, getValue: (u: any) => u.job || '' },
              { key: 'businessUnit', label: 'Business Unit', defaultSelected: true, getValue: (u: any) => u.businessUnit || '' },
              { key: 'location', label: 'Location', defaultSelected: true, getValue: (u: any) => u.location || '' },
              { key: 'manager', label: 'Manager', defaultSelected: true, getValue: (u: any) => u.manager || '' },
              { key: 'assignedRoles', label: 'All Assigned Roles', defaultSelected: false, getValue: (u: any) => u.assignedRoles?.map((r: any) => typeof r === 'string' ? r : (`${r.roleName || r.roleCode || ''} [${r.roleCode || ''}]${r.autoProvisioned ? ` Auto:${r.autoProvisioned}` : ''}`)).join('; ') }
            ]}
            onFetchScopeData={async (scope) => {
              if (scope === 'PAGE') return filteredUsers;
              const countToFetch = scope === 'FILTERED'
                ? Math.min(effectiveTotal || 5000, 5000)
                : Math.min(directoryTotal || 5000, 5000);
              const res = await api.getUsers(
                scope === 'FILTERED' ? (searchTerm || undefined) : undefined,
                1,
                countToFetch,
                scope === 'FILTERED' && activeCategoryFilter !== 'ALL' ? activeCategoryFilter : undefined,
                scope === 'FILTERED' && statusFilter !== 'ALL' ? statusFilter : undefined
              );
              return res?.users || [];
            }}
          />
        </div>

        {/* Table Toolbar: Clear count, Rows Per Page & Top Pagination */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
          fontSize: '0.82rem',
          color: 'var(--text-secondary)',
          flexWrap: 'wrap',
          gap: '0.75rem'
        }}>
          <div>
            {displayCount === 0 && !loading ? (
              <span>Showing <strong>0</strong> users</span>
            ) : (
              <span>
                Showing <strong>{startItem.toLocaleString()}</strong>–<strong>{endItem.toLocaleString()}</strong> of <strong>{effectiveTotal.toLocaleString()}</strong> {statusFilter === 'INACTIVE' ? 'inactive ' : statusFilter === 'ACTIVE' ? 'active ' : ''}{activeCategoryFilter && activeCategoryFilter !== 'ALL' ? getCategoryBadgeLabel(activeCategoryFilter).toLowerCase() : 'users'}
              </span>
            )}
            {loading && <span style={{ marginLeft: '0.5rem', color: 'var(--accent-blue)', fontSize: '0.75rem' }}>(updating...)</span>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            {renderRowsPerPageSelect()}
            {totalPages > 1 && renderPaginationButtons()}
          </div>
        </div>

        {/* Table Grid: live Oracle User Details Report (SCIM + HCM + BIP) */}
        <div className="table-container" style={{ margin: 0, overflowX: 'auto' }}>
          <table className="enterprise-table" style={{ minWidth: '1700px' }}>
            <thead>
              <tr>
                <th>Username</th>
                <th>User Category</th>
                <th>First Name</th>
                <th>Last Name</th>
                <th>Email Address</th>
                <th>Active</th>
                <th>Number of Roles</th>
                <th>Person Number</th>
                <th>Department</th>
                <th>Job</th>
                <th>Business Unit</th>
                <th>Location</th>
                <th>Manager</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && filteredUsers.length === 0 ? (
                <TableLoadingState
                  title="Searching Oracle Fusion User Directory..."
                  subtitle="Retrieving user profiles, active statuses, and assigned roles"
                  colSpan={14}
                  skeletonRows={4}
                />
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={14} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                    No security users match the filter criteria.
                  </td>
                </tr>
              ) : (
                filteredUsers.map(user => {
                  const roleCount = Array.isArray(user.assignedRoles) 
                    ? user.assignedRoles.length 
                    : (typeof user.roleCount === 'number' ? user.roleCount : 0);
                  return (
                  <tr
                    key={user.id}
                    onClick={() => setSelectedUser(user)}
                    style={{ cursor: 'pointer', backgroundColor: selectedUser?.id === user.id ? 'rgba(37, 99, 235, 0.06)' : '' }}
                  >
                    <td><code>{user.userName}</code></td>
                    <td>{user.userCategory || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{user.firstName || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{user.lastName || '—'}</td>
                    <td>{user.email || 'N/A'}</td>
                    <td>
                      <span className={`badge ${user.active ? 'badge-active' : 'badge-inactive'}`}>
                        {user.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{roleCount}</td>
                    <td>{user.personNumber || '—'}</td>
                    <td>{user.department || '—'}</td>
                    <td>{user.job || '—'}</td>
                    <td>{user.businessUnit || '—'}</td>
                    <td>{user.location || '—'}</td>
                    <td>{user.manager || '—'}</td>
                    <td>
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onInvestigateUser) {
                            onInvestigateUser(user.userName, user.displayName);
                          } else {
                            setSelectedUser(user);
                          }
                        }}
                        className="btn btn-secondary" 
                        style={{ 
                          padding: '0.2rem 0.5rem', 
                          fontSize: '0.72rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          color: 'var(--accent-blue)',
                          borderColor: 'rgba(53, 99, 233, 0.25)'
                        }}
                      >
                        <span>Inspect</span>
                        <ArrowRight size={10} />
                      </button>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls Bar (Bottom) */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '1rem',
            padding: '0.75rem 0.25rem',
            flexWrap: 'wrap',
            gap: '0.75rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong> ({effectiveTotal.toLocaleString()} {statusFilter === 'INACTIVE' ? 'inactive ' : statusFilter === 'ACTIVE' ? 'active ' : ''}users)
              </div>
              {renderRowsPerPageSelect()}
            </div>
            {renderPaginationButtons()}
          </div>
        )}
      </div>

      {/* Right Column: User Details Sidebar Card */}
      {selectedUser && (
        <div className="glass-panel animate-fade-in" style={{
          width: '400px',
          height: 'fit-content',
          padding: '1.5rem',
          position: 'sticky',
          top: '2rem',
          alignSelf: 'flex-start'
        }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <UserIcon size={18} style={{ color: 'var(--accent-gold)' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, fontFamily: 'var(--font-header)', margin: 0 }}>
                Security Entitlements
              </h3>
            </div>
            <button
              onClick={() => setSelectedUser(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            
            {/* Identity Profile: live User Details Report fields */}
            <div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{selectedUser.displayName}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                <code>{selectedUser.userName}</code>
                <span style={{ color: 'var(--text-muted)' }}>•</span>
                <span className={`badge ${selectedUser.active ? 'badge-active' : 'badge-inactive'}`} style={{ fontSize: '0.65rem' }}>
                  {selectedUser.active ? 'Active' : 'Inactive'}
                </span>
                {selectedUser.userCategory && (
                  <span className="badge badge-blue" style={{ fontSize: '0.65rem' }}>{selectedUser.userCategory}</span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem 0.75rem', color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.75rem' }}>
                <div><strong>First Name:</strong> {selectedUser.firstName || '—'}</div>
                <div><strong>Last Name:</strong> {selectedUser.lastName || '—'}</div>
                <div><strong>Person Number:</strong> {selectedUser.personNumber || '—'}</div>
                <div><strong>Department:</strong> {selectedUser.department || '—'}</div>
                <div><strong>Job:</strong> {selectedUser.job || '—'}</div>
                <div><strong>Business Unit:</strong> {selectedUser.businessUnit || '—'}</div>
                <div><strong>Location:</strong> {selectedUser.location || '—'}</div>
                <div><strong>Manager:</strong> {selectedUser.manager || '—'}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                <Mail size={14} />
                <span>{selectedUser.email || 'No email registered'}</span>
              </div>
            </div>

            {/* Quick Action: Full Investigation */}
            {onInvestigateUser && (
              <button
                onClick={() => onInvestigateUser(selectedUser.userName, selectedUser.displayName)}
                className="btn btn-primary"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  padding: '0.6rem 1rem',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  backgroundColor: 'var(--accent-blue)',
                  color: '#ffffff',
                  borderRadius: '6px',
                  boxShadow: '0 2px 8px rgba(37, 99, 235, 0.25)'
                }}
              >
                <Sparkles size={14} />
                <span>Deep Security Investigation</span>
              </button>
            )}

            {/* Sub-Tab Navigation inside Drawer: Roles vs Effective Privileges */}
            <div>
              <div style={{
                display: 'flex',
                borderBottom: '1px solid var(--border-color)',
                gap: '0.75rem',
                marginBottom: '0.75rem'
              }}>
                <button
                  type="button"
                  onClick={() => setDrawerTab('ROLES')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    paddingBottom: '0.45rem',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: drawerTab === 'ROLES' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                    borderBottom: drawerTab === 'ROLES' ? '2px solid var(--accent-blue)' : '2px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Shield size={13} />
                  <span>Direct Roles ({filteredDrawerRoles.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerTab('PRIVILEGES')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    paddingBottom: '0.45rem',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: drawerTab === 'PRIVILEGES' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                    borderBottom: drawerTab === 'PRIVILEGES' ? '2px solid var(--accent-blue)' : '2px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <KeyRound size={13} />
                  <span>Effective Privileges {totalUserPrivileges > 0 ? `(${totalUserPrivileges.toLocaleString()})` : ''}</span>
                </button>
              </div>

              {drawerTab === 'PRIVILEGES' ? (
                <div>
                  <div style={{ position: 'relative', marginBottom: '0.65rem' }}>
                    <Search size={13} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      placeholder="Search functional privileges..."
                      value={drawerPrivilegeSearch}
                      onChange={(e) => setDrawerPrivilegeSearch(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.35rem 1.8rem 0.35rem 2rem',
                        fontSize: '0.78rem',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                    {drawerPrivilegeSearch && (
                      <button
                        type="button"
                        onClick={() => setDrawerPrivilegeSearch('')}
                        style={{
                          position: 'absolute',
                          right: '0.45rem',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: '2px',
                          display: 'flex'
                        }}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  {privilegesLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem 0' }}>
                      <div style={{ height: '28px', width: '100%' }} className="skeleton" />
                      <div style={{ height: '28px', width: '85%' }} className="skeleton" />
                      <div style={{ height: '28px', width: '90%' }} className="skeleton" />
                      <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        Resolving role hierarchy and granted privileges...
                      </div>
                    </div>
                  ) : filteredDrawerPrivileges.length === 0 ? (
                    <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {drawerPrivilegeSearch ? `No privileges match "${drawerPrivilegeSearch}".` : 'No functional privileges resolved for this user.'}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '420px', overflowY: 'auto' }}>
                      {filteredDrawerPrivileges.map((p: any, idx: number) => (
                        <div
                          key={idx}
                          style={{
                            padding: '0.6rem 0.75rem',
                            backgroundColor: 'var(--bg-secondary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.2rem'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                              {p.privilegeName || p.privilegeCode}
                            </span>
                            <span className="badge badge-blue" style={{ fontSize: '0.62rem', whiteSpace: 'nowrap' }}>
                              Privilege
                            </span>
                          </div>
                          <code style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{p.privilegeCode}</code>
                          {p.description && (
                            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: '1.3' }}>
                              {p.description}
                            </p>
                          )}
                          <div style={{ marginTop: '0.3rem', fontSize: '0.68rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <span>Granted via:</span>
                            <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{p.grantedViaRoleName}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Assigned Roles List Tab */
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Directly Assigned Roles ({filteredDrawerRoles.length}{drawerRoleSearch.trim() && selectedUser.assignedRoles?.length ? ` of ${selectedUser.assignedRoles.length}` : ''})
                    </div>
                  </div>

              {selectedUser.assignedRoles && selectedUser.assignedRoles.length > 0 && (
                <div style={{ position: 'relative', marginBottom: '0.65rem' }}>
                  <Search size={13} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Search roles..."
                    value={drawerRoleSearch}
                    onChange={(e) => setDrawerRoleSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.35rem 1.8rem 0.35rem 2rem',
                      fontSize: '0.78rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-tertiary)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                  {drawerRoleSearch && (
                    <button
                      type="button"
                      onClick={() => setDrawerRoleSearch('')}
                      style={{
                        position: 'absolute',
                        right: '0.45rem',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'flex'
                      }}
                      title="Clear search"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              )}
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '400px', overflowY: 'auto' }}>
                {(!selectedUser.assignedRoles || selectedUser.assignedRoles.length === 0) ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic', padding: '0.5rem 0' }}>
                    No roles directly assigned to this account.
                  </div>
                ) : filteredDrawerRoles.length === 0 ? (
                  <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                    <div>No roles match "{drawerRoleSearch}".</div>
                    <button
                      type="button"
                      onClick={() => setDrawerRoleSearch('')}
                      style={{
                        marginTop: '0.35rem',
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-blue)',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        textDecoration: 'underline'
                      }}
                    >
                      Clear search
                    </button>
                  </div>
                ) : (
                  filteredDrawerRoles.map((role: any, idx: number) => {
                    const roleCode = typeof role === 'string' ? role : (role.roleCode || role.value || '');
                    const roleName = typeof role === 'string' ? role : (role.roleName || role.displayName || roleCode);
                    const autoProvisioned = typeof role === 'object' ? (role.autoProvisioned ?? null) : null;
                    const category = typeof role === 'object' && role.category ? role.category : 'JOB';
                    const isCustom = typeof role === 'object' ? Boolean(role.isCustom) : false;

                    return (
                      <div 
                        key={idx} 
                        style={{ 
                          padding: '0.65rem 0.85rem', 
                          backgroundColor: 'var(--bg-secondary)', 
                          border: '1px solid var(--border-color)', 
                          borderRadius: '6px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.25rem'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {roleName}
                          </span>
                          <span className={`badge ${category === 'DUTY' ? 'badge-blue' : category === 'ADMIN' ? 'badge-gold' : 'badge-gold'}`} style={{ fontSize: '0.65rem' }}>
                            {category}
                          </span>
                        </div>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <code style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{roleCode}</code>
                          <span style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                            {autoProvisioned && (
                              <span style={{ fontSize: '0.65rem', color: 'var(--accent-green, #059669)', fontWeight: 600 }}>Auto: {autoProvisioned}</span>
                            )}
                            {isCustom && (
                              <span style={{ fontSize: '0.65rem', color: 'var(--accent-blue)', fontWeight: 600 }}>Custom</span>
                            )}
                          </span>
                        </div>

                        {onInspectRole && roleCode && (
                          <div style={{ marginTop: '0.35rem', display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => onInspectRole(roleCode, roleName)}
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                fontSize: '0.72rem',
                                color: 'var(--accent-blue)',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.2rem',
                                fontWeight: 500
                              }}
                            >
                              <span>Trace Hierarchy</span>
                              <ArrowRight size={10} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )}

    </div>
  );
}
