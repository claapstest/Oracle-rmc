import React, { useState, useRef, useEffect } from 'react';
import { Download, ChevronDown, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { exportToExcel, type ExcelColumn } from '../utils/excelExport';

export interface TableExportControlProps<T = any> {
  filename: string;
  sheetName?: string;
  data?: T[];
  totalCount?: number;
  filteredCount?: number;
  columns?: ExcelColumn<T>[];
  onFetchData?: (requestedCount?: number) => Promise<T[]>;
  align?: 'left' | 'right';
  size?: 'sm' | 'md';
  buttonText?: string;
  title?: string;
  disabled?: boolean;
}

export const TableExportControl: React.FC<TableExportControlProps> = ({
  filename,
  sheetName,
  data = [],
  totalCount,
  filteredCount,
  columns,
  onFetchData,
  align = 'right',
  size = 'sm',
  buttonText = 'Download',
  title = 'Export table records to Excel (.xlsx)',
  disabled = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [rowCountInput, setRowCountInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const effectiveTotal = totalCount !== undefined 
    ? totalCount 
    : (filteredCount !== undefined ? filteredCount : data.length);

  const hasData = effectiveTotal > 0 || Boolean(onFetchData);

  // Close dropdown on click outside or Escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setErrorMessage('');
      setInfoMessage('');
      // Suggest default count: 100 or total if smaller
      if (!rowCountInput) {
        setRowCountInput(effectiveTotal > 0 ? String(Math.min(100, effectiveTotal)) : '10');
      }
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen]);

  // Core download runner
  const executeDownload = async (count?: number) => {
    setErrorMessage('');
    setInfoMessage('');
    setIsDownloading(true);

    try {
      let exportDataset: any[];
      let actualCount = 0;

      if (onFetchData) {
        // Fetch via async provider (e.g. backend pagination API)
        exportDataset = await onFetchData(count);
      } else {
        // Use in-memory dataset
        exportDataset = data;
      }

      if (!exportDataset || exportDataset.length === 0) {
        setErrorMessage('No records available to export.');
        setIsDownloading(false);
        return;
      }

      if (count !== undefined && count > 0) {
        if (count > exportDataset.length && totalCount !== undefined && count > totalCount) {
          // Requested more than total available
          setInfoMessage(`Downloaded all ${exportDataset.length} available rows (requested ${count}).`);
        }
        exportDataset = exportDataset.slice(0, count);
        actualCount = exportDataset.length;
      } else {
        actualCount = exportDataset.length;
      }

      const fileSuffix = count !== undefined ? `${actualCount}` : 'all';
      const exportName = `${filename}_${fileSuffix}`;

      const success = exportToExcel({
        filename: exportName,
        data: exportDataset,
        columns,
        sheetName
      });

      if (!success) {
        setErrorMessage('Failed to generate Excel workbook (.xlsx).');
      } else {
        // Close dropdown after brief visual feedback
        setTimeout(() => {
          setIsOpen(false);
          setIsDownloading(false);
        }, 350);
        return;
      }
    } catch (err: any) {
      console.error('Download execution failed:', err);
      setErrorMessage(err.message || 'An error occurred during download.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadAll = () => {
    executeDownload(undefined);
  };

  const handleDownloadNRows = () => {
    const rawVal = rowCountInput.trim();

    // 1. Validation: Empty or whitespace
    if (!rawVal) {
      setErrorMessage('Enter a number greater than 0.');
      return;
    }

    // 2. Validation: Letters / non-numeric
    if (!/^-?\d+(\.\d+)?$/.test(rawVal)) {
      setErrorMessage('Enter a valid number of rows.');
      return;
    }

    // 3. Validation: Decimals
    if (rawVal.includes('.')) {
      setErrorMessage('Enter a whole number.');
      return;
    }

    const num = parseInt(rawVal, 10);

    // 4. Validation: 0
    if (num === 0) {
      setErrorMessage('Enter a number greater than 0.');
      return;
    }

    // 5. Validation: Negative numbers
    if (num < 0) {
      setErrorMessage('Enter a positive number.');
      return;
    }

    // 6. Validation: Safe maximum threshold to prevent browser lockup
    if (num > 100000) {
      setErrorMessage('Please enter a value of 100,000 or fewer.');
      return;
    }

    // Safe handling if user enters more than available:
    // User requirement 4: "User enters 700 when only 500 exist: Do NOT crash. Use a sensible behavior such as download available 500 records"
    executeDownload(num);
  };

  const paddingStyle = size === 'sm' ? '0.25rem 0.65rem' : '0.45rem 0.9rem';
  const fontSizeStyle = size === 'sm' ? '0.75rem' : '0.84rem';

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Trigger Button */}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setIsOpen(prev => !prev)}
        disabled={disabled || !hasData || isDownloading}
        title={title}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: paddingStyle,
          fontSize: fontSizeStyle,
          fontWeight: 600,
          borderRadius: '6px',
          borderColor: 'var(--border-color)',
          backgroundColor: '#FFFFFF',
          color: 'var(--text-primary)',
          cursor: disabled || !hasData ? 'not-allowed' : 'pointer',
          opacity: disabled || !hasData ? 0.5 : 1,
          height: size === 'sm' ? '30px' : '36px',
          whiteSpace: 'nowrap'
        }}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {isDownloading ? (
          <RefreshCw size={13} className="animate-spin" style={{ color: 'var(--accent-blue)' }} />
        ) : (
          <Download size={13} style={{ color: 'var(--accent-blue)' }} />
        )}
        <span>{isDownloading ? 'Downloading...' : buttonText}</span>
        <ChevronDown 
          size={11} 
          style={{ 
            color: 'var(--text-muted)',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease' 
          }} 
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="glass-panel animate-fade-in"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            [align === 'right' ? 'right' : 'left']: 0,
            width: '265px',
            padding: '0.85rem',
            backgroundColor: '#FFFFFF',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            boxShadow: '0 8px 24px -4px rgba(15, 23, 42, 0.12), 0 2px 6px -1px rgba(15, 23, 42, 0.04)',
            zIndex: 1050,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.65rem'
          }}
        >
          {/* Header Info */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.01em' }}>
              Download Options
            </span>
            <span 
              className="badge" 
              style={{ 
                fontSize: '0.65rem', 
                backgroundColor: 'var(--accent-blue-light)', 
                color: 'var(--accent-blue)', 
                padding: '0.1rem 0.45rem',
                fontWeight: 600 
              }}
            >
              {effectiveTotal.toLocaleString()} rows
            </span>
          </div>

          {/* Option 1: Download All */}
          <div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleDownloadAll}
              disabled={isDownloading || effectiveTotal === 0}
              style={{
                width: '100%',
                justifyContent: 'center',
                padding: '0.45rem 0.75rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                backgroundColor: 'var(--bg-tertiary)',
                borderColor: 'var(--border-color)',
                borderRadius: '6px'
              }}
            >
              <Download size={13} style={{ color: 'var(--accent-blue)' }} />
              <span>Download All ({effectiveTotal.toLocaleString()})</span>
            </button>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '0.1rem 0' }} />

          {/* Option 2: Download N Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Rows to download:
            </label>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input
                ref={inputRef}
                type="text"
                className="form-input"
                value={rowCountInput}
                onChange={(e) => {
                  setRowCountInput(e.target.value);
                  if (errorMessage) setErrorMessage('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleDownloadNRows();
                  }
                }}
                placeholder="e.g. 50"
                disabled={isDownloading}
                style={{
                  flex: 1,
                  padding: '0.3rem 0.5rem',
                  fontSize: '0.78rem',
                  height: '32px',
                  borderRadius: '6px',
                  borderColor: errorMessage ? 'var(--accent-red)' : 'var(--border-color)'
                }}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleDownloadNRows}
                disabled={isDownloading || effectiveTotal === 0}
                style={{
                  padding: '0.3rem 0.75rem',
                  fontSize: '0.78rem',
                  height: '32px',
                  borderRadius: '6px',
                  whiteSpace: 'nowrap'
                }}
              >
                {isDownloading ? '...' : 'Download'}
              </button>
            </div>

            {/* Validation Error Banner */}
            {errorMessage && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem', color: 'var(--accent-red)', fontSize: '0.72rem' }}>
                <AlertCircle size={12} style={{ flexShrink: 0 }} />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Info Message */}
            {infoMessage && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem', color: 'var(--accent-green)', fontSize: '0.72rem' }}>
                <CheckCircle2 size={12} style={{ flexShrink: 0 }} />
                <span>{infoMessage}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
