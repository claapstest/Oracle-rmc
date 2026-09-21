/**
 * Safe CSV Export Utility
 * Conforms to RFC 4180 standards for CSV serialization:
 * - Proper escaping of quotes, commas, and line breaks
 * - Safe handling of null, undefined, boolean, array, and object data
 * - UTF-8 Byte Order Mark (\uFEFF) to prevent encoding corruption in Excel and other spreadsheet tools
 * - Memory-efficient Blob-based downloads with object URL cleanup
 */

export interface CsvColumn<T = any> {
  key: string;
  label?: string;
  getValue?: (item: T) => any;
}

export interface CsvExportOptions<T = any> {
  filename: string;
  data: T[];
  columns?: CsvColumn<T>[];
}

/**
 * Format a single cell value for CSV output
 */
export function formatCellValue(val: any): string {
  if (val === null || val === undefined) {
    return '';
  }

  // Handle Date objects
  if (val instanceof Date) {
    return val.toISOString();
  }

  // Handle arrays (e.g. assigned roles or members)
  if (Array.isArray(val)) {
    const serialized = val
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
    return escapeCsvString(serialized);
  }

  // Handle plain objects (avoid [object Object])
  if (typeof val === 'object') {
    // If it's a simple key-value object or has common identifier properties
    if (val.displayName || val.name || val.roleName || val.userName) {
      return escapeCsvString(String(val.displayName || val.name || val.roleName || val.userName));
    }
    return escapeCsvString(JSON.stringify(val));
  }

  return escapeCsvString(String(val));
}

/**
 * Escape quotes and wrap string in double quotes if it contains commas, quotes, or newlines
 */
function escapeCsvString(str: string): string {
  const needsQuotes = str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r');
  // Always double any existing double-quotes
  const escaped = str.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/**
 * Sanitize filename to prevent invalid filesystem characters
 */
export function sanitizeFilename(name: string): string {
  const clean = name.replace(/[/\\?%*:|"<>]/g, '_').trim();
  return clean.endsWith('.csv') ? clean : `${clean}.csv`;
}

/**
 * Serialize an array of records into a valid RFC 4180 CSV string
 */
export function serializeToCsv<T = any>(data: T[], columns?: CsvColumn<T>[]): string {
  if (!data || data.length === 0) {
    if (columns && columns.length > 0) {
      return columns.map(c => escapeCsvString(c.label || c.key)).join(',');
    }
    return '';
  }

  // Determine columns if not explicitly provided
  let effectiveColumns: CsvColumn<T>[];
  if (columns && columns.length > 0) {
    effectiveColumns = columns;
  } else {
    // Derive keys from the first row, filtering out internal / UI attributes
    const firstRow = data[0] as Record<string, any>;
    effectiveColumns = Object.keys(firstRow)
      .filter(key => {
        if (key.startsWith('_')) return false;
        if (key === 'action' || key === 'actions' || key === 'render') return false;
        const val = firstRow[key];
        // Exclude React elements, functions
        if (typeof val === 'function') return false;
        if (val && typeof val === 'object' && ('$$typeof' in val || '_owner' in val)) return false;
        return true;
      })
      .map(key => ({
        key,
        label: key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim()
      }));
  }

  // Header row
  const headers = effectiveColumns.map(c => escapeCsvString(c.label || c.key)).join(',');

  // Data rows
  const rows = data.map(item => {
    return effectiveColumns
      .map(col => {
        let val: any;
        if (col.getValue) {
          val = col.getValue(item);
        } else if (item && typeof item === 'object') {
          val = (item as any)[col.key];
        }
        return formatCellValue(val);
      })
      .join(',');
  });

  return [headers, ...rows].join('\r\n');
}

/**
 * Export data to a downloadable CSV file using a Blob
 */
export function exportToCsv<T = any>({ filename, data, columns }: CsvExportOptions<T>): boolean {
  try {
    const csvContent = serializeToCsv(data, columns);
    // Prepend UTF-8 Byte Order Mark (\uFEFF) for Excel Unicode compatibility
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const cleanFilename = sanitizeFilename(filename || 'export');

    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', cleanFilename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Revoke object URL after a short delay to free memory
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);

    return true;
  } catch (err) {
    console.error('Failed to export CSV:', err);
    return false;
  }
}
