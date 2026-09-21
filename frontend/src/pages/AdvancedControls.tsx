import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { api } from '../services/api.js';
import { AdvancedControlsModule, type AdvancedControlRecord } from '../components/AdvancedControlsModule';

interface AdvancedControlsProps {
  environmentMode: 'DEMO' | 'ORACLE_FUSION';
}

export default function AdvancedControls({ environmentMode }: AdvancedControlsProps) {
  const [controls, setControls] = useState<AdvancedControlRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [controlsRefreshing, setControlsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string>('');

  const loadControls = async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const res = await api.getAdvancedControls();
      if (res?.success) {
        setControls((res.items || []) as AdvancedControlRecord[]);
        setDataSource(res.dataSource || (environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Data'));
        setLastRefreshed(new Date().toLocaleTimeString());
      } else {
        setControls([]);
      }
    } catch (err: unknown) {
      console.error('Failed to load Advanced Controls:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Unable to communicate with Risk Management backend services.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadControls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environmentMode]);

  const handleRefreshControls = async () => {
    setControlsRefreshing(true);
    try {
      const res = await api.refreshAdvancedControls();
      if (res?.success && Array.isArray(res.items)) {
        setControls(res.items as AdvancedControlRecord[]);
        setLastRefreshed(new Date().toLocaleTimeString());
        setErrorMessage('');
      }
    } catch (err) {
      console.error('Failed to refresh controls catalog:', err);
    } finally {
      setControlsRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }} aria-busy="true" aria-label="Loading Advanced Controls">
        <div style={{ height: '35px', width: '260px', marginBottom: '1rem' }} className="skeleton" />
        <div style={{ height: '20px', width: '450px', marginBottom: '2rem' }} className="skeleton" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
          <div style={{ height: '90px' }} className="skeleton" />
          <div style={{ height: '90px' }} className="skeleton" />
          <div style={{ height: '90px' }} className="skeleton" />
          <div style={{ height: '90px' }} className="skeleton" />
        </div>
        <div style={{ height: '300px' }} className="skeleton" />
        <p style={{ marginTop: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Loading Oracle Fusion data...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', width: '100%', margin: '0 auto' }}>
      <div
        className="page-header-banner animate-fade-in"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #1E40AF 0%, #2563EB 60%, #3B82F6 100%)',
          position: 'relative',
          flexWrap: 'wrap',
          gap: '1rem'
        }}
      >
        <svg
          viewBox="0 0 1440 240"
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, opacity: 0.9 }}
        >
          <path fill="rgba(255, 255, 255, 0.08)" d="M0,120 C320,190,480,50,800,130 C1120,210,1280,80,1440,120 L1440,240 L0,240 Z" />
          <path fill="rgba(96, 165, 250, 0.15)" d="M0,170 C360,90,600,210,960,140 C1200,90,1360,180,1440,150 L1440,240 L0,240 Z" />
        </svg>

        <div style={{ position: 'relative', zIndex: 2 }}>
          <h1 style={{ fontSize: '1.85rem', fontWeight: 800, fontFamily: 'var(--font-header)', marginBottom: '0.35rem', letterSpacing: '-0.02em', color: '#ffffff' }}>
            Advanced Controls
          </h1>
          <p style={{ color: '#E0E7FF', fontSize: '0.92rem', margin: 0 }}>
            Monitor access and transaction controls configured in Oracle Fusion.
          </p>
        </div>

        <div style={{ position: 'relative', zIndex: 2 }}>
          <div
            style={{
              padding: '0.4rem 0.95rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              borderRadius: '9999px',
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              color: '#ffffff'
            }}
            aria-label={`Data source: ${dataSource || (environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Data')}`}
          >
            {dataSource || (environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Data')}
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="glass-panel" style={{ padding: '1rem 1.5rem', borderLeft: '4px solid var(--accent-red)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }} role="alert">
          <AlertCircle size={20} style={{ color: 'var(--accent-red)' }} />
          <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', flex: 1 }}>{errorMessage}</div>
          <button type="button" onClick={loadControls} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.35rem 0.8rem' }}>
            Retry
          </button>
        </div>
      )}

      <div className="animate-fade-in">
        <AdvancedControlsModule
          controls={controls}
          environmentMode={environmentMode}
          dataSource={dataSource}
          lastRefreshed={lastRefreshed}
          controlsRefreshing={controlsRefreshing}
          onRefreshControls={handleRefreshControls}
          embedded
          hideSectionHeader
        />
      </div>
    </div>
  );
}
