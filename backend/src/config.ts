import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from the parent directories or workspace root if needed
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(process.cwd(), '../.env') });
dotenv.config(); // fallback to current working directory .env

function parseRoleMapping(raw?: string): Record<string, string> {
  if (!raw || !raw.trim()) return {};
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') {
          result[k.trim()] = v.trim().toUpperCase();
        }
      }
      return result;
    } catch {
      console.warn('[Config] Failed to parse ENTRA_ROLE_MAPPING as JSON, falling back to empty mapping.');
      return {};
    }
  }
  const result: Record<string, string> = {};
  for (const pair of trimmed.split(',')) {
    const [claim, role] = pair.split(':').map(s => s?.trim());
    if (claim && role) {
      result[claim] = role.toUpperCase();
    }
  }
  return result;
}

export const config = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  environmentMode: (process.env.ENVIRONMENT_MODE || 'ORACLE_FUSION').toUpperCase() as 'DEMO' | 'ORACLE_FUSION',
  authProvider: (process.env.AUTH_PROVIDER || 'LOCAL').trim().toUpperCase() as 'LOCAL' | 'ENTRA',
  entra: {
    tenantId: process.env.ENTRA_TENANT_ID || process.env.AZURE_TENANT_ID || '',
    clientId: process.env.ENTRA_CLIENT_ID || process.env.AZURE_CLIENT_ID || '',
    clientSecret: process.env.ENTRA_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '',
    redirectUri: process.env.ENTRA_REDIRECT_URI || '',
    jitProvisioning: process.env.ENTRA_JIT_PROVISIONING === 'true',
    defaultRole: (process.env.ENTRA_DEFAULT_ROLE || 'AUDIT_USER').trim().toUpperCase(),
    roleMapping: parseRoleMapping(process.env.ENTRA_ROLE_MAPPING),
    requireRoleMapping: process.env.ENTRA_REQUIRE_ROLE_MAPPING === 'true',
  },
  oracle: {
    baseUrl: process.env.ORACLE_FUSION_BASE_URL || '',
    authType: (process.env.ORACLE_AUTH_TYPE || 'BASIC').toUpperCase() as 'BASIC' | 'BEARER',
    username: process.env.ORACLE_USERNAME || '',
    password: process.env.ORACLE_PASSWORD || '',
    token: process.env.ORACLE_TOKEN || '',
  }
};

const CONFIG_FILE_PATH = path.join(__dirname, '../oracle_config.json');

// Derive 32-byte encryption key
const ENCRYPTION_KEY_RAW = process.env.ORACLE_ENCRYPTION_KEY || 'default-fallback-security-key-oracle-fusion';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(ENCRYPTION_KEY_RAW).digest();
const ALGORITHM = 'aes-256-cbc';

export function encrypt(text: string): string {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

export function decrypt(text: string): string {
  if (!text) return '';
  const parts = text.split(':');
  if (parts.length !== 2) {
    // Migration fallback for existing plaintext config files
    return text;
  }
  try {
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText, undefined, 'utf8') as string;
    decrypted += decipher.final('utf8') as string;
    return decrypted;
  } catch (err) {
    console.error('[Crypto Error] Failed to decrypt secret. Falling back to original value.', (err as Error).message);
    return text;
  }
}

export function loadPersistedConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const fileData = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
      const persisted = JSON.parse(fileData);
      
      if (persisted.environmentMode !== undefined) {
        config.environmentMode = persisted.environmentMode;
      }
      if (persisted.oracle) {
        if (persisted.oracle.baseUrl !== undefined) config.oracle.baseUrl = persisted.oracle.baseUrl;
        if (persisted.oracle.authType !== undefined) config.oracle.authType = persisted.oracle.authType;
        if (persisted.oracle.username !== undefined) config.oracle.username = persisted.oracle.username;
        if (persisted.oracle.password !== undefined) {
          config.oracle.password = decrypt(persisted.oracle.password);
        }
        if (persisted.oracle.token !== undefined) {
          config.oracle.token = decrypt(persisted.oracle.token);
        }
      }
      console.log(`[Config] Loaded persisted configuration from ${CONFIG_FILE_PATH}`);
    }
  } catch (err) {
    console.error(`[Config Error] Failed to load persisted configuration:`, err);
  }
}

// Ensure persisted configuration is loaded on module import
loadPersistedConfig();

export function savePersistedConfig() {
  try {
    const dataToSave = {
      environmentMode: config.environmentMode,
      oracle: {
        baseUrl: config.oracle.baseUrl,
        authType: config.oracle.authType,
        username: config.oracle.username,
        password: encrypt(config.oracle.password),
        token: encrypt(config.oracle.token),
      }
    };
    
    // Write configuration atomically to prevent file corruption
    const tempFilePath = CONFIG_FILE_PATH + '.tmp';
    fs.writeFileSync(tempFilePath, JSON.stringify(dataToSave, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempFilePath, CONFIG_FILE_PATH);
    
    console.log(`[Config] Persisted configuration saved to ${CONFIG_FILE_PATH}`);
  } catch (err) {
    console.error(`[Config Error] Failed to save persisted configuration:`, err);
    throw new Error(`Failed to save configuration: ${(err as Error).message}`);
  }
}

export function validateConfig() {
  // 1. Validate AUTH_PROVIDER deployment configuration (fails closed if invalid or missing required keys)
  const providerType = config.authProvider;
  if (providerType !== 'LOCAL' && providerType !== 'ENTRA') {
    throw new Error(`[Config Error] Invalid AUTH_PROVIDER "${providerType}". Supported providers are LOCAL and ENTRA.`);
  }

  if (providerType === 'ENTRA') {
    const missing: string[] = [];
    if (!config.entra.tenantId || config.entra.tenantId.trim() === '') missing.push('ENTRA_TENANT_ID');
    if (!config.entra.clientId || config.entra.clientId.trim() === '') missing.push('ENTRA_CLIENT_ID');
    if (!config.entra.redirectUri || config.entra.redirectUri.trim() === '') missing.push('ENTRA_REDIRECT_URI');
    if (missing.length > 0) {
      throw new Error(`[Config Error] AUTH_PROVIDER is set to ENTRA, but required configuration is missing: ${missing.join(', ')}.`);
    }
  }

  // 2. Validate Oracle configuration if active
  if (config.environmentMode === 'ORACLE_FUSION') {
    if (!config.oracle.baseUrl) {
      console.warn('[Config Warning] ENVIRONMENT_MODE is set to ORACLE_FUSION, but ORACLE_FUSION_BASE_URL is missing.');
    }
  }
}
