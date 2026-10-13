import { WORKSHEET_COLUMNS, wsVal } from './AccessCertificates.js';

// Canonical columns now follow the live BIP Certifier Worksheet output
// (Title Case + camelCase + UPPER_SNAKE tolerant mapping).
const expected = [
  'CERTIFICATION NAME', 'JOB ROLE NAME', 'ROLE CODE', 'USER NAME', 'COMMENT',
  'ACTION', 'USER-ROLE BUSINESS UNIT', 'USER POSITION NAME', 'USER MANAGER NAME',
  'USER JOB NAME', 'USER LOCATION'
];

const actual = WORKSHEET_COLUMNS.map((c) => c.header);
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`columns mismatch:\n actual: ${actual.join(' | ')}`);
}

// Tolerant mapping: every header resolves from at least one key shape.
const sample: any = {
  certificationName: 'CLPS_Access_Certification3',
  'Job Role Name': 'Accounts Receivable Manager',
  ROLE_CODE: 'ORA_AR_MANAGER',
  ownerName: 'PPM66 Student',
  Comments: 'Verified OK',
  certificationAction: 'Certify',
  businessUnit: 'US1 Business Unit',
  POSITION_NAME: 'Consultant',
  certifiedManager: 'Christine Ryan',
  'Job Name': 'QTR Close',
  USER_LOCATION: 'Hyderabad'
};
const resolved = WORKSHEET_COLUMNS.map((c) => wsVal(sample, c.keys) || '—');
if (resolved.includes('—')) {
  throw new Error(`unresolved columns: ${resolved.map((v, i) => (v === '—' ? expected[i] : '')).filter(Boolean).join(', ')}`);
}
if (wsVal({ a: 1 }, ['missing', 'ALSO_MISSING']) !== '') throw new Error('missing fields must resolve empty');

console.log(`worksheet columns check passed (${expected.length}/${expected.length})`);
