import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldAlert,
  FileText,
  CheckCircle2,
  AlertCircle,
  Search,
  Filter,
  Eye,
  Clock,
  UserCheck,
  X,
  RefreshCw,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { api } from '../services/api.js';
import { EnterpriseExportControl, type EnterpriseExportColumn } from '../components/EnterpriseExportControl';

interface AdvancedAccessRequestsProps {
  environmentMode: 'DEMO' | 'ORACLE_FUSION';
}

export interface AccessRequestRecord {
  id: string;
  requestedFor: string;
  requestedBy: string;
  justification: string;
  violationCount: number;
  status: string;
  creationDate: string;
  createdAt?: string;
  requestDate?: string;
  isTemporaryAccess?: boolean;
  analysisCompletedOn?: string;
  [key: string]: unknown;
}

export default function AdvancedAccessRequests({ environmentMode }: AdvancedAccessRequestsProps) {
  const [accessRequests, setAccessRequests] = useState<AccessRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [dataSource, setDataSource] = useState('');

  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRequest, setSelectedRequest] = useState<AccessRequestRecord | null>(null);
  const [requestsRefreshing, setRequestsRefreshing] = useState(false);
  const [requestPage, setRequestPage] = useState<number>(1);
  const [requestPageSize, setRequestPageSize] = useState<number>(10);

  const loadRequests = async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const res = await api.getAdvancedAccessRequests();
      if (res?.success) {
        setAccessRequests((res.items || []) as AccessRequestRecord[]);
        setDataSource(res.dataSource || (environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Data'));
      } else {
        setAccessRequests([]);
      }
    } catch (err: unknown) {
      console.error('Failed to load Advanced Access Requests:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Unable to communicate with Risk Management backend services.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environmentMode]);

  useEffect(() => {
    setRequestPage(1);
  }, [searchQuery, statusFilter, requestPageSize]);

  const filteredRequests = useMemo(() => {
    return accessRequests.filter(req => {
      const matchesStatus = statusFilter === 'ALL' || req.status === statusFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        (req.requestedFor && String(req.requestedFor).toLowerCase().includes(q)) ||
        (req.requestedBy && String(req.requestedBy).toLowerCase().includes(q)) ||
        (req.justification && String(req.justification).toLowerCase().includes(q)) ||
        (req.id && String(req.id).toLowerCase().includes(q));
      return matchesStatus && matchesSearch;
    });
  }, [accessRequests, statusFilter, searchQuery]);

  const totalViolations = useMemo(
    () => accessRequests.reduce((acc, r) => acc + (r.violationCount || 0), 0),
    [accessRequests]
  );
  const pendingCount = useMemo(
    () => accessRequests.filter(r => r.status === 'NEW' || r.status === 'PENDING').length,
    [accessRequests]
  );
  const approvedCount = useMemo(
    () => accessRequests.filter(r => r.status === 'APPROVED').length,
    [accessRequests]
  );

  const requestTotalPages = Math.max(1, Math.ceil(filteredRequests.length / requestPageSize));
  const safeRequestPage = Math.min(requestPage, requestTotalPages);
  const paginatedRequests = useMemo(() => {
    const start = (safeRequestPage - 1) * requestPageSize;
    return filteredRequests.slice(start, start + requestPageSize);
  }, [filteredRequests, safeRequestPage, requestPageSize]);

  const requestRangeStart = filteredRequests.length === 0 ? 0 : (safeRequestPage - 1) * requestPageSize + 1;
  const requestRangeEnd = Math.min(safeRequestPage * requestPageSize, filteredRequests.length);

  const requestExportColumns: EnterpriseExportColumn<AccessRequestRecord>[] = useMemo(
    () => [
      { key: 'id', label: 'Request ID', defaultSelected: true, getValue: r => r.id },
      { key: 'requestedFor', label: 'Requested For', defaultSelected: true, getValue: r => r.requestedFor },
      { key: 'requestedBy', label: 'Requested By', defaultSelected: true, getValue: r => r.requestedBy },
      { key: 'justification', label: 'Justification', defaultSelected: true, getValue: r => r.justification },
      { key: 'violationCount', label: 'Risk Violations', defaultSelected: true, getValue: r => r.violationCount ?? 0 },
      { key: 'status', label: 'Status', defaultSelected: true, getValue: r => r.status },
      { key: 'created', label: 'Created', defaultSelected: true, getValue: r => r.creationDate || r.createdAt || r.requestDate || '' }
    ],
    []
  );

  const handleRefreshRequests = async () => {
    setRequestsRefreshing(true);
    try {
      const res = await api.getAdvancedAccessRequests();
      if (res?.success) {
        setAccessRequests((res.items || []) as AccessRequestRecord[]);
        setDataSource(res.dataSource || dataSource);
        setErrorMessage('');
      }
    } catch (err) {
      console.error('Failed to refresh access requests:', err);
    } finally {
      setRequestsRefreshing(false);
    }
  };

  const renderPaginationButtons = () => {
    const pages: (number | string)[] = [];
    if (requestTotalPages <= 7) {
      for (let i = 1; i <= requestTotalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (safeRequestPage > 3) pages.push('...');
      const start = Math.max(2, safeRequestPage - 1);
      const end = Math.min(requestTotalPages - 1, safeRequestPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (safeRequestPage < requestTotalPages - 2) pages.push('...');
      pages.push(requestTotalPages);
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={safeRequestPage <= 1}
          onClick={() => setRequestPage(p => Math.max(1, p - 1))}
          className="btn btn-secondary"
          style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          aria-label="Previous requests page"
        >
          <ChevronLeft size={14} />
          <span>Prev</span>
        </button>
        {pages.map((p, idx) =>
          typeof p === 'string' ? (
            <span key={`ellipsis-${idx}`} style={{ padding: '0 0.3rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              ...
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => setRequestPage(p)}
              aria-label={`Go to requests page ${p}`}
              aria-current={p === safeRequestPage ? 'page' : undefined}
              style={{
                minWidth: '30px',
                padding: '0.35rem 0.5rem',
                fontSize: '0.78rem',
                fontWeight: p === safeRequestPage ? 700 : 500,
                borderRadius: '6px',
                border: p === safeRequestPage ? '1px solid var(--accent-blue)' : '1px solid var(--border-color)',
                backgroundColor: p === safeRequestPage ? 'var(--accent-blue-light)' : '#FFFFFF',
                color: p === safeRequestPage ? 'var(--accent-blue)' : 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          disabled={safeRequestPage >= requestTotalPages}
          onClick={() => setRequestPage(p => Math.min(requestTotalPages, p + 1))}
          className="btn btn-secondary"
          style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          aria-label="Next requests page"
        >
          <span>Next</span>
          <ChevronRight size={14} />
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }} aria-busy="true" aria-label="Loading Advanced Access Requests">
        <div style={{ height: '35px', width: '260px', marginBottom: '1rem' }} className="skeleton" />
        <div style={{ height: '20px', width: '450px', marginBottom: '2rem' }} className="skeleton" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
          <div style={{ height: '90px' }} className="skeleton" />
          <div style={{ height: '90px' }} className="skeleton" />
          <div style={{ height: '90px' }} className="skeleton" />
          <div style={{ height: '90px' }} className="skeleton" />
        </div>
        <div style={{ height: '300px' }} className="skeleton" />
        <p style={{ marginTop: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Loading Oracle Fusion data...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', width: '100%', margin: '0 auto' }}>
      <div
        className="page-header-banner animate-fade-in"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #1E40AF 0%, #2563EB 60%, #3B82F6 100%)',
          position: 'relative',
          flexWrap: 'wrap',
          gap: '1rem'
        }}
      >
        <svg
          viewBox="0 0 1440 240"
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, opacity: 0.9 }}
        >
          <path fill="rgba(255, 255, 255, 0.08)" d="M0,120 C320,190,480,50,800,130 C1120,210,1280,80,1440,120 L1440,240 L0,240 Z" />
          <path fill="rgba(96, 165, 250, 0.15)" d="M0,170 C360,90,600,210,960,140 C1200,90,1360,180,1440,150 L1440,240 L0,240 Z" />
        </svg>

        <div style={{ position: 'relative', zIndex: 2 }}>
          <h1 style={{ fontSize: '1.85rem', fontWeight: 800, fontFamily: 'var(--font-header)', marginBottom: '0.35rem', letterSpacing: '-0.02em', color: '#ffffff' }}>
            Advanced Access Requests
          </h1>
          <p style={{ color: '#E0E7FF', fontSize: '0.92rem', margin: 0 }}>
            Review access requests, policy violation analyses, and approval activity across Oracle Fusion.
          </p>
        </div>

        <div style={{ position: 'relative', zIndex: 2 }}>
          <div
            style={{
              padding: '0.4rem 0.95rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              borderRadius: '9999px',
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              color: '#ffffff'
            }}
            aria-label={`Data source: ${dataSource || (environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Data')}`}
          >
            {dataSource || (environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Data')}
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="glass-panel" style={{ padding: '1rem 1.5rem', borderLeft: '4px solid var(--accent-red)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }} role="alert">
          <AlertCircle size={20} style={{ color: 'var(--accent-red)' }} />
          <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', flex: 1 }}>{errorMessage}</div>
          <button type="button" onClick={loadRequests} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.35rem 0.8rem' }}>
            Retry
          </button>
        </div>
      )}

      <div className="animate-fade-in">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <FileText size={16} style={{ color: 'var(--accent-blue)' }} />
              Total Access Requests
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>{accessRequests.length}</div>
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
              <Clock size={16} style={{ color: 'var(--accent-amber)' }} />
              Pending / New Reviews
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>{pendingCount}</div>
          </div>
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <UserCheck size={16} style={{ color: 'var(--accent-green)' }} />
              Approved Requests
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>{approvedCount}</div>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem', marginBottom: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '240px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.45rem 0.75rem' }}>
            <Search size={16} style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search by user, justification, or request ID..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              aria-label="Search access requests"
              style={{ background: 'none', border: 'none', outline: 'none', width: '100%', color: 'var(--text-primary)', fontSize: '0.85rem' }}
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                <X size={14} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Filter size={15} style={{ color: 'var(--text-muted)' }} />
            <label htmlFor="aar-status-filter" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Status:</label>
            <select
              id="aar-status-filter"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.45rem 0.75rem', fontSize: '0.85rem', outline: 'none' }}
            >
              <option value="ALL">All Statuses ({accessRequests.length})</option>
              <option value="NEW">New / Pending</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handleRefreshRequests}
            disabled={requestsRefreshing}
            className="btn btn-secondary"
            style={{ fontSize: '0.82rem', padding: '0.45rem 0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            title="Reload access requests from Oracle Fusion"
          >
            <RefreshCw size={14} className={requestsRefreshing ? 'animate-spin' : ''} />
            {requestsRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>

          <EnterpriseExportControl
            filename="access_requests"
            sheetName="Access Requests"
            reportTitle="Oracle Fusion Advanced Access Requests"
            dataSource={dataSource}
            entityName="Requests"
            categoryLabel="Requests"
            buttonText="Export"
            currentPageData={paginatedRequests}
            filteredCount={filteredRequests.length}
            totalCount={accessRequests.length}
            availableColumns={requestExportColumns}
            appliedFilters={[
              ...(statusFilter !== 'ALL' ? [{ label: 'Status', value: statusFilter }] : []),
              ...(searchQuery.trim() ? [{ label: 'Search', value: searchQuery.trim() }] : [])
            ]}
            onFetchScopeData={async scope => {
              if (scope === 'PAGE') return paginatedRequests;
              if (scope === 'FILTERED') return filteredRequests;
              return accessRequests;
            }}
          />
        </div>

        {(statusFilter !== 'ALL' || searchQuery.trim()) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }} aria-label="Active filters">
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Active filters:</span>
            {statusFilter !== 'ALL' && (
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 600, backgroundColor: 'var(--accent-blue-light)', color: 'var(--accent-blue)', border: '1px solid rgba(37,99,235,0.25)', borderRadius: '9999px', padding: '0.2rem 0.6rem', cursor: 'pointer' }}
                aria-label="Remove status filter"
              >
                {statusFilter} <X size={12} />
              </button>
            )}
            {searchQuery.trim() && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 600, backgroundColor: 'var(--accent-blue-light)', color: 'var(--accent-blue)', border: '1px solid rgba(37,99,235,0.25)', borderRadius: '9999px', padding: '0.2rem 0.6rem', cursor: 'pointer', maxWidth: '320px' }}
                aria-label="Remove search filter"
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Search: {searchQuery.trim()}</span> <X size={12} />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setStatusFilter('ALL');
                setSearchQuery('');
              }}
              style={{ background: 'none', border: 'none', fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Clear all
            </button>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <div>
            <strong style={{ color: 'var(--text-primary)' }}>{accessRequests.length.toLocaleString()}</strong> requests found
            {filteredRequests.length !== accessRequests.length && (
              <span> · <strong style={{ color: 'var(--accent-blue)' }}>{filteredRequests.length.toLocaleString()}</strong> matching filters</span>
            )}
          </div>
          <div>
            Showing {requestRangeStart}&ndash;{requestRangeEnd} of {filteredRequests.length.toLocaleString()}
          </div>
        </div>

        <div className="table-container" style={{ margin: 0, overflowX: 'auto' }}>
          <table className="enterprise-table" style={{ minWidth: '980px' }}>
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
              {paginatedRequests.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                    No access requests match the selected criteria.
                  </td>
                </tr>
              ) : (
                paginatedRequests.map(req => (
                  <tr key={req.id}>
                    <td>
                      <span style={{ fontWeight: 600, color: 'var(--accent-amber)', fontSize: '0.85rem' }}>#{req.id}</span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{req.requestedFor}</div>
                      {req.isTemporaryAccess && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--accent-amber)', display: 'block' }}>Temporary Access</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{req.requestedBy}</td>
                    <td style={{ maxWidth: '260px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(req.justification || '')}>
                        {req.justification}
                      </div>
                    </td>
                    <td>
                      {(req.violationCount || 0) > 0 ? (
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
                      <span className={`badge ${req.status === 'APPROVED' ? 'badge-active' : req.status === 'REJECTED' ? 'badge-inactive' : 'badge-gold'}`} style={{ fontSize: '0.75rem' }}>
                        {req.status}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {req.creationDate ? new Date(String(req.creationDate)).toLocaleDateString() : <span style={{ fontStyle: 'italic' }}>Not available</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => setSelectedRequest(req)}
                        className="btn btn-secondary"
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                        aria-label={`View details for request ${req.id}`}
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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <label htmlFor="aar-page-size">Rows per page:</label>
            <select
              id="aar-page-size"
              value={requestPageSize}
              onChange={e => setRequestPageSize(Number(e.target.value))}
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
          {renderPaginationButtons()}
        </div>
      </div>

      {selectedRequest && (
        <div
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
          onClick={() => setSelectedRequest(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Access request ${selectedRequest.id} details`}
        >
          <div className="glass-panel animate-scale-in" style={{ maxWidth: '650px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '2rem' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
              <div>
                <span className="badge badge-gold" style={{ fontSize: '0.75rem', marginRight: '0.5rem' }}>
                  Request #{selectedRequest.id}
                </span>
                <span className={`badge ${selectedRequest.status === 'APPROVED' ? 'badge-active' : 'badge-inactive'}`} style={{ fontSize: '0.75rem' }}>
                  {selectedRequest.status}
                </span>
              </div>
              <button onClick={() => setSelectedRequest(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} aria-label="Close details">
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
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  {selectedRequest.creationDate ? new Date(String(selectedRequest.creationDate)).toLocaleString() : 'Not available'}
                </span>
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

            <div style={{ marginBottom: '1.5rem', backgroundColor: (selectedRequest.violationCount || 0) > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)', padding: '1rem', borderRadius: '6px', border: `1px solid ${(selectedRequest.violationCount || 0) > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: (selectedRequest.violationCount || 0) > 0 ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: 600, fontSize: '0.9rem' }}>
                <ShieldAlert size={18} />
                <span>Risk Violation Assessment: {selectedRequest.violationCount || 0} Detected</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.4rem', marginBottom: 0 }}>
                {(selectedRequest.violationCount || 0) > 0
                  ? 'This request triggered Segregation of Duties (SoD) or Advanced Access Control policy violations during automated analysis.'
                  : 'No policy or Segregation of Duties violations were detected during automated pre-provisioning simulation.'}
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setSelectedRequest(null)} className="btn btn-secondary">
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
