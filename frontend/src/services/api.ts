const API_BASE = (import.meta.env.VITE_API_BASE_URL ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/+$/, '') : '') + '/api';

const inflightRequests = new Map<string, Promise<any>>();

export function getActiveAuthToken(): string {
  // 1. Primary source: active browser session storage
  let token = sessionStorage.getItem('authToken');
  if (token) return token;

  // 2. Child tab bridge: ONLY if this window was opened specifically for an investigation
  const urlParams = new URLSearchParams(window.location.search);
  const currentInvId = urlParams.get('investigationId');

  if (currentInvId) {
    try {
      const bridgeRaw = localStorage.getItem('inv_tab_bridge');
      if (bridgeRaw) {
        const bridge = JSON.parse(bridgeRaw);
        // Clean up bridge immediately (single-use)
        localStorage.removeItem('inv_tab_bridge');
        if (bridge && bridge.targetId === currentInvId && bridge.token && Date.now() <= bridge.expiresAt) {
          token = bridge.token;
          sessionStorage.setItem('authToken', bridge.token);
          if (bridge.user) {
            sessionStorage.setItem('currentUser', bridge.user);
          }
          return token;
        }
      }
    } catch (_) {
      localStorage.removeItem('inv_tab_bridge');
    }
  } else {
    // Normal visit without investigationId: purge any stale bridge
    localStorage.removeItem('inv_tab_bridge');
  }

  return '';
}

export function getActiveUserEmail(): string {
  return sessionStorage.getItem('currentUser') || '';
}

export function getActiveUserRole(): string {
  return sessionStorage.getItem('userRole') || '';
}

export function getActiveUserPermissions(): string[] {
  try {
    const raw = sessionStorage.getItem('userPermissions');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (_) {
    return [];
  }
}

export function prepareInvestigationTabBridge(investigationId: string) {
  const token = sessionStorage.getItem('authToken');
  const user = sessionStorage.getItem('currentUser');
  if (!token) return;
  try {
    localStorage.setItem('inv_tab_bridge', JSON.stringify({
      targetId: investigationId,
      token,
      user: user || '',
      expiresAt: Date.now() + 15000 // 15 seconds validity
    }));
  } catch (_) { }
}

export function updateActiveAuthToken(token: string) {
  if (!token) return;
  sessionStorage.setItem('authToken', token.trim());
}

export function setActiveAuthSession(token: string, email: string, role?: string, permissions?: string[]) {
  sessionStorage.setItem('authToken', token.trim());
  sessionStorage.setItem('currentUser', email);
  if (role !== undefined) sessionStorage.setItem('userRole', role);
  if (permissions !== undefined) sessionStorage.setItem('userPermissions', JSON.stringify(permissions));
  // Clean any legacy persistent keys
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  localStorage.removeItem('tab_transfer_token');
  localStorage.removeItem('inv_tab_bridge');
}

export function clearActiveAuthSession() {
  sessionStorage.removeItem('authToken');
  sessionStorage.removeItem('currentUser');
  sessionStorage.removeItem('userRole');
  sessionStorage.removeItem('userPermissions');
  sessionStorage.removeItem('activePage');
  sessionStorage.removeItem('tab_transfer_token');
  localStorage.removeItem('tab_transfer_token');
  localStorage.removeItem('inv_tab_bridge');
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  clientCache.clear();
}

interface ClientCacheEntry {
  data: any;
  timestamp: number;
}
const clientCache = new Map<string, ClientCacheEntry>();

export function clearClientApiCache() {
  clientCache.clear();
}

export class ApiError extends Error {
  status: number;
  code?: string;
  data?: any;

  constructor(message: string, status: number, code?: string, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export interface ApiRequestOptions extends RequestInit {
  _isRetry?: boolean;
}

export async function apiRequest(endpoint: string, options: ApiRequestOptions = {}) {
  const method = options.method || 'GET';
  const body = options.body ? String(options.body) : '';
  const requestKey = `${method}:${endpoint}:${body}`;

  // Instant response from client-side cache for GET requests within 2 minutes
  if (method === 'GET') {
    const cached = clientCache.get(requestKey);
    if (cached && Date.now() - cached.timestamp < 2 * 60 * 1000) {
      return cached.data;
    }
  }

  if (inflightRequests.has(requestKey)) {
    // Zero sensitive data logged: log only HTTP method and path, never request body
    console.log(`[API Service] Deduplicating in-flight request: ${method} ${endpoint}`);
    return inflightRequests.get(requestKey);
  }

  const promise = (async () => {
    try {
      const token = getActiveAuthToken();
      const res = await fetch(`${API_BASE}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
          ...options.headers,
        },
        ...options,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const message = errorData.message || errorData.error || `Request failed with status ${res.status}`;
        const code = errorData.code || errorData.errorCode || errorData.error_code;

        // AC3: Transparent token renewal for 401 on protected endpoints (excluding auth routes)
        // Hard guarantee: _isRetry prevents infinite retry loops
        const isAuthEndpoint =
          endpoint.startsWith('/auth/login') ||
          endpoint.startsWith('/auth/logout') ||
          endpoint.startsWith('/auth/refresh') ||
          endpoint.startsWith('/auth/entra') ||
          endpoint.startsWith('/auth/reset-password');

        if (res.status === 401 && !isAuthEndpoint && !options._isRetry) {
          try {
            // Attempt silent session refresh to acquire a fresh RS256 JWT access token
            const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : '',
              },
            });

            if (refreshRes.ok) {
              const refreshData = await refreshRes.json();
              const freshToken = refreshData.token || refreshData.accessToken;
              if (freshToken) {
                updateActiveAuthToken(freshToken);
                // Retry the original request with the fresh token and _isRetry=true
                const retryHeaders = {
                  ...options.headers,
                  'Authorization': `Bearer ${freshToken}`,
                };
                return await apiRequest(endpoint, {
                  ...options,
                  headers: retryHeaders,
                  _isRetry: true,
                });
              }
            }
          } catch (_) {
            // Silent refresh failed; fall through to session expiration handling
          }
        }

        if (res.status === 401 && endpoint !== '/auth/login' && endpoint !== '/auth/entra/callback') {
          const isExplicitSessionExpiry =
            code === 'SESSION_EXPIRED' ||
            code === 'INVALID_TOKEN' ||
            endpoint === '/auth/status' ||
            endpoint === '/auth/refresh' ||
            options._isRetry;
          if (isExplicitSessionExpiry) {
            console.warn('[API Service] Explicit session expiration received. Redirecting to login.');
            clearActiveAuthSession();
            window.dispatchEvent(new CustomEvent('auth:expired'));
          }
        } else if (res.status === 403 && (code === 'USER_DISABLED' || code === 'ACCOUNT_INACTIVE')) {
          console.warn('[API Service] User account inactive or disabled. Revoking active session.');
          clearActiveAuthSession();
          window.dispatchEvent(new CustomEvent('auth:disabled', { detail: { message } }));
        }
        throw new ApiError(message, res.status, code, errorData);
      }

      const data = await res.json();

      // Store successful GET responses in fast client memory cache
      if (method === 'GET') {
        if (clientCache.size > 200) {
          const oldest = clientCache.keys().next().value;
          if (oldest) clientCache.delete(oldest);
        }
        clientCache.set(requestKey, { data, timestamp: Date.now() });
      } else if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
        // Invalidate cache on mutations
        if (!endpoint.includes('/investigations')) {
          clientCache.clear();
        }
      }

      return data;
    } catch (err) {
      // AC3: Zero sensitive data logged. Only log error message string, never raw headers or payload
      const safeDetail = err instanceof ApiError ? `HTTP ${err.status} (${err.code || 'UNKNOWN'})` : (err as Error)?.message || 'Unknown error';
      console.error(`[API Service Error] Endpoint: ${endpoint}, Detail: ${safeDetail}`);
      throw err;
    } finally {
      inflightRequests.delete(requestKey);
    }
  })();

  inflightRequests.set(requestKey, promise);
  return promise;
}

export const api = {
  // Overview Statistics
  async getOverviewStats() {
    return apiRequest('/overview/stats');
  },

  // Dedicated Risk Trend with Product & Event Type & Date Range filters
  async getRiskTrend(params?: {
    product?: string;
    eventType?: string;
    range?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.product && params.product !== 'ALL') query.set('product', params.product);
    if (params?.eventType && params.eventType !== 'ALL') query.set('eventType', params.eventType);
    if (params?.range) query.set('range', params.range);
    if (params?.fromDate) query.set('fromDate', params.fromDate);
    if (params?.toDate) query.set('toDate', params.toDate);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return apiRequest(`/dashboard/risk-trend${qs}`);
  },

  // Products with recent audit records (today, yesterday, 7d, 30d)
  async getProductActivity(options?: { timeframe?: string }) {
    const query = options?.timeframe ? `?timeframe=${encodeURIComponent(options.timeframe)}` : '';
    return apiRequest(`/dashboard/product-activity${query}`);
  },

  // On-demand Product-Level Audit Sync
  async syncProductActivity(product: string, options?: { businessObject?: string; fromDate?: string; toDate?: string }) {
    return apiRequest('/audit/sync/product', {
      method: 'POST',
      body: JSON.stringify({ product, ...options })
    });
  },

  // Audit Supervisor Dashboard Metrics (Mock Screen 5: Active Risks, Open Issues, Reports Generated)
  // Backend scopes rows to the caller's permissions; 401/403 surfaces here for AC6/AC7 handling.
  async getAuditSupervisorMetrics(options?: { refresh?: boolean }) {
    const query = options?.refresh ? '?refresh=true' : '';
    return apiRequest(`/dashboard/metrics${query}`);
  },

  // Capabilities
  async getCapabilities() {
    return apiRequest('/capabilities');
  },

  // Users
  async getUsers(
    filter?: string,
    startIndex?: number,
    count?: number,
    category?: string,
    status?: string,
    source: 'oracle' | 'database' = 'oracle'
  ) {
    const params = new URLSearchParams();
    if (filter) params.append('filter', filter);
    if (category && category !== 'ALL') params.append('category', category);
    if (status && status !== 'ALL') params.append('status', status);
    if (startIndex) params.append('startIndex', String(startIndex));
    if (count) params.append('count', String(count));
    params.append('source', source);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`/users${query}`);
  },

  async getUser(userId: string, source: string = 'oracle') {
    const params = new URLSearchParams();
    if (source) params.append('source', source);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`/users/${encodeURIComponent(userId)}${query}`);
  },

  // Roles
  async getRoles(filter?: string, category?: string, startIndex?: number, count?: number) {
    const params = new URLSearchParams();
    if (filter) params.append('filter', filter);
    if (category && category !== 'ALL') params.append('category', category);
    if (startIndex) params.append('startIndex', String(startIndex));
    if (count) params.append('count', String(count));
    params.append('source', 'oracle');
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`/roles${query}`);
  },

  async getRole(identifier: string) {
    const params = new URLSearchParams({ identifier });
    return apiRequest(`/roles/single?${params.toString()}`);
  },

  async getRoleMembers(roleName: string) {
    return apiRequest(`/roles/${encodeURIComponent(roleName)}/members`);
  },

  async getRolesValidation() {
    return apiRequest('/roles/validation');
  },

  async syncRoles() {
    return apiRequest('/roles/sync', { method: 'POST' });
  },

  async getRoleHierarchy(roleName: string) {
    return apiRequest(`/roles/${encodeURIComponent(roleName)}/hierarchy`);
  },

  async getRoleHierarchyReport(forceRefresh = false) {
    const res = await apiRequest(`/reports/role-hierarchy${forceRefresh ? '?refresh=true' : ''}`);
    if (res && Array.isArray(res.items) && Array.isArray(res.privilegesCatalog) && Array.isArray(res.privilegeSets)) {
      const resolvedSets = res.privilegeSets.map((ids: number[]) =>
        Array.isArray(ids) ? ids.map((id: number) => res.privilegesCatalog[id]).filter(Boolean) : []
      );
      res.items = res.items.map((item: any) => {
        if (Array.isArray(item.privileges)) return item;
        const setId = typeof item.privSetId === 'number' ? item.privSetId : -1;
        return {
          ...item,
          privileges: setId >= 0 ? (resolvedSets[setId] || []) : []
        };
      });
    }
    return res;
  },

  async syncRoleHierarchy() {
    return apiRequest('/reports/role-hierarchy/sync', { method: 'POST' });
  },

  // Mock 10 reports list: scope-enforced server-side (AC11).
  async getDbReports(options?: { limit?: number; category?: string; status?: string }) {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.category && options.category !== 'ALL') params.append('category', options.category);
    if (options?.status && options.status !== 'ALL') params.append('status', options.status);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`/reports/db${query}`);
  },

  async getUserAccessReport(options?: { refresh?: boolean }) {
    const query = options?.refresh ? '?refresh=true' : '';
    return apiRequest(`/reports/user-access${query}`);
  },

  async getRolePrivileges(roleName: string) {
    return apiRequest(`/roles/${encodeURIComponent(roleName)}/privileges`);
  },

  // Audit Logs & Product Catalog
  async getAuditProducts() {
    return apiRequest('/audit/products');
  },

  async getAuditLogs(
    filterOrParams?: string | {
      product?: string;
      businessObjectType?: string;
      fromDate?: string;
      toDate?: string;
      username?: string;
      action?: string;
      pageNumber?: number;
      pageSize?: number;
      source?: 'live' | 'database';
    },
    legacyAction?: string
  ) {
    const params = new URLSearchParams();
    if (typeof filterOrParams === 'string') {
      if (filterOrParams) params.append('username', filterOrParams);
      if (legacyAction && legacyAction !== 'ALL') params.append('action', legacyAction);
    } else if (filterOrParams && typeof filterOrParams === 'object') {
      if (filterOrParams.product) params.append('product', filterOrParams.product);
      if (filterOrParams.businessObjectType) params.append('businessObjectType', filterOrParams.businessObjectType);
      if (filterOrParams.fromDate) params.append('fromDate', filterOrParams.fromDate);
      if (filterOrParams.toDate) params.append('toDate', filterOrParams.toDate);
      if (filterOrParams.username) params.append('username', filterOrParams.username);
      if (filterOrParams.action && filterOrParams.action !== 'ALL') params.append('action', filterOrParams.action);
      if (filterOrParams.pageNumber) params.append('pageNumber', String(filterOrParams.pageNumber));
      if (filterOrParams.pageSize) params.append('pageSize', String(filterOrParams.pageSize));
      if (filterOrParams.source) params.append('source', filterOrParams.source);
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`/audit${query}`);
  },

  async syncAuditTrail(payload?: {
    product?: string;
    businessObjectType?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    return apiRequest('/audit/sync', {
      method: 'POST',
      body: JSON.stringify(payload || {})
    });
  },

  // GRC / Risk Management
  async getAdvancedAccessRequests(options?: { limit?: number; offset?: number; status?: string; user?: string }) {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.offset) params.append('offset', String(options.offset));
    if (options?.status) params.append('status', options.status);
    if (options?.user) params.append('user', options.user);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`/risk/access-requests${query}`);
  },

  async getAccessRequestById(id: string) {
    return apiRequest(`/risk/access-requests/${encodeURIComponent(id)}`);
  },

  async getAdvancedControls(options?: { limit?: number; offset?: number }) {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.offset) params.append('offset', String(options.offset));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`/risk/controls${query}`);
  },

  async getAdvancedControlDetail(controlId: string, refresh?: boolean) {
    return apiRequest(`/risk/controls/${encodeURIComponent(controlId)}${refresh ? '?refresh=true' : ''}`);
  },

  async getControlIncidents(
    controlId: string,
    pageOrOptions?: number | {
      page?: number;
      limit?: number;
      refresh?: boolean;
      filters?: {
        statuses?: string[];
        states?: string[];
        search?: string;
        globalUser?: string;
        role?: string;
        accessEntitlement?: string;
        accessPointName?: string;
        accessPointType?: string;
        priority?: string;
        groupingValue?: string;
        group?: string;
        dataSource?: string;
        incidentInformation?: string;
        createdBy?: string;
        investigator?: string;
        lastUpdatedBy?: string;
      };
    },
    limit?: number,
    refresh?: boolean,
    filters?: Record<string, any>
  ) {
    const params = new URLSearchParams();
    let effectiveFilters: Record<string, any> | undefined = filters;

    if (typeof pageOrOptions === 'number') {
      params.append('page', String(pageOrOptions));
      if (limit) params.append('limit', String(limit));
      if (refresh) params.append('refresh', 'true');
    } else if (pageOrOptions) {
      if (pageOrOptions.page) params.append('page', String(pageOrOptions.page));
      if (pageOrOptions.limit) params.append('limit', String(pageOrOptions.limit));
      if (pageOrOptions.refresh) params.append('refresh', 'true');
      effectiveFilters = pageOrOptions.filters || effectiveFilters;
    }

    if (effectiveFilters) {
      if (Array.isArray(effectiveFilters.statuses) && effectiveFilters.statuses.length > 0) {
        params.append('statuses', effectiveFilters.statuses.join(','));
      }
      if (Array.isArray(effectiveFilters.states) && effectiveFilters.states.length > 0) {
        params.append('states', effectiveFilters.states.join(','));
      }
      const strKeys = [
        'search',
        'globalUser',
        'role',
        'accessEntitlement',
        'accessPointName',
        'accessPointType',
        'priority',
        'groupingValue',
        'group',
        'dataSource',
        'incidentInformation',
        'createdBy',
        'investigator',
        'lastUpdatedBy'
      ];
      for (const k of strKeys) {
        const val = typeof effectiveFilters[k] === 'string' ? effectiveFilters[k].trim() : '';
        if (val && val.toUpperCase() !== 'ALL') {
          params.append(k, val);
        }
      }
    }

    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`/risk/controls/${encodeURIComponent(controlId)}/incidents${query}`);
  },

  async getControlIncidentFacets(controlId: string) {
    return apiRequest(`/risk/controls/${encodeURIComponent(controlId)}/incidents/facets`);
  },

  async getControlIncidentCounts(sync?: boolean) {
    return apiRequest(`/risk/controls/counts${sync ? '?sync=true' : ''}`);
  },

  async getControlIncidentCount(controlId: string, refresh?: boolean) {
    return apiRequest(`/risk/controls/${encodeURIComponent(controlId)}/count${refresh ? '?refresh=true' : ''}`);
  },

  async refreshAdvancedControls() {
    return apiRequest('/risk/controls/refresh', {
      method: 'POST',
    });
  },

  // Control Reporting Data Layer API
  async getControlSummaryReport(options?: { refresh?: boolean; scan?: boolean }) {
    const params = new URLSearchParams();
    if (options?.refresh) params.append('refresh', 'true');
    if (options?.scan) params.append('scan', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`/risk/reports/control-summary${query}`);
  },

  async probeControlIncidentCount(controlId: string) {
    return apiRequest(`/risk/reports/control-summary/${encodeURIComponent(controlId)}`);
  },

  async getRiskCapabilities() {
    return apiRequest('/risk/capabilities');
  },

  async getRiskIncidents(options?: { controlId?: string; controls?: string[]; user?: string; role?: string; refresh?: boolean; page?: number; limit?: number; search?: string; status?: string; state?: string; domain?: string }) {
    const params = new URLSearchParams();
    if (options?.controlId) params.append('controlId', options.controlId);
    if (options?.controls && options.controls.length > 0) params.append('controls', options.controls.join(','));
    if (options?.user && options.user.trim()) params.append('user', options.user.trim());
    if (options?.role && options.role.trim()) params.append('role', options.role.trim());
    if (options?.refresh) params.append('refresh', 'true');
    if (options?.page) params.append('page', String(options.page));
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.search && options.search.trim()) params.append('search', options.search.trim());
    if (options?.status && options.status !== 'ALL') params.append('status', options.status);
    if (options?.state && options.state !== 'ALL') params.append('state', options.state);
    if (options?.domain && options.domain !== 'ALL') params.append('domain', options.domain);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`/risk/incidents${query}`);
  },

  async getSoDConflicts() {
    return apiRequest('/risk/sod');
  },

  // Incident Analytics: top-N aggregation endpoints (backend contract below).
  // GET /api/risk/incidents/top-users?limit=10&controls=11005,11067
  //   -> { success, items: [{ user, incidents }] }
  // GET /api/risk/incidents/top-roles?limit=10&controls=11005,11067
  //   -> { success, items: [{ role, incidents }] }
  // `controls` is optional; omitted = all controls in the active environment.
  async getTopIncidentUsers(limit = 10, controls?: string[]) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (controls && controls.length > 0) params.append('controls', controls.join(','));
    return apiRequest(`/risk/incidents/top-users?${params.toString()}`);
  },

  async getTopIncidentRoles(limit = 10, controls?: string[]) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (controls && controls.length > 0) params.append('controls', controls.join(','));
    return apiRequest(`/risk/incidents/top-roles?${params.toString()}`);
  },

  async getAccessCertifications(forceRefresh = false) {
    const query = forceRefresh ? `?t=${Date.now()}` : '';
    return apiRequest(`/access-certifications${query}`);
  },

  async getAccessCertificationDetails(certificationId: string, forceRefresh = false) {
    const encodedId = encodeURIComponent(String(certificationId || '').trim());
    const query = forceRefresh ? `?refresh=true&t=${Date.now()}` : '';
    return apiRequest(`/access-certifications/${encodedId}/details${query}`);
  },

  // Configuration Settings
  async getSettings() {
    return apiRequest('/settings');
  },

  async testSettingsConnection(params?: {
    baseUrl: string;
    authType: string;
    username?: string;
    password?: string;
    token?: string;
  }) {
    return apiRequest('/settings/test-connection', {
      method: 'POST',
      body: params ? JSON.stringify(params) : undefined,
    });
  },

  async saveSettings(settings: {
    mode: 'DEMO' | 'ORACLE_FUSION';
    baseUrl?: string;
    authType?: string;
    username?: string;
    password?: string;
    token?: string;
  }) {
    return apiRequest('/settings/toggle-mode', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
  },

  // Admin Global Synchronization APIs (AC: Off-peak & Mutex Protected)
  async getAdminSyncStatus() {
    return apiRequest('/admin/sync/status');
  },

  async startAdminFullSync() {
    return apiRequest('/admin/sync/full', {
      method: 'POST'
    });
  },

  // Authentication APIs
  async getAuthConfig() {
    return apiRequest('/auth/config');
  },

  async startEntraLogin() {
    return apiRequest('/auth/entra/start', { credentials: 'include' });
  },

  async completeEntraLogin(params: { code: string; state: string }) {
    const res = await apiRequest('/auth/entra/callback', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify(params),
    });
    const token = res?.token || res?.accessToken;
    if (res?.success && token) {
      setActiveAuthSession(token, res.email, res.role, res.permissions);
    }
    return res;
  },

  async login(params: { email: string; password?: string; force?: boolean }) {
    const res = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    const token = res?.token || res?.accessToken;
    if (res?.success && token) {
      setActiveAuthSession(token, res.email || params.email, res.role, res.permissions);
    }
    return res;
  },

  async getSessionStatus() {
    return apiRequest('/auth/status');
  },

  async refreshSession() {
    const res = await apiRequest('/auth/refresh', {
      method: 'POST',
    });
    const freshToken = res?.token || res?.accessToken;
    if (res?.success && freshToken) {
      updateActiveAuthToken(freshToken);
    }
    return res;
  },

  async logout(params?: { postLogoutRedirectUri?: string; upstream?: boolean }) {
    try {
      const token = getActiveAuthToken();
      return await apiRequest('/auth/logout', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: params ? JSON.stringify({ ...params, token }) : (token ? JSON.stringify({ token }) : undefined),
      });
    } finally {
      clearActiveAuthSession();
      clearClientApiCache();
    }
  },

  async resetPassword(params: { email: string; resetCode: string; newPassword?: string }) {
    return apiRequest('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  // Admin Portal user/password reset actions
  async getAdminUsers() {
    return apiRequest('/admin/users');
  },

  async toggleUserAccountStatus(email: string, active: boolean) {
    return apiRequest('/admin/users/toggle-status', {
      method: 'POST',
      body: JSON.stringify({ email, active }),
    });
  },

  async generateResetCode(email: string) {
    return apiRequest('/admin/users/generate-reset-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async revokeResetCode(email: string) {
    return apiRequest('/admin/users/revoke-reset-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async deleteUserAccount(email: string) {
    return apiRequest('/admin/users/delete', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  // Application Users List management (Mock Screen 8).
  // List is readable with USERS_LIST privilege; mutations are Site Admin only
  // (backend requireAdmin) and surface 403/400/404 for AC10 handling.
  async createAppUser(payload: {
    email: string;
    displayName?: string;
    role?: string;
    password?: string;
    status?: string;
    applicationAccess?: string[];
    sendInvitation?: boolean;
  }) {
    return apiRequest('/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateAppUser(
    id: string,
    payload: {
      displayName?: string;
      role?: string;
      status?: string;
      password?: string;
    }
  ) {
    return apiRequest(`/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async deleteAppUser(id: string) {
    return apiRequest(`/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  // Investigation Snapshots (24h Retention)
  async saveInvestigation(id: string, payload: any) {
    return apiRequest('/investigations', {
      method: 'POST',
      body: JSON.stringify({ id, payload }),
    });
  },

  async getInvestigation(id: string) {
    return apiRequest(`/investigations/${id}`);
  },

  // Role & Privilege Catalog APIs
  async getRolePrivilegeCatalogStatus() {
    return apiRequest('/catalog/role-privileges');
  },

  async syncRolePrivilegeCatalog() {
    return apiRequest('/catalog/role-privileges/sync', {
      method: 'POST',
    });
  },

  async getRolesByPrivilege(privilege: string) {
    return apiRequest(`/catalog/role-privileges/roles-by-privilege?privilege=${encodeURIComponent(privilege)}`);
  },

  async getPrivilegesByRole(role: string) {
    return apiRequest(`/catalog/role-privileges/privileges-by-role?role=${encodeURIComponent(role)}`);
  },

  async getUsersByPrivilege(privilege: string, page = 1, pageSize = 50) {
    return apiRequest(`/catalog/users-by-privilege?privilege=${encodeURIComponent(privilege)}&page=${page}&pageSize=${pageSize}`);
  },

  async getPrivilegesByUser(username: string, page = 1, pageSize = 100) {
    return apiRequest(`/catalog/privileges-by-user?username=${encodeURIComponent(username)}&page=${page}&pageSize=${pageSize}`);
  },

  // ==========================================
  // Oracle API Console Operations & Diagnostics
  // ==========================================
  async executeCommandCenterRequest(payload: {
    method: string;
    url: string;
    params?: Record<string, string>;
    headers?: Record<string, string>;
    body?: any;
    authMode?: 'FUSION_DEFAULT' | 'NONE';
    timeoutMs?: number;
  }) {
    return apiRequest('/command-center/request', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async testCommandCenterConnection() {
    return apiRequest('/command-center/test-connection', {
      method: 'POST',
    });
  },

  async getCommandCenterCatalog() {
    return apiRequest('/command-center/catalog');
  },

  async getCommandCenterHistory() {
    return apiRequest('/command-center/history');
  },

  async clearCommandCenterHistory() {
    return apiRequest('/command-center/history', {
      method: 'DELETE',
    });
  },

  async getCommandCenterSavedRequests() {
    return apiRequest('/command-center/saved-requests');
  },

  async saveCommandCenterRequest(payload: {
    id?: string;
    name: string;
    category?: string;
    description?: string;
    method: string;
    url: string;
    params?: Record<string, string>;
    headers?: Record<string, string>;
    body?: string;
  }) {
    return apiRequest('/command-center/saved-requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async deleteCommandCenterSavedRequest(id: string) {
    return apiRequest(`/command-center/saved-requests/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
};
