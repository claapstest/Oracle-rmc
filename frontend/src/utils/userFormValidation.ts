// Create User form validation (AC1-AC5, AC7, AC8). Pure + testable.
// Application access / invitation travel in the request body for Phase 2;
// the backend persists email/displayName/role today and ignores the rest.

export const ALLOWED_ROLES = ['AUDIT_MANAGER', 'AUDIT_SUPERVISOR', 'AUDIT_USER', 'SITE_ADMIN'];

export const APP_ACCESS_OPTIONS = ['Fusion - Production', 'Fusion - Test', 'Fusion - Dev'];

export const SITE_ADMIN_EMAIL = 'admin@admin.com';

export function normalizeEmail(email: string): string {
  return (email ?? '').trim().toLowerCase();
}

export interface CreateUserInput {
  name: string;
  email: string;
  role: string;
  access: string[];
}

export interface CreateUserErrors {
  name?: string;
  email?: string;
  role?: string;
  access?: string;
}

export function isSiteAdminEmail(email: string): boolean {
  return normalizeEmail(email) === SITE_ADMIN_EMAIL;
}

export function validateCreateUser(
  input: CreateUserInput,
  existingUsers: Array<{ email?: string }>
): CreateUserErrors {
  const errors: CreateUserErrors = {};
  const name = (input.name ?? '').trim();
  const email = normalizeEmail(input.email);
  const role = (input.role ?? '').trim().toUpperCase();
  const access = Array.isArray(input.access) ? input.access : [];

  if (!name) {
    errors.name = 'Full name is required.';
  }
  if (!email) {
    errors.email = 'Email is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid email address.';
  } else if (
    (existingUsers || []).some((u) => normalizeEmail(u?.email || '') === email)
  ) {
    errors.email = 'A user with this email already exists.';
  }
  if (!role) {
    errors.role = 'Role is required.';
  } else if (!ALLOWED_ROLES.includes(role)) {
    errors.role = 'Select a valid role.';
  } else if (email === SITE_ADMIN_EMAIL && role !== 'SITE_ADMIN') {
    // AC7 — local Site Admin account never leaves the VEYRA flow.
    errors.role = 'Site Admin uses local VEYRA authentication and keeps the Site Admin role.';
  }
  if (access.length === 0) {
    errors.access = 'Select at least one application access.';
  }
  return errors;
}

export function isCreateUserValid(
  input: CreateUserInput,
  existingUsers: Array<{ email?: string }>
): boolean {
  const errors = validateCreateUser(input, existingUsers);
  return !errors.name && !errors.email && !errors.role && !errors.access;
}
