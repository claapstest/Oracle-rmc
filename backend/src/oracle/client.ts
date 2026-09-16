import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config.js';

export class OracleFusionClient {
  private client!: AxiosInstance;

  constructor() {
    this.recreateClient();
  }

  recreateClient() {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (config.oracle.authType === 'BEARER' && config.oracle.token) {
      headers['Authorization'] = `Bearer ${config.oracle.token}`;
    } else if (config.oracle.authType === 'BASIC' && config.oracle.username && config.oracle.password) {
      const token = Buffer.from(`${config.oracle.username}:${config.oracle.password}`).toString('base64');
      headers['Authorization'] = `Basic ${token}`;
    }

    const activeBaseUrl = config.oracle.baseUrl || 'https://mock.fusion.oracle.com';
    console.log(`[Oracle Config] Active Base URL: ${activeBaseUrl}`);

    this.client = axios.create({
      baseURL: activeBaseUrl,
      headers,
      timeout: 30000, // 30 seconds
    });
  }

  // Translate raw Axios errors into human-friendly business messages
  private handleError(error: unknown, context: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const responseData = axiosError.response?.data;
      
      console.error(`[Oracle Client Error] Context: ${context}, Status: ${status}, Detail:`, responseData ? JSON.stringify(responseData, null, 2) : axiosError.message);

      if (axiosError.code === 'ECONNABORTED' || axiosError.message.toLowerCase().includes('timeout')) {
        throw new Error(
          'Oracle Fusion did not respond within the configured timeout'
        );
      }
      if (status === 400) {
        const errDetail = typeof responseData === 'object' && responseData !== null
          ? (responseData as any)?.detail || (responseData as any)?.['o:errorDetails']?.[0]?.detail || (responseData as any)?.message || (responseData as any)?.title || JSON.stringify(responseData)
          : String(responseData || '');
        const lower = errDetail.toLowerCase();
        if (lower.includes('businessobject') || lower.includes('business object') || lower.includes('requires a business object')) {
          throw new Error('Oracle Fusion requires a Business Object Type for this audit query.');
        }
        if (context.includes('Audit')) {
          throw new Error(errDetail || 'The audit history request was rejected by Oracle Fusion.');
        }
        throw new Error(
          errDetail || 'The resolved request was rejected by Oracle'
        );
      }
      if (status === 401) {
        throw new Error(
          'Oracle Fusion connection failed. We could not authenticate with the configured environment. Please check your credentials.'
        );
      }
      if (status === 403) {
        throw new Error(
          'Oracle Fusion access denied. The configured account does not have sufficient privileges to access security, SCIM, or audit APIs.'
        );
      }
      if (status === 404) {
        throw new Error(
          `Oracle Fusion resource not found. The endpoint associated with ${context} could not be located on the server.`
        );
      }
      if (status && status >= 500) {
        throw new Error(
          'Oracle Fusion server failure occurred while processing this request.'
        );
      }
      if (axiosError.code === 'ENOTFOUND' || !axiosError.response) {
        throw new Error(
          'Oracle Fusion host is unreachable. Please verify that the Base URL is correct and the server is online.'
        );
      }
    }
    
    throw new Error(`An error occurred while communicating with Oracle Fusion: ${(error as Error).message || error}`);
  }

  async testConnection(customConfig?: {
    baseUrl: string;
    authType: 'BASIC' | 'BEARER';
    username?: string;
    password?: string;
    token?: string;
  }): Promise<{ success: boolean; status: 'SUCCESS' | 'AUTH_FAILED' | 'FORBIDDEN' | 'UNREACHABLE' | 'ENDPOINT_UNAVAILABLE' | 'ERROR'; message: string }> {
    let testClient = this.client;
    
    if (customConfig) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      if (customConfig.authType === 'BEARER' && customConfig.token) {
        headers['Authorization'] = `Bearer ${customConfig.token}`;
      } else if (customConfig.authType === 'BASIC' && customConfig.username && customConfig.password) {
        const token = Buffer.from(`${customConfig.username}:${customConfig.password}`).toString('base64');
        headers['Authorization'] = `Basic ${token}`;
      }

      testClient = axios.create({
        baseURL: customConfig.baseUrl,
        headers,
        timeout: 10000,
      });
    } else {
      if (!config.oracle.baseUrl) {
        return { success: false, status: 'ERROR', message: 'Oracle Fusion Base URL is not configured. Please enter a valid URL.' };
      }
    }

    try {
      await testClient.get('/hcmRestApi/scim/Users', { params: { count: 1 } });
      return { 
        success: true, 
        status: 'SUCCESS',
        message: 'Connection successful. Successfully connected to Oracle Fusion SCIM API.' 
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const code = error.code;
        
        if (status === 401) {
          return {
            success: false,
            status: 'AUTH_FAILED',
            message: 'Authentication failed. Please verify that the Oracle username and password (or Bearer token) are correct.'
          };
        }
        if (status === 403) {
          return {
            success: false,
            status: 'FORBIDDEN',
            message: 'Access forbidden. The configured account does not have sufficient privileges to access SCIM APIs.'
          };
        }
        if (status === 404) {
          return {
            success: false,
            status: 'ENDPOINT_UNAVAILABLE',
            message: 'API endpoint unavailable. The Oracle SCIM Users API path (/hcmRestApi/scim/Users) could not be located on the server.'
          };
        }
        if (code === 'ECONNABORTED') {
          return {
            success: false,
            status: 'UNREACHABLE',
            message: 'Invalid/unreachable instance URL. Connection timed out. Oracle Fusion did not respond within the expected time.'
          };
        }
        if (code === 'ENOTFOUND' || !error.response) {
          return {
            success: false,
            status: 'UNREACHABLE',
            message: 'Invalid/unreachable instance URL. Oracle Fusion host is unreachable. Please verify that the Base URL is correct and the server is online.'
          };
        }
      }
      return { 
        success: false, 
        status: 'ERROR',
        message: `Connection failed: ${(error as Error).message || error}` 
      };
    }
  }

  async getUsers(params: { count?: number; startIndex?: number; filter?: string } = {}) {
    try {
      const response = await this.client.get('/hcmRestApi/scim/Users', {
        params: {
          count: params.count || 50,
          startIndex: params.startIndex || 1,
          filter: params.filter,
        },
      });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Get Users API');
    }
  }

  async getUser(userId: string) {
    try {
      const response = await this.client.get(`/hcmRestApi/scim/Users/${userId}`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Get User API for user ID "${userId}"`);
    }
  }

  async getRoles(params: { count?: number; startIndex?: number; filter?: string } = {}) {
    try {
      const response = await this.client.get('/hcmRestApi/scim/Roles', {
        params: {
          count: params.count || 50,
          startIndex: params.startIndex || 1,
          filter: params.filter,
        },
      });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Get Roles API');
    }
  }

  async getUsersByRole(roleName: string) {
    try {
      // Endpoint syntax: match by displayName or role code (name)
      const response = await this.client.get('/hcmRestApi/scim/Roles', {
        params: {
          filter: `displayName eq "${roleName}" or name eq "${roleName}"`,
        },
      });
      return response.data;
    } catch (error) {
      this.handleError(error, `Get Users by Role API for role "${roleName}"`);
    }
  }

  async getAuditHistory(
    payload: {
      product?: string;
      businessObjectType?: string;
      fromDate?: string;
      toDate?: string;
      username?: string;
      eventType?: string;
      includeChildObjects?: string;
      includeImpersonator?: string;
      includeAttributes?: string;
      attributeDetailMode?: string;
      includeExtendedObjectIdentifierColumns?: string;
    } = {},
    options: {
      pageNumber?: number;
      pageSize?: number;
    } = {}
  ) {
    try {
      const pageNumber = options.pageNumber || 1;
      const pageSize = options.pageSize || 500;
      const path = `/fscmRestApi/fndAuditRESTService/audittrail/getaudithistory?pageNumber=${pageNumber}&pageSize=${pageSize}`;
      console.log(`[Oracle Audit Request] Path: ${path}`);
      console.log(`[Oracle Audit Request] Body: ${JSON.stringify(payload)}`);
      
      const response = await this.client.post(path, payload);
      return response.data;
    } catch (error) {
      this.handleError(error, 'Get Audit History API');
    }
  }

  async getRoleBriefing(roleCode: string) {
    const activeBaseUrl = config.oracle.baseUrl || 'https://mock.fusion.oracle.com';
    const path = '/fscmRestApi/resources/11.13.18.05/advancedAccessRequests/action/getRoleBriefing';
    const fullUrl = `${activeBaseUrl}${path}`;
    const body = { roleCodes: [roleCode] };

    console.log(`[Role Briefing] Request started for role "${roleCode}"`);
    console.log(`[Oracle Role Briefing Request] Endpoint: ${fullUrl}`);
    console.log(`[Oracle Role Briefing Request] Method: POST`);
    console.log(`[Oracle Role Briefing Request] Body: ${JSON.stringify(body)}`);
    console.log(`[Oracle Role Briefing Request] Timeout: 12000ms`);

    const tStart = Date.now();
    try {
      const response = await this.client.post(
        path,
        body,
        {
          headers: {
            'Content-Type': 'application/vnd.oracle.adf.action+json',
            'Accept': 'application/json'
          },
          timeout: 12000 // 12-second timeout for non-blocking enrichment
        }
      );
      const elapsed = Date.now() - tStart;
      console.log(`[Role Briefing] Oracle response received: ${elapsed}ms`);
      return response.data;
    } catch (error: any) {
      const elapsed = Date.now() - tStart;
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        console.warn(`[Role Briefing] Request timeout after ${elapsed}ms for role "${roleCode}"`);
      } else {
        console.warn(`[Role Briefing] Request failed after ${elapsed}ms: ${error.message}`);
      }
      this.handleError(error, `Get Role Briefing API for role code "${roleCode}"`);
    }
  }

  async getAdvancedAccessRequests(options: { limit?: number; offset?: number; q?: string } = {}) {
    try {
      const params: Record<string, any> = {
        limit: options.limit || 25,
        offset: options.offset || 0,
      };
      if (options.q) {
        params.q = options.q;
      }
      const response = await this.client.get('/fscmRestApi/resources/11.13.18.05/advancedAccessRequests', {
        params,
      });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Get Advanced Access Requests API');
    }
  }

  async getAccessRequestById(id: string) {
    try {
      const response = await this.client.get(`/fscmRestApi/resources/11.13.18.05/advancedAccessRequests/${encodeURIComponent(id)}`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Get Access Request Detail API for ID "${id}"`);
    }
  }

  async getAdvancedControls(options: { limit?: number; offset?: number; q?: string } = {}) {
    try {
      const params: Record<string, any> = {
        limit: options.limit || 100,
        offset: options.offset || 0,
      };
      if (options.q) {
        params.q = options.q;
      }
      const response = await this.client.get('/fscmRestApi/resources/11.13.18.05/advancedControls', {
        params,
      });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Get Advanced Controls API');
    }
  }

  async getAdvancedControlById(controlId: string, expand: string = 'incidents') {
    try {
      const params: Record<string, any> = {};
      if (expand) {
        params.expand = expand;
      }
      const path = `/fscmRestApi/resources/11.13.18.05/advancedControls/${encodeURIComponent(controlId)}`;
      console.log(`[Oracle Client] GET ${path}${expand ? `?expand=${expand}` : ''}`);
      const response = await this.client.get(path, { params });
      return response.data;
    } catch (error) {
      this.handleError(error, `Get Advanced Control Detail API for ID "${controlId}"`);
    }
  }
}

