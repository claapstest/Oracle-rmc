import React, { useEffect, useState } from 'react';
import { 
  Settings as SettingsIcon, 
  Link2, 
  Key, 
  CheckCircle2, 
  AlertOctagon, 
  RefreshCw,
  Search,
  Shield,
  Lock,
  Copy,
  Check,
  X,
  Power,
  KeyRound,
  ShieldAlert,
  Info,
  Trash2,
  Database
} from 'lucide-react';
import { api } from '../services/api.js';
import { TableExportControl } from '../components/TableExportControl';

interface SettingsProps {
  environmentMode: 'DEMO' | 'ORACLE_FUSION';
  setEnvironmentMode: (mode: 'DEMO' | 'ORACLE_FUSION') => void;
  currentUser: string;
}

export default function Settings({ environmentMode, setEnvironmentMode, currentUser }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<'INTEGRATION' | 'USER_MANAGEMENT'>('INTEGRATION');

  // Integration Settings states
  const [baseUrl, setBaseUrl] = useState('');
  const [authType, setAuthType] = useState<'BASIC' | 'BEARER'>('BASIC');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [groqModel, setGroqModel] = useState('');
  const [serverState, setServerState] = useState<any>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; status?: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(true);

  // User Management states
  const [users, setUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<{ email: string; code: string } | null>(null);
  const [userActionError, setUserActionError] = useState('');
  const [userActionSuccess, setUserActionSuccess] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  // Delete account confirmation modal states
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Role & Privilege Catalog states
  const [catalogMetadata, setCatalogMetadata] = useState<any>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [catalogSyncMessage, setCatalogSyncMessage] = useState('');

  useEffect(() => {
    async function loadSettings() {
      setLoading(true);
      try {
        const configState = await api.getSettings();
        setServerState(configState);
        setBaseUrl(configState.baseUrl || '');
        setAuthType(configState.authType || 'BASIC');
        setUsername(configState.username || '');
        setGroqModel(configState.groqModel || 'llama-3.3-70b-versatile');
        setIsAdmin(true);
      } catch (err) {
        console.error('Failed to retrieve configurations:', err);
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
    fetchCatalogStatus();
  }, []);

  const fetchCatalogStatus = async () => {
    setLoadingCatalog(true);
    try {
      const res = await api.getRolePrivilegeCatalogStatus();
      if (res?.success && res?.catalog) {
        setCatalogMetadata(res.catalog);
        if (res.catalog.status === 'SYNCING') {
          setSyncingCatalog(true);
        } else {
          setSyncingCatalog(false);
        }
      }
    } catch (err: any) {
      console.warn('Failed to fetch catalog status:', err.message);
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    let timer: any = null;
    if (syncingCatalog) {
      timer = setInterval(async () => {
        try {
          const res = await api.getRolePrivilegeCatalogStatus();
          if (res?.success && res?.catalog) {
            setCatalogMetadata(res.catalog);
            if (res.catalog.status !== 'SYNCING') {
              setSyncingCatalog(false);
              setCatalogSyncMessage('Role & Privilege Catalog synchronization completed successfully.');
            }
          }
        } catch {
          // ignore polling error
        }
      }, 3000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [syncingCatalog]);

  const handleRefreshCatalog = async () => {
    setSyncingCatalog(true);
    setCatalogSyncMessage('Synchronization running in background. Active catalog continues serving chatbot queries.');
    try {
      const res = await api.syncRolePrivilegeCatalog();
      if (res?.success) {
        await fetchCatalogStatus();
      } else {
        setCatalogSyncMessage(res?.message || 'Synchronization request failed.');
        setSyncingCatalog(false);
      }
    } catch (err: any) {
      setCatalogSyncMessage(err.message || 'Error initiating synchronization.');
      setSyncingCatalog(false);
    }
  };

  const fetchUsers = async () => {
    setLoadingUsers(true);
    setUserActionError('');
    try {
      const res = await api.getAdminUsers();
      if (res.success) {
        setUsers(res.users);
      }
    } catch (err: any) {
      setUserActionError(err.message || 'Failed to fetch registered application users.');
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'USER_MANAGEMENT') {
      fetchUsers();
      setGeneratedCode(null);
    }
  }, [activeTab]);

  const validateAndNormalizeUrl = (url: string): string => {
    let trimmed = url.trim();
    if (!trimmed) {
      throw new Error('Base URL is required.');
    }
    if (trimmed.includes('?') || trimmed.includes('#')) {
      throw new Error('Base URL must not contain query parameters (?) or fragments (#).');
    }
    if (!trimmed.startsWith('https://')) {
      if (trimmed.startsWith('http://')) {
        throw new Error('Secure connection (https://) is required.');
      } else {
        trimmed = 'https://' + trimmed;
      }
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch (err) {
      throw new Error('Invalid URL format. Please enter a valid URL.');
    }
    if (parsed.pathname && parsed.pathname !== '/' && parsed.pathname.toLowerCase() !== '') {
      throw new Error("Please enter only the Base URL (e.g., https://example.oraclecloud.com) without any path (e.g., /hcmRestApi/...)");
    }
    return `${parsed.protocol}//${parsed.host}`;
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const normalizedBaseUrl = validateAndNormalizeUrl(baseUrl);
      setBaseUrl(normalizedBaseUrl);
      const res = await api.testSettingsConnection({
        baseUrl: normalizedBaseUrl,
        authType,
        username,
        password: password || undefined,
        token: token || undefined,
      });
      setTestResult(res);
    } catch (err) {
      setTestResult({ success: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveStatus('');
    try {
      const normalizedBaseUrl = validateAndNormalizeUrl(baseUrl);
      setBaseUrl(normalizedBaseUrl);
      const res = await api.saveSettings({
        mode: 'ORACLE_FUSION' as const,
        baseUrl: normalizedBaseUrl,
        authType,
        username,
        password: password || undefined,
        token: token || undefined,
        groqModel,
      });
      setEnvironmentMode(res.settings.mode);
      setServerState(res.settings);
      setSaveStatus('Configuration saved successfully.');
      setPassword('');
      setToken('');
    } catch (err) {
      setSaveStatus(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // User Administration Handlers
  const handleToggleStatus = async (email: string, currentActive: boolean) => {
    setUserActionError('');
    setUserActionSuccess('');
    if (email.toLowerCase() === currentUser.toLowerCase()) {
      setUserActionError('Security Policy: Administrators cannot deactivate their own accounts.');
      return;
    }
    try {
      const res = await api.toggleUserAccountStatus(email, !currentActive);
      if (res.success) {
        setUserActionSuccess(`Status updated for ${email}`);
        fetchUsers();
      }
    } catch (err: any) {
      setUserActionError(err.message || 'Failed to update account status.');
    }
  };

  const handleGenerateResetCode = async (email: string) => {
    setUserActionError('');
    setUserActionSuccess('');
    setGeneratedCode(null);
    setCopiedCode(false);
    try {
      const res = await api.generateResetCode(email);
      if (res.success) {
        setGeneratedCode({ email, code: res.resetCode });
        setUserActionSuccess(`Temporary reset code generated for ${email}`);
        fetchUsers();
      }
    } catch (err: any) {
      setUserActionError(err.message || 'Failed to generate reset code.');
    }
  };

  const handleRevokeResetCode = async (email: string) => {
    setUserActionError('');
    setUserActionSuccess('');
    try {
      const res = await api.revokeResetCode(email);
      if (res.success) {
        setUserActionSuccess(`Active reset code revoked for ${email}`);
        if (generatedCode?.email === email) {
          setGeneratedCode(null);
        }
        fetchUsers();
      }
    } catch (err: any) {
      setUserActionError(err.message || 'Failed to revoke reset code.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;

    setIsDeleting(true);
    setDeleteError('');
    setUserActionError('');
    setUserActionSuccess('');

    try {
      const res = await api.deleteUserAccount(deleteTarget.email);
      if (res.success) {
        setUserActionSuccess(res.message || `Account for ${deleteTarget.email} has been permanently deleted.`);
        setDeleteTarget(null);
        await fetchUsers();
      } else {
        setDeleteError(res.message || 'Failed to delete user account.');
      }
    } catch (err: any) {
      console.error('Delete user failed:', err);
      setDeleteError(err.message || 'Failed to delete user account.');
    } finally {
      setIsDeleting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const filteredUsers = users.filter(u => 
    u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  if (!isAdmin) {
    return (
      <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto', textAlign: 'center', marginTop: '4rem' }}>
        <div className="glass-panel animate-fade-in" style={{ padding: '3rem', borderRadius: 'var(--radius-lg)' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            color: 'var(--accent-red)',
            marginBottom: '1.5rem'
          }}>
            <AlertOctagon size={32} />
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
            Access Denied
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.5', marginBottom: '1.5rem' }}>
            You do not have administrative privileges to access the settings panel. 
            Please sign in as an authorized administrator to view this page.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem' }}>
        <div style={{ height: '35px', width: '150px', marginBottom: '1.5rem' }} className="skeleton" />
        <div style={{ height: '200px' }} className="skeleton" />
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: activeTab === 'USER_MANAGEMENT' ? '1400px' : '960px', width: '100%', margin: '0 auto', transition: 'max-width 0.25s ease' }}>
      
      {/* Settings Blue Gradient Banner */}
      <div className="page-header-banner animate-fade-in" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #1E40AF 0%, #2563EB 60%, #3B82F6 100%)',
        position: 'relative',
        marginBottom: '2rem'
      }}>
        {/* Subtle Wave Curve overlay */}
        <svg 
          viewBox="0 0 1440 240" 
          preserveAspectRatio="none" 
          style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, opacity: 0.9 }}
        >
          <path fill="rgba(255, 255, 255, 0.08)" d="M0,120 C320,190,480,50,800,130 C1120,210,1280,80,1440,120 L1440,240 L0,240 Z" />
          <path fill="rgba(96, 165, 250, 0.15)" d="M0,170 C360,90,600,210,960,140 C1200,90,1360,180,1440,150 L1440,240 L0,240 Z" />
        </svg>

        <div style={{ position: 'relative', zIndex: 2 }}>
          <h1 style={{ fontSize: '1.85rem', fontWeight: 800, fontFamily: 'var(--font-header)', marginBottom: '0.35rem', letterSpacing: '-0.02em', color: '#ffffff' }}>
            Oracle Integration Settings
          </h1>
          <p style={{ color: '#E0E7FF', fontSize: '0.92rem', margin: 0 }}>
            Configure Oracle Fusion Cloud REST API connections, authentication, and security governance.
          </p>
        </div>

        <div style={{ position: 'relative', zIndex: 2 }}>
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
            {environmentMode === 'DEMO' ? 'Sample Data Mode (disabled — live only)' : 'Live Oracle Fusion API'}
          </div>
        </div>
      </div>

      {/* Top Section Navigation Buttons */}
      <div style={{ 
        display: 'inline-flex', 
        alignItems: 'center',
        padding: '0.35rem',
        borderRadius: 'var(--radius-md)',
        backgroundColor: '#FFFFFF',
        border: '1px solid var(--border-color)',
        marginBottom: '2rem',
        gap: '0.5rem',
        boxShadow: 'var(--shadow-sm)'
      }}>
        <button 
          onClick={() => setActiveTab('INTEGRATION')}
          className="btn"
          style={{
            backgroundColor: activeTab === 'INTEGRATION' ? 'var(--bg-card)' : 'transparent',
            color: activeTab === 'INTEGRATION' ? 'var(--text-primary)' : 'var(--text-secondary)',
            border: activeTab === 'INTEGRATION' ? '1px solid var(--border-color-hover)' : '1px solid transparent',
            boxShadow: activeTab === 'INTEGRATION' ? '0 2px 8px rgba(0, 0, 0, 0.15)' : 'none',
            padding: '0.6rem 1.15rem',
            fontSize: '0.9rem',
            fontWeight: activeTab === 'INTEGRATION' ? 600 : 500,
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            transition: 'all var(--transition-speed) ease',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          <SettingsIcon size={16} style={{ color: activeTab === 'INTEGRATION' ? 'var(--accent-gold)' : 'var(--text-muted)' }} />
          <span>Oracle Integration</span>
        </button>

        <button 
          onClick={() => setActiveTab('USER_MANAGEMENT')}
          className="btn"
          style={{
            backgroundColor: activeTab === 'USER_MANAGEMENT' ? 'var(--bg-card)' : 'transparent',
            color: activeTab === 'USER_MANAGEMENT' ? 'var(--text-primary)' : 'var(--text-secondary)',
            border: activeTab === 'USER_MANAGEMENT' ? '1px solid var(--border-color-hover)' : '1px solid transparent',
            boxShadow: activeTab === 'USER_MANAGEMENT' ? '0 2px 8px rgba(0, 0, 0, 0.15)' : 'none',
            padding: '0.6rem 1.15rem',
            fontSize: '0.9rem',
            fontWeight: activeTab === 'USER_MANAGEMENT' ? 600 : 500,
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            transition: 'all var(--transition-speed) ease',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          <Shield size={16} style={{ color: activeTab === 'USER_MANAGEMENT' ? 'var(--accent-blue)' : 'var(--text-muted)' }} />
          <span>User & Password Management</span>
        </button>
      </div>

      {activeTab === 'INTEGRATION' ? (
        <div>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--accent-gold-light)',
              color: 'var(--accent-gold)'
            }}>
              <SettingsIcon size={20} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-header)', margin: 0 }}>
                Enterprise API Configuration
              </h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.15rem' }}>
                Setup Oracle Fusion REST endpoints and toggle testing modes.
              </p>
            </div>
          </div>

          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Environment Toggle Panel */}
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', fontFamily: 'var(--font-header)' }}>
                Execution Environment Mode
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '1.25rem' }}>
                Live-instance-only: all queries run against the Oracle instance link configured below. Sample/demo data is disabled.
              </p>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <div
                  onClick={() => setEnvironmentMode('ORACLE_FUSION')}
                  className="glass-panel"
                  title="Demo mode disabled — live Oracle instance only"
                  style={{
                    flex: 1,
                    padding: '1rem',
                    cursor: 'not-allowed',
                    opacity: 0.5,
                    border: '1px solid var(--border-color)',
                    backgroundColor: '',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    DEMO MODE (DISABLED)
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    Offline sample data is disabled. Configure the live instance link below.
                  </div>
                </div>

                <div
                  onClick={() => setEnvironmentMode('ORACLE_FUSION')}
                  className="glass-panel"
                  style={{
                    flex: 1,
                    padding: '1rem',
                    cursor: 'pointer',
                    border: environmentMode === 'ORACLE_FUSION' ? '2px solid var(--accent-blue)' : '1px solid var(--border-color)',
                    backgroundColor: environmentMode === 'ORACLE_FUSION' ? 'var(--accent-blue-light)' : '',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: environmentMode === 'ORACLE_FUSION' ? 'var(--accent-blue)' : 'var(--text-primary)' }}>
                    ORACLE FUSION LIVE
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    Performs active API calls directly against your HCM and FSCM cloud environment.
                  </div>
                </div>
              </div>
            </div>

            {/* Connection Setup */}
            <div className="glass-panel" style={{
              padding: '1.5rem',
              opacity: environmentMode === 'DEMO' ? 0.5 : 1,
              pointerEvents: environmentMode === 'DEMO' ? 'none' : 'auto',
              transition: 'opacity 0.25s ease'
            }}>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <Link2 size={18} style={{ color: 'var(--accent-gold)' }} />
                <h3 style={{ fontSize: '1rem', fontWeight: 600, fontFamily: 'var(--font-header)', margin: 0 }}>
                  Oracle Fusion REST Endpoint
                </h3>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                    Oracle Fusion Base URL
                  </label>
                  <input
                    type="url"
                    className="form-input"
                    placeholder="https://fa-xxxx-test.fa.ocs.oraclecloud.com"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    disabled={environmentMode === 'DEMO'}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                      Auth Method
                    </label>
                    <select
                      className="form-select"
                      style={{ width: '100%' }}
                      value={authType}
                      onChange={(e) => setAuthType(e.target.value as any)}
                      disabled={environmentMode === 'DEMO'}
                    >
                      <option value="BASIC">Basic Auth</option>
                      <option value="BEARER">Bearer Token</option>
                    </select>
                  </div>

                  {authType === 'BASIC' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                          Username
                        </label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="e.g. security_admin"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          disabled={environmentMode === 'DEMO'}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                          Password {serverState.hasPassword && <span style={{ color: 'var(--accent-green)' }}>(Configured)</span>}
                        </label>
                        <input
                          type="password"
                          className="form-input"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          disabled={environmentMode === 'DEMO'}
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                        Access Token {serverState.hasToken && <span style={{ color: 'var(--accent-green)' }}>(Configured)</span>}
                      </label>
                      <input
                        type="password"
                        className="form-input"
                        placeholder="eyJhbGciOiJSUzI1NiIs..."
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        disabled={environmentMode === 'DEMO'}
                      />
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* AI Language Model Configuration Panel */}
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <Key size={18} style={{ color: 'var(--accent-gold)' }} />
                <h3 style={{ fontSize: '1rem', fontWeight: 600, fontFamily: 'var(--font-header)', margin: 0 }}>
                  AI Language Model Configuration
                </h3>
              </div>
              
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '1.25rem' }}>
                Configure the Groq Cloud Large Language Model used to parse conversational queries and synthesize results.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', alignItems: 'flex-start' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                      Select Groq LLM Model
                    </label>
                    <select
                      className="form-select"
                      style={{ width: '100%' }}
                      value={groqModel}
                      onChange={(e) => setGroqModel(e.target.value)}
                    >
                      <option value="openai/gpt-oss-20b">openai/gpt-oss-20b (Recommended Production Model)</option>
                      <option value="gpt-oss-20b">gpt-oss-20b (Standard Alias)</option>
                      <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (Enterprise Model)</option>
                      <option value="llama-3.1-70b-versatile">llama-3.1-70b-versatile (Standard 70B Model)</option>
                      <option value="mixtral-8x7b-32768">mixtral-8x7b-32768 (Mixture of Experts)</option>
                    </select>
                  </div>

                  <div style={{ marginTop: '1.8rem' }}>
                    <div style={{
                      padding: '0.5rem 0.75rem',
                      backgroundColor: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.75rem',
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span className="badge" style={{
                        backgroundColor: serverState.hasGeminiKey ? 'rgba(16, 185, 129, 0.1)' : 'rgba(217, 119, 6, 0.1)',
                        color: serverState.hasGeminiKey ? 'var(--accent-green)' : 'var(--accent-gold)',
                        width: '100%',
                        textAlign: 'center',
                        fontWeight: 600
                      }}>
                        {serverState.hasGeminiKey ? 'Active (Groq Key detected)' : 'Fallback (Offline Keyword)'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Buttons / Actions */}
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', alignItems: 'center' }}>
              {saveStatus && (
                <span style={{ fontSize: '0.85rem', color: saveStatus.includes('failed') ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: 500 }}>
                  {saveStatus}
                </span>
              )}

              {environmentMode === 'ORACLE_FUSION' && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleTestConnection}
                  disabled={testing || saving || !baseUrl}
                >
                  {testing ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Verifying connection...</span>
                    </>
                  ) : (
                    'Test Connection'
                  )}
                </button>
              )}

              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || testing}
              >
                {saving ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>

          </form>

          {/* Test Connection Results Alert */}
          {testResult && (
            <div className="glass-panel animate-fade-in" style={{
              marginTop: '1.5rem',
              padding: '1.25rem',
              borderLeft: `4px solid ${
                testResult.success 
                  ? 'var(--accent-green)' 
                  : testResult.status === 'AUTH_FAILED' || testResult.status === 'FORBIDDEN'
                    ? 'var(--accent-red)' 
                    : 'var(--accent-gold)'
              }`,
              backgroundColor: testResult.success 
                ? 'rgba(16, 185, 129, 0.02)' 
                : testResult.status === 'AUTH_FAILED' || testResult.status === 'FORBIDDEN'
                  ? 'rgba(239, 68, 68, 0.02)'
                  : 'rgba(217, 119, 6, 0.02)',
              display: 'flex',
              gap: '1rem',
              alignItems: 'flex-start'
            }}>
              {testResult.success ? (
                <CheckCircle2 size={20} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
              ) : (
                <AlertOctagon size={20} style={{ 
                  color: testResult.status === 'AUTH_FAILED' || testResult.status === 'FORBIDDEN' ? 'var(--accent-red)' : 'var(--accent-gold)', 
                  flexShrink: 0 
                }} />
              )}
              <div>
                <h4 style={{ 
                  fontSize: '0.9rem', 
                  fontWeight: 600, 
                  color: testResult.success 
                    ? 'var(--accent-green)' 
                    : testResult.status === 'AUTH_FAILED' || testResult.status === 'FORBIDDEN'
                      ? 'var(--accent-red)' 
                      : 'var(--accent-gold)', 
                  marginBottom: '0.25rem' 
                }}>
                  {testResult.success && 'Connection Successful'}
                  {testResult.status === 'AUTH_FAILED' && 'Authentication Failed'}
                  {testResult.status === 'FORBIDDEN' && 'Access Forbidden'}
                  {testResult.status === 'UNREACHABLE' && 'Invalid/Unreachable Instance URL'}
                  {testResult.status === 'ENDPOINT_UNAVAILABLE' && 'API Endpoint Unavailable'}
                  {testResult.status === 'ERROR' && 'Connection Error'}
                  {!testResult.success && !testResult.status && 'Connection Failed'}
                </h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  {testResult.message}
                </p>
              </div>
            </div>
          )}

          {/* Role & Privilege Catalog Section */}
          <div className="glass-panel" style={{ marginTop: '1.75rem', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '38px',
                  height: '38px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  color: 'var(--accent-blue)'
                }}>
                  <Database size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 700, fontFamily: 'var(--font-header)', margin: 0, letterSpacing: '0.02em' }}>
                    ROLE & PRIVILEGE CATALOG
                  </h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                    Bidirectional intelligence data layer for Role → Privilege and Privilege → Role reverse inquiries.
                  </p>
                </div>
              </div>

              {/* Status Badge & Refresh Action */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.35rem 0.8rem',
                  borderRadius: '9999px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  backgroundColor: catalogMetadata?.status === 'SYNCING' ? 'rgba(217, 119, 6, 0.1)' : catalogMetadata?.status === 'ERROR' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                  color: catalogMetadata?.status === 'SYNCING' ? 'var(--accent-gold)' : catalogMetadata?.status === 'ERROR' ? 'var(--accent-red)' : 'var(--accent-green)',
                  border: `1px solid ${catalogMetadata?.status === 'SYNCING' ? 'rgba(217, 119, 6, 0.3)' : catalogMetadata?.status === 'ERROR' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`
                }}>
                  <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: catalogMetadata?.status === 'SYNCING' ? 'var(--accent-gold)' : catalogMetadata?.status === 'ERROR' ? 'var(--accent-red)' : 'var(--accent-green)',
                    display: 'inline-block'
                  }} />
                  <span>
                    Status: {catalogMetadata?.status === 'SYNCING' ? 'Syncing...' : catalogMetadata?.status === 'ERROR' ? 'Error' : '● Ready'}
                  </span>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleRefreshCatalog}
                  disabled={syncingCatalog || loadingCatalog}
                  style={{
                    padding: '0.45rem 1rem',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    borderRadius: 'var(--radius-sm)'
                  }}
                  title="Extract latest roles and privileges in the background"
                >
                  <RefreshCw size={13} className={syncingCatalog ? 'animate-spin' : ''} />
                  <span>{syncingCatalog ? 'Synchronizing...' : 'Refresh Catalog'}</span>
                </button>
              </div>
            </div>

            {/* Catalog Metrics Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '1rem',
              marginTop: '1rem',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              padding: '1.15rem'
            }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  Instance
                </div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                  {catalogMetadata?.instance || 'fa-euth-dev58'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  Last Synchronized
                </div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.25rem' }} title={catalogMetadata?.lastUpdated || ''}>
                  {catalogMetadata?.freshnessText || 'Just now'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  Roles
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-blue)', marginTop: '0.25rem' }}>
                  {catalogMetadata?.roleCount ? Number(catalogMetadata.roleCount).toLocaleString() : '6,973'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  Privileges
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-gold)', marginTop: '0.25rem' }}>
                  {catalogMetadata?.privilegeCount ? Number(catalogMetadata.privilegeCount).toLocaleString() : '—'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  Mappings
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-green)', marginTop: '0.25rem' }}>
                  {catalogMetadata?.mappingCount ? Number(catalogMetadata.mappingCount).toLocaleString() : '—'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  Source
                </div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  {catalogMetadata?.source || 'Oracle Fusion'}
                </div>
              </div>
            </div>

            {/* Sync Feedback Message */}
            {catalogSyncMessage && (
              <div style={{
                marginTop: '1rem',
                padding: '0.65rem 0.9rem',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(59, 130, 246, 0.05)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <Info size={15} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                <span>{catalogSyncMessage}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="animate-fade-in">
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(14, 165, 233, 0.1)',
              color: 'var(--accent-blue)'
            }}>
              <Shield size={20} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-header)', margin: 0 }}>
                User & Password Management
              </h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.15rem' }}>
                Onboard corporate users, toggle access states, and manage secure one-time password reset codes.
              </p>
            </div>
          </div>

          {/* Feedback Messages */}
          {userActionError && (
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
              <ShieldAlert size={16} style={{ flexShrink: 0 }} />
              <span>{userActionError}</span>
            </div>
          )}

          {userActionSuccess && (
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
              <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
              <span>{userActionSuccess}</span>
            </div>
          )}

          {/* Generated Reset Code Box (One-time Display) */}
          {generatedCode && (
            <div className="glass-panel animate-fade-in" style={{
              border: '1px solid rgba(14, 165, 233, 0.3)',
              backgroundColor: 'rgba(14, 165, 233, 0.03)',
              padding: '1.5rem',
              borderRadius: 'var(--radius-md)',
              marginBottom: '2rem'
            }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', color: 'var(--accent-blue)' }}>
                <KeyRound size={18} />
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Secure Password Reset Code Generated</h3>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4', margin: '0 0 1rem 0' }}>
                Please provide this one-time code to the user <strong>{generatedCode.email}</strong>. 
                For safety, this code expires in 1 hour and will not be displayed again.
              </p>

              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <div style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.75rem 1.25rem',
                  fontSize: '1.25rem',
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  letterSpacing: '0.1em',
                  color: 'var(--text-primary)',
                  display: 'inline-block'
                }}>
                  {generatedCode.code}
                </div>

                <button 
                  onClick={() => copyToClipboard(generatedCode.code)}
                  className="btn btn-secondary"
                  style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  {copiedCode ? <Check size={16} style={{ color: 'var(--accent-green)' }} /> : <Copy size={16} />}
                  <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Search bar & Refresh actions */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.25rem',
            gap: '1rem'
          }}>
            <div style={{ position: 'relative', width: '300px' }}>
              <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input 
                type="text"
                className="form-input"
                style={{ paddingLeft: '2.25rem', paddingRight: '0.75rem' }}
                placeholder="Search users by email..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
            </div>

            <button 
              onClick={fetchUsers} 
              className="btn btn-secondary"
              disabled={loadingUsers}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem' }}
            >
              <RefreshCw size={14} className={loadingUsers ? 'animate-spin' : ''} />
              <span>Refresh Users</span>
            </button>

            <TableExportControl
              filename="admin_users"
              data={filteredUsers}
              totalCount={filteredUsers.length}
              columns={[
                { key: 'email', label: 'User Email' },
                { key: 'role', label: 'Role' },
                { key: 'active', label: 'Account Status', getValue: (u: any) => u.active ? 'Active' : 'Inactive' },
                { key: 'setupCompleted', label: 'Setup State', getValue: (u: any) => u.setupCompleted ? 'Completed' : 'Pending' },
                { key: 'resetCode', label: 'Active Reset Code', getValue: (u: any) => u.resetCode || '' }
              ]}
            />
          </div>

          {/* Users Table */}
          <div className="glass-panel" style={{ overflowX: 'auto', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', minWidth: '950px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
                  <th style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap' }}>User Email</th>
                  <th style={{ padding: '0.85rem 0.75rem', whiteSpace: 'nowrap' }}>Role</th>
                  <th style={{ padding: '0.85rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>Account Status</th>
                  <th style={{ padding: '0.85rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>Setup State</th>
                  <th style={{ padding: '0.85rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>Active Reset Code</th>
                  <th style={{ padding: '0.85rem 1.25rem', textAlign: 'right', whiteSpace: 'nowrap', minWidth: '260px' }}>Security Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingUsers ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 0.5rem auto' }} />
                      <div>Loading corporate user database...</div>
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No registered users found matching "{userSearch}".
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(user => {
                    const isSelf = user.email.toLowerCase() === currentUser.toLowerCase();
                    return (
                      <tr 
                        key={user.email} 
                        style={{ 
                          borderBottom: '1px solid var(--border-color)',
                          backgroundColor: isSelf ? 'rgba(245, 158, 11, 0.01)' : '' 
                        }}
                      >
                        <td style={{ padding: '0.85rem 1rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span>{user.email}</span>
                            {isSelf && <span className="badge" style={{ backgroundColor: 'var(--accent-gold-light)', color: 'var(--accent-gold)', fontSize: '0.65rem' }}>You</span>}
                          </div>
                        </td>
                        <td style={{ padding: '0.85rem 0.75rem', whiteSpace: 'nowrap' }}>
                          <span className="badge" style={{
                            backgroundColor: user.isAdmin ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                            color: user.isAdmin ? 'var(--accent-red)' : 'var(--text-secondary)'
                          }}>
                            {user.isAdmin ? 'Administrator' : 'General User'}
                          </span>
                        </td>
                        <td style={{ padding: '0.85rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                            <button
                              disabled={isSelf}
                              onClick={() => handleToggleStatus(user.email, user.isActive)}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: isSelf ? 'not-allowed' : 'pointer',
                                color: user.isActive ? 'var(--accent-green)' : 'var(--text-muted)',
                                padding: '0.25rem',
                                borderRadius: 'var(--radius-sm)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem'
                              }}
                              title={isSelf ? 'Cannot deactivate yourself' : `Click to ${user.isActive ? 'deactivate' : 'activate'}`}
                            >
                              <Power size={14} />
                              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                                {user.isActive ? 'Active' : 'Deactivated'}
                              </span>
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: '0.85rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: user.setupCompleted ? 'var(--accent-green)' : 'var(--accent-gold)'
                          }}>
                            {user.setupCompleted ? 'Complete' : 'Pending Onboarding'}
                          </span>
                        </td>
                        <td style={{ padding: '0.85rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {user.resetCodeStatus === 'active' ? (
                            <span className="badge" style={{ backgroundColor: 'rgba(14, 165, 233, 0.1)', color: 'var(--accent-blue)', fontSize: '0.7rem' }}>
                              Active (1h)
                            </span>
                          ) : user.resetCodeStatus === 'used' ? (
                            <span className="badge" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-green)', fontSize: '0.7rem' }}>
                              Used
                            </span>
                          ) : user.resetCodeStatus === 'expired' ? (
                            <span className="badge" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-red)', fontSize: '0.7rem' }}>
                              Expired
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>None</span>
                          )}
                        </td>
                        <td style={{ padding: '0.85rem 1.25rem', textAlign: 'right', whiteSpace: 'nowrap', minWidth: '260px' }}>
                          <div style={{ display: 'inline-flex', gap: '0.5rem', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'nowrap' }}>
                            {user.resetCodeStatus === 'active' ? (
                              <button
                                onClick={() => handleRevokeResetCode(user.email)}
                                className="btn btn-secondary"
                                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap' }}
                              >
                                <X size={12} />
                                <span>Revoke Code</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => handleGenerateResetCode(user.email)}
                                className="btn btn-secondary"
                                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap' }}
                              >
                                <KeyRound size={12} />
                                <span>Reset Password</span>
                              </button>
                            )}

                            {/* Delete Account Destructive Action */}
                            <button
                              disabled={isSelf}
                              onClick={() => {
                                if (!isSelf) {
                                  setDeleteError('');
                                  setDeleteTarget(user);
                                }
                              }}
                              className="btn btn-secondary"
                              style={{ 
                                padding: '0.25rem 0.5rem', 
                                fontSize: '0.75rem', 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '0.25rem',
                                color: isSelf ? 'var(--text-muted)' : 'var(--accent-red)',
                                borderColor: isSelf ? 'var(--border-color)' : 'rgba(239, 68, 68, 0.4)',
                                opacity: isSelf ? 0.4 : 1,
                                cursor: isSelf ? 'not-allowed' : 'pointer',
                                whiteSpace: 'nowrap'
                              }}
                              title={isSelf ? 'Current administrator account cannot be deleted' : `Permanently delete user account for ${user.email}`}
                            >
                              <Trash2 size={12} />
                              <span>Delete Account</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          
          <div style={{
            display: 'flex',
            gap: '0.75rem',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            padding: '1rem',
            fontSize: '0.8rem',
            lineHeight: '1.4',
            color: 'var(--text-secondary)',
            marginTop: '1.5rem'
          }}>
            <Info size={16} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
            <div>
              <strong>Security Protocol Warning:</strong> All administrative account deletions, password reset generations, and status modifications are tracked in the security audit logs (`oracle_audit.log`).
            </div>
          </div>

        </div>
      )}

      {/* Delete User Account Confirmation Dialog */}
      {deleteTarget && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div className="glass-panel animate-fade-in" style={{
            maxWidth: '480px',
            width: '100%',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            padding: '1.75rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                color: 'var(--accent-red)',
                flexShrink: 0
              }}>
                <ShieldAlert size={22} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Delete User Account?
                </h3>
                <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Destructive Administrative Action
                </p>
              </div>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5', margin: '0 0 1rem 0' }}>
              Are you sure you want to permanently delete the account for <strong style={{ color: 'var(--text-primary)' }}>{deleteTarget.email}</strong>?
            </p>

            <div style={{
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              borderLeft: '3px solid var(--accent-red)',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1.5rem',
              fontSize: '0.82rem',
              color: 'var(--text-secondary)',
              lineHeight: '1.4'
            }}>
              This will permanently remove this user account, revoke any active login sessions, and eliminate their application access. <strong style={{ color: 'var(--accent-red)' }}>This action cannot be undone.</strong>
            </div>

            {deleteError && (
              <div style={{
                padding: '0.75rem',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--accent-red)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--accent-red)',
                fontSize: '0.85rem',
                marginBottom: '1rem'
              }}>
                {deleteError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteError('');
                }}
                className="btn btn-secondary"
                style={{ padding: '0.55rem 1.25rem', fontSize: '0.85rem', cursor: isDeleting ? 'not-allowed' : 'pointer' }}
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="btn"
                style={{
                  padding: '0.55rem 1.25rem',
                  fontSize: '0.85rem',
                  backgroundColor: 'var(--accent-red)',
                  color: '#ffffff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  opacity: isDeleting ? 0.7 : 1
                }}
              >
                {isDeleting ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Deleting Account...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>Delete Account</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
