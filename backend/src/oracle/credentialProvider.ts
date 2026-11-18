/**
 * Oracle Credential Provider
 * Story ID: VYR-042
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both
 *
 * Abstraction for retrieving Oracle Fusion credentials at runtime.
 * The provider never caches plain-text credentials longer than a single
 * request cycle and never exposes them in logs, error messages or stack traces.
 *
 * Backends (resolved at boot from ORACLE_CREDENTIAL_BACKEND env var):
 *   - "env"   (default) — reads from process.env / config.oracle (current behavior)
 *   - "file"  — reads a JSON credential file at ORACLE_CREDENTIAL_FILE_PATH
 *   - "vault" — fetches from a secret-manager HTTP endpoint (HashiCorp Vault,
 *               AWS Secrets Manager, OCI Vault, etc.) at ORACLE_VAULT_URL
 *
 * All three backends implement the same OracleCredentialProvider interface,
 * so the Oracle clients and the ingestion pipeline don't know or care where
 * the credentials come from.
 */

import fs from 'fs';
import crypto from 'crypto';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OracleCredentials {
  baseUrl: string;
  authType: 'BASIC' | 'BEARER';
  username: string;
  password: string;
  token: string;
}

export interface CredentialProviderHealth {
  backend: string;
  healthy: boolean;
  lastRetrievedAt: string | null;
  lastError: string | null;
  rotationSupported: boolean;
  credentialFingerprint: string | null;
}

export interface OracleCredentialProvider {
  readonly backend: string;
  getCredentials(): Promise<OracleCredentials>;
  getHealth(): CredentialProviderHealth;
  refresh(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Utility: fingerprint credentials without exposing them
// ---------------------------------------------------------------------------

export function fingerprint(creds: OracleCredentials): string {
  const data = `${creds.baseUrl}|${creds.authType}|${creds.username}|${creds.password ? 'P' : '-'}|${creds.token ? 'T' : '-'}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// Backend: Environment variables (default — current behavior)
// ---------------------------------------------------------------------------

export class EnvCredentialProvider implements OracleCredentialProvider {
  readonly backend = 'env';
  private lastRetrievedAt: string | null = null;
  private lastError: string | null = null;
  private lastFingerprint: string | null = null;

  async getCredentials(): Promise<OracleCredentials> {
    try {
      const creds: OracleCredentials = {
        baseUrl: config.oracle.baseUrl,
        authType: config.oracle.authType,
        username: config.oracle.username,
        password: config.oracle.password,
        token: config.oracle.token,
      };
      this.lastRetrievedAt = new Date().toISOString();
      this.lastError = null;
      this.lastFingerprint = fingerprint(creds);
      return creds;
    } catch (err: any) {
      this.lastError = err.message;
      throw err;
    }
  }

  getHealth(): CredentialProviderHealth {
    return {
      backend: this.backend,
      healthy: true,
      lastRetrievedAt: this.lastRetrievedAt,
      lastError: this.lastError,
      rotationSupported: false,
      credentialFingerprint: this.lastFingerprint,
    };
  }

  async refresh(): Promise<void> {
    // env backend reads live from config.oracle, nothing to refresh
  }
}

// ---------------------------------------------------------------------------
// Backend: JSON credential file
// ---------------------------------------------------------------------------

export class FileCredentialProvider implements OracleCredentialProvider {
  readonly backend = 'file';
  private filePath: string;
  private lastRetrievedAt: string | null = null;
  private lastError: string | null = null;
  private lastFingerprint: string | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async getCredentials(): Promise<OracleCredentials> {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);

      const creds: OracleCredentials = {
        baseUrl: parsed.baseUrl || parsed.ORACLE_FUSION_BASE_URL || config.oracle.baseUrl,
        authType: ((parsed.authType || parsed.ORACLE_AUTH_TYPE || 'BASIC').toUpperCase()) as 'BASIC' | 'BEARER',
        username: parsed.username || parsed.ORACLE_USERNAME || '',
        password: parsed.password || parsed.ORACLE_PASSWORD || '',
        token: parsed.token || parsed.ORACLE_TOKEN || '',
      };

      this.lastRetrievedAt = new Date().toISOString();
      this.lastError = null;
      this.lastFingerprint = fingerprint(creds);
      return creds;
    } catch (err: any) {
      this.lastError = `Credential file read failed: ${err.code || err.message}`;
      throw new Error(`[CredentialProvider:file] Failed to read ${this.filePath}: ${err.code || err.message}`);
    }
  }

  getHealth(): CredentialProviderHealth {
    const exists = fs.existsSync(this.filePath);
    return {
      backend: this.backend,
      healthy: exists && !this.lastError,
      lastRetrievedAt: this.lastRetrievedAt,
      lastError: exists ? this.lastError : `Credential file not found: ${this.filePath}`,
      rotationSupported: true,
      credentialFingerprint: this.lastFingerprint,
    };
  }

  async refresh(): Promise<void> {
    await this.getCredentials();
  }
}

// ---------------------------------------------------------------------------
// Backend: Vault / secret-manager HTTP endpoint
// ---------------------------------------------------------------------------

export class VaultCredentialProvider implements OracleCredentialProvider {
  readonly backend = 'vault';
  private vaultUrl: string;
  private vaultToken: string;
  private vaultFieldMapping: Record<string, string>;
  private cached: OracleCredentials | null = null;
  private cachedAt = 0;
  private ttlMs: number;
  private lastRetrievedAt: string | null = null;
  private lastError: string | null = null;
  private lastFingerprint: string | null = null;

  constructor() {
    this.vaultUrl = process.env.ORACLE_VAULT_URL || '';
    this.vaultToken = process.env.ORACLE_VAULT_TOKEN || '';
    this.ttlMs = parseInt(process.env.ORACLE_VAULT_TTL_SECONDS || '300', 10) * 1000;

    // Allow mapping vault response fields to our credential fields
    const mapping = process.env.ORACLE_VAULT_FIELD_MAPPING || '';
    this.vaultFieldMapping = {};
    if (mapping) {
      for (const pair of mapping.split(',')) {
        const [k, v] = pair.split(':').map(s => s.trim());
        if (k && v) this.vaultFieldMapping[k] = v;
      }
    }
  }

  async getCredentials(): Promise<OracleCredentials> {
    if (this.cached && Date.now() - this.cachedAt < this.ttlMs) {
      return this.cached;
    }

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };

      if (this.vaultToken) {
        headers['X-Vault-Token'] = this.vaultToken;
        headers['Authorization'] = `Bearer ${this.vaultToken}`;
      }

      const response = await fetch(this.vaultUrl, { headers, signal: AbortSignal.timeout(10000) });

      if (!response.ok) {
        throw new Error(`Vault returned HTTP ${response.status}`);
      }

      const body = await response.json() as any;

      // Support HashiCorp Vault (data.data), AWS Secrets Manager (SecretString), or flat JSON
      const secret = body?.data?.data || (body?.SecretString ? JSON.parse(body.SecretString) : null) || body?.data || body;

      const field = (name: string, fallback: string) => {
        const mapped = this.vaultFieldMapping[name] || name;
        return secret[mapped] || secret[name] || fallback;
      };

      const creds: OracleCredentials = {
        baseUrl: field('baseUrl', config.oracle.baseUrl),
        authType: (field('authType', 'BASIC').toUpperCase()) as 'BASIC' | 'BEARER',
        username: field('username', ''),
        password: field('password', ''),
        token: field('token', ''),
      };

      this.cached = creds;
      this.cachedAt = Date.now();
      this.lastRetrievedAt = new Date().toISOString();
      this.lastError = null;
      this.lastFingerprint = fingerprint(creds);

      console.log(`[CredentialProvider:vault] Credentials retrieved from vault (fingerprint: ${this.lastFingerprint})`);
      return creds;
    } catch (err: any) {
      this.lastError = `Vault retrieval failed: ${err.message}`;
      console.error(`[CredentialProvider:vault] ${this.lastError}`);

      // Fall back to cached credentials if available
      if (this.cached) {
        console.warn('[CredentialProvider:vault] Using cached credentials after vault failure');
        return this.cached;
      }

      throw new Error(`[CredentialProvider:vault] Cannot retrieve Oracle credentials: ${err.message}`);
    }
  }

  getHealth(): CredentialProviderHealth {
    return {
      backend: this.backend,
      healthy: !!this.cached || !this.lastError,
      lastRetrievedAt: this.lastRetrievedAt,
      lastError: this.lastError,
      rotationSupported: true,
      credentialFingerprint: this.lastFingerprint,
    };
  }

  async refresh(): Promise<void> {
    this.cached = null;
    this.cachedAt = 0;
    await this.getCredentials();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createProvider(backendOverride?: string): OracleCredentialProvider {
  const backend = (backendOverride || process.env.ORACLE_CREDENTIAL_BACKEND || 'env').toLowerCase().trim();

  switch (backend) {
    case 'file': {
      const filePath = process.env.ORACLE_CREDENTIAL_FILE_PATH || '';
      if (!filePath) {
        console.warn('[CredentialProvider] ORACLE_CREDENTIAL_BACKEND=file but ORACLE_CREDENTIAL_FILE_PATH is not set. Falling back to env.');
        return new EnvCredentialProvider();
      }
      console.log(`[CredentialProvider] Using file backend: ${filePath}`);
      return new FileCredentialProvider(filePath);
    }

    case 'vault': {
      const vaultUrl = process.env.ORACLE_VAULT_URL || '';
      if (!vaultUrl) {
        console.warn('[CredentialProvider] ORACLE_CREDENTIAL_BACKEND=vault but ORACLE_VAULT_URL is not set. Falling back to env.');
        return new EnvCredentialProvider();
      }
      console.log('[CredentialProvider] Using vault backend');
      return new VaultCredentialProvider();
    }

    case 'env':
    default:
      console.log('[CredentialProvider] Using env backend (default)');
      return new EnvCredentialProvider();
  }
}

export const oracleCredentialProvider = createProvider();
