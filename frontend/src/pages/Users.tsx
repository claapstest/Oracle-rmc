import React, { useEffect, useState } from 'react';
import { Search, UserCheck, ShieldAlert, ArrowRight, User as UserIcon, X, Mail, Shield, Sparkles } from 'lucide-react';
import { api } from '../services/api.js';

interface UsersProps {
  initialFilter?: string;
  onInvestigateUser?: (userId: string, displayName: string) => void;
  onInspectRole?: (roleCode: string, displayName: string) => void;
}

export default function Users({ initialFilter = 'ALL', onInvestigateUser, onInspectRole }: UsersProps) {
  const [users, setUsers] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dataSource, setDataSource] = useState('');

  useEffect(() => {
    const delay = searchTerm ? 350 : 0;
    const delayDebounceFn = setTimeout(() => {
      async function loadUsers() {
        setLoading(true);
        setError('');
        try {
          const res = await api.getUsers(searchTerm || undefined);
          if (res?.users) {
            setUsers(res.users);
            setDataSource(res.dataSource || 'Oracle Fusion');
          }
        } catch (err) {
          console.error('Failed to load users:', err);
          setError('Unable to fetch users from security service.');
        } finally {
          setLoading(false);
        }
      }
      loadUsers();
    }, delay);

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm]);

  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      user.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.assignedRoles.some((r: any) => {
        const val = typeof r === 'string' ? r : (r.roleName || r.roleCode || '');
        return val.toLowerCase().includes(searchTerm.toLowerCase());
      });
      
    const matchesStatus = 
      statusFilter === 'ALL' ||
      (statusFilter === 'ACTIVE' && user.active) ||
      (statusFilter === 'INACTIVE' && !user.active);

    // Apply parent insight card filter definitions
    let matchesInsight = true;
    if (initialFilter === 'Multiple Role Users') {
      matchesInsight = user.assignedRoles && user.assignedRoles.length > 1;
    } else if (initialFilter === 'Users Without Roles') {
      matchesInsight = !user.assignedRoles || user.assignedRoles.length === 0;
    } else if (initialFilter === 'Security Administrators') {
      matchesInsight = user.assignedRoles && user.assignedRoles.some((r: any) => {
        const val = typeof r === 'string' ? r : (r.roleName || r.roleCode || '');
        return val.includes('Security Administrator') || val.includes('IT Security Manager');
      });
    } else if (initialFilter === 'High-Risk Role Users') {
      // High-risk users hold sensitive roles like Security Admin, IT Security Manager, or AP Manager
      matchesInsight = user.assignedRoles && user.assignedRoles.some((r: any) => {
        const val = typeof r === 'string' ? r : (r.roleName || r.roleCode || '');
        return val.includes('Security Administrator') || val.includes('IT Security Manager') || val.includes('AP Manager');
      });
    }

    return matchesSearch && matchesStatus && matchesInsight;
  });

  if (loading) {
    return (
      <div style={{ padding: '2rem' }}>
        <div style={{ height: '35px', width: '150px', marginBottom: '1.5rem' }} className="skeleton" />
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ height: '40px', width: '250px' }} className="skeleton" />
          <div style={{ height: '40px', width: '150px' }} className="skeleton" />
        </div>
        <div style={{ height: '300px' }} className="skeleton" />
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', width: '100%', margin: '0 auto', display: 'flex', gap: '2rem' }}>
      
      {/* Left Column: List */}
      <div style={{ flex: 1, minWidth: 0 }}>
        
        <div className="page-header-banner animate-fade-in" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #1E40AF 0%, #2563EB 60%, #3B82F6 100%)',
          position: 'relative'
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
              Identity & Access Management
            </h1>
            <p style={{ color: '#E0E7FF', fontSize: '0.92rem', margin: 0 }}>
              Verify user statuses and trace role entitlements inside the {dataSource || 'Oracle Fusion'} catalog.
              {initialFilter !== 'ALL' && (
                <span style={{ marginLeft: '0.6rem', padding: '0.15rem 0.6rem', backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
                  Filter: {initialFilter}
                </span>
              )}
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
              {filteredUsers.length} Users Found
            </div>
          </div>
        </div>

        {error && (
          <div className="glass-panel" style={{ padding: '1rem', borderLeft: '4px solid var(--accent-red)', marginBottom: '1.5rem' }}>
            <p style={{ color: 'var(--accent-red)', fontSize: '0.85rem' }}>{error}</p>
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
              <Search size={16} />
            </span>
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: '2.5rem' }}
              placeholder="Search by name, username, email, or role..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <select
            className="form-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Users</option>
            <option value="INACTIVE">Inactive Users</option>
          </select>
        </div>

        {/* Table Grid */}
        <div className="table-container" style={{ margin: 0 }}>
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Display Name</th>
                <th>Email Address</th>
                <th>Role Count</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No security users match the filter criteria.
                  </td>
                </tr>
              ) : (
                filteredUsers.map(user => (
                  <tr
                    key={user.id}
                    onClick={() => setSelectedUser(user)}
                    style={{ cursor: 'pointer', backgroundColor: selectedUser?.id === user.id ? 'rgba(255, 255, 255, 0.04)' : '' }}
                  >
                    <td><code>{user.userName}</code></td>
                    <td style={{ fontWeight: 600 }}>{user.displayName}</td>
                    <td>{user.email || 'N/A'}</td>
                    <td>{user.assignedRoles?.length || 0}</td>
                    <td>
                      <span className={`badge ${user.active ? 'badge-active' : 'badge-inactive'}`}>
                        {user.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onInvestigateUser) {
                            onInvestigateUser(user.userName, user.displayName);
                          } else {
                            setSelectedUser(user);
                          }
                        }}
                        className="btn btn-secondary" 
                        style={{ 
                          padding: '0.2rem 0.5rem', 
                          fontSize: '0.72rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          color: 'var(--accent-blue)',
                          borderColor: 'rgba(53, 99, 233, 0.25)'
                        }}
                      >
                        <span>Inspect</span>
                        <ArrowRight size={10} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right Column: User Details Sidebar Card */}
      {selectedUser && (
        <div className="glass-panel animate-fade-in" style={{
          width: '400px',
          height: 'fit-content',
          padding: '1.5rem',
          position: 'sticky',
          top: '2rem',
          alignSelf: 'flex-start'
        }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <UserIcon size={18} style={{ color: 'var(--accent-gold)' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, fontFamily: 'var(--font-header)', margin: 0 }}>
                Security Entitlements
              </h3>
            </div>
            <button
              onClick={() => setSelectedUser(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            
            {/* Identity Profile */}
            <div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{selectedUser.displayName}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                <code>{selectedUser.userName}</code>
                <span style={{ color: 'var(--text-muted)' }}>•</span>
                <span className={`badge ${selectedUser.active ? 'badge-active' : 'badge-inactive'}`} style={{ fontSize: '0.65rem' }}>
                  {selectedUser.active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>

            {/* Contacts Info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Mail size={14} />
                <span>{selectedUser.email || 'No email configured'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Shield size={14} />
                <span>Identity Identifier: <code>{selectedUser.id}</code></span>
              </div>
            </div>

            {/* Deep Investigation Workspace Trigger */}
            {onInvestigateUser && (
              <button 
                onClick={() => onInvestigateUser(selectedUser.userName, selectedUser.displayName)}
                className="btn btn-primary"
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                <Sparkles size={14} />
                <span>Launch Deep Workspace</span>
              </button>
            )}

            {/* Roles List */}
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Assigned Roles ({selectedUser.assignedRoles?.length || 0})
              </div>

              {selectedUser.assignedRoles && selectedUser.assignedRoles.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {selectedUser.assignedRoles.map((role: any, idx: number) => {
                    const rName = typeof role === 'string' ? role : (role.roleName || 'Unknown Role Name');
                    const rCode = typeof role === 'string' ? role : (role.roleCode || '');
                    const isCustom = typeof role === 'string' ? (role.startsWith('CLAAPS_') || role.startsWith('CUSTOM_')) : (role.isCustom || false);
                    
                    // Determine if it is a high privilege role
                    const isHighPriv = rName.toLowerCase().includes('security manager') || 
                                       rName.toLowerCase().includes('administrator') || 
                                       rName.toLowerCase().includes('ap manager') ||
                                       rCode.toLowerCase().includes('it_security_manager') ||
                                       rCode.toLowerCase().includes('security_administrator');

                    return (
                      <div key={idx} className="glass-panel animate-fade-in" style={{
                        padding: '1rem',
                        fontSize: '0.8rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        borderLeft: `4px solid ${isHighPriv ? 'var(--accent-red)' : 'var(--accent-gold)'}`,
                        position: 'relative'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{rName}</span>
                          {isHighPriv && (
                            <span className="badge badge-inactive" style={{ fontSize: '0.65rem', textTransform: 'uppercase' }}>
                              High Privilege
                            </span>
                          )}
                        </div>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
                          <code style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{rCode}</code>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {isCustom ? 'Custom Role' : 'Oracle Predefined'}
                          </span>
                        </div>

                        {onInspectRole && rCode && (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
                            <button
                              onClick={() => onInspectRole(rCode, rName)}
                              className="btn btn-secondary"
                              style={{ 
                                padding: '0.2rem 0.5rem', 
                                fontSize: '0.7rem', 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '0.25rem',
                                color: 'var(--accent-blue)',
                                borderColor: 'var(--accent-blue-light)',
                                background: 'transparent',
                                cursor: 'pointer'
                              }}
                            >
                              <span>Inspect Role</span>
                              <ArrowRight size={10} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{
                  padding: '1.5rem',
                  textAlign: 'center',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)'
                }}>
                  No security roles assigned.
                </div>
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
