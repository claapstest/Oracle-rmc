import React, { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Pencil, Trash2, X, KeyRound, Power, Copy, Check, CheckCircle2, ShieldAlert } from 'lucide-react';
import { api, getActiveUserPermissions, getActiveUserRole, getActiveUserEmail } from '../services/api';
import {
  normalizeEmail as normalizeUserEmail,
  validateCreateUser,
  isCreateUserValid,
  isSiteAdminEmail,
  APP_ACCESS_OPTIONS
} from '../utils/userFormValidation';
import { canManageUsers } from '../utils/authorization';

interface AppUsersListProps {
  hasAccess?: (pageId: string) => boolean;
  onInvestigateUser?: (userId: string, displayName: string) => void;
}

const ROLE_OPTIONS = [
  { value: 'AUDIT_MANAGER', label: 'Audit Manager' },
  { value: 'AUDIT_SUPERVISOR', label: 'Audit Supervisor' },
  { value: 'AUDIT_USER', label: 'Audit User' },
  { value: 'SITE_ADMIN', label: 'Site Admin' },
];

function getRoleLabel(role?: string): string {
  const norm = (role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const found = ROLE_OPTIONS.find((r) => r.value === norm);
  if (found) return found.label;
  if (!norm) return '—';
  return norm.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

function formatLastLogin(value?: string | null): string {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function getErrorMessage(err: any, fallback: string): string {
  const status = err?.status;
  const code = err?.code;
  const backendMsg = err?.data?.message || err?.message;
  // AC10 — backend rejection must surface as a friendly, actionable message.
  if (status === 403 || code === 'FORBIDDEN') {
    return 'You do not have permission to perform this action. Contact your Site Administrator.';
  }
  if (code === 'CANNOT_DELETE_SELF') {
    return 'Administrators cannot delete their own accounts.';
  }
  if (status === 404) {
    return 'User not found. The list has been refreshed.';
  }
  if (status === 409 || code === 'USER_ALREADY_EXISTS') {
    return 'A user with this email already exists.';
  }
  if (backendMsg && typeof backendMsg === 'string' && backendMsg.length < 200) return backendMsg;
  return fallback;
}

export default function AppUsersList({ hasAccess, onInvestigateUser }: AppUsersListProps) {
  // AC7/AC8 — management privilege resolved from the live session on every
  // render (cheap string check). Only Site Admin sessions (role SITE_ADMIN or
  // ALL/USER_MANAGEMENT grant) can Create/Edit/Delete; other matrix roles are
  // read-only. `hasAccess` is accepted for API consistency with Dashboard.
  void hasAccess;
  void onInvestigateUser;
  const canManage = canManageUsers({ role: getActiveUserRole(), permissions: getActiveUserPermissions() });
  const currentSessionEmail = getActiveUserEmail().toLowerCase();

  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  // AC2/AC3 — search is trimmed, debounced, and empty restores the default list.
  const [searchTerm, setSearchTerm] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Security actions state (password reset code, account status toggle feedback)
  const [generatedCode, setGeneratedCode] = useState<{ email: string; code: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [actingEmail, setActingEmail] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [deletingUser, setDeletingUser] = useState<any | null>(null);
  const [modalError, setModalError] = useState('');
  const [modalSuccess, setModalSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState('AUDIT_USER');
  const [formStatus, setFormStatus] = useState('ACTIVE');
  const [formPassword, setFormPassword] = useState('');
  const [formAccess, setFormAccess] = useState<string[]>(['Fusion - Production']);
  const [sendInvitation, setSendInvitation] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; role?: string; access?: string }>({});
  const [touched, setTouched] = useState<{ name?: boolean; email?: boolean }>({});
  const [createdEmail, setCreatedEmail] = useState('');

  // AC7 — admin@admin.com stays local and keeps the Site Admin role.
  const adminLocked = isSiteAdminEmail(formEmail);
  const effectiveRole = adminLocked ? 'SITE_ADMIN' : formRole;
  const createInput = { name: formName, email: formEmail, role: effectiveRole, access: formAccess };
  const createValid = isCreateUserValid(createInput, users);
  // Live errors so blocked submits (AC9) still explain themselves (AC8/AC11).
  const liveErrors = validateCreateUser(createInput, users);
  const nameError = showCreate ? (fieldErrors.name || (touched.name ? liveErrors.name : undefined)) : undefined;
  const emailError = showCreate ? (fieldErrors.email || (touched.email ? liveErrors.email : undefined)) : undefined;
  const accessError = showCreate ? (fieldErrors.access || (formAccess.length === 0 ? liveErrors.access : undefined)) : undefined;
  const roleError = showCreate ? fieldErrors.role : undefined;

  useEffect(() => {
    const delay = searchTerm ? 350 : 0;
    const timer = setTimeout(() => setAppliedSearch(searchTerm.trim()), delay);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    let isMounted = true;
    async function loadAppUsers() {
      setLoading(true);
      setError('');
      try {
        const res = await api.getAdminUsers();
        if (!isMounted) return;
        const list = Array.isArray((res as any)?.users)
          ? (res as any).users
          : Array.isArray((res as any)?.data)
            ? (res as any).data
            : [];
        setUsers(list);
      } catch (err: any) {
        if (!isMounted) return;
        setUsers([]);
        setError(getErrorMessage(err, 'Unable to fetch users. Check your connection and try again.'));
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadAppUsers();
    return () => { isMounted = false; };
  }, [reloadKey]);

  const filteredUsers = useMemo(() => {
    const q = appliedSearch.trim().toLowerCase();
    return users.filter((u) => {
      if (q) {
        const name = String(u.displayName || '').toLowerCase();
        const email = String(u.email || '').toLowerCase();
        if (!name.includes(q) && !email.includes(q)) return false;
      }
      if (roleFilter !== 'ALL') {
        const norm = String(u.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
        if (norm !== roleFilter) return false;
      }
      if (statusFilter === 'ACTIVE' && !(u.isActive ?? u.status === 'ACTIVE')) return false;
      if (statusFilter === 'INACTIVE' && (u.isActive ?? u.status === 'ACTIVE')) return false;
      return true;
    });
  }, [users, appliedSearch, roleFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageItems = filteredUsers.slice((safePage - 1) * pageSize, safePage * pageSize);

  function resetPage() {
    setCurrentPage(1);
  }

  function openCreate() {
    setModalError('');
    setModalSuccess('');
    setFieldErrors({});
    setTouched({});
    setCreatedEmail('');
    setFormName('');
    setFormEmail('');
    setFormRole('AUDIT_USER');
    setFormStatus('ACTIVE');
    setFormPassword('');
    setFormAccess(['Fusion - Production']);
    setSendInvitation(true);
    setShowCreate(true);
  }

  function openEdit(user: any) {
    setModalError('');
    setModalSuccess('');
    setFormName(String(user.displayName || ''));
    setFormEmail(String(user.email || ''));
    setFormRole(String(user.role || 'AUDIT_USER').trim().toUpperCase().replace(/[\s-]+/g, '_'));
    setFormStatus(user.isActive ?? user.status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED');
    setFormPassword('');
    setEditingUser(user);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setModalError('');
    setModalSuccess('');
    // AC1-AC5 — client validation first; no API call when invalid.
    const errs = validateCreateUser(createInput, users);
    setFieldErrors(errs);
    if (errs.name || errs.email || errs.role || errs.access) return;
    const email = normalizeUserEmail(formEmail);
    const displayName = formName.trim();
    setSubmitting(true);
    try {
      await api.createAppUser({
        email,
        displayName,
        role: effectiveRole,
        status: formStatus,
        ...(formPassword ? { password: formPassword } : {}),
        applicationAccess: formAccess,
        sendInvitation
      });
      // AC10 — stay open with success + way back to the list.
      setCreatedEmail(email);
      setModalSuccess(`User ${email} created.`);
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      const msg = getErrorMessage(err, 'Could not create the user. Try again.');
      // AC8/AC11 — duplicate lands on the email field; rest on the banner.
      if (err?.status === 409 || err?.code === 'USER_ALREADY_EXISTS') {
        setFieldErrors({ email: 'A user with this email already exists.' });
      }
      setModalError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    setModalError('');
    setModalSuccess('');
    const displayName = formName.trim();
    if (!displayName) {
      setModalError('Full name is required.');
      return;
    }
    setSubmitting(true);
    try {
      const id = String(editingUser.email || editingUser.userId || editingUser.id || '');
      await api.updateAppUser(id, {
        displayName,
        role: formRole,
        status: formStatus,
        ...(formPassword ? { password: formPassword } : {}),
      });
      setModalSuccess(`User ${id} updated.`);
      setEditingUser(null);
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      setModalError(getErrorMessage(err, 'Could not update the user. Try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deletingUser) return;
    setModalError('');
    setSubmitting(true);
    try {
      const id = String(deletingUser.email || deletingUser.userId || deletingUser.id || '');
      await api.deleteAppUser(id);
      setDeletingUser(null);
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      setModalError(getErrorMessage(err, 'Could not delete the user. Try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  const handleToggleStatus = async (email: string, currentActive: boolean) => {
    setActionFeedback(null);
    if (email.toLowerCase() === currentSessionEmail) {
      setActionFeedback({ type: 'error', message: 'Security Policy: Administrators cannot deactivate their own accounts.' });
      return;
    }
    setActingEmail(email);
    try {
      const res = await api.toggleUserAccountStatus(email, !currentActive);
      if (res?.success) {
        setActionFeedback({ type: 'success', message: `Account status updated for ${email}.` });
        setReloadKey((k) => k + 1);
      } else {
        setActionFeedback({ type: 'error', message: res?.message || 'Failed to update account status.' });
      }
    } catch (err: any) {
      setActionFeedback({ type: 'error', message: getErrorMessage(err, 'Failed to update account status.') });
    } finally {
      setActingEmail(null);
    }
  };

  const handleGenerateResetCode = async (email: string) => {
    setActionFeedback(null);
    setGeneratedCode(null);
    setCopiedCode(false);
    setActingEmail(email);
    try {
      const res = await api.generateResetCode(email);
      if (res?.success) {
        setGeneratedCode({ email, code: res.resetCode });
        setActionFeedback({ type: 'success', message: `Temporary reset code generated for ${email}.` });
        setReloadKey((k) => k + 1);
      } else {
        setActionFeedback({ type: 'error', message: res?.message || 'Failed to generate reset code.' });
      }
    } catch (err: any) {
      setActionFeedback({ type: 'error', message: getErrorMessage(err, 'Failed to generate reset code.') });
    } finally {
      setActingEmail(null);
    }
  };

  const handleRevokeResetCode = async (email: string) => {
    setActionFeedback(null);
    setActingEmail(email);
    try {
      const res = await api.revokeResetCode(email);
      if (res?.success) {
        if (generatedCode?.email.toLowerCase() === email.toLowerCase()) {
          setGeneratedCode(null);
        }
        setActionFeedback({ type: 'success', message: `Active reset code revoked for ${email}.` });
        setReloadKey((k) => k + 1);
      } else {
        setActionFeedback({ type: 'error', message: res?.message || 'Failed to revoke reset code.' });
      }
    } catch (err: any) {
      setActionFeedback({ type: 'error', message: getErrorMessage(err, 'Failed to revoke reset code.') });
    } finally {
      setActingEmail(null);
    }
  };

  const copyResetCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  if (loading && users.length === 0) {
    return (
      <div>
        <div style={{ height: '35px', width: '150px', marginBottom: '1.5rem' }} className="skeleton" />
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ height: '40px', flex: 1 }} className="skeleton" />
          <div style={{ height: '40px', width: '160px' }} className="skeleton" />
          <div style={{ height: '40px', width: '160px' }} className="skeleton" />
        </div>
        <div style={{ height: '300px' }} className="skeleton" />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header-banner animate-fade-in" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #1E40AF 0%, #2563EB 60%, #3B82F6 100%)',
        position: 'relative',
        gap: '1rem',
        flexWrap: 'wrap'
      }}>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <h1 style={{ fontSize: '1.85rem', fontWeight: 800, fontFamily: 'var(--font-header)', marginBottom: '0.35rem', letterSpacing: '-0.02em', color: '#ffffff' }}>
            User Management
          </h1>
          <p style={{ color: '#E0E7FF', fontSize: '0.92rem', margin: 0 }}>
            Manage VEYRA application users, role assignments, account statuses, and secure password credentials.
          </p>
        </div>
        <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{
            padding: '0.4rem 0.95rem',
            fontSize: '0.78rem',
            fontWeight: 600,
            borderRadius: '9999px',
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            color: '#ffffff',
            backdropFilter: 'blur(8px)'
          }}>
            {users.length > 0 ? `${users.length.toLocaleString()} Application Users` : 'No users'}
          </div>
          {canManage && (
            <button type="button" className="btn btn-primary" onClick={openCreate} style={{ backgroundColor: '#ffffff', color: '#1D4ED8', border: 'none', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <Plus size={15} />
              <span>Create User</span>
            </button>
          )}
        </div>
      </div>

      {actionFeedback && (
        <div className="glass-panel animate-fade-in" style={{
          padding: '0.75rem 1rem',
          borderLeft: `4px solid ${actionFeedback.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)'}`,
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: actionFeedback.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {actionFeedback.type === 'success' ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
            <span>{actionFeedback.message}</span>
          </div>
          <button type="button" onClick={() => setActionFeedback(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {generatedCode && (
        <div className="glass-panel animate-fade-in" style={{
          border: '1px solid rgba(14, 165, 233, 0.3)',
          backgroundColor: 'rgba(14, 165, 233, 0.04)',
          padding: '1.25rem 1.5rem',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.5rem'
        }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem', color: 'var(--accent-blue)' }}>
            <KeyRound size={18} />
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Secure Password Reset Code Generated</h3>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: '1.4', margin: '0 0 0.85rem 0' }}>
            Temporary one-time code for <strong style={{ color: 'var(--text-primary)' }}>{generatedCode.email}</strong>. For safety, this code expires in 1 hour and will not be displayed again.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.6rem 1.15rem',
              fontSize: '1.2rem',
              fontWeight: 700,
              fontFamily: 'monospace',
              letterSpacing: '0.15em',
              color: 'var(--accent-blue)'
            }}>
              {generatedCode.code}
            </div>
            <button
              type="button"
              onClick={() => copyResetCode(generatedCode.code)}
              className="btn btn-secondary"
              style={{ padding: '0.55rem 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
            >
              {copiedCode ? <Check size={14} style={{ color: 'var(--accent-green)' }} /> : <Copy size={14} />}
              <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="glass-panel" role="alert" style={{ padding: '1rem 1.5rem', borderLeft: '4px solid var(--accent-red)', marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--accent-red)', fontSize: '0.85rem', margin: '0 0 0.75rem 0' }}>{error}</p>
          <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
          <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
            <Search size={16} />
          </span>
          <input
            type="text"
            className="form-input"
            style={{ paddingLeft: '2.5rem' }}
            placeholder="Search by name or email..."
            aria-label="Search by name or email"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); resetPage(); }}
          />
          {searchTerm && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => { setSearchTerm(''); resetPage(); }}
              style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <select
          className="form-select"
          aria-label="Filter by role"
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); resetPage(); }}
          style={{ width: '180px' }}
        >
          <option value="ALL">All Roles</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        <select
          className="form-select"
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); resetPage(); }}
          style={{ width: '160px' }}
        >
          <option value="ALL">All Statuses</option>
          <option value="ACTIVE">Active Users</option>
          <option value="INACTIVE">Inactive Users</option>
        </select>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          Showing <strong>{filteredUsers.length > 0 ? ((safePage - 1) * pageSize + 1).toLocaleString() : 0}</strong>–<strong>{Math.min(safePage * pageSize, filteredUsers.length).toLocaleString()}</strong> of <strong>{filteredUsers.length.toLocaleString()}</strong> users
          {loading && <span style={{ marginLeft: '0.5rem', color: 'var(--accent-blue)', fontSize: '0.75rem' }}>(updating...)</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span>Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); resetPage(); }}
            className="form-select"
            style={{ width: '80px', padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </div>
      </div>

      <div className="table-container" style={{ margin: 0, overflowX: 'auto' }}>
        <table className="enterprise-table">
          <thead>
            <tr>
              <th>Application User</th>
              <th>Role</th>
              <th>Account Status</th>
              <th>Reset Code</th>
              <th>Last Login</th>
              <th style={{ textAlign: 'right' }}>Security Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                  No users match the search/filter criteria.
                </td>
              </tr>
            ) : (
              pageItems.map((user: any) => {
                const active = user.isActive ?? user.status === 'ACTIVE';
                const key = String(user.userId || user.id || user.email);
                const email = String(user.email || '');
                const isSelf = email.toLowerCase() === currentSessionEmail;
                const hasActiveResetCode = Boolean(user.hasResetCode || user.resetCodeStatus === 'active' || (generatedCode?.email.toLowerCase() === email.toLowerCase()));

                return (
                  <tr key={key}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user.displayName || '—'}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.15rem' }}>
                        <span>{email || 'N/A'}</span>
                        {isSelf && (
                          <span style={{
                            fontSize: '0.65rem',
                            padding: '0.1rem 0.4rem',
                            borderRadius: '9999px',
                            backgroundColor: 'rgba(59, 130, 246, 0.12)',
                            color: 'var(--accent-blue)',
                            fontWeight: 600
                          }}>
                            You
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="badge" style={{
                        backgroundColor: user.role === 'SITE_ADMIN' ? 'rgba(217, 119, 6, 0.12)' : 'rgba(59, 130, 246, 0.12)',
                        color: user.role === 'SITE_ADMIN' ? 'var(--accent-gold)' : 'var(--accent-blue)',
                        border: `1px solid ${user.role === 'SITE_ADMIN' ? 'rgba(217, 119, 6, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`
                      }}>
                        {getRoleLabel(user.role)}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                        <span className={`badge ${active ? 'badge-active' : 'badge-inactive'}`}>
                          {active ? 'Active' : 'Disabled'}
                        </span>
                        {canManage && (
                          <button
                            type="button"
                            disabled={isSelf || actingEmail === email}
                            onClick={() => handleToggleStatus(email, active)}
                            className="btn btn-secondary"
                            style={{
                              padding: '0.2rem 0.45rem',
                              fontSize: '0.72rem',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.2rem',
                              cursor: isSelf ? 'not-allowed' : 'pointer',
                              opacity: isSelf ? 0.4 : 1
                            }}
                            title={isSelf ? 'Cannot deactivate yourself' : active ? 'Disable user access' : 'Activate user access'}
                          >
                            <Power size={11} style={{ color: active ? 'var(--accent-red)' : 'var(--accent-green)' }} />
                            <span>{active ? 'Disable' : 'Enable'}</span>
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      {hasActiveResetCode ? (
                        <span className="badge" style={{ backgroundColor: 'rgba(217, 119, 6, 0.12)', color: 'var(--accent-gold)', border: '1px solid rgba(217, 119, 6, 0.3)' }}>
                          Active (1h)
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>None</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {formatLastLogin(user.lastLoginAt)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {canManage ? (
                        <span style={{ display: 'inline-flex', gap: '0.4rem', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          {hasActiveResetCode ? (
                            <button
                              type="button"
                              title="Revoke active reset code"
                              disabled={actingEmail === email}
                              onClick={() => handleRevokeResetCode(email)}
                              className="btn btn-secondary"
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                            >
                              <X size={12} style={{ color: 'var(--accent-red)' }} />
                              <span>Revoke Code</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              title="Generate secure password reset code"
                              disabled={actingEmail === email}
                              onClick={() => handleGenerateResetCode(email)}
                              className="btn btn-secondary"
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                            >
                              <KeyRound size={12} style={{ color: 'var(--accent-blue)' }} />
                              <span>Reset Password</span>
                            </button>
                          )}
                          <button
                            type="button"
                            title="Edit user"
                            aria-label={`Edit ${user.email}`}
                            onClick={() => openEdit(user)}
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                          >
                            <Pencil size={12} />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            title={isSelf ? 'Cannot delete yourself' : 'Delete user'}
                            aria-label={`Delete ${user.email}`}
                            disabled={isSelf}
                            onClick={() => { setModalError(''); setDeletingUser(user); }}
                            className="btn btn-secondary"
                            style={{
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.72rem',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              color: isSelf ? 'var(--text-muted)' : 'var(--accent-red)',
                              borderColor: isSelf ? 'var(--border-color)' : 'rgba(220, 38, 38, 0.25)',
                              cursor: isSelf ? 'not-allowed' : 'pointer',
                              opacity: isSelf ? 0.4 : 1
                            }}
                          >
                            <Trash2 size={12} />
                            <span>Delete</span>
                          </button>
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', padding: '0.75rem 0.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Page <strong>{safePage}</strong> of <strong>{totalPages}</strong> ({filteredUsers.length.toLocaleString()} total users)
          </div>
          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            <button type="button" className="btn btn-secondary" disabled={safePage <= 1} onClick={() => setCurrentPage(safePage - 1)} style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem' }}>
              Prev
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).slice(0, 7).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setCurrentPage(p)}
                style={{
                  padding: '0.3rem 0.65rem',
                  fontSize: '0.78rem',
                  borderRadius: '6px',
                  border: p === safePage ? '1px solid var(--accent-blue)' : '1px solid var(--border-color)',
                  background: p === safePage ? 'var(--accent-blue)' : 'transparent',
                  color: p === safePage ? '#fff' : 'var(--text-primary)',
                  cursor: 'pointer',
                  fontWeight: p === safePage ? 700 : 500
                }}
              >
                {p}
              </button>
            ))}
            <button type="button" className="btn btn-secondary" disabled={safePage >= totalPages} onClick={() => setCurrentPage(safePage + 1)} style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem' }}>
              Next
            </button>
          </div>
        </div>
      )}

      {(showCreate || editingUser) && (
        <div role="dialog" aria-modal="true" aria-label={showCreate ? 'Create user' : 'Edit user'} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }} onClick={() => { setShowCreate(false); setEditingUser(null); }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '480px', padding: '1.75rem' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>{showCreate ? 'Create New User' : 'Edit User'}</h3>
              <button type="button" aria-label="Close" onClick={() => { setShowCreate(false); setEditingUser(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                <X size={18} />
              </button>
            </div>
            {modalError && (
              <div role="alert" style={{ padding: '0.65rem 0.9rem', borderLeft: '4px solid var(--accent-red)', backgroundColor: 'rgba(239, 68, 68, 0.06)', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.83rem', color: 'var(--accent-red)' }}>
                {modalError}
              </div>
            )}
            {showCreate && createdEmail ? (
              <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                <div role="status" style={{ padding: '0.9rem 1rem', borderLeft: '4px solid var(--accent-green)', backgroundColor: 'rgba(16, 185, 129, 0.06)', borderRadius: '6px', marginBottom: '1.25rem', fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                  {modalSuccess || `User ${createdEmail} created.`}
                </div>
                <button type="button" className="btn btn-primary" style={{ width: '100%', padding: '0.7rem' }} onClick={() => { setShowCreate(false); setCreatedEmail(''); }}>
                  Back to Users List
                </button>
              </div>
            ) : (
            <form onSubmit={showCreate ? handleCreate : handleEdit}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>Full Name *</label>
              <input className="form-input" style={{ width: '100%', marginBottom: nameError ? '0.3rem' : '0.9rem' }} placeholder="Enter full name" value={formName} onChange={(e) => { setFormName(e.target.value); if (showCreate) setFieldErrors((p) => ({ ...p, name: undefined })); }} onBlur={() => setTouched((t) => ({ ...t, name: true }))} aria-invalid={!!nameError} />
              {nameError && <div role="alert" style={{ color: 'var(--accent-red)', fontSize: '0.78rem', marginBottom: '0.9rem' }}>{nameError}</div>}
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>Email (Microsoft ID) *</label>
              <input className="form-input" style={{ width: '100%', marginBottom: emailError ? '0.3rem' : '0.9rem' }} placeholder="user@company.com" value={formEmail} disabled={!showCreate} onChange={(e) => { setFormEmail(e.target.value); if (showCreate) setFieldErrors((p) => ({ ...p, email: undefined })); }} onBlur={() => setTouched((t) => ({ ...t, email: true }))} aria-invalid={!!emailError} />
              {emailError && <div role="alert" style={{ color: 'var(--accent-red)', fontSize: '0.78rem', marginBottom: '0.9rem' }}>{emailError}</div>}
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>Role *</label>
              <select className="form-select" style={{ width: '100%', marginBottom: roleError ? '0.3rem' : '0.9rem' }} value={showCreate ? effectiveRole : formRole} disabled={showCreate && adminLocked} onChange={(e) => { setFormRole(e.target.value); if (showCreate) setFieldErrors((p) => ({ ...p, role: undefined })); }} aria-invalid={!!roleError}>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              {roleError && <div role="alert" style={{ color: 'var(--accent-red)', fontSize: '0.78rem', marginBottom: '0.9rem' }}>{roleError}</div>}
              {showCreate && adminLocked && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.55rem 0.75rem', marginBottom: '0.9rem' }}>
                  Site Admin uses local VEYRA authentication — it is never redirected to Microsoft Entra ID.
                </div>
              )}
              {showCreate && (
                <>
                  <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>Application Access (Oracle) *</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: accessError ? '0.3rem' : '0.9rem' }}>
                    {APP_ACCESS_OPTIONS.map((a) => (
                      <label key={a} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={formAccess.includes(a)}
                          onChange={() => {
                            setFormAccess((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
                            setFieldErrors((p) => ({ ...p, access: undefined }));
                          }}
                        />
                        <span>{a}</span>
                      </label>
                    ))}
                  </div>
                  {accessError && <div role="alert" style={{ color: 'var(--accent-red)', fontSize: '0.78rem', marginBottom: '0.9rem' }}>{accessError}</div>}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', marginBottom: '0.35rem' }}>
                    <input type="checkbox" checked={sendInvitation} onChange={(e) => setSendInvitation(e.target.checked)} />
                    <span>Send invitation email to user</span>
                  </label>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
                    Phase 1 creates the account directly — no Microsoft Entra invitation is sent. Invitation emails arrive with Entra integration.
                  </div>
                </>
              )}
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>Status</label>
              <select className="form-select" style={{ width: '100%', marginBottom: '0.9rem' }} value={formStatus} onChange={(e) => setFormStatus(e.target.value)}>
                <option value="ACTIVE">Active</option>
                <option value="DISABLED">Inactive</option>
              </select>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>{showCreate ? 'Password (optional)' : 'New password (optional)'}</label>
              <input className="form-input" type="password" style={{ width: '100%', marginBottom: '1.25rem' }} placeholder={showCreate ? 'Leave blank to set later' : 'Leave blank to keep current'} value={formPassword} onChange={(e) => setFormPassword(e.target.value)} autoComplete="new-password" />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowCreate(false); setEditingUser(null); setCreatedEmail(''); }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting || (showCreate && !createValid)}>
                  {submitting ? 'Saving...' : showCreate ? 'Create User' : 'Save Changes'}
                </button>
              </div>
            </form>
            )}
          </div>
        </div>
      )}

      {deletingUser && (
        <div role="dialog" aria-modal="true" aria-label="Confirm delete user" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }} onClick={() => setDeletingUser(null)}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '440px', padding: '1.75rem' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.6rem 0' }}>Delete user?</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: '0 0 1rem 0' }}>
              Are you sure you want to delete this user?
            </p>
            <p style={{ fontSize: '0.88rem', fontWeight: 600, margin: '0 0 1.25rem 0', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {String(deletingUser.email || deletingUser.displayName || '')}
            </p>
            {modalError && (
              <div role="alert" style={{ padding: '0.65rem 0.9rem', borderLeft: '4px solid var(--accent-red)', backgroundColor: 'rgba(239, 68, 68, 0.06)', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.83rem', color: 'var(--accent-red)' }}>
                {modalError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setDeletingUser(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={submitting} onClick={handleDelete} style={{ backgroundColor: '#DC2626' }}>
                {submitting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalSuccess && !showCreate && !editingUser && !deletingUser && (
        <div role="status" style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', backgroundColor: '#059669', color: '#fff', padding: '0.7rem 1.1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 1000 }}>
          {modalSuccess}
        </div>
      )}
    </div>
  );
}
