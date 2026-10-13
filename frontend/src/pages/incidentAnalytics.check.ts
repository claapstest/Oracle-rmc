import { topNByCount } from './IncidentAnalytics.js';

function eq(actual: unknown, expected: unknown, name: string): void {
  if (actual !== expected) throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const rows = [
  { user: 'a@x.com', incidents: 50 },
  { user: 'b@x.com', incidents: 120 },
  { user: 'c@x.com', incidents: 30 },
  { user: 'd@x.com', incidents: 90 }
];

// Top-N descending by count
const top2 = topNByCount(rows, 'user', 'incidents', 2);
eq(top2.length, 2, 'length');
eq(top2[0].label, 'b@x.com', 'first');
eq(top2[0].value, 120, 'first value');
eq(top2[1].label, 'd@x.com', 'second');
// Missing/invalid counts sort last, never crash
const messy: any[] = [{ user: 'x' }, { user: 'y', incidents: 'NaN' }, { user: 'z', incidents: 5 }];
const topM = topNByCount(messy, 'user', 'incidents', 10);
eq(topM.length, 3, 'keeps all');
eq(topM[0].label, 'z', 'valid first');
// Empty in, empty out
eq(topNByCount([], 'user', 'incidents', 10).length, 0, 'empty');

console.log('incidentAnalytics checks passed');
