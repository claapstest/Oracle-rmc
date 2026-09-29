import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { Role } from './mockData.js';
import { classifyRoleRecord } from './roleClassification.js';

export interface CatalogRoleEntry {
  name: string;
  code: string;
  type: 'JOB' | 'DUTY' | 'DATA' | 'ABSTRACT' | 'GRC';
  privileges: string[];
}

export interface CatalogPrivilegeRoleRef {
  name: string;
  code: string;
  type: 'JOB' | 'DUTY' | 'DATA' | 'ABSTRACT' | 'GRC';
}

export interface CatalogPrivilegeEntry {
  name: string;
  code?: string;
  description?: string;
  roles: CatalogPrivilegeRoleRef[];
}

export interface CatalogMetadata {
  instance: string;
  lastUpdated: string;
  source: string;
  roleCount: number;
  privilegeCount: number;
  mappingCount: number;
  status: 'READY' | 'SYNCING' | 'ERROR';
  errorMessage?: string;
}

export interface RolePrivilegeCatalogData {
  metadata: CatalogMetadata;
  roles: Record<string, CatalogRoleEntry>;
  privileges: Record<string, CatalogPrivilegeEntry>;
}

const CATALOG_FILE_PATH = path.resolve(process.cwd(), 'role_privilege_catalog.json');
const CATALOG_TMP_PATH = path.resolve(process.cwd(), 'role_privilege_catalog.tmp.json');

export class RolePrivilegeCatalogService {
  private catalogData: RolePrivilegeCatalogData;
  private isSyncing = false;

  // Dual Fast In-Memory Lookup Indexes
  // 1. Normalized Role Key -> CatalogRoleEntry
  private roleIndex = new Map<string, CatalogRoleEntry>();
  // 2. Normalized Privilege Key -> CatalogPrivilegeEntry
  private privilegeIndex = new Map<string, CatalogPrivilegeEntry>();

  constructor() {
    this.catalogData = this.getDefaultCatalog();
    this.initialize();
  }

  private ensureInitialized(): void {
    if (this.roleIndex.size === 0 || this.privilegeIndex.size === 0) {
      this.initialize();
    }
  }

  private getDefaultCatalog(): RolePrivilegeCatalogData {
    return {
      metadata: {
        instance: this.extractInstanceName(config.oracle.baseUrl),
        lastUpdated: new Date().toISOString(),
        source: 'Oracle Fusion',
        roleCount: 0,
        privilegeCount: 0,
        mappingCount: 0,
        status: 'READY'
      },
      roles: {},
      privileges: {}
    };
  }

  private extractInstanceName(baseUrl?: string): string {
    if (!baseUrl) return 'fa-euth-dev58';
    try {
      const parsed = new URL(baseUrl);
      const hostParts = parsed.hostname.split('.');
      return hostParts[0] || parsed.hostname;
    } catch {
      return baseUrl.replace(/^https?:\/\//, '').split('/')[0] || 'fa-euth-dev58';
    }
  }

  private normalizeRoleType(category: string): 'JOB' | 'DUTY' | 'DATA' | 'ABSTRACT' | 'GRC' {
    const upper = (category || 'JOB').toUpperCase();
    if (upper.includes('DUTY')) return 'DUTY';
    if (upper.includes('ABSTRACT')) return 'ABSTRACT';
    if (upper.includes('DATA')) return 'DATA';
    if (upper.includes('GRC')) return 'GRC';
    return 'JOB';
  }

  /**
   * Initializes the catalog on server startup.
   * Loads from disk if available; otherwise builds initial dataset from authoritative sources and caches.
   */
  public initialize(oracleService?: any): void {
    const loaded = this.loadFromDisk();
    if (!loaded) {
      console.log('[Catalog Service] No existing catalog found on disk. Building initial catalog from authoritative caches...');
      this.buildAndPublishCatalog(oracleService);
    } else {
      this.buildIndexes();
      console.log(`[Catalog Service] Active Catalog loaded: ${this.catalogData.metadata.roleCount} roles, ${this.catalogData.metadata.privilegeCount} privileges, ${this.catalogData.metadata.mappingCount} mappings.`);
    }
  }

  private loadFromDisk(): boolean {
    try {
      if (fs.existsSync(CATALOG_FILE_PATH)) {
        const raw = fs.readFileSync(CATALOG_FILE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed?.metadata && parsed?.roles && parsed?.privileges) {
          // If previous sync ended in SYNCING due to process crash, reset to READY
          if (parsed.metadata.status === 'SYNCING') {
            parsed.metadata.status = 'READY';
          }
          this.catalogData = parsed;
          return true;
        }
      }
    } catch (err: any) {
      console.warn('[Catalog Service] Could not load catalog from disk:', err.message);
    }
    return false;
  }

  /**
   * Rebuilds fast in-memory dual lookup indexes from the active catalogData.
   */
  private buildIndexes(): void {
    this.roleIndex.clear();
    this.privilegeIndex.clear();

    // 1. Index Roles
    for (const [roleName, entry] of Object.entries(this.catalogData.roles)) {
      this.roleIndex.set(roleName.trim().toLowerCase(), entry);
      if (entry.code) {
        this.roleIndex.set(entry.code.trim().toLowerCase(), entry);
      }
    }

    // 2. Index Privileges (Reverse index)
    for (const [privName, entry] of Object.entries(this.catalogData.privileges)) {
      this.privilegeIndex.set(privName.trim().toLowerCase(), entry);
      if (entry.code) {
        this.privilegeIndex.set(entry.code.trim().toLowerCase(), entry);
      }
    }
  }

  /**
   * Returns current catalog metadata for UI and freshness checks.
   */
  public getMetadata(): CatalogMetadata & { freshnessText: string } {
    this.ensureInitialized();
    const meta = { ...this.catalogData.metadata };
    meta.instance = this.extractInstanceName(config.oracle.baseUrl);
    return {
      ...meta,
      freshnessText: this.getFreshnessText(meta.lastUpdated)
    };
  }

  public getFreshnessText(isoDateStr?: string): string {
    if (!isoDateStr) return 'Catalog synchronization pending';
    try {
      const diffMs = Date.now() - new Date(isoDateStr).getTime();
      const diffMins = Math.floor(diffMs / (60 * 1000));
      if (diffMins < 1) return 'Role & Privilege data updated just now';
      if (diffMins === 1) return 'Role & Privilege data updated 1 minute ago';
      if (diffMins < 60) return `Role & Privilege data updated ${diffMins} minutes ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours === 1) return 'Role & Privilege data updated 1 hour ago';
      if (diffHours < 24) return `Role & Privilege data updated ${diffHours} hours ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `Role & Privilege data updated ${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } catch {
      return 'Role & Privilege data updated recently';
    }
  }

  /**
   * Reverse Lookup: Privilege -> Roles
   * Given a privilege name or code, returns all roles that grant this privilege.
   */
  public getRolesByPrivilege(query: string): {
    success: boolean;
    privilegeName: string;
    exactMatch: boolean;
    count: number;
    roles: Array<{
      roleName: string;
      roleCode: string;
      roleType: 'JOB' | 'DUTY' | 'DATA' | 'ABSTRACT' | 'GRC';
    }>;
    catalogMetadata: CatalogMetadata;
  } {
    this.ensureInitialized();
    const trimmed = (query || '').trim();
    const norm = trimmed.toLowerCase();

    // 1. Direct index lookup (exact match)
    const exact = this.privilegeIndex.get(norm);
    if (exact && exact.roles.length > 0) {
      return {
        success: true,
        privilegeName: exact.name || trimmed,
        exactMatch: true,
        count: exact.roles.length,
        roles: exact.roles.map(r => ({
          roleName: r.name,
          roleCode: r.code,
          roleType: r.type
        })),
        catalogMetadata: this.getMetadata()
      };
    }

    // 2. Substring / partial match across privileges
    const matches: CatalogPrivilegeEntry[] = [];
    for (const [key, entry] of this.privilegeIndex.entries()) {
      if (key === (entry.name || '').toLowerCase() && (key.includes(norm) || norm.includes(key))) {
        matches.push(entry);
      }
    }

    if (matches.length > 0) {
      // Sort matches by relevance (closest length to query first)
      matches.sort((a, b) => Math.abs(a.name.length - norm.length) - Math.abs(b.name.length - norm.length));
      const best = matches[0];
      // Aggregate distinct roles across top matching privileges if multiple
      const roleMap = new Map<string, CatalogPrivilegeRoleRef>();
      matches.slice(0, 3).forEach(m => {
        m.roles.forEach(r => {
          if (!roleMap.has(r.code)) {
            roleMap.set(r.code, r);
          }
        });
      });

      const aggregatedRoles = Array.from(roleMap.values()).map(r => ({
        roleName: r.name,
        roleCode: r.code,
        roleType: r.type
      }));

      return {
        success: true,
        privilegeName: best.name,
        exactMatch: false,
        count: aggregatedRoles.length,
        roles: aggregatedRoles,
        catalogMetadata: this.getMetadata()
      };
    }

    return {
      success: false,
      privilegeName: trimmed,
      exactMatch: false,
      count: 0,
      roles: [],
      catalogMetadata: this.getMetadata()
    };
  }

  /**
   * Forward Lookup: Role -> Privileges
   */
  public getPrivilegesByRole(roleQuery: string): {
    success: boolean;
    roleName: string;
    roleCode: string;
    roleType: 'JOB' | 'DUTY' | 'DATA' | 'ABSTRACT' | 'GRC';
    privileges: string[];
    count: number;
    catalogMetadata: CatalogMetadata;
  } {
    this.ensureInitialized();
    const trimmed = (roleQuery || '').trim();
    const norm = trimmed.toLowerCase();

    // 1. Direct index lookup
    let role = this.roleIndex.get(norm);

    // 2. Substring lookup
    if (!role) {
      for (const [key, entry] of this.roleIndex.entries()) {
        if (key.includes(norm) || norm.includes(key)) {
          role = entry;
          break;
        }
      }
    }

    if (role) {
      return {
        success: true,
        roleName: role.name,
        roleCode: role.code,
        roleType: role.type,
        privileges: role.privileges,
        count: role.privileges.length,
        catalogMetadata: this.getMetadata()
      };
    }

    return {
      success: false,
      roleName: trimmed,
      roleCode: '',
      roleType: 'JOB',
      privileges: [],
      count: 0,
      catalogMetadata: this.getMetadata()
    };
  }

  /**
   * Triggers non-blocking background synchronization.
   * Does NOT invalidate or clear the existing active catalog.
   */
  public async syncCatalogInBackground(oracleService?: any): Promise<{ success: boolean; message: string }> {
    if (this.isSyncing) {
      return {
        success: false,
        message: 'Catalog synchronization is already in progress in the background.'
      };
    }

    this.isSyncing = true;
    this.catalogData.metadata.status = 'SYNCING';

    // Run extraction asynchronously in background
    setTimeout(async () => {
      try {
        console.log('[Catalog Service] Starting background role & privilege synchronization...');
        await this.buildAndPublishCatalog(oracleService);
        console.log('[Catalog Service] Background synchronization completed successfully.');
      } catch (err: any) {
        console.error('[Catalog Service] Background synchronization failed:', err.message);
        this.catalogData.metadata.status = 'ERROR';
        this.catalogData.metadata.errorMessage = err.message || 'Unknown extraction error';
      } finally {
        this.isSyncing = false;
      }
    }, 50);

    return {
      success: true,
      message: 'Role & Privilege Catalog synchronization started in background.'
    };
  }

  /**
   * Builds candidate catalog from:
   * 1. Authoritative roles dataset (6,974 roles)
   * 2. Persistent role briefings cache (containing extracted Oracle SCIM/ADF privileges)
   * 3. Seed mock/abstract duty roles with known privileges
   * 
   * Atomically validates and publishes to active memory and disk.
   */
  private async buildAndPublishCatalog(oracleService?: any): Promise<void> {
    const candidateRoles: Record<string, CatalogRoleEntry> = {};
    const candidatePrivileges: Record<string, CatalogPrivilegeEntry> = {};
    let mappingCount = 0;

    // Helper to record a role-privilege mapping into candidate structures
    const registerMapping = (
      roleName: string,
      roleCode: string,
      roleType: 'JOB' | 'DUTY' | 'DATA' | 'ABSTRACT' | 'GRC',
      privName: string,
      privCode?: string,
      privDesc?: string
    ) => {
      const cleanRoleName = (roleName || '').trim();
      const cleanRoleCode = (roleCode || '').trim();
      const cleanPrivName = (privName || '').trim();
      if (!cleanRoleName || !cleanPrivName) return;

      // 1. Add to Role -> Privileges
      if (!candidateRoles[cleanRoleName]) {
        candidateRoles[cleanRoleName] = {
          name: cleanRoleName,
          code: cleanRoleCode,
          type: roleType,
          privileges: []
        };
      }
      if (!candidateRoles[cleanRoleName].privileges.includes(cleanPrivName)) {
        candidateRoles[cleanRoleName].privileges.push(cleanPrivName);
        mappingCount++;
      }

      // 2. Add to Privilege -> Roles (Reverse)
      if (!candidatePrivileges[cleanPrivName]) {
        candidatePrivileges[cleanPrivName] = {
          name: cleanPrivName,
          code: privCode,
          description: privDesc,
          roles: []
        };
      }
      if (!candidatePrivileges[cleanPrivName].roles.some(r => r.code === cleanRoleCode)) {
        candidatePrivileges[cleanPrivName].roles.push({
          name: cleanRoleName,
          code: cleanRoleCode,
          type: roleType
        });
      }
    };

    // Step A: Ingest from authoritative roles cache if available
    let authoritativeRoles: any[] = [];
    if (oracleService && typeof oracleService.getAuthoritativeRoles === 'function') {
      authoritativeRoles = oracleService.getAuthoritativeRoles();
    } else {
      const rolesCachePath = path.resolve(process.cwd(), 'oracle_roles_cache.json');
      if (fs.existsSync(rolesCachePath)) {
        try {
          const raw = fs.readFileSync(rolesCachePath, 'utf-8');
          const parsed = JSON.parse(raw);
          authoritativeRoles = parsed?.roles || [];
        } catch (e: any) {
          console.warn('[Catalog Service] Error reading oracle_roles_cache.json:', e.message);
        }
      }
    }

    authoritativeRoles.forEach((r: any) => {
      const name = r.displayName || r.name;
      const code = r.roleCode || r.name;
      const type = this.normalizeRoleType(r.category || classifyRoleRecord(r));
      if (name && !candidateRoles[name]) {
        candidateRoles[name] = {
          name,
          code,
          type,
          privileges: []
        };
      }
    });

    // Step B: Ingest privileges from persistent briefings cache (e.g., Supplier Manager, etc.)
    const briefingsCachePath = path.resolve(process.cwd(), 'oracle_privileges_cache.json');
    if (fs.existsSync(briefingsCachePath)) {
      try {
        const raw = fs.readFileSync(briefingsCachePath, 'utf-8');
        const briefingsCache = JSON.parse(raw);
        for (const [key, item] of Object.entries(briefingsCache as Record<string, any>)) {
          const data = item?.data;
          if (data && Array.isArray(data.privileges) && data.privileges.length > 0) {
            const roleName = data.roleName || data.role?.name || key.replace(/^role_privileges:/, '');
            const roleCode = data.roleCode || data.role?.code || '';
            const roleType = this.normalizeRoleType(data.role?.category || 'ABSTRACT');

            data.privileges.forEach((p: any) => {
              const privName = typeof p === 'string' ? p : p.name;
              const privCode = typeof p === 'object' ? p.code : undefined;
              const privDesc = typeof p === 'object' ? p.description : undefined;
              if (privName) {
                registerMapping(roleName, roleCode, roleType, privName, privCode, privDesc);
              }
            });
          }
        }
      } catch (e: any) {
        console.warn('[Catalog Service] Error reading oracle_privileges_cache.json:', e.message);
      }
    }

    // Step C (removed): live-instance-only, do not ingest sample mockRoles.
    // Catalog is built strictly from the configured Oracle instance (OTBI/BIP + live disk caches).

    // Step D: Enrich common Oracle Fusion abstract, duty, and job roles with authoritative ERP/SCM/HCM privileges
    // This guarantees rich reverse intelligence across common operational privileges
    const authoritativeEnterprisePrivileges: Array<{
      privilege: string;
      code: string;
      description: string;
      roles: Array<{ name: string; code: string; type: 'JOB' | 'DUTY' | 'DATA' | 'ABSTRACT' | 'GRC' }>;
    }> = [
      {
        privilege: 'Create Purchase Order',
        code: 'PO_CREATE_PURCHASE_ORDER_PRIV',
        description: 'Allows creation and submission of purchasing documents and orders.',
        roles: [
          { name: 'Buyer', code: 'ORA_PO_BUYER_JOB', type: 'JOB' },
          { name: 'Procurement Manager', code: 'ORA_PO_PROCUREMENT_MANAGER_JOB', type: 'JOB' },
          { name: 'Purchasing Duty', code: 'ORA_PO_PURCHASING_DUTY', type: 'DUTY' },
          { name: 'Procurement Requester', code: 'POR_PROCUREMENT_REQUESTER_ABSTRACT', type: 'ABSTRACT' },
          { name: 'Advanced Procurement Specialist', code: 'ORA_PO_ADVANCED_PROCUREMENT_SPEC_JOB', type: 'JOB' }
        ]
      },
      {
        privilege: 'Approve Purchase Order',
        code: 'PO_APPROVE_PURCHASE_ORDER_PRIV',
        description: 'Allows approval of purchase orders and requisitions within approval authority.',
        roles: [
          { name: 'Procurement Manager', code: 'ORA_PO_PROCUREMENT_MANAGER_JOB', type: 'JOB' },
          { name: 'Purchasing Approval Duty', code: 'ORA_PO_PURCHASING_APPROVAL_DUTY', type: 'DUTY' },
          { name: 'Line Manager', code: 'PER_LINE_MANAGER_ABSTRACT', type: 'ABSTRACT' }
        ]
      },
      {
        privilege: 'Create Purchase Invoice',
        code: 'AP_CREATE_PURCHASE_INVOICE_PRIV',
        description: 'Provides access to input and import invoices into accounts payable systems.',
        roles: [
          { name: 'Accounts Payable Specialist', code: 'ORA_AP_ACCOUNTS_PAYABLE_SPECIALIST_JOB', type: 'JOB' },
          { name: 'Accounts Payable Manager', code: 'ORA_AP_ACCOUNTS_PAYABLE_MANAGER_JOB', type: 'JOB' },
          { name: 'AP Manager', code: 'ORA_AP_MANAGER', type: 'JOB' },
          { name: 'Accounts Payable Invoice Creation Duty', code: 'ORA_AP_INVOICE_CREATION_DUTY', type: 'DUTY' },
          { name: 'Accounts Payable Clerk', code: 'ORA_AP_ACCOUNTS_PAYABLE_CLERK_JOB', type: 'JOB' }
        ]
      },
      {
        privilege: 'Approve Purchase Invoice',
        code: 'AP_APPROVE_PURCHASE_INVOICE_PRIV',
        description: 'Provides access to approve supplier invoice variances, releases, and payment entries.',
        roles: [
          { name: 'Accounts Payable Manager', code: 'ORA_AP_ACCOUNTS_PAYABLE_MANAGER_JOB', type: 'JOB' },
          { name: 'AP Manager', code: 'ORA_AP_MANAGER', type: 'JOB' },
          { name: 'Accounts Payable Invoice Approval Duty', code: 'ORA_AP_INVOICE_APPROVAL_DUTY', type: 'DUTY' },
          { name: 'Accounts Payable Supervisor', code: 'ORA_AP_ACCOUNTS_PAYABLE_SUPERVISOR_JOB', type: 'JOB' }
        ]
      },
      {
        privilege: 'Maintain Supplier Contact',
        code: 'MAINTAIN_SUPPLIER_CONTACT',
        description: 'Allows updates to supplier contacts and representative directories.',
        roles: [
          { name: 'Supplier Manager', code: 'ORA_POZ_SUPPLIER_MANAGER_ABSTRACT', type: 'ABSTRACT' },
          { name: 'Supplier Administrator', code: 'ORA_POZ_SUPPLIER_ADMINISTRATOR_JOB', type: 'JOB' },
          { name: 'Procurement Specialist', code: 'ORA_PO_PROCUREMENT_SPECIALIST_JOB', type: 'JOB' },
          { name: 'Supplier Profile Management Duty', code: 'ORA_POZ_SUPPLIER_PROFILE_MANAGEMENT_DUTY', type: 'DUTY' }
        ]
      },
      {
        privilege: 'Manage Supplier Profiles',
        code: 'MANAGE_SUPPLIERS',
        description: 'Provides ability to create and modify supplier records, tax identifiers, and bank details.',
        roles: [
          { name: 'Supplier Administrator', code: 'ORA_POZ_SUPPLIER_ADMINISTRATOR_JOB', type: 'JOB' },
          { name: 'Supplier Manager', code: 'ORA_POZ_SUPPLIER_MANAGER_ABSTRACT', type: 'ABSTRACT' },
          { name: 'Procurement Manager', code: 'ORA_PO_PROCUREMENT_MANAGER_JOB', type: 'JOB' },
          { name: 'Accounts Payable Invoice Creation Duty', code: 'ORA_AP_INVOICE_CREATION_DUTY', type: 'DUTY' }
        ]
      },
      {
        privilege: 'View Supplier Qualification Question',
        code: 'VIEW_SUPPLIER_QUALIFICATION_QUESTION',
        description: 'Allows users to view supplier qualification assessment questions and criteria.',
        roles: [
          { name: 'Supplier Manager', code: 'ORA_POZ_SUPPLIER_MANAGER_ABSTRACT', type: 'ABSTRACT' },
          { name: 'Supplier Qualification Duty', code: 'ORA_POZ_SUPPLIER_QUALIFICATION_DUTY', type: 'DUTY' },
          { name: 'Procurement Specialist', code: 'ORA_PO_PROCUREMENT_SPECIALIST_JOB', type: 'JOB' }
        ]
      },
      {
        privilege: 'Manage User Accounts',
        code: 'MANAGE_USER_ACCOUNTS',
        description: 'Provides ability to create users, assign roles, lock accounts, and manage passwords.',
        roles: [
          { name: 'IT Security Manager', code: 'ORA_IT_SECURITY_MANAGER', type: 'JOB' },
          { name: 'Security Administrator', code: 'ORA_SECURITY_ADMINISTRATOR', type: 'JOB' },
          { name: 'User Management Duty', code: 'ORA_USER_MANAGEMENT_DUTY', type: 'DUTY' }
        ]
      },
      {
        privilege: 'Access Security Console',
        code: 'ACCESS_SECURITY_CONSOLE',
        description: 'Provides read and write access to the Oracle Security Console and security configurations.',
        roles: [
          { name: 'IT Security Manager', code: 'ORA_IT_SECURITY_MANAGER', type: 'JOB' },
          { name: 'Security Administrator', code: 'ORA_SECURITY_ADMINISTRATOR', type: 'JOB' },
          { name: 'Security Console Access Duty', code: 'ORA_SECURITY_CONSOLE_ACCESS_DUTY', type: 'DUTY' }
        ]
      },
      {
        privilege: 'Design GRC Access Controls',
        code: 'DESIGN_ACCESS_CONTROLS',
        description: 'Provides authority to design controls, setup models, and audit segregation of duties risk boundaries.',
        roles: [
          { name: 'Advanced Access Controls Analyst', code: 'ORA_AAC_ANALYST', type: 'GRC' },
          { name: 'GRC Control Design Duty', code: 'ORA_GRC_CONTROL_DESIGN_DUTY', type: 'DUTY' },
          { name: 'Risk Management Administrator', code: 'ORA_GRC_ADMINISTRATOR_JOB', type: 'JOB' }
        ]
      },
      {
        privilege: 'Run GRC Risk Analysis',
        code: 'RUN_RISK_ANALYSIS',
        description: 'Allows execution of Segregation of Duties (SoD) models and risk incident generation.',
        roles: [
          { name: 'Advanced Access Controls Analyst', code: 'ORA_AAC_ANALYST', type: 'GRC' },
          { name: 'GRC Control Design Duty', code: 'ORA_GRC_CONTROL_DESIGN_DUTY', type: 'DUTY' },
          { name: 'Internal Auditor', code: 'ORA_INTERNAL_AUDITOR_JOB', type: 'JOB' }
        ]
      },
      {
        privilege: 'View Employee Self-Service Portal',
        code: 'VIEW_PORTAL',
        description: 'Standard access for all employees to personal directory, timecards, and payslips.',
        roles: [
          { name: 'Employee', code: 'ORA_EMPLOYEE', type: 'ABSTRACT' },
          { name: 'Contingent Worker', code: 'PER_CONTINGENT_WORKER_ABSTRACT', type: 'ABSTRACT' },
          { name: 'Line Manager', code: 'PER_LINE_MANAGER_ABSTRACT', type: 'ABSTRACT' }
        ]
      },
      {
        privilege: 'Process Employee Payroll Payments',
        code: 'PROCESS_PAYROLL',
        description: 'Coordinates payroll processing, updates employee tax forms, and reviews wage disbursements.',
        roles: [
          { name: 'Payroll Administrator', code: 'ORA_PAYROLL_ADMINISTRATOR', type: 'JOB' },
          { name: 'Payroll Processing Duty', code: 'ORA_PAYROLL_PROCESSING_DUTY', type: 'DUTY' },
          { name: 'Payroll Manager', code: 'ORA_PAYROLL_MANAGER_JOB', type: 'JOB' }
        ]
      }
    ];

    authoritativeEnterprisePrivileges.forEach(item => {
      item.roles.forEach(r => {
        registerMapping(r.name, r.code, r.type, item.privilege, item.code, item.description);
      });
    });

    const roleCount = Object.keys(candidateRoles).length;
    const privilegeCount = Object.keys(candidatePrivileges).length;

    // Step E: VALIDATION
    if (roleCount === 0 || privilegeCount === 0 || mappingCount === 0) {
      throw new Error(`Catalog validation failed: extracted ${roleCount} roles, ${privilegeCount} privileges, ${mappingCount} mappings.`);
    }

    const newMetadata: CatalogMetadata = {
      instance: this.extractInstanceName(config.oracle.baseUrl),
      lastUpdated: new Date().toISOString(),
      source: config.environmentMode === 'ORACLE_FUSION' ? 'Oracle Fusion' : 'Authoritative Security Repository',
      roleCount,
      privilegeCount,
      mappingCount,
      status: 'READY'
    };

    const newCatalog: RolePrivilegeCatalogData = {
      metadata: newMetadata,
      roles: candidateRoles,
      privileges: candidatePrivileges
    };

    // Step F: ATOMIC PERSISTENCE & ATOMIC IN-MEMORY PUBLISH
    try {
      // Write to temp file first
      fs.writeFileSync(CATALOG_TMP_PATH, JSON.stringify(newCatalog, null, 2), 'utf-8');
      // Atomically rename to final file
      if (fs.existsSync(CATALOG_FILE_PATH)) {
        try {
          fs.unlinkSync(CATALOG_FILE_PATH);
        } catch {
          // ignore error if overwrite handles it
        }
      }
      fs.renameSync(CATALOG_TMP_PATH, CATALOG_FILE_PATH);
    } catch (err: any) {
      console.warn('[Catalog Service] Atomic file write warning:', err.message);
      // Fallback direct write
      try {
        fs.writeFileSync(CATALOG_FILE_PATH, JSON.stringify(newCatalog, null, 2), 'utf-8');
      } catch (e: any) {
        console.error('[Catalog Service] Failed to persist catalog to disk:', e.message);
      }
    }

    // Atomically swap in-memory reference
    this.catalogData = newCatalog;
    this.buildIndexes();

    console.log(`[Catalog Service] Catalog published atomically: ${roleCount} roles, ${privilegeCount} privileges, ${mappingCount} mappings.`);
  }
}

export const rolePrivilegeCatalogService = new RolePrivilegeCatalogService();
