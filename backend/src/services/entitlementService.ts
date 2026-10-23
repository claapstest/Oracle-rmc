import { query as dbQuery } from '../db.js';
import { privilegeRoleCatalogService } from './privilegeRoleCatalogService.js';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL
const usersByPrivCache = new Map<string, CacheEntry<any>>();
const privsByUserCache = new Map<string, CacheEntry<any>>();

export interface UserPrivilegeGrant {
  username: string;
  displayName: string | null;
  email: string | null;
  isActive: boolean;
  grantedViaRoleName: string;
  grantedViaRoleCode: string;
  privilegeName?: string;
  privilegeCode?: string;
}

export interface UserEffectivePrivilege {
  privilegeCode: string;
  privilegeName: string;
  description: string | null;
  grantedViaRoleName: string;
  grantedViaRoleCode: string;
}

export class EntitlementService {
  /**
   * Direction A: Privilege -> Users
   * Finds all users who hold a given privilege (directly or inherited via parent roles).
   */
  public async getUsersByPrivilege(
    privilegeQuery: string,
    page: number = 1,
    pageSize: number = 2000
  ): Promise<{
    success: boolean;
    privilege: string;
    total: number;
    page: number;
    pageSize: number;
    durationMs: number;
    users: UserPrivilegeGrant[];
  }> {
    const cleanPriv = (privilegeQuery || '').trim();
    if (!cleanPriv) {
      return {
        success: true,
        privilege: '',
        total: 0,
        page,
        pageSize,
        durationMs: 0,
        users: []
      };
    }

    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(1, pageSize), 5000);
    const offset = (safePage - 1) * safePageSize;
    const cacheKey = `priv:${cleanPriv.toLowerCase()}:${safePage}:${safePageSize}`;

    const cached = usersByPrivCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    const t0 = Date.now();

    // 1. Get candidate roles from authoritative in-memory catalog
    const catalogMatch = privilegeRoleCatalogService.getRolesByPrivilege(cleanPriv);
    let roleNames: string[] = [];
    let roleCodes: string[] = [];

    if (catalogMatch.success && catalogMatch.roles.length > 0) {
      roleNames = catalogMatch.roles.map((r) => r.roleName.toLowerCase());
      roleCodes = catalogMatch.roles.map((r) => r.roleCode.toLowerCase());
    }

    // 2. Query matching users in PostgreSQL
    // If catalog didn't have the privilege, fallback to search in oracle_raw_role_hierarchy
    let sql: string;
    let params: any[];

    if (roleNames.length > 0) {
      sql = `
        WITH matched_roles AS (
          SELECT UNNEST($1::text[]) as r_name, UNNEST($2::text[]) as r_code
        ),
        all_parent_roles AS (
          SELECT r_name, r_code FROM matched_roles
          UNION
          SELECT LOWER(h.parent_role_name) as r_name, '' as r_code
          FROM oracle_raw_role_hierarchy h
          WHERE LOWER(h.child_role_name) = ANY($1::text[])
        ),
        matched_users AS (
          SELECT DISTINCT
            u.username,
            u.display_name,
            u.email,
            u.is_active,
            r->>'roleName' as granted_role_name,
            r->>'roleCode' as granted_role_code
          FROM oracle_raw_users u,
               jsonb_array_elements(COALESCE(u.raw_user->'assignedRoles', '[]'::jsonb)) as r
          JOIN all_parent_roles apr
            ON apr.r_name = LOWER(r->>'roleName')
            OR (apr.r_code <> '' AND apr.r_code = LOWER(COALESCE(r->>'roleCode', '')))
        )
        SELECT 
          username,
          display_name,
          email,
          is_active,
          granted_role_name,
          granted_role_code,
          count(*) OVER() as full_count
        FROM matched_users
        ORDER BY username ASC
        LIMIT $3 OFFSET $4;
      `;
      params = [roleNames, roleCodes, safePageSize, offset];
    } else {
      // Direct SQL fallback via role hierarchy table
      sql = `
        WITH matching_roles AS (
          SELECT DISTINCT 
            LOWER(child_role_name) as r_name, 
            LOWER(COALESCE(role_code, '')) as r_code
          FROM oracle_raw_role_hierarchy,
               jsonb_array_elements(COALESCE(raw_record->'privileges', '[]'::jsonb)) as priv
          WHERE LOWER(priv->>'code') = LOWER($1) 
             OR LOWER(priv->>'name') = LOWER($1)
             OR LOWER(priv->>'code') = LOWER(REPLACE($1, ' ', '_'))
        ),
        all_target_roles AS (
          SELECT r_name, r_code FROM matching_roles
          UNION
          SELECT LOWER(h.parent_role_name) as r_name, '' as r_code
          FROM oracle_raw_role_hierarchy h
          JOIN matching_roles mr ON LOWER(h.child_role_name) = mr.r_name
        ),
        matched_users AS (
          SELECT DISTINCT
            u.username,
            u.display_name,
            u.email,
            u.is_active,
            r->>'roleName' as granted_role_name,
            r->>'roleCode' as granted_role_code
          FROM oracle_raw_users u,
               jsonb_array_elements(COALESCE(u.raw_user->'assignedRoles', '[]'::jsonb)) as r
          JOIN all_target_roles atr
            ON atr.r_name = LOWER(r->>'roleName')
            OR (atr.r_code <> '' AND atr.r_code = LOWER(COALESCE(r->>'roleCode', '')))
        )
        SELECT 
          username,
          display_name,
          email,
          is_active,
          granted_role_name,
          granted_role_code,
          count(*) OVER() as full_count
        FROM matched_users
        ORDER BY username ASC
        LIMIT $2 OFFSET $3;
      `;
      params = [cleanPriv, safePageSize, offset];
    }

    const res = await dbQuery(sql, params);
    const durationMs = Date.now() - t0;
    const total = res.rows.length > 0 ? parseInt(res.rows[0].full_count, 10) : 0;

    const users: UserPrivilegeGrant[] = res.rows.map((r: any) => ({
      username: r.username,
      displayName: r.display_name,
      email: r.email,
      isActive: Boolean(r.is_active),
      grantedViaRoleName: r.granted_role_name,
      grantedViaRoleCode: r.granted_role_code,
      privilegeName: catalogMatch.privilegeName || cleanPriv,
      privilegeCode: catalogMatch.privilegeCode || cleanPriv
    }));

    const result = {
      success: true,
      privilege: cleanPriv,
      total,
      page: safePage,
      pageSize: safePageSize,
      durationMs,
      users
    };

    // Cache result if valid
    if (usersByPrivCache.size > 500) usersByPrivCache.clear();
    usersByPrivCache.set(cacheKey, { data: result, timestamp: Date.now() });

    return result;
  }

  /**
   * Direction B: User -> Privileges
   * Finds all functional privileges effective for a given user (direct + inherited duty roles).
   */
  public async getPrivilegesByUser(
    usernameQuery: string,
    page: number = 1,
    pageSize: number = 2000
  ): Promise<{
    success: boolean;
    username: string;
    displayName: string | null;
    total: number;
    page: number;
    pageSize: number;
    durationMs: number;
    privileges: UserEffectivePrivilege[];
  }> {
    const cleanUser = (usernameQuery || '').trim();
    if (!cleanUser) {
      return {
        success: true,
        username: '',
        displayName: null,
        total: 0,
        page,
        pageSize,
        durationMs: 0,
        privileges: []
      };
    }

    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(1, pageSize), 5000);
    const offset = (safePage - 1) * safePageSize;
    const cacheKey = `user:${cleanUser.toLowerCase()}:${safePage}:${safePageSize}`;

    const cached = privsByUserCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    const t0 = Date.now();

    // Fast indexed query:
    // 1. Get user direct roles from oracle_raw_users (1 row lookup)
    // 2. Expand related child duty roles in oracle_raw_role_hierarchy
    // 3. Unpack privileges from only matching hierarchy nodes
    const sql = `
      WITH user_info AS (
        SELECT 
          u.username,
          u.display_name,
          COALESCE(u.raw_user->'assignedRoles', '[]'::jsonb) as assigned_roles
        FROM oracle_raw_users u
        WHERE LOWER(u.username) = LOWER($1)
           OR LOWER(u.email) = LOWER($1)
        LIMIT 1
      ),
      user_direct_roles AS (
        SELECT DISTINCT 
          LOWER(r->>'roleName') as r_name, 
          LOWER(COALESCE(r->>'roleCode', '')) as r_code
        FROM user_info ui,
             jsonb_array_elements(ui.assigned_roles) as r
      ),
      all_related_roles AS (
        SELECT r_name, r_code FROM user_direct_roles
        UNION
        SELECT LOWER(h.child_role_name) as r_name, LOWER(COALESCE(h.role_code, '')) as r_code
        FROM oracle_raw_role_hierarchy h
        JOIN user_direct_roles udr ON LOWER(h.parent_role_name) = udr.r_name
      ),
      matching_hierarchy AS (
        SELECT h.child_role_name, h.role_code, h.raw_record
        FROM oracle_raw_role_hierarchy h
        WHERE LOWER(h.child_role_name) IN (SELECT r_name FROM all_related_roles)
           OR (h.role_code IS NOT NULL AND LOWER(h.role_code) IN (SELECT r_code FROM all_related_roles WHERE r_code <> ''))
      ),
      all_privileges AS (
        SELECT DISTINCT
          priv->>'code' as privilege_code,
          priv->>'name' as privilege_name,
          priv->>'description' as privilege_description,
          mh.child_role_name as granted_via_role_name,
          mh.role_code as granted_via_role_code
        FROM matching_hierarchy mh,
             jsonb_array_elements(COALESCE(mh.raw_record->'privileges', '[]'::jsonb)) as priv
        WHERE priv->>'code' IS NOT NULL
      )
      SELECT 
        (SELECT display_name FROM user_info) as user_display_name,
        privilege_code,
        privilege_name,
        privilege_description,
        granted_via_role_name,
        granted_via_role_code,
        count(*) OVER() as full_count
      FROM all_privileges
      ORDER BY privilege_name ASC
      LIMIT $2 OFFSET $3;
    `;

    const res = await dbQuery(sql, [cleanUser, safePageSize, offset]);
    const durationMs = Date.now() - t0;
    const total = res.rows.length > 0 ? parseInt(res.rows[0].full_count, 10) : 0;
    const userDisplayName = res.rows.length > 0 ? res.rows[0].user_display_name : null;

    const privileges: UserEffectivePrivilege[] = res.rows.map((r: any) => ({
      privilegeCode: r.privilege_code,
      privilegeName: r.privilege_name,
      description: r.privilege_description,
      grantedViaRoleName: r.granted_via_role_name,
      grantedViaRoleCode: r.granted_via_role_code
    }));

    const result = {
      success: true,
      username: cleanUser,
      displayName: userDisplayName,
      total,
      page: safePage,
      pageSize: safePageSize,
      durationMs,
      privileges
    };

    if (privsByUserCache.size > 500) privsByUserCache.clear();
    privsByUserCache.set(cacheKey, { data: result, timestamp: Date.now() });

    return result;
  }
}

export const entitlementService = new EntitlementService();
