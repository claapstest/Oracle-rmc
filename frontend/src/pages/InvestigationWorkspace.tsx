import React, { useState, useEffect, useMemo } from 'react';
import { 
  Award, 
  Users, 
  KeyRound, 
  FileText, 
  X,
  Download, 
  Bookmark, 
  BookmarkCheck, 
  CornerDownRight, 
  AlertTriangle, 
  Calendar, 
  Shield, 
  ArrowRight, 
  Lock, 
  Send,
  Terminal,
  Database,
  Search,
  ChevronLeft,
  ChevronRight,
  Info,
  RefreshCw,
  CheckCircle2
} from 'lucide-react';
import { api } from '../services/api';
import { TableExportControl } from '../components/TableExportControl';
import { TableLoadingState } from '../components/TableLoadingState';

// Global in-memory cache of user profiles to prevent repeated or N+1 lookups
const globalUserLookupCache: Record<string, { id?: string; userName?: string; displayName?: string; active?: boolean }> = {};

interface InvestigationWorkspaceProps {
  entity: {
    type: 'role' | 'user';
    id: string; // roleCode or username
    name: string; // displayName
    initialTab?: string;
    sourcePage?: string;
  };
  onClose: () => void;
  onNavigate: (type: 'role' | 'user', id: string, name: string) => void;
  onInspectRole?: (roleCode: string, displayName: string) => void;
  onBack: () => void;
  historyCount: number;
  onNavigateToPage?: (pageId: string) => void;
  environmentMode: 'DEMO' | 'ORACLE_FUSION';
}

export default function InvestigationWorkspace({ 
  entity, 
  onClose, 
  onNavigate, 
  onInspectRole,
  onBack,
  historyCount,
  onNavigateToPage,
  environmentMode 
}: InvestigationWorkspaceProps) {
  const isRole = entity.type === 'role';

  // Tabs based on entity type
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'MEMBERS' | 'ROLES' | 'HIERARCHY' | 'PRIVILEGES' | 'AUDIT'>('OVERVIEW');
  const [highlightedRoleCode, setHighlightedRoleCode] = useState<string | null>(null);

  const handleRoleChipClick = (roleCode: string) => {
    setHighlightedRoleCode(roleCode);
    setActiveTab('ROLES');

    // Wait for the DOM to switch and mount the tab elements
    setTimeout(() => {
      const el = document.getElementById(`role-card-${roleCode}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);

    // Clear highlighting animation after 3 seconds
    setTimeout(() => {
      setHighlightedRoleCode(null);
    }, 3000);
  };
  const [data, setData] = useState<any>(null);
  const [hierarchyData, setHierarchyData] = useState<any>(null);
  const [privilegeData, setPrivilegeData] = useState<any>(null);
  const [auditData, setAuditData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Assigned Members state & filtering (Batched, NO N+1)
  const [membersData, setMembersData] = useState<any[] | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersSearch, setMembersSearch] = useState('');
  const [membersPage, setMembersPage] = useState(1);
  const [membersPageSize, setMembersPageSize] = useState(25);

  // User assigned roles search
  const [rolesSearch, setRolesSearch] = useState('');


  // Decoupled background loading states
  const [privilegeLoading, setPrivilegeLoading] = useState(false);
  const [privilegeError, setPrivilegeError] = useState('');
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  // Complete Privilege & Hierarchy Data (Direct & Indirect)
  const [completePrivilegeResult, setCompletePrivilegeResult] = useState<{
    directCount: number;
    indirectCount: number;
    totalCount: number;
    roleCode?: string;
    roleName?: string;
    details: any[];
  } | null>(null);

  // Functional Privileges Filtering and Pagination States
  const [privilegeSearch, setPrivilegeSearch] = useState('');
  const [privilegeInheritanceFilter, setPrivilegeInheritanceFilter] = useState<'ALL' | 'DIRECT' | 'INDIRECT'>('ALL');
  const [privilegePage, setPrivilegePage] = useState(1);
  const [privilegePageSize, setPrivilegePageSize] = useState(25);

  // Saved bookmark state
  const [isSaved, setIsSaved] = useState(false);

  // Filtered assigned roles for user inspection
  const filteredAssignedRoles = useMemo(() => {
    const list: any[] = data?.assignedRoles || [];
    const q = rolesSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((role: any) => {
      const rName = typeof role === 'string' ? role : (role.roleName || role.displayName || role.roleCode || '');
      const rCode = typeof role === 'string' ? role : (role.roleCode || role.value || '');
      return rName.toLowerCase().includes(q) || rCode.toLowerCase().includes(q);
    });
  }, [data?.assignedRoles, rolesSearch]);

  // Check if investigation is already bookmarked
  useEffect(() => {
    const saved = localStorage.getItem('saved_investigations');
    if (saved) {
      const items = JSON.parse(saved);
      const exists = items.some((item: any) => item.type === entity.type && item.id === entity.id);
      setIsSaved(exists);
    }
  }, [entity]);

  // Load details with Decoupled Asynchronous Tasks
  useEffect(() => {
    let isMounted = true;

    async function loadWorkspaceData() {
      setData(null);
      setLoading(true);
      setError('');
      setHierarchyData(null);
      setPrivilegeData(null);
      setCompletePrivilegeResult(null);
      setPrivilegeError('');
      setAuditData([]);
      setPrivilegePage(1);
      setPrivilegeSearch('');
      setPrivilegeInheritanceFilter('ALL');
      setMembersData(null);
      setMembersLoading(false);
      setMembersSearch('');
      setMembersPage(1);
      setRolesSearch('');

      if (entity.type === 'role') {
        // Step 1: Fast Initial Base Metadata Resolution (0ms in-memory cache lookup, avoids full /api/roles catalog download)
        setLoading(true);
        try {
          const roleIdentifier = entity.id || entity.name;
          const roleRes = await api.getRole(roleIdentifier);
          if (!isMounted) return;
          if (roleRes?.role) {
            setData(roleRes.role);
          } else {
            // Fallback: search query if direct identifier lookup misses
            const rolesRes = await api.getRoles(entity.name);
            if (!isMounted) return;
            const matchedRole = rolesRes?.roles?.find((r: any) => 
              r.displayName?.toLowerCase() === entity.name.toLowerCase() || 
              r.roleCode?.toLowerCase() === entity.id.toLowerCase()
            );
            if (matchedRole) {
              setData(matchedRole);
            } else {
              setData({
                displayName: entity.name,
                roleCode: entity.id,
                category: 'Job',
                description: 'Oracle Fusion Security Role details.',
                members: []
              });
            }
          }
        } catch (err) {
          if (!isMounted) return;
          setData({
            displayName: entity.name,
            roleCode: entity.id,
            category: 'Job',
            description: 'Oracle Fusion Security Role details.',
            members: []
          });
        } finally {
          // Immediately unblock the UI so the user sees the role header in < 50ms!
          if (isMounted) setLoading(false);
        }

        // Parallel Independent Task 1: Assigned Members (Batched SCIM query in chunks of 40 IDs, NO N+1, cached)
        setMembersLoading(true);
        const targetRoleParam = entity.name || entity.id;
        api.getRoleMembers(targetRoleParam)
          .then(res => {
            if (!isMounted) return;
            if (res?.members && res.members.length > 0) {
              setMembersData(res.members);
              // Seed global user lookup cache
              res.members.forEach((m: any) => {
                if (m.userName) globalUserLookupCache[m.userName.toLowerCase()] = m;
                if (m.id) globalUserLookupCache[m.id.toLowerCase()] = m;
              });
            }
          })
          .catch(err => {
            console.warn('Members fetch error:', err);
          })
          .finally(() => {
            if (isMounted) setMembersLoading(false);
          });

        // Parallel Independent Task 2: Hierarchy
        setHierarchyLoading(true);
        api.getRoleHierarchy(entity.name)
          .then(hier => { if (isMounted) setHierarchyData(hier); })
          .catch(err => console.warn('Hierarchy fetch error:', err))
          .finally(() => { if (isMounted) setHierarchyLoading(false); });

        // Parallel Independent Task 3: Complete Privileges & Hierarchy Inheritance (Direct & Indirect)
        setPrivilegeLoading(true);
        const targetCode = entity.id || entity.name;
        api.getCompletePrivilegeCount(targetCode)
          .then(res => {
            if (!isMounted) return;
            if (res && res.success && Array.isArray(res.details)) {
              setCompletePrivilegeResult({
                directCount: res.directCount ?? 0,
                indirectCount: res.indirectCount ?? 0,
                totalCount: res.totalCount ?? res.details.length,
                roleCode: res.roleCode || targetCode,
                roleName: res.roleName || entity.name,
                details: res.details
              });
              setPrivilegeData({
                success: true,
                roleCode: res.roleCode || targetCode,
                roleName: res.roleName || entity.name,
                privileges: res.details.map((d: any) => ({
                  code: d.privilegeCode,
                  name: d.privilegeName || d.privilegeCode,
                  type: d.type || 'DIRECT',
                  inheritedFrom: d.sourceRoles || targetCode,
                  roleCode: res.roleCode || targetCode,
                  roleName: res.roleName || entity.name
                }))
              });
            } else {
              // Fallback to legacy getRolePrivileges if needed
              api.getRolePrivileges(entity.name)
                .then(privs => {
                  if (!isMounted) return;
                  setPrivilegeData(privs);
                })
                .catch(() => {});
            }
          })
          .catch(err => {
            if (!isMounted) return;
            console.error('Privileges fetch error:', err);
            setPrivilegeError(err.message || 'Failed to load functional privileges.');
          })
          .finally(() => {
            if (isMounted) setPrivilegeLoading(false);
          });

      } else {
        // User identity investigation: load from PostgreSQL report (oracle_raw_user_access) first
        setLoading(true);
        try {
          const userRes = await api.getUser(entity.id, 'database');
          const userObj = userRes?.user || userRes;
          if (isMounted && userObj) {
            setData(userObj);
            // Cache user
            if (userObj.userName) globalUserLookupCache[userObj.userName.toLowerCase()] = userObj;
            if (userObj.id) globalUserLookupCache[userObj.id.toLowerCase()] = userObj;
          }
        } catch (err: any) {
          console.error('Failed to load user details:', err);
          if (isMounted) setError(err.message || 'Error loading identity details from Oracle.');
        } finally {
          if (isMounted) setLoading(false);
        }
      }
    }

    loadWorkspaceData();
    const initTab = (entity as any).initialTab;
    if (initTab === 'HIERARCHY') {
      setActiveTab('PRIVILEGES');
    } else if (!isRole && (initTab === 'PRIVILEGES' || initTab === 'AUDIT' || initTab === 'MEMBERS' || initTab === 'HIERARCHY')) {
      setActiveTab('OVERVIEW');
    } else {
      setActiveTab(initTab || 'OVERVIEW');
    }

    return () => {
      isMounted = false;
    };
  }, [entity, environmentMode, isRole]);

  // Ensure activeTab is always valid for user entities
  useEffect(() => {
    if (!isRole && (activeTab === 'PRIVILEGES' || activeTab === 'AUDIT' || activeTab === 'MEMBERS' || activeTab === 'HIERARCHY')) {
      setActiveTab('OVERVIEW');
    }
  }, [isRole, activeTab]);

  // Lazy-load audit logs only when the user navigates to the AUDIT tab (Non-blocking)
  useEffect(() => {
    if (activeTab === 'AUDIT' && auditData.length === 0 && !auditLoading) {
      setAuditLoading(true);
      if (entity.type === 'role') {
        api.getAuditLogs()
          .then(logs => {
            if (logs?.logs) {
              const roleLogs = logs.logs.filter((l: any) => 
                l.businessObject?.toLowerCase().includes(entity.id.toLowerCase()) || 
                l.businessObject?.toLowerCase().includes(entity.name.toLowerCase())
              );
              setAuditData(roleLogs);
            }
          })
          .catch(err => console.warn('Audit fetch error:', err))
          .finally(() => setAuditLoading(false));
      } else {
        api.getAuditLogs(entity.id)
          .then(logs => {
            if (logs?.logs) setAuditData(logs.logs);
          })
          .catch(err => console.warn('User audit fetch error:', err))
          .finally(() => setAuditLoading(false));
      }
    }
  }, [activeTab, entity.type, entity.id, entity.name, auditData.length, auditLoading]);

  const toggleSave = () => {
    const saved = localStorage.getItem('saved_investigations');
    let items = saved ? JSON.parse(saved) : [];
    
    if (isSaved) {
      items = items.filter((item: any) => !(item.type === entity.type && item.id === entity.id));
      setIsSaved(false);
    } else {
      items.push({
        type: entity.type,
        id: entity.id,
        name: entity.name,
        timestamp: new Date().toISOString()
      });
      setIsSaved(true);
    }
    localStorage.setItem('saved_investigations', JSON.stringify(items));
  };


  const renderHierarchyNode = (node: any, depth = 0) => {
    if (!node) return null;
    return (
      <div key={node.code || node.name} style={{ marginLeft: `${depth * 1.5}rem`, marginTop: '0.4rem' }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          padding: '0.35rem 0.6rem',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: depth > 0 ? 'var(--bg-secondary)' : 'transparent',
          border: depth > 0 ? '1px solid var(--border-color)' : 'none'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
            <CornerDownRight size={14} style={{ color: 'var(--text-muted)' }} />
            <span style={{ fontWeight: depth === 0 ? 700 : 500 }}>{node.name}</span>
            <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>({node.code})</code>
            {node.category && (
              <span className="badge badge-blue" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>{node.category}</span>
            )}
          </div>
          {node.code && node.code !== entity.id && (
            <button
              onClick={() => onNavigate('role', node.code, node.name || node.code)}
              className="btn btn-secondary"
              style={{ 
                padding: '0.15rem 0.45rem', 
                fontSize: '0.7rem', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.2rem', 
                color: 'var(--accent-blue)',
                borderColor: 'rgba(53, 99, 233, 0.25)'
              }}
              title={`Inspect ${node.name}`}
            >
              <span>Inspect</span>
              <ArrowRight size={10} />
            </button>
          )}
        </div>
        {node.children?.map((child: any) => renderHierarchyNode(child, depth + 1))}
      </div>
    );
  };

  // Determine categories
  const roleCategory = data?.category || 'Job';

  // Memoized Functional Privileges filtering & pagination (Must precede any conditional early returns)
  const allPrivileges: any[] = useMemo(() => {
    if (completePrivilegeResult?.details && completePrivilegeResult.details.length > 0) {
      return completePrivilegeResult.details.map((d: any) => ({
        code: d.privilegeCode,
        name: d.privilegeName || d.privilegeCode,
        description: '',
        type: d.type || 'DIRECT',
        inheritedFrom: d.sourceRoles || entity.id || entity.name,
        roleCode: completePrivilegeResult.roleCode || entity.id || entity.name,
        roleName: completePrivilegeResult.roleName || entity.name
      }));
    }
    return privilegeData?.privileges || [];
  }, [completePrivilegeResult, privilegeData, entity]);

  const directPrivilegesCount = useMemo(() => {
    if (completePrivilegeResult) return completePrivilegeResult.directCount;
    return allPrivileges.filter((p: any) => p.type === 'DIRECT').length;
  }, [completePrivilegeResult, allPrivileges]);

  const indirectPrivilegesCount = useMemo(() => {
    if (completePrivilegeResult) return completePrivilegeResult.indirectCount;
    return allPrivileges.filter((p: any) => p.type === 'INDIRECT').length;
  }, [completePrivilegeResult, allPrivileges]);

  const totalPrivilegesCount = useMemo(() => {
    if (completePrivilegeResult) return completePrivilegeResult.totalCount;
    return allPrivileges.length;
  }, [completePrivilegeResult, allPrivileges]);

  const filteredPrivileges = useMemo(() => {
    let list = allPrivileges;
    if (privilegeInheritanceFilter === 'DIRECT') {
      list = list.filter((p: any) => p.type === 'DIRECT');
    } else if (privilegeInheritanceFilter === 'INDIRECT') {
      list = list.filter((p: any) => p.type === 'INDIRECT');
    }
    if (privilegeSearch.trim()) {
      const term = privilegeSearch.trim().toLowerCase();
      list = list.filter((p: any) => 
        (p.name && p.name.toLowerCase().includes(term)) ||
        (p.code && p.code.toLowerCase().includes(term)) ||
        (p.description && p.description.toLowerCase().includes(term)) ||
        (p.inheritedFrom && p.inheritedFrom.toLowerCase().includes(term)) ||
        (p.roleCode && p.roleCode.toLowerCase().includes(term)) ||
        (p.roleName && p.roleName.toLowerCase().includes(term))
      );
    }
    return list;
  }, [allPrivileges, privilegeSearch, privilegeInheritanceFilter]);

  const totalPages = privilegePageSize === -1 ? 1 : Math.max(1, Math.ceil(filteredPrivileges.length / privilegePageSize));
  const startIndex = privilegePageSize === -1 ? 0 : (privilegePage - 1) * privilegePageSize;
  const endIndex = privilegePageSize === -1 ? filteredPrivileges.length : Math.min(startIndex + privilegePageSize, filteredPrivileges.length);
  const currentPrivileges = privilegePageSize === -1 ? filteredPrivileges : filteredPrivileges.slice(startIndex, endIndex);

  // Memoized Assigned Members resolution, filtering & pagination (Must precede conditional early return)
  const resolvedMemberList: any[] = useMemo(() => {
    if (membersData && membersData.length > 0) {
      return membersData;
    }
    // Fallback: If data.members is available from initial role load
    if (data?.members && data.members.length > 0) {
      return data.members.map((m: any) => {
        const rawVal = m.value || m.userName || '';
        const cached = globalUserLookupCache[rawVal.toLowerCase()] || (m.id ? globalUserLookupCache[m.id.toLowerCase()] : null);
        return {
          id: m.id || rawVal,
          userName: cached?.userName || m.userName || rawVal,
          displayName: cached?.displayName || m.displayName || m.display || '',
          active: cached?.active ?? m.active ?? true
        };
      });
    }
    return [];
  }, [membersData, data?.members]);

  const filteredMembers = useMemo(() => {
    let list = resolvedMemberList;
    if (membersSearch.trim()) {
      const term = membersSearch.trim().toLowerCase();
      list = list.filter((m: any) => 
        (m.displayName && m.displayName.toLowerCase().includes(term)) ||
        (m.userName && m.userName.toLowerCase().includes(term)) ||
        (m.id && m.id.toLowerCase().includes(term))
      );
    }
    return list;
  }, [resolvedMemberList, membersSearch]);

  const totalMemberPages = membersPageSize === -1 ? 1 : Math.max(1, Math.ceil(filteredMembers.length / membersPageSize));
  const memberStartIndex = membersPageSize === -1 ? 0 : (membersPage - 1) * membersPageSize;
  const memberEndIndex = membersPageSize === -1 ? filteredMembers.length : Math.min(memberStartIndex + membersPageSize, filteredMembers.length);
  const currentMembers = membersPageSize === -1 ? filteredMembers : filteredMembers.slice(memberStartIndex, memberEndIndex);


  if (loading) {
    return (
      <div style={{ padding: '2rem' }}>
        <div style={{ height: '30px', width: '200px', marginBottom: '1.5rem' }} className="skeleton" />
        <div style={{ height: '80px', marginBottom: '1.5rem' }} className="skeleton" />
        <div style={{ height: '300px' }} className="skeleton" />
      </div>
    );
  }

  return (
    <div className="page-container">
      
      {/* Breadcrumb Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {entity.sourcePage === 'roles' ? (
            <>
              <span 
                style={{ cursor: 'pointer', color: 'var(--text-secondary, #64748b)', transition: 'color 0.15s ease' }} 
                onClick={onClose} 
                title="Back to Roles Catalog"
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-blue, #2563eb)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary, #64748b)')}
              >
                Roles Catalog
              </span>
              <span>&gt;</span>
              <span 
                style={{ cursor: 'pointer', color: 'var(--text-secondary, #64748b)', transition: 'color 0.15s ease' }} 
                onClick={onClose} 
                title="Back to Roles Catalog"
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-blue, #2563eb)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary, #64748b)')}
              >
                {roleCategory} Roles
              </span>
              <span>&gt;</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{entity.name}</span>
            </>
          ) : entity.sourcePage === 'users' ? (
            <>
              <span 
                style={{ cursor: 'pointer', color: 'var(--text-secondary, #64748b)', transition: 'color 0.15s ease' }} 
                onClick={onClose} 
                title="Back to Users List"
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-blue, #2563eb)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary, #64748b)')}
              >
                Users List
              </span>
              {isRole && (
                <>
                  <span>&gt;</span>
                  <span>{roleCategory} Roles</span>
                </>
              )}
              <span>&gt;</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{entity.name}</span>
            </>
          ) : entity.sourcePage === 'reports' ? (
            <>
              <span 
                style={{ cursor: 'pointer', color: 'var(--text-secondary, #64748b)', transition: 'color 0.15s ease' }} 
                onClick={onClose} 
                title="Back to Reports"
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-blue, #2563eb)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary, #64748b)')}
              >
                Reports
              </span>
              <span>&gt;</span>
              <span>{isRole ? `${roleCategory} Roles` : 'Users'}</span>
              <span>&gt;</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{entity.name}</span>
            </>
          ) : entity.sourcePage === 'user-management' ? (
            <>
              <span 
                style={{ cursor: 'pointer', color: 'var(--text-secondary, #64748b)', transition: 'color 0.15s ease' }} 
                onClick={onClose} 
                title="Back to User Management"
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-blue, #2563eb)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary, #64748b)')}
              >
                User Management
              </span>
              <span>&gt;</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{entity.name}</span>
            </>
          ) : entity.sourcePage === 'dashboard' ? (
            <>
              <span 
                style={{ cursor: 'pointer', color: 'var(--text-secondary, #64748b)', transition: 'color 0.15s ease' }} 
                onClick={onClose} 
                title="Back to Dashboard"
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-blue, #2563eb)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary, #64748b)')}
              >
                Dashboard
              </span>
              <span>&gt;</span>
              <span>{isRole ? `${roleCategory} Roles` : 'Users'}</span>
              <span>&gt;</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{entity.name}</span>
            </>
          ) : (
            // Default / Dashboard
            <>
              <span 
                style={{ cursor: 'pointer', color: 'var(--text-secondary, #64748b)', transition: 'color 0.15s ease' }} 
                onClick={() => onNavigateToPage?.('dashboard')} 
                title="Back to Dashboard"
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-blue, #2563eb)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary, #64748b)')}
              >
                Dashboard
              </span>
              <span>&gt;</span>
              {isRole ? (
                <>
                  <span 
                    style={{ cursor: 'pointer', color: 'var(--text-secondary, #64748b)', transition: 'color 0.15s ease' }} 
                    onClick={() => onNavigateToPage?.('roles')} 
                    title="Go to Roles Catalog"
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-blue, #2563eb)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary, #64748b)')}
                  >
                    Roles
                  </span>
                  <span>&gt;</span>
                  <span>{roleCategory} Roles</span>
                </>
              ) : (
                <>
                  <span 
                    style={{ cursor: 'pointer', color: 'var(--text-secondary, #64748b)', transition: 'color 0.15s ease' }} 
                    onClick={() => onNavigateToPage?.('users')} 
                    title="Go to Users List"
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-blue, #2563eb)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary, #64748b)')}
                  >
                    Users
                  </span>
                </>
              )}
              <span>&gt;</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{entity.name}</span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            className="btn btn-secondary" 
            onClick={toggleSave}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem' }}
          >
            {isSaved ? (
              <>
                <BookmarkCheck size={16} style={{ color: 'var(--accent-green)' }} />
                <span>Saved</span>
              </>
            ) : (
              <>
                <Bookmark size={16} />
                <span>
                  {entity.sourcePage === 'roles' ? 'Bookmark Role' : (entity.sourcePage === 'users' ? 'Bookmark User' : 'Save Investigation')}
                </span>
              </>
            )}
          </button>
          
          <button 
            onClick={onClose}
            className="btn btn-secondary"
            style={{ padding: '0.5rem', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Close workspace"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {error && (
        <div className="glass-panel" style={{ padding: '1rem', borderLeft: '4px solid var(--accent-red)', marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--accent-red)', fontSize: '0.85rem' }}>{error}</p>
        </div>
      )}

      {/* Profile Header Panel */}
      <div className="page-header-banner animate-fade-in" style={{
        padding: '1.75rem 2rem',
        marginBottom: '1.5rem',
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  padding: '0.2rem 0.65rem',
                  borderRadius: '9999px',
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  color: '#ffffff'
                }}>
                  {isRole ? `${roleCategory} Role` : 'User Identity'}
                </span>
              </div>
              <h1 style={{ fontSize: '1.85rem', fontWeight: 800, fontFamily: 'var(--font-header)', marginTop: '0.5rem', color: '#ffffff' }}>
                {entity.name}
              </h1>
              {isRole && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.25rem', fontSize: '0.88rem', color: '#E0E7FF' }}>
                  <span>Identifier: <code style={{ color: '#ffffff', background: 'rgba(255,255,255,0.15)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{entity.id}</code></span>
                  <span>•</span>
                  <span>Assigned Users: {membersLoading ? (data?.members?.length || '...') : resolvedMemberList.length}</span>
                </div>
              )}
            </div>

            <div style={{ fontSize: '0.8rem', color: '#E0E7FF', textAlign: 'right' }}>
              <div>Last Sync</div>
              <div style={{ fontWeight: 600, color: '#ffffff' }}>Just now</div>
            </div>
          </div>
          
          {isRole && data?.description && (
            <p style={{ marginTop: '1rem', fontSize: '0.88rem', color: '#E0E7FF', borderTop: '1px solid rgba(255, 255, 255, 0.15)', paddingTop: '0.75rem' }}>
              {data.description}
            </p>
          )}
        </div>
      </div>

      {/* Tabs Layout */}
      <div className="investigation-workspace-grid">
        
        {/* Left Side: Tab Buttons */}
        <div className="investigation-tabs-nav">
          {[
            { id: 'OVERVIEW', label: 'Overview', show: true },
            { 
              id: 'MEMBERS', 
              label: isRole 
                ? `Assigned Members (${membersLoading ? '...' : (resolvedMemberList.length)})` 
                : 'Assigned Members', 
              show: isRole 
            },
            { id: 'ROLES', label: 'Assigned Roles', show: !isRole },
            { 
              id: 'PRIVILEGES', 
              label: isRole 
                ? `Privileges & Inheritance (${privilegeLoading ? '...' : totalPrivilegesCount})`
                : 'Privileges Matrix', 
              show: isRole 
            },
            { 
              id: 'AUDIT', 
              label: `Audit Timeline ${auditLoading ? '(Loading...)' : auditData.length > 0 ? `(${auditData.length})` : ''}`, 
              show: false 
            }
          ].map(tab => {
            if (!tab.show) return null;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
                style={{
                  textAlign: 'left',
                  padding: '0.75rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backgroundColor: activeTab === tab.id ? 'var(--accent-blue)' : 'var(--bg-card)',
                  color: activeTab === tab.id ? '#ffffff' : 'var(--text-secondary)',
                  border: '1px solid var(--border-color)'
                }}
              >
                <span>{tab.label}</span>
              </button>
            );
          })}

          <div className="glass-panel" style={{ marginTop: '1.5rem', padding: '1rem', fontSize: '0.8rem' }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Quick Action Guide</h4>
            <p style={{ color: 'var(--text-muted)', lineHeight: '1.4', fontSize: '0.75rem' }}>
              Explore structural dependencies, member assignments, and functional privileges to evaluate security posture.
            </p>
          </div>
        </div>

        {/* Right Side: Tab Viewport Content */}
        <div className="glass-panel animate-fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
          
          {/* Tab 1: Overview */}
          {activeTab === 'OVERVIEW' && (
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Shield size={18} style={{ color: 'var(--accent-blue)' }} />
                <span>Entity Security Health Summary</span>
              </h3>

              {isRole ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                  <div 
                    className="glass-panel" 
                    onClick={() => setActiveTab('MEMBERS')}
                    style={{ padding: '0.85rem 1rem', textAlign: 'center', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', cursor: 'pointer', transition: 'all 0.2s ease', borderRadius: '8px' }}
                    title="Click to view assigned accounts"
                  >
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Assigned Members</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 700, margin: '0.2rem 0', color: 'var(--accent-blue)' }}>
                      {membersLoading ? (data?.members?.length || '...') : resolvedMemberList.length}
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--accent-blue)' }}>Assigned Accounts (Click to view)</span>
                  </div>

                  <div 
                    className="glass-panel" 
                    onClick={() => { setPrivilegeInheritanceFilter('DIRECT'); setActiveTab('PRIVILEGES'); }}
                    style={{ padding: '0.85rem 1rem', textAlign: 'center', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', cursor: 'pointer', transition: 'all 0.2s ease', borderRadius: '8px' }}
                    title="Click to view direct privileges"
                  >
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Direct Privileges</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 700, margin: '0.2rem 0', color: 'var(--accent-blue)' }}>
                      {privilegeLoading ? (
                        <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>...</span>
                      ) : (
                        directPrivilegesCount
                      )}
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Directly Assigned</span>
                  </div>

                  <div 
                    className="glass-panel" 
                    onClick={() => { setPrivilegeInheritanceFilter('INDIRECT'); setActiveTab('PRIVILEGES'); }}
                    style={{ padding: '0.85rem 1rem', textAlign: 'center', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', cursor: 'pointer', transition: 'all 0.2s ease', borderRadius: '8px' }}
                    title="Click to view indirect privileges"
                  >
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Indirect Privileges</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 700, margin: '0.2rem 0', color: '#8B5CF6' }}>
                      {privilegeLoading ? (
                        <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>...</span>
                      ) : (
                        indirectPrivilegesCount
                      )}
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Inherited from Duty Roles</span>
                  </div>

                  <div 
                    className="glass-panel" 
                    onClick={() => { setPrivilegeInheritanceFilter('ALL'); setActiveTab('PRIVILEGES'); }}
                    style={{
                      padding: '0.85rem 1rem',
                      textAlign: 'center',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-tertiary)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: 'var(--shadow-sm)',
                      borderRadius: '8px'
                    }}
                    title="Click to view all privileges"
                  >
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                      <span>Total Privileges</span>
                      <ArrowRight size={13} style={{ color: 'var(--accent-green)' }} />
                    </div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 700, margin: '0.2rem 0', color: 'var(--accent-green)', minHeight: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {privilegeLoading ? (
                        <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <RefreshCw size={14} className="animate-spin" />
                          <span>Loading...</span>
                        </span>
                      ) : (
                        totalPrivilegesCount
                      )}
                    </div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--accent-blue)', fontWeight: 600 }}>
                      {privilegeLoading ? 'Loading from database...' : `View all ${totalPrivilegesCount} permissions →`}
                    </span>
                  </div>
                </div>
              ) : (
                /* User Account Details — Oracle console layout, VEYRA blue theme, live instance data only */
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', marginBottom: '1rem', alignItems: 'stretch' }}>
                    {/* User Information */}
                    <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', border: '1px solid var(--border-color)', height: '100%', display: 'flex', flexDirection: 'column' }}>
                      <h4 style={{ fontSize: '1.05rem', fontWeight: 500, color: '#1E40AF', margin: '0 0 1rem 0', fontFamily: 'var(--font-header)' }}>
                        User Information
                      </h4>
                      {[
                        ['User Category', data?.userCategory || '—'],
                        ['User Name', data?.userName || entity.id],
                        ['First Name', data?.firstName || '—'],
                        ['Last Name', data?.lastName || '—'],
                        ['Email', data?.email || 'N/A'],
                        ['Phone', (data as any)?.phone || '—'],
                      ].map(([label, value]) => (
                        <div key={label} style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '0.75rem', padding: '0.3rem 0', fontSize: '0.85rem' }}>
                          <span style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{label}</span>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 500, wordBreak: 'break-word' }}>{value}</span>
                        </div>
                      ))}
                    </div>

                    {/* Associated Worker Information */}
                    <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', border: '1px solid var(--border-color)', height: '100%', display: 'flex', flexDirection: 'column' }}>
                      <h4 style={{ fontSize: '1.05rem', fontWeight: 500, color: '#1E40AF', margin: '0 0 1rem 0', fontFamily: 'var(--font-header)' }}>
                        Associated Worker Information
                      </h4>
                      {[
                        ['Worker Name', data?.displayName || '—'],
                        ['Person Number', data?.personNumber || '—'],
                        ['Manager', data?.manager || '—'],
                        ['Job', data?.job || '—'],
                        ['Business Unit', data?.businessUnit || '—'],
                        ['Department', data?.department || '—'],
                      ].map(([label, value]) => (
                        <div key={label} style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '0.75rem', padding: '0.3rem 0', fontSize: '0.85rem' }}>
                          <span style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{label}</span>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 500, wordBreak: 'break-word' }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Roles — live SCIM + BIP merge */}
                  <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', border: '1px solid var(--border-color)', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                      <h4 style={{ fontSize: '1.05rem', fontWeight: 500, color: '#1E40AF', margin: 0, fontFamily: 'var(--font-header)' }}>
                        Roles ({filteredAssignedRoles.length}{rolesSearch.trim() && data?.assignedRoles?.length ? ` of ${data.assignedRoles.length}` : ''})
                      </h4>
                      {data?.assignedRoles && data.assignedRoles.length > 0 && (
                        <div style={{ position: 'relative', width: '280px', maxWidth: '100%' }}>
                          <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                          <input
                            type="text"
                            placeholder="Search roles by role or role code..."
                            value={rolesSearch}
                            onChange={(e) => setRolesSearch(e.target.value)}
                            className="input-search"
                            style={{
                              width: '100%',
                              paddingLeft: '2.2rem',
                              paddingRight: rolesSearch ? '2rem' : '0.75rem',
                              height: '34px',
                              fontSize: '0.82rem',
                              borderRadius: '6px',
                              border: '1px solid var(--border-color)',
                              background: 'var(--bg-secondary)',
                              color: 'var(--text-primary)',
                              boxSizing: 'border-box'
                            }}
                          />
                          {rolesSearch && (
                            <button
                              type="button"
                              onClick={() => setRolesSearch('')}
                              style={{
                                position: 'absolute',
                                right: '0.5rem',
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
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {(!data?.assignedRoles || data.assignedRoles.length === 0) ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                        No roles directly assigned to this account.
                      </div>
                    ) : filteredAssignedRoles.length === 0 ? (
                      <div style={{ padding: '1.75rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem' }}>
                          No roles match "{rolesSearch}".
                        </p>
                        <button
                          type="button"
                          onClick={() => setRolesSearch('')}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem' }}
                        >
                          Clear Search
                        </button>
                      </div>
                    ) : (
                      <div className="table-container" style={{ margin: 0 }}>
                        <table className="enterprise-table">
                          <thead>
                            <tr>
                              <th>Role</th>
                              <th>Role Code</th>
                              <th>Auto-Provisioned</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredAssignedRoles.map((role: any, idx: number) => {
                              const rName = typeof role === 'string' ? role : (role.roleName || role.displayName || role.roleCode || '');
                              const rCode = typeof role === 'string' ? role : (role.roleCode || role.value || '');
                              const rAuto = typeof role === 'object' ? (role.autoProvisioned ?? '—') : '—';
                              return (
                                <tr key={idx}>
                                  <td
                                    style={{ fontWeight: 600, color: 'var(--accent-blue)', cursor: 'pointer' }}
                                    onClick={() => onNavigate('role', rCode, rName)}
                                    title={`Click to inspect role ${rName}`}
                                  >
                                    {rName}
                                  </td>
                                  <td><code style={{ fontSize: '0.75rem' }}>{rCode}</code></td>
                                  <td>{rAuto}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}



              {isRole && data?.assignedRoles && data.assignedRoles.length > 0 && (
                <div style={{ marginTop: '1.5rem' }}>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
                    Assigned Roles Preview ({data.assignedRoles.length})
                  </h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    {data.assignedRoles.slice(0, 5).map((role: any, idx: number) => {
                      const rName = role.roleName || 'Unknown Role';
                      const rCode = role.roleCode || '';
                      return (
                        <span 
                          key={idx} 
                          className="badge badge-blue" 
                          onClick={() => handleRoleChipClick(rCode)}
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', cursor: 'pointer', transition: 'transform 0.1s' }}
                          title={`Click to find and highlight ${rName}`}
                        >
                          {rName}
                        </span>
                      );
                    })}
                    {data.assignedRoles.length > 5 && (
                      <span className="badge badge-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>
                        +{data.assignedRoles.length - 5} more
                      </span>
                    )}
                  </div>
                  <button 
                    onClick={() => setActiveTab('ROLES')}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', color: 'var(--accent-blue)' }}
                  >
                    View All Assigned Roles &rarr;
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Assigned Members */}
          {activeTab === 'MEMBERS' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Users size={18} style={{ color: 'var(--accent-blue)' }} />
                    <span>Assigned Members</span>
                    <span className="badge badge-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                      {membersLoading ? 'Resolving...' : `${resolvedMemberList.length} users`}
                    </span>
                  </h3>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Users directly mapped to this role with resolved display identity and security codes.
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <TableExportControl
                    filename={`${entity.id || entity.name}_assigned_members`}
                    data={filteredMembers}
                    totalCount={filteredMembers.length}
                    columns={[
                      { key: 'displayName', label: 'Display Name', getValue: (m: any) => m.displayName || m.name || m.userName || '' },
                      { key: 'userName', label: 'User Name', getValue: (m: any) => m.userName || m.id || m.value || '' }
                    ]}
                  />
                </div>
              </div>

              {/* Search and page size filter */}
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input 
                    type="text"
                    placeholder="Filter by display name or user name..."
                    value={membersSearch}
                    onChange={(e) => {
                      setMembersSearch(e.target.value);
                      setMembersPage(1);
                    }}
                    className="input-search"
                    style={{ width: '100%', paddingLeft: '2.2rem', paddingRight: '0.75rem', height: '36px', fontSize: '0.8rem' }}
                  />
                  {membersSearch && (
                    <button
                      onClick={() => { setMembersSearch(''); setMembersPage(1); }}
                      style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <select
                  value={membersPageSize}
                  onChange={(e) => {
                    setMembersPageSize(Number(e.target.value));
                    setMembersPage(1);
                  }}
                  className="input-select"
                  style={{ height: '36px', padding: '0 0.5rem', fontSize: '0.75rem' }}
                >
                  <option value={10}>10 per page</option>
                  <option value={25}>25 per page</option>
                  <option value={50}>50 per page</option>
                  <option value={100}>100 per page</option>
                  <option value={-1}>Show all</option>
                </select>
              </div>

              <div className="table-container" style={{ margin: 0, overflowX: 'auto' }}>
                <table className="enterprise-table" style={{ fontSize: '0.82rem', width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '40%' }}>DISPLAY NAME</th>
                      <th style={{ width: '35%' }}>USER NAME</th>
                      <th style={{ width: '25%', textAlign: 'right' }}>INVESTIGATION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentMembers.length > 0 ? (
                      currentMembers.map((m: any, idx: number) => {
                        const userCode = m.userName || m.id || m.value || '';
                        const resolvedDisplayName = m.displayName?.trim() || '';
                        const isResolving = membersLoading && !resolvedDisplayName;
                        const displayLabel = resolvedDisplayName ? resolvedDisplayName : (isResolving ? 'Loading...' : (m.userName || 'Unknown User'));

                        return (
                          <tr key={idx} style={{ transition: 'background-color 0.15s ease' }}>
                            <td style={{ fontWeight: 600 }}>
                              {isResolving ? (
                                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  <RefreshCw size={12} className="animate-spin" />
                                  <span>Loading...</span>
                                </span>
                              ) : (
                                <span style={{ color: resolvedDisplayName ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                  {displayLabel}
                                </span>
                              )}
                            </td>
                            <td>
                              <code style={{ 
                                color: 'var(--text-secondary)', 
                                background: 'var(--bg-tertiary)', 
                                padding: '0.15rem 0.45rem', 
                                borderRadius: '4px',
                                fontSize: '0.78rem'
                              }}>
                                {userCode || '—'}
                              </code>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button 
                                onClick={() => onNavigate('user', userCode, resolvedDisplayName || userCode)}
                                className="btn btn-secondary" 
                                style={{ 
                                  padding: '0.25rem 0.65rem', 
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                  color: 'var(--accent-blue)',
                                  borderColor: 'rgba(53, 99, 233, 0.25)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.3rem'
                                }}
                                title={`Investigate ${displayLabel} (${userCode})`}
                              >
                                <span>Investigate User</span>
                                <ArrowRight size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      membersLoading ? (
                        <TableLoadingState
                          colSpan={3}
                          title="Resolving Assigned Members from Oracle Fusion..."
                          subtitle="Querying role membership hierarchy and identity accounts..."
                          skeletonRows={3}
                        />
                      ) : (
                        <tr>
                          <td colSpan={3} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                            {membersSearch 
                              ? `No members match the search query "${membersSearch}".` 
                              : 'No members assigned directly to this role.'}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination controls for members */}
              {totalMemberPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Page <strong>{membersPage}</strong> of <strong>{totalMemberPages}</strong> ({filteredMembers.length} total members)
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <button
                      onClick={() => setMembersPage(prev => Math.max(1, prev - 1))}
                      disabled={membersPage === 1}
                      className="btn btn-secondary"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                    >
                      <ChevronLeft size={14} />
                      <span>Previous</span>
                    </button>

                    {Array.from({ length: totalMemberPages }, (_, i) => i + 1).map(pNum => {
                      if (
                        pNum === 1 || 
                        pNum === totalMemberPages || 
                        (pNum >= membersPage - 2 && pNum <= membersPage + 2)
                      ) {
                        return (
                          <button
                            key={pNum}
                            onClick={() => setMembersPage(pNum)}
                            className={`btn ${membersPage === pNum ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ 
                              padding: '0.3rem 0.6rem', 
                              fontSize: '0.75rem', 
                              minWidth: '30px', 
                              fontWeight: membersPage === pNum ? 700 : 400 
                            }}
                          >
                            {pNum}
                          </button>
                        );
                      }
                      if (pNum === membersPage - 3 || pNum === membersPage + 3) {
                        return <span key={pNum} style={{ padding: '0 0.2rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>...</span>;
                      }
                      return null;
                    })}

                    <button
                      onClick={() => setMembersPage(prev => Math.min(totalMemberPages, prev + 1))}
                      disabled={membersPage === totalMemberPages}
                      className="btn btn-secondary"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                    >
                      <span>Next</span>
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Assigned Roles */}
          {activeTab === 'ROLES' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>
                  Assigned Security Roles ({filteredAssignedRoles.length}{rolesSearch.trim() && data?.assignedRoles?.length ? ` of ${data.assignedRoles.length}` : ''})
                </h3>
                <TableExportControl
                  filename={`${entity.id}_assigned_roles`}
                  data={filteredAssignedRoles.map((r: any) => ({ Role: typeof r === 'string' ? r : (r.roleName || r.roleCode || '') }))}
                  totalCount={filteredAssignedRoles.length}
                  columns={[
                    { key: 'Role', label: 'Role Name' }
                  ]}
                />
              </div>

              {/* Search Bar for Assigned Roles */}
              {data?.assignedRoles && data.assignedRoles.length > 0 && (
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      placeholder="Search assigned roles by role or role code..."
                      value={rolesSearch}
                      onChange={(e) => setRolesSearch(e.target.value)}
                      className="input-search"
                      style={{
                        width: '100%',
                        paddingLeft: '2.2rem',
                        paddingRight: rolesSearch ? '2rem' : '0.75rem',
                        height: '36px',
                        fontSize: '0.82rem',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        boxSizing: 'border-box'
                      }}
                    />
                    {rolesSearch && (
                      <button
                        type="button"
                        onClick={() => setRolesSearch('')}
                        style={{
                          position: 'absolute',
                          right: '0.5rem',
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
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {(!data?.assignedRoles || data.assignedRoles.length === 0) ? (
                  <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    No roles directly assigned to this account.
                  </div>
                ) : filteredAssignedRoles.length === 0 ? (
                  <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <p style={{ margin: '0 0 0.5rem 0', fontWeight: 500 }}>
                      No roles match "{rolesSearch}".
                    </p>
                    <button
                      type="button"
                      onClick={() => setRolesSearch('')}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                    >
                      Clear Search
                    </button>
                  </div>
                ) : (
                  filteredAssignedRoles.map((role: any, idx: number) => {
                    const rName = typeof role === 'string' ? role : (role.roleName || 'Unknown Role Name');
                    const rCode = typeof role === 'string' ? role : (role.roleCode || '');
                    const isCustom = typeof role === 'string' ? (role.startsWith('CLAAPS_') || role.startsWith('CUSTOM_')) : (role.isCustom || false);
                    
                    const isHighPriv = rName.toLowerCase().includes('security') || 
                                       rName.toLowerCase().includes('administrator') || 
                                       rName.toLowerCase().includes('manager') ||
                                       rName.toLowerCase().includes('analyst') ||
                                       rCode.toLowerCase().includes('it_security_manager') ||
                                       rCode.toLowerCase().includes('security_administrator') ||
                                       rCode.toLowerCase().includes('admin');

                    const isHighlighted = rCode === highlightedRoleCode;
                    return (
                      <div 
                        key={idx} 
                        id={`role-card-${rCode}`}
                        className={`glass-panel animate-fade-in ${isHighlighted ? 'highlight-pulse' : ''}`}
                        style={{ 
                          padding: '1rem', 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: '0.5rem',
                          borderLeft: `4px solid ${isHighlighted ? 'var(--accent-blue)' : (isHighPriv ? 'var(--accent-red)' : 'var(--accent-gold)')}`,
                          backgroundColor: isHighlighted ? 'var(--accent-blue-light)' : '',
                          boxShadow: isHighlighted ? '0 0 12px rgba(53, 99, 233, 0.35)' : '',
                          transform: isHighlighted ? 'scale(1.02)' : '',
                          transition: 'all 0.4s ease-in-out'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{rName}</span>
                          {isHighPriv && (
                            <span className="badge badge-inactive" style={{ fontSize: '0.65rem' }}>
                              High Privilege
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{rCode}</code>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {isCustom ? 'Custom Role' : 'Oracle Predefined'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.35rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.35rem' }}>
                          <button 
                            onClick={() => {
                              onNavigate('role', rCode, rName);
                            }}
                            className="btn btn-secondary" 
                            style={{ 
                              padding: '0.2rem 0.5rem', 
                              fontSize: '0.7rem', 
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: '0.25rem',
                              color: 'var(--accent-blue)',
                              borderColor: 'var(--accent-blue-light)',
                              background: 'transparent',
                              cursor: 'pointer'
                            }}
                          >
                            <span>Inspect Role</span>
                            <ArrowRight size={10} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Tab: Privileges & Inheritance */}
          {(activeTab === 'PRIVILEGES' || activeTab === 'HIERARCHY') && isRole && (
            <div>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <KeyRound size={18} style={{ color: 'var(--accent-green)' }} />
                    <span>
                      Privileges &amp; Inheritance — {privilegeLoading && allPrivileges.length === 0 ? 'Loading...' : totalPrivilegesCount}
                    </span>
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                      Complete authoritative security permissions and parent-child duty role grants for {entity.name}
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <TableExportControl
                    filename={`${entity.id}_privileges_and_inheritance`}
                    data={(filteredPrivileges.length > 0 ? filteredPrivileges : allPrivileges).map(p => ({
                      'Role Name': p.roleName || entity.name,
                      'Role Code': p.roleCode || entity.id,
                      'Type': p.type || 'DIRECT',
                      'Inherited from role code': p.inheritedFrom || p.sourceRoles || p.roleCode || entity.id,
                      'Privilege Name': p.name || '',
                      'Privilege Code': p.code || '',
                    }))}
                    totalCount={(filteredPrivileges.length > 0 ? filteredPrivileges : allPrivileges).length}
                  />
                </div>
              </div>

              {/* In-flight Loading Banner for Privileges */}
              {privilegeLoading && (
                <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem', borderLeft: '4px solid var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '0.75rem', backgroundColor: 'var(--accent-blue-subtle)' }}>
                  <RefreshCw size={18} className="animate-spin" style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Loading Privileges &amp; Hierarchy from Database...
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Retrieving authoritative direct &amp; indirect functional permissions.
                    </div>
                  </div>
                </div>
              )}

              {/* Error Banner */}
              {privilegeError && (
                <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem', borderLeft: '4px solid var(--accent-red)' }}>
                  <p style={{ color: 'var(--accent-red)', fontSize: '0.85rem', margin: 0 }}>{privilegeError}</p>
                </div>
              )}

              <>
                {/* Search, Inheritance Filter, and Page Size Toolbar */}
                {isRole && allPrivileges.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      {/* Live Search Input */}
                      <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
                        <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        <input 
                          type="text"
                          placeholder={`Search ${allPrivileges.length} privileges by name, code, inherited role...`}
                          value={privilegeSearch}
                          onChange={(e) => {
                            setPrivilegeSearch(e.target.value);
                            setPrivilegePage(1);
                          }}
                          className="form-input"
                          style={{ paddingLeft: '2.2rem', fontSize: '0.82rem', height: '36px', width: '100%' }}
                        />
                        {privilegeSearch && (
                          <button
                            onClick={() => { setPrivilegeSearch(''); setPrivilegePage(1); }}
                            style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem' }}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>

                      {/* Filter Pills */}
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button
                          onClick={() => { setPrivilegeInheritanceFilter('ALL'); setPrivilegePage(1); }}
                          className={`btn ${privilegeInheritanceFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', borderRadius: '6px' }}
                        >
                          All ({totalPrivilegesCount})
                        </button>
                        <button
                          onClick={() => { setPrivilegeInheritanceFilter('DIRECT'); setPrivilegePage(1); }}
                          className={`btn ${privilegeInheritanceFilter === 'DIRECT' ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', borderRadius: '6px' }}
                        >
                          Direct ({directPrivilegesCount})
                        </button>
                        <button
                          onClick={() => { setPrivilegeInheritanceFilter('INDIRECT'); setPrivilegePage(1); }}
                          className={`btn ${privilegeInheritanceFilter === 'INDIRECT' ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', borderRadius: '6px' }}
                        >
                          Indirect ({indirectPrivilegesCount})
                        </button>
                      </div>

                      {/* Page Size Selector */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        <span>Rows:</span>
                        {[25, 50, 100].map(sz => (
                          <button
                            key={sz}
                            onClick={() => { setPrivilegePageSize(sz); setPrivilegePage(1); }}
                            className={`btn ${privilegePageSize === sz ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                          >
                            {sz}
                          </button>
                        ))}
                        <button
                          onClick={() => { setPrivilegePageSize(-1); setPrivilegePage(1); }}
                          className={`btn ${privilegePageSize === -1 ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                        >
                          All
                        </button>
                      </div>
                    </div>

                    {/* Filter / Count Summary */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      <span>
                        Showing <strong>{filteredPrivileges.length === 0 ? 0 : startIndex + 1}–{endIndex}</strong> of <strong>{filteredPrivileges.length}</strong> privileges
                        {filteredPrivileges.length !== allPrivileges.length && ` (filtered from ${allPrivileges.length} total)`}
                      </span>
                      {privilegeSearch && (
                        <button 
                          onClick={() => { setPrivilegeSearch(''); setPrivilegeInheritanceFilter('ALL'); setPrivilegePage(1); }}
                          style={{ background: 'none', border: 'none', color: 'var(--accent-blue)', cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline' }}
                        >
                          Clear search
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Table */}
                <div className="table-container" style={{ margin: 0 }}>
                  <table className="enterprise-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '22%' }}>Role Name</th>
                        <th style={{ width: '20%' }}>Role Code</th>
                        <th style={{ width: '10%' }}>Type</th>
                        <th style={{ width: '20%' }}>Inherited from role code</th>
                        <th style={{ width: '18%' }}>Privilege Name</th>
                        <th style={{ width: '10%' }}>Privilege Code</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isRole ? (
                        currentPrivileges && currentPrivileges.length > 0 ? (
                          currentPrivileges.map((p: any, idx: number) => {
                            const roleCode = p.roleCode || entity.id;
                            const roleName = p.roleName || entity.name;
                            const inheritedFrom = p.inheritedFrom || p.sourceRoles || (p.type === 'DIRECT' ? roleCode : '—');
                            return (
                              <tr key={`${p.code || idx}_${p.type}_${idx}`}>
                                <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                  {roleName}
                                </td>
                                <td>
                                  <code style={{ fontSize: '0.78rem', color: 'var(--accent-blue)' }}>{roleCode}</code>
                                </td>
                                <td>
                                  <span className={`badge ${p.type === 'DIRECT' ? 'badge-blue' : 'badge-purple'}`} style={{ fontSize: '0.72rem', padding: '2px 8px', fontWeight: 600 }}>
                                    {p.type || 'DIRECT'}
                                  </span>
                                </td>
                                <td>
                                  <code style={{ fontSize: '0.78rem', color: p.type === 'INDIRECT' ? 'var(--accent-purple)' : 'var(--text-muted)' }}>
                                    {inheritedFrom}
                                  </code>
                                </td>
                                <td>
                                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{p.name}</div>
                                </td>
                                <td>
                                  <code style={{ fontSize: '0.78rem' }}>{p.code}</code>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          privilegeLoading ? (
                            <TableLoadingState
                              colSpan={6}
                              title="Extracting Privileges & Hierarchy from Oracle Fusion..."
                              subtitle="Querying authoritative permissions and duty grants from database..."
                              skeletonRows={4}
                            />
                          ) : (
                            <tr>
                              <td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                {privilegeSearch 
                                  ? `No privileges match the search query "${privilegeSearch}".`
                                  : 'No privileges mapped to this role.'}
                              </td>
                            </tr>
                          )
                        )
                      ) : (
                          // User identity fallback (retains standard view)
                          entity.id === 'JSMITH' ? (
                            <>
                              <tr>
                                <td style={{ fontWeight: 600 }}>Create Purchase Invoice</td>
                                <td><code>CREATE_PURCHASE_INVOICE</code></td>
                                <td><code>ORA_AP_INVOICE_DUTY</code></td>
                                <td><span className="badge badge-blue">Function</span></td>
                              </tr>
                              <tr>
                                <td style={{ fontWeight: 600 }}>Approve Purchase Invoice</td>
                                <td><code>APPROVE_PURCHASE_INVOICE</code></td>
                                <td><code>ORA_AP_INVOICE_DUTY</code></td>
                                <td><span className="badge badge-blue">Function</span></td>
                              </tr>
                              <tr>
                                <td style={{ fontWeight: 600 }}>Access Security Console</td>
                                <td><code>ACCESS_SECURITY_CONSOLE</code></td>
                                <td><code>ORA_SECURITY_CONSOLE_DUTY</code></td>
                                <td><span className="badge badge-blue">Function</span></td>
                              </tr>
                              <tr>
                                <td style={{ fontWeight: 600 }}>Manage User Accounts</td>
                                <td><code>MANAGE_USER_ACCOUNTS</code></td>
                                <td><code>ORA_USER_MANAGEMENT_DUTY</code></td>
                                <td><span className="badge badge-blue">Function</span></td>
                              </tr>
                            </>
                          ) : (
                            <tr>
                              <td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                                No high-sensitivity privileges inherited by this user identity.
                              </td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination Controls */}
                  {isRole && totalPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Page <strong>{privilegePage}</strong> of <strong>{totalPages}</strong> ({filteredPrivileges.length} total privileges)
                      </span>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <button
                          onClick={() => setPrivilegePage(prev => Math.max(1, prev - 1))}
                          disabled={privilegePage === 1}
                          className="btn btn-secondary"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                        >
                          <ChevronLeft size={14} />
                          <span>Previous</span>
                        </button>

                        {/* Numeric page pills */}
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map(pNum => {
                          if (
                            pNum === 1 || 
                            pNum === totalPages || 
                            (pNum >= privilegePage - 2 && pNum <= privilegePage + 2)
                          ) {
                            return (
                              <button
                                key={pNum}
                                onClick={() => setPrivilegePage(pNum)}
                                className={`btn ${privilegePage === pNum ? 'btn-primary' : 'btn-secondary'}`}
                                style={{ 
                                  padding: '0.3rem 0.6rem', 
                                  fontSize: '0.75rem', 
                                  minWidth: '30px', 
                                  fontWeight: privilegePage === pNum ? 700 : 400 
                                }}
                              >
                                {pNum}
                              </button>
                            );
                          }
                          if (pNum === privilegePage - 3 || pNum === privilegePage + 3) {
                            return <span key={pNum} style={{ padding: '0 0.2rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>...</span>;
                          }
                          return null;
                        })}

                        <button
                          onClick={() => setPrivilegePage(prev => Math.min(totalPages, prev + 1))}
                          disabled={privilegePage === totalPages}
                          className="btn btn-secondary"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                        >
                          <span>Next</span>
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
            </div>
          )}

          {/* Tab 6: Audit History */}
          {activeTab === 'AUDIT' && false && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Security Configuration Logs</h3>
                <TableExportControl
                  filename={`${entity.id}_audit_trail`}
                  data={auditData}
                  totalCount={auditData?.length || 0}
                  columns={[
                    { key: 'timestamp', label: 'Timestamp', getValue: (l: any) => l.timestamp ? new Date(l.timestamp).toLocaleString() : '' },
                    { key: 'username', label: 'Operator' },
                    { key: 'businessObject', label: 'Object' },
                    { key: 'action', label: 'Action', getValue: (l: any) => l.action || l.event || 'UPDATE' },
                    { key: 'details', label: 'Details' }
                  ]}
                />
              </div>

              <div className="table-container" style={{ margin: 0 }}>
                <table className="enterprise-table" style={{ fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Operator</th>
                      <th>Object</th>
                      <th>Action</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditData && auditData.length > 0 ? (
                      auditData.map((log: any) => (
                        <tr key={log.id}>
                          <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td style={{ fontWeight: 600 }}><code>{log.username}</code></td>
                          <td style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.businessObject}</td>
                          <td>
                            <span className={`badge ${log.action === 'ROLE_REVOKE' ? 'badge-inactive' : log.action === 'ROLE_ASSIGN' ? 'badge-active' : 'badge-gold'}`}>
                              {log.action || log.event || 'UPDATE'}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: '200px' }}>{log.details}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                          No recent audit log entries captured for this entity.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}



        </div>

      </div>

    </div>
  );
}

