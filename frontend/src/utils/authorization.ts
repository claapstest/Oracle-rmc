// Role-based page authorization (AC3/AC6). Mirrors backend requirePrivilege lists in
// backend/src/routes/api.ts — frontend never grants what the API would deny.
// Fail-closed: unknown pages and unauthenticated sessions are denied.

export interface AuthContext {
  isAdmin?: boolean;
  role?: string;
  permissions?: string[];
}

// Privileges (any one grants) per frontend page. 'dashboard' needs auth only.
// requireAdmin-backed modules use adminOnly instead of a privilege list.
const PAGE_PRIVILEGES: Record<string, string[]> = {
  dashboard: [],
  assistant: ['ASK_VEYRA'],
  users: ['USERS_LIST', 'USER_READ', 'USER_MANAGEMENT', 'SECURITY_READ'],
  roles: ['ROLES_CATALOG', 'ROLE_READ', 'USER_MANAGEMENT', 'SECURITY_READ'],
  audit: ['AUDIT_TRAIL', 'AUDIT_READ'],
  // Group shell needs the group's own privilege (a REPORTS-only role may still
  // open risk-certificates directly, matching the backend's per-page grants).
  risk: ['RISK_MANAGEMENT', 'RISK_READ'],
  'risk-access-requests': ['RISK_MANAGEMENT', 'RISK_READ'],
  'risk-controls': ['RISK_MANAGEMENT', 'RISK_READ'],
  'risk-certificates': ['REPORTS', 'REPORTS_READ', 'AUDIT_TRAIL'],
  reports: ['REPORTS', 'REPORTS_READ']
};

const ADMIN_PAGES = new Set(['settings', 'command-center']);

export function normalizePrivileges(permissions?: string[]): string[] {
  return (permissions || []).map((p) => String(p || '').trim().toUpperCase()).filter(Boolean);
}

export function canAccessPage(pageId: string, auth: AuthContext | null): boolean {
  if (!auth) return false;
  const required = PAGE_PRIVILEGES[pageId];
  // Fail-closed: unknown pages deny for everyone, including admins.
  if (!required && !ADMIN_PAGES.has(pageId)) return false;
  const perms = normalizePrivileges(auth.permissions);
  // ponytail: Entra ID seam — role/permission shape stays identical when Entra
  // replaces local auth; only the issuer populating it changes.
  if (auth.isAdmin === true || perms.includes('ALL')) return true;
  if (ADMIN_PAGES.has(pageId)) return false;
  if (required!.length === 0) return true; // authenticated session suffices
  return required!.some((p) => perms.includes(p));
}
