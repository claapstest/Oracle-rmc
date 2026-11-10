import { query as dbQuery, pool } from '../db.js';
import { auditService } from './auditService.js';
import { config } from '../config.js';

export interface EntraIdentityClaims {
  email: string;
  subject: string; // oid (Object ID) or sub
  tenantId: string;
  displayName?: string;
  roles?: string[];
  groups?: string[];
}

export const VEYRA_ROLE_RANKS: Record<string, number> = {
  SITE_ADMIN: 40,
  AUDIT_MANAGER: 30,
  AUDIT_SUPERVISOR: 20,
  AUDIT_USER: 10,
};

export interface EntraRoleResolution {
  roleCode: string | null;
  matchedClaim?: string;
  source: 'CLAIM_MAPPING' | 'DIRECT_ROLE' | 'CONVENTION' | 'DEFAULT_FALLBACK' | 'UNMAPPED';
}

export interface EntraIdentityMappingRecord {
  id: string;
  userId: string;
  provider: string;
  tenantId: string;
  externalUserId: string;
  externalEmail: string;
  externalDisplayName: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastAuthenticatedAt: Date;
}

export interface EntraResolutionResult {
  success: boolean;
  code?: string;
  message?: string;
  status?: string;
  user?: {
    id: string;
    email: string;
    displayName: string;
    status: string;
    isLocalUser: boolean;
    lastLoginAt: Date | null;
  };
  mapping?: EntraIdentityMappingRecord;
  isNewProvision?: boolean;
}

export class EntraIdentityService {
  /**
   * Resolves the target Veyra role from incoming Entra token claims (roles and groups)
   * according to configured mappings, standard conventions, and role hierarchy precedence.
   */
  public resolveEntraRole(claims: EntraIdentityClaims): EntraRoleResolution {
    const rawRoles = claims.roles || [];
    const rawGroups = claims.groups || [];
    const candidates = [...rawRoles, ...rawGroups].map(c => String(c).trim()).filter(Boolean);

    const configuredMapping = config.entra.roleMapping || {};
    // Normalize configured mapping keys for case-insensitive lookup
    const normalizedConfigMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(configuredMapping)) {
      normalizedConfigMap[k.toLowerCase()] = v.toUpperCase();
    }

    interface Match {
      roleCode: string;
      matchedClaim: string;
      rank: number;
      source: 'CLAIM_MAPPING' | 'DIRECT_ROLE' | 'CONVENTION';
    }

    const matches: Match[] = [];

    for (const claim of candidates) {
      const lowerClaim = claim.toLowerCase();

      // 1. Configured mapping match (highest priority)
      if (normalizedConfigMap[lowerClaim]) {
        const target = normalizedConfigMap[lowerClaim];
        if (VEYRA_ROLE_RANKS[target]) {
          matches.push({
            roleCode: target,
            matchedClaim: claim,
            rank: VEYRA_ROLE_RANKS[target],
            source: 'CLAIM_MAPPING'
          });
          continue;
        }
      }

      // 2. Direct role code match (case-insensitive)
      const upperClaim = claim.toUpperCase();
      if (VEYRA_ROLE_RANKS[upperClaim]) {
        matches.push({
          roleCode: upperClaim,
          matchedClaim: claim,
          rank: VEYRA_ROLE_RANKS[upperClaim],
          source: 'DIRECT_ROLE'
        });
        continue;
      }

      // 3. Standard naming conventions:
      if (lowerClaim === 'veyra.siteadmin' || lowerClaim === 'veyra.admin' || lowerClaim === 'siteadmin' || lowerClaim === 'site_admin') {
        matches.push({ roleCode: 'SITE_ADMIN', matchedClaim: claim, rank: VEYRA_ROLE_RANKS.SITE_ADMIN, source: 'CONVENTION' });
      } else if (lowerClaim === 'veyra.auditmanager' || lowerClaim === 'veyra.manager' || lowerClaim === 'auditmanager' || lowerClaim === 'audit_manager') {
        matches.push({ roleCode: 'AUDIT_MANAGER', matchedClaim: claim, rank: VEYRA_ROLE_RANKS.AUDIT_MANAGER, source: 'CONVENTION' });
      } else if (lowerClaim === 'veyra.auditsupervisor' || lowerClaim === 'veyra.supervisor' || lowerClaim === 'auditsupervisor' || lowerClaim === 'audit_supervisor') {
        matches.push({ roleCode: 'AUDIT_SUPERVISOR', matchedClaim: claim, rank: VEYRA_ROLE_RANKS.AUDIT_SUPERVISOR, source: 'CONVENTION' });
      } else if (lowerClaim === 'veyra.audituser' || lowerClaim === 'veyra.user' || lowerClaim === 'audituser' || lowerClaim === 'audit_user') {
        matches.push({ roleCode: 'AUDIT_USER', matchedClaim: claim, rank: VEYRA_ROLE_RANKS.AUDIT_USER, source: 'CONVENTION' });
      }
    }

    // Sort by rank descending so the highest-privilege role wins
    if (matches.length > 0) {
      matches.sort((a, b) => b.rank - a.rank);
      const best = matches[0];
      return {
        roleCode: best.roleCode,
        matchedClaim: best.matchedClaim,
        source: best.source
      };
    }

    // No claim matches found
    if (config.entra.requireRoleMapping) {
      return {
        roleCode: null,
        source: 'UNMAPPED'
      };
    }

    const fallbackRole = (config.entra.defaultRole || 'AUDIT_USER').toUpperCase();
    return {
      roleCode: VEYRA_ROLE_RANKS[fallbackRole] ? fallbackRole : 'AUDIT_USER',
      source: 'DEFAULT_FALLBACK'
    };
  }

  /**
   * Synchronizes a user's assigned role in veyra_user_role to match the target role.
   * If the role changed, updates veyra_user_role atomically and records a ROLE_ASSIGNED audit event.
   */
  public async syncUserRole(
    userId: string,
    targetRoleCode: string,
    meta?: { matchedClaim?: string; source?: string; ipAddress?: string; userAgent?: string }
  ): Promise<{ changed: boolean; previousRole: string | null; currentRole: string }> {
    const currentRoleRes = await dbQuery<{ role_code: string; role_id: string }>(
      `SELECT r.role_code, r.id as role_id
       FROM veyra_role r
       JOIN veyra_user_role ur ON ur.role_id = r.id
       WHERE ur.user_id = $1 AND r.status = 'ACTIVE'`,
      [userId]
    );

    const previousRole = currentRoleRes.rows[0]?.role_code || null;
    if (previousRole === targetRoleCode) {
      return { changed: false, previousRole, currentRole: targetRoleCode };
    }

    const targetRoleRes = await dbQuery<{ id: string }>(
      `SELECT id FROM veyra_role WHERE role_code = $1 AND status = 'ACTIVE'`,
      [targetRoleCode]
    );

    if (targetRoleRes.rows.length === 0) {
      console.warn(`[EntraIdentityService] Target role ${targetRoleCode} not found in veyra_role.`);
      return { changed: false, previousRole, currentRole: previousRole || targetRoleCode };
    }

    const newRoleId = targetRoleRes.rows[0].id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM veyra_user_role WHERE user_id = $1`, [userId]);
      await client.query(
        `INSERT INTO veyra_user_role (user_id, role_id, created_by)
         VALUES ($1, $2, 'ENTRA_SYNC')`,
        [userId, newRoleId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await auditService.recordAuditEvent({
      userId,
      eventType: 'ROLE_ASSIGNED',
      ipAddress: meta?.ipAddress || null,
      userAgent: meta?.userAgent || null,
      targetType: 'ROLE',
      targetId: newRoleId,
      details: {
        provider: 'ENTRA',
        previousRole,
        newRole: targetRoleCode,
        matchedClaim: meta?.matchedClaim || null,
        source: meta?.source || 'CLAIM_MAPPING'
      }
    }).catch(() => {});

    return { changed: true, previousRole, currentRole: targetRoleCode };
  }

  /**
   * Validate that incoming token's tenant matches the configured enterprise tenant.
   */
  public isTenantAllowed(incomingTenantId?: string): boolean {
    const configuredTenant = (config.entra.tenantId || '').trim().toLowerCase();
    if (!configuredTenant) {
      // If not explicitly constrained in development, permit incoming tenant
      return true;
    }
    const incoming = (incomingTenantId || '').trim().toLowerCase();
    return incoming === configuredTenant;
  }

  /**
   * Look up existing external identity mapping by immutable composite key (provider, tenantId, externalUserId).
   */
  public async findMapping(tenantId: string, externalUserId: string): Promise<EntraIdentityMappingRecord | null> {
    const res = await dbQuery<any>(
      `SELECT id, user_id, provider, tenant_id, external_user_id, external_email, 
              external_display_name, created_at, updated_at, last_authenticated_at
       FROM veyra_user_identity_mapping
       WHERE provider = 'ENTRA' AND tenant_id = $1 AND external_user_id = $2`,
      [tenantId, externalUserId]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      tenantId: row.tenant_id,
      externalUserId: row.external_user_id,
      externalEmail: row.external_email,
      externalDisplayName: row.external_display_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAuthenticatedAt: row.last_authenticated_at
    };
  }

  /**
   * Resolve an authenticated Entra identity into a controlled VEYRA principal.
   * Enforces:
   * 1. Tenant match validation.
   * 2. Immutable identity resolution by (tenantId, externalUserId/oid).
   * 3. Disabled/suspended account rejection (403 USER_DISABLED).
   * 4. Pre-provisioned account linking.
   * 5. Just-in-Time (JIT) provisioning when enabled.
   * 6. Audit logging without secret leakage.
   */
  public async resolveOrProvision(
    claims: EntraIdentityClaims,
    clientMeta?: { ipAddress?: string; userAgent?: string }
  ): Promise<EntraResolutionResult> {
    const normalizedEmail = (claims.email || '').trim().toLowerCase();
    const externalUserId = (claims.subject || '').trim();
    const tenantId = (claims.tenantId || '').trim();
    const displayName = (claims.displayName || normalizedEmail.split('@')[0] || 'Entra User').trim();

    const rawIp = clientMeta?.ipAddress || '127.0.0.1';
    const ipAddress = (rawIp === '::1' || /^[\d.]+$/.test(rawIp) || /^[a-fA-F0-9:]+$/.test(rawIp))
      ? rawIp
      : '127.0.0.1';
    const userAgent = (clientMeta?.userAgent || 'Unknown Client').substring(0, 1000);

    // 1. Basic claim sanity checks
    if (!normalizedEmail || !externalUserId) {
      await auditService.recordAuditEvent({
        userId: null,
        eventType: 'LOGIN_FAILED',
        ipAddress,
        userAgent,
        targetType: 'USER',
        targetId: null,
        details: { reason: 'UNRESOLVED_IDENTITY', provider: 'ENTRA' }
      }).catch(() => {});

      return {
        success: false,
        code: 'UNRESOLVED_IDENTITY',
        message: 'Invalid or incomplete Microsoft Entra identity claims.'
      };
    }

    // 2. Tenant isolation check (AC1)
    if (!this.isTenantAllowed(tenantId)) {
      await auditService.recordAuditEvent({
        userId: null,
        eventType: 'LOGIN_FAILED',
        ipAddress,
        userAgent,
        targetType: 'USER',
        targetId: null,
        details: {
          reason: 'TENANT_MISMATCH',
          provider: 'ENTRA',
          incomingTenant: tenantId,
          configuredTenant: config.entra.tenantId
        }
      }).catch(() => {});

      return {
        success: false,
        code: 'TENANT_MISMATCH',
        message: 'Sign-in is only permitted from the configured enterprise directory.'
      };
    }

    // 2.1 Resolve target role from Entra claims (Story 13 - VYR-013)
    const roleResolution = this.resolveEntraRole(claims);
    if (!roleResolution.roleCode) {
      await auditService.recordAuditEvent({
        userId: null,
        eventType: 'LOGIN_FAILED',
        ipAddress,
        userAgent,
        targetType: 'USER',
        targetId: null,
        details: {
          reason: 'ROLE_NOT_MAPPED',
          provider: 'ENTRA',
          email: normalizedEmail,
          tenantId,
          claims: {
            roles: claims.roles || [],
            groups: claims.groups || []
          }
        }
      }).catch(() => {});

      return {
        success: false,
        code: 'ROLE_NOT_MAPPED',
        message: 'Your Microsoft account has not been assigned an approved VEYRA application role.'
      };
    }

    try {
      // 3. Primary lookup by immutable composite key (provider, tenantId, externalUserId)
      const existingMapping = await this.findMapping(tenantId, externalUserId);

      if (existingMapping) {
        // Fetch mapped veyra_user
        const userRes = await dbQuery<any>(
          `SELECT id, email, password_hash, display_name, status, is_local_user, last_login_at
           FROM veyra_user
           WHERE id = $1`,
          [existingMapping.userId]
        );

        if (userRes.rows.length > 0) {
          const dbUser = userRes.rows[0];

          // Check account status (AC2)
          if (dbUser.status !== 'ACTIVE') {
            await auditService.recordAuditEvent({
              userId: dbUser.id,
              eventType: 'LOGIN_FAILED',
              ipAddress,
              userAgent,
              targetType: 'USER',
              targetId: dbUser.id,
              details: { reason: 'ACCOUNT_INACTIVE', status: dbUser.status, provider: 'ENTRA' }
            }).catch(() => {});

            return {
              success: false,
              code: 'USER_DISABLED',
              status: dbUser.status,
              message: 'Your account is not active. Please contact a system administrator.'
            };
          }

          // User is active: update last_authenticated_at and metadata on mapping
          await dbQuery(
            `UPDATE veyra_user_identity_mapping
             SET last_authenticated_at = now(),
                 external_email = $1,
                 external_display_name = $2,
                 updated_at = now()
             WHERE id = $3`,
            [normalizedEmail, displayName, existingMapping.id]
          );

          // Synchronize user role from claims (Story 13 - VYR-013)
          await this.syncUserRole(dbUser.id, roleResolution.roleCode, {
            matchedClaim: roleResolution.matchedClaim,
            source: roleResolution.source,
            ipAddress,
            userAgent
          });

          return {
            success: true,
            user: {
              id: dbUser.id,
              email: dbUser.email,
              displayName: dbUser.display_name,
              status: dbUser.status,
              isLocalUser: dbUser.is_local_user,
              lastLoginAt: dbUser.last_login_at
            },
            mapping: {
              ...existingMapping,
              externalEmail: normalizedEmail,
              externalDisplayName: displayName,
              lastAuthenticatedAt: new Date()
            },
            isNewProvision: false
          };
        }
        // If user was deleted, cascade clean orphaned mapping and proceed to account lookup
        await dbQuery(`DELETE FROM veyra_user_identity_mapping WHERE id = $1`, [existingMapping.id]).catch(() => {});
      }

      // 4. Secondary lookup: Check if user exists in veyra_user by email (Account Linking)
      const emailUserRes = await dbQuery<any>(
        `SELECT id, email, password_hash, display_name, status, is_local_user, last_login_at
         FROM veyra_user
         WHERE email = $1`,
        [normalizedEmail]
      );

      if (emailUserRes.rows.length > 0) {
        const dbUser = emailUserRes.rows[0];

        // Check account status (AC2)
        if (dbUser.status !== 'ACTIVE') {
          await auditService.recordAuditEvent({
            userId: dbUser.id,
            eventType: 'LOGIN_FAILED',
            ipAddress,
            userAgent,
            targetType: 'USER',
            targetId: dbUser.id,
            details: { reason: 'ACCOUNT_INACTIVE', status: dbUser.status, provider: 'ENTRA' }
          }).catch(() => {});

          return {
            success: false,
            code: 'USER_DISABLED',
            status: dbUser.status,
            message: 'Your account is not active. Please contact a system administrator.'
          };
        }

        // Link existing user to Entra identity
        const insertMappingRes = await dbQuery<any>(
          `INSERT INTO veyra_user_identity_mapping (
            user_id, provider, tenant_id, external_user_id, external_email, external_display_name
          ) VALUES ($1, 'ENTRA', $2, $3, $4, $5)
          ON CONFLICT (provider, tenant_id, external_user_id) 
          DO UPDATE SET external_email = EXCLUDED.external_email,
                        external_display_name = EXCLUDED.external_display_name,
                        last_authenticated_at = now(),
                        updated_at = now()
          RETURNING id, user_id, provider, tenant_id, external_user_id, external_email, 
                    external_display_name, created_at, updated_at, last_authenticated_at`,
          [dbUser.id, tenantId, externalUserId, normalizedEmail, displayName]
        );

        const newMappingRow = insertMappingRes.rows[0];

        await auditService.recordAuditEvent({
          userId: dbUser.id,
          eventType: 'USER_UPDATED',
          ipAddress,
          userAgent,
          targetType: 'USER',
          targetId: dbUser.id,
          details: {
            action: 'EXTERNAL_IDENTITY_LINKED',
            provider: 'ENTRA',
            tenantId,
            externalUserId
          }
        }).catch(() => {});

        // Synchronize user role from claims (Story 13 - VYR-013)
        await this.syncUserRole(dbUser.id, roleResolution.roleCode, {
          matchedClaim: roleResolution.matchedClaim,
          source: roleResolution.source,
          ipAddress,
          userAgent
        });

        return {
          success: true,
          user: {
            id: dbUser.id,
            email: dbUser.email,
            displayName: dbUser.display_name,
            status: dbUser.status,
            isLocalUser: dbUser.is_local_user,
            lastLoginAt: dbUser.last_login_at
          },
          mapping: {
            id: newMappingRow.id,
            userId: newMappingRow.user_id,
            provider: newMappingRow.provider,
            tenantId: newMappingRow.tenant_id,
            externalUserId: newMappingRow.external_user_id,
            externalEmail: newMappingRow.external_email,
            externalDisplayName: newMappingRow.external_display_name,
            createdAt: newMappingRow.created_at,
            updatedAt: newMappingRow.updated_at,
            lastAuthenticatedAt: newMappingRow.last_authenticated_at
          },
          isNewProvision: false
        };
      }

      // 5. User does not exist: Evaluate Just-In-Time (JIT) Provisioning Policy
      if (!config.entra.jitProvisioning) {
        await auditService.recordAuditEvent({
          userId: null,
          eventType: 'LOGIN_FAILED',
          ipAddress,
          userAgent,
          targetType: 'USER',
          targetId: null,
          details: {
            reason: 'IDENTITY_NOT_PROVISIONED',
            provider: 'ENTRA',
            email: normalizedEmail,
            tenantId
          }
        }).catch(() => {});

        return {
          success: false,
          code: 'IDENTITY_NOT_PROVISIONED',
          message: 'Your Microsoft account is not authorized to access VEYRA.'
        };
      }

      // 6. JIT Provisioning (Atomic Transaction)
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 6.1 Create new veyra_user
        const insertUserRes = await client.query(
          `INSERT INTO veyra_user (email, display_name, status, is_local_user, password_hash)
           VALUES ($1, $2, 'ACTIVE', false, null)
           RETURNING id, email, display_name, status, is_local_user, last_login_at`,
          [normalizedEmail, displayName]
        );
        const newUser = insertUserRes.rows[0];

        // 6.2 Assign resolved role from claims (Story 13 - VYR-013)
        const targetRoleCode = roleResolution.roleCode;
        const roleRes = await client.query(
          `SELECT id FROM veyra_role WHERE role_code = $1`,
          [targetRoleCode]
        );

        const assignedRoleId = roleRes.rows[0]?.id;
        if (assignedRoleId) {
          await client.query(
            `INSERT INTO veyra_user_role (user_id, role_id, created_by)
             VALUES ($1, $2, 'ENTRA_JIT')
             ON CONFLICT DO NOTHING`,
            [newUser.id, assignedRoleId]
          );
        }

        // 6.3 Insert identity mapping record
        const insertMappingRes = await client.query(
          `INSERT INTO veyra_user_identity_mapping (
            user_id, provider, tenant_id, external_user_id, external_email, external_display_name
          ) VALUES ($1, 'ENTRA', $2, $3, $4, $5)
          RETURNING id, user_id, provider, tenant_id, external_user_id, external_email, 
                    external_display_name, created_at, updated_at, last_authenticated_at`,
          [newUser.id, tenantId, externalUserId, normalizedEmail, displayName]
        );
        const mappingRow = insertMappingRes.rows[0];

        await client.query('COMMIT');

        // 6.4 Record audit trails for JIT provisioning (outside transaction)
        await auditService.recordAuditEvent({
          userId: newUser.id,
          eventType: 'USER_CREATED',
          ipAddress,
          userAgent,
          targetType: 'USER',
          targetId: newUser.id,
          details: {
            action: 'JIT_PROVISIONED',
            provider: 'ENTRA',
            tenantId,
            externalUserId,
            assignedRole: targetRoleCode
          }
        }).catch(() => {});

        if (assignedRoleId) {
          await auditService.recordAuditEvent({
            userId: newUser.id,
            eventType: 'ROLE_ASSIGNED',
            ipAddress,
            userAgent,
            targetType: 'ROLE',
            targetId: assignedRoleId,
            details: {
              roleCode: targetRoleCode,
              matchedClaim: roleResolution.matchedClaim || null,
              source: roleResolution.source,
              assignedVia: 'ENTRA_JIT'
            }
          }).catch(() => {});
        }

        return {
          success: true,
          user: {
            id: newUser.id,
            email: newUser.email,
            displayName: newUser.display_name,
            status: newUser.status,
            isLocalUser: newUser.is_local_user,
            lastLoginAt: newUser.last_login_at
          },
          mapping: {
            id: mappingRow.id,
            userId: mappingRow.user_id,
            provider: mappingRow.provider,
            tenantId: mappingRow.tenant_id,
            externalUserId: mappingRow.external_user_id,
            externalEmail: mappingRow.external_email,
            externalDisplayName: mappingRow.external_display_name,
            createdAt: mappingRow.created_at,
            updatedAt: mappingRow.updated_at,
            lastAuthenticatedAt: mappingRow.last_authenticated_at
          },
          isNewProvision: true
        };
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.error('[EntraIdentityService Error]:', err);
      return {
        success: false,
        code: 'AUTH_BACKEND_UNAVAILABLE',
        message: 'Sign-in is temporarily unavailable. Please try again.'
      };
    }
  }
}

export const entraIdentityService = new EntraIdentityService();

