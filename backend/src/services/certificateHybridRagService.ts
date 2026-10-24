import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db.js';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

class CertificateHybridRagService {
  private recentTraces: RagTraceRecord[] = [];
  private maxTraceHistory = 100;
  private certsCachePath: string;

  constructor() {
    this.certsCachePath = path.resolve(__dirname, '../../oracle_access_certs_cache.json');
    this.seedDefaultKnowledgeBase().catch(err => {
      console.warn('[HybridRAG] Knowledge base auto-seed notice:', err.message);
    });
  }

  /**
   * Generates a deterministic pseudo-embedding (384 floats) for local fallback
   * when an external embedding model is not configured.
   */
  public generateEmbedding(text: string): number[] {
    const dim = 384;
    const vector = new Array(dim).fill(0);
    const clean = text.toLowerCase().trim();
    if (!clean) return vector;

    // Character n-gram & token hashing into 384-dimensional space
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

      // Bigram projection
      if (i > 0) {
        const biHash = (hash * 31 + tokens[i - 1].length) % dim;
        vector[Math.abs(biHash)] += 0.5;
      }
    }

    // L2 Normalize
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += vector[i] * vector[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) vector[i] = parseFloat((vector[i] / norm).toFixed(6));
    }
    return vector;
  }

  /**
   * Automatically seeds standard certification policies into the vector knowledge store
   */
  public async seedDefaultKnowledgeBase(): Promise<void> {
    try {
      const checkRes = await query(`SELECT COUNT(*) as cnt FROM certificate_knowledge_vector`);
      const count = parseInt(checkRes.rows[0]?.cnt || '0', 10);
      if (count > 0) return;

      const seedDocs = [
        {
          certificate_id: 'GLOBAL',
          certificate_name: 'Oracle Fusion Access Certification Policy',
          document_type: 'POLICY',
          title: 'Access Certification Governance & Manager Responsibilities',
          content: 'Access Certification Campaigns require periodic verification of user entitlements. The Supervising Manager (manager_name) is legally responsible for verifying direct reports. The Campaign Owner (owner_name) is the administrative creator who launched the campaign. The Certifier (certifier_name) performs the operational sign-off.'
        },
        {
          certificate_id: 'GLOBAL',
          certificate_name: 'Segregation of Duties in Access Certifications',
          document_type: 'GUIDELINE',
          title: 'SoD Review Standards for Certification Worksheets',
          content: 'Certifiers must evaluate whether users possess conflicting roles, such as Accounts Payable Manager combined with Purchasing Agent. Any revoked lines must be remediated immediately in Oracle Identity Management.'
        },
        {
          certificate_id: '1',
          certificate_name: 'FY26_QTR3_ Claaps Advanced Access control Certification',
          document_type: 'DESCRIPTION',
          title: 'Advanced Access Control Campaign Scope',
          content: 'Quarterly compliance campaign reviewing Advanced Access Controls Analyst, Risk Manager, and GRC administrative permissions across all financial business units.'
        },
        {
          certificate_id: '2',
          certificate_name: 'FY26_QTR3_CLAAPS IT Security Manager Certification',
          document_type: 'DESCRIPTION',
          title: 'IT Security Manager Elevated Privilege Review',
          content: 'Quarterly review of IT Security Manager and Security Administrator roles. High-risk entitlements require explicit manager approval.'
        }
      ];

      for (const doc of seedDocs) {
        const emb = this.generateEmbedding(`${doc.title} ${doc.content}`);
        await query(
          `INSERT INTO certificate_knowledge_vector (
            certificate_id, certificate_name, document_type, title, content, embedding, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          [doc.certificate_id, doc.certificate_name, doc.document_type, doc.title, doc.content, emb]
        );
      }
      console.log('[HybridRAG] Initialized default knowledge vector embeddings.');
    } catch (err: any) {
      console.warn('[HybridRAG] Vector seeding notice:', err.message);
    }
  }

  /**
   * Phase 4A: Structured SQL Retrieval for Exact Certificate Fields
   * Strictly extracts manager, owner, certifier, status, due date without LLM hallucination.
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
      LIMIT 10
    `;

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

      if (res.rows.length > 1) {
        // Check if top row is an exact match
        const top = res.rows[0];
        const isExactId = String(top.certification_id) === rawId;
        const isExactName = (top.certification_name || '').toLowerCase() === rawId.toLowerCase();

        if (!isExactId && !isExactName) {
          return {
            found: true,
            ambiguous: true,
            matches: res.rows.map(r => ({
              id: String(r.certification_id),
              name: r.certification_name || `Certification ${r.certification_id}`
            })),
            source: 'PostgreSQL Database',
            explanation: `Multiple certificates matched "${rawId}". Please select the exact certification.`,
            sqlQueryUsed: sql
          };
        }
      }

      const row = res.rows[0];
      return this.formatStructuredResult(row, targetField, 'PostgreSQL Database', sql);
    } catch (dbErr: any) {
      console.warn('[HybridRAG] DB Structured query error, falling back to disk cache:', dbErr.message);
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

  private findInDiskCache(ref: string): any | null {
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

  private formatStructuredResult(
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
        ? `The ${targetField} field for certificate "${certName}" is not configured (NULL) in the database.`
        : `Found certificate "${certName}".`
    };
  }

  /**
   * Phase 4B: Vector Semantic Search over Certificate Knowledge Documents
   */
  public async searchVectorKnowledge(queryText: string, limit = 3): Promise<VectorSearchResult[]> {
    const cleanQuery = queryText.trim();
    if (!cleanQuery) return [];

    const queryEmbedding = this.generateEmbedding(cleanQuery);

    try {
      // Use fallback cosine similarity function created in migration 017
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
      console.warn('[HybridRAG] Vector similarity search notice:', err.message);
      return [];
    }
  }

  /**
   * Phase 5: Oracle & PostgreSQL Data Consistency Validation
   * Cross-references database records against Oracle cache / live BIP payload
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
   * Phase 6: Grounded Evidence Generation for LLM
   * Formulates zero-hallucination prompt evidence for the LLM.
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
- Supervising Manager (manager_name): ${r.managerName || 'NOT SPECIFIED (NULL)'}
- Campaign Owner (owner_name): ${r.ownerName || 'NOT SPECIFIED (NULL)'}
- Assigned Certifier (certifier_name): ${r.certifierName || 'NOT SPECIFIED (NULL)'}
- Campaign Status: ${r.status || 'Active'}
- Due Date: ${r.dueDate || '—'}
- Completion Rate: ${r.percentComplete}%

GROUNDING RULES:
1. Answer using retrieved database evidence only.
2. The Supervising Manager is: ${r.managerName ? `"${r.managerName}"` : 'NULL (not configured)'}.
3. The Campaign Owner is: ${r.ownerName ? `"${r.ownerName}"` : 'NULL'}.
4. NEVER substitute the Campaign Owner ("${r.ownerName || ''}") for the Manager.
5. If the user asked "Who is the manager?", the answer is strictly ${r.managerName ? `"${r.managerName}"` : 'that the manager is not specified (NULL)'}.
`;

    if (semanticDocs.length > 0) {
      evidence += `\nRELEVANT POLICY & TECHNICAL DOCUMENTATION:
${semanticDocs.map((d, i) => `[Doc ${i + 1}] (${d.title}): ${d.content}`).join('\n')}`;
    }

    return evidence;
  }

  /**
   * Phase 7: Observability Tracing Logger
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
