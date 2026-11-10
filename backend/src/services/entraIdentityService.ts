import { query as dbQuery, pool } from '../db.js';
import { auditService } from './auditService.js';
import { config } from '../config.js';

export interface EntraIdentityClaims {
  email: string;
  subject: string; // oid (Object ID) or sub
  tenantId: string;
  displayName?: string;
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

        // 6.2 Assign default role
        const defaultRoleCode = config.entra.defaultRole || 'AUDIT_USER';
        const roleRes = await client.query(
          `SELECT id FROM veyra_role WHERE role_code = $1`,
          [defaultRoleCode]
        );

        if (roleRes.rows.length > 0) {
          const roleId = roleRes.rows[0].id;
          await client.query(
            `INSERT INTO veyra_user_role (user_id, role_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [newUser.id, roleId]
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
            assignedRole: defaultRoleCode
          }
        }).catch(() => {});

        if (roleRes.rows.length > 0) {
          await auditService.recordAuditEvent({
            userId: newUser.id,
            eventType: 'ROLE_ASSIGNED',
            ipAddress,
            userAgent,
            targetType: 'ROLE',
            targetId: roleRes.rows[0].id,
            details: {
              roleCode: defaultRoleCode,
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

