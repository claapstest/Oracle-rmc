// Role-based page authorization (AC3/AC6). Mirrors backend requirePrivilege lists in
// backend/src/routes/api.ts — frontend never grants what the API would deny.
// Fail-closed: unknown pages and unauthenticated sessions are denied.

export interface AuthContext {
  isAdmin?: boolean;
  role?: string;
  permissions?: string[];
}

// Privileges (any one grants) per frontend page. 'dashboard' needs auth only.
const PAGE_PRIVILEGES: Record<string, string[]> = {
  dashboard: [],
  assistant: ['ASK_VEYRA'],
  users: ['USERS_LIST', 'USER_READ'],
  'user-management': ['USER_MANAGEMENT'],
  roles: ['ROLES_CATALOG', 'ROLE_READ'],
  audit: ['AUDIT_TRAIL', 'AUDIT_READ'],
  // Group shell needs the group's own privilege (a REPORTS-only role may still
  // open risk-certificates directly, matching the backend's per-page grants).
  risk: ['RISK_MANAGEMENT', 'RISK_READ'],
  'risk-access-requests': ['RISK_MANAGEMENT', 'RISK_READ'],
  'risk-controls': ['RISK_MANAGEMENT', 'RISK_READ'],
  'risk-certificates': ['REPORTS', 'REPORTS_READ', 'AUDIT_TRAIL'],
  reports: ['REPORTS', 'REPORTS_READ'],
  settings: ['ORACLE_INTEGRATION'],
  'command-center': ['ORACLE_API_CONSOLE']
};

export function normalizePrivileges(permissions?: string[]): string[] {
  return (permissions || []).map((p) => String(p || '').trim().toUpperCase()).filter(Boolean);
}

// Destructive user operations (Create/Edit/Delete) and administration require USER_MANAGEMENT.
// Site Admin (role SITE_ADMIN / USER_MANAGEMENT) qualifies.
export function canManageUsers(auth: AuthContext | null): boolean {
  if (!auth) return false;
  const normalizedRole = (auth.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (normalizedRole === 'SITE_ADMIN' || auth.isAdmin === true) return true;
  const perms = normalizePrivileges(auth.permissions);
  return perms.includes('ALL') || perms.includes('USER_MANAGEMENT');
}

export function canAccessPage(pageId: string, auth: AuthContext | null): boolean {
  if (!auth) return false;
  const required = PAGE_PRIVILEGES[pageId];
  // Fail-closed: unknown pages deny for everyone.
  if (!required) return false;
  if (required.length === 0) return true; // authenticated session suffices (e.g. dashboard)

  const normalizedRole = (auth.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const perms = normalizePrivileges(auth.permissions);
  const effectivePerms = new Set(perms);

  // Map Site Admin canonical privileges if not explicitly present
  if (normalizedRole === 'SITE_ADMIN') {
    effectivePerms.add('USER_MANAGEMENT');
    effectivePerms.add('ORACLE_INTEGRATION');
    effectivePerms.add('ORACLE_API_CONSOLE');
    // Site Admin sees only the modules corresponding to its authorized privileges per Requirement 7
    return required.some((p) =>
      ['USER_MANAGEMENT', 'ORACLE_INTEGRATION', 'ORACLE_API_CONSOLE'].includes(p)
    );
  }

  // If a non-Site Admin has 'ALL', allow
  if (perms.includes('ALL')) return true;

  return required.some((p) => effectivePerms.has(p));
}
