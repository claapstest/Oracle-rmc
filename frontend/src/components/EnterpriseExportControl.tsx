import React, { useState, useEffect } from 'react';
import { Download, X, Check, FileSpreadsheet, FileText, RefreshCw, Filter, CheckSquare, Square, RotateCcw } from 'lucide-react';
import { exportToExcel, exportToCsv, type ExcelColumn, type AppliedFilterInfo } from '../utils/excelExport';

export interface EnterpriseExportColumn<T = any> {
  key: string;
  label: string;
  defaultSelected?: boolean;
  getValue?: (item: T) => any;
}

export type ExportScope = 'PAGE' | 'FILTERED' | 'ALL';
export type ExportFormat = 'xlsx' | 'csv';

export interface EnterpriseExportControlProps<T = any> {
  filename: string;
  sheetName?: string;
  reportTitle?: string;
  dataSource?: string;
  entityName?: string;         // e.g. "Users", "Roles", "Controls", "Incidents"
  categoryLabel?: string;      // e.g. "Job Roles" for active category
  buttonText?: string;
  title?: string;
  disabled?: boolean;
  align?: 'left' | 'right';
  size?: 'sm' | 'md';

  // Data counts
  currentPageData: T[];
  filteredCount: number;
  totalCount: number;

  // Columns configuration
  availableColumns: EnterpriseExportColumn<T>[];

  // Applied filters list for display & metadata
  appliedFilters?: AppliedFilterInfo[];

  // Provider for fetching data according to chosen scope
  onFetchScopeData?: (scope: ExportScope) => Promise<T[]>;
}

export const EnterpriseExportControl: React.FC<EnterpriseExportControlProps> = ({
  filename,
  sheetName,
  reportTitle,
  dataSource,
  entityName = 'Records',
  categoryLabel,
  buttonText = 'Export',
  title = 'Export data to Excel (.xlsx) or CSV (.csv)',
  disabled = false,
  align = 'right',
  size = 'sm',
  currentPageData = [],
  filteredCount,
  totalCount,
  availableColumns = [],
  appliedFilters = [],
  onFetchScopeData
}) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedScope, setSelectedScope] = useState<ExportScope>('FILTERED');
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('xlsx');
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Effective counts
  const pageCount = currentPageData.length;
  const effectiveFilteredCount = filteredCount !== undefined ? filteredCount : pageCount;
  const effectiveTotalCount = totalCount !== undefined ? totalCount : effectiveFilteredCount;

  // Initialize selected columns to defaults on dialog open
  const initDefaultColumns = () => {
    const initial = new Set<string>();
    availableColumns.forEach(c => {
      if (c.defaultSelected !== false) {
        initial.add(c.key);
      }
    });
    // If none were marked default, select all
    if (initial.size === 0) {
      availableColumns.forEach(c => initial.add(c.key));
    }
    setSelectedColumnKeys(initial);
  };

  const handleOpenDialog = () => {
    if (disabled) return;
    setErrorMessage('');
    initDefaultColumns();
    // Default to FILTERED if filters are present and differ from total, else PAGE or ALL
    if (effectiveFilteredCount > 0 && effectiveFilteredCount !== effectiveTotalCount) {
      setSelectedScope('FILTERED');
    } else if (pageCount > 0 && pageCount === effectiveTotalCount) {
      setSelectedScope('PAGE');
    } else {
      setSelectedScope('FILTERED');
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    if (isExporting) return;
    setIsDialogOpen(false);
  };

  // Close on Escape key
  useEffect(() => {
    if (!isDialogOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCloseDialog();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDialogOpen, isExporting]);

  // Column toggle helpers
  const handleToggleColumn = (key: string) => {
    setSelectedColumnKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) { // Keep at least 1 column selected
          next.delete(key);
        }
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSelectAllColumns = () => {
    setSelectedColumnKeys(new Set(availableColumns.map(c => c.key)));
  };

  const handleClearAllColumns = () => {
    // Keep first column to avoid invalid empty exports
    if (availableColumns.length > 0) {
      setSelectedColumnKeys(new Set([availableColumns[0].key]));
    }
  };

  const handleResetColumns = () => {
    initDefaultColumns();
  };

  // Calculate target record count for selected scope
  const getTargetCount = (): number => {
    switch (selectedScope) {
      case 'PAGE':
        return pageCount;
      case 'FILTERED':
        return effectiveFilteredCount;
      case 'ALL':
        return effectiveTotalCount;
    }
  };

  const targetCount = getTargetCount();

  // Dynamic button label
  const getExportActionLabel = () => {
    const labelNoun = categoryLabel || entityName;
    if (isExporting) return 'Generating export...';
    if (targetCount === 1) return `Export 1 ${labelNoun.replace(/s$/, '')}`;
    return `Export ${targetCount.toLocaleString()} ${labelNoun}`;
  };

  // Perform Export Execution
  const handleExecuteExport = async () => {
    if (selectedColumnKeys.size === 0) {
      setErrorMessage('Please select at least one column to export.');
      return;
    }

    setErrorMessage('');
    setIsExporting(true);

    try {
      let exportDataset: any[] = [];

      if (selectedScope === 'PAGE') {
        exportDataset = currentPageData;
      } else if (onFetchScopeData) {
        // Fetch async dataset from caller (backend or cached data)
        exportDataset = await onFetchScopeData(selectedScope);
      } else {
        // Fallback to currentPageData if no provider provided
        exportDataset = currentPageData;
      }

      // Filter export columns based on user selection
      const activeColumns: ExcelColumn[] = availableColumns
        .filter(c => selectedColumnKeys.has(c.key))
        .map(c => ({
          key: c.key,
          label: c.label,
          getValue: c.getValue
        }));

      const exportOptions = {
        filename: `${filename}_${selectedScope.toLowerCase()}`,
        data: exportDataset,
        columns: activeColumns,
        sheetName: sheetName || entityName,
        reportTitle: reportTitle || `${entityName} Export`,
        dataSource: dataSource || 'Oracle Fusion Cloud',
        appliedFilters: selectedScope === 'PAGE' || selectedScope === 'ALL' ? [] : appliedFilters
      };

      let success = false;
      if (selectedFormat === 'xlsx') {
        success = exportToExcel(exportOptions);
      } else {
        success = exportToCsv(exportOptions);
      }

      if (success) {
        setIsDialogOpen(false);
      } else {
        setErrorMessage('Export failed. Please check browser permissions and try again.');
      }
    } catch (err: any) {
      console.error('[EnterpriseExportControl] Export failed:', err);
      setErrorMessage(err.message || 'An unexpected error occurred during export.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={handleOpenDialog}
        disabled={disabled || (effectiveTotalCount === 0 && !onFetchScopeData)}
        className="btn btn-secondary"
        title={title}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.45rem',
          fontSize: size === 'sm' ? '0.8rem' : '0.88rem',
          padding: size === 'sm' ? '0.4rem 0.85rem' : '0.55rem 1.1rem',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontWeight: 600,
          color: 'var(--text-primary)',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
          transition: 'all 0.15s ease'
        }}
      >
        <Download size={size === 'sm' ? 14 : 16} style={{ color: 'var(--accent-blue)' }} />
        <span>{buttonText}</span>
      </button>

      {/* Modal Dialog */}
      {isDialogOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem'
          }}
          onClick={handleCloseDialog}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              boxShadow: '0 20px 45px -10px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.08)',
              width: '100%',
              maxWidth: '560px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              animation: 'fadeScaleIn 0.18s ease-out'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1.1rem 1.5rem',
              borderBottom: '1px solid #E2E8F0',
              backgroundColor: '#F8FAFC'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: '#EFF6FF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#2563EB',
                  border: '1px solid #DBEAFE'
                }}>
                  <Download size={16} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#0F172A' }}>
                    Export {categoryLabel || entityName}
                  </h3>
                  <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                    Select scope, columns, and target file format
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCloseDialog}
                disabled={isExporting}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748B',
                  cursor: isExporting ? 'not-allowed' : 'pointer',
                  padding: '4px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              {errorMessage && (
                <div style={{
                  padding: '0.65rem 0.85rem',
                  backgroundColor: '#FEF2F2',
                  border: '1px solid #FCA5A5',
                  borderRadius: '6px',
                  color: '#991B1B',
                  fontSize: '0.8rem'
                }}>
                  {errorMessage}
                </div>
              )}

              {/* 1. Export Scope */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0F172A', marginBottom: '0.5rem' }}>
                  Export Scope
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  {/* Current Page */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.6rem 0.85rem',
                    borderRadius: '8px',
                    border: `1px solid ${selectedScope === 'PAGE' ? '#2563EB' : '#E2E8F0'}`,
                    backgroundColor: selectedScope === 'PAGE' ? '#EFF6FF' : '#FFFFFF',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <input
                        type="radio"
                        name="exportScope"
                        checked={selectedScope === 'PAGE'}
                        onChange={() => setSelectedScope('PAGE')}
                        style={{ accentColor: '#2563EB', cursor: 'pointer' }}
                      />
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F172A' }}>
                          Current Page
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#64748B' }}>
                          Only the rows currently visible on this page
                        </div>
                      </div>
                    </div>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#2563EB', backgroundColor: '#DBEAFE', padding: '2px 8px', borderRadius: '12px' }}>
                      {pageCount.toLocaleString()} records
                    </span>
                  </label>

                  {/* Current Filtered Results */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.6rem 0.85rem',
                    borderRadius: '8px',
                    border: `1px solid ${selectedScope === 'FILTERED' ? '#2563EB' : '#E2E8F0'}`,
                    backgroundColor: selectedScope === 'FILTERED' ? '#EFF6FF' : '#FFFFFF',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <input
                        type="radio"
                        name="exportScope"
                        checked={selectedScope === 'FILTERED'}
                        onChange={() => setSelectedScope('FILTERED')}
                        style={{ accentColor: '#2563EB', cursor: 'pointer' }}
                      />
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F172A' }}>
                          Current Filtered Results
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#64748B' }}>
                          All matching records across all pages respecting active filters
                        </div>
                      </div>
                    </div>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#2563EB', backgroundColor: '#DBEAFE', padding: '2px 8px', borderRadius: '12px' }}>
                      {effectiveFilteredCount.toLocaleString()} records
                    </span>
                  </label>

                  {/* All Results */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.6rem 0.85rem',
                    borderRadius: '8px',
                    border: `1px solid ${selectedScope === 'ALL' ? '#2563EB' : '#E2E8F0'}`,
                    backgroundColor: selectedScope === 'ALL' ? '#EFF6FF' : '#FFFFFF',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <input
                        type="radio"
                        name="exportScope"
                        checked={selectedScope === 'ALL'}
                        onChange={() => setSelectedScope('ALL')}
                        style={{ accentColor: '#2563EB', cursor: 'pointer' }}
                      />
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F172A' }}>
                          All Results
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#64748B' }}>
                          Entire unfiltered enterprise dataset
                        </div>
                      </div>
                    </div>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', backgroundColor: '#F1F5F9', padding: '2px 8px', borderRadius: '12px' }}>
                      {effectiveTotalCount.toLocaleString()} records
                    </span>
                  </label>
                </div>
              </div>

              {/* 2. Active Filters Applied Notice */}
              {selectedScope === 'FILTERED' && appliedFilters && appliedFilters.length > 0 && (
                <div style={{
                  padding: '0.65rem 0.85rem',
                  backgroundColor: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: '8px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                    <Filter size={12} style={{ color: '#2563EB' }} />
                    Active Filters Applied:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {appliedFilters.map((f, idx) => (
                      <span key={idx} style={{
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        backgroundColor: '#EFF6FF',
                        color: '#1D4ED8',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        border: '1px solid #BFDBFE'
                      }}>
                        {f.label}: <strong>{f.value}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. Column Selection */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.45rem' }}>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>
                    Columns ({selectedColumnKeys.size} of {availableColumns.length} selected)
                  </label>
                  <div style={{ display: 'flex', gap: '0.65rem' }}>
                    <button
                      type="button"
                      onClick={handleSelectAllColumns}
                      style={{ background: 'none', border: 'none', fontSize: '0.72rem', color: '#2563EB', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                    >
                      Select All
                    </button>
                    <span style={{ color: '#CBD5E1', fontSize: '0.72rem' }}>•</span>
                    <button
                      type="button"
                      onClick={handleClearAllColumns}
                      style={{ background: 'none', border: 'none', fontSize: '0.72rem', color: '#64748B', fontWeight: 500, cursor: 'pointer', padding: 0 }}
                    >
                      Clear
                    </button>
                    <span style={{ color: '#CBD5E1', fontSize: '0.72rem' }}>•</span>
                    <button
                      type="button"
                      onClick={handleResetColumns}
                      style={{ background: 'none', border: 'none', fontSize: '0.72rem', color: '#64748B', fontWeight: 500, cursor: 'pointer', padding: 0 }}
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '0.35rem 0.75rem',
                  maxHeight: '175px',
                  overflowY: 'auto',
                  padding: '0.65rem',
                  border: '1px solid #E2E8F0',
                  borderRadius: '8px',
                  backgroundColor: '#F8FAFC'
                }}>
                  {availableColumns.map(col => {
                    const isChecked = selectedColumnKeys.has(col.key);
                    return (
                      <label
                        key={col.key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.45rem',
                          fontSize: '0.78rem',
                          color: isChecked ? '#0F172A' : '#64748B',
                          fontWeight: isChecked ? 600 : 400,
                          cursor: 'pointer',
                          userSelect: 'none'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleColumn(col.key)}
                          style={{ accentColor: '#2563EB', cursor: 'pointer' }}
                        />
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {col.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* 4. Format Selection */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0F172A', marginBottom: '0.45rem' }}>
                  Target Format
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                  {/* Excel */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    padding: '0.6rem 0.85rem',
                    borderRadius: '8px',
                    border: `1px solid ${selectedFormat === 'xlsx' ? '#2563EB' : '#E2E8F0'}`,
                    backgroundColor: selectedFormat === 'xlsx' ? '#EFF6FF' : '#FFFFFF',
                    cursor: 'pointer'
                  }}>
                    <input
                      type="radio"
                      name="exportFormat"
                      checked={selectedFormat === 'xlsx'}
                      onChange={() => setSelectedFormat('xlsx')}
                      style={{ accentColor: '#2563EB' }}
                    />
                    <FileSpreadsheet size={18} style={{ color: '#10B981' }} />
                    <div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>
                        Excel Workbook (.xlsx)
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#64748B' }}>
                        Includes formatting & metadata sheet
                      </div>
                    </div>
                  </label>

                  {/* CSV */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    padding: '0.6rem 0.85rem',
                    borderRadius: '8px',
                    border: `1px solid ${selectedFormat === 'csv' ? '#2563EB' : '#E2E8F0'}`,
                    backgroundColor: selectedFormat === 'csv' ? '#EFF6FF' : '#FFFFFF',
                    cursor: 'pointer'
                  }}>
                    <input
                      type="radio"
                      name="exportFormat"
                      checked={selectedFormat === 'csv'}
                      onChange={() => setSelectedFormat('csv')}
                      style={{ accentColor: '#2563EB' }}
                    />
                    <FileText size={18} style={{ color: '#2563EB' }} />
                    <div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>
                        CSV (.csv)
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#64748B' }}>
                        UTF-8 standard machine-readable
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1rem 1.5rem',
              borderTop: '1px solid #E2E8F0',
              backgroundColor: '#F8FAFC'
            }}>
              <div style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 500 }}>
                <strong style={{ color: '#0F172A' }}>{targetCount.toLocaleString()}</strong> records selected •{' '}
                <strong style={{ color: '#0F172A' }}>{selectedColumnKeys.size}</strong> columns
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <button
                  type="button"
                  onClick={handleCloseDialog}
                  disabled={isExporting}
                  className="btn btn-secondary"
                  style={{
                    fontSize: '0.82rem',
                    padding: '0.45rem 0.95rem',
                    borderRadius: '6px',
                    border: '1px solid #CBD5E1',
                    backgroundColor: '#FFFFFF',
                    color: '#475569',
                    cursor: isExporting ? 'not-allowed' : 'pointer'
                  }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleExecuteExport}
                  disabled={isExporting || targetCount === 0 || selectedColumnKeys.size === 0}
                  className="btn btn-primary"
                  style={{
                    fontSize: '0.82rem',
                    padding: '0.45rem 1.1rem',
                    borderRadius: '6px',
                    backgroundColor: isExporting || targetCount === 0 ? '#93C5FD' : '#1D4ED8',
                    color: '#FFFFFF',
                    border: 'none',
                    cursor: isExporting || targetCount === 0 ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    fontWeight: 600,
                    boxShadow: '0 2px 6px rgba(37, 99, 235, 0.25)'
                  }}
                >
                  {isExporting ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Exporting...</span>
                    </>
                  ) : (
                    <>
                      <Download size={14} />
                      <span>{getExportActionLabel()}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
