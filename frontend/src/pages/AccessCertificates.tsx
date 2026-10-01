import React, { useEffect, useState, useMemo } from 'react';
import {
  Award,
  RefreshCw,
  Search,
  Download,
  Eye,
  Info,
  AlertCircle,
  ArrowLeft,
  Users,
  ShieldCheck,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  FileSpreadsheet
} from 'lucide-react';
import { api } from '../services/api.js';

interface AccessCertificatesProps {
  environmentMode?: 'DEMO' | 'ORACLE_FUSION';
}

// Certifier worksheet columns (23). Each column lists candidate row-field keys so
// both camelCase and UPPER_SNAKE BIP payload shapes resolve; missing fields render '—'.
interface WorksheetColumn {
  header: string;
  keys: string[];
  icon?: 'role';
}

export const WORKSHEET_COLUMNS: WorksheetColumn[] = [
  { header: 'ROLE NAME', keys: ['roleName', 'ROLE_NAME'], icon: 'role' },
  { header: 'USER NAME', keys: ['userName', 'ownerName', 'USER_NAME'] },
  { header: 'DIRECT MANAGER', keys: ['directManager', 'DIRECT_MANAGER'] },
  { header: 'ACTION', keys: ['action', 'certificationAction', 'ACTION'] },
  { header: 'ATTACHMENTS', keys: ['attachments', 'attachmentCount', 'ATTACHMENTS'] },
  { header: 'COMMENTS', keys: ['comments', 'commentCount', 'COMMENTS'] },
  { header: 'FOLLOW-UP', keys: ['followUp', 'FOLLOW_UP'] },
  { header: 'BUSINESS UNIT', keys: ['businessUnit', 'userBusinessUnit', 'BUSINESS_UNIT'] },
  { header: 'CREATED BY', keys: ['createdBy', 'CREATED_BY'] },
  { header: 'CREATION DATE', keys: ['creationDate', 'CREATION_DATE'] },
  { header: 'FOLLOW-UP STATUS', keys: ['followUpStatus', 'FOLLOW_UP_STATUS'] },
  { header: 'JOB NAME', keys: ['jobName', 'JOB_NAME'] },
  { header: 'LAST DECISION BY', keys: ['lastDecisionBy', 'LAST_DECISION_BY'] },
  { header: 'LAST DECISION DATE', keys: ['lastDecisionDate', 'LAST_DECISION_DATE'] },
  { header: 'LAST UPDATED DATE', keys: ['lastUpdatedDate', 'LAST_UPDATED_DATE'] },
  { header: 'LOCATION', keys: ['location', 'LOCATION'] },
  { header: 'PENDING SUBMISSION', keys: ['pendingSubmission', 'PENDING_SUBMISSION'] },
  { header: 'POSITION NAME', keys: ['positionName', 'POSITION_NAME'] },
  { header: 'USER-ROLE BUSINESS UNIT', keys: ['userRoleBusinessUnit', 'USER_ROLE_BUSINESS_UNIT'] },
  { header: 'ROLE CODE', keys: ['roleCode', 'ROLE_CODE'] },
  { header: 'ROLE DESCRIPTION', keys: ['roleDescription', 'ROLE_DESCRIPTION'] },
  { header: 'SELF-CERTIFIED', keys: ['selfCertified', 'SELF_CERTIFIED'] },
  { header: 'UPDATED BY', keys: ['updatedBy', 'UPDATED_BY'] }
];

export function wsVal(row: any, keys: string[]): string {
  for (const k of keys) {
    const v = row?.[k];
    if (v !== undefined && v !== null) {
      const s = String(v).trim();
      if (s !== '' && s.toLowerCase() !== 'null') return s;
    }
  }
  return '';
}

export default function AccessCertificates({ environmentMode }: AccessCertificatesProps) {
  // Main Certification List State
  const [certifications, setCertifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [lastExecuted, setLastExecuted] = useState<string>('');
  const [activeReportPath, setActiveReportPath] = useState<string>('/Custom/Claaps Access Certification Review Report.xdo');

  // Drill-Down / Certifier Worksheet State
  const [drillDownCertId, setDrillDownCertId] = useState<string | null>(null);
  const [drillDownSummary, setDrillDownSummary] = useState<any | null>(null);
  const [worksheetRows, setWorksheetRows] = useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [worksheetSearchTerm, setWorksheetSearchTerm] = useState('');
  const [worksheetPageSize, setWorksheetPageSize] = useState(10);
  const [worksheetCurrentPage, setWorksheetCurrentPage] = useState(1);

  const fetchCertifications = async (isManualRefresh = false) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getAccessCertifications(isManualRefresh);
      if (res && res.success) {
        setCertifications(Array.isArray(res.data) ? res.data : []);
        if (res.reportPath) {
          setActiveReportPath(res.reportPath);
        }
      } else {
        setCertifications([]);
        setError(res?.message || 'Unable to retrieve Access Certification data from Oracle Fusion.');
      }
    } catch (err: any) {
      console.error('[AccessCertificates UI] Failed to load certifications:', err);
      const errMsg =
        err?.response?.data?.message || err?.message || 'Unable to retrieve Access Certification data from Oracle Fusion.';
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
      const id = String(item.certificationId || '').toLowerCase();
      const name = String(item.certificationName || '').toLowerCase();
      const status = String(item.status || '').toLowerCase();
      const type = String(item.type || '').toLowerCase();
      const due = String(item.dueDate || '').toLowerCase();
      const creation = String(item.creationDate || '').toLowerCase();
      return (
        id.includes(term) ||
        name.includes(term) ||
        status.includes(term) ||
        type.includes(term) ||
        due.includes(term) ||
        creation.includes(term)
      );
    });
  }, [certifications, searchTerm]);

  // Pagination calculation for main list
  const totalRecords = filteredCertifications.length;
  const totalPages = Math.ceil(totalRecords / pageSize) || 1;
  const paginatedCertifications = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCertifications.slice(start, start + pageSize);
  }, [filteredCertifications, currentPage, pageSize]);

  // Drill-Down: Open worksheet for selected certification
  const openCertificationDrillDown = async (cert: any) => {
    const certId = String(cert?.certificationId ?? cert?.id ?? '').trim();
    if (!certId) {
      setDetailsError('Certification ID is missing.');
      return;
    }

    setDrillDownCertId(certId);
    setDrillDownSummary(cert);
    setLoadingDetails(true);
    setDetailsError('');
    setWorksheetRows([]);
    setWorksheetSearchTerm('');
    setWorksheetCurrentPage(1);

    try {
      const res = await api.getAccessCertificationDetails(certId);
      if (res && res.success) {
        setWorksheetRows(Array.isArray(res.data) ? res.data : []);
      } else {
        setDetailsError(res?.message || 'Unable to load certification details.');
      }
    } catch (err: any) {
      console.error('[AccessCertificates UI] Error loading drill-down:', err);
      const errMsg =
        err?.response?.data?.message || err?.message || 'Unable to retrieve Access Certification details.';
      setDetailsError(errMsg);
    } finally {
      setLoadingDetails(false);
    }
  };

  const backToList = () => {
    setDrillDownCertId(null);
    setDrillDownSummary(null);
    setWorksheetRows([]);
    setDetailsError('');
    setWorksheetSearchTerm('');
  };

  // Filtered worksheet rows based on search term (matches across all 23 columns)
  const filteredWorksheetRows = useMemo(() => {
    if (!worksheetSearchTerm.trim()) return worksheetRows;
    const term = worksheetSearchTerm.toLowerCase().trim();
    return worksheetRows.filter((r) => {
      return WORKSHEET_COLUMNS.some((c) => wsVal(r, c.keys).toLowerCase().includes(term));
    });
  }, [worksheetRows, worksheetSearchTerm]);

  // Pagination for worksheet rows
  const totalWorksheetRecords = filteredWorksheetRows.length;
  const totalWorksheetPages = Math.ceil(totalWorksheetRecords / worksheetPageSize) || 1;
  const paginatedWorksheetRows = useMemo(() => {
    const start = (worksheetCurrentPage - 1) * worksheetPageSize;
    return filteredWorksheetRows.slice(start, start + worksheetPageSize);
  }, [filteredWorksheetRows, worksheetCurrentPage, worksheetPageSize]);

  // Export functions
  const exportToCsv = () => {
    if (filteredCertifications.length === 0) return;
    const headers = [
      '#',
      'Certification ID',
      'Certification Name',
      'Type',
      'Status',
      'Certification % Complete',
      'Due Date',
      'Creation Date'
    ];
    const rows = filteredCertifications.map((item, idx) => [
      idx + 1,
      `"${String(item.certificationId ?? item.id ?? '').replace(/"/g, '""')}"`,
      `"${String(item.name ?? item.certificationName ?? '').replace(/"/g, '""')}"`,
      `"${String(item.type || '').replace(/"/g, '""')}"`,
      `"${String(item.status || '').replace(/"/g, '""')}"`,
      `"${String(item.certificationPercentComplete ?? '0%').replace(/"/g, '""')}"`,
      `"${String(item.dueDate || '').replace(/"/g, '""')}"`,
      `"${String(item.creationDate || '').replace(/"/g, '""')}"`
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Access_Certifications_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportWorksheetToCsv = () => {
    if (filteredWorksheetRows.length === 0) return;
    const headers = ['#', ...WORKSHEET_COLUMNS.map((c) => c.header)];
    const rows = filteredWorksheetRows.map((r, idx) => [
      idx + 1,
      ...WORKSHEET_COLUMNS.map((c) => `"${wsVal(r, c.keys).replace(/"/g, '""')}"`)
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `Certifier_Worksheet_${drillDownCertId}_${new Date().toISOString().split('T')[0]}.csv`
    );
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

  // =========================================================================
  // VIEW 2: CERTIFICATION DRILL-DOWN / CERTIFIER WORKSHEET VIEW
  // =========================================================================
  if (drillDownCertId !== null) {
    const firstRow = worksheetRows[0] || {};
    const certName = firstRow.certificationName || drillDownSummary?.certificationName || 'Access Certification Details';
    const certStatus = firstRow.status || drillDownSummary?.status || 'Active';
    const certType = firstRow.type || drillDownSummary?.type || 'Standard';
    const certPct = getPercentValue(
      firstRow.completionPercent ?? drillDownSummary?.certificationPercentComplete ?? 0
    );
    const certDueDate = firstRow.dueDate || drillDownSummary?.dueDate;
    const certCreationDate = firstRow.creationDate || drillDownSummary?.creationDate;
    const certManager =
      firstRow.certifiedManager ||
      firstRow.certifierName ||
      firstRow.userManager ||
      drillDownSummary?.managerName ||
      drillDownSummary?.createdBy ||
      '—';

    return (
      <div style={{ padding: '1.75rem 2rem', maxWidth: '1600px', width: '100%', margin: '0 auto' }}>
        {/* Navigation Breadcrumb / Back Button */}
        <div style={{ marginBottom: '1.25rem' }}>
          <button
            type="button"
            onClick={backToList}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              backgroundColor: '#FFFFFF',
              border: '1px solid #CBD5E1',
              borderRadius: '8px',
              padding: '0.55rem 1.1rem',
              color: '#1E293B',
              fontSize: '0.86rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#F8FAFC';
              e.currentTarget.style.borderColor = '#94A3B8';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#FFFFFF';
              e.currentTarget.style.borderColor = '#CBD5E1';
            }}
          >
            <ArrowLeft size={16} style={{ color: '#2563EB' }} />
            <span>Back to Access Certificates</span>
          </button>
        </div>

        {/* Top Header Banner Matching VEYRA Style */}
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
            marginBottom: '1.25rem',
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
              <FileSpreadsheet size={30} style={{ color: '#ffffff' }} />
            </div>
            <div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'rgba(255, 255, 255, 0.85)',
                  marginBottom: '0.25rem'
                }}
              >
                <span>Access Certification Drill-Down</span>
                <span>•</span>
                <span>ID: {drillDownCertId}</span>
              </div>
              <h1
                style={{
                  fontSize: '1.75rem',
                  fontWeight: 800,
                  fontFamily: 'var(--font-header, sans-serif)',
                  margin: 0,
                  letterSpacing: '-0.02em',
                  color: '#ffffff'
                }}
              >
                {certName}
              </h1>
              <p style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: '0.92rem', margin: '0.35rem 0 0 0' }}>
                Oracle Fusion BI Publisher Certifier Worksheet &amp; User Access Details
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
                  backgroundColor: certStatus.toLowerCase() === 'active' ? '#10B981' : '#CBD5E1',
                  boxShadow: certStatus.toLowerCase() === 'active' ? '0 0 8px #10B981' : 'none'
                }}
              />
              <span>Status: {certStatus}</span>
            </div>

            <button
              type="button"
              onClick={() => openCertificationDrillDown(drillDownSummary || { certificationId: drillDownCertId })}
              disabled={loadingDetails}
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
                cursor: loadingDetails ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.26)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.16)';
              }}
            >
              <RefreshCw size={14} className={loadingDetails ? 'animate-spin' : ''} />
              <span>Refresh Worksheet</span>
            </button>
          </div>
        </div>

        {/* Integration Notification / Notice */}
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
              <strong>BIP Certifier Worksheet Source:</strong> Executed via ExternalReportWSSService with parameter{' '}
              <code style={{ background: 'rgba(37, 99, 235, 0.08)', padding: '0.15rem 0.35rem', borderRadius: '4px' }}>
                P_CERTIFICATION_ID = {drillDownCertId}
              </code>
              . Preserving all assigned user and role worksheet rows.
            </span>
          </div>
          <div style={{ color: '#64748B', fontSize: '0.82rem' }}>
            Rows Loaded:{' '}
            <strong style={{ color: '#1E293B' }}>{worksheetRows.length}</strong>
          </div>
        </div>

        {/* Error Banner if drill-down fetch failed */}
        {detailsError && (
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
              <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>Integration Error</div>
              <div>{detailsError}</div>
            </div>
            <button
              type="button"
              onClick={() => openCertificationDrillDown(drillDownSummary || { certificationId: drillDownCertId })}
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

        {/* SECTION 1: CERTIFICATION SUMMARY CARD */}
        <div
          className="animate-fade-in"
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: '14px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 4px 12px -2px rgba(15, 23, 42, 0.05)',
            padding: '1.75rem',
            marginBottom: '1.5rem',
            boxSizing: 'border-box'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
            <Award size={20} style={{ color: '#2563EB' }} />
            <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: '#0F172A' }}>
              Certification Details Summary
            </h2>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '1.25rem'
            }}
          >
            <div style={{ backgroundColor: '#F8FAFC', padding: '1rem', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
              <span style={{ fontSize: '0.76rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Certification Name
              </span>
              <div style={{ fontSize: '1.02rem', fontWeight: 700, color: '#0F172A', marginTop: '0.35rem' }}>
                {certName}
              </div>
            </div>

            <div style={{ backgroundColor: '#F8FAFC', padding: '1rem', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
              <span style={{ fontSize: '0.76rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Certification ID
              </span>
              <div style={{ fontSize: '1.02rem', fontWeight: 700, color: '#2563EB', marginTop: '0.35rem' }}>
                {drillDownCertId}
              </div>
            </div>

            <div style={{ backgroundColor: '#F8FAFC', padding: '1rem', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
              <span style={{ fontSize: '0.76rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Certifier / Certified Manager
              </span>
              <div style={{ fontSize: '1.02rem', fontWeight: 700, color: '#0F172A', marginTop: '0.35rem' }}>
                {certManager}
              </div>
            </div>

            <div style={{ backgroundColor: '#F8FAFC', padding: '1rem', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
              <span style={{ fontSize: '0.76rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Status &amp; Type
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem' }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '0.2rem 0.6rem',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    borderRadius: '9999px',
                    backgroundColor: certStatus.toLowerCase() === 'active' ? '#DCFCE7' : '#F1F5F9',
                    color: certStatus.toLowerCase() === 'active' ? '#166534' : '#475569'
                  }}
                >
                  {certStatus}
                </span>
                <span style={{ fontSize: '0.86rem', color: '#64748B' }}>({certType})</span>
              </div>
            </div>

            <div style={{ backgroundColor: '#F8FAFC', padding: '1rem', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
              <span style={{ fontSize: '0.76rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Certification % Complete
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.45rem' }}>
                <div style={{ flex: 1, height: '8px', backgroundColor: '#E2E8F0', borderRadius: '9999px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.min(Math.max(certPct, 0), 100)}%`,
                      height: '100%',
                      backgroundColor: certPct > 0 ? '#2563EB' : 'transparent',
                      borderRadius: '9999px'
                    }}
                  />
                </div>
                <span style={{ fontWeight: 800, fontSize: '0.94rem', color: '#0F172A' }}>{certPct}%</span>
              </div>
            </div>

            <div style={{ backgroundColor: '#F8FAFC', padding: '1rem', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
              <span style={{ fontSize: '0.76rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Due Date
              </span>
              <div style={{ fontSize: '0.98rem', fontWeight: 600, color: '#334155', marginTop: '0.35rem' }}>
                {formatDueDate(certDueDate)}
              </div>
            </div>

            <div style={{ backgroundColor: '#F8FAFC', padding: '1rem', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
              <span style={{ fontSize: '0.76rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Creation Date
              </span>
              <div style={{ fontSize: '0.98rem', fontWeight: 600, color: '#334155', marginTop: '0.35rem' }}>
                {formatCreationDate(certCreationDate)}
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 2: CERTIFIER WORKSHEET TABLE */}
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
          {/* Controls Bar */}
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
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Users size={18} style={{ color: '#2563EB' }} />
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: '#0F172A' }}>
                  Certifier Worksheet / User Access Details
                </h3>
              </div>
              <p style={{ color: '#64748B', fontSize: '0.84rem', margin: '0.25rem 0 0 0' }}>
                User access privileges and direct manager assignments belonging to this certification.
              </p>
            </div>

            {/* Right Search and Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              {/* Search Bar */}
              <div style={{ position: 'relative', minWidth: '280px' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: '0.85rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#94A3B8',
                    display: 'flex'
                  }}
                >
                  <Search size={15} />
                </span>
                <input
                  type="text"
                  placeholder="Filter by any column value..."
                  value={worksheetSearchTerm}
                  onChange={(e) => {
                    setWorksheetSearchTerm(e.target.value);
                    setWorksheetCurrentPage(1);
                  }}
                  style={{
                    width: '100%',
                    padding: '0.52rem 0.85rem 0.52rem 2.4rem',
                    fontSize: '0.84rem',
                    border: '1px solid #E2E8F0',
                    borderRadius: '8px',
                    backgroundColor: '#F8FAFC',
                    color: '#0F172A',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* Rows Per Page */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.84rem', color: '#64748B' }}>
                <span>Rows:</span>
                <select
                  value={worksheetPageSize}
                  onChange={(e) => {
                    setWorksheetPageSize(Number(e.target.value));
                    setWorksheetCurrentPage(1);
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

              {/* Export Button */}
              <button
                type="button"
                onClick={exportWorksheetToCsv}
                disabled={filteredWorksheetRows.length === 0}
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
                  cursor: filteredWorksheetRows.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: filteredWorksheetRows.length === 0 ? 0.6 : 1
                }}
              >
                <Download size={14} />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          {/* Counts */}
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
              <strong style={{ color: '#0F172A' }}>{totalWorksheetRecords}</strong> worksheet records returned
            </div>
            <div>
              Showing {totalWorksheetRecords > 0 ? (worksheetCurrentPage - 1) * worksheetPageSize + 1 : 0}-
              {Math.min(worksheetCurrentPage * worksheetPageSize, totalWorksheetRecords)} of {totalWorksheetRecords}
            </div>
          </div>

          {/* REQUIRED CERTIFIER WORKSHEET TABLE (23 COLUMNS) */}
          <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.86rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', color: '#475569' }}>
                  <th style={{ padding: '0.85rem 1rem', width: '45px', fontWeight: 700 }}>#</th>
                  {WORKSHEET_COLUMNS.map((c) => (
                    <th key={c.header} style={{ padding: '0.85rem 1rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{c.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingDetails ? (
                  <tr>
                    <td colSpan={WORKSHEET_COLUMNS.length + 1} style={{ padding: '3.5rem 1rem', textAlign: 'center', color: '#64748B' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                        <RefreshCw size={24} className="animate-spin" style={{ color: '#2563EB' }} />
                        <span style={{ fontWeight: 600 }}>Loading certification details...</span>
                      </div>
                    </td>
                  </tr>
                ) : paginatedWorksheetRows.length === 0 ? (
                  <tr>
                    <td colSpan={WORKSHEET_COLUMNS.length + 1} style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748B' }}>
                      <Users size={32} style={{ color: '#94A3B8', margin: '0 auto 0.75rem auto' }} />
                      <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#334155' }}>
                        No user access records found for this certification.
                      </div>
                      <div style={{ fontSize: '0.82rem', marginTop: '0.25rem', color: '#94A3B8' }}>
                        {worksheetSearchTerm
                          ? 'No worksheet records match your filter criteria.'
                          : 'Oracle BI Publisher returned 0 certifier worksheet rows for this Certification ID.'}
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedWorksheetRows.map((row, idx) => {
                    const rowNum = (worksheetCurrentPage - 1) * worksheetPageSize + idx + 1;
                    return (
                      <tr
                        key={`${row.certificationId}_${row.userName}_${idx}`}
                        style={{
                          borderBottom: '1px solid #F1F5F9',
                          transition: 'background-color 0.15s ease'
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#F8FAFC')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <td style={{ padding: '0.9rem 1rem', fontWeight: 700, color: '#64748B' }}>{rowNum}</td>
                        {WORKSHEET_COLUMNS.map((c) => {
                          const v = wsVal(row, c.keys) || '—';
                          return (
                            <td key={c.header} style={{ padding: '0.9rem 1rem', color: '#334155', whiteSpace: 'nowrap' }}>
                              {c.icon === 'role' ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  <ShieldCheck size={15} style={{ color: '#2563EB', flexShrink: 0 }} />
                                  <span style={{ fontWeight: 700, color: '#1E293B' }}>{v}</span>
                                </div>
                              ) : (
                                <span>{v}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Worksheet Pagination Controls */}
          {totalWorksheetPages > 1 && (
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
                Page {worksheetCurrentPage} of {totalWorksheetPages}
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button
                  type="button"
                  onClick={() => setWorksheetCurrentPage((p) => Math.max(p - 1, 1))}
                  disabled={worksheetCurrentPage === 1}
                  style={{
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.8rem',
                    border: '1px solid #CBD5E1',
                    borderRadius: '6px',
                    backgroundColor: '#FFFFFF',
                    cursor: worksheetCurrentPage === 1 ? 'not-allowed' : 'pointer',
                    opacity: worksheetCurrentPage === 1 ? 0.5 : 1
                  }}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setWorksheetCurrentPage((p) => Math.min(p + 1, totalWorksheetPages))}
                  disabled={worksheetCurrentPage === totalWorksheetPages}
                  style={{
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.8rem',
                    border: '1px solid #CBD5E1',
                    borderRadius: '6px',
                    backgroundColor: '#FFFFFF',
                    cursor: worksheetCurrentPage === totalWorksheetPages ? 'not-allowed' : 'pointer',
                    opacity: worksheetCurrentPage === totalWorksheetPages ? 0.5 : 1
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 1: MAIN ACCESS CERTIFICATION LIST VIEW
  // =========================================================================
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

      {/* On-Demand Report Notice Bar */}
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
              {activeReportPath}
            </code>
            ). Click <strong>View</strong> on any certification row to drill down into the live Certifier Worksheet.
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
              placeholder="Search by certification name, ID, status, type, or date..."
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

        {/* Counts Row */}
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

        {/* Table Container */}
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
                <th style={{ padding: '0.85rem 1rem', fontWeight: 700, textAlign: 'center', width: '110px' }}>ACTIONS</th>
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
                  const certId = String(item.certificationId ?? item.id ?? '').trim();
                  const certName = item.name || item.certificationName || '—';

                  return (
                    <tr
                      key={certId || certName ? `${certName}_${certId || idx}` : idx}
                      style={{
                        borderBottom: '1px solid #F1F5F9',
                        transition: 'background-color 0.15s ease'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#F8FAFC')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <td style={{ padding: '0.9rem 1rem', fontWeight: 700, color: '#334155' }}>{rowNum}</td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          <button
                            type="button"
                            onClick={() => openCertificationDrillDown(item)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              margin: 0,
                              textAlign: 'left',
                              fontWeight: 700,
                              fontSize: '0.88rem',
                              color: '#1D4ED8',
                              cursor: 'pointer'
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                          >
                            {certName}
                          </button>
                          {certId && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <button
                                type="button"
                                onClick={() => openCertificationDrillDown(item)}
                                title="Open certification drill-down"
                                style={{
                                  display: 'inline-block',
                                  padding: '0.1rem 0.45rem',
                                  fontSize: '0.72rem',
                                  fontWeight: 700,
                                  backgroundColor: '#EFF6FF',
                                  color: '#2563EB',
                                  borderRadius: '4px',
                                  border: '1px solid #DBEAFE',
                                  cursor: 'pointer'
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                                onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                              >
                                ID: {certId}
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '0.9rem 1rem', color: '#334155' }}>{item.type || 'Standard'}</td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '0.2rem 0.55rem',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            borderRadius: '9999px',
                            backgroundColor: String(item.status).toLowerCase() === 'active' ? '#DCFCE7' : '#F1F5F9',
                            color: String(item.status).toLowerCase() === 'active' ? '#166534' : '#475569'
                          }}
                        >
                          {item.status || 'Active'}
                        </span>
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
                          onClick={() => openCertificationDrillDown(item)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            padding: '0.38rem 0.85rem',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            borderRadius: '6px',
                            border: '1px solid #2563EB',
                            backgroundColor: '#2563EB',
                            color: '#FFFFFF',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#1D4ED8';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = '#2563EB';
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
    </div>
  );
}
