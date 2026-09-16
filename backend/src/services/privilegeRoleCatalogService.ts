import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { otbiClient, OtbiQueryResult } from '../oracle/otbiClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PrivilegeRoleRef {
  roleName: string;
  roleCode: string;
}

export interface PrivilegeEntry {
  privilegeName: string;
  privilegeCode: string;
  roles: PrivilegeRoleRef[];
}

export interface PrivilegeRoleSyncMetadata {
  lastSuccessfulSync: string | null;
  lastAttemptedSync: string | null;
  syncDurationMs: number;
  totalMappingRows: number;
  uniquePrivileges: number;
  uniqueRoles: number;
  status: 'READY' | 'SYNCING' | 'ERROR';
  lastError: string | null;
  dataSource: 'OTBI';
  reportPath: string;
}

export interface PrivilegeRoleCatalogData {
  metadata: PrivilegeRoleSyncMetadata;
  privileges: Record<string, PrivilegeEntry>;
}

export interface RolesByPrivilegeResult {
  success: boolean;
  privilegeName: string;
  privilegeCode: string;
  matchType: 'EXACT_CODE' | 'EXACT_NAME' | 'NORMALIZED_CODE' | 'NORMALIZED_NAME' | 'NONE' | 'AMBIGUOUS';
  count: number;
  roles: PrivilegeRoleRef[];
  possibleMatches?: Array<{ privilegeName: string; privilegeCode: string; roleCount: number }>;
  message?: string;
  metadata?: PrivilegeRoleSyncMetadata;
}

const STORAGE_FILE_PATH = path.resolve(__dirname, '../../privilege_role_mapping.json');
const STORAGE_TMP_PATH = path.resolve(__dirname, '../../privilege_role_mapping.tmp.json');

export class PrivilegeRoleCatalogService {
  private catalogData: PrivilegeRoleCatalogData;
  private isSyncing = false;

  // In-Memory Fast Lookup Indexes
  // 1. Normalized Code (lower-case) -> PrivilegeEntry
  private codeIndex = new Map<string, PrivilegeEntry>();
  // 2. Normalized Name (lower-case) -> PrivilegeEntry
  private nameIndex = new Map<string, PrivilegeEntry>();
  // 3. Alias / Variation index -> Canonical Code/Key
  private aliasIndex = new Map<string, string>();

  constructor() {
    this.catalogData = this.getDefaultCatalog();
    const loaded = this.loadFromDisk();
    if (loaded) {
      this.buildIndexes();
    }
  }

  private getDefaultCatalog(): PrivilegeRoleCatalogData {
    return {
      metadata: {
        lastSuccessfulSync: null,
        lastAttemptedSync: null,
        syncDurationMs: 0,
        totalMappingRows: 0,
        uniquePrivileges: 0,
        uniqueRoles: 0,
        status: 'READY',
        lastError: null,
        dataSource: 'OTBI',
        reportPath: otbiClient.reportPath
      },
      privileges: {}
    };
  }

  /**
   * Initializes catalog on server startup:
   * Loads from persistent disk file if present; otherwise triggers initial OTBI sync.
   */
  public async initialize(): Promise<void> {
    if (Object.keys(this.catalogData.privileges).length === 0) {
      const loaded = this.loadFromDisk();
      if (loaded) {
        this.buildIndexes();
        console.log(`[Privilege-Role Catalog] Loaded from disk: ${this.catalogData.metadata.totalMappingRows} mappings, ${this.catalogData.metadata.uniquePrivileges} unique privileges, ${this.catalogData.metadata.uniqueRoles} unique roles.`);
      } else {
        console.log('[Privilege-Role Catalog] No existing mapping found on disk. Initiating initial OTBI synchronization in background...');
        this.syncFromOtbi().catch(err => {
          console.warn('[Privilege-Role Catalog] Initial background sync deferred or failed:', err.message);
        });
      }
    } else {
      console.log(`[Privilege-Role Catalog] Active Catalog ready: ${this.catalogData.metadata.totalMappingRows} mappings, ${this.catalogData.metadata.uniquePrivileges} unique privileges.`);
    }
  }

  private loadFromDisk(): boolean {
    try {
      if (fs.existsSync(STORAGE_FILE_PATH)) {
        const content = fs.readFileSync(STORAGE_FILE_PATH, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed && parsed.metadata && parsed.privileges) {
          if (parsed.metadata.status === 'SYNCING') {
            parsed.metadata.status = 'READY';
          }
          this.catalogData = parsed;
          return true;
        }
      }
    } catch (err: any) {
      console.error('[Privilege-Role Catalog] Error loading from disk:', err.message);
    }
    return false;
  }

  /**
   * Builds fast in-memory lookup indexes and alias mappings.
   */
  private buildIndexes(): void {
    this.codeIndex.clear();
    this.nameIndex.clear();
    this.aliasIndex.clear();

    for (const entry of Object.values(this.catalogData.privileges)) {
      const codeKey = (entry.privilegeCode || '').trim().toLowerCase();
      const nameKey = (entry.privilegeName || '').trim().toLowerCase();

      if (codeKey) {
        this.codeIndex.set(codeKey, entry);

        // Normalize code variations into alias index:
        // E.g. POZ_MAINTAIN_SUPPLIER_CONTACT_PRIV
        // -> ORA_POZ_MAINTAIN_SUPPLIER_CONTACT_PRIV
        // -> POZ_MAINTAIN_SUPPLIER_CONTACT
        // -> ORA_POZ_MAINTAIN_SUPPLIER_CONTACT
        this.aliasIndex.set(codeKey, codeKey);

        const withoutPriv = codeKey.replace(/_priv$/, '');
        if (withoutPriv !== codeKey) {
          this.aliasIndex.set(withoutPriv, codeKey);
          this.aliasIndex.set('ora_' + withoutPriv, codeKey);
        }

        const withOra = codeKey.startsWith('ora_') ? codeKey : 'ora_' + codeKey;
        this.aliasIndex.set(withOra, codeKey);
        this.aliasIndex.set(withOra.replace(/_priv$/, ''), codeKey);
      }

      if (nameKey) {
        this.nameIndex.set(nameKey, entry);
      }
    }
  }

  /**
   * Synchronizes data from OTBI Analysis into the catalog.
   * Atomically validates and publishes without overwriting last-known-good data on failure.
   */
  public async syncFromOtbi(): Promise<{ success: boolean; message: string; metadata: PrivilegeRoleSyncMetadata }> {
    if (this.isSyncing) {
      return {
        success: false,
        message: 'OTBI synchronization is already in progress.',
        metadata: this.getMetadata()
      };
    }

    this.isSyncing = true;
    const syncStart = Date.now();
    this.catalogData.metadata.lastAttemptedSync = new Date().toISOString();
    this.catalogData.metadata.status = 'SYNCING';

    try {
      console.log(`[Privilege-Role Catalog] Starting OTBI sync from analysis "${otbiClient.reportPath}"...`);
      const queryResult: OtbiQueryResult = await otbiClient.fetchCompleteAnalysis();

      if (!queryResult.success || !queryResult.rows || queryResult.rows.length === 0) {
        throw new Error(queryResult.error || 'OTBI analysis returned 0 rows or query execution failed.');
      }

      // SYNC VALIDATION:
      // 1. Minimum sanity threshold (must have substantial rows from OTBI)
      if (queryResult.rows.length < 100) {
        throw new Error(`Retrieved only ${queryResult.rows.length} rows, which is unexpectedly low (< 100). Aborting publish to protect active dataset.`);
      }

      const candidatePrivileges: Record<string, PrivilegeEntry> = {};
      const uniqueRoles = new Set<string>();
      let validRowCount = 0;

      for (const row of queryResult.rows) {
        const privName = (row.privilegeName || '').trim();
        const privCode = (row.privilegeCode || '').trim();
        const roleName = (row.roleName || '').trim();
        const roleCode = (row.roleCode || '').trim();

        // Must have both privilege identity and role identity
        if (!privName || !roleName || !roleCode) {
          continue;
        }

        validRowCount++;
        uniqueRoles.add(roleCode);

        // Group by unique privilege (using code if available, else name)
        const primaryKey = privCode ? privCode.toUpperCase() : privName.toUpperCase();
        if (!candidatePrivileges[primaryKey]) {
          candidatePrivileges[primaryKey] = {
            privilegeName: privName,
            privilegeCode: privCode,
            roles: []
          };
        }

        // Deduplicate roles under this privilege
        const exists = candidatePrivileges[primaryKey].roles.some(
          r => r.roleCode.toUpperCase() === roleCode.toUpperCase()
        );
        if (!exists) {
          candidatePrivileges[primaryKey].roles.push({
            roleName,
            roleCode
          });
        }
      }

      const uniquePrivilegeCount = Object.keys(candidatePrivileges).length;
      if (uniquePrivilegeCount === 0 || validRowCount === 0) {
        throw new Error('Validation failed: No valid privilege-role mappings were extracted after filtering.');
      }

      const durationMs = Date.now() - syncStart;
      const newMetadata: PrivilegeRoleSyncMetadata = {
        lastSuccessfulSync: new Date().toISOString(),
        lastAttemptedSync: this.catalogData.metadata.lastAttemptedSync,
        syncDurationMs: durationMs,
        totalMappingRows: validRowCount,
        uniquePrivileges: uniquePrivilegeCount,
        uniqueRoles: uniqueRoles.size,
        status: 'READY',
        lastError: null,
        dataSource: 'OTBI',
        reportPath: otbiClient.reportPath
      };

      const newCatalogData: PrivilegeRoleCatalogData = {
        metadata: newMetadata,
        privileges: candidatePrivileges
      };

      // Atomic write to disk: write to .tmp then rename
      try {
        fs.writeFileSync(STORAGE_TMP_PATH, JSON.stringify(newCatalogData, null, 2), 'utf-8');
        fs.renameSync(STORAGE_TMP_PATH, STORAGE_FILE_PATH);
      } catch (writeErr: any) {
        console.error('[Privilege-Role Catalog] Warning: Could not write catalog to disk:', writeErr.message);
      }

      // Atomically publish into active memory
      this.catalogData = newCatalogData;
      this.buildIndexes();

      console.log(`[Privilege-Role Catalog] Sync successfully completed in ${durationMs}ms: ${validRowCount} rows, ${uniquePrivilegeCount} privileges, ${uniqueRoles.size} roles.`);

      return {
        success: true,
        message: `Successfully synchronized ${validRowCount} mappings (${uniquePrivilegeCount} privileges, ${uniqueRoles.size} roles) from OTBI.`,
        metadata: this.getMetadata()
      };
    } catch (err: any) {
      console.error('[Privilege-Role Catalog] Sync failed:', err.message);
      // Fail-safe: PRESERVE the last-known-good dataset
      this.catalogData.metadata.status = 'ERROR';
      this.catalogData.metadata.lastError = err.message || 'Unknown synchronization error';
      return {
        success: false,
        message: `Synchronization failed: ${err.message}. Preserved last-known-good dataset (${this.catalogData.metadata.uniquePrivileges} privileges).`,
        metadata: this.getMetadata()
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Returns current sync metadata and status.
   */
  public getMetadata(): PrivilegeRoleSyncMetadata {
    return { ...this.catalogData.metadata };
  }

  /**
   * Privilege -> Roles Search
   * Priority:
   * 1. Exact privilege code match
   * 2. Exact privilege name match
   * 3. Normalized privilege code match (with/without ORA_, with/without _PRIV)
   * 4. Normalized privilege name match
   * 5. If ambiguous or multiple match candidates, return suggestions to clarify
   */
  public getRolesByPrivilege(query: string): RolesByPrivilegeResult {
    const raw = (query || '').trim();
    if (!raw) {
      return {
        success: false,
        privilegeName: '',
        privilegeCode: '',
        matchType: 'NONE',
        count: 0,
        roles: [],
        message: 'Please provide a privilege name or privilege code to search.'
      };
    }

    const norm = raw.toLowerCase();

    // 1. Exact privilege code match
    const exactByCode = this.codeIndex.get(norm);
    if (exactByCode) {
      return {
        success: true,
        privilegeName: exactByCode.privilegeName,
        privilegeCode: exactByCode.privilegeCode,
        matchType: 'EXACT_CODE',
        count: exactByCode.roles.length,
        roles: exactByCode.roles,
        metadata: this.getMetadata()
      };
    }

    // 2. Exact privilege name match (case-insensitive)
    const exactByName = this.nameIndex.get(norm);
    if (exactByName) {
      return {
        success: true,
        privilegeName: exactByName.privilegeName,
        privilegeCode: exactByName.privilegeCode,
        matchType: 'EXACT_NAME',
        count: exactByName.roles.length,
        roles: exactByName.roles,
        metadata: this.getMetadata()
      };
    }

    // 3. Normalized code alias match (e.g. ORA_POZ_MAINTAIN_SUPPLIER_CONTACT or without _PRIV)
    const canonicalCodeKey = this.aliasIndex.get(norm);
    if (canonicalCodeKey) {
      const entry = this.codeIndex.get(canonicalCodeKey);
      if (entry) {
        return {
          success: true,
          privilegeName: entry.privilegeName,
          privilegeCode: entry.privilegeCode,
          matchType: 'NORMALIZED_CODE',
          count: entry.roles.length,
          roles: entry.roles,
          metadata: this.getMetadata()
        };
      }
    }

    // 4. Normalized name match (e.g. extra whitespace collapsed, special punctuation stripped)
    const cleanNorm = norm.replace(/[_\-]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const [nameKey, entry] of this.nameIndex.entries()) {
      const cleanEntry = nameKey.replace(/[_\-]/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleanEntry === cleanNorm) {
        return {
          success: true,
          privilegeName: entry.privilegeName,
          privilegeCode: entry.privilegeCode,
          matchType: 'NORMALIZED_NAME',
          count: entry.roles.length,
          roles: entry.roles,
          metadata: this.getMetadata()
        };
      }
    }

    // 5. Look for close candidates without aggressive fuzzy matching
    const candidates: Array<{ privilegeName: string; privilegeCode: string; roleCount: number }> = [];
    for (const entry of Object.values(this.catalogData.privileges)) {
      const pNameLower = entry.privilegeName.toLowerCase();
      const pCodeLower = entry.privilegeCode.toLowerCase();

      // Check if candidate matches starting token or contains normalized term
      if (pNameLower.includes(cleanNorm) || pCodeLower.includes(norm.replace(/[^a-z0-9_]/g, ''))) {
        candidates.push({
          privilegeName: entry.privilegeName,
          privilegeCode: entry.privilegeCode,
          roleCount: entry.roles.length
        });
        if (candidates.length >= 5) break;
      }
    }

    if (candidates.length === 1) {
      // Exactly 1 clear candidate
      const matched = candidates[0];
      const entry = this.codeIndex.get(matched.privilegeCode.toLowerCase()) || this.nameIndex.get(matched.privilegeName.toLowerCase());
      if (entry) {
        return {
          success: true,
          privilegeName: entry.privilegeName,
          privilegeCode: entry.privilegeCode,
          matchType: 'NORMALIZED_NAME',
          count: entry.roles.length,
          roles: entry.roles,
          metadata: this.getMetadata()
        };
      }
    } else if (candidates.length > 1) {
      return {
        success: false,
        privilegeName: raw,
        privilegeCode: '',
        matchType: 'AMBIGUOUS',
        count: 0,
        roles: [],
        possibleMatches: candidates,
        message: `Multiple privileges matched "${raw}". Please specify one of the following exact privileges:`,
        metadata: this.getMetadata()
      };
    }

    return {
      success: false,
      privilegeName: raw,
      privilegeCode: '',
      matchType: 'NONE',
      count: 0,
      roles: [],
      message: `No matching privilege "${raw}" was found in the synchronized OTBI dataset.`,
      metadata: this.getMetadata()
    };
  }
}

export const privilegeRoleCatalogService = new PrivilegeRoleCatalogService();
