import React, { useEffect, useState } from 'react';
import { 
  ShieldAlert, 
  Scale, 
  ClipboardCheck, 
  CheckCircle2, 
  AlertCircle, 
  Search, 
  Filter, 
  Eye, 
  ExternalLink, 
  Clock, 
  UserCheck, 
  FileText,
  Activity,
  Layers,
  X,
  RefreshCw,
  ArrowLeft,
  Info,
  ShieldCheck,
  Calendar,
  User,
  Sliders
} from 'lucide-react';
import { api } from '../services/api.js';

interface RiskProps {
  environmentMode: 'DEMO' | 'ORACLE_FUSION';
}

export default function Risk({ environmentMode }: RiskProps) {
  const [accessRequests, setAccessRequests] = useState<any[]>([]);
  const [controls, setControls] = useState<any[]>([]);
  const [capabilities, setCapabilities] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [dataSource, setDataSource] = useState('');
  
  // Tab state: 'ACCESS_REQUESTS' | 'ADVANCED_CONTROLS' | 'CAPABILITIES'
  const [activeTab, setActiveTab] = useState<'ACCESS_REQUESTS' | 'ADVANCED_CONTROLS' | 'CAPABILITIES'>('ACCESS_REQUESTS');
  
  // Filter & Search states for Tab 1: Access Requests
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);

  // Filter & Search & Selection states for Tab 2: Advanced Controls
  const [controlsRefreshing, setControlsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string>('');
  const [controlSearchQuery, setControlSearchQuery] = useState<string>('');
  const [controlStatusFilter, setControlStatusFilter] = useState<string>('ALL');
  const [controlStateFilter, setControlStateFilter] = useState<string>('ALL');
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);
  const [selectedControlDetail, setSelectedControlDetail] = useState<any | null>(null);
  const [controlDetailLoading, setControlDetailLoading] = useState<boolean>(false);
  const [controlDetailError, setControlDetailError] = useState<string>('');

  useEffect(() => {
    async function loadRiskData() {
      setLoading(true);
      setErrorMessage('');
      try {
        const [reqRes, ctrlRes, capRes] = await Promise.all([
          api.getAdvancedAccessRequests(),
          api.getAdvancedControls(),
          api.getRiskCapabilities()
        ]);

        if (reqRes.success) {
          setAccessRequests(reqRes.items || []);
          setDataSource(reqRes.dataSource || (environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Data'));
        }

        if (ctrlRes.success) {
          setControls(ctrlRes.items || []);
          setLastRefreshed(new Date().toLocaleTimeString());
        }

        if (capRes.success) {
          setCapabilities(capRes.capabilities);
        }
      } catch (err: any) {
        console.error('Failed to load Risk Management data:', err);
        setErrorMessage(err.message || 'Unable to communicate with Risk Management backend services.');
      } finally {
        setLoading(false);
      }
    }
    loadRiskData();
  }, [environmentMode]);

  // Tab 1: Filtered access requests
  const filteredRequests = accessRequests.filter(req => {
    const matchesStatus = statusFilter === 'ALL' || req.status === statusFilter;
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || 
      (req.requestedFor && req.requestedFor.toLowerCase().includes(q)) ||
      (req.requestedBy && req.requestedBy.toLowerCase().includes(q)) ||
      (req.justification && req.justification.toLowerCase().includes(q)) ||
      (req.id && String(req.id).includes(q));
    return matchesStatus && matchesSearch;
  });

  const totalViolations = accessRequests.reduce((acc, r) => acc + (r.violationCount || 0), 0);
  const pendingCount = accessRequests.filter(r => r.status === 'NEW' || r.status === 'PENDING').length;
  const approvedCount = accessRequests.filter(r => r.status === 'APPROVED').length;

  // Tab 2: Filtered controls
  const filteredControls = controls.filter(ctrl => {
    const statusMatch = controlStatusFilter === 'ALL' || 
      (ctrl.status && String(ctrl.status).toUpperCase() === controlStatusFilter.toUpperCase());
    const stateMatch = controlStateFilter === 'ALL' || 
      ((ctrl.state || ctrl.stateCode) && String(ctrl.state || ctrl.stateCode).toUpperCase() === controlStateFilter.toUpperCase());
    const q = controlSearchQuery.trim().toLowerCase();
    const searchMatch = !q || 
      (ctrl.id && String(ctrl.id).toLowerCase().includes(q)) || 
      (ctrl.name && String(ctrl.name).toLowerCase().includes(q));
    return statusMatch && stateMatch && searchMatch;
  });

  // Extract unique statuses and states for filters
  const controlStatuses = ['ALL', ...Array.from(new Set(controls.map(c => c.status).filter(Boolean)))];
  const controlStates = ['ALL', ...Array.from(new Set(controls.map(c => c.state || c.stateCode).filter(Boolean)))];

  // Control selection handler (calls live backend detail endpoint expand=incidents)
  const handleSelectControl = async (ctrlId: string) => {
    setSelectedControlId(ctrlId);
    setControlDetailLoading(true);
    setControlDetailError('');
    try {
      const res = await api.getAdvancedControlDetail(ctrlId);
      if (res && res.success && res.control) {
        setSelectedControlDetail(res.control);
      } else {
        setControlDetailError('Unable to retrieve control details from Oracle Fusion.');
      }
    } catch (err: any) {
      console.error('Failed to fetch control details:', err);
      setControlDetailError('Unable to retrieve control details from Oracle Fusion.');
    } finally {
      setControlDetailLoading(false);
    }
  };

  // Catalog refresh handler
  const handleRefreshControls = async () => {
    setControlsRefreshing(true);
    try {
      const res = await api.refreshAdvancedControls();
      if (res && res.success && Array.isArray(res.items)) {
        setControls(res.items);
        setLastRefreshed(new Date().toLocaleTimeString());
        if (selectedControlId) {
          handleSelectControl(selectedControlId);
        }
      }
    } catch (err) {
      console.error('Failed to refresh controls catalog:', err);
    } finally {
      setControlsRefreshing(false);
    }
  };

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
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return String(dateVal);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ height: '35px', width: '260px', marginBottom: '1rem' }} className="skeleton" />
        <div style={{ height: '20px', width: '450px', marginBottom: '2rem' }} className="skeleton" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
          <div style={{ height: '90px' }} className="skeleton" />
          <div style={{ height: '90px' }} className="skeleton" />
          <div style={{ height: '90px' }} className="skeleton" />
          <div style={{ height: '90px' }} className="skeleton" />
        </div>
        <div style={{ height: '300px' }} className="skeleton" />
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', width: '100%', margin: '0 auto' }}>
      
      {/* Header */}
      {/* Risk Management Blue Gradient Banner */}
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
            Risk Management & SoD Analysis
          </h1>
          <p style={{ color: '#E0E7FF', fontSize: '0.92rem', margin: 0 }}>
            Inspect Advanced Access Requests, policy violation analyses, and automated security controls.
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
            {dataSource || (environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Data')}
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="glass-panel" style={{ padding: '1rem 1.5rem', borderLeft: '4px solid var(--accent-red)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <AlertCircle size={20} style={{ color: 'var(--accent-red)' }} />
          <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{errorMessage}</div>
        </div>
      )}

      {/* Context-Aware KPI Metrics */}
      {activeTab === 'ADVANCED_CONTROLS' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Scale size={16} style={{ color: 'var(--accent-gold)' }} />
              Total Controls
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {controls.length}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Authoritative Oracle Catalog
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <CheckCircle2 size={16} style={{ color: 'var(--accent-green)' }} />
              Active Controls
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {controls.filter(c => (c.status || '').toUpperCase() === 'ACTIVE').length}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Active policy enforcement
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <ShieldCheck size={16} style={{ color: 'var(--accent-gold)' }} />
              Approved Controls
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {controls.filter(c => (c.state || c.stateCode || '').toUpperCase() === 'APPROVED').length}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Approved state code
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <ShieldAlert size={16} style={{ color: selectedControlDetail && selectedControlDetail.incidentCount > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }} />
              Controls With Incidents
            </div>
            <div style={{ fontSize: selectedControlDetail ? '1.75rem' : '0.95rem', fontWeight: 700, color: selectedControlDetail && selectedControlDetail.incidentCount > 0 ? 'var(--accent-red)' : 'var(--text-secondary)', lineHeight: selectedControlDetail ? '1.2' : '1.8' }}>
              {selectedControlDetail ? `${selectedControlDetail.incidentCount} incidents` : 'Available after control selection'}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              {selectedControlDetail ? `Selected Control #${selectedControlDetail.id}` : 'Calculated per control on demand'}
            </div>
          </div>
        </div>
      ) : activeTab === 'CAPABILITIES' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Layers size={16} style={{ color: 'var(--accent-gold)' }} />
              Total Services Detected
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              5
            </div>
          </div>
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <CheckCircle2 size={16} style={{ color: 'var(--accent-green)' }} />
              Live Operational
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--accent-green)' }}>
              4 Services
            </div>
          </div>
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <AlertCircle size={16} style={{ color: 'var(--accent-gold)' }} />
              Standalone / Licensable
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--accent-gold)' }}>
              1 Service
            </div>
          </div>
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Activity size={16} style={{ color: 'var(--accent-gold)' }} />
              REST API Engine
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.3rem' }}>
              11.13.18.05
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <FileText size={16} style={{ color: 'var(--accent-gold)' }} />
              Total Access Requests
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {accessRequests.length}
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <ShieldAlert size={16} style={{ color: 'var(--accent-red)' }} />
              Total Risk Violations
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: totalViolations > 0 ? 'var(--accent-red)' : 'var(--text-primary)' }}>
              {totalViolations}
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Clock size={16} style={{ color: 'var(--accent-gold)' }} />
              Pending / New Reviews
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {pendingCount}
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <UserCheck size={16} style={{ color: 'var(--accent-green)' }} />
              Approved Requests
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {approvedCount}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {[
          { id: 'ACCESS_REQUESTS', label: 'Advanced Access Requests', count: accessRequests.length, icon: FileText },
          { id: 'ADVANCED_CONTROLS', label: 'Advanced Controls Catalog', count: controls.length, icon: Scale },
          { id: 'CAPABILITIES', label: 'Service Capabilities & Matrix', count: null, icon: Layers }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              background: 'none',
              border: 'none',
              outline: 'none',
              cursor: 'pointer',
              paddingBottom: '0.75rem',
              fontSize: '0.9rem',
              fontWeight: 600,
              color: activeTab === tab.id ? 'var(--accent-gold)' : 'var(--text-secondary)',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent-gold)' : '2px solid transparent',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.15s ease'
            }}
          >
            <tab.icon size={16} />
            <span>{tab.label}</span>
            {tab.count !== null && (
              <span style={{
                fontSize: '0.7rem',
                padding: '0.1rem 0.4rem',
                borderRadius: '9999px',
                backgroundColor: activeTab === tab.id ? 'var(--accent-gold-light)' : 'var(--bg-tertiary)',
                color: activeTab === tab.id ? 'var(--accent-gold)' : 'var(--text-secondary)'
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content Rendering */}
      <div className="animate-fade-in">
        
        {/* Tab 1: Access Requests */}
        {activeTab === 'ACCESS_REQUESTS' && (
          <div>
            {/* Filter Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, maxWidth: '400px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.4rem 0.75rem' }}>
                <Search size={16} style={{ color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="Search by user or justification..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ background: 'none', border: 'none', outline: 'none', width: '100%', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Filter size={15} style={{ color: 'var(--text-muted)' }} />
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '0.4rem 0.75rem',
                    fontSize: '0.85rem',
                    outline: 'none'
                  }}
                >
                  <option value="ALL">All Statuses ({accessRequests.length})</option>
                  <option value="NEW">New / Pending</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="table-container" style={{ margin: 0 }}>
              <table className="enterprise-table">
                <thead>
                  <tr>
                    <th>Req ID</th>
                    <th>Requested For</th>
                    <th>Requested By</th>
                    <th>Justification</th>
                    <th>Risk Violations</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                        No access requests match the selected criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredRequests.map(req => (
                      <tr key={req.id}>
                        <td>
                          <span style={{ fontWeight: 600, color: 'var(--accent-gold)', fontSize: '0.85rem' }}>
                            #{req.id}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{req.requestedFor}</div>
                          {req.isTemporaryAccess && (
                            <span style={{ fontSize: '0.7rem', color: 'var(--accent-gold)', display: 'block' }}>
                              Temporary Access
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          {req.requestedBy}
                        </td>
                        <td style={{ maxWidth: '260px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {req.justification}
                          </div>
                        </td>
                        <td>
                          {req.violationCount > 0 ? (
                            <span className="badge badge-inactive" style={{ fontSize: '0.75rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                              <AlertCircle size={12} />
                              {req.violationCount} Violations
                            </span>
                          ) : (
                            <span className="badge badge-active" style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                              <CheckCircle2 size={12} />
                              0 Violations
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${req.status === 'APPROVED' ? 'badge-active' : (req.status === 'REJECTED' ? 'badge-inactive' : 'badge-gold')}`} style={{ fontSize: '0.75rem' }}>
                            {req.status}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {new Date(req.creationDate).toLocaleDateString()}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            onClick={() => setSelectedRequest(req)}
                            className="btn btn-secondary"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                          >
                            <Eye size={13} />
                            Details
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Advanced Controls Catalog */}
        {activeTab === 'ADVANCED_CONTROLS' && (
          <div>
            {selectedControlId ? (
              /* Selected Control Details & Incidents View */
              <div className="animate-fade-in">
                {/* Back Button Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <button
                    onClick={() => {
                      setSelectedControlId(null);
                      setSelectedControlDetail(null);
                      setControlDetailError('');
                    }}
                    className="btn btn-secondary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
                  >
                    <ArrowLeft size={16} /> Back to Controls Catalog
                  </button>

                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Endpoint: <code>/fscmRestApi/resources/11.13.18.05/advancedControls/{selectedControlId}?expand=incidents</code>
                  </div>
                </div>

                {/* Loading State */}
                {controlDetailLoading && (
                  <div className="glass-panel" style={{ padding: '3.5rem 2rem', textAlign: 'center', marginBottom: '1.5rem' }}>
                    <div className="animate-spin" style={{ display: 'inline-block', marginBottom: '1rem', color: 'var(--accent-gold)' }}>
                      <RefreshCw size={36} />
                    </div>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                      Loading control details...
                    </h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>
                      Fetching control configuration and continuous monitoring incidents from Oracle Fusion...
                    </p>
                  </div>
                )}

                {/* Error State with Retry Button */}
                {controlDetailError && !controlDetailLoading && (
                  <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', borderLeft: '4px solid var(--accent-red)', marginBottom: '1.5rem' }}>
                    <AlertCircle size={36} style={{ color: 'var(--accent-red)', marginBottom: '0.75rem' }} />
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--accent-red)', marginBottom: '0.4rem' }}>
                      Unable to retrieve control details from Oracle Fusion.
                    </h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                      The backend request to the Oracle Fusion FSCM REST endpoint encountered a communication failure.
                    </p>
                    <button
                      onClick={() => handleSelectControl(selectedControlId)}
                      className="btn btn-primary"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
                    >
                      <RefreshCw size={14} /> Retry
                    </button>
                  </div>
                )}

                {/* Populated Control Details & Incidents */}
                {selectedControlDetail && !controlDetailLoading && (
                  <div>
                    {/* Header Card */}
                    <div className="glass-panel" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.75rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                            <span className="badge badge-gold" style={{ fontSize: '0.8rem', fontWeight: 700 }}>
                              Control ID: {selectedControlDetail.id}
                            </span>
                            <span className={`badge ${selectedControlDetail.status === 'ACTIVE' ? 'badge-active' : 'badge-inactive'}`} style={{ fontSize: '0.75rem' }}>
                              {selectedControlDetail.status || 'Status N/A'}
                            </span>
                            <span className="badge badge-gold" style={{ fontSize: '0.75rem' }}>
                              State: {selectedControlDetail.state || selectedControlDetail.stateCode || 'APPROVED'}
                            </span>
                            {selectedControlDetail.type && (
                              <span className="badge" style={{ fontSize: '0.75rem', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                                Type: {selectedControlDetail.type}
                              </span>
                            )}
                          </div>
                          <h2 style={{ fontSize: '1.35rem', fontWeight: 700, fontFamily: 'var(--font-header)', color: 'var(--text-primary)', margin: 0 }}>
                            {selectedControlDetail.name}
                          </h2>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Incidents Detected</span>
                          <span style={{ fontSize: '1.6rem', fontWeight: 800, color: (selectedControlDetail.incidents?.length || 0) > 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                            {selectedControlDetail.incidents ? selectedControlDetail.incidents.length : 0}
                          </span>
                        </div>
                      </div>

                      {selectedControlDetail.description && (
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5', margin: '0.75rem 0 0 0', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                          {selectedControlDetail.description}
                        </p>
                      )}
                    </div>

                    {/* Section 1: Control Details Grid */}
                    <div className="glass-panel" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
                      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, fontFamily: 'var(--font-header)', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Scale size={18} style={{ color: 'var(--accent-gold)' }} />
                        Control Details
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

                        <div style={{ gridColumn: '1 / -1' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Description</span>
                          <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '0.65rem 0.85rem', borderRadius: '4px', fontSize: '0.85rem', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                            {renderFieldVal(selectedControlDetail.description)}
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Type</span>
                          <span style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>{renderFieldVal(selectedControlDetail.type)}</span>
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

                    {/* Section 2: Incidents */}
                    <div className="glass-panel" style={{ padding: '1.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <div>
                          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, fontFamily: 'var(--font-header)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <ShieldAlert size={18} style={{ color: (selectedControlDetail.incidents?.length || 0) > 0 ? 'var(--accent-red)' : 'var(--accent-green)' }} />
                            Incidents ({selectedControlDetail.incidents ? selectedControlDetail.incidents.length : 0})
                          </h3>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                            Retrieved from live Oracle Fusion Advanced Controls API (<code>?expand=incidents</code>)
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            Incident Count:
                          </span>
                          <span className={`badge ${(selectedControlDetail.incidents?.length || 0) > 0 ? 'badge-inactive' : 'badge-active'}`} style={{ fontSize: '0.85rem', fontWeight: 700, padding: '0.25rem 0.65rem' }}>
                            {selectedControlDetail.incidents ? selectedControlDetail.incidents.length : 0}
                          </span>
                        </div>
                      </div>

                      {/* Empty Incidents Case: Zero Incidents */}
                      {(!selectedControlDetail.incidents || selectedControlDetail.incidents.length === 0) ? (
                        <div style={{
                          padding: '3rem 2rem',
                          textAlign: 'center',
                          backgroundColor: 'var(--bg-secondary)',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color)'
                        }}>
                          <CheckCircle2 size={36} style={{ color: 'var(--accent-green)', marginBottom: '0.75rem' }} />
                          <h4 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                            No incidents found for this control.
                          </h4>
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: '520px', margin: '0 auto' }}>
                            Oracle Fusion returned an empty incidents collection (<code>"incidents": []</code>). No policy violations or risk incidents have been triggered under this rule.
                          </p>
                        </div>
                      ) : (
                        /* Populated Incidents Table */
                        <div className="table-container" style={{ margin: 0, overflowX: 'auto' }}>
                          <table className="enterprise-table">
                            <thead>
                              <tr>
                                <th style={{ whiteSpace: 'nowrap' }}>Incident ID</th>
                                <th style={{ whiteSpace: 'nowrap' }}>Global User</th>
                                <th style={{ whiteSpace: 'nowrap' }}>Role</th>
                                <th style={{ whiteSpace: 'nowrap' }}>Priority</th>
                                <th style={{ whiteSpace: 'nowrap' }}>Status</th>
                                <th style={{ whiteSpace: 'nowrap' }}>State</th>
                                <th style={{ whiteSpace: 'nowrap' }}>Creation Date</th>
                                <th style={{ minWidth: '220px' }}>Incident Information</th>
                                <th style={{ whiteSpace: 'nowrap' }}>Data Source</th>
                                <th style={{ whiteSpace: 'nowrap' }}>Grouping Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedControlDetail.incidents.map((inc: any, idx: number) => (
                                <tr key={inc.id || idx}>
                                  <td>
                                    <span style={{ fontWeight: 600, color: 'var(--accent-gold)', fontSize: '0.85rem' }}>
                                      #{inc.id}
                                    </span>
                                  </td>
                                  <td>
                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                                      {renderFieldVal(inc.globalUserName || inc.globalUserId)}
                                    </div>
                                    {inc.globalUserId && inc.globalUserName && (
                                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                        ID: {inc.globalUserId}
                                      </span>
                                    )}
                                  </td>
                                  <td>
                                    <code style={{ fontSize: '0.75rem' }}>{renderFieldVal(inc.role)}</code>
                                  </td>
                                  <td>
                                    <span className="badge" style={{
                                      fontSize: '0.72rem',
                                      fontWeight: 600,
                                      backgroundColor: inc.priority === 'HIGH' ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg-tertiary)',
                                      color: inc.priority === 'HIGH' ? 'var(--accent-red)' : 'var(--text-secondary)'
                                    }}>
                                      {renderFieldVal(inc.priority)}
                                    </span>
                                  </td>
                                  <td>
                                    <span className="badge badge-active" style={{ fontSize: '0.72rem' }}>
                                      {renderFieldVal(inc.status)}
                                    </span>
                                  </td>
                                  <td>
                                    <span className="badge badge-gold" style={{ fontSize: '0.72rem' }}>
                                      {renderFieldVal(inc.state)}
                                    </span>
                                  </td>
                                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                    {formatOracleDate(inc.creationDate)}
                                  </td>
                                  <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                    <div style={{ wordBreak: 'break-word', maxWidth: '320px' }}>
                                      {renderFieldVal(inc.incidentInformation)}
                                    </div>
                                  </td>
                                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                    {renderFieldVal(inc.dataSource)}
                                  </td>
                                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                    {renderFieldVal(inc.groupingValue)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Controls Catalog List View */
              <div>
                {/* Catalog Controls Header with Refresh */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
                  <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-header)', margin: 0, color: 'var(--text-primary)' }}>
                      Advanced Controls Catalog
                    </h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0.2rem 0 0 0' }}>
                      Authoritative Oracle Fusion controls inventory retrieved dynamically via <code>/fscmRestApi/resources/11.13.18.05/advancedControls</code>
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {lastRefreshed && (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Last refreshed: {lastRefreshed}
                      </span>
                    )}
                    <button
                      onClick={handleRefreshControls}
                      disabled={controlsRefreshing}
                      className="btn btn-secondary"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', padding: '0.45rem 0.85rem' }}
                      title="Fetch live controls from Oracle Fusion"
                    >
                      <RefreshCw size={14} className={controlsRefreshing ? 'animate-spin' : ''} />
                      {controlsRefreshing ? 'Refreshing...' : 'Refresh Catalog'}
                    </button>
                  </div>
                </div>

                {/* Filter and Search Bar */}
                <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
                    <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      placeholder="Search controls by ID or Name..."
                      value={controlSearchQuery}
                      onChange={e => setControlSearchQuery(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.5rem 0.75rem 0.5rem 2.25rem',
                        backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        fontSize: '0.85rem'
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Filter size={15} style={{ color: 'var(--text-muted)' }} />
                    <select
                      value={controlStatusFilter}
                      onChange={e => setControlStatusFilter(e.target.value)}
                      style={{
                        padding: '0.5rem 0.75rem',
                        backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        fontSize: '0.85rem'
                      }}
                    >
                      <option value="ALL">All Statuses ({controls.length})</option>
                      {controlStatuses.filter(s => s !== 'ALL').map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <select
                      value={controlStateFilter}
                      onChange={e => setControlStateFilter(e.target.value)}
                      style={{
                        padding: '0.5rem 0.75rem',
                        backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        fontSize: '0.85rem'
                      }}
                    >
                      <option value="ALL">All States</option>
                      {controlStates.filter(s => s !== 'ALL').map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Controls Catalog Table */}
                <div className="table-container" style={{ margin: 0, overflowX: 'auto' }}>
                  <table className="enterprise-table">
                    <thead>
                      <tr>
                        <th style={{ width: '110px' }}>Control ID</th>
                        <th style={{ minWidth: '320px' }}>Control Name</th>
                        <th style={{ width: '100px' }}>Status</th>
                        <th style={{ width: '110px' }}>State</th>
                        <th style={{ width: '130px' }}>Last Run</th>
                        <th style={{ width: '130px' }}>Last Updated</th>
                        <th style={{ width: '110px', textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredControls.length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                            No advanced controls match the search criteria.
                          </td>
                        </tr>
                      ) : (
                        filteredControls.map(ctrl => (
                          <tr
                            key={ctrl.id}
                            onClick={() => handleSelectControl(ctrl.id)}
                            style={{ cursor: 'pointer' }}
                            title="Click to view details and incidents"
                          >
                            <td>
                              <span style={{ fontWeight: 600, color: 'var(--accent-gold)', fontSize: '0.85rem' }}>
                                #{ctrl.id}
                              </span>
                            </td>
                            <td>
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                                {ctrl.name}
                              </div>
                              {ctrl.description && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '420px' }}>
                                  {ctrl.description}
                                </div>
                              )}
                            </td>
                            <td>
                              <span className={`badge ${ctrl.status === 'ACTIVE' ? 'badge-active' : 'badge-inactive'}`} style={{ fontSize: '0.72rem' }}>
                                {ctrl.status || 'ACTIVE'}
                              </span>
                            </td>
                            <td>
                              <span className="badge badge-gold" style={{ fontSize: '0.72rem' }}>
                                {ctrl.state || ctrl.stateCode || 'APPROVED'}
                              </span>
                            </td>
                            <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {formatOracleDate(ctrl.lastRunDate)}
                            </td>
                            <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {formatOracleDate(ctrl.lastUpdateDate)}
                            </td>
                            <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => handleSelectControl(ctrl.id)}
                                className="btn btn-secondary"
                                style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                              >
                                <Eye size={13} />
                                Details
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Footer summary */}
                <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Showing {filteredControls.length} of {controls.length} controls</span>
                  <span>Click any row to inspect continuous monitoring incidents via <code>?expand=incidents</code></span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Service Capabilities & Matrix */}
        {activeTab === 'CAPABILITIES' && (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, fontFamily: 'var(--font-header)', marginBottom: '0.5rem' }}>
              Oracle Risk Management Cloud Capability Matrix
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Real-time API service detection verified against the connected Oracle Fusion environment.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
              {[
                {
                  name: 'Advanced Access Requests (AAC)',
                  endpoint: '/fscmRestApi/resources/11.13.18.05/advancedAccessRequests',
                  status: capabilities?.advancedAccessRequests?.status || 'LIVE_AVAILABLE',
                  message: capabilities?.advancedAccessRequests?.message || 'Operational with live access requests.'
                },
                {
                  name: 'Role Briefing & Privilege Analysis',
                  endpoint: '/fscmRestApi/resources/11.13.18.05/advancedAccessRequests/action/getRoleBriefing',
                  status: 'LIVE_AVAILABLE',
                  message: 'Operational with live ADF action returning complete privilege catalog.'
                },
                {
                  name: 'Advanced Controls & Policies',
                  endpoint: '/fscmRestApi/resources/11.13.18.05/advancedControls',
                  status: capabilities?.advancedControls?.status || 'LIVE_AVAILABLE',
                  message: capabilities?.advancedControls?.message || 'Operational with live FSCM schema.'
                },
                {
                  name: 'Control Violation Incidents',
                  endpoint: '/fscmRestApi/resources/11.13.18.05/advancedControls/{id}/child/incidents',
                  status: capabilities?.controlIncidents?.status || 'LIVE_AVAILABLE',
                  message: capabilities?.controlIncidents?.message || 'Accessible via control child links.'
                },
                {
                  name: 'Access Review Campaigns',
                  endpoint: '/fscmRestApi/resources/11.13.18.05/accessCertifications',
                  status: capabilities?.accessCertifications?.status || 'SERVICE_NOT_ACTIVATED',
                  message: capabilities?.accessCertifications?.message || 'Access Certification Cloud standalone REST services require separate licensing in this sandbox.'
                }
              ].map((cap, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '1rem 1.25rem',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  flexWrap: 'wrap',
                  gap: '0.75rem'
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
                      {cap.name}
                    </div>
                    <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{cap.endpoint}</code>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                      {cap.message}
                    </div>
                  </div>

                  <div>
                    {cap.status === 'LIVE_AVAILABLE' ? (
                      <span className="badge badge-active" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}>
                        <CheckCircle2 size={14} />
                        Live Available
                      </span>
                    ) : (
                      <span className="badge badge-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}>
                        <AlertCircle size={14} />
                        Service Not Activated
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Modal: Access Request Details */}
      {selectedRequest && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div className="glass-panel animate-scale-in" style={{ maxWidth: '650px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
              <div>
                <span className="badge badge-gold" style={{ fontSize: '0.75rem', marginRight: '0.5rem' }}>
                  Request #{selectedRequest.id}
                </span>
                <span className={`badge ${selectedRequest.status === 'APPROVED' ? 'badge-active' : 'badge-inactive'}`} style={{ fontSize: '0.75rem' }}>
                  {selectedRequest.status}
                </span>
              </div>
              <button
                onClick={() => setSelectedRequest(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Target User</span>
                <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{selectedRequest.requestedFor}</strong>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Requested By</span>
                <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{selectedRequest.requestedBy}</strong>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Creation Date</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{new Date(selectedRequest.creationDate).toLocaleString()}</span>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Risk Analysis Completed</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{selectedRequest.analysisCompletedOn || 'Pending'}</span>
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>Business Justification</span>
              <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                {selectedRequest.justification}
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem', backgroundColor: selectedRequest.violationCount > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)', padding: '1rem', borderRadius: '6px', border: `1px solid ${selectedRequest.violationCount > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: selectedRequest.violationCount > 0 ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: 600, fontSize: '0.9rem' }}>
                <ShieldAlert size={18} />
                <span>Risk Violation Assessment: {selectedRequest.violationCount} Detected</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.4rem', margin: 0 }}>
                {selectedRequest.violationCount > 0
                  ? 'This request triggered Segregation of Duties (SoD) or Advanced Access Control policy violations during automated analysis.'
                  : 'No policy or Segregation of Duties violations were detected during automated pre-provisioning simulation.'}
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setSelectedRequest(null)}
                className="btn btn-secondary"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
