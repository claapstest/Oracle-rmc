import React, { useEffect, useState, useMemo, useRef } from 'react';
import { 
  FileSpreadsheet, 
  Shield, 
  FileClock, 
  ShieldAlert, 
  Search, 
  Filter, 
  RefreshCw, 
  Layers, 
  Calendar, 
  AlertCircle, 
  UserCheck, 
  CheckCircle2, 
  ArrowRight,
  ArrowLeft,
  GitFork,
  ChevronLeft,
  ChevronRight,
  Database,
  Play,
  Clock,
  Info,
  Activity,
  ShieldCheck,
  Check,
  Scale,
  FileText,
  Eye,
  X,
  User,
  Users,
  Sliders,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  FolderTree,
  Key,
  ExternalLink
} from 'lucide-react';
import { api } from '../services/api';
import { EnterpriseExportControl } from '../components/EnterpriseExportControl';
import { ReportSelectorDropdown } from '../components/ReportSelectorDropdown';
import ReportsList from '../components/ReportsList';
import { formatControlTypeName, isAccessControl, isTransactionControl } from '../utils/controlTypeMapping';

interface ReportsProps {
  environmentMode?: string;
  canGenerate?: boolean;
  onInvestigateUser?: (userId: string, displayName: string) => void;
  onInspectRole?: (roleCode: string, displayName: string) => void;
}

type ReportSectionId = 'RISK' | 'SECURITY' | 'AUDIT';
type ReportId = 
  | 'CONTROL_SUMMARY'
  | 'INCIDENTS_DETAILED'
  | 'USER_ROLE_MAPPING' 
  | 'ROLE_HIERARCHY' 
  | 'USER_ACCESS'
  | 'AUDIT_HISTORY';

interface ReportMeta {
  id: ReportId;
  section: ReportSectionId;
  title: string;
  subtitle: string;
  badge: string;
  icon: any;
}

const REPORT_DEFINITIONS: ReportMeta[] = [
  {
    id: 'CONTROL_SUMMARY',
    section: 'RISK',
    title: 'Control Summary',
    subtitle: 'Enterprise-wide overview of Oracle Fusion Advanced Controls and incident exposure.',
    badge: 'Risk Management',
    icon: Shield
  },
  {
    id: 'INCIDENTS_DETAILED',
    section: 'RISK',
    title: 'Incidents Detailed',
    subtitle: 'Detailed continuous monitoring incidents and segregation-of-duties conflicts.',
    badge: 'Risk Management',
    icon: ShieldAlert
  },
  {
    id: 'USER_ROLE_MAPPING',
    section: 'SECURITY',
    title: 'User Role Mapping',
    subtitle: 'Detailed normalized mappings of corporate users to assigned security roles and duty entitlements.',
    badge: 'Security',
    icon: UserCheck
  },
  {
    id: 'ROLE_HIERARCHY',
    section: 'SECURITY',
    title: 'Role Hierarchy',
    subtitle: 'Authoritative parent-child duty role inheritance trees and grant relationships.',
    badge: 'Security',
    icon: GitFork
  },
  {
    id: 'USER_ACCESS',
    section: 'SECURITY',
    title: 'User Access Report',
    subtitle: 'Complete Fusion user access, role and organizational information.',
    badge: 'Security',
    icon: Users
  },
  {
    id: 'AUDIT_HISTORY',
    section: 'AUDIT',
    title: 'Audit History',
    subtitle: 'Comprehensive audit trail of security configuration events, privilege assignments, and system modifications.',
    badge: 'Audit',
    icon: FileClock
  }
];

// Domain grouping for the report selector (DOMAIN -> REPORT hierarchy)
const REPORT_DOMAIN_LABELS: Record<ReportSectionId, string> = {
  RISK: 'Risk Management Reports',
  SECURITY: 'Security Reports',
  AUDIT: 'Audit Reports'
};

const REPORT_DOMAIN_ORDER = [
  REPORT_DOMAIN_LABELS.RISK,
  REPORT_DOMAIN_LABELS.SECURITY,
  REPORT_DOMAIN_LABELS.AUDIT
];

function reportParamFromId(id: ReportId): string {
  return id.toLowerCase().replace(/_/g, '-');
}

// Display names used inside the report selector dropdown only.
// The underlying REPORT_DEFINITIONS remain the single source of truth.
const REPORT_SELECTOR_NAMES: Record<ReportId, string> = {
  CONTROL_SUMMARY: 'Control Summary',
  INCIDENTS_DETAILED: 'Incidents Detailed',
  USER_ROLE_MAPPING: 'User Role Mapping Report',
  ROLE_HIERARCHY: 'Role Hierarchy Report',
  USER_ACCESS: 'User Access Report',
  AUDIT_HISTORY: 'Audit History Report'
};

export default function Reports({ environmentMode = 'DEMO', canGenerate = false, onInvestigateUser, onInspectRole }: ReportsProps) {
  // Active Report Selection - intentionally null until the user picks a report
  const [activeReportId, setActiveReportId] = useState<ReportId | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = (params.get('report') || '').toLowerCase().replace(/_/g, '-');
      const match = REPORT_DEFINITIONS.find(r => reportParamFromId(r.id) === raw);
      if (match) return match.id;
    } catch (_) {
      /* ignore invalid URL state */
    }
    return null;
  });

  // Shared Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // -------------------------------------------------------------
  // 1. CONTROL SUMMARY REPORT STATE
  // -------------------------------------------------------------
  const [controlsSummaryReport, setControlsSummaryReport] = useState<any | null>(null);
  const [controlsData, setControlsData] = useState<any[]>([]);
  const [controlsLoading, setControlsLoading] = useState<boolean>(false);
  const [controlsScanning, setControlsScanning] = useState<boolean>(false);
  const [controlsError, setControlsError] = useState<string>('');
  const [controlsSearch, setControlsSearch] = useState<string>('');
  const [controlsStatusFilter, setControlsStatusFilter] = useState<string>('ALL');
  const [controlsTypeFilter, setControlsTypeFilter] = useState<'ALL' | 'ACCESS' | 'TRANSACTION'>('ALL');
  const [controlsCountsStatusFilter, setControlsCountsStatusFilter] = useState<string>('ALL');
  const [controlsIncidentFilter, setControlsIncidentFilter] = useState<string>('ALL');
  const [probingControlId, setProbingControlId] = useState<string | null>(null);
  const controlsPollingRef = useRef<any>(null);

  // -------------------------------------------------------------
  // 2. INCIDENTS DETAILED REPORT STATE
  // -------------------------------------------------------------
  const [incidentsData, setIncidentsData] = useState<any[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState<boolean>(false);
  const [incidentsError, setIncidentsError] = useState<string>('');
  const [incidentsSearch, setIncidentsSearch] = useState<string>('');
  const [selectedIncidentsControlId, setSelectedIncidentsControlId] = useState<string>('114281');
  const [availableIncidentControls, setAvailableIncidentControls] = useState<any[]>([]);
  const [incidentsStatusFilter, setIncidentsStatusFilter] = useState<string>('ALL');
  const [incidentsStateFilter, setIncidentsStateFilter] = useState<string>('ALL');
  const [incidentsSyncState, setIncidentsSyncState] = useState<{
    cacheStatus?: 'NOT_CACHED' | 'SYNCING' | 'READY' | 'PARTIAL' | 'ERROR';
    fetchedCount?: number;
    totalCount?: number;
    lastSyncedAt?: string;
    message?: string;
  }>({ cacheStatus: 'NOT_CACHED' });
  const [incidentsKpis, setIncidentsKpis] = useState<{
    total?: number;
    openOrActive?: number;
    accepted?: number;
    closedOrResolved?: number;
    status?: string;
  }>({});
  const [selectedIncidentDetail, setSelectedIncidentDetail] = useState<any | null>(null);
  const incidentsPollingRef = useRef<any>(null);

  // -------------------------------------------------------------
  // 3. USER ROLE MAPPING REPORT STATE
  // -------------------------------------------------------------
  const [userRoleData, setUserRoleData] = useState<any[]>([]);
  const [userRoleLoading, setUserRoleLoading] = useState<boolean>(false);
  const [userRoleError, setUserRoleError] = useState<string>('');
  const [urmSearch, setUrmSearch] = useState<string>('');
  const [urmStatusFilter, setUrmStatusFilter] = useState<string>('ALL');
  const [urmCategoryFilter, setUrmCategoryFilter] = useState<string>('ALL');

  // -------------------------------------------------------------
  // 4. ROLE HIERARCHY REPORT STATE
  // -------------------------------------------------------------
  const [hierarchyData, setHierarchyData] = useState<any[]>([]);
  const [hierarchyLoading, setHierarchyLoading] = useState<boolean>(false);
  const [hierarchyError, setHierarchyError] = useState<string>('');
  const [hierarchyIntegrationNotice, setHierarchyIntegrationNotice] = useState<string>('');
  const [rhSearch, setRhSearch] = useState<string>('');
  const [rhCategoryFilter, setRhCategoryFilter] = useState<string>('ALL');
  const [rhViewMode, setRhViewMode] = useState<'TABLE' | 'TREE'>('TABLE');
  const [rhSelectedRoleForTree, setRhSelectedRoleForTree] = useState<string>('');
  const [rhTreeData, setRhTreeData] = useState<any | null>(null);
  const [rhTreeLoading, setRhTreeLoading] = useState<boolean>(false);
  const [rhTreeModalOpen, setRhTreeModalOpen] = useState<boolean>(false);
  const [rhExpandedNodes, setRhExpandedNodes] = useState<Set<string>>(new Set());
  const [rhExpandedPrivileges, setRhExpandedPrivileges] = useState<Set<string>>(new Set());
  const [rhSyncing, setRhSyncing] = useState<boolean>(false);

  // -------------------------------------------------------------
  // 5. AUDIT HISTORY REPORT STATE
  // -------------------------------------------------------------
  const [auditProducts, setAuditProducts] = useState<any[]>([]);
  const [selectedAuditProduct, setSelectedAuditProduct] = useState<string>('hcm');
  const [selectedAuditBO, setSelectedAuditBO] = useState<string>('person');
  const [auditFromDate, setAuditFromDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().split('T')[0];
  });
  const [auditToDate, setAuditToDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [auditUserQuery, setAuditUserQuery] = useState<string>('');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('ALL');
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState<boolean>(false);
  const [auditError, setAuditError] = useState<string>('');
  const [auditDateWarning, setAuditDateWarning] = useState<string>('');

  // -------------------------------------------------------------
  // 6. USER ACCESS REPORT STATE
  // -------------------------------------------------------------
  const [userAccessData, setUserAccessData] = useState<any[]>([]);
  const [userAccessSummary, setUserAccessSummary] = useState<{
    totalUsers: number;
    usersWithRoles: number;
    usersWithoutRoles: number;
    totalRoleAssignments: number;
    activeUsers: number;
    inactiveUsers: number;
  } | null>(null);
  const [userAccessLoading, setUserAccessLoading] = useState<boolean>(false);
  const [userAccessError, setUserAccessError] = useState<string>('');
  const [userAccessSearch, setUserAccessSearch] = useState<string>('');
  const [userAccessStatusFilter, setUserAccessStatusFilter] = useState<string>('ALL');
  const [userAccessBuFilter, setUserAccessBuFilter] = useState<string>('ALL');
  const [userAccessDeptFilter, setUserAccessDeptFilter] = useState<string>('ALL');
  const [userAccessManagerFilter, setUserAccessManagerFilter] = useState<string>('ALL');
  const [userAccessRoleFilter, setUserAccessRoleFilter] = useState<string>('ALL');

  // Cleanup polling intervals on unmount
  useEffect(() => {
    return () => {
      if (controlsPollingRef.current) {
        clearInterval(controlsPollingRef.current);
        controlsPollingRef.current = null;
      }
      if (incidentsPollingRef.current) {
        clearInterval(incidentsPollingRef.current);
        incidentsPollingRef.current = null;
      }
    };
  }, []);

  // Reset pagination when active report changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeReportId]);

  // Single report-selection mechanism for the workspace
  const handleSelectReport = (id: ReportId | null) => {
    setActiveReportId(id);
    try {
      const url = new URL(window.location.href);
      if (id) {
        url.searchParams.set('report', reportParamFromId(id));
      } else {
        url.searchParams.delete('report');
      }
      window.history.replaceState(null, '', url.toString());
    } catch (_) {
      /* URL sync is best-effort; component state remains authoritative */
    }
  };

  // Dropdown options derived from the existing REPORT_DEFINITIONS (no duplication)
  const reportSelectorOptions = useMemo(() => REPORT_DEFINITIONS.map(r => ({
    id: r.id,
    name: REPORT_SELECTOR_NAMES[r.id],
    domain: REPORT_DOMAIN_LABELS[r.section],
    description: r.subtitle,
    icon: r.icon
  })), []);

  // =============================================================
  // DATA LOADERS
  // =============================================================

  // Loader 1: Control Summary Report
  const loadControlsSummary = async (forceRefresh = false, scan = false) => {
    if (forceRefresh || controlsData.length === 0) {
      setControlsLoading(true);
    }
    if (scan) {
      setControlsScanning(true);
    }
    setControlsError('');

    try {
      const res = await api.getControlSummaryReport({ refresh: forceRefresh, scan });
      if (res && res.success) {
        setControlsSummaryReport(res);
        setControlsData(res.controls || []);

        if (res.summaryStatus === 'CALCULATING') {
          setControlsScanning(true);
          if (!controlsPollingRef.current) {
            controlsPollingRef.current = setInterval(async () => {
              try {
                const pollRes = await api.getControlSummaryReport();
                if (pollRes && pollRes.success) {
                  setControlsSummaryReport(pollRes);
                  setControlsData(pollRes.controls || []);
                  if (pollRes.summaryStatus !== 'CALCULATING') {
                    setControlsScanning(false);
                    if (controlsPollingRef.current) {
                      clearInterval(controlsPollingRef.current);
                      controlsPollingRef.current = null;
                    }
                  }
                }
              } catch (pollErr) {
                console.warn('[Control Summary Polling Error]:', pollErr);
              }
            }, 3000);
          }
        } else {
          setControlsScanning(false);
          if (controlsPollingRef.current) {
            clearInterval(controlsPollingRef.current);
            controlsPollingRef.current = null;
          }
        }
      } else {
        setControlsError(res?.message || 'Unable to retrieve controls summary.');
      }
    } catch (err: any) {
      console.error('Failed to load control summary:', err);
      setControlsError(err.message || 'Unable to retrieve advanced controls reporting summary.');
    } finally {
      setControlsLoading(false);
    }
  };

  const probeSingleControl = async (controlId: string) => {
    setProbingControlId(controlId);
    try {
      const res = await api.probeControlIncidentCount(controlId);
      if (res && res.success && res.scan) {
        setControlsData(prev => prev.map(c => {
          if (c.controlId === controlId) {
            const scan = res.scan;
            // Lightweight probe verifies ONLY the total. Status-level breakdown
            // stays null (rendered as "—") until detailed incidents are scanned.
            return {
              ...c,
              totalIncidentCount: scan.totalIncidentCount,
              assignedOrInRemediationCount: scan.totalIncidentCount === 0 ? 0 : null,
              acceptedCount: scan.totalIncidentCount === 0 ? 0 : null,
              closedOrResolvedCount: scan.totalIncidentCount === 0 ? 0 : null,
              countsStatus: scan.totalIncidentCount === 0 ? 'READY' : (scan.totalIncidentCount !== null ? 'PARTIAL' : 'ERROR'),
              lastCalculatedAt: scan.timestamp,
              calculationNotes: scan.totalIncidentCount === 0
                ? '0 incidents confirmed via lightweight query'
                : (scan.totalIncidentCount !== null ? `Total count (${scan.totalIncidentCount.toLocaleString()}) verified via lightweight query; status breakdown not yet calculated` : scan.error)
            };
          }
          return c;
        }));
      }
    } catch (err: any) {
      console.error(`Failed to probe control ${controlId}:`, err);
    } finally {
      setProbingControlId(null);
    }
  };

  // Loader 2: Incidents Detailed Report (Operational & Live)
  const loadRiskIncidents = async (controlId = selectedIncidentsControlId, forceRefresh = false) => {
    setIncidentsLoading(true);
    setIncidentsError('');
    try {
      const res = await api.getRiskIncidents({ controlId, refresh: forceRefresh });
      if (res && res.success) {
        setIncidentsData(res.items || []);
        if (Array.isArray(res.availableControls)) {
          setAvailableIncidentControls(res.availableControls);
        }
        if (res.kpis) {
          setIncidentsKpis(res.kpis);
        }
        setIncidentsSyncState({
          cacheStatus: res.cacheStatus || 'READY',
          fetchedCount: res.fetchedCount,
          totalCount: res.totalCount,
          lastSyncedAt: res.lastSyncedAt,
          message: res.message
        });

        // Polling if background sync is active
        if (res.cacheStatus === 'SYNCING') {
          if (!incidentsPollingRef.current) {
            incidentsPollingRef.current = setInterval(async () => {
              try {
                const pollRes = await api.getRiskIncidents({ controlId });
                if (pollRes && pollRes.success) {
                  setIncidentsData(pollRes.items || []);
                  if (pollRes.kpis) setIncidentsKpis(pollRes.kpis);
                  setIncidentsSyncState({
                    cacheStatus: pollRes.cacheStatus || 'READY',
                    fetchedCount: pollRes.fetchedCount,
                    totalCount: pollRes.totalCount,
                    lastSyncedAt: pollRes.lastSyncedAt,
                    message: pollRes.message
                  });
                  if (pollRes.cacheStatus === 'READY' || pollRes.cacheStatus === 'ERROR') {
                    if (incidentsPollingRef.current) {
                      clearInterval(incidentsPollingRef.current);
                      incidentsPollingRef.current = null;
                    }
                  }
                }
              } catch (pollErr) {
                console.warn('Incident sync polling error:', pollErr);
              }
            }, 3000);
          }
        } else {
          if (incidentsPollingRef.current) {
            clearInterval(incidentsPollingRef.current);
            incidentsPollingRef.current = null;
          }
        }
      } else {
        setIncidentsError(res?.message || 'Unable to retrieve continuous monitoring incidents.');
      }
    } catch (err: any) {
      console.error('Failed to load risk incidents:', err);
      setIncidentsError(err.message || 'Unable to retrieve continuous monitoring incidents.');
    } finally {
      setIncidentsLoading(false);
    }
  };

  // Loader 3: User Role Mappings
  const loadUserRoleMappings = async () => {
    setUserRoleLoading(true);
    setUserRoleError('');
    try {
      const res = await api.getUsers(undefined, 1, 1000);
      const rawUsers = res?.users || [];
      
      const expandedRows: any[] = [];
      rawUsers.forEach((u: any) => {
        const username = u.userName || '—';
        const displayName = u.displayName || '—';
        const email = u.email || '—';
        const status = u.active ? 'Active' : 'Inactive';
        const roles = u.assignedRoles || [];

        if (roles.length === 0) {
          expandedRows.push({
            id: `${u.id || username}_none`,
            username,
            displayName,
            email,
            status,
            roleName: '(No Assigned Roles)',
            roleCode: '—',
            category: '—',
            isCustom: false
          });
        } else {
          roles.forEach((r: any, idx: number) => {
            const roleName = typeof r === 'string' ? r : (r.roleName || r.displayName || r.roleCode || 'Unknown Role');
            const roleCode = typeof r === 'string' ? r : (r.roleCode || '—');
            const category = typeof r === 'object' && r.category ? r.category : 'Job';
            const isCustom = typeof r === 'object' ? Boolean(r.isCustom) : false;

            expandedRows.push({
              id: `${u.id || username}_${roleCode}_${idx}`,
              username,
              displayName,
              email,
              status,
              roleName,
              roleCode,
              category,
              isCustom
            });
          });
        }
      });

      setUserRoleData(expandedRows);
    } catch (err: any) {
      console.error('Failed to load user role mappings:', err);
      setUserRoleError('Unable to load user role mappings from identity service.');
    } finally {
      setUserRoleLoading(false);
    }
  };

  // Loader 4: Role Hierarchy
  const loadRoleHierarchy = async (forceRefresh = false) => {
    setHierarchyLoading(true);
    setHierarchyError('');
    setHierarchyIntegrationNotice('');
    try {
      const res = await api.getRoleHierarchyReport(forceRefresh);
      if (res?.items && Array.isArray(res.items)) {
        setHierarchyData(res.items);
        if (res.items.length > 0 && !rhSelectedRoleForTree) {
          const defaultJob = res.items.find((i: any) => i.category === 'Job') || res.items[0];
          setRhSelectedRoleForTree(defaultJob.roleName || defaultJob.childRole);
        }
      } else if (res?.integrationRequired) {
        setHierarchyIntegrationNotice(res.message || 'Live role hierarchy trees require privileged security catalog sync.');
        setHierarchyData([]);
      }
    } catch (err: any) {
      console.error('Failed to load role hierarchy:', err);
      setHierarchyError('Unable to retrieve role inheritance hierarchy.');
    } finally {
      setHierarchyLoading(false);
    }
  };

  const loadRoleTree = async (roleName: string) => {
    if (!roleName) return;
    setRhSelectedRoleForTree(roleName);
    setRhTreeLoading(true);
    try {
      const res = await api.getRoleHierarchy(roleName);
      if (res && (res.success || res.childrenTree || res.parents)) {
        setRhTreeData(res);
        const exp = new Set<string>();
        exp.add(roleName.toLowerCase());
        (res.childrenTree || []).forEach((c: any) => exp.add(c.name.toLowerCase()));
        setRhExpandedNodes(exp);
      } else {
        setRhTreeData(null);
      }
    } catch (err) {
      console.error('Failed to load role tree:', err);
      setRhTreeData(null);
    } finally {
      setRhTreeLoading(false);
    }
  };

  const toggleTreeNode = (nodeKey: string) => {
    setRhExpandedNodes(prev => {
      const next = new Set(prev);
      const key = nodeKey.toLowerCase();
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const togglePrivilegeNode = (nodeKey: string) => {
    setRhExpandedPrivileges(prev => {
      const next = new Set(prev);
      const key = nodeKey.toLowerCase();
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleOpenTreeModal = (roleName: string) => {
    setRhTreeModalOpen(true);
    loadRoleTree(roleName);
  };

  const handleSyncHierarchyLive = async () => {
    setRhSyncing(true);
    try {
      await api.syncRoleHierarchy();
      await loadRoleHierarchy(true);
    } catch (err: any) {
      console.error('Live sync error:', err);
      setHierarchyError('Failed to synchronize live hierarchy from Oracle Fusion.');
    } finally {
      setRhSyncing(false);
    }
  };

  const expandAllTreeNodes = () => {
    if (!rhTreeData) return;
    const allKeys = new Set<string>();
    const collectKeys = (node: any) => {
      if (node.name) allKeys.add(node.name.toLowerCase());
      if (node.children && node.children.length > 0) {
        node.children.forEach(collectKeys);
      }
    };
    allKeys.add(rhTreeData.roleName.toLowerCase());
    (rhTreeData.childrenTree || []).forEach(collectKeys);
    setRhExpandedNodes(allKeys);
  };

  const collapseAllTreeNodes = () => {
    setRhExpandedNodes(new Set());
  };

  const renderHierarchyNode = (node: any, level = 0) => {
    const isExpanded = rhExpandedNodes.has(node.name.toLowerCase());
    const hasChildren = node.children && node.children.length > 0;
    const hasPrivileges = node.privileges && node.privileges.length > 0;
    const isPrivExpanded = rhExpandedPrivileges.has(node.name.toLowerCase());

    return (
      <div key={`${node.name}-${level}`} style={{ marginLeft: level > 0 ? `${Math.min(level * 22, 88)}px` : '0', marginBottom: '0.65rem' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.65rem 0.9rem',
          borderRadius: '8px',
          backgroundColor: level === 0 ? 'rgba(37, 99, 235, 0.08)' : 'var(--bg-secondary)',
          border: level === 0 ? '1px solid rgba(37, 99, 235, 0.35)' : '1px solid var(--border-color)',
          transition: 'all 0.15s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flex: 1, minWidth: 0 }}>
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleTreeNode(node.name)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center'
                }}
                title={isExpanded ? 'Collapse sub-roles' : 'Expand sub-roles'}
              >
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
            ) : (
              <div style={{ width: '16px' }} />
            )}

            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: level === 0 ? '#2563EB' : 'rgba(59, 130, 246, 0.1)',
              color: level === 0 ? '#ffffff' : 'var(--accent-blue)',
              flexShrink: 0
            }}>
              {level === 0 ? <Shield size={16} /> : <FolderTree size={15} />}
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <span
                  style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', cursor: 'pointer' }}
                  onClick={() => loadRoleTree(node.name)}
                  title="Click to focus this role"
                >
                  {node.name}
                </span>
                {node.code && <code style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>{node.code}</code>}
                <span className={`badge ${node.type === 'JOB' ? 'badge-primary' : 'badge-gold'}`} style={{ fontSize: '0.66rem' }}>
                  {node.type || node.category || 'Duty'}
                </span>
                {node.relationship && (
                  <span className="badge badge-neutral" style={{ fontSize: '0.64rem' }}>
                    {node.relationship}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            {hasPrivileges && (
              <button
                type="button"
                onClick={() => togglePrivilegeNode(node.name)}
                className="badge badge-neutral"
                style={{
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.7rem',
                  border: '1px solid var(--border-color)',
                  backgroundColor: isPrivExpanded ? 'rgba(234, 179, 8, 0.15)' : 'transparent',
                  color: isPrivExpanded ? 'var(--accent-gold)' : 'var(--text-secondary)'
                }}
                title="Click to toggle functional privileges"
              >
                <Key size={12} />
                <span>{node.privileges.length} Privileges</span>
                {isPrivExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>
            )}

            <button
              type="button"
              onClick={() => loadRoleTree(node.name)}
              className="btn btn-secondary"
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
              title="Focus this role in tree"
            >
              <GitFork size={12} /> Focus
            </button>
          </div>
        </div>

        {/* Privileges under this role */}
        {hasPrivileges && isPrivExpanded && (
          <div style={{
            marginLeft: '2rem',
            marginTop: '0.4rem',
            marginBottom: '0.5rem',
            padding: '0.65rem 0.9rem',
            backgroundColor: 'var(--bg-tertiary)',
            borderRadius: '6px',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Key size={12} style={{ color: 'var(--accent-gold)' }} />
              <span>Granted Functional Privileges ({node.privileges.length}):</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', maxHeight: '180px', overflowY: 'auto' }}>
              {node.privileges.map((p: any, idx: number) => (
                <span
                  key={`p-${node.name}-${idx}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    fontSize: '0.72rem',
                    backgroundColor: 'var(--bg-primary)',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-secondary)'
                  }}
                >
                  <code style={{ fontSize: '0.7rem', color: 'var(--text-primary)' }}>{p.code || p.name}</code>
                  {p.name && p.name !== p.code && <span style={{ opacity: 0.75 }}>({p.name})</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Child duties */}
        {hasChildren && isExpanded && (
          <div style={{ marginTop: '0.5rem', borderLeft: '2px solid var(--border-color)', paddingLeft: '0.75rem' }}>
            {node.children.map((child: any) => renderHierarchyNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderHierarchyTreeContent = (isModal = false) => {
    if (rhTreeLoading) {
      return (
        <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <RefreshCw size={30} className="animate-spin" style={{ margin: '0 auto 0.75rem auto', color: 'var(--accent-blue)' }} />
          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Loading Role Hierarchy Tree...</div>
          <div style={{ fontSize: '0.8rem', marginTop: '0.25rem', color: 'var(--text-muted)' }}>
            Tracing Job ➔ Duty ➔ Privileges relationships from Oracle Fusion
          </div>
        </div>
      );
    }

    if (!rhTreeData) {
      return (
        <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <FolderTree size={36} style={{ margin: '0 auto 0.75rem auto', opacity: 0.4 }} />
          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>No Role Selected</div>
          <div style={{ fontSize: '0.82rem', marginTop: '0.25rem', color: 'var(--text-muted)' }}>
            Select a role from the focus selector or click &quot;View Tree&quot; in the explorer table to inspect its full inheritance hierarchy.
          </div>
        </div>
      );
    }

    const rootNode = {
      name: rhTreeData.roleName,
      code: rhTreeData.roleCode,
      type: rhTreeData.category === 'Duty' ? 'DUTY' : 'JOB',
      category: rhTreeData.category,
      relationship: 'Root Focus Role',
      privileges: rhTreeData.privileges || [],
      children: rhTreeData.childrenTree || [],
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Tree Stats Bar */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.9rem 1.15rem',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          gap: '0.75rem'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>{rhTreeData.roleName}</span>
              <code style={{ fontSize: '0.8rem' }}>{rhTreeData.roleCode}</code>
              <span className="badge badge-primary" style={{ fontSize: '0.7rem' }}>{rhTreeData.category}</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Total Descendant Roles: <strong>{rhTreeData.totalDescendants}</strong> &bull; Direct Duties: <strong>{rhTreeData.childrenTree?.length || 0}</strong> &bull; Direct Privileges: <strong>{rhTreeData.privileges?.length || 0}</strong>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={expandAllTreeNodes}
              style={{ fontSize: '0.76rem', padding: '0.3rem 0.65rem' }}
            >
              Expand All
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={collapseAllTreeNodes}
              style={{ fontSize: '0.76rem', padding: '0.3rem 0.65rem' }}
            >
              Collapse All
            </button>
            {isModal && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setRhTreeModalOpen(false);
                  setRhViewMode('TREE');
                }}
                style={{ fontSize: '0.76rem', padding: '0.3rem 0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <ExternalLink size={12} /> Open in Page
              </button>
            )}
          </div>
        </div>

        {/* Section 1: Parent Grantor Roles */}
        {rhTreeData.parents && rhTreeData.parents.length > 0 && (
          <div style={{
            padding: '0.85rem 1rem',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Layers size={14} style={{ color: 'var(--accent-blue)' }} />
              <span>Parent Roles that Inherit or Grant this Role ({rhTreeData.parents.length}):</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
              {rhTreeData.parents.map((p: any) => (
                <button
                  key={`parent-${p.name}`}
                  type="button"
                  onClick={() => loadRoleTree(p.name)}
                  className="badge badge-blue"
                  style={{
                    cursor: 'pointer',
                    padding: '0.3rem 0.65rem',
                    fontSize: '0.76rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    border: '1px solid rgba(37, 99, 235, 0.25)',
                    transition: 'all 0.15s ease'
                  }}
                  title={`Focus parent role: ${p.name}`}
                >
                  <span>{p.name}</span>
                  <span style={{ opacity: 0.7, fontSize: '0.68rem' }}>({p.type || 'ROLE'})</span>
                  <ArrowRight size={11} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Section 2: Recursive Hierarchy Tree */}
        <div style={{
          padding: '1rem',
          backgroundColor: 'var(--bg-tertiary)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          maxHeight: isModal ? '55vh' : 'auto',
          overflowY: isModal ? 'auto' : 'visible'
        }}>
          <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <FolderTree size={14} style={{ color: 'var(--accent-gold)' }} />
            <span>Inheritance Tree: Job Role &rarr; Duty Role &rarr; Privileges</span>
          </div>

          {renderHierarchyNode(rootNode, 0)}
        </div>
      </div>
    );
  };

  // Loader 5: Audit History
  const loadAuditHistory = async () => {
    setAuditLoading(true);
    setAuditError('');
    try {
      const res = await api.getAuditLogs({
        product: selectedAuditProduct,
        businessObjectType: selectedAuditBO,
        fromDate: auditFromDate,
        toDate: auditToDate,
        username: auditUserQuery,
        action: auditActionFilter,
        pageNumber: 1,
        pageSize: 500
      });
      if (res?.items) {
        setAuditLogs(res.items);
      }
    } catch (err: any) {
      console.error('Failed to load audit history:', err);
      setAuditError('Failed to execute audit trail query.');
    } finally {
      setAuditLoading(false);
    }
  };

  // Loader 6: User Access Report
  const loadUserAccessReport = async (forceRefresh = false) => {
    setUserAccessLoading(true);
    setUserAccessError('');
    try {
      const res = await api.getUserAccessReport({ refresh: forceRefresh });
      if (res?.data) {
        setUserAccessData(res.data);
        if (res.summary) {
          setUserAccessSummary(res.summary);
        }
      } else if (res?.error) {
        setUserAccessError(res.error);
      }
    } catch (err: any) {
      console.error('Failed to load user access report:', err);
      setUserAccessError(err.message || 'Unable to retrieve user access report from Oracle Fusion.');
    } finally {
      setUserAccessLoading(false);
    }
  };

  // Initial load when report changes
  useEffect(() => {
    if (activeReportId === 'CONTROL_SUMMARY' && controlsData.length === 0 && !controlsLoading) {
      loadControlsSummary();
    } else if (activeReportId === 'INCIDENTS_DETAILED' && incidentsData.length === 0 && !incidentsLoading) {
      loadRiskIncidents(selectedIncidentsControlId);
    } else if (activeReportId === 'USER_ROLE_MAPPING' && userRoleData.length === 0 && !userRoleLoading) {
      loadUserRoleMappings();
    } else if (activeReportId === 'ROLE_HIERARCHY' && hierarchyData.length === 0 && !hierarchyLoading) {
      loadRoleHierarchy();
    } else if (activeReportId === 'AUDIT_HISTORY' && auditLogs.length === 0 && !auditLoading) {
      loadAuditHistory();
    } else if (activeReportId === 'USER_ACCESS' && userAccessData.length === 0 && !userAccessLoading) {
      loadUserAccessReport();
    }
  }, [activeReportId]);

  // Load role tree when tree view mode is active
  useEffect(() => {
    if (activeReportId === 'ROLE_HIERARCHY' && rhViewMode === 'TREE' && rhSelectedRoleForTree && !rhTreeData && !rhTreeLoading) {
      loadRoleTree(rhSelectedRoleForTree);
    }
  }, [activeReportId, rhViewMode, rhSelectedRoleForTree]);

  // Audit Product Catalog loads lazily: only when the Audit History report is opened
  useEffect(() => {
    async function fetchAuditCatalog() {
      try {
        const res = await api.getAuditProducts();
        if (res?.products) {
          setAuditProducts(res.products);
        }
      } catch (e) {
        console.warn('Could not load audit products catalog:', e);
      }
    }
    if (activeReportId === 'AUDIT_HISTORY' && auditProducts.length === 0) {
      fetchAuditCatalog();
    }
  }, [activeReportId, auditProducts.length]);

  // Update audit business objects dropdown when product changes
  useEffect(() => {
    const prod = auditProducts.find(p => p.id === selectedAuditProduct);
    if (!prod) return;
    if (!prod.requiresBusinessObjectType || !prod.businessObjects || prod.businessObjects.length === 0) {
      setSelectedAuditBO('');
    } else {
      setSelectedAuditBO(prod.businessObjects[0]?.id || '');
    }
  }, [selectedAuditProduct, auditProducts]);

  // =============================================================
  // FILTERED DATASETS
  // =============================================================

  // 1. Controls Summary Filtered
  const filteredControls = useMemo(() => {
    return controlsData.filter(ctrl => {
      const q = controlsSearch.toLowerCase().trim();
      const matchesSearch = !q ||
        (ctrl.controlId && String(ctrl.controlId).toLowerCase().includes(q)) ||
        (ctrl.controlName && ctrl.controlName.toLowerCase().includes(q)) ||
        (ctrl.description && ctrl.description.toLowerCase().includes(q)) ||
        (ctrl.scheduledBy && ctrl.scheduledBy.toLowerCase().includes(q)) ||
        (ctrl.controlTypeCode && String(ctrl.controlTypeCode).includes(q));

      const matchesStatus = controlsStatusFilter === 'ALL' ||
        (ctrl.status && String(ctrl.status).toUpperCase() === controlsStatusFilter.toUpperCase());

      // Verified Oracle Type value only (173 = Access, 174 = Transaction).
      // Unknown codes are excluded when a specific type is selected.
      const matchesType = controlsTypeFilter === 'ALL' ||
        (controlsTypeFilter === 'ACCESS' && isAccessControl(ctrl.controlTypeCode)) ||
        (controlsTypeFilter === 'TRANSACTION' && isTransactionControl(ctrl.controlTypeCode));

      const matchesCountsStatus = controlsCountsStatusFilter === 'ALL' ||
        (ctrl.countsStatus && String(ctrl.countsStatus).toUpperCase() === controlsCountsStatusFilter.toUpperCase());

      const matchesIncidents = controlsIncidentFilter === 'ALL' ||
        (controlsIncidentFilter === 'WITH_INCIDENTS' && (ctrl.totalIncidentCount || 0) > 0) ||
        (controlsIncidentFilter === 'ZERO_INCIDENTS' && ctrl.totalIncidentCount === 0) ||
        (controlsIncidentFilter === 'NOT_SCANNED' && ctrl.totalIncidentCount === null);

      return matchesSearch && matchesStatus && matchesType && matchesCountsStatus && matchesIncidents;
    });
  }, [controlsData, controlsSearch, controlsStatusFilter, controlsTypeFilter, controlsCountsStatusFilter, controlsIncidentFilter]);

  // 2. Incidents Detailed Filtered
  const filteredIncidents = useMemo(() => {
    return incidentsData.filter(item => {
      const q = incidentsSearch.toLowerCase().trim();
      const matchesSearch = !q ||
        (item.id && String(item.id).toLowerCase().includes(q)) ||
        (item.controlId && String(item.controlId).toLowerCase().includes(q)) ||
        (item.controlName && item.controlName.toLowerCase().includes(q)) ||
        (item.globalUserName && item.globalUserName.toLowerCase().includes(q)) ||
        (item.userFirstName && item.userFirstName.toLowerCase().includes(q)) ||
        (item.userLastName && item.userLastName.toLowerCase().includes(q)) ||
        (item.role && item.role.toLowerCase().includes(q)) ||
        (item.incidentInformation && item.incidentInformation.toLowerCase().includes(q));

      const matchesStatus = incidentsStatusFilter === 'ALL' ||
        (item.status && item.status.toUpperCase() === incidentsStatusFilter.toUpperCase());

      const matchesState = incidentsStateFilter === 'ALL' ||
        (item.state && item.state.toUpperCase() === incidentsStateFilter.toUpperCase());

      return matchesSearch && matchesStatus && matchesState;
    });
  }, [incidentsData, incidentsSearch, incidentsStatusFilter, incidentsStateFilter]);

  // 3. User Role Mappings Filtered
  const filteredUserRoleData = useMemo(() => {
    return userRoleData.filter(item => {
      const q = urmSearch.toLowerCase().trim();
      const matchesSearch = !q ||
        item.username.toLowerCase().includes(q) ||
        item.displayName.toLowerCase().includes(q) ||
        item.email.toLowerCase().includes(q) ||
        item.roleName.toLowerCase().includes(q) ||
        item.roleCode.toLowerCase().includes(q);

      const matchesStatus = urmStatusFilter === 'ALL' || 
        item.status.toUpperCase() === urmStatusFilter.toUpperCase();

      const matchesCat = urmCategoryFilter === 'ALL' ||
        item.category.toLowerCase() === urmCategoryFilter.toLowerCase();

      return matchesSearch && matchesStatus && matchesCat;
    });
  }, [userRoleData, urmSearch, urmStatusFilter, urmCategoryFilter]);

  // 4. Role Hierarchy Filtered
  const filteredHierarchyData = useMemo(() => {
    return hierarchyData.filter(item => {
      const q = rhSearch.toLowerCase().trim();
      const matchesSearch = !q ||
        item.roleName.toLowerCase().includes(q) ||
        item.roleCode.toLowerCase().includes(q) ||
        item.parentRole.toLowerCase().includes(q) ||
        item.childRole.toLowerCase().includes(q) ||
        item.relationshipType.toLowerCase().includes(q);

      const matchesCat = rhCategoryFilter === 'ALL' ||
        item.category.toLowerCase() === rhCategoryFilter.toLowerCase();

      return matchesSearch && matchesCat;
    });
  }, [hierarchyData, rhSearch, rhCategoryFilter]);

  // 5. Audit History Filtered
  const filteredAuditLogs = useMemo(() => {
    return auditLogs;
  }, [auditLogs]);

  // 6. User Access Filtered
  const filteredUserAccessData = useMemo(() => {
    return userAccessData.filter(row => {
      if (userAccessSearch) {
        const term = userAccessSearch.toLowerCase().trim();
        const match =
          (row.username && String(row.username).toLowerCase().includes(term)) ||
          (row.displayName && String(row.displayName).toLowerCase().includes(term)) ||
          (row.email && String(row.email).toLowerCase().includes(term)) ||
          (row.roleName && String(row.roleName).toLowerCase().includes(term)) ||
          (row.roleCode && String(row.roleCode).toLowerCase().includes(term)) ||
          (row.department && String(row.department).toLowerCase().includes(term)) ||
          (row.job && String(row.job).toLowerCase().includes(term)) ||
          (row.businessUnit && String(row.businessUnit).toLowerCase().includes(term)) ||
          (row.location && String(row.location).toLowerCase().includes(term)) ||
          (row.manager && String(row.manager).toLowerCase().includes(term)) ||
          (row.personNumber && String(row.personNumber).toLowerCase().includes(term));
        if (!match) return false;
      }
      if (userAccessStatusFilter !== 'ALL') {
        if (userAccessStatusFilter === 'ACTIVE' && !row.active) return false;
        if (userAccessStatusFilter === 'INACTIVE' && row.active) return false;
      }
      if (userAccessBuFilter !== 'ALL' && row.businessUnit !== userAccessBuFilter) {
        return false;
      }
      if (userAccessDeptFilter !== 'ALL' && row.department !== userAccessDeptFilter) {
        return false;
      }
      if (userAccessRoleFilter !== 'ALL' && row.roleName !== userAccessRoleFilter) {
        return false;
      }
      if (userAccessManagerFilter !== 'ALL' && row.manager !== userAccessManagerFilter) {
        return false;
      }
      return true;
    });
  }, [userAccessData, userAccessSearch, userAccessStatusFilter, userAccessBuFilter, userAccessDeptFilter, userAccessRoleFilter, userAccessManagerFilter]);

  // Active dataset pointer
  const currentDataset = useMemo(() => {
    switch (activeReportId) {
      case 'CONTROL_SUMMARY': return filteredControls;
      case 'INCIDENTS_DETAILED': return filteredIncidents;
      case 'USER_ROLE_MAPPING': return filteredUserRoleData;
      case 'ROLE_HIERARCHY': return filteredHierarchyData;
      case 'USER_ACCESS': return filteredUserAccessData;
      case 'AUDIT_HISTORY': return filteredAuditLogs;
      default: return [];
    }
  }, [activeReportId, filteredControls, filteredIncidents, filteredUserRoleData, filteredHierarchyData, filteredUserAccessData, filteredAuditLogs]);

  // Active Filters & Options for User Access Report
  const userAccessBuOptions = useMemo(() => {
    const set = new Set<string>();
    userAccessData.forEach(r => { if (r.businessUnit) set.add(r.businessUnit); });
    return Array.from(set).sort();
  }, [userAccessData]);

  const userAccessDeptOptions = useMemo(() => {
    const set = new Set<string>();
    userAccessData.forEach(r => { if (r.department) set.add(r.department); });
    return Array.from(set).sort();
  }, [userAccessData]);

  const userAccessRoleOptions = useMemo(() => {
    const set = new Set<string>();
    userAccessData.forEach(r => { if (r.roleName) set.add(r.roleName); });
    return Array.from(set).sort();
  }, [userAccessData]);

  const userAccessManagerOptions = useMemo(() => {
    const set = new Set<string>();
    userAccessData.forEach(r => { if (r.manager) set.add(r.manager); });
    return Array.from(set).sort();
  }, [userAccessData]);

  const userAccessActiveFilters = useMemo(() => {
    const list: { label: string; value: string }[] = [];
    if (userAccessSearch) list.push({ label: 'Search', value: `"${userAccessSearch}"` });
    if (userAccessStatusFilter !== 'ALL') list.push({ label: 'Status', value: userAccessStatusFilter });
    if (userAccessRoleFilter !== 'ALL') list.push({ label: 'Role', value: userAccessRoleFilter });
    if (userAccessBuFilter !== 'ALL') list.push({ label: 'Business Unit', value: userAccessBuFilter });
    if (userAccessDeptFilter !== 'ALL') list.push({ label: 'Department', value: userAccessDeptFilter });
    if (userAccessManagerFilter !== 'ALL') list.push({ label: 'Manager', value: userAccessManagerFilter });
    return list;
  }, [userAccessSearch, userAccessStatusFilter, userAccessRoleFilter, userAccessBuFilter, userAccessDeptFilter, userAccessManagerFilter]);

  const hasActiveUserAccessFilters = Boolean(
    userAccessSearch ||
    userAccessStatusFilter !== 'ALL' ||
    userAccessRoleFilter !== 'ALL' ||
    userAccessBuFilter !== 'ALL' ||
    userAccessDeptFilter !== 'ALL' ||
    userAccessManagerFilter !== 'ALL'
  );

  const resetUserAccessFilters = () => {
    setUserAccessSearch('');
    setUserAccessStatusFilter('ALL');
    setUserAccessRoleFilter('ALL');
    setUserAccessBuFilter('ALL');
    setUserAccessDeptFilter('ALL');
    setUserAccessManagerFilter('ALL');
    setCurrentPage(1);
  };

  // Active pagination slice
  const totalRows = currentDataset.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const paginatedSlice = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return currentDataset.slice(start, start + pageSize);
  }, [currentDataset, currentPage, pageSize]);

  const activeMeta = activeReportId ? REPORT_DEFINITIONS.find(r => r.id === activeReportId) : undefined;

  // Active Filters & Reset Helpers for Control Summary
  const controlsActiveFilters = useMemo(() => {
    const list: { label: string; value: string }[] = [];
    if (controlsSearch) list.push({ label: 'Search', value: `"${controlsSearch}"` });
    if (controlsStatusFilter !== 'ALL') list.push({ label: 'Status', value: controlsStatusFilter });
    if (controlsTypeFilter !== 'ALL') list.push({ label: 'Control Type', value: controlsTypeFilter === 'ACCESS' ? 'Access Controls' : 'Transaction Controls' });
    if (controlsCountsStatusFilter !== 'ALL') list.push({ label: 'Data Status', value: controlsCountsStatusFilter });
    if (controlsIncidentFilter !== 'ALL') list.push({ label: 'Exposure', value: controlsIncidentFilter === 'WITH_INCIDENTS' ? 'With Incidents' : controlsIncidentFilter === 'ZERO_INCIDENTS' ? 'Zero Incidents' : 'Not Scanned' });
    return list;
  }, [controlsSearch, controlsStatusFilter, controlsTypeFilter, controlsCountsStatusFilter, controlsIncidentFilter]);

  const hasActiveControlsFilters = Boolean(controlsSearch || controlsStatusFilter !== 'ALL' || controlsTypeFilter !== 'ALL' || controlsCountsStatusFilter !== 'ALL' || controlsIncidentFilter !== 'ALL');
  const resetControlsFilters = () => {
    setControlsSearch('');
    setControlsStatusFilter('ALL');
    setControlsTypeFilter('ALL');
    setControlsCountsStatusFilter('ALL');
    setControlsIncidentFilter('ALL');
    setCurrentPage(1);
  };

  // Active Filters & Reset Helpers for Incidents Detailed
  const incidentsActiveFilters = useMemo(() => {
    const list: { label: string; value: string }[] = [];
    list.push({ label: 'Control ID', value: selectedIncidentsControlId });
    if (incidentsSearch) list.push({ label: 'Search', value: `"${incidentsSearch}"` });
    if (incidentsStatusFilter !== 'ALL') list.push({ label: 'Status', value: incidentsStatusFilter });
    if (incidentsStateFilter !== 'ALL') list.push({ label: 'State', value: incidentsStateFilter });
    return list;
  }, [selectedIncidentsControlId, incidentsSearch, incidentsStatusFilter, incidentsStateFilter]);

  const hasActiveIncidentsFilters = Boolean(incidentsSearch || incidentsStatusFilter !== 'ALL' || incidentsStateFilter !== 'ALL');
  const resetIncidentsFilters = () => {
    setIncidentsSearch('');
    setIncidentsStatusFilter('ALL');
    setIncidentsStateFilter('ALL');
    setCurrentPage(1);
  };

  // Active Filters for User Role Mapping
  const urmActiveFilters = useMemo(() => {
    const list: { label: string; value: string }[] = [];
    if (urmSearch) list.push({ label: 'Search', value: `"${urmSearch}"` });
    if (urmStatusFilter !== 'ALL') list.push({ label: 'Status', value: urmStatusFilter });
    if (urmCategoryFilter !== 'ALL') list.push({ label: 'Category', value: urmCategoryFilter });
    return list;
  }, [urmSearch, urmStatusFilter, urmCategoryFilter]);

  // Active Filters for Role Hierarchy
  const rhActiveFilters = useMemo(() => {
    const list: { label: string; value: string }[] = [];
    if (rhSearch) list.push({ label: 'Search', value: `"${rhSearch}"` });
    if (rhCategoryFilter !== 'ALL') list.push({ label: 'Category', value: rhCategoryFilter });
    return list;
  }, [rhSearch, rhCategoryFilter]);

  // Helper to render Oracle fields gracefully without inventing values
  const renderFieldVal = (val: any) => {
    if (val === null || val === undefined || val === '') {
      return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not available</span>;
    }
    return String(val);
  };

  // Helper to format Oracle timestamps safely
  const formatOracleDate = (dateVal: any) => {
    if (!dateVal) return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not available</span>;
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return String(dateVal);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return String(dateVal);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', width: '100%', margin: '0 auto', paddingBottom: '4rem' }}>
      
      {/* -------------------------------------------------------------
          1. SIGNATURE ENTERPRISE BLUE GRADIENT BANNER (Matches Risk.tsx)
          ------------------------------------------------------------- */}
      <div className="page-header-banner animate-fade-in" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #1E40AF 0%, #2563EB 60%, #3B82F6 100%)',
        position: 'relative',
        padding: '2rem',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(37, 99, 235, 0.15)',
        marginBottom: '1.75rem',
        overflow: 'hidden'
      }}>
        {/* Subtle Wave Curve Overlay */}
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
            Reports
          </h1>
          <p style={{ color: '#E0E7FF', fontSize: '0.92rem', margin: 0 }}>
            Authoritative compliance, security, audit, and risk intelligence from your connected Oracle Fusion environment.
          </p>
        </div>

        <div style={{ position: 'relative', zIndex: 2 }}>
          <div style={{
            padding: '0.45rem 1rem',
            fontSize: '0.78rem',
            fontWeight: 600,
            borderRadius: '9999px',
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            color: '#ffffff',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}>
            <Database size={13} />
            <span>{environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Authoritative Sample'}</span>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------------
          2. REPORT SELECTOR (single report-selection mechanism)
          Stacking note: .glass-panel uses backdrop-filter, which makes every
          panel its own stacking context painted in DOM order. This selector
          bar therefore carries position + z-index so its dropdown menu always
          paints above the later sibling content panels.
          ------------------------------------------------------------- */}
      <div className="glass-panel" style={{
        position: 'relative',
        zIndex: 10,
        padding: '0.85rem 1rem',
        borderRadius: '10px',
        marginBottom: '1.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem',
        flexWrap: 'wrap',
        border: '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-secondary)'
      }}>
        <label htmlFor="report-selector" style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
          Select Report
        </label>
        <ReportSelectorDropdown
          options={reportSelectorOptions}
          domains={REPORT_DOMAIN_ORDER}
          selectedId={activeReportId}
          onSelect={(id) => handleSelectReport(id as ReportId)}
          placeholder="Select a report"
        />
      </div>

      {/* -------------------------------------------------------------
          3. SELECTED REPORT CONTAINER (PART 9)
          ------------------------------------------------------------- */}
      {activeMeta ? (
      <div className="glass-panel" style={{ borderRadius: '12px', padding: '1.5rem', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
        
        {/* Back to All Reports Link */}
        <div style={{ marginBottom: '1.1rem' }}>
          <button
            type="button"
            onClick={() => handleSelectReport(null)}
            className="btn btn-secondary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              padding: '0.35rem 0.75rem',
              color: 'var(--accent-blue)',
              borderColor: 'rgba(53, 99, 233, 0.25)',
              background: 'transparent',
              cursor: 'pointer'
            }}
          >
            <ArrowLeft size={13} />
            <span>Back to All Reports</span>
          </button>
        </div>

        {/* Selected Report Header Bar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '1.25rem',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '6px',
                backgroundColor: 'var(--accent-blue-light)',
                color: 'var(--accent-blue)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <activeMeta.icon size={18} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0, fontFamily: 'var(--font-header)', color: 'var(--text-primary)' }}>
                    {activeMeta.title}
                  </h2>
                  <span className="badge badge-gold" style={{ fontSize: '0.72rem', fontWeight: 600 }}>
                    {activeMeta.badge}
                  </span>
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0 0' }}>
                  {activeMeta.subtitle}
                </p>
              </div>
            </div>
          </div>

          {/* Global Actions (Refresh & Export) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            {/* Refresh Button */}
            {activeReportId === 'CONTROL_SUMMARY' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => loadControlsSummary(true, false)}
                disabled={controlsLoading || controlsScanning}
                style={{ fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
                title="Force refresh entire control summary report from Oracle"
              >
                <RefreshCw size={13} className={controlsLoading ? 'animate-spin' : ''} />
                <span>{controlsLoading ? 'Refreshing...' : 'Refresh'}</span>
              </button>
            )}

            {activeReportId === 'INCIDENTS_DETAILED' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => loadRiskIncidents(selectedIncidentsControlId, true)}
                disabled={incidentsLoading}
                style={{ fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
                title="Refresh incident records from Oracle Fusion"
              >
                <RefreshCw size={13} className={incidentsLoading ? 'animate-spin' : ''} />
                <span>{incidentsLoading ? 'Refreshing...' : 'Refresh'}</span>
              </button>
            )}

            {activeReportId === 'USER_ACCESS' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => loadUserAccessReport(true)}
                disabled={userAccessLoading}
                style={{ fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
                title="Force refresh live user access data from Oracle Fusion"
              >
                <RefreshCw size={13} className={userAccessLoading ? 'animate-spin' : ''} />
                <span>{userAccessLoading ? 'Refreshing...' : 'Refresh'}</span>
              </button>
            )}

            {/* Standardized Table Download Control */}
            {activeReportId === 'CONTROL_SUMMARY' && (
              <EnterpriseExportControl
                filename="control_summary_report"
                sheetName="Control Summary"
                reportTitle="Oracle Fusion Advanced Controls Summary Report"
                dataSource="Oracle Fusion Risk Management Cloud"
                entityName="Controls"
                buttonText="Export Controls"
                currentPageData={paginatedSlice}
                filteredCount={filteredControls.length}
                totalCount={controlsData.length}
                appliedFilters={controlsActiveFilters}
                availableColumns={[
                  { key: 'controlId', label: 'Control ID', defaultSelected: true },
                  { key: 'controlName', label: 'Control Name', defaultSelected: true },
                  { key: 'description', label: 'Description', defaultSelected: false, getValue: (c: any) => c.description || '—' },
                  { key: 'status', label: 'Status', defaultSelected: true },
                  { key: 'state', label: 'State', defaultSelected: true },
                  { key: 'controlType', label: 'Control Type', defaultSelected: true, getValue: (c: any) => c.controlTypeName || (c.controlTypeCode !== null && c.controlTypeCode !== undefined && String(c.controlTypeCode).trim() !== '' ? formatControlTypeName(c.controlTypeCode) : '—') },
                  { key: 'totalIncidentCount', label: 'Total Incidents', defaultSelected: true, getValue: (c: any) => c.totalIncidentCount !== null ? c.totalIncidentCount : (c.countsStatus === 'NOT_STARTED' ? 'Not scanned' : c.countsStatus === 'CALCULATING' ? 'Calculating...' : 'Partial') },
                  { key: 'assignedOrInRemediationCount', label: 'Assigned / In Remediation', defaultSelected: true, getValue: (c: any) => c.assignedOrInRemediationCount !== null ? c.assignedOrInRemediationCount : '—' },
                  { key: 'acceptedCount', label: 'Accepted', defaultSelected: true, getValue: (c: any) => c.acceptedCount !== null ? c.acceptedCount : '—' },
                  { key: 'closedOrResolvedCount', label: 'Closed / Resolved', defaultSelected: true, getValue: (c: any) => c.closedOrResolvedCount !== null ? c.closedOrResolvedCount : '—' },
                  { key: 'lastRunDate', label: 'Last Run Date', defaultSelected: true, getValue: (c: any) => c.lastRunDate ? new Date(c.lastRunDate).toLocaleString() : '—' },
                  { key: 'scheduledBy', label: 'Scheduled By', defaultSelected: false, getValue: (c: any) => c.scheduledBy || '—' },
                  { key: 'countsStatus', label: 'Data Status', defaultSelected: false },
                  { key: 'lastCalculatedAt', label: 'Last Calculated At', defaultSelected: false, getValue: (c: any) => c.lastCalculatedAt ? new Date(c.lastCalculatedAt).toLocaleString() : '—' },
                  { key: 'calculationNotes', label: 'Calculation Notes', defaultSelected: false, getValue: (c: any) => c.calculationNotes || '—' }
                ]}
                onFetchScopeData={async (scope) => {
                  if (scope === 'PAGE') return paginatedSlice;
                  if (scope === 'FILTERED') return filteredControls;
                  return controlsData;
                }}
              />
            )}

            {activeReportId === 'INCIDENTS_DETAILED' && (
              <EnterpriseExportControl
                filename={`control_${selectedIncidentsControlId}_incidents_detailed`}
                sheetName="Incidents Detailed"
                reportTitle={`Oracle Advanced Control ${selectedIncidentsControlId} Incident Detailed Audit`}
                dataSource="Oracle Fusion Continuous Monitoring"
                entityName="Incidents"
                buttonText="Export Incidents"
                currentPageData={paginatedSlice}
                filteredCount={filteredIncidents.length}
                totalCount={incidentsData.length}
                appliedFilters={incidentsActiveFilters}
                availableColumns={[
                  { key: 'id', label: 'Incident ID', defaultSelected: true },
                  { key: 'controlId', label: 'Control ID', defaultSelected: true },
                  { key: 'controlName', label: 'Control Name', defaultSelected: true, getValue: (i: any) => i.controlName || '—' },
                  { key: 'user', label: 'Global User', defaultSelected: true, getValue: (i: any) => i.globalUserName || (i.userFirstName ? `${i.userFirstName} ${i.userLastName || ''}` : 'Not available') },
                  { key: 'role', label: 'Role', defaultSelected: true, getValue: (i: any) => i.role || 'Not available' },
                  { key: 'priority', label: 'Priority', defaultSelected: true, getValue: (i: any) => i.priority !== undefined ? String(i.priority) : '—' },
                  { key: 'status', label: 'Status', defaultSelected: true },
                  { key: 'state', label: 'State', defaultSelected: true },
                  { key: 'incidentInformation', label: 'Incident Information', defaultSelected: true, getValue: (i: any) => i.incidentInformation || '—' },
                  { key: 'entitlement', label: 'Entitlement', defaultSelected: false, getValue: (i: any) => i.entitlement || 'Not available' },
                  { key: 'accessPointName', label: 'Access Point', defaultSelected: false, getValue: (i: any) => i.accessPointName || 'Not available' },
                  { key: 'accessPointType', label: 'Access Point Type', defaultSelected: false, getValue: (i: any) => i.accessPointType || 'Not available' },
                  { key: 'creationDate', label: 'Creation Date', defaultSelected: true, getValue: (i: any) => i.creationDate ? new Date(i.creationDate).toLocaleString() : 'Not available' },
                  { key: 'closedDate', label: 'Closed Date', defaultSelected: false, getValue: (i: any) => i.closedDate ? new Date(i.closedDate).toLocaleString() : 'Not available' }
                ]}
                onFetchScopeData={async (scope) => {
                  if (scope === 'PAGE') return paginatedSlice;
                  if (scope === 'FILTERED') return filteredIncidents;
                  return incidentsData;
                }}
              />
            )}

            {activeReportId === 'USER_ROLE_MAPPING' && (
              <EnterpriseExportControl
                filename="users_role_mapping"
                sheetName="User Role Mapping"
                reportTitle="Oracle Fusion User Role Mapping Report"
                dataSource="Oracle Fusion Security Cloud"
                entityName="Mappings"
                buttonText="Export Mappings"
                currentPageData={paginatedSlice}
                filteredCount={filteredUserRoleData.length}
                totalCount={userRoleData.length}
                appliedFilters={urmActiveFilters}
                availableColumns={[
                  { key: 'username', label: 'Username', defaultSelected: true },
                  { key: 'displayName', label: 'Display Name', defaultSelected: true },
                  { key: 'email', label: 'Email', defaultSelected: true },
                  { key: 'status', label: 'Status', defaultSelected: true },
                  { key: 'roleName', label: 'Role Name', defaultSelected: true },
                  { key: 'roleCode', label: 'Role Code', defaultSelected: true },
                  { key: 'category', label: 'Role Category', defaultSelected: true }
                ]}
                onFetchScopeData={async (scope) => {
                  if (scope === 'PAGE') return paginatedSlice;
                  if (scope === 'FILTERED') return filteredUserRoleData;
                  return userRoleData;
                }}
              />
            )}

            {activeReportId === 'ROLE_HIERARCHY' && (
              <EnterpriseExportControl
                filename="roles_hierarchy"
                sheetName="Role Hierarchy"
                reportTitle="Oracle Fusion Role Hierarchy & Inheritance Report"
                dataSource="Oracle Fusion Security Cloud"
                entityName="Relationships"
                buttonText="Export Hierarchy"
                currentPageData={paginatedSlice}
                filteredCount={filteredHierarchyData.length}
                totalCount={hierarchyData.length}
                appliedFilters={rhActiveFilters}
                availableColumns={[
                  { key: 'roleName', label: 'Role', defaultSelected: true },
                  { key: 'roleCode', label: 'Role Code', defaultSelected: true },
                  { key: 'category', label: 'Category', defaultSelected: true },
                  { key: 'parentRole', label: 'Parent Role', defaultSelected: true },
                  { key: 'childRole', label: 'Child Role', defaultSelected: true },
                  { key: 'relationshipType', label: 'Relationship Type', defaultSelected: true }
                ]}
                onFetchScopeData={async (scope) => {
                  if (scope === 'PAGE') return paginatedSlice;
                  if (scope === 'FILTERED') return filteredHierarchyData;
                  return hierarchyData;
                }}
              />
            )}

            {activeReportId === 'AUDIT_HISTORY' && (
              <EnterpriseExportControl
                filename="audit_history"
                sheetName="Audit History"
                reportTitle="Oracle Fusion Enterprise Security Audit History"
                dataSource="Oracle Fusion Audit Vault"
                entityName="Audit Events"
                buttonText="Export Audit"
                currentPageData={paginatedSlice}
                filteredCount={filteredAuditLogs.length}
                totalCount={auditLogs.length}
                availableColumns={[
                  { key: 'timestamp', label: 'Timestamp', defaultSelected: true, getValue: (l: any) => l.timestamp ? new Date(l.timestamp).toLocaleString() : '' },
                  { key: 'username', label: 'Username', defaultSelected: true },
                  { key: 'action', label: 'Action', defaultSelected: true },
                  { key: 'event', label: 'Event', defaultSelected: true },
                  { key: 'businessObject', label: 'Business Object', defaultSelected: true },
                  { key: 'qualifiedBusinessObject', label: 'Qualified Object', defaultSelected: false, getValue: (l: any) => l.qualifiedBusinessObject || '' },
                  { key: 'identifier', label: 'Identifier', defaultSelected: false, getValue: (l: any) => l.identifier || '' },
                  { key: 'details', label: 'Details', defaultSelected: true }
                ]}
                onFetchScopeData={async (scope) => {
                  if (scope === 'PAGE') return paginatedSlice;
                  if (scope === 'FILTERED') return filteredAuditLogs;
                  return auditLogs;
                }}
              />
            )}

            {activeReportId === 'USER_ACCESS' && (
              <EnterpriseExportControl
                filename="oracle_user_access_report"
                sheetName="User Access"
                reportTitle="Oracle Fusion User Access & Assignment Report"
                dataSource="Oracle Fusion Cloud (SCIM & Public Workers)"
                entityName="User Access Records"
                buttonText="Export Access Report"
                currentPageData={paginatedSlice}
                filteredCount={filteredUserAccessData.length}
                totalCount={userAccessData.length}
                appliedFilters={userAccessActiveFilters}
                availableColumns={[
                  { key: 'username', label: 'Username', defaultSelected: true },
                  { key: 'displayName', label: 'Display Name', defaultSelected: true, getValue: (r: any) => r.displayName || '—' },
                  { key: 'email', label: 'Email', defaultSelected: true, getValue: (r: any) => r.email || '—' },
                  { key: 'active', label: 'Status', defaultSelected: true, getValue: (r: any) => r.active ? 'Active' : 'Inactive' },
                  { key: 'roleName', label: 'Role Name', defaultSelected: true, getValue: (r: any) => r.roleName || '—' },
                  { key: 'roleCode', label: 'Role Code', defaultSelected: true, getValue: (r: any) => r.roleCode || '—' },
                  { key: 'personId', label: 'Person ID', defaultSelected: true, getValue: (r: any) => r.personId || '—' },
                  { key: 'personNumber', label: 'Person Number', defaultSelected: true, getValue: (r: any) => r.personNumber || '—' },
                  { key: 'department', label: 'Department', defaultSelected: true, getValue: (r: any) => r.department || '—' },
                  { key: 'job', label: 'Job', defaultSelected: true, getValue: (r: any) => r.job || '—' },
                  { key: 'businessUnit', label: 'Business Unit', defaultSelected: true, getValue: (r: any) => r.businessUnit || '—' },
                  { key: 'location', label: 'Location', defaultSelected: true, getValue: (r: any) => r.location || '—' },
                  { key: 'manager', label: 'Manager', defaultSelected: true, getValue: (r: any) => r.manager || '—' }
                ]}
                onFetchScopeData={async (scope) => {
                  if (scope === 'PAGE') return paginatedSlice;
                  if (scope === 'FILTERED') return filteredUserAccessData;
                  return userAccessData;
                }}
              />
            )}
          </div>
        </div>

        {/* -------------------------------------------------------------
            REPORT 1: CONTROL SUMMARY (PART 10)
            ------------------------------------------------------------- */}
        {activeReportId === 'CONTROL_SUMMARY' && (
          <div>
            {/* Top KPI Metrics Cards (Matches Risk.tsx Style) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              
              {/* Card 1: Total Controls */}
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '8px', borderLeft: '4px solid var(--accent-gold)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <Scale size={16} style={{ color: 'var(--accent-gold)' }} />
                  Total Controls
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {controlsSummaryReport?.totalControls ?? controlsData.length}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Authoritative Oracle Catalog
                </div>
              </div>

              {/* Card 2: Active Controls */}
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '8px', borderLeft: '4px solid var(--accent-green)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <CheckCircle2 size={16} style={{ color: 'var(--accent-green)' }} />
                  Active Controls
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--accent-green)' }}>
                  {controlsSummaryReport?.activeControls ?? controlsData.filter(c => (c.status || '').toUpperCase() === 'ACTIVE').length}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Active policy enforcement
                </div>
              </div>

              {/* Card 3: Inactive Controls */}
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '8px', borderLeft: '4px solid #94A3B8' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <AlertCircle size={16} style={{ color: '#94A3B8' }} />
                  Inactive Controls
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {controlsSummaryReport 
                    ? (controlsSummaryReport.totalControls - controlsSummaryReport.activeControls) 
                    : controlsData.filter(c => (c.status || '').toUpperCase() === 'INACTIVE').length}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Disabled or retired rules
                </div>
              </div>

              {/* Card 4: Controls With Incidents */}
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '8px', borderLeft: '4px solid var(--accent-red)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <ShieldAlert size={16} style={{ color: (controlsSummaryReport?.controlsWithIncidents || 0) > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }} />
                  Controls With Incidents
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: (controlsSummaryReport?.controlsWithIncidents || 0) > 0 ? 'var(--accent-red)' : 'var(--text-primary)' }}>
                  {controlsSummaryReport?.controlsWithIncidents ?? controlsData.filter(c => (c.totalIncidentCount || 0) > 0).length}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Detected continuous violations
                </div>
              </div>

            </div>

            {/* Calculation Status & Provenance Banner */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '0.75rem 1rem',
              marginBottom: '1.25rem',
              flexWrap: 'wrap',
              gap: '0.75rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Report Calculation Status:
                </span>
                
                {/* Status Badge */}
                {controlsSummaryReport?.summaryStatus === 'READY' ? (
                  <span className="badge badge-active" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem' }}>
                    <Check size={12} /> READY
                  </span>
                ) : controlsSummaryReport?.summaryStatus === 'CALCULATING' || controlsScanning ? (
                  <span className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#2563EB' }}>
                    <RefreshCw size={12} className="animate-spin" /> CALCULATING
                  </span>
                ) : controlsSummaryReport?.summaryStatus === 'PARTIAL' ? (
                  <span className="badge badge-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem' }}>
                    <AlertCircle size={12} /> PARTIAL
                  </span>
                ) : (
                  <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                    {controlsSummaryReport?.summaryStatus || 'NOT_STARTED'}
                  </span>
                )}

                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>•</span>

                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Source: <strong>{controlsSummaryReport?.dataSource || (environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Controls Data')}</strong>
                </span>

                {controlsSummaryReport?.calculatedAt && (
                  <>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>•</span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Last calculated: <strong>{new Date(controlsSummaryReport.calculatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
                    </span>
                  </>
                )}

                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>•</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Coverage: <strong>{controlsSummaryReport?.scannedControlsCount ?? controlsData.filter(c => c.countsStatus === 'READY' || c.countsStatus === 'PARTIAL').length} / {controlsSummaryReport?.totalControls ?? controlsData.length}</strong> controls scanned
                </span>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => loadControlsSummary(false, true)}
                  disabled={controlsScanning || controlsLoading}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                  title="Scan incident counts for unscanned controls via lightweight Oracle probe"
                >
                  <Play size={12} className={controlsScanning ? 'animate-spin' : ''} />
                  <span>{controlsScanning ? 'Scanning...' : 'Scan Incident Counts'}</span>
                </button>
              </div>
            </div>

            {/* Filter Toolbar */}
            <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
                <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search by Control ID, Name, Scheduled By, or Type..."
                  value={controlsSearch}
                  onChange={(e) => { setControlsSearch(e.target.value); setCurrentPage(1); }}
                  style={{ paddingLeft: '2.1rem', fontSize: '0.84rem' }}
                />
              </div>

              <select
                className="form-select"
                value={controlsStatusFilter}
                onChange={(e) => { setControlsStatusFilter(e.target.value); setCurrentPage(1); }}
                style={{ width: '135px', fontSize: '0.84rem' }}
                aria-label="Filter by control status"
              >
                <option value="ALL">Status: All</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>

              <select
                className="form-select"
                value={controlsTypeFilter}
                onChange={(e) => { setControlsTypeFilter(e.target.value as 'ALL' | 'ACCESS' | 'TRANSACTION'); setCurrentPage(1); }}
                style={{ width: '175px', fontSize: '0.84rem' }}
                aria-label="Filter by control type"
                title="Filter by verified Oracle control type (173 = Access, 174 = Transaction)"
              >
                <option value="ALL">All Control Types</option>
                <option value="ACCESS">Access Controls</option>
                <option value="TRANSACTION">Transaction Controls</option>
              </select>

              <select
                className="form-select"
                value={controlsIncidentFilter}
                onChange={(e) => { setControlsIncidentFilter(e.target.value); setCurrentPage(1); }}
                style={{ width: '175px', fontSize: '0.84rem' }}
              >
                <option value="ALL">Incidents: All</option>
                <option value="WITH_INCIDENTS">With Incidents (&gt;0)</option>
                <option value="ZERO_INCIDENTS">Zero Incidents (0)</option>
                <option value="NOT_SCANNED">Not Scanned</option>
              </select>

              <select
                className="form-select"
                value={controlsCountsStatusFilter}
                onChange={(e) => { setControlsCountsStatusFilter(e.target.value); setCurrentPage(1); }}
                style={{ width: '150px', fontSize: '0.84rem' }}
              >
                <option value="ALL">Data Status: All</option>
                <option value="READY">Ready</option>
                <option value="PARTIAL">Partial</option>
                <option value="NOT_STARTED">Not Started</option>
                <option value="ERROR">Error</option>
              </select>

              {hasActiveControlsFilters && (
                <button
                  type="button"
                  onClick={resetControlsFilters}
                  className="btn btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', padding: '0.4rem 0.75rem', color: 'var(--accent-red)' }}
                  title="Reset all search and dropdown filters"
                >
                  <RotateCcw size={13} />
                  <span>Reset Filters</span>
                </button>
              )}
            </div>

            {/* Active Filter Chips */}
            {hasActiveControlsFilters && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Active Filters:</span>
                {controlsSearch && (
                  <span className="badge badge-blue" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '2px 8px' }}>
                    Search: "{controlsSearch}"
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => { setControlsSearch(''); setCurrentPage(1); }} />
                  </span>
                )}
                {controlsStatusFilter !== 'ALL' && (
                  <span className="badge badge-blue" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '2px 8px' }}>
                    Status: {controlsStatusFilter}
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => { setControlsStatusFilter('ALL'); setCurrentPage(1); }} />
                  </span>
                )}
                {controlsTypeFilter !== 'ALL' && (
                  <span className="badge badge-blue" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '2px 8px' }}>
                    Type: {controlsTypeFilter === 'ACCESS' ? 'Access Controls' : 'Transaction Controls'}
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => { setControlsTypeFilter('ALL'); setCurrentPage(1); }} />
                  </span>
                )}
                {controlsIncidentFilter !== 'ALL' && (
                  <span className="badge badge-blue" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '2px 8px' }}>
                    Exposure: {controlsIncidentFilter}
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => { setControlsIncidentFilter('ALL'); setCurrentPage(1); }} />
                  </span>
                )}
                {controlsCountsStatusFilter !== 'ALL' && (
                  <span className="badge badge-blue" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '2px 8px' }}>
                    Data: {controlsCountsStatusFilter}
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => { setControlsCountsStatusFilter('ALL'); setCurrentPage(1); }} />
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------------------
            REPORT 2: INCIDENTS DETAILED (PART 3, 4, 5, 6)
            ------------------------------------------------------------- */}
        {activeReportId === 'INCIDENTS_DETAILED' && (
          <div>
            {/* Top KPI Metrics Cards (Matches Risk.tsx Style) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              
              {/* KPI 1: Total Incidents */}
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '8px', borderLeft: '4px solid var(--accent-gold)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <FileText size={16} style={{ color: 'var(--accent-gold)' }} />
                  Total Incidents
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {incidentsKpis.total !== undefined ? incidentsKpis.total.toLocaleString() : (incidentsLoading ? 'Calculating...' : 'Not available')}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Authoritative continuous monitoring
                </div>
              </div>

              {/* KPI 2: Open / Active Incidents */}
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '8px', borderLeft: '4px solid var(--accent-red)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <ShieldAlert size={16} style={{ color: 'var(--accent-red)' }} />
                  Open / Active Incidents
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: (incidentsKpis.openOrActive || 0) > 0 ? 'var(--accent-red)' : 'var(--text-primary)' }}>
                  {incidentsKpis.openOrActive !== undefined ? incidentsKpis.openOrActive.toLocaleString() : (incidentsLoading ? 'Calculating...' : 'Not available')}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  In investigation & assigned
                </div>
              </div>

              {/* KPI 3: Accepted */}
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '8px', borderLeft: '4px solid #F59E0B' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <CheckCircle2 size={16} style={{ color: '#F59E0B' }} />
                  Accepted Exceptions
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {incidentsKpis.accepted !== undefined ? incidentsKpis.accepted.toLocaleString() : '0'}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Policy exception accepted
                </div>
              </div>

              {/* KPI 4: Closed / Resolved */}
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '8px', borderLeft: '4px solid var(--accent-green)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <ShieldCheck size={16} style={{ color: 'var(--accent-green)' }} />
                  Closed / Resolved
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {incidentsKpis.closedOrResolved !== undefined ? incidentsKpis.closedOrResolved.toLocaleString() : '0'}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Remediated compliance records
                </div>
              </div>

            </div>

            {/* Sync Progress Banner if caching or syncing */}
            {incidentsSyncState.cacheStatus && incidentsSyncState.cacheStatus !== 'READY' && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                backgroundColor: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
                borderRadius: '8px',
                padding: '0.75rem 1rem',
                marginBottom: '1.25rem',
                fontSize: '0.82rem',
                color: 'var(--accent-blue)'
              }}>
                <RefreshCw size={14} className={incidentsSyncState.cacheStatus === 'SYNCING' ? 'animate-spin' : ''} />
                <span>
                  {incidentsSyncState.message || (incidentsSyncState.cacheStatus === 'SYNCING' ? 'Synchronizing incidents in the background with Oracle Fusion...' : 'Continuous monitoring incidents status: ' + incidentsSyncState.cacheStatus)}
                </span>
                {incidentsSyncState.fetchedCount !== undefined && incidentsSyncState.totalCount !== undefined && (
                  <span style={{ fontWeight: 600 }}>
                    ({incidentsSyncState.fetchedCount.toLocaleString()} / {incidentsSyncState.totalCount.toLocaleString()})
                  </span>
                )}
              </div>
            )}

            {/* Filter Toolbar (Unified & Compact) */}
            <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.25rem' }}>
              
              {/* Control Scope Selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Control:</span>
                <select
                  className="form-select"
                  value={selectedIncidentsControlId}
                  onChange={(e) => {
                    const newId = e.target.value;
                    setSelectedIncidentsControlId(newId);
                    setCurrentPage(1);
                    loadRiskIncidents(newId);
                  }}
                  style={{ width: '280px', fontSize: '0.82rem' }}
                >
                  <option value="ALL">All Cached Controls</option>
                  {availableIncidentControls.map(c => (
                    <option key={c.id} value={c.id}>
                      #{c.id} - {c.name ? c.name.substring(0, 32) : 'Control'}{c.incidentCount !== undefined ? ` (${c.incidentCount.toLocaleString()})` : ''}
                    </option>
                  ))}
                  {/* Fallback if available controls list not yet populated */}
                  {availableIncidentControls.length === 0 && (
                    <>
                      <option value="114281">#114281 - Manage HSDL Templates (2,552)</option>
                      <option value="114285">#114285 - Sensitive Time & Labor (3,121)</option>
                      <option value="114305">#114305 - Approve Payables Invoices (35,118)</option>
                      <option value="114313">#114313 - Payables & Payments (19,700)</option>
                      <option value="114269">#114269 - Position & Time Labor (72,701)</option>
                      <option value="113308">#113308 - Contract Purchase (0 incidents)</option>
                    </>
                  )}
                </select>
              </div>

              {/* Universal Search Input */}
              <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
                <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search by ID, User, Role, or Information..."
                  value={incidentsSearch}
                  onChange={(e) => { setIncidentsSearch(e.target.value); setCurrentPage(1); }}
                  style={{ paddingLeft: '2.1rem', fontSize: '0.84rem' }}
                />
              </div>

              {/* Status Filter */}
              <select
                className="form-select"
                value={incidentsStatusFilter}
                onChange={(e) => { setIncidentsStatusFilter(e.target.value); setCurrentPage(1); }}
                style={{ width: '135px', fontSize: '0.84rem' }}
              >
                <option value="ALL">Status: All</option>
                <option value="ASSIGNED">Assigned</option>
                <option value="CLOSED">Closed</option>
                <option value="RESOLVED">Resolved</option>
              </select>

              {/* State Filter */}
              <select
                className="form-select"
                value={incidentsStateFilter}
                onChange={(e) => { setIncidentsStateFilter(e.target.value); setCurrentPage(1); }}
                style={{ width: '160px', fontSize: '0.84rem' }}
              >
                <option value="ALL">State: All</option>
                <option value="IN_INVESTIGATION">In Investigation</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="CLOSED">Closed</option>
              </select>

              {hasActiveIncidentsFilters && (
                <button
                  type="button"
                  onClick={resetIncidentsFilters}
                  className="btn btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', padding: '0.4rem 0.75rem', color: 'var(--accent-red)' }}
                  title="Reset search and status filters"
                >
                  <RotateCcw size={13} />
                  <span>Reset Filters</span>
                </button>
              )}
            </div>

            {/* Active Incidents Filter Chips */}
            {hasActiveIncidentsFilters && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Active Filters:</span>
                {incidentsSearch && (
                  <span className="badge badge-blue" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '2px 8px' }}>
                    Search: "{incidentsSearch}"
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => { setIncidentsSearch(''); setCurrentPage(1); }} />
                  </span>
                )}
                {incidentsStatusFilter !== 'ALL' && (
                  <span className="badge badge-blue" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '2px 8px' }}>
                    Status: {incidentsStatusFilter}
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => { setIncidentsStatusFilter('ALL'); setCurrentPage(1); }} />
                  </span>
                )}
                {incidentsStateFilter !== 'ALL' && (
                  <span className="badge badge-blue" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '2px 8px' }}>
                    State: {incidentsStateFilter}
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => { setIncidentsStateFilter('ALL'); setCurrentPage(1); }} />
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------------------
            REPORT 3: USER ROLE MAPPING FILTERS
            ------------------------------------------------------------- */}
        {activeReportId === 'USER_ROLE_MAPPING' && (
          <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
              <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Search user, email, role name, or role code..."
                value={urmSearch}
                onChange={(e) => { setUrmSearch(e.target.value); setCurrentPage(1); }}
                style={{ paddingLeft: '2.1rem', fontSize: '0.84rem' }}
              />
            </div>

            <select
              className="form-select"
              value={urmStatusFilter}
              onChange={(e) => { setUrmStatusFilter(e.target.value); setCurrentPage(1); }}
              style={{ width: '135px', fontSize: '0.84rem' }}
            >
              <option value="ALL">Status: All</option>
              <option value="ACTIVE">Active Users</option>
              <option value="INACTIVE">Inactive Users</option>
            </select>

            <select
              className="form-select"
              value={urmCategoryFilter}
              onChange={(e) => { setUrmCategoryFilter(e.target.value); setCurrentPage(1); }}
              style={{ width: '150px', fontSize: '0.84rem' }}
            >
              <option value="ALL">Category: All</option>
              <option value="Job">Job Roles</option>
              <option value="Duty">Duty Roles</option>
              <option value="Abstract">Abstract Roles</option>
              <option value="Data">Data Roles</option>
              <option value="GRC">GRC Roles</option>
            </select>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={loadUserRoleMappings}
              disabled={userRoleLoading}
              style={{ fontSize: '0.82rem' }}
            >
              <RefreshCw size={14} className={userRoleLoading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        )}

        {/* -------------------------------------------------------------
            REPORT 4: ROLE HIERARCHY FILTERS
            ------------------------------------------------------------- */}
        {activeReportId === 'ROLE_HIERARCHY' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              {/* View Mode Toggle */}
              <div style={{ display: 'flex', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', padding: '3px', border: '1px solid var(--border-color)', gap: '0.25rem' }}>
                <button
                  type="button"
                  onClick={() => setRhViewMode('TABLE')}
                  style={{
                    padding: '0.35rem 0.85rem',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    backgroundColor: rhViewMode === 'TABLE' ? 'var(--accent-blue)' : 'transparent',
                    color: rhViewMode === 'TABLE' ? '#ffffff' : 'var(--text-secondary)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Layers size={14} /> Parent-Child Table
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRhViewMode('TREE');
                    if (rhSelectedRoleForTree && !rhTreeData) {
                      loadRoleTree(rhSelectedRoleForTree);
                    }
                  }}
                  style={{
                    padding: '0.35rem 0.85rem',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    backgroundColor: rhViewMode === 'TREE' ? 'var(--accent-blue)' : 'transparent',
                    color: rhViewMode === 'TREE' ? '#ffffff' : 'var(--text-secondary)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <FolderTree size={14} /> Interactive Tree View
                </button>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => loadRoleHierarchy(false)}
                  disabled={hierarchyLoading || rhSyncing}
                  style={{ fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  title="Reload role hierarchy records"
                >
                  <RefreshCw size={14} className={hierarchyLoading ? 'animate-spin' : ''} />
                  <span>Refresh</span>
                </button>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSyncHierarchyLive}
                  disabled={hierarchyLoading || rhSyncing}
                  style={{ fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}
                  title="Re-run live BIP query against Oracle Fusion"
                >
                  <Database size={14} className={rhSyncing ? 'animate-spin' : ''} />
                  <span>{rhSyncing ? 'Syncing BIP Live...' : 'Sync Oracle Fusion BIP'}</span>
                </button>
              </div>
            </div>

            {/* Filter controls row */}
            <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
                <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="form-input"
                  placeholder={rhViewMode === 'TABLE' ? 'Search parent role, child role, or relation type...' : 'Type to search role tree...'}
                  value={rhSearch}
                  onChange={(e) => {
                    setRhSearch(e.target.value);
                    setCurrentPage(1);
                    if (rhViewMode === 'TREE' && e.target.value.length > 2) {
                      const match = hierarchyData.find((h: any) =>
                        h.roleName.toLowerCase().includes(e.target.value.toLowerCase()) ||
                        h.childRole.toLowerCase().includes(e.target.value.toLowerCase()) ||
                        h.parentRole.toLowerCase().includes(e.target.value.toLowerCase())
                      );
                      if (match) {
                        loadRoleTree(match.roleName || match.childRole);
                      }
                    }
                  }}
                  style={{ paddingLeft: '2.1rem', fontSize: '0.84rem' }}
                />
              </div>

              <select
                className="form-select"
                value={rhCategoryFilter}
                onChange={(e) => { setRhCategoryFilter(e.target.value); setCurrentPage(1); }}
                style={{ width: '160px', fontSize: '0.84rem' }}
              >
                <option value="ALL">Category: All</option>
                <option value="Job">Job Roles</option>
                <option value="Duty">Duty Roles</option>
                <option value="Abstract">Abstract Roles</option>
                <option value="Data">Data Roles</option>
                <option value="GRC">GRC Roles</option>
              </select>

              {rhViewMode === 'TREE' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Focus Role:</span>
                  <select
                    className="form-select"
                    value={rhSelectedRoleForTree}
                    onChange={(e) => loadRoleTree(e.target.value)}
                    style={{ maxWidth: '240px', fontSize: '0.84rem', fontWeight: 600 }}
                  >
                    {Array.from(new Set(filteredHierarchyData.slice(0, 100).map((h: any) => h.roleName))).map((name: any) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------
            REPORT 5: AUDIT HISTORY FILTERS
            ------------------------------------------------------------- */}
        {activeReportId === 'AUDIT_HISTORY' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Product:</label>
                <select
                  className="form-select"
                  value={selectedAuditProduct}
                  onChange={(e) => setSelectedAuditProduct(e.target.value)}
                  style={{ width: '170px', fontSize: '0.84rem' }}
                >
                  {auditProducts.map(p => (
                    <option key={p.id} value={p.id}>{p.displayName || p.productName}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Business Object:</label>
                <select
                  className="form-select"
                  value={selectedAuditBO}
                  onChange={(e) => setSelectedAuditBO(e.target.value)}
                  style={{ width: '180px', fontSize: '0.84rem' }}
                >
                  {auditProducts.find(p => p.id === selectedAuditProduct)?.businessObjects?.map((b: any) => (
                    <option key={b.id} value={b.id}>{b.displayName}</option>
                  )) || <option value="">All Events</option>}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>From Date:</label>
                <input
                  type="date"
                  className="form-input"
                  value={auditFromDate}
                  onChange={(e) => setAuditFromDate(e.target.value)}
                  style={{ width: '140px', fontSize: '0.82rem', height: '36px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>To Date:</label>
                <input
                  type="date"
                  className="form-input"
                  value={auditToDate}
                  onChange={(e) => setAuditToDate(e.target.value)}
                  style={{ width: '140px', fontSize: '0.82rem', height: '36px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1, minWidth: '160px' }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Username:</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. JSMITH"
                  value={auditUserQuery}
                  onChange={(e) => setAuditUserQuery(e.target.value)}
                  style={{ fontSize: '0.84rem', height: '36px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Action:</label>
                <select
                  className="form-select"
                  value={auditActionFilter}
                  onChange={(e) => setAuditActionFilter(e.target.value)}
                  style={{ width: '140px', fontSize: '0.84rem' }}
                >
                  <option value="ALL">All Actions</option>
                  <option value="CREATE">CREATE</option>
                  <option value="UPDATE">UPDATE</option>
                  <option value="DELETE">DELETE</option>
                  <option value="ROLE_ASSIGN">ROLE_ASSIGN</option>
                  <option value="ROLE_REVOKE">ROLE_REVOKE</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-end', paddingTop: '1.2rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={loadAuditHistory}
                  disabled={auditLoading}
                  style={{ height: '36px', fontSize: '0.84rem' }}
                >
                  <RefreshCw size={14} className={auditLoading ? 'animate-spin' : ''} />
                  <span>Run Query</span>
                </button>
              </div>
            </div>

            {auditDateWarning && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#D97706', fontSize: '0.76rem' }}>
                <AlertCircle size={13} />
                <span>{auditDateWarning}</span>
              </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------------------
            REPORT 6: USER ACCESS REPORT KPIS & FILTERS
            ------------------------------------------------------------- */}
        {activeReportId === 'USER_ACCESS' && (
          <div>
            {/* Top KPI Metrics Cards (Matches VEYRA Design) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              
              {/* Card 1: Total Users */}
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '8px', borderLeft: '4px solid var(--accent-gold)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <Users size={16} style={{ color: 'var(--accent-gold)' }} />
                  Total Users
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {userAccessSummary ? userAccessSummary.totalUsers.toLocaleString() : (userAccessLoading ? '...' : 0)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Master SCIM Population
                </div>
              </div>

              {/* Card 2: Users With Roles */}
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '8px', borderLeft: '4px solid var(--accent-blue)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <UserCheck size={16} style={{ color: 'var(--accent-blue)' }} />
                  Users With Roles
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--accent-blue)' }}>
                  {userAccessSummary ? userAccessSummary.usersWithRoles.toLocaleString() : (userAccessLoading ? '...' : 0)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Assigned 1+ security roles
                </div>
              </div>

              {/* Card 3: Users Without Roles */}
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '8px', borderLeft: '4px solid #F59E0B' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <AlertCircle size={16} style={{ color: '#F59E0B' }} />
                  Users Without Roles
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: (userAccessSummary?.usersWithoutRoles || 0) > 0 ? '#F59E0B' : 'var(--text-primary)' }}>
                  {userAccessSummary ? userAccessSummary.usersWithoutRoles.toLocaleString() : (userAccessLoading ? '...' : 0)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Retained in report
                </div>
              </div>

              {/* Card 4: Total Role Assignments */}
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '8px', borderLeft: '4px solid #8B5CF6' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <Layers size={16} style={{ color: '#8B5CF6' }} />
                  Total Role Assignments
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#8B5CF6' }}>
                  {userAccessSummary ? userAccessSummary.totalRoleAssignments.toLocaleString() : (userAccessLoading ? '...' : 0)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Total user-role grants
                </div>
              </div>

              {/* Card 5: Active Users */}
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '8px', borderLeft: '4px solid var(--accent-green)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <CheckCircle2 size={16} style={{ color: 'var(--accent-green)' }} />
                  Active Users
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--accent-green)' }}>
                  {userAccessSummary ? userAccessSummary.activeUsers.toLocaleString() : (userAccessLoading ? '...' : 0)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Enabled login accounts
                </div>
              </div>

              {/* Card 6: Inactive Users */}
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '8px', borderLeft: '4px solid #94A3B8' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <User size={16} style={{ color: '#94A3B8' }} />
                  Inactive Users
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {userAccessSummary ? userAccessSummary.inactiveUsers.toLocaleString() : (userAccessLoading ? '...' : 0)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Disabled or locked accounts
                </div>
              </div>

            </div>

            {/* Filter Toolbar for User Access Report */}
            <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
                <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search user, email, role, job, department, manager..."
                  value={userAccessSearch}
                  onChange={(e) => { setUserAccessSearch(e.target.value); setCurrentPage(1); }}
                  style={{ paddingLeft: '2.1rem', fontSize: '0.84rem' }}
                />
              </div>

              <select
                className="form-select"
                value={userAccessStatusFilter}
                onChange={(e) => { setUserAccessStatusFilter(e.target.value); setCurrentPage(1); }}
                style={{ width: '135px', fontSize: '0.84rem' }}
              >
                <option value="ALL">Status: All</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>

              <select
                className="form-select"
                value={userAccessRoleFilter}
                onChange={(e) => { setUserAccessRoleFilter(e.target.value); setCurrentPage(1); }}
                style={{ width: '160px', fontSize: '0.84rem' }}
              >
                <option value="ALL">Role: All</option>
                {userAccessRoleOptions.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>

              <select
                className="form-select"
                value={userAccessBuFilter}
                onChange={(e) => { setUserAccessBuFilter(e.target.value); setCurrentPage(1); }}
                style={{ width: '160px', fontSize: '0.84rem' }}
              >
                <option value="ALL">Business Unit: All</option>
                {userAccessBuOptions.map(bu => (
                  <option key={bu} value={bu}>{bu}</option>
                ))}
              </select>

              <select
                className="form-select"
                value={userAccessDeptFilter}
                onChange={(e) => { setUserAccessDeptFilter(e.target.value); setCurrentPage(1); }}
                style={{ width: '160px', fontSize: '0.84rem' }}
              >
                <option value="ALL">Department: All</option>
                {userAccessDeptOptions.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>

              <select
                className="form-select"
                value={userAccessManagerFilter}
                onChange={(e) => { setUserAccessManagerFilter(e.target.value); setCurrentPage(1); }}
                style={{ width: '160px', fontSize: '0.84rem' }}
              >
                <option value="ALL">Manager: All</option>
                {userAccessManagerOptions.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>

              {hasActiveUserAccessFilters && (
                <button
                  type="button"
                  onClick={resetUserAccessFilters}
                  className="btn btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', padding: '0.4rem 0.75rem', color: 'var(--accent-red)' }}
                  title="Reset all filters"
                >
                  <RotateCcw size={13} />
                  <span>Reset Filters</span>
                </button>
              )}
            </div>

            {/* Active User Access Filter Chips */}
            {hasActiveUserAccessFilters && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Active Filters:</span>
                {userAccessSearch && (
                  <span className="badge badge-blue" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '2px 8px' }}>
                    Search: "{userAccessSearch}"
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => { setUserAccessSearch(''); setCurrentPage(1); }} />
                  </span>
                )}
                {userAccessStatusFilter !== 'ALL' && (
                  <span className="badge badge-blue" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '2px 8px' }}>
                    Status: {userAccessStatusFilter}
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => { setUserAccessStatusFilter('ALL'); setCurrentPage(1); }} />
                  </span>
                )}
                {userAccessRoleFilter !== 'ALL' && (
                  <span className="badge badge-blue" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '2px 8px' }}>
                    Role: {userAccessRoleFilter}
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => { setUserAccessRoleFilter('ALL'); setCurrentPage(1); }} />
                  </span>
                )}
                {userAccessBuFilter !== 'ALL' && (
                  <span className="badge badge-blue" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '2px 8px' }}>
                    BU: {userAccessBuFilter}
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => { setUserAccessBuFilter('ALL'); setCurrentPage(1); }} />
                  </span>
                )}
                {userAccessDeptFilter !== 'ALL' && (
                  <span className="badge badge-blue" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '2px 8px' }}>
                    Dept: {userAccessDeptFilter}
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => { setUserAccessDeptFilter('ALL'); setCurrentPage(1); }} />
                  </span>
                )}
                {userAccessManagerFilter !== 'ALL' && (
                  <span className="badge badge-blue" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '2px 8px' }}>
                    Manager: {userAccessManagerFilter}
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => { setUserAccessManagerFilter('ALL'); setCurrentPage(1); }} />
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Error Banner */}
        {(controlsError || incidentsError || userRoleError || hierarchyError || auditError || userAccessError) && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 1rem',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FCA5A5',
            borderRadius: '8px',
            color: '#B91C1C',
            fontSize: '0.82rem',
            marginBottom: '1rem'
          }}>
            <AlertCircle size={16} />
            <span>{controlsError || incidentsError || userRoleError || hierarchyError || auditError || userAccessError}</span>
          </div>
        )}

        {/* -------------------------------------------------------------
            4. REPORT DATA TABLES
            ------------------------------------------------------------- */}
        <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', minHeight: '300px', overflow: 'hidden' }}>
          
          {/* Table 1: Control Summary */}
          {activeReportId === 'CONTROL_SUMMARY' && (
            <div style={{ overflowX: 'auto' }}>
              <table className="enterprise-table" style={{ minWidth: '1200px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '100px' }}>Control ID</th>
                    <th style={{ minWidth: '260px' }}>Control Name</th>
                    <th style={{ width: '90px' }}>Status</th>
                    <th style={{ width: '90px' }}>State</th>
                    <th style={{ width: '110px' }}>Control Type</th>
                    <th style={{ width: '130px', textAlign: 'right' }}>Total Incidents</th>
                    <th style={{ width: '130px', textAlign: 'right' }}>Assigned / In Rem.</th>
                    <th style={{ width: '100px', textAlign: 'right' }}>Accepted</th>
                    <th style={{ width: '120px', textAlign: 'right' }}>Closed / Resolved</th>
                    <th style={{ width: '140px' }}>Last Run Date</th>
                    <th style={{ width: '130px' }}>Scheduled By</th>
                    <th style={{ width: '110px' }}>Last Run By</th>
                    <th style={{ width: '110px' }}>Data Status</th>
                    <th style={{ width: '80px', textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {controlsLoading && controlsData.length === 0 ? (
                    Array.from({ length: 8 }).map((_, idx) => (
                      <tr key={`skel-${idx}`} className="animate-pulse">
                        <td><div style={{ height: '14px', width: '60px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '220px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '18px', width: '50px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '10px' }}></div></td>
                        <td><div style={{ height: '18px', width: '60px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '10px' }}></div></td>
                        <td><div style={{ height: '14px', width: '40px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '50px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', marginLeft: 'auto' }}></div></td>
                        <td><div style={{ height: '14px', width: '40px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', marginLeft: 'auto' }}></div></td>
                        <td><div style={{ height: '14px', width: '30px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', marginLeft: 'auto' }}></div></td>
                        <td><div style={{ height: '14px', width: '30px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', marginLeft: 'auto' }}></div></td>
                        <td><div style={{ height: '14px', width: '90px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '80px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '70px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '18px', width: '65px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '10px' }}></div></td>
                        <td><div style={{ height: '22px', width: '40px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', margin: '0 auto' }}></div></td>
                      </tr>
                    ))
                  ) : paginatedSlice.length === 0 ? (
                    <tr>
                      <td colSpan={14} style={{ textAlign: 'center', padding: '3.5rem 1rem' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'var(--bg-secondary)', marginBottom: '0.75rem', color: 'var(--text-muted)' }}>
                          <Shield size={24} />
                        </div>
                        <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          No Advanced Controls Found
                        </h4>
                        <p style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                          No controls match the selected filters or search query.
                        </p>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setControlsSearch('');
                            setControlsStatusFilter('ALL');
                            setControlsTypeFilter('ALL');
                            setControlsCountsStatusFilter('ALL');
                            setControlsIncidentFilter('ALL');
                            setCurrentPage(1);
                          }}
                          style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}
                        >
                          Clear All Filters
                        </button>
                      </td>
                    </tr>
                  ) : (
                    paginatedSlice.map((ctrl: any) => {
                      const isProbing = probingControlId === ctrl.controlId;
                      const hasIncidents = ctrl.totalIncidentCount !== null && ctrl.totalIncidentCount > 0;

                      return (
                        <tr key={ctrl.controlId || ctrl.id}>
                          {/* 1. Control ID */}
                          <td>
                            <span style={{ fontWeight: 700, color: 'var(--accent-blue)', fontSize: '0.84rem' }}>
                              {ctrl.controlId || ctrl.id}
                            </span>
                          </td>

                          {/* 2. Control Name */}
                          <td>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.84rem' }}>
                              {ctrl.controlName || ctrl.name}
                            </div>
                            {ctrl.description && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem', maxWidth: '340px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={ctrl.description}>
                                {ctrl.description}
                              </div>
                            )}
                          </td>

                          {/* 3. Status */}
                          <td>
                            <span className={`badge ${(ctrl.status || '').toUpperCase() === 'ACTIVE' ? 'badge-active' : 'badge-inactive'}`} style={{ fontSize: '0.68rem' }}>
                              {(ctrl.status || 'ACTIVE').toUpperCase()}
                            </span>
                          </td>

                          {/* 4. State */}
                          <td>
                            <span className="badge badge-gold" style={{ fontSize: '0.68rem' }}>
                              {(ctrl.state || 'APPROVED').toUpperCase()}
                            </span>
                          </td>

                          {/* 5. Control Type (verified Oracle Type value: 173 = Access, 174 = Transaction) */}
                          <td>
                            {(() => {
                              const code = ctrl.controlTypeCode;
                              const hasCode = code !== null && code !== undefined && String(code).trim() !== '';
                              const label = hasCode ? formatControlTypeName(code) : (ctrl.controlTypeName || 'Other');
                              const access = isAccessControl(code);
                              const transaction = !access && (isTransactionControl(code) || label === 'Transaction Control');
                              return (
                                <span
                                  className="badge"
                                  style={{
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
                                    backgroundColor: access ? 'rgba(37, 99, 235, 0.1)' : transaction ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-tertiary)',
                                    color: access ? '#1D4ED8' : transaction ? '#4F46E5' : 'var(--text-secondary)',
                                    border: access ? '1px solid rgba(37, 99, 235, 0.25)' : transaction ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid var(--border-color)'
                                  }}
                                  title={hasCode ? `Oracle Type: ${code}` : 'Oracle type code not provided'}
                                >
                                  {label}
                                </span>
                              );
                            })()}
                          </td>

                          {/* 6. Total Incidents */}
                          <td style={{ textAlign: 'right' }}>
                            {ctrl.countsStatus === 'READY' ? (
                              <span style={{ fontWeight: 700, fontSize: '0.86rem', color: hasIncidents ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                                {ctrl.totalIncidentCount?.toLocaleString()}
                              </span>
                            ) : ctrl.countsStatus === 'PARTIAL' ? (
                              <span
                                style={{ fontWeight: 700, fontSize: '0.84rem', color: hasIncidents ? 'var(--accent-red)' : 'var(--text-primary)' }}
                                title="Total incident count is verified from Oracle Fusion. Status-level breakdown has not yet been calculated."
                              >
                                {ctrl.totalIncidentCount !== null && ctrl.totalIncidentCount !== undefined ? ctrl.totalIncidentCount.toLocaleString() : '—'}
                              </span>
                            ) : ctrl.countsStatus === 'CALCULATING' ? (
                              <span style={{ fontSize: '0.74rem', color: 'var(--accent-blue)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                <RefreshCw size={11} className="animate-spin" /> Calculating...
                              </span>
                            ) : ctrl.countsStatus === 'ERROR' ? (
                              <span className="badge badge-danger" style={{ fontSize: '0.65rem' }}>Error</span>
                            ) : (
                              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Not scanned</span>
                            )}
                          </td>

                          {/* 7. Assigned / In Remediation */}
                          <td style={{ textAlign: 'right', fontSize: '0.82rem' }}>
                            {ctrl.assignedOrInRemediationCount !== null && ctrl.assignedOrInRemediationCount !== undefined ? (
                              <span style={{ color: ctrl.assignedOrInRemediationCount > 0 ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
                                {ctrl.assignedOrInRemediationCount.toLocaleString()}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>

                          {/* 8. Accepted */}
                          <td style={{ textAlign: 'right', fontSize: '0.82rem' }}>
                            {ctrl.acceptedCount !== null && ctrl.acceptedCount !== undefined ? (
                              <span>{ctrl.acceptedCount.toLocaleString()}</span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>

                          {/* 9. Closed / Resolved */}
                          <td style={{ textAlign: 'right', fontSize: '0.82rem' }}>
                            {ctrl.closedOrResolvedCount !== null && ctrl.closedOrResolvedCount !== undefined ? (
                              <span style={{ color: ctrl.closedOrResolvedCount > 0 ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                                {ctrl.closedOrResolvedCount.toLocaleString()}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>

                          {/* 10. Last Run Date */}
                          <td style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {formatOracleDate(ctrl.lastRunDate)}
                          </td>

                          {/* 11. Scheduled By */}
                          <td style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                            {ctrl.scheduledBy || '—'}
                          </td>

                          {/* 12. Last Run By */}
                          <td style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontStyle: 'italic' }} title="Oracle Advanced Controls REST API does not provide a LastRunBy attribute">
                            Not available
                          </td>

                          {/* 13. Data Status */}
                          <td>
                            {ctrl.countsStatus === 'READY' ? (
                              <span className="badge badge-active" style={{ fontSize: '0.64rem', padding: '0.1rem 0.4rem' }}>
                                Ready
                              </span>
                            ) : ctrl.countsStatus === 'PARTIAL' ? (
                              <span className="badge badge-gold" style={{ fontSize: '0.64rem', padding: '0.1rem 0.4rem' }}>
                                Partial
                              </span>
                            ) : ctrl.countsStatus === 'CALCULATING' ? (
                              <span className="badge" style={{ fontSize: '0.64rem', padding: '0.1rem 0.4rem', backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#2563EB' }}>
                                Syncing
                              </span>
                            ) : ctrl.countsStatus === 'ERROR' ? (
                              <span className="badge badge-danger" style={{ fontSize: '0.64rem', padding: '0.1rem 0.4rem' }}>
                                Error
                              </span>
                            ) : (
                              <span className="badge badge-neutral" style={{ fontSize: '0.64rem', padding: '0.1rem 0.4rem' }}>
                                Unscanned
                              </span>
                            )}
                          </td>

                          {/* 14. Action / Single Probe */}
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => probeSingleControl(ctrl.controlId || ctrl.id)}
                              disabled={isProbing}
                              style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                              title="Probe incident count via lightweight query"
                            >
                              {isProbing ? (
                                <RefreshCw size={10} className="animate-spin" />
                              ) : (
                                <Play size={10} />
                              )}
                              <span>{ctrl.countsStatus === 'NOT_STARTED' ? 'Probe' : 'Re-probe'}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Table 2: Incidents Detailed (PART 6) */}
          {activeReportId === 'INCIDENTS_DETAILED' && (
            <div style={{ overflowX: 'auto' }}>
              <table className="enterprise-table" style={{ minWidth: '1100px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '120px' }}>Incident ID</th>
                    <th style={{ width: '220px' }}>Control</th>
                    <th style={{ width: '160px' }}>User</th>
                    <th style={{ minWidth: '180px' }}>Role</th>
                    <th style={{ minWidth: '220px' }}>Incident Information</th>
                    <th style={{ width: '95px' }}>Status</th>
                    <th style={{ width: '130px' }}>State</th>
                    <th style={{ width: '130px' }}>Created</th>
                    <th style={{ width: '110px' }}>Closed</th>
                    <th style={{ width: '95px', textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {incidentsLoading && incidentsData.length === 0 ? (
                    Array.from({ length: 8 }).map((_, idx) => (
                      <tr key={`inc-skel-${idx}`} className="animate-pulse">
                        <td><div style={{ height: '14px', width: '80px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '160px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '110px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '140px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '180px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '18px', width: '60px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '10px' }}></div></td>
                        <td><div style={{ height: '18px', width: '85px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '10px' }}></div></td>
                        <td><div style={{ height: '14px', width: '85px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '70px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '22px', width: '60px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', margin: '0 auto' }}></div></td>
                      </tr>
                    ))
                  ) : paginatedSlice.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '3.5rem 1rem' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'var(--bg-secondary)', marginBottom: '0.75rem', color: 'var(--text-muted)' }}>
                          <ShieldAlert size={24} />
                        </div>
                        <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {selectedIncidentsControlId === '113308' ? 'Zero Incidents Confirmed' : 'No Incidents Found'}
                        </h4>
                        <p style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                          {selectedIncidentsControlId === '113308' 
                            ? 'Control #113308 has 0 active continuous monitoring violations in Oracle Fusion.' 
                            : 'No incident records match the current filter selection or search criteria.'}
                        </p>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setIncidentsSearch('');
                            setIncidentsStatusFilter('ALL');
                            setIncidentsStateFilter('ALL');
                            setCurrentPage(1);
                          }}
                          style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}
                        >
                          Clear Filters
                        </button>
                      </td>
                    </tr>
                  ) : (
                    paginatedSlice.map((inc: any) => (
                      <tr key={inc.id}>
                        {/* 1. Incident ID */}
                        <td>
                          <span style={{ fontWeight: 700, color: 'var(--accent-blue)', fontSize: '0.84rem' }}>
                            #{inc.id}
                          </span>
                        </td>

                        {/* 2. Control */}
                        <td>
                          <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                            #{inc.controlId}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={inc.controlName || `Control #${inc.controlId}`}>
                            {inc.controlName || `Control #${inc.controlId}`}
                          </div>
                        </td>

                        {/* 3. User */}
                        <td>
                          <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                            {inc.globalUserName || (inc.userFirstName ? `${inc.userFirstName} ${inc.userLastName || ''}` : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not available</span>)}
                          </div>
                          {inc.globalUserId && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              ID: {inc.globalUserId}
                            </div>
                          )}
                        </td>

                        {/* 4. Role */}
                        <td>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', maxWidth: '220px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={inc.role || 'Not available'}>
                            {renderFieldVal(inc.role)}
                          </div>
                        </td>

                        {/* 5. Incident Information */}
                        <td>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', maxWidth: '260px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={inc.incidentInformation || '—'}>
                            {renderFieldVal(inc.incidentInformation)}
                          </div>
                        </td>

                        {/* 6. Status */}
                        <td>
                          <span className={`badge ${(inc.status || '').toUpperCase() === 'ASSIGNED' ? 'badge-danger' : (inc.status || '').toUpperCase() === 'CLOSED' ? 'badge-active' : 'badge-neutral'}`} style={{ fontSize: '0.68rem' }}>
                            {renderFieldVal(inc.status)}
                          </span>
                        </td>

                        {/* 7. State */}
                        <td>
                          <span className="badge badge-gold" style={{ fontSize: '0.68rem' }}>
                            {renderFieldVal(inc.state)}
                          </span>
                        </td>

                        {/* 8. Created */}
                        <td style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {formatOracleDate(inc.creationDate)}
                        </td>

                        {/* 9. Closed */}
                        <td style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {inc.closedDate ? formatOracleDate(inc.closedDate) : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not available</span>}
                        </td>

                        {/* 10. Action: View Details */}
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setSelectedIncidentDetail(inc)}
                            style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                          >
                            <Eye size={12} />
                            <span>Details</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Table 3: User Role Mapping */}
          {activeReportId === 'USER_ROLE_MAPPING' && (
            <div style={{ overflowX: 'auto' }}>
              <table className="enterprise-table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Display Name</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Role Name</th>
                    <th>Role Code</th>
                    <th>Role Category</th>
                  </tr>
                </thead>
                <tbody>
                  {userRoleLoading ? (
                    Array.from({ length: 8 }).map((_, idx) => (
                      <tr key={`urm-skel-${idx}`} className="animate-pulse">
                        <td><div style={{ height: '14px', width: '80px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '130px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '140px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '18px', width: '50px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '10px' }}></div></td>
                        <td><div style={{ height: '14px', width: '180px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '90px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '18px', width: '60px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '10px' }}></div></td>
                      </tr>
                    ))
                  ) : paginatedSlice.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
                        No user role assignments match the selected filters.
                      </td>
                    </tr>
                  ) : (
                    paginatedSlice.map((row: any) => (
                      <tr key={row.id}>
                        <td style={{ fontWeight: 600, color: 'var(--accent-blue)' }}>{row.username}</td>
                        <td>{row.displayName}</td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{row.email}</td>
                        <td>
                          <span className={`badge ${row.status === 'Active' ? 'badge-active' : 'badge-inactive'}`} style={{ fontSize: '0.68rem' }}>
                            {row.status}
                          </span>
                        </td>
                        <td style={{ fontWeight: 500 }}>{row.roleName}</td>
                        <td><code style={{ fontSize: '0.78rem' }}>{row.roleCode}</code></td>
                        <td>
                          <span className="badge badge-gold" style={{ fontSize: '0.68rem' }}>
                            {row.category}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Table 4: Role Hierarchy */}
          {activeReportId === 'ROLE_HIERARCHY' && (
            rhViewMode === 'TREE' ? (
              renderHierarchyTreeContent(false)
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="enterprise-table">
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Role Code</th>
                      <th>Category</th>
                      <th>Parent Role</th>
                      <th>Child Role</th>
                      <th>Relationship Type</th>
                      <th>Functional Privileges</th>
                      <th style={{ textAlign: 'right' }}>Hierarchy Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hierarchyLoading ? (
                      Array.from({ length: 8 }).map((_, idx) => (
                        <tr key={`rh-skel-${idx}`} className="animate-pulse">
                          <td><div style={{ height: '14px', width: '140px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                          <td><div style={{ height: '14px', width: '80px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                          <td><div style={{ height: '18px', width: '50px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '10px' }}></div></td>
                          <td><div style={{ height: '14px', width: '130px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                          <td><div style={{ height: '14px', width: '130px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                          <td><div style={{ height: '18px', width: '80px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '10px' }}></div></td>
                          <td><div style={{ height: '18px', width: '90px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '10px' }}></div></td>
                          <td><div style={{ height: '24px', width: '70px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', marginLeft: 'auto' }}></div></td>
                        </tr>
                      ))
                    ) : hierarchyIntegrationNotice ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                          <div style={{ maxWidth: '500px', margin: '0 auto' }}>
                            <AlertCircle size={28} style={{ color: 'var(--accent-gold)', marginBottom: '0.5rem' }} />
                            <div style={{ fontWeight: 600, fontSize: '0.92rem', marginBottom: '0.25rem' }}>Hierarchy Tree Information</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{hierarchyIntegrationNotice}</div>
                          </div>
                        </td>
                      </tr>
                    ) : paginatedSlice.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
                          No hierarchy relationships found.
                        </td>
                      </tr>
                    ) : (
                      paginatedSlice.map((item: any) => (
                        <tr key={item.id}>
                          <td style={{ fontWeight: 600 }}>
                            <span
                              style={{ color: 'var(--accent-blue)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                              onClick={() => handleOpenTreeModal(item.roleName)}
                              title="Click to view hierarchy tree"
                            >
                              <Shield size={13} style={{ flexShrink: 0 }} />
                              {item.roleName}
                            </span>
                          </td>
                          <td><code style={{ fontSize: '0.78rem' }}>{item.roleCode}</code></td>
                          <td>
                            <span className={`badge ${item.category === 'Job' ? 'badge-primary' : item.category === 'Duty' ? 'badge-gold' : 'badge-neutral'}`} style={{ fontSize: '0.68rem' }}>
                              {item.category}
                            </span>
                          </td>
                          <td>
                            <span
                              style={{ cursor: 'pointer', color: 'var(--text-primary)', textDecoration: 'underline dotted', textUnderlineOffset: '3px' }}
                              onClick={() => handleOpenTreeModal(item.parentRole)}
                              title="Click to inspect parent role tree"
                            >
                              {item.parentRole}
                            </span>
                          </td>
                          <td>
                            <span
                              style={{ cursor: 'pointer', color: 'var(--text-primary)', textDecoration: 'underline dotted', textUnderlineOffset: '3px' }}
                              onClick={() => handleOpenTreeModal(item.childRole)}
                              title="Click to inspect child role tree"
                            >
                              {item.childRole}
                            </span>
                          </td>
                          <td><span className="badge badge-neutral" style={{ fontSize: '0.68rem' }}>{item.relationshipType}</span></td>
                          <td>
                            {item.privileges && item.privileges.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => handleOpenTreeModal(item.roleName || item.childRole)}
                                className="badge badge-blue"
                                style={{
                                  fontSize: '0.7rem',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.3rem',
                                  border: '1px solid rgba(37, 99, 235, 0.25)',
                                  backgroundColor: 'rgba(37, 99, 235, 0.08)',
                                  color: 'var(--accent-blue)',
                                  padding: '3px 8px',
                                  borderRadius: '6px'
                                }}
                                title={item.privileges.slice(0, 8).map((p: any) => `• ${p.name || p.code} (${p.code})`).join('\n') + (item.privileges.length > 8 ? `\n...and ${item.privileges.length - 8} more privileges` : '')}
                              >
                                <Key size={11} style={{ flexShrink: 0 }} />
                                <span>{item.privileges.length} Privileges</span>
                              </button>
                            ) : (
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => handleOpenTreeModal(item.roleName || item.childRole)}
                              style={{ padding: '0.25rem 0.6rem', fontSize: '0.74rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                              title="Open interactive hierarchy tree"
                            >
                              <FolderTree size={12} />
                              <span>View Tree</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* Table 5: Audit History */}
          {activeReportId === 'AUDIT_HISTORY' && (
            <div style={{ overflowX: 'auto' }}>
              <table className="enterprise-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Username</th>
                    <th>Action</th>
                    <th>Event</th>
                    <th>Business Object</th>
                    <th>Identifier</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLoading ? (
                    Array.from({ length: 8 }).map((_, idx) => (
                      <tr key={`aud-skel-${idx}`} className="animate-pulse">
                        <td><div style={{ height: '14px', width: '110px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '80px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '18px', width: '60px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '10px' }}></div></td>
                        <td><div style={{ height: '14px', width: '100px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '90px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '80px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '160px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                      </tr>
                    ))
                  ) : paginatedSlice.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
                        No audit history records found for the selected criteria.
                      </td>
                    </tr>
                  ) : (
                    paginatedSlice.map((log: any) => (
                      <tr key={log.id}>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {formatOracleDate(log.timestamp)}
                        </td>
                        <td style={{ fontWeight: 600, color: 'var(--accent-blue)' }}>{log.username}</td>
                        <td><span className="badge badge-gold" style={{ fontSize: '0.68rem' }}>{log.action}</span></td>
                        <td>{log.event}</td>
                        <td>{log.businessObject}</td>
                        <td><code>{log.identifier || '—'}</code></td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', maxWidth: '280px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={log.details}>
                          {log.details || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Table 6: User Access Report */}
          {activeReportId === 'USER_ACCESS' && (
            <div style={{ overflowX: 'auto' }}>
              <table className="enterprise-table" style={{ minWidth: '1500px' }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: '120px' }}>Username</th>
                    <th style={{ minWidth: '140px' }}>Display Name</th>
                    <th style={{ minWidth: '160px' }}>Email</th>
                    <th style={{ width: '90px' }}>Status</th>
                    <th style={{ minWidth: '180px' }}>Role Name</th>
                    <th style={{ minWidth: '160px' }}>Role Code</th>
                    <th style={{ width: '110px' }}>Person ID</th>
                    <th style={{ width: '110px' }}>Person Number</th>
                    <th style={{ minWidth: '150px' }}>Department</th>
                    <th style={{ minWidth: '140px' }}>Job</th>
                    <th style={{ minWidth: '150px' }}>Business Unit</th>
                    <th style={{ minWidth: '120px' }}>Location</th>
                    <th style={{ minWidth: '140px' }}>Manager</th>
                  </tr>
                </thead>
                <tbody>
                  {userAccessLoading && userAccessData.length === 0 ? (
                    Array.from({ length: 10 }).map((_, idx) => (
                      <tr key={`uar-skel-${idx}`} className="animate-pulse">
                        <td><div style={{ height: '14px', width: '80px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '120px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '130px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '18px', width: '50px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '10px' }}></div></td>
                        <td><div style={{ height: '14px', width: '150px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '120px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '70px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '70px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '110px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '100px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '110px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '80px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                        <td><div style={{ height: '14px', width: '100px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}></div></td>
                      </tr>
                    ))
                  ) : paginatedSlice.length === 0 ? (
                    <tr>
                      <td colSpan={13} style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-secondary)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                          <Users size={32} style={{ color: 'var(--text-muted)', opacity: 0.6 }} />
                          <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                            No user access records found.
                          </div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            {hasActiveUserAccessFilters ? 'No user assignments match the current filter selection.' : 'No user access data found in the connected environment.'}
                          </div>
                          {hasActiveUserAccessFilters && (
                            <button
                              type="button"
                              onClick={resetUserAccessFilters}
                              className="btn btn-secondary"
                              style={{ marginTop: '0.5rem', fontSize: '0.78rem' }}
                            >
                              Clear Filters
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedSlice.map((row: any, idx: number) => (
                      <tr key={`uar-${row.username}-${row.roleCode || 'norole'}-${idx}`}>
                        {/* 1. Username */}
                        <td style={{ fontWeight: 600, color: 'var(--accent-blue)' }}>
                          {onInvestigateUser ? (
                            <button
                              type="button"
                              onClick={() => onInvestigateUser(row.username, row.displayName || row.username)}
                              style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent-blue)', fontWeight: 600, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline' }}
                              title="Click to open Investigation Workspace for user"
                            >
                              {row.username}
                            </button>
                          ) : (
                            row.username
                          )}
                        </td>

                        {/* 2. Display Name */}
                        <td>
                          {row.displayName || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>}
                        </td>

                        {/* 3. Email */}
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                          {row.email || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>}
                        </td>

                        {/* 4. Status */}
                        <td>
                          <span className={`badge ${row.active ? 'badge-active' : 'badge-inactive'}`} style={{ fontSize: '0.68rem' }}>
                            {row.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>

                        {/* 5. Role Name */}
                        <td style={{ fontWeight: 500 }}>
                          {row.roleName ? (
                            onInspectRole && row.roleCode ? (
                              <button
                                type="button"
                                onClick={() => onInspectRole(row.roleCode, row.roleName)}
                                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-primary)', fontWeight: 500, cursor: 'pointer', textAlign: 'left' }}
                                title="Click to inspect role details"
                              >
                                {row.roleName}
                              </button>
                            ) : (
                              row.roleName
                            )
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>(No Assigned Roles)</span>
                          )}
                        </td>

                        {/* 6. Role Code */}
                        <td>
                          {row.roleCode ? (
                            <code style={{ fontSize: '0.78rem' }}>{row.roleCode}</code>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>

                        {/* 7. Person ID */}
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {row.personId || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>}
                        </td>

                        {/* 8. Person Number */}
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {row.personNumber || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>}
                        </td>

                        {/* 9. Department */}
                        <td>
                          {row.department || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>}
                        </td>

                        {/* 10. Job */}
                        <td>
                          {row.job || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>}
                        </td>

                        {/* 11. Business Unit */}
                        <td>
                          {row.businessUnit || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>}
                        </td>

                        {/* 12. Location */}
                        <td>
                          {row.location || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>}
                        </td>

                        {/* 13. Manager */}
                        <td>
                          {row.manager ? (
                            <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{row.manager}</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

        </div>

        {/* -------------------------------------------------------------
            5. PAGINATION & DATASET FOOTER
            ------------------------------------------------------------- */}
        {activeReportId === 'ROLE_HIERARCHY' && rhViewMode === 'TREE' ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', flexWrap: 'wrap', gap: '0.75rem', padding: '0.75rem 1.1rem', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Tree View Mode: Inspecting <strong>{rhSelectedRoleForTree || 'Selected Role'}</strong> across live Oracle Fusion inheritance trees (17,255 distinct role relationships).
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRhViewMode('TABLE')}
                style={{ fontSize: '0.76rem', padding: '0.3rem 0.65rem' }}
              >
                Switch to Table View
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Showing {totalRows === 0 ? 0 : (currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, totalRows)} of <strong>{totalRows.toLocaleString()}</strong> applicable records
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Rows per page:</span>
                <select
                  className="form-select"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(parseInt(e.target.value, 10));
                    setCurrentPage(1);
                  }}
                  style={{ padding: '0.2rem 0.5rem', height: '28px', fontSize: '0.78rem' }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  style={{ padding: '0.25rem 0.55rem', height: '28px' }}
                >
                  <ChevronLeft size={14} />
                </button>

                <span style={{ fontSize: '0.78rem', color: 'var(--text-primary)', padding: '0 0.35rem' }}>
                  Page {currentPage} of {totalPages}
                </span>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages || totalRows === 0}
                  style={{ padding: '0.25rem 0.55rem', height: '28px' }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <div style={{ textAlign: 'left', marginBottom: '0.25rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-header)', color: 'var(--text-primary)', margin: '0 0 0.35rem 0' }}>
              Available Reports Catalog
            </h2>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: 0 }}>
              Select a report suite below or use the selector dropdown above to review live Oracle Fusion data.
            </p>
          </div>

          {REPORT_DOMAIN_ORDER.map((domain) => {
            const domainReports = REPORT_DEFINITIONS.filter(r => REPORT_DOMAIN_LABELS[r.section] === domain);
            return (
              <div key={domain} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                    {domain}
                  </span>
                  <div style={{ height: '1px', flex: 1, backgroundColor: 'var(--border-color)' }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.25rem' }}>
                  {domainReports.map((report) => {
                    const ReportIcon = report.icon;
                    return (
                      <div
                        key={report.id}
                        className="glass-panel stat-card"
                        onClick={() => handleSelectReport(report.id)}
                        style={{
                          cursor: 'pointer',
                          padding: '1.5rem',
                          borderRadius: '12px',
                          border: '1px solid var(--border-color)',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '1rem',
                          backgroundColor: 'var(--bg-secondary)'
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.85rem' }}>
                            <div style={{
                              width: '42px',
                              height: '42px',
                              borderRadius: '10px',
                              backgroundColor: 'rgba(37, 99, 235, 0.1)',
                              color: '#2563EB',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}>
                              <ReportIcon size={20} />
                            </div>
                            <span className="badge badge-gold" style={{ fontSize: '0.7rem', fontWeight: 600 }}>
                              {report.badge}
                            </span>
                          </div>

                          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.35rem 0', fontFamily: 'var(--font-header)' }}>
                            {REPORT_SELECTOR_NAMES[report.id] || report.title}
                          </h3>
                          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                            {report.subtitle}
                          </p>
                        </div>

                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingTop: '0.85rem',
                          borderTop: '1px solid var(--border-color)',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          color: 'var(--accent-blue)'
                        }}>
                          <span>Generate & View Report</span>
                          <ArrowRight size={15} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* -------------------------------------------------------------
          6. INCIDENT DETAIL SLIDE-OVER DRAWER (PART 6)
          ------------------------------------------------------------- */}
      {selectedIncidentDetail && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 1000,
          display: 'flex',
          justifyContent: 'flex-end',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '560px',
            height: '100%',
            backgroundColor: 'var(--bg-primary)',
            boxShadow: '-4px 0 25px rgba(0,0,0,0.18)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideInRight 0.25s ease-out',
            overflowY: 'auto'
          }}>
            
            {/* Drawer Header */}
            <div style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              backgroundColor: 'var(--bg-secondary)'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span className="badge badge-danger" style={{ fontSize: '0.72rem', fontWeight: 700 }}>
                    Incident #{selectedIncidentDetail.id}
                  </span>
                  <span className="badge badge-gold" style={{ fontSize: '0.72rem' }}>
                    {selectedIncidentDetail.state || 'IN_INVESTIGATION'}
                  </span>
                </div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, fontFamily: 'var(--font-header)', color: 'var(--text-primary)' }}>
                  Continuous Monitoring Incident Details
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setSelectedIncidentDetail(null)}
                className="btn btn-secondary"
                style={{ padding: '0.35rem', borderRadius: '50%' }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Drawer Content */}
            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              {/* Card 1: Control Identification */}
              <div className="glass-panel" style={{ padding: '1.15rem', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-blue)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Scale size={14} />
                  <span>Control Context</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Control ID</span>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>#{selectedIncidentDetail.controlId}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Control Name</span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{renderFieldVal(selectedIncidentDetail.controlName)}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Status</span>
                    <span className="badge badge-active" style={{ fontSize: '0.68rem' }}>{renderFieldVal(selectedIncidentDetail.status)}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>State</span>
                    <span className="badge badge-gold" style={{ fontSize: '0.68rem' }}>{renderFieldVal(selectedIncidentDetail.state)}</span>
                  </div>
                </div>
              </div>

              {/* Card 2: User & Identity Context */}
              <div className="glass-panel" style={{ padding: '1.15rem', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-gold)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <User size={14} />
                  <span>User & Identity Context</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Global User Name</span>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{renderFieldVal(selectedIncidentDetail.globalUserName)}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>User ID</span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{renderFieldVal(selectedIncidentDetail.globalUserId)}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>First Name</span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{renderFieldVal(selectedIncidentDetail.userFirstName)}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Last Name</span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{renderFieldVal(selectedIncidentDetail.userLastName)}</span>
                  </div>
                </div>
              </div>

              {/* Card 3: Security & Access Context */}
              <div className="glass-panel" style={{ padding: '1.15rem', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <ShieldCheck size={14} />
                  <span>Security & Access Context</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Role</span>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                      {renderFieldVal(selectedIncidentDetail.role)}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Conflicting Roles</span>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      {renderFieldVal(selectedIncidentDetail.conflictingRoles)}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                    <div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Entitlement</span>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{renderFieldVal(selectedIncidentDetail.entitlement)}</span>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Access Point Type</span>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{renderFieldVal(selectedIncidentDetail.accessPointType)}</span>
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Access Point Name</span>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      {renderFieldVal(selectedIncidentDetail.accessPointName)}
                    </div>
                  </div>
                  {selectedIncidentDetail.conflictingAccPointName && (
                    <div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Conflicting Access Point</span>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        {renderFieldVal(selectedIncidentDetail.conflictingAccPointName)}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Card 4: Incident Information */}
              <div className="glass-panel" style={{ padding: '1.15rem', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-red)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <ShieldAlert size={14} />
                  <span>Violation & Incident Details</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Incident Information</span>
                    <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '0.65rem 0.85rem', borderRadius: '6px', fontSize: '0.82rem', color: 'var(--text-primary)', border: '1px solid var(--border-color)', lineHeight: '1.4' }}>
                      {renderFieldVal(selectedIncidentDetail.incidentInformation)}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', marginTop: '0.25rem' }}>
                    <div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Grouping Value</span>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{renderFieldVal(selectedIncidentDetail.groupingValue)}</span>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Data Source</span>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{renderFieldVal(selectedIncidentDetail.dataSource)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 5: Audit Lifecycle Dates & Users */}
              <div className="glass-panel" style={{ padding: '1.15rem', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Clock size={14} />
                  <span>Audit Lifecycle</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Created By</span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{renderFieldVal(selectedIncidentDetail.createdBy)}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Creation Date</span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{formatOracleDate(selectedIncidentDetail.creationDate)}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Last Updated By</span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{renderFieldVal(selectedIncidentDetail.lastUpdatedBy)}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Last Update Date</span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{formatOracleDate(selectedIncidentDetail.lastUpdateDate)}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Closed By</span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{renderFieldVal(selectedIncidentDetail.closedBy)}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Closed Date</span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{formatOracleDate(selectedIncidentDetail.closedDate)}</span>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>Result Investigator</span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{renderFieldVal(selectedIncidentDetail.resultInvestigator)}</span>
                  </div>
                </div>
              </div>

            </div>

          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
          7. ROLE HIERARCHY TREE MODAL
          ------------------------------------------------------------- */}
      {rhTreeModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 1100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '920px',
            maxHeight: '90vh',
            backgroundColor: 'var(--bg-primary)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            boxShadow: '0 20px 45px rgba(0,0,0,0.3)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '1.1rem 1.4rem',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'var(--bg-secondary)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(37, 99, 235, 0.1)',
                  color: '#2563EB',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <FolderTree size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, fontFamily: 'var(--font-header)', color: 'var(--text-primary)' }}>
                    Role Hierarchy Explorer
                  </h3>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    Job Role &rarr; Duty Role &rarr; Granted Privileges Tree
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setRhTreeModalOpen(false)}
                  className="btn btn-secondary"
                  style={{ padding: '0.35rem 0.65rem' }}
                  title="Close modal"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '1.25rem', overflowY: 'auto', flex: 1 }}>
              {renderHierarchyTreeContent(true)}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
