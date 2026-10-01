import { normalizeEmail, validateCreateUser } from './userFormValidation.js';

function eq(actual: unknown, expected: unknown, name: string): void {
  if (actual !== expected) throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const USERS = [{ email: 'taken@claaps.com' }];
const ACCESS = ['Fusion - Production'];

// AC2 — normalization
eq(normalizeEmail('  User@Claaps.COM  '), 'user@claaps.com', 'normalize');
// AC1 — name mandatory, whitespace rejected, trimmed
eq(validateCreateUser({ name: '', email: 'a@b.com', role: 'AUDIT_USER', access: ACCESS }, USERS).name, 'Full name is required.', 'empty name');
eq(validateCreateUser({ name: '   ', email: 'a@b.com', role: 'AUDIT_USER', access: ACCESS }, USERS).name, 'Full name is required.', 'blank name');
// AC2 — email mandatory + format
eq(validateCreateUser({ name: 'Ann', email: '', role: 'AUDIT_USER', access: ACCESS }, USERS).email, 'Email is required.', 'empty email');
eq(validateCreateUser({ name: 'Ann', email: 'nope', role: 'AUDIT_USER', access: ACCESS }, USERS).email, 'Enter a valid email address.', 'bad email');
// AC8 — duplicate against loaded list (case-insensitive)
eq(validateCreateUser({ name: 'Ann', email: 'TAKEN@claaps.com', role: 'AUDIT_USER', access: ACCESS }, USERS).email, 'A user with this email already exists.', 'duplicate');
// AC3 — role mandatory + from allowed set
eq(validateCreateUser({ name: 'Ann', email: 'a@b.com', role: '', access: ACCESS }, USERS).role, 'Role is required.', 'empty role');
eq(validateCreateUser({ name: 'Ann', email: 'a@b.com', role: 'SUPERUSER', access: ACCESS }, USERS).role, 'Select a valid role.', 'bad role');
// AC4 — at least one application access
eq(validateCreateUser({ name: 'Ann', email: 'a@b.com', role: 'AUDIT_USER', access: [] }, USERS).access, 'Select at least one application access.', 'no access');
// AC7 — admin stays local + locks Site Admin role
const adminRes = validateCreateUser({ name: 'Admin', email: 'admin@admin.com', role: 'AUDIT_USER', access: ACCESS }, USERS);
eq(adminRes.role, 'Site Admin uses local VEYRA authentication and keeps the Site Admin role.', 'admin role lock');
// Valid input passes clean
eq(JSON.stringify(validateCreateUser({ name: ' Ann Lee ', email: 'ann.lee@claaps.com', role: 'AUDIT_MANAGER', access: ACCESS }, USERS)), '{}', 'valid');

console.log('userFormValidation checks passed');
