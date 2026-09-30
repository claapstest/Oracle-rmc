import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Scale,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Search,
  Filter,
  Columns,
  ArrowLeft,
  Eye,
  RefreshCw,
  ChevronDown,
  Shield,
  Zap,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  X,
  User,
  Key,
  FileText,
  Clock
} from 'lucide-react';
import { api } from '../services/api.js';
import { EnterpriseExportControl, type EnterpriseExportColumn } from './EnterpriseExportControl';
import { 
  isAccessControl, 
  isTransactionControl, 
  formatControlTypeName, 
  formatSecondaryTypeBadge 
} from '../utils/controlTypeMapping';

export interface AdvancedControlRecord {
  id: string;
  name: string;
  description: string | null;
  enforcementType: string | null;
  statusId: number | string | null;
  stateCode: string | null;
  type: string | number | null;
  lastRunDate: string | null;
  lastUpdateDate: string | null;
  latestJobId: number | string | null;
  createdBy: string | null;
  creationDate: string | null;
  status: string;
  state: string;
  lastUpdatedBy: string | null;
  scheduledBy: string | null;
  incidentCount?: number;
  incidents?: any[];
  raw?: any;
}

export interface AdvancedControlsModuleProps {
  controls: AdvancedControlRecord[];
  environmentMode: 'DEMO' | 'ORACLE_FUSION';
  dataSource?: string;
  lastRefreshed?: string;
  controlsRefreshing: boolean;
  onRefreshControls: () => void;
  onSelectControl?: (ctrlId: string) => void;
  /** When embedded inside the Risk Management subsection, render a compact section header instead of the standalone blue hero. */
  embedded?: boolean;
  /** When the hosting page already renders its own title/hero, hide the module section header and keep only the view tabs + sync actions. */
  hideSectionHeader?: boolean;
}

type SubSectionType = 'ACCESS' | 'TRANSACTION';

type SortField = 'id' | 'name' | 'status' | 'lastRunDate' | 'lastUpdateDate' | 'incidentCount';
type SortDirection = 'asc' | 'desc';

interface ColumnDef {
  key: string;
  label: string;
  defaultVisible: boolean;
  minWidth?: string;
}

const ALL_COLUMNS: ColumnDef[] = [
  { key: 'id', label: 'Control ID', defaultVisible: true, minWidth: '110px' },
  { key: 'name', label: 'Control Name', defaultVisible: true, minWidth: '280px' },
  { key: 'type', label: 'Type', defaultVisible: true, minWidth: '150px' },
  { key: 'status', label: 'Status', defaultVisible: true, minWidth: '110px' },
  { key: 'state', label: 'State', defaultVisible: true, minWidth: '110px' },
  { key: 'incidentCount', label: 'Incidents', defaultVisible: true, minWidth: '110px' },
  { key: 'lastRunDate', label: 'Last Run', defaultVisible: true, minWidth: '130px' },
  { key: 'lastUpdateDate', label: 'Last Updated', defaultVisible: true, minWidth: '130px' },
  { key: 'description', label: 'Description', defaultVisible: false, minWidth: '260px' },
  { key: 'enforcementType', label: 'Enforcement Type', defaultVisible: false, minWidth: '140px' },
  { key: 'latestJobId', label: 'Latest Job ID', defaultVisible: false, minWidth: '130px' },
  { key: 'createdBy', label: 'Created By', defaultVisible: false, minWidth: '140px' },
  { key: 'creationDate', label: 'Creation Date', defaultVisible: false, minWidth: '130px' },
  { key: 'lastUpdatedBy', label: 'Last Updated By', defaultVisible: false, minWidth: '140px' },
  { key: 'scheduledBy', label: 'Scheduled By', defaultVisible: false, minWidth: '140px' },
];

export const AdvancedControlsModule: React.FC<AdvancedControlsModuleProps> = ({
  controls = [],
  environmentMode,
  dataSource,
  lastRefreshed,
  controlsRefreshing,
  onRefreshControls,
  embedded = false,
  hideSectionHeader = false,
}) => {
  // Active internal subsection tab
  const [activeSubSection, setActiveSubSection] = useState<SubSectionType>('ACCESS');

  // Search & Filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [stateFilter, setStateFilter] = useState<string>('ALL');
  const [incidentFilter, setIncidentFilter] = useState<string>('ALL');

  // Column visibility state
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<Set<string>>(
    () => new Set(ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key))
  );
  const [isColumnsDropdownOpen, setIsColumnsDropdownOpen] = useState(false);
  const columnsDropdownRef = useRef<HTMLDivElement>(null);

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('id');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);

  // Selected Control detail view state
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);
  const [selectedControlDetail, setSelectedControlDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  // Lightweight incident counts cache state for the catalog
  const [incidentCounts, setIncidentCounts] = useState<Record<string, { count: number; updatedAt?: string; status?: string }>>({});
  const [countsLoading, setCountsLoading] = useState(false);

  // Paginated incidents state for the Control Details view
  const [incidentPage, setIncidentPage] = useState<number>(1);
  const [incidentPageSize, setIncidentPageSize] = useState<number>(25);
  const [incidentsList, setIncidentsList] = useState<any[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState<boolean>(false);
  const [incidentsHasMore, setIncidentsHasMore] = useState<boolean>(false);
  const [incidentsTotalCount, setIncidentsTotalCount] = useState<number | undefined>(undefined);
  const [incidentsCountLoading, setIncidentsCountLoading] = useState<boolean>(false);
  const [incidentsError, setIncidentsError] = useState<string>('');

  // Incident Details modal state
  const [viewingIncident, setViewingIncident] = useState<any | null>(null);

  const [incidentSyncState, setIncidentSyncState] = useState<{
    cacheStatus: 'NOT_CACHED' | 'SYNCING' | 'READY' | 'PARTIAL' | 'ERROR';
    fetchedCount?: number;
    totalCount?: number;
    lastSyncedAt?: string;
  }>({ cacheStatus: 'NOT_CACHED' });
  const [detailIncidentPage, setDetailIncidentPage] = useState(1);
  const detailPollingRef = useRef<any>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (detailPollingRef.current) {
        clearInterval(detailPollingRef.current);
        detailPollingRef.current = null;
      }
    };
  }, []);

  // Fetch incident counts from lightweight cache on mount or when controls change
  const loadIncidentCounts = async (triggerSync = true) => {
    try {
      setCountsLoading(true);
      const res = await api.getControlIncidentCounts(triggerSync);
      if (res && res.counts) {
        setIncidentCounts(res.counts);
      }
    } catch (err) {
      console.error('Failed to load incident counts:', err);
    } finally {
      setCountsLoading(false);
    }
  };

  useEffect(() => {
    loadIncidentCounts(true);
  }, [controls]);

  // Periodic poll if any control count is currently CALCULATING
  useEffect(() => {
    const hasCalculating = Object.values(incidentCounts).some(item => item?.status === 'CALCULATING');
    if (!hasCalculating) return;

    const timer = setInterval(async () => {
      try {
        const res = await api.getControlIncidentCounts(false);
        if (res && res.counts) {
          setIncidentCounts(res.counts);
        }
      } catch (e) {
        // ignore background poll errors
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [incidentCounts]);

  // Close columns dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (columnsDropdownRef.current && !columnsDropdownRef.current.contains(e.target as Node)) {
        setIsColumnsDropdownOpen(false);
      }
    }
    if (isColumnsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isColumnsDropdownOpen]);

  // Reset pagination when subsection, search, filters, or page size change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeSubSection, searchQuery, statusFilter, stateFilter, incidentFilter, pageSize]);

  // Dynamic counts derived strictly from Oracle type mapping
  // Type === 173 -> Access Control
  // Type === 174 -> Transaction Control
  const accessControls = useMemo(() => {
    return controls.filter(c => isAccessControl(c.type));
  }, [controls]);

  const transactionControls = useMemo(() => {
    return controls.filter(c => isTransactionControl(c.type));
  }, [controls]);

  // Active domain dataset with cached counts merged in
  const activeSubsectionControls = useMemo(() => {
    const base = activeSubSection === 'ACCESS' ? accessControls : transactionControls;
    return base.map(c => {
      const cached = incidentCounts[c.id];
      const count = (cached?.count !== undefined && cached?.count !== null) ? cached.count : c.incidentCount;
      return {
        ...c,
        incidentCount: count,
        incidentCountStatus: cached?.status
      };
    });
  }, [activeSubSection, accessControls, transactionControls, incidentCounts]);

  // Extract unique filter options present in backend data for current subsection
  const availableStatuses = useMemo(() => {
    const statuses = new Set<string>();
    activeSubsectionControls.forEach(c => {
      if (c.status) statuses.add(c.status.toUpperCase());
    });
    return Array.from(statuses);
  }, [activeSubsectionControls]);

  const availableStates = useMemo(() => {
    const states = new Set<string>();
    activeSubsectionControls.forEach(c => {
      const s = c.state || c.stateCode;
      if (s) states.add(s.toUpperCase());
    });
    return Array.from(states);
  }, [activeSubsectionControls]);

  // Dynamic KPI calculations for selected subsection
  const kpiTotal = activeSubsectionControls.length;
  const kpiActive = activeSubsectionControls.filter(c => (c.status || '').toUpperCase() === 'ACTIVE').length;
  const kpiInactive = activeSubsectionControls.filter(c => (c.status || '').toUpperCase() === 'INACTIVE').length;
  
  // Incident statistics for selected subsection (with honest update status)
  const controlsWithKnownIncidents = activeSubsectionControls.filter(c => typeof c.incidentCount === 'number');
  const knownCountTotal = controlsWithKnownIncidents.length;
  const hasIncidentData = knownCountTotal > 0;
  const kpiTotalIncidentsCount = controlsWithKnownIncidents.reduce((sum, c) => sum + (c.incidentCount ?? 0), 0);
  const allControlsUpdated = activeSubsectionControls.length > 0 && knownCountTotal === activeSubsectionControls.length;

  // Filter & Search application strictly within selected subsection
  const filteredControls = useMemo(() => {
    return activeSubsectionControls.filter(ctrl => {
      // Status filter
      if (statusFilter !== 'ALL') {
        if ((ctrl.status || '').toUpperCase() !== statusFilter.toUpperCase()) {
          return false;
        }
      }

      // State filter
      if (stateFilter !== 'ALL') {
        const s = (ctrl.state || ctrl.stateCode || '').toUpperCase();
        if (s !== stateFilter.toUpperCase()) {
          return false;
        }
      }

      // Incident filter: ALL | WITH_INCIDENTS | ZERO_INCIDENTS | NOT_SCANNED
      if (incidentFilter === 'WITH_INCIDENTS') {
        if (ctrl.incidentCount === undefined || ctrl.incidentCount === null || ctrl.incidentCount <= 0) return false;
      } else if (incidentFilter === 'ZERO_INCIDENTS') {
        if (ctrl.incidentCount !== 0) return false;
      } else if (incidentFilter === 'NOT_SCANNED') {
        if (ctrl.incidentCount !== undefined && ctrl.incidentCount !== null) return false;
      }

      // Search query across ID, Name, Description, ScheduledBy, CreatedBy
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesId = ctrl.id && String(ctrl.id).toLowerCase().includes(q);
        const matchesName = ctrl.name && ctrl.name.toLowerCase().includes(q);
        const matchesDesc = ctrl.description && ctrl.description.toLowerCase().includes(q);
        const matchesScheduled = ctrl.scheduledBy && ctrl.scheduledBy.toLowerCase().includes(q);
        const matchesCreated = ctrl.createdBy && ctrl.createdBy.toLowerCase().includes(q);
        if (!matchesId && !matchesName && !matchesDesc && !matchesScheduled && !matchesCreated) {
          return false;
        }
      }

      return true;
    });
  }, [activeSubsectionControls, statusFilter, stateFilter, incidentFilter, searchQuery]);

  // Sort filtered controls
  const sortedControls = useMemo(() => {
    const list = [...filteredControls];
    list.sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      if (sortField === 'id') {
        valA = parseInt(a.id, 10) || a.id;
        valB = parseInt(b.id, 10) || b.id;
      } else if (sortField === 'incidentCount') {
        valA = a.incidentCount ?? -1;
        valB = b.incidentCount ?? -1;
      } else if (sortField === 'lastRunDate' || sortField === 'lastUpdateDate') {
        valA = valA ? new Date(valA).getTime() : 0;
        valB = valB ? new Date(valB).getTime() : 0;
      } else {
        valA = String(valA || '').toLowerCase();
        valB = String(valB || '').toLowerCase();
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [filteredControls, sortField, sortDirection]);

  // Paginated records for table view
  const totalPages = Math.ceil(sortedControls.length / pageSize) || 1;
  const paginatedControls = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedControls.slice(start, start + pageSize);
  }, [sortedControls, currentPage, pageSize]);

  // Sort click handler
  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Helper date formatter
  const formatOracleDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not available</span>;
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return String(dateStr);
    }
  };

  // Helper field fallback
  const renderFieldVal = (val: any) => {
    if (val === null || val === undefined || val === '') {
      return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not available</span>;
    }
    return String(val);
  };

  // Load a specific page of incidents for the active control
  const loadIncidentsPage = async (ctrlId: string, page: number, size: number) => {
    setIncidentsLoading(true);
    setIncidentsError('');
    try {
      const res = await api.getControlIncidents(ctrlId, page, size);
      if (res && res.success) {
        setIncidentsList(res.items || []);
        setIncidentsHasMore(Boolean(res.hasMore));
        if (typeof res.totalResults === 'number') {
          setIncidentsTotalCount(res.totalResults);
        }
      } else {
        setIncidentsError(res?.message || 'Failed to retrieve continuous monitoring incidents from Oracle Fusion');
      }
    } catch (err: any) {
      console.error('Error fetching control incidents page:', err);
      setIncidentsError('Failed to fetch incidents from Oracle Fusion FSCM REST API.');
    } finally {
      setIncidentsLoading(false);
    }
  };

  // Authoritative incident count request (REQUEST B) executed in background
  const loadIncidentCountSeparately = async (ctrlId: string, refresh = false) => {
    setIncidentsCountLoading(true);
    try {
      const res = await api.getControlIncidentCount(ctrlId, refresh);
      if (res && typeof res.count === 'number') {
        setIncidentsTotalCount(res.count);
        setIncidentCounts(prev => ({
          ...prev,
          [ctrlId]: {
            count: res.count,
            updatedAt: res.updatedAt || new Date().toISOString(),
            status: 'READY'
          }
        }));
      }
    } catch (err) {
      console.error('Error loading authoritative incident count:', err);
    } finally {
      setIncidentsCountLoading(false);
    }
  };

  // Control detail inspection handler: fast header + independent incident page & count
  const handleOpenDetail = async (ctrlId: string, forceRefresh = false) => {
    if (detailPollingRef.current) {
      clearInterval(detailPollingRef.current);
      detailPollingRef.current = null;
    }

    setSelectedControlId(ctrlId);
    setDetailLoading(true);
    setDetailError('');
    setIncidentPage(1);
    setIncidentsList([]);
    setIncidentsError('');
    setViewingIncident(null);

    // Pre-seed known count from incident counts cache immediately
    const cachedCountObj = incidentCounts[ctrlId];
    if (cachedCountObj && typeof cachedCountObj.count === 'number') {
      setIncidentsTotalCount(cachedCountObj.count);
    } else {
      setIncidentsTotalCount(undefined);
    }

    // 1. Fetch Control Header (<500ms)
    try {
      const res = await api.getAdvancedControlDetail(ctrlId, forceRefresh);
      if (res && res.success && res.control) {
        setSelectedControlDetail(res.control);
        if (typeof res.incidentCount === 'number') {
          setIncidentsTotalCount(res.incidentCount);
        }
        setIncidentSyncState({
          cacheStatus: res.cacheStatus || 'READY',
          fetchedCount: res.fetchedCount,
          totalCount: res.totalCount || res.incidentCount,
          lastSyncedAt: res.lastSyncedAt
        });
      } else {
        setDetailError(res?.message || 'Unable to retrieve control details from Oracle Fusion.');
      }
    } catch (err: any) {
      console.error('Error fetching control detail:', err);
      setDetailError('Communication failure querying Oracle Fusion FSCM REST endpoint.');
    } finally {
      setDetailLoading(false);
    }

    // 2. Launch REQUEST A: First 25 Incidents immediately
    loadIncidentsPage(ctrlId, 1, incidentPageSize);

    // 3. Launch REQUEST B: Total authoritative count in background
    loadIncidentCountSeparately(ctrlId, forceRefresh);
  };

  const handleIncidentPageChange = (newPage: number) => {
    if (!selectedControlId || newPage < 1) return;
    setIncidentPage(newPage);
    loadIncidentsPage(selectedControlId, newPage, incidentPageSize);
  };

  const handleIncidentPageSizeChange = (newSize: number) => {
    if (!selectedControlId) return;
    setIncidentPageSize(newSize);
    setIncidentPage(1);
    loadIncidentsPage(selectedControlId, 1, newSize);
  };

  const handleRefreshIncidents = () => {
    if (!selectedControlId) return;
    loadIncidentsPage(selectedControlId, incidentPage, incidentPageSize);
    loadIncidentCountSeparately(selectedControlId, true);
  };

  // Columns toggle functions
  const toggleColumn = (key: string) => {
    setVisibleColumnKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) { // Prevent deselecting all
          next.delete(key);
        }
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllColumns = () => {
    setVisibleColumnKeys(new Set(ALL_COLUMNS.map(c => c.key)));
  };

  const clearAllColumns = () => {
    // Keep at least Control ID and Name for minimum legibility
    setVisibleColumnKeys(new Set(['id', 'name']));
  };

  const resetToDefaultColumns = () => {
    setVisibleColumnKeys(new Set(ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key)));
  };

  // Build columns definition for EnterpriseExportControl
  const exportColumns: EnterpriseExportColumn<AdvancedControlRecord>[] = useMemo(() => {
    return [
      { key: 'id', label: 'Control ID', defaultSelected: true, getValue: c => c.id },
      { key: 'name', label: 'Control Name', defaultSelected: true, getValue: c => c.name },
      { key: 'type', label: 'Type', defaultSelected: true, getValue: c => formatControlTypeName(c.type) },
      { key: 'status', label: 'Status', defaultSelected: true, getValue: c => c.status || 'ACTIVE' },
      { key: 'state', label: 'State', defaultSelected: true, getValue: c => c.state || c.stateCode || 'APPROVED' },
      { key: 'incidentCount', label: 'Incidents', defaultSelected: true, getValue: c => (c.incidentCount !== undefined && c.incidentCount !== null ? c.incidentCount : 'Not available') },
      { key: 'lastRunDate', label: 'Last Run', defaultSelected: true, getValue: c => c.lastRunDate || '' },
      { key: 'lastUpdateDate', label: 'Last Updated', defaultSelected: true, getValue: c => c.lastUpdateDate || '' },
      { key: 'description', label: 'Description', defaultSelected: false, getValue: c => c.description || '' },
      { key: 'enforcementType', label: 'Enforcement Type', defaultSelected: false, getValue: c => c.enforcementType || '' },
      { key: 'latestJobId', label: 'Latest Job ID', defaultSelected: false, getValue: c => c.latestJobId || '' },
      { key: 'createdBy', label: 'Created By', defaultSelected: false, getValue: c => c.createdBy || '' },
      { key: 'creationDate', label: 'Creation Date', defaultSelected: false, getValue: c => c.creationDate || '' },
      { key: 'lastUpdatedBy', label: 'Last Updated By', defaultSelected: false, getValue: c => c.lastUpdatedBy || '' },
      { key: 'scheduledBy', label: 'Scheduled By', defaultSelected: false, getValue: c => c.scheduledBy || '' },
    ];
  }, []);

  const activeEntityName = activeSubSection === 'ACCESS' ? 'Access Controls' : 'Transaction Controls';

  return (
    <div className="advanced-controls-module animate-fade-in">

      {/* 1. Section header + internal Access/Transaction views. Standalone blue hero is used only when NOT embedded; Risk Management provides the hero. */}
      {embedded ? (
        <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
          {!hideSectionHeader && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 800, fontFamily: 'var(--font-header)', margin: 0, letterSpacing: '-0.01em' }}>
                Advanced Controls
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: '0.3rem 0 0 0' }}>
                Monitor access and transaction controls configured in Oracle Fusion.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '9999px', padding: '0.35rem 0.85rem' }}>
                {dataSource || (environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Data')}
              </span>
              <button
                id="btn-sync-catalog"
                onClick={onRefreshControls}
                disabled={controlsRefreshing}
                className="btn btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem', padding: '0.45rem 0.95rem', borderRadius: '6px', cursor: controlsRefreshing ? 'not-allowed' : 'pointer', fontWeight: 700 }}
                title="Fetch latest controls from Oracle Fusion"
              >
                <RefreshCw size={14} className={controlsRefreshing ? 'animate-spin' : ''} />
                {controlsRefreshing ? 'Syncing...' : 'Sync Catalog'}
              </button>
            </div>
          </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div role="tablist" aria-label="Advanced Controls views" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              id="tab-access-controls"
              role="tab"
              aria-selected={activeSubSection === 'ACCESS'}
              onClick={() => setActiveSubSection('ACCESS')}
              style={{
                background: activeSubSection === 'ACCESS' ? 'var(--accent-blue)' : 'var(--bg-tertiary)',
                border: activeSubSection === 'ACCESS' ? '1px solid var(--accent-blue)' : '1px solid var(--border-color)',
                outline: 'none',
                cursor: 'pointer',
                padding: '0.55rem 1.1rem',
                borderRadius: '8px',
                fontSize: '0.88rem',
                fontWeight: 700,
                color: activeSubSection === 'ACCESS' ? '#ffffff' : 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.55rem',
                boxShadow: activeSubSection === 'ACCESS' ? '0 2px 8px rgba(37, 99, 235, 0.3)' : 'none'
              }}
            >
              <Shield size={16} />
              <span>Access Controls</span>
              <span style={{ fontSize: '0.72rem', padding: '0.1rem 0.5rem', borderRadius: '9999px', backgroundColor: activeSubSection === 'ACCESS' ? 'rgba(255,255,255,0.22)' : '#DBEAFE', color: activeSubSection === 'ACCESS' ? '#ffffff' : '#1D4ED8', fontWeight: 800 }}>
                {accessControls.length}
              </span>
            </button>
            <button
              id="tab-transaction-controls"
              role="tab"
              aria-selected={activeSubSection === 'TRANSACTION'}
              onClick={() => setActiveSubSection('TRANSACTION')}
              style={{
                background: activeSubSection === 'TRANSACTION' ? '#047857' : 'var(--bg-tertiary)',
                border: activeSubSection === 'TRANSACTION' ? '1px solid #047857' : '1px solid var(--border-color)',
                outline: 'none',
                cursor: 'pointer',
                padding: '0.55rem 1.1rem',
                borderRadius: '8px',
                fontSize: '0.88rem',
                fontWeight: 700,
                color: activeSubSection === 'TRANSACTION' ? '#ffffff' : 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.55rem',
                boxShadow: activeSubSection === 'TRANSACTION' ? '0 2px 8px rgba(4, 120, 87, 0.3)' : 'none'
              }}
            >
              <Zap size={16} />
              <span>Transaction Controls</span>
              <span style={{ fontSize: '0.72rem', padding: '0.1rem 0.5rem', borderRadius: '9999px', backgroundColor: activeSubSection === 'TRANSACTION' ? 'rgba(255,255,255,0.22)' : '#D1FAE5', color: activeSubSection === 'TRANSACTION' ? '#ffffff' : '#047857', fontWeight: 800 }}>
                {transactionControls.length}
              </span>
            </button>
          </div>
          {hideSectionHeader && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '9999px', padding: '0.35rem 0.85rem' }}>
                {dataSource || (environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Data')}
              </span>
              <button
                id="btn-sync-catalog"
                onClick={onRefreshControls}
                disabled={controlsRefreshing}
                className="btn btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem', padding: '0.45rem 0.95rem', borderRadius: '6px', cursor: controlsRefreshing ? 'not-allowed' : 'pointer', fontWeight: 700 }}
                title="Fetch latest controls from Oracle Fusion"
              >
                <RefreshCw size={14} className={controlsRefreshing ? 'animate-spin' : ''} />
                {controlsRefreshing ? 'Syncing...' : 'Sync Catalog'}
              </button>
            </div>
          )}
          </div>
        </div>
      ) : (
      /* 1. Integrated Enterprise Header Banner with Docked Domain Tabs */
      <div
        className="page-header-banner"
        style={{
          background: 'linear-gradient(135deg, #1E3A8A 0%, #2563EB 55%, #3B82F6 100%)',
          position: 'relative',
          padding: '1.75rem 2rem 0 2rem',
          borderRadius: '12px',
          marginBottom: '1.5rem',
          boxShadow: '0 8px 24px -4px rgba(30, 58, 138, 0.25)',
          overflow: 'hidden'
        }}
      >
        {/* Subtle Wave Curve overlay */}
        <svg
          viewBox="0 0 1440 240"
          preserveAspectRatio="none"
          style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, opacity: 0.85 }}
        >
          <path fill="rgba(255, 255, 255, 0.08)" d="M0,120 C320,190,480,50,800,130 C1120,210,1280,80,1440,120 L1440,240 L0,240 Z" />
          <path fill="rgba(96, 165, 250, 0.16)" d="M0,170 C360,90,600,210,960,140 C1200,90,1360,180,1440,150 L1440,240 L0,240 Z" />
        </svg>

        {/* Top Header Row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 2, flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.35rem' }}>
              <span style={{
                backgroundColor: 'rgba(255, 255, 255, 0.2)',
                color: '#ffffff',
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '0.2rem 0.6rem',
                borderRadius: '9999px',
                letterSpacing: '0.04em',
                textTransform: 'uppercase'
              }}>
                Oracle Fusion Risk Management Cloud
              </span>
            </div>
            <h1 style={{ fontSize: '1.85rem', fontWeight: 800, fontFamily: 'var(--font-header)', margin: 0, letterSpacing: '-0.02em', color: '#ffffff' }}>
              Advanced Controls
            </h1>
            <p style={{ color: '#E0E7FF', fontSize: '0.92rem', margin: '0.3rem 0 0 0' }}>
              Monitor access and transaction controls configured in Oracle Fusion.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
            <div style={{
              padding: '0.4rem 0.95rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              borderRadius: '9999px',
              backgroundColor: 'rgba(255, 255, 255, 0.18)',
              border: '1px solid rgba(255, 255, 255, 0.35)',
              color: '#ffffff',
              backdropFilter: 'blur(8px)'
            }}>
              {dataSource || (environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Data')}
            </div>

            <button
              id="btn-sync-catalog"
              onClick={onRefreshControls}
              disabled={controlsRefreshing}
              className="btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                fontSize: '0.82rem',
                padding: '0.45rem 0.95rem',
                borderRadius: '6px',
                backgroundColor: '#ffffff',
                color: '#1E3A8A',
                fontWeight: 700,
                border: 'none',
                cursor: controlsRefreshing ? 'not-allowed' : 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.15)'
              }}
              title="Fetch latest controls from Oracle Fusion"
            >
              <RefreshCw size={14} className={controlsRefreshing ? 'animate-spin' : ''} />
              {controlsRefreshing ? 'Syncing...' : 'Sync Catalog'}
            </button>
          </div>
        </div>

        {/* Docked Subsections Tabs Row (Requirement 17 Mockup) */}
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            position: 'relative',
            zIndex: 2,
            borderTop: '1px solid rgba(255, 255, 255, 0.15)',
            paddingTop: '0.75rem'
          }}
        >
          {/* Tab 1: Access Controls (Oracle Type 173) */}
          <button
            id="tab-access-controls"
            onClick={() => setActiveSubSection('ACCESS')}
            style={{
              background: activeSubSection === 'ACCESS' ? '#ffffff' : 'rgba(255, 255, 255, 0.12)',
              border: 'none',
              outline: 'none',
              cursor: 'pointer',
              padding: '0.65rem 1.25rem',
              borderRadius: '8px 8px 0 0',
              fontSize: '0.92rem',
              fontWeight: 700,
              color: activeSubSection === 'ACCESS' ? '#1E3A8A' : '#ffffff',
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
              transition: 'all 0.15s ease',
              boxShadow: activeSubSection === 'ACCESS' ? '0 -2px 10px rgba(0,0,0,0.1)' : 'none'
            }}
          >
            <Shield size={17} style={{ color: activeSubSection === 'ACCESS' ? '#2563EB' : 'rgba(255, 255, 255, 0.8)' }} />
            <span>Access Controls</span>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '0.12rem 0.55rem',
                borderRadius: '9999px',
                backgroundColor: activeSubSection === 'ACCESS' ? '#DBEAFE' : 'rgba(255, 255, 255, 0.25)',
                color: activeSubSection === 'ACCESS' ? '#1D4ED8' : '#ffffff',
                fontWeight: 800
              }}
            >
              {accessControls.length}
            </span>
          </button>

          {/* Tab 2: Transaction Controls (Oracle Type 174) */}
          <button
            id="tab-transaction-controls"
            onClick={() => setActiveSubSection('TRANSACTION')}
            style={{
              background: activeSubSection === 'TRANSACTION' ? '#ffffff' : 'rgba(255, 255, 255, 0.12)',
              border: 'none',
              outline: 'none',
              cursor: 'pointer',
              padding: '0.65rem 1.25rem',
              borderRadius: '8px 8px 0 0',
              fontSize: '0.92rem',
              fontWeight: 700,
              color: activeSubSection === 'TRANSACTION' ? '#065F46' : '#ffffff',
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
              transition: 'all 0.15s ease',
              boxShadow: activeSubSection === 'TRANSACTION' ? '0 -2px 10px rgba(0,0,0,0.1)' : 'none'
            }}
          >
            <Zap size={17} style={{ color: activeSubSection === 'TRANSACTION' ? '#10B981' : 'rgba(255, 255, 255, 0.8)' }} />
            <span>Transaction Controls</span>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '0.12rem 0.55rem',
                borderRadius: '9999px',
                backgroundColor: activeSubSection === 'TRANSACTION' ? '#D1FAE5' : 'rgba(255, 255, 255, 0.25)',
                color: activeSubSection === 'TRANSACTION' ? '#047857' : '#ffffff',
                fontWeight: 800
              }}
            >
              {transactionControls.length}
            </span>
          </button>
        </div>
      </div>
      )}

      {/* Detail Modal / Screen Override */}
      {selectedControlId ? (
        <div className="animate-fade-in">
          {/* Back Navigation Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <button
              onClick={() => {
                if (detailPollingRef.current) {
                  clearInterval(detailPollingRef.current);
                  detailPollingRef.current = null;
                }
                setSelectedControlId(null);
                setSelectedControlDetail(null);
                setDetailError('');
                setIncidentSyncState({ cacheStatus: 'NOT_CACHED' });
              }}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem' }}
            >
              <ArrowLeft size={16} /> Back to {activeEntityName}
            </button>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Endpoint: <code>/fscmRestApi/resources/11.13.18.05/advancedControls/{selectedControlId}</code>
            </div>
          </div>

          {/* Loading State */}
          {detailLoading && (
            <div className="glass-panel" style={{ padding: '3.5rem 2rem', textAlign: 'center', marginBottom: '1.5rem' }}>
              <div className="animate-spin" style={{ display: 'inline-block', marginBottom: '1rem', color: 'var(--accent-gold)' }}>
                <RefreshCw size={36} />
              </div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                Loading control details...
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>
                Querying continuous monitoring incidents and configuration from Oracle Fusion...
              </p>
            </div>
          )}

          {/* Error State */}
          {detailError && !detailLoading && (
            <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', borderLeft: '4px solid var(--accent-red)', marginBottom: '1.5rem' }}>
              <AlertCircle size={36} style={{ color: 'var(--accent-red)', marginBottom: '0.75rem' }} />
              <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--accent-red)', marginBottom: '0.4rem' }}>
                {detailError}
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                The backend request to the Oracle Fusion FSCM REST endpoint encountered an issue.
              </p>
              <button
                onClick={() => handleOpenDetail(selectedControlId, true)}
                className="btn btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
              >
                <RefreshCw size={14} /> Retry Request
              </button>
            </div>
          )}

          {/* Populated Control Detail */}
          {selectedControlDetail && !detailLoading && (
            <div>
              {/* Header Card */}
              <div className="glass-panel" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.75rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                      <span className="badge badge-gold" style={{ fontSize: '0.8rem', fontWeight: 700 }}>
                        Control ID: {selectedControlDetail.id}
                      </span>
                      
                      {/* Product-level Type Label */}
                      <span 
                        className="badge" 
                        style={{ 
                          fontSize: '0.75rem', 
                          fontWeight: 700, 
                          backgroundColor: isAccessControl(selectedControlDetail.type) ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)', 
                          color: isAccessControl(selectedControlDetail.type) ? '#3B82F6' : '#10B981',
                          border: isAccessControl(selectedControlDetail.type) ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)'
                        }}
                      >
                        {formatControlTypeName(selectedControlDetail.type)}
                      </span>

                      {/* Secondary Technical Oracle Code Badge */}
                      <span 
                        className="badge" 
                        style={{ 
                          fontSize: '0.72rem', 
                          backgroundColor: 'var(--bg-tertiary)', 
                          color: 'var(--text-muted)',
                          border: '1px solid var(--border-color)'
                        }}
                        title="Oracle Fusion internal numeric type code"
                      >
                        {formatSecondaryTypeBadge(selectedControlDetail.type)}
                      </span>

                      <span className={`badge ${selectedControlDetail.status === 'ACTIVE' ? 'badge-active' : 'badge-inactive'}`} style={{ fontSize: '0.75rem' }}>
                        {selectedControlDetail.status || 'Status N/A'}
                      </span>
                      <span className="badge badge-gold" style={{ fontSize: '0.75rem' }}>
                        State: {selectedControlDetail.state || selectedControlDetail.stateCode || 'APPROVED'}
                      </span>
                    </div>

                    <h2 style={{ fontSize: '1.35rem', fontWeight: 700, fontFamily: 'var(--font-header)', color: 'var(--text-primary)', margin: 0 }}>
                      {selectedControlDetail.name}
                    </h2>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Continuous Incidents</span>
                    <span style={{ 
                      fontSize: '1.6rem', 
                      fontWeight: 800, 
                      color: (incidentsTotalCount !== undefined && incidentsTotalCount !== null ? incidentsTotalCount : (selectedControlDetail.incidentCount ?? 0)) > 0 ? 'var(--accent-red)' : 'var(--accent-green)' 
                    }}>
                      {incidentsTotalCount !== undefined && incidentsTotalCount !== null
                        ? Number(incidentsTotalCount).toLocaleString() 
                        : (incidentsCountLoading 
                            ? 'Calculating...' 
                            : (selectedControlDetail.incidentCount !== undefined && selectedControlDetail.incidentCount !== null
                                ? Number(selectedControlDetail.incidentCount).toLocaleString() 
                                : 'Calculating...'))}
                    </span>
                    {incidentsCountLoading && (
                      <span style={{ fontSize: '0.72rem', color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.25rem', marginTop: '0.2rem' }}>
                        <RefreshCw size={11} className="animate-spin" /> Fetching total...
                      </span>
                    )}
                  </div>
                </div>

                {selectedControlDetail.description && (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5', margin: '0.75rem 0 0 0', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                    {selectedControlDetail.description}
                  </p>
                )}
              </div>

              {/* Control Full Metadata Grid */}
              <div className="glass-panel" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, fontFamily: 'var(--font-header)', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Scale size={18} style={{ color: 'var(--accent-gold)' }} />
                  Control Configuration Details
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Control ID</span>
                    <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>{renderFieldVal(selectedControlDetail.id)}</strong>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Control Name</span>
                    <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>{renderFieldVal(selectedControlDetail.name)}</strong>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Control Domain (Type)</span>
                    <span style={{ color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600 }}>
                      {formatControlTypeName(selectedControlDetail.type)}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                      ({formatSecondaryTypeBadge(selectedControlDetail.type)})
                    </span>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Enforcement Type</span>
                    <span style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>{renderFieldVal(selectedControlDetail.enforcementType)}</span>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Status</span>
                    <span style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>{renderFieldVal(selectedControlDetail.status)}</span>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>State</span>
                    <span style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>{renderFieldVal(selectedControlDetail.state || selectedControlDetail.stateCode)}</span>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Last Run Date</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{formatOracleDate(selectedControlDetail.lastRunDate)}</span>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Last Update Date</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{formatOracleDate(selectedControlDetail.lastUpdateDate)}</span>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Latest Job ID</span>
                    <code style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{renderFieldVal(selectedControlDetail.latestJobId)}</code>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Created By</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{renderFieldVal(selectedControlDetail.createdBy)}</span>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Creation Date</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{formatOracleDate(selectedControlDetail.creationDate)}</span>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Last Updated By</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{renderFieldVal(selectedControlDetail.lastUpdatedBy)}</span>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Scheduled By</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{renderFieldVal(selectedControlDetail.scheduledBy)}</span>
                  </div>
                </div>
              </div>

              {/* Incidents Table Panel with True Pagination */}
              <div className="glass-panel" style={{ padding: '1.75rem', position: 'relative' }}>
                {/* Header Row with Title, Badge, and Action */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, fontFamily: 'var(--font-header)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <AlertCircle size={18} style={{ color: 'var(--accent-red)' }} />
                      Continuous Monitoring Incidents
                    </h3>
                    <span 
                      className="badge" 
                      style={{ 
                        fontSize: '0.75rem', 
                        backgroundColor: 'var(--bg-secondary)', 
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-secondary)'
                      }}
                    >
                      {incidentsList.length > 0 ? (
                        <>
                          Showing {(incidentPage - 1) * incidentPageSize + 1}–{(incidentPage - 1) * incidentPageSize + incidentsList.length}
                          {incidentsTotalCount !== undefined ? ` of ${incidentsTotalCount.toLocaleString()}` : (incidentsHasMore ? ' of many' : '')}
                        </>
                      ) : (
                        '0 incidents'
                      )}
                    </span>
                  </div>

                  <button
                    onClick={handleRefreshIncidents}
                    disabled={incidentsLoading || incidentsCountLoading}
                    className="btn btn-secondary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
                    title="Refresh current page and count from Oracle Fusion"
                  >
                    <RefreshCw size={13} className={incidentsLoading || incidentsCountLoading ? 'animate-spin' : ''} />
                    Refresh Incidents
                  </button>
                </div>

                {/* Initial Loading State */}
                {incidentsLoading && incidentsList.length === 0 && (
                  <div style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                    <RefreshCw size={32} className="animate-spin" style={{ color: 'var(--accent-gold)', marginBottom: '0.75rem' }} />
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                      Retrieving first {incidentPageSize} incidents from Oracle Fusion...
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Querying endpoint with offset={(incidentPage - 1) * incidentPageSize}&limit={incidentPageSize}
                    </div>
                  </div>
                )}

                {/* Error State */}
                {incidentsError && incidentsList.length === 0 && (
                  <div style={{ padding: '2rem 1.5rem', textAlign: 'center', borderLeft: '4px solid var(--accent-red)' }}>
                    <AlertCircle size={28} style={{ color: 'var(--accent-red)', marginBottom: '0.5rem' }} />
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--accent-red)', marginBottom: '0.25rem' }}>
                      {incidentsError}
                    </div>
                    <button
                      onClick={() => loadIncidentsPage(selectedControlId, incidentPage, incidentPageSize)}
                      className="btn btn-primary"
                      style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}
                    >
                      <RefreshCw size={13} /> Retry
                    </button>
                  </div>
                )}

                {/* Empty State */}
                {!incidentsLoading && !incidentsError && incidentsList.length === 0 && (
                  <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }}>
                    <CheckCircle2 size={32} style={{ color: 'var(--accent-green)', marginBottom: '0.5rem' }} />
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                      No continuous monitoring incidents found for this control.
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Oracle Fusion returned zero incident records for control {selectedControlDetail.id}.
                    </div>
                  </div>
                )}

                {/* Incident Records Table */}
                {incidentsList.length > 0 && (
                  <div>
                    <div className="table-container" style={{ margin: 0, overflowX: 'auto', position: 'relative' }}>
                      {/* Dimming overlay when changing page */}
                      {incidentsLoading && (
                        <div 
                          style={{
                            position: 'absolute',
                            inset: 0,
                            backgroundColor: 'rgba(10, 15, 29, 0.65)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 10,
                            backdropFilter: 'blur(2px)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-gold)', fontWeight: 600, fontSize: '0.9rem' }}>
                            <RefreshCw size={18} className="animate-spin" /> Loading page {incidentPage}...
                          </div>
                        </div>
                      )}

                      <table className="enterprise-table">
                        <thead>
                          <tr>
                            <th>Incident ID</th>
                            <th>User Name</th>
                            <th>Role</th>
                            <th>Access Point</th>
                            <th>Status</th>
                            <th>State</th>
                            <th>Created Date</th>
                            <th style={{ textAlign: 'center' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {incidentsList.map((inc: any, idx: number) => {
                            const userName = inc.globalUserName || inc.globalUserId || (inc.userFirstName ? `${inc.userFirstName} ${inc.userLastName || ''}`.trim() : 'N/A');
                            const roleVal = inc.role || 'N/A';
                            const accessPointVal = inc.accessPointName || inc.accessPointType || 'N/A';
                            return (
                              <tr key={inc.id || idx}>
                                <td>
                                  <span style={{ fontWeight: 600, color: 'var(--accent-gold)' }}>{inc.id}</span>
                                </td>
                                <td style={{ fontSize: '0.85rem' }}>{userName}</td>
                                <td style={{ fontSize: '0.85rem' }}>{roleVal}</td>
                                <td style={{ fontSize: '0.85rem' }}>{accessPointVal}</td>
                                <td>
                                  <span className="badge" style={{ fontSize: '0.72rem' }}>
                                    {inc.status || 'ASSIGNED'}
                                  </span>
                                </td>
                                <td>
                                  <span className="badge badge-gold" style={{ fontSize: '0.72rem' }}>
                                    {inc.state || 'APPROVED'}
                                  </span>
                                </td>
                                <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                  {formatOracleDate(inc.creationDate)}
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <button
                                    onClick={() => setViewingIncident(inc)}
                                    className="btn btn-secondary"
                                    style={{ 
                                      display: 'inline-flex', 
                                      alignItems: 'center', 
                                      gap: '0.35rem', 
                                      fontSize: '0.75rem', 
                                      padding: '0.3rem 0.65rem' 
                                    }}
                                    title="View complete Oracle incident record"
                                  >
                                    <Eye size={13} /> View
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination Bar */}
                    <div 
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        flexWrap: 'wrap', 
                        gap: '1rem', 
                        marginTop: '1.25rem', 
                        paddingTop: '1rem', 
                        borderTop: '1px solid var(--border-color)' 
                      }}
                    >
                      {/* Page Size Selector */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        <span>Rows per page:</span>
                        <select
                          value={incidentPageSize}
                          onChange={e => handleIncidentPageSizeChange(Number(e.target.value))}
                          disabled={incidentsLoading}
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            color: 'var(--text-primary)',
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.82rem',
                            cursor: 'pointer'
                          }}
                        >
                          <option value={25}>25</option>
                          <option value={50}>50</option>
                          <option value={100}>100</option>
                        </select>
                      </div>

                      {/* Page indicator */}
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        Page <strong style={{ color: 'var(--text-primary)' }}>{incidentPage}</strong>
                        {incidentsTotalCount ? (
                          <> of <strong style={{ color: 'var(--text-primary)' }}>{Math.ceil(incidentsTotalCount / incidentPageSize) || 1}</strong></>
                        ) : null}
                      </div>

                      {/* Navigation buttons */}
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleIncidentPageChange(incidentPage - 1)}
                          disabled={incidentPage <= 1 || incidentsLoading}
                          className="btn btn-secondary"
                          style={{ 
                            padding: '0.4rem 0.75rem', 
                            fontSize: '0.82rem', 
                            display: 'inline-flex', 
                            alignItems: 'center', 
                            gap: '0.35rem',
                            cursor: incidentPage <= 1 || incidentsLoading ? 'not-allowed' : 'pointer',
                            opacity: incidentPage <= 1 || incidentsLoading ? 0.5 : 1
                          }}
                        >
                          <ChevronLeft size={15} /> Previous
                        </button>
                        <button
                          onClick={() => handleIncidentPageChange(incidentPage + 1)}
                          disabled={
                            incidentsLoading || 
                            (!incidentsHasMore && !(incidentsTotalCount && incidentPage * incidentPageSize < incidentsTotalCount))
                          }
                          className="btn btn-secondary"
                          style={{ 
                            padding: '0.4rem 0.75rem', 
                            fontSize: '0.82rem', 
                            display: 'inline-flex', 
                            alignItems: 'center', 
                            gap: '0.35rem',
                            cursor: incidentsLoading || (!incidentsHasMore && !(incidentsTotalCount && incidentPage * incidentPageSize < incidentsTotalCount)) ? 'not-allowed' : 'pointer',
                            opacity: incidentsLoading || (!incidentsHasMore && !(incidentsTotalCount && incidentPage * incidentPageSize < incidentsTotalCount)) ? 0.5 : 1
                          }}
                        >
                          Next <ChevronRight size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Incident Details Modal (Drawer/Modal View) */}
              {viewingIncident && (
                <div 
                  style={{
                    position: 'fixed',
                    inset: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.75)',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '1.5rem',
                    backdropFilter: 'blur(4px)'
                  }}
                  onClick={() => setViewingIncident(null)}
                >
                  <div 
                    className="glass-panel"
                    style={{
                      maxWidth: '780px',
                      width: '100%',
                      maxHeight: '90vh',
                      overflowY: 'auto',
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '12px',
                      padding: '1.75rem',
                      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)'
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    {/* Modal Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                          <span className="badge badge-gold" style={{ fontSize: '0.8rem', fontWeight: 700 }}>
                            Incident #{viewingIncident.id}
                          </span>
                          <span className="badge" style={{ fontSize: '0.72rem' }}>
                            {viewingIncident.status || 'ASSIGNED'}
                          </span>
                          <span className="badge badge-gold" style={{ fontSize: '0.72rem' }}>
                            {viewingIncident.state || 'APPROVED'}
                          </span>
                        </div>
                        <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                          Oracle Fusion Incident Details
                        </h3>
                      </div>
                      <button 
                        onClick={() => setViewingIncident(null)}
                        className="btn btn-secondary"
                        style={{ padding: '0.35rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Close modal"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    {/* Section 1: User Information */}
                    <div style={{ marginBottom: '1.25rem' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-blue)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
                        <User size={15} /> User Information
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem', backgroundColor: 'var(--bg-secondary)', padding: '1rem', borderRadius: '8px' }}>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>User Name</span>
                          <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                            {renderFieldVal(viewingIncident.globalUserName || viewingIncident.globalUserId)}
                          </strong>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>First Name</span>
                          <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                            {renderFieldVal(viewingIncident.userFirstName)}
                          </span>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Last Name</span>
                          <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                            {renderFieldVal(viewingIncident.userLastName)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Section 2: Access Information */}
                    <div style={{ marginBottom: '1.25rem' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-gold)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
                        <Key size={15} /> Access & Privilege Details
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem', backgroundColor: 'var(--bg-secondary)', padding: '1rem', borderRadius: '8px' }}>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Role</span>
                          <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                            {renderFieldVal(viewingIncident.role)}
                          </strong>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Access Point</span>
                          <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                            {renderFieldVal(viewingIncident.accessPointName)}
                          </span>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Access Point Type</span>
                          <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                            {renderFieldVal(viewingIncident.accessPointType)}
                          </span>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Entitlement</span>
                          <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                            {renderFieldVal(viewingIncident.entitlement)}
                          </span>
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Incident Information</span>
                          <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            {renderFieldVal(viewingIncident.incidentInformation)}
                          </span>
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Conflicting Roles</span>
                          <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                            {renderFieldVal(viewingIncident.conflictingRoles)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Section 3: Incident Metadata */}
                    <div style={{ marginBottom: '1.25rem' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-green)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
                        <FileText size={15} /> Incident Metadata
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem', backgroundColor: 'var(--bg-secondary)', padding: '1rem', borderRadius: '8px' }}>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Incident ID</span>
                          <code style={{ fontSize: '0.85rem', color: 'var(--accent-gold)' }}>{renderFieldVal(viewingIncident.id)}</code>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Control ID</span>
                          <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                            {renderFieldVal(viewingIncident.controlId || selectedControlId)}
                          </span>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Control Name</span>
                          <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                            {renderFieldVal(viewingIncident.controlName || selectedControlDetail?.name)}
                          </span>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Priority</span>
                          <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                            {renderFieldVal(viewingIncident.priority)}
                          </span>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Incident Version</span>
                          <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                            {renderFieldVal(viewingIncident.incidentVersion)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Section 4: Audit Information */}
                    <div style={{ marginBottom: '1.25rem' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
                        <Clock size={15} /> Audit & Timeline
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem', backgroundColor: 'var(--bg-secondary)', padding: '1rem', borderRadius: '8px' }}>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Creation Date</span>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {formatOracleDate(viewingIncident.creationDate)}
                          </span>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Created By</span>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {renderFieldVal(viewingIncident.createdBy)}
                          </span>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Last Updated Date</span>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {formatOracleDate(viewingIncident.lastUpdateDate)}
                          </span>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Last Updated By</span>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {renderFieldVal(viewingIncident.lastUpdatedBy)}
                          </span>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Closed Date</span>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {formatOracleDate(viewingIncident.closedDate)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Modal Footer */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                      <button 
                        onClick={() => setViewingIncident(null)}
                        className="btn btn-secondary"
                        style={{ padding: '0.45rem 1.25rem', fontSize: '0.85rem' }}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Main Catalog View with Two Subsections */
        <div>

          {/* Subsection Description Header Banner */}
          <div 
            className="glass-panel" 
            style={{ 
              padding: '0.85rem 1.25rem', 
              marginBottom: '1.5rem', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              borderLeft: activeSubSection === 'ACCESS' ? '4px solid #3B82F6' : '4px solid #10B981',
              backgroundColor: 'var(--bg-secondary)'
            }}
          >
            <div>
              <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, color: activeSubSection === 'ACCESS' ? '#3B82F6' : '#10B981' }}>
                {activeSubSection === 'ACCESS' ? 'Access Controls Domain (Oracle Type 173)' : 'Transaction Controls Domain (Oracle Type 174)'}
              </span>
              <div style={{ color: 'var(--text-primary)', fontSize: '0.88rem', fontWeight: 500, marginTop: '0.15rem' }}>
                {activeSubSection === 'ACCESS' 
                  ? 'Controls that govern access to functions, data, roles, and privileges.' 
                  : 'Controls that monitor sensitive or conflicting business transactions.'}
              </div>
            </div>

            {lastRefreshed && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Catalog synced: {lastRefreshed}
              </span>
            )}
          </div>

          {/* 3. KPI Cards for Selected Subsection */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem', marginBottom: '1.75rem' }}>
            {/* Total Controls */}
            <div className="glass-panel" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Scale size={16} style={{ color: activeSubSection === 'ACCESS' ? '#3B82F6' : '#10B981' }} />
                Total {activeSubSection === 'ACCESS' ? 'Access' : 'Transaction'} Controls
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {kpiTotal}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                Oracle Type {activeSubSection === 'ACCESS' ? '173' : '174'} Inventory
              </div>
            </div>

            {/* Active Controls */}
            <div className="glass-panel" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={16} style={{ color: 'var(--accent-green)' }} />
                Active Controls
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {kpiActive}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                Active continuous monitoring
              </div>
            </div>

            {/* Inactive Controls */}
            <div className="glass-panel" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <XCircle size={16} style={{ color: 'var(--text-muted)' }} />
                Inactive Controls
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {kpiInactive}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                Disabled or pending activation
              </div>
            </div>

            {/* Total Incidents */}
            <div className="glass-panel" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <AlertCircle size={16} style={{ color: kpiTotalIncidentsCount > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }} />
                Total Incidents
              </div>
              <div style={{ fontSize: hasIncidentData ? '1.75rem' : '1.05rem', fontWeight: 800, color: kpiTotalIncidentsCount > 0 ? 'var(--accent-red)' : 'var(--text-primary)', lineHeight: hasIncidentData ? '1.2' : '1.8' }}>
                {hasIncidentData ? kpiTotalIncidentsCount.toLocaleString() : (countsLoading || controlsRefreshing ? 'Calculating...' : 'Not available')}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                {hasIncidentData 
                  ? (allControlsUpdated ? 'All controls updated' : `${knownCountTotal} of ${activeSubsectionControls.length} controls updated`) 
                  : (countsLoading ? 'Checking incident count cache...' : 'Run incident scan to calculate')}
              </div>
            </div>
          </div>

          {/* 4. Toolbar: Search, Filters, Columns Customizer, Enterprise Export */}
          <div 
            className="glass-panel" 
            style={{ 
              padding: '1rem', 
              marginBottom: '1.25rem', 
              display: 'flex', 
              gap: '0.85rem', 
              flexWrap: 'wrap', 
              alignItems: 'center' 
            }}
          >
            {/* Search Input - scoped strictly to selected subsection */}
            <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
              <Search 
                size={16} 
                style={{ 
                  position: 'absolute', 
                  left: '0.75rem', 
                  top: '50%', 
                  transform: 'translateY(-50%)', 
                  color: 'var(--text-muted)' 
                }} 
              />
              <input
                id="control-search-input"
                type="text"
                placeholder={`Search ${activeEntityName.toLowerCase()} by ID, Name, Description...`}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem 0.5rem 2.25rem',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem'
                }}
              />
            </div>

            {/* Status Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Filter size={15} style={{ color: 'var(--text-muted)' }} />
              <select
                id="filter-status-select"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem'
                }}
              >
                <option value="ALL">All Statuses ({activeSubsectionControls.length})</option>
                {availableStatuses.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* State Filter */}
            {availableStates.length > 0 && (
              <div>
                <select
                  id="filter-state-select"
                  value={stateFilter}
                  onChange={e => setStateFilter(e.target.value)}
                  style={{
                    padding: '0.5rem 0.75rem',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem'
                  }}
                >
                  <option value="ALL">All States</option>
                  {availableStates.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Incident Filter */}
            <div>
              <select
                id="filter-incident-select"
                value={incidentFilter}
                onChange={e => setIncidentFilter(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem'
                }}
              >
                <option value="ALL">All Incidents</option>
                <option value="WITH_INCIDENTS">With Incidents</option>
                <option value="ZERO_INCIDENTS">Zero Incidents</option>
                <option value="NOT_SCANNED">Not Scanned</option>
              </select>
            </div>

            {/* Professional Columns Customizer Dropdown */}
            <div style={{ position: 'relative' }} ref={columnsDropdownRef}>
              <button
                id="btn-toggle-columns"
                onClick={() => setIsColumnsDropdownOpen(prev => !prev)}
                className="btn btn-secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.5rem 0.85rem',
                  fontSize: '0.85rem',
                  borderRadius: '6px'
                }}
                title="Customize table columns"
              >
                <Columns size={15} />
                <span>Columns</span>
                <ChevronDown size={14} />
              </button>

              {isColumnsDropdownOpen && (
                <div
                  id="columns-selector-dropdown"
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '110%',
                    width: '260px',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.4)',
                    padding: '0.75rem',
                    zIndex: 50
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Visible Columns ({visibleColumnKeys.size}/{ALL_COLUMNS.length})
                    </span>
                    <button
                      onClick={resetToDefaultColumns}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-gold)',
                        fontSize: '0.72rem',
                        cursor: 'pointer',
                        padding: 0
                      }}
                      title="Reset to default columns"
                    >
                      Reset
                    </button>
                  </div>

                  {/* Actions: Select All / Clear All */}
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.65rem' }}>
                    <button
                      onClick={selectAllColumns}
                      style={{
                        flex: 1,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        fontSize: '0.72rem',
                        padding: '0.25rem',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer'
                      }}
                    >
                      Select All
                    </button>
                    <button
                      onClick={clearAllColumns}
                      style={{
                        flex: 1,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        fontSize: '0.72rem',
                        padding: '0.25rem',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer'
                      }}
                    >
                      Clear All
                    </button>
                  </div>

                  {/* Columns List */}
                  <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {ALL_COLUMNS.map(col => {
                      const isChecked = visibleColumnKeys.has(col.key);
                      return (
                        <label
                          key={col.key}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            fontSize: '0.8rem',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            padding: '0.25rem 0.35rem',
                            borderRadius: '4px',
                            backgroundColor: isChecked ? 'rgba(59, 130, 246, 0.08)' : 'transparent'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleColumn(col.key)}
                            style={{ cursor: 'pointer' }}
                          />
                          <span>{col.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Enterprise Export Control - Scoped strictly to active subsection */}
            <div id="export-controls-container">
              <EnterpriseExportControl
                filename={activeSubSection === 'ACCESS' ? 'oracle_access_controls' : 'oracle_transaction_controls'}
                sheetName={activeSubSection === 'ACCESS' ? 'Access Controls' : 'Transaction Controls'}
                reportTitle={activeSubSection === 'ACCESS' ? 'Oracle Fusion Access Controls (Type 173)' : 'Oracle Fusion Transaction Controls (Type 174)'}
                dataSource={dataSource || (environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Data')}
                entityName={activeEntityName}
                categoryLabel={activeEntityName}
                buttonText={`Export ${activeEntityName}`}
                currentPageData={paginatedControls}
                filteredCount={filteredControls.length}
                totalCount={activeSubsectionControls.length}
                availableColumns={exportColumns}
                appliedFilters={[
                  ...(statusFilter !== 'ALL' ? [{ label: 'Status', value: statusFilter }] : []),
                  ...(stateFilter !== 'ALL' ? [{ label: 'State', value: stateFilter }] : []),
                  ...(incidentFilter !== 'ALL' ? [{ label: 'Incidents', value: incidentFilter }] : []),
                  ...(searchQuery.trim() ? [{ label: 'Search', value: searchQuery }] : [])
                ]}
                onFetchScopeData={async (scope) => {
                  if (scope === 'PAGE') return paginatedControls;
                  if (scope === 'FILTERED') return filteredControls;
                  return activeSubsectionControls;
                }}
              />
            </div>
          </div>

          {/* Active filter chips — compact, removable without reopening dropdowns */}
          {(statusFilter !== 'ALL' || stateFilter !== 'ALL' || incidentFilter !== 'ALL' || searchQuery.trim()) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.85rem' }} aria-label="Active control filters">
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Active filters:</span>
              {searchQuery.trim() && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', fontWeight: 600, backgroundColor: 'rgba(37, 99, 235, 0.08)', color: 'var(--accent-blue)', border: '1px solid rgba(37,99,235,0.25)', borderRadius: '9999px', padding: '0.2rem 0.6rem', cursor: 'pointer', maxWidth: '300px' }}
                  aria-label="Remove search filter"
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Search: {searchQuery.trim()}</span>
                  <X size={12} />
                </button>
              )}
              {statusFilter !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setStatusFilter('ALL')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', fontWeight: 600, backgroundColor: 'rgba(37, 99, 235, 0.08)', color: 'var(--accent-blue)', border: '1px solid rgba(37,99,235,0.25)', borderRadius: '9999px', padding: '0.2rem 0.6rem', cursor: 'pointer' }}
                  aria-label="Remove status filter"
                >
                  {statusFilter} <X size={12} />
                </button>
              )}
              {stateFilter !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setStateFilter('ALL')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', fontWeight: 600, backgroundColor: 'rgba(37, 99, 235, 0.08)', color: 'var(--accent-blue)', border: '1px solid rgba(37,99,235,0.25)', borderRadius: '9999px', padding: '0.2rem 0.6rem', cursor: 'pointer' }}
                  aria-label="Remove state filter"
                >
                  {stateFilter} <X size={12} />
                </button>
              )}
              {incidentFilter !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setIncidentFilter('ALL')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', fontWeight: 600, backgroundColor: 'rgba(37, 99, 235, 0.08)', color: 'var(--accent-blue)', border: '1px solid rgba(37,99,235,0.25)', borderRadius: '9999px', padding: '0.2rem 0.6rem', cursor: 'pointer' }}
                  aria-label="Remove incident filter"
                >
                  {incidentFilter} <X size={12} />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('ALL');
                  setStateFilter('ALL');
                  setIncidentFilter('ALL');
                }}
                style={{ background: 'none', border: 'none', fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Clear all
              </button>
            </div>
          )}

          {/* Result counts — total dataset vs filtered vs current page */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>{activeSubsectionControls.length.toLocaleString()}</strong> {activeEntityName.toLowerCase()} in domain
              {filteredControls.length !== activeSubsectionControls.length && (
                <span> · <strong style={{ color: 'var(--accent-blue)' }}>{filteredControls.length.toLocaleString()}</strong> matching filters</span>
              )}
            </div>
            <div>
              Showing {paginatedControls.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}&ndash;{Math.min(currentPage * pageSize, sortedControls.length)} of {sortedControls.length.toLocaleString()}
            </div>
          </div>

          {/* 5. Control Table with Horizontal Scroll Support */}
          <div 
            className="table-container" 
            style={{ 
              margin: 0, 
              overflowX: 'auto',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-primary)'
            }}
          >
            <table className="enterprise-table" style={{ width: '100%', minWidth: '950px' }}>
              <thead>
                <tr>
                  {visibleColumnKeys.has('id') && (
                    <th 
                      style={{ width: '110px', cursor: 'pointer' }}
                      onClick={() => handleSortClick('id')}
                      title="Sort by Control ID"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span>Control ID</span>
                        {sortField === 'id' ? (sortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                  )}

                  {visibleColumnKeys.has('name') && (
                    <th 
                      style={{ minWidth: '280px', cursor: 'pointer' }}
                      onClick={() => handleSortClick('name')}
                      title="Sort by Control Name"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span>Control Name</span>
                        {sortField === 'name' ? (sortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                  )}

                  {visibleColumnKeys.has('type') && (
                    <th style={{ width: '150px' }}>Type</th>
                  )}

                  {visibleColumnKeys.has('status') && (
                    <th 
                      style={{ width: '110px', cursor: 'pointer' }}
                      onClick={() => handleSortClick('status')}
                      title="Sort by Status"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span>Status</span>
                        {sortField === 'status' ? (sortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                  )}

                  {visibleColumnKeys.has('state') && (
                    <th style={{ width: '110px' }}>State</th>
                  )}

                  {visibleColumnKeys.has('incidentCount') && (
                    <th 
                      style={{ width: '110px', cursor: 'pointer' }}
                      onClick={() => handleSortClick('incidentCount')}
                      title="Sort by Incidents Count"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span>Incidents</span>
                        {sortField === 'incidentCount' ? (sortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                  )}

                  {visibleColumnKeys.has('lastRunDate') && (
                    <th 
                      style={{ width: '130px', cursor: 'pointer' }}
                      onClick={() => handleSortClick('lastRunDate')}
                      title="Sort by Last Run Date"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span>Last Run</span>
                        {sortField === 'lastRunDate' ? (sortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                  )}

                  {visibleColumnKeys.has('lastUpdateDate') && (
                    <th 
                      style={{ width: '130px', cursor: 'pointer' }}
                      onClick={() => handleSortClick('lastUpdateDate')}
                      title="Sort by Last Update Date"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span>Last Updated</span>
                        {sortField === 'lastUpdateDate' ? (sortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                  )}

                  {visibleColumnKeys.has('description') && (
                    <th style={{ minWidth: '260px' }}>Description</th>
                  )}

                  {visibleColumnKeys.has('enforcementType') && (
                    <th style={{ width: '140px' }}>Enforcement</th>
                  )}

                  {visibleColumnKeys.has('latestJobId') && (
                    <th style={{ width: '130px' }}>Job ID</th>
                  )}

                  {visibleColumnKeys.has('createdBy') && (
                    <th style={{ width: '140px' }}>Created By</th>
                  )}

                  {visibleColumnKeys.has('creationDate') && (
                    <th style={{ width: '130px' }}>Creation Date</th>
                  )}

                  {visibleColumnKeys.has('lastUpdatedBy') && (
                    <th style={{ width: '140px' }}>Updated By</th>
                  )}

                  {visibleColumnKeys.has('scheduledBy') && (
                    <th style={{ width: '140px' }}>Scheduled By</th>
                  )}

                  <th style={{ width: '100px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>

              <tbody>
                {sortedControls.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumnKeys.size + 1} style={{ textAlign: 'center', padding: '3.5rem', color: 'var(--text-muted)' }}>
                      No {activeEntityName.toLowerCase()} match the search or filter criteria.
                    </td>
                  </tr>
                ) : (
                  paginatedControls.map(ctrl => {
                    const domain = isAccessControl(ctrl.type) ? 'ACCESS' : (isTransactionControl(ctrl.type) ? 'TRANSACTION' : 'OTHER');
                    const typeLabel = formatControlTypeName(ctrl.type);
                    const secondaryBadge = formatSecondaryTypeBadge(ctrl.type);

                    return (
                      <tr
                        key={ctrl.id}
                        onClick={() => handleOpenDetail(ctrl.id)}
                        style={{ cursor: 'pointer' }}
                        title="Click row to inspect continuous monitoring incidents"
                      >
                        {visibleColumnKeys.has('id') && (
                          <td>
                            <span style={{ fontWeight: 700, color: 'var(--accent-gold)', fontSize: '0.85rem' }}>
                              {ctrl.id}
                            </span>
                          </td>
                        )}

                        {visibleColumnKeys.has('name') && (
                          <td>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                              {ctrl.name}
                            </div>
                            {/* If description column is hidden, show single-line truncated hint under name with tooltip */}
                            {!visibleColumnKeys.has('description') && ctrl.description && (
                              <div 
                                style={{ 
                                  fontSize: '0.75rem', 
                                  color: 'var(--text-muted)', 
                                  marginTop: '0.2rem', 
                                  whiteSpace: 'nowrap', 
                                  overflow: 'hidden', 
                                  textOverflow: 'ellipsis', 
                                  maxWidth: '380px' 
                                }}
                                title={ctrl.description}
                              >
                                {ctrl.description}
                              </div>
                            )}
                          </td>
                        )}

                        {visibleColumnKeys.has('type') && (
                          <td>
                            <span 
                              className="badge"
                              style={{
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                backgroundColor: domain === 'ACCESS' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                                color: domain === 'ACCESS' ? '#3B82F6' : '#10B981',
                                border: domain === 'ACCESS' ? '1px solid rgba(59, 130, 246, 0.25)' : '1px solid rgba(16, 185, 129, 0.25)'
                              }}
                              title={secondaryBadge}
                            >
                              {typeLabel}
                            </span>
                          </td>
                        )}

                        {visibleColumnKeys.has('status') && (
                          <td>
                            <span 
                              className={`badge ${(ctrl.status || '').toUpperCase() === 'ACTIVE' ? 'badge-active' : 'badge-inactive'}`} 
                              style={{ fontSize: '0.72rem' }}
                            >
                              {ctrl.status || 'ACTIVE'}
                            </span>
                          </td>
                        )}

                        {visibleColumnKeys.has('state') && (
                          <td>
                            <span className="badge badge-gold" style={{ fontSize: '0.72rem' }}>
                              {ctrl.state || ctrl.stateCode || 'APPROVED'}
                            </span>
                          </td>
                        )}

                        {visibleColumnKeys.has('incidentCount') && (
                          <td>
                            {ctrl.incidentCount !== undefined && ctrl.incidentCount !== null ? (
                              <span 
                                style={{ 
                                  fontWeight: 700, 
                                  fontSize: '0.85rem',
                                  color: ctrl.incidentCount > 0 ? 'var(--accent-red)' : 'var(--accent-green)' 
                                }}
                              >
                                {Number(ctrl.incidentCount).toLocaleString()}
                              </span>
                            ) : (ctrl as any).incidentCountStatus === 'CALCULATING' ? (
                              <span style={{ fontSize: '0.75rem', color: 'var(--accent-blue)', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                <RefreshCw size={11} className="animate-spin" /> Calculating...
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                Not scanned
                              </span>
                            )}
                          </td>
                        )}

                        {visibleColumnKeys.has('lastRunDate') && (
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {formatOracleDate(ctrl.lastRunDate)}
                          </td>
                        )}

                        {visibleColumnKeys.has('lastUpdateDate') && (
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {formatOracleDate(ctrl.lastUpdateDate)}
                          </td>
                        )}

                        {visibleColumnKeys.has('description') && (
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '280px' }}>
                            <div 
                              style={{ 
                                whiteSpace: 'nowrap', 
                                overflow: 'hidden', 
                                textOverflow: 'ellipsis' 
                              }}
                              title={ctrl.description || ''}
                            >
                              {renderFieldVal(ctrl.description)}
                            </div>
                          </td>
                        )}

                        {visibleColumnKeys.has('enforcementType') && (
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {renderFieldVal(ctrl.enforcementType)}
                          </td>
                        )}

                        {visibleColumnKeys.has('latestJobId') && (
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            <code>{renderFieldVal(ctrl.latestJobId)}</code>
                          </td>
                        )}

                        {visibleColumnKeys.has('createdBy') && (
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {renderFieldVal(ctrl.createdBy)}
                          </td>
                        )}

                        {visibleColumnKeys.has('creationDate') && (
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {formatOracleDate(ctrl.creationDate)}
                          </td>
                        )}

                        {visibleColumnKeys.has('lastUpdatedBy') && (
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {renderFieldVal(ctrl.lastUpdatedBy)}
                          </td>
                        )}

                        {visibleColumnKeys.has('scheduledBy') && (
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {renderFieldVal(ctrl.scheduledBy)}
                          </td>
                        )}

                        <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                          <button
                            id={`btn-details-${ctrl.id}`}
                            onClick={() => handleOpenDetail(ctrl.id)}
                            className="btn btn-secondary"
                            style={{ 
                              padding: '0.3rem 0.65rem', 
                              fontSize: '0.75rem', 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: '0.3rem' 
                            }}
                          >
                            <Eye size={13} />
                            Details
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 6. Footer result counts, page-size selector & numbered pagination */}
          <div
            style={{
              marginTop: '1rem',
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label htmlFor="controls-page-size">Rows per page:</label>
              <select
                id="controls-page-size"
                value={pageSize}
                onChange={e => setPageSize(Number(e.target.value))}
                style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.3rem 0.5rem', fontSize: '0.8rem', color: 'var(--text-primary)' }}
              >
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </div>

            {totalPages > 1 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="btn btn-secondary"
                  style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                  aria-label="Previous controls page"
                >
                  <ChevronLeft size={14} />
                  <span>Prev</span>
                </button>
                {(() => {
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
                  return pages.map((p, idx) =>
                    typeof p === 'string' ? (
                      <span key={`ellipsis-${idx}`} style={{ padding: '0 0.3rem', fontSize: '0.8rem' }}>...</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p)}
                        aria-label={`Go to controls page ${p}`}
                        aria-current={p === currentPage ? 'page' : undefined}
                        style={{
                          minWidth: '30px',
                          padding: '0.35rem 0.5rem',
                          fontSize: '0.78rem',
                          fontWeight: p === currentPage ? 700 : 500,
                          borderRadius: '6px',
                          border: p === currentPage ? '1px solid var(--accent-blue)' : '1px solid var(--border-color)',
                          backgroundColor: p === currentPage ? 'var(--accent-blue-light)' : '#FFFFFF',
                          color: p === currentPage ? 'var(--accent-blue)' : 'var(--text-secondary)',
                          cursor: 'pointer'
                        }}
                      >
                        {p}
                      </button>
                    )
                  );
                })()}
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="btn btn-secondary"
                  style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                  aria-label="Next controls page"
                >
                  <span>Next</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            ) : (
              <div>
                Showing {paginatedControls.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} - {Math.min(currentPage * pageSize, sortedControls.length)} of {sortedControls.length} {activeEntityName.toLowerCase()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
