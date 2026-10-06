// Reports list filtering (AC2-AC4). Pure + testable.

export interface ReportListFilter {
  term: string;
  category: string;
  rangeDays: number;
}

export const REPORT_DATE_RANGES = [
  { label: 'Last 30 Days', days: 30 },
  { label: 'Last 7 Days', days: 7 },
  { label: 'Last 90 Days', days: 90 }
];

export function filterReports(rows: any[], filter: ReportListFilter, nowMs?: number): any[] {
  const term = (filter.term || '').trim().toLowerCase();
  const category = (filter.category || 'ALL').trim();
  const rangeDays = filter.rangeDays || 0;
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const cutoff = rangeDays > 0 ? now - rangeDays * 24 * 60 * 60 * 1000 : 0;

  return (rows || []).filter((r) => {
    if (category !== 'ALL' && String(r?.category || '') !== category) return false;
    if (term) {
      const hay = `${r?.reportName || ''} ${r?.generatedBy || ''}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    if (cutoff > 0) {
      const t = r?.generatedAt ? new Date(r.generatedAt).getTime() : NaN;
      if (Number.isNaN(t) || t < cutoff) return false;
    }
    return true;
  });
}
