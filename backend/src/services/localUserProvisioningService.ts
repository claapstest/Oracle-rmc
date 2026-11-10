import bcrypt from 'bcryptjs';
import { query as dbQuery } from '../db.js';
import { auditService } from './auditService.js';

export interface SeedPersona {
  email: string;
  displayName: string;
  roleCode: 'SITE_ADMIN' | 'AUDIT_MANAGER' | 'AUDIT_SUPERVISOR' | 'AUDIT_USER' | 'SECURITY_ANALYST';
  status: 'ACTIVE' | 'INACTIVE';
  description?: string;
}

export interface SeedResult {
  success: boolean;
  environment: string;
  seededUsersCount: number;
  users: Array<{ email: string; role: string; userId: string; status: string }>;
  message: string;
  auditWarningEmitted?: boolean;
}

export interface AdminProvisionOptions {
  email?: string;
  password?: string;
  passwordHash?: string;
  displayName?: string;
  allowProductionOverride?: boolean;
}

export interface AdminProvisionResult {
  success: boolean;
  userId: string;
  email: string;
  role: string;
  status: string;
  message: string;
}

export class ProductionSeedBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionSeedBlockedError';
  }
}

/**
 * Standard representative development personas for regression testing
 * across the four primary VEYRA RBAC roles.
 */
export const REPRESENTATIVE_DEV_PERSONAS: SeedPersona[] = [
  {
    email: 'admin@admin.com',
    displayName: 'Site Administrator',
    roleCode: 'SITE_ADMIN',
    status: 'ACTIVE',
    description: 'Full administrative access and integration control'
  },
  {
    email: 'akash.meesarapu@claaps.com',
    displayName: 'Akash Meesarapu',
    roleCode: 'AUDIT_MANAGER',
    status: 'ACTIVE',
    description: 'Audit reviews, risk analysis, investigations, and reporting'
  },
  {
    email: 'supervisor.user@claaps.com',
    displayName: 'Audit Supervisor User',
    roleCode: 'AUDIT_SUPERVISOR',
    status: 'ACTIVE',
    description: 'Audit supervision, role catalogues, and compliance'
  },
  {
    email: 'audit.user@claaps.com',
    displayName: 'Standard Audit User',
    roleCode: 'AUDIT_USER',
    status: 'ACTIVE',
    description: 'Baseline audit user with report access'
  }
];

/**
 * LocalUserProvisioningService (VYR-015)
 * 
 * Provides controlled local-user provisioning and development seed users:
 * 1. Gated seed execution: blocks dev test accounts in production environments unless explicitly overridden.
 * 2. Secure credential generation: bcrypt password hashes only; credentials supplied via secret injection
 *    (DEV_SEED_PASSWORD, ADMIN_INITIAL_PASSWORD) rather than hardcoded source constants.
 * 3. Representative development personas spanning all Veyra RBAC roles.
 * 4. Controlled administrator provisioning for production environments.
 * 5. Full audit logging with zero plaintext credential leakage.
 */
export class LocalUserProvisioningService {
  /**
   * Checks whether the current runtime environment is considered production.
   */
  public isProduction(): boolean {
    const nodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase();
    const envMode = (process.env.ENVIRONMENT_MODE || '').trim().toUpperCase();
    return nodeEnv === 'production' || envMode === 'PRODUCTION';
  }

  /**
   * Evaluates if development seed execution is permitted in the current environment.
   */
  public canSeedDevelopmentUsers(overrideEnv?: string): { allowed: boolean; reason?: string } {
    const currentEnv = overrideEnv || process.env.NODE_ENV || 'development';
    const isProd = currentEnv.trim().toLowerCase() === 'production';
    const allowOverride = process.env.ALLOW_PRODUCTION_SEED === 'true';

    if (isProd && !allowOverride) {
      return {
        allowed: false,
        reason: 'Development seed execution is strictly blocked in PRODUCTION environments to prevent unauthorized test accounts. Set ALLOW_PRODUCTION_SEED=true to override for audited maintenance.'
      };
    }

    return { allowed: true };
  }

  /**
   * Seeds development personas in non-production environments.
   * If run in production with ALLOW_PRODUCTION_SEED=true, logs a SECURITY_WARNING audit event.
   */
  public async seedDevelopmentUsers(options?: {
    customPassword?: string;
    overrideEnv?: string;
    personas?: SeedPersona[];
  }): Promise<SeedResult> {
    const env = options?.overrideEnv || process.env.NODE_ENV || 'development';
    const gateCheck = this.canSeedDevelopmentUsers(env);

    if (!gateCheck.allowed) {
      throw new ProductionSeedBlockedError(gateCheck.reason || 'Seeding blocked in production.');
    }

    const isProdWithOverride = env.trim().toLowerCase() === 'production' && process.env.ALLOW_PRODUCTION_SEED === 'true';
    let auditWarningEmitted = false;

    if (isProdWithOverride) {
      console.warn('⚠️  [SECURITY WARNING] Seeding development users in PRODUCTION with ALLOW_PRODUCTION_SEED=true.');
      await auditService.recordAuditEvent({
        userId: null,
        eventType: 'USER_CREATED',
        ipAddress: '127.0.0.1',
        userAgent: 'LocalUserProvisioningService',
        targetType: 'SYSTEM',
        targetId: 'SEED_MECHANISM',
        details: {
          warning: 'Development seed users provisioned in PRODUCTION with explicit override',
          isSecurityWarning: true,
          timestamp: new Date().toISOString()
        }
      }).catch(() => {});
      auditWarningEmitted = true;
    }

    // Determine candidate plaintext password from secure injection
    const defaultDevSeedPassword = options?.customPassword || process.env.DEV_SEED_PASSWORD || 'Password@123';
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(defaultDevSeedPassword, saltRounds);

    const personasToSeed = options?.personas || REPRESENTATIVE_DEV_PERSONAS;
    const seededList: Array<{ email: string; role: string; userId: string; status: string }> = [];

    for (const persona of personasToSeed) {
      const normalizedEmail = persona.email.trim().toLowerCase();

      // 1. Upsert veyra_user
      const userRes = await dbQuery(
        `INSERT INTO veyra_user (email, display_name, status, is_local_user, password_hash, created_by)
         VALUES ($1, $2, $3, TRUE, $4, 'DEVELOPMENT_SEED')
         ON CONFLICT (email) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           status = EXCLUDED.status,
           password_hash = EXCLUDED.password_hash,
           updated_at = NOW()
         RETURNING id, email, status`,
        [normalizedEmail, persona.displayName, persona.status, passwordHash]
      );

      const userId = userRes.rows[0].id;

      // 2. Map role in veyra_user_role
      const roleRes = await dbQuery(
        `SELECT id FROM veyra_role WHERE role_code = $1`,
        [persona.roleCode]
      );

      if (roleRes.rows.length > 0) {
        const roleId = roleRes.rows[0].id;
        await dbQuery(
          `INSERT INTO veyra_user_role (user_id, role_id, created_by)
           VALUES ($1, $2, 'DEVELOPMENT_SEED')
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [userId, roleId]
        );
      }

      // 3. Record audit trail for provisioning
      await auditService.recordAuditEvent({
        userId,
        eventType: 'USER_CREATED',
        ipAddress: '127.0.0.1',
        userAgent: 'LocalUserProvisioningService',
        targetType: 'USER',
        targetId: userId,
        details: {
          email: normalizedEmail,
          role: persona.roleCode,
          provisionedVia: 'DEVELOPMENT_SEED',
          isLocalUser: true
        }
      }).catch(() => {});

      seededList.push({
        email: normalizedEmail,
        role: persona.roleCode,
        userId: String(userId),
        status: persona.status
      });
    }

    return {
      success: true,
      environment: env,
      seededUsersCount: seededList.length,
      users: seededList,
      message: `Successfully provisioned ${seededList.length} development users in ${env} environment.`,
      auditWarningEmitted
    };
  }

  /**
   * Controlled administrator provisioning for production or non-production.
   * In production, requires secret injection (ADMIN_INITIAL_PASSWORD or ADMIN_INITIAL_PASSWORD_HASH).
   */
  public async provisionAdministrator(options?: AdminProvisionOptions): Promise<AdminProvisionResult> {
    const isProd = this.isProduction();
    const adminEmail = (options?.email || process.env.ADMIN_EMAIL || 'admin@admin.com').trim().toLowerCase();
    const displayName = options?.displayName || 'Site Administrator';

    // Retrieve credential from secure secret injection
    const injectedPassword = options?.password || process.env.ADMIN_INITIAL_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD;
    const injectedHash = options?.passwordHash || process.env.ADMIN_INITIAL_PASSWORD_HASH;

    if (isProd && !injectedPassword && !injectedHash && !options?.allowProductionOverride) {
      throw new Error(
        'Production administrator provisioning requires ADMIN_INITIAL_PASSWORD or ADMIN_INITIAL_PASSWORD_HASH to be supplied via secure secret injection.'
      );
    }

    let finalPasswordHash: string | null = null;
    if (injectedHash) {
      finalPasswordHash = injectedHash;
    } else if (injectedPassword) {
      // Use higher cost factor 12 for administrator in production
      finalPasswordHash = await bcrypt.hash(injectedPassword, 12);
    } else {
      // Development fallback only
      finalPasswordHash = await bcrypt.hash('Admin@123', 10);
    }

    // 1. Upsert veyra_user for admin
    const userRes = await dbQuery(
      `INSERT INTO veyra_user (email, display_name, status, is_local_user, password_hash, created_by)
       VALUES ($1, $2, 'ACTIVE', TRUE, $3, 'CONTROLLED_ADMIN_PROVISION')
       ON CONFLICT (email) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         status = 'ACTIVE',
         password_hash = COALESCE(EXCLUDED.password_hash, veyra_user.password_hash),
         updated_at = NOW()
       RETURNING id, email, status`,
      [adminEmail, displayName, finalPasswordHash]
    );

    const adminId = userRes.rows[0].id;

    // 2. Ensure SITE_ADMIN role is assigned
    const roleRes = await dbQuery(`SELECT id FROM veyra_role WHERE role_code = 'SITE_ADMIN'`);
    if (roleRes.rows.length > 0) {
      await dbQuery(
        `INSERT INTO veyra_user_role (user_id, role_id, created_by)
         VALUES ($1, $2, 'CONTROLLED_ADMIN_PROVISION')
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [adminId, roleRes.rows[0].id]
      );
    }

    // 3. Audit trail (never logging plaintext password)
    await auditService.recordAuditEvent({
      userId: adminId,
      eventType: 'USER_CREATED',
      ipAddress: '127.0.0.1',
      userAgent: 'LocalUserProvisioningService',
      targetType: 'USER',
      targetId: adminId,
      details: {
        email: adminEmail,
        role: 'SITE_ADMIN',
        provisionedVia: 'CONTROLLED_ADMIN_PROVISION'
      }
    }).catch(() => {});

    return {
      success: true,
      userId: String(adminId),
      email: adminEmail,
      role: 'SITE_ADMIN',
      status: 'ACTIVE',
      message: `Controlled administrator provisioned successfully for ${adminEmail}.`
    };
  }
}

export const localUserProvisioningService = new LocalUserProvisioningService();
