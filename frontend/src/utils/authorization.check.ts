import { canAccessPage } from './authorization.js';

function ok(actual: unknown, name: string): void {
  if (actual !== true) throw new Error(`${name}: expected true`);
}
function no(actual: unknown, name: string): void {
  if (actual !== false) throw new Error(`${name}: expected false`);
}

const AUDIT_MGR = {
  isAdmin: false,
  role: 'AUDIT_MANAGER',
  permissions: ['ASK_VEYRA', 'RISK_MANAGEMENT', 'RISK_READ', 'REPORTS', 'REPORTS_READ', 'USERS_LIST', 'USER_READ', 'ROLES_CATALOG', 'ROLE_READ', 'AUDIT_TRAIL', 'AUDIT_READ']
};
const ADMIN = { isAdmin: true, role: 'SITE_ADMIN', permissions: ['ALL'] };
const BARE = { isAdmin: false, role: 'VIEWER', permissions: [] as string[] };

// AC1/AC6 — unauthenticated sees nothing
no(canAccessPage('dashboard', null), 'anon dashboard');
no(canAccessPage('reports', null), 'anon reports');
// AC2 — Audit Manager reaches all seven mock-4 modules
for (const p of ['dashboard', 'assistant', 'risk', 'reports', 'users', 'roles', 'audit']) {
  ok(canAccessPage(p, AUDIT_MGR), `audit-mgr ${p}`);
}
// AC3 — privileged admin-only modules hidden without grant
no(canAccessPage('settings', AUDIT_MGR), 'audit-mgr settings');
no(canAccessPage('command-center', AUDIT_MGR), 'audit-mgr console');
// Admin / ALL bypass everywhere
for (const p of ['dashboard', 'assistant', 'risk', 'reports', 'users', 'roles', 'audit', 'settings', 'command-center']) {
  ok(canAccessPage(p, ADMIN), `admin ${p}`);
}
// Bare authenticated user keeps dashboard only
ok(canAccessPage('dashboard', BARE), 'bare dashboard');
no(canAccessPage('reports', BARE), 'bare reports');
// Mock 6 — Audit User (reports-only): Dashboard + Reports, nothing else
const AUDIT_USER = { isAdmin: false, role: 'AUDIT_USER', permissions: ['REPORTS'] };
for (const p of ['dashboard', 'reports']) {
  ok(canAccessPage(p, AUDIT_USER), `audit-user ${p}`);
}
for (const p of ['assistant', 'risk', 'users', 'roles', 'audit', 'settings', 'command-center']) {
  no(canAccessPage(p, AUDIT_USER), `audit-user denied ${p}`);
}
// Risk group shell needs the group's own privilege (REPORTS-only roles may
// still open risk-certificates directly, matching backend per-page grants).
ok(canAccessPage('risk-certificates', AUDIT_USER), 'audit-user certificates page');
// Unknown pages deny (fail-closed)
no(canAccessPage('nope', ADMIN), 'unknown page');

console.log('authorization checks passed');
