/**
 * Oracle Raw-Data Encryption Contract, AAD & Storage Schema Specification
 * Story ID: VYR-028
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Defines the versioned EncryptedPayload data model, Additional Authenticated Data (AAD)
 * construction, key rotation identifiers, envelope encryption metadata, and dual-mode
 * legacy/encrypted payload discrimination helpers.
 */

export const ENCRYPTION_ALGORITHM_AES_256_GCM = 'AES-256-GCM';
export const CURRENT_ENCRYPTION_FORMAT_VERSION = 1;

/**
 * Format versions this build can decrypt (VYR-036). A new format is added here
 * before any writer emits it, and removed only after no stored record uses it.
 */
export const SUPPORTED_ENCRYPTION_FORMAT_VERSIONS: readonly number[] = [1];

export function isSupportedFormatVersion(version: number): boolean {
  return SUPPORTED_ENCRYPTION_FORMAT_VERSIONS.includes(version);
}
export const DEFAULT_SCHEMA_VERSION = 'v1';

// Cryptographic parameters for AES-256-GCM
export const GCM_NONCE_LENGTH_BYTES = 12; // 96-bit recommended nonce size for GCM
export const GCM_AUTH_TAG_LENGTH_BYTES = 16; // 128-bit authentication tag
export const DEK_LENGTH_BYTES = 32; // 256-bit AES Data Encryption Key

/**
 * Standard versioned EncryptedPayload contract.
 * Usable across background sync ingestion jobs (Epic 5), REST controllers (Epic 4),
 * and Node.js decryption services (VYR-035).
 */
export interface EncryptedPayload {
  /**
   * Version of the encrypted container schema (currently 1).
   * Ensures future cryptographic migrations (e.g. post-quantum algorithms) can be identified.
   */
  formatVersion: number;

  /**
   * Cryptographic cipher algorithm used. Always 'AES-256-GCM' in Epic 4.
   */
  algorithm: string;

  /**
   * Key identifier referencing the Key Encryption Key (KEK) / Master Key in KMS or Key Vault.
   * Enables seamless decryption of records after key rotation.
   */
  keyId: string;

  /**
   * Envelope-encrypted Data Encryption Key (DEK), encoded in standard Base64.
   * If a direct KMS key reference or key alias is used without envelope, this holds the key reference.
   */
  encryptedDek: string;

  /**
   * Cryptographically secure 96-bit initialization vector / nonce, Base64-encoded.
   * MUST be fresh and unique for every single encryption operation.
   */
  nonce: string;

  /**
   * 128-bit GCM authentication tag, Base64-encoded.
   * Verifies ciphertext and AAD integrity before decryption.
   */
  authTag: string;

  /**
   * Encrypted ciphertext bytes of the plaintext payload (e.g. JSON string), Base64-encoded.
   */
  ciphertext: string;

  /**
   * Canonical AAD string bound to this ciphertext at time of encryption.
   * Included for auditing, verification, and tamper detection.
   */
  aad: string;

  /**
   * ISO 8601 timestamp when the encryption operation occurred.
   */
  createdAt: string;
}

/**
 * Structured Additional Authenticated Data (AAD) context parameters.
 * Guarantees ciphertext cannot be transposed or spliced across tenants, tables, or records.
 */
export interface AadContext {
  /**
   * Environment host (e.g., 'eiiv-dev14.fa.us6.oraclecloud.com').
   * Prevents cross-tenant ciphertext transplantation.
   */
  tenant: string;

  /**
   * PostgreSQL table or domain name (e.g., 'oracle_raw_users').
   * Prevents moving ciphertext from one table to another.
   */
  table: string;

  /**
   * Stable natural primary key of the entity record (e.g., username, control_id, record_unique_hash).
   * Prevents moving ciphertext between two records in the same table.
   */
  recordId: string;

  /**
   * Version of the record schema (default 'v1').
   */
  schemaVersion?: string;
}

/**
 * Generates the deterministic, canonical AAD string from context.
 * Format: "tenant=<host>|table=<table>|id=<recordId>|v=<version>"
 * Any pipe (|) or equals (=) characters in inputs are escaped to prevent injection attacks.
 */
export function buildAad(context: AadContext): string {
  const sanitize = (val: string) => String(val || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/=/g, '\\=');
  const tenant = sanitize(context.tenant.trim().toLowerCase());
  const table = sanitize(context.table.trim().toLowerCase());
  const recordId = sanitize(context.recordId.trim());
  const version = sanitize(context.schemaVersion || DEFAULT_SCHEMA_VERSION);

  return `tenant=${tenant}|table=${table}|id=${recordId}|v=${version}`;
}

/**
 * Parses a canonical AAD string back into structured components.
 */
export function parseAad(aadString: string): AadContext {
  if (!aadString || typeof aadString !== 'string') {
    throw new Error('Invalid AAD: string is empty or not provided');
  }

  const parts = aadString.split(/(?<!\\)\|/);
  const map: Record<string, string> = {};

  for (const part of parts) {
    const unescapedPart = part.replace(/\\\|/g, '|');
    const eqIdx = unescapedPart.indexOf('=');
    if (eqIdx !== -1) {
      const k = unescapedPart.slice(0, eqIdx);
      const v = unescapedPart.slice(eqIdx + 1).replace(/\\\\/g, '\\').replace(/\\=/g, '=');
      map[k] = v;
    }
  }

  if (!map.tenant || !map.table || !map.id) {
    throw new Error(`Malformed canonical AAD string: missing required fields in "${aadString}"`);
  }

  return {
    tenant: map.tenant,
    table: map.table,
    recordId: map.id,
    schemaVersion: map.v || DEFAULT_SCHEMA_VERSION,
  };
}

/**
 * Validates the cryptographic structure and encoding of an EncryptedPayload container.
 * Returns true if valid, throws an Error with details if invalid.
 */
export function validateEncryptedPayload(payload: any): payload is EncryptedPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('EncryptedPayload must be a non-null object');
  }

  if (typeof payload.formatVersion !== 'number' || payload.formatVersion < 1) {
    throw new Error(`Invalid formatVersion: expected positive number, got ${payload.formatVersion}`);
  }

  if (payload.algorithm !== ENCRYPTION_ALGORITHM_AES_256_GCM) {
    throw new Error(`Unsupported algorithm: expected ${ENCRYPTION_ALGORITHM_AES_256_GCM}, got ${payload.algorithm}`);
  }

  if (!payload.keyId || typeof payload.keyId !== 'string' || !payload.keyId.trim()) {
    throw new Error('Missing or empty keyId in EncryptedPayload');
  }

  if (typeof payload.encryptedDek !== 'string') {
    throw new Error('Missing encryptedDek in EncryptedPayload');
  }

  // Nonce validation: 12 bytes = 16 Base64 characters
  if (!payload.nonce || typeof payload.nonce !== 'string') {
    throw new Error('Missing nonce in EncryptedPayload');
  }
  const nonceBytes = Buffer.from(payload.nonce, 'base64');
  if (nonceBytes.length !== GCM_NONCE_LENGTH_BYTES) {
    throw new Error(`Invalid nonce byte length: expected ${GCM_NONCE_LENGTH_BYTES} bytes, got ${nonceBytes.length}`);
  }

  // AuthTag validation: 16 bytes = 24 Base64 characters
  if (!payload.authTag || typeof payload.authTag !== 'string') {
    throw new Error('Missing authTag in EncryptedPayload');
  }
  const authTagBytes = Buffer.from(payload.authTag, 'base64');
  if (authTagBytes.length !== GCM_AUTH_TAG_LENGTH_BYTES) {
    throw new Error(`Invalid authTag byte length: expected ${GCM_AUTH_TAG_LENGTH_BYTES} bytes, got ${authTagBytes.length}`);
  }

  // Ciphertext validation
  if (!payload.ciphertext || typeof payload.ciphertext !== 'string') {
    throw new Error('Missing or empty ciphertext in EncryptedPayload');
  }

  // AAD validation
  if (!payload.aad || typeof payload.aad !== 'string') {
    throw new Error('Missing AAD string in EncryptedPayload');
  }

  return true;
}

/**
 * Discriminates between an EncryptedPayload container and a legacy plaintext JSON record.
 * Used during the dual-mode migration window (Stories VYR-035 & VYR-037).
 */
export function isEncryptedPayload(value: any): value is EncryptedPayload {
  if (!value || typeof value !== 'object') return false;
  return (
    typeof value.formatVersion === 'number' &&
    value.algorithm === ENCRYPTION_ALGORITHM_AES_256_GCM &&
    typeof value.keyId === 'string' &&
    typeof value.nonce === 'string' &&
    typeof value.authTag === 'string' &&
    typeof value.ciphertext === 'string'
  );
}

/**
 * Deterministic serializer for EncryptedPayload into PostgreSQL JSONB representation.
 */
export function serializeEncryptedPayload(payload: EncryptedPayload): string {
  validateEncryptedPayload(payload);
  return JSON.stringify({
    formatVersion: payload.formatVersion,
    algorithm: payload.algorithm,
    keyId: payload.keyId,
    encryptedDek: payload.encryptedDek,
    nonce: payload.nonce,
    authTag: payload.authTag,
    ciphertext: payload.ciphertext,
    aad: payload.aad,
    createdAt: payload.createdAt,
  });
}

/**
 * Parses and validates an EncryptedPayload from a raw JSON string or JSONB object.
 */
export function parseEncryptedPayload(raw: string | object): EncryptedPayload {
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  validateEncryptedPayload(obj);
  return obj as EncryptedPayload;
}

/**
 * Standard table-to-natural-id extractor for generating AAD in accordance with the VYR-027 matrix.
 */
export function getRecordNaturalId(tableName: string, record: any): string {
  if (!record || typeof record !== 'object') {
    throw new Error(`Cannot extract record natural ID: record is invalid for table ${tableName}`);
  }

  switch (tableName) {
    case 'oracle_raw_audit_records':
      return String(record.record_unique_hash || record.recordUniqueHash || record.id || '').trim();
    case 'oracle_raw_users':
      return String(record.username || record.userName || record.id || '').trim();
    case 'oracle_raw_roles':
      return String(record.role_code || record.roleCode || record.id || '').trim();
    case 'oracle_raw_role_hierarchy':
      return `${record.parent_role_name || record.parentRole || ''}:${record.child_role_name || record.childRole || ''}`.trim();
    case 'oracle_raw_controls':
    case 'oracle_control_incidents':
      return String(record.control_id || record.controlId || record.id || '').trim();
    case 'oracle_incident_rows':
      return `${record.control_id || record.controlId || ''}:${record.ord !== undefined ? record.ord : ''}`.trim();
    case 'oracle_raw_access_certifications':
      return String(record.certification_id || record.certificationId || record.id || '').trim();
    case 'oracle_raw_certifier_worksheets':
      return `${record.certification_id || record.certificationId || ''}:${record.id !== undefined ? record.id : ''}`.trim();
    case 'oracle_raw_user_access':
      return `${record.username || record.userName || ''}:${record.role_code || record.roleCode || ''}`.trim();
    default:
      if (record.id) return String(record.id).trim();
      throw new Error(`Unmapped table "${tableName}" for AAD natural ID extraction`);
  }
}

/**
 * Builds the canonical AAD string for a specific PostgreSQL table row.
 */
export function buildTableRecordAad(
  tableName: string,
  record: any,
  environmentHost: string,
  schemaVersion = DEFAULT_SCHEMA_VERSION
): string {
  const recordId = getRecordNaturalId(tableName, record);
  if (!recordId) {
    throw new Error(`Missing natural identifier for table "${tableName}" row when constructing AAD`);
  }

  return buildAad({
    tenant: environmentHost,
    table: tableName,
    recordId,
    schemaVersion,
  });
}
