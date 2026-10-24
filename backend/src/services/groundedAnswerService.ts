import axios from 'axios';
import { config } from '../config.js';
import { VerifiedResultAnalysis } from './resultVerificationService.js';
import { ExecutedQueryResult } from './sourceRoutingService.js';

export interface GroundedAnswerResult {
  message: string;
  structuredData: {
    title: string;
    summary: string;
    keyFindings: string[];
    riskHighlights: string[];
    table?: {
      columns: Array<{ key: string; label: string; type?: string }>;
      rows: any[];
      totalCount: number;
    };
    metadata?: Record<string, any>;
  };
  aiExplanation?: string;
}

export class GroundedAnswerService {
  /**
   * Generates a grounded, verified natural language response based strictly on executed database facts.
   */
  public async generateGroundedAnswer(
    userQuery: string,
    queryResult: ExecutedQueryResult,
    verification: VerifiedResultAnalysis,
    sqlUsed: string
  ): Promise<GroundedAnswerResult> {
    // 1. Error / Rejection Case
    if (!queryResult.success) {
      return {
        message: `Query could not be executed: ${queryResult.error || 'Database error occurred'}.`,
        structuredData: {
          title: 'Database Execution Notice',
          summary: queryResult.error || 'Query failed to complete.',
          keyFindings: ['The database was unable to complete the requested query plan.'],
          riskHighlights: []
        }
      };
    }

    // 2. Empty Result Case
    if (!verification.hasRows || verification.cleanRows.length === 0) {
      return {
        message: `No matching records were found in ${queryResult.databaseSource} for: "${userQuery}".`,
        structuredData: {
          title: 'No Matching Records Found',
          summary: 'The query executed successfully but returned 0 rows matching your criteria.',
          keyFindings: [
            'Verified that no records match the filter criteria.',
            `Executed against ${queryResult.databaseSource} (${queryResult.executionTimeMs}ms).`
          ],
          riskHighlights: []
        }
      };
    }

    const rows = verification.cleanRows;
    const isAnalytical = this.detectAnalyticalQuery(userQuery, rows);

    // 3. Simple Factual Lookup or Single Record (Deterministic Template for 100% accuracy)
    if (!isAnalytical && rows.length === 1) {
      return this.buildSingleRecordAnswer(userQuery, rows[0], queryResult, sqlUsed, verification);
    }

    // 4. Group by / Count summary breakdown
    if (this.isSimpleGroupCount(rows)) {
      return this.buildGroupCountAnswer(userQuery, rows, queryResult, sqlUsed);
    }

    // 5. Complex or Analytical Query -> Together AI LLM Synthesis with Grounded Evidence
    const apiKey = config.togetherApiKey || config.groqApiKey;
    if (apiKey) {
      try {
        const aiSummary = await this.callTogetherGroundedSynthesis(userQuery, rows, queryResult, sqlUsed, verification);
        return aiSummary;
      } catch (err: any) {
        console.warn('[GroundedAnswer] Together AI synthesis fallback:', err.message);
      }
    }

    // 6. Deterministic Multi-Row Tabular Response
    return this.buildGenericTableAnswer(userQuery, rows, queryResult, sqlUsed, verification);
  }

  private detectAnalyticalQuery(query: string, rows: any[]): boolean {
    const q = query.toLowerCase();
    return (
      q.startsWith('why ') || q.includes(' why ') ||
      q.includes('explain') || q.includes('analyze') ||
      q.includes('compare') || q.includes('impact') ||
      q.includes('risk analysis') || q.includes('remediation')
    );
  }

  private isSimpleGroupCount(rows: any[]): boolean {
    if (rows.length > 10) return false;
    const sample = rows[0];
    const keys = Object.keys(sample);
    const countKey = keys.find(k => k.toLowerCase().includes('count') || k.toLowerCase().includes('total'));
    return keys.length <= 3 && !!countKey;
  }

  private buildSingleRecordAnswer(
    userQuery: string,
    row: any,
    queryResult: ExecutedQueryResult,
    sqlUsed: string,
    verification: VerifiedResultAnalysis
  ): GroundedAnswerResult {
    const entries = Object.entries(row);
    const title = row.name || row.certification_name || row.role_name || row.display_name || row.username || 'Database Record Details';
    
    // Check specific fields requested like "manager" or "status"
    let specificMessage = '';
    const qLower = userQuery.toLowerCase();
    if (qLower.includes('manager')) {
      const mgr = row.manager_name || row.direct_manager || row.manager;
      if (mgr) {
        specificMessage = `The supervising manager is **${mgr}**.`;
      } else {
        specificMessage = `The supervising manager is **not configured (NULL)** in the database.`;
      }
    } else if (qLower.includes('owner')) {
      const owner = row.owner_name || row.owner;
      specificMessage = owner ? `The campaign owner is **${owner}**.` : 'The campaign owner is not specified (NULL).';
    } else if (qLower.includes('status')) {
      const st = row.status || row.lifecycle;
      specificMessage = st ? `Current status is **${st}**.` : 'Status is not specified.';
    }

    const bullets = entries.slice(0, 8).map(([k, v]) => {
      const valStr = v === null || v === undefined || v === '' ? '_Not configured (NULL)_' : String(v);
      const cleanKey = k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      return `• **${cleanKey}**: ${valStr}`;
    });

    const summary = specificMessage || `Retrieved record for **${title}** from ${queryResult.databaseSource}.`;
    const message = `${summary}\n\n${bullets.join('\n')}`;

    return {
      message,
      structuredData: {
        title: String(title),
        summary,
        keyFindings: bullets.map(b => b.replace(/^•\s*/, '')),
        riskHighlights: verification.dataQualityIssues.length > 0 ? verification.dataQualityIssues : [],
        table: {
          columns: entries.map(([k]) => ({ key: k, label: k.replace(/_/g, ' ').toUpperCase() })),
          rows: [row],
          totalCount: 1
        },
        metadata: {
          source: queryResult.databaseSource,
          executionTimeMs: queryResult.executionTimeMs,
          sql: sqlUsed
        }
      }
    };
  }

  private buildGroupCountAnswer(
    userQuery: string,
    rows: any[],
    queryResult: ExecutedQueryResult,
    sqlUsed: string
  ): GroundedAnswerResult {
    const keys = Object.keys(rows[0]);
    const groupKey = keys.find(k => !k.toLowerCase().includes('count')) || keys[0];
    const countKey = keys.find(k => k.toLowerCase().includes('count')) || keys[1];

    const totalCount = rows.reduce((sum, r) => sum + (Number(r[countKey]) || 0), 0);
    const bullets = rows.map(r => {
      const countVal = Number(r[countKey]) || 0;
      const pct = totalCount > 0 ? ((countVal / totalCount) * 100).toFixed(1) : '0';
      return `• **${r[groupKey] || 'Unclassified'}**: **${countVal.toLocaleString()}** (${pct}%)`;
    });

    const summary = `Total Count: **${totalCount.toLocaleString()}** across ${rows.length} categories.`;
    const message = `${summary}\n\n**Breakdown:**\n${bullets.join('\n')}`;

    return {
      message,
      structuredData: {
        title: 'Categorical Distribution Analysis',
        summary,
        keyFindings: bullets.map(b => b.replace(/^•\s*/, '')),
        riskHighlights: [],
        table: {
          columns: [
            { key: groupKey, label: groupKey.replace(/_/g, ' ').toUpperCase() },
            { key: countKey, label: 'COUNT', type: 'number' }
          ],
          rows,
          totalCount: rows.length
        },
        metadata: {
          source: queryResult.databaseSource,
          executionTimeMs: queryResult.executionTimeMs,
          sql: sqlUsed
        }
      }
    };
  }

  private buildGenericTableAnswer(
    userQuery: string,
    rows: any[],
    queryResult: ExecutedQueryResult,
    sqlUsed: string,
    verification: VerifiedResultAnalysis
  ): GroundedAnswerResult {
    const columns = Object.keys(rows[0]).map(k => ({
      key: k,
      label: k.replace(/_/g, ' ').toUpperCase()
    }));

    const summary = `Found **${rows.length.toLocaleString()} record${rows.length === 1 ? '' : 's'}** matching your criteria in ${queryResult.databaseSource}.`;

    return {
      message: summary,
      structuredData: {
        title: 'Database Query Results',
        summary,
        keyFindings: [
          `Retrieved ${rows.length} rows (${queryResult.executionTimeMs}ms execution time).`,
          `Authoritative Source: ${queryResult.sourceOfTruth}`
        ],
        riskHighlights: verification.dataQualityIssues,
        table: {
          columns,
          rows,
          totalCount: rows.length
        },
        metadata: {
          source: queryResult.databaseSource,
          executionTimeMs: queryResult.executionTimeMs,
          sql: sqlUsed
        }
      }
    };
  }

  private async callTogetherGroundedSynthesis(
    userQuery: string,
    rows: any[],
    queryResult: ExecutedQueryResult,
    sqlUsed: string,
    verification: VerifiedResultAnalysis
  ): Promise<GroundedAnswerResult> {
    const promptRows = rows.slice(0, 15); // Truncate safely for prompt context efficiency
    const apiKey = config.togetherApiKey || config.groqApiKey;
    const endpoint = config.llmEndpoint || 'https://api.together.xyz/v1/chat/completions';
    const model = config.groqModel || config.togetherModel || 'openai/gpt-oss-120b';

    const response = await axios.post(
      endpoint,
      {
        model,
        messages: [
          {
            role: 'system',
            content: `You are the Enterprise Database Risk & Compliance Analyst.
The user is asking: "${userQuery}".
Analyze the retrieved database evidence strictly.
Output a strict JSON object:
{
  "summary": "Clear, objective explanation directly answering the user query.",
  "keyFindings": ["Up to 3-5 factual findings grounded 100% in the evidence."],
  "riskHighlights": ["Governance or security recommendations. Leave empty if none."]
}

ANTI-HALLUCINATION RULES:
1. Base all statements strictly on the provided rows. Never invent numbers, IDs, names, or relationships.
2. If a value is NULL or empty in the evidence, state that it is unconfigured/NULL.
3. Never output raw markdown tables, HTML, or code snippets in the JSON summary.`
          },
          {
            role: 'user',
            content: `Query: "${userQuery}"\nDatabase Evidence (${rows.length} total rows):\n${JSON.stringify(promptRows, null, 2)}`
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 1000
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 25000
      }
    );

    const parsed = JSON.parse(response.data.choices[0]?.message?.content || '{}');
    const summary = parsed.summary || `Analysis completed across ${rows.length} records.`;
    const columns = Object.keys(rows[0]).map(k => ({ key: k, label: k.replace(/_/g, ' ').toUpperCase() }));

    return {
      message: summary,
      structuredData: {
        title: 'Analytical Security Assessment',
        summary,
        keyFindings: parsed.keyFindings || [`Analyzed ${rows.length} records from ${queryResult.databaseSource}`],
        riskHighlights: parsed.riskHighlights || verification.dataQualityIssues,
        table: {
          columns,
          rows,
          totalCount: rows.length
        },
        metadata: {
          source: queryResult.databaseSource,
          executionTimeMs: queryResult.executionTimeMs,
          sql: sqlUsed
        }
      },
      aiExplanation: summary
    };
  }
}

export const groundedAnswerService = new GroundedAnswerService();
