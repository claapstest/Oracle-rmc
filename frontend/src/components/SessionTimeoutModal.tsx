import React from 'react';
import { Clock } from 'lucide-react';

export interface SessionTimeoutModalProps {
  isOpen: boolean;
  secondsRemaining: number;
  onStayLoggedIn: () => void;
  onLogoutNow: () => void;
}

/**
 * Session Timeout Warning Modal matching Mock Screen 3 specs.
 * Warns user when session is within warning period (default 30 seconds before 5-min limit).
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)'
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-warning-title"
    >
      <div
        className="w-full max-w-md bg-white rounded-xl shadow-2xl overflow-hidden border border-amber-200 animate-in fade-in zoom-in-95 duration-200"
        style={{
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          background: '#FFFFFF'
        }}
      >
        {/* Mock Screen 3 Inner Card Container with subtle warm amber tint */}
        <div className="p-7 text-center" style={{ backgroundColor: '#FFFBF0' }}>
          {/* Circular Clock Icon Header Badge */}
          <div
            className="mx-auto mb-4 flex items-center justify-center rounded-full"
            style={{
              width: '64px',
              height: '64px',
              backgroundColor: '#FFEDD5',
              border: '2px solid #FED7AA'
            }}
          >
            <Clock className="w-8 h-8 text-amber-600" aria-hidden="true" />
          </div>

          {/* Heading */}
          <h2
            id="session-warning-title"
            className="text-xl font-bold text-slate-900 mb-3"
            style={{ fontFamily: "'Outfit', 'Inter', sans-serif" }}
          >
            Session Expiring Soon
          </h2>

          {/* Subtitle / Description - AC2: Dynamic Countdown Display */}
          <p className="text-slate-700 text-sm mb-2 font-medium">
            You will be logged out in{' '}
            <span className="font-bold text-amber-700 text-base underline decoration-amber-400 decoration-2">
              {secondsRemaining} {secondsRemaining === 1 ? 'second' : 'seconds'}
            </span>{' '}
            due to inactivity.
          </p>

          <p className="text-slate-800 text-sm font-semibold mb-6">
            Do you want to continue your session?
          </p>

          {/* Action Buttons: AC3 & AC4 */}
          <div className="flex items-center justify-center gap-3 mt-2">
            {/* AC3: Stay Logged In (Primary Action) */}
            <button
              type="button"
              onClick={onStayLoggedIn}
              className="flex-1 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              style={{
                backgroundColor: '#2563EB',
                borderColor: '#2563EB'
              }}
            >
              Stay Logged In
            </button>

            {/* AC4: Logout Now (Secondary Action) */}
            <button
              type="button"
              onClick={onLogoutNow}
              className="flex-1 px-5 py-2.5 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg border border-slate-300 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
            >
              Logout Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
