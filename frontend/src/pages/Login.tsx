import React, { useState } from 'react';
import { ShieldCheck, Lock, Mail, AlertCircle, ArrowLeft, Key, Check, X, Eye, EyeOff, Shield, Users, FileText } from 'lucide-react';
import { api } from '../services/api';
import { normalizeEmail, validateLoginInputs, mapLoginError, type LoginFieldErrors } from '../utils/loginValidation';

interface LoginProps {
  onLoginSuccess: (username: string, token: string, envMode?: 'DEMO' | 'ORACLE_FUSION') => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Tab control: 'LOGIN' or 'RESET_PASSWORD'
  const [view, setView] = useState<'LOGIN' | 'RESET_PASSWORD'>('LOGIN');

  // Reset Password form fields
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Password criteria checks
  const criteria = {
    length: newPassword.length >= 8,
    upper: /[A-Z]/.test(newPassword),
    lower: /[a-z]/.test(newPassword),
    number: /[0-9]/.test(newPassword),
    special: /[!@#$%^&*(),.?":{}|<>]/.test(newPassword)
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // AC9 — never stack concurrent login requests
    if (loading) return;
    setError('');
    setSuccessMsg('');

    // AC2/AC3/AC4 — client-side validation first; no API call when invalid
    const errs = validateLoginInputs(email, password);
    setFieldErrors(errs);
    if (errs.email || errs.password) return;

    // AC2 — trim + case-insensitive; AC8 — admin@admin.com stays on this local flow
    const cleanEmail = normalizeEmail(email);

    setLoading(true);
    try {
      // ponytail: Entra ID seam — Phase 2 routes non-admin users to Microsoft
      // Entra ID here; admin@admin.com must always stay on this local VEYRA flow.
      // AC5 — local VEYRA auth only; frontend never touches the database directly.
      const res = await api.login({ email: cleanEmail, password });
      if (res.success && res.token) {
        onLoginSuccess(res.email, res.token, res.environmentMode);
      } else {
        // AC6/AC7/AC10 — mapped, never raw backend text
        setError(mapLoginError(res.message || 'Login failed.'));
      }
    } catch (err: any) {
      setError(mapLoginError(err?.message || ''));
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const cleanEmail = resetEmail.trim().toLowerCase();
    if (!cleanEmail || !resetCode || !newPassword || !confirmPassword) {
      setError('Please fill in all security fields.');
      return;
    }

    const emailRegex = /^[a-zA-Z]+\.[a-zA-Z]+@claaps\.com$/i;
    if (!emailRegex.test(cleanEmail)) {
      setError('Invalid company email format.');
      return;
    }

    // Password criteria check
    const allCriteriaMet = Object.values(criteria).every(Boolean);
    if (!allCriteriaMet) {
      setError('Password does not meet the safety requirements listed below.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.resetPassword({
        email: cleanEmail,
        resetCode: resetCode.trim(),
        newPassword
      });
      if (res.success) {
        setSuccessMsg(res.message || 'Password reset successful. You can now sign in.');
        setView('LOGIN');
        // Clear fields
        setEmail(cleanEmail);
        setPassword('');
        setResetEmail('');
        setResetCode('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setError(mapLoginError(res.message || 'Failed to reset password.'));
      }
    } catch (err: any) {
      setError(mapLoginError(err?.message || ''));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="veyra-login-page">
      <style>{`
        .veyra-login-page {
          display: flex;
          min-height: 100vh;
          width: 100vw;
          background: #eaf1fb;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          box-sizing: border-box;
        }
        .veyra-login-brand {
          flex: 1 1 42%;
          background: linear-gradient(160deg, #0a2540 0%, #123a6d 55%, #1d4ed8 100%);
          color: #fff;
          padding: 3rem 2.5rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 1.75rem;
          position: relative;
          overflow: hidden;
        }
        .veyra-login-brand::after {
          content: "";
          position: absolute;
          inset: auto -6rem -6rem auto;
          width: 22rem;
          height: 22rem;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.08);
        }
        .veyra-login-form-wrap {
          flex: 1 1 58%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem 1.5rem;
          box-sizing: border-box;
        }
        .veyra-login-card {
          background: #fff;
          border: 1px solid #dbe5f3;
          border-radius: 12px;
          box-shadow: 0 20px 40px -18px rgba(10, 37, 64, 0.25);
          max-width: 430px;
          width: 100%;
          padding: 2.25rem 2rem;
          box-sizing: border-box;
        }
        .veyra-field-error {
          color: #dc2626;
          font-size: 0.78rem;
          margin-top: 0.35rem;
        }
        .veyra-input-invalid {
          border-color: #dc2626 !important;
        }
        @media (max-width: 860px) {
          .veyra-login-brand { display: none; }
        }
      `}</style>

      {/* Left brand panel — Mock Screen 1 */}
      <div className="veyra-login-brand">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src="/logo.png" alt="VEYRA logo" style={{ height: '44px', width: 'auto', objectFit: 'contain' }} />
          <span style={{ fontSize: '1.9rem', fontWeight: 800, letterSpacing: '0.04em' }}>VEYRA</span>
        </div>
        <div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>Audit Intelligence Platform</div>
          <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.9rem', marginTop: '0.35rem' }}>
            Trusted data. Deeper insights. Stronger audits.
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.92rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Shield size={18} /> <span>Secure Access</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Users size={18} /> <span>Role-based Experience</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <FileText size={18} /> <span>Audit-Ready Insights</span>
          </div>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.78rem', marginTop: '1rem' }}>
          From Access to Insight — Powered for Audit.
        </div>
      </div>

      {/* Right sign-in card */}
      <div className="veyra-login-form-wrap">
        <div className="veyra-login-card animate-fade-in">
          <div style={{ marginBottom: '1.5rem' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, color: '#0a2540' }}>Sign in</h1>
            <p style={{ color: '#64748b', fontSize: '0.88rem', margin: '0.3rem 0 0' }}>
              to continue to VEYRA
            </p>
          </div>

          {error && (
            <div role="alert" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: '8px',
              padding: '0.7rem 0.9rem',
              color: '#b91c1c',
              fontSize: '0.85rem',
              marginBottom: '1.25rem'
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div role="status" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              borderRadius: '8px',
              padding: '0.7rem 0.9rem',
              color: '#047857',
              fontSize: '0.85rem',
              marginBottom: '1.25rem'
            }}>
              <ShieldCheck size={16} style={{ flexShrink: 0 }} />
              <span>{successMsg}</span>
            </div>
          )}

          {view === 'LOGIN' ? (
            <form onSubmit={handleLoginSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
              <div>
                <label htmlFor="veyra-email" style={{ display: 'block', fontSize: '0.78rem', color: '#475569', marginBottom: '0.4rem', fontWeight: 600 }}>
                  Email
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                    <Mail size={17} />
                  </span>
                  <input
                    id="veyra-email"
                    type="email"
                    name="username"
                    className={`form-input${fieldErrors.email ? ' veyra-input-invalid' : ''}`}
                    style={{ paddingLeft: '2.5rem', width: '100%', boxSizing: 'border-box' }}
                    placeholder="someone@company.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setFieldErrors(prev => ({ ...prev, email: undefined })); }}
                    disabled={loading}
                    autoComplete="username"
                    aria-invalid={!!fieldErrors.email}
                    aria-describedby={fieldErrors.email ? 'veyra-email-error' : undefined}
                  />
                </div>
                {fieldErrors.email && <div id="veyra-email-error" role="alert" className="veyra-field-error">{fieldErrors.email}</div>}
              </div>

              <div>
                <label htmlFor="veyra-password" style={{ display: 'block', fontSize: '0.78rem', color: '#475569', marginBottom: '0.4rem', fontWeight: 600 }}>
                  Password
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                    <Lock size={17} />
                  </span>
                  <input
                    id="veyra-password"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    className={`form-input${fieldErrors.password ? ' veyra-input-invalid' : ''}`}
                    style={{ paddingLeft: '2.5rem', paddingRight: '2.5rem', width: '100%', boxSizing: 'border-box' }}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setFieldErrors(prev => ({ ...prev, password: undefined })); }}
                    disabled={loading}
                    autoComplete="current-password"
                    aria-invalid={!!fieldErrors.password}
                    aria-describedby={fieldErrors.password ? 'veyra-password-error' : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(prev => !prev)}
                    disabled={loading}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    style={{ position: 'absolute', right: '0.7rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.15rem', display: 'flex' }}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                {fieldErrors.password && <div id="veyra-password-error" role="alert" className="veyra-field-error">{fieldErrors.password}</div>}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontSize: '0.8rem' }}>
                <button
                  type="button"
                  onClick={() => setView('RESET_PASSWORD')}
                  style={{ background: 'none', border: 'none', color: '#1d4ed8', cursor: 'pointer', outline: 'none', fontSize: '0.8rem', fontWeight: 600, padding: 0 }}
                >
                  Can&apos;t access your account?
                </button>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', padding: '0.7rem', background: '#1d4ed8', borderColor: '#1d4ed8' }}
                disabled={loading}
                aria-busy={loading}
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>

              <div style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: 1.5, borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                  <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: '0.15rem', color: '#1d4ed8' }} />
                  <span>Your organization&apos;s security policies apply. Microsoft Entra ID sign-in arrives in a future phase — Site Admin (admin@admin.com) always signs in here.</span>
                </div>
              </div>
            </form>
          ) : (
            <form onSubmit={handleResetSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setView('LOGIN')}
                  style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 0 }}
                >
                  <ArrowLeft size={16} />
                </button>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Back to Sign In</span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Corporate Email
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="name.surname@claaps.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Reset Code
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                    <Key size={16} />
                  </span>
                  <input
                    type="text"
                    className="form-input"
                    style={{ paddingLeft: '2.5rem' }}
                    placeholder="Enter 8-digit alphanumeric code"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  New Password
                </label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Choose a strong password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Confirm Password
                </label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Confirm your new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div style={{
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '0.75rem 1rem',
                fontSize: '0.75rem',
                color: '#475569',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem'
              }}>
                <span style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Secure Password Requirements:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {criteria.length ? <Check size={12} style={{ color: '#059669' }} /> : <X size={12} style={{ color: '#dc2626' }} />}
                  <span>At least 8 characters long</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {criteria.upper && criteria.lower ? <Check size={12} style={{ color: '#059669' }} /> : <X size={12} style={{ color: '#dc2626' }} />}
                  <span>Contains uppercase & lowercase letters</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {criteria.number ? <Check size={12} style={{ color: '#059669' }} /> : <X size={12} style={{ color: '#dc2626' }} />}
                  <span>Contains at least one number</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {criteria.special ? <Check size={12} style={{ color: '#059669' }} /> : <X size={12} style={{ color: '#dc2626' }} />}
                  <span>Contains at least one special character</span>
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', padding: '0.75rem', marginTop: '0.5rem' }}
                disabled={loading}
              >
                {loading ? 'Changing Password...' : 'Save & Update Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
