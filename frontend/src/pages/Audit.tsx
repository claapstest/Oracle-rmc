import React, { useEffect, useState } from 'react';
import { 
  Search, 
  FileClock, 
  Filter, 
  ShieldAlert, 
  RefreshCw, 
  ChevronDown, 
  ChevronRight, 
  Calendar, 
  AlertCircle, 
  Layers 
} from 'lucide-react';
import { api } from '../services/api.js';
import { TableExportControl } from '../components/TableExportControl';

interface AuditProductBO {
  id: string;
  displayName: string;
}

interface AuditProduct {
  sno?: number;
  id: string;
  displayName: string;
  productName?: string;
  shortCodes: string[];
  mappingStatus?: 'CONFIRMED' | 'UNRESOLVED';
  requiresBusinessObjectType: boolean;
  businessObjects: AuditProductBO[];
}

interface AttributeDetail {
  attribute: string;
  attributeInternalName?: string;
  oldValue?: string;
  newValue?: string;
}

interface AuditLogItem {
  id: string;
  timestamp: string;
  username: string;
  userInternalName?: string;
  event: string;
  eventCategory?: string;
  businessObject: string;
  qualifiedBusinessObject?: string;
  identifier: string;
  details: string;
  attributeDetails?: AttributeDetail[];
  childObjects?: any[];
  impersonator?: string;
}

export default function Audit() {
  // Product Catalog state
  const [products, setProducts] = useState<AuditProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('hcm');
  const [selectedBOId, setSelectedBOId] = useState<string>('person');

  // Filter state
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 9);
    return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [userQuery, setUserQuery] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('ALL');

  // Query Results & Status
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [dataSource, setDataSource] = useState<string>('Oracle Fusion');
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [dateWarning, setDateWarning] = useState<string>('');

  // Summary State of last successful search
  const [lastQuerySummary, setLastQuerySummary] = useState<{
    productDisplayName: string;
    businessObjectDisplayName: string;
    fromDate: string;
    toDate: string;
    count: number;
  } | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Expandable row state (set of expanded log IDs)
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());

  // 1. Load authoritative product catalog on mount
  useEffect(() => {
    let isCancelled = false;
    async function loadCatalog() {
      try {
        const res = await api.getAuditProducts();
        if (isCancelled) return;
        if (res?.success && Array.isArray(res.products)) {
          setProducts(res.products);
          // Default to confirmed hcm if available
          const hcm = res.products.find((p: AuditProduct) => p.id === 'hcm');
          if (hcm) {
            setSelectedProductId('hcm');
            if (hcm.businessObjects && hcm.businessObjects.length > 0) {
              setSelectedBOId(hcm.businessObjects[0].id);
            }
          } else if (res.products.length > 0) {
            setSelectedProductId(res.products[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load audit product catalog:', err);
      }
    }
    loadCatalog();
    return () => {
      isCancelled = true;
    };
  }, []);

  // Update business object selection when selected product changes
  useEffect(() => {
    const prod = products.find(p => p.id === selectedProductId);
    if (!prod) return;

    if (!prod.requiresBusinessObjectType || prod.businessObjects.length === 0) {
      setSelectedBOId('');
    } else {
      setSelectedBOId(prod.businessObjects[0]?.id || '');
    }
  }, [selectedProductId, products]);

  // Date span validation (Oracle restricts audit queries to <= 30 days)
  useEffect(() => {
    if (fromDate && toDate) {
      const fromMs = new Date(fromDate).getTime();
      const toMs = new Date(toDate).getTime();
      const diffDays = (toMs - fromMs) / (1000 * 60 * 60 * 24);
      if (diffDays > 30) {
        setDateWarning('Oracle Fusion limits audit history queries to a maximum 30-day time span.');
      } else if (diffDays < 0) {
        setDateWarning('Date From cannot be after Date To.');
      } else {
        setDateWarning('');
      }
    }
  }, [fromDate, toDate]);

  // Auto-run initial search once product catalog is loaded
  const [hasAutoSearched, setHasAutoSearched] = useState(false);
  useEffect(() => {
    if (!hasAutoSearched && products.length > 0 && selectedProductId) {
      setHasAutoSearched(true);
      handleSearch(1);
    }
  }, [products, selectedProductId, hasAutoSearched]);

  // Execute Search
  const handleSearch = async (targetPage = 1) => {
    if (dateWarning && (new Date(toDate).getTime() < new Date(fromDate).getTime())) {
      setError('Please correct the date range before searching.');
      return;
    }

    setIsSearching(true);
    setError('');

    const prod = products.find(p => p.id === selectedProductId);
    const selectedBO = prod?.businessObjects.find(b => b.id === selectedBOId);

    try {
      const res = await api.getAuditLogs({
        product: prod?.productName || prod?.displayName || selectedProductId,
        businessObjectType: selectedBO?.displayName || selectedBOId || undefined,
        fromDate,
        toDate,
        username: userQuery.trim() || undefined,
        action: actionFilter !== 'ALL' ? actionFilter : undefined,
        pageNumber: targetPage,
        pageSize
      });

      setHasSearched(true);
      setCurrentPage(targetPage);

      if (res?.auditUnavailable) {
        setError(res.message || 'Unable to retrieve audit history from Oracle Fusion.');
        setLogs([]);
        setTotalRecords(0);
      } else if (res?.logs) {
        setError('');
        console.log(`[Audit UI DEBUG]\nAPI records: ${res.logs.length}\nNormalized records: ${res.logs.length}\nDisplayed records: ${Math.min(res.logs.length, pageSize)}`);
        setLogs(res.logs);
        setTotalRecords(res.totalRecords !== undefined ? res.totalRecords : res.logs.length);
        setDataSource(res.dataSource || 'Oracle Fusion');
        setLastQuerySummary({
          productDisplayName: res.productDisplayName || prod?.displayName || 'Oracle Fusion',
          businessObjectDisplayName: res.businessObjectDisplayName || selectedBO?.displayName || (prod?.requiresBusinessObjectType ? 'Standard Object' : 'All Platform Events'),
          fromDate: res.dateRange?.fromDate || fromDate,
          toDate: res.dateRange?.toDate || toDate,
          count: res.totalRecords !== undefined ? res.totalRecords : res.logs.length
        });
      } else {
        setError('');
        setLogs([]);
        setTotalRecords(0);
      }
    } catch (err: any) {
      console.error('Audit search failed:', err);
      const msg = err.response?.data?.message || err.message || 'Unable to retrieve audit history from Oracle Fusion.';
      setError(msg);
      setHasSearched(true);
      setLogs([]);
      setTotalRecords(0);
    } finally {
      setIsSearching(false);
    }
  };

  // Clear filters
  const handleClearFilters = () => {
    const hcm = products.find(p => p.id === 'hcm');
    if (hcm) {
      setSelectedProductId('hcm');
      setSelectedBOId(hcm.businessObjects[0]?.id || 'person');
    }
    const d = new Date();
    d.setDate(d.getDate() - 9);
    setFromDate(d.toISOString().split('T')[0]);
    setToDate(new Date().toISOString().split('T')[0]);
    setUserQuery('');
    setActionFilter('ALL');
    setError('');
    setDateWarning('');
    setHasSearched(false);
    setLogs([]);
    setTotalRecords(0);
    setLastQuerySummary(null);
    setCurrentPage(1);
    setExpandedRowIds(new Set());
  };

  // Toggle Row Expansion
  const toggleRowExpansion = (id: string) => {
    setExpandedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Active product metadata
  const currentProduct = products.find(p => p.id === selectedProductId);
  const requiresBO = currentProduct?.requiresBusinessObjectType ?? true;

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRecords);

  // Badge class helper based on event type
  const getEventBadgeClass = (event: string) => {
    const e = event.toUpperCase();
    if (e.includes('DELETE') || e.includes('REVOKE')) return 'badge-inactive';
    if (e.includes('INSERT') || e.includes('CREATE') || e.includes('ASSIGN') || e.includes('ADD')) return 'badge-active';
    if (e.includes('UPDATE') || e.includes('MODIFY')) return 'badge-gold';
    return 'badge-secondary';
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1440px', width: '100%', margin: '0 auto' }}>
      
      {/* 1. Header Banner */}
      <div className="page-header-banner animate-fade-in" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #1E40AF 0%, #2563EB 60%, #3B82F6 100%)',
        position: 'relative',
        borderRadius: '12px',
        padding: '1.75rem 2rem',
        marginBottom: '1.5rem',
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(37, 99, 235, 0.2)'
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
            Oracle Fusion Audit Trail
          </h1>
          <p style={{ color: '#E0E7FF', fontSize: '0.92rem', margin: 0 }}>
            View and investigate audit history from Oracle Fusion applications.
          </p>
        </div>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div style={{
            padding: '0.45rem 1rem',
            fontSize: '0.8rem',
            fontWeight: 600,
            borderRadius: '9999px',
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            color: '#ffffff',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <FileClock size={15} />
            <span>{hasSearched ? `${totalRecords} Records Found` : `${dataSource || 'Live Oracle Fusion'} Connected`}</span>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="glass-panel animate-fade-in" style={{ padding: '1rem 1.25rem', borderLeft: '4px solid var(--accent-red)', marginBottom: '1.25rem', background: 'rgba(239, 68, 68, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <AlertCircle size={18} style={{ color: 'var(--accent-red)', flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--accent-red)' }}>Unable to retrieve audit history from Oracle Fusion</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>{error}</div>
            </div>
          </div>
        </div>
      )}

      {/* Date Span Warning */}
      {dateWarning && (
        <div className="glass-panel animate-fade-in" style={{ padding: '0.75rem 1.25rem', borderLeft: '4px solid var(--accent-gold)', marginBottom: '1.25rem', background: 'rgba(245, 158, 11, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <ShieldAlert size={16} style={{ color: 'var(--accent-gold)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 500 }}>{dateWarning}</span>
          </div>
        </div>
      )}

      {/* 2. Filter / Search Area */}
      <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem', borderRadius: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.9rem' }}>
          <Filter size={16} style={{ color: 'var(--accent-blue)' }} />
          <span>Audit Filters &amp; Scope</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', alignItems: 'flex-end' }}>
          
          {/* A. Product */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
              Product
            </label>
            <select
              className="form-select"
              style={{ width: '100%', fontSize: '0.82rem', padding: '0.45rem 0.65rem' }}
              value={selectedProductId}
              onChange={(e) => {
                const nextId = e.target.value;
                setSelectedProductId(nextId);
                const nextProd = products.find(p => p.id === nextId);
                if (!nextProd || !nextProd.requiresBusinessObjectType || nextProd.businessObjects.length === 0) {
                  setSelectedBOId('');
                } else {
                  setSelectedBOId(nextProd.businessObjects[0]?.id || '');
                }
              }}
              disabled={isSearching}
            >
              {products.map(prod => (
                <option key={prod.id} value={prod.id}>
                  {prod.displayName}
                </option>
              ))}
            </select>
          </div>

          {/* B. Business Object Type */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
              Business Object Type
            </label>
            <select
              className="form-select"
              style={{ width: '100%', fontSize: '0.82rem', padding: '0.45rem 0.65rem', opacity: !requiresBO ? 0.7 : 1 }}
              value={selectedBOId}
              onChange={(e) => setSelectedBOId(e.target.value)}
              disabled={isSearching || !requiresBO}
            >
              {!requiresBO ? (
                <option value="">Not Required (Middleware Audit Events)</option>
              ) : currentProduct && currentProduct.businessObjects.length > 0 ? (
                currentProduct.businessObjects.map(bo => (
                  <option key={bo.id} value={bo.id}>
                    {bo.displayName}
                  </option>
                ))
              ) : (
                <option value="">Standard Object</option>
              )}
            </select>
          </div>

          {/* C. Date From */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
              Date From
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="date"
                className="form-input"
                style={{ width: '100%', fontSize: '0.82rem', padding: '0.45rem 0.65rem' }}
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                disabled={isSearching}
              />
            </div>
          </div>

          {/* D. Date To */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
              Date To
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="date"
                className="form-input"
                style={{ width: '100%', fontSize: '0.82rem', padding: '0.45rem 0.65rem' }}
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                disabled={isSearching}
              />
            </div>
          </div>

          {/* E. User */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
              User (Optional)
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="form-input"
                style={{ width: '100%', fontSize: '0.82rem', padding: '0.45rem 0.65rem' }}
                placeholder="Search by username..."
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                disabled={isSearching}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch(1);
                }}
              />
            </div>
          </div>

          {/* F. Event Type / Action */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
              Event Type / Action
            </label>
            <select
              className="form-select"
              style={{ width: '100%', fontSize: '0.82rem', padding: '0.45rem 0.65rem' }}
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              disabled={isSearching}
            >
              <option value="ALL">All Events</option>
              <option value="Object Data Insert">Object Data Insert</option>
              <option value="Object Data Update">Object Data Update</option>
              <option value="Object Data Delete">Object Data Delete</option>
              <option value="Role Membership Add">Role Membership Add</option>
              <option value="Role Membership Revoke">Role Membership Revoke</option>
              <option value="CreateCredential">CreateCredential</option>
              <option value="DeleteCredential">DeleteCredential</option>
            </select>
          </div>

          {/* G & H. Action Buttons */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-primary"
              style={{
                flex: 1,
                padding: '0.48rem 1rem',
                fontSize: '0.82rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
                cursor: isSearching ? 'not-allowed' : 'pointer',
                opacity: isSearching ? 0.7 : 1
              }}
              onClick={() => handleSearch(1)}
              disabled={isSearching}
            >
              {isSearching ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Searching...</span>
                </>
              ) : (
                <>
                  <Search size={14} />
                  <span>Search Audit</span>
                </>
              )}
            </button>

            <button
              className="btn btn-secondary"
              style={{
                padding: '0.48rem 0.85rem',
                fontSize: '0.82rem',
                cursor: isSearching ? 'not-allowed' : 'pointer'
              }}
              onClick={handleClearFilters}
              disabled={isSearching}
              title="Clear all filters"
            >
              Clear
            </button>
          </div>

        </div>
      </div>

      {/* 3. Summary Area (Only displayed after a query has been performed) */}
      {hasSearched && lastQuerySummary && (
        <div className="glass-panel animate-fade-in" style={{
          padding: '0.9rem 1.35rem',
          marginBottom: '1.25rem',
          borderRadius: '10px',
          background: 'rgba(37, 99, 235, 0.04)',
          borderLeft: '4px solid var(--accent-blue)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', gap: '2.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>
                Audit Results
              </span>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {lastQuerySummary.count} records found
              </div>
            </div>

            <div>
              <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>
                Product
              </span>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {lastQuerySummary.productDisplayName}
              </div>
            </div>

            <div>
              <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>
                Business Object
              </span>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {lastQuerySummary.businessObjectDisplayName}
              </div>
            </div>

            <div>
              <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>
                Date Range
              </span>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Calendar size={13} style={{ color: 'var(--text-muted)' }} />
                <span>{lastQuerySummary.fromDate} – {lastQuerySummary.toDate}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Source: <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{dataSource}</span>
            </div>
            {logs.length > 0 && (
              <TableExportControl
                filename="audit_history"
                data={logs}
                totalCount={totalRecords || logs.length}
                columns={[
                  { key: 'timestamp', label: 'Timestamp' },
                  { key: 'username', label: 'User' },
                  { key: 'event', label: 'Event' },
                  { key: 'businessObject', label: 'Business Object' },
                  { key: 'identifier', label: 'Identifier' },
                  { key: 'details', label: 'Details' }
                ]}
              />
            )}
          </div>
        </div>
      )}

      {/* 4. Audit Results Table */}
      <div className="table-container" style={{ margin: 0, borderRadius: '10px', overflow: 'hidden' }}>
        <table className="enterprise-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ width: '30px' }}></th>
              <th style={{ width: '160px' }}>TIMESTAMP</th>
              <th style={{ width: '150px' }}>USER</th>
              <th style={{ width: '180px' }}>EVENT</th>
              <th style={{ width: '180px' }}>BUSINESS OBJECT</th>
              <th style={{ width: '220px' }}>IDENTIFIER</th>
              <th>DETAILS</th>
            </tr>
          </thead>
          <tbody>
            {/* Loading State */}
            {isSearching ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '3.5rem 1.5rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                    <RefreshCw size={26} className="animate-spin" style={{ color: 'var(--accent-blue)' }} />
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                      Retrieving audit history from Oracle Fusion...
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Querying live audit trail logs within the selected scope.
                    </span>
                  </div>
                </td>
              </tr>
            ) : !hasSearched ? (
              /* Before Search Empty State */
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '4rem 1.5rem', color: 'var(--text-muted)' }}>
                  <div style={{ maxWidth: '480px', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ 
                      width: '48px', 
                      height: '48px', 
                      borderRadius: '50%', 
                      backgroundColor: 'rgba(37, 99, 235, 0.08)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      marginBottom: '1rem',
                      color: 'var(--accent-blue)'
                    }}>
                      <FileClock size={24} />
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                      No audit records to display
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                      Select your filters above and search Oracle Fusion Audit History to inspect real administrative actions, role assignments, and data modifications.
                    </div>
                  </div>
                </td>
              </tr>
            ) : logs.length === 0 ? (
              /* After Search 0 Records Empty State */
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '3.5rem 1.5rem', color: 'var(--text-muted)' }}>
                  <div style={{ maxWidth: '450px', margin: '0 auto' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                      No audit records found for the selected filters.
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                      Try adjusting your date range, clearing username filters, or selecting another Product / Business Object.
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              logs.slice(startIndex, endIndex).map((log) => {
                const isExpanded = expandedRowIds.has(log.id);
                const hasAttributes = Array.isArray(log.attributeDetails) && log.attributeDetails.length > 0;
                const hasChildren = Array.isArray(log.childObjects) && log.childObjects.length > 0;
                const hasImpersonator = Boolean(log.impersonator);

                return (
                  <React.Fragment key={log.id}>
                    {/* Main Row */}
                    <tr 
                      onClick={() => toggleRowExpansion(log.id)}
                      style={{ 
                        cursor: 'pointer',
                        backgroundColor: isExpanded ? 'rgba(37, 99, 235, 0.04)' : undefined,
                        transition: 'background-color 0.15s ease'
                      }}
                      className="audit-row"
                    >
                      {/* Chevron Toggle */}
                      <td style={{ textAlign: 'center', paddingLeft: '0.75rem', paddingRight: '0.25rem', color: 'var(--text-muted)' }}>
                        {isExpanded ? <ChevronDown size={15} style={{ color: 'var(--accent-blue)' }} /> : <ChevronRight size={15} />}
                      </td>

                      {/* Timestamp */}
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {log.timestamp}
                      </td>

                      {/* User */}
                      <td style={{ fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <code>{log.username}</code>
                        </div>
                      </td>

                      {/* Event Badge */}
                      <td>
                        <span className={`badge ${getEventBadgeClass(log.event)}`} style={{ fontSize: '0.72rem', letterSpacing: '0.02em' }}>
                          {log.event}
                        </span>
                      </td>

                      {/* Business Object */}
                      <td style={{ fontSize: '0.83rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                        {log.businessObject}
                      </td>

                      {/* Identifier */}
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        <code style={{ fontSize: '0.75rem', backgroundColor: 'var(--bg-tertiary)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                          {log.identifier}
                        </code>
                      </td>

                      {/* Details / Expand Action */}
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ 
                            overflow: 'hidden', 
                            textOverflow: 'ellipsis', 
                            whiteSpace: 'nowrap', 
                            maxWidth: '350px' 
                          }}>
                            {log.details}
                          </span>
                          <span style={{ 
                            fontSize: '0.72rem', 
                            fontWeight: 600, 
                            color: 'var(--accent-blue)', 
                            whiteSpace: 'nowrap',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.2rem'
                          }}>
                            {isExpanded ? 'Hide' : hasAttributes ? 'View Changes' : 'Details'}
                          </span>
                        </div>
                      </td>
                    </tr>

                    {/* 5. Expandable Details Panel */}
                    {isExpanded && (
                      <tr style={{ backgroundColor: 'rgba(37, 99, 235, 0.03)' }}>
                        <td colSpan={7} style={{ padding: '1.25rem 1.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
                          <div className="animate-fade-in">
                            
                            {/* Metadata Grid */}
                            <div style={{ 
                              display: 'grid', 
                              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', 
                              gap: '1rem',
                              paddingBottom: '1rem',
                              borderBottom: (hasAttributes || hasChildren || hasImpersonator) ? '1px solid var(--border-subtle)' : 'none',
                              marginBottom: (hasAttributes || hasChildren || hasImpersonator) ? '1rem' : '0'
                            }}>
                              <div>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Event</span>
                                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                                  {log.event}
                                </div>
                              </div>

                              <div>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>User</span>
                                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                                  {log.username} {log.userInternalName ? `(${log.userInternalName})` : ''}
                                </div>
                              </div>

                              <div>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Timestamp</span>
                                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                                  {log.timestamp}
                                </div>
                              </div>

                              <div>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Business Object</span>
                                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                                  {log.businessObject}
                                </div>
                              </div>

                              <div>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Identifier</span>
                                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                                  <code>{log.identifier}</code>
                                </div>
                              </div>

                              {log.qualifiedBusinessObject && (
                                <div style={{ gridColumn: 'span 2' }}>
                                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Qualified Business Object</span>
                                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'monospace', marginTop: '0.15rem', wordBreak: 'break-all' }}>
                                    {log.qualifiedBusinessObject}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Impersonator (if available) */}
                            {hasImpersonator && (
                              <div style={{ marginBottom: '1rem', padding: '0.5rem 0.75rem', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.08)', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                <ShieldAlert size={15} style={{ color: 'var(--accent-gold)' }} />
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                  Impersonator: <code>{log.impersonator}</code>
                                </span>
                              </div>
                            )}

                            {/* Changed Attributes Table */}
                            {hasAttributes && (
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <Layers size={14} style={{ color: 'var(--accent-blue)' }} />
                                    <span>Changed Attributes ({log.attributeDetails?.length})</span>
                                  </div>
                                  <TableExportControl
                                    filename={`audit_${log.id}_changed_attributes`}
                                    data={log.attributeDetails}
                                    columns={[
                                      { key: 'attribute', label: 'Attribute' },
                                      { key: 'attributeInternalName', label: 'Internal Name' },
                                      { key: 'oldValue', label: 'Old Value' },
                                      { key: 'newValue', label: 'New Value' }
                                    ]}
                                  />
                                </div>

                                <div style={{ overflowX: 'auto', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                    <thead>
                                      <tr style={{ backgroundColor: 'var(--bg-tertiary)', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                                        <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)', width: '30%' }}>Attribute</th>
                                        <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)', width: '35%' }}>Old Value</th>
                                        <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)', width: '35%' }}>New Value</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {log.attributeDetails?.map((attr, idx) => (
                                        <tr key={idx} style={{ borderBottom: idx < (log.attributeDetails?.length || 0) - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                                          <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                            {attr.attribute}
                                            {attr.attributeInternalName && attr.attributeInternalName !== attr.attribute && (
                                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', fontWeight: 400 }}>
                                                {attr.attributeInternalName}
                                              </span>
                                            )}
                                          </td>
                                          <td style={{ padding: '0.5rem 0.75rem', color: attr.oldValue ? 'var(--accent-red)' : 'var(--text-muted)', fontFamily: attr.oldValue ? 'monospace' : 'inherit', fontSize: '0.78rem' }}>
                                            {attr.oldValue !== undefined && attr.oldValue !== '' ? attr.oldValue : '—'}
                                          </td>
                                          <td style={{ padding: '0.5rem 0.75rem', color: attr.newValue ? 'var(--accent-green)' : 'var(--text-muted)', fontFamily: attr.newValue ? 'monospace' : 'inherit', fontSize: '0.78rem' }}>
                                            {attr.newValue !== undefined && attr.newValue !== '' ? attr.newValue : '—'}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            {/* Child Objects (if available) */}
                            {hasChildren && (
                              <div style={{ marginTop: '1rem' }}>
                                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
                                  Child Objects
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(log.childObjects, null, 2)}</pre>
                                </div>
                              </div>
                            )}

                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 8. Pagination Controls */}
      {logs.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            Showing <strong style={{ color: 'var(--text-primary)' }}>{startIndex + 1}–{endIndex}</strong> of <strong style={{ color: 'var(--text-primary)' }}>{totalRecords}</strong> records (Page {currentPage} of {totalPages})
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.75rem' }}>Per page:</span>
              <select
                className="form-select"
                style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem', height: '28px' }}
                value={pageSize}
                onChange={(e) => {
                  const newSize = Number(e.target.value);
                  setPageSize(newSize);
                  setCurrentPage(1);
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            {totalPages > 1 && (
              <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1 || isSearching}
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem', opacity: currentPage === 1 ? 0.4 : 1, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                  title="First Page"
                >
                  First
                </button>
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1 || isSearching}
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', opacity: currentPage === 1 ? 0.4 : 1, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                  title="Previous Page"
                >
                  Previous
                </button>

                {/* Page Number indicator */}
                <div style={{ padding: '0.2rem 0.6rem', fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.75rem' }}>
                  {currentPage} / {totalPages}
                </div>

                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages || isSearching}
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', opacity: currentPage === totalPages ? 0.4 : 1, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
                  title="Next Page"
                >
                  Next
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages || isSearching}
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem', opacity: currentPage === totalPages ? 0.4 : 1, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
                  title="Last Page"
                >
                  Last
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
