export interface TablePaginationState {
  currentPage: number;
  pageSize: number;
  filterText: string;
}

export interface SecuritySessionSnapshot {
  user: string;
  lastUpdated: number;
  messages: any[];
  tableStates: Record<number, TablePaginationState>;
  rolesListStates: Record<number, { currentPage: number }>;
  expandedDetails: Record<number, boolean>;
  inputValue?: string;
  scrollTop?: number;
}

const HISTORY_KEY_PREFIX = 'ask_security_history_';
const OLD_SESSION_PREFIX = 'security_intelligence_session_';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours retention period

/**
 * Saves a temporary snapshot of the Ask Security conversation into localStorage
 * associated with the authenticated user with a 24-hour retention timestamp.
 * Never persists tokens, passwords, or secrets.
 */
export function saveSecuritySession(username: string, session: Omit<SecuritySessionSnapshot, 'user' | 'lastUpdated'>) {
  if (!username) return;
  const normalizedUser = username.trim().toLowerCase();
  try {
    const snapshot: SecuritySessionSnapshot = {
      ...session,
      user: normalizedUser,
      lastUpdated: Date.now()
    };
    localStorage.setItem(`${HISTORY_KEY_PREFIX}${normalizedUser}`, JSON.stringify(snapshot));
    // Mirror to sessionStorage for backwards-compat in existing open tabs
    sessionStorage.setItem(`${OLD_SESSION_PREFIX}${normalizedUser}`, JSON.stringify(snapshot));
  } catch (err) {
    console.error('[SecuritySessionService] Failed to save session snapshot:', err);
  }
}

/**
 * Loads the temporary Ask Security snapshot for the specified user.
 * Validates user isolation and enforces the 24-hour expiration TTL.
 * Restores conversation across browser refresh, navigation, and re-login.
 */
export function loadSecuritySession(username: string): SecuritySessionSnapshot | null {
  if (!username) return null;
  const normalizedUser = username.trim().toLowerCase();
  try {
    let raw = localStorage.getItem(`${HISTORY_KEY_PREFIX}${normalizedUser}`);
    // Check fallback migration from sessionStorage if localStorage item isn't populated yet
    if (!raw) {
      raw = sessionStorage.getItem(`${OLD_SESSION_PREFIX}${normalizedUser}`);
    }
    // Also check raw un-normalized key for backward compatibility
    if (!raw && normalizedUser !== username) {
      raw = localStorage.getItem(`${HISTORY_KEY_PREFIX}${username}`) || sessionStorage.getItem(`${OLD_SESSION_PREFIX}${username}`);
    }
    if (!raw) return null;

    const session: SecuritySessionSnapshot = JSON.parse(raw);

    // User-specific isolation check (case-insensitive)
    if (!session.user || session.user.trim().toLowerCase() !== normalizedUser) {
      localStorage.removeItem(`${HISTORY_KEY_PREFIX}${normalizedUser}`);
      sessionStorage.removeItem(`${OLD_SESSION_PREFIX}${normalizedUser}`);
      return null;
    }

    // 24-hour TTL expiration check
    if (!session.lastUpdated || Date.now() - session.lastUpdated > TTL_MS) {
      localStorage.removeItem(`${HISTORY_KEY_PREFIX}${normalizedUser}`);
      sessionStorage.removeItem(`${OLD_SESSION_PREFIX}${normalizedUser}`);
      return null;
    }

    return session;
  } catch (err) {
    console.error('[SecuritySessionService] Failed to load session snapshot:', err);
    return null;
  }
}

/**
 * Clears the temporary Ask Security session.
 * Called when the user explicitly clicks "Clear History" or manual reset.
 */
export function clearSecuritySession(username?: string) {
  try {
    if (username) {
      const normalizedUser = username.trim().toLowerCase();
      localStorage.removeItem(`${HISTORY_KEY_PREFIX}${normalizedUser}`);
      sessionStorage.removeItem(`${OLD_SESSION_PREFIX}${normalizedUser}`);
      if (normalizedUser !== username) {
        localStorage.removeItem(`${HISTORY_KEY_PREFIX}${username}`);
        sessionStorage.removeItem(`${OLD_SESSION_PREFIX}${username}`);
      }
    }
    sessionStorage.removeItem('audit_trail_filter_state');

    // Remove any remaining ask_security_history or old session keys
    const localKeysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(HISTORY_KEY_PREFIX) || key.startsWith(OLD_SESSION_PREFIX))) {
        localKeysToRemove.push(key);
      }
    }
    localKeysToRemove.forEach(k => localStorage.removeItem(k));

    const sessionKeysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(OLD_SESSION_PREFIX)) {
        sessionKeysToRemove.push(key);
      }
    }
    sessionKeysToRemove.forEach(k => sessionStorage.removeItem(k));
  } catch (err) {
    console.error('[SecuritySessionService] Failed to clear session snapshot:', err);
  }
}

/**
 * Retrieves the list of user queries asked within the 24-hour retention period.
 */
export function getRecentQuestions(username: string): string[] {
  const session = loadSecuritySession(username);
  if (!session || !Array.isArray(session.messages)) return [];
  return session.messages
    .filter(m => m && m.sender === 'user' && m.text && typeof m.text === 'string')
    .map(m => m.text.trim())
    .filter(Boolean);
}
