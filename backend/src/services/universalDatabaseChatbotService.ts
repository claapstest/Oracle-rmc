import { schemaLinkingService } from './schemaLinkingService.js';
import { textToSqlService } from './textToSqlService.js';
import { sqlValidatorService } from './sqlValidatorService.js';
import { sourceRoutingService } from './sourceRoutingService.js';
import { resultVerificationService } from './resultVerificationService.js';
import { groundedAnswerService, GroundedAnswerResult } from './groundedAnswerService.js';
import { conversationContextService } from './conversationContextService.js';
import { observabilityTraceService, UniversalQueryTrace } from './observabilityTraceService.js';

export interface AIResponse {
  message: string;
  intent: string;
  parameters: any;
  toolResult: any;
  structuredData?: any;
  aiExplanation?: string;
}

export class UniversalDatabaseChatbotService {
  /**
   * Executes a universal, schema-aware query across any accessible PostgreSQL / Oracle database table.
   */
  public async processQuery(userQuery: string, context?: any): Promise<AIResponse> {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const sessionId = (context && (context.sessionId || context.username || context.userId)) || 'default_session';

    // 1. Resolve Multi-Turn Conversation Context & Pronouns
    const { resolvedQuery, historySummary } = conversationContextService.resolveContextualQuery(sessionId, userQuery);

    // 2. Intelligent Schema Linking (Sub-schema selection)
    const linkedSchema = await schemaLinkingService.linkSchema(resolvedQuery);

    // 3. General-Purpose Text-to-SQL Generation
    const sqlPlan = await textToSqlService.generateSqlPlan(resolvedQuery, linkedSchema, historySummary);

    // If query was ambiguous or impossible to map to accessible tables
    if (sqlPlan.isAmbiguous || !sqlPlan.sql) {
      const explanation = sqlPlan.clarificationMessage || 'The requested information does not exist or is ambiguous in the accessible database tables.';
      const trace: UniversalQueryTrace = {
        requestId,
        timestamp: new Date().toISOString(),
        userQuestion: userQuery,
        resolvedFollowUp: resolvedQuery !== userQuery ? resolvedQuery : undefined,
        identifiedIntent: 'UNIVERSAL_DATABASE_QUERY',
        extractedEntities: linkedSchema.matchedEntities,
        relevantSchemaSelected: linkedSchema.selectedTables,
        selectedDatabaseSource: 'PostgreSQL Database',
        generatedSql: null,
        sqlParametersRedacted: [],
        sqlValidationPassed: false,
        validationError: explanation,
        executionTimeMs: Date.now() - startTime,
        returnedRecordCount: 0,
        dataFreshness: 'N/A',
        finalAnswerSummary: explanation,
        answerValidationStatus: 'AMBIGUOUS'
      };
      observabilityTraceService.logTrace(trace);

      return {
        message: explanation,
        intent: 'UNIVERSAL_DATABASE_QUERY',
        parameters: { query: userQuery, targetEntity: sqlPlan.targetEntity },
        toolResult: {
          tool: 'universalDatabaseQuery',
          parameters: { query: userQuery },
          dataSource: 'PostgreSQL Database',
          timestamp: new Date().toISOString(),
          success: false,
          error: explanation
        },
        structuredData: {
          title: 'Database Query Clarification',
          summary: explanation,
          keyFindings: [explanation],
          riskHighlights: []
        }
      };
    }

    // 4. Strict AST Parsing, Table Allowlists & Security Validation
    const validation = await sqlValidatorService.validateAndSanitizeSql(sqlPlan.sql);
    if (!validation.isValid) {
      const rejection = validation.rejectionReason || 'Security rejection: unauthorized query structure.';
      console.warn(`[UniversalChatbot] Query rejected by security layer: ${rejection}`);

      const trace: UniversalQueryTrace = {
        requestId,
        timestamp: new Date().toISOString(),
        userQuestion: userQuery,
        resolvedFollowUp: resolvedQuery !== userQuery ? resolvedQuery : undefined,
        identifiedIntent: 'UNIVERSAL_DATABASE_QUERY',
        extractedEntities: linkedSchema.matchedEntities,
        relevantSchemaSelected: validation.tablesUsed,
        selectedDatabaseSource: 'PostgreSQL Database',
        generatedSql: sqlPlan.sql,
        sqlParametersRedacted: sqlPlan.parameters,
        sqlValidationPassed: false,
        validationError: rejection,
        executionTimeMs: Date.now() - startTime,
        returnedRecordCount: 0,
        dataFreshness: 'N/A',
        finalAnswerSummary: rejection,
        answerValidationStatus: 'FAILED'
      };
      observabilityTraceService.logTrace(trace);

      return {
        message: `Query rejected by database security policy: ${rejection}`,
        intent: 'UNIVERSAL_DATABASE_QUERY',
        parameters: { query: userQuery },
        toolResult: {
          tool: 'universalDatabaseQuery',
          parameters: { query: userQuery },
          dataSource: 'PostgreSQL Database',
          timestamp: new Date().toISOString(),
          success: false,
          error: rejection
        },
        structuredData: {
          title: 'Database Security Rejection',
          summary: rejection,
          keyFindings: ['The query requested unauthorized operations, unapproved tables, or sensitive columns.'],
          riskHighlights: [rejection]
        }
      };
    }

    // 5. Source Routing and Safe Read-Only Execution
    const queryResult = await sourceRoutingService.executeValidatedQuery(
      validation.sanitizedSql,
      sqlPlan.parameters,
      { targetEntity: sqlPlan.targetEntity }
    );

    console.log(`\n================================================================================`);
    console.log(`🤖 [UNIVERSAL DATABASE CHATBOT - TEXT-TO-SQL EXECUTED]`);
    console.log(`📝 Question:       "${userQuery}"`);
    console.log(`🗄️  Schema Tables:  ${validation.tablesUsed.join(', ')}`);
    console.log(`💾 Generated SQL:`);
    console.log(`   ${validation.sanitizedSql}`);
    console.log(`⚙️  SQL Parameters: ${JSON.stringify(sqlPlan.parameters)}`);
    console.log(`📊 Records Found:  ${queryResult.rowCount}`);
    console.log(`⏱️  Engine Latency: ${Date.now() - startTime}ms`);
    console.log(`================================================================================\n`);

    // 6. Deep Result Verification & Semantic Checks
    const verification = resultVerificationService.verifyResult(queryResult, resolvedQuery);

    // 7. Grounded Answer Synthesis
    const grounded = await groundedAnswerService.generateGroundedAnswer(
      resolvedQuery,
      queryResult,
      verification,
      validation.sanitizedSql
    );

    // 8. Record Multi-turn Conversational Memory
    const primaryResultIds = verification.cleanRows.slice(0, 5).map(
      r => String(r.id || r.certification_id || r.role_code || r.username || r.control_id || '')
    ).filter(Boolean);

    conversationContextService.recordTurn(sessionId, {
      id: requestId,
      timestamp: new Date().toISOString(),
      userQuery,
      resolvedQuery,
      targetEntity: sqlPlan.targetEntity,
      activeFilters: {},
      lastResultIds: primaryResultIds,
      lastSqlUsed: validation.sanitizedSql
    });

    // 9. Structured Observability Trace
    const totalLatency = Date.now() - startTime;
    const trace: UniversalQueryTrace = {
      requestId,
      timestamp: new Date().toISOString(),
      userQuestion: userQuery,
      resolvedFollowUp: resolvedQuery !== userQuery ? resolvedQuery : undefined,
      identifiedIntent: 'UNIVERSAL_DATABASE_QUERY',
      extractedEntities: linkedSchema.matchedEntities,
      relevantSchemaSelected: validation.tablesUsed,
      selectedDatabaseSource: queryResult.databaseSource,
      generatedSql: validation.sanitizedSql,
      sqlParametersRedacted: sqlPlan.parameters,
      sqlValidationPassed: true,
      executionTimeMs: queryResult.executionTimeMs,
      returnedRecordCount: queryResult.rowCount,
      dataFreshness: queryResult.isCached ? 'Cached Snapshot' : 'Live Synchronized',
      databaseErrors: queryResult.error || null,
      finalAnswerSummary: grounded.message,
      answerValidationStatus: verification.hasRows ? 'VERIFIED_FAITHFUL' : 'EMPTY_MATCH'
    };
    observabilityTraceService.logTrace(trace);

    // 10. Return frontend-compatible response
    return {
      message: grounded.message,
      intent: 'UNIVERSAL_DATABASE_QUERY',
      parameters: {
        query: userQuery,
        resolvedQuery,
        sql: validation.sanitizedSql,
        databaseSource: queryResult.databaseSource
      },
      toolResult: {
        tool: 'universalDatabaseQuery',
        parameters: { query: userQuery, sql: validation.sanitizedSql },
        dataSource: queryResult.databaseSource,
        timestamp: new Date().toISOString(),
        success: queryResult.success,
        data: verification.cleanRows
      },
      structuredData: grounded.structuredData,
      aiExplanation: grounded.aiExplanation
    };
  }
}

export const universalDatabaseChatbotService = new UniversalDatabaseChatbotService();
