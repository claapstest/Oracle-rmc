import React, { useState, useMemo } from 'react';
import { ArrowRight, Search } from 'lucide-react';

export interface TableColumnSchema {
  key: string;
  header: string;
  width: string;
  align?: 'left' | 'center' | 'right';
  render?: (row: any, index: number, helpers: {
    onInvestigate: (type: 'role' | 'user', id: string, name: string, initialTab?: string) => void;
    onInspectRole: (roleName: string) => void;
    onNavigatePage?: (pageId: string, filter?: string) => void;
  }) => React.ReactNode;
}

export const StatusBadge = React.memo(function StatusBadge({ active }: { active?: boolean }) {
  const isActive = active !== false;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.15rem 0.5rem',
        borderRadius: '9999px',
        fontSize: '0.72rem',
        fontWeight: 600,
        backgroundColor: isActive ? '#ECFDF5' : '#F1F5F9',
        color: isActive ? '#059669' : '#64748B',
        border: `1px solid ${isActive ? '#A7F3D0' : '#CBD5E1'}`,
        lineHeight: 1.3
      }}
    >
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
});

export const RiskBadge = React.memo(function RiskBadge({ level }: { level?: string }) {
  const norm = (level || 'LOW').toUpperCase();
  let bg = '#ECFDF5';
  let color = '#059669';
  let border = '#A7F3D0';

  if (norm === 'CRITICAL') {
    bg = '#7F1D1D';
    color = '#FFFFFF';
    border = '#991B1B';
  } else if (norm === 'HIGH') {
    bg = '#FEF2F2';
    color = '#DC2626';
    border = '#FECACA';
  } else if (norm === 'MEDIUM') {
    bg = '#FFFBEB';
    color = '#D97706';
    border = '#FDE68A';
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.15rem 0.5rem',
        borderRadius: '9999px',
        fontSize: '0.7rem',
        fontWeight: 700,
        backgroundColor: bg,
        color: color,
        border: `1px solid ${border}`,
        letterSpacing: '0.04em',
        lineHeight: 1.3
      }}
    >
      {norm}
    </span>
  );
});

function getTableColumns(
  tableType: string,
  rawColumns: string[] = [],
  rows: any[] = []
): TableColumnSchema[] {
  if (tableType === 'users') {
    return [
      {
        key: 'displayName',
        header: 'DISPLAY NAME',
        width: '24%',
        align: 'left',
        render: (row) => (
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {row.displayName || row.name || '—'}
          </span>
        )
      },
      {
        key: 'userName',
        header: 'USERNAME',
        width: '20%',
        align: 'left',
        render: (row) => (
          <code style={{ 
            fontSize: '0.78rem', 
            backgroundColor: '#F1F5F9', 
            color: '#0F172A',
            padding: '0.15rem 0.4rem', 
            borderRadius: '4px',
            border: '1px solid #E2E8F0'
          }}>
            {row.userName || row.username || '—'}
          </code>
        )
      },
      {
        key: 'status',
        header: 'STATUS',
        width: '12%',
        align: 'center',
        render: (row) => <StatusBadge active={row.active} />
      },
      {
        key: 'assignedRoles',
        header: 'ASSIGNED ROLES',
        width: '14%',
        align: 'center',
        render: (row) => (
          <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
            {row.roleCount !== undefined ? row.roleCount : (Array.isArray(row.roles) ? row.roles.length : (row.assignedRoles ? row.assignedRoles.length : 0))}
          </span>
        )
      },
      {
        key: 'riskLevel',
        header: 'RISK LEVEL',
        width: '12%',
        align: 'center',
        render: (row) => <RiskBadge level={row.riskLevel} />
      },
      {
        key: 'actions',
        header: 'ACTIONS',
        width: '18%',
        align: 'left',
        render: (row, _idx, { onInvestigate, onNavigatePage }) => (
          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            <button 
              onClick={() => onInvestigate('user', row.userName || row.id, row.displayName || row.userName)}
              className="btn btn-secondary" 
              style={{ 
                padding: '0.2rem 0.55rem', 
                fontSize: '0.72rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                color: 'var(--accent-blue)',
                borderColor: 'rgba(53, 99, 233, 0.3)',
                backgroundColor: 'rgba(53, 99, 233, 0.05)',
                borderRadius: '4px',
                whiteSpace: 'nowrap'
              }}
              title={`Inspect ${row.displayName || row.userName}`}
            >
              <span>Inspect</span>
              <ArrowRight size={11} />
            </button>
            <button
              onClick={() => {
                if (onNavigatePage) {
                  onNavigatePage('users', row.userName || row.displayName);
                } else {
                  onInvestigate('user', row.userName || row.id, row.displayName || row.userName);
                }
              }}
              className="btn btn-secondary"
              style={{ 
                padding: '0.2rem 0.55rem', 
                fontSize: '0.72rem',
                fontWeight: 500,
                borderRadius: '4px',
                whiteSpace: 'nowrap'
              }}
              title="Explore in Users Catalog"
            >
              Explore
            </button>
          </div>
        )
      }
    ];
  }

  if (tableType === 'roles') {
    return [
      {
        key: 'displayName',
        header: 'ROLE NAME',
        width: '32%',
        align: 'left',
        render: (row) => (
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {row.displayName || row.roleName || '—'}
          </span>
        )
      },
      {
        key: 'roleCode',
        header: 'ROLE CODE',
        width: '26%',
        align: 'left',
        render: (row) => (
          <code style={{ 
            fontSize: '0.78rem', 
            backgroundColor: '#F1F5F9', 
            color: '#0F172A',
            padding: '0.15rem 0.4rem', 
            borderRadius: '4px',
            border: '1px solid #E2E8F0'
          }}>
            {row.roleCode || row.code || '—'}
          </code>
        )
      },
      {
        key: 'category',
        header: 'CATEGORY',
        width: '18%',
        align: 'center',
        render: (row) => {
          let badgeClass = 'badge-blue';
          if (row.category === 'Duty') badgeClass = 'badge-gold';
          else if (row.category === 'Data') badgeClass = 'badge-active';
          else if (row.category === 'Abstract') badgeClass = 'badge-inactive';
          return (
            <span className={`badge ${badgeClass}`} style={{ fontSize: '0.7rem' }}>
              {row.category || 'Role'}
            </span>
          );
        }
      },
      {
        key: 'actions',
        header: 'ACTIONS',
        width: '24%',
        align: 'left',
        render: (row, _idx, { onInvestigate, onInspectRole }) => (
          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            <button 
              onClick={() => onInvestigate('role', row.roleCode || row.id, row.displayName || row.roleCode)}
              className="btn btn-secondary" 
              style={{ 
                padding: '0.2rem 0.55rem', 
                fontSize: '0.72rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                color: 'var(--accent-blue)',
                borderColor: 'rgba(53, 99, 233, 0.3)',
                backgroundColor: 'rgba(53, 99, 233, 0.05)',
                borderRadius: '4px',
                whiteSpace: 'nowrap'
              }}
            >
              <span>Inspect</span>
              <ArrowRight size={11} />
            </button>
            <button 
              onClick={() => onInspectRole(row.displayName || row.roleCode)}
              className="btn btn-secondary" 
              style={{ 
                padding: '0.2rem 0.5rem', 
                fontSize: '0.72rem',
                fontWeight: 500,
                borderRadius: '4px',
                whiteSpace: 'nowrap'
              }}
              title="Brief privileges for this role"
            >
              Privileges
            </button>
          </div>
        )
      }
    ];
  }

  if (tableType === 'roles_by_privilege') {
    return [
      {
        key: 'displayName',
        header: 'ROLE NAME',
        width: '32%',
        align: 'left',
        render: (row) => (
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {row.displayName || row.roleName || '—'}
          </span>
        )
      },
      {
        key: 'roleType',
        header: 'ROLE TYPE',
        width: '20%',
        align: 'center',
        render: (row) => {
          const typeStr = (row.roleType || row.category || 'Job').toUpperCase();
          let badgeClass = 'badge-blue';
          let label = `${row.roleType || row.category || 'Job'} Role`;
          if (typeStr.includes('DUTY')) {
            badgeClass = 'badge-gold';
            label = 'Duty Role';
          } else if (typeStr.includes('DATA')) {
            badgeClass = 'badge-active';
            label = 'Data Role';
          } else if (typeStr.includes('ABSTRACT')) {
            badgeClass = 'badge-inactive';
            label = 'Abstract Role';
          } else if (typeStr.includes('GRC')) {
            badgeClass = 'badge-red';
            label = 'GRC Role';
          } else if (typeStr.includes('JOB')) {
            badgeClass = 'badge-blue';
            label = 'Job Role';
          }
          return (
            <span className={`badge ${badgeClass}`} style={{ fontSize: '0.72rem', fontWeight: 600 }}>
              {label}
            </span>
          );
        }
      },
      {
        key: 'roleCode',
        header: 'ROLE CODE',
        width: '28%',
        align: 'left',
        render: (row) => (
          <code style={{ 
            fontSize: '0.78rem', 
            backgroundColor: '#F1F5F9', 
            color: '#0F172A',
            padding: '0.15rem 0.4rem', 
            borderRadius: '4px',
            border: '1px solid #E2E8F0'
          }}>
            {row.roleCode || row.code || '—'}
          </code>
        )
      },
      {
        key: 'investigation',
        header: 'INVESTIGATION',
        width: '20%',
        align: 'left',
        render: (row, _idx, { onInvestigate }) => (
          <button 
            onClick={() => onInvestigate('role', row.roleCode || row.id, row.displayName || row.roleName || row.roleCode)}
            className="btn btn-secondary" 
            style={{ 
              padding: '0.2rem 0.65rem', 
              fontSize: '0.74rem',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              color: 'var(--accent-blue)',
              borderColor: 'rgba(53, 99, 233, 0.3)',
              backgroundColor: 'rgba(53, 99, 233, 0.05)',
              borderRadius: '4px',
              whiteSpace: 'nowrap',
              cursor: 'pointer'
            }}
          >
            <span>Inspect</span>
            <ArrowRight size={12} />
          </button>
        )
      }
    ];
  }

  if (tableType === 'audit') {
    return [
      {
        key: 'timestamp',
        header: 'TIMESTAMP',
        width: '18%',
        align: 'left',
        render: (row) => <code style={{ fontSize: '0.75rem' }}>{row.timestamp}</code>
      },
      {
        key: 'username',
        header: 'USERNAME',
        width: '16%',
        align: 'left',
        render: (row) => <span style={{ fontWeight: 600 }}>{row.username}</span>
      },
      {
        key: 'businessObject',
        header: 'BUSINESS OBJECT',
        width: '22%',
        align: 'left',
        render: (row) => <code>{row.businessObject}</code>
      },
      {
        key: 'action',
        header: 'ACTION',
        width: '14%',
        align: 'center',
        render: (row) => <span className="badge badge-blue">{row.action}</span>
      },
      {
        key: 'details',
        header: 'DETAILS',
        width: '30%',
        align: 'left',
        render: (row) => <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{row.details}</span>
      }
    ];
  }

  if (tableType === 'privileges') {
    return [
      {
        key: 'name',
        header: 'PRIVILEGE NAME',
        width: '35%',
        align: 'left',
        render: (row) => <span style={{ fontWeight: 600 }}>{row.name}</span>
      },
      {
        key: 'code',
        header: 'PRIVILEGE CODE',
        width: '35%',
        align: 'left',
        render: (row) => <code>{row.code}</code>
      },
      {
        key: 'inheritedFrom',
        header: 'INHERITED FROM',
        width: '30%',
        align: 'left',
        render: (row) => <span style={{ color: 'var(--text-secondary)' }}>{row.inheritedFrom || 'Direct'}</span>
      }
    ];
  }

  if (tableType === 'risk') {
    return [
      {
        key: 'ruleName',
        header: 'RISK RULE',
        width: '30%',
        align: 'left',
        render: (row) => <span style={{ fontWeight: 600 }}>{row.ruleName || row.name || 'Risk Rule'}</span>
      },
      {
        key: 'entity',
        header: 'TARGET ENTITY',
        width: '24%',
        align: 'left',
        render: (row) => <code>{row.entity || row.userName || row.roleCode}</code>
      },
      {
        key: 'severity',
        header: 'SEVERITY',
        width: '16%',
        align: 'center',
        render: (row) => <RiskBadge level={row.severity || row.riskLevel} />
      },
      {
        key: 'status',
        header: 'STATUS',
        width: '12%',
        align: 'center',
        render: (row) => <StatusBadge active={row.active !== false} />
      },
      {
        key: 'actions',
        header: 'ACTIONS',
        width: '18%',
        align: 'left',
        render: (row, _idx, { onInvestigate }) => (
          <button 
            onClick={() => onInvestigate('user', row.userName || row.entity, row.entity)}
            className="btn btn-secondary" 
            style={{ 
              padding: '0.2rem 0.55rem', 
              fontSize: '0.72rem',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              color: 'var(--accent-blue)',
              borderColor: 'rgba(53, 99, 233, 0.3)',
              backgroundColor: 'rgba(53, 99, 233, 0.05)',
              borderRadius: '4px'
            }}
          >
            <span>Inspect</span>
            <ArrowRight size={11} />
          </button>
        )
      }
    ];
  }

  const cols = rawColumns.length > 0 
    ? rawColumns 
    : (rows.length > 0 ? Object.keys(rows[0]).filter(k => k !== 'id' && !k.startsWith('_')) : ['Attribute', 'Value']);
  
  const pct = Math.floor(100 / cols.length) + '%';
  return cols.map((colName) => ({
    key: colName,
    header: colName.toUpperCase(),
    width: pct,
    align: 'left',
    render: (row) => {
      const foundKey = Object.keys(row).find(k => k.toLowerCase() === colName.toLowerCase().replace(/\s+/g, '')) || colName;
      const val = row[foundKey] ?? row[colName];
      if (typeof val === 'boolean') {
        return <StatusBadge active={val} />;
      }
      return <span>{String(val ?? '—')}</span>;
    }
  }));
}

export const PaginatedTable = React.memo(function PaginatedTable({
  table,
  metadata,
  onNavigatePage,
  onInvestigate,
  onInspectRole,
  initialPage = 1,
  initialPageSize = 10,
  initialFilterText = '',
  onStateChange
}: {
  table: { type: string; columns: string[]; rows: any[] };
  metadata?: any;
  onNavigatePage?: (pageId: string, filter?: string) => void;
  onInvestigate: (type: 'role' | 'user', id: string, name: string, initialTab?: string) => void;
  onInspectRole: (roleName: string) => void;
  initialPage?: number;
  initialPageSize?: number;
  initialFilterText?: string;
  onStateChange?: (state: { currentPage: number; pageSize: number; filterText: string }) => void;
}) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [filterText, setFilterText] = useState(initialFilterText);

  React.useEffect(() => {
    if (initialPage !== undefined && initialPage !== currentPage) {
      setCurrentPage(initialPage);
    }
  }, [initialPage]);

  React.useEffect(() => {
    if (initialPageSize !== undefined && initialPageSize !== pageSize) {
      setPageSize(initialPageSize);
    }
  }, [initialPageSize]);

  React.useEffect(() => {
    if (initialFilterText !== undefined && initialFilterText !== filterText) {
      setFilterText(initialFilterText);
    }
  }, [initialFilterText]);

  const handlePageChange = (newPage: number | ((prev: number) => number)) => {
    setCurrentPage(prev => {
      const next = typeof newPage === 'function' ? newPage(prev) : newPage;
      onStateChange?.({ currentPage: next, pageSize, filterText });
      return next;
    });
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
    onStateChange?.({ currentPage: 1, pageSize: newSize, filterText });
  };

  const handleFilterTextChange = (newFilter: string) => {
    setFilterText(newFilter);
    setCurrentPage(1);
    onStateChange?.({ currentPage: 1, pageSize, filterText: newFilter });
  };

  const rows = table?.rows || [];
  const filteredRows = rows.filter((row: any) => {
    if (!filterText.trim()) return true;
    const term = filterText.toLowerCase();
    return Object.values(row).some(val => 
      String(val).toLowerCase().includes(term)
    );
  });

  const totalMatching = metadata?.matchingCount !== undefined ? Math.max(metadata.matchingCount, filteredRows.length) : filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (validCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredRows.length);
  const pageRows = filteredRows.slice(startIndex, endIndex);

  const columns = useMemo(() => {
    return getTableColumns(table.type, table.columns, rows);
  }, [table.type, table.columns, rows]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', margin: '0.35rem 0', width: '100%' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'flex-start', 
        flexWrap: 'wrap', 
        gap: '0.75rem', 
        padding: '0.2rem 0 0.4rem 0'
      }}>
        <div>
          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {totalMatching} {table.type === 'users' ? 'users match this query' : `${table.type || 'records'} match this query`}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
            Showing {filteredRows.length > 0 ? startIndex + 1 : 0}–{endIndex} of {filteredRows.length} · Page {validCurrentPage} of {totalPages}
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {rows.length > 5 && (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={13} style={{ position: 'absolute', left: '0.6rem', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                type="text"
                className="form-input"
                style={{ 
                  padding: '0.25rem 0.5rem 0.25rem 1.8rem', 
                  fontSize: '0.75rem', 
                  width: '150px', 
                  height: '30px',
                  borderRadius: '6px' 
                }}
                placeholder="Search rows..."
                value={filterText}
                onChange={(e) => handleFilterTextChange(e.target.value)}
              />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            <span>Per page:</span>
            <select
              className="form-select"
              style={{ 
                padding: '0.15rem 0.4rem', 
                fontSize: '0.75rem', 
                height: '30px', 
                borderRadius: '6px',
                borderColor: 'var(--border-color)',
                backgroundColor: '#FFFFFF'
              }}
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      </div>

      <div 
        className="table-container" 
        style={{ 
          margin: 0, 
          width: '100%', 
          overflowX: 'auto',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
        }}
      >
        <table 
          className="enterprise-table" 
          style={{ 
            width: '100%', 
            tableLayout: 'fixed',
            borderCollapse: 'collapse',
            fontSize: '0.85rem' 
          }}
        >
          <colgroup>
            {columns.map((col, idx) => (
              <col key={col.key || idx} style={{ width: col.width }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ backgroundColor: '#F1F5FB' }}>
              {columns.map((col, idx) => (
                <th 
                  key={col.key || idx} 
                  style={{ 
                    width: col.width,
                    textAlign: col.align || 'left',
                    backgroundColor: '#F1F5FB',
                    color: '#0F172A',
                    fontWeight: 700,
                    fontSize: '0.72rem',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    padding: '0.75rem 1rem',
                    borderBottom: '1px solid #E2E8F0',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                  No records match your filter.
                </td>
              </tr>
            ) : (
              pageRows.map((row: any, rIdx: number) => (
                <tr key={row.id || row.userName || row.roleCode || rIdx}>
                  {columns.map((col, cIdx) => (
                    <td 
                      key={col.key || cIdx} 
                      style={{ 
                        width: col.width,
                        textAlign: col.align || 'left',
                        padding: '0.75rem 1rem',
                        borderBottom: '1px solid var(--border-color)',
                        verticalAlign: 'middle'
                      }}
                    >
                      {col.render 
                        ? col.render(row, rIdx, { onInvestigate, onInspectRole, onNavigatePage }) 
                        : (row[col.key] !== undefined ? String(row[col.key]) : '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', fontSize: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ color: 'var(--text-secondary)' }}>
            Showing {filteredRows.length > 0 ? startIndex + 1 : 0}–{endIndex} of {filteredRows.length} (Page {validCurrentPage} of {totalPages})
          </div>
          <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
            <button
              onClick={() => handlePageChange(1)}
              disabled={validCurrentPage === 1}
              className="btn btn-secondary"
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', opacity: validCurrentPage === 1 ? 0.4 : 1, cursor: validCurrentPage === 1 ? 'not-allowed' : 'pointer' }}
              title="First Page"
            >
              First
            </button>
            <button
              onClick={() => handlePageChange(prev => Math.max(1, prev - 1))}
              disabled={validCurrentPage === 1}
              className="btn btn-secondary"
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', opacity: validCurrentPage === 1 ? 0.4 : 1, cursor: validCurrentPage === 1 ? 'not-allowed' : 'pointer' }}
              title="Previous Page"
            >
              Prev
            </button>
            
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum = validCurrentPage;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (validCurrentPage <= 3) {
                pageNum = i + 1;
              } else if (validCurrentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = validCurrentPage - 2 + i;
              }
              if (pageNum < 1 || pageNum > totalPages) return null;
              return (
                <button
                  key={pageNum}
                  onClick={() => handlePageChange(pageNum)}
                  className={`btn ${validCurrentPage === pageNum ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ 
                    padding: '0.2rem 0.5rem', 
                    fontSize: '0.75rem',
                    minWidth: '28px',
                    backgroundColor: validCurrentPage === pageNum ? 'var(--accent-blue)' : '',
                    color: validCurrentPage === pageNum ? '#ffffff' : '',
                    fontWeight: validCurrentPage === pageNum ? 700 : 500
                  }}
                >
                  {pageNum}
                </button>
              );
            })}

            <button
              onClick={() => handlePageChange(prev => Math.min(totalPages, prev + 1))}
              disabled={validCurrentPage === totalPages}
              className="btn btn-secondary"
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', opacity: validCurrentPage === totalPages ? 0.4 : 1, cursor: validCurrentPage === totalPages ? 'not-allowed' : 'pointer' }}
              title="Next Page"
            >
              Next
            </button>
            <button
              onClick={() => handlePageChange(totalPages)}
              disabled={validCurrentPage === totalPages}
              className="btn btn-secondary"
              style={{ padding: '0.2rem 0.45rem', fontSize: '0.75rem', opacity: validCurrentPage === totalPages ? 0.4 : 1, cursor: validCurrentPage === totalPages ? 'not-allowed' : 'pointer' }}
              title="Last Page"
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export const AssignedRolesList = React.memo(function AssignedRolesList({ 
  roles, 
  onInspectRole,
  onInvestigate,
  initialPage = 1,
  onPageChange
}: { 
  roles: any[]; 
  onInspectRole?: (roleName: string) => void;
  onInvestigate?: (type: 'role' | 'user', id: string, name: string) => void;
  initialPage?: number;
  onPageChange?: (page: number) => void;
}) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(roles.length / pageSize));
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (validCurrentPage - 1) * pageSize;
  const pageRoles = roles.slice(startIndex, startIndex + pageSize);

  React.useEffect(() => {
    if (initialPage !== undefined && initialPage !== currentPage) {
      setCurrentPage(initialPage);
    }
  }, [initialPage]);

  const handlePageChange = (newPage: number | ((prev: number) => number)) => {
    setCurrentPage(prev => {
      const next = typeof newPage === 'function' ? newPage(prev) : newPage;
      onPageChange?.(next);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem', width: '100%' }}>
        {pageRoles.map((role: any, idx: number) => {
          const rName = role.roleName || (typeof role === 'string' ? role : 'Unknown Role');
          const rCode = role.roleCode || (typeof role === 'string' ? role : '');
          const isCustom = role.isCustom || (typeof role === 'string' && (role.startsWith('CLAAPS_') || role.startsWith('CUSTOM_')));

          const isHighPriv = rName.toLowerCase().includes('security') || 
                             rName.toLowerCase().includes('administrator') || 
                             rName.toLowerCase().includes('manager') ||
                             rName.toLowerCase().includes('analyst') ||
                             rCode.toLowerCase().includes('it_security_manager') ||
                             rCode.toLowerCase().includes('security_administrator') ||
                             rCode.toLowerCase().includes('admin');

          return (
            <div key={idx} className="glass-panel animate-fade-in" style={{
              padding: '0.85rem 1rem',
              fontSize: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
              borderLeft: `4px solid ${isHighPriv ? 'var(--accent-red)' : 'var(--accent-gold)'}`,
              borderRadius: 'var(--radius-md)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{rName}</span>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  {role.category && (
                    <span className="badge badge-blue" style={{ fontSize: '0.65rem' }}>
                      {role.category}
                    </span>
                  )}
                  {isHighPriv && (
                    <span className="badge badge-inactive" style={{ fontSize: '0.65rem' }}>
                      High Privilege
                    </span>
                  )}
                </div>
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
                    if (onInvestigate) {
                      onInvestigate('role', rCode || rName, rName);
                    } else if (onInspectRole) {
                      onInspectRole(rCode || rName);
                    }
                  }}
                  className="btn btn-secondary"
                  style={{ 
                    padding: '0.25rem 0.6rem', 
                    fontSize: '0.75rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.25rem',
                    color: 'var(--accent-blue)',
                    borderColor: 'rgba(53, 99, 233, 0.25)',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  <span>Inspect Role</span>
                  <ArrowRight size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', fontSize: '0.75rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            Showing {startIndex + 1}–{Math.min(startIndex + pageSize, roles.length)} of {roles.length} roles (Page {validCurrentPage} of {totalPages})
          </span>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              onClick={() => handlePageChange(p => Math.max(1, p - 1))}
              disabled={validCurrentPage === 1}
              className="btn btn-secondary"
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', opacity: validCurrentPage === 1 ? 0.4 : 1, cursor: validCurrentPage === 1 ? 'not-allowed' : 'pointer' }}
            >
              Previous
            </button>
            <button
              onClick={() => handlePageChange(p => Math.min(totalPages, p + 1))}
              disabled={validCurrentPage === totalPages}
              className="btn btn-secondary"
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', opacity: validCurrentPage === totalPages ? 0.4 : 1, cursor: validCurrentPage === totalPages ? 'not-allowed' : 'pointer' }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
