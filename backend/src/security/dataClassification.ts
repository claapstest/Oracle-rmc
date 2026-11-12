/**
 * Oracle Data Classification and Persistence Path Mapping
 * Story ID: VYR-027
 * Epic: EPIC 4 — Oracle raw-data encryption and Node.js-only decryption
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Formal classification of all Oracle Fusion data stored in PostgreSQL,
 * mapping of all ingestion and retrieval paths, and cataloging of SQL/report
 * dependencies on raw JSON fields.
 */

export enum DataSensitivity {
  /**
   * Personally Identifiable Information (PII)
   * High confidentiality risk. Requires encryption at rest (Epic 4),
   * access restriction, and authorized Node.js-only decryption.
   */
  RESTRICTED_PII = 'RESTRICTED_PII',

  /**
   * Financial & Segregation of Duties (SOD) sensitive compliance data.
   * High business risk. Requires encryption at rest for raw payloads.
   */
  CONFIDENTIAL_FINANCIAL = 'CONFIDENTIAL_FINANCIAL',

  /**
   * Security & Entitlement metadata (Role structures, access points).
   * Medium risk. Protected by RBAC; queryable by security administrators.
   */
  SENSITIVE_SECURITY = 'SENSITIVE_SECURITY',

  /**
   * Operational telemetry, sync state, and environment tracking.
   * Internal metadata required for service operations and sync watermarks.
   */
  OPERATIONAL_METADATA = 'OPERATIONAL_METADATA',

  /**
   * Approved queryable metadata & aggregated metrics.
   * Explicitly permitted to remain in plaintext / indexed columns to support
   * sub-millisecond dashboard queries and server-side pagination without decryption.
   */
  QUERYABLE_METADATA = 'QUERYABLE_METADATA',
}

export interface TableClassification {
  tableName: string;
  domain: string;
  rawJsonColumn: string | null;
  columns: Record<string, {
    dataType: string;
    sensitivity: DataSensitivity;
    requiresEncryption: boolean;
    isQueryableMetadata: boolean;
    description: string;
  }>;
  aadFields: string[]; // Additional Authenticated Data components for AEAD (VYR-028)
}

/**
 * Authoritative Data Classification Matrix for Oracle Fusion Storage
 */
export const ORACLE_DATA_CLASSIFICATION_MATRIX: Record<string, TableClassification> = {
  oracle_raw_audit_records: {
    tableName: 'oracle_raw_audit_records',
    domain: 'Audit Trail',
    rawJsonColumn: 'raw_payload',
    aadFields: ['environment_host', 'product', 'business_object', 'record_unique_hash'],
    columns: {
      id: {
        dataType: 'bigint',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Auto-incrementing surrogate primary key',
      },
      environment_host: {
        dataType: 'varchar(255)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Oracle Fusion host for multi-tenant isolation and AAD',
      },
      product: {
        dataType: 'varchar(150)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Oracle product line (e.g., HCM, Financials, RACM)',
      },
      business_object: {
        dataType: 'varchar(255)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Audited business entity (e.g., User, Journal Entry)',
      },
      record_unique_hash: {
        dataType: 'varchar(64)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'SHA-256 deduplication fingerprint of event attributes',
      },
      event_timestamp: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Exact timestamp when event occurred in Oracle Fusion',
      },
      username: {
        dataType: 'varchar(150)',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false, // Pseudonymized principal identifier indexed for search
        isQueryableMetadata: true,
        description: 'User identifier or email executing the transaction',
      },
      event_type: {
        dataType: 'varchar(100)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Action classification (CREATE, UPDATE, DELETE, VIEW)',
      },
      raw_payload: {
        dataType: 'jsonb',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: true, // Entire raw payload contains attribute changes, PII, financial details
        isQueryableMetadata: false,
        description: 'Full Oracle auditData payload containing before/after state and sensitive values',
      },
      created_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Record insertion timestamp',
      },
    },
  },

  oracle_raw_users: {
    tableName: 'oracle_raw_users',
    domain: 'Directory & Identity',
    rawJsonColumn: 'raw_user',
    aadFields: ['environment_host', 'username'],
    columns: {
      environment_host: {
        dataType: 'varchar(255)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Environment host for tenant segregation',
      },
      username: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false, // Natural key required for indexing and directory search
        isQueryableMetadata: true,
        description: 'Unique Oracle user principal login name',
      },
      display_name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Human-readable full user display name',
      },
      email: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Corporate email address used for duplicate detection and contact',
      },
      is_active: {
        dataType: 'boolean',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Oracle user status flag (active or terminated)',
      },
      user_category: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'User category classification (DEFAULT, SYSTEM, CONTRACTOR)',
      },
      raw_user: {
        dataType: 'jsonb',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: true, // Contains full SCIM profile: emails, roles, managers, HR attributes
        isQueryableMetadata: false,
        description: 'Full Oracle SCIM 2.0 user JSON resource',
      },
      last_synced_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Timestamp of last SCIM sync',
      },
      created_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Record initial creation timestamp',
      },
      updated_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Record modification timestamp',
      },
    },
  },

  oracle_raw_roles: {
    tableName: 'oracle_raw_roles',
    domain: 'Security & Access Roles',
    rawJsonColumn: 'raw_role',
    aadFields: ['environment_host', 'role_code'],
    columns: {
      environment_host: {
        dataType: 'varchar(255)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Environment host for tenant segregation',
      },
      role_code: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Authoritative Oracle role code (e.g. ORA_FND_IT_SECURITY_MANAGER_JOB)',
      },
      role_name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Human-readable title of the security role',
      },
      category: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Role classification (Job, Duty, Data, Abstract, GRC, Other)',
      },
      is_custom: {
        dataType: 'boolean',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Flag indicating customer-authored vs Oracle pre-packaged seed role',
      },
      member_count: {
        dataType: 'integer',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Total number of users currently assigned to this role',
      },
      raw_role: {
        dataType: 'jsonb',
        sensitivity: DataSensitivity.SENSITIVE_SECURITY,
        requiresEncryption: true, // Contains privilege mappings, members list, description
        isQueryableMetadata: false,
        description: 'Full Oracle SCIM role representation with members array',
      },
      last_synced_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Timestamp of last role sync',
      },
      created_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Creation timestamp',
      },
      updated_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Last update timestamp',
      },
    },
  },

  oracle_raw_role_hierarchy: {
    tableName: 'oracle_raw_role_hierarchy',
    domain: 'Role Hierarchy & Privileges',
    rawJsonColumn: 'raw_record',
    aadFields: ['environment_host', 'parent_role_name', 'child_role_name'],
    columns: {
      id: {
        dataType: 'integer',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Surrogate sequence primary key',
      },
      environment_host: {
        dataType: 'varchar(255)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Environment host for tenant segregation',
      },
      parent_role_name: {
        dataType: 'varchar(500)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Parent role in entitlement hierarchy',
      },
      parent_role_type: {
        dataType: 'varchar(100)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Category of parent role (Job, Abstract, Duty)',
      },
      child_role_name: {
        dataType: 'varchar(500)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Child role or functional privilege inherited by parent',
      },
      child_role_type: {
        dataType: 'varchar(100)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Category of child item (Duty, Privilege)',
      },
      role_code: {
        dataType: 'varchar(255)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Technical role code',
      },
      category: {
        dataType: 'varchar(100)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Functional domain categorization',
      },
      relationship_type: {
        dataType: 'varchar(255)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Hierarchy relationship type (Direct, Inherited)',
      },
      raw_record: {
        dataType: 'jsonb',
        sensitivity: DataSensitivity.SENSITIVE_SECURITY,
        requiresEncryption: true,
        isQueryableMetadata: false,
        description: 'Raw BI Publisher row extracted from Oracle Fusion security repository',
      },
      last_synced_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Sync timestamp',
      },
      created_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Creation timestamp',
      },
    },
  },

  oracle_raw_controls: {
    tableName: 'oracle_raw_controls',
    domain: 'Advanced Access Controls (RMC)',
    rawJsonColumn: 'raw_payload',
    aadFields: ['environment_host', 'control_id'],
    columns: {
      environment_host: {
        dataType: 'varchar(255)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Environment host for tenant segregation',
      },
      control_id: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Oracle GRC Control unique ID',
      },
      name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Control rule title (e.g. AP Manager vs General Ledger Posting)',
      },
      state: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Control lifecycle state (Approved, In Review, Closed)',
      },
      status: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Control enforcement status (Active, Inactive)',
      },
      oracle_last_run_date: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Timestamp when analysis model last executed in Oracle',
      },
      oracle_last_update_date: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Timestamp when control definition was updated in Oracle',
      },
      raw_payload: {
        dataType: 'jsonb',
        sensitivity: DataSensitivity.CONFIDENTIAL_FINANCIAL,
        requiresEncryption: true, // Contains SOD logic, entitlement filters, rule parameters
        isQueryableMetadata: false,
        description: 'Full Oracle GRC Control REST definition resource',
      },
      created_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Creation timestamp',
      },
      updated_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Update timestamp',
      },
    },
  },

  oracle_control_incidents: {
    tableName: 'oracle_control_incidents',
    domain: 'Control Incidents & Violations',
    rawJsonColumn: 'raw_incidents',
    aadFields: ['environment_host', 'control_id'],
    columns: {
      environment_host: {
        dataType: 'varchar(255)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Environment host for tenant segregation',
      },
      control_id: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Oracle GRC Control unique ID',
      },
      control_name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Control rule title',
      },
      total_incidents: {
        dataType: 'integer',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Pre-computed count of total incidents for high-performance dashboards',
      },
      assigned_incidents: {
        dataType: 'integer',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Number of incidents in Assigned lifecycle status',
      },
      accepted_incidents: {
        dataType: 'integer',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Number of incidents in Accepted risk status',
      },
      remediate_incidents: {
        dataType: 'integer',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Number of incidents undergoing Remediation',
      },
      resolved_incidents: {
        dataType: 'integer',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Number of resolved incidents',
      },
      last_oracle_update_date: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Incident batch watermark date from Oracle',
      },
      last_synced_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Timestamp of last incident sync',
      },
      sync_status: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Sync status (SUCCESS, PARTIAL, FAILED)',
      },
      raw_incidents: {
        dataType: 'jsonb',
        sensitivity: DataSensitivity.CONFIDENTIAL_FINANCIAL,
        requiresEncryption: true, // Entire JSON array contains user PII and SOD conflicts
        isQueryableMetadata: false,
        description: 'Consolidated single-cell JSON array of all incidents for the control',
      },
      created_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Creation timestamp',
      },
      updated_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Update timestamp',
      },
    },
  },

  oracle_incident_rows: {
    tableName: 'oracle_incident_rows',
    domain: 'Normalized Incident Detail',
    rawJsonColumn: 'raw',
    aadFields: ['environment_host', 'control_id', 'ord'],
    columns: {
      environment_host: {
        dataType: 'text',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Environment host for tenant segregation',
      },
      control_id: {
        dataType: 'text',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Control identifier',
      },
      control_name: {
        dataType: 'text',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Control title',
      },
      ord: {
        dataType: 'integer',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Order index within control incident set',
      },
      result_id: {
        dataType: 'text',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Oracle incident result unique key',
      },
      status: {
        dataType: 'text',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Incident status string',
      },
      state: {
        dataType: 'text',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Workflow state',
      },
      lifecycle: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Canonical lifecycle (Assigned, Accepted, Remediate, Resolved)',
      },
      priority: {
        dataType: 'text',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Incident priority (High, Medium, Low)',
      },
      global_user: {
        dataType: 'text',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false, // Indexed for top-violator aggregations
        isQueryableMetadata: true,
        description: 'User principal identity associated with violation',
      },
      role_name: {
        dataType: 'text',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Conflicting role name involved in SOD breach',
      },
      access_entitlement: {
        dataType: 'text',
        sensitivity: DataSensitivity.SENSITIVE_SECURITY,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Conflicting access privilege or entitlement',
      },
      access_point_name: {
        dataType: 'text',
        sensitivity: DataSensitivity.SENSITIVE_SECURITY,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Business process access point',
      },
      access_point_type: {
        dataType: 'text',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Access point type',
      },
      grouping_value: {
        dataType: 'text',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Grouping key for related SOD violations',
      },
      group_name: {
        dataType: 'text',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Group label',
      },
      data_source: {
        dataType: 'text',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Source application instance',
      },
      incident_information: {
        dataType: 'text',
        sensitivity: DataSensitivity.CONFIDENTIAL_FINANCIAL,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Summary narrative of the violation',
      },
      created_by: {
        dataType: 'text',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'User or process creating incident',
      },
      investigator: {
        dataType: 'text',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Assigned compliance investigator',
      },
      last_updated_by: {
        dataType: 'text',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'User modifying incident status',
      },
      raw: {
        dataType: 'jsonb',
        sensitivity: DataSensitivity.CONFIDENTIAL_FINANCIAL,
        requiresEncryption: true, // Entire raw item object
        isQueryableMetadata: false,
        description: 'Raw Oracle incident line object with all attributes',
      },
    },
  },

  oracle_raw_access_certifications: {
    tableName: 'oracle_raw_access_certifications',
    domain: 'Access Certification Campaigns',
    rawJsonColumn: 'raw_data',
    aadFields: ['environment_host', 'certification_id'],
    columns: {
      environment_host: {
        dataType: 'varchar(255)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Environment host for tenant segregation',
      },
      certification_id: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Certification campaign unique identifier',
      },
      certification_name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Campaign campaign title (e.g. Q4 2026 Financial Controls Attestation)',
      },
      type: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Certification type (Standard, Event-driven, Manager)',
      },
      status: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Campaign status (Active, Completed, Overdue)',
      },
      percent_complete: {
        dataType: 'numeric',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Attestation progress percentage (0-100)',
      },
      due_date: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Deadline date for campaign completion',
      },
      creation_date: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Date campaign was launched',
      },
      owner_name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Business process owner responsible for campaign',
      },
      manager_name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Manager coordinating certifiers',
      },
      certifier_name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Direct attestation authority',
      },
      raw_data: {
        dataType: 'jsonb',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: true,
        isQueryableMetadata: false,
        description: 'Full Oracle BI Publisher / REST campaign JSON representation',
      },
      last_synced_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Last sync timestamp',
      },
      created_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Creation timestamp',
      },
      updated_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Update timestamp',
      },
    },
  },

  oracle_raw_certifier_worksheets: {
    tableName: 'oracle_raw_certifier_worksheets',
    domain: 'Access Certification Worksheets',
    rawJsonColumn: 'raw_data',
    aadFields: ['environment_host', 'certification_id', 'id'],
    columns: {
      id: {
        dataType: 'bigint',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Auto-incrementing line item key',
      },
      environment_host: {
        dataType: 'varchar(255)',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Environment host for tenant segregation',
      },
      certification_id: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Campaign identifier',
      },
      certification_name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Campaign title',
      },
      user_name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'User whose role access is being certified',
      },
      role_name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Role undergoing attestation',
      },
      role_code: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Technical role code',
      },
      certifier_name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Attesting manager name',
      },
      certified_manager: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Manager sign-off name',
      },
      direct_manager: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Employee direct reporting manager',
      },
      business_unit: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Business unit organization',
      },
      department: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Department name',
      },
      action: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Attestation decision (Approved, Revoked, Pending)',
      },
      raw_data: {
        dataType: 'jsonb',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: true,
        isQueryableMetadata: false,
        description: 'Raw worksheet line object from Oracle BI Publisher',
      },
      last_synced_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Last sync timestamp',
      },
      created_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Creation timestamp',
      },
      updated_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Update timestamp',
      },
    },
  },

  oracle_raw_user_access: {
    tableName: 'oracle_raw_user_access',
    domain: 'Directory User Entitlements',
    rawJsonColumn: null, // Structured table; individual PII columns marked below
    aadFields: ['environment_host', 'username'],
    columns: {
      environment_host: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Environment host for tenant segregation',
      },
      username: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false, // Natural key required for indexing and directory search
        isQueryableMetadata: true,
        description: 'Oracle user principal login name',
      },
      user_category: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'User category (DEFAULT, SYSTEM)',
      },
      first_name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Employee given name',
      },
      last_name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Employee family name',
      },
      display_name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Full formatted user name',
      },
      email: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Employee email address',
      },
      active: {
        dataType: 'boolean',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'User active entitlement status flag',
      },
      role_name: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Entitlement role display title',
      },
      role_code: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Entitlement role code',
      },
      auto_provisioned: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Auto-provisioning indicator (Yes/No)',
      },
      person_id: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Oracle HCM Person ID',
      },
      person_number: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Employee payroll / badge number',
      },
      department: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'HR Department code or title',
      },
      job: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'HR Job specification',
      },
      business_unit: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Operational business unit',
      },
      location: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.QUERYABLE_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Work office location',
      },
      manager: {
        dataType: 'varchar',
        sensitivity: DataSensitivity.RESTRICTED_PII,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Direct supervisor name',
      },
      last_synced_at: {
        dataType: 'timestamptz',
        sensitivity: DataSensitivity.OPERATIONAL_METADATA,
        requiresEncryption: false,
        isQueryableMetadata: true,
        description: 'Last synchronization timestamp',
      },
    },
  },
};

/**
 * Operational and Watermark Tables Inventory
 */
export const ORACLE_OPERATIONAL_TABLES: Record<string, {
  tableName: string;
  description: string;
  sensitivity: DataSensitivity;
  requiresEncryption: boolean;
}> = {
  oracle_audit_sync_state: {
    tableName: 'oracle_audit_sync_state',
    description: 'Tracks incremental high-water mark timestamp and sync status per product line',
    sensitivity: DataSensitivity.OPERATIONAL_METADATA,
    requiresEncryption: false,
  },
  oracle_control_sync_watermark: {
    tableName: 'oracle_control_sync_watermark',
    description: 'Tracks incident sync status, error messages, and update timestamps per control',
    sensitivity: DataSensitivity.OPERATIONAL_METADATA,
    requiresEncryption: false,
  },
  oracle_incident_rows_sync: {
    tableName: 'oracle_incident_rows_sync',
    description: 'Tracks normalized incident row sync status and total count per control',
    sensitivity: DataSensitivity.OPERATIONAL_METADATA,
    requiresEncryption: false,
  },
  oracle_user_access_summary: {
    tableName: 'oracle_user_access_summary',
    description: 'Pre-computed directory statistics (total users, users with/without roles, active/inactive counts)',
    sensitivity: DataSensitivity.QUERYABLE_METADATA,
    requiresEncryption: false,
  },
  product_sync_policy: {
    tableName: 'product_sync_policy',
    description: 'Scheduled synchronization policies, intervals, and execution history',
    sensitivity: DataSensitivity.OPERATIONAL_METADATA,
    requiresEncryption: false,
  },
};

/**
 * Catalog of Ingestion Pipelines into PostgreSQL
 */
export const ORACLE_INGESTION_PIPELINES = [
  {
    id: 'INGEST-01',
    pipelineName: 'Full Oracle Synchronization Pipeline',
    service: 'OracleSyncService',
    method: 'runFullSync',
    concurrencyProtection: 'Mutual exclusion lock (isSyncing)',
    targetTables: [
      'oracle_raw_controls',
      'oracle_control_incidents',
      'oracle_incident_rows',
      'oracle_raw_role_hierarchy',
      'oracle_raw_audit_records',
      'oracle_raw_roles',
      'oracle_raw_users',
      'oracle_raw_user_access',
    ],
    description: 'End-to-end synchronization executing all domain sync jobs sequentially under global lock.',
  },
  {
    id: 'INGEST-02',
    pipelineName: 'Audit Trail Incremental Sync',
    service: 'AuditRawDbService',
    method: 'saveRawAuditRecords / syncProduct / runDailyIncrementalSync',
    concurrencyProtection: 'Atomic upsert ON CONFLICT DO NOTHING with SHA-256 deduplication',
    targetTables: ['oracle_raw_audit_records', 'oracle_audit_sync_state'],
    description: 'Pulls auditData REST records, computes deterministic unique hash, and inserts new events.',
  },
  {
    id: 'INGEST-03',
    pipelineName: 'Advanced Access Controls & Incidents Pipeline',
    service: 'ControlRawDbService',
    method: 'saveRawControl / saveRawIncidents / syncControlIncidents',
    concurrencyProtection: 'Atomic upsert ON CONFLICT DO UPDATE; transactional delete-and-reinsert for rows',
    targetTables: [
      'oracle_raw_controls',
      'oracle_control_incidents',
      'oracle_incident_rows',
      'oracle_control_sync_watermark',
      'oracle_incident_rows_sync',
    ],
    description: 'Pulls control definition and incidents from Oracle GRC; stores single-cell raw JSON and normalized rows.',
  },
  {
    id: 'INGEST-04',
    pipelineName: 'Directory Users & Roles SCIM Pipeline',
    service: 'UserRoleRawDbService',
    method: 'saveRawUsersBatch / saveRawRolesBatch',
    concurrencyProtection: 'Chunked atomic batch upsert (100-200 rows per chunk)',
    targetTables: ['oracle_raw_users', 'oracle_raw_roles'],
    description: 'Paginates Oracle SCIM 2.0 Users and Roles endpoints and persists full JSON with indexed metadata.',
  },
  {
    id: 'INGEST-05',
    pipelineName: 'Role Hierarchy & Privileges BI Publisher Pipeline',
    service: 'RoleHierarchyService',
    method: 'syncFromBip / seedDatabaseIfEmpty',
    concurrencyProtection: 'Chunked atomic batch insert ON CONFLICT DO NOTHING',
    targetTables: ['oracle_raw_role_hierarchy'],
    description: 'Extracts deep multi-level role inheritance and functional privileges from Oracle BI Publisher.',
  },
  {
    id: 'INGEST-06',
    pipelineName: 'Access Certification Campaigns & Worksheets Pipeline',
    service: 'AccessCertRawDbService',
    method: 'saveRawCertifications / saveRawWorksheetRows',
    concurrencyProtection: 'Upsert for campaigns; transactional purge-and-insert for worksheet rows',
    targetTables: ['oracle_raw_access_certifications', 'oracle_raw_certifier_worksheets'],
    description: 'Ingests quarterly access certification campaigns and certifier line-item decisions.',
  },
  {
    id: 'INGEST-07',
    pipelineName: 'User Access Composite Report Pipeline',
    service: 'UserAccessReportService',
    method: 'persistToDatabase',
    concurrencyProtection: 'PostgreSQL ACID transaction (BEGIN / COMMIT / ROLLBACK) in 500-row chunks',
    targetTables: ['oracle_raw_user_access', 'oracle_user_access_summary'],
    description: 'Consolidates SCIM users, SCIM role memberships, HCM worker records, and auto-provisioning rules.',
  },
];

/**
 * Catalog of API Retrieval Paths & Query Endpoints
 */
export const ORACLE_RETRIEVAL_PATHS = [
  {
    endpoint: 'GET /api/users',
    handler: 'requireUsersListAccess -> userAccessReportService.getDirectoryUsersFromDatabase / userRoleRawDbService.getRawUsers',
    sourceTables: ['oracle_raw_user_access', 'oracle_raw_users'],
    rbacPrivilege: 'USERS_LIST / USER_MANAGEMENT',
    decryptRequiredInEpic4: true, // For raw_user payload inspection in details modal
  },
  {
    endpoint: 'GET /api/users/:id',
    handler: 'requireUsersListAccess -> userRoleRawDbService.getRawUser',
    sourceTables: ['oracle_raw_users'],
    rbacPrivilege: 'USERS_LIST / USER_MANAGEMENT',
    decryptRequiredInEpic4: true,
  },
  {
    endpoint: 'GET /api/roles',
    handler: 'requirePrivilege(["ROLES_CATALOG", ...]) -> userRoleRawDbService.getRawRoles',
    sourceTables: ['oracle_raw_roles'],
    rbacPrivilege: 'ROLES_CATALOG / ROLE_READ',
    decryptRequiredInEpic4: true,
  },
  {
    endpoint: 'GET /api/roles/:name/hierarchy',
    handler: 'requirePrivilege(["ROLES_CATALOG", ...]) -> roleHierarchyService.getRoleHierarchy',
    sourceTables: ['oracle_raw_role_hierarchy'],
    rbacPrivilege: 'ROLES_CATALOG / ROLE_READ',
    decryptRequiredInEpic4: false, // Reads indexed parent_role_name, child_role_name columns
  },
  {
    endpoint: 'GET /api/audit',
    handler: 'requirePrivilege(["AUDIT_TRAIL", ...]) -> auditRawDbService.getRawAuditRecords',
    sourceTables: ['oracle_raw_audit_records'],
    rbacPrivilege: 'AUDIT_TRAIL / AUDIT_READ',
    decryptRequiredInEpic4: true, // raw_payload returned to UI
  },
  {
    endpoint: 'GET /api/risk/controls',
    handler: 'requirePrivilege(["RISK_MANAGEMENT", ...]) -> controlRawDbService.getRawControls',
    sourceTables: ['oracle_raw_controls', 'oracle_control_incidents'],
    rbacPrivilege: 'RISK_MANAGEMENT / RISK_READ',
    decryptRequiredInEpic4: true,
  },
  {
    endpoint: 'GET /api/risk/controls/:id/incidents',
    handler: 'requirePrivilege(["RISK_MANAGEMENT", ...]) -> controlRawDbService.getIncidentRows',
    sourceTables: ['oracle_incident_rows'],
    rbacPrivilege: 'RISK_MANAGEMENT / RISK_READ',
    decryptRequiredInEpic4: false, // Queries indexed columns; raw column only decrypted if deep inspect requested
  },
  {
    endpoint: 'GET /api/access-certifications',
    handler: 'requirePrivilege(["REPORTS", ...]) -> accessCertRawDbService.getCertifications',
    sourceTables: ['oracle_raw_access_certifications'],
    rbacPrivilege: 'REPORTS / REPORTS_READ',
    decryptRequiredInEpic4: true,
  },
  {
    endpoint: 'GET /api/access-certifications/:certificationId/details',
    handler: 'requirePrivilege(["REPORTS", ...]) -> accessCertRawDbService.getWorksheetRows',
    sourceTables: ['oracle_raw_certifier_worksheets'],
    rbacPrivilege: 'REPORTS / REPORTS_READ',
    decryptRequiredInEpic4: true,
  },
  {
    endpoint: 'GET /api/reports/user-access',
    handler: 'requirePrivilege(["REPORTS", ...]) -> userAccessReportService.loadFromDatabase',
    sourceTables: ['oracle_raw_user_access', 'oracle_user_access_summary'],
    rbacPrivilege: 'REPORTS / REPORTS_READ',
    decryptRequiredInEpic4: false, // Serves minimized DTOs from structured table columns
  },
];

/**
 * SQL & Report Dependencies on Raw JSON Fields
 * Documents every query, filter, and JSONB operator inspecting raw JSON columns.
 */
export const SQL_RAW_JSON_DEPENDENCIES = [
  {
    table: 'oracle_raw_users',
    column: 'raw_user',
    operator: `raw_user->>'businessUnit' ILIKE $param`,
    context: 'UserRoleRawDbService.getRawUsers: Filtering directory users by business unit.',
    epic4MigrationPlan: 'VYR-028/031 will extract business_unit as a first-class indexed column, avoiding ciphertext JSON inspection.',
  },
  {
    table: 'oracle_raw_users',
    column: 'raw_user',
    operator: `jsonb_array_length(COALESCE(raw_user->'assignedRoles', '[]'::jsonb)) > 1`,
    context: 'UserRoleRawDbService.getRawUsers / getSecurityStatistics: Filtering & counting users with multiple roles.',
    epic4MigrationPlan: 'Pre-computed in oracle_raw_user_access / oracle_user_access_summary or stored as assigned_roles_count column.',
  },
  {
    table: 'oracle_raw_users',
    column: 'raw_user',
    operator: `jsonb_array_length(COALESCE(raw_user->'assignedRoles', '[]'::jsonb)) = 0`,
    context: 'UserRoleRawDbService.getRawUsers / getSecurityStatistics: Filtering & counting users without roles.',
    epic4MigrationPlan: 'Covered by oracle_user_access_summary.users_without_roles and indexed queryable flags.',
  },
  {
    table: 'oracle_raw_users',
    column: 'raw_user',
    operator: `jsonb_array_length(COALESCE(raw_user->'assignedRoles', '[]'::jsonb)) = 1`,
    context: 'UserRoleRawDbService.getRawUsers / getSecurityStatistics: Filtering & counting users with a single role.',
    epic4MigrationPlan: 'Covered by queryable count column.',
  },
  {
    table: 'oracle_raw_users',
    column: 'raw_user',
    operator: `raw_user->>'assignedRoles' ILIKE '%security administrator%'`,
    context: 'UserRoleRawDbService.getRawUsers: Filtering users holding elevated security administrator roles.',
    epic4MigrationPlan: 'Evaluated against oracle_raw_user_access where role_code / role_name are first-class queryable columns.',
  },
  {
    table: 'oracle_raw_users',
    column: 'raw_user',
    operator: `raw_user->>'assignedRoles' ILIKE '%payroll%'`,
    context: 'UserRoleRawDbService.getRawUsers: Filtering users with sensitive payroll access.',
    epic4MigrationPlan: 'Evaluated against indexed oracle_raw_user_access rows.',
  },
  {
    table: 'oracle_raw_audit_records',
    column: 'raw_payload',
    operator: `raw_payload->>'userName' ILIKE $param`,
    context: 'AuditRawDbService.getRawAuditRecords: Fallback username match when username column is null.',
    epic4MigrationPlan: 'Enforce non-null username extraction at ingestion boundary (VYR-032/033); raw_payload encrypted with Node.js decryption on read.',
  },
  {
    table: 'oracle_raw_audit_records',
    column: 'raw_payload',
    operator: `raw_payload->>'eventType' ILIKE $param`,
    context: 'AuditRawDbService.getRawAuditRecords: Fallback event action filter.',
    epic4MigrationPlan: 'Enforce event_type extraction at ingestion boundary.',
  },
  {
    table: 'oracle_control_incidents',
    column: 'raw_incidents',
    operator: `jsonb_typeof(raw_incidents) = 'array' AND jsonb_array_length(raw_incidents) > COALESCE(total_incidents, 0)`,
    context: 'ControlRawDbService.runStartupHealing: Auto-heals total_incidents count if out of sync with raw array.',
    epic4MigrationPlan: 'Total count and status counts maintained via oracle_incident_rows_sync table without scanning ciphertext.',
  },
  {
    table: 'oracle_control_incidents',
    column: 'raw_incidents',
    operator: `jsonb_array_elements(c.raw_incidents)`,
    context: 'ControlRawDbService.normalizeIncidentRows: Normalizes incident rows into oracle_incident_rows.',
    epic4MigrationPlan: 'Normalization occurs in Node.js ingestion pipeline before encryption (VYR-033/040).',
  },
];
