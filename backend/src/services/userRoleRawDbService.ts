import fs from 'fs';
import path from 'path';
import { query } from '../db.js';
import { config } from '../config.js';

export interface RawRoleRecord {
  environment_host: string;
  role_code: string;
  role_name: string | null;
  category: string | null;
  is_custom: boolean;
  member_count: number;
  raw_role: any;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface RawUserRecord {
  environment_host: string;
  username: string;
  display_name: string | null;
  email: string | null;
  is_active: boolean;
  user_category: string | null;
  raw_user: any;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
}

export class UserRoleRawDbService {
  /**
   * Normalizes the host string for environment isolation (e.g. eiiv-dev14.fa.us6.oraclecloud.com)
   */
  public getHost(): string {
    const rawUrl = (process.env.FUSION_HOST || config.oracle.baseUrl || 'mock.fusion.oracle.com').trim().toLowerCase();
    try {
      if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
        return new URL(rawUrl).host;
      }
    } catch (_) {}
    return rawUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'default_env';
  }

  // =============================================================
  // Roles Operations (oracle_raw_roles)
  // =============================================================

  /**
   * Saves a single raw role JSON into oracle_raw_roles
   */
  public async saveRawRole(role: any): Promise<void> {
    const host = this.getHost();
    const roleCode = String(role.roleCode || role.code || role.id || '').trim();
    if (!roleCode) return;

    const roleName = role.displayName || role.roleName || role.name || roleCode;
    const category = role.category || null;
    const isCustom = Boolean(role.isCustom || roleCode.startsWith('CUSTOM_') || roleCode.startsWith('CLAAPS_'));
    const memberCount = typeof role.memberCount === 'number' ? role.memberCount : (Array.isArray(role.members) ? role.members.length : 0);

    const sql = `
      INSERT INTO oracle_raw_roles (
        environment_host,
        role_code,
        role_name,
        category,
        is_custom,
        member_count,
        raw_role,
        last_synced_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (environment_host, role_code) DO UPDATE SET
        role_name = EXCLUDED.role_name,
        category = EXCLUDED.category,
        is_custom = EXCLUDED.is_custom,
        member_count = EXCLUDED.member_count,
        raw_role = EXCLUDED.raw_role,
        last_synced_at = NOW(),
        updated_at = NOW();
    `;

    await query(sql, [host, roleCode, roleName, category, isCustom, memberCount, JSON.stringify(role)]);
  }

  /**
   * Batch upserts multiple raw roles in chunks for maximum performance
   */
  public async saveRawRolesBatch(roles: any[]): Promise<number> {
    if (!Array.isArray(roles) || roles.length === 0) return 0;
    const host = this.getHost();
    const chunkSize = 200;
    let savedCount = 0;

    for (let i = 0; i < roles.length; i += chunkSize) {
      const chunk = roles.slice(i, i + chunkSize);
      const values: any[] = [];
      const valueClauses: string[] = [];

      chunk.forEach((role, idx) => {
        const roleCode = String(role.roleCode || role.code || role.id || '').trim();
        if (!roleCode) return;

        const roleName = role.displayName || role.roleName || role.name || roleCode;
        const category = role.category || null;
        const isCustom = Boolean(role.isCustom || roleCode.startsWith('CUSTOM_') || roleCode.startsWith('CLAAPS_'));
        const memberCount = typeof role.memberCount === 'number' ? role.memberCount : (Array.isArray(role.members) ? role.members.length : 0);

        const baseIndex = values.length + 1;
        valueClauses.push(
          `($${baseIndex}, $${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, NOW(), NOW())`
        );
        values.push(host, roleCode, roleName, category, isCustom, memberCount, JSON.stringify(role));
      });

      if (valueClauses.length === 0) continue;

      const sql = `
        INSERT INTO oracle_raw_roles (
          environment_host,
          role_code,
          role_name,
          category,
          is_custom,
          member_count,
          raw_role,
          last_synced_at,
          updated_at
        ) VALUES ${valueClauses.join(', ')}
        ON CONFLICT (environment_host, role_code) DO UPDATE SET
          role_name = EXCLUDED.role_name,
          category = EXCLUDED.category,
          is_custom = EXCLUDED.is_custom,
          member_count = EXCLUDED.member_count,
          raw_role = EXCLUDED.raw_role,
          last_synced_at = NOW(),
          updated_at = NOW();
      `;

      await query(sql, values);
      savedCount += chunk.length;
    }

    return savedCount;
  }

  /**
   * Retrieves raw roles from oracle_raw_roles with optional category and search filters
   */
  public async getRawRoles(options: {
    category?: string;
    filterText?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ roles: any[]; totalCount: number }> {
    const host = this.getHost();
    const conditions: string[] = ['environment_host = $1'];
    const params: any[] = [host];

    if (options.category && options.category.toUpperCase() !== 'ALL') {
      params.push(options.category);
      conditions.push(`category = $${params.length}`);
    }

    if (options.filterText) {
      params.push(`%${options.filterText}%`);
      conditions.push(`(role_code ILIKE $${params.length} OR role_name ILIKE $${params.length})`);
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await query<{ count: string }>(
      `SELECT count(*) as count FROM oracle_raw_roles WHERE ${whereClause}`,
      params
    );
    const totalCount = parseInt(countRes.rows[0]?.count || '0', 10);

    let querySql = `SELECT raw_role FROM oracle_raw_roles WHERE ${whereClause} ORDER BY role_name ASC`;
    if (options.limit) {
      params.push(options.limit);
      querySql += ` LIMIT $${params.length}`;
    }
    if (options.offset) {
      params.push(options.offset);
      querySql += ` OFFSET $${params.length}`;
    }

    const dataRes = await query<{ raw_role: any }>(querySql, params);
    const roles = dataRes.rows.map(r => r.raw_role);

    return { roles, totalCount };
  }

  /**
   * Loads and seeds authoritative roles from oracle_roles_cache.json into oracle_raw_roles if table is empty
   */
  public async seedRolesFromCacheIfEmpty(): Promise<number> {
    try {
      const host = this.getHost();
      const existing = await query<{ count: string }>(
        `SELECT count(*) as count FROM oracle_raw_roles WHERE environment_host = $1`,
        [host]
      );
      const count = parseInt(existing.rows[0]?.count || '0', 10);
      if (count > 0) {
        return count; // Already populated
      }

      const cacheFile = path.resolve(process.cwd(), 'oracle_roles_cache.json');
      if (fs.existsSync(cacheFile)) {
        const raw = fs.readFileSync(cacheFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.roles) && parsed.roles.length > 0) {
          console.log(`[UserRoleRawDbService] Seeding ${parsed.roles.length} roles from cache into oracle_raw_roles...`);
          const saved = await this.saveRawRolesBatch(parsed.roles);
          console.log(`[UserRoleRawDbService] Successfully seeded ${saved} raw roles in PostgreSQL.`);
          return saved;
        }
      }
    } catch (err: any) {
      console.warn('[UserRoleRawDbService] Seeding roles failed:', err.message);
    }
    return 0;
  }

  // =============================================================
  // Users Operations (oracle_raw_users)
  // =============================================================

  /**
   * Saves a single raw user JSON into oracle_raw_users
   */
  public async saveRawUser(user: any): Promise<void> {
    const host = this.getHost();
    const username = String(user.userName || user.username || user.id || '').trim();
    if (!username) return;

    const displayName = user.displayName || `${user.name?.givenName || user.firstName || ''} ${user.name?.familyName || user.lastName || ''}`.trim() || username;
    const email = user.email || (Array.isArray(user.emails) ? user.emails[0]?.value : null);
    const isActive = typeof user.active === 'boolean' ? user.active : true;
    const userCategory = user.userCategory || null;

    const sql = `
      INSERT INTO oracle_raw_users (
        environment_host,
        username,
        display_name,
        email,
        is_active,
        user_category,
        raw_user,
        last_synced_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (environment_host, username) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        email = EXCLUDED.email,
        is_active = EXCLUDED.is_active,
        user_category = EXCLUDED.user_category,
        raw_user = EXCLUDED.raw_user,
        last_synced_at = NOW(),
        updated_at = NOW();
    `;

    await query(sql, [host, username, displayName, email, isActive, userCategory, JSON.stringify(user)]);
  }

  /**
   * Batch upserts multiple raw users into oracle_raw_users
   */
  public async saveRawUsersBatch(users: any[]): Promise<number> {
    if (!Array.isArray(users) || users.length === 0) return 0;
    const host = this.getHost();
    const chunkSize = 100;
    let savedCount = 0;

    for (let i = 0; i < users.length; i += chunkSize) {
      const chunk = users.slice(i, i + chunkSize);
      const values: any[] = [];
      const valueClauses: string[] = [];

      chunk.forEach((user) => {
        const username = String(user.userName || user.username || user.id || '').trim();
        if (!username) return;

        const displayName = user.displayName || `${user.name?.givenName || user.firstName || ''} ${user.name?.familyName || user.lastName || ''}`.trim() || username;
        const email = user.email || (Array.isArray(user.emails) ? user.emails[0]?.value : null);
        const isActive = typeof user.active === 'boolean' ? user.active : true;
        const userCategory = user.userCategory || null;

        const baseIndex = values.length + 1;
        valueClauses.push(
          `($${baseIndex}, $${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, NOW(), NOW())`
        );
        values.push(host, username, displayName, email, isActive, userCategory, JSON.stringify(user));
      });

      if (valueClauses.length === 0) continue;

      const sql = `
        INSERT INTO oracle_raw_users (
          environment_host,
          username,
          display_name,
          email,
          is_active,
          user_category,
          raw_user,
          last_synced_at,
          updated_at
        ) VALUES ${valueClauses.join(', ')}
        ON CONFLICT (environment_host, username) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          email = EXCLUDED.email,
          is_active = EXCLUDED.is_active,
          user_category = EXCLUDED.user_category,
          raw_user = EXCLUDED.raw_user,
          last_synced_at = NOW(),
          updated_at = NOW();
      `;

      await query(sql, values);
      savedCount += chunk.length;
    }

    return savedCount;
  }

  /**
   * Retrieves raw users from oracle_raw_users with optional search and pagination
   */
  public async getRawUsers(options: {
    filterText?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ users: any[]; totalCount: number }> {
    const host = this.getHost();
    const conditions: string[] = ['environment_host = $1'];
    const params: any[] = [host];

    if (options.filterText) {
      params.push(`%${options.filterText}%`);
      conditions.push(`(username ILIKE $${params.length} OR display_name ILIKE $${params.length} OR email ILIKE $${params.length})`);
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await query<{ count: string }>(
      `SELECT count(*) as count FROM oracle_raw_users WHERE ${whereClause}`,
      params
    );
    const totalCount = parseInt(countRes.rows[0]?.count || '0', 10);

    let querySql = `SELECT raw_user FROM oracle_raw_users WHERE ${whereClause} ORDER BY username ASC`;
    if (options.limit) {
      params.push(options.limit);
      querySql += ` LIMIT $${params.length}`;
    }
    if (options.offset) {
      params.push(options.offset);
      querySql += ` OFFSET $${params.length}`;
    }

    const dataRes = await query<{ raw_user: any }>(querySql, params);
    const users = dataRes.rows.map(r => r.raw_user);

    return { users, totalCount };
  }

  /**
   * Returns total count of users currently in oracle_raw_users
   */
  public async getRawUserCount(): Promise<number> {
    const host = this.getHost();
    const res = await query<{ count: string }>(
      `SELECT count(*) as count FROM oracle_raw_users WHERE environment_host = $1`,
      [host]
    );
    return parseInt(res.rows[0]?.count || '0', 10);
  }

  /**
   * Returns total count of roles currently in oracle_raw_roles
   */
  public async getRawRoleCount(): Promise<number> {
    const host = this.getHost();
    const res = await query<{ count: string }>(
      `SELECT count(*) as count FROM oracle_raw_roles WHERE environment_host = $1`,
      [host]
    );
    return parseInt(res.rows[0]?.count || '0', 10);
  }
}

export const userRoleRawDbService = new UserRoleRawDbService();
