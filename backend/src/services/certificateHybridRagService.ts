import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db.js';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ColumnMetadata {
  name: string;
  dataType: string;
  isNullable: boolean;
}

export interface TableMetadata {
  tableName: string;
  primaryKey: string;
  columns: Record<string, ColumnMetadata>;
}

export interface BusinessMetadataDefinition {
  term: string;
  synonyms: string[];
  table: string;
  column: string;
  authoritativeSource: 'ORACLE_LIVE' | 'POSTGRESQL_DB';
  description: string;
}

export const BUSINESS_METADATA_REGISTRY: Record<string, BusinessMetadataDefinition> = {
  manager: {
    term: 'manager',
    synonyms: ['supervising manager', 'manager_name', 'reporting manager', 'manager name'],
    table: 'oracle_raw_access_certifications',
    column: 'manager_name',
    authoritativeSource: 'ORACLE_LIVE',
    description: 'The supervising manager legally accountable for verifying certification review'
  },
  owner: {
    term: 'owner',
    synonyms: ['campaign owner', 'owner_name', 'creator', 'created by', 'owner name'],
    table: 'oracle_raw_access_certifications',
    column: 'owner_name',
    authoritativeSource: 'ORACLE_LIVE',
    description: 'The administrative user who configured and launched the certification campaign'
  },
  certifier: {
    term: 'certifier',
    synonyms: ['certifier_name', 'reviewer', 'certified by', 'assigned certifier'],
    table: 'oracle_raw_access_certifications',
    column: 'certifier_name',
    authoritativeSource: 'ORACLE_LIVE',
    description: 'The designated certifier who signs off on line item access rights'
  },
  status: {
    term: 'status',
    synonyms: ['state', 'campaign status', 'lifecycle'],
    table: 'oracle_raw_access_certifications',
    column: 'status',
    authoritativeSource: 'ORACLE_LIVE',
    description: 'Operational status of the certification campaign (Active, Inactive, Closed)'
  },
  due: {
    term: 'due',
    synonyms: ['due date', 'due_date', 'deadline', 'expiry'],
    table: 'oracle_raw_access_certifications',
    column: 'due_date',
    authoritativeSource: 'ORACLE_LIVE',
    description: 'Target completion date for the certification review'
  },
  complete: {
    term: 'complete',
    synonyms: ['completion', 'percent complete', 'percent_complete', 'progress'],
    table: 'oracle_raw_access_certifications',
    column: 'percent_complete',
    authoritativeSource: 'POSTGRESQL_DB',
    description: 'Calculated progress percentage of completed worksheet items'
  },
  direct_manager: {
    term: 'direct_manager',
    synonyms: ['worksheet manager', 'direct manager', 'user manager'],
    table: 'oracle_raw_certifier_worksheets',
    column: 'direct_manager',
    authoritativeSource: 'ORACLE_LIVE',
    description: 'Direct manager of the reviewed employee recorded on the certification worksheet'
  }
};

export interface RagTraceRecord {
  requestId: string;
  timestamp: string;
  userQuery: string;
  identifiedCertId: string | null;
  targetField: string | null;
  retrievalMethod: 'STRUCTURED_SQL' | 'VECTOR_SEMANTIC' | 'HYBRID';
  sqlExecuted: string | null;
  databaseSource: string;
  cacheHit: boolean;
  retrievedRecordCount: number;
  retrievedFields: Record<string, any> | null;
  vectorSimilarityScores: number[] | null;
  llmContextProvided: string;
  finalResponse: string;
  latencyMs: number;
  errors: string | null;
}

export interface StructuredCertRecord {
  certificationId: string;
  certificationName: string;
  ownerName: string | null;
  managerName: string | null;
  certifierName: string | null;
  type: string | null;
  status: string | null;
  percentComplete: number;
  dueDate: string | null;
  creationDate: string | null;
  targetFieldValue?: string | null;
  authoritativeSource?: string;
  hasDisagreement?: boolean;
  disagreementDetails?: string;
  worksheetSummary?: {
    totalLines: number;
    directManagers: string[];
    users: string[];
  };
}

export interface StructuredRetrievalResult {
  found: boolean;
  ambiguous: boolean;
  matches?: Array<{ id: string; name: string }>;
  record?: StructuredCertRecord;
  targetFieldRequested?: string;
  fieldValue?: string | null;
  isFieldNull?: boolean;
  explanation?: string;
  source: string;
  sqlQueryUsed?: string;
}

export interface VectorSearchResult {
  id: string | number;
  certificateId: string | null;
  certificateName: string | null;
  documentType: string;
  title: string;
  content: string;
  metadata: any;
  similarity: number;
}

export interface ConsistencyCheckReport {
  checkedAt: string;
  postgresCount: number;
  cacheCount: number;
  mismatches: Array<{
    certificateId: string;
    certificateName: string;
    field: string;
    postgresValue: string | null;
    cacheValue: string | null;
  }>;
  isConsistent: boolean;
  summary: string;
}

export interface AuthoritativeReconciliationResult {
  authoritativeValue: string | null;
  authoritativeSource: string;
  hasDisagreement: boolean;
  disagreementDetails?: string;
}

class CertificateHybridRagService {
  private recentTraces: RagTraceRecord[] = [];
  private maxTraceHistory = 100;
  private certsCachePath: string;
  private schemaCache: Record<string, TableMetadata> | null = null;

  constructor() {
    this.certsCachePath = path.resolve(__dirname, '../../oracle_access_certs_cache.json');
    // Schema-aware relational RAG: Row embedding generation is disabled for structured relational queries
  }

  /**
   * Automatically discovers tables, columns, data types, and primary keys from information_schema
   */
  public async discoverSchema(): Promise<Record<string, TableMetadata>> {
    if (this.schemaCache) return this.schemaCache;
    try {
      const res = await query(`
        SELECT table_name, column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('oracle_raw_access_certifications', 'oracle_raw_certifier_worksheets')
        ORDER BY table_name, ordinal_position
      `);

      const map: Record<string, TableMetadata> = {
        oracle_raw_access_certifications: {
          tableName: 'oracle_raw_access_certifications',
          primaryKey: 'certification_id',
          columns: {}
        },
        oracle_raw_certifier_worksheets: {
          tableName: 'oracle_raw_certifier_worksheets',
          primaryKey: 'id',
          columns: {}
        }
      };

      for (const row of res.rows || []) {
        if (map[row.table_name]) {
          map[row.table_name].columns[row.column_name] = {
            name: row.column_name,
            dataType: row.data_type,
            isNullable: row.is_nullable === 'YES'
          };
        }
      }
      this.schemaCache = map;
      return map;
    } catch (err: any) {
      console.warn('[StructuredRAG] Schema discovery warning:', err.message);
      return {};
    }
  }

  /**
   * Generates a safe, read-only parameterized SQL query for certificate retrieval
   */
  public generateControlledSqlQuery(
    targetField?: string,
    options: { includeWorksheetSummary?: boolean } = {}
  ): { sql: string; paramsDesc: string[] } {
    if (options.includeWorksheetSummary) {
      const sql = `
        SELECT 
          c.certification_id,
          c.certification_name,
          c.owner_name,
          c.manager_name,
          c.certifier_name,
          c.type,
          c.status,
          c.percent_complete,
          c.due_date,
          c.creation_date,
          COUNT(w.id) AS worksheet_line_count,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT w.direct_manager), NULL) AS worksheet_direct_managers,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT w.user_name), NULL) AS worksheet_users
        FROM oracle_raw_access_certifications c
        LEFT JOIN oracle_raw_certifier_worksheets w 
          ON CAST(c.certification_id AS TEXT) = CAST(w.certification_id AS TEXT)
        WHERE CAST(c.certification_id AS TEXT) = $1
           OR c.certification_name ILIKE $2
           OR c.certification_name ILIKE $3
        GROUP BY 
          c.certification_id, c.certification_name, c.owner_name, c.manager_name, 
          c.certifier_name, c.type, c.status, c.percent_complete, c.due_date, c.creation_date
        ORDER BY 
          CASE 
            WHEN CAST(c.certification_id AS TEXT) = $1 THEN 0 
            WHEN c.certification_name ILIKE $2 THEN 1 
            ELSE 2 
          END,
          c.certification_id ASC
        LIMIT 10;
      `;
      return { sql, paramsDesc: ['$1 exactId', '$2 prefixName', '$3 cleanedName'] };
    }

    const sql = `
      SELECT 
        certification_id,
        certification_name,
        owner_name,
        manager_name,
        certifier_name,
        type,
        status,
        percent_complete,
        due_date,
        creation_date
      FROM oracle_raw_access_certifications
      WHERE CAST(certification_id AS TEXT) = $1
         OR certification_name ILIKE $2
         OR certification_name ILIKE $3
      ORDER BY 
        CASE 
          WHEN CAST(certification_id AS TEXT) = $1 THEN 0 
          WHEN certification_name ILIKE $2 THEN 1 
          ELSE 2 
        END,
        certification_id ASC
      LIMIT 10;
    `;
    return { sql, paramsDesc: ['$1 exactId', '$2 prefixName', '$3 cleanedName'] };
  }

  /**
   * Validates multi-table JOIN relationships against schema foreign key rules
   */
  public validateJoinRelationship(
    primaryTable: string,
    foreignTable: string,
    joinKey: string
  ): { valid: boolean; reason?: string } {
    const validPairs: Record<string, Record<string, string>> = {
      oracle_raw_access_certifications: {
        oracle_raw_certifier_worksheets: 'certification_id'
      },
      oracle_raw_certifier_worksheets: {
        oracle_raw_access_certifications: 'certification_id'
      }
    };

    if (!validPairs[primaryTable] || !validPairs[primaryTable][foreignTable]) {
      return {
        valid: false,
        reason: `Unsupported JOIN between "${primaryTable}" and "${foreignTable}". No validated relationship exists.`
      };
    }

    const expectedKey = validPairs[primaryTable][foreignTable];
    if (joinKey !== expectedKey) {
      return {
        valid: false,
        reason: `Invalid JOIN key "${joinKey}". Supported foreign key relationship is on "${expectedKey}".`
      };
    }

    return { valid: true };
  }

  /**
   * Reconciles field values between PostgreSQL and Oracle Cache/Live records.
   * Authoritative rules:
   * - Oracle Live is authoritative for operational person assignments (manager_name, owner_name, certifier_name).
   * - PostgreSQL is authoritative for aggregated completion metrics (percent_complete) and audit trail.
   */
  public reconcileAuthoritativeSource(
    pgRecord: StructuredCertRecord,
    targetField?: string
  ): AuthoritativeReconciliationResult {
    const cached = this.findInDiskCache(pgRecord.certificationId);
    if (!cached) {
      return {
        authoritativeValue: pgRecord.targetFieldValue ?? null,
        authoritativeSource: 'PostgreSQL Database',
        hasDisagreement: false
      };
    }

    const field = targetField || 'manager';
    const meta = BUSINESS_METADATA_REGISTRY[field];
    const authoritativeSourceType = meta ? meta.authoritativeSource : 'ORACLE_LIVE';

    let pgVal: string | null = null;
    let oracleVal: string | null = null;

    if (field === 'manager') {
      pgVal = pgRecord.managerName;
      oracleVal = cached.managerName || null;
    } else if (field === 'owner') {
      pgVal = pgRecord.ownerName;
      oracleVal = cached.ownerName || null;
    } else if (field === 'certifier') {
      pgVal = pgRecord.certifierName;
      oracleVal = cached.certifierName || null;
    }

    const hasDisagreement = !!(pgVal && oracleVal && pgVal.trim().toLowerCase() !== oracleVal.trim().toLowerCase());
    let disagreementDetails: string | undefined;

    if (hasDisagreement) {
      disagreementDetails = `Discrepancy detected for "${field}": PostgreSQL database contains "${pgVal}", while authoritative Oracle source contains "${oracleVal}". Applied authoritative source: ${authoritativeSourceType}.`;
    }

    // Apply authoritative value
    const authoritativeValue = (authoritativeSourceType === 'ORACLE_LIVE' ? oracleVal : pgVal) || pgVal || oracleVal;

    return {
      authoritativeValue,
      authoritativeSource: authoritativeSourceType === 'ORACLE_LIVE' ? 'Oracle Cloud Fusion (Authoritative Source)' : 'PostgreSQL Database (Authoritative Source)',
      hasDisagreement,
      disagreementDetails
    };
  }

  /**
   * Structured SQL Retrieval for Exact Certificate Fields
   * Strictly extracts manager, owner, certifier, status, due date with deduplication and validation.
   */
  public async getCertificateStructured(
    identifier: string,
    targetField?: 'manager' | 'owner' | 'certifier' | 'status' | 'due' | 'all'
  ): Promise<StructuredRetrievalResult> {
    const rawId = (identifier || '').trim();
    if (!rawId) {
      return {
        found: false,
        ambiguous: false,
        source: 'PostgreSQL Database',
        explanation: 'No certificate identifier provided.'
      };
    }

    const { sql } = this.generateControlledSqlQuery(targetField);
    const exactMatch = rawId;
    const prefixMatch = `%${rawId}%`;
    const cleanedSearch = `%${rawId.replace(/^(the|certificate|cert|campaign|for)\s+/i, '').trim()}%`;

    try {
      const res = await query(sql, [exactMatch, prefixMatch, cleanedSearch]);
      if (!res.rows || res.rows.length === 0) {
        // Fallback to offline disk cache if DB query returned 0 rows
        const fallbackCert = this.findInDiskCache(rawId);
        if (fallbackCert) {
          return this.formatStructuredResult(fallbackCert, targetField, 'Local Offline Cache');
        }

        return {
          found: false,
          ambiguous: false,
          source: 'PostgreSQL Database',
          explanation: `Certificate "${rawId}" was not found in the database or offline cache.`,
          sqlQueryUsed: sql
        };
      }

      // Deduplicate rows by certification_id
      const uniqueRows: any[] = [];
      const seenIds = new Set<string>();
      for (const row of res.rows) {
        const idStr = String(row.certification_id);
        if (!seenIds.has(idStr)) {
          seenIds.add(idStr);
          uniqueRows.push(row);
        }
      }

      if (uniqueRows.length > 1) {
        const top = uniqueRows[0];
        const isExactId = String(top.certification_id) === rawId;
        const isExactName = (top.certification_name || '').toLowerCase() === rawId.toLowerCase();

        if (!isExactId && !isExactName) {
          return {
            found: true,
            ambiguous: true,
            matches: uniqueRows.map(r => ({
              id: String(r.certification_id),
              name: r.certification_name || `Certification ${r.certification_id}`
            })),
            source: 'PostgreSQL Database',
            explanation: `Multiple certificates matched "${rawId}". Please select the exact certification.`,
            sqlQueryUsed: sql
          };
        }
      }

      const row = uniqueRows[0];
      return this.formatStructuredResult(row, targetField, 'PostgreSQL Database', sql);
    } catch (dbErr: any) {
      console.warn('[StructuredRAG] DB query error, falling back to disk cache:', dbErr.message);
      const fallbackCert = this.findInDiskCache(rawId);
      if (fallbackCert) {
        return this.formatStructuredResult(fallbackCert, targetField, 'Local Offline Cache');
      }
      return {
        found: false,
        ambiguous: false,
        source: 'PostgreSQL Database (Error)',
        explanation: `Database query failed: ${dbErr.message}`,
        sqlQueryUsed: sql
      };
    }
  }

  public findInDiskCache(ref: string): any | null {
    try {
      if (!fs.existsSync(this.certsCachePath)) return null;
      const raw = fs.readFileSync(this.certsCachePath, 'utf8');
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return null;

      const clean = ref.toLowerCase().trim();
      return (
        list.find((c: any) => String(c.certificationId || c.id) === clean) ||
        list.find((c: any) => (c.certificationName || c.name || '').toLowerCase() === clean) ||
        list.find((c: any) => (c.certificationName || c.name || '').toLowerCase().includes(clean)) ||
        null
      );
    } catch (_) {
      return null;
    }
  }

  public formatStructuredResult(
    rawRow: any,
    targetField: string | undefined,
    source: string,
    sqlQueryUsed?: string
  ): StructuredRetrievalResult {
    const certId = String(rawRow.certification_id ?? rawRow.certificationId ?? rawRow.id ?? '');
    const certName = rawRow.certification_name || rawRow.certificationName || rawRow.name || `Certification ${certId}`;
    const ownerName = rawRow.owner_name || rawRow.ownerName || null;
    const managerName = rawRow.manager_name || rawRow.managerName || null;
    const certifierName = rawRow.certifier_name || rawRow.certifierName || null;
    const status = rawRow.status || 'Active';
    const type = rawRow.type || 'Standard';
    const percent = typeof rawRow.percent_complete === 'number' 
      ? rawRow.percent_complete 
      : Number(rawRow.certificationPercentComplete || 0);
    const dueDate = rawRow.due_date || rawRow.dueDate || null;
    const creationDate = rawRow.creation_date || rawRow.creationDate || null;

    let targetVal: string | null = null;
    let isNull = false;

    if (targetField === 'manager') {
      targetVal = managerName;
      isNull = !managerName || managerName.trim() === '';
    } else if (targetField === 'owner') {
      targetVal = ownerName;
      isNull = !ownerName || ownerName.trim() === '';
    } else if (targetField === 'certifier') {
      targetVal = certifierName;
      isNull = !certifierName || certifierName.trim() === '';
    } else if (targetField === 'status') {
      targetVal = status;
    } else if (targetField === 'due') {
      targetVal = dueDate;
    }

    const record: StructuredCertRecord = {
      certificationId: certId,
      certificationName: certName,
      ownerName,
      managerName,
      certifierName,
      type,
      status,
      percentComplete: percent,
      dueDate,
      creationDate,
      targetFieldValue: targetVal
    };

    // Reconcile authoritative source & flag any discrepancies
    const reconciliation = this.reconcileAuthoritativeSource(record, targetField);
    record.authoritativeSource = reconciliation.authoritativeSource;
    record.hasDisagreement = reconciliation.hasDisagreement;
    record.disagreementDetails = reconciliation.disagreementDetails;

    return {
      found: true,
      ambiguous: false,
      record,
      targetFieldRequested: targetField,
      fieldValue: targetVal,
      isFieldNull: isNull,
      source,
      sqlQueryUsed,
      explanation: isNull
        ? `The ${targetField || 'requested'} field for certificate "${certName}" is not configured (NULL) in the database.`
        : `Found certificate "${certName}".`
    };
  }

  /**
   * Generates deterministic pseudo-embedding (384 floats) - retained for backward compatibility
   */
  public generateEmbedding(text: string): number[] {
    const dim = 384;
    const vector = new Array(dim).fill(0);
    const clean = text.toLowerCase().trim();
    if (!clean) return vector;

    const tokens = clean.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      let hash = 0;
      for (let j = 0; j < tok.length; j++) {
        hash = (hash << 5) - hash + tok.charCodeAt(j);
        hash |= 0;
      }
      const idx = Math.abs(hash) % dim;
      vector[idx] += 1.0;
    }

    let norm = 0;
    for (let i = 0; i < dim; i++) norm += vector[i] * vector[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) vector[i] = parseFloat((vector[i] / norm).toFixed(6));
    }
    return vector;
  }

  /**
   * Passive fallback vector search - retained for non-breaking compatibility
   */
  public async searchVectorKnowledge(queryText: string, limit = 3): Promise<VectorSearchResult[]> {
    const cleanQuery = queryText.trim();
    if (!cleanQuery) return [];

    const queryEmbedding = this.generateEmbedding(cleanQuery);

    try {
      const sql = `
        SELECT 
          id,
          certificate_id,
          certificate_name,
          document_type,
          title,
          content,
          metadata,
          cosine_similarity_float8(embedding, $1) AS similarity
        FROM certificate_knowledge_vector
        WHERE embedding IS NOT NULL
        ORDER BY similarity DESC
        LIMIT $2
      `;

      const res = await query(sql, [queryEmbedding, limit]);
      return (res.rows || []).map(r => ({
        id: r.id,
        certificateId: r.certificate_id,
        certificateName: r.certificate_name,
        documentType: r.document_type,
        title: r.title,
        content: r.content,
        metadata: r.metadata,
        similarity: parseFloat(Number(r.similarity || 0).toFixed(4))
      }));
    } catch (err: any) {
      return [];
    }
  }

  /**
   * Oracle & PostgreSQL Data Consistency Validation
   */
  public async validateConsistency(): Promise<ConsistencyCheckReport> {
    const report: ConsistencyCheckReport = {
      checkedAt: new Date().toISOString(),
      postgresCount: 0,
      cacheCount: 0,
      mismatches: [],
      isConsistent: true,
      summary: ''
    };

    try {
      const dbRes = await query(`SELECT certification_id, certification_name, owner_name, manager_name, certifier_name FROM oracle_raw_access_certifications`);
      const dbRows = dbRes.rows || [];
      report.postgresCount = dbRows.length;

      let cacheList: any[] = [];
      if (fs.existsSync(this.certsCachePath)) {
        cacheList = JSON.parse(fs.readFileSync(this.certsCachePath, 'utf8'));
        report.cacheCount = Array.isArray(cacheList) ? cacheList.length : 0;
      }

      for (const dbRow of dbRows) {
        const id = String(dbRow.certification_id);
        const cacheItem = cacheList.find((c: any) => String(c.certificationId || c.id) === id);
        if (cacheItem) {
          if (dbRow.manager_name && cacheItem.managerName && dbRow.manager_name !== cacheItem.managerName) {
            report.mismatches.push({
              certificateId: id,
              certificateName: dbRow.certification_name,
              field: 'manager_name',
              postgresValue: dbRow.manager_name,
              cacheValue: cacheItem.managerName
            });
          }
          if (dbRow.owner_name && cacheItem.ownerName && dbRow.owner_name !== cacheItem.ownerName) {
            report.mismatches.push({
              certificateId: id,
              certificateName: dbRow.certification_name,
              field: 'owner_name',
              postgresValue: dbRow.owner_name,
              cacheValue: cacheItem.ownerName
            });
          }
        }
      }

      report.isConsistent = report.mismatches.length === 0;
      report.summary = report.isConsistent
        ? `Oracle and PostgreSQL records are 100% consistent across ${report.postgresCount} certifications.`
        : `Found ${report.mismatches.length} discrepancy items between PostgreSQL and Oracle cache.`;
    } catch (err: any) {
      report.summary = `Consistency check error: ${err.message}`;
    }

    return report;
  }

  /**
   * Grounded Evidence Generation for LLM with Anti-Hallucination Constraints
   */
  public buildGroundedEvidence(
    structured: StructuredRetrievalResult,
    semanticDocs: VectorSearchResult[] = []
  ): string {
    if (!structured.found || !structured.record) {
      return `STATUS: CERTIFICATE_NOT_FOUND\nREASON: ${structured.explanation || 'No matching record exists in the database.'}`;
    }

    const r = structured.record;
    let evidence = `AUTHORITATIVE DATABASE RECORD (Source: ${structured.source}):
- Certificate ID: ${r.certificationId}
- Certificate Name: ${r.certificationName}
- Supervising Manager (manager_name): ${r.managerName || 'NOT CONFIGURED (NULL)'}
- Campaign Owner (owner_name): ${r.ownerName || 'NOT SPECIFIED (NULL)'}
- Assigned Certifier (certifier_name): ${r.certifierName || 'NOT SPECIFIED (NULL)'}
- Campaign Status: ${r.status || 'Active'}
- Due Date: ${r.dueDate || '—'}
- Completion Rate: ${r.percentComplete}%
- Authoritative Data Source: ${r.authoritativeSource || 'PostgreSQL Database'}`;

    if (r.hasDisagreement && r.disagreementDetails) {
      evidence += `\n- NOTICE: ${r.disagreementDetails}`;
    }

    evidence += `\n
STRICT GROUNDING & RETRIEVAL RULES:
1. Answer using ONLY the retrieved structured database evidence above.
2. The Supervising Manager is: ${r.managerName ? `"${r.managerName}"` : 'NULL (not configured)'}.
3. The Campaign Owner is: ${r.ownerName ? `"${r.ownerName}"` : 'NULL'}.
4. NEVER substitute the Campaign Owner ("${r.ownerName || ''}") for the Supervising Manager.
5. If the manager is NULL/empty, explicitly state that the supervising manager is not configured (NULL) in the database.
6. Do NOT invent, assume, or modify any database values.
`;

    if (semanticDocs.length > 0) {
      evidence += `\nSUPPLEMENTARY REFERENCE POLICIES:
${semanticDocs.map((d, i) => `[Doc ${i + 1}] (${d.title}): ${d.content}`).join('\n')}`;
    }

    return evidence;
  }

  /**
   * Observability Tracing Logger
   */
  public logTrace(trace: RagTraceRecord): void {
    this.recentTraces.unshift(trace);
    if (this.recentTraces.length > this.maxTraceHistory) {
      this.recentTraces.pop();
    }
    console.log(`[RAG Trace ${trace.requestId}] ${trace.retrievalMethod} | Query: "${trace.userQuery}" | Found: ${trace.retrievedRecordCount} | Latency: ${trace.latencyMs}ms`);
  }

  public getRecentTraces(limit = 20): RagTraceRecord[] {
    return this.recentTraces.slice(0, limit);
  }
}

export const certificateHybridRagService = new CertificateHybridRagService();
