import React, { useEffect, useState, useMemo } from 'react';
import { Search, Award, X, Users, ArrowRight, RefreshCw } from 'lucide-react';
import { api } from '../services/api.js';
import { EnterpriseExportControl } from '../components/EnterpriseExportControl';
import { TableLoadingState } from '../components/TableLoadingState';

function highlightMatch(text: string, query: string) {
  if (!query || !query.trim() || !text) return text;
  const words = query.trim().split(/\s+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0) return text;
  const regex = new RegExp(`(${words.join('|')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) => 
    regex.test(part) ? (
      <mark key={i} style={{ backgroundColor: 'rgba(234, 179, 8, 0.25)', color: 'inherit', padding: '0 2px', borderRadius: '2px', fontWeight: 700 }}>
        {part}
      </mark>
    ) : part
  );
}

interface RolesProps {
  initialCategory?: string;
  isActive?: boolean;
  onInvestigateRole?: (roleCode: string, displayName: string) => void;
  onBack?: () => void;
  onRegisterBack?: (config: { canGoBack: boolean; onBack: () => void; label?: string } | null) => void;
}

const normalizeCategory = (cat?: string): string => {
  if (!cat) return 'ALL';
  const norm = cat.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (norm === 'ALL' || norm === '') return 'ALL';
  if (norm.includes('UNASSIGNED') || norm.includes('WITHOUT_USERS') || norm.includes('NO_USERS') || norm.includes('ZERO_USERS')) return 'UNASSIGNED';
  if (norm.includes('JOB')) return 'JOB';
  if (norm.includes('DUTY')) return 'DUTY';
  if (norm.includes('DATA')) return 'DATA';
  if (norm.includes('ABSTRACT')) return 'ABSTRACT';
  return cat.trim().toUpperCase();
};

export default function Roles({
  initialCategory = 'ALL',
  isActive = true,
  onInvestigateRole,
  onBack,
  onRegisterBack
}: RolesProps) {
  const [roles, setRoles] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(() => normalizeCategory(initialCategory));
  const [moduleFilter, setModuleFilter] = useState('ALL');
  const [availableModules, setAvailableModules] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    return () => {
      if (onRegisterBack) {
        onRegisterBack(null);
      }
    };
  }, [onRegisterBack]);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalResults, setTotalResults] = useState(0);

  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [environmentMode, setEnvironmentMode] = useState<'DEMO' | 'ORACLE_FUSION'>('DEMO');

  const handleSyncAuthoritativeRoles = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await api.syncRoles();
      if (res?.success) {
        setSyncMessage({
          type: 'success',
          text: `Successfully synced ${res.totalRoles?.toLocaleString() || 'all'} authoritative roles from ${res.source || 'BI Publisher'} (${res.duration || ''}).`
        });
        const startIndex = (currentPage - 1) * pageSize + 1;
        const refreshed = await api.getRoles(
          searchTerm || undefined,
          categoryFilter === 'ALL' ? undefined : categoryFilter,
          startIndex,
          pageSize,
          moduleFilter === 'ALL' ? undefined : moduleFilter
        );
        if (refreshed?.roles) {
          setRoles(refreshed.roles);
          setTotalResults(refreshed.totalResults || refreshed.roles.length);
          if (refreshed.modules && Array.isArray(refreshed.modules)) {
            setAvailableModules(refreshed.modules);
          }
        }
      } else {
        setSyncMessage({
          type: 'error',
          text: res?.message || res?.error || 'Role synchronization failed.'
        });
      }
    } catch (err: any) {
      setSyncMessage({
        type: 'error',
        text: err.message || 'Failed to sync roles from BI Publisher.'
      });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    let isCancelled = false;
    // Instant loading on mount / category / page change; debounce search typing by 300ms
    const delay = searchTerm ? 500 : 0;
    const delayDebounceFn = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const startIndex = (currentPage - 1) * pageSize + 1;
        const res = await api.getRoles(
          searchTerm || undefined,
          categoryFilter === 'ALL' ? undefined : categoryFilter,
          startIndex,
          pageSize,
          moduleFilter === 'ALL' ? undefined : moduleFilter
        );
        if (!isCancelled && res?.roles) {
          setRoles(res.roles);
          setTotalResults(res.totalResults || res.roles.length);
          setDataSource(res.dataSource || 'Oracle Fusion');
          setEnvironmentMode(res.mode || 'DEMO');
          if (res.modules && Array.isArray(res.modules) && res.modules.length > 0) {
            setAvailableModules(res.modules);
          }
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('Failed to load roles:', err);
          setError('Unable to fetch security roles.');
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
  }, [searchTerm, categoryFilter, moduleFilter, currentPage, pageSize]);

  // Update category filter and clear search if initialCategory changes
  useEffect(() => {
    const targetCat = normalizeCategory(initialCategory);
    setCategoryFilter(targetCat);
    setSearchTerm('');
    setModuleFilter('ALL');
    setCurrentPage(1);
  }, [initialCategory]);



  const categoryLabelMap: Record<string, string> = {
    JOB: 'Job Roles',
    DUTY: 'Duty Roles',
    DATA: 'Data Roles',
    ABSTRACT: 'Abstract Roles',
    UNASSIGNED: 'Roles Without Users'
  };
  const activeCategoryName = categoryFilter !== 'ALL' ? (categoryLabelMap[categoryFilter] || 'Roles') : 'Roles';

  const activeFilters = useMemo(() => {
    const list: { label: string; value: string }[] = [];
    if (categoryFilter !== 'ALL') {
      list.push({ label: 'Category', value: categoryLabelMap[categoryFilter] || categoryFilter });
    }
    if (moduleFilter !== 'ALL') {
      list.push({ label: 'Module', value: moduleFilter });
    }
    if (searchTerm) {
      list.push({ label: 'Search', value: `"${searchTerm}"` });
    }
    return list;
  }, [categoryFilter, moduleFilter, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));

  const renderPaginationButtons = () => (
    <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
      <button
        onClick={() => setCurrentPage(1)}
        disabled={currentPage === 1}
        className="btn btn-secondary"
        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', opacity: currentPage === 1 ? 0.5 : 1 }}
      >
        First
      </button>
      <button
        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
        disabled={currentPage === 1}
        className="btn btn-secondary"
        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', opacity: currentPage === 1 ? 0.5 : 1 }}
      >
        Prev
      </button>

      <span style={{ padding: '0 0.5rem', fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.8rem' }}>
        {currentPage}
      </span>

      <button
        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
        disabled={currentPage >= totalPages}
        className="btn btn-secondary"
        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', opacity: currentPage >= totalPages ? 0.5 : 1 }}
      >
        Next
      </button>
      <button
        onClick={() => setCurrentPage(totalPages)}
        disabled={currentPage >= totalPages}
        className="btn btn-secondary"
        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', opacity: currentPage >= totalPages ? 0.5 : 1 }}
      >
        Last
      </button>
    </div>
  );

  const renderRowsPerPageSelect = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
      <span>Rows per page:</span>
      <select
        className="form-select"
        style={{
          width: '78px',
          minWidth: '78px',
          height: '28px',
          padding: '0.15rem 1.6rem 0.15rem 0.6rem',
          fontSize: '0.8rem',
          lineHeight: 1.2,
          backgroundPosition: 'right 0.45rem center',
          backgroundSize: '0.75rem',
          borderRadius: '6px',
          cursor: 'pointer'
        }}
        value={pageSize}
        onChange={(e) => {
          setPageSize(Number(e.target.value));
          setCurrentPage(1);
        }}
      >
        <option value={25}>25</option>
        <option value={50}>50</option>
        <option value={100}>100</option>
        <option value={200}>200</option>
      </select>
    </div>
  );

  if (initialLoading && roles.length === 0) {
    return (
      <div className="page-container">
        <div style={{ height: '35px', width: '150px', marginBottom: '1.5rem' }} className="skeleton" />
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ height: '40px', width: '250px' }} className="skeleton" />
          <div style={{ height: '40px', width: '150px' }} className="skeleton" />
        </div>
        <div style={{ height: '300px' }} className="skeleton" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="users-roles-layout-container">
      
      {/* Left Grid */}
      <div className="users-roles-main-col">
        
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
              Security Role Catalog
            </h1>
            <p style={{ color: '#E0E7FF', fontSize: '0.92rem', margin: 0 }}>
              Browse Job, Duty, Data, and Abstract roles mapped in the Oracle Fusion registry.
              {categoryFilter !== 'ALL' && (
                <span 
                  onClick={() => {
                    setCategoryFilter('ALL');
                    setSearchTerm('');
                    setCurrentPage(1);
                  }}
                  style={{ 
                    marginLeft: '0.6rem', 
                    padding: '0.15rem 0.6rem', 
                    backgroundColor: 'rgba(255, 255, 255, 0.2)', 
                    borderRadius: '9999px', 
                    fontSize: '0.75rem', 
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem'
                  }}
                  title="Click to reset filter to All Categories"
                >
                  Filter: {activeCategoryName} <X size={12} />
                </span>
              )}
              {moduleFilter !== 'ALL' && (
                <span 
                  onClick={() => {
                    setModuleFilter('ALL');
                    setSearchTerm('');
                    setCurrentPage(1);
                  }}
                  style={{ 
                    marginLeft: '0.6rem', 
                    padding: '0.15rem 0.6rem', 
                    backgroundColor: 'rgba(255, 255, 255, 0.2)', 
                    borderRadius: '9999px', 
                    fontSize: '0.75rem', 
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem'
                  }}
                  title="Click to reset filter to All Modules"
                >
                  Module: {moduleFilter} <X size={12} />
                </span>
              )}
            </p>
          </div>
          <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <button
              onClick={handleSyncAuthoritativeRoles}
              disabled={syncing}
              className="btn"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.2)',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                color: '#ffffff',
                padding: '0.35rem 0.85rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                borderRadius: '8px',
                cursor: syncing ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                backdropFilter: 'blur(8px)'
              }}
              title="Sync authoritative roles directly from Oracle Fusion BI Publisher (/Custom/Claaps_All_Module_Roles.xdo)"
            >
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
              <span>{syncing ? 'Syncing BIP Roles...' : 'Sync BIP Roles'}</span>
            </button>
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
              {totalResults > 0 ? `${totalResults.toLocaleString()} Roles` : `${roles.length} Roles`}
            </div>
          </div>
        </div>

        {syncMessage && (
          <div style={{
            margin: '0.75rem 0',
            padding: '0.6rem 1rem',
            borderRadius: '8px',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: syncMessage.type === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${syncMessage.type === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            color: syncMessage.type === 'success' ? '#16a34a' : '#dc2626'
          }}>
            <span>{syncMessage.text}</span>
            <button
              onClick={() => setSyncMessage(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Filters & Page Size */}
        <div className="filter-bar-responsive" style={{ marginBottom: '1.5rem' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
            <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
              <Search size={16} />
            </span>
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: '2.5rem', paddingRight: searchTerm ? '4.5rem' : '2.5rem' }}
              placeholder="Search by role name or code..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
            <div style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {loading && roles.length > 0 && (
                <RefreshCw size={14} className="animate-spin" style={{ color: 'var(--accent-blue)' }} />
              )}
              {searchTerm && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setCurrentPage(1);
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.2rem' }}
                  title="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <select
            className="form-select"
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setSearchTerm('');
              setCurrentPage(1);
            }}
          >
            <option value="ALL">All Categories</option>
            <option value="JOB">Job Roles</option>
            <option value="DUTY">Duty Roles</option>
            <option value="DATA">Data Roles</option>
            <option value="ABSTRACT">Abstract Roles</option>
          </select>

          <select
            className="form-select"
            value={moduleFilter}
            onChange={(e) => {
              setModuleFilter(e.target.value);
              setSearchTerm('');
              setCurrentPage(1);
            }}
            style={{ maxWidth: '180px' }}
          >
            <option value="ALL">All Modules</option>
            {availableModules.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <EnterpriseExportControl
            filename="oracle_roles_catalog"
            sheetName="Roles Catalog"
            reportTitle="Oracle Fusion Security Roles Catalog"
            dataSource={dataSource}
            entityName="Roles"
            categoryLabel={categoryFilter !== 'ALL' ? activeCategoryName : undefined}
            buttonText="Export Excel"
            currentPageData={roles}
            filteredCount={totalResults}
            totalCount={totalResults}
            appliedFilters={activeFilters}
            availableColumns={[
              { key: 'displayName', label: 'Role Name', defaultSelected: true },
              { key: 'roleCode', label: 'Role Code', defaultSelected: true },
              { key: 'module', label: 'Module', defaultSelected: true, getValue: (r: any) => r.module || 'Common' },
              { key: 'category', label: 'Category', defaultSelected: true },
              { key: 'description', label: 'Description', defaultSelected: true, getValue: (r: any) => r.description || '—' },
              {
                key: 'assignedMembers',
                label: 'Assigned Members',
                defaultSelected: true,
                getValue: (r: any) => {
                  if (typeof r.assignedMembers === 'number') return r.assignedMembers;
                  if (typeof r.memberCount === 'number') return r.memberCount;
                  if (typeof r.userCount === 'number') return r.userCount;
                  if (Array.isArray(r.members)) return r.members.length;
                  if (Array.isArray(r.assignedIdentities)) return r.assignedIdentities.length;
                  return 0;
                }
              },
            ]}
            onFetchScopeData={async (scope) => {
              if (scope === 'PAGE') return roles;
              const countToFetch = Math.min(totalResults || 5000, 10000);
              const res = await api.getRoles(
                scope === 'FILTERED' ? (searchTerm || undefined) : undefined,
                scope === 'FILTERED' && categoryFilter !== 'ALL' ? categoryFilter : undefined,
                1,
                countToFetch,
                scope === 'FILTERED' && moduleFilter !== 'ALL' ? moduleFilter : undefined
              );
              return res?.roles || [];
            }}
          />
        </div>

        {/* Top Table Toolbar: Count, Rows Per Page & Top Pagination Controls */}
        <div className="pagination-bar-responsive" style={{
          marginBottom: '0.75rem',
          fontSize: '0.82rem',
          color: 'var(--text-secondary)'
        }}>
          <div>
            Showing <strong>{totalResults > 0 ? ((currentPage - 1) * pageSize + 1).toLocaleString() : 0}</strong>–<strong>{Math.min(currentPage * pageSize, totalResults).toLocaleString()}</strong> of <strong>{totalResults.toLocaleString()}</strong> roles
            {loading && <span style={{ marginLeft: '0.5rem', color: 'var(--accent-blue)', fontSize: '0.75rem' }}>(updating...)</span>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            {renderRowsPerPageSelect()}
            {totalPages > 1 && renderPaginationButtons()}
          </div>
        </div>

        {/* List Table */}
        <div className="table-container" style={{ margin: 0, position: 'relative' }}>
          <table className="enterprise-table" style={{ opacity: loading ? 0.65 : 1, transition: 'opacity 0.2s ease' }}>
            <thead>
              <tr>
                <th>Role Name</th>
                <th>Role Code</th>
                <th>Module</th>
                <th>Category</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableLoadingState
                  title="Searching Oracle Fusion Roles Catalog..."
                  subtitle="Retrieving security roles, categories, and assigned permissions"
                  colSpan={5}
                  skeletonRows={4}
                />
              ) : roles.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
                      <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        No roles matched your search criteria.
                      </div>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {searchTerm ? `No results for "${searchTerm}" in ${categoryFilter !== 'ALL' ? activeCategoryName : 'all categories'}.` : 'No roles available in this category.'}
                      </p>
                      {(searchTerm || categoryFilter !== 'ALL' || moduleFilter !== 'ALL') && (
                        <button
                          onClick={() => {
                            setSearchTerm('');
                            setCategoryFilter('ALL');
                            setModuleFilter('ALL');
                            setCurrentPage(1);
                          }}
                          className="btn btn-secondary"
                          style={{ marginTop: '0.5rem', fontSize: '0.78rem' }}
                        >
                          Clear Filters & Search
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                roles.map(role => (
                  <tr key={role.id || role.roleCode}>
                    <td style={{ fontWeight: 600 }}>{highlightMatch(role.displayName, searchTerm)}</td>
                    <td><code>{highlightMatch(role.roleCode, searchTerm)}</code></td>
                    <td>
                      <span className="badge" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3B82F6', fontWeight: 600, border: '1px solid rgba(59, 130, 246, 0.25)', fontSize: '0.72rem' }}>
                        {role.module || 'Common'}
                      </span>
                    </td>
                    <td><span className="badge badge-blue">{role.category}</span></td>
                    <td>
                      <button 
                        onClick={() => onInvestigateRole?.(role.roleCode, role.displayName)}
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
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom Pagination Bar */}
        {totalPages > 1 && (
          <div className="pagination-bar-responsive" style={{
            marginTop: '1rem',
            padding: '0.75rem 0.25rem',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
              <div>
                Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong> ({totalResults.toLocaleString()} total roles)
              </div>
              {renderRowsPerPageSelect()}
            </div>
            {renderPaginationButtons()}
          </div>
        )}
      </div>

      </div>


    </div>
  );
}
