import { OracleFusionClient } from '../oracle/client.js';
import { config } from '../config.js';
import { mockRiskIncidents, mockSoDConflicts, mockAccessCertifications } from './mockData.js';

export interface AdvancedAccessRequest {
  id: string;
  personId?: number;
  requestedBy: string;
  requestedFor: string;
  justification: string;
  status: 'NEW' | 'APPROVED' | 'REJECTED' | 'PENDING' | string;
  violationCount: number;
  isAnalyzingRisk: boolean;
  isTemporaryAccess: boolean;
  creationDate: string;
  analysisCompletedOn?: string;
  raw?: any;
}

export interface AdvancedControl {
  id: string;
  name: string;
  description: string;
  status: string;
  category?: string;
  controlType?: string;
  riskLevel?: 'High' | 'Medium' | 'Low';
  incidentCount?: number;
  lastRunDate?: string;
}

export interface RiskCapabilities {
  advancedAccessRequests: {
    available: boolean;
    status: 'LIVE_AVAILABLE' | 'DEMO_MOCK' | 'UNAVAILABLE';
    message: string;
  };
  advancedControls: {
    available: boolean;
    status: 'LIVE_AVAILABLE' | 'DEMO_MOCK' | 'UNAVAILABLE';
    message: string;
  };
  controlIncidents: {
    available: boolean;
    status: 'LIVE_AVAILABLE' | 'DEMO_MOCK' | 'UNAVAILABLE';
    message: string;
  };
  accessCertifications: {
    available: boolean;
    status: 'SERVICE_NOT_ACTIVATED' | 'DEMO_MOCK' | 'UNAVAILABLE';
    message: string;
  };
}

export class RiskService {
  private client: OracleFusionClient;

  constructor(client: OracleFusionClient) {
    this.client = client;
  }

  isDemoMode(): boolean {
    return config.environmentMode !== 'ORACLE_FUSION';
  }

  // 1. Get Advanced Access Requests
  async getAccessRequests(options: { limit?: number; offset?: number; status?: string; user?: string } = {}): Promise<{
    success: boolean;
    dataSource: string;
    items: AdvancedAccessRequest[];
    totalCount: number;
    message?: string;
  }> {
    if (this.isDemoMode()) {
      const demoItems: AdvancedAccessRequest[] = [
        {
          id: '101',
          requestedBy: 'System Administrator',
          requestedFor: 'Karthika Claaps',
          justification: 'Role elevation for Q3 Financial Close',
          status: 'APPROVED',
          violationCount: 2,
          isAnalyzingRisk: false,
          isTemporaryAccess: true,
          creationDate: new Date(Date.now() - 86400000 * 2).toISOString(),
          analysisCompletedOn: new Date(Date.now() - 86400000 * 2).toISOString()
        },
        {
          id: '102',
          requestedBy: 'Audit Lead',
          requestedFor: 'Test1 Claaps',
          justification: 'Application Implementation Consultant access',
          status: 'NEW',
          violationCount: 4,
          isAnalyzingRisk: false,
          isTemporaryAccess: false,
          creationDate: new Date(Date.now() - 86400000 * 5).toISOString(),
          analysisCompletedOn: new Date(Date.now() - 86400000 * 5).toISOString()
        }
      ];
      return {
        success: true,
        dataSource: 'Sample Data',
        items: demoItems,
        totalCount: demoItems.length
      };
    }

    try {
      const data = await this.client.getAdvancedAccessRequests({
        limit: options.limit || 50,
        offset: options.offset || 0,
      });

      const rawItems = Array.isArray(data?.items) ? data.items : [];
      const normalized: AdvancedAccessRequest[] = rawItems.map((item: any) => ({
        id: String(item.AccessRequestId || item.id || ''),
        personId: item.PersonId,
        requestedBy: item.RequestedByDisplayName || 'Unknown Requester',
        requestedFor: item.RequestedForDisplayName || 'Unknown Target',
        justification: item.Justification || 'No justification specified',
        status: (item.RequestStatus || 'NEW').toUpperCase(),
        violationCount: parseInt(item.ControlViolationCount, 10) || 0,
        isAnalyzingRisk: String(item.IsAnalyzingRisk).toLowerCase() === 'true',
        isTemporaryAccess: String(item.IsTemporaryAccess).toLowerCase() === 'true',
        creationDate: item.CreationDate || new Date().toISOString(),
        analysisCompletedOn: item.ControlAnalysisCompletedOn,
        raw: item
      }));

      // Apply in-memory filters if provided
      let filtered = normalized;
      if (options.status && options.status !== 'ALL') {
        filtered = filtered.filter(r => r.status === options.status?.toUpperCase());
      }
      if (options.user) {
        const query = options.user.toLowerCase();
        filtered = filtered.filter(r => 
          r.requestedFor.toLowerCase().includes(query) || 
          r.requestedBy.toLowerCase().includes(query)
        );
      }

      return {
        success: true,
        dataSource: 'Live Oracle Fusion API',
        items: filtered,
        totalCount: normalized.length
      };
    } catch (err: any) {
      console.error('[Risk Service] getAccessRequests error:', err.message);
      return {
        success: false,
        dataSource: 'Live Oracle Fusion API',
        items: [],
        totalCount: 0,
        message: err.message || 'Failed to retrieve access requests from Oracle Fusion.'
      };
    }
  }

  // 2. Get Access Request by ID
  async getAccessRequestById(id: string): Promise<{
    success: boolean;
    item: AdvancedAccessRequest | null;
    message?: string;
  }> {
    if (this.isDemoMode()) {
      const all = await this.getAccessRequests();
      const match = all.items.find(i => i.id === id) || null;
      return { success: !!match, item: match };
    }

    try {
      const item = await this.client.getAccessRequestById(id);
      if (!item) return { success: false, item: null, message: 'Request not found' };

      return {
        success: true,
        item: {
          id: String(item.AccessRequestId || item.id || id),
          personId: item.PersonId,
          requestedBy: item.RequestedByDisplayName || 'Unknown Requester',
          requestedFor: item.RequestedForDisplayName || 'Unknown Target',
          justification: item.Justification || 'No justification provided',
          status: (item.RequestStatus || 'NEW').toUpperCase(),
          violationCount: parseInt(item.ControlViolationCount, 10) || 0,
          isAnalyzingRisk: String(item.IsAnalyzingRisk).toLowerCase() === 'true',
          isTemporaryAccess: String(item.IsTemporaryAccess).toLowerCase() === 'true',
          creationDate: item.CreationDate || new Date().toISOString(),
          analysisCompletedOn: item.ControlAnalysisCompletedOn,
          raw: item
        }
      };
    } catch (err: any) {
      return { success: false, item: null, message: err.message };
    }
  }

  // 3. Get Advanced Controls
  async getAdvancedControls(options: { limit?: number; offset?: number } = {}): Promise<{
    success: boolean;
    dataSource: string;
    items: AdvancedControl[];
    totalCount: number;
    message?: string;
  }> {
    if (this.isDemoMode()) {
      const demoControls: AdvancedControl[] = [
        {
          id: 'CTRL-001',
          name: 'Segregation of Duties: AP Invoice Creation & Payment Approval',
          description: 'Prevents the same identity from holding invoice creation and payment release privileges simultaneously.',
          status: 'ACTIVE',
          category: 'Financial Risk',
          controlType: 'Access Control',
          riskLevel: 'High',
          incidentCount: 2,
          lastRunDate: '2026-08-28'
        },
        {
          id: 'CTRL-002',
          name: 'Superuser Access Monitoring: IT Security Manager',
          description: 'Tracks administrative privilege assignments and unassigned role changes.',
          status: 'ACTIVE',
          category: 'IT General Control',
          controlType: 'Continuous Monitoring',
          riskLevel: 'Medium',
          incidentCount: 0,
          lastRunDate: '2026-08-28'
        }
      ];
      return {
        success: true,
        dataSource: 'Sample Data',
        items: demoControls,
        totalCount: demoControls.length
      };
    }

    try {
      const data = await this.client.getAdvancedControls({
        limit: options.limit || 50,
        offset: options.offset || 0,
      });

      const rawItems = Array.isArray(data?.items) ? data.items : [];
      const normalized: AdvancedControl[] = rawItems.map((item: any) => ({
        id: String(item.ControlId || item.id || ''),
        name: item.Name || item.ControlName || 'Advanced Security Control',
        description: item.Description || 'Automated Oracle Fusion Access Control Rule',
        status: item.Status || 'ACTIVE',
        category: item.Category || 'Access Control',
        controlType: item.ControlType || 'Automated Analysis',
        riskLevel: item.RiskLevel || 'Medium',
        incidentCount: item.IncidentCount || 0,
        lastRunDate: item.LastRunDate || item.LastUpdateDate
      }));

      return {
        success: true,
        dataSource: 'Live Oracle Fusion API',
        items: normalized,
        totalCount: normalized.length
      };
    } catch (err: any) {
      console.error('[Risk Service] getAdvancedControls error:', err.message);
      return {
        success: false,
        dataSource: 'Live Oracle Fusion API',
        items: [],
        totalCount: 0,
        message: err.message || 'Failed to retrieve advanced controls from Oracle Fusion.'
      };
    }
  }

  // 4. Get Capabilities Matrix
  getRiskCapabilities(): RiskCapabilities {
    if (this.isDemoMode()) {
      return {
        advancedAccessRequests: { available: true, status: 'DEMO_MOCK', message: 'Simulated access request risk data' },
        advancedControls: { available: true, status: 'DEMO_MOCK', message: 'Simulated advanced controls catalog' },
        controlIncidents: { available: true, status: 'DEMO_MOCK', message: 'Simulated control violation incidents' },
        accessCertifications: { available: true, status: 'DEMO_MOCK', message: 'Simulated access review campaigns' }
      };
    }

    return {
      advancedAccessRequests: {
        available: true,
        status: 'LIVE_AVAILABLE',
        message: 'Live Oracle Fusion FSCM REST API (/advancedAccessRequests) operational with live records.'
      },
      advancedControls: {
        available: true,
        status: 'LIVE_AVAILABLE',
        message: 'Live Oracle Fusion FSCM REST API (/advancedControls) operational.'
      },
      controlIncidents: {
        available: true,
        status: 'LIVE_AVAILABLE',
        message: 'Control incidents accessible via advanced controls child links.'
      },
      accessCertifications: {
        available: false,
        status: 'SERVICE_NOT_ACTIVATED',
        message: 'Access Certification Cloud standalone REST services are not deployed in this dev58 sandbox environment.'
      }
    };
  }
}
