/**
 * Safe Microsoft Excel (.xlsx) & CSV (.csv) Enterprise Export Utility
 * Generates genuine Office Open XML (.xlsx) workbooks and clean machine-readable CSVs.
 */
import * as XLSX from 'xlsx';

export interface ExcelColumn<T = any> {
  key: string;
  label?: string;
  getValue?: (item: T) => any;
}

export interface AppliedFilterInfo {
  label: string;
  value: string;
}

export interface EnterpriseExportOptions<T = any> {
  filename: string;
  data: T[];
  columns?: ExcelColumn<T>[];
  sheetName?: string;
  reportTitle?: string;
  dataSource?: string;
  appliedFilters?: AppliedFilterInfo[];
  format?: 'xlsx' | 'csv';
}

/**
 * Format a single cell value for Excel/CSV worksheet representation
 */
export function formatCellValue(val: any): string {
  if (val === null || val === undefined) {
    return '';
  }

  // Handle numbers
  if (typeof val === 'number') {
    return isNaN(val) ? '' : String(val);
  }

  // Handle Date objects
  if (val instanceof Date) {
    return val.toLocaleString();
  }

  // Handle booleans
  if (typeof val === 'boolean') {
    return val ? 'Active' : 'Inactive';
  }

  // Handle arrays (e.g. assigned roles or member lists)
  if (Array.isArray(val)) {
    return val
      .map(item => {
        if (item === null || item === undefined) return '';
        if (typeof item === 'string') return item;
        if (typeof item === 'number' || typeof item === 'boolean') return String(item);
        if (typeof item === 'object') {
          return item.displayName || item.name || item.roleName || item.roleCode || item.userName || JSON.stringify(item);
        }
        return String(item);
      })
      .filter(Boolean)
      .join('; ');
  }

  // Handle plain objects
  if (typeof val === 'object') {
    if (val.displayName || val.name || val.roleName || val.userName) {
      return String(val.displayName || val.name || val.roleName || val.userName);
    }
    return JSON.stringify(val);
  }

  return String(val);
}

/**
 * Sanitize filename to prevent invalid filesystem characters
 */
export function sanitizeFilename(name: string, extension: 'xlsx' | 'csv'): string {
  let clean = name.replace(/[/\\?%*:|"<>]/g, '_').trim();
  // Strip trailing extension if present
  clean = clean.replace(/\.(xlsx|csv)$/i, '');
  return `${clean}.${extension}`;
}

/**
 * Export data to a downloadable Microsoft Excel workbook (.xlsx)
 */
export function exportToExcel<T = any>({
  filename,
  data = [],
  columns,
  sheetName = 'Data',
  reportTitle,
  dataSource,
  appliedFilters = []
}: EnterpriseExportOptions<T>): boolean {
  try {
    // 1. Resolve Effective Columns
    let effectiveColumns: ExcelColumn<T>[] = [];
    if (columns && columns.length > 0) {
      effectiveColumns = columns;
    } else if (data.length > 0) {
      const firstRow = data[0] as Record<string, any>;
      effectiveColumns = Object.keys(firstRow)
        .filter(key => {
          if (key.startsWith('_')) return false;
          if (key === 'action' || key === 'actions' || key === 'render') return false;
          const val = firstRow[key];
          if (typeof val === 'function') return false;
          if (val && typeof val === 'object' && ('$$typeof' in val || '_owner' in val)) return false;
          return true;
        })
        .map(key => ({
          key,
          label: key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim()
        }));
    }

    // 2. Build Data Sheet Rows
    const headerRow = effectiveColumns.map(c => c.label || c.key);
    const dataRows: any[][] = [];

    data.forEach(item => {
      const rowVals = effectiveColumns.map(col => {
        let rawVal: any;
        if (col.getValue) {
          rawVal = col.getValue(item);
        } else if (item && typeof item === 'object') {
          rawVal = (item as any)[col.key];
        }
        return formatCellValue(rawVal);
      });
      dataRows.push(rowVals);
    });

    const aoa = [headerRow, ...dataRows];
    const dataWorksheet = XLSX.utils.aoa_to_sheet(aoa);

    // Calculate dynamic column widths
    const colWidths = effectiveColumns.map((col, idx) => {
      let maxLen = (col.label || col.key || '').length;
      dataRows.forEach(row => {
        const cellLen = String(row[idx] ?? '').length;
        if (cellLen > maxLen) {
          maxLen = cellLen;
        }
      });
      return { wch: Math.min(Math.max(maxLen + 4, 12), 65) };
    });
    dataWorksheet['!cols'] = colWidths;

    // Enable auto-filter for the header row in Excel
    if (effectiveColumns.length > 0 && dataRows.length > 0) {
      dataWorksheet['!autofilter'] = {
        ref: `A1:${XLSX.utils.encode_col(effectiveColumns.length - 1)}${dataRows.length + 1}`
      };
    }

    // 3. Create Workbook
    const workbook = XLSX.utils.book_new();
    const cleanSheetName = sheetName.replace(/[\\/?*[\]]/g, '').substring(0, 31) || 'Records';
    XLSX.utils.book_append_sheet(workbook, dataWorksheet, cleanSheetName);

    // 4. Add Metadata / Report Information Sheet if requested
    if (reportTitle || dataSource || (appliedFilters && appliedFilters.length > 0)) {
      const metaRows: string[][] = [
        ['Report Export Metadata'],
        [''],
        ['Report Name:', reportTitle || filename],
        ['Export Timestamp:', new Date().toLocaleString()],
        ['Data Source:', dataSource || 'Oracle Fusion Cloud'],
        ['Total Records Exported:', String(data.length)],
        ['']
      ];

      if (appliedFilters && appliedFilters.length > 0) {
        metaRows.push(['Applied Filters:']);
        appliedFilters.forEach(f => {
          metaRows.push([`  • ${f.label}:`, f.value]);
        });
      }

      const metaWorksheet = XLSX.utils.aoa_to_sheet(metaRows);
      metaWorksheet['!cols'] = [{ wch: 26 }, { wch: 45 }];
      XLSX.utils.book_append_sheet(workbook, metaWorksheet, 'Export Info');
    }

    // 5. Generate binary XLSX buffer and trigger download
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const cleanFilename = sanitizeFilename(filename || 'export', 'xlsx');
    downloadBlob(blob, cleanFilename);
    return true;
  } catch (err) {
    console.error('Failed to export Excel workbook (.xlsx):', err);
    return false;
  }
}

/**
 * Escape a single CSV cell according to RFC-4180
 */
function escapeCsvCell(val: string): string {
  if (val.includes('"') || val.includes(',') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * Export data to a clean, RFC-4180 compliant CSV file (.csv) with UTF-8 BOM
 */
export function exportToCsv<T = any>({
  filename,
  data = [],
  columns
}: EnterpriseExportOptions<T>): boolean {
  try {
    // 1. Resolve Effective Columns
    let effectiveColumns: ExcelColumn<T>[] = [];
    if (columns && columns.length > 0) {
      effectiveColumns = columns;
    } else if (data.length > 0) {
      const firstRow = data[0] as Record<string, any>;
      effectiveColumns = Object.keys(firstRow)
        .filter(key => !key.startsWith('_') && key !== 'action' && key !== 'actions')
        .map(key => ({
          key,
          label: key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim()
        }));
    }

    // 2. Build CSV string
    const lines: string[] = [];

    // Header Row
    lines.push(effectiveColumns.map(c => escapeCsvCell(c.label || c.key)).join(','));

    // Data Rows
    data.forEach(item => {
      const row = effectiveColumns.map(col => {
        let rawVal: any;
        if (col.getValue) {
          rawVal = col.getValue(item);
        } else if (item && typeof item === 'object') {
          rawVal = (item as any)[col.key];
        }
        return escapeCsvCell(formatCellValue(rawVal));
      });
      lines.push(row.join(','));
    });

    // 3. Prepend UTF-8 Byte Order Mark (BOM: \uFEFF) so Excel reliably detects UTF-8
    const csvContent = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const cleanFilename = sanitizeFilename(filename || 'export', 'csv');

    downloadBlob(blob, cleanFilename);
    return true;
  } catch (err) {
    console.error('Failed to export CSV (.csv):', err);
    return false;
  }
}

/**
 * Common browser trigger for blob download
 */
function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
