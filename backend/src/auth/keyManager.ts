import crypto from 'crypto';
import fs from 'fs';
import * as jose from 'jose';
import {
  VEYRA_JWT_ALGORITHM
} from './jwtContract.js';

export interface JwkPublicKey extends jose.JWK {
  kid: string;
  alg: string;
  use: string;
  kty: string;
  n: string;
  e: string;
}

export interface JwksResponse {
  keys: JwkPublicKey[];
}

export interface SigningKeyBundle {
  privateKey: any;
  publicKey: any;
  jwk: JwkPublicKey;
  kid: string;
}

/**
 * KeyManager
 *
 * Story VYR-020: RSA Key Pair Management & JWKS Publication
 *
 * Encapsulates:
 * - Loading RSA 2048+ private/public signing keys from environment (PEM or Base64) or file paths
 * - Autonomous ephemeral RSA keypair generation for development & test environments
 * - RFC 7517 JWKS generation for public key publication (GET /.well-known/jwks.json)
 * - Key rotation support: holds active signing key while preserving rotated public keys in JWKS
 */
class KeyManager {
  private activeBundle: SigningKeyBundle | null = null;
  private rotatedJwks: Map<string, JwkPublicKey> = new Map();
  private initPromise: Promise<SigningKeyBundle> | null = null;

  /**
   * Resets internal state. Intended for automated test isolation.
   */
  public reset(): void {
    this.activeBundle = null;
    this.rotatedJwks.clear();
    this.initPromise = null;
  }

  /**
   * Formats a raw PEM string by normalizing whitespace and line breaks.
   */
  private cleanPem(raw: string): string {
    let cleaned = raw.trim();
    if (!cleaned.includes('-----BEGIN') && /^[A-Za-z0-9+/=\s]+$/.test(cleaned)) {
      try {
        const decoded = Buffer.from(cleaned, 'base64').toString('utf8');
        if (decoded.includes('-----BEGIN')) {
          cleaned = decoded.trim();
        }
      } catch {
        // Fall back to original string
      }
    }
    // Handle escaped newlines from env strings (\n)
    return cleaned.replace(/\\n/g, '\n');
  }

  /**
   * Loads a PEM from an inline env variable or a file path.
   */
  private loadPemSource(envVal?: string, filePath?: string): string | null {
    if (envVal && envVal.trim()) {
      return this.cleanPem(envVal);
    }
    if (filePath && filePath.trim() && fs.existsSync(filePath.trim())) {
      try {
        return this.cleanPem(fs.readFileSync(filePath.trim(), 'utf8'));
      } catch (err) {
        console.error(`[KeyManager] Failed to read key file from ${filePath}:`, err);
      }
    }
    return null;
  }

  /**
   * Initializes or returns the active signing key bundle.
   */
  public async getSigningKeyBundle(): Promise<SigningKeyBundle> {
    if (this.activeBundle) {
      return this.activeBundle;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.initKeyBundle();
    try {
      this.activeBundle = await this.initPromise;
      return this.activeBundle;
    } finally {
      this.initPromise = null;
    }
  }

  private async initKeyBundle(): Promise<SigningKeyBundle> {
    const kid = (process.env.JWT_KEY_ID || 'veyra-key-1').trim();
    const privPem = this.loadPemSource(process.env.JWT_PRIVATE_KEY, process.env.JWT_PRIVATE_KEY_PATH);
    const pubPem = this.loadPemSource(process.env.JWT_PUBLIC_KEY, process.env.JWT_PUBLIC_KEY_PATH);

    if (privPem) {
      try {
        const privateKey = await jose.importPKCS8(privPem, VEYRA_JWT_ALGORITHM);
        let publicKey: any;

        if (pubPem) {
          publicKey = await jose.importSPKI(pubPem, VEYRA_JWT_ALGORITHM);
        } else {
          // Derive public key from private key using Node crypto
          const privKeyObj = crypto.createPrivateKey(privPem);
          const pubKeyObj = crypto.createPublicKey(privKeyObj);
          const derivedPubPem = pubKeyObj.export({ type: 'spki', format: 'pem' }) as string;
          publicKey = await jose.importSPKI(derivedPubPem, VEYRA_JWT_ALGORITHM);
        }

        const rawJwk = await jose.exportJWK(publicKey);
        const jwk: JwkPublicKey = {
          kty: rawJwk.kty || 'RSA',
          n: rawJwk.n || '',
          e: rawJwk.e || 'AQAB',
          kid,
          alg: VEYRA_JWT_ALGORITHM,
          use: 'sig'
        };

        return { privateKey, publicKey, jwk, kid };
      } catch (err: any) {
        console.error('[KeyManager] Failed to import configured RSA key. Falling back to ephemeral key generation.', err.message);
      }
    }

    // Ephemeral RSA 2048-bit keypair generation for development & testing
    const { publicKey, privateKey } = await jose.generateKeyPair(VEYRA_JWT_ALGORITHM, {
      modulusLength: 2048,
      extractable: true
    });

    const rawJwk = await jose.exportJWK(publicKey);
    const jwk: JwkPublicKey = {
      kty: rawJwk.kty || 'RSA',
      n: rawJwk.n || '',
      e: rawJwk.e || 'AQAB',
      kid,
      alg: VEYRA_JWT_ALGORITHM,
      use: 'sig'
    };

    return { privateKey, publicKey, jwk, kid };
  }

  /**
   * Returns active Key ID.
   */
  public async getActiveKeyId(): Promise<string> {
    const bundle = await this.getSigningKeyBundle();
    return bundle.kid;
  }

  /**
   * Registers a retired/previous public key to be published in JWKS during rotation.
   */
  public async addRotatedPublicKey(pubPemOrJwk: string | JwkPublicKey, kid: string): Promise<void> {
    if (typeof pubPemOrJwk === 'object') {
      this.rotatedJwks.set(kid, { ...pubPemOrJwk, kid, alg: VEYRA_JWT_ALGORITHM, use: 'sig' });
      return;
    }

    const cleaned = this.cleanPem(pubPemOrJwk);
    const publicKey = await jose.importSPKI(cleaned, VEYRA_JWT_ALGORITHM);
    const rawJwk = await jose.exportJWK(publicKey);
    const jwk: JwkPublicKey = {
      kty: rawJwk.kty || 'RSA',
      n: rawJwk.n || '',
      e: rawJwk.e || 'AQAB',
      kid,
      alg: VEYRA_JWT_ALGORITHM,
      use: 'sig'
    };
    this.rotatedJwks.set(kid, jwk);
  }

  /**
   * Produces RFC 7517 JSON Web Key Set containing active and retired public keys.
   */
  public async getJwks(): Promise<JwksResponse> {
    const active = await this.getSigningKeyBundle();
    const keys: JwkPublicKey[] = [active.jwk];

    // Include previously configured rotated key if defined via environment
    const prevPem = this.loadPemSource(process.env.JWT_PREVIOUS_PUBLIC_KEY, process.env.JWT_PREVIOUS_PUBLIC_KEY_PATH);
    const prevKid = (process.env.JWT_PREVIOUS_KEY_ID || '').trim();
    if (prevPem && prevKid && !this.rotatedJwks.has(prevKid)) {
      try {
        await this.addRotatedPublicKey(prevPem, prevKid);
      } catch (err: any) {
        console.warn(`[KeyManager] Failed to load previous public key for rotation: ${err.message}`);
      }
    }

    for (const rotated of this.rotatedJwks.values()) {
      if (rotated.kid !== active.kid) {
        keys.push(rotated);
      }
    }

    return { keys };
  }
}

export const keyManager = new KeyManager();
