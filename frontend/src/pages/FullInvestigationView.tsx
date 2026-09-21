import React, { useState, useEffect } from 'react';
import { 
  Shield, 
  Sparkles, 
  Printer, 
  X, 
  Search, 
  Users, 
  Award, 
  FileText, 
  ShieldAlert, 
  ExternalLink,
  ArrowLeft,
  Check,
  Copy,
  Info
} from 'lucide-react';
import { PaginatedTable, AssignedRolesList } from '../components/InvestigationComponents';
import { api } from '../services/api';
import InvestigationWorkspace from './InvestigationWorkspace';

interface FullInvestigationViewProps {
  investigationId: string;
  environmentMode: 'DEMO' | 'ORACLE_FUSION';
  onInvestigate?: (type: 'role' | 'user', id: string, name: string) => void;
  onNavigatePage?: (pageId: string, filter?: string) => void;
  onBack?: () => void;
}

export default function FullInvestigationView({ 
  investigationId, 
  environmentMode,
  onInvestigate,
  onNavigatePage,
  onBack 
}: FullInvestigationViewProps) {
  const [data, setData] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  // Standalone fallback entity investigation state
  const [internalEntity, setInternalEntity] = useState<{
    type: 'role' | 'user';
    id: string;
    name: string;
  } | null>(null);
  const [internalHistory, setInternalHistory] = useState<Array<{
    type: 'role' | 'user';
    id: string;
    name: string;
  }>>([]);

  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadSnapshot() {
      setLoading(true);

      // 1. Try local caches first (sessionStorage, then localStorage)
      try {
        const stored = sessionStorage.getItem(`oracle_inv_${investigationId}`) || localStorage.getItem(`oracle_inv_${investigationId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (isMounted && parsed) {
            setData(parsed);
            setLoading(false);
            return;
          }
        }
      } catch (err) {
        console.warn('Local storage snapshot check note:', err);
      }

      // 2. Direct Window Opener in-memory bridge (instantaneous and quota-free)
      try {
        if (typeof window !== 'undefined' && window.opener && !window.opener.closed) {
          const openerMap = (window.opener as any).__oracleInvestigationSnapshots;
          if (openerMap && openerMap.has(investigationId)) {
            const openerData = openerMap.get(investigationId);
            if (openerData && isMounted) {
              setData(openerData);
              try {
                sessionStorage.setItem(`oracle_inv_${investigationId}`, JSON.stringify(openerData));
              } catch (_) {}
              setLoading(false);
              return;
            }
          }
        }
      } catch (err) {
        console.warn('Opener snapshot check note:', err);
      }

      // 3. BroadcastChannel bridge across open browser tabs
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel('oracle_investigation_channel');
          const bcPromise = new Promise<any>((resolve) => {
            const timer = setTimeout(() => resolve(null), 500);
            channel.onmessage = (e) => {
              if (e.data?.type === 'SNAPSHOT_DATA' && e.data?.id === investigationId && e.data?.payload) {
                clearTimeout(timer);
                resolve(e.data.payload);
              }
            };
            channel.postMessage({ type: 'REQUEST_SNAPSHOT', id: investigationId });
          });
          const bcData = await bcPromise;
          channel.close();
          if (bcData && isMounted) {
            setData(bcData);
            try {
              sessionStorage.setItem(`oracle_inv_${investigationId}`, JSON.stringify(bcData));
            } catch (_) {}
            setLoading(false);
            return;
          }
        }
      } catch (err) {
        console.warn('BroadcastChannel snapshot check note:', err);
      }

      // 4. Authenticated backend fallback with retries (accommodates async save in parent tab)
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await api.getInvestigation(investigationId);
          if (res && res.success && res.data && isMounted) {
            setData(res.data);
            try {
              sessionStorage.setItem(`oracle_inv_${investigationId}`, JSON.stringify(res.data));
            } catch (_) {}
            setLoading(false);
            return;
          }
        } catch (err) {
          // May still be saving on backend from parent tab
        }
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 400));
        }
      }

      if (isMounted) {
        setLoading(false);
      }
    }

    loadSnapshot();

    return () => {
      isMounted = false;
    };
  }, [investigationId, reloadCounter]);

  const handleInspectEntity = (type: 'role' | 'user', id: string, name: string) => {
    if (onInvestigate) {
      onInvestigate(type, id, name);
    } else {
      const ent = { type, id, name };
      setInternalHistory(prev => [...prev, ent]);
      setInternalEntity(ent);
    }
  };

  if (internalEntity) {
    return (
      <InvestigationWorkspace
        entity={internalEntity}
        onClose={() => {
          setInternalEntity(null);
          setInternalHistory([]);
        }}
        onNavigate={(type, id, name) => {
          const ent = { type, id, name };
          setInternalHistory(prev => [...prev, ent]);
          setInternalEntity(ent);
        }}
        onBack={() => {
          setInternalHistory(prev => {
            const next = prev.slice(0, -1);
            setInternalEntity(next.length > 0 ? next[next.length - 1] : null);
            return next;
          });
        }}
        historyCount={internalHistory.length}
        environmentMode={environmentMode}
      />
    );
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <div className="animate-spin" style={{ width: '32px', height: '32px', border: '3px solid var(--accent-blue)', borderTopColor: 'transparent', borderRadius: '50%' }} />
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Loading investigation workspace...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-primary)', padding: '2rem' }}>
        <div className="glass-panel" style={{ maxWidth: '500px', width: '100%', padding: '2rem', textAlign: 'center' }}>
          <ShieldAlert size={40} style={{ color: 'var(--accent-gold)', margin: '0 auto 1rem' }} />
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Investigation Snapshot Not Found</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            This investigation answer might have expired or was opened in a different browser session.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button 
              onClick={() => setReloadCounter(c => c + 1)} 
              className="btn btn-secondary"
              style={{ flex: 1 }}
            >
              Retry
            </button>
            <button 
              onClick={() => window.close()} 
              className="btn btn-primary"
              style={{ flex: 1 }}
            >
              Close Tab
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { userQuery, structuredData, text, timestamp, createdAt } = data;
  const structured = structuredData || {};
  const { title, summary, keyFindings, riskHighlights, table, user, metadata } = structured;

  const actualSource = data?.dataSource || metadata?.source || data?.toolResult?.dataSource || (environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Oracle Fusion Data');
  const isLiveOracle = actualSource.toLowerCase().includes('live') || actualSource.toLowerCase().includes('oracle') || data?.environmentMode === 'ORACLE_FUSION' || environmentMode === 'ORACLE_FUSION';

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column' }}>
      
      {/* Minimal Enterprise Topbar Header */}
      <header style={{
        height: '52px',
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
        padding: '0 2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--accent-blue-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield size={16} style={{ color: 'var(--accent-blue)' }} />
            </div>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>Ask VEYRA Investigation</span>
                <span className={`badge ${isLiveOracle ? 'badge-blue' : 'badge-gold'}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.45rem' }}>
                  {isLiveOracle ? 'Live Oracle Fusion' : 'Demo Mode'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={() => {
              let textToCopy = text;
              if (structuredData) {
                textToCopy = `[${title}]\n\n${summary}`;
                if (keyFindings?.length > 0) textToCopy += `\n\nKey Insights:\n` + keyFindings.map((f: string) => `- ${f}`).join('\n');
                if (riskHighlights?.length > 0) textToCopy += `\n\nRisk Warnings:\n` + riskHighlights.map((r: string) => `[WARNING] ${r}`).join('\n');
                if (table?.rows?.length > 0) textToCopy += `\n\nData Table:\n` + table.rows.map((row: any) => JSON.stringify(row)).join('\n');
              }
              navigator.clipboard.writeText(textToCopy);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            {copied ? <Check size={12} style={{ color: 'var(--accent-green)' }} /> : <Copy size={12} />}
            <span>{copied ? 'Copied' : 'Copy All'}</span>
          </button>

          <button
            onClick={() => window.print()}
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Printer size={12} />
            <span>Print Report</span>
          </button>

          <button
            onClick={onBack ? onBack : () => window.close()}
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', color: onBack ? 'var(--text-primary)' : 'var(--accent-red)' }}
          >
            {onBack ? <ArrowLeft size={12} /> : <X size={12} />}
            <span>{onBack ? 'Return to Assistant' : 'Close Tab'}</span>
          </button>
        </div>
      </header>

      {/* Main Full-Screen Investigation Body */}
      <main style={{ flex: 1, padding: '2rem', maxWidth: '1800px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        
        {/* Back navigation action button when embedded in app */}
        {onBack && (
          <div style={{ marginBottom: '1.25rem' }}>
            <button 
              onClick={onBack}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', padding: '0.4rem 0.85rem', fontWeight: 600 }}
            >
              <ArrowLeft size={14} />
              <span>Back to Ask VEYRA Results</span>
            </button>
          </div>
        )}

        {/* Investigation Title Banner */}
        <div className="glass-panel" style={{ padding: '1.25rem 1.75rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent-blue)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem' }}>
                User Question / Query Scope
              </div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                {title || userQuery || 'Ask VEYRA Analysis'}
              </h1>
              {userQuery && (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                  Query: <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>"{userQuery}"</span>
                </div>
              )}
            </div>

            <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <div>Generated: {createdAt ? new Date(createdAt).toLocaleString() : timestamp || 'Active Session'}</div>
              <div>Source: <span style={{ color: isLiveOracle ? 'var(--accent-blue)' : 'var(--accent-gold)', fontWeight: 600 }}>{actualSource}</span></div>
              {metadata?.matchingCount !== undefined && (
                <div>Total Matches: <span style={{ color: 'var(--accent-blue)', fontWeight: 700 }}>{metadata.matchingCount} records</span></div>
              )}
            </div>
          </div>
        </div>

        {/* Executive Summary Card */}
        {summary && (
          <div className="glass-panel" style={{ padding: '1.25rem 1.75rem', marginBottom: '1.5rem', backgroundColor: 'var(--bg-secondary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: 'var(--accent-gold)', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <Sparkles size={14} />
              <span>Executive Compliance Summary</span>
            </div>
            <p style={{ fontSize: '0.95rem', lineHeight: '1.6', color: 'var(--text-primary)', margin: 0 }}>
              {summary}
            </p>
          </div>
        )}

        {/* Key Security Findings */}
        {keyFindings && keyFindings.length > 0 && (
          <div className="glass-panel" style={{ padding: '1.25rem 1.75rem', marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Info size={15} style={{ color: 'var(--accent-blue)' }} />
              <span>Key Intelligence Insights</span>
            </h3>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {keyFindings.map((finding: string, idx: number) => (
                <li key={idx} style={{ lineHeight: '1.5' }}>{finding}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Risk Indicators / Highlights */}
        {riskHighlights && riskHighlights.length > 0 && (
          <div className="glass-panel" style={{ padding: '1.25rem 1.75rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent-gold)', backgroundColor: 'rgba(217, 119, 6, 0.05)' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-gold)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldAlert size={16} />
              <span>Security & Compliance Risk Indicators</span>
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {riskHighlights.map((risk: string, idx: number) => (
                <div key={idx} style={{ fontSize: '0.85rem', lineHeight: '1.5', color: 'var(--text-primary)' }}>
                  {risk}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Custom User Security Profile Details (if applicable) */}
        {user && (
          <div className="glass-panel" style={{ padding: '1.25rem 1.75rem', marginBottom: '1.5rem', backgroundColor: 'var(--bg-tertiary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{user.displayName}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', fontSize: '0.8rem' }}>
                  <code>{user.userName}</code>
                  <span>•</span>
                  <span className={`badge ${user.active ? 'badge-active' : 'badge-inactive'}`}>
                    {user.active ? 'Active User' : 'Inactive User'}
                  </span>
                  {user.riskScore !== undefined && (
                    <span className="badge badge-gold">Risk Score: {user.riskScore}</span>
                  )}
                </div>
              </div>

              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Assigned Roles: <span style={{ color: 'var(--accent-blue)', fontWeight: 700 }}>{user.assignedRoles?.length || 0}</span>
              </div>
            </div>

            {user.assignedRoles && user.assignedRoles.length > 0 && (
              <div style={{ marginTop: '1.25rem' }}>
                <AssignedRolesList 
                  roles={user.assignedRoles} 
                  onInvestigate={handleInspectEntity}
                  onInspectRole={(rName) => handleInspectEntity('role', rName, rName)} 
                />
              </div>
            )}
          </div>
        )}

        {/* Primary Paginated Results Table */}
        {table && table.rows && (
          <div className="glass-panel" style={{ padding: '1.25rem 1.75rem', marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
              Detailed Record Dataset
            </h3>
            <PaginatedTable
              table={table}
              metadata={metadata}
              onNavigatePage={onNavigatePage}
              onInvestigate={handleInspectEntity}
              onInspectRole={(rName) => handleInspectEntity('role', rName, rName)}
            />
          </div>
        )}

      </main>
    </div>
  );
}
