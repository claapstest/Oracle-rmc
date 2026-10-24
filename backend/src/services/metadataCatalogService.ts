import { schemaDiscoveryService, DatabaseSchema, TableInfo, ColumnInfo } from './schemaDiscoveryService.js';

export interface VerifiedRelationship {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  relationshipType: 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_ONE' | 'MANY_TO_MANY';
  description: string;
}

export interface BusinessEntityDefinition {
  entityName: string;
  primaryTable: string;
  synonyms: string[];
  description: string;
  defaultColumns: string[];
  authoritativeSource: 'ORACLE_LIVE' | 'POSTGRESQL_DB' | 'HYBRID';
  commonFilters?: Record<string, string>;
}

export interface SensitiveColumnRule {
  tableName?: string;
  columnName: string;
  action: 'DENY' | 'REDACT';
  reason: string;
}

export class MetadataCatalogService {
  // Verified business join relationships across tables
  private verifiedRelationships: VerifiedRelationship[] = [
    {
      sourceTable: 'oracle_raw_access_certifications',
      sourceColumn: 'certification_id',
      targetTable: 'oracle_raw_certifier_worksheets',
      targetColumn: 'certification_id',
      relationshipType: 'ONE_TO_MANY',
      description: 'Access certification campaign links to individual user/role worksheet line items'
    },
    {
      sourceTable: 'oracle_raw_controls',
      sourceColumn: 'control_id',
      targetTable: 'oracle_control_incidents',
      targetColumn: 'control_id',
      relationshipType: 'ONE_TO_MANY',
      description: 'Advanced Access / Transaction Control links to identified policy violation incidents'
    },
    {
      sourceTable: 'oracle_raw_roles',
      sourceColumn: 'role_code',
      targetTable: 'oracle_raw_role_hierarchy',
      targetColumn: 'role_code',
      relationshipType: 'ONE_TO_MANY',
      description: 'Role catalog links to parent/child role hierarchy nodes'
    },
    {
      sourceTable: 'veyra_user',
      sourceColumn: 'id',
      targetTable: 'veyra_user_role',
      targetColumn: 'user_id',
      relationshipType: 'ONE_TO_MANY',
      description: 'Veyra user links to assigned roles junction table'
    },
    {
      sourceTable: 'veyra_role',
      sourceColumn: 'id',
      targetTable: 'veyra_user_role',
      targetColumn: 'role_id',
      relationshipType: 'ONE_TO_MANY',
      description: 'Veyra role links to assigned users junction table'
    },
    {
      sourceTable: 'veyra_role',
      sourceColumn: 'id',
      targetTable: 'veyra_role_privilege',
      targetColumn: 'role_id',
      relationshipType: 'ONE_TO_MANY',
      description: 'Veyra role links to role privileges junction table'
    },
    {
      sourceTable: 'veyra_privilege',
      sourceColumn: 'id',
      targetTable: 'veyra_role_privilege',
      targetColumn: 'privilege_id',
      relationshipType: 'ONE_TO_MANY',
      description: 'Veyra privilege links to roles that grant it'
    },
    {
      sourceTable: 'veyra_application',
      sourceColumn: 'id',
      targetTable: 'veyra_user_application_scope',
      targetColumn: 'application_id',
      relationshipType: 'ONE_TO_MANY',
      description: 'Application links to scoped users'
    },
    {
      sourceTable: 'veyra_user',
      sourceColumn: 'id',
      targetTable: 'veyra_user_application_scope',
      targetColumn: 'user_id',
      relationshipType: 'ONE_TO_MANY',
      description: 'User links to application scopes'
    }
  ];

  // Business entities and synonym mappings
  private businessEntities: Record<string, BusinessEntityDefinition> = {
    roles: {
      entityName: 'roles',
      primaryTable: 'oracle_raw_roles',
      synonyms: ['role', 'roles', 'duty role', 'job role', 'abstract role', 'data role', 'grc role', 'security role', 'catalog', 'role catalog'],
      description: 'Oracle Fusion Security Role Catalog containing Job, Duty, Abstract, Data, and GRC roles.',
      defaultColumns: ['role_code', 'role_name', 'category', 'is_custom', 'member_count'],
      authoritativeSource: 'POSTGRESQL_DB'
    },
    users: {
      entityName: 'users',
      primaryTable: 'oracle_raw_users',
      synonyms: ['user', 'users', 'employee', 'employees', 'identities', 'person', 'account', 'worker'],
      description: 'Oracle enterprise users, identities, and active personnel.',
      defaultColumns: ['username', 'display_name', 'email', 'is_active', 'user_category'],
      authoritativeSource: 'HYBRID'
    },
    certifications: {
      entityName: 'certifications',
      primaryTable: 'oracle_raw_access_certifications',
      synonyms: ['certification', 'certifications', 'certificate', 'certificates', 'campaign', 'campaigns', 'access review'],
      description: 'Oracle Access Certification review campaigns, statuses, managers, and owners.',
      defaultColumns: ['certification_id', 'certification_name', 'status', 'owner_name', 'manager_name', 'percent_complete', 'due_date'],
      authoritativeSource: 'HYBRID'
    },
    worksheets: {
      entityName: 'worksheets',
      primaryTable: 'oracle_raw_certifier_worksheets',
      synonyms: ['worksheet', 'worksheets', 'line item', 'line items', 'certifier lines'],
      description: 'Individual line-items of access certification worksheets detailing users, roles, direct managers, and certifier actions.',
      defaultColumns: ['certification_id', 'user_name', 'role_name', 'direct_manager', 'action', 'business_unit'],
      authoritativeSource: 'POSTGRESQL_DB'
    },
    controls: {
      entityName: 'controls',
      primaryTable: 'oracle_raw_controls',
      synonyms: ['control', 'controls', 'advanced controls', 'access control', 'transaction control', 'sod control', 'rule', 'rules'],
      description: 'Oracle Advanced Controls (AAC/TC) monitoring Segregation of Duties and high-risk transactional patterns.',
      defaultColumns: ['control_id', 'name', 'status', 'state'],
      authoritativeSource: 'POSTGRESQL_DB'
    },
    incidents: {
      entityName: 'incidents',
      primaryTable: 'oracle_control_incidents',
      synonyms: ['incident', 'incidents', 'violation', 'violations', 'sod conflict', 'conflicts', 'policy breach'],
      description: 'Violations and policy breach incidents flagged by Advanced Controls.',
      defaultColumns: ['incident_id', 'control_id', 'status', 'assigned_to', 'created_at'],
      authoritativeSource: 'POSTGRESQL_DB'
    },
    audits: {
      entityName: 'audits',
      primaryTable: 'oracle_raw_audit_records',
      synonyms: ['audit', 'audits', 'audit trail', 'audit history', 'audit log', 'security changes', 'modifications', 'events'],
      description: 'FSCM/HCM immutable audit trail recording configuration updates, role assignments, and attribute revisions.',
      defaultColumns: ['audit_timestamp', 'user_name', 'product_name', 'business_object_type', 'operation_type', 'attribute_name', 'old_value', 'new_value'],
      authoritativeSource: 'POSTGRESQL_DB'
    },
    platform_users: {
      entityName: 'platform_users',
      primaryTable: 'veyra_user',
      synonyms: ['platform user', 'administrator', 'system user', 'analyst', 'audit manager', 'supervisor'],
      description: 'Internal Veyra platform administrative and security user accounts.',
      defaultColumns: ['id', 'username', 'email', 'first_name', 'last_name', 'is_active'],
      authoritativeSource: 'POSTGRESQL_DB'
    }
  };

  // Sensitive columns strictly blocked or redacted from user visibility
  private sensitiveColumns: SensitiveColumnRule[] = [
    { columnName: 'password_hash', action: 'DENY', reason: 'Cryptographic credential hash protection' },
    { columnName: 'password', action: 'DENY', reason: 'Plaintext or credential field protection' },
    { columnName: 'token', action: 'DENY', reason: 'Session / API token security' },
    { columnName: 'secret', action: 'DENY', reason: 'Cryptographic secret protection' },
    { columnName: 'session_secret', action: 'DENY', reason: 'Session security' },
    { columnName: 'encryption_key', action: 'DENY', reason: 'Encryption key secrecy' }
  ];

  /**
   * Returns all verified relationships, merged with foreign keys discovered in the database.
   */
  public async getAllRelationships(): Promise<VerifiedRelationship[]> {
    const schema = await schemaDiscoveryService.discoverSchema();
    const result: VerifiedRelationship[] = [...this.verifiedRelationships];
    const seen = new Set<string>(
      result.map(r => `${r.sourceTable}:${r.sourceColumn}->${r.targetTable}:${r.targetColumn}`)
    );

    // Merge in declared foreign keys from information_schema
    for (const [tableName, tInfo] of Object.entries(schema.tables)) {
      for (const fk of tInfo.foreignKeys) {
        const key = `${tableName}:${fk.columnName}->${fk.foreignTable}:${fk.foreignColumn}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push({
            sourceTable: tableName,
            sourceColumn: fk.columnName,
            targetTable: fk.foreignTable,
            targetColumn: fk.foreignColumn,
            relationshipType: 'MANY_TO_ONE',
            description: `Declared foreign key from ${tableName}.${fk.columnName} to ${fk.foreignTable}.${fk.foreignColumn}`
          });
        }
      }
    }

    return result;
  }

  /**
   * Finds valid relationships between two tables (either direct or reverse).
   */
  public async findRelationship(tableA: string, tableB: string): Promise<VerifiedRelationship | null> {
    const relationships = await this.getAllRelationships();
    for (const r of relationships) {
      if (
        (r.sourceTable === tableA && r.targetTable === tableB) ||
        (r.sourceTable === tableB && r.targetTable === tableA)
      ) {
        return r;
      }
    }
    return null;
  }

  /**
   * Returns the list of business entity definitions.
   */
  public getBusinessEntities(): Record<string, BusinessEntityDefinition> {
    return this.businessEntities;
  }

  /**
   * Checks if a column is sensitive and must be blocked from query selection.
   */
  public isSensitiveColumn(columnName: string, tableName?: string): SensitiveColumnRule | null {
    const colLower = columnName.toLowerCase();
    for (const rule of this.sensitiveColumns) {
      if (tableName && rule.tableName && rule.tableName.toLowerCase() !== tableName.toLowerCase()) {
        continue;
      }
      if (colLower === rule.columnName || colLower.includes('password') || colLower.includes('token') || colLower.includes('secret')) {
        return rule;
      }
    }
    return null;
  }
}

export const metadataCatalogService = new MetadataCatalogService();
