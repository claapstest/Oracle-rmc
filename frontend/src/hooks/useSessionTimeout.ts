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

const DEFAULT_TIMEOUT_SECONDS = 5 * 60; // 5 minutes = 300 seconds
const DEFAULT_WARNING_SECONDS = 30;    // 30 seconds warning
const BACKEND_SYNC_INTERVAL_MS = 30 * 1000; // Synchronize with backend at most once every 30 seconds of activity

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
  const lastBackendSyncRef = useRef<number>(Date.now());
  const isWarningOpenRef = useRef<boolean>(false);
  const isLoggedInRef = useRef<boolean>(isLoggedIn);

  // Synchronize ref states
  isWarningOpenRef.current = isWarningOpen;
  isLoggedInRef.current = isLoggedIn;

  // Helper to send backend keep-alive
  const syncBackendActivity = useCallback(async () => {
    try {
      await api.refreshSession();
      lastBackendSyncRef.current = Date.now();
    } catch (err) {
      console.warn('[SessionTimeout] Failed to refresh backend session:', err);
    }
  }, []);

  // Manual timer reset helper
  const resetActivityTimer = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    if (isWarningOpenRef.current) {
      setIsWarningOpen(false);
      setSecondsRemaining(warningSeconds);
    }
    syncBackendActivity();
  }, [warningSeconds, syncBackendActivity]);

  // Stay Logged In - explicit button click in warning modal
  const handleStayLoggedIn = useCallback(async () => {
    const now = Date.now();
    lastActivityRef.current = now;
    setIsWarningOpen(false);
    setSecondsRemaining(warningSeconds);
    await syncBackendActivity();
  }, [warningSeconds, syncBackendActivity]);

  // Logout Now - explicit logout action
  const handleLogoutNow = useCallback(async () => {
    setIsWarningOpen(false);
    onLogout('MANUAL');
  }, [onLogout]);

  // Activity Event Listener Setup
  useEffect(() => {
    if (!isLoggedIn) {
      setIsWarningOpen(false);
      return;
    }

    // Reset baseline activity timestamp on login
    const initialNow = Date.now();
    lastActivityRef.current = initialNow;
    lastBackendSyncRef.current = initialNow;

    const handleUserActivity = () => {
      const now = Date.now();
      lastActivityRef.current = now;

      // CRITICAL REQUIREMENT:
      // If the warning modal is currently visible, ANY activity (mousemove, click, keydown, touch)
      // immediately dismisses the warning modal, resets the timer, and keeps the session active!
      if (isWarningOpenRef.current) {
        setIsWarningOpen(false);
        setSecondsRemaining(warningSeconds);
        // Immediately sync with backend so backend expires_at is refreshed without waiting
        syncBackendActivity();
        return;
      }

      // Performance requirement for mousemove and other frequent events:
      // Throttle backend synchronization (send keep-alive at most once every 30s)
      if (now - lastBackendSyncRef.current >= BACKEND_SYNC_INTERVAL_MS) {
        lastBackendSyncRef.current = now;
        syncBackendActivity();
      }
    };

    // Listen to ALL genuine user activity events including cursor movement
    const activityEvents = [
      'mousemove',
      'mousedown',
      'mouseup',
      'click',
      'keydown',
      'keyup',
      'scroll',
      'wheel',
      'touchstart',
      'touchend',
      'pointermove',
      'pointerdown'
    ];

    activityEvents.forEach(evt => {
      window.addEventListener(evt, handleUserActivity, { passive: true, capture: true });
    });

    return () => {
      activityEvents.forEach(evt => {
        window.removeEventListener(evt, handleUserActivity, true);
      });
    };
  }, [isLoggedIn, warningSeconds, syncBackendActivity]);

  // 1-Second Tick & Tab Visibility Monitoring
  useEffect(() => {
    if (!isLoggedIn) return;

    const checkInactivity = () => {
      if (!isLoggedInRef.current) return;

      const now = Date.now();
      const elapsedSeconds = Math.floor((now - lastActivityRef.current) / 1000);
      const remaining = Math.max(0, timeoutSeconds - elapsedSeconds);

      if (remaining <= 0) {
        // Continuous inactivity timeout reached (e.g. 5 minutes of NO interaction)
        console.warn('[SessionTimeout] 5 minutes of continuous inactivity reached. Logging out automatically.');
        setIsWarningOpen(false);
        onLogout('EXPIRED');
      } else if (remaining <= warningSeconds) {
        // Within warning window (e.g. 4m 30s to 5m) — show countdown warning modal
        setSecondsRemaining(remaining);
        if (!isWarningOpenRef.current) {
          setIsWarningOpen(true);
        }
      } else {
        // Outside warning window (user was active or timer reset) — ensure modal is hidden
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
