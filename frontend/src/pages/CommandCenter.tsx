import React, { useState, useEffect, useMemo } from 'react';
import { 
  Terminal, 
  Send, 
  Play, 
  Save, 
  Trash2, 
  History, 
  FolderGit2, 
  Layers, 
  ShieldCheck, 
  ShieldAlert, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Copy, 
  Check, 
  Search, 
  Plus, 
  X, 
  RefreshCw, 
  ExternalLink, 
  Database, 
  Code2, 
  Table as TableIcon, 
  FileText, 
  Sliders, 
  Lock, 
  ArrowRight,
  Info,
  ChevronRight,
  ChevronDown
} from 'lucide-react';
import { api } from '../services/api';
import { TableExportControl } from '../components/TableExportControl';

interface KeyValueRow {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export default function CommandCenter({ onNavigatePage }: { onNavigatePage?: (pageId: string) => void }) {
  // Navigation & Catalog states
  const [activeLeftTab, setActiveLeftTab] = useState<'CATALOG' | 'SAVED' | 'HISTORY'>('CATALOG');
  const [catalog, setCatalog] = useState<any[]>([]);
  const [savedRequests, setSavedRequests] = useState<any[]>([]);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [searchCatalogQuery, setSearchCatalogQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    'Risk Management': true,
    'Users & Identities': true,
    'Roles Catalog': false,
    'Audit Trail': false,
    'Oracle Integration': false
  });

  // Request Builder states
  const [method, setMethod] = useState<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>('GET');
  const [urlPath, setUrlPath] = useState('/fscmRestApi/resources/11.13.18.05/advancedControls');
  const [activeBuilderTab, setActiveBuilderTab] = useState<'PARAMS' | 'HEADERS' | 'AUTH' | 'BODY'>('PARAMS');
  const [queryParams, setQueryParams] = useState<KeyValueRow[]>([
    { id: '1', key: 'limit', value: '25', enabled: true },
    { id: '2', key: 'offset', value: '0', enabled: true }
  ]);
  const [headers, setHeaders] = useState<KeyValueRow[]>([
    { id: '1', key: 'Accept', value: 'application/json', enabled: true },
    { id: '2', key: 'Content-Type', value: 'application/json', enabled: true }
  ]);
  const [authMode, setAuthMode] = useState<'FUSION_DEFAULT' | 'NONE'>('FUSION_DEFAULT');
  const [bodyText, setBodyText] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState(30);

  // Execution & Response states
  const [executing, setExecuting] = useState(false);
  const [responseResult, setResponseResult] = useState<any | null>(null);
  const [activeResponseTab, setActiveResponseTab] = useState<'JSON' | 'TABLE' | 'RAW' | 'HEADERS'>('JSON');
  const [jsonSearchQuery, setJsonSearchQuery] = useState('');
  const [copiedResponse, setCopiedResponse] = useState(false);

  // Connection Health probe state
  const [connectionHealth, setConnectionHealth] = useState<{
    tested: boolean;
    connected: boolean;
    testing: boolean;
    latencyMs: number;
    message: string;
    timestamp: string;
    baseUrl: string;
  }>({
    tested: false,
    connected: false,
    testing: false,
    latencyMs: 0,
    message: '',
    timestamp: '',
    baseUrl: ''
  });

  // Save Modal state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveCategory, setSaveCategory] = useState('Risk Management');
  const [saveDescription, setSaveDescription] = useState('');

  // Initial Load: Catalog, History, Saved Requests, and Connection Health
  useEffect(() => {
    loadCatalog();
    loadSavedRequests();
    loadHistory();
    probeConnectionHealth();
  }, []);

  async function loadCatalog() {
    try {
      const res = await api.getCommandCenterCatalog();
      if (res.success && Array.isArray(res.catalog)) {
        setCatalog(res.catalog);
      }
    } catch (err) {
      console.error('Failed to load API catalog:', err);
    }
  }

  async function loadSavedRequests() {
    try {
      const res = await api.getCommandCenterSavedRequests();
      if (res.success && Array.isArray(res.items)) {
        setSavedRequests(res.items);
      }
    } catch (err) {
      console.error('Failed to load saved requests:', err);
    }
  }

  async function loadHistory() {
    try {
      const res = await api.getCommandCenterHistory();
      if (res.success && Array.isArray(res.history)) {
        setHistoryItems(res.history);
      }
    } catch (err) {
      console.error('Failed to load execution history:', err);
    }
  }

  async function probeConnectionHealth() {
    setConnectionHealth(prev => ({ ...prev, testing: true }));
    try {
      const res = await api.testCommandCenterConnection();
      setConnectionHealth({
        tested: true,
        connected: !!res.connected,
        testing: false,
        latencyMs: res.responseTimeMs || 0,
        message: res.message || (res.connected ? 'Connected' : 'Unavailable'),
        timestamp: new Date().toLocaleTimeString(),
        baseUrl: res.baseUrl || ''
      });
    } catch (err: any) {
      setConnectionHealth({
        tested: true,
        connected: false,
        testing: false,
        latencyMs: 0,
        message: err.message || 'Probe failed',
        timestamp: new Date().toLocaleTimeString(),
        baseUrl: ''
      });
    }
  }

  // Load an endpoint from the catalog into the Request Builder
  function loadCatalogItem(item: any, dynamicControlId?: string) {
    setMethod(item.method || 'GET');
    let path = item.path;
    if (dynamicControlId && path.includes('{ControlId}')) {
      path = path.replace('{ControlId}', dynamicControlId);
    }
    setUrlPath(path);

    // Populate default query params
    const newParams: KeyValueRow[] = [];
    if (item.defaultParams) {
      Object.entries(item.defaultParams).forEach(([k, v], idx) => {
        newParams.push({ id: String(idx + 1), key: k, value: String(v), enabled: true });
      });
    }
    setQueryParams(newParams);

    // Populate default headers
    const newHeaders: KeyValueRow[] = [
      { id: '1', key: 'Accept', value: 'application/json', enabled: true },
      { id: '2', key: 'Content-Type', value: 'application/json', enabled: true }
    ];
    if (item.defaultHeaders) {
      Object.entries(item.defaultHeaders).forEach(([k, v], idx) => {
        const existing = newHeaders.find(h => h.key.toLowerCase() === k.toLowerCase());
        if (existing) {
          existing.value = String(v);
        } else {
          newHeaders.push({ id: String(newHeaders.length + idx + 1), key: k, value: String(v), enabled: true });
        }
      });
    }
    setHeaders(newHeaders);

    // Body
    if (item.defaultBody) {
      setBodyText(JSON.stringify(item.defaultBody, null, 2));
      setActiveBuilderTab('BODY');
    } else {
      setBodyText('');
      setActiveBuilderTab(newParams.length > 0 ? 'PARAMS' : 'HEADERS');
    }
  }

  // Execute Request
  async function handleSendRequest(overrideUrl?: string, overrideMethod?: string) {
    const targetMethod = overrideMethod || method;
    const targetUrl = overrideUrl || urlPath;

    if (!targetUrl.trim()) {
      alert('Please specify a request URL or endpoint path.');
      return;
    }

    setExecuting(true);
    setResponseResult(null);

    // Build query params
    const paramsMap: Record<string, string> = {};
    queryParams
      .filter(p => p.enabled && p.key.trim())
      .forEach(p => {
        paramsMap[p.key.trim()] = p.value.trim();
      });

    // Build headers
    const headersMap: Record<string, string> = {};
    headers
      .filter(h => h.enabled && h.key.trim())
      .forEach(h => {
        headersMap[h.key.trim()] = h.value.trim();
      });

    try {
      const res = await api.executeCommandCenterRequest({
        method: targetMethod,
        url: targetUrl,
        params: Object.keys(paramsMap).length > 0 ? paramsMap : undefined,
        headers: Object.keys(headersMap).length > 0 ? headersMap : undefined,
        body: ['POST', 'PUT', 'PATCH'].includes(targetMethod) && bodyText.trim() ? bodyText : undefined,
        authMode,
        timeoutMs: timeoutSeconds * 1000
      });

      setResponseResult(res);

      // Auto select appropriate response tab
      if (res.data && (Array.isArray(res.data.items) || Array.isArray(res.data.Resources))) {
        setActiveResponseTab('TABLE');
      } else {
        setActiveResponseTab('JSON');
      }

      // Refresh history
      loadHistory();
    } catch (err: any) {
      setResponseResult({
        success: false,
        status: 500,
        statusText: 'Client Execution Error',
        responseTimeMs: 0,
        responseSizeBytes: 0,
        responseSizeFormatted: '0 B',
        timestamp: new Date().toISOString(),
        headers: {},
        data: { error: err.message || 'Execution failed' },
        requestUrl: targetUrl,
        diagnostic: {
          category: 'UNKNOWN',
          title: 'Request Failed',
          message: err.message || 'An error occurred prior to receiving a response.',
          severity: 'error'
        }
      });
      setActiveResponseTab('JSON');
    } finally {
      setExecuting(false);
    }
  }

  // Copy response payload to clipboard
  function handleCopyResponse() {
    if (!responseResult?.data) return;
    const content = typeof responseResult.data === 'string' 
      ? responseResult.data 
      : JSON.stringify(responseResult.data, null, 2);
    navigator.clipboard.writeText(content);
    setCopiedResponse(true);
    setTimeout(() => setCopiedResponse(false), 2000);
  }

  // Save current request
  async function handleSaveCurrentRequest() {
    if (!saveName.trim()) {
      alert('Please enter a name for the saved request.');
      return;
    }

    const paramsMap: Record<string, string> = {};
    queryParams.filter(p => p.enabled && p.key.trim()).forEach(p => {
      paramsMap[p.key.trim()] = p.value.trim();
    });

    const headersMap: Record<string, string> = {};
    headers.filter(h => h.enabled && h.key.trim()).forEach(h => {
      headersMap[h.key.trim()] = h.value.trim();
    });

    try {
      await api.saveCommandCenterRequest({
        name: saveName.trim(),
        category: saveCategory.trim(),
        description: saveDescription.trim(),
        method,
        url: urlPath,
        params: paramsMap,
        headers: headersMap,
        body: bodyText
      });
      setShowSaveModal(false);
      setSaveName('');
      setSaveDescription('');
      loadSavedRequests();
      setActiveLeftTab('SAVED');
    } catch (err: any) {
      alert('Failed to save request: ' + err.message);
    }
  }

  async function handleDeleteSavedRequest(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this saved request?')) return;
    try {
      await api.deleteCommandCenterSavedRequest(id);
      loadSavedRequests();
    } catch (err: any) {
      alert('Failed to delete request: ' + err.message);
    }
  }

  async function handleClearHistory() {
    if (!confirm('Clear all execution history items?')) return;
    try {
      await api.clearCommandCenterHistory();
      setHistoryItems([]);
    } catch (err: any) {
      alert('Failed to clear history: ' + err.message);
    }
  }

  // Filter catalog items
  const filteredCatalog = useMemo(() => {
    if (!searchCatalogQuery.trim()) return catalog;
    const q = searchCatalogQuery.toLowerCase();
    return catalog.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.path.toLowerCase().includes(q) || 
      c.category.toLowerCase().includes(q) ||
      (c.subCategory && c.subCategory.toLowerCase().includes(q))
    );
  }, [catalog, searchCatalogQuery]);

  // Group catalog by Category
  const groupedCatalog = useMemo(() => {
    const groups: Record<string, any[]> = {};
    filteredCatalog.forEach(item => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    });
    return groups;
  }, [filteredCatalog]);

  // Tabular response parsing
  const tableData = useMemo(() => {
    if (!responseResult?.data) return { rows: [], columns: [] };
    const data = responseResult.data;
    const list = Array.isArray(data.items) 
      ? data.items 
      : Array.isArray(data.Resources) 
      ? data.Resources 
      : Array.isArray(data) 
      ? data 
      : null;

    if (!list || list.length === 0) return { rows: [], columns: [] };

    // Discover top columns
    const columnSet = new Set<string>();
    list.slice(0, 10).forEach((item: any) => {
      if (typeof item === 'object' && item !== null) {
        Object.keys(item).forEach(k => {
          if (k !== 'links' && typeof item[k] !== 'object') {
            columnSet.add(k);
          }
        });
      }
    });

    const columns = Array.from(columnSet).slice(0, 8);
    return { rows: list, columns };
  }, [responseResult]);

  // Check if response contains Advanced Controls list or individual control
  const isControlsList = useMemo(() => {
    return urlPath.includes('/advancedControls') && !urlPath.includes('/child/') && Array.isArray(responseResult?.data?.items);
  }, [urlPath, responseResult]);

  const isSingleControl = useMemo(() => {
    return urlPath.includes('/advancedControls/') && !urlPath.includes('/child/') && responseResult?.data && !Array.isArray(responseResult.data);
  }, [urlPath, responseResult]);

  // Method badge colors
  function getMethodBadgeColor(m: string) {
    switch (m.toUpperCase()) {
      case 'GET': return { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' };
      case 'POST': return { bg: '#ECFDF5', text: '#059669', border: '#A7F3D0' };
      case 'PUT': return { bg: '#FFFBEB', text: '#D97706', border: '#FDE68A' };
      case 'PATCH': return { bg: '#FDF4FF', text: '#C026D3', border: '#F5D0FE' };
      case 'DELETE': return { bg: '#FEF2F2', text: '#DC2626', border: '#FECACA' };
      default: return { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' };
    }
  }

  // Status code color
  function getStatusColor(status: number) {
    if (status >= 200 && status < 300) return { bg: '#DCFCE7', text: '#15803D', border: '#86EFAC' };
    if (status >= 400 && status < 500) return { bg: '#FEF3C7', text: '#B45309', border: '#FCD34D' };
    if (status >= 500) return { bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5' };
    return { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' };
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: '#F8FAFC',
      color: '#0F172A',
      fontFamily: 'var(--font-body, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
      overflow: 'hidden'
    }}>
      
      {/* ==========================================================
          TOP STATUS BAR: BRANDING & LIVE CONNECTION PROBE
          ========================================================== */}
      <div style={{
        padding: '0.85rem 1.75rem',
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #E2E8F0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        {/* Title & Description */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #1E40AF 0%, #3B82F6 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
            boxShadow: '0 2px 8px rgba(37, 99, 235, 0.25)'
          }}>
            <Terminal size={20} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
                Oracle API Console
              </h1>
              <span style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#2563EB',
                backgroundColor: '#EFF6FF',
                padding: '2px 8px',
                borderRadius: '12px',
                border: '1px solid #DBEAFE'
              }}>
                API Operations & Diagnostics
              </span>
            </div>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: '#64748B' }}>
              Live Oracle Fusion API operations, diagnostics, and response inspection.
            </p>
          </div>
        </div>

        {/* Real Connection Health Badge & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Environment Target */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
            padding: '0.35rem 0.75rem',
            borderRadius: '8px',
            backgroundColor: '#F1F5F9',
            border: '1px solid #E2E8F0',
            fontSize: '0.75rem',
            color: '#334155'
          }}>
            <Database size={13} style={{ color: '#2563EB' }} />
            <span style={{ fontWeight: 600 }}>Instance:</span>
            <span style={{ fontFamily: 'monospace', color: '#0F172A', fontWeight: 700 }}>
              {connectionHealth.baseUrl ? connectionHealth.baseUrl.replace(/^https?:\/\//, '').split('.')[0] : 'Configured Instance'}
            </span>
          </div>

          {/* Real Connection Status Pill */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.35rem 0.85rem',
            borderRadius: '8px',
            backgroundColor: connectionHealth.connected ? '#ECFDF5' : (connectionHealth.tested ? '#FEF2F2' : '#F8FAFC'),
            border: `1px solid ${connectionHealth.connected ? '#A7F3D0' : (connectionHealth.tested ? '#FECACA' : '#E2E8F0')}`,
            fontSize: '0.75rem'
          }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: connectionHealth.testing ? '#F59E0B' : (connectionHealth.connected ? '#10B981' : '#EF4444'),
              boxShadow: connectionHealth.connected ? '0 0 8px rgba(16, 185, 129, 0.6)' : 'none'
            }} />
            <span style={{
              fontWeight: 700,
              color: connectionHealth.connected ? '#047857' : (connectionHealth.tested ? '#B91C1C' : '#475569')
            }}>
              {connectionHealth.testing ? 'Testing...' : (connectionHealth.connected ? 'Connected' : 'Unavailable')}
            </span>
            {connectionHealth.connected && (
              <span style={{ fontSize: '0.7rem', color: '#059669', fontWeight: 600 }}>
                ({connectionHealth.latencyMs}ms)
              </span>
            )}
          </div>

          {/* Live Test Connection Button */}
          <button
            onClick={probeConnectionHealth}
            disabled={connectionHealth.testing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.4rem 0.85rem',
              borderRadius: '8px',
              backgroundColor: '#FFFFFF',
              border: '1px solid #CBD5E1',
              color: '#334155',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: connectionHealth.testing ? 'wait' : 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2563EB'; e.currentTarget.style.color = '#2563EB'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#CBD5E1'; e.currentTarget.style.color = '#334155'; }}
            title="Probe live connection to Oracle Fusion SCIM API"
          >
            <RefreshCw size={13} className={connectionHealth.testing ? 'spin' : ''} />
            <span>Test Connection</span>
          </button>
        </div>
      </div>

      {/* ==========================================================
          MAIN 3-PANEL WORKSPACE CONTAINER
          ========================================================== */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '320px 1fr',
        flex: 1,
        overflow: 'hidden'
      }}>
        
        {/* ========================================================
            LEFT PANEL: API EXPLORER, COLLECTIONS & HISTORY
            ======================================================== */}
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRight: '1px solid #E2E8F0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {/* Navigation Sub-tabs */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid #E2E8F0',
            backgroundColor: '#F8FAFC',
            padding: '0.35rem 0.5rem 0 0.5rem',
            gap: '0.25rem'
          }}>
            {[
              { id: 'CATALOG', label: 'API Catalog', icon: Layers },
              { id: 'SAVED', label: 'Collections', icon: FolderGit2, count: savedRequests.length },
              { id: 'HISTORY', label: 'History', icon: History, count: historyItems.length }
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = activeLeftTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveLeftTab(tab.id as any)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    padding: '0.45rem 0.5rem',
                    fontSize: '0.74rem',
                    fontWeight: isActive ? 700 : 600,
                    color: isActive ? '#2563EB' : '#64748B',
                    backgroundColor: isActive ? '#FFFFFF' : 'transparent',
                    border: '1px solid',
                    borderColor: isActive ? '#E2E8F0 #E2E8F0 transparent #E2E8F0' : 'transparent',
                    borderTopLeftRadius: '6px',
                    borderTopRightRadius: '6px',
                    cursor: 'pointer',
                    position: 'relative',
                    bottom: isActive ? '-1px' : '0'
                  }}
                >
                  <Icon size={13} />
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span style={{
                      fontSize: '0.65rem',
                      padding: '1px 5px',
                      borderRadius: '10px',
                      backgroundColor: isActive ? '#DBEAFE' : '#E2E8F0',
                      color: isActive ? '#1E40AF' : '#475569'
                    }}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* LEFT TAB CONTENT 1: API CATALOG */}
          {activeLeftTab === 'CATALOG' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              {/* Search Bar */}
              <div style={{ padding: '0.65rem 0.75rem', borderBottom: '1px solid #F1F5F9' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.35rem 0.65rem',
                  borderRadius: '6px',
                  backgroundColor: '#F8FAFC',
                  border: '1px solid #E2E8F0'
                }}>
                  <Search size={13} style={{ color: '#94A3B8' }} />
                  <input
                    type="text"
                    placeholder="Search supported APIs..."
                    value={searchCatalogQuery}
                    onChange={(e) => setSearchCatalogQuery(e.target.value)}
                    style={{
                      border: 'none',
                      backgroundColor: 'transparent',
                      outline: 'none',
                      fontSize: '0.76rem',
                      color: '#0F172A',
                      width: '100%'
                    }}
                  />
                  {searchCatalogQuery && (
                    <X size={13} style={{ color: '#94A3B8', cursor: 'pointer' }} onClick={() => setSearchCatalogQuery('')} />
                  )}
                </div>
              </div>

              {/* Categorized Endpoints Tree */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
                {Object.keys(groupedCatalog).length === 0 ? (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.78rem' }}>
                    No matching APIs found
                  </div>
                ) : (
                  Object.entries(groupedCatalog).map(([category, items]) => {
                    const isExpanded = expandedCategories[category] !== false;
                    return (
                      <div key={category} style={{ marginBottom: '0.5rem' }}>
                        {/* Category Header */}
                        <div
                          onClick={() => setExpandedCategories(prev => ({ ...prev, [category]: !isExpanded }))}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.35rem 0.5rem',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            color: '#334155',
                            fontWeight: 700,
                            fontSize: '0.76rem',
                            backgroundColor: isExpanded ? '#F8FAFC' : 'transparent'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            <span>{category}</span>
                          </div>
                          <span style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 600 }}>
                            {items.length}
                          </span>
                        </div>

                        {/* Category Items */}
                        {isExpanded && (
                          <div style={{ marginLeft: '0.65rem', paddingLeft: '0.5rem', borderLeft: '2px solid #E2E8F0', marginTop: '0.2rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            {items.map(item => {
                              const badgeStyle = getMethodBadgeColor(item.method);
                              const isSelected = urlPath === item.path;
                              return (
                                <div
                                  key={item.id}
                                  onClick={() => loadCatalogItem(item)}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '0.4rem 0.55rem',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    backgroundColor: isSelected ? '#EFF6FF' : '#FFFFFF',
                                    border: `1px solid ${isSelected ? '#BFDBFE' : 'transparent'}`,
                                    transition: 'all 0.15s ease'
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!isSelected) e.currentTarget.style.backgroundColor = '#F8FAFC';
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!isSelected) e.currentTarget.style.backgroundColor = '#FFFFFF';
                                  }}
                                  title={item.description}
                                >
                                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '0.5rem' }}>
                                    <div style={{ fontSize: '0.76rem', fontWeight: 600, color: isSelected ? '#1D4ED8' : '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {item.name}
                                    </div>
                                    <div style={{ fontSize: '0.68rem', color: '#94A3B8', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {item.path}
                                    </div>
                                  </div>
                                  <span style={{
                                    fontSize: '0.64rem',
                                    fontWeight: 800,
                                    padding: '2px 5px',
                                    borderRadius: '4px',
                                    backgroundColor: badgeStyle.bg,
                                    color: badgeStyle.text,
                                    border: `1px solid ${badgeStyle.border}`,
                                    flexShrink: 0
                                  }}>
                                    {item.method}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* LEFT TAB CONTENT 2: SAVED COLLECTIONS */}
          {activeLeftTab === 'SAVED' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ padding: '0.65rem 0.75rem', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#334155' }}>
                  Saved Templates ({savedRequests.length})
                </span>
                <button
                  onClick={() => setShowSaveModal(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    fontSize: '0.72rem',
                    color: '#2563EB',
                    backgroundColor: '#EFF6FF',
                    border: '1px solid #BFDBFE',
                    borderRadius: '5px',
                    padding: '2px 7px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <Plus size={12} />
                  <span>Save Current</span>
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {savedRequests.length === 0 ? (
                  <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.78rem' }}>
                    No saved requests yet. Click "Save Current" to create templates.
                  </div>
                ) : (
                  savedRequests.map(item => {
                    const badge = getMethodBadgeColor(item.method);
                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          setMethod(item.method);
                          setUrlPath(item.url);
                          if (item.params) {
                            setQueryParams(Object.entries(item.params).map(([k, v], i) => ({ id: String(i + 1), key: k, value: String(v), enabled: true })));
                          }
                          if (item.headers) {
                            setHeaders(Object.entries(item.headers).map(([k, v], i) => ({ id: String(i + 1), key: k, value: String(v), enabled: true })));
                          }
                          if (item.body) {
                            setBodyText(typeof item.body === 'string' ? item.body : JSON.stringify(item.body, null, 2));
                          }
                        }}
                        style={{
                          padding: '0.5rem 0.65rem',
                          borderRadius: '6px',
                          border: '1px solid #E2E8F0',
                          backgroundColor: '#FFFFFF',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.25rem',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#93C5FD'; e.currentTarget.style.backgroundColor = '#F8FAFC'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.backgroundColor = '#FFFFFF'; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0F172A' }}>
                            {item.name}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{
                              fontSize: '0.62rem',
                              fontWeight: 800,
                              padding: '1px 4px',
                              borderRadius: '3px',
                              backgroundColor: badge.bg,
                              color: badge.text
                            }}>
                              {item.method}
                            </span>
                            <span
                              title="Delete saved request"
                              onClick={(e) => handleDeleteSavedRequest(item.id, e)}
                              style={{ display: 'inline-flex', cursor: 'pointer' }}
                            >
                              <Trash2 size={13} style={{ color: '#94A3B8' }} />
                            </span>
                          </div>
                        </div>
                        <span style={{ fontSize: '0.68rem', color: '#64748B', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.url}
                        </span>
                        {item.description && (
                          <span style={{ fontSize: '0.68rem', color: '#94A3B8' }}>{item.description}</span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* LEFT TAB CONTENT 3: EXECUTION HISTORY */}
          {activeLeftTab === 'HISTORY' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ padding: '0.65rem 0.75rem', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#334155' }}>
                  Recent Runs ({historyItems.length})
                </span>
                {historyItems.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    style={{
                      fontSize: '0.7rem',
                      color: '#DC2626',
                      backgroundColor: 'transparent',
                      border: 'none',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Clear All
                  </button>
                )}
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {historyItems.length === 0 ? (
                  <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.78rem' }}>
                    No requests executed in this session yet.
                  </div>
                ) : (
                  historyItems.map(item => {
                    const statusBadge = getStatusColor(item.status);
                    const methodBadge = getMethodBadgeColor(item.method);
                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          setMethod(item.method as any);
                          setUrlPath(item.url);
                        }}
                        style={{
                          padding: '0.45rem 0.65rem',
                          borderRadius: '6px',
                          border: '1px solid #E2E8F0',
                          backgroundColor: '#FFFFFF',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.5rem',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#93C5FD'; e.currentTarget.style.backgroundColor = '#F8FAFC'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.backgroundColor = '#FFFFFF'; }}
                      >
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '2px' }}>
                            <span style={{
                              fontSize: '0.62rem',
                              fontWeight: 800,
                              padding: '1px 4px',
                              borderRadius: '3px',
                              backgroundColor: methodBadge.bg,
                              color: methodBadge.text
                            }}>
                              {item.method}
                            </span>
                            <span style={{
                              fontSize: '0.64rem',
                              fontWeight: 700,
                              padding: '1px 4px',
                              borderRadius: '3px',
                              backgroundColor: statusBadge.bg,
                              color: statusBadge.text
                            }}>
                              {item.status || 'Err'}
                            </span>
                            <span style={{ fontSize: '0.66rem', color: '#94A3B8' }}>
                              {item.responseTimeMs}ms
                            </span>
                          </div>
                          <div style={{ fontSize: '0.7rem', color: '#475569', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.url}
                          </div>
                        </div>
                        <span style={{ fontSize: '0.64rem', color: '#94A3B8', flexShrink: 0 }}>
                          {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* ========================================================
            RIGHT WORKSPACE: REQUEST BUILDER (TOP) + INSPECTOR (BOTTOM)
            ======================================================== */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          backgroundColor: '#FFFFFF'
        }}>
          
          {/* 1. REQUEST BUILDER TOOLBAR & URL BAR */}
          <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid #E2E8F0', backgroundColor: '#FFFFFF' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {/* Method Selector */}
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as any)}
                style={{
                  padding: '0.55rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  backgroundColor: getMethodBadgeColor(method).bg,
                  color: getMethodBadgeColor(method).text,
                  fontWeight: 800,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>

              {/* URL Input Bar */}
              <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                borderRadius: '8px',
                border: '1px solid #CBD5E1',
                backgroundColor: '#F8FAFC',
                padding: '0 0.75rem',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
              }}>
                <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontFamily: 'monospace', marginRight: '4px', userSelect: 'none' }}>
                  {"{{FUSION_BASE_URL}}"}
                </span>
                <input
                  type="text"
                  value={urlPath}
                  onChange={(e) => setUrlPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      handleSendRequest();
                    }
                  }}
                  placeholder="/fscmRestApi/resources/11.13.18.05/advancedControls"
                  style={{
                    flex: 1,
                    border: 'none',
                    backgroundColor: 'transparent',
                    padding: '0.55rem 0',
                    fontSize: '0.84rem',
                    fontFamily: 'monospace',
                    color: '#0F172A',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Send Button */}
              <button
                onClick={() => handleSendRequest()}
                disabled={executing}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.55rem 1.35rem',
                  borderRadius: '8px',
                  backgroundColor: '#1D4ED8',
                  color: '#FFFFFF',
                  border: 'none',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  cursor: executing ? 'wait' : 'pointer',
                  boxShadow: '0 2px 6px rgba(29, 78, 216, 0.3)',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => { if (!executing) e.currentTarget.style.backgroundColor = '#1E40AF'; }}
                onMouseLeave={(e) => { if (!executing) e.currentTarget.style.backgroundColor = '#1D4ED8'; }}
              >
                {executing ? (
                  <>
                    <RefreshCw size={15} className="spin" />
                    <span>SENDING...</span>
                  </>
                ) : (
                  <>
                    <Send size={15} />
                    <span>SEND REQUEST</span>
                  </>
                )}
              </button>

              {/* Save Template Button */}
              <button
                onClick={() => {
                  setSaveName(urlPath.split('/').pop() || 'My API Request');
                  setShowSaveModal(true);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.55rem 0.85rem',
                  borderRadius: '8px',
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  color: '#475569',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
                title="Save this request into Collections"
              >
                <Save size={15} />
                <span>Save</span>
              </button>
            </div>

            {/* Request Builder Sub-Tabs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid #E2E8F0' }}>
              {[
                { id: 'PARAMS', label: 'Params', count: queryParams.filter(p => p.enabled && p.key).length },
                { id: 'HEADERS', label: 'Headers', count: headers.filter(h => h.enabled && h.key).length },
                { id: 'AUTH', label: 'Authorization' },
                { id: 'BODY', label: 'Body', isRequired: ['POST', 'PUT', 'PATCH'].includes(method) }
              ].map(tab => {
                const isActive = activeBuilderTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveBuilderTab(tab.id as any)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.45rem 0.85rem',
                      fontSize: '0.78rem',
                      fontWeight: isActive ? 700 : 600,
                      color: isActive ? '#2563EB' : '#64748B',
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderBottom: isActive ? '2px solid #2563EB' : '2px solid transparent',
                      cursor: 'pointer',
                      position: 'relative',
                      bottom: '-1px'
                    }}
                  >
                    <span>{tab.label}</span>
                    {tab.count !== undefined && tab.count > 0 && (
                      <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '10px', backgroundColor: '#EFF6FF', color: '#1D4ED8' }}>
                        {tab.count}
                      </span>
                    )}
                    {tab.isRequired && (
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#2563EB' }} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* TAB CONTENT: PARAMS */}
            {activeBuilderTab === 'PARAMS' && (
              <div style={{ paddingTop: '0.65rem', maxHeight: '135px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ color: '#64748B', textAlign: 'left', borderBottom: '1px solid #F1F5F9' }}>
                      <th style={{ width: '30px', padding: '4px' }}></th>
                      <th style={{ padding: '4px 8px' }}>Key</th>
                      <th style={{ padding: '4px 8px' }}>Value</th>
                      <th style={{ width: '30px', padding: '4px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {queryParams.map((row, idx) => (
                      <tr key={row.id}>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(e) => {
                              const updated = [...queryParams];
                              updated[idx].enabled = e.target.checked;
                              setQueryParams(updated);
                            }}
                          />
                        </td>
                        <td style={{ padding: '2px 4px' }}>
                          <input
                            type="text"
                            value={row.key}
                            placeholder="Parameter Name"
                            onChange={(e) => {
                              const updated = [...queryParams];
                              updated[idx].key = e.target.value;
                              setQueryParams(updated);
                            }}
                            style={{ width: '100%', padding: '4px 6px', fontSize: '0.76rem', border: '1px solid #E2E8F0', borderRadius: '4px' }}
                          />
                        </td>
                        <td style={{ padding: '2px 4px' }}>
                          <input
                            type="text"
                            value={row.value}
                            placeholder="Value"
                            onChange={(e) => {
                              const updated = [...queryParams];
                              updated[idx].value = e.target.value;
                              setQueryParams(updated);
                            }}
                            style={{ width: '100%', padding: '4px 6px', fontSize: '0.76rem', border: '1px solid #E2E8F0', borderRadius: '4px' }}
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <X
                            size={14}
                            style={{ color: '#94A3B8', cursor: 'pointer' }}
                            onClick={() => setQueryParams(queryParams.filter((_, i) => i !== idx))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  onClick={() => setQueryParams([...queryParams, { id: String(Date.now()), key: '', value: '', enabled: true }])}
                  style={{
                    marginTop: '0.35rem',
                    fontSize: '0.72rem',
                    color: '#2563EB',
                    backgroundColor: 'transparent',
                    border: 'none',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.2rem'
                  }}
                >
                  <Plus size={13} />
                  <span>Add Parameter</span>
                </button>
              </div>
            )}

            {/* TAB CONTENT: HEADERS */}
            {activeBuilderTab === 'HEADERS' && (
              <div style={{ paddingTop: '0.65rem', maxHeight: '135px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ color: '#64748B', textAlign: 'left', borderBottom: '1px solid #F1F5F9' }}>
                      <th style={{ width: '30px', padding: '4px' }}></th>
                      <th style={{ padding: '4px 8px' }}>Header Key</th>
                      <th style={{ padding: '4px 8px' }}>Header Value</th>
                      <th style={{ width: '30px', padding: '4px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {headers.map((row, idx) => (
                      <tr key={row.id}>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(e) => {
                              const updated = [...headers];
                              updated[idx].enabled = e.target.checked;
                              setHeaders(updated);
                            }}
                          />
                        </td>
                        <td style={{ padding: '2px 4px' }}>
                          <input
                            type="text"
                            value={row.key}
                            placeholder="Header Key (e.g. Accept)"
                            onChange={(e) => {
                              const updated = [...headers];
                              updated[idx].key = e.target.value;
                              setHeaders(updated);
                            }}
                            style={{ width: '100%', padding: '4px 6px', fontSize: '0.76rem', border: '1px solid #E2E8F0', borderRadius: '4px' }}
                          />
                        </td>
                        <td style={{ padding: '2px 4px' }}>
                          <input
                            type="text"
                            value={row.value}
                            placeholder="Value"
                            onChange={(e) => {
                              const updated = [...headers];
                              updated[idx].value = e.target.value;
                              setHeaders(updated);
                            }}
                            style={{ width: '100%', padding: '4px 6px', fontSize: '0.76rem', border: '1px solid #E2E8F0', borderRadius: '4px' }}
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <X
                            size={14}
                            style={{ color: '#94A3B8', cursor: 'pointer' }}
                            onClick={() => setHeaders(headers.filter((_, i) => i !== idx))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  onClick={() => setHeaders([...headers, { id: String(Date.now()), key: '', value: '', enabled: true }])}
                  style={{
                    marginTop: '0.35rem',
                    fontSize: '0.72rem',
                    color: '#2563EB',
                    backgroundColor: 'transparent',
                    border: 'none',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.2rem'
                  }}
                >
                  <Plus size={13} />
                  <span>Add Header</span>
                </button>
              </div>
            )}

            {/* TAB CONTENT: AUTHORIZATION */}
            {activeBuilderTab === 'AUTH' && (
              <div style={{ paddingTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>Authorization Mode:</span>
                  <select
                    value={authMode}
                    onChange={(e) => setAuthMode(e.target.value as any)}
                    style={{
                      padding: '0.35rem 0.75rem',
                      borderRadius: '6px',
                      border: '1px solid #CBD5E1',
                      fontSize: '0.78rem',
                      fontWeight: 600
                    }}
                  >
                    <option value="FUSION_DEFAULT">Oracle Fusion Connection (Configured & Secure)</option>
                    <option value="NONE">No Auth / Custom Headers</option>
                  </select>
                </div>

                {authMode === 'FUSION_DEFAULT' ? (
                  <div style={{
                    padding: '0.6rem 0.85rem',
                    borderRadius: '6px',
                    backgroundColor: '#EFF6FF',
                    border: '1px solid #BFDBFE',
                    fontSize: '0.76rem',
                    color: '#1E40AF',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <Lock size={15} style={{ flexShrink: 0 }} />
                    <span>
                      Active credentials from <strong>Oracle Integration</strong> are automatically and securely attached by the backend. Raw passwords are never transmitted or exposed in the browser.
                    </span>
                  </div>
                ) : (
                  <div style={{ padding: '0.6rem 0.85rem', borderRadius: '6px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', fontSize: '0.76rem', color: '#B45309' }}>
                    Warning: Standard Oracle Fusion credentials will not be injected. Use the Headers tab to supply explicit token headers if testing external gateways.
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: BODY */}
            {activeBuilderTab === 'BODY' && (
              <div style={{ paddingTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.74rem', color: '#64748B' }}>JSON Payload:</span>
                  <button
                    onClick={() => {
                      try {
                        if (!bodyText.trim()) return;
                        const parsed = JSON.parse(bodyText);
                        setBodyText(JSON.stringify(parsed, null, 2));
                      } catch {
                        alert('Invalid JSON syntax. Unable to format.');
                      }
                    }}
                    style={{
                      fontSize: '0.7rem',
                      color: '#2563EB',
                      backgroundColor: 'transparent',
                      border: 'none',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Format JSON
                  </button>
                </div>
                <textarea
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  placeholder={'{\n  "roleCodes": ["ORA_FND_IT_SECURITY_MANAGER_JOB"]\n}'}
                  rows={4}
                  style={{
                    width: '100%',
                    fontFamily: 'monospace',
                    fontSize: '0.78rem',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    border: '1px solid #CBD5E1',
                    backgroundColor: '#F8FAFC',
                    outline: 'none',
                    resize: 'vertical'
                  }}
                />
              </div>
            )}
          </div>

          {/* 2. RESPONSE INSPECTOR & DIAGNOSTICS */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: '#F8FAFC' }}>
            
            {/* If no response yet: Clean Product Empty State */}
            {!responseResult ? (
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2.5rem',
                textAlign: 'center',
                gap: '1rem'
              }}>
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '16px',
                  backgroundColor: '#EFF6FF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#2563EB',
                  border: '1px solid #DBEAFE',
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.1)'
                }}>
                  <Play size={28} style={{ marginLeft: '4px' }} />
                </div>
                <div style={{ maxWidth: '480px' }}>
                  <h3 style={{ margin: '0 0 0.4rem 0', fontSize: '1.12rem', fontWeight: 800, color: '#0F172A' }}>
                    Ready to Execute & Inspect
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748B', lineHeight: 1.5 }}>
                    Select an API from the left catalog or configure a REST endpoint above. All responses will be captured with real latencies, payload sizes, and diagnostic insights.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => {
                      setUrlPath('/fscmRestApi/resources/11.13.18.05/advancedControls');
                      setMethod('GET');
                      setQueryParams([
                        { id: '1', key: 'limit', value: '25', enabled: true },
                        { id: '2', key: 'offset', value: '0', enabled: true }
                      ]);
                      handleSendRequest('/fscmRestApi/resources/11.13.18.05/advancedControls', 'GET');
                    }}
                    style={{
                      padding: '0.55rem 1rem',
                      borderRadius: '8px',
                      backgroundColor: '#1D4ED8',
                      color: '#FFFFFF',
                      border: 'none',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(29, 78, 216, 0.25)'
                    }}
                  >
                    Quick Test: GET All Advanced Controls
                  </button>
                  <button
                    onClick={() => {
                      setUrlPath('/hcmRestApi/scim/Users');
                      setMethod('GET');
                      setQueryParams([{ id: '1', key: 'count', value: '10', enabled: true }]);
                      handleSendRequest('/hcmRestApi/scim/Users', 'GET');
                    }}
                    style={{
                      padding: '0.55rem 1rem',
                      borderRadius: '8px',
                      backgroundColor: '#FFFFFF',
                      color: '#334155',
                      border: '1px solid #CBD5E1',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Quick Test: GET SCIM Users
                  </button>
                </div>
              </div>
            ) : (
              /* Response Present: Show Inspector */
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                
                {/* Status Bar */}
                <div style={{
                  padding: '0.65rem 1.25rem',
                  backgroundColor: '#FFFFFF',
                  borderBottom: '1px solid #E2E8F0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.75rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    {/* Status Badge */}
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '3px 9px',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      backgroundColor: getStatusColor(responseResult.status).bg,
                      color: getStatusColor(responseResult.status).text,
                      border: `1px solid ${getStatusColor(responseResult.status).border}`
                    }}>
                      {responseResult.status >= 200 && responseResult.status < 300 ? (
                        <CheckCircle2 size={13} />
                      ) : (
                        <AlertCircle size={13} />
                      )}
                      <span>{responseResult.status} {responseResult.statusText}</span>
                    </span>

                    {/* Latency */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.76rem', color: '#64748B' }}>
                      <Clock size={13} />
                      <span style={{ fontWeight: 700, color: '#334155' }}>{responseResult.responseTimeMs}ms</span>
                    </div>

                    {/* Size */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.76rem', color: '#64748B' }}>
                      <Database size={13} />
                      <span style={{ fontWeight: 700, color: '#334155' }}>{responseResult.responseSizeFormatted}</span>
                    </div>

                    {/* Timestamp */}
                    <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
                      {new Date(responseResult.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  {/* Actions & Response Subtabs */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {/* Tabs */}
                    <div style={{ display: 'flex', backgroundColor: '#F1F5F9', padding: '2px', borderRadius: '6px' }}>
                      {[
                        { id: 'JSON', label: 'JSON', icon: Code2 },
                        { id: 'TABLE', label: 'Table', icon: TableIcon, disabled: !tableData.rows.length },
                        { id: 'RAW', label: 'Raw', icon: FileText },
                        { id: 'HEADERS', label: 'Headers', icon: Sliders }
                      ].map(t => {
                        const Icon = t.icon;
                        const isAct = activeResponseTab === t.id;
                        return (
                          <button
                            key={t.id}
                            disabled={t.disabled}
                            onClick={() => setActiveResponseTab(t.id as any)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                              padding: '0.3rem 0.65rem',
                              borderRadius: '5px',
                              border: 'none',
                              fontSize: '0.74rem',
                              fontWeight: isAct ? 700 : 500,
                              backgroundColor: isAct ? '#FFFFFF' : 'transparent',
                              color: isAct ? '#1D4ED8' : (t.disabled ? '#CBD5E1' : '#64748B'),
                              cursor: t.disabled ? 'not-allowed' : 'pointer',
                              boxShadow: isAct ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
                            }}
                          >
                            <Icon size={12} />
                            <span>{t.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Copy Button */}
                    <button
                      onClick={handleCopyResponse}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        padding: '0.35rem 0.75rem',
                        borderRadius: '6px',
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #CBD5E1',
                        color: copiedResponse ? '#15803D' : '#475569',
                        fontSize: '0.74rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                      title="Copy response payload to clipboard"
                    >
                      {copiedResponse ? <Check size={13} /> : <Copy size={13} />}
                      <span>{copiedResponse ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                {/* Diagnostic Banner if Warning or Error */}
                {responseResult.diagnostic && responseResult.status !== 200 && (
                  <div style={{
                    padding: '0.65rem 1.25rem',
                    backgroundColor: responseResult.diagnostic.severity === 'error' ? '#FEF2F2' : '#FFFBEB',
                    borderBottom: `1px solid ${responseResult.diagnostic.severity === 'error' ? '#FECACA' : '#FDE68A'}`,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.65rem',
                    fontSize: '0.78rem'
                  }}>
                    <AlertCircle size={16} style={{ color: responseResult.diagnostic.severity === 'error' ? '#DC2626' : '#D97706', flexShrink: 0, marginTop: '2px' }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 800, color: responseResult.diagnostic.severity === 'error' ? '#991B1B' : '#92400E' }}>
                        {responseResult.diagnostic.title}:
                      </span>{' '}
                      <span style={{ color: '#475569' }}>{responseResult.diagnostic.message}</span>
                      {responseResult.diagnostic.recommendation && (
                        <div style={{ marginTop: '3px', fontWeight: 600, color: responseResult.diagnostic.severity === 'error' ? '#B91C1C' : '#B45309' }}>
                          💡 Recommendation: {responseResult.diagnostic.recommendation}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ==========================================================
                    ORACLE-RISK-AWARE CONTEXTUAL ACTIONS FOR ADVANCED CONTROLS
                    ========================================================== */}
                {/* Contextual Action 1: Controls List Detected */}
                {isControlsList && (
                  <div style={{
                    padding: '0.65rem 1.25rem',
                    backgroundColor: '#EFF6FF',
                    borderBottom: '1px solid #BFDBFE',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '0.5rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <ShieldCheck size={16} style={{ color: '#2563EB' }} />
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1E40AF' }}>
                        {responseResult.data.items.length} Controls Discovered
                      </span>
                      <span style={{ fontSize: '0.74rem', color: '#64748B' }}>
                        Click any Control ID below to test individual control details
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {responseResult.data.items.slice(0, 4).map((ctrl: any) => {
                        const id = ctrl.ControlId || ctrl.id;
                        return (
                          <button
                            key={id}
                            onClick={() => {
                              const newPath = `/fscmRestApi/resources/11.13.18.05/advancedControls/${id}`;
                              setUrlPath(newPath);
                              setQueryParams([]);
                              handleSendRequest(newPath, 'GET');
                            }}
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              backgroundColor: '#FFFFFF',
                              border: '1px solid #93C5FD',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              color: '#1D4ED8',
                              cursor: 'pointer'
                            }}
                            title={`Inspect Control "${ctrl.Name || id}"`}
                          >
                            #{id}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Contextual Action 2: Single Control Details Detected */}
                {isSingleControl && (
                  <div style={{
                    padding: '0.75rem 1.25rem',
                    backgroundColor: '#F0FDF4',
                    borderBottom: '1px solid #BBF7D0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '0.75rem'
                  }}>
                    <div>
                      <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#166534', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <ShieldAlert size={16} style={{ color: '#16A34A' }} />
                        <span>Control: {responseResult.data.Name || responseResult.data.ControlName || 'Security Control'}</span>
                        <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: '4px', backgroundColor: '#DCFCE7', color: '#15803D' }}>
                          ID: {responseResult.data.ControlId || responseResult.data.id}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#4B5563', marginTop: '2px' }}>
                        Status: <strong>{responseResult.data.Status || 'Active'}</strong> | State: <strong>{responseResult.data.State || 'Published'}</strong> | Last Run: {responseResult.data.LastRunDate || 'N/A'}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        const ctrlId = responseResult.data.ControlId || responseResult.data.id;
                        const incidentsPath = `/fscmRestApi/resources/11.13.18.05/advancedControls/${ctrlId}/child/incidents`;
                        setUrlPath(incidentsPath);
                        setQueryParams([{ id: '1', key: 'limit', value: '25', enabled: true }]);
                        handleSendRequest(incidentsPath, 'GET');
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.45rem 0.95rem',
                        borderRadius: '6px',
                        backgroundColor: '#16A34A',
                        color: '#FFFFFF',
                        border: 'none',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)'
                      }}
                    >
                      <Layers size={14} />
                      <span>View Control Incidents</span>
                      <ArrowRight size={13} />
                    </button>
                  </div>
                )}

                {/* TAB VIEW 1: JSON VIEWER */}
                {activeResponseTab === 'JSON' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0.75rem 1.25rem' }}>
                    {/* JSON Search filter */}
                    <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        padding: '0.25rem 0.65rem',
                        borderRadius: '6px',
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        width: '280px'
                      }}>
                        <Search size={12} style={{ color: '#94A3B8' }} />
                        <input
                          type="text"
                          placeholder="Search in response JSON..."
                          value={jsonSearchQuery}
                          onChange={(e) => setJsonSearchQuery(e.target.value)}
                          style={{ border: 'none', outline: 'none', fontSize: '0.74rem', width: '100%' }}
                        />
                        {jsonSearchQuery && <X size={12} style={{ color: '#94A3B8', cursor: 'pointer' }} onClick={() => setJsonSearchQuery('')} />}
                      </div>
                    </div>

                    <div style={{
                      flex: 1,
                      overflowY: 'auto',
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      padding: '1rem',
                      fontFamily: 'monospace',
                      fontSize: '0.8rem',
                      lineHeight: 1.5,
                      color: '#0F172A'
                    }}>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {JSON.stringify(responseResult.data, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {/* TAB VIEW 2: TABLE DATA */}
                {activeResponseTab === 'TABLE' && (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>
                        Parsed Response Records ({tableData.rows.length})
                      </span>
                      {tableData.rows.length > 0 && (
                        <TableExportControl
                          filename="command_center_response_data"
                          data={tableData.rows}
                          totalCount={tableData.rows.length}
                          columns={tableData.columns.map(c => ({ key: c, label: c }))}
                        />
                      )}
                    </div>
                    <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', color: '#475569', textAlign: 'left' }}>
                            <th style={{ padding: '8px 12px', width: '50px' }}>#</th>
                            {tableData.columns.map(col => (
                              <th key={col} style={{ padding: '8px 12px', fontWeight: 700 }}>{col}</th>
                            ))}
                            {isControlsList && <th style={{ padding: '8px 12px', width: '80px' }}>Action</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {tableData.rows.map((row: any, idx: number) => (
                            <tr
                              key={idx}
                              style={{ borderBottom: '1px solid #F1F5F9', transition: 'background-color 0.15s ease' }}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F8FAFC'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#FFFFFF'; }}
                            >
                              <td style={{ padding: '8px 12px', color: '#94A3B8', fontWeight: 600 }}>{idx + 1}</td>
                              {tableData.columns.map(col => {
                                const val = row[col];
                                const isIdCol = col.toLowerCase().includes('id');
                                return (
                                  <td key={col} style={{ padding: '8px 12px', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {isControlsList && isIdCol ? (
                                      <span
                                        onClick={() => {
                                          const newPath = `/fscmRestApi/resources/11.13.18.05/advancedControls/${val}`;
                                          setUrlPath(newPath);
                                          setQueryParams([]);
                                          handleSendRequest(newPath, 'GET');
                                        }}
                                        style={{ color: '#2563EB', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
                                        title="Click to query this control directly"
                                      >
                                        {String(val)}
                                      </span>
                                    ) : (
                                      <span>{typeof val === 'boolean' ? (val ? 'true' : 'false') : String(val !== undefined && val !== null ? val : '—')}</span>
                                    )}
                                  </td>
                                );
                              })}
                              {isControlsList && (
                                <td style={{ padding: '8px 12px' }}>
                                  <button
                                    onClick={() => {
                                      const ctrlId = row.ControlId || row.id;
                                      const newPath = `/fscmRestApi/resources/11.13.18.05/advancedControls/${ctrlId}`;
                                      setUrlPath(newPath);
                                      setQueryParams([]);
                                      handleSendRequest(newPath, 'GET');
                                    }}
                                    style={{
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      backgroundColor: '#EFF6FF',
                                      border: '1px solid #BFDBFE',
                                      fontSize: '0.68rem',
                                      fontWeight: 700,
                                      color: '#1D4ED8',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Inspect
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* TAB VIEW 3: RAW VIEW */}
                {activeResponseTab === 'RAW' && (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1.25rem' }}>
                    <div style={{
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      padding: '1rem',
                      fontFamily: 'monospace',
                      fontSize: '0.78rem',
                      color: '#0F172A',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all'
                    }}>
                      {typeof responseResult.data === 'string' 
                        ? responseResult.data 
                        : JSON.stringify(responseResult.data)}
                    </div>
                  </div>
                )}

                {/* TAB VIEW 4: HEADERS VIEW */}
                {activeResponseTab === 'HEADERS' && (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>
                        Response Headers ({Object.keys(responseResult.headers || {}).length})
                      </span>
                      {Object.keys(responseResult.headers || {}).length > 0 && (
                        <TableExportControl
                          filename="command_center_response_headers"
                          data={Object.entries(responseResult.headers || {}).map(([k, v]) => ({ headerName: k, headerValue: String(v) }))}
                          totalCount={Object.keys(responseResult.headers || {}).length}
                          columns={[
                            { key: 'headerName', label: 'Header Name' },
                            { key: 'headerValue', label: 'Header Value' }
                          ]}
                        />
                      )}
                    </div>
                    <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', color: '#475569', textAlign: 'left' }}>
                            <th style={{ padding: '8px 12px', width: '220px', fontWeight: 700 }}>Header Name</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700 }}>Header Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(responseResult.headers || {}).map(([k, v]) => (
                            <tr key={k} style={{ borderBottom: '1px solid #F1F5F9' }}>
                              <td style={{ padding: '8px 12px', fontWeight: 600, color: '#334155' }}>{k}</td>
                              <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#0F172A' }}>{String(v)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

              </div>
            )}

          </div>

        </div>

      </div>

      {/* ==========================================================
          SAVE REQUEST MODAL DIALOG
          ========================================================== */}
      {showSaveModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            width: '440px',
            backgroundColor: '#FFFFFF',
            borderRadius: '12px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0F172A' }}>
                Save Request to Collections
              </h3>
              <X size={18} style={{ color: '#94A3B8', cursor: 'pointer' }} onClick={() => setShowSaveModal(false)} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                  Template Name *
                </label>
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="e.g. Segregation of Duties Controls"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '0.8rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                  Category / Folder
                </label>
                <select
                  value={saveCategory}
                  onChange={(e) => setSaveCategory(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '0.8rem' }}
                >
                  <option value="Risk Management">Risk Management</option>
                  <option value="Users & Identities">Users & Identities</option>
                  <option value="Roles Catalog">Roles Catalog</option>
                  <option value="Audit Trail">Audit Trail</option>
                  <option value="Custom Collections">Custom Collections</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                  Description (Optional)
                </label>
                <input
                  type="text"
                  value={saveDescription}
                  onChange={(e) => setSaveDescription(e.target.value)}
                  placeholder="Purpose of this API diagnostic template"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '0.8rem' }}
                />
              </div>

              <div style={{ fontSize: '0.72rem', color: '#64748B', backgroundColor: '#F8FAFC', padding: '0.5rem', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                Endpoint: <code>{method} {urlPath}</code>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                onClick={() => setShowSaveModal(false)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: '#475569',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCurrentRequest}
                style={{
                  padding: '0.45rem 1rem',
                  borderRadius: '6px',
                  backgroundColor: '#1D4ED8',
                  border: 'none',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  cursor: 'pointer'
                }}
              >
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
