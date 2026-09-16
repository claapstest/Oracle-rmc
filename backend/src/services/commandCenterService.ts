import axios, { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAVED_REQUESTS_FILE = path.join(__dirname, '../../command_center_saved.json');

export interface CommandCenterRequestPayload {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string; // Either full URL or relative path e.g. /fscmRestApi/resources/11.13.18.05/advancedControls
  params?: Record<string, string>;
  headers?: Record<string, string>;
  body?: any;
  authMode?: 'FUSION_DEFAULT' | 'NONE';
  timeoutMs?: number;
}

export interface DiagnosticInsight {
  category: 'SUCCESS' | 'BAD_REQUEST' | 'AUTH_FAILURE' | 'PERMISSION_DENIED' | 'NOT_FOUND' | 'REQUEST_TIMEOUT' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'SERVICE_UNAVAILABLE' | 'HOST_UNREACHABLE' | 'UNKNOWN';
  title: string;
  message: string;
  recommendation?: string;
  severity: 'success' | 'warning' | 'error' | 'info';
}

export interface CommandCenterExecutionResult {
  success: boolean;
  status: number;
  statusText: string;
  responseTimeMs: number;
  responseSizeBytes: number;
  responseSizeFormatted: string;
  timestamp: string;
  headers: Record<string, string>;
  data: any;
  requestUrl: string;
  diagnostic: DiagnosticInsight;
}

export interface HistoryItem {
  id: string;
  method: string;
  url: string;
  status: number;
  statusText: string;
  responseTimeMs: number;
  timestamp: string;
  success: boolean;
}

export interface SavedRequest {
  id: string;
  name: string;
  category: string;
  description?: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
  createdAt: string;
}

export interface CatalogEndpoint {
  id: string;
  name: string;
  category: string;
  subCategory?: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  defaultParams?: Record<string, string>;
  defaultHeaders?: Record<string, string>;
  defaultBody?: any;
  oracleDocumentationUrl?: string;
}

class CommandCenterService {
  private history: HistoryItem[] = [];
  private maxHistoryItems = 50;

  constructor() {
    this.ensureDefaultSavedRequests();
  }

  // Pre-configured catalog of verified Oracle Fusion endpoints
  getCatalog(): CatalogEndpoint[] {
    return [
      {
        id: 'risk-controls-all',
        name: 'Get All Advanced Controls',
        category: 'Risk Management',
        subCategory: 'Advanced Controls',
        method: 'GET',
        path: '/fscmRestApi/resources/11.13.18.05/advancedControls',
        description: 'Retrieves automated security & segregation of duties (SoD) controls configured in Oracle Fusion Risk Management.',
        defaultParams: {
          limit: '25',
          offset: '0'
        }
      },
      {
        id: 'risk-control-single',
        name: 'Get Advanced Control by ID',
        category: 'Risk Management',
        subCategory: 'Advanced Controls',
        method: 'GET',
        path: '/fscmRestApi/resources/11.13.18.05/advancedControls/{ControlId}',
        description: 'Fetches granular attributes, enforcement settings, state, and execution history for an individual control.',
        defaultParams: {}
      },
      {
        id: 'risk-control-incidents',
        name: 'Get Control Incidents',
        category: 'Risk Management',
        subCategory: 'Advanced Controls',
        method: 'GET',
        path: '/fscmRestApi/resources/11.13.18.05/advancedControls/{ControlId}/child/incidents',
        description: 'Lists real violation incidents flagged against a specific security control in Oracle Fusion.',
        defaultParams: {
          limit: '25'
        }
      },
      {
        id: 'risk-access-requests-all',
        name: 'Get All Access Requests',
        category: 'Risk Management',
        subCategory: 'Advanced Access Requests',
        method: 'GET',
        path: '/fscmRestApi/resources/11.13.18.05/advancedAccessRequests',
        description: 'Queries elevated and sensitive role assignment requests analyzed for SoD risk.',
        defaultParams: {
          limit: '25',
          offset: '0'
        }
      },
      {
        id: 'risk-access-request-single',
        name: 'Get Access Request Detail',
        category: 'Risk Management',
        subCategory: 'Advanced Access Requests',
        method: 'GET',
        path: '/fscmRestApi/resources/11.13.18.05/advancedAccessRequests/{id}',
        description: 'Fetches detailed justifications, request lifecycle status, and violation totals for an access request.',
        defaultParams: {}
      },
      {
        id: 'risk-role-briefing',
        name: 'Get Role Briefing Action',
        category: 'Risk Management',
        subCategory: 'Advanced Access Requests',
        method: 'POST',
        path: '/fscmRestApi/resources/11.13.18.05/advancedAccessRequests/action/getRoleBriefing',
        description: 'Executes the GRC AI role briefing action to extract functional role summaries and granted privileges.',
        defaultHeaders: {
          'Content-Type': 'application/vnd.oracle.adf.action+json',
          'Accept': 'application/json'
        },
        defaultBody: {
          roleCodes: ['ORA_FND_IT_SECURITY_MANAGER_JOB']
        }
      },
      {
        id: 'users-scim-list',
        name: 'List SCIM Users',
        category: 'Users & Identities',
        subCategory: 'SCIM API',
        method: 'GET',
        path: '/hcmRestApi/scim/Users',
        description: 'Queries user accounts and employee identities registered in Oracle Fusion Cloud HCM.',
        defaultParams: {
          count: '25',
          startIndex: '1'
        }
      },
      {
        id: 'users-scim-active',
        name: 'Filter Active SCIM Users',
        category: 'Users & Identities',
        subCategory: 'SCIM API',
        method: 'GET',
        path: '/hcmRestApi/scim/Users',
        description: 'Filters active user accounts using SCIM filter syntax.',
        defaultParams: {
          filter: 'active eq true',
          count: '25'
        }
      },
      {
        id: 'users-scim-single',
        name: 'Get SCIM User by ID',
        category: 'Users & Identities',
        subCategory: 'SCIM API',
        method: 'GET',
        path: '/hcmRestApi/scim/Users/{id}',
        description: 'Retrieves complete identity attributes, email addresses, and assigned security roles for a user.',
        defaultParams: {}
      },
      {
        id: 'roles-scim-list',
        name: 'List SCIM Roles',
        category: 'Roles Catalog',
        subCategory: 'SCIM API',
        method: 'GET',
        path: '/hcmRestApi/scim/Roles',
        description: 'Returns enterprise security roles configured in the Oracle Fusion Security Console.',
        defaultParams: {
          count: '25',
          startIndex: '1'
        }
      },
      {
        id: 'roles-scim-filter',
        name: 'Search Role by Display Name',
        category: 'Roles Catalog',
        subCategory: 'SCIM API',
        method: 'GET',
        path: '/hcmRestApi/scim/Roles',
        description: 'Searches for a specific role definition using SCIM query expressions.',
        defaultParams: {
          filter: 'displayName eq "IT Security Manager"'
        }
      },
      {
        id: 'audit-history-post',
        name: 'Query Audit Trail History',
        category: 'Audit Trail',
        subCategory: 'FND Audit REST Service',
        method: 'POST',
        path: '/fscmRestApi/fndAuditRESTService/audittrail/getaudithistory?pageNumber=1&pageSize=25',
        description: 'Queries configuration and identity audit trail events from Oracle Fusion FND Audit.',
        defaultHeaders: {
          'Content-Type': 'application/json'
        },
        defaultBody: {
          product: 'hcmCore',
          businessObjectType: 'oracle.apps.hcm.people.core.uiModel.view.ManagePersonVO',
          eventType: 'ALL',
          includeChildObjects: 'true',
          includeImpersonator: 'true',
          includeAttributes: 'true',
          attributeDetailMode: 'true'
        }
      },
      {
        id: 'integration-health-ping',
        name: 'Integration Health Ping',
        category: 'Oracle Integration',
        subCategory: 'Diagnostics',
        method: 'GET',
        path: '/hcmRestApi/scim/Users',
        description: 'Performs a lightweight 1-record ping to confirm authentication and SCIM service availability.',
        defaultParams: {
          count: '1'
        }
      }
    ];
  }

  // Resolves variable {{FUSION_BASE_URL}} and validates against SSRF
  private resolveAndValidateUrl(inputUrl: string): { fullUrl: string; baseUrl: string; path: string } {
    let rawBase = (config.oracle.baseUrl || '').trim().replace(/\/+$/, '');
    if (!rawBase) {
      throw new Error('Oracle Fusion Base URL is not configured in Oracle Integration settings.');
    }

    let parsedConfigBase: URL;
    try {
      parsedConfigBase = new URL(rawBase);
    } catch {
      throw new Error(`Configured Oracle Base URL "${rawBase}" is invalid.`);
    }

    let normalized = inputUrl.trim();
    // Replace variable template {{FUSION_BASE_URL}}
    normalized = normalized.replace(/\{\{\s*FUSION_BASE_URL\s*\}\}/gi, rawBase);

    let targetUrl: URL;
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      try {
        targetUrl = new URL(normalized);
      } catch {
        throw new Error(`The provided request URL "${normalized}" is malformed.`);
      }

      // STRICT SSRF CHECK: Host must match configured Oracle Fusion instance host exactly
      if (targetUrl.hostname.toLowerCase() !== parsedConfigBase.hostname.toLowerCase()) {
        throw new Error(
          `Security Policy Rejection (SSRF Protection): The destination host "${targetUrl.hostname}" does not match the configured Oracle Fusion host "${parsedConfigBase.hostname}". Command Center only connects to your approved Oracle Fusion environment.`
        );
      }
    } else {
      // Relative path: ensure leading slash
      const relativePath = normalized.startsWith('/') ? normalized : `/${normalized}`;
      targetUrl = new URL(relativePath, parsedConfigBase);
    }

    // Check protocol: must be https in production or match base
    if (targetUrl.protocol !== 'https:' && parsedConfigBase.protocol === 'https:') {
      throw new Error('Insecure protocol: Command Center requests to Oracle Fusion must use HTTPS.');
    }

    return {
      fullUrl: targetUrl.toString(),
      baseUrl: `${targetUrl.protocol}//${targetUrl.host}`,
      path: targetUrl.pathname + targetUrl.search
    };
  }

  // Format bytes into human readable string
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Classify diagnostic based on HTTP status code & payload
  private diagnoseResponse(status: number, data: any, errorMsg?: string): DiagnosticInsight {
    if (status >= 200 && status < 300) {
      return {
        category: 'SUCCESS',
        title: `${status} OK — Request Succeeded`,
        message: 'Oracle Fusion processed the request successfully and returned valid payload data.',
        severity: 'success'
      };
    }

    if (status === 400) {
      const errDetail = typeof data === 'object' && data !== null
        ? data?.detail || data?.['o:errorDetails']?.[0]?.detail || data?.message || data?.title || JSON.stringify(data)
        : String(data || errorMsg || 'Bad Request');
      return {
        category: 'BAD_REQUEST',
        title: '400 Bad Request',
        message: `Oracle Fusion rejected the request syntax or parameters: ${errDetail}`,
        recommendation: 'Verify the query parameter names, data types, and required payload fields against the Oracle REST API specification.',
        severity: 'warning'
      };
    }

    if (status === 401) {
      return {
        category: 'AUTH_FAILURE',
        title: '401 Unauthorized — Authentication Failed',
        message: 'Oracle Fusion rejected the session authentication credentials.',
        recommendation: 'Verify the configured Oracle Fusion username and password (or Bearer Token) in Oracle Integration settings.',
        severity: 'error'
      };
    }

    if (status === 403) {
      return {
        category: 'PERMISSION_DENIED',
        title: '403 Forbidden — Insufficient Privileges',
        message: 'The credentials authenticated successfully, but the user lacks the specific duty role or functional privilege required to access this REST resource.',
        recommendation: 'Grant the required Oracle Fusion duty role (e.g. ORA_FND_IT_SECURITY_MANAGER_JOB, Risk Management Administrator, or SCIM integration role) to the configured integration user.',
        severity: 'error'
      };
    }

    if (status === 404) {
      return {
        category: 'NOT_FOUND',
        title: '404 Not Found — Resource or Endpoint Unavailable',
        message: 'The requested REST resource URI does not exist on this Oracle Fusion instance or the targeted record ID was not found.',
        recommendation: 'Verify the version number (e.g., 11.13.18.05), endpoint casing, or verify that the specific record ID exists.',
        severity: 'warning'
      };
    }

    if (status === 408 || errorMsg?.toLowerCase().includes('timeout') || errorMsg?.toLowerCase().includes('econnaborted')) {
      return {
        category: 'REQUEST_TIMEOUT',
        title: 'Request Timeout',
        message: 'Oracle Fusion did not respond within the configured timeout duration.',
        recommendation: 'Check whether Oracle Fusion is under heavy batch processing load or increase the timeout limit.',
        severity: 'warning'
      };
    }

    if (status === 429) {
      return {
        category: 'RATE_LIMITED',
        title: '429 Too Many Requests — Rate Limited',
        message: 'Oracle Fusion has temporarily throttled incoming API requests for this integration identity.',
        recommendation: 'Introduce an exponential backoff interval before sending subsequent requests.',
        severity: 'warning'
      };
    }

    if (status === 500) {
      return {
        category: 'SERVER_ERROR',
        title: '500 Internal Server Error — Oracle Fusion Server Fault',
        message: 'An internal unhandled exception occurred within the Oracle Fusion application tier or ADF business components.',
        recommendation: 'Inspect Oracle Fusion server diagnostic incident logs or review query parameters to avoid triggering backend faults.',
        severity: 'error'
      };
    }

    if (status === 503) {
      return {
        category: 'SERVICE_UNAVAILABLE',
        title: '503 Service Unavailable — Maintenance / Outage',
        message: 'Oracle Fusion is currently undergoing quarterly maintenance or the targeted application service is restarting.',
        recommendation: 'Check your Oracle Cloud SaaS maintenance schedule or retry once the service lifecycle status returns to active.',
        severity: 'error'
      };
    }

    return {
      category: 'UNKNOWN',
      title: `${status || 'Error'} — Request Failed`,
      message: errorMsg || 'An unexpected error occurred while communicating with Oracle Fusion.',
      severity: 'error'
    };
  }

  // Execute an API request against Oracle Fusion securely
  async executeRequest(payload: CommandCenterRequestPayload): Promise<CommandCenterExecutionResult> {
    const { fullUrl } = this.resolveAndValidateUrl(payload.url);
    const method = (payload.method || 'GET').toUpperCase() as any;

    // Headers preparation (merging custom headers with secure Oracle authorization)
    const requestHeaders: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(payload.headers || {})
    };

    // Attach Oracle Fusion Credentials securely on the backend
    if (payload.authMode !== 'NONE') {
      if (config.oracle.authType === 'BEARER' && config.oracle.token) {
        requestHeaders['Authorization'] = `Bearer ${config.oracle.token}`;
      } else if (config.oracle.username && config.oracle.password) {
        const token = Buffer.from(`${config.oracle.username}:${config.oracle.password}`).toString('base64');
        requestHeaders['Authorization'] = `Basic ${token}`;
      }
    }

    const timeout = payload.timeoutMs || 30000;
    const startTime = Date.now();

    const axiosConfig: AxiosRequestConfig = {
      method,
      url: fullUrl,
      params: payload.params,
      headers: requestHeaders,
      timeout,
      validateStatus: () => true // Allow handling all status codes gracefully without throwing
    };

    if (['POST', 'PUT', 'PATCH'].includes(method) && payload.body !== undefined) {
      axiosConfig.data = typeof payload.body === 'string' ? JSON.parse(payload.body) : payload.body;
    }

    try {
      const response: AxiosResponse = await axios(axiosConfig);
      const elapsedMs = Date.now() - startTime;

      // Calculate payload size
      let sizeBytes = 0;
      if (response.data) {
        const dataStr = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        sizeBytes = Buffer.byteLength(dataStr, 'utf8');
      }

      // Filter and sanitize response headers (remove set-cookie and internal headers)
      const sanitizedHeaders: Record<string, string> = {};
      if (response.headers) {
        for (const [key, val] of Object.entries(response.headers)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey === 'set-cookie' || lowerKey.includes('authorization') || lowerKey.includes('password')) {
            sanitizedHeaders[key] = '********';
          } else {
            sanitizedHeaders[key] = String(val);
          }
        }
      }

      const diagnostic = this.diagnoseResponse(response.status, response.data);

      const result: CommandCenterExecutionResult = {
        success: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.statusText || (response.status === 200 ? 'OK' : 'Completed'),
        responseTimeMs: elapsedMs,
        responseSizeBytes: sizeBytes,
        responseSizeFormatted: this.formatBytes(sizeBytes),
        timestamp: new Date().toISOString(),
        headers: sanitizedHeaders,
        data: response.data,
        requestUrl: fullUrl,
        diagnostic
      };

      this.addHistoryItem({
        id: `req_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        method,
        url: payload.url,
        status: response.status,
        statusText: response.statusText,
        responseTimeMs: elapsedMs,
        timestamp: result.timestamp,
        success: result.success
      });

      return result;
    } catch (err: any) {
      const elapsedMs = Date.now() - startTime;
      let status = 0;
      let statusText = 'Network Error';
      let errorMsg = err.message || 'Unknown network failure';

      if (axios.isAxiosError(err)) {
        const axiosErr = err as AxiosError;
        if (axiosErr.code === 'ECONNABORTED' || axiosErr.message.toLowerCase().includes('timeout')) {
          status = 408;
          statusText = 'Request Timeout';
          errorMsg = `Request timed out after ${timeout}ms without response from Oracle Fusion.`;
        } else if (axiosErr.code === 'ENOTFOUND') {
          status = 502;
          statusText = 'Host Unreachable';
          errorMsg = `Unable to resolve host: ${(axiosErr as any).hostname || fullUrl}. Please verify network connectivity.`;
        }
      }

      const diagnostic = this.diagnoseResponse(status, null, errorMsg);

      const failedResult: CommandCenterExecutionResult = {
        success: false,
        status,
        statusText,
        responseTimeMs: elapsedMs,
        responseSizeBytes: 0,
        responseSizeFormatted: '0 B',
        timestamp: new Date().toISOString(),
        headers: {},
        data: { error: errorMsg },
        requestUrl: fullUrl,
        diagnostic
      };

      this.addHistoryItem({
        id: `req_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        method,
        url: payload.url,
        status,
        statusText,
        responseTimeMs: elapsedMs,
        timestamp: failedResult.timestamp,
        success: false
      });

      return failedResult;
    }
  }

  // Real connection test to Oracle Fusion
  async testConnection(): Promise<{
    connected: boolean;
    status: number;
    responseTimeMs: number;
    timestamp: string;
    message: string;
    baseUrl: string;
  }> {
    const rawBase = (config.oracle.baseUrl || '').trim();
    if (!rawBase) {
      return {
        connected: false,
        status: 0,
        responseTimeMs: 0,
        timestamp: new Date().toISOString(),
        message: 'Oracle Fusion Base URL is not configured.',
        baseUrl: ''
      };
    }

    const tStart = Date.now();
    try {
      const pingResult = await this.executeRequest({
        method: 'GET',
        url: '/hcmRestApi/scim/Users',
        params: { count: '1' },
        timeoutMs: 10000
      });

      const elapsed = Date.now() - tStart;
      const isConnected = pingResult.status === 200 || pingResult.status === 204;

      return {
        connected: isConnected,
        status: pingResult.status,
        responseTimeMs: elapsed,
        timestamp: new Date().toISOString(),
        message: isConnected
          ? 'Successfully reached Oracle Fusion REST API.'
          : pingResult.diagnostic.message,
        baseUrl: rawBase
      };
    } catch (err: any) {
      return {
        connected: false,
        status: 0,
        responseTimeMs: Date.now() - tStart,
        timestamp: new Date().toISOString(),
        message: err.message || 'Connection test failed.',
        baseUrl: rawBase
      };
    }
  }

  // History management
  private addHistoryItem(item: HistoryItem) {
    this.history.unshift(item);
    if (this.history.length > this.maxHistoryItems) {
      this.history.pop();
    }
  }

  getHistory(): HistoryItem[] {
    return this.history;
  }

  clearHistory(): void {
    this.history = [];
  }

  // Saved Requests Management
  private ensureDefaultSavedRequests(): void {
    if (!fs.existsSync(SAVED_REQUESTS_FILE)) {
      const defaults: SavedRequest[] = [
        {
          id: 'saved-1',
          name: 'All Advanced Controls',
          category: 'Risk Management',
          description: 'Live security and segregation of duties controls',
          method: 'GET',
          url: '/fscmRestApi/resources/11.13.18.05/advancedControls',
          params: { limit: '25', offset: '0' },
          createdAt: new Date().toISOString()
        },
        {
          id: 'saved-2',
          name: 'IT Security Manager Role Definition',
          category: 'Roles Catalog',
          description: 'SCIM query for high privilege administrative role',
          method: 'GET',
          url: '/hcmRestApi/scim/Roles',
          params: { filter: 'displayName eq "IT Security Manager"' },
          createdAt: new Date().toISOString()
        },
        {
          id: 'saved-3',
          name: 'Active HCM Person Audit History',
          category: 'Audit Trail',
          description: 'Recent ManagePerson audit events',
          method: 'POST',
          url: '/fscmRestApi/fndAuditRESTService/audittrail/getaudithistory?pageNumber=1&pageSize=25',
          body: JSON.stringify({
            product: 'hcmCore',
            businessObjectType: 'oracle.apps.hcm.people.core.uiModel.view.ManagePersonVO',
            eventType: 'ALL',
            includeChildObjects: 'true',
            includeImpersonator: 'true'
          }, null, 2),
          createdAt: new Date().toISOString()
        }
      ];
      try {
        fs.writeFileSync(SAVED_REQUESTS_FILE, JSON.stringify(defaults, null, 2), 'utf8');
      } catch (err) {
        console.error('[Command Center] Failed to write default saved requests:', err);
      }
    }
  }

  getSavedRequests(): SavedRequest[] {
    try {
      if (fs.existsSync(SAVED_REQUESTS_FILE)) {
        const content = fs.readFileSync(SAVED_REQUESTS_FILE, 'utf8');
        return JSON.parse(content);
      }
    } catch (err) {
      console.error('[Command Center] Error reading saved requests:', err);
    }
    return [];
  }

  saveRequest(reqItem: Omit<SavedRequest, 'id' | 'createdAt'> & { id?: string }): SavedRequest {
    const list = this.getSavedRequests();
    const id = reqItem.id || `saved_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const fullItem: SavedRequest = {
      ...reqItem,
      id,
      createdAt: new Date().toISOString()
    };

    const existingIndex = list.findIndex(item => item.id === id);
    if (existingIndex >= 0) {
      list[existingIndex] = fullItem;
    } else {
      list.unshift(fullItem);
    }

    try {
      fs.writeFileSync(SAVED_REQUESTS_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch (err) {
      console.error('[Command Center] Failed to save request item:', err);
    }
    return fullItem;
  }

  deleteSavedRequest(id: string): boolean {
    const list = this.getSavedRequests();
    const filtered = list.filter(item => item.id !== id);
    try {
      fs.writeFileSync(SAVED_REQUESTS_FILE, JSON.stringify(filtered, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('[Command Center] Failed to delete saved request item:', err);
      return false;
    }
  }
}

export const commandCenterService = new CommandCenterService();
