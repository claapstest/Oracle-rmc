/**
 * Service Identity Registry
 * Story ID: VYR-042
 * Epic: EPIC 5 — Scheduled Oracle Fusion synchronization and secure ingestion
 * Branch Applicability: Both
 *
 * Provides dedicated workload identities for non-interactive (scheduled,
 * pipeline, background) Oracle operations. These identities:
 *
 *   - Are never derived from a human user's browser JWT
 *   - Carry a stable service principal name for audit attribution
 *   - Use the credential provider to retrieve Oracle Fusion credentials
 *   - Support least-privilege account mapping per service
 *
 * When a human admin triggers a manual sync, the audit trail records their
 * email as the actor AND the service identity as the execution context.
 * When the nightly scheduler fires, there is no human — the service identity
 * is the sole actor.
 */

import crypto from 'crypto';
import { oracleCredentialProvider, type OracleCredentials, type CredentialProviderHealth } from './credentialProvider.js';
import { runAsCryptoService, type CryptoAuditContext } from '../security/cryptoAuditContext.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceIdentity {
  /** Stable service principal, e.g. "veyra-sync-worker" */
  principalName: string;
  /** Short description for audit logs */
  description: string;
  /** When this identity was first used */
  activeSince: string;
  /** One-way hash of the identity for correlation */
  identityRef: string;
}

export interface ServiceExecutionContext {
  identity: ServiceIdentity;
  credentials: OracleCredentials;
  /** Who triggered this — email for admin, principalName for scheduled */
  triggeredBy: string;
  /** Whether a human triggered this */
  isHumanTriggered: boolean;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const KNOWN_SERVICES: Record<string, { description: string }> = {
  'veyra-sync-worker':    { description: 'Nightly scheduled Oracle sync worker' },
  'veyra-pipeline':       { description: 'Shared ingestion pipeline orchestrator' },
  'veyra-admin-sync':     { description: 'Admin-triggered manual sync' },
  'veyra-audit-sync':     { description: 'On-demand audit trail sync' },
  'veyra-role-sync':      { description: 'On-demand role hierarchy sync' },
  'veyra-catalog-sync':   { description: 'Background catalog sync' },
};

export function makeIdentityRef(name: string): string {
  return crypto.createHash('sha256').update(`svc:${name}`).digest('hex').slice(0, 16);
}

export class ServiceIdentityRegistry {
  private identities = new Map<string, ServiceIdentity>();

  /**
   * Gets or creates a service identity for the given principal name.
   */
  public getIdentity(principalName: string): ServiceIdentity {
    const existing = this.identities.get(principalName);
    if (existing) return existing;

    const known = KNOWN_SERVICES[principalName];
    const identity: ServiceIdentity = {
      principalName,
      description: known?.description || `Service: ${principalName}`,
      activeSince: new Date().toISOString(),
      identityRef: makeIdentityRef(principalName),
    };

    this.identities.set(principalName, identity);
    return identity;
  }

  /**
   * Builds a full execution context for a service operation:
   *  - Resolves the service identity
   *  - Retrieves credentials from the credential provider
   *  - Records who triggered the operation
   */
  public async buildContext(
    principalName: string,
    triggeredBy?: string
  ): Promise<ServiceExecutionContext> {
    const identity = this.getIdentity(principalName);
    const credentials = await oracleCredentialProvider.getCredentials();

    const isHumanTriggered = !!triggeredBy
      && triggeredBy !== 'SCHEDULED_OFFPEAK_CRON'
      && triggeredBy !== principalName
      && triggeredBy.includes('@');

    return {
      identity,
      credentials,
      triggeredBy: triggeredBy || principalName,
      isHumanTriggered,
    };
  }

  /**
   * Runs a function within a service identity context.
   * The crypto audit context is set to the service identity,
   * and fresh credentials are provided.
   */
  public async runAsService<T>(
    principalName: string,
    purpose: string,
    triggeredBy: string | undefined,
    fn: (ctx: ServiceExecutionContext) => Promise<T>
  ): Promise<T> {
    const ctx = await this.buildContext(principalName, triggeredBy);

    return runAsCryptoService(principalName, purpose, async () => {
      console.log(
        `[ServiceIdentity] Executing as "${principalName}" ` +
        `(ref: ${ctx.identity.identityRef}, trigger: ${ctx.triggeredBy}, human: ${ctx.isHumanTriggered})`
      );
      return fn(ctx);
    });
  }

  /**
   * Returns the health of the credential provider and
   * the list of known service identities.
   */
  public getHealth(): {
    credentialProvider: CredentialProviderHealth;
    registeredServices: string[];
    activeIdentities: Array<{ principalName: string; identityRef: string; activeSince: string }>;
  } {
    return {
      credentialProvider: oracleCredentialProvider.getHealth(),
      registeredServices: Object.keys(KNOWN_SERVICES),
      activeIdentities: Array.from(this.identities.values()).map(i => ({
        principalName: i.principalName,
        identityRef: i.identityRef,
        activeSince: i.activeSince,
      })),
    };
  }

  /** Forces the credential provider to re-fetch credentials (rotation). */
  public async rotateCredentials(): Promise<void> {
    console.log('[ServiceIdentity] Credential rotation requested');
    await oracleCredentialProvider.refresh();
    console.log('[ServiceIdentity] Credential rotation complete');
  }
}

export const serviceIdentityRegistry = new ServiceIdentityRegistry();
