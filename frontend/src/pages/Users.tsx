import React, { useEffect, useState, useMemo } from 'react';
import { Search, UserCheck, ShieldAlert, ArrowRight, User as UserIcon, X, Mail, Shield, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../services/api.js';
import { EnterpriseExportControl } from '../components/EnterpriseExportControl';

interface UsersProps {
  initialFilter?: string;
  onInvestigateUser?: (userId: string, displayName: string) => void;
  onInspectRole?: (roleCode: string, displayName: string) => void;
  hasAccess?: (pageId: string) => boolean;
}

export default function Users({ initialFilter = 'ALL', onInvestigateUser, onInspectRole, hasAccess }: UsersProps) {
  void hasAccess;
  const [users, setUsers] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dataSource, setDataSource] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalResults, setTotalResults] = useState(0);

  const [activeCategoryFilter, setActiveCategoryFilter] = useState(initialFilter);

  useEffect(() => {
    setActiveCategoryFilter(initialFilter);
    setCurrentPage(1);
  }, [initialFilter]);

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
    const delay = searchTerm ? 350 : 0;
    const delayDebounceFn = setTimeout(() => {
      async function loadUsers() {
        setLoading(true);
        setError('');
        try {
          const startIndex = (currentPage - 1) * pageSize + 1;
          const res = await api.getUsers(
            searchTerm || undefined,
            startIndex,
            pageSize,
            activeCategoryFilter !== 'ALL' ? activeCategoryFilter : undefined
          );
          if (res?.users) {
            setUsers(res.users);
            setTotalResults(res.totalResults !== undefined ? res.totalResults : res.users.length);
            setDataSource(res.dataSource || 'Oracle Fusion SCIM API');
          }
        } catch (err) {
          console.error('Failed to load users:', err);
          setError('Unable to fetch users from security service.');
        } finally {
          setLoading(false);
        }
      }
      loadUsers();
    }, delay);

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, currentPage, pageSize, activeCategoryFilter]);

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

  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));

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

  if (loading && users.length === 0) {
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
              {totalResults > 0 ? `${totalResults.toLocaleString()} Users in Directory` : 'Loading directory...'}
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
            style={{ width: '160px' }}
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Users</option>
            <option value="INACTIVE">Inactive Users</option>
          </select>

          {/* Enterprise Export Control */}
          <EnterpriseExportControl
            filename="users_directory"
            sheetName="Users Directory"
            reportTitle="Oracle Fusion Identity & Access Management Directory"
            dataSource={dataSource}
            entityName="Users"
            buttonText="Export Users"
            currentPageData={filteredUsers}
            filteredCount={totalResults}
            totalCount={totalResults}
            appliedFilters={activeFilters}
            availableColumns={[
              { key: 'userName', label: 'Username', defaultSelected: true },
              { key: 'userCategory', label: 'User Category', defaultSelected: true, getValue: (u: any) => u.userCategory || '' },
              { key: 'firstName', label: 'First Name', defaultSelected: true, getValue: (u: any) => u.firstName || '' },
              { key: 'lastName', label: 'Last Name', defaultSelected: true, getValue: (u: any) => u.lastName || '' },
              { key: 'displayName', label: 'Display Name', defaultSelected: false },
              { key: 'email', label: 'Email Address', defaultSelected: true, getValue: (u: any) => u.email || 'N/A' },
              { key: 'status', label: 'Active', defaultSelected: true, getValue: (u: any) => u.active ? 'Active' : 'Inactive' },
              { key: 'roleName', label: 'Role Name (primary)', defaultSelected: true, getValue: (u: any) => getPrimaryRole(u)?.roleName || '' },
              { key: 'roleCode', label: 'Role Code (primary)', defaultSelected: true, getValue: (u: any) => getPrimaryRole(u)?.roleCode || '' },
              { key: 'autoProvisioned', label: 'Auto-Provisioned (primary)', defaultSelected: true, getValue: (u: any) => getPrimaryRole(u)?.autoProvisioned ?? '' },
              { key: 'roleCount', label: 'Role Count', defaultSelected: true, getValue: (u: any) => u.assignedRoles?.length || 0 },
              { key: 'personId', label: 'Person ID', defaultSelected: true, getValue: (u: any) => u.personId || '' },
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
                ? Math.min(totalResults || 5000, 5000)
                : Math.min(totalResults || 5000, 5000);
              const res = await api.getUsers(
                scope === 'FILTERED' ? (searchTerm || undefined) : undefined,
                1,
                countToFetch
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
            Showing <strong>{totalResults > 0 ? ((currentPage - 1) * pageSize + 1).toLocaleString() : 0}</strong>–<strong>{Math.min(currentPage * pageSize, totalResults).toLocaleString()}</strong> of <strong>{totalResults.toLocaleString()}</strong> users
            {loading && <span style={{ marginLeft: '0.5rem', color: 'var(--accent-blue)', fontSize: '0.75rem' }}>(updating...)</span>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            {renderRowsPerPageSelect()}
            {totalPages > 1 && renderPaginationButtons()}
          </div>
        </div>

        {/* Table Grid: live Oracle User Details Report (SCIM + HCM + BIP) */}
        <div className="table-container" style={{ margin: 0, overflowX: 'auto' }}>
          <table className="enterprise-table" style={{ minWidth: '2100px' }}>
            <thead>
              <tr>
                <th>Username</th>
                <th>User Category</th>
                <th>First Name</th>
                <th>Last Name</th>
                <th>Email Address</th>
                <th>Active</th>
                <th>Role Name</th>
                <th>Role Code</th>
                <th>Person ID</th>
                <th>Person Number</th>
                <th>Department</th>
                <th>Job</th>
                <th>Business Unit</th>
                <th>Location</th>
                <th>Manager</th>
                <th>Roles</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={17} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                    No security users match the filter criteria.
                  </td>
                </tr>
              ) : (
                filteredUsers.map(user => {
                  const primary = getPrimaryRole(user);
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
                    <td>{primary?.roleName || '—'}</td>
                    <td><code style={{ fontSize: '0.7rem' }}>{primary?.roleCode || '—'}</code></td>
                  <td>{user.personId || '—'}</td>
                    <td>{user.personNumber || '—'}</td>
                    <td>{user.department || '—'}</td>
                    <td>{user.job || '—'}</td>
                    <td>{user.businessUnit || '—'}</td>
                    <td>{user.location || '—'}</td>
                    <td>{user.manager || '—'}</td>
                    <td>{user.assignedRoles?.length || 0}</td>
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
                Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong> ({totalResults.toLocaleString()} total users)
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
                <div><strong>Person ID:</strong> {selectedUser.personId || '—'}</div>
                <div><strong>Person Number:</strong> {selectedUser.personNumber || '—'}</div>
                <div><strong>Department:</strong> {selectedUser.department || '—'}</div>
                <div><strong>Job:</strong> {selectedUser.job || '—'}</div>
                <div><strong>Business Unit:</strong> {selectedUser.businessUnit || '—'}</div>
                <div><strong>Location:</strong> {selectedUser.location || '—'}</div>
                <div style={{ gridColumn: '1 / -1' }}><strong>Manager:</strong> {selectedUser.manager || '—'}</div>
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

            {/* Assigned Roles List */}
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                Directly Assigned Roles ({selectedUser.assignedRoles?.length || 0})
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '400px', overflowY: 'auto' }}>
                {(!selectedUser.assignedRoles || selectedUser.assignedRoles.length === 0) ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic', padding: '0.5rem 0' }}>
                    No roles directly assigned to this account.
                  </div>
                ) : (
                  selectedUser.assignedRoles.map((role: any, idx: number) => {
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

          </div>
        </div>
      )}

    </div>
  );
}
