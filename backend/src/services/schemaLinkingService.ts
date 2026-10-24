import { schemaDiscoveryService, TableInfo } from './schemaDiscoveryService.js';
import { metadataCatalogService, VerifiedRelationship } from './metadataCatalogService.js';

export interface LinkedSchemaContext {
  matchedEntities: string[];
  selectedTables: string[];
  tableDetails: Record<string, {
    tableName: string;
    description: string;
    columns: Array<{
      name: string;
      dataType: string;
      isPrimaryKey: boolean;
      isForeignKey: boolean;
      isNullable: boolean;
      description?: string;
    }>;
  }>;
  relevantRelationships: VerifiedRelationship[];
  formattedPromptSchema: string;
}

export class SchemaLinkingService {
  /**
   * Intelligently links user natural language query to the minimal relevant database sub-schema.
   */
  public async linkSchema(userQuery: string): Promise<LinkedSchemaContext> {
    const cleanQuery = userQuery.toLowerCase();
    const schema = await schemaDiscoveryService.discoverSchema();
    const entities = metadataCatalogService.getBusinessEntities();
    const allRelationships = await metadataCatalogService.getAllRelationships();

    const matchedEntities = new Set<string>();
    const matchedTableNames = new Set<string>();

    // 1. Match business synonyms and entity names
    for (const [key, entityDef] of Object.entries(entities)) {
      for (const synonym of entityDef.synonyms) {
        // Word boundary match
        const regex = new RegExp(`\\b${synonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(cleanQuery)) {
          matchedEntities.add(key);
          matchedTableNames.add(entityDef.primaryTable);
          break;
        }
      }
    }

    // 2. Match raw table names directly if mentioned in the query
    for (const tableName of Object.keys(schema.tables)) {
      const simplified = tableName.replace(/^(oracle_raw_|veyra_)/, '').replace(/_/g, ' ');
      if (
        cleanQuery.includes(tableName.toLowerCase()) ||
        cleanQuery.includes(simplified.toLowerCase())
      ) {
        matchedTableNames.add(tableName);
      }
    }

    // 3. Match column names directly (e.g., "manager", "due_date", "department", "email")
    for (const [tName, tInfo] of Object.entries(schema.tables)) {
      for (const colName of Object.keys(tInfo.columns)) {
        if (colName.length > 3 && cleanQuery.includes(colName.toLowerCase())) {
          matchedTableNames.add(tName);
          break;
        }
      }
    }

    // If nothing matched, provide default foundational tables for enterprise security
    if (matchedTableNames.size === 0) {
      matchedTableNames.add('oracle_raw_roles');
      matchedTableNames.add('oracle_raw_users');
      matchedTableNames.add('oracle_raw_access_certifications');
    }

    // 4. Traversal of verified relationships between matched tables
    const relevantRelationships: VerifiedRelationship[] = [];
    const tableList = Array.from(matchedTableNames);

    for (let i = 0; i < tableList.length; i++) {
      for (let j = i + 1; j < tableList.length; j++) {
        const rel = await metadataCatalogService.findRelationship(tableList[i], tableList[j]);
        if (rel) {
          relevantRelationships.push(rel);
        }
      }
    }

    // If a multi-table query seems requested (e.g., "users and roles" or "certificates and worksheets"),
    // check if a bridge table needs to be included
    if (matchedTableNames.has('oracle_raw_access_certifications') && cleanQuery.includes('worksheet')) {
      matchedTableNames.add('oracle_raw_certifier_worksheets');
      const rel = await metadataCatalogService.findRelationship('oracle_raw_access_certifications', 'oracle_raw_certifier_worksheets');
      if (rel && !relevantRelationships.includes(rel)) relevantRelationships.push(rel);
    }

    if (matchedTableNames.has('oracle_raw_controls') && cleanQuery.includes('incident')) {
      matchedTableNames.add('oracle_control_incidents');
      const rel = await metadataCatalogService.findRelationship('oracle_raw_controls', 'oracle_control_incidents');
      if (rel && !relevantRelationships.includes(rel)) relevantRelationships.push(rel);
    }

    // 5. Construct selected table details & compact formatted prompt schema
    const tableDetails: LinkedSchemaContext['tableDetails'] = {};
    const promptLines: string[] = [];

    for (const tableName of matchedTableNames) {
      const tInfo = schema.tables[tableName];
      if (!tInfo) continue;

      const entityKey = Object.keys(entities).find(k => entities[k].primaryTable === tableName);
      const desc = entityKey ? entities[entityKey].description : `PostgreSQL database table ${tableName}`;

      const cols = Object.values(tInfo.columns)
        .filter(c => !metadataCatalogService.isSensitiveColumn(c.name, tableName))
        .map(c => ({
          name: c.name,
          dataType: c.dataType,
          isPrimaryKey: c.isPrimaryKey,
          isForeignKey: c.isForeignKey,
          isNullable: c.isNullable
        }));

      tableDetails[tableName] = {
        tableName,
        description: desc,
        columns: cols
      };

      promptLines.push(`TABLE: "${tableName}" (${desc})`);
      promptLines.push(`  COLUMNS:`);
      for (const col of cols) {
        const pk = col.isPrimaryKey ? ' [PRIMARY KEY]' : '';
        const fk = col.isForeignKey ? ' [FOREIGN KEY]' : '';
        const nul = col.isNullable ? '' : ' NOT NULL';
        promptLines.push(`    - "${col.name}": ${col.dataType}${pk}${fk}${nul}`);
      }
    }

    if (relevantRelationships.length > 0) {
      promptLines.push(`\nVERIFIED RELATIONSHIPS & JOIN PATHS:`);
      for (const r of relevantRelationships) {
        promptLines.push(`  - "${r.sourceTable}"."${r.sourceColumn}" = "${r.targetTable}"."${r.targetColumn}" (${r.description})`);
      }
    }

    return {
      matchedEntities: Array.from(matchedEntities),
      selectedTables: Array.from(matchedTableNames),
      tableDetails,
      relevantRelationships,
      formattedPromptSchema: promptLines.join('\n')
    };
  }
}

export const schemaLinkingService = new SchemaLinkingService();
