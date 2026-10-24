import nodeSqlParser from 'node-sql-parser';
import { schemaDiscoveryService } from './schemaDiscoveryService.js';
import { metadataCatalogService } from './metadataCatalogService.js';

const ParserClass = (nodeSqlParser as any).Parser || (nodeSqlParser as any).default?.Parser || (nodeSqlParser as any);

export interface SqlValidationResult {
  isValid: boolean;
  sanitizedSql: string;
  tablesUsed: string[];
  columnsUsed: string[];
  rejectionReason?: string;
  hasAggregation: boolean;
}

export class SqlValidatorService {
  private parser: any;

  constructor() {
    this.parser = new ParserClass();
  }

  /**
   * Strictly validates and sanitizes LLM-generated SQL queries before database execution.
   */
  public async validateAndSanitizeSql(rawSql: string): Promise<SqlValidationResult> {
    const cleanSql = rawSql.trim().replace(/;+\s*$/, ''); // Remove trailing semicolon

    // 1. Regex Guardrail: Reject destructive keywords immediately
    const destructiveRegex = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|EXECUTE|CREATE|REINDEX|VACUUM|COMMENT|EXPLAIN|COPY|PG_SLEEP|PG_READ_FILE)\b/i;
    if (destructiveRegex.test(cleanSql)) {
      return {
        isValid: false,
        sanitizedSql: '',
        tablesUsed: [],
        columnsUsed: [],
        rejectionReason: 'Security Violation: Destructive or administrative SQL operations are strictly forbidden.',
        hasAggregation: false
      };
    }

    // 2. Reject statement stacking (multiple statements separated by ;)
    if (cleanSql.includes(';')) {
      return {
        isValid: false,
        sanitizedSql: '',
        tablesUsed: [],
        columnsUsed: [],
        rejectionReason: 'Security Violation: Multiple stacked SQL queries in a single request are forbidden.',
        hasAggregation: false
      };
    }

    // 3. AST Parsing with node-sql-parser
    let ast: any;
    try {
      ast = this.parser.astify(cleanSql, { database: 'postgresql' });
    } catch (parseErr: any) {
      // Fallback parser check for standard SELECT queries
      if (!cleanSql.toLowerCase().startsWith('select')) {
        return {
          isValid: false,
          sanitizedSql: '',
          tablesUsed: [],
          columnsUsed: [],
          rejectionReason: `SQL Syntax Error: Only SELECT queries are permitted (${parseErr.message})`,
          hasAggregation: false
        };
      }
    }

    // Check AST type if parser succeeded
    if (ast) {
      const astArray = Array.isArray(ast) ? ast : [ast];
      if (astArray.length > 1) {
        return {
          isValid: false,
          sanitizedSql: '',
          tablesUsed: [],
          columnsUsed: [],
          rejectionReason: 'Security Violation: Multiple statements detected in AST.',
          hasAggregation: false
        };
      }

      const rootType = (astArray[0].type || '').toLowerCase();
      if (rootType !== 'select') {
        return {
          isValid: false,
          sanitizedSql: '',
          tablesUsed: [],
          columnsUsed: [],
          rejectionReason: `Security Violation: AST root operation "${rootType}" is not permitted. Only "select" is allowed.`,
          hasAggregation: false
        };
      }
    }

    // 4. Extract tables and validate against discovered schema allowlist
    const schema = await schemaDiscoveryService.discoverSchema();
    const accessibleTables = new Set(Object.keys(schema.tables));

    const tablesUsed: string[] = [];
    const fromMatches = cleanSql.matchAll(/\b(?:FROM|JOIN)\s+([a-zA-Z0-9_"]+)/gi);
    for (const match of fromMatches) {
      const rawTable = match[1].replace(/["']/g, '').toLowerCase();
      if (!accessibleTables.has(rawTable) && !rawTable.startsWith('information_schema')) {
        return {
          isValid: false,
          sanitizedSql: '',
          tablesUsed: [],
          columnsUsed: [],
          rejectionReason: `Security Violation: Table "${rawTable}" is not in the accessible database schema allowlist.`,
          hasAggregation: false
        };
      }
      if (!tablesUsed.includes(rawTable)) tablesUsed.push(rawTable);
    }

    // 5. Enforce sensitive column protections
    const sensitiveColumns = ['password_hash', 'password', 'token', 'secret', 'session_secret', 'encryption_key'];
    for (const sc of sensitiveColumns) {
      const regex = new RegExp(`\\b${sc}\\b`, 'i');
      if (regex.test(cleanSql)) {
        return {
          isValid: false,
          sanitizedSql: '',
          tablesUsed,
          columnsUsed: [sc],
          rejectionReason: `Security Violation: Access to sensitive cryptographic/credential column "${sc}" is prohibited.`,
          hasAggregation: false
        };
      }
    }

    // 6. Enforce mandatory LIMIT for safety
    let sanitizedSql = cleanSql;
    const hasLimit = /\bLIMIT\s+\d+\b/i.test(cleanSql);
    const hasAggregation = /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(cleanSql);
    const hasGroupBy = /\bGROUP\s+BY\b/i.test(cleanSql);

    if (!hasLimit) {
      if (hasAggregation && !hasGroupBy) {
        // Pure scalar aggregate like SELECT COUNT(*) FROM table -> does not strictly need limit
      } else {
        // Enforce maximum 100 rows limit
        sanitizedSql = `${cleanSql} LIMIT 100`;
      }
    }

    return {
      isValid: true,
      sanitizedSql,
      tablesUsed,
      columnsUsed: [],
      hasAggregation: hasAggregation || hasGroupBy
    };
  }
}

export const sqlValidatorService = new SqlValidatorService();
