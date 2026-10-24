export interface UniversalQueryTrace {
  requestId: string;
  timestamp: string;
  userQuestion: string;
  resolvedFollowUp?: string;
  identifiedIntent: string;
  extractedEntities: string[];
  relevantSchemaSelected: string[];
  selectedDatabaseSource: string;
  generatedSql: string | null;
  sqlParametersRedacted: any[];
  sqlValidationPassed: boolean;
  validationError?: string;
  executionTimeMs: number;
  returnedRecordCount: number;
  dataFreshness: string;
  databaseErrors?: string | null;
  finalAnswerSummary: string;
  answerValidationStatus: 'VERIFIED_FAITHFUL' | 'EMPTY_MATCH' | 'AMBIGUOUS' | 'FAILED';
}

export class ObservabilityTraceService {
  private recentTraces: UniversalQueryTrace[] = [];
  private readonly MAX_HISTORY = 100;

  /**
   * Logs a complete structured execution trace with credential redaction.
   */
  public logTrace(trace: UniversalQueryTrace): void {
    // Redact any parameters that look like credentials or tokens
    const redactedParams = (trace.sqlParametersRedacted || []).map(p => {
      if (typeof p === 'string' && (p.includes('Bearer ') || p.length > 80)) {
        return '[REDACTED_SECRET]';
      }
      return p;
    });

    const safeTrace: UniversalQueryTrace = {
      ...trace,
      sqlParametersRedacted: redactedParams
    };

    this.recentTraces.unshift(safeTrace);
    if (this.recentTraces.length > this.MAX_HISTORY) {
      this.recentTraces.pop();
    }

    console.log(
      `[UniversalTrace ${safeTrace.requestId}] ` +
      `Tables: [${safeTrace.relevantSchemaSelected.join(', ')}] | ` +
      `Rows: ${safeTrace.returnedRecordCount} | ` +
      `Latency: ${safeTrace.executionTimeMs}ms | ` +
      `Status: ${safeTrace.answerValidationStatus} | ` +
      `Q: "${safeTrace.userQuestion}"`
    );
  }

  public getRecentTraces(limit = 25): UniversalQueryTrace[] {
    return this.recentTraces.slice(0, limit);
  }

  public getTraceById(requestId: string): UniversalQueryTrace | null {
    return this.recentTraces.find(t => t.requestId === requestId) || null;
  }
}

export const observabilityTraceService = new ObservabilityTraceService();
