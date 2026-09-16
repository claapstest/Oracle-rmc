import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { OracleFusionClient } from '../oracle/client.js';
import { RiskService } from './riskService.js';
import { ControlCatalogService } from './controlCatalogService.js';
import { classifyRoleRecord } from './roleClassification.js';
import { auditProductCatalogService, AuditProduct } from './auditProductCatalogService.js';
export { classifyRoleRecord };

const ROLES_CACHE_FILE = path.resolve(process.cwd(), 'oracle_roles_cache.json');
const PRIVILEGES_CACHE_FILE = path.resolve(process.cwd(), 'oracle_privileges_cache.json');
import {
  mockUsers,
  mockRoles,
  mockAuditTrail,
  mockRiskIncidents,
  mockSoDConflicts,
  mockAccessCertifications,
  User,
  Role,
  AuditEvent,
  RiskIncident,
  SoDConflict,
  AccessCertification
} from './mockData.js';



function normalizeAssignedRoles(rolesList: any[] | undefined, isDemo: boolean): any[] {
  if (!rolesList) return [];
  const seenCodes = new Set<string>();
  const normalized: any[] = [];
  
  rolesList.forEach((r: any) => {
    let code = '';
    let name = '';
    let isCustom = false;
    
    if (typeof r === 'string') {
      const resolved = mockRoles.find(x => x.roleCode === r || x.displayName === r);
      code = resolved ? resolved.roleCode : r;
      name = resolved ? resolved.displayName : r;
      isCustom = r.startsWith('CLAAPS_') || r.startsWith('CUSTOM_');
    } else {
      code = r.value || r.roleCode || '';
      name = r.displayName || r.display || r.roleName || code || 'Unknown Role Name';
      isCustom = code.startsWith('CLAAPS_') || code.startsWith('CUSTOM_');
    }
    
    if (code && !seenCodes.has(code)) {
      seenCodes.add(code);
      const category = classifyRoleRecord({ name: code, roleCode: code, displayName: name });
      normalized.push({
        roleName: name,
        roleCode: code,
        category,
        isCustom
      });
    }
  });
  
  return normalized;
}

export function normalizeCategoryFilter(cat?: string): string | null {
  if (!cat || cat.toUpperCase() === 'ALL') return null;
  const upper = cat.trim().toUpperCase();
  if (upper.includes('UNASSIGNED') || upper.includes('WITHOUT_USERS') || upper.includes('NO_USERS')) return 'UNASSIGNED';
  if (upper.includes('DUTY')) return 'Duty';
  if (upper.includes('GRC')) return 'GRC';
  if (upper.includes('DATA')) return 'Data';
  if (upper.includes('ABSTRACT')) return 'Abstract';
  if (upper.includes('JOB')) return 'Job';
  if (upper.includes('OTHER')) return 'Other';
  return cat;
}

class OracleService {
  private client: OracleFusionClient;
  public riskService: RiskService;
  public controlCatalogService: ControlCatalogService;
  private cachedTotalUsers = 7915;
  private cachedActiveUsers = 7731;
  private cachedInactiveUsers = 184;
  private cachedTotalRoles = 6956;
  private cachedJobRoles = 5992;
  private cachedDutyRoles = 55;
  private cachedDataRoles = 329;
  private cachedAbstractRoles = 517;
  private cachedGrcRoles = 12;
  private cachedOtherRoles = 51;
  private isCounting = false;
  private authoritativeRoles: Role[] = [];
  private lastRolesSyncTime = '';
  private queryCache = new Map<string, { data: any; expiresAt: number }>();
  private persistentPrivilegesCache: Record<string, { data: any; timestamp: number }> = {};

  constructor() {
    this.client = new OracleFusionClient();
    this.riskService = new RiskService(this.client);
    this.controlCatalogService = new ControlCatalogService(this.client);
    this.loadAuthoritativeRolesFromCache();
    this.loadPersistentPrivilegesFromDisk();
    this.triggerBackgroundCounting();
  }

  public loadPersistentPrivilegesFromDisk(): void {
    try {
      if (fs.existsSync(PRIVILEGES_CACHE_FILE)) {
        const raw = fs.readFileSync(PRIVILEGES_CACHE_FILE, 'utf-8');
        this.persistentPrivilegesCache = JSON.parse(raw);
        console.log(`[Oracle Service] Loaded ${Object.keys(this.persistentPrivilegesCache).length} cached role briefings from disk.`);
      }
    } catch (err) {
      console.warn('[Oracle Service] Failed to load privileges cache from disk:', (err as Error).message);
    }
  }

  public savePersistentPrivilege(key: string, data: any): void {
    try {
      this.persistentPrivilegesCache[key] = {
        data,
        timestamp: Date.now()
      };
      fs.writeFileSync(PRIVILEGES_CACHE_FILE, JSON.stringify(this.persistentPrivilegesCache, null, 2), 'utf-8');
      console.log(`[Oracle Service] Successfully persisted briefing cache for "${key}" to disk.`);
    } catch (err) {
      console.error('[Oracle Service] Failed to save persistent privilege cache:', (err as Error).message);
    }
  }

  public loadAuthoritativeRolesFromCache(): boolean {
    try {
      if (fs.existsSync(ROLES_CACHE_FILE)) {
        const raw = fs.readFileSync(ROLES_CACHE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed?.roles && Array.isArray(parsed.roles) && parsed.roles.length > 0) {
          this.authoritativeRoles = parsed.roles.map((r: any) => ({
            ...r,
            parentRoles: r.parentRoles || [],
            childRoles: r.childRoles || [],
            privileges: r.privileges || []
          }));
          this.cachedTotalRoles = parsed.totalResults || parsed.roles.length;
          if (parsed.counts) {
            this.cachedJobRoles = parsed.counts.Job || 0;
            this.cachedDutyRoles = parsed.counts.Duty || 0;
            this.cachedDataRoles = parsed.counts.Data || 0;
            this.cachedAbstractRoles = parsed.counts.Abstract || 0;
            this.cachedGrcRoles = parsed.counts.GRC || 0;
            this.cachedOtherRoles = parsed.counts.Other || 0;
          }
          this.lastRolesSyncTime = parsed.syncedAt || new Date().toISOString();
          console.log(`[Oracle Service] Authoritative Role Dataset ready: ${this.authoritativeRoles.length} records loaded (Synced: ${this.lastRolesSyncTime}).`);
          return true;
        }
      }
    } catch (err) {
      console.warn('[Oracle Service] Failed to load cached authoritative roles:', (err as Error).message);
    }
    return false;
  }

  public saveAuthoritativeRolesToCache(): void {
    try {
      const counts = {
        Job: this.cachedJobRoles,
        Duty: this.cachedDutyRoles,
        Data: this.cachedDataRoles,
        Abstract: this.cachedAbstractRoles,
        GRC: this.cachedGrcRoles,
        Other: this.cachedOtherRoles
      };
      fs.writeFileSync(ROLES_CACHE_FILE, JSON.stringify({
        syncedAt: this.lastRolesSyncTime || new Date().toISOString(),
        totalResults: this.authoritativeRoles.length,
        counts,
        roles: this.authoritativeRoles
      }, null, 2));
      console.log('[Oracle Service] Successfully saved authoritative role dataset to disk.');
    } catch (err) {
      console.error('[Oracle Service] Failed to save authoritative roles cache:', (err as Error).message);
    }
  }

  public getAuthoritativeRoles(): Role[] {
    return this.authoritativeRoles;
  }

  public getFromCache<T>(key: string): T | null {
    const item = this.queryCache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.queryCache.delete(key);
      return null;
    }
    return item.data as T;
  }

  public setInCache<T>(key: string, data: T, ttlMs: number = 3 * 60 * 1000): void {
    if (this.queryCache.size > 500) {
      const oldestKey = this.queryCache.keys().next().value;
      if (oldestKey) this.queryCache.delete(oldestKey);
    }
    this.queryCache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  public clearQueryCache(): void {
    this.queryCache.clear();
  }

  recreateClient() {
    this.clearQueryCache();
    this.client.recreateClient();
    this.riskService = new RiskService(this.client);
    this.controlCatalogService.recreateClient(this.client);
    this.loadAuthoritativeRolesFromCache();
    this.triggerBackgroundCounting(true);
  }

  isDemoMode(): boolean {
    return config.environmentMode === 'DEMO';
  }

  getModeInfo() {
    return {
      mode: config.environmentMode,
      dataSource: this.isDemoMode() ? 'Sample Oracle Fusion Data' : 'Live Oracle Fusion API',
      connectionConfigured: !!config.oracle.baseUrl
    };
  }

  getCachedCounts() {
    if (this.authoritativeRoles.length > 0) {
      const jobRolesCount = this.authoritativeRoles.filter(r => r.category === 'Job').length;
      const dutyRolesCount = this.authoritativeRoles.filter(r => r.category === 'Duty').length;
      const dataRolesCount = this.authoritativeRoles.filter(r => r.category === 'Data').length;
      const abstractRolesCount = this.authoritativeRoles.filter(r => r.category === 'Abstract').length;
      const grcRolesCount = this.authoritativeRoles.filter(r => r.category === 'GRC').length;
      const otherRolesCount = this.authoritativeRoles.filter(r => r.category === 'Other').length;
      const rolesWithoutUsersCount = this.authoritativeRoles.filter(r => !r.members || r.members.length === 0).length;
      const rolesWithUsersCount = this.authoritativeRoles.length - rolesWithoutUsersCount;

      return {
        totalUsers: this.cachedTotalUsers,
        activeUsers: this.cachedActiveUsers,
        inactiveUsers: this.cachedInactiveUsers,
        totalRoles: this.authoritativeRoles.length,
        jobRolesCount,
        dutyRolesCount,
        dataRolesCount,
        abstractRolesCount,
        grcRolesCount,
        otherRolesCount,
        rolesWithoutUsersCount,
        rolesWithUsersCount,
        highRiskRolesCount: grcRolesCount,
        syncedAt: this.lastRolesSyncTime
      };
    }

    return {
      totalUsers: this.cachedTotalUsers,
      activeUsers: this.cachedActiveUsers,
      inactiveUsers: this.cachedInactiveUsers,
      totalRoles: this.cachedTotalRoles,
      jobRolesCount: this.cachedJobRoles,
      dutyRolesCount: this.cachedDutyRoles,
      dataRolesCount: this.cachedDataRoles,
      abstractRolesCount: this.cachedAbstractRoles,
      grcRolesCount: this.cachedGrcRoles,
      otherRolesCount: this.cachedOtherRoles,
      rolesWithoutUsersCount: 4918,
      rolesWithUsersCount: 2071,
      highRiskRolesCount: this.cachedGrcRoles,
      syncedAt: this.lastRolesSyncTime
    };
  }

  public validateRoleCounts() {
    const counts = this.getCachedCounts();
    const dataset = this.authoritativeRoles;

    const dutyInDataset = dataset.filter(r => r.category === 'Duty').length;
    const grcInDataset = dataset.filter(r => r.category === 'GRC').length;
    const dataInDataset = dataset.filter(r => r.category === 'Data').length;
    const abstractInDataset = dataset.filter(r => r.category === 'Abstract').length;
    const jobInDataset = dataset.filter(r => r.category === 'Job').length;
    const otherInDataset = dataset.filter(r => r.category === 'Other').length;
    const totalInDataset = dataset.length;
    const sumCategories = jobInDataset + dutyInDataset + dataInDataset + abstractInDataset + grcInDataset + otherInDataset;

    const mismatches: string[] = [];
    if (counts.dutyRolesCount !== dutyInDataset) {
      mismatches.push(`Duty mismatch: dashboard=${counts.dutyRolesCount}, dataset=${dutyInDataset}`);
    }
    if (counts.grcRolesCount !== grcInDataset) {
      mismatches.push(`GRC mismatch: dashboard=${counts.grcRolesCount}, dataset=${grcInDataset}`);
    }
    if (counts.dataRolesCount !== dataInDataset) {
      mismatches.push(`Data mismatch: dashboard=${counts.dataRolesCount}, dataset=${dataInDataset}`);
    }
    if (counts.abstractRolesCount !== abstractInDataset) {
      mismatches.push(`Abstract mismatch: dashboard=${counts.abstractRolesCount}, dataset=${abstractInDataset}`);
    }
    if (counts.jobRolesCount !== jobInDataset) {
      mismatches.push(`Job mismatch: dashboard=${counts.jobRolesCount}, dataset=${jobInDataset}`);
    }
    if (counts.totalRoles !== totalInDataset) {
      mismatches.push(`Total mismatch: dashboard=${counts.totalRoles}, dataset=${totalInDataset}`);
    }
    if (sumCategories !== totalInDataset) {
      mismatches.push(`Sum mismatch: sum=${sumCategories}, total=${totalInDataset}`);
    }

    return {
      isValid: mismatches.length === 0,
      authoritativeTotal: totalInDataset,
      categoryBreakdown: {
        Job: jobInDataset,
        Duty: dutyInDataset,
        Data: dataInDataset,
        Abstract: abstractInDataset,
        GRC: grcInDataset,
        Other: otherInDataset
      },
      dashboardCounts: {
        totalRoles: counts.totalRoles,
        jobRolesCount: counts.jobRolesCount,
        dutyRolesCount: counts.dutyRolesCount,
        dataRolesCount: counts.dataRolesCount,
        abstractRolesCount: counts.abstractRolesCount,
        grcRolesCount: counts.grcRolesCount,
        otherRolesCount: counts.otherRolesCount
      },
      sumOfCategories: sumCategories,
      mismatches,
      lastSync: this.lastRolesSyncTime,
      isDemoMode: this.isDemoMode()
    };
  }

  async syncAuthoritativeRoles(): Promise<{ success: boolean; totalRoles: number; counts: any; duration: string }> {
    if (this.isCounting || this.isDemoMode()) {
      return { 
        success: true, 
        totalRoles: this.authoritativeRoles.length, 
        counts: this.getCachedCounts(),
        duration: '0s (already in progress or demo)' 
      };
    }
    this.isCounting = true;
    const start = Date.now();
    console.log('[Oracle Service] On-demand authoritative role synchronization started...');

    try {
      const allRoles: Role[] = [];
      let totalRoles = 0;
      let jobRoles = 0;
      let dutyRoles = 0;
      let dataRoles = 0;
      let abstractRoles = 0;
      let grcRoles = 0;
      let otherRoles = 0;

      let startIndex = 1;
      const count = 100;
      while (config.environmentMode === 'ORACLE_FUSION') {
        let res: any = null;
        let retries = 3;
        while (retries > 0) {
          try {
            res = await this.client.getRoles({ count, startIndex });
            break;
          } catch (err: any) {
            retries--;
            if (retries === 0) throw err;
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        const len = res?.Resources?.length || 0;
        if (len === 0) break;
        totalRoles += len;

        res?.Resources?.forEach((r: any) => {
          const cat = classifyRoleRecord(r);
          if (cat === 'Job') jobRoles++;
          else if (cat === 'Duty') dutyRoles++;
          else if (cat === 'Data') dataRoles++;
          else if (cat === 'Abstract') abstractRoles++;
          else if (cat === 'GRC') grcRoles++;
          else otherRoles++;

          allRoles.push({
            id: r.id,
            displayName: r.displayName || '',
            roleCode: r.name || r.roleCode || '',
            category: cat,
            description: r.description || `Oracle Fusion Security ${cat} Role`,
            members: r.members?.map((m: any) => ({ value: m.value, display: m.display || '' })) || [],
            parentRoles: [],
            childRoles: [],
            privileges: []
          });
        });

        if (len < count) break;
        startIndex += count;
      }

      this.authoritativeRoles = allRoles;
      this.cachedTotalRoles = totalRoles;
      this.cachedJobRoles = jobRoles;
      this.cachedDutyRoles = dutyRoles;
      this.cachedDataRoles = dataRoles;
      this.cachedAbstractRoles = abstractRoles;
      this.cachedGrcRoles = grcRoles;
      this.cachedOtherRoles = otherRoles;
      this.lastRolesSyncTime = new Date().toISOString();
      this.saveAuthoritativeRolesToCache();
      this.clearQueryCache();

      const duration = `${((Date.now() - start) / 1000).toFixed(1)}s`;
      console.log(`[Oracle Service] Authoritative role sync complete in ${duration}. Total: ${totalRoles}`);
      return {
        success: true,
        totalRoles,
        counts: this.getCachedCounts(),
        duration
      };
    } finally {
      this.isCounting = false;
    }
  }

  async triggerBackgroundCounting(force = false) {
    if (this.isCounting || this.isDemoMode()) return;
    // If we already have authoritative roles and not forced, keep existing dataset and only count users if needed
    if (!force && this.authoritativeRoles.length > 0 && this.cachedTotalUsers > 0) {
      console.log(`[Oracle Service] Authoritative roles already active (${this.authoritativeRoles.length} roles). Skipping full crawl.`);
      return;
    }

    this.isCounting = true;
    console.log('[Oracle Service] Starting background user and role count calculation...');

    (async () => {
      try {
        let totalUsers = 0;
        let activeUsers = 0;
        let inactiveUsers = 0;
        let startIndex = 1;
        const count = 100;
        while (config.environmentMode === 'ORACLE_FUSION') {
          const res = await this.client.getUsers({ count, startIndex });
          const len = res?.Resources?.length || 0;
          totalUsers += len;
          res?.Resources?.forEach((r: any) => {
            if (r.active === false) inactiveUsers++;
            else activeUsers++;
          });
          if (len < count) break;
          startIndex += count;
        }
        this.cachedTotalUsers = totalUsers;
        this.cachedActiveUsers = activeUsers;
        this.cachedInactiveUsers = inactiveUsers;
        console.log(`[Oracle Service] Background User Count complete. Total: ${totalUsers} (Active: ${activeUsers}, Inactive: ${inactiveUsers})`);
      } catch (err) {
        console.error('[Oracle Service] Background user count failed:', (err as Error).message);
      }

      // If roles not loaded yet or forced, run full role sync
      if (this.authoritativeRoles.length === 0 || force) {
        try {
          const allRoles: Role[] = [];
          let totalRoles = 0;
          let jobRoles = 0;
          let dutyRoles = 0;
          let dataRoles = 0;
          let abstractRoles = 0;
          let grcRoles = 0;
          let otherRoles = 0;

          let startIndex = 1;
          const count = 100;
          while (config.environmentMode === 'ORACLE_FUSION') {
            let res: any = null;
            let retries = 3;
            while (retries > 0) {
              try {
                res = await this.client.getRoles({ count, startIndex });
                break;
              } catch (err: any) {
                retries--;
                if (retries === 0) throw err;
                await new Promise(r => setTimeout(r, 2000));
              }
            }

            const len = res?.Resources?.length || 0;
            if (len === 0) break;
            totalRoles += len;

            res?.Resources?.forEach((r: any) => {
              const cat = classifyRoleRecord(r);
              if (cat === 'Job') jobRoles++;
              else if (cat === 'Duty') dutyRoles++;
              else if (cat === 'Data') dataRoles++;
              else if (cat === 'Abstract') abstractRoles++;
              else if (cat === 'GRC') grcRoles++;
              else otherRoles++;

              allRoles.push({
                id: r.id,
                displayName: r.displayName || '',
                roleCode: r.name || r.roleCode || '',
                category: cat,
                description: r.description || `Oracle Fusion Security ${cat} Role`,
                members: r.members?.map((m: any) => ({ value: m.value, display: m.display || '' })) || [],
                parentRoles: [],
                childRoles: [],
                privileges: []
              });
            });

            if (len < count) break;
            startIndex += count;
          }
          this.authoritativeRoles = allRoles;
          this.cachedTotalRoles = totalRoles;
          this.cachedJobRoles = jobRoles;
          this.cachedDutyRoles = dutyRoles;
          this.cachedDataRoles = dataRoles;
          this.cachedAbstractRoles = abstractRoles;
          this.cachedGrcRoles = grcRoles;
          this.cachedOtherRoles = otherRoles;
          this.lastRolesSyncTime = new Date().toISOString();
          this.saveAuthoritativeRolesToCache();
          console.log(`[Oracle Service] Authoritative Role sync complete. Total: ${totalRoles} (Job: ${jobRoles}, Duty: ${dutyRoles}, Data: ${dataRoles}, Abstract: ${abstractRoles}, GRC: ${grcRoles}, Other: ${otherRoles})`);
        } catch (err) {
          console.error('[Oracle Service] Background role sync failed:', (err as Error).message);
        }
      }
      this.isCounting = false;
    })();
  }

  async testConnection(customConfig?: {
    baseUrl: string;
    authType: 'BASIC' | 'BEARER';
    username?: string;
    password?: string;
    token?: string;
  }) {
    if (this.isDemoMode() && !customConfig) {
      return { success: true, status: 'SUCCESS', message: 'Demo Mode: Mock connection validation successful.' };
    }
    return this.client.testConnection(customConfig);
  }

  async getUsers(params?: string | { filterText?: string; startIndex?: number; count?: number }): Promise<{ users: User[]; totalResults: number; startIndex: number; count: number }> {
    let filterText: string | undefined;
    let startIndex = 1;
    let count = 50;

    if (typeof params === 'string') {
      filterText = params;
    } else if (params && typeof params === 'object') {
      filterText = params.filterText;
      if (params.startIndex) startIndex = params.startIndex;
      if (params.count) count = params.count;
    }

    if (this.isDemoMode()) {
      let list = mockUsers;
      if (filterText) {
        const term = filterText.toLowerCase();
        list = mockUsers.filter(u => 
          u.userName.toLowerCase().includes(term) || 
          u.displayName.toLowerCase().includes(term) ||
          u.email.toLowerCase().includes(term)
        );
      }
      const totalResults = list.length;
      const sliced = list.slice(startIndex - 1, startIndex - 1 + count);
      const mapped = sliced.map(u => ({
        ...u,
        assignedRoles: normalizeAssignedRoles(u.assignedRoles, true)
      }));
      return {
        users: mapped,
        totalResults,
        startIndex,
        count
      };
    }

    // Call live Oracle Fusion SCIM Users API
    const scimFilter = filterText ? `userName co "${filterText}" or displayName co "${filterText}"` : undefined;
    const cacheKey = `users:${scimFilter || 'all'}:${startIndex}:${count}`;
    const cached = this.getFromCache<{ users: User[]; totalResults: number; startIndex: number; count: number }>(cacheKey);
    if (cached) {
      return cached;
    }

    const scimResponse = await this.client.getUsers({
      filter: scimFilter,
      startIndex,
      count
    });

    const resources = scimResponse?.Resources || [];
    const totalResults = scimResponse?.totalResults !== undefined ? scimResponse.totalResults : (this.cachedTotalUsers || resources.length);
    const mapped = resources.map((res: any) => ({
      id: res.id,
      userName: res.userName || '',
      displayName: res.name?.formatted || res.displayName || `${res.name?.givenName || ''} ${res.name?.familyName || ''}`.trim(),
      firstName: res.name?.givenName || '',
      lastName: res.name?.familyName || '',
      email: res.emails?.[0]?.value || '',
      active: typeof res.active === 'boolean' ? res.active : true,
      assignedRoles: normalizeAssignedRoles(res.roles || res.assignedRoles, false)
    }));

    const result = {
      users: mapped,
      totalResults,
      startIndex,
      count
    };

    this.setInCache(cacheKey, result, 3 * 60 * 1000);
    return result;
  }

  async getUser(userId: string): Promise<User | null> {
    const cleanUserId = userId.trim();
    console.log(`[USER LOOKUP DEBUG] Extracted username: "${userId}"`);
    console.log(`[USER LOOKUP DEBUG] Normalized username: "${cleanUserId}"`);

    if (this.isDemoMode()) {
      const u = mockUsers.find(x => 
        x.userName.toLowerCase() === cleanUserId.toLowerCase() || 
        x.displayName.toLowerCase() === cleanUserId.toLowerCase() ||
        x.id.toLowerCase() === cleanUserId.toLowerCase()
      );
      if (u) {
        console.log(`[USER LOOKUP DEBUG] API query: local find`);
        console.log(`[USER LOOKUP DEBUG] Raw API user count: 1`);
        console.log(`[USER LOOKUP DEBUG] Returned usernames: ["${u.userName}"]`);
        console.log(`[USER LOOKUP DEBUG] Final matched user: "${u.userName}"`);
        return {
          ...u,
          assignedRoles: normalizeAssignedRoles(u.assignedRoles, true)
        };
      }
      console.log(`[USER LOOKUP DEBUG] API query: local find`);
      console.log(`[USER LOOKUP DEBUG] Raw API user count: 0`);
      console.log(`[USER LOOKUP DEBUG] Returned usernames: []`);
      console.log(`[USER LOOKUP DEBUG] Final matched user: NOT FOUND`);
      return null;
    }

    // Live Oracle Fusion SCIM flow
    let matchedUserResource: any = null;

    // Attempt 1: Exact userName eq (standard proven filter)
    try {
      const filter = `userName eq "${cleanUserId}"`;
      console.log(`[USER LOOKUP DEBUG] API query: ${filter}`);
      const scimResponse = await this.client.getUsers({ filter });
      const resources = scimResponse?.Resources || [];
      console.log(`[USER LOOKUP DEBUG] Raw API user count: ${resources.length}`);
      console.log(`[USER LOOKUP DEBUG] Returned usernames: ${JSON.stringify(resources.map((r: any) => r.userName))}`);
      if (resources.length > 0) {
        matchedUserResource = resources[0];
      }
    } catch (err: any) {
      console.warn(`[Oracle Service] userName eq exact lookup failed:`, err.message);
    }

    // Attempt 2: Case insensitive userName eq check (lowercase / uppercase fallback)
    if (!matchedUserResource) {
      const variants = [cleanUserId.toLowerCase(), cleanUserId.toUpperCase()];
      // Remove duplicates
      const uniqueVariants = Array.from(new Set(variants)).filter(v => v !== cleanUserId);
      for (const variant of uniqueVariants) {
        try {
          const filter = `userName eq "${variant}"`;
          console.log(`[USER LOOKUP DEBUG] API query: ${filter}`);
          const scimResponse = await this.client.getUsers({ filter });
          const resources = scimResponse?.Resources || [];
          console.log(`[USER LOOKUP DEBUG] Raw API user count: ${resources.length}`);
          console.log(`[USER LOOKUP DEBUG] Returned usernames: ${JSON.stringify(resources.map((r: any) => r.userName))}`);
          if (resources.length > 0) {
            matchedUserResource = resources[0];
            break;
          }
        } catch (err: any) {
          console.warn(`[Oracle Service] userName eq variant lookup failed:`, err.message);
        }
      }
    }

    // Attempt 3: Exact displayName matching
    if (!matchedUserResource) {
      try {
        const filter = `displayName eq "${cleanUserId}"`;
        console.log(`[USER LOOKUP DEBUG] API query: ${filter}`);
        const scimResponse = await this.client.getUsers({ filter });
        const resources = scimResponse?.Resources || [];
        console.log(`[USER LOOKUP DEBUG] Raw API user count: ${resources.length}`);
        console.log(`[USER LOOKUP DEBUG] Returned usernames: ${JSON.stringify(resources.map((r: any) => r.userName))}`);
        if (resources.length > 0) {
          matchedUserResource = resources[0];
        }
      } catch (err: any) {
        console.warn(`[Oracle Service] displayName eq lookup failed:`, err.message);
      }
    }

    // Attempt 4: Search by familyName prefix & match case-insensitively locally
    if (!matchedUserResource) {
      try {
        const words = cleanUserId.split(/\s+/).filter(w => w.length > 1);
        if (words.length > 0) {
          const lastName = words[words.length - 1];
          const filter = `name.familyName eq "${lastName}"`;
          console.log(`[USER LOOKUP DEBUG] API query: ${filter}`);
          const scimResponse = await this.client.getUsers({ filter, count: 50 });
          const resources = scimResponse?.Resources || [];
          console.log(`[USER LOOKUP DEBUG] Raw API user count: ${resources.length}`);
          console.log(`[USER LOOKUP DEBUG] Returned usernames: ${JSON.stringify(resources.map((r: any) => r.userName))}`);
          
          const normalizedTarget = cleanUserId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          const localMatch = resources.find((r: any) => {
            const uName = (r.userName || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const dName = (r.displayName || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const fName = (r.name?.formatted || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            return uName === normalizedTarget || dName === normalizedTarget || fName === normalizedTarget;
          });
          if (localMatch) {
            matchedUserResource = localMatch;
          }
        }
      } catch (err: any) {
        console.warn(`[Oracle Service] familyName search lookup failed:`, err.message);
      }
    }

    // Direct lookup by ID as final fallback
    if (!matchedUserResource) {
      try {
        console.log(`[USER LOOKUP DEBUG] API query: Direct ID fetch for ${cleanUserId}`);
        const res = await this.client.getUser(cleanUserId);
        console.log(`[USER LOOKUP DEBUG] Raw API user count: ${res ? 1 : 0}`);
        console.log(`[USER LOOKUP DEBUG] Returned usernames: ${res ? JSON.stringify([res.userName]) : '[]'}`);
        if (res) {
          matchedUserResource = res;
        }
      } catch (err: any) {
        console.warn(`[Oracle Service] Direct SCIM ID fetch failed:`, err.message);
      }
    }

    if (matchedUserResource) {
      console.log(`[USER LOOKUP DEBUG] Final matched user: "${matchedUserResource.userName}"`);
      return {
        id: matchedUserResource.id,
        userName: matchedUserResource.userName || '',
        displayName: matchedUserResource.name?.formatted || matchedUserResource.displayName || `${matchedUserResource.name?.givenName || ''} ${matchedUserResource.name?.familyName || ''}`.trim(),
        firstName: matchedUserResource.name?.givenName || '',
        lastName: matchedUserResource.name?.familyName || '',
        email: matchedUserResource.emails?.[0]?.value || '',
        active: typeof matchedUserResource.active === 'boolean' ? matchedUserResource.active : true,
        assignedRoles: normalizeAssignedRoles(matchedUserResource.roles || matchedUserResource.assignedRoles, false)
      };
    }

    console.log(`[USER LOOKUP DEBUG] Final matched user: NOT FOUND`);
    return null;
  }

  async getRoles(
    params?: string | { filterText?: string; category?: string; startIndex?: number; count?: number },
    categoryArg?: string,
    startIndexArg?: number,
    countArg?: number
  ): Promise<{ roles: Role[]; totalResults: number; startIndex: number; count: number }> {
    let filterText: string | undefined;
    let category: string | undefined = categoryArg;
    let startIndex = startIndexArg || 1;
    let count = countArg || 50;

    if (typeof params === 'string') {
      filterText = params;
    } else if (params && typeof params === 'object') {
      filterText = params.filterText;
      if (params.category) category = params.category;
      if (params.startIndex) startIndex = params.startIndex;
      if (params.count) count = params.count;
    }

    // Authoritative Dataset:
    // When authoritative dataset is available, serve directly from it to guarantee
    // 100% consistency between Overview Dashboard role counts and Roles Catalog records.
    if (this.authoritativeRoles.length > 0) {
      let results = this.authoritativeRoles;
      const normalizedCat = normalizeCategoryFilter(category);

      if (normalizedCat === 'UNASSIGNED') {
        results = results.filter(r => !r.members || r.members.length === 0);
      } else if (normalizedCat) {
        results = results.filter(r => r.category.toLowerCase() === normalizedCat.toLowerCase());
      }

      if (filterText && filterText.trim()) {
        const term = filterText.trim().toLowerCase();
        results = results.filter(r => 
          (r.displayName && r.displayName.toLowerCase().includes(term)) ||
          (r.roleCode && r.roleCode.toLowerCase().includes(term)) ||
          (r.description && r.description.toLowerCase().includes(term)) ||
          (r.id && r.id.toLowerCase().includes(term))
        );
      }

      const totalResults = results.length;
      const sliced = results.slice(startIndex - 1, startIndex - 1 + count);
      return {
        roles: sliced,
        totalResults,
        startIndex,
        count
      };
    }

    if (this.isDemoMode()) {
      let results = mockRoles;
      if (filterText) {
        const term = filterText.toLowerCase();
        results = results.filter(r => r.displayName.toLowerCase().includes(term) || r.roleCode.toLowerCase().includes(term));
      }
      const normalizedCat = normalizeCategoryFilter(category);
      if (normalizedCat === 'UNASSIGNED') {
        results = results.filter(r => !r.members || r.members.length === 0);
      } else if (normalizedCat) {
        results = results.filter(r => r.category.toLowerCase() === normalizedCat.toLowerCase());
      }
      const totalResults = results.length;
      const sliced = results.slice(startIndex - 1, startIndex - 1 + count);
      return {
        roles: sliced,
        totalResults,
        startIndex,
        count
      };
    }

    // Fallback: Call live Oracle Fusion SCIM Roles API directly if authoritative dataset is not yet loaded
    let scimFilter = '';
    if (filterText) {
      scimFilter = `displayName co "${filterText}" or name co "${filterText}"`;
    }
    const normalizedCat = normalizeCategoryFilter(category);
    if (normalizedCat) {
      const catFilter = `category eq "${normalizedCat.toUpperCase()}"`;
      scimFilter = scimFilter ? `(${scimFilter}) and ${catFilter}` : catFilter;
    }

    const cacheKey = `roles:${scimFilter || 'all'}:${category || 'all'}:${startIndex}:${count}`;
    const cached = this.getFromCache<{ roles: Role[]; totalResults: number; startIndex: number; count: number }>(cacheKey);
    if (cached) {
      return cached;
    }

    let scimResponse: any = null;
    try {
      scimResponse = await this.client.getRoles({
        filter: scimFilter || undefined,
        startIndex,
        count
      });
    } catch (err: any) {
      // If Oracle rejects boundary startIndex requests (e.g. requested page near or beyond total results)
      return {
        roles: [],
        totalResults: this.cachedTotalRoles || 6938,
        startIndex,
        count
      };
    }

    const resources = scimResponse?.Resources || [];
    const totalResults = scimResponse?.totalResults !== undefined ? scimResponse.totalResults : (this.cachedTotalRoles || resources.length);

    const roles: Role[] = resources.map((res: any) => {
      const cat = classifyRoleRecord(res);

      return {
        id: res.id,
        displayName: res.displayName || '',
        roleCode: res.name || res.roleCode || '',
        category: cat,
        description: res.description || `Oracle Fusion Security ${cat} Role`,
        members: res.members?.map((m: any) => ({ value: m.value, display: m.display || '' })) || [],
        parentRoles: [], // SCIM doesn't expose hierarchy by default
        childRoles: [],
        privileges: []
      };
    });

    const result = {
      roles,
      totalResults,
      startIndex,
      count
    };

    this.setInCache(cacheKey, result, 3 * 60 * 1000);
    return result;
  }

  async getRole(identifier: string): Promise<Role | null> {
    if (!identifier) return null;
    const clean = identifier.trim().toLowerCase();

    // 1. In-memory resolution from authoritative roles (0ms, 6,972 roles)
    if (this.authoritativeRoles.length > 0) {
      const found = this.authoritativeRoles.find(r => 
        (r.roleCode && r.roleCode.toLowerCase() === clean) ||
        (r.displayName && r.displayName.toLowerCase() === clean) ||
        (r.id && r.id.toLowerCase() === clean)
      );
      if (found) return found;
    }

    // 2. Check memory cache
    const cacheKey = `role_single:${clean}`;
    const cached = this.getFromCache<Role>(cacheKey);
    if (cached) return cached;

    // 3. Demo mode check
    if (this.isDemoMode()) {
      const found = mockRoles.find(r => 
        (r.roleCode && r.roleCode.toLowerCase() === clean) ||
        (r.displayName && r.displayName.toLowerCase() === clean) ||
        (r.id && r.id.toLowerCase() === clean)
      );
      if (found) {
        this.setInCache(cacheKey, found, 10 * 60 * 1000);
        return found;
      }
      return null;
    }

    // 4. Live Oracle Fusion SCIM lookup
    try {
      const scimRes = await this.client.getRoles({
        filter: `displayName eq "${identifier}" or name eq "${identifier}"`,
        count: 5
      });
      const roles = scimRes?.Resources || [];
      if (roles.length > 0) {
        const r = roles[0];
        const cat = classifyRoleRecord(r);
        const mappedRole: Role = {
          id: r.id,
          displayName: r.displayName || '',
          roleCode: r.name || r.roleCode || '',
          category: cat,
          description: r.description || `Oracle Fusion Security ${cat} Role`,
          members: r.members?.map((m: any) => ({ value: m.value, display: m.display || '' })) || [],
          parentRoles: [],
          childRoles: [],
          privileges: []
        };
        this.setInCache(cacheKey, mappedRole, 10 * 60 * 1000);
        return mappedRole;
      }
    } catch (err: any) {
      console.warn(`[Oracle Service] getRole SCIM lookup failed for "${identifier}":`, err.message);
    }
    return null;
  }

  async getRoleMembers(roleNameOrCode: string): Promise<Array<{ id: string; userName: string; displayName: string; active: boolean }>> {
    if (!roleNameOrCode) return [];
    const clean = roleNameOrCode.trim().toLowerCase();
    
    // Resolve canonical role from authoritativeRoles to handle both roleCode and displayName
    const knownRole = this.authoritativeRoles.find(r => 
      r.roleCode.toLowerCase() === clean || 
      r.displayName.toLowerCase() === clean || 
      r.id.toLowerCase() === clean
    );

    const canonicalName = knownRole?.displayName || roleNameOrCode;
    const canonicalCode = knownRole?.roleCode || roleNameOrCode;

    // Check cache under canonical name or code
    const cached = this.getFromCache<Array<{ id: string; userName: string; displayName: string; active: boolean }>>(`role_members:${canonicalName.toLowerCase()}`) ||
                   this.getFromCache<Array<{ id: string; userName: string; displayName: string; active: boolean }>>(`role_members:${canonicalCode.toLowerCase()}`);
    if (cached && cached.length > 0) {
      return cached;
    }

    if (this.isDemoMode()) {
      const role = mockRoles.find(r => 
        r.displayName.toLowerCase() === clean || 
        r.roleCode.toLowerCase() === clean ||
        r.displayName.toLowerCase() === canonicalName.toLowerCase() ||
        r.roleCode.toLowerCase() === canonicalCode.toLowerCase()
      );
      if (!role) return [];
      
      const memberIds = role.members.map(m => m.value);
      const members = mockUsers
        .filter(u => memberIds.includes(u.id) || (u.assignedRoles && u.assignedRoles.some(ar => ar.toLowerCase() === role.displayName.toLowerCase() || ar.toLowerCase() === role.roleCode.toLowerCase())))
        .map(u => ({
          id: u.id,
          userName: u.userName,
          displayName: u.displayName || u.userName,
          active: u.active !== false
        }));
      this.setInCache(`role_members:${canonicalName.toLowerCase()}`, members, 15 * 60 * 1000);
      this.setInCache(`role_members:${canonicalCode.toLowerCase()}`, members, 15 * 60 * 1000);
      return members;
    }

    try {
      // Use batched getUsersByRole with canonicalName or canonicalCode
      const users = await this.getUsersByRole(canonicalName || canonicalCode);
      const members = users.map(u => ({
        id: u.id,
        userName: u.userName || u.id,
        displayName: u.displayName || u.userName || 'Unknown User',
        active: u.active !== false
      }));
      if (members.length > 0) {
        this.setInCache(`role_members:${canonicalName.toLowerCase()}`, members, 15 * 60 * 1000);
        this.setInCache(`role_members:${canonicalCode.toLowerCase()}`, members, 15 * 60 * 1000);
      }
      return members;
    } catch (err: any) {
      console.warn(`[Oracle Service] getRoleMembers failed for "${roleNameOrCode}":`, err.message);
      return [];
    }
  }

  async getUsersByRole(roleName: string): Promise<User[]> {
    if (this.isDemoMode()) {
      const cleanName = roleName.toLowerCase().trim();
      const role = mockRoles.find(r => r.displayName.toLowerCase() === cleanName || r.roleCode.toLowerCase() === cleanName);
      if (!role) return [];
      const memberIds = role.members.map(m => m.value);
      return mockUsers.filter(u => memberIds.includes(u.id));
    }

    const clean = roleName.trim().toLowerCase();
    const knownRole = this.authoritativeRoles.find(r => 
      r.roleCode.toLowerCase() === clean || 
      r.displayName.toLowerCase() === clean || 
      r.id.toLowerCase() === clean
    );

    const canonicalName = knownRole?.displayName || roleName;
    const canonicalCode = knownRole?.roleCode || roleName;

    let members: any[] = [];
    if (knownRole && knownRole.members && knownRole.members.length > 0) {
      // We already have the authoritative member IDs in-memory!
      members = knownRole.members;
    } else {
      // Call live Oracle Fusion Roles filter trying displayName first then roleCode
      const scimResponse = await this.client.getUsersByRole(canonicalName);
      let roles = scimResponse?.Resources || [];
      if (roles.length === 0 && canonicalCode && canonicalCode !== canonicalName) {
        const retryRes = await this.client.getUsersByRole(canonicalCode);
        roles = retryRes?.Resources || [];
      }
      if (roles.length === 0) return [];
      const matchedRole = roles[0];
      members = matchedRole.members || [];
    }

    if (members.length === 0) return [];

    // Resolve member details in concurrent batches
    const memberIds = members.map((m: any) => m.value);
    const chunkSize = 40;
    const resolvedUsersMap = new Map<string, any>();

    const chunks: string[][] = [];
    for (let i = 0; i < memberIds.length; i += chunkSize) {
      chunks.push(memberIds.slice(i, i + chunkSize));
    }

    await Promise.allSettled(chunks.map(async (chunk) => {
      const userFilters = chunk.map((id: string) => `id eq "${id}"`).join(' or ');
      try {
        const userRes = await this.client.getUsers({ filter: userFilters, count: chunk.length });
        userRes?.Resources?.forEach((u: any) => {
          const mappedUser: User = {
            id: u.id,
            userName: u.userName,
            displayName: u.displayName || `${u.name?.givenName || ''} ${u.name?.familyName || ''}`.trim() || u.userName,
            firstName: u.name?.givenName || '',
            lastName: u.name?.familyName || '',
            email: u.emails?.find((e: any) => e.primary)?.value || u.emails?.[0]?.value || '',
            active: u.active !== false,
            assignedRoles: normalizeAssignedRoles(u.roles?.map((r: any) => r.value || r.display) || [canonicalName], false)
          };
          resolvedUsersMap.set(u.id, mappedUser);
          if (u.userName) resolvedUsersMap.set(u.userName.toLowerCase(), mappedUser);
        });
      } catch (err) {
        console.error('[Oracle Service] Failed to resolve chunk of user IDs:', (err as Error).message);
      }
    }));

    return members.map((m: any) => {
      const resolved = resolvedUsersMap.get(m.value) || (m.userName ? resolvedUsersMap.get(m.userName.toLowerCase()) : null);
      if (resolved) return resolved;
      return {
        id: m.value,
        userName: m.userName || m.display || m.value,
        displayName: m.display || m.userName || `Identity Code: ${m.value.substring(0, 8)}...`,
        firstName: '',
        lastName: '',
        email: '',
        active: true,
        assignedRoles: normalizeAssignedRoles([canonicalName], false)
      };
    });
  }

  async getAuditHistory(params: {
    product?: string;
    businessObjectType?: string;
    fromDate?: string;
    toDate?: string;
    username?: string;
    action?: string;
    pageNumber?: number;
    pageSize?: number;
  } = {}): Promise<{
    success: boolean;
    dataSource: string;
    logs: any[];
    totalRecords: number;
    pageNumber: number;
    pageSize: number;
    product?: string;
    productDisplayName?: string;
    businessObject?: string;
    businessObjectDisplayName?: string;
    dateRange?: { fromDate: string; toDate: string };
    message?: string;
  }> {
    const pageNumber = params.pageNumber && params.pageNumber > 0 ? params.pageNumber : 1;
    const pageSize = params.pageSize && params.pageSize > 0 ? params.pageSize : 50;

    // 1. Date calculation & 30-day enforcement (Oracle limits audit queries to <= 30 days)
    const formatDate = (d: Date) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    const isIsoDate = (s?: string) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());

    let fromDateStr: string;
    let toDateStr: string;

    if (isIsoDate(params.fromDate) && isIsoDate(params.toDate)) {
      const fParts = params.fromDate!.trim().split('-').map(Number);
      const tParts = params.toDate!.trim().split('-').map(Number);
      const fDate = new Date(Date.UTC(fParts[0], fParts[1] - 1, fParts[2]));
      const tDate = new Date(Date.UTC(tParts[0], tParts[1] - 1, tParts[2]));
      const diffDays = (tDate.getTime() - fDate.getTime()) / (1000 * 60 * 60 * 24);

      if (diffDays >= 0 && diffDays <= 30) {
        fromDateStr = params.fromDate!.trim();
        toDateStr = params.toDate!.trim();
      } else if (diffDays > 30) {
        const clampedFrom = new Date(tDate.getTime() - 29 * 24 * 60 * 60 * 1000);
        fromDateStr = formatDate(clampedFrom);
        toDateStr = params.toDate!.trim();
      } else {
        // Reversed dates: swap
        fromDateStr = params.toDate!.trim();
        toDateStr = params.fromDate!.trim();
      }
    } else {
      let toDateObj = params.toDate ? new Date(params.toDate) : new Date();
      if (isNaN(toDateObj.getTime())) toDateObj = new Date();
      let fromDateObj = params.fromDate ? new Date(params.fromDate) : new Date(toDateObj.getTime() - 9 * 24 * 60 * 60 * 1000);
      if (isNaN(fromDateObj.getTime())) fromDateObj = new Date(toDateObj.getTime() - 9 * 24 * 60 * 60 * 1000);
      const diffDays = (toDateObj.getTime() - fromDateObj.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 30 || diffDays < 0) {
        fromDateObj = new Date(toDateObj.getTime() - 29 * 24 * 60 * 60 * 1000);
      }
      fromDateStr = formatDate(fromDateObj);
      toDateStr = formatDate(toDateObj);
    }

    // 2. Resolve Product & Business Object via authoritative Catalog
    const productQuery = params.product || 'Global Human Resources';
    const resolution = auditProductCatalogService.resolveAuditRequest(productQuery, params.businessObjectType);

    if (resolution.status === 'NOT_FOUND') {
      throw new Error(`Product "${productQuery}" is not recognized in the Oracle Fusion audit catalog.`);
    }

    const restProduct = resolution.product?.restProduct || resolution.product?.shortCodes?.[0] || productQuery;
    let restBusinessObjectType: string | undefined = undefined;
    if (resolution.product?.requiresBusinessObjectType) {
      if (resolution.businessObject?.restBusinessObjectType) {
        restBusinessObjectType = resolution.businessObject.restBusinessObjectType;
      } else if (resolution.businessObject?.restValue) {
        restBusinessObjectType = resolution.businessObject.restValue;
      }
    }

    // Explicit confirmed mapping for Global Human Resources (hcmCore):
    // The backend MUST use this exact Oracle Fusion REST businessObjectType:
    // oracle.apps.hcm.people.core.uiModel.view.ManagePersonVO
    if (restProduct === 'hcmCore' || resolution.product?.id === 'hcm' || resolution.product?.productName === 'Global Human Resources') {
      restBusinessObjectType = 'oracle.apps.hcm.people.core.uiModel.view.ManagePersonVO';
    }

    const productDisplayName = resolution.product?.displayName || productQuery;
    const boDisplayName = resolution.businessObject?.displayName || (resolution.product?.requiresBusinessObjectType ? 'Standard Object' : 'All Platform Events');

    // Handle Demo Mode
    if (this.isDemoMode()) {
      let results = mockAuditTrail.map((a, idx) => ({
        id: a.id || `demo_aud_${idx}`,
        timestamp: a.timestamp,
        username: a.username,
        userInternalName: a.username.toUpperCase(),
        action: a.action || 'UPDATE',
        event: a.action === 'ROLE_ASSIGN' ? 'Role Membership Add' : a.action === 'ROLE_REVOKE' ? 'Role Membership Revoke' : `Object Data ${a.action ? (a.action.charAt(0) + a.action.slice(1).toLowerCase()) : 'Update'}`,
        businessObject: a.businessObject || boDisplayName,
        qualifiedBusinessObject: restBusinessObjectType,
        identifier: `${boDisplayName}:${10000 + idx}`,
        details: a.details,
        attributeDetails: [
          { attribute: 'Status', oldValue: 'PENDING', newValue: 'ACTIVE' },
          { attribute: 'AssignedRole', oldValue: '', newValue: a.details.split(' ').pop() || 'SECURITY_ROLE' }
        ]
      }));

      if (params.username) {
        const term = params.username.toUpperCase();
        results = results.filter(a =>
          a.username.toUpperCase().includes(term) ||
          (a.details && a.details.toUpperCase().includes(term))
        );
      }
      if (params.action && params.action !== 'ALL') {
        const act = params.action.toUpperCase();
        results = results.filter(a => a.event.toUpperCase().includes(act));
      }

      return {
        success: true,
        dataSource: this.getModeInfo().dataSource,
        logs: results,
        totalRecords: results.length,
        pageNumber,
        pageSize,
        product: resolution.product?.id,
        productDisplayName,
        businessObject: resolution.businessObject?.id,
        businessObjectDisplayName: boDisplayName,
        dateRange: { fromDate: fromDateStr, toDate: toDateStr }
      };
    }

    // 3. Query Live Oracle Fusion Audit REST endpoint
    try {
      const payload: any = {
        fromDate: fromDateStr,
        toDate: toDateStr,
        product: restProduct,
        eventType: params.action && params.action !== 'ALL' ? params.action : 'ALL',
        includeChildObjects: 'true',
        includeImpersonator: 'true',
        includeAttributes: 'true',
        attributeDetailMode: 'true',
        includeExtendedObjectIdentifierColumns: 'true'
      };

      if (restBusinessObjectType) {
        payload.businessObjectType = restBusinessObjectType;
      }

      // Safe Debug Logging (no tokens, passwords, cookies, or secrets)
      console.log(`[AUDIT DEBUG] Requested product:\n${productQuery}`);
      console.log(`[AUDIT DEBUG] Resolved REST product:\n${restProduct}`);
      console.log(`[AUDIT DEBUG] Requested business object:\n${params.businessObjectType || '(none)'}`);
      console.log(`[AUDIT DEBUG] Resolved businessObjectType:\n${restBusinessObjectType || '(none)'}`);
      console.log(`[AUDIT DEBUG] fromDate:\n${fromDateStr}`);
      console.log(`[AUDIT DEBUG] toDate:\n${toDateStr}`);

      const queryPageSize = params.pageSize && params.pageSize > 50 ? params.pageSize : 500;
      const response = await this.client.getAuditHistory(payload, { pageNumber, pageSize: queryPageSize });
      const audits = response?.auditData || response?.auditHistory || response?.items || [];

      console.log(`[AUDIT DEBUG] Oracle response status:\n${response?.status || (audits.length > 0 ? 'SUCCESS' : 'EMPTY')}`);
      console.log(`[AUDIT DEBUG] Oracle auditData count:\n${audits.length}`);

      let mappedLogs = audits.map((a: any, idx: number) => {
        // Derive clean identifier from description, attributeDetails, or fields
        let identifier = a.identifier || a.objectIdentifier || '';
        const rawAttrDetails = Array.isArray(a.attributeDetails) ? a.attributeDetails : [];
        if (!identifier && a.description) {
          const descMatch = a.description.match(/(?:Person ID|Person Number|ID|Number):\s*([0-9A-Za-z_-]+)/i);
          if (descMatch) {
            identifier = descMatch[0];
          }
        }
        if (!identifier && rawAttrDetails.length > 0) {
          const idAttr = rawAttrDetails.find((d: any) =>
            d.attribute && (d.attribute.toLowerCase().includes('id') || d.attribute.toLowerCase().includes('name') || d.attribute.toLowerCase().includes('number'))
          );
          if (idAttr) {
            identifier = `${idAttr.attribute}: ${idAttr.newValue || idAttr.oldValue || ''}`;
          }
        }
        if (!identifier && a.userInternalName) {
          identifier = `User:${a.userInternalName}`;
        }
        if (!identifier) {
          identifier = `${a.businessObject || boDisplayName}:${idx + 1}`;
        }

        const attributeDetails = rawAttrDetails.map((ad: any) => ({
          attribute: ad.attribute || ad.attributeInternalName || 'Attribute',
          attributeInternalName: ad.attributeInternalName,
          oldValue: ad.oldValue !== undefined && ad.oldValue !== null ? String(ad.oldValue) : undefined,
          newValue: ad.newValue !== undefined && ad.newValue !== null ? String(ad.newValue) : undefined
        }));

        const eventName = a.eventType || a.action || 'Object Data Update';

        return {
          id: a.id || `aud_${(a.userName || 'sys').replace(/[^a-zA-Z0-9]/g, '_')}_${idx}_${Date.now()}`,
          timestamp: a.date || a.timestamp || a.lastUpdateDate || new Date().toISOString(),
          username: a.userName || a.userInternalName || a.userId || 'System',
          userInternalName: a.userInternalName,
          action: a.action || a.eventType || 'UPDATE',
          event: eventName,
          eventCategory: a.eventCategory,
          businessObject: a.businessObject || boDisplayName,
          qualifiedBusinessObject: a.qualifiedBusinessObject || restBusinessObjectType,
          identifier,
          details: a.description || (attributeDetails.length > 0 ? `Updated ${attributeDetails.length} attribute(s)` : `${eventName} on ${a.businessObject || boDisplayName}`),
          attributeDetails: attributeDetails.length > 0 ? attributeDetails : undefined,
          childObjects: a.childObjects || a.children || undefined,
          impersonator: a.impersonator || undefined,
          raw: a
        };
      });

      // Filter in memory if username or action filter specified
      if (params.username) {
        const term = params.username.toLowerCase();
        mappedLogs = mappedLogs.filter((a: any) =>
          a.username.toLowerCase().includes(term) ||
          (a.userInternalName && a.userInternalName.toLowerCase().includes(term)) ||
          (a.details && a.details.toLowerCase().includes(term))
        );
      }
      if (params.action && params.action !== 'ALL') {
        const act = params.action.toLowerCase();
        mappedLogs = mappedLogs.filter((a: any) =>
          a.event.toLowerCase().includes(act) ||
          (a.eventCategory && a.eventCategory.toLowerCase().includes(act))
        );
      }

      return {
        success: true,
        dataSource: this.getModeInfo().dataSource,
        logs: mappedLogs,
        totalRecords: response?.totalResults || mappedLogs.length,
        pageNumber,
        pageSize: queryPageSize,
        product: resolution.product?.id,
        productDisplayName,
        businessObject: resolution.businessObject?.id,
        businessObjectDisplayName: boDisplayName,
        dateRange: { fromDate: fromDateStr, toDate: toDateStr }
      };
    } catch (err: any) {
      console.error('[Oracle Service] Live getAuditHistory failed:', err.message);
      const errMsg = String(err.message || '');
      if (
        errMsg.toLowerCase().includes('businessobject') ||
        errMsg.toLowerCase().includes('business object') ||
        errMsg.toLowerCase().includes('requires a business object')
      ) {
        throw new Error('Oracle Fusion requires a Business Object Type for this audit query.');
      }
      if (
        errMsg.toLowerCase().includes('timeout') ||
        errMsg.toLowerCase().includes('econnrefused') ||
        errMsg.toLowerCase().includes('did not respond') ||
        errMsg.toLowerCase().includes('econnreset')
      ) {
        throw new Error('Unable to retrieve audit history from Oracle Fusion.');
      }
      throw err;
    }
  }

  async getRoleHierarchy(roleName: string) {
    if (this.isDemoMode()) {
      const role = mockRoles.find(r => r.displayName.toLowerCase() === roleName.toLowerCase() || r.roleCode.toLowerCase() === roleName.toLowerCase());
      if (!role) return { success: false, message: 'Role not found' };
      
      const resolveChildren = (code: string): any => {
        const found = mockRoles.find(r => r.roleCode === code);
        if (!found) return { name: code, category: 'Unknown' };
        return {
          name: found.displayName,
          code: found.roleCode,
          category: found.category,
          children: found.childRoles.map(resolveChildren)
        };
      };

      return {
        success: true,
        dataSource: 'Sample Data',
        roleName: role.displayName,
        roleCode: role.roleCode,
        category: role.category,
        hierarchy: {
          name: role.displayName,
          code: role.roleCode,
          category: role.category,
          children: role.childRoles.map(resolveChildren)
        }
      };
    }

    return {
      success: false,
      integrationRequired: true,
      dataSource: 'Oracle Fusion',
      message: 'Oracle REST API integration required. The Oracle Fusion SCIM API (/hcmRestApi/scim/Roles) does not natively return complete role hierarchies. Accessing hierarchies requires either configuration of a custom Oracle BI Publisher report service or the separate Security Console REST APIs.'
    };
  }

  async getPrivilegesForRole(roleName: string) {
    if (this.isDemoMode()) {
      const term = roleName.toLowerCase();
      const matches = mockRoles.filter(r => 
        r.displayName.toLowerCase().includes(term) || 
        r.roleCode.toLowerCase().includes(term)
      );

      if (matches.length === 0) {
        return { success: false, message: 'Role not found' };
      } else if (matches.length === 1) {
        const role = matches[0];
        const privilegesList: any[] = [];
        const visited = new Set<string>();

        const collect = (rCode: string) => {
          if (visited.has(rCode)) return;
          visited.add(rCode);
          const r = mockRoles.find(x => x.roleCode === rCode);
          if (!r) return;
          privilegesList.push(...r.privileges.map(p => ({ ...p, inheritedFrom: r.displayName })));
          r.childRoles.forEach(collect);
        };

        collect(role.roleCode);

        return {
          success: true,
          dataSource: 'Sample Data',
          roleName: role.displayName,
          roleCode: role.roleCode,
          role: {
            name: role.displayName,
            code: role.roleCode,
            category: role.category
          },
          privileges: privilegesList,
          inheritedPrivileges: [],
          entitlements: [],
          summary: {
            totalPrivileges: privilegesList.length,
            directPrivileges: privilegesList.length,
            inheritedPrivileges: 0
          },
          message: `Mock Security Briefing generated for ${role.displayName}.`
        };
      } else {
        const exactMatch = matches.find(r => 
          r.displayName.toLowerCase() === term || 
          r.roleCode.toLowerCase() === term
        );
        if (exactMatch) {
          const role = exactMatch;
          const privilegesList: any[] = [];
          const visited = new Set<string>();

          const collect = (rCode: string) => {
            if (visited.has(rCode)) return;
            visited.add(rCode);
            const r = mockRoles.find(x => x.roleCode === rCode);
            if (!r) return;
            privilegesList.push(...r.privileges.map(p => ({ ...p, inheritedFrom: r.displayName })));
            r.childRoles.forEach(collect);
          };

          collect(role.roleCode);

          return {
            success: true,
            dataSource: 'Sample Data',
            roleName: role.displayName,
            roleCode: role.roleCode,
            role: {
              name: role.displayName,
              code: role.roleCode,
              category: role.category
            },
            privileges: privilegesList,
            inheritedPrivileges: [],
            entitlements: [],
            summary: {
              totalPrivileges: privilegesList.length,
              directPrivileges: privilegesList.length,
              inheritedPrivileges: 0
            },
            message: `Mock Security Briefing generated for ${role.displayName}.`
          };
        } else {
          return {
            success: false,
            ambiguous: true,
            matches: matches.map(r => ({
              roleName: r.displayName,
              roleCode: r.roleCode,
              category: r.category
            })),
            message: `Multiple mock roles match your query "${roleName}". Please select the correct role to inspect.`
          };
        }
      }
    }

    const cacheKey = `role_privileges:${roleName.trim().toLowerCase()}`;
    const cached = this.getFromCache<any>(cacheKey);
    if (cached) {
      console.log(`[Role Briefing Timing] In-memory cache hit for "${cacheKey}" (0ms)`);
      return cached;
    }

    // Check persistent disk cache (valid within 24 hours)
    const persistent = this.persistentPrivilegesCache[cacheKey];
    if (persistent && Date.now() - persistent.timestamp < 24 * 60 * 60 * 1000) {
      console.log(`[Role Briefing Timing] Persistent disk cache hit for "${cacheKey}" (0ms)`);
      this.setInCache(cacheKey, persistent.data, 30 * 60 * 1000);
      return persistent.data;
    }

    const t0 = Date.now();
    let roleCode = '';
    let displayName = '';
    let category = 'Job';
    let resolvedRole: any = null;
    let matches: any[] = [];
    const normInput = roleName.trim().toLowerCase();

    // Fast In-Memory Resolution from Authoritative Dataset (6,972 roles)
    if (this.authoritativeRoles.length > 0) {
      const authMatch = this.authoritativeRoles.find((r: any) => 
        (r.displayName || '').trim().toLowerCase() === normInput ||
        (r.roleCode || '').trim().toLowerCase() === normInput
      );
      if (authMatch) {
        resolvedRole = authMatch;
        roleCode = authMatch.roleCode;
        displayName = authMatch.displayName;
        category = authMatch.category;
        console.log(`[Role Resolution] Fast in-memory resolution for "${roleName}" -> "${roleCode}" (${Date.now() - t0}ms)`);
      }
    }

    // Fallback to remote SCIM lookups only if not found in authoritative dataset
    if (!resolvedRole) {
      try {
        const scimRes = await this.client.getRoles({ filter: `displayName eq "${roleName}"` });
        if (scimRes?.Resources && scimRes.Resources.length > 0) {
          matches = scimRes.Resources;
        }
      } catch (err: any) {
        console.warn('[Role Resolution] SCIM exact displayName lookup failed:', err.message);
      }

      if (matches.length === 0) {
        try {
          const scimRes = await this.client.getRoles({ filter: `name eq "${roleName}"` });
          if (scimRes?.Resources && scimRes.Resources.length > 0) {
            matches = scimRes.Resources;
          }
        } catch (err: any) {
          console.warn('[Role Resolution] SCIM exact name lookup failed:', err.message);
        }
      }

      if (matches.length === 0) {
        try {
          const scimRes = await this.client.getRoles({ filter: `displayName co "${roleName}"`, count: 50 });
          const list = scimRes?.Resources || [];
          
          const localMatches = list.filter((r: any) => 
            (r.displayName || '').trim().toLowerCase() === normInput ||
            (r.name || '').trim().toLowerCase() === normInput
          );

          if (localMatches.length > 0) {
            matches = localMatches;
          }
        } catch (err: any) {
          console.warn('[Role Resolution] Case-insensitive lookup failed:', err.message);
        }
      }

      if (matches.length === 0) {
        try {
          const scimRes = await this.client.getRoles({ filter: `displayName co "${roleName}"`, count: 50 });
          const list = scimRes?.Resources || [];

          const partialMatches = list.filter((r: any) => 
            (r.displayName || '').trim().toLowerCase().includes(normInput) ||
            (r.name || '').trim().toLowerCase().includes(normInput)
          );

          if (partialMatches.length > 0) {
            matches = partialMatches;
          }
        } catch (err: any) {
          console.warn('[Role Resolution] Partial matching lookup failed:', err.message);
        }
      }

      // Try abbreviation / token expansion
      if (matches.length === 0) {
        try {
          const norm = roleName.trim();
          const expandedQueries: string[] = [];
          if (/\bAP\b/i.test(norm)) {
            expandedQueries.push(norm.replace(/\bAP\b/gi, 'Accounts Payable'));
            expandedQueries.push(norm.replace(/\bAP\b/gi, 'Payables'));
            expandedQueries.push('AP_');
          }
          if (/\bAR\b/i.test(norm)) {
            expandedQueries.push(norm.replace(/\bAR\b/gi, 'Accounts Receivable'));
            expandedQueries.push(norm.replace(/\bAR\b/gi, 'Receivables'));
          }
          if (/\bGL\b/i.test(norm)) {
            expandedQueries.push(norm.replace(/\bGL\b/gi, 'General Ledger'));
          }
          if (/\bHR\b|\bHCM\b/i.test(norm)) {
            expandedQueries.push(norm.replace(/\bHR\b|\bHCM\b/gi, 'Human Capital Management'));
            expandedQueries.push(norm.replace(/\bHR\b|\bHCM\b/gi, 'Human Resources'));
          }

          for (const q of expandedQueries) {
            const scimRes = await this.client.getRoles({ filter: `displayName co "${q}" or name co "${q}"`, count: 20 });
            const list = scimRes?.Resources || [];
            if (list.length > 0) {
              matches.push(...list);
            }
          }

          const seen = new Set<string>();
          matches = matches.filter(r => {
            const id = r.name || r.id;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          });
        } catch (err: any) {
          console.warn('[Role Resolution] Abbreviation expansion lookup failed:', err.message);
        }
      }

      if (matches.length === 0) {
        console.log(`[Role Resolution] No matches found in SCIM for "${roleName}". Rejecting request.`);
        return {
          success: false,
          notFound: true,
          message: `The security role "${roleName}" could not be located in the Oracle Fusion catalog.`
        };
      }

      if (matches.length === 1) {
        resolvedRole = matches[0];
        roleCode = resolvedRole.name;
        displayName = resolvedRole.displayName;
        category = classifyRoleRecord(resolvedRole);
        console.log(`[Role Resolution] Successfully resolved "${roleName}" to technical code "${roleCode}"`);
      } else {
        const exactMatch = matches.find((r: any) => 
          (r.displayName || '').trim().toLowerCase() === roleName.trim().toLowerCase() ||
          (r.name || '').trim().toLowerCase() === roleName.trim().toLowerCase()
        );
        if (exactMatch) {
          resolvedRole = exactMatch;
          roleCode = resolvedRole.name;
          displayName = resolvedRole.displayName;
          category = classifyRoleRecord(resolvedRole);
          console.log(`[Role Resolution] Deduplicated multiple matches using exact case-insensitive match: "${roleCode}"`);
        } else {
          console.log(`[Role Resolution] Multiple matches found for "${roleName}". Returning ambiguous choices.`);
          return {
            success: false,
            ambiguous: true,
            matches: matches.map((r: any) => ({
              roleName: r.displayName || 'Unknown Role Name',
              roleCode: r.name || '',
              category: r.category || 'Job'
            })),
            message: `Multiple security roles match your query "${roleName}". Please select the correct one to inspect.`
          };
        }
      }
    }

    const tResolve = Date.now() - t0;

    // Check code-based cache as well
    const codeCacheKey = `role_privileges:${roleCode.trim().toLowerCase()}`;
    const codeCached = this.getFromCache<any>(codeCacheKey) || this.persistentPrivilegesCache[codeCacheKey]?.data;
    if (codeCached) {
      console.log(`[Role Briefing Timing] Cache hit via roleCode "${codeCacheKey}" (0ms)`);
      this.setInCache(cacheKey, codeCached, 30 * 60 * 1000);
      return codeCached;
    }

    try {
      const tBriefingStart = Date.now();
      const briefingRes = await this.client.getRoleBriefing(roleCode);
      const tBriefing = Date.now() - tBriefingStart;
      console.log('[Role Briefing Response]', JSON.stringify(briefingRes, null, 2));

      const result = briefingRes?.result;
      
      const tParseStart = Date.now();
      let privilegesList: any[] = [];
      const completeListText = result?.["Complete list of privileges"] || '';

      if (completeListText) {
        const blocks = completeListText.split(/\n\s*\n/);
        blocks.forEach((block: string) => {
          const cleanBlock = block.trim();
          if (!cleanBlock) return;
          const match = cleanBlock.match(/^\d+\.\s*([^:]+):\s*(.*)/s);
          if (match) {
            privilegesList.push({
              name: match[1].trim(),
              code: match[1].trim().replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().substring(0, 50),
              description: match[2].trim(),
              inheritedFrom: displayName
            });
          } else {
            const matchSimple = cleanBlock.match(/^\d+\.\s*(.*)/s);
            if (matchSimple) {
              privilegesList.push({
                name: matchSimple[1].trim(),
                code: matchSimple[1].trim().replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().substring(0, 50),
                description: 'No description provided.',
                inheritedFrom: displayName
              });
            }
          }
        });
      }

      // If no privileges parsed, check if result.privileges has anything
      if (privilegesList.length === 0 && result?.privileges) {
        privilegesList = [{ name: result.privileges, code: 'REF_PRIVILEGES', inheritedFrom: displayName }];
      }

      const summaryText = result?.answer || result?.description || 'AI Security Briefing successfully generated.';
      const functionalSummary = result?.["Summary of privileges by functional category"] || '';
      const tParse = Date.now() - tParseStart;
      const tTotal = Date.now() - t0;

      console.log(`[Role Briefing Timing] Role: "${roleCode}" (${displayName})`);
      console.log(`  - Role Resolution: ${tResolve}ms`);
      console.log(`  - Oracle Briefing API: ${tBriefing}ms`);
      console.log(`  - Parsing & Normalization: ${tParse}ms`);
      console.log(`  - Privileges Extracted: ${privilegesList.length}`);
      console.log(`  - Total Server Time: ${tTotal}ms`);

      const responsePayload = {
        success: true,
        dataSource: 'Live Oracle Fusion API',
        roleName: displayName,
        roleCode: roleCode,
        role: {
          name: displayName,
          code: roleCode,
          category: category
        },
        privileges: privilegesList,
        inheritedPrivileges: [],
        entitlements: [],
        summary: {
          totalPrivileges: privilegesList.length,
          directPrivileges: privilegesList.length,
          inheritedPrivileges: 0
        },
        briefingRaw: {
          roleSummary: result?.answer || '',
          roleUsage: functionalSummary,
          privileges: completeListText
        },
        message: summaryText
      };

      this.setInCache(cacheKey, responsePayload, 30 * 60 * 1000);
      this.setInCache(codeCacheKey, responsePayload, 30 * 60 * 1000);
      this.savePersistentPrivilege(cacheKey, responsePayload);
      this.savePersistentPrivilege(codeCacheKey, responsePayload);

      return responsePayload;
    } catch (err: any) {
      const errMsg = err.message || '';
      console.warn(`[Role Briefing] AI briefing unavailable for role "${roleCode || roleName}": ${errMsg}`);

      let localizedMessage = 'Role intelligence summary is temporarily unavailable.';
      let status = 'ENRICHMENT_UNAVAILABLE';
      if (errMsg.includes('configured timeout') || errMsg.includes('timeout') || errMsg.includes('expected time') || errMsg.includes('ECONNABORTED')) {
        localizedMessage = 'AI role briefing could not be loaded within the 12-second timeout. Core investigation remains fully functional.';
        status = 'TIMEOUT';
      } else if (errMsg.includes('403') || errMsg.includes('permission denied')) {
        localizedMessage = 'Role intelligence briefing requires Risk Management duty privileges.';
        status = 'FORBIDDEN';
      }

      // Return a graceful payload with core role information so the workspace never breaks
      return {
        success: true,
        dataSource: 'Oracle Fusion Security Catalog',
        roleName: displayName || roleName,
        roleCode: roleCode || roleName,
        role: {
          name: displayName || roleName,
          code: roleCode || roleName,
          category
        },
        privileges: [],
        inheritedPrivileges: [],
        entitlements: [],
        summary: {
          totalPrivileges: 0,
          directPrivileges: 0,
          inheritedPrivileges: 0
        },
        briefingRaw: null,
        briefingUnavailable: true,
        status,
        message: localizedMessage
      };
    }
  }

  async getRiskIncidents(): Promise<any> {
    if (this.isDemoMode()) {
      return {
        success: true,
        dataSource: 'Sample Data',
        items: mockRiskIncidents
      };
    }
    return {
      success: false,
      integrationRequired: true,
      dataSource: 'Oracle Fusion',
      message: 'Oracle REST API integration required. Live risk incidents are managed within Oracle Fusion Advanced Access Controls (AAC) and Risk Management, which are licensed separately and communicate via separate GRC REST service endpoints.'
    };
  }

  async getSoDConflicts(): Promise<any> {
    if (this.isDemoMode()) {
      return {
        success: true,
        dataSource: 'Sample Data',
        items: mockSoDConflicts
      };
    }
    return {
      success: false,
      integrationRequired: true,
      dataSource: 'Oracle Fusion',
      message: 'Oracle REST API integration required. Segregation of Duties (SoD) analytics are generated inside Oracle Risk Management Cloud. Live integration requires the Oracle Risk Management REST API.'
    };
  }

  async getAccessCertifications(): Promise<any> {
    if (this.isDemoMode()) {
      return {
        success: true,
        dataSource: 'Sample Data',
        items: mockAccessCertifications
      };
    }
    return {
      success: false,
      integrationRequired: true,
      dataSource: 'Oracle Fusion',
      message: 'Oracle REST API integration required. Access certifications require Oracle Access Certification Cloud API integration.'
    };
  }

  async getAdvancedAccessRequests(options?: { limit?: number; offset?: number; status?: string; user?: string }) {
    return this.riskService.getAccessRequests(options);
  }

  async getAccessRequestById(id: string) {
    return this.riskService.getAccessRequestById(id);
  }

  async getAdvancedControls(options?: { limit?: number; offset?: number; forceRefresh?: boolean }) {
    return this.controlCatalogService.getAllControls(options?.forceRefresh);
  }

  async getAdvancedControlDetail(controlId: string) {
    return this.controlCatalogService.getControlDetail(controlId);
  }

  resolveAdvancedControl(query: string) {
    return this.controlCatalogService.resolveControl(query);
  }

  getRiskCapabilities() {
    return this.riskService.getRiskCapabilities();
  }
}

export const oracleService = new OracleService();

