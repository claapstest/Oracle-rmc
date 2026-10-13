import axios from 'axios';
import * as xml2js from 'xml2js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db.js';
import { config } from '../config.js';
import { BipClient } from '../oracle/bipClient.js';
import { rolePrivilegeCatalogService } from './rolePrivilegeCatalogService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE_PATH = path.join(__dirname, '../../oracle_role_hierarchy_cache.json');

export interface RoleHierarchyItem {
  id: number | string;
  roleName: string;
  roleCode: string;
  category: string;
  parentRole: string;
  parentRoleType: string;
  childRole: string;
  childRoleType: string;
  relationshipType: string;
  privileges?: Array<{ code: string; name: string; description?: string }>;
  privilegeCount?: number;
}

export interface RoleHierarchyTreeNode {
  name: string;
  code: string;
  type: string;
  category: string;
  relationship?: string;
  children?: RoleHierarchyTreeNode[];
  privileges?: Array<{ code: string; name: string; description?: string }>;
}

export interface RoleHierarchyTreeResult {
  roleName: string;
  roleCode: string;
  category: string;
  parents: Array<{ name: string; type: string }>;
  childrenTree: RoleHierarchyTreeNode[];
  privileges: Array<{ code: string; name: string; description?: string }>;
  totalDescendants: number;
}

export class RoleHierarchyService {
  private bipClient: BipClient;
  private memoryCache: RoleHierarchyItem[] | null = null;
  private isSyncing = false;
  private lastSyncedAt: string | null = null;

  constructor() {
    this.bipClient = new BipClient();
    this.loadCacheFromDisk();
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

  private loadCacheFromDisk() {
    try {
      if (fs.existsSync(CACHE_FILE_PATH)) {
        const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.items)) {
          this.memoryCache = parsed.items;
          this.lastSyncedAt = parsed.lastSyncedAt || null;
          console.log(`[RoleHierarchyService] Loaded ${this.memoryCache?.length || 0} cached hierarchy relationships from disk.`);
        }
      }
    } catch (err) {
      console.warn('[RoleHierarchyService] Failed to load disk cache:', (err as Error).message);
    }
  }

  private saveCacheToDisk(items: RoleHierarchyItem[]) {
    try {
      this.lastSyncedAt = new Date().toISOString();
      fs.writeFileSync(
        CACHE_FILE_PATH,
        JSON.stringify({
          lastSyncedAt: this.lastSyncedAt,
          totalCount: items.length,
          items,
        }, null, 2),
        'utf8'
      );
    } catch (err) {
      console.warn('[RoleHierarchyService] Failed to save disk cache:', (err as Error).message);
    }
  }

  /**
   * Runs the Oracle Fusion BI Publisher report /Custom/Role_Hierarchy_Privileges.xdo live,
   * parses the XML data, and persists records with live privileges to PostgreSQL and local disk cache.
   */
  public async syncFromBip(reportPath = '/Custom/Role_Hierarchy_Privileges.xdo'): Promise<{ success: boolean; count: number; message: string }> {
    if (this.isSyncing) {
      return { success: false, count: 0, message: 'Sync already in progress.' };
    }

    this.isSyncing = true;
    console.log(`[RoleHierarchyService] Starting BIP sync for report: "${reportPath}"...`);

    try {
      const { baseUrl } = (this.bipClient as any).getCredentials();
      const endpoint = `${baseUrl}/xmlpserver/services/ExternalReportWSSService`;
      const soapEnvelope = this.bipClient.generateRunReportEnvelope(reportPath, 'xml', -1);

      const tempSoapFile = path.join(__dirname, `../../temp_bip_soap_${Date.now()}.xml`);
      const tempXmlFile = path.join(__dirname, `../../temp_bip_hierarchy_${Date.now()}.xml`);

      console.log(`[RoleHierarchyService] Downloading live report via HTTP stream to "${tempSoapFile}"...`);

      const response = await axios.post(endpoint, soapEnvelope, {
        headers: {
          'Content-Type': 'application/soap+xml; charset=UTF-8',
          'Action': 'runReport',
        },
        responseType: 'stream',
        timeout: 300000,
      });

      // Stream HTTP response directly to temporary file on disk (never creates a 512MB string)
      await new Promise<void>((resolve, reject) => {
        const writer = fs.createWriteStream(tempSoapFile);
        response.data.pipe(writer);
        writer.on('finish', () => resolve());
        writer.on('error', (err) => reject(err));
      });

      const soapSize = fs.statSync(tempSoapFile).size;
      console.log(`[RoleHierarchyService] Downloaded ${(soapSize / (1024 * 1024)).toFixed(2)} MB SOAP envelope. Stream-decoding base64 reportBytes...`);

      // Stream decode base64 between <reportBytes> and </reportBytes> (with optional namespace prefixes like pub: or ns2:) directly to XML file
      const soapStream = fs.createReadStream(tempSoapFile, { encoding: 'utf8', highWaterMark: 64 * 1024 });
      const xmlWriter = fs.createWriteStream(tempXmlFile);
      let inBytes = false;
      let leftover = '';

      const startRegex = /<([a-zA-Z0-9_-]+:)?reportBytes[^>]*>/;
      const endRegex = /<\/([a-zA-Z0-9_-]+:)?reportBytes>/;

      for await (const chunk of soapStream) {
        let text = leftover + chunk;
        leftover = '';

        if (!inBytes) {
          const match = text.match(startRegex);
          if (match && match.index !== undefined) {
            inBytes = true;
            text = text.slice(match.index + match[0].length);
          } else {
            leftover = text.slice(-50);
            continue;
          }
        }

        if (inBytes) {
          const endMatch = text.match(endRegex);
          let b64Part = '';
          if (endMatch && endMatch.index !== undefined) {
            b64Part = text.slice(0, endMatch.index).replace(/[\r\n\s]/g, '');
            inBytes = false;
          } else {
            const stripped = text.replace(/[\r\n\s]/g, '');
            const validLen = stripped.length - (stripped.length % 4);
            b64Part = stripped.slice(0, validLen);
            leftover = stripped.slice(validLen);
          }
          if (b64Part.length > 0) {
            xmlWriter.write(Buffer.from(b64Part, 'base64'));
          }
          if (!inBytes) break;
        }
      }
      await new Promise<void>((resolve) => xmlWriter.end(() => resolve()));

      // Clean up SOAP file immediately
      try {
        if (fs.existsSync(tempSoapFile)) fs.unlinkSync(tempSoapFile);
      } catch (_) {}

      const xmlSize = fs.statSync(tempXmlFile).size;
      console.log(`[RoleHierarchyService] Decoded ${(xmlSize / (1024 * 1024)).toFixed(2)} MB raw XML payload. Extracting hierarchy records...`);

      // Stream extract <G_1> or <ROW> items in 128KB chunks
      const privMap = new Map<string, Array<{ code: string; name: string; description?: string }>>();
      const seenPrivKeys = new Set<string>();
      const rawRows: Array<{ parent: string; child: string; parentType: string; childType: string; roleCode: string }> = [];

      try {
        const stream = fs.createReadStream(tempXmlFile, { encoding: 'utf8', highWaterMark: 128 * 1024 });
        let buffer = '';
        const rowRegex = /<(?:G_1|ROW)>([\s\S]*?)<\/(?:G_1|ROW)>/;

        for await (const chunk of stream) {
          buffer += chunk;
          let match;
          while ((match = rowRegex.exec(buffer)) !== null) {
            const block = match[1];
            buffer = buffer.slice(match.index + match[0].length);

            const parent = block.match(/<(?:PARENT_ROLE|PARENT_ROLE_NAME)>([\s\S]*?)<\/(?:PARENT_ROLE|PARENT_ROLE_NAME)>/)?.[1]?.trim() || '';
            const child = block.match(/<(?:CHILD_ROLE|CHILD_ROLE_NAME)>([\s\S]*?)<\/(?:CHILD_ROLE|CHILD_ROLE_NAME)>/)?.[1]?.trim() || '';
            const parentType = block.match(/<PARENT_ROLE_TYPE>([\s\S]*?)<\/PARENT_ROLE_TYPE>/)?.[1]?.trim() || 'DUTY';
            const childType = block.match(/<CHILD_ROLE_TYPE>([\s\S]*?)<\/CHILD_ROLE_TYPE>/)?.[1]?.trim() || 'JOB';
            const roleCode = block.match(/<(?:CHILD_ROLE_CODE|ROLE_CODE)>([\s\S]*?)<\/(?:CHILD_ROLE_CODE|ROLE_CODE)>/)?.[1]?.trim() || '';
            const priv = block.match(/<PRIVILEGE>([\s\S]*?)<\/PRIVILEGE>/)?.[1]?.trim() || '';
            const privName = block.match(/<PRIVILEGE_DISPLAY_NAME>([\s\S]*?)<\/PRIVILEGE_DISPLAY_NAME>/)?.[1]?.trim() || '';
            const privDesc = block.match(/<(?:PRIVILEGE_DESCRIPTION|PRIVILEGE_DESC|DESCRIPTION)>([\s\S]*?)<\/(?:PRIVILEGE_DESCRIPTION|PRIVILEGE_DESC|DESCRIPTION)>/)?.[1]?.trim() || '';

            if (!parent || !child) continue;

            const dedupeKey = `${parent.toLowerCase()}|||${child.toLowerCase()}`;
            if (priv || privName) {
              const privKey = `${dedupeKey}|||${priv.toLowerCase()}`;
              if (!seenPrivKeys.has(privKey)) {
                seenPrivKeys.add(privKey);
                if (!privMap.has(dedupeKey)) {
                  privMap.set(dedupeKey, []);
                }
                privMap.get(dedupeKey)!.push({
                  code: priv,
                  name: privName || priv,
                  description: privDesc || undefined
                });
              }
            }

            rawRows.push({ parent, child, parentType, childType, roleCode });
          }

          // Keep buffer lean by dropping garbage before next open tag
          const nextOpen = buffer.search(/<(?:G_1|ROW)>/);
          if (nextOpen > 0) {
            buffer = buffer.slice(nextOpen);
          }
        }
      } finally {
        try {
          if (fs.existsSync(tempXmlFile)) {
            fs.unlinkSync(tempXmlFile);
          }
        } catch (_) {}
      }

      console.log(`[RoleHierarchyService] Extracted ${rawRows.length.toLocaleString()} raw hierarchy rows and ${privMap.size.toLocaleString()} unique privilege groups.`);

      if (rawRows.length === 0) {
        return { success: true, count: 0, message: 'BIP report returned 0 records.' };
      }

      // Pre-load existing roles from oracle_raw_roles to resolve role codes if missing
      const host = this.getHost();
      let roleCodeMap = new Map<string, string>();
      try {
        const rolesRes = await query('SELECT role_code, role_name FROM oracle_raw_roles WHERE environment_host = $1', [host]);
        for (const r of rolesRes.rows) {
          if (r.role_name) {
            roleCodeMap.set(r.role_name.trim().toLowerCase(), r.role_code);
          }
        }
      } catch (_) {}

      const items: RoleHierarchyItem[] = [];
      const seenKeys = new Set<string>();

      rawRows.forEach((r) => {
        const parentName = r.parent;
        const parentType = r.parentType || 'DUTY';
        const childName = r.child;
        const childType = r.childType || 'JOB';

        const dedupeKey = `${parentName.toLowerCase()}|||${childName.toLowerCase()}`;
        if (seenKeys.has(dedupeKey)) return;
        seenKeys.add(dedupeKey);

        // Derive category
        let category = 'Duty';
        const pUpper = parentType.toUpperCase();
        const cUpper = childType.toUpperCase();
        if (pUpper.includes('JOB') || cUpper.includes('JOB')) {
          category = 'Job';
        } else if (pUpper.includes('ABSTRACT') || cUpper.includes('ABSTRACT')) {
          category = 'Abstract';
        } else if (pUpper.includes('DATA') || cUpper.includes('DATA')) {
          category = 'Data';
        } else if (pUpper.includes('GRC') || cUpper.includes('GRC')) {
          category = 'GRC';
        }

        const roleCode = r.roleCode ||
          roleCodeMap.get(childName.toLowerCase()) ||
          roleCodeMap.get(parentName.toLowerCase()) ||
          `ORA_${childName.toUpperCase().replace(/[^A-Z0-9_]/g, '_').substring(0, 30)}`;

        const relationshipType = `${parentType} grants ${childType}`;
        const privileges = privMap.get(dedupeKey) || [];

        items.push({
          id: items.length + 1,
          roleName: childName,
          roleCode,
          category,
          parentRole: parentName,
          parentRoleType: parentType,
          childRole: childName,
          childRoleType: childType,
          relationshipType,
          privileges,
          privilegeCount: privileges.length,
        });
      });

      // Persist to PostgreSQL database in batches
      try {
        const BATCH_SIZE = 500;
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
          const batch = items.slice(i, i + BATCH_SIZE);
          const values: any[] = [];
          const valueClauses: string[] = [];

          batch.forEach((item, bIdx) => {
            const offset = bIdx * 8;
            valueClauses.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}::jsonb)`);
            values.push(
              host,
              item.parentRole,
              item.parentRoleType,
              item.childRole,
              item.childRoleType,
              item.roleCode,
              item.category,
              JSON.stringify(item)
            );
          });

          const sql = `
            INSERT INTO oracle_raw_role_hierarchy 
              (environment_host, parent_role_name, parent_role_type, child_role_name, child_role_type, role_code, category, raw_record)
            VALUES ${valueClauses.join(', ')}
            ON CONFLICT (environment_host, parent_role_name, child_role_name) DO UPDATE SET
              parent_role_type = EXCLUDED.parent_role_type,
              child_role_type = EXCLUDED.child_role_type,
              role_code = EXCLUDED.role_code,
              category = EXCLUDED.category,
              raw_record = EXCLUDED.raw_record,
              last_synced_at = NOW();
          `;
          await query(sql, values);
        }
        console.log(`[RoleHierarchyService] Successfully persisted ${items.length} records to oracle_raw_role_hierarchy in PostgreSQL.`);
      } catch (dbErr) {
        console.error('[RoleHierarchyService] DB persist error (fallback to file cache):', (dbErr as Error).message);
      }

      // Save to memory and disk cache
      this.memoryCache = items;
      this.saveCacheToDisk(items);

      return {
        success: true,
        count: items.length,
        message: `Successfully synchronized ${items.length.toLocaleString()} role hierarchy relationships with functional privileges from Oracle Fusion.`,
      };
    } catch (err: any) {
      console.error('[RoleHierarchyService] BIP sync failed:', err.message);
      throw err;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Retrieves role hierarchy rows with filtering and pagination.
   */
  public async getHierarchyReport(options?: {
    search?: string;
    category?: string;
    page?: number;
    limit?: number;
    forceRefresh?: boolean;
  }): Promise<{
    success: boolean;
    dataSource: string;
    items: RoleHierarchyItem[];
    totalCount: number;
    lastSyncedAt: string | null;
  }> {
    if (options?.forceRefresh || (!this.memoryCache && !(await this.hasDbRecords()))) {
      try {
        await this.syncFromBip();
      } catch (err) {
        console.warn('[RoleHierarchyService] Live sync failed on demand, using cached records if available:', (err as Error).message);
      }
    }

    // Try loading from DB if memory is empty
    if (!this.memoryCache || this.memoryCache.length === 0) {
      const host = this.getHost();
      try {
        const res = await query(
          `SELECT id, parent_role_name, parent_role_type, child_role_name, child_role_type, role_code, category, relationship_type, raw_record, last_synced_at
           FROM oracle_raw_role_hierarchy 
           WHERE environment_host = $1 
           ORDER BY child_role_name ASC`,
          [host]
        );
        if (res.rows.length > 0) {
          this.memoryCache = res.rows.map((r, i) => {
            const raw = r.raw_record || {};
            return {
              id: r.id || i + 1,
              roleName: r.child_role_name,
              roleCode: r.role_code || raw.roleCode || `ORA_ROLE_${i + 1}`,
              category: r.category || raw.category || 'Duty',
              parentRole: r.parent_role_name,
              parentRoleType: r.parent_role_type || raw.parentRoleType || 'DUTY',
              childRole: r.child_role_name,
              childRoleType: r.child_role_type || raw.childRoleType || 'JOB',
              relationshipType: r.relationship_type || raw.relationshipType || `${r.parent_role_type} grants ${r.child_role_type}`,
              privileges: raw.privileges || [],
              privilegeCount: raw.privilegeCount || (raw.privileges?.length || 0),
            };
          });
          this.lastSyncedAt = res.rows[0].last_synced_at?.toISOString() || null;
        }
      } catch (err) {
        console.warn('[RoleHierarchyService] DB load error:', (err as Error).message);
      }
    }

    let allItems = this.memoryCache || [];

    // Filter by search (checks role names, role codes, relationship, and privileges)
    if (options?.search) {
      const q = options.search.toLowerCase().trim();
      allItems = allItems.filter(
        i =>
          i.roleName.toLowerCase().includes(q) ||
          i.roleCode.toLowerCase().includes(q) ||
          i.parentRole.toLowerCase().includes(q) ||
          i.childRole.toLowerCase().includes(q) ||
          i.relationshipType.toLowerCase().includes(q) ||
          (i.privileges && i.privileges.some(p => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)))
      );
    }

    // Filter by category
    if (options?.category && options.category !== 'ALL') {
      const cat = options.category.toLowerCase().trim();
      allItems = allItems.filter(i => i.category.toLowerCase() === cat);
    }

    return {
      success: true,
      dataSource: 'Live Oracle Fusion (BIP)',
      items: allItems,
      totalCount: allItems.length,
      lastSyncedAt: this.lastSyncedAt,
    };
  }

  /**
   * Constructs an interactive multi-level hierarchy tree for a given role name.
   */
  public async getRoleHierarchyTree(roleName: string): Promise<RoleHierarchyTreeResult> {
    const report = await this.getHierarchyReport();
    const items = report.items;
    const target = roleName.trim();
    const targetLower = target.toLowerCase();

    // 1. Find direct parents (roles that grant/contain this role)
    const parents: Array<{ name: string; type: string }> = [];
    const parentSet = new Set<string>();

    items.forEach(item => {
      if (item.childRole.toLowerCase() === targetLower) {
        if (!parentSet.has(item.parentRole)) {
          parentSet.add(item.parentRole);
          parents.push({ name: item.parentRole, type: item.parentRoleType });
        }
      }
    });

    // 2. Build recursive child inheritance tree
    const visited = new Set<string>();
    visited.add(targetLower);

    const buildChildren = (currentName: string, depth = 1): RoleHierarchyTreeNode[] => {
      if (depth > 4) return []; // prevent infinite recursion

      const cLower = currentName.toLowerCase();
      const directChildren: RoleHierarchyTreeNode[] = [];

      items.forEach(item => {
        // In our mapping, PARENT_ROLE grants CHILD_ROLE
        // When checking for children of currentName, if item.parentRole === currentName
        if (item.parentRole.toLowerCase() === cLower) {
          const childKey = item.childRole.toLowerCase();
          if (!visited.has(childKey)) {
            visited.add(childKey);

            // Use live privileges from item if available, else fallback to static catalog
            let privs: Array<{ code: string; name: string; description?: string }> = item.privileges && item.privileges.length > 0
              ? item.privileges
              : [];

            if (privs.length === 0) {
              const privResult = rolePrivilegeCatalogService.getPrivilegesByRole(item.childRole);
              privs = (privResult?.privileges || []).map(p => typeof p === 'string' ? { code: p, name: p } : { code: (p as any).code || '', name: (p as any).name || '' });
            }

            directChildren.push({
              name: item.childRole,
              code: item.roleCode,
              type: item.childRoleType,
              category: item.category,
              relationship: item.relationshipType,
              privileges: privs,
              children: buildChildren(item.childRole, depth + 1),
            });
          }
        }
      });

      return directChildren;
    };

    const childrenTree = buildChildren(target, 1);

    // Privileges for the top role itself
    const rootItem = items.find(i => i.roleName.toLowerCase() === targetLower || i.childRole.toLowerCase() === targetLower);
    let rootPrivs: Array<{ code: string; name: string; description?: string }> = rootItem?.privileges && rootItem.privileges.length > 0
      ? rootItem.privileges
      : [];

    if (rootPrivs.length === 0) {
      const rootPrivResult = rolePrivilegeCatalogService.getPrivilegesByRole(target);
      rootPrivs = (rootPrivResult?.privileges || []).map(p => typeof p === 'string' ? { code: p, name: p } : { code: (p as any).code || '', name: (p as any).name || '' });
    }

    // Derive category
    const directMatch = items.find(i => i.roleName.toLowerCase() === targetLower || i.childRole.toLowerCase() === targetLower || i.parentRole.toLowerCase() === targetLower);
    const category = directMatch?.category || (parents.length > 0 ? 'Duty' : 'Job');
    const roleCode = directMatch?.roleCode || `ORA_${target.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;

    return {
      roleName: target,
      roleCode,
      category,
      parents,
      childrenTree,
      privileges: rootPrivs,
      totalDescendants: visited.size - 1,
    };
  }

  private async hasDbRecords(): Promise<boolean> {
    try {
      const res = await query('SELECT 1 FROM oracle_raw_role_hierarchy LIMIT 1');
      return (res.rowCount || 0) > 0;
    } catch {
      return false;
    }
  }
}

export const roleHierarchyService = new RoleHierarchyService();
