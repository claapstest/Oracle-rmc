import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db.js';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CERTIFICATIONS_CACHE_FILE = path.resolve(__dirname, '../../oracle_access_certs_cache.json');
const WORKSHEETS_CACHE_FILE = path.resolve(__dirname, '../../oracle_certifier_worksheets_cache.json');

export interface RawAccessCertificationRecord {
  environment_host: string;
  certification_id: string;
  certification_name: string | null;
  type: string | null;
  status: string | null;
  percent_complete: number;
  due_date: string | null;
  creation_date: string | null;
  owner_name: string | null;
  manager_name: string | null;
  certifier_name: string | null;
  raw_data: any;
  last_synced_at: string;
}

export interface RawCertifierWorksheetRecord {
  id?: number | string;
  environment_host: string;
  certification_id: string;
  certification_name: string | null;
  user_name: string | null;
  role_name: string | null;
  role_code: string | null;
  certifier_name: string | null;
  certified_manager: string | null;
  direct_manager: string | null;
  business_unit: string | null;
  department: string | null;
  action: string | null;
  raw_data: any;
  last_synced_at: string;
}

export class AccessCertRawDbService {
  /**
   * Normalizes the host string for environment isolation.
   */
  public getHost(): string {
    const rawUrl = (process.env.FUSION_HOST || config.oracle.baseUrl || 'eiiv-dev14.fa.us6.oraclecloud.com').trim().toLowerCase();
    try {
      if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
        return new URL(rawUrl).host;
      }
    } catch (_) {}
    return rawUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'eiiv-dev14.fa.us6.oraclecloud.com';
  }

  // =========================================================================
  // 1. Access Certifications Campaigns (oracle_raw_access_certifications)
  // =========================================================================

  /**
   * Saves raw certification campaign records into the database and updates file cache.
   * Stores the exact raw data received from the BI Publisher report in raw_data JSONB.
   */
  public async saveRawCertifications(certifications: any[]): Promise<void> {
    if (!Array.isArray(certifications) || certifications.length === 0) return;
    const host = this.getHost();

    // 1. Always update offline-resilient disk cache first
    try {
      this.writeCertificationsCache(certifications);
    } catch (cacheErr: any) {
      console.warn('[AccessCertDb] Failed to update file cache:', cacheErr.message);
    }

    // 2. Persist into PostgreSQL
    try {
      for (const item of certifications) {
        const certId = String(item.certificationId ?? item.id ?? '').trim();
        if (!certId) continue;

        const certName = item.certificationName || item.name || `Certification ${certId}`;
        const type = item.type || 'Standard';
        const status = item.status || 'Active';
        const percent = typeof item.certificationPercentComplete === 'number' 
          ? item.certificationPercentComplete 
          : parseFloat(String(item.certificationPercentComplete || '0').replace('%', '').trim()) || 0;
        const dueDate = item.dueDate || null;
        const creationDate = item.creationDate || null;
        const ownerName = item.ownerName || null;
        const managerName = item.managerName || null;
        const certifierName = item.certifierName || item.certifiedManager || managerName || null;

        const sql = `
          INSERT INTO oracle_raw_access_certifications (
            environment_host,
            certification_id,
            certification_name,
            type,
            status,
            percent_complete,
            due_date,
            creation_date,
            owner_name,
            manager_name,
            certifier_name,
            raw_data,
            last_synced_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
          ON CONFLICT (environment_host, certification_id) DO UPDATE SET
            certification_name = EXCLUDED.certification_name,
            type = EXCLUDED.type,
            status = EXCLUDED.status,
            percent_complete = EXCLUDED.percent_complete,
            due_date = EXCLUDED.due_date,
            creation_date = EXCLUDED.creation_date,
            owner_name = EXCLUDED.owner_name,
            manager_name = EXCLUDED.manager_name,
            certifier_name = EXCLUDED.certifier_name,
            raw_data = EXCLUDED.raw_data,
            last_synced_at = NOW(),
            updated_at = NOW();
        `;

        await query(sql, [
          host,
          certId,
          certName,
          type,
          status,
          percent,
          dueDate,
          creationDate,
          ownerName,
          managerName,
          certifierName,
          JSON.stringify(item)
        ]);
      }
      console.log(`[AccessCertDb] Successfully persisted ${certifications.length} certifications to PostgreSQL for ${host}`);
    } catch (dbErr: any) {
      console.warn('[AccessCertDb] Database unavailable or error during saveRawCertifications (safely continuing with cache):', dbErr.message);
    }
  }

  /**
   * Retrieves all certifications from database, with fallback to disk cache.
   */
  public async getCertifications(): Promise<any[] | null> {
    const host = this.getHost();
    try {
      const res = await query<RawAccessCertificationRecord>(
        `SELECT * FROM oracle_raw_access_certifications 
         WHERE (environment_host = $1 OR environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com') 
         ORDER BY (CASE WHEN environment_host = $1 THEN 0 ELSE 1 END), certification_id ASC`,
        [host]
      );

      if (res.rows && res.rows.length > 0) {
        return res.rows.map(r => {
          const raw = r.raw_data || {};
          return {
            ...raw,
            id: Number(r.certification_id) || r.certification_id,
            certificationId: Number(r.certification_id) || r.certification_id,
            certificationName: r.certification_name || raw.certificationName,
            name: r.certification_name || raw.name,
            type: r.type || raw.type || 'Standard',
            status: r.status || raw.status || 'Active',
            certificationPercentComplete: typeof r.percent_complete === 'number' ? r.percent_complete : Number(r.percent_complete) || 0,
            dueDate: r.due_date || raw.dueDate,
            creationDate: r.creation_date || raw.creationDate,
            ownerName: r.owner_name || raw.ownerName,
            managerName: r.manager_name || raw.managerName,
            certifierName: r.certifier_name || raw.certifierName,
            source: 'PostgreSQL Database (Synced with BI Publisher)'
          };
        });
      }
    } catch (err: any) {
      console.warn('[AccessCertDb] DB read error for certifications (falling back to disk cache):', err.message);
    }

    // Fallback: Read from file cache
    return this.readCertificationsCache();
  }

  // =========================================================================
  // 2. Certifier Worksheet Details (oracle_raw_certifier_worksheets)
  // =========================================================================

  /**
   * Saves raw worksheet rows for a certification into PostgreSQL and disk cache.
   * Stores the exact row data as returned by BI Publisher in raw_data JSONB.
   */
  public async saveRawWorksheetRows(certificationId: string, rows: any[]): Promise<void> {
    const cleanCertId = String(certificationId || '').trim();
    if (!cleanCertId || !Array.isArray(rows)) return;
    const host = this.getHost();

    // 1. Update file cache for offline resiliency
    try {
      this.writeWorksheetCache(cleanCertId, rows);
    } catch (cacheErr: any) {
      console.warn('[AccessCertDb] Failed to update worksheet cache:', cacheErr.message);
    }

    if (rows.length === 0) return;

    // 2. Persist into PostgreSQL
    try {
      // Clear previous rows for this certification in this environment to prevent duplicates
      await query(
        `DELETE FROM oracle_raw_certifier_worksheets WHERE environment_host = $1 AND certification_id = $2`,
        [host, cleanCertId]
      );

      const certName = rows[0]?.certificationName || rows[0]?.name || `Certification ${cleanCertId}`;

      // Batch insert in chunks of 50
      const chunkSize = 50;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        for (const r of chunk) {
          const userName = r.userName || r.ownerName || null;
          const roleName = r.roleName || r.jobRoleName || null;
          const roleCode = r.roleCode || null;
          const certifierName = r.certifierName || r.certifiedManager || null;
          const certifiedManager = r.certifiedManager || null;
          const directManager = r.directManager || null;
          const bu = r.businessUnit || r.userBusinessUnit || null;
          const dept = r.department || null;
          const action = r.action || 'Pending';

          const sql = `
            INSERT INTO oracle_raw_certifier_worksheets (
              environment_host,
              certification_id,
              certification_name,
              user_name,
              role_name,
              role_code,
              certifier_name,
              certified_manager,
              direct_manager,
              business_unit,
              department,
              action,
              raw_data,
              last_synced_at,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW(), NOW())
          `;

          await query(sql, [
            host,
            cleanCertId,
            r.certificationName || certName,
            userName,
            roleName,
            roleCode,
            certifierName,
            certifiedManager,
            directManager,
            bu,
            dept,
            action,
            JSON.stringify(r)
          ]);
        }
      }
      console.log(`[AccessCertDb] Successfully persisted ${rows.length} worksheet rows for Cert ID "${cleanCertId}" to PostgreSQL`);
    } catch (dbErr: any) {
      console.warn(`[AccessCertDb] Database unavailable or error during saveRawWorksheetRows for ${cleanCertId}:`, dbErr.message);
    }
  }

  /**
   * Retrieves worksheet rows for a certification from database, with fallback to disk cache.
   */
  public async getWorksheetRows(certificationId: string): Promise<any[] | null> {
    const cleanCertId = String(certificationId || '').trim();
    if (!cleanCertId) return null;
    const host = this.getHost();

    try {
      const res = await query<RawCertifierWorksheetRecord>(
        `SELECT * FROM oracle_raw_certifier_worksheets 
         WHERE (environment_host = $1 OR environment_host = 'eiiv-dev14.fa.us6.oraclecloud.com') AND certification_id = $2 
         ORDER BY (CASE WHEN environment_host = $1 THEN 0 ELSE 1 END), id ASC`,
        [host, cleanCertId]
      );

      if (res.rows && res.rows.length > 0) {
        return res.rows.map(r => {
          const raw = r.raw_data || {};
          return {
            ...raw,
            id: Number(cleanCertId) || cleanCertId,
            certificationId: Number(cleanCertId) || cleanCertId,
            certificationName: r.certification_name || raw.certificationName,
            name: r.certification_name || raw.name,
            userName: r.user_name || raw.userName,
            ownerName: r.user_name || raw.ownerName,
            roleName: r.role_name || raw.roleName,
            jobRoleName: r.role_name || raw.jobRoleName,
            roleCode: r.role_code || raw.roleCode,
            certifierName: r.certifier_name || raw.certifierName,
            certifiedManager: r.certified_manager || raw.certifiedManager,
            directManager: r.direct_manager || raw.directManager,
            businessUnit: r.business_unit || raw.businessUnit,
            department: r.department || raw.department,
            action: r.action || raw.action || 'Pending'
          };
        });
      }
    } catch (err: any) {
      console.warn(`[AccessCertDb] DB read error for worksheet ${cleanCertId} (falling back to disk cache):`, err.message);
    }

    // Fallback: Read from file cache
    return this.readWorksheetCache(cleanCertId);
  }

  /**
   * Searches all certifications across the database or cached records.
   */
  public async searchCertifications(searchTerm: string): Promise<any[]> {
    const list = await this.getCertifications();
    if (!list) return [];
    if (!searchTerm || !searchTerm.trim()) return list;

    const term = searchTerm.toLowerCase().trim();
    return list.filter((item: any) => {
      const id = String(item.certificationId || item.id || '').toLowerCase();
      const name = String(item.certificationName || item.name || '').toLowerCase();
      const status = String(item.status || '').toLowerCase();
      const type = String(item.type || '').toLowerCase();
      const owner = String(item.ownerName || item.managerName || item.certifierName || '').toLowerCase();
      return id.includes(term) || name.includes(term) || status.includes(term) || type.includes(term) || owner.includes(term);
    });
  }

  /**
   * Searches worksheet rows across a certification or all certifications.
   */
  public async searchWorksheet(searchTerm: string, certificationId?: string): Promise<any[]> {
    const certId = certificationId ? String(certificationId).trim() : '1';
    const rows = await this.getWorksheetRows(certId);
    if (!rows) return [];
    if (!searchTerm || !searchTerm.trim()) return rows;

    const term = searchTerm.toLowerCase().trim();
    return rows.filter((r: any) => {
      const u = String(r.userName || r.ownerName || '').toLowerCase();
      const role = String(r.roleName || r.jobRoleName || '').toLowerCase();
      const mgr = String(r.directManager || r.certifiedManager || r.managerName || '').toLowerCase();
      const bu = String(r.businessUnit || r.department || '').toLowerCase();
      const action = String(r.action || '').toLowerCase();
      return u.includes(term) || role.includes(term) || mgr.includes(term) || bu.includes(term) || action.includes(term);
    });
  }

  // =========================================================================
  // File Cache Helpers (Offline-Resilience & Shift-To-Database Support)
  // =========================================================================

  private writeCertificationsCache(certifications: any[]): void {
    fs.writeFileSync(CERTIFICATIONS_CACHE_FILE, JSON.stringify(certifications, null, 2), 'utf-8');
  }

  private readCertificationsCache(): any[] | null {
    if (fs.existsSync(CERTIFICATIONS_CACHE_FILE)) {
      try {
        const raw = fs.readFileSync(CERTIFICATIONS_CACHE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (_) {}
    }
    return null;
  }

  private writeWorksheetCache(certificationId: string, rows: any[]): void {
    let allWorksheets: Record<string, any[]> = {};
    if (fs.existsSync(WORKSHEETS_CACHE_FILE)) {
      try {
        allWorksheets = JSON.parse(fs.readFileSync(WORKSHEETS_CACHE_FILE, 'utf-8'));
      } catch (_) {
        allWorksheets = {};
      }
    }
    allWorksheets[certificationId] = rows;
    fs.writeFileSync(WORKSHEETS_CACHE_FILE, JSON.stringify(allWorksheets, null, 2), 'utf-8');
  }

  private readWorksheetCache(certificationId: string): any[] | null {
    if (fs.existsSync(WORKSHEETS_CACHE_FILE)) {
      try {
        const raw = fs.readFileSync(WORKSHEETS_CACHE_FILE, 'utf-8');
        const allWorksheets = JSON.parse(raw);
        if (allWorksheets && Array.isArray(allWorksheets[certificationId])) {
          return allWorksheets[certificationId];
        }
      } catch (_) {}
    }
    return null;
  }
}

export const accessCertRawDbService = new AccessCertRawDbService();
