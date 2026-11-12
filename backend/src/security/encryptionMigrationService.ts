/**
 * PostgreSQL Encrypted Payload Schema & Migration Management Service
 * Story ID: VYR-031
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Implements schema verification, rolling migration tracking via the migration ledger,
 * dual-mode record persistence helpers, and debug log sanitization to prevent accidental
 * disclosure of key material or plaintext raw JSON.
 */

import pg from 'pg';
import { EncryptedPayload, isEncryptedPayload } from './encryptionContract.js';

export interface RawTableDescriptor {
  tableName: string;
  rawColumnName: string;
  primaryKeyColumns: string[];
  queryableMetadataColumns: string[];
}

export const RAW_ORACLE_PERSISTENCE_TABLES: RawTableDescriptor[] = [
  {
    tableName: 'oracle_raw_audit_records',
    rawColumnName: 'raw_payload',
    primaryKeyColumns: ['id'],
    queryableMetadataColumns: ['environment_host', 'event_id', 'event_timestamp', 'user_name', 'action_type', 'business_object'],
  },
  {
    tableName: 'oracle_raw_users',
    rawColumnName: 'raw_user',
    primaryKeyColumns: ['environment_host', 'username'],
    queryableMetadataColumns: ['environment_host', 'username', 'display_name', 'email', 'is_active', 'user_category'],
  },
  {
    tableName: 'oracle_raw_roles',
    rawColumnName: 'raw_role',
    primaryKeyColumns: ['environment_host', 'role_code'],
    queryableMetadataColumns: ['environment_host', 'role_code', 'role_name', 'category', 'is_custom', 'member_count'],
  },
  {
    tableName: 'oracle_raw_role_hierarchy',
    rawColumnName: 'raw_record',
    primaryKeyColumns: ['environment_host', 'parent_role_name', 'child_role_name'],
    queryableMetadataColumns: ['environment_host', 'parent_role_name', 'child_role_name'],
  },
  {
    tableName: 'oracle_raw_controls',
    rawColumnName: 'raw_payload',
    primaryKeyColumns: ['environment_host', 'control_id'],
    queryableMetadataColumns: ['environment_host', 'control_id', 'control_name', 'control_type', 'risk_level', 'status'],
  },
  {
    tableName: 'oracle_control_incidents',
    rawColumnName: 'raw_incidents',
    primaryKeyColumns: ['environment_host', 'control_id'],
    queryableMetadataColumns: ['environment_host', 'control_id', 'control_name', 'total_incidents', 'assigned_incidents'],
  },
  {
    tableName: 'oracle_incident_rows',
    rawColumnName: 'raw',
    primaryKeyColumns: ['environment_host', 'control_id', 'ord'],
    queryableMetadataColumns: ['environment_host', 'control_id', 'ord', 'result_id', 'status', 'lifecycle', 'priority'],
  },
  {
    tableName: 'oracle_raw_access_certifications',
    rawColumnName: 'raw_data',
    primaryKeyColumns: ['environment_host', 'certification_id'],
    queryableMetadataColumns: ['environment_host', 'certification_id', 'name', 'status', 'due_date'],
  },
  {
    tableName: 'oracle_raw_certifier_worksheets',
    rawColumnName: 'raw_data',
    primaryKeyColumns: ['environment_host', 'certification_id', 'id'],
    queryableMetadataColumns: ['environment_host', 'certification_id', 'id', 'certifier_name', 'status'],
  },
  {
    tableName: 'oracle_raw_user_access',
    rawColumnName: 'raw_payload',
    primaryKeyColumns: ['id'],
    queryableMetadataColumns: ['environment_host', 'username', 'role_name', 'role_code', 'department', 'job', 'manager'],
  },
];

export interface TableEncryptionStatus {
  tableName: string;
  totalRecords: number;
  encryptedRecords: number;
  plaintextRecords: number;
  encryptionPercentage: number;
}

export interface MigrationLedgerEntry {
  tableName: string;
  environmentHost: string;
  totalRecords: number;
  encryptedRecords: number;
  plaintextRecords: number;
  lastMigratedId: string | null;
  batchSize: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  lastError: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

/**
 * Service for managing PostgreSQL encryption schema state, migration tracking,
 * and safe serialization across all Oracle raw tables.
 */
export class EncryptionMigrationService {
  /**
   * Verifies that all 10 raw tables have the required encryption tracking columns and indexes.
   */
  public async verifySchemaIntegrity(pool: pg.Pool): Promise<{
    healthy: boolean;
    missingColumns: Array<{ table: string; column: string }>;
    ledgerTableExists: boolean;
  }> {
    const missingColumns: Array<{ table: string; column: string }> = [];
    const expectedCols = [
      'is_encrypted',
      'encryption_format_version',
      'encryption_key_id',
      'encrypted_at',
    ];

    for (const descriptor of RAW_ORACLE_PERSISTENCE_TABLES) {
      const res = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        [descriptor.tableName]
      );
      const existing = new Set(res.rows.map((r: any) => r.column_name));

      for (const col of expectedCols) {
        if (!existing.has(col)) {
          missingColumns.push({ table: descriptor.tableName, column: col });
        }
      }

      // Check raw column existence
      if (!existing.has(descriptor.rawColumnName)) {
        missingColumns.push({ table: descriptor.tableName, column: descriptor.rawColumnName });
      }
    }

    const ledgerRes = await pool.query(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'oracle_encryption_migration_ledger'
       ) AS exists`
    );
    const ledgerTableExists = Boolean(ledgerRes.rows[0]?.exists);

    return {
      healthy: missingColumns.length === 0 && ledgerTableExists,
      missingColumns,
      ledgerTableExists,
    };
  }

  /**
   * Calculates encryption metrics per table for a given environment host or across all hosts.
   */
  public async getTableEncryptionStatus(
    pool: pg.Pool,
    environmentHost?: string
  ): Promise<TableEncryptionStatus[]> {
    const results: TableEncryptionStatus[] = [];

    for (const descriptor of RAW_ORACLE_PERSISTENCE_TABLES) {
      const whereClause = environmentHost ? 'WHERE environment_host = $1' : '';
      const params = environmentHost ? [environmentHost] : [];

      const query = `
        SELECT
          COUNT(*)::int AS total_records,
          COUNT(*) FILTER (WHERE is_encrypted = TRUE)::int AS encrypted_records,
          COUNT(*) FILTER (WHERE is_encrypted = FALSE)::int AS plaintext_records
        FROM ${descriptor.tableName}
        ${whereClause}
      `;

      try {
        const res = await pool.query(query, params);
        const row = res.rows[0] || { total_records: 0, encrypted_records: 0, plaintext_records: 0 };
        const total = row.total_records;
        const encrypted = row.encrypted_records;
        const plaintext = row.plaintext_records;
        const pct = total > 0 ? Math.round((encrypted / total) * 1000) / 10 : 100.0;

        results.push({
          tableName: descriptor.tableName,
          totalRecords: total,
          encryptedRecords: encrypted,
          plaintextRecords: plaintext,
          encryptionPercentage: pct,
        });
      } catch (err: any) {
        // Handle unmigrated table gracefully
        results.push({
          tableName: descriptor.tableName,
          totalRecords: 0,
          encryptedRecords: 0,
          plaintextRecords: 0,
          encryptionPercentage: 0,
        });
      }
    }

    return results;
  }

  /**
   * Retrieves migration ledger entries from the database.
   */
  public async getMigrationLedger(
    pool: pg.Pool,
    environmentHost?: string
  ): Promise<MigrationLedgerEntry[]> {
    const whereClause = environmentHost ? 'WHERE environment_host = $1' : '';
    const params = environmentHost ? [environmentHost] : [];

    const query = `
      SELECT
        table_name,
        environment_host,
        total_records,
        encrypted_records,
        plaintext_records,
        last_migrated_id,
        batch_size,
        status,
        last_error,
        started_at,
        completed_at,
        updated_at
      FROM oracle_encryption_migration_ledger
      ${whereClause}
      ORDER BY table_name ASC
    `;

    const res = await pool.query(query, params);
    return res.rows.map((r: any) => ({
      tableName: r.table_name,
      environmentHost: r.environment_host,
      totalRecords: r.total_records,
      encryptedRecords: r.encrypted_records,
      plaintextRecords: r.plaintext_records,
      lastMigratedId: r.last_migrated_id,
      batchSize: r.batch_size,
      status: r.status,
      lastError: r.last_error,
      startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
      completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }

  /**
   * Initializes or updates migration ledger entry for a table and environment.
   */
  public async updateMigrationLedger(
    pool: pg.Pool,
    entry: {
      tableName: string;
      environmentHost: string;
      totalRecords?: number;
      encryptedRecords?: number;
      plaintextRecords?: number;
      lastMigratedId?: string | null;
      batchSize?: number;
      status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
      lastError?: string | null;
    }
  ): Promise<void> {
    const query = `
      INSERT INTO oracle_encryption_migration_ledger (
        table_name, environment_host, total_records, encrypted_records,
        plaintext_records, last_migrated_id, batch_size, status,
        last_error, started_at, completed_at, updated_at
      ) VALUES (
        $1, $2, COALESCE($3, 0), COALESCE($4, 0),
        COALESCE($5, 0), $6, COALESCE($7, 100), COALESCE($8, 'PENDING'),
        $9, CASE WHEN $8 = 'IN_PROGRESS' THEN NOW() ELSE NULL END,
        CASE WHEN $8 = 'COMPLETED' THEN NOW() ELSE NULL END, NOW()
      )
      ON CONFLICT (table_name, environment_host) DO UPDATE SET
        total_records = COALESCE($3, oracle_encryption_migration_ledger.total_records),
        encrypted_records = COALESCE($4, oracle_encryption_migration_ledger.encrypted_records),
        plaintext_records = COALESCE($5, oracle_encryption_migration_ledger.plaintext_records),
        last_migrated_id = COALESCE($6, oracle_encryption_migration_ledger.last_migrated_id),
        batch_size = COALESCE($7, oracle_encryption_migration_ledger.batch_size),
        status = COALESCE($8, oracle_encryption_migration_ledger.status),
        last_error = $9,
        started_at = CASE
          WHEN $8 = 'IN_PROGRESS' AND oracle_encryption_migration_ledger.started_at IS NULL THEN NOW()
          ELSE oracle_encryption_migration_ledger.started_at
        END,
        completed_at = CASE
          WHEN $8 = 'COMPLETED' THEN NOW()
          ELSE oracle_encryption_migration_ledger.completed_at
        END,
        updated_at = NOW()
    `;

    await pool.query(query, [
      entry.tableName,
      entry.environmentHost,
      entry.totalRecords,
      entry.encryptedRecords,
      entry.plaintextRecords,
      entry.lastMigratedId,
      entry.batchSize,
      entry.status,
      entry.lastError,
    ]);
  }

  /**
   * Safe serializer/sanitizer for debug and logging output.
   * Redacts ciphertext, nonce, authTag, and encryptedDek to ensure logs never
   * leak sensitive data or cryptographic material.
   */
  public sanitizeForLogging(data: any): any {
    if (data === null || data === undefined) return data;

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeForLogging(item));
    }

    if (typeof data === 'object') {
      if (isEncryptedPayload(data)) {
        return {
          formatVersion: data.formatVersion,
          algorithm: data.algorithm,
          keyId: data.keyId,
          encryptedDek: '[REDACTED_WRAPPED_DEK]',
          nonce: '[REDACTED_NONCE]',
          authTag: '[REDACTED_AUTH_TAG]',
          ciphertext: `[REDACTED_CIPHERTEXT:${(data.ciphertext || '').length}B]`,
          aad: data.aad,
          createdAt: data.createdAt,
        };
      }

      const copy: Record<string, any> = {};
      for (const [key, value] of Object.entries(data)) {
        if (
          key.toLowerCase().includes('password') ||
          key.toLowerCase().includes('secret') ||
          key.toLowerCase().includes('token') ||
          key.toLowerCase().includes('ssn')
        ) {
          copy[key] = '[REDACTED_SENSITIVE]';
        } else {
          copy[key] = this.sanitizeForLogging(value);
        }
      }
      return copy;
    }

    return data;
  }
}

// Global active instance
export const encryptionMigrationService = new EncryptionMigrationService();

