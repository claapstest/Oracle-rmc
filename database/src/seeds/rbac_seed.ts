/**
 * Deterministic, version-controlled seed data for VEYRA RBAC configuration.
 * Story: VY-STRY-008
 *
 * Roles: SITE_ADMIN, AUDIT_MANAGER, AUDIT_SUPERVISOR, AUDIT_USER
 * Privileges: ASK_VEYRA, USERS_LIST, ROLES_CATALOG, AUDIT_TRAIL, RISK_MANAGEMENT,
 *             REPORTS, USER_MANAGEMENT, ORACLE_INTEGRATION, ORACLE_API_CONSOLE
 * Bootstrap User: admin@admin.com -> SITE_ADMIN (password_hash = null)
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from database directory or root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || '127.0.0.1'}:${process.env.POSTGRES_PORT || '5433'}/${process.env.POSTGRES_DB || 'veyra_db'}`;

export const ROLES_DATA = [
  {
    role_code: 'SITE_ADMIN',
    role_name: 'Site Administrator',
    description: 'Site Administrator with full administrative access and integration control',
  },
  {
    role_code: 'AUDIT_MANAGER',
    role_name: 'Audit Manager',
    description: 'Audit Manager responsible for reviews, risk, investigations, and reporting',
  },
  {
    role_code: 'AUDIT_SUPERVISOR',
    role_name: 'Audit Supervisor',
    description: 'Audit Supervisor responsible for oversight, catalogs, and reporting',
  },
  {
    role_code: 'AUDIT_USER',
    role_name: 'Audit User',
    description: 'Baseline audit user with reporting access',
  },
];

export const PRIVILEGES_DATA = [
  {
    privilege_code: 'ASK_VEYRA',
    privilege_name: 'Ask VEYRA Assistant',
    module: 'AI_ASSISTANT',
    description: 'Conversational AI and investigation assistant',
  },
  {
    privilege_code: 'USERS_LIST',
    privilege_name: 'Users Directory',
    module: 'SECURITY',
    description: 'View user directories and identities',
  },
  {
    privilege_code: 'ROLES_CATALOG',
    privilege_name: 'Roles Catalog',
    module: 'SECURITY',
    description: 'View role catalog and privilege hierarchies',
  },
  {
    privilege_code: 'AUDIT_TRAIL',
    privilege_name: 'Audit Trail Logs',
    module: 'AUDIT',
    description: 'Access audit trail and change history logs',
  },
  {
    privilege_code: 'RISK_MANAGEMENT',
    privilege_name: 'Risk Management & Controls',
    module: 'RISK',
    description: 'Access Segregation of Duties and risk controls',
  },
  {
    privilege_code: 'REPORTS',
    privilege_name: 'Compliance & Audit Reports',
    module: 'REPORTS',
    description: 'Access enterprise audit and compliance reports',
  },
  {
    privilege_code: 'USER_MANAGEMENT',
    privilege_name: 'User Management',
    module: 'ADMIN',
    description: 'Manage system users and administrative actions',
  },
  {
    privilege_code: 'ORACLE_INTEGRATION',
    privilege_name: 'Oracle Integration',
    module: 'INTEGRATION',
    description: 'Configure and manage Oracle Fusion integrations',
  },
  {
    privilege_code: 'ORACLE_API_CONSOLE',
    privilege_name: 'Oracle API Console',
    module: 'INTEGRATION',
    description: 'Access Oracle Fusion REST API console',
  },
];

export const ROLE_PRIVILEGE_MAPPINGS: Record<string, string[]> = {
  SITE_ADMIN: ['USER_MANAGEMENT', 'ORACLE_INTEGRATION', 'ORACLE_API_CONSOLE'],
  AUDIT_MANAGER: [
    'ASK_VEYRA',
    'USERS_LIST',
    'ROLES_CATALOG',
    'AUDIT_TRAIL',
    'RISK_MANAGEMENT',
    'REPORTS',
  ],
  AUDIT_SUPERVISOR: [
    'USERS_LIST',
    'ROLES_CATALOG',
    'AUDIT_TRAIL',
    'RISK_MANAGEMENT',
    'REPORTS',
  ],
  AUDIT_USER: ['REPORTS'],
};

export const BOOTSTRAP_USER = {
  email: 'admin@admin.com',
  display_name: 'Site Administrator',
  status: 'ACTIVE',
  is_local_user: true,
  role_code: 'SITE_ADMIN',
  // In accordance with Story 8 requirements:
  // "Do not invent an initial admin password.
  // The story specifies admin@admin.com but does not specify its initial password provisioning mechanism.
  // Flag this for the team instead of hardcoding an invented password."
  password_hash: null,
  created_by: 'SYSTEM_SEED',
};

export const SEED_PERSONAS = [
  {
    email: 'akash.meesarapu@claaps.com',
    display_name: 'Akash Meesarapu',
    status: 'ACTIVE',
    role_code: 'AUDIT_MANAGER',
    password_hash: '$2b$10$3R8moi2HVvpi8RusvkJ9D.hd9vDXo2Nauygzxv4QP4ppIknZsDTCC', // Password@123
    created_by: 'SYSTEM_SEED',
  },
  {
    email: 'supervisor.user@claaps.com',
    display_name: 'Audit Supervisor User',
    status: 'ACTIVE',
    role_code: 'AUDIT_SUPERVISOR',
    password_hash: '$2b$10$3R8moi2HVvpi8RusvkJ9D.hd9vDXo2Nauygzxv4QP4ppIknZsDTCC', // Password@123
    created_by: 'SYSTEM_SEED',
  },
  {
    email: 'audit.user@claaps.com',
    display_name: 'Standard Audit User',
    status: 'ACTIVE',
    role_code: 'AUDIT_USER',
    password_hash: '$2b$10$3R8moi2HVvpi8RusvkJ9D.hd9vDXo2Nauygzxv4QP4ppIknZsDTCC', // Password@123
    created_by: 'SYSTEM_SEED',
  },
];

export async function seedRbacData(client?: pg.ClientBase): Promise<void> {
  let localClient: pg.Client | null = null;
  const db: pg.ClientBase = client || (localClient = new pg.Client({ connectionString }));

  if (localClient) {
    await localClient.connect();
  }

  try {
    await db.query('BEGIN');

    // 1. Seed Roles
    const roleIdMap = new Map<string, string>();
    for (const r of ROLES_DATA) {
      const res = await db.query(
        `INSERT INTO veyra_role (role_code, role_name, description, status)
         VALUES ($1, $2, $3, 'ACTIVE')
         ON CONFLICT (role_code) DO UPDATE SET
           role_name = EXCLUDED.role_name,
           description = EXCLUDED.description
         RETURNING id, role_code`,
        [r.role_code, r.role_name, r.description]
      );
      roleIdMap.set(res.rows[0].role_code, res.rows[0].id);
    }

    // 2. Seed Privileges
    const privIdMap = new Map<string, string>();
    for (const p of PRIVILEGES_DATA) {
      const res = await db.query(
        `INSERT INTO veyra_privilege (privilege_code, privilege_name, module, description, status)
         VALUES ($1, $2, $3, $4, 'ACTIVE')
         ON CONFLICT (privilege_code) DO UPDATE SET
           privilege_name = EXCLUDED.privilege_name,
           module = EXCLUDED.module,
           description = EXCLUDED.description
         RETURNING id, privilege_code`,
        [p.privilege_code, p.privilege_name, p.module, p.description]
      );
      privIdMap.set(res.rows[0].privilege_code, res.rows[0].id);
    }

    // 3. Seed Role-Privilege Mappings
    for (const [roleCode, privCodes] of Object.entries(ROLE_PRIVILEGE_MAPPINGS)) {
      const roleId = roleIdMap.get(roleCode);
      if (!roleId) continue;
      for (const privCode of privCodes) {
        const privId = privIdMap.get(privCode);
        if (!privId) continue;
        await db.query(
          `INSERT INTO veyra_role_privilege (role_id, privilege_id, created_by)
           VALUES ($1, $2, 'SYSTEM_SEED')
           ON CONFLICT (role_id, privilege_id) DO NOTHING`,
          [roleId, privId]
        );
      }
    }

    // 4. Seed Bootstrap User
    const normalizedEmail = BOOTSTRAP_USER.email.trim().toLowerCase();
    const userRes = await db.query(
      `INSERT INTO veyra_user (email, display_name, status, is_local_user, password_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         status = EXCLUDED.status
       RETURNING id`,
      [
        normalizedEmail,
        BOOTSTRAP_USER.display_name,
        BOOTSTRAP_USER.status,
        BOOTSTRAP_USER.is_local_user,
        BOOTSTRAP_USER.password_hash,
        BOOTSTRAP_USER.created_by,
      ]
    );
    const adminUserId = userRes.rows[0].id;

    // 5. Map Admin User to SITE_ADMIN
    const adminRoleId = roleIdMap.get(BOOTSTRAP_USER.role_code);
    if (adminRoleId) {
      await db.query(
        `INSERT INTO veyra_user_role (user_id, role_id, created_by)
         VALUES ($1, $2, 'SYSTEM_SEED')
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [adminUserId, adminRoleId]
      );
    }

    // 6. Seed Additional Personas (Audit Manager, Supervisor, User)
    for (const persona of SEED_PERSONAS) {
      const pEmail = persona.email.trim().toLowerCase();
      const pRes = await db.query(
        `INSERT INTO veyra_user (email, display_name, status, is_local_user, password_hash, created_by)
         VALUES ($1, $2, $3, true, $4, $5)
         ON CONFLICT (email) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           status = EXCLUDED.status,
           password_hash = COALESCE(EXCLUDED.password_hash, veyra_user.password_hash)
         RETURNING id`,
        [pEmail, persona.display_name, persona.status, persona.password_hash, persona.created_by]
      );
      const pUserId = pRes.rows[0].id;
      const pRoleId = roleIdMap.get(persona.role_code);
      if (pRoleId) {
        await db.query(
          `INSERT INTO veyra_user_role (user_id, role_id, created_by)
           VALUES ($1, $2, 'SYSTEM_SEED')
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [pUserId, pRoleId]
        );
      }
    }

    await db.query('COMMIT');
    console.log('✅ Successfully applied VEYRA RBAC seed data.');
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('❌ Error seeding RBAC data:', err);
    throw err;
  } finally {
    if (localClient) {
      await localClient.end();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedRbacData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
