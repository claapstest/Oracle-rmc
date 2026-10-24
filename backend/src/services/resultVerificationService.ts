import { ExecutedQueryResult } from './sourceRoutingService.js';

export interface VerifiedResultAnalysis {
  isValid: boolean;
  hasRows: boolean;
  isAmbiguous: boolean;
  hasNullFields: boolean;
  nullFieldNames: string[];
  hasDuplicates: boolean;
  summaryMessage: string;
  dataQualityIssues: string[];
  cleanRows: any[];
}

export class ResultVerificationService {
  /**
   * Performs deep semantic verification and data-quality inspection on executed SQL results.
   */
  public verifyResult(
    queryResult: ExecutedQueryResult,
    userQuery: string,
    targetField?: string
  ): VerifiedResultAnalysis {
    const issues: string[] = [];

    if (!queryResult.success) {
      return {
        isValid: false,
        hasRows: false,
        isAmbiguous: false,
        hasNullFields: false,
        nullFieldNames: [],
        hasDuplicates: false,
        summaryMessage: `Query execution error: ${queryResult.error || 'Unknown database error'}`,
        dataQualityIssues: [queryResult.error || 'Database query failed'],
        cleanRows: []
      };
    }

    const rows = queryResult.rows;

    // 1. Check for empty results
    if (rows.length === 0) {
      return {
        isValid: true,
        hasRows: false,
        isAmbiguous: false,
        hasNullFields: false,
        nullFieldNames: [],
        hasDuplicates: false,
        summaryMessage: 'No matching records were found in the database for your query.',
        dataQualityIssues: ['No records returned'],
        cleanRows: []
      };
    }

    // 2. Check for NULL values across requested fields
    const nullFields = new Set<string>();
    for (const row of rows) {
      for (const [key, val] of Object.entries(row)) {
        if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) {
          nullFields.add(key);
        }
      }
    }

    if (nullFields.size > 0) {
      issues.push(`Unconfigured or NULL values detected for columns: ${Array.from(nullFields).join(', ')}`);
    }

    // 3. Check for duplicates based on primary key or identifier
    let hasDuplicates = false;
    const seenIds = new Set<string>();
    const cleanRows: any[] = [];

    for (const r of rows) {
      const id = r.id || r.certification_id || r.role_code || r.username || r.control_id || JSON.stringify(r);
      if (seenIds.has(String(id))) {
        hasDuplicates = true;
      } else {
        seenIds.add(String(id));
        cleanRows.push(r);
      }
    }

    if (hasDuplicates) {
      issues.push(`Duplicate records detected and deduplicated (${rows.length - cleanRows.length} duplicates removed)`);
    }

    // 4. Check for ambiguity (e.g. user asked for a specific entity but multiple matches returned)
    const isSingleEntityQuery = (
      userQuery.toLowerCase().startsWith('who is ') ||
      userQuery.toLowerCase().startsWith('what is ') ||
      /\bfor certificate \d+\b/i.test(userQuery) ||
      /\brole ['"]?[A-Za-z0-9_ ]+['"]?\b/i.test(userQuery)
    );

    const isAmbiguous = isSingleEntityQuery && cleanRows.length > 1 && !userQuery.toLowerCase().includes('all') && !userQuery.toLowerCase().includes('list');

    let summaryMessage = `Retrieved ${cleanRows.length} record${cleanRows.length === 1 ? '' : 's'} successfully from ${queryResult.databaseSource}.`;
    if (isAmbiguous) {
      summaryMessage = `Multiple matching records found (${cleanRows.length} matches). Please specify the exact record identifier.`;
    }

    return {
      isValid: true,
      hasRows: true,
      isAmbiguous,
      hasNullFields: nullFields.size > 0,
      nullFieldNames: Array.from(nullFields),
      hasDuplicates,
      summaryMessage,
      dataQualityIssues: issues,
      cleanRows
    };
  }
}

export const resultVerificationService = new ResultVerificationService();
