import React, { useEffect, useState, useMemo } from 'react';
import { Search, Award, X, Users, Network, KeyRound, AlertTriangle, Sparkles, ArrowRight, RefreshCw } from 'lucide-react';
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

export default function Roles({
  initialCategory = 'ALL',
  isActive = true,
  onInvestigateRole,
  onBack,
  onRegisterBack
}: RolesProps) {
  const [roles, setRoles] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(() => (initialCategory ? initialCategory.toUpperCase() : 'ALL'));
  const [selectedRole, setSelectedRole] = useState<any | null>(null);
  
  // Synchronize internal selected role drawer with topbar Back button
  useEffect(() => {
    if (onRegisterBack) {
      if (isActive && selectedRole) {
        onRegisterBack({
          canGoBack: true,
          onBack: () => setSelectedRole(null),
          label: 'Roles Catalog'
        });
      } else if (isActive) {
        onRegisterBack(null);
      }
    }
  }, [isActive, selectedRole, onRegisterBack]);

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

  // Tabs within role details: 'OVERVIEW', 'HIERARCHY', 'PRIVILEGES'
  const [detailTab, setDetailTab] = useState<'OVERVIEW' | 'HIERARCHY' | 'PRIVILEGES'>('OVERVIEW');
  const [hierarchyData, setHierarchyData] = useState<any | null>(null);
  const [privilegeData, setPrivilegeData] = useState<any | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [environmentMode, setEnvironmentMode] = useState<'DEMO' | 'ORACLE_FUSION'>('DEMO');

  useEffect(() => {
    let isCancelled = false;
    // Instant loading on mount / category / page change; debounce search typing by 300ms
    const delay = searchTerm ? 300 : 0;
    const delayDebounceFn = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const startIndex = (currentPage - 1) * pageSize + 1;
        const res = await api.getRoles(
          searchTerm || undefined,
          categoryFilter === 'ALL' ? undefined : categoryFilter,
          startIndex,
          pageSize
        );
        if (!isCancelled && res?.roles) {
          setRoles(res.roles);
          setTotalResults(res.totalResults || res.roles.length);
          setDataSource(res.dataSource || 'Oracle Fusion');
          setEnvironmentMode(res.mode || 'DEMO');
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
  }, [searchTerm, categoryFilter, currentPage, pageSize]);

  // Update category filter and clear search if initialCategory changes
  useEffect(() => {
    const targetCat = (initialCategory || 'ALL').toUpperCase();
    setCategoryFilter(targetCat);
    setSearchTerm('');
    setCurrentPage(1);
    setSelectedRole(null);
  }, [initialCategory]);

  // Fetch details (hierarchy and privileges) when role selection changes
  useEffect(() => {
    if (!selectedRole) return;
    
    async function loadRoleEntitlements() {
      setDetailLoading(true);
      setHierarchyData(null);
      setPrivilegeData(null);
      try {
        const hierRes = await api.getRoleHierarchy(selectedRole.displayName);
        setHierarchyData(hierRes);

        const privRes = await api.getRolePrivileges(selectedRole.displayName);
        setPrivilegeData(privRes);
      } catch (err) {
        console.error('Error fetching role details:', err);
      } finally {
        setDetailLoading(false);
      }
    }

    loadRoleEntitlements();
    setDetailTab('OVERVIEW');
  }, [selectedRole]);

  const renderHierarchyNode = (node: any, depth = 0) => {
    if (!node) return null;
    return (
      <div key={node.code} style={{ marginLeft: `${depth * 1.25}rem`, marginTop: '0.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>└─</span>
          <span style={{ fontWeight: depth === 0 ? 700 : 500 }}>{node.name}</span>
          <code style={{ fontSize: '0.7rem' }}>({node.code})</code>
          <span className="badge badge-blue" style={{ fontSize: '0.6rem', padding: '0.1rem 0.3rem' }}>{node.category}</span>
        </div>
        {node.children?.map((child: any) => renderHierarchyNode(child, depth + 1))}
      </div>
    );
  };

  const categoryLabelMap: Record<string, string> = {
    JOB: 'Job Roles',
    DUTY: 'Duty Roles',
    DATA: 'Data Roles',
    ABSTRACT: 'Abstract Roles',
    GRC: 'GRC / Access Rules',
    UNASSIGNED: 'Roles Without Users',
    OTHER: 'Other Roles'
  };
  const activeCategoryName = categoryFilter !== 'ALL' ? (categoryLabelMap[categoryFilter] || 'Roles') : 'Roles';

  const activeFilters = useMemo(() => {
    const list: { label: string; value: string }[] = [];
    if (categoryFilter !== 'ALL') {
      list.push({ label: 'Category', value: categoryLabelMap[categoryFilter] || categoryFilter });
    }
    if (searchTerm) {
      list.push({ label: 'Search', value: `"${searchTerm}"` });
    }
    return list;
  }, [categoryFilter, searchTerm]);

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
        style={{ width: '80px', padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
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
      <div style={{ padding: '2rem' }}>
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
    <div style={{ padding: '2rem', maxWidth: '1400px', width: '100%', margin: '0 auto', display: 'flex', gap: '2rem' }}>
      
      {/* Left Grid */}
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
              Security Role Catalog
            </h1>
            <p style={{ color: '#E0E7FF', fontSize: '0.92rem', margin: 0 }}>
              Browse Job, Duty, GRC, and Abstract roles mapped in the {dataSource || 'Oracle Fusion'} registry.
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
              {totalResults > 0 ? `${totalResults.toLocaleString()} Roles` : `${roles.length} Roles`}
            </div>
          </div>
        </div>

        {/* Filters & Page Size */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
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
            <option value="GRC">GRC / Access Rules</option>
            <option value="UNASSIGNED">Roles Without Users</option>
            <option value="OTHER">Other Roles</option>
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
              { key: 'displayName', label: 'Display Name', defaultSelected: true },
              { key: 'roleCode', label: 'Role Code', defaultSelected: true },
              { key: 'category', label: 'Category', defaultSelected: true },
              { key: 'description', label: 'Description', defaultSelected: true, getValue: (r: any) => r.description || '—' },
              { key: 'userCount', label: 'User Count', defaultSelected: true, getValue: (r: any) => r.userCount !== undefined ? r.userCount : '—' },
              { key: 'classification', label: 'Classification', defaultSelected: false, getValue: (r: any) => r.roleCode?.startsWith('CLAAPS_') || r.roleCode?.startsWith('CUSTOM_') ? 'Custom' : 'Standard Oracle' }
            ]}
            onFetchScopeData={async (scope) => {
              if (scope === 'PAGE') return roles;
              const countToFetch = Math.min(totalResults || 5000, 10000);
              const res = await api.getRoles(
                scope === 'FILTERED' ? (searchTerm || undefined) : undefined,
                scope === 'FILTERED' && categoryFilter !== 'ALL' ? categoryFilter : undefined,
                1,
                countToFetch
              );
              return res?.roles || [];
            }}
          />
        </div>

        {/* Top Table Toolbar: Count, Rows Per Page & Top Pagination Controls */}
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
                <th>Display Name</th>
                <th>Role Code</th>
                <th>Category</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableLoadingState
                  title="Searching Oracle Fusion Roles Catalog..."
                  subtitle="Retrieving security roles, categories, and assigned permissions"
                  colSpan={4}
                  skeletonRows={4}
                />
              ) : roles.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
                      <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        No roles matched your search criteria.
                      </div>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {searchTerm ? `No results for "${searchTerm}" in ${categoryFilter !== 'ALL' ? activeCategoryName : 'all categories'}.` : 'No roles available in this category.'}
                      </p>
                      {(searchTerm || categoryFilter !== 'ALL') && (
                        <button
                          onClick={() => {
                            setSearchTerm('');
                            setCategoryFilter('ALL');
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
                  <tr
                    key={role.id || role.roleCode}
                    onClick={() => setSelectedRole(role)}
                    style={{ cursor: 'pointer', backgroundColor: selectedRole?.roleCode === role.roleCode ? 'rgba(255, 255, 255, 0.04)' : '' }}
                  >
                    <td style={{ fontWeight: 600 }}>{highlightMatch(role.displayName, searchTerm)}</td>
                    <td><code>{highlightMatch(role.roleCode, searchTerm)}</code></td>
                    <td><span className="badge badge-blue">{role.category}</span></td>
                    <td>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onInvestigateRole) {
                            onInvestigateRole(role.roleCode, role.displayName);
                          } else {
                            setSelectedRole(role);
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
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom Pagination Bar */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '1rem',
            padding: '0.75rem 0.25rem',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            flexWrap: 'wrap',
            gap: '0.75rem'
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

      {/* Right Drawer Card */}
      {selectedRole && (
        <div className="glass-panel animate-fade-in" style={{
          width: '450px',
          height: 'fit-content',
          padding: '1.5rem',
          position: 'sticky',
          top: '2rem',
          alignSelf: 'flex-start'
        }}>
          
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
            <div>
              <span className="badge badge-blue" style={{ fontSize: '0.7rem', marginBottom: '0.25rem' }}>{selectedRole.category} Role</span>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, fontFamily: 'var(--font-header)', margin: 0 }}>
                {selectedRole.displayName}
              </h3>
              <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{selectedRole.roleCode}</code>
            </div>
            <button
              onClick={() => setSelectedRole(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>
          </div>

          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.4', marginBottom: '1.25rem' }}>
            {selectedRole.description}
          </p>

          {/* Deep Investigation Workspace Trigger */}
          {onInvestigateRole && (
            <button 
              onClick={() => onInvestigateRole(selectedRole.roleCode, selectedRole.displayName)}
              className="btn btn-primary"
              style={{ width: '100%', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              <Sparkles size={14} />
              <span>Launch Deep Workspace</span>
            </button>
          )}

          {/* Sub Tabs Navigation */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', gap: '1rem', marginBottom: '1.25rem' }}>
            {[
              { id: 'OVERVIEW', label: 'Members', icon: Users },
              { id: 'HIERARCHY', label: 'Hierarchy', icon: Network },
              { id: 'PRIVILEGES', label: 'Privileges', icon: KeyRound }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setDetailTab(tab.id as any)}
                style={{
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  cursor: 'pointer',
                  paddingBottom: '0.5rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: detailTab === tab.id ? 'var(--accent-gold)' : 'var(--text-secondary)',
                  borderBottom: detailTab === tab.id ? '2px solid var(--accent-gold)' : '2px solid transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  transition: 'all 0.15s ease'
                }}
              >
                <tab.icon size={14} />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab Contents */}
          {detailLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem' }}>
              <div style={{ height: '20px', width: '100%' }} className="skeleton" />
              <div style={{ height: '20px', width: '80%' }} className="skeleton" />
              <div style={{ height: '20px', width: '90%' }} className="skeleton" />
            </div>
          ) : (
            <div style={{ fontSize: '0.85rem' }}>
              
              {/* Tab 1: Members (Overview) */}
              {detailTab === 'OVERVIEW' && (
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.75rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Assigned Identities ({selectedRole.members?.length || 0})
                  </div>
                  {selectedRole.members && selectedRole.members.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {selectedRole.members.map((m: any, idx: number) => (
                        <div key={idx} className="glass-panel" style={{ padding: '0.5rem 0.75rem', display: 'flex', justifyItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 600 }}>{m.display}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Member Code: {m.value ? m.value.replace('usr_', '') : (m.name || 'N/A')}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: '1.5rem', textAlign: 'center', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }}>
                      No direct member assignments. (Inherited by parent roles or unassigned).
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Hierarchy */}
              {detailTab === 'HIERARCHY' && (
                <div>
                  {hierarchyData?.integrationRequired ? (
                    <div style={{
                      padding: '1rem',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'rgba(217, 119, 6, 0.05)',
                      border: '1px dashed var(--accent-gold)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-gold)', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                        <AlertTriangle size={15} />
                        <span>Oracle Integration Required</span>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                        {hierarchyData.message}
                      </p>
                    </div>
                  ) : hierarchyData?.hierarchy ? (
                    <div style={{ padding: '0.25rem' }}>
                      {renderHierarchyNode(hierarchyData.hierarchy)}
                    </div>
                  ) : (
                    <p style={{ color: 'var(--text-muted)' }}>Hierarchy not available.</p>
                  )}
                </div>
              )}

              {/* Tab 3: Privileges */}
              {detailTab === 'PRIVILEGES' && (
                <div>
                  {privilegeData?.integrationRequired ? (
                    <div style={{
                      padding: '1rem',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'rgba(217, 119, 6, 0.05)',
                      border: '1px dashed var(--accent-gold)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-gold)', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                        <AlertTriangle size={15} />
                        <span>Oracle Integration Required</span>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                        {privilegeData.message}
                      </p>
                    </div>
                  ) : privilegeData?.privileges && privilegeData.privileges.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Entitlements list ({privilegeData.privileges.length})
                        </div>
                        <EnterpriseExportControl
                          filename={`${selectedRole.roleCode || selectedRole.displayName}_privileges`}
                          sheetName="Role Privileges"
                          reportTitle={`Role ${selectedRole.displayName} Entitlements`}
                          entityName="Privileges"
                          buttonText="Export Excel"
                          size="sm"
                          currentPageData={privilegeData.privileges}
                          filteredCount={privilegeData.privileges.length}
                          totalCount={privilegeData.privileges.length}
                          availableColumns={[
                            { key: 'name', label: 'Privilege Name', defaultSelected: true },
                            { key: 'inheritedFrom', label: 'Inherited From', defaultSelected: true }
                          ]}
                        />
                      </div>
                      <div className="table-container" style={{ margin: 0 }}>
                        <table className="enterprise-table" style={{ fontSize: '0.75rem' }}>
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Inherited From</th>
                            </tr>
                          </thead>
                          <tbody>
                            {privilegeData.privileges.map((p: any, idx: number) => (
                              <tr key={idx}>
                                <td style={{ fontWeight: 600 }}>{p.name}</td>
                                <td style={{ color: 'var(--text-muted)' }}>{p.inheritedFrom}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '1.5rem', textAlign: 'center', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }}>
                      No permissions directly mapped to this role item.
                    </div>
                  )}
                </div>
              )}

            </div>
          )}

        </div>
      )}

    </div>
  );
}
