import React from 'react';
import { Clock } from 'lucide-react';

export interface SessionTimeoutModalProps {
  isOpen: boolean;
  secondsRemaining: number;
  onStayLoggedIn: () => void;
  onLogoutNow: () => void;
}

/**
 * Session Timeout Warning Modal strictly matching Mock Screen 3 specs.
 * Rendered as a high-contrast modal overlay centered on the screen.
 * Uses 100% pure inline styles & CSS variables to avoid Tailwind dependency.
 */
export const SessionTimeoutModal: React.FC<SessionTimeoutModalProps> = ({
  isOpen,
  secondsRemaining,
  onStayLoggedIn,
  onLogoutNow
}) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(5px)',
        WebkitBackdropFilter: 'blur(5px)',
        zIndex: 999999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
        boxSizing: 'border-box'
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-warning-title"
    >
      <div
        style={{
          width: '100%',
          maxWidth: '450px',
          backgroundColor: '#FFFDF7',
          border: '1px solid #FED7AA',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.35), 0 0 0 1px rgba(245, 158, 11, 0.1)',
          padding: '2.25rem 2rem',
          textAlign: 'center',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          boxSizing: 'border-box',
          position: 'relative',
          overflow: 'hidden',
          animation: 'veyraModalPop 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        <style>{`
          @keyframes veyraModalPop {
            0% { opacity: 0; transform: scale(0.94) translateY(10px); }
            100% { opacity: 1; transform: scale(1) translateY(0); }
          }
          .veyra-btn-primary {
            background-color: #2563EB !important;
            color: #FFFFFF !important;
            border: 1px solid #2563EB !important;
          }
          .veyra-btn-primary:hover {
            background-color: #1D4ED8 !important;
            border-color: #1D4ED8 !important;
            box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35) !important;
          }
          .veyra-btn-secondary {
            background-color: #FFFFFF !important;
            color: #334155 !important;
            border: 1px solid #CBD5E1 !important;
          }
          .veyra-btn-secondary:hover {
            background-color: #F8FAFC !important;
            border-color: #94A3B8 !important;
            color: #0F172A !important;
          }
        `}</style>

        {/* Circular Clock Icon Badge — Mock Screen 3 Header */}
        <div
          style={{
            width: '68px',
            height: '68px',
            borderRadius: '50%',
            backgroundColor: '#FFEDD5',
            border: '2px solid #FDBA74',
            color: '#EA580C',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.25rem',
            boxShadow: '0 4px 12px rgba(234, 88, 12, 0.12)'
          }}
        >
          <Clock size={34} strokeWidth={2.2} />
        </div>

        {/* Title — Mock Screen 3 Heading */}
        <h2
          id="session-warning-title"
          style={{
            fontSize: '1.35rem',
            fontWeight: 700,
            color: '#7C2D12',
            fontFamily: "'Outfit', 'Inter', sans-serif",
            margin: '0 0 0.85rem 0',
            letterSpacing: '-0.01em'
          }}
        >
          Session Expiring Soon
        </h2>

        {/* Body Line 1 — Mock Screen 3 Countdown Text */}
        <p
          style={{
            color: '#334155',
            fontSize: '0.95rem',
            fontWeight: 500,
            margin: '0 0 0.6rem 0',
            lineHeight: 1.5
          }}
        >
          You will be logged out in{' '}
          <span
            style={{
              color: '#C2410C',
              fontWeight: 700,
              backgroundColor: '#FFEDD5',
              padding: '0.15rem 0.5rem',
              borderRadius: '6px',
              border: '1px solid #FDBA74',
              display: 'inline-block'
            }}
          >
            {secondsRemaining} {secondsRemaining === 1 ? 'second' : 'seconds'}
          </span>{' '}
          due to inactivity.
        </p>

        {/* Body Line 2 — Mock Screen 3 Question */}
        <p
          style={{
            color: '#1E293B',
            fontSize: '0.95rem',
            fontWeight: 600,
            margin: '0 0 1.75rem 0'
          }}
        >
          Do you want to continue your session?
        </p>

        {/* Action Buttons — Mock Screen 3 Buttons */}
        <div
          style={{
            display: 'flex',
            gap: '0.85rem',
            justifyContent: 'center',
            alignItems: 'center'
          }}
        >
          {/* Stay Logged In — Solid Blue Primary Button */}
          <button
            type="button"
            onClick={onStayLoggedIn}
            className="veyra-btn-primary"
            style={{
              flex: 1,
              borderRadius: '8px',
              padding: '0.75rem 1.25rem',
              fontSize: '0.92rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.18s ease',
              boxShadow: '0 2px 8px rgba(37, 99, 235, 0.25)',
              outline: 'none'
            }}
          >
            Stay Logged In
          </button>

          {/* Logout Now — White Outlined Secondary Button */}
          <button
            type="button"
            onClick={onLogoutNow}
            className="veyra-btn-secondary"
            style={{
              flex: 1,
              borderRadius: '8px',
              padding: '0.75rem 1.25rem',
              fontSize: '0.92rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.18s ease',
              outline: 'none'
            }}
          >
            Logout Now
          </button>
        </div>
      </div>
    </div>
  );
};
