import React, { useEffect, useState, useMemo } from 'react';
import { Award, RefreshCw, Search, Download, Eye, Info, X, AlertCircle } from 'lucide-react';
import { api } from '../services/api.js';

interface AccessCertificatesProps {
  environmentMode?: 'DEMO' | 'ORACLE_FUSION';
}

export default function AccessCertificates({ environmentMode }: AccessCertificatesProps) {
  const [certifications, setCertifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [lastExecuted, setLastExecuted] = useState<string>('');
  const [selectedCert, setSelectedCert] = useState<any | null>(null);

  const fetchCertifications = async (isManualRefresh = false) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getAccessCertifications(isManualRefresh);
      if (res && res.success) {
        setCertifications(Array.isArray(res.data) ? res.data : []);
      } else {
        setCertifications([]);
        setError(res?.message || 'Unable to retrieve Access Certification data from Oracle Fusion.');
      }
    } catch (err: any) {
      console.error('[AccessCertificates UI] Failed to load certifications:', err);
      const errMsg = err?.response?.data?.message || err?.message || 'Unable to retrieve Access Certification data from Oracle Fusion.';
      setError(errMsg);
      setCertifications([]);
    } finally {
      const now = new Date();
      const pad = (n: number) => (n < 10 ? '0' + n : String(n));
      setLastExecuted(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCertifications();
  }, []);

  // Filter records based on search query
  const filteredCertifications = useMemo(() => {
    if (!searchTerm.trim()) return certifications;
    const term = searchTerm.toLowerCase().trim();
    return certifications.filter((item) => {
      const name = String(item.certificationName || '').toLowerCase();
      const status = String(item.status || '').toLowerCase();
      const type = String(item.type || '').toLowerCase();
      const due = String(item.dueDate || '').toLowerCase();
      const creation = String(item.creationDate || '').toLowerCase();
      return name.includes(term) || status.includes(term) || type.includes(term) || due.includes(term) || creation.includes(term);
    });
  }, [certifications, searchTerm]);

  // Pagination calculation
  const totalRecords = filteredCertifications.length;
  const totalPages = Math.ceil(totalRecords / pageSize) || 1;
  const paginatedCertifications = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCertifications.slice(start, start + pageSize);
  }, [filteredCertifications, currentPage, pageSize]);

  const exportToCsv = () => {
    if (filteredCertifications.length === 0) return;
    const headers = ['#', 'Certification Name', 'Type', 'Status', 'Certification % Complete', 'Due Date', 'Creation Date'];
    const rows = filteredCertifications.map((item, idx) => [
      idx + 1,
      `"${String(item.certificationName || '').replace(/"/g, '""')}"`,
      `"${String(item.type || '').replace(/"/g, '""')}"`,
      `"${String(item.status || '').replace(/"/g, '""')}"`,
      `"${String(item.certificationPercentComplete ?? '0%').replace(/"/g, '""')}"`,
      `"${String(item.dueDate || '').replace(/"/g, '""')}"`,
      `"${String(item.creationDate || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Access_Certifications_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getPercentValue = (val: any): number => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const num = parseFloat(val.replace('%', '').trim());
      return isNaN(num) ? 0 : num;
    }
    return 0;
  };

  const formatDueDate = (dateStr: any): string => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return String(dateStr);
      const pad = (n: number) => (n < 10 ? '0' + n : String(n));
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    } catch (_) {
      return String(dateStr);
    }
  };

  const formatCreationDate = (dateStr: any): string => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return String(dateStr);
      const pad = (n: number) => (n < 10 ? '0' + n : String(n));
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (_) {
      return String(dateStr);
    }
  };

  return (
    <div style={{ padding: '1.75rem 2rem', maxWidth: '1600px', width: '100%', margin: '0 auto' }}>
      {/* Top Banner Matching Screenshot */}
      <div
        className="page-header-banner animate-fade-in"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 50%, #3b82f6 100%)',
          borderRadius: '16px',
          padding: '2rem 2.25rem',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 10px 25px -5px rgba(37, 99, 235, 0.25)',
          marginBottom: '1rem',
          color: '#ffffff',
          flexWrap: 'wrap',
          gap: '1.25rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', position: 'relative', zIndex: 2 }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '12px',
              backgroundColor: 'rgba(255, 255, 255, 0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <Award size={30} style={{ color: '#ffffff' }} />
          </div>
          <div>
            <h1
              style={{
                fontSize: '1.85rem',
                fontWeight: 800,
                fontFamily: 'var(--font-header, sans-serif)',
                margin: 0,
                letterSpacing: '-0.02em',
                color: '#ffffff'
              }}
            >
              Access Certificates
            </h1>
            <p style={{ color: 'rgba(255, 255, 255, 0.88)', fontSize: '0.94rem', margin: '0.35rem 0 0 0' }}>
              Oracle Fusion BI Publisher report execution for live Access Certification records.
            </p>
          </div>
        </div>

        {/* Right Badges in Banner */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', position: 'relative', zIndex: 2 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.45rem 1rem',
              fontSize: '0.82rem',
              fontWeight: 600,
              borderRadius: '9999px',
              backgroundColor: 'rgba(255, 255, 255, 0.16)',
              border: '1px solid rgba(255, 255, 255, 0.28)',
              color: '#ffffff'
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#10B981',
                boxShadow: '0 0 8px #10B981'
              }}
            />
            <span>Live Oracle Fusion BIP</span>
          </div>

          <button
            type="button"
            onClick={() => fetchCertifications(true)}
            disabled={loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.45rem 1.05rem',
              fontSize: '0.82rem',
              fontWeight: 600,
              borderRadius: '9999px',
              backgroundColor: 'rgba(255, 255, 255, 0.16)',
              border: '1px solid rgba(255, 255, 255, 0.28)',
              color: '#ffffff',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.26)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.16)';
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* On-Demand Report Notice Bar Matching Screenshot */}
      <div
        className="animate-fade-in"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#EFF6FF',
          border: '1px solid #DBEAFE',
          borderRadius: '10px',
          padding: '0.75rem 1.25rem',
          marginBottom: '1.25rem',
          fontSize: '0.84rem',
          color: '#1E3A8A',
          flexWrap: 'wrap',
          gap: '0.75rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Info size={16} style={{ color: '#2563EB', flexShrink: 0 }} />
          <span>
            <strong>On-Demand Report:</strong> Retrieves data directly via BI Publisher (
            <code style={{ background: 'rgba(37, 99, 235, 0.08)', padding: '0.15rem 0.35rem', borderRadius: '4px' }}>
              /Custom/Claaps Access Certification.xdo
            </code>
            ). Freshness reflects the latest reporting subject area snapshot.
          </span>
        </div>
        {lastExecuted && (
          <div style={{ color: '#64748B', fontSize: '0.82rem' }}>
            Last executed: <span style={{ fontWeight: 600, color: '#334155' }}>{lastExecuted}</span>
          </div>
        )}
      </div>

      {/* Error state if integration failed */}
      {error && (
        <div
          role="alert"
          className="animate-fade-in"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.85rem',
            backgroundColor: '#FEF2F2',
            border: '1px solid #F87171',
            borderRadius: '10px',
            padding: '1rem 1.25rem',
            marginBottom: '1.25rem',
            color: '#991B1B',
            fontSize: '0.88rem'
          }}
        >
          <AlertCircle size={18} style={{ color: '#DC2626', flexShrink: 0, marginTop: '0.1rem' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>Integration Notification</div>
            <div>{error}</div>
          </div>
          <button
            type="button"
            onClick={() => fetchCertifications(true)}
            style={{
              background: '#DC2626',
              border: 'none',
              borderRadius: '6px',
              color: '#ffffff',
              padding: '0.35rem 0.8rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Try Again
          </button>
        </div>
      )}

      {/* Main White Card with Table */}
      <div
        className="animate-fade-in"
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '14px',
          border: '1px solid #E2E8F0',
          boxShadow: '0 4px 12px -2px rgba(15, 23, 42, 0.05)',
          padding: '1.5rem',
          boxSizing: 'border-box'
        }}
      >
        {/* Top Controls Row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.25rem',
            flexWrap: 'wrap',
            gap: '1rem'
          }}
        >
          {/* Search bar */}
          <div style={{ position: 'relative', flex: '1 1 340px', maxWidth: '480px' }}>
            <span
              style={{
                position: 'absolute',
                left: '1rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#94A3B8',
                display: 'flex'
              }}
            >
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Search by certification name, status, type, or date..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                width: '100%',
                padding: '0.62rem 1rem 0.62rem 2.6rem',
                fontSize: '0.86rem',
                border: '1px solid #E2E8F0',
                borderRadius: '8px',
                backgroundColor: '#F8FAFC',
                color: '#0F172A',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Right Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.84rem', color: '#64748B' }}>
              <span>Rows:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                style={{
                  padding: '0.45rem 0.75rem',
                  fontSize: '0.84rem',
                  border: '1px solid #E2E8F0',
                  borderRadius: '6px',
                  backgroundColor: '#FFFFFF',
                  color: '#334155',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => fetchCertifications(true)}
              disabled={loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.48rem 0.95rem',
                fontSize: '0.84rem',
                fontWeight: 600,
                border: '1px solid #CBD5E1',
                borderRadius: '8px',
                backgroundColor: '#FFFFFF',
                color: '#1E293B',
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={exportToCsv}
              disabled={filteredCertifications.length === 0}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.48rem 0.95rem',
                fontSize: '0.84rem',
                fontWeight: 600,
                border: '1px solid #CBD5E1',
                borderRadius: '8px',
                backgroundColor: '#FFFFFF',
                color: '#1E293B',
                cursor: filteredCertifications.length === 0 ? 'not-allowed' : 'pointer',
                opacity: filteredCertifications.length === 0 ? 0.6 : 1
              }}
            >
              <Download size={14} />
              <span>Export</span>
            </button>
          </div>
        </div>

        {/* Counts Row Matching Screenshot */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.84rem',
            color: '#64748B',
            marginBottom: '0.85rem'
          }}
        >
          <div>
            <strong style={{ color: '#0F172A' }}>{totalRecords}</strong> records returned by Oracle BIP
          </div>
          <div>
            Showing {totalRecords > 0 ? (currentPage - 1) * pageSize + 1 : 0}-
            {Math.min(currentPage * pageSize, totalRecords)} of {totalRecords}
          </div>
        </div>

        {/* Table Container with Horizontal Scroll */}
        <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.86rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', color: '#475569' }}>
                <th style={{ padding: '0.85rem 1rem', width: '50px', fontWeight: 700 }}>#</th>
                <th style={{ padding: '0.85rem 1rem', fontWeight: 700 }}>CERTIFICATION NAME</th>
                <th style={{ padding: '0.85rem 1rem', fontWeight: 700 }}>TYPE</th>
                <th style={{ padding: '0.85rem 1rem', fontWeight: 700 }}>STATUS</th>
                <th style={{ padding: '0.85rem 1rem', fontWeight: 700, minWidth: '160px' }}>CERTIFICATION % COMPLETE</th>
                <th style={{ padding: '0.85rem 1rem', fontWeight: 700 }}>DUE DATE</th>
                <th style={{ padding: '0.85rem 1rem', fontWeight: 700 }}>CREATION DATE</th>
                <th style={{ padding: '0.85rem 1rem', fontWeight: 700, textAlign: 'center', width: '100px' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: '3.5rem 1rem', textAlign: 'center', color: '#64748B' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                      <RefreshCw size={24} className="animate-spin" style={{ color: '#2563EB' }} />
                      <span style={{ fontWeight: 600 }}>Loading Access Certifications from Oracle Fusion...</span>
                    </div>
                  </td>
                </tr>
              ) : paginatedCertifications.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748B' }}>
                    <Award size={32} style={{ color: '#94A3B8', margin: '0 auto 0.75rem auto' }} />
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#334155' }}>
                      No Access Certifications found.
                    </div>
                    <div style={{ fontSize: '0.82rem', marginTop: '0.25rem', color: '#94A3B8' }}>
                      {searchTerm ? 'No records match your search filter.' : 'Oracle BI Publisher returned 0 certification rows.'}
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedCertifications.map((item, idx) => {
                  const rowNum = (currentPage - 1) * pageSize + idx + 1;
                  const pct = getPercentValue(item.certificationPercentComplete);

                  return (
                    <tr
                      key={item.certificationName ? `${item.certificationName}_${idx}` : idx}
                      style={{
                        borderBottom: '1px solid #F1F5F9',
                        transition: 'background-color 0.15s ease'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#F8FAFC')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <td style={{ padding: '0.9rem 1rem', fontWeight: 700, color: '#334155' }}>{rowNum}</td>
                      <td style={{ padding: '0.9rem 1rem', fontWeight: 700, color: '#0F172A' }}>
                        {item.certificationName || '—'}
                      </td>
                      <td style={{ padding: '0.9rem 1rem', color: '#334155' }}>{item.type || 'Standard'}</td>
                      <td style={{ padding: '0.9rem 1rem', fontWeight: 700, color: '#0F172A' }}>
                        {item.status || 'Active'}
                      </td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: '130px' }}>
                          <div
                            style={{
                              flex: 1,
                              height: '6px',
                              backgroundColor: '#E2E8F0',
                              borderRadius: '9999px',
                              overflow: 'hidden'
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.min(Math.max(pct, 0), 100)}%`,
                                height: '100%',
                                backgroundColor: pct > 0 ? '#2563EB' : 'transparent',
                                borderRadius: '9999px'
                              }}
                            />
                          </div>
                          <span style={{ fontWeight: 700, fontSize: '0.86rem', color: '#0F172A' }}>{pct}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem', color: '#334155' }}>{formatDueDate(item.dueDate)}</td>
                      <td style={{ padding: '0.9rem 1rem', color: '#334155' }}>{formatCreationDate(item.creationDate)}</td>
                      <td style={{ padding: '0.9rem 1rem', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => setSelectedCert(item)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            padding: '0.35rem 0.75rem',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            borderRadius: '6px',
                            border: '1px solid #CBD5E1',
                            backgroundColor: '#FFFFFF',
                            color: '#1E293B',
                            cursor: 'pointer'
                          }}
                        >
                          <Eye size={14} />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls if more than 1 page */}
        {totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '1.25rem',
              fontSize: '0.84rem',
              color: '#64748B'
            }}
          >
            <div>
              Page {currentPage} of {totalPages}
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.8rem',
                  border: '1px solid #CBD5E1',
                  borderRadius: '6px',
                  backgroundColor: '#FFFFFF',
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  opacity: currentPage === 1 ? 0.5 : 1
                }}
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                disabled={currentPage === totalPages}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.8rem',
                  border: '1px solid #CBD5E1',
                  borderRadius: '6px',
                  backgroundColor: '#FFFFFF',
                  cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                  opacity: currentPage === totalPages ? 0.5 : 1
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Details View Modal */}
      {selectedCert && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.5rem'
          }}
          onClick={() => setSelectedCert(null)}
        >
          <div
            className="animate-fade-in"
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '14px',
              maxWidth: '640px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
              overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid #E2E8F0',
                backgroundColor: '#F8FAFC'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Award size={20} style={{ color: '#2563EB' }} />
                <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: '#0F172A' }}>
                  Access Certification Details
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCert(null)}
                style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', padding: 0 }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                  Certification Name
                </label>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F172A', marginTop: '0.2rem' }}>
                  {selectedCert.certificationName || '—'}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                    Type
                  </label>
                  <div style={{ fontSize: '0.95rem', color: '#334155', marginTop: '0.2rem' }}>
                    {selectedCert.type || 'Standard'}
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                    Status
                  </label>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', marginTop: '0.2rem' }}>
                    {selectedCert.status || 'Active'}
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                    Due Date
                  </label>
                  <div style={{ fontSize: '0.95rem', color: '#334155', marginTop: '0.2rem' }}>
                    {formatDueDate(selectedCert.dueDate)}
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                    Creation Date
                  </label>
                  <div style={{ fontSize: '0.95rem', color: '#334155', marginTop: '0.2rem' }}>
                    {formatCreationDate(selectedCert.creationDate)}
                  </div>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                  Certification Completion
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.4rem' }}>
                  <div style={{ flex: 1, height: '8px', backgroundColor: '#E2E8F0', borderRadius: '9999px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(Math.max(getPercentValue(selectedCert.certificationPercentComplete), 0), 100)}%`,
                        height: '100%',
                        backgroundColor: '#2563EB',
                        borderRadius: '9999px'
                      }}
                    />
                  </div>
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0F172A' }}>
                    {getPercentValue(selectedCert.certificationPercentComplete)}%
                  </span>
                </div>
              </div>
            </div>

            <div
              style={{
                padding: '1rem 1.5rem',
                borderTop: '1px solid #E2E8F0',
                backgroundColor: '#F8FAFC',
                display: 'flex',
                justifyContent: 'flex-end'
              }}
            >
              <button
                type="button"
                onClick={() => setSelectedCert(null)}
                style={{
                  padding: '0.5rem 1.25rem',
                  backgroundColor: '#1E293B',
                  color: '#FFFFFF',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '0.86rem',
                  border: 'none',
                  cursor: 'pointer'
                }}
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
