import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';

export interface UseSessionTimeoutOptions {
  /** Total inactivity timeout in seconds (Default: 300 = 5 minutes) */
  timeoutSeconds?: number;
  /** Warning countdown window in seconds before expiry (Default: 30 seconds) */
  warningSeconds?: number;
  /** Callback invoked when session expires or user clicks Logout Now */
  onLogout: (reason: 'MANUAL' | 'EXPIRED') => void;
  /** Whether the user is currently authenticated */
  isLoggedIn: boolean;
}

export interface UseSessionTimeoutReturn {
  isWarningOpen: boolean;
  secondsRemaining: number;
  handleStayLoggedIn: () => Promise<void>;
  handleLogoutNow: () => Promise<void>;
  resetActivityTimer: () => void;
}

const DEFAULT_TIMEOUT_SECONDS = 5 * 60; // 5 minutes = 300 seconds (AC1)
const DEFAULT_WARNING_SECONDS = 30;    // 30 seconds warning (AC2)

export function useSessionTimeout({
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  warningSeconds = DEFAULT_WARNING_SECONDS,
  onLogout,
  isLoggedIn
}: UseSessionTimeoutOptions): UseSessionTimeoutReturn {
  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(warningSeconds);

  // Store timestamps & state in refs to avoid closure stale state in event listeners
  const lastActivityRef = useRef<number>(Date.now());
  const lastThrottleRef = useRef<number>(0);
  const isWarningOpenRef = useRef<boolean>(false);
  const isLoggedInRef = useRef<boolean>(isLoggedIn);

  // Synchronize ref states
  isWarningOpenRef.current = isWarningOpen;
  isLoggedInRef.current = isLoggedIn;

  // Manual timer reset helper
  const resetActivityTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIsWarningOpen(false);
  }, []);

  // AC3: Stay Logged In - refresh backend session & reset activity timer
  const handleStayLoggedIn = useCallback(async () => {
    try {
      // Send backend activity keep-alive refresh
      await api.refreshSession();
    } catch (err) {
      console.warn('[SessionTimeout] Failed to refresh backend session:', err);
    } finally {
      lastActivityRef.current = Date.now();
      setIsWarningOpen(false);
    }
  }, []);

  // AC4: Logout Now - explicit logout action
  const handleLogoutNow = useCallback(async () => {
    setIsWarningOpen(false);
    onLogout('MANUAL');
  }, [onLogout]);

  // Activity Event Listener Setup: AC1 & AC2
  useEffect(() => {
    if (!isLoggedIn) {
      setIsWarningOpen(false);
      return;
    }

    // Reset baseline activity timestamp on login
    lastActivityRef.current = Date.now();

    const handleUserActivity = () => {
      // If warning modal is actively displayed, do NOT update activity timer.
      // User must explicitly click "Stay Logged In".
      if (isWarningOpenRef.current) return;

      const now = Date.now();
      // Throttle activity recording to at most once per second
      if (now - lastThrottleRef.current > 1000) {
        lastThrottleRef.current = now;
        lastActivityRef.current = now;
      }
    };

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    activityEvents.forEach(evt => {
      window.addEventListener(evt, handleUserActivity, { passive: true });
    });

    return () => {
      activityEvents.forEach(evt => {
        window.removeEventListener(evt, handleUserActivity);
      });
    };
  }, [isLoggedIn]);

  // 1-Second Tick & Tab Visibility Monitoring: AC1, AC2, AC5
  useEffect(() => {
    if (!isLoggedIn) return;

    const checkInactivity = () => {
      if (!isLoggedInRef.current) return;

      const now = Date.now();
      const elapsedSeconds = Math.floor((now - lastActivityRef.current) / 1000);
      const remaining = Math.max(0, timeoutSeconds - elapsedSeconds);

      if (remaining <= 0) {
        // AC5: Countdown expired without response — auto logout
        console.warn('[SessionTimeout] Inactivity timeout reached (5 minutes). Logging out automatically.');
        setIsWarningOpen(false);
        onLogout('EXPIRED');
      } else if (remaining <= warningSeconds) {
        // AC2: Within warning window — show countdown warning modal
        setSecondsRemaining(remaining);
        if (!isWarningOpenRef.current) {
          setIsWarningOpen(true);
        }
      } else {
        // Outside warning window — ensure modal is hidden
        if (isWarningOpenRef.current) {
          setIsWarningOpen(false);
        }
      }
    };

    const intervalId = setInterval(checkInactivity, 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkInactivity();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isLoggedIn, timeoutSeconds, warningSeconds, onLogout]);

  return {
    isWarningOpen,
    secondsRemaining,
    handleStayLoggedIn,
    handleLogoutNow,
    resetActivityTimer
  };
}
