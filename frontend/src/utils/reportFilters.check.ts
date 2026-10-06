import { filterReports, REPORT_DATE_RANGES } from './reportFilters.js';

function eq(actual: unknown, expected: unknown, name: string): void {
  if (actual !== expected) throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const NOW = new Date('2026-09-30T12:00:00Z').getTime();
const rows = [
  { reportName: 'User Access Summary', category: 'Security', generatedAt: '2026-09-15T10:00:00Z', generatedBy: 'John Doe', status: 'Completed' },
  { reportName: 'Role Privileges Report', category: 'Security', generatedAt: '2026-09-14T10:00:00Z', generatedBy: 'Priya Sharma', status: 'Processing' },
  { reportName: 'Risk Assessment', category: 'Risk', generatedAt: '2026-08-01T10:00:00Z', generatedBy: 'John Doe', status: 'Failed' }
];

// AC2 — search matches name + generated-by, case-insensitive
eq(filterReports(rows, { term: 'priya', category: 'ALL', rangeDays: 0 }, NOW).length, 1, 'search by author');
eq(filterReports(rows, { term: 'ACCESS', category: 'ALL', rangeDays: 0 }, NOW).length, 1, 'search case-insensitive');
eq(filterReports(rows, { term: 'zzz', category: 'ALL', rangeDays: 0 }, NOW).length, 0, 'no match');
// AC3 — category filter
eq(filterReports(rows, { term: '', category: 'Risk', rangeDays: 0 }, NOW).length, 1, 'category');
eq(filterReports(rows, { term: '', category: 'ALL', rangeDays: 0 }, NOW).length, 3, 'all categories');
// AC4 — date ranges (Last 30 Days keeps Sep rows, drops Aug)
eq(filterReports(rows, { term: '', category: 'ALL', rangeDays: 30 }, NOW).length, 2, 'last 30');
eq(filterReports(rows, { term: '', category: 'ALL', rangeDays: 7 }, NOW).length, 0, 'last 7');
// Combined
eq(filterReports(rows, { term: 'r', category: 'Security', rangeDays: 30 }, NOW).length, 2, 'combined');
// Ranges list offers Last 30 Days first
eq(REPORT_DATE_RANGES[0].label, 'Last 30 Days', 'default range');
eq(REPORT_DATE_RANGES[0].days, 30, 'default days');

console.log('reportFilters checks passed');
