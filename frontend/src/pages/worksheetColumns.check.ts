import { WORKSHEET_COLUMNS, wsVal } from './AccessCertificates.js';

const expected = [
  'ROLE NAME', 'USER NAME', 'DIRECT MANAGER', 'ACTION', 'ATTACHMENTS', 'COMMENTS',
  'FOLLOW-UP', 'BUSINESS UNIT', 'CREATED BY', 'CREATION DATE', 'FOLLOW-UP STATUS',
  'JOB NAME', 'LAST DECISION BY', 'LAST DECISION DATE', 'LAST UPDATED DATE', 'LOCATION',
  'PENDING SUBMISSION', 'POSITION NAME', 'USER-ROLE BUSINESS UNIT', 'ROLE CODE',
  'ROLE DESCRIPTION', 'SELF-CERTIFIED', 'UPDATED BY'
];

const actual = WORKSHEET_COLUMNS.map((c) => c.header);
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`columns mismatch:\n actual: ${actual.join(' | ')}`);
}

// Tolerant mapping: camelCase + UPPER_SNAKE resolve, blanks fall through
const sample: any = {
  roleName: 'Accounts Receivable Manager',
  USER_NAME: 'PPM66 Student',
  directManager: 'Christine Ryan',
  ACTION: 'Certify',
  attachments: '2 files',
  COMMENTS: 'Verified OK',
  FOLLOW_UP: 'Yes',
  BUSINESS_UNIT: 'US1 Business Unit',
  createdBy: 'System',
  CREATION_DATE: '2026-09-21',
  followUpStatus: 'Open',
  JOB_NAME: 'QTR Close',
  lastDecisionBy: 'Christine Ryan',
  LAST_DECISION_DATE: '2026-09-20',
  lastUpdatedDate: '2026-09-21',
  LOCATION: 'Hyderabad',
  pendingSubmission: 'No',
  POSITION_NAME: 'Consultant',
  userRoleBusinessUnit: 'US1',
  ROLE_CODE: 'ORA_AR_MANAGER',
  roleDescription: 'Manages AR',
  SELF_CERTIFIED: 'N',
  updatedBy: 'Admin'
};
const resolved = WORKSHEET_COLUMNS.map((c) => wsVal(sample, c.keys) || '—');
if (resolved.includes('—')) {
  throw new Error(`unresolved columns: ${resolved.map((v, i) => (v === '—' ? expected[i] : '')).filter(Boolean).join(', ')}`);
}
if (wsVal({ a: 1 }, ['missing', 'ALSO_MISSING']) !== '') throw new Error('missing fields must resolve empty');

console.log('worksheet columns check passed (23/23)');
