/**
 * Configuration & Secrets Startup Validation Service
 * Story ID: VYR-055
 * Epic: EPIC 6 — OWASP application and API security hardening
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Enforces production readiness and fail-closed security gates:
 *  1. Validates required environment variables and service credentials at boot
 *  2. Production gate: strictly rejects default/fallback passwords, keys and placeholders
 *  3. Verifies KMS, JWT, Database, Oracle Fusion and Entra configurations
 *  4. Assesses repository protections (.gitignore rules for secrets)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateAndNormalizeUrl } from './urlPolicy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ValidationCheckResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message?: string;
}

export interface ConfigValidationReport {
  valid: boolean;
  environment: string;
  errors: string[];
  warnings: string[];
  checks: ValidationCheckResult[];
}

export interface ValidationOptions {
  environment?: string;
  strict?: boolean;
  throwOnError?: boolean;
}

export const KNOWN_DEFAULT_FALLBACK_KEYS = new Set([
  'default-fallback-security-key-oracle-fusion',
  'secret',
  'password',
  'changeme',
  '123456',
  'admin',
  'test',
]);

/**
 * Validates system environment configuration across all active subsystems.
 */
export function validateStartupConfig(options: ValidationOptions = {}): ConfigValidationReport {
  const env = (options.environment || process.env.NODE_ENV || 'development').toLowerCase();
  const isProduction = env === 'production';
  const strict = options.strict ?? isProduction;
  const throwOnError = options.throwOnError ?? isProduction;

  const checks: ValidationCheckResult[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  function recordPass(name: string, message?: string) {
    checks.push({ name, status: 'PASS', message });
  }

  function recordFail(name: string, message: string) {
    checks.push({ name, status: 'FAIL', message });
    errors.push(`[${name}] ${message}`);
  }

  function recordWarn(name: string, message: string) {
    checks.push({ name, status: 'WARN', message });
    warnings.push(`[${name}] ${message}`);
  }

  // --------------------------------------------------------------------------
  // Check 1: Server Port & Environment Profile
  // --------------------------------------------------------------------------
  const portRaw = process.env.PORT || '5000';
  const portNum = parseInt(portRaw, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    recordFail('PORT_CONFIG', `PORT must be a valid number between 1 and 65535 (received: "${portRaw}")`);
  } else {
    recordPass('PORT_CONFIG', `Port configured to ${portNum}`);
  }

  // --------------------------------------------------------------------------
  // Check 2: Authentication Provider Configuration
  // --------------------------------------------------------------------------
  const authProvider = (process.env.AUTH_PROVIDER || 'LOCAL').trim().toUpperCase();
  if (authProvider !== 'LOCAL' && authProvider !== 'ENTRA') {
    recordFail('AUTH_PROVIDER', `Invalid AUTH_PROVIDER "${authProvider}". Must be "LOCAL" or "ENTRA".`);
  } else {
    recordPass('AUTH_PROVIDER', `Auth provider active: ${authProvider}`);
  }

  if (authProvider === 'ENTRA') {
    const tenantId = process.env.ENTRA_TENANT_ID || process.env.AZURE_TENANT_ID;
    const clientId = process.env.ENTRA_CLIENT_ID || process.env.AZURE_CLIENT_ID;
    const redirectUri = process.env.ENTRA_REDIRECT_URI;
    const clientSecret = process.env.ENTRA_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET;

    if (!tenantId || !clientId || !redirectUri) {
      recordFail(
        'ENTRA_OIDC_CONFIG',
        'AUTH_PROVIDER is set to ENTRA, but missing required ENTRA_TENANT_ID, ENTRA_CLIENT_ID, or ENTRA_REDIRECT_URI.'
      );
    } else {
      recordPass('ENTRA_OIDC_CONFIG', `Entra OIDC configured for tenant ${tenantId}`);
    }

    if (strict && !clientSecret && !process.env.AZURE_FEDERATED_TOKEN_FILE) {
      recordFail(
        'ENTRA_CREDENTIALS',
        'Production Entra OIDC requires ENTRA_CLIENT_SECRET or Azure Workload Identity federation.'
      );
    }
  }

  // --------------------------------------------------------------------------
  // Check 3: Database Credentials & Fail-Closed Gates
  // --------------------------------------------------------------------------
  const rawDbUrl = process.env.DATABASE_URL || process.env.DATABASE_URI;
  const dbUser = process.env.POSTGRES_USER || 'postgres';
  const dbPass = process.env.POSTGRES_PASSWORD || 'postgres';
  const dbHost = process.env.POSTGRES_HOST || '127.0.0.1';

  const hasDbConfig = Boolean(rawDbUrl || process.env.POSTGRES_HOST || process.env.POSTGRES_DB);

  if (!hasDbConfig) {
    recordFail('DATABASE_CONFIG', 'No database connection parameters found (DATABASE_URL or POSTGRES_HOST).');
  } else {
    recordPass('DATABASE_CONFIG', 'Database connection parameters detected.');
  }

  if (strict) {
    // In production, reject default credentials
    const isDefaultDbPassword = dbPass === 'postgres' || dbPass === 'admin' || dbPass === 'password';
    const isLocalHost = dbHost === '127.0.0.1' || dbHost === 'localhost';

    if (isDefaultDbPassword && !isLocalHost) {
      recordFail('DATABASE_CREDENTIALS', 'Production database cannot use default password ("postgres").');
    }

    if (rawDbUrl && rawDbUrl.includes('postgres:postgres@') && !rawDbUrl.includes('localhost') && !rawDbUrl.includes('127.0.0.1')) {
      recordFail('DATABASE_CREDENTIALS', 'Production DATABASE_URL contains default credentials ("postgres:postgres").');
    }
  }

  // --------------------------------------------------------------------------
  // Check 4: KMS & Master Encryption Key Hardening
  // --------------------------------------------------------------------------
  const encryptionKeyRaw = process.env.ORACLE_ENCRYPTION_KEY || '';
  const isDefaultKey = KNOWN_DEFAULT_FALLBACK_KEYS.has(encryptionKeyRaw.trim().toLowerCase());
  const hasCloudKms = Boolean(process.env.AWS_KMS_KEY_ARN || process.env.AZURE_KEY_VAULT_URL);

  if (strict) {
    if (!encryptionKeyRaw && !hasCloudKms) {
      recordFail('KMS_MASTER_KEY', 'Production requires ORACLE_ENCRYPTION_KEY or a cloud KMS provider (AWS_KMS_KEY_ARN or AZURE_KEY_VAULT_URL).');
    } else if (isDefaultKey) {
      recordFail('KMS_MASTER_KEY', 'Production cannot use the default fallback encryption key ("default-fallback-security-key-oracle-fusion").');
    } else if (encryptionKeyRaw && encryptionKeyRaw.length < 32 && !hasCloudKms) {
      recordFail('KMS_MASTER_KEY', `ORACLE_ENCRYPTION_KEY must be at least 32 characters in production (got ${encryptionKeyRaw.length}).`);
    } else {
      recordPass('KMS_MASTER_KEY', 'Cryptographic master key meets production requirements.');
    }
  } else {
    if (isDefaultKey || !encryptionKeyRaw) {
      recordWarn('KMS_MASTER_KEY', 'Using default fallback encryption key. Configure ORACLE_ENCRYPTION_KEY for non-development environments.');
    } else {
      recordPass('KMS_MASTER_KEY', 'Encryption key configured.');
    }
  }

  // --------------------------------------------------------------------------
  // Check 5: JWT / JWS Token Signing Configuration
  // --------------------------------------------------------------------------
  const jwtPrivateKey = process.env.JWT_PRIVATE_KEY || '';
  const jwtKeyPath = process.env.JWT_PRIVATE_KEY_PATH || '';
  const hasJwtPrivateKey = Boolean(jwtPrivateKey.trim() || (jwtKeyPath && fs.existsSync(jwtKeyPath.trim())));

  if (strict) {
    if (!hasJwtPrivateKey) {
      recordFail('JWT_SIGNING_CONFIG', 'Production requires an explicit RSA signing private key (JWT_PRIVATE_KEY or JWT_PRIVATE_KEY_PATH). Ephemeral development keys are disallowed.');
    } else {
      recordPass('JWT_SIGNING_CONFIG', 'JWT RSA signing key is configured.');
    }
  } else {
    if (!hasJwtPrivateKey) {
      recordWarn('JWT_SIGNING_CONFIG', 'JWT private key not set; backend will generate an ephemeral RSA keypair for development.');
    } else {
      recordPass('JWT_SIGNING_CONFIG', 'JWT RSA signing key configured.');
    }
  }

  // --------------------------------------------------------------------------
  // Check 6: Oracle Fusion Integration Validation
  // --------------------------------------------------------------------------
  const envMode = (process.env.ENVIRONMENT_MODE || 'ORACLE_FUSION').toUpperCase();
  if (envMode === 'ORACLE_FUSION') {
    const rawUrl = process.env.ORACLE_FUSION_BASE_URL || process.env.FUSION_HOST || 'https://eiiv-dev14.fa.us6.oraclecloud.com';
    try {
      validateAndNormalizeUrl(rawUrl);
      recordPass('ORACLE_FUSION_URL', `Oracle Fusion base URL is valid (${rawUrl})`);
    } catch (err: any) {
      recordFail('ORACLE_FUSION_URL', `Invalid ORACLE_FUSION_BASE_URL: ${err.message}`);
    }

    if (strict) {
      const hasUser = Boolean(process.env.ORACLE_USERNAME);
      const hasSecret = Boolean(process.env.ORACLE_PASSWORD || process.env.ORACLE_TOKEN);
      if (!hasUser || !hasSecret) {
        recordFail('ORACLE_CREDENTIALS', 'Production Oracle Fusion mode requires ORACLE_USERNAME and either ORACLE_PASSWORD or ORACLE_TOKEN.');
      } else {
        recordPass('ORACLE_CREDENTIALS', 'Oracle integration credentials configured.');
      }
    }
  }

  // --------------------------------------------------------------------------
  // Check 7: Repository Secret Exclusion (.gitignore audit)
  // --------------------------------------------------------------------------
  const repoRoot = path.resolve(__dirname, '../../../');
  const gitignorePath = path.join(repoRoot, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    const blocksEnv = gitignoreContent.includes('.env');
    const blocksKeys = gitignoreContent.includes('.pem') || gitignoreContent.includes('*.key');
    if (blocksEnv && blocksKeys) {
      recordPass('GITIGNORE_SECRET_GUARDS', '.gitignore blocks .env files and private keys.');
    } else {
      recordWarn('GITIGNORE_SECRET_GUARDS', '.gitignore is missing explicit blocks for .env or key files.');
    }
  } else {
    recordWarn('GITIGNORE_SECRET_GUARDS', '.gitignore not found at workspace root.');
  }

  const isValid = errors.length === 0;
  const report: ConfigValidationReport = {
    valid: isValid,
    environment: env,
    errors,
    warnings,
    checks,
  };

  if (!isValid && throwOnError) {
    throw new Error(
      `[Config Error] Startup configuration validation failed with ${errors.length} error(s):\n${errors.map((e) => `  - ${e}`).join('\n')}`
    );
  }

  return report;
}
