# KMS & Key Vault Envelope Encryption Integration (VYR-030)

## Executive Summary & Metadata
- **Story ID:** VYR-030
- **Story Title:** Integrate envelope encryption with KMS/Key Vault
- **Epic:** EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
- **Branch Applicability:** Both (`standard-veyra-application-dev` & `veyra-application-dev`)
- **Status:** Complete / Production-Ready
- **Dependencies:** VYR-027 (Data Classification), VYR-028 (Encryption Contract & AAD), VYR-029 (AES-256-GCM Encryption Service)

---

## 1. Problem Statement & Threat Model
In traditional database architectures, sensitive Oracle Fusion enterprise records (such as executive user access, audit events, and compliance reports) are often encrypted with static database-level keys or table-space encryption. This architecture leaves data vulnerable to:
1. **Compromised Database Backups / SQL Injections:** If a database backup is exfiltrated or direct SQL read access is obtained, attackers can decrypt all raw records if the key is stored in the database or shared infrastructure.
2. **Key Material Exposure in Code / Config:** Storing master encryption keys in environment variables or configuration files creates high leakage risk across CI/CD logs, Docker images, and application memory dumps.
3. **Over-Privileged Identity:** Application containers having broad administrative rights over KMS keys could inadvertently delete, disable, or misconfigure key rotation policies.

**Story VYR-030 Solution:** Envelope encryption decouples the Data Encryption Key (DEK) used to encrypt actual data payloads from the Master Key / Key Encryption Key (KEK) managed exclusively inside a hardened Key Management Service (AWS KMS, Azure Key Vault, or isolated Local Secure Vault).

---

## 2. Cryptographic Architecture: Envelope Encryption Hierarchy

```
+-----------------------------------------------------------------------------------+
|                           Cloud KMS / Key Vault Enclave                           |
|  [ Master Key / KEK: veyra-kms-k1-2026 ] (Never leaves KMS / HSM hardware boundary)  |
+-----------------------------------------------------------------------------------+
                                      |
                GenerateDataKey / WrapDek / UnwrapDek
                                      |
+-----------------------------------------------------------------------------------+
|                        Node.js Application Runtime (Veyra)                        |
|                                                                                   |
|  1. Generate 256-bit ephemeral DEK via crypto.randomBytes(32)                      |
|  2. Wrap DEK via KMS: KEK + Context -> Base64 Wrapped DEK                         |
|  3. Encrypt Oracle Record via AES-256-GCM + Nonce (12B) + Canonical AAD           |
|  4. MEMORY ZEROING: dek.fill(0) wipes plaintext DEK immediately                   |
|  5. Assemble standardized EncryptedPayload container                              |
+-----------------------------------------------------------------------------------+
                                      |
                     Persist Only Encrypted Container
                                      |
+-----------------------------------------------------------------------------------+
|                       PostgreSQL Database (Oracle Raw Tables)                     |
|                                                                                   |
|  Stored Columns / Fields:                                                         |
|  - raw_payload / encrypted_record: {                                              |
|      formatVersion: 1,                                                            |
|      algorithm: "AES-256-GCM",                                                    |
|      keyId: "veyra-kms-k1-2026",                                                  |
|      encryptedDek: "<Wrapped DEK Base64>",                                        |
|      nonce: "<12-byte Nonce Base64>",                                             |
|      authTag: "<16-byte Tag Base64>",                                             |
|      ciphertext: "<Ciphertext Base64>",                                           |
|      aad: "table=oracle_raw_user_access|id=1001|ts=...",                          |
|      createdAt: "2026-11-12T16:00:00.000Z"                                        |
|    }                                                                              |
|                                                                                   |
|  * Plaintext DEK is NEVER stored in database.                                     |
|  * Master KEK is NEVER stored in database or application config.                  |
+-----------------------------------------------------------------------------------+
```

---

## 3. Key Management Service (KMS) Provider Architecture

The subsystem implements a modular, pluggable interface (`KmsKeyProvider`) extending `KeyProvider`:

```typescript
export interface KmsKeyProvider extends KeyProvider {
  readonly providerType: KmsProviderType;
  generateDataKey(keyId?: string, encryptionContext?: Record<string, string>): Promise<DataKeyResult>;
  wrapDek(dek: Buffer, keyId: string, encryptionContext?: Record<string, string>): Promise<string>;
  unwrapDek(wrappedDekB64: string, keyId: string, encryptionContext?: Record<string, string>): Promise<Buffer>;
  healthCheck(): Promise<KmsHealthCheckResult>;
  getTelemetry(): KmsTelemetry;
}
```

### 3.1 Local Secure Vault (`LocalKmsProvider`)
- **Purpose:** Used for local development, CI/CD automated test pipelines, isolated environments, and Render container fallback.
- **Algorithm:** AES-256-GCM authenticated key wrapping with 12-byte fresh nonce, 16-byte GHASH authentication tag, and cryptographic context binding.
- **Key Ring:** Supports multi-generation master key rings for seamless key rotation (e.g. `veyra-kms-k1-2025`, `veyra-kms-k1-2026`, `veyra-kms-k1-2027`).
- **Backward Compatibility:** Seamlessly unwraps keys produced by `LocalKeyProvider` (`wrap:dek:${keyId}`) as well as standard KMS context-bound envelopes (`kms:wrap:${keyId}`).

### 3.2 AWS KMS Provider (`AwsKmsProvider`)
- **Purpose:** Production deployments on AWS (EKS / ECS / EC2).
- **Authentication:** AWS IAM Workload Identity (IRSA: IAM Roles for Service Accounts).
- **APIs:** `kms:GenerateDataKey`, `kms:Encrypt`, `kms:Decrypt`.
- **Security:** Master KEKs are non-exportable hardware-backed keys in FIPS 140-2 Level 3 HSMs.

### 3.3 Azure Key Vault Provider (`AzureKeyVaultProvider`)
- **Purpose:** Production deployments on Microsoft Azure (AKS / App Services).
- **Authentication:** Azure Managed Identity (System-Assigned or User-Assigned).
- **APIs:** `wrapKey`, `unwrapKey` via Azure Key Vault REST / SDK.
- **Security:** Azure Key Vault Premium HSM backing.

---

## 4. Least-Privilege IAM & Workload Identity Specifications

### 4.1 AWS IAM Least-Privilege Policy
Node.js application pods authenticate using IAM Roles for Service Accounts (IRSA). The IAM policy restricts operations strictly to data key operations on the designated key ARN:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowEnvelopeEncryptionOperationsOnly",
      "Effect": "Allow",
      "Action": [
        "kms:GenerateDataKey",
        "kms:Encrypt",
        "kms:Decrypt"
      ],
      "Resource": "arn:aws:kms:us-east-1:123456789012:key/veyra-oracle-kek-2026",
      "Condition": {
        "StringEquals": {
          "kms:CallerAccount": "123456789012"
        }
      }
    },
    {
      "Sid": "DenyKeyAdministration",
      "Effect": "Deny",
      "Action": [
        "kms:Create*",
        "kms:Delete*",
        "kms:Disable*",
        "kms:PutKeyPolicy",
        "kms:ScheduleKeyDeletion"
      ],
      "Resource": "*"
    }
  ]
}
```

### 4.2 Azure Key Vault RBAC Policy
Assign the **Key Vault Crypto Service Encryption User** role:
- Granted Actions: `Microsoft.KeyVault/vaults/keys/wrap/action`, `Microsoft.KeyVault/vaults/keys/unwrap/action`.
- Denied Actions: No access to secret read, certificate read, or key administrative deletion.

---

## 5. Security & Operational Guarantees

### 5.1 Memory Hygiene & DEK Zeroing
Plaintext 256-bit DEKs reside in Node.js heap memory only for the brief milliseconds required to encrypt or decrypt the record:
```typescript
const dek = crypto.randomBytes(DEK_LENGTH_BYTES);
try {
  // Encrypt payload...
} finally {
  // Memory Hygiene: Zero out plaintext DEK buffer immediately
  dek.fill(0);
}
```
Even if application memory is dumped or inspected after request completion, the plaintext DEK cannot be recovered.

### 5.2 Zero-Fallback Fail-Closed Semantics
If KMS is unreachable, the key is revoked, the authentication tag fails verification, or the wrapped DEK envelope is tampered with:
- The system **fails closed** immediately and throws a typed `EncryptionError` (`KEY_NOT_FOUND`, `DECRYPTION_FAILED`, `ENCRYPTION_FAILED`).
- Under **no circumstances** does the system fallback to plaintext storage, default null encryption, or unauthenticated cipher modes.

### 5.3 Zero Key Material Disclosure in Telemetry
KMS operational telemetry is observable for SRE monitoring and incident response without disclosing sensitive key material:
- **Metrics Tracked:** `totalOperations`, `generateDataKeyCount`, `wrapCount`, `unwrapCount`, `failureCount`, `averageLatencyMs`, `lastOperationTimestamp`.
- **Sanitization:** `lastError` is scrubbed of all high-entropy hexadecimal or Base64 key patterns (`[REDACTED_KEY_MATERIAL]`). Raw key bytes and plaintext DEKs are never emitted.

---

## 6. Verification & Test Plan (Story VYR-030)

| Test Category | Description | Target Result |
|---|---|---|
| **KMS Provider Initialization** | Factory creates correct provider based on env vars (`LOCAL_VAULT`, `AWS_KMS`, `AZURE_KEY_VAULT`). | PASS |
| **DEK Generation & Wrapping** | Generates 256-bit random DEK and authenticated envelope. | PASS |
| **DEK Unwrapping & Parity** | Unwrapped DEK identically matches original generated DEK. | PASS |
| **Context Binding Authentication** | Tampering with KMS encryption context triggers unwrap failure. | PASS |
| **Envelope Tamper Resistance** | Corrupting ciphertext, nonce, or tag in wrapped DEK fails closed. | PASS |
| **Key Rotation Multi-Gen** | Historical keys decryptable; rotated active key used for new wraps. | PASS |
| **Memory Zeroing** | Verified DEK memory zeroing hygiene (`fill(0)`). | PASS |
| **Zero Key Disclosure** | Telemetry and error strings contain zero raw key material. | PASS |
| **KMS Health Check** | Self-test round-trip measures latency and reports health status. | PASS |
| **Story 29 Interoperability** | Seamless round-trip encryption/decryption with `EncryptionService`. | PASS |
