import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';
import { config, decrypt } from '../config.js';

export interface UserAccessReportRow {
  username: string;
  userCategory: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  email: string | null;
  active: boolean;
  roleName: string | null;
  roleCode: string | null;
  autoProvisioned: 'Yes' | 'No' | null;
  personId: string | null;
  personNumber: string | null;
  department: string | null;
  job: string | null;
  businessUnit: string | null;
  location: string | null;
  manager: string | null;
}

export interface UserAccessReportSummary {
  totalUsers: number;
  usersWithRoles: number;
  usersWithoutRoles: number;
  totalRoleAssignments: number;
  activeUsers: number;
  inactiveUsers: number;
}

export interface UserAccessReportResult {
  success: boolean;
  summary: UserAccessReportSummary;
  data: UserAccessReportRow[];
  calculatedAt?: string;
  source?: string;
}

const CACHE_FILE = path.resolve(process.cwd(), 'oracle_user_access_report_cache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours TTL

export class UserAccessReportService {
  private client!: AxiosInstance;
  private cachedReport: { summary: UserAccessReportSummary; data: UserAccessReportRow[]; calculatedAt: string } | null = null;
  private isGenerating = false;
  private generationPromise: Promise<UserAccessReportResult> | null = null;

  constructor() {
    this.recreateClient();
    this.loadFromDisk();
  }

  private recreateClient() {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (config.oracle.authType === 'BEARER' && config.oracle.token) {
      headers['Authorization'] = `Bearer ${config.oracle.token}`;
    } else if (config.oracle.username && config.oracle.password) {
      const rawPassword = decrypt(config.oracle.password);
      const token = Buffer.from(`${config.oracle.username}:${rawPassword}`).toString('base64');
      headers['Authorization'] = `Basic ${token}`;
    }

    const activeBaseUrl = (config.oracle.baseUrl || '').trim();

    this.client = axios.create({
      baseURL: activeBaseUrl || 'https://oracle-instance-not-configured.invalid',
      headers,
      timeout: 120000, // 2 minutes for heavy Oracle queries
    });
  }

  private workersCache: { data: any[]; expiresAt: number } | null = null;
  private bipCache: { rows: import('../oracle/bipClient.js').UserRoleAutoProvisionRow[]; expiresAt: number } | null = null;

  public async getWorkersCached(): Promise<any[]> {
    if (this.workersCache && Date.now() < this.workersCache.expiresAt) return this.workersCache.data;
    const workers = await this.getAllWorkers();
    this.workersCache = { data: workers, expiresAt: Date.now() + 60 * 60 * 1000 };
    return workers;
  }

  public async getBipRowsCached(): Promise<import('../oracle/bipClient.js').UserRoleAutoProvisionRow[]> {
    if (this.bipCache && Date.now() < this.bipCache.expiresAt) return this.bipCache.rows;
    try {
      const { bipClient } = await import('../oracle/bipClient.js');
      const rows = await bipClient.runUserRoleAutoProvisioningReport();
      this.bipCache = { rows, expiresAt: Date.now() + 60 * 60 * 1000 };
      return rows;
    } catch (err) {
      console.warn('[User Access Report] BIP Auto-Provisioning fetch failed (live-only, leaving null):', (err as Error).message);
      return [];
    }
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.summary && Array.isArray(parsed.data)) {
          this.cachedReport = parsed;
          console.log(`[User Access Report] Loaded cached report from disk with ${parsed.data.length} rows (calculated at ${parsed.calculatedAt})`);
        }
      }
    } catch (err) {
      console.warn('[User Access Report] Failed to load cache from disk:', (err as Error).message);
    }
  }

  private saveToDisk(payload: { summary: UserAccessReportSummary; data: UserAccessReportRow[]; calculatedAt: string }) {
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), 'utf-8');
      console.log(`[User Access Report] Saved ${payload.data.length} report rows to disk cache.`);
    } catch (err) {
      console.warn('[User Access Report] Failed to write cache to disk:', (err as Error).message);
    }
  }

  // Helper to extract primary email from SCIM user emails array
  private getPrimaryEmail(user: any): string | null {
    if (!user.emails || !Array.isArray(user.emails) || user.emails.length === 0) return null;
    const primary = user.emails.find((e: any) => e.primary === true);
    return primary?.value || user.emails[0]?.value || null;
  }

  // 1. SCIM Users - Master population
  async getAllScimUsers(): Promise<any[]> {
    const users: any[] = [];
    let startIndex = 1;
    const pageSize = 500;
    let totalResults: number | null = null;

    console.log('[User Access Report] Fetching SCIM users...');
    while (true) {
      const response = await this.client.get('/hcmRestApi/scim/Users', {
        params: { startIndex, count: pageSize }
      });
      const data = response.data;
      if (totalResults === null && typeof data.totalResults === 'number') {
        totalResults = data.totalResults;
      }
      const resources = data.Resources || [];
      users.push(...resources);
      console.log(`[User Access Report] SCIM users retrieved: ${users.length} / ${totalResults ?? 'unknown'}`);

      if (resources.length === 0 || resources.length < pageSize) {
        break;
      }
      if (totalResults !== null && users.length >= totalResults) {
        break;
      }
      startIndex += resources.length;
    }

    return users;
  }

  // 2. Public Workers - Enrichment
  async getAllWorkers(): Promise<any[]> {
    const workers: any[] = [];
    let offset = 0;
    const pageSize = 500;

    console.log('[User Access Report] Fetching public workers...');
    while (true) {
      const response = await this.client.get('/hcmRestApi/resources/11.13.18.05/publicWorkers', {
        params: {
          limit: pageSize,
          offset,
          expand: 'assignments'
        }
      });
      const items = response.data.items || [];
      workers.push(...items);
      console.log(`[User Access Report] Workers retrieved: ${workers.length}`);

      if (items.length < pageSize) {
        break;
      }
      offset += items.length;
    }

    return workers;
  }

  // 3. Fallback worker assignment retrieval
  async getWorkerAssignments(personId: string | number): Promise<any[]> {
    try {
      const response = await this.client.get(
        `/hcmRestApi/resources/11.13.18.05/publicWorkers/${encodeURIComponent(String(personId))}/child/assignments`
      );
      return response.data?.items || [];
    } catch (error) {
      console.warn(`[User Access Report] Assignment API failed for PersonId ${personId}:`, (error as Error).message);
      return [];
    }
  }

  // 4. Optional: fallback managers for assignment
  async getAssignmentManagers(personId: string | number, assignmentId: string | number): Promise<any[]> {
    try {
      const response = await this.client.get(
        `/hcmRestApi/resources/11.13.18.05/publicWorkers/${encodeURIComponent(String(personId))}/child/assignments/${encodeURIComponent(String(assignmentId))}/child/managers`
      );
      return response.data?.items || [];
    } catch (error) {
      console.warn(`[User Access Report] Manager API failed for PersonId ${personId}, AssignmentId ${assignmentId}:`, (error as Error).message);
      return [];
    }
  }

  // Core generator method
  async generateUserAccessReport(): Promise<UserAccessReportResult> {
    this.recreateClient();

    console.log('[User Access Report] Starting report generation from live Oracle Fusion APIs...');
    const startTime = Date.now();

    // Concurrently fetch SCIM Users (master), Public Workers (enrichment), BIP Auto-Provisioned (roles)
    const [scimUsers, workers, bipRows] = await Promise.all([
      this.getAllScimUsers(),
      this.getWorkersCached(),
      this.getBipRowsCached()
    ]);

    console.log(`[User Access Report] Fetched ${scimUsers.length} SCIM users, ${workers.length} Public Workers, ${bipRows.length} BIP role rows in ${Date.now() - startTime}ms`);

    // Index BIP rows by USERNAME|ROLE_CODE (upper-cased) for merge
    const bipMap = new Map<string, { roleName: string; roleCode: string; autoProvisioned: 'Yes' | 'No' | null }>();
    for (const r of bipRows) {
      const key = `${(r.username || '').toUpperCase()}|${(r.roleCode || '').toUpperCase()}`;
      if (!r.username) continue;
      bipMap.set(key, { roleName: r.roleName || '', roleCode: r.roleCode || '', autoProvisioned: r.autoProvisioned ?? null });
    }

    // Build index by Username.toUpperCase()
    const workerMap = new Map<string, any>();
    for (const worker of workers) {
      if (!worker.Username) continue;
      workerMap.set(worker.Username.toUpperCase(), worker);
    }

    const report: UserAccessReportRow[] = [];

    // Summary counters calculated from actual retrieved SCIM data
    let totalUsers = scimUsers.length;
    let usersWithRoles = 0;
    let usersWithoutRoles = 0;
    let totalRoleAssignments = 0;
    let activeUsers = 0;
    let inactiveUsers = 0;

    // Master Population Rule: Iterate over SCIM Users so every SCIM user is retained!
    for (const user of scimUsers) {
      const username = user.userName || '';
      const isActive = typeof user.active === 'boolean' ? user.active : true;

      if (isActive) {
        activeUsers++;
      } else {
        inactiveUsers++;
      }

      const worker = workerMap.get(username.toUpperCase()) || null;
      const roles = user.roles || [];
      const primaryEmail = this.getPrimaryEmail(user);

      // Determine primary assignment
      const assignments = worker?.assignments || [];
      const assignment =
        assignments.find((a: any) => a.PrimaryAssignmentFlag === true) ||
        assignments.find((a: any) => a.PrimaryFlag === true) ||
        assignments[0] ||
        null;

      const managerName = assignment?.ManagerName || null;

      // Handle users without roles: MUST appear in report with null role fields
      if (roles.length === 0) {
        usersWithoutRoles++;
        report.push({
          username,
          userCategory: user.userCategory || null,
          firstName: user.name?.givenName || null,
          lastName: user.name?.familyName || null,
          displayName: user.displayName || null,
          email: primaryEmail,
          active: isActive,
          roleName: null,
          roleCode: null,
          autoProvisioned: null,
          personId: worker?.PersonId ? String(worker.PersonId) : null,
          personNumber: worker?.PersonNumber ? String(worker.PersonNumber) : null,
          department: assignment?.DepartmentName || null,
          job: assignment?.JobName || null,
          businessUnit: assignment?.BusinessUnitName || null,
          location: assignment?.LocationName || null,
          manager: managerName
        });
        continue;
      }

      usersWithRoles++;
      totalRoleAssignments += roles.length;

      // Produce ONE row per assigned role, merged with BIP authoritative Role Name/Code + Auto-Provisioned
      for (const role of roles) {
        const scimRoleCode = role.value || null;
        const scimRoleName = role.displayName || null;
        const bipKey = `${username.toUpperCase()}|${(scimRoleCode || '').toUpperCase()}`;
        const bip = bipMap.get(bipKey);
        report.push({
          username,
          userCategory: user.userCategory || null,
          firstName: user.name?.givenName || null,
          lastName: user.name?.familyName || null,
          displayName: user.displayName || null,
          email: primaryEmail,
          active: isActive,
          roleName: bip?.roleName || scimRoleName,
          roleCode: bip?.roleCode || scimRoleCode,
          autoProvisioned: bip?.autoProvisioned ?? null,
          personId: worker?.PersonId ? String(worker.PersonId) : null,
          personNumber: worker?.PersonNumber ? String(worker.PersonNumber) : null,
          department: assignment?.DepartmentName || null,
          job: assignment?.JobName || null,
          businessUnit: assignment?.BusinessUnitName || null,
          location: assignment?.LocationName || null,
          manager: managerName
        });
      }
    }

    const summary: UserAccessReportSummary = {
      totalUsers,
      usersWithRoles,
      usersWithoutRoles,
      totalRoleAssignments,
      activeUsers,
      inactiveUsers
    };

    const calculatedAt = new Date().toISOString();
    const result: UserAccessReportResult = {
      success: true,
      summary,
      data: report,
      calculatedAt,
      source: 'Oracle Fusion SCIM & Public Workers'
    };

    // Cache in memory and disk
    this.cachedReport = { summary, data: report, calculatedAt };
    this.saveToDisk(this.cachedReport);

    console.log(`[User Access Report] Report generated successfully with ${report.length} rows for ${totalUsers} users in ${Date.now() - startTime}ms`);
    return result;
  }

  // Public retrieval method with caching and refresh support
  async getUserAccessReport(forceRefresh = false): Promise<UserAccessReportResult> {
    // If not forcing refresh, return in-memory cache if available
    if (!forceRefresh && this.cachedReport) {
      return {
        success: true,
        summary: this.cachedReport.summary,
        data: this.cachedReport.data,
        calculatedAt: this.cachedReport.calculatedAt,
        source: 'Cache (Oracle Fusion)'
      };
    }

    // If generation is already in flight, reuse existing promise to prevent duplicate API bursts
    if (this.isGenerating && this.generationPromise) {
      return this.generationPromise;
    }

    this.isGenerating = true;
    this.generationPromise = this.generateUserAccessReport()
      .finally(() => {
        this.isGenerating = false;
        this.generationPromise = null;
      });

    return this.generationPromise;
  }
}

export const userAccessReportService = new UserAccessReportService();
