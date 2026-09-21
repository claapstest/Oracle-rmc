import React from 'react';
import { Award, Clock } from 'lucide-react';

interface AccessCertificatesProps {
  environmentMode: 'DEMO' | 'ORACLE_FUSION';
}

export default function AccessCertificates({ environmentMode }: AccessCertificatesProps) {
  const dataSource = environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Data';

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
            Access Certificates
          </h1>
          <p style={{ color: '#E0E7FF', fontSize: '0.92rem', margin: 0 }}>
            Certification campaigns and reviewer decisions for access governance.
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
            aria-label={`Data source: ${dataSource}`}
          >
            {dataSource}
          </div>
        </div>
      </div>

      <div className="glass-panel animate-fade-in" style={{ padding: '3.5rem 2rem', textAlign: 'center' }}>
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '16px',
            backgroundColor: 'var(--accent-blue-light)',
            border: '1px solid rgba(37, 99, 235, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.25rem auto',
            color: 'var(--accent-blue)'
          }}
        >
          <Award size={30} />
        </div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.5rem' }}>Access Certificates</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', maxWidth: '620px', margin: '0 auto 0.5rem auto', lineHeight: 1.55 }}>
          Review and manage access certification campaigns, reviewer decisions, and certification history.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: '620px', margin: '0 auto 1.25rem auto' }}>
          Access certification capabilities are not yet available.
        </p>
        <span
          className="badge badge-gold"
          style={{ fontSize: '0.78rem', padding: '0.3rem 0.9rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Clock size={13} />
          Coming Soon
        </span>
        <div style={{ marginTop: '1.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Data source: {dataSource} · No certificate data is fabricated in this view.
        </div>
      </div>
    </div>
  );
}
