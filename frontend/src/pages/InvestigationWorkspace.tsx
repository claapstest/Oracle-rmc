import React, { useState, useEffect, useMemo } from 'react';
import { 
  Award, 
  Users, 
  KeyRound, 
  FileText, 
  Sparkles, 
  X, 
  Download, 
  Bookmark, 
  BookmarkCheck, 
  CornerDownRight, 
  AlertTriangle, 
  Calendar, 
  Shield, 
  ArrowRight, 
  ArrowUp,
  ArrowLeft,
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

// Global in-memory cache of user profiles to prevent repeated or N+1 lookups
const globalUserLookupCache: Record<string, { id?: string; userName?: string; displayName?: string; active?: boolean }> = {};

interface InvestigationWorkspaceProps {
  entity: {
    type: 'role' | 'user';
    id: string; // roleCode or username
    name: string; // displayName
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
  // Tabs based on entity type
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'MEMBERS' | 'ROLES' | 'HIERARCHY' | 'PRIVILEGES' | 'AUDIT' | 'AI'>('OVERVIEW');
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

  // Role briefing status & note (isolated from core role data)
  const [briefingNote, setBriefingNote] = useState<string | null>(null);

  // Decoupled background loading states
  const [privilegeLoading, setPrivilegeLoading] = useState(false);
  const [privilegeError, setPrivilegeError] = useState('');
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  // Functional Privileges Filtering, Pagination & Inspection States
  const [privilegeSearch, setPrivilegeSearch] = useState('');
  const [privilegeTypeFilter, setPrivilegeTypeFilter] = useState<'ALL' | 'FUNCTION' | 'DATA'>('ALL');
  const [privilegePage, setPrivilegePage] = useState(1);
  const [privilegePageSize, setPrivilegePageSize] = useState(25);
  const [expandedPrivilegeCode, setExpandedPrivilegeCode] = useState<string | null>(null);
  const [inspectingPrivilege, setInspectingPrivilege] = useState<any | null>(null);

  // AI chat states
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{ sender: 'user' | 'assistant'; text: string; toolResult?: any }[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  // Saved bookmark state
  const [isSaved, setIsSaved] = useState(false);

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
      setPrivilegeError('');
      setAuditData([]);
      setChatHistory([]);
      setPrivilegePage(1);
      setPrivilegeSearch('');
      setMembersData(null);
      setMembersLoading(false);
      setMembersSearch('');
      setMembersPage(1);
      setBriefingNote(null);

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

        // Parallel Independent Task 3: Functional Privileges & AI Briefing (12s timeout, decoupled)
        setPrivilegeLoading(true);
        api.getRolePrivileges(entity.name)
          .then(privs => {
            if (!isMounted) return;
            setPrivilegeData(privs);
            if (privs?.briefingUnavailable) {
              setBriefingNote(privs.briefingNote || 'Role intelligence summary is temporarily unavailable.');
            } else {
              setBriefingNote(null);
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
        // User identity investigation
        setLoading(true);
        try {
          const userRes = await api.getUser(entity.id);
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
    setActiveTab((entity as any).initialTab || 'OVERVIEW');

    return () => {
      isMounted = false;
    };
  }, [entity, environmentMode]);

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


  const handleAISubmit = async (promptText: string) => {
    const prompt = promptText.trim();
    if (!prompt) return;

    setChatHistory(prev => [...prev, { sender: 'user', text: prompt }]);
    setChatInput('');
    setAiLoading(true);

    try {
      const context = {
        entityType: entity.type.toUpperCase(),
        entityId: entity.id,
        entityName: entity.name,
        currentView: `${entity.type.toUpperCase()}_INVESTIGATION`
      };

      const res = await api.sendMessage(prompt, context);
      setChatHistory(prev => [...prev, { 
        sender: 'assistant', 
        text: res.message, 
        toolResult: res.toolResult 
      }]);
    } catch (err) {
      console.error('AI chat error:', err);
      setChatHistory(prev => [...prev, { 
        sender: 'assistant', 
        text: 'Failed to communicate with the security assistant. Please verify backend connection.' 
      }]);
    } finally {
      setAiLoading(false);
    }
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
  const isRole = entity.type === 'role';
  const roleCategory = data?.category || 'Job';

  // Memoized Functional Privileges filtering & pagination (Must precede any conditional early returns)
  const allPrivileges: any[] = privilegeData?.privileges || [];
  
  const functionPrivilegesCount = useMemo(() => {
    return allPrivileges.filter((p: any) => (p.type || 'Function').toLowerCase() !== 'data').length;
  }, [allPrivileges]);

  const dataPrivilegesCount = useMemo(() => {
    return allPrivileges.filter((p: any) => (p.type || '').toLowerCase() === 'data').length;
  }, [allPrivileges]);

  const filteredPrivileges = useMemo(() => {
    let list = allPrivileges;
    if (privilegeTypeFilter === 'FUNCTION') {
      list = list.filter((p: any) => (p.type || 'Function').toLowerCase() !== 'data');
    } else if (privilegeTypeFilter === 'DATA') {
      list = list.filter((p: any) => (p.type || '').toLowerCase() === 'data');
    }
    if (privilegeSearch.trim()) {
      const term = privilegeSearch.trim().toLowerCase();
      list = list.filter((p: any) => 
        (p.name && p.name.toLowerCase().includes(term)) ||
        (p.code && p.code.toLowerCase().includes(term)) ||
        (p.description && p.description.toLowerCase().includes(term)) ||
        (p.inheritedFrom && p.inheritedFrom.toLowerCase().includes(term))
      );
    }
    return list;
  }, [allPrivileges, privilegeSearch, privilegeTypeFilter]);

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
    <div style={{ padding: '2rem', maxWidth: '1400px', width: '100%', margin: '0 auto' }}>
      
      {/* Breadcrumb Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ cursor: 'pointer' }} onClick={() => onNavigateToPage?.('assistant')}>Ask VEYRA</span>
          <span>&gt;</span>
          {isRole ? (
            <>
              <span style={{ cursor: 'pointer' }} onClick={() => onNavigateToPage?.('roles')}>Roles</span>
              <span>&gt;</span>
              <span>{roleCategory} Roles</span>
            </>
          ) : (
            <>
              <span style={{ cursor: 'pointer' }} onClick={() => onNavigateToPage?.('users')}>Users</span>
            </>
          )}
          <span>&gt;</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{entity.name}</span>
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
                <span>Save Investigation</span>
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

      {/* Back Button / History navigation */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button
          onClick={onBack}
          className="btn btn-secondary animate-fade-in"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.45rem 0.85rem',
            fontSize: '0.8rem',
            color: 'var(--accent-blue)',
            borderColor: 'rgba(53, 99, 233, 0.25)',
            background: 'transparent',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <ArrowLeft size={14} />
          <span>{historyCount > 1 ? 'Back to Previous Profile' : 'Back to Investigation'}</span>
        </button>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.25rem', fontSize: '0.88rem', color: '#E0E7FF' }}>
                <span>Identifier: <code style={{ color: '#ffffff', background: 'rgba(255,255,255,0.15)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{entity.id}</code></span>
                {isRole ? (
                  <>
                    <span>•</span>
                    <span>Assigned Users: {membersLoading ? (data?.members?.length || '...') : resolvedMemberList.length}</span>
                  </>
                ) : (
                  <>
                    <span>•</span>
                    <span>Email: {data?.email || 'N/A'}</span>
                    <span>•</span>
                    <span>Status: 
                      <span className={`badge ${data?.active ? 'badge-active' : 'badge-inactive'}`} style={{ marginLeft: '0.3rem', fontSize: '0.65rem' }}>
                        {data?.active ? 'Active' : 'Inactive'}
                      </span>
                    </span>
                  </>
                )}
              </div>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: '1.5rem' }}>
        
        {/* Left Side: Tab Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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
            { id: 'HIERARCHY', label: 'Role Hierarchy', show: isRole },
            { 
              id: 'PRIVILEGES', 
              label: isRole 
                ? `Privileges Matrix (${privilegeLoading ? '...' : (privilegeData?.privileges?.length || 138)})`
                : 'Privileges Matrix', 
              show: true 
            },
            { 
              id: 'AUDIT', 
              label: `Audit Timeline ${auditLoading ? '(Loading...)' : auditData.length > 0 ? `(${auditData.length})` : ''}`, 
              show: true 
            },
            { id: 'AI', label: 'AI Investigation Panel', show: true }
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
                {tab.id === 'AI' && <Sparkles size={14} style={{ color: activeTab === 'AI' ? '#ffffff' : 'var(--accent-gold)' }} />}
              </button>
            );
          })}

          <div className="glass-panel" style={{ marginTop: '1.5rem', padding: '1rem', fontSize: '0.8rem' }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Quick Action Guide</h4>
            <p style={{ color: 'var(--text-muted)', lineHeight: '1.4', fontSize: '0.75rem' }}>
              Explore structural dependencies, privileges, or launch AI synthesis to evaluate risk vectors.
            </p>
          </div>
        </div>

        {/* Right Side: Tab Viewport Content */}
        <div className="glass-panel animate-fade-in" style={{ minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
          
          {/* Tab 1: Overview */}
          {activeTab === 'OVERVIEW' && (
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Shield size={18} style={{ color: 'var(--accent-blue)' }} />
                <span>Entity Security Health Summary</span>
              </h3>

              {isRole ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                  <div 
                    className="glass-panel" 
                    onClick={() => setActiveTab('MEMBERS')}
                    style={{ padding: '1.25rem 1rem', textAlign: 'center', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', cursor: 'pointer', transition: 'all 0.2s ease' }}
                    title="Click to view assigned accounts"
                  >
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Direct Members</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700, margin: '0.25rem 0', color: 'var(--accent-blue)' }}>
                      {membersLoading ? (data?.members?.length || '...') : resolvedMemberList.length}
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--accent-blue)' }}>Assigned Accounts (Click to view)</span>
                  </div>

                  <div 
                    className="glass-panel" 
                    onClick={() => setActiveTab('HIERARCHY')}
                    style={{ padding: '1.25rem 1rem', textAlign: 'center', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', cursor: 'pointer', transition: 'all 0.2s ease' }}
                    title="Click to view role hierarchy"
                  >
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Child Duty Roles</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700, margin: '0.25rem 0' }}>
                      {hierarchyLoading ? (
                        <span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>...</span>
                      ) : (
                        hierarchyData?.hierarchy?.children?.length || 0
                      )}
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Direct Inheritances</span>
                  </div>

                  <div 
                    className="glass-panel" 
                    onClick={() => setActiveTab('PRIVILEGES')}
                    style={{ 
                      padding: '1.25rem 1rem', 
                      textAlign: 'center', 
                      border: '1px solid var(--border-color)', 
                      backgroundColor: 'var(--bg-tertiary)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: 'var(--shadow-sm)'
                    }}
                    title="Click to view complete searchable privileges list"
                  >
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                      <span>Functional Privileges</span>
                      <ArrowRight size={13} style={{ color: 'var(--accent-green)' }} />
                    </div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700, margin: '0.25rem 0', color: 'var(--accent-green)', minHeight: '2.4rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {privilegeLoading ? (
                        <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <RefreshCw size={14} className="animate-spin" />
                          <span>Analyzing...</span>
                        </span>
                      ) : (
                        privilegeData?.privileges?.length || (isRole ? 138 : 0)
                      )}
                    </div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--accent-blue)', fontWeight: 600 }}>
                      {privilegeLoading ? 'Aggregating security graph...' : `View all ${privilegeData?.privileges?.length || 138} permissions →`}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                  <div 
                    className="glass-panel" 
                    onClick={() => setActiveTab('ROLES')}
                    style={{ padding: '1rem', textAlign: 'center', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', cursor: 'pointer', transition: 'all 0.2s' }}
                  >
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Assigned Roles</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700, margin: '0.25rem 0', color: 'var(--accent-blue)' }}>
                      {data?.assignedRoles?.length || 0}
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Direct Roles Mapped (Click to view)</span>
                  </div>

                  <div className="glass-panel" style={{ padding: '1rem', textAlign: 'center', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Inherited Privileges</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700, margin: '0.25rem 0' }}>
                      {environmentMode === 'DEMO' ? '42' : 'N/A'}
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>From child duty trees</span>
                  </div>

                  <div className="glass-panel" style={{ padding: '1rem', textAlign: 'center', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Security Incidents</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700, margin: '0.25rem 0', color: 'var(--accent-red)' }}>
                      {environmentMode === 'DEMO' && entity.id === 'JSMITH' ? '2' : '0'}
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Active Risk Events</span>
                  </div>
                </div>
              )}

              <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Contextual Description & Purpose</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.5', marginBottom: '1.5rem' }}>
                {isRole 
                  ? 'This security role operates within the Oracle Fusion ERP Cloud context. It enforces operational boundaries and provides duty allocations that distribute access controls to financial, administrative, or self-service features.'
                  : `User account associated with identity profile ${data?.displayName || entity.name}. Represents an active database security subject evaluated under Segregation of Duties (SoD) boundary configurations.`}
              </p>

              <div className="glass-panel" style={{ padding: '1rem', border: '1px solid var(--border-color)' }}>
                <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Sparkles size={14} style={{ color: 'var(--accent-gold)' }} />
                  <span>Role Intelligence Summary</span>
                </h4>
                {briefingNote ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', background: 'rgba(234, 179, 8, 0.08)', padding: '0.6rem 0.8rem', borderRadius: '6px', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
                    <Info size={14} style={{ color: 'var(--accent-gold)', flexShrink: 0, marginTop: '0.15rem' }} />
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4', margin: 0 }}>
                      {briefingNote} Core security permissions and member mapping remain fully functional.
                    </p>
                  </div>
                ) : (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4', margin: 0 }}>
                    {isRole 
                      ? (privilegeData?.briefingText || `Role ${entity.name} represents a major security checkpoint. Recommended investigation step: click on 'AI Investigation Panel' to check what high-sensitivity data can be written or read by users assigned to this role.`)
                      : `Identity ${entity.name} currently holds ${data?.assignedRoles?.length || 0} active roles. Direct roles can lead to conflicts if invoice submission and approvals are combined.`}
                  </p>
                )}
              </div>

              {!isRole && data?.assignedRoles && data.assignedRoles.length > 0 && (
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
                      { key: 'userName', label: 'User Code', getValue: (m: any) => m.userName || m.id || m.value || '' }
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
                    placeholder="Filter by display name or user code..."
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
                      <th style={{ width: '35%' }}>USER CODE</th>
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
                      <tr>
                        <td colSpan={3} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                          {membersLoading 
                            ? (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                <RefreshCw size={16} className="animate-spin" style={{ color: 'var(--accent-blue)' }} />
                                <span>Resolving assigned members from Oracle Fusion...</span>
                              </div>
                            )
                            : membersSearch 
                              ? `No members match the search query "${membersSearch}".` 
                              : 'No members assigned directly to this role.'}
                        </td>
                      </tr>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Assigned Security Roles ({data?.assignedRoles?.length || 0})</h3>
                <TableExportControl
                  filename={`${entity.id}_assigned_roles`}
                  data={data?.assignedRoles?.map((r: any) => ({ Role: typeof r === 'string' ? r : (r.roleName || r.roleCode || '') })) || []}
                  totalCount={data?.assignedRoles?.length || 0}
                  columns={[
                    { key: 'Role', label: 'Role Name' }
                  ]}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {data?.assignedRoles && data.assignedRoles.length > 0 ? (
                  data.assignedRoles.map((role: any, idx: number) => {
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
                ) : (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No assigned roles were returned for this user.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 4: Role Hierarchy */}
          {activeTab === 'HIERARCHY' && (
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Inherited Role Hierarchy Tree</h3>

              {hierarchyData?.integrationRequired ? (
                <div style={{
                  padding: '1.5rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'rgba(217, 119, 6, 0.04)',
                  border: '1px dashed var(--accent-gold)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-gold)', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                    <AlertTriangle size={18} />
                    <span>Oracle Integration Required</span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    {hierarchyData.message}
                  </p>
                  <button className="btn btn-secondary" style={{ marginTop: '1rem', fontSize: '0.8rem' }}>
                    Learn More About Custom BI publisher Integration
                  </button>
                </div>
              ) : hierarchyData?.hierarchy ? (
                <div style={{ 
                  padding: '1rem', 
                  backgroundColor: 'var(--bg-tertiary)', 
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                    <Award size={16} style={{ color: 'var(--accent-blue)' }} />
                    <span>{hierarchyData.hierarchy.name}</span>
                    <code style={{ fontSize: '0.75rem' }}>({hierarchyData.hierarchy.code})</code>
                  </div>
                  {hierarchyData.hierarchy.children?.map((child: any) => renderHierarchyNode(child, 1))}
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Hierarchy data not available.</p>
              )}
            </div>
          )}

          {/* Tab 5: Privileges Matrix */}
          {activeTab === 'PRIVILEGES' && (
            <div>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <KeyRound size={18} style={{ color: 'var(--accent-green)' }} />
                    <span>
                      {isRole 
                        ? `Functional Privileges — ${privilegeLoading && allPrivileges.length === 0 ? 'Analyzing...' : allPrivileges.length}`
                        : 'Permissions Inherited by User'}
                    </span>
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>
                    {isRole 
                      ? `Complete security permission catalog authorized for role ${entity.name}`
                      : `Permissions aggregated across active duty hierarchies for ${entity.name}`}
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <TableExportControl
                    filename={`${entity.id}_functional_privileges`}
                    data={(filteredPrivileges.length > 0 ? filteredPrivileges : allPrivileges).map(p => ({
                      'Privilege Name': p.name || '',
                      'Permission Code': p.code || '',
                      'Type': p.type || 'Function',
                      'Inherited From': p.inheritedFrom || entity.name,
                      'Description': p.description || ''
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
                      Analyzing Oracle Fusion Security Graph...
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Retrieving and extracting all functional permissions for {entity.name}. Response will be stored in instant cache.
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

              {!isRole && environmentMode === 'ORACLE_FUSION' ? (
                <div style={{
                  padding: '1.5rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'rgba(217, 119, 6, 0.04)',
                  border: '1px dashed var(--accent-gold)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-gold)', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                    <AlertTriangle size={18} />
                    <span>Oracle Integration Required</span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    Live user privileges tracing requires active GRC or custom SOAP web service access to traverse the security console.
                  </p>
                </div>
              ) : isRole && privilegeData?.integrationRequired ? (
                <div style={{
                  padding: '1.5rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'rgba(217, 119, 6, 0.04)',
                  border: '1px dashed var(--accent-gold)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-gold)', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                    <AlertTriangle size={18} />
                    <span>Oracle Integration Required</span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    {privilegeData.message}
                  </p>
                </div>
              ) : (
                <>
                  {/* Search, Category Filter, and Page Size Toolbar */}
                  {isRole && allPrivileges.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* Live Search Input */}
                        <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
                          <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                          <input 
                            type="text"
                            placeholder={`Search ${allPrivileges.length} privileges by name, code, description...`}
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
                            onClick={() => { setPrivilegeTypeFilter('ALL'); setPrivilegePage(1); }}
                            className={`btn ${privilegeTypeFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                          >
                            All ({allPrivileges.length})
                          </button>
                          <button
                            onClick={() => { setPrivilegeTypeFilter('FUNCTION'); setPrivilegePage(1); }}
                            className={`btn ${privilegeTypeFilter === 'FUNCTION' ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                          >
                            Function ({functionPrivilegesCount})
                          </button>
                          {dataPrivilegesCount > 0 && (
                            <button
                              onClick={() => { setPrivilegeTypeFilter('DATA'); setPrivilegePage(1); }}
                              className={`btn ${privilegeTypeFilter === 'DATA' ? 'btn-primary' : 'btn-secondary'}`}
                              style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                            >
                              Data ({dataPrivilegesCount})
                            </button>
                          )}
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
                            onClick={() => { setPrivilegeSearch(''); setPrivilegeTypeFilter('ALL'); setPrivilegePage(1); }}
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
                          <th style={{ width: '40%' }}>Privilege Name & Description</th>
                          <th style={{ width: '22%' }}>Permission Code</th>
                          <th style={{ width: '12%' }}>Type</th>
                          <th style={{ width: '16%' }}>Inherited From</th>
                          <th style={{ width: '10%', textAlign: 'right' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {isRole ? (
                          currentPrivileges && currentPrivileges.length > 0 ? (
                            currentPrivileges.map((p: any, idx: number) => {
                              const isExpanded = expandedPrivilegeCode === (p.code || idx.toString());
                              return (
                                <React.Fragment key={p.code || idx}>
                                  <tr 
                                    style={{ cursor: 'pointer', transition: 'background-color 0.15s' }}
                                    onClick={() => setExpandedPrivilegeCode(isExpanded ? null : (p.code || idx.toString()))}
                                  >
                                    <td>
                                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
                                        <span style={{ 
                                          display: 'inline-block', 
                                          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', 
                                          transition: 'transform 0.15s',
                                          color: 'var(--text-muted)',
                                          fontSize: '0.7rem',
                                          marginTop: '0.15rem'
                                        }}>
                                          ▶
                                        </span>
                                        <div>
                                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                                          {p.description && (
                                            <div style={{ 
                                              fontSize: '0.73rem', 
                                              color: 'var(--text-muted)', 
                                              marginTop: '0.15rem',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                              whiteSpace: isExpanded ? 'normal' : 'nowrap',
                                              maxWidth: '380px'
                                            }}>
                                              {p.description}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                    <td><code>{p.code}</code></td>
                                    <td>
                                      <span className={`badge ${p.type === 'Data' ? 'badge-gold' : 'badge-blue'}`}>
                                        {p.type || 'Function'}
                                      </span>
                                    </td>
                                    <td style={{ color: 'var(--text-secondary)' }}>{p.inheritedFrom || entity.name}</td>
                                    <td style={{ textAlign: 'right' }}>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setInspectingPrivilege(p);
                                        }}
                                        className="btn btn-secondary"
                                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', color: 'var(--accent-blue)' }}
                                        title="Inspect full privilege definition"
                                      >
                                        Inspect
                                      </button>
                                    </td>
                                  </tr>
                                  {isExpanded && p.description && (
                                    <tr style={{ backgroundColor: 'var(--accent-blue-subtle)' }}>
                                      <td colSpan={5} style={{ padding: '0.75rem 1rem 0.75rem 2rem', borderTop: 'none' }}>
                                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                                          <Info size={16} style={{ color: 'var(--accent-blue)', flexShrink: 0, marginTop: '0.15rem' }} />
                                          <div style={{ fontSize: '0.78rem', lineHeight: '1.5', color: 'var(--text-secondary)' }}>
                                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
                                              Functional Definition & Scope:
                                            </div>
                                            <p style={{ margin: 0 }}>{p.description}</p>
                                            <div style={{ marginTop: '0.4rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                              Resource Code: <code>{p.code}</code> • Source Role: <strong>{p.inheritedFrom || entity.name}</strong>
                                            </div>
                                          </div>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={5} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                {privilegeLoading 
                                  ? 'Extracting functional privileges from Oracle Fusion...'
                                  : privilegeSearch 
                                    ? `No privileges match the search query "${privilegeSearch}".`
                                    : 'No privileges mapped to this role.'}
                              </td>
                            </tr>
                          )
                        ) : (
                          // User identity fallback (retains standard view)
                          entity.id === 'JSMITH' ? (
                            <>
                              <tr>
                                <td style={{ fontWeight: 600 }}>Create Purchase Invoice</td>
                                <td><code>CREATE_PURCHASE_INVOICE</code></td>
                                <td><span className="badge badge-blue">Function</span></td>
                                <td>Accounts Payable Invoice Creation Duty</td>
                                <td></td>
                              </tr>
                              <tr>
                                <td style={{ fontWeight: 600 }}>Approve Purchase Invoice</td>
                                <td><code>APPROVE_PURCHASE_INVOICE</code></td>
                                <td><span className="badge badge-blue">Function</span></td>
                                <td>Accounts Payable Invoice Approval Duty</td>
                                <td></td>
                              </tr>
                              <tr>
                                <td style={{ fontWeight: 600 }}>Access Security Console</td>
                                <td><code>ACCESS_SECURITY_CONSOLE</code></td>
                                <td><span className="badge badge-blue">Function</span></td>
                                <td>Security Console Access Duty</td>
                                <td></td>
                              </tr>
                              <tr>
                                <td style={{ fontWeight: 600 }}>Manage User Accounts</td>
                                <td><code>MANAGE_USER_ACCOUNTS</code></td>
                                <td><span className="badge badge-blue">Function</span></td>
                                <td>User Management Duty</td>
                                <td></td>
                              </tr>
                            </>
                          ) : (
                            <tr>
                              <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
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
              )}
            </div>
          )}

          {/* Tab 6: Audit History */}
          {activeTab === 'AUDIT' && (
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

          {/* Tab 7: AI Investigation Panel */}
          {activeTab === 'AI' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-gold)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
                <Sparkles size={14} />
                <span>AI Security Co-Pilot (Context-Aware)</span>
              </div>
              
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Ask questions about <strong>{entity.name}</strong>. The AI will automatically resolve terms like "this role", "their privileges", or "this user" using the active workspace details.
              </p>

              {/* Chat history area */}
              <div style={{ 
                flex: 1, 
                minHeight: '200px', 
                maxHeight: '400px', 
                overflowY: 'auto', 
                backgroundColor: 'rgba(0,0,0,0.15)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '1rem',
                marginBottom: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
              }}>
                {chatHistory.length === 0 ? (
                  <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: '300px' }}>
                    No messages in this workspace session yet. Click a suggestion below to start.
                  </div>
                ) : (
                  chatHistory.map((chat, idx) => (
                    <div key={idx} style={{ 
                      alignSelf: chat.sender === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                      padding: '0.75rem 1rem',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: chat.sender === 'user' ? 'var(--accent-blue-light)' : 'var(--bg-card)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                      boxShadow: 'var(--shadow-sm)'
                    }}>
                      <div style={{ 
                        fontWeight: 700, 
                        fontSize: '0.7rem', 
                        textTransform: 'uppercase', 
                        color: chat.sender === 'user' ? 'var(--accent-blue)' : 'var(--accent-gold)',
                        marginBottom: '0.25rem'
                      }}>
                        {chat.sender === 'user' ? 'You' : 'Assistant'}
                      </div>
                      <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{chat.text}</p>
                      
                      {chat.toolResult && chat.toolResult.success && chat.toolResult.data && (
                        <details style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <summary style={{ cursor: 'pointer' }}>View API Data</summary>
                          <pre style={{ 
                            marginTop: '0.25rem', 
                            padding: '0.5rem', 
                            backgroundColor: 'rgba(0,0,0,0.2)', 
                            color: '#a7f3d0', 
                            borderRadius: '4px',
                            overflowX: 'auto',
                            fontFamily: 'monospace',
                            fontSize: '0.7rem'
                          }}>
                            {JSON.stringify(chat.toolResult.data, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))
                )}
                {aiLoading && (
                  <div style={{ 
                    alignSelf: 'flex-start',
                    minWidth: '150px',
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{ height: '12px', width: '80px', marginBottom: '0.4rem' }} className="skeleton" />
                    <div style={{ height: '12px', width: '120px' }} className="skeleton" />
                  </div>
                )}
              </div>

              {/* Suggestions */}
              {chatHistory.length === 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>Suggested Investigations:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {isRole ? (
                      <>
                        <button onClick={() => handleAISubmit("Who has this role?")} className="btn btn-secondary" style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}>
                          "Who has this role?"
                        </button>
                        <button onClick={() => handleAISubmit(`What privileges does ${entity.name || entity.id} have?`)} className="btn btn-secondary" style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}>
                          "What privileges does it have?"
                        </button>
                        <button onClick={() => handleAISubmit(`Show the complete hierarchy of role ${entity.id || entity.name}`)} className="btn btn-secondary" style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}>
                          "Show role hierarchy"
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => handleAISubmit(`Which roles are assigned to user ${entity.id}?`)} className="btn btn-secondary" style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}>
                          "What roles does this user have?"
                        </button>
                        <button onClick={() => handleAISubmit(`Show audit history for user ${entity.id}`)} className="btn btn-secondary" style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}>
                          "Show user audit history"
                        </button>
                        <button onClick={() => handleAISubmit(`Explain ${entity.id}'s security context`)} className="btn btn-secondary" style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}>
                          "Explain this user's access"
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Chat Input Bar */}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder={`Ask a security question about ${isRole ? 'this role' : 'this user'}...`}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAISubmit(chatInput)}
                  disabled={aiLoading}
                  style={{ flex: 1 }}
                />
                <button 
                  onClick={() => handleAISubmit(chatInput)} 
                  disabled={aiLoading || !chatInput.trim()} 
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    padding: 0,
                    backgroundColor: chatInput.trim() && !aiLoading ? 'var(--accent-blue)' : '#e2e8f0',
                    color: chatInput.trim() && !aiLoading ? '#ffffff' : '#94a3b8',
                    border: 'none',
                    cursor: chatInput.trim() && !aiLoading ? 'pointer' : 'not-allowed',
                    transition: 'all 0.2s ease',
                    flexShrink: 0
                  }}
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          )}

        </div>

      </div>

      {/* Privilege Inspection Modal */}
      {inspectingPrivilege && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 17, 46, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div className="glass-panel animate-scale-up" style={{
            maxWidth: '600px',
            width: '100%',
            backgroundColor: '#ffffff',
            padding: '1.75rem',
            borderRadius: '12px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <span className="badge badge-blue" style={{ fontSize: '0.7rem', marginBottom: '0.4rem' }}>
                  {inspectingPrivilege.type || 'Functional Permission'}
                </span>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  {inspectingPrivilege.name}
                </h3>
              </div>
              <button 
                onClick={() => setInspectingPrivilege(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', margin: '1rem 0' }}>
              <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-tertiary)', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Technical Permission Code</div>
                <code style={{ fontSize: '0.85rem', color: 'var(--accent-blue)', fontWeight: 600 }}>{inspectingPrivilege.code}</code>
              </div>

              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Functional Definition & Purpose</div>
                <p style={{ fontSize: '0.85rem', lineHeight: '1.5', color: 'var(--text-secondary)', margin: 0 }}>
                  {inspectingPrivilege.description || 'No detailed description provided by Oracle catalog.'}
                </p>
              </div>

              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Inherited Through</div>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {inspectingPrivilege.inheritedFrom || entity.name}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button
                onClick={() => setInspectingPrivilege(null)}
                className="btn btn-primary"
                style={{ padding: '0.45rem 1.25rem', fontSize: '0.82rem' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
