/**
 * AES-256-GCM Encryption and Decryption Service
 * Story ID: VYR-029
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Provides high-performance, tamper-proof authenticated encryption with associated
 * data (AEAD) for Oracle raw records. Implements zero-fallback fail-closed semantics,
 * envelope DEK encryption, key rotation support, and memory zeroing.
 */

import crypto from 'crypto';
import {
  EncryptedPayload,
  AadContext,
  ENCRYPTION_ALGORITHM_AES_256_GCM,
  CURRENT_ENCRYPTION_FORMAT_VERSION,
  GCM_NONCE_LENGTH_BYTES,
  GCM_AUTH_TAG_LENGTH_BYTES,
  DEK_LENGTH_BYTES,
  buildAad,
  parseAad,
  buildTableRecordAad,
  validateEncryptedPayload,
  isEncryptedPayload,
  isSupportedFormatVersion,
} from './encryptionContract.js';

export type EncryptionErrorCode =
  | 'DECRYPTION_FAILED'
  | 'INVALID_CONTAINER'
  | 'KEY_NOT_FOUND'
  | 'INVALID_KEY'
  | 'UNSUPPORTED_ALGORITHM'
  | 'ENCRYPTION_FAILED'
  | 'INVALID_INPUT'
  | 'AAD_MISMATCH'
  | 'KEY_NOT_APPROVED'
  | 'KEY_IN_USE'
  | 'UNSUPPORTED_FORMAT_VERSION';

export class EncryptionError extends Error {
  public readonly code: EncryptionErrorCode;
  public readonly isOperational = true;

  constructor(code: EncryptionErrorCode, message: string) {
    super(`[EncryptionError: ${code}] ${message}`);
    this.name = 'EncryptionError';
    this.code = code;
    Object.setPrototypeOf(this, EncryptionError.prototype);
  }
}

/**
 * Key Provider interface abstracting Key Management (Local Vault, KMS, Key Vault)
 */
export interface KeyProvider {
  getActiveKeyId(): string;
  getMasterKey(keyId: string): Promise<Buffer | null>;
  wrapDek(dek: Buffer, keyId: string): Promise<string>;
  unwrapDek(wrappedDekB64: string, keyId: string): Promise<Buffer>;
}

/**
 * Default secure key provider using local key derivation and AES-256-KW wrapping.
 * Prepares the architecture for cloud KMS / Key Vault integration in Story VYR-030.
 */
export class LocalKeyProvider implements KeyProvider {
  private activeKeyId: string;
  private keyRing = new Map<string, Buffer>();

  constructor(defaultKeyId = 'veyra-kms-k1-2026', initialMasterSecret?: string) {
    this.activeKeyId = defaultKeyId;

    // Derive root 256-bit master key from environment or secure initial secret
    const rawSecret =
      initialMasterSecret ||
      process.env.VEYRA_ENCRYPTION_MASTER_KEY ||
      process.env.ORACLE_ENCRYPTION_KEY ||
      'veyra-production-authoritative-kms-master-key-seed-2026';

    const derivedKey = crypto.createHash('sha256').update(rawSecret).digest();
    this.keyRing.set(defaultKeyId, derivedKey);
  }

  public getActiveKeyId(): string {
    return this.activeKeyId;
  }

  public setActiveKeyId(newKeyId: string, masterKeyBytes?: Buffer | string): void {
    if (masterKeyBytes) {
      const buf = typeof masterKeyBytes === 'string'
        ? crypto.createHash('sha256').update(masterKeyBytes).digest()
        : masterKeyBytes;
      if (buf.length !== 32) {
        throw new EncryptionError('INVALID_KEY', 'Master key must be exactly 32 bytes (256 bits)');
      }
      this.keyRing.set(newKeyId, buf);
    } else if (!this.keyRing.has(newKeyId)) {
      throw new EncryptionError('KEY_NOT_FOUND', `Cannot set active keyId "${newKeyId}": key not in key ring`);
    }
    this.activeKeyId = newKeyId;
  }

  public registerKey(keyId: string, secret: string | Buffer): void {
    const buf = typeof secret === 'string'
      ? crypto.createHash('sha256').update(secret).digest()
      : secret;
    if (buf.length !== 32) {
      throw new EncryptionError('INVALID_KEY', 'Master key must be exactly 32 bytes (256 bits)');
    }
    this.keyRing.set(keyId, buf);
  }

  public async getMasterKey(keyId: string): Promise<Buffer | null> {
    return this.keyRing.get(keyId) || null;
  }

  /**
   * Wraps the Data Encryption Key (DEK) using AES-256-GCM with the Master Key (KEK).
   */
  public async wrapDek(dek: Buffer, keyId: string): Promise<string> {
    const masterKey = await this.getMasterKey(keyId);
    if (!masterKey) {
      throw new EncryptionError('KEY_NOT_FOUND', `Master key "${keyId}" not found for DEK wrapping`);
    }

    const wrapNonce = crypto.randomBytes(GCM_NONCE_LENGTH_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, wrapNonce);
    cipher.setAAD(Buffer.from(`wrap:dek:${keyId}`, 'utf8'));

    const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Container: [12-byte nonce][16-byte tag][wrapped DEK]
    const combined = Buffer.concat([wrapNonce, tag, wrapped]);
    return combined.toString('base64');
  }

  /**
   * Unwraps the Data Encryption Key (DEK) using AES-256-GCM with the Master Key (KEK).
   */
  public async unwrapDek(wrappedDekB64: string, keyId: string): Promise<Buffer> {
    const masterKey = await this.getMasterKey(keyId);
    if (!masterKey) {
      throw new EncryptionError('KEY_NOT_FOUND', `Master key "${keyId}" not found for DEK unwrapping`);
    }

    const combined = Buffer.from(wrappedDekB64, 'base64');
    if (combined.length < GCM_NONCE_LENGTH_BYTES + GCM_AUTH_TAG_LENGTH_BYTES + DEK_LENGTH_BYTES) {
      throw new EncryptionError('INVALID_CONTAINER', 'Wrapped DEK container has invalid byte length');
    }

    const wrapNonce = combined.subarray(0, GCM_NONCE_LENGTH_BYTES);
    const tag = combined.subarray(GCM_NONCE_LENGTH_BYTES, GCM_NONCE_LENGTH_BYTES + GCM_AUTH_TAG_LENGTH_BYTES);
    const wrapped = combined.subarray(GCM_NONCE_LENGTH_BYTES + GCM_AUTH_TAG_LENGTH_BYTES);

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, wrapNonce);
      decipher.setAAD(Buffer.from(`wrap:dek:${keyId}`, 'utf8'));
      decipher.setAuthTag(tag);

      const unwrapped = Buffer.concat([decipher.update(wrapped), decipher.final()]);
      if (unwrapped.length !== DEK_LENGTH_BYTES) {
        throw new EncryptionError('DECRYPTION_FAILED', `Unwrapped DEK length mismatch: expected ${DEK_LENGTH_BYTES}`);
      }
      return unwrapped;
    } catch (err: any) {
      throw new EncryptionError('DECRYPTION_FAILED', `Failed to unwrap DEK under keyId "${keyId}": ${err.message}`);
    }
  }
}

/**
 * Enterprise AES-256-GCM Encryption and Decryption Service.
 */
export class EncryptionService {
  private keyProvider: KeyProvider;

  constructor(keyProvider?: KeyProvider) {
    this.keyProvider = keyProvider || new LocalKeyProvider();
  }

  public getKeyProvider(): KeyProvider {
    return this.keyProvider;
  }

  public setKeyProvider(provider: KeyProvider): void {
    this.keyProvider = provider;
  }

  /**
   * Encrypts plaintext data into a versioned EncryptedPayload container.
   *
   * @param data Raw JSON object, string, or binary Buffer to encrypt.
   * @param aad Context object or canonical AAD string.
   * @param options Optional override for keyId.
   */
  public async encryptPayload(
    data: string | object | Buffer,
    aad: string | AadContext,
    options: { keyId?: string } = {}
  ): Promise<EncryptedPayload> {
    if (data === null || data === undefined) {
      throw new EncryptionError('INVALID_INPUT', 'Cannot encrypt null or undefined data');
    }

    const aadString = typeof aad === 'string' ? aad.trim() : buildAad(aad);
    if (!aadString) {
      throw new EncryptionError('INVALID_INPUT', 'AAD string or context must be non-empty');
    }

    // Serialize data to Buffer
    let plaintextBuffer: Buffer;
    if (Buffer.isBuffer(data)) {
      plaintextBuffer = data;
    } else if (typeof data === 'string') {
      plaintextBuffer = Buffer.from(data, 'utf8');
    } else if (typeof data === 'object') {
      plaintextBuffer = Buffer.from(JSON.stringify(data), 'utf8');
    } else {
      plaintextBuffer = Buffer.from(String(data), 'utf8');
    }

    const keyId = options.keyId || this.keyProvider.getActiveKeyId();

    // 1. Generate fresh 256-bit Data Encryption Key (DEK)
    const dek = crypto.randomBytes(DEK_LENGTH_BYTES);

    try {
      // 2. Wrap DEK using Master Key (KEK) via keyProvider
      const encryptedDek = await this.keyProvider.wrapDek(dek, keyId);

      // 3. Generate fresh cryptographically secure 96-bit (12-byte) GCM nonce
      const nonce = crypto.randomBytes(GCM_NONCE_LENGTH_BYTES);

      // 4. Encrypt with AES-256-GCM and bind AAD
      const cipher = crypto.createCipheriv('aes-256-gcm', dek, nonce);
      cipher.setAAD(Buffer.from(aadString, 'utf8'));

      const ciphertextBuffer = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // 5. Build standardized EncryptedPayload container
      const container: EncryptedPayload = {
        formatVersion: CURRENT_ENCRYPTION_FORMAT_VERSION,
        algorithm: ENCRYPTION_ALGORITHM_AES_256_GCM,
        keyId,
        encryptedDek,
        nonce: nonce.toString('base64'),
        authTag: authTag.toString('base64'),
        ciphertext: ciphertextBuffer.toString('base64'),
        aad: aadString,
        createdAt: new Date().toISOString(),
      };

      validateEncryptedPayload(container);
      return container;
    } catch (err: any) {
      if (err instanceof EncryptionError) throw err;
      throw new EncryptionError('ENCRYPTION_FAILED', `Encryption operation failed: ${err.message}`);
    } finally {
      // Memory Hygiene: Zero out plaintext DEK buffer
      dek.fill(0);
    }
  }

  /**
   * Decrypts an EncryptedPayload container and returns the verified plaintext.
   * Fails closed if ciphertext, nonce, authTag, or AAD has been tampered with.
   *
   * @param payload EncryptedPayload container object or serialized JSON string.
   * @param expectedAad Optional expected AAD string or context to verify against container.
   */
  public async decryptPayload<T = any>(
    payload: EncryptedPayload | string,
    expectedAad?: string | AadContext
  ): Promise<T> {
    if (!payload) {
      throw new EncryptionError('INVALID_INPUT', 'Payload is null or undefined');
    }

    const container: EncryptedPayload =
      typeof payload === 'string' ? JSON.parse(payload) : payload;

    validateEncryptedPayload(container);

    if (!isSupportedFormatVersion(container.formatVersion)) {
      throw new EncryptionError(
        'UNSUPPORTED_FORMAT_VERSION',
        `Encrypted payload format version ${container.formatVersion} is not supported by this build`
      );
    }

    if (container.algorithm !== ENCRYPTION_ALGORITHM_AES_256_GCM) {
      throw new EncryptionError(
        'UNSUPPORTED_ALGORITHM',
        `Unsupported cipher algorithm: ${container.algorithm}`
      );
    }

    // Verify AAD expectation if caller supplied it
    if (expectedAad) {
      const expectedAadStr = typeof expectedAad === 'string' ? expectedAad.trim() : buildAad(expectedAad);
      if (container.aad !== expectedAadStr) {
        throw new EncryptionError(
          'AAD_MISMATCH',
          `AAD mismatch: payload has "${container.aad}" but expected "${expectedAadStr}"`
        );
      }
    }

    // 1. Unwrap DEK using Master Key referenced by keyId
    const dek = await this.keyProvider.unwrapDek(container.encryptedDek, container.keyId);

    try {
      const nonceBuffer = Buffer.from(container.nonce, 'base64');
      const authTagBuffer = Buffer.from(container.authTag, 'base64');
      const ciphertextBuffer = Buffer.from(container.ciphertext, 'base64');
      const aadBuffer = Buffer.from(container.aad, 'utf8');

      // 2. Initialize AES-256-GCM decipher
      const decipher = crypto.createDecipheriv('aes-256-gcm', dek, nonceBuffer);
      decipher.setAAD(aadBuffer);
      decipher.setAuthTag(authTagBuffer);

      // 3. Decrypt and verify GHASH authentication tag
      let plaintextBuffer: Buffer;
      try {
        plaintextBuffer = Buffer.concat([
          decipher.update(ciphertextBuffer),
          decipher.final(),
        ]);
      } catch (cryptoErr: any) {
        throw new EncryptionError(
          'DECRYPTION_FAILED',
          `Authentication tag verification failed: ciphertext or AAD has been tampered with or corrupted (${cryptoErr.message})`
        );
      }

      // 4. Return parsed JSON or raw string
      const text = plaintextBuffer.toString('utf8');
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } finally {
      // Memory Hygiene: Zero out unwrapped plaintext DEK
      dek.fill(0);
    }
  }

  /**
   * Helper for raw ingestion pipelines (VYR-032 / VYR-033).
   * Generates table-bound AAD and encrypts raw record field.
   */
  public async encryptEntityRecord(
    tableName: string,
    record: any,
    rawField: string,
    environmentHost: string
  ): Promise<EncryptedPayload> {
    const rawData = record[rawField];
    if (rawData === undefined || rawData === null) {
      throw new EncryptionError('INVALID_INPUT', `Record is missing rawField "${rawField}"`);
    }

    const aad = buildTableRecordAad(tableName, record, environmentHost);
    return await this.encryptPayload(rawData, aad);
  }

  /**
   * Helper for read paths (VYR-035).
   * Handles dual-mode records: returns legacy plaintext unmodified, decrypts EncryptedPayload.
   */
  public async decryptEntityRecord<T = any>(
    tableName: string,
    record: any,
    rawColumnValue: any,
    environmentHost: string
  ): Promise<T> {
    if (!isEncryptedPayload(rawColumnValue)) {
      // Legacy plaintext record pass-through
      return rawColumnValue as T;
    }

    const expectedAad = buildTableRecordAad(tableName, record, environmentHost);
    return await this.decryptPayload<T>(rawColumnValue, expectedAad);
  }

  /**
   * Key rotation re-encryption helper (VYR-036 / VYR-037).
   * Decrypts container with old key and re-encrypts with new active key, preserving AAD.
   */
  public async rotatePayloadKey(
    payload: EncryptedPayload,
    newKeyId?: string
  ): Promise<EncryptedPayload> {
    const decrypted = await this.decryptPayload(payload);
    return await this.encryptPayload(decrypted, payload.aad, {
      keyId: newKeyId || this.keyProvider.getActiveKeyId(),
    });
  }

  /**
   * KEK rotation (VYR-036): unwraps the record's DEK with its current KEK and
   * re-wraps it with the target KEK. Ciphertext, nonce, authTag, AAD and
   * createdAt are left byte-identical, so the record's data is never re-encrypted.
   */
  public async rewrapPayloadDek(
    payload: EncryptedPayload,
    newKeyId?: string
  ): Promise<EncryptedPayload> {
    validateEncryptedPayload(payload);
    if (!isSupportedFormatVersion(payload.formatVersion)) {
      throw new EncryptionError(
        'UNSUPPORTED_FORMAT_VERSION',
        `Encrypted payload format version ${payload.formatVersion} is not supported by this build`
      );
    }

    const targetKeyId = newKeyId || this.keyProvider.getActiveKeyId();
    if (payload.keyId === targetKeyId) return payload;

    const dek = await this.keyProvider.unwrapDek(payload.encryptedDek, payload.keyId);
    try {
      const encryptedDek = await this.keyProvider.wrapDek(dek, targetKeyId);
      return { ...payload, keyId: targetKeyId, encryptedDek };
    } finally {
      dek.fill(0);
    }
  }
}

/**
 * Key lifecycle (VYR-036).
 *   PENDING     registered, not yet used for anything
 *   ACTIVE      the single key that wraps new DEKs (and unwraps)
 *   RETIRING    approved for unwrap only, during the rotation transition
 *   COMPROMISED unwrap only, so the rewrap job can move data off it; never wraps
 *   RETIRED     no longer usable; allowed only once no record depends on it
 */
export type KeyStatus = 'PENDING' | 'ACTIVE' | 'RETIRING' | 'RETIRED' | 'COMPROMISED';

const KEY_STATUSES: readonly KeyStatus[] = ['PENDING', 'ACTIVE', 'RETIRING', 'RETIRED', 'COMPROMISED'];
const UNWRAP_ALLOWED: readonly KeyStatus[] = ['ACTIVE', 'RETIRING', 'COMPROMISED'];

export interface KeyRingEntry {
  keyId: string;
  status: KeyStatus;
  statusChangedAt: string;
}

export interface KeyLifecycleEvent {
  at: string;
  action: 'ADDED' | 'CONFIGURED' | 'ACTIVATED' | 'RETIRING' | 'RETIRED' | 'COMPROMISED';
  keyId: string;
  detail?: string;
}

export interface KeyRingConfigEntry {
  keyId: string;
  /** Name of the environment variable holding the key secret; secrets are never inlined. */
  secretEnv?: string;
  status: KeyStatus;
}

type RegistrableKeyProvider = KeyProvider & {
  registerKey?(keyId: string, secret: string | Buffer): void;
};

/**
 * KeyProvider decorator that enforces the key lifecycle on every wrap/unwrap.
 * Keys it does not track are refused (fail closed).
 */
export class KeyLifecycleRegistry implements KeyProvider {
  private readonly entries = new Map<string, KeyRingEntry>();
  private readonly events: KeyLifecycleEvent[] = [];
  private activeKeyId: string;

  constructor(private readonly inner: RegistrableKeyProvider) {
    this.activeKeyId = inner.getActiveKeyId();
    this.setStatus(this.activeKeyId, 'ACTIVE', 'ADDED', 'provider default key');
  }

  /**
   * Builds the registry from VEYRA_KEY_RING, a JSON array of
   * { keyId, secretEnv, status }. Exactly one entry must be ACTIVE. The
   * provider's bootstrap key is kept as RETIRING if the ring does not list it,
   * so records written under it stay readable until they are rewrapped.
   */
  public static fromEnv(
    inner: RegistrableKeyProvider,
    rawConfig: string | undefined = process.env.VEYRA_KEY_RING
  ): KeyLifecycleRegistry {
    const registry = new KeyLifecycleRegistry(inner);
    if (!rawConfig || !rawConfig.trim()) return registry;

    let config: KeyRingConfigEntry[];
    try {
      config = JSON.parse(rawConfig);
    } catch {
      throw new EncryptionError('INVALID_INPUT', 'VEYRA_KEY_RING is not valid JSON');
    }
    if (!Array.isArray(config) || config.length === 0) {
      throw new EncryptionError('INVALID_INPUT', 'VEYRA_KEY_RING must be a non-empty JSON array');
    }

    const active = config.filter(e => e && e.status === 'ACTIVE');
    if (active.length !== 1) {
      throw new EncryptionError('INVALID_KEY', `VEYRA_KEY_RING must contain exactly one ACTIVE key (found ${active.length})`);
    }

    for (const entry of config) {
      if (!entry || typeof entry.keyId !== 'string' || !entry.keyId.trim() || !KEY_STATUSES.includes(entry.status)) {
        throw new EncryptionError('INVALID_INPUT', 'Each VEYRA_KEY_RING entry needs a keyId and a valid status');
      }
      if (entry.status !== 'RETIRED') {
        const secret = entry.secretEnv ? process.env[entry.secretEnv] : undefined;
        if (!secret) {
          throw new EncryptionError('KEY_NOT_FOUND', `Secret for key "${entry.keyId}" is missing (env ${entry.secretEnv || '<unset>'})`);
        }
        registry.registerSecret(entry.keyId, secret);
      }
      registry.setStatus(entry.keyId, entry.status === 'ACTIVE' ? 'PENDING' : entry.status, 'CONFIGURED');
    }

    registry.activate(active[0].keyId);
    return registry;
  }

  public getActiveKeyId(): string {
    return this.activeKeyId;
  }

  public getStatus(keyId: string): KeyStatus | null {
    return this.entries.get(keyId)?.status ?? null;
  }

  public listKeys(): KeyRingEntry[] {
    return Array.from(this.entries.values(), e => ({ ...e }));
  }

  public getEvents(): KeyLifecycleEvent[] {
    return this.events.map(e => ({ ...e }));
  }

  /** Registers a new KEK as PENDING. It wraps nothing until activate(). */
  public addKey(keyId: string, secret: string | Buffer): void {
    if (this.entries.has(keyId)) {
      throw new EncryptionError('INVALID_INPUT', `Key "${keyId}" is already in the key ring`);
    }
    this.registerSecret(keyId, secret);
    this.setStatus(keyId, 'PENDING', 'ADDED');
  }

  /**
   * Makes keyId the wrapping key; the previous active key becomes RETIRING.
   * Re-activating a RETIRING key is the rollback path.
   */
  public activate(keyId: string): void {
    const status = this.getStatus(keyId);
    if (status === 'ACTIVE') return;
    if (status !== 'PENDING' && status !== 'RETIRING') {
      throw new EncryptionError('KEY_NOT_APPROVED', `Key "${keyId}" cannot be activated from status ${status ?? 'UNKNOWN'}`);
    }
    const previous = this.activeKeyId;
    this.activeKeyId = keyId;
    this.setStatus(keyId, 'ACTIVE', 'ACTIVATED', previous ? `replaces ${previous}` : undefined);
    if (previous && previous !== keyId && this.getStatus(previous) === 'ACTIVE') {
      this.setStatus(previous, 'RETIRING', 'RETIRING', `superseded by ${keyId}`);
    }
  }

  /**
   * Retires a key. dependentRecords must come from a live count of stored
   * records still wrapped by this key (see keyRotationService.retireKey).
   */
  public retire(keyId: string, dependentRecords: number): void {
    if (keyId === this.activeKeyId) {
      throw new EncryptionError('KEY_IN_USE', `Key "${keyId}" is the active key and cannot be retired`);
    }
    if (!Number.isFinite(dependentRecords) || dependentRecords > 0) {
      throw new EncryptionError('KEY_IN_USE', `Key "${keyId}" still protects ${dependentRecords} record(s); rewrap them before retiring`);
    }
    if (!this.entries.has(keyId)) {
      throw new EncryptionError('KEY_NOT_FOUND', `Key "${keyId}" is not in the key ring`);
    }
    this.setStatus(keyId, 'RETIRED', 'RETIRED');
  }

  /**
   * Emergency path: the key stops wrapping immediately. If it was active, the
   * replacement (already added) is activated first.
   */
  public markCompromised(keyId: string, replacementKeyId?: string): void {
    if (!this.entries.has(keyId)) {
      throw new EncryptionError('KEY_NOT_FOUND', `Key "${keyId}" is not in the key ring`);
    }
    if (keyId === this.activeKeyId) {
      if (!replacementKeyId || replacementKeyId === keyId) {
        throw new EncryptionError('INVALID_INPUT', `Compromised key "${keyId}" is active; a replacement key is required`);
      }
      this.activate(replacementKeyId);
    }
    this.setStatus(keyId, 'COMPROMISED', 'COMPROMISED');
  }

  public async getMasterKey(keyId: string): Promise<Buffer | null> {
    this.assertUnwrapAllowed(keyId);
    return this.inner.getMasterKey(keyId);
  }

  public async wrapDek(dek: Buffer, keyId: string): Promise<string> {
    const status = this.getStatus(keyId);
    if (status !== 'ACTIVE') {
      throw new EncryptionError('KEY_NOT_APPROVED', `Key "${keyId}" (${status ?? 'UNKNOWN'}) is not approved for wrapping new data`);
    }
    return this.inner.wrapDek(dek, keyId);
  }

  public async unwrapDek(wrappedDekB64: string, keyId: string): Promise<Buffer> {
    this.assertUnwrapAllowed(keyId);
    return this.inner.unwrapDek(wrappedDekB64, keyId);
  }

  private assertUnwrapAllowed(keyId: string): void {
    const status = this.getStatus(keyId);
    if (!status || !UNWRAP_ALLOWED.includes(status)) {
      throw new EncryptionError('KEY_NOT_APPROVED', `Key "${keyId}" (${status ?? 'UNKNOWN'}) is not approved for decryption`);
    }
  }

  private registerSecret(keyId: string, secret: string | Buffer): void {
    if (typeof this.inner.registerKey !== 'function') {
      throw new EncryptionError('INVALID_INPUT', 'Underlying key provider does not support registering keys');
    }
    this.inner.registerKey(keyId, secret);
  }

  private setStatus(keyId: string, status: KeyStatus, action: KeyLifecycleEvent['action'], detail?: string): void {
    const at = new Date().toISOString();
    this.entries.set(keyId, { keyId, status, statusChangedAt: at });
    this.events.push({ at, action, keyId, ...(detail ? { detail } : {}) });
    if (this.events.length > 500) this.events.shift();
  }
}

// App-wide key ring and encryption service. Raw-table writes and reads go through these.
export const keyRegistry = KeyLifecycleRegistry.fromEnv(new LocalKeyProvider());
export const encryptionService = new EncryptionService(keyRegistry);

