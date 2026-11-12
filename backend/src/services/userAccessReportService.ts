import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';
import { config, decrypt } from '../config.js';
import { pool, query } from '../db.js';

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

function getUserAccessReportCachePath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'oracle_user_access_report_cache.json'),
    path.resolve(process.cwd(), 'backend/oracle_user_access_report_cache.json'),
    path.resolve(process.cwd(), '../oracle_user_access_report_cache.json')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

const CACHE_FILE = getUserAccessReportCachePath();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours TTL

export interface DirectoryUsersQuery {
  filterText?: string;
  category?: string;
  status?: string;
  startIndex?: number;
  count?: number;
}

export class UserAccessReportService {
  private client!: AxiosInstance;
  private cachedReport: { summary: UserAccessReportSummary; data: UserAccessReportRow[]; calculatedAt: string } | null = null;
  private cachedDirectorySourceRef: UserAccessReportRow[] | null = null;
  private cachedDirectoryUsers: any[] = [];
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

  private getHost(): string {
    const rawUrl = (process.env.FUSION_HOST || config.oracle.baseUrl || 'eiiv-dev14.fa.us6.oraclecloud.com').trim().toLowerCase();
    try {
      if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
        return new URL(rawUrl).host;
      }
    } catch (_) {}
    return rawUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'eiiv-dev14.fa.us6.oraclecloud.com';
  }

  public async persistToDatabase(payload: {
    summary: UserAccessReportSummary;
    data: UserAccessReportRow[];
    calculatedAt: string;
  }): Promise<void> {
    const host = this.getHost();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM oracle_raw_user_access WHERE environment_host = $1`, [host]);

      const BATCH_SIZE = 500;
      for (let i = 0; i < payload.data.length; i += BATCH_SIZE) {
        const chunk = payload.data.slice(i, i + BATCH_SIZE);
        const values: any[] = [];
        const clauses: string[] = [];

        chunk.forEach((row) => {
          const base = values.length + 1;
          clauses.push(
            `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, NOW())`
          );
          values.push(
            host,
            row.username,
            row.userCategory ?? null,
            row.firstName ?? null,
            row.lastName ?? null,
            row.displayName ?? null,
            row.email ?? null,
            typeof row.active === 'boolean' ? row.active : true,
            row.roleName ?? null,
            row.roleCode ?? null,
            row.autoProvisioned ?? null,
            row.personId ?? null,
            row.personNumber ?? null,
            row.department ?? null,
            row.job ?? null,
            row.businessUnit ?? null,
            row.location ?? null,
            row.manager ?? null
          );
        });

        await client.query(
          `INSERT INTO oracle_raw_user_access (
            environment_host, username, user_category, first_name, last_name, display_name,
            email, active, role_name, role_code, auto_provisioned, person_id, person_number,
            department, job, business_unit, location, manager, last_synced_at
          ) VALUES ${clauses.join(', ')}`,
          values
        );
      }

      await client.query(
        `INSERT INTO oracle_user_access_summary (
          environment_host, total_users, users_with_roles, users_without_roles,
          total_role_assignments, active_users, inactive_users, calculated_at, last_synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, NOW())
        ON CONFLICT (environment_host) DO UPDATE SET
          total_users = EXCLUDED.total_users,
          users_with_roles = EXCLUDED.users_with_roles,
          users_without_roles = EXCLUDED.users_without_roles,
          total_role_assignments = EXCLUDED.total_role_assignments,
          active_users = EXCLUDED.active_users,
          inactive_users = EXCLUDED.inactive_users,
          calculated_at = EXCLUDED.calculated_at,
          last_synced_at = NOW()`,
        [
          host,
          payload.summary.totalUsers,
          payload.summary.usersWithRoles,
          payload.summary.usersWithoutRoles,
          payload.summary.totalRoleAssignments,
          payload.summary.activeUsers,
          payload.summary.inactiveUsers,
          payload.calculatedAt
        ]
      );

      await client.query('COMMIT');
      console.log(`[User Access Report] Persisted ${payload.data.length} rows to PostgreSQL (oracle_raw_user_access).`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  public async loadFromDatabase(): Promise<UserAccessReportResult | null> {
    const host = this.getHost();
    try {
      // Resolve the host from the table we actually read, so an environment whose
      // configured Fusion host differs from the stored one (e.g. QA/dev deployments
      // sharing a database) still serves the populated directory instead of falling back.
      const hostRes = await query<{ environment_host: string }>(
        `SELECT environment_host
         FROM oracle_raw_user_access
         GROUP BY environment_host
         ORDER BY (CASE WHEN environment_host = $1 THEN 0 WHEN environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com' THEN 1 ELSE 2 END),
                  COUNT(*) DESC
         LIMIT 1`,
        [host]
      );
      const targetHost = hostRes.rows[0]?.environment_host || host;

      const [sumRes, rowsRes] = await Promise.all([
        query<{
          total_users: number;
          users_with_roles: number;
          users_without_roles: number;
          total_role_assignments: number;
          active_users: number;
          inactive_users: number;
          calculated_at: Date;
        }>(`SELECT * FROM oracle_user_access_summary WHERE environment_host = $1 LIMIT 1`, [targetHost]),
        query<{
          username: string;
          user_category: string | null;
          first_name: string | null;
          last_name: string | null;
          display_name: string | null;
          email: string | null;
          active: boolean;
          role_name: string | null;
          role_code: string | null;
          auto_provisioned: 'Yes' | 'No' | null;
          person_id: string | null;
          person_number: string | null;
          department: string | null;
          job: string | null;
          business_unit: string | null;
          location: string | null;
          manager: string | null;
        }>(
          `SELECT username, user_category, first_name, last_name, display_name, email, active,
                  role_name, role_code, auto_provisioned, person_id, person_number,
                  department, job, business_unit, location, manager
           FROM oracle_raw_user_access
           WHERE environment_host = $1
           ORDER BY username ASC, role_name ASC NULLS LAST`,
          [targetHost]
        )
      ]);

      if (rowsRes.rows.length === 0) return null;

      const sRow = sumRes.rows[0];
      const data: UserAccessReportRow[] = rowsRes.rows.map((r) => ({
        username: r.username,
        userCategory: r.user_category,
        firstName: r.first_name,
        lastName: r.last_name,
        displayName: r.display_name,
        email: r.email,
        active: Boolean(r.active),
        roleName: r.role_name,
        roleCode: r.role_code,
        autoProvisioned: r.auto_provisioned,
        personId: r.person_id,
        personNumber: r.person_number,
        department: r.department,
        job: r.job,
        businessUnit: r.business_unit,
        location: r.location,
        manager: r.manager
      }));

      const summary: UserAccessReportSummary = sRow
        ? {
            totalUsers: Number(sRow.total_users),
            usersWithRoles: Number(sRow.users_with_roles),
            usersWithoutRoles: Number(sRow.users_without_roles),
            totalRoleAssignments: Number(sRow.total_role_assignments),
            activeUsers: Number(sRow.active_users),
            inactiveUsers: Number(sRow.inactive_users)
          }
        : {
            totalUsers: new Set(data.map((d) => d.username)).size,
            usersWithRoles: new Set(data.filter((d) => d.roleCode || d.roleName).map((d) => d.username)).size,
            usersWithoutRoles: new Set(data.filter((d) => !d.roleCode && !d.roleName).map((d) => d.username)).size,
            totalRoleAssignments: data.filter((d) => d.roleCode || d.roleName).length,
            activeUsers: new Set(data.filter((d) => d.active).map((d) => d.username)).size,
            inactiveUsers: new Set(data.filter((d) => !d.active).map((d) => d.username)).size
          };

      const calculatedAt = sRow?.calculated_at ? new Date(sRow.calculated_at).toISOString() : new Date().toISOString();
      this.cachedReport = { summary, data, calculatedAt };

      return {
        success: true,
        summary,
        data,
        calculatedAt,
        source: 'PostgreSQL Database'
      };
    } catch (err) {
      console.warn('[User Access Report] Failed to load from PostgreSQL:', (err as Error).message);
      return null;
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
  // Live SCIM userCategory lives in the FA extension block, not top-level (verified live).
  private getUserCategory(user: any): string | null {
    if (!user || typeof user !== 'object') return null;
    const faExt = (user as any)['urn:scim:schemas:extension:fa:2.0:faUser'];
    if (faExt && typeof faExt === 'object' && (faExt as any).userCategory) return String((faExt as any).userCategory);
    if ((user as any).userCategory) return String((user as any).userCategory);
    if ((user as any).userType) return String((user as any).userType);
    return null;
  }
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
          userCategory: this.getUserCategory(user),
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
          userCategory: this.getUserCategory(user),
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
      source: 'PostgreSQL Database'
    };

    // Persist to PostgreSQL and update caches
    try {
      await this.persistToDatabase({ summary, data: report, calculatedAt });
    } catch (dbErr: any) {
      console.warn('[User Access Report] Failed to persist generated report to PostgreSQL:', dbErr.message);
    }
    this.cachedReport = { summary, data: report, calculatedAt };
    this.saveToDisk(this.cachedReport);

    console.log(`[User Access Report] Report generated successfully with ${report.length} rows for ${totalUsers} users in ${Date.now() - startTime}ms`);
    return result;
  }

  // Public retrieval method: reads strictly from PostgreSQL (only syncs from Oracle when syncFromOracle is true)
  async getUserAccessReport(options: boolean | { forceRefresh?: boolean; syncFromOracle?: boolean } = false): Promise<UserAccessReportResult> {
    const forceRefresh = typeof options === 'boolean' ? options : Boolean(options.forceRefresh);
    const syncFromOracle = typeof options === 'object' ? Boolean(options.syncFromOracle) : false;

    if (syncFromOracle) {
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

    // Read from PostgreSQL (clear in-memory copy when refreshing from DB)
    if (!forceRefresh && this.cachedReport) {
      return {
        success: true,
        summary: this.cachedReport.summary,
        data: this.cachedReport.data,
        calculatedAt: this.cachedReport.calculatedAt,
        source: 'PostgreSQL Database'
      };
    }

    const dbRes = await this.loadFromDatabase();
    if (dbRes && dbRes.data.length > 0) {
      return dbRes;
    }

    // One-time backfill if local disk cache exists and PostgreSQL table is empty
    if (this.cachedReport && this.cachedReport.data.length > 0) {
      try {
        await this.persistToDatabase(this.cachedReport);
      } catch (err: any) {
        console.warn('[User Access Report] Failed to backfill PostgreSQL from disk cache:', err.message);
      }
      return {
        success: true,
        summary: this.cachedReport.summary,
        data: this.cachedReport.data,
        calculatedAt: this.cachedReport.calculatedAt,
        source: 'PostgreSQL Database'
      };
    }

    return {
      success: true,
      summary: {
        totalUsers: 0,
        usersWithRoles: 0,
        usersWithoutRoles: 0,
        totalRoleAssignments: 0,
        activeUsers: 0,
        inactiveUsers: 0
      },
      data: [],
      calculatedAt: new Date().toISOString(),
      source: 'PostgreSQL Database'
    };
  }

  /**
   * Groups PostgreSQL `oracle_raw_user_access` rows into directory user objects
   * and supports instant filtering, status/category KPI counts, and pagination.
   */
  public async getDirectoryUsersFromDatabase(params: DirectoryUsersQuery = {}) {
    const reportRes = await this.getUserAccessReport();
    if (!reportRes?.data || reportRes.data.length === 0) {
      return null;
    }

    if (this.cachedDirectorySourceRef !== reportRes.data) {
      const userMap = new Map<string, any>();
      for (const r of reportRes.data) {
        const key = r.username;
        let u = userMap.get(key);
        if (!u) {
          u = {
            id: r.username,
            userName: r.username,
            userCategory: r.userCategory || null,
            displayName: r.displayName || `${r.firstName || ''} ${r.lastName || ''}`.trim() || r.username,
            firstName: r.firstName || '',
            lastName: r.lastName || '',
            email: r.email || '',
            phone: null,
            active: Boolean(r.active),
            personId: r.personId || null,
            personNumber: r.personNumber || null,
            department: r.department || null,
            job: r.job || null,
            businessUnit: r.businessUnit || null,
            location: r.location || null,
            manager: r.manager || null,
            assignedRoles: [] as Array<{ roleName: string; roleCode: string; autoProvisioned: 'Yes' | 'No' | null }>
          };
          userMap.set(key, u);
        }
        if (r.roleName || r.roleCode) {
          u.assignedRoles.push({
            roleName: r.roleName || r.roleCode || '',
            roleCode: r.roleCode || r.roleName || '',
            autoProvisioned: r.autoProvisioned ?? null
          });
        }
      }
      this.cachedDirectoryUsers = Array.from(userMap.values());
      this.cachedDirectorySourceRef = reportRes.data;
    }

    const normCat = (params.category || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    const normStatus = (params.status || '').trim().toUpperCase();
    const startIndex = Math.max(1, params.startIndex || 1);
    const count = Math.max(1, params.count || 50);

    let scopedUsers = this.cachedDirectoryUsers;

    if (normCat && normCat !== 'ALL') {
      if (normCat === 'NO_ROLES' || normCat === 'WITHOUT_ROLES' || normCat === 'USERS_WITHOUT_ROLES') {
        scopedUsers = scopedUsers.filter((u) => u.assignedRoles.length === 0);
      } else if (normCat === 'SINGLE_ROLE' || normCat === 'SINGLE_ROLE_USERS') {
        scopedUsers = scopedUsers.filter((u) => u.assignedRoles.length === 1);
      } else if (normCat === 'MULTIPLE_ROLES' || normCat === 'MULTIPLE_ROLE_USERS') {
        scopedUsers = scopedUsers.filter((u) => u.assignedRoles.length > 1);
      } else if (
        normCat === 'ADMIN_ROLES' || normCat === 'SECURITY_ADMINISTRATORS' || normCat === 'SECURITY_ADMINS' ||
        normCat === 'HIGH_RISK' || normCat === 'HIGH_RISK_USERS' || normCat === 'HIGH_RISK_ROLE_USERS'
      ) {
        scopedUsers = scopedUsers.filter((u) =>
          u.assignedRoles.some((r: any) => {
            const val = r.roleName || r.roleCode || '';
            return val.includes('Security Administrator') || val.includes('IT Security Manager') || val.includes('AP Manager');
          })
        );
      } else if (normCat === 'INACTIVE' || normCat === 'INACTIVE_ACCOUNTS') {
        scopedUsers = scopedUsers.filter((u) => !u.active);
      } else if (normCat === 'ACTIVE') {
        scopedUsers = scopedUsers.filter((u) => u.active);
      }
    }

    const directoryTotal = scopedUsers.length;
    const activeCount = scopedUsers.filter((u) => u.active).length;
    const inactiveCount = directoryTotal - activeCount;

    let filtered = scopedUsers;
    if (normStatus === 'ACTIVE') {
      filtered = filtered.filter((u) => u.active);
    } else if (normStatus === 'INACTIVE') {
      filtered = filtered.filter((u) => !u.active);
    }

    if (params.filterText && params.filterText.trim()) {
      const term = params.filterText.trim().toLowerCase();
      filtered = filtered.filter((u) =>
        (u.userName && u.userName.toLowerCase().includes(term)) ||
        (u.displayName && u.displayName.toLowerCase().includes(term)) ||
        (u.firstName && u.firstName.toLowerCase().includes(term)) ||
        (u.lastName && u.lastName.toLowerCase().includes(term)) ||
        (u.email && u.email.toLowerCase().includes(term)) ||
        (u.personNumber && String(u.personNumber).toLowerCase().includes(term)) ||
        (u.department && u.department.toLowerCase().includes(term)) ||
        (u.businessUnit && u.businessUnit.toLowerCase().includes(term))
      );
    }

    const totalResults = filtered.length;
    const sliced = filtered.slice(startIndex - 1, startIndex - 1 + count);

    return {
      success: true,
      users: sliced,
      totalResults,
      startIndex,
      count: sliced.length,
      directoryTotal,
      activeCount,
      inactiveCount,
      dataSource: 'PostgreSQL Database'
    };
  }
}

export const userAccessReportService = new UserAccessReportService();

