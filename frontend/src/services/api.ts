const API_BASE = '/api';

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
  } catch (_) {}
}

export function setActiveAuthSession(token: string, email: string, role?: string, permissions?: string[]) {
  sessionStorage.setItem('authToken', token);
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

export async function apiRequest(endpoint: string, options: RequestInit = {}) {
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
    console.log(`[API Service] Deduplicating in-flight request: ${requestKey}`);
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
        if (res.status === 401 && endpoint !== '/auth/login') {
          console.warn('[API Service] 401 Unauthorized encountered, session expired.');
          clearActiveAuthSession();
          window.dispatchEvent(new CustomEvent('auth:expired'));
        }
        const errorData = await res.json().catch(() => ({}));
        const message = errorData.message || errorData.error || `Request failed with status ${res.status}`;
        const code = errorData.code || errorData.errorCode || errorData.error_code;
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
        if (!endpoint.includes('/investigations') && !endpoint.includes('/chat')) {
          clientCache.clear();
        }
      }

      return data;
    } catch (err) {
      console.error(`[API Service Error] Endpoint: ${endpoint}, Detail:`, err);
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

  // Audit Supervisor Dashboard Metrics (Mock Screen 5: Active Risks, Open Issues, Reports Generated)
  // Backend scopes rows to the caller's permissions; 401/403 surfaces here for AC6/AC7 handling.
  async getAuditSupervisorMetrics(options?: { refresh?: boolean }) {
    const query = options?.refresh ? '?refresh=true' : '';
    return apiRequest(`/dashboard/metrics${query}`);
  },

  // Assistant Chat
  async sendMessage(message: string, context?: any) {
    return apiRequest('/chat', {
      method: 'POST',
      body: JSON.stringify({ message, context }),
    });
  },

  // Capabilities
  async getCapabilities() {
    return apiRequest('/capabilities');
  },

  // Users
  async getUsers(filter?: string, startIndex?: number, count?: number) {
    const params = new URLSearchParams();
    if (filter) params.append('filter', filter);
    if (startIndex) params.append('startIndex', String(startIndex));
    if (count) params.append('count', String(count));
    params.append('source', 'oracle');
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`/users${query}`);
  },

  async getUser(userId: string) {
    return apiRequest(`/users/${userId}`);
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

  async getRoleHierarchyReport() {
    return apiRequest('/reports/role-hierarchy');
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
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`/audit${query}`);
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

  async getControlIncidents(controlId: string, pageOrOptions?: number | { page?: number; limit?: number; refresh?: boolean }, limit?: number, refresh?: boolean) {
    const params = new URLSearchParams();
    if (typeof pageOrOptions === 'number') {
      params.append('page', String(pageOrOptions));
      if (limit) params.append('limit', String(limit));
      if (refresh) params.append('refresh', 'true');
    } else if (pageOrOptions) {
      if (pageOrOptions.page) params.append('page', String(pageOrOptions.page));
      if (pageOrOptions.limit) params.append('limit', String(pageOrOptions.limit));
      if (pageOrOptions.refresh) params.append('refresh', 'true');
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`/risk/controls/${encodeURIComponent(controlId)}/incidents${query}`);
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

  async getRiskIncidents(options?: { controlId?: string; refresh?: boolean }) {
    const params = new URLSearchParams();
    if (options?.controlId) params.append('controlId', options.controlId);
    if (options?.refresh) params.append('refresh', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`/risk/incidents${query}`);
  },

  async getSoDConflicts() {
    return apiRequest('/risk/sod');
  },

  async getAccessCertifications(forceRefresh = false) {
    const query = forceRefresh ? `?t=${Date.now()}` : '';
    return apiRequest(`/access-certifications${query}`);
  },

  async getAccessCertificationDetails(certificationId: string) {
    const encodedId = encodeURIComponent(String(certificationId || '').trim());
    return apiRequest(`/access-certifications/${encodedId}/details`);
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
    groqModel?: string;
  }) {
    return apiRequest('/settings/toggle-mode', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
  },

  // Authentication APIs
  async login(params: { email: string; password?: string }) {
    return apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async getSessionStatus() {
    return apiRequest('/auth/status');
  },

  async refreshSession() {
    return apiRequest('/auth/refresh', {
      method: 'POST',
    });
  },

  async logout() {
    return apiRequest('/auth/logout', {
      method: 'POST',
    });
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
