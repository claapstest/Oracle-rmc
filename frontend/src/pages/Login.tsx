import React, { useState } from 'react';
import { ShieldCheck, Lock, User, AlertCircle, ArrowLeft, Key, Info, Check, X } from 'lucide-react';
import { api } from '../services/api';

interface LoginProps {
  onLoginSuccess: (username: string, token: string, envMode?: 'DEMO' | 'ORACLE_FUSION') => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    setError('');
    setSuccessMsg('');

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setError('Please fill in both email and password.');
      return;
    }

    // Client-side quick validation for company domain
    const emailRegex = /^[a-zA-Z]+\.[a-zA-Z]+@claaps\.com$/i;
    if (!emailRegex.test(cleanEmail)) {
      setError('Access restricted to company emails only (<firstname>.<lastname>@claaps.com).');
      return;
    }

    setLoading(true);
    try {
      const res = await api.login({ email: cleanEmail, password });
      if (res.success && res.token) {
        onLoginSuccess(res.email, res.token, res.environmentMode);
      } else {
        setError(res.message || 'Login failed.');
      }
    } catch (err: any) {
      setError(err.message || 'Incorrect email or password.');
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
        setError(res.message || 'Failed to reset password.');
      }
    } catch (err: any) {
      setError(err.message || 'Invalid or expired reset code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      width: '100vw',
      background: 'var(--bg-primary)',
      padding: '1.5rem',
      boxSizing: 'border-box'
    }}>
      <div className="glass-panel animate-fade-in" style={{
        maxWidth: '480px',
        width: '100%',
        padding: '2.5rem',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 20px 40px -15px rgba(15, 23, 42, 0.08)'
      }}>
        
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1.25rem'
          }}>
            <img src="/logo.png" alt="CLAAPS VEYRA Logo" style={{ height: '76px', width: 'auto', objectFit: 'contain' }} />
          </div>
          
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'var(--font-header)', marginBottom: '0.25rem', letterSpacing: '-0.01em' }}>
            CLAAPS <span style={{ color: 'var(--accent-blue)' }}>VEYRA</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Security & Risk Intelligence Assistant
          </p>
        </div>

        {/* Feedback Alert Boxes */}
        {error && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.75rem 1rem',
            color: 'var(--accent-red)',
            fontSize: '0.85rem',
            marginBottom: '1.5rem'
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.75rem 1rem',
            color: 'var(--accent-green)',
            fontSize: '0.85rem',
            marginBottom: '1.5rem'
          }}>
            <ShieldCheck size={16} style={{ flexShrink: 0 }} />
            <span>{successMsg}</span>
          </div>
        )}

        {view === 'LOGIN' ? (
          <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Corporate Email
              </label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
                  <User size={18} />
                </span>
                <input
                  type="text"
                  name="username"
                  className="form-input"
                  style={{ paddingLeft: '2.75rem' }}
                  placeholder="name.surname@claaps.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  autoComplete="username"
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
                  <Lock size={18} />
                </span>
                <input
                  type="password"
                  name="password"
                  className="form-input"
                  style={{ paddingLeft: '2.75rem' }}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="current-password"
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input type="checkbox" style={{ accentColor: 'var(--accent-gold)' }} defaultChecked />
                <span>Remember environment</span>
              </label>
              <button 
                type="button"
                onClick={() => setView('RESET_PASSWORD')}
                style={{ background: 'none', border: 'none', color: 'var(--accent-gold)', cursor: 'pointer', outline: 'none', fontSize: '0.8rem', fontWeight: 600 }}
              >
                Reset Password?
              </button>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.75rem', marginTop: '0.5rem' }}
              disabled={loading}
            >
              {loading ? 'Verifying Credentials...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleResetSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <button 
                type="button" 
                onClick={() => setView('LOGIN')}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }}
              >
                <ArrowLeft size={16} />
              </button>
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Back to Sign In</span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Reset Code
              </label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
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
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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

            {/* Password Policy visual checklist */}
            <div style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.75rem 1rem',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem'
            }}>
              <span style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Secure Password Requirements:</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {criteria.length ? <Check size={12} style={{ color: 'var(--accent-green)' }} /> : <X size={12} style={{ color: 'var(--accent-red)' }} />}
                <span>At least 8 characters long</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {criteria.upper && criteria.lower ? <Check size={12} style={{ color: 'var(--accent-green)' }} /> : <X size={12} style={{ color: 'var(--accent-red)' }} />}
                <span>Contains uppercase & lowercase letters</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {criteria.number ? <Check size={12} style={{ color: 'var(--accent-green)' }} /> : <X size={12} style={{ color: 'var(--accent-red)' }} />}
                <span>Contains at least one number</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {criteria.special ? <Check size={12} style={{ color: 'var(--accent-green)' }} /> : <X size={12} style={{ color: 'var(--accent-red)' }} />}
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

        <div style={{
          marginTop: '2rem',
          borderTop: '1px solid var(--border-color)',
          paddingTop: '1.25rem',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          lineHeight: '1.4'
        }}>
          <p style={{ marginBottom: '0.5rem' }}>
            🔒 <strong>Enterprise Access Only</strong>
          </p>
          <p>
            By logging in, you agree to monitor user privileges and security configurations under policy guidelines. All audit operations are logged dynamically.
          </p>
        </div>

      </div>
    </div>
  );
}
