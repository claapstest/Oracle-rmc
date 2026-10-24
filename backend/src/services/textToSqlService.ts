import axios from 'axios';
import { config } from '../config.js';
import { LinkedSchemaContext } from './schemaLinkingService.js';

export interface GeneratedSqlQueryPlan {
  sql: string;
  parameters: any[];
  explanation: string;
  targetEntity: string;
  isAnalytical: boolean;
  aggregations: string[];
  suggestedVisualization?: 'table' | 'metric' | 'chart';
  isAmbiguous?: boolean;
  clarificationMessage?: string;
}

class TextToSqlService {
  /**
   * Converts a user natural language query into a valid, safe PostgreSQL query plan using Grok LLM.
   */
  public async generateSqlPlan(
    userQuery: string,
    schemaContext: LinkedSchemaContext,
    conversationHistory: string = ''
  ): Promise<GeneratedSqlQueryPlan> {
    const apiKey = config.togetherApiKey || config.groqApiKey;
    if (!apiKey) {
      return this.generateFallbackSqlPlan(userQuery, schemaContext);
    }

    try {
      const systemPrompt = `You are an expert PostgreSQL Text-to-SQL compiler for an Enterprise Database Assistant.
Your task is to convert the user's natural language question into a safe, syntactically correct PostgreSQL SELECT query plan based STRICTLY on the provided schema.

DATABASE SCHEMA:
${schemaContext.formattedPromptSchema}

${conversationHistory ? `RECENT CONVERSATION CONTEXT:\n${conversationHistory}\n` : ''}

CRITICAL RULES:
1. ONLY produce SELECT queries. NEVER produce INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, or DDL statements.
2. Output valid PostgreSQL SQL. Use standard double quotes for table and column names if needed or clean snake_case.
3. For text comparisons, use case-insensitive matching like ILIKE '%term%' or lower(column) = lower('term').
4. For multi-table queries, use ONLY verified join paths specified in the schema. Do NOT invent foreign keys.
5. If the user asks for count, sum, average, or breakdown, use proper aggregate functions (COUNT, SUM, AVG, MIN, MAX) with GROUP BY.
6. Always include an appropriate LIMIT (maximum 100) unless an aggregate function is calculating a single total.
7. Return a strict JSON object with NO surrounding markdown backticks or wrappers:
{
  "sql": "SELECT ... FROM ... WHERE ... LIMIT 50",
  "parameters": [],
  "explanation": "Brief explanation of what the query retrieves",
  "targetEntity": "primary entity name (e.g. roles, users, certifications, controls)",
  "isAnalytical": true/false,
  "aggregations": ["COUNT", "GROUP BY"],
  "suggestedVisualization": "table" | "metric" | "chart",
  "isAmbiguous": false,
  "clarificationMessage": null
}
8. If the requested information is fundamentally impossible to answer with the accessible tables, set "sql": "", "isAmbiguous": true, "clarificationMessage": "Explanation of what is missing."`;

      const endpoint = config.llmEndpoint || 'https://api.together.xyz/v1/chat/completions';
      const model = config.groqModel || config.togetherModel || 'openai/gpt-oss-120b';

      const response = await axios.post(
        endpoint,
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userQuery }
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

      const content = response.data.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from AI API');
      }

      const parsed = JSON.parse(content) as GeneratedSqlQueryPlan;
      if (!parsed.sql && !parsed.clarificationMessage) {
        return this.generateFallbackSqlPlan(userQuery, schemaContext);
      }
      return parsed;
    } catch (err: any) {
      console.warn('[TextToSql] Together AI Text-to-SQL error, falling back to deterministic compiler:', err.message);
      return this.generateFallbackSqlPlan(userQuery, schemaContext);
    }
  }

  /**
   * Deterministic local fallback generator for common patterns when Groq API is offline or unconfigured.
   */
  public generateFallbackSqlPlan(
    userQuery: string,
    schemaContext: LinkedSchemaContext
  ): GeneratedSqlQueryPlan {
    const q = userQuery.toLowerCase().trim();

    // 1. Certificate Queries
    if (q.includes('certificat') || q.includes('campaign')) {
      if (q.includes('expir') || q.includes('due') || q.includes('next month')) {
        return {
          sql: `SELECT certification_id, certification_name, owner_name, manager_name, status, percent_complete, due_date FROM oracle_raw_access_certifications WHERE due_date IS NOT NULL ORDER BY due_date ASC LIMIT 50;`,
          parameters: [],
          explanation: 'Certifications with scheduled review deadlines',
          targetEntity: 'certifications',
          isAnalytical: false,
          aggregations: [],
          suggestedVisualization: 'table'
        };
      }
      if (q.includes('manager')) {
        const idMatch = q.match(/\b\d+\b/);
        const certId = idMatch ? idMatch[0] : '1';
        return {
          sql: `SELECT certification_id, certification_name, manager_name, owner_name, certifier_name, status, percent_complete FROM oracle_raw_access_certifications WHERE CAST(certification_id AS TEXT) = $1 OR certification_name ILIKE $2 LIMIT 10;`,
          parameters: [certId, `%${certId}%`],
          explanation: `Supervising manager details for certification ${certId}`,
          targetEntity: 'certifications',
          isAnalytical: false,
          aggregations: [],
          suggestedVisualization: 'table'
        };
      }
      return {
        sql: `SELECT certification_id, certification_name, owner_name, manager_name, status, percent_complete, due_date FROM oracle_raw_access_certifications ORDER BY certification_id ASC LIMIT 50;`,
        parameters: [],
        explanation: 'Access certification review campaigns',
        targetEntity: 'certifications',
        isAnalytical: false,
        aggregations: [],
        suggestedVisualization: 'table'
      };
    }

    // 2. Role Queries
    if (q.includes('duty role') || (q.includes('how many') && q.includes('duty'))) {
      return {
        sql: `SELECT category, count(*) AS role_count FROM oracle_raw_roles GROUP BY category ORDER BY role_count DESC;`,
        parameters: [],
        explanation: 'Security role distribution breakdown by category',
        targetEntity: 'roles',
        isAnalytical: true,
        aggregations: ['COUNT', 'GROUP BY'],
        suggestedVisualization: 'chart'
      };
    }

    if (q.includes('role')) {
      return {
        sql: `SELECT role_code, role_name, category, is_custom, member_count FROM oracle_raw_roles ORDER BY member_count DESC LIMIT 50;`,
        parameters: [],
        explanation: 'Oracle Security Roles list',
        targetEntity: 'roles',
        isAnalytical: false,
        aggregations: [],
        suggestedVisualization: 'table'
      };
    }

    // 3. User Queries
    if (q.includes('department')) {
      return {
        sql: `SELECT COALESCE(raw_user->>'department', 'Corporate') AS department, count(*) AS employee_count FROM oracle_raw_users GROUP BY department ORDER BY employee_count DESC LIMIT 25;`,
        parameters: [],
        explanation: 'Department-wise employee headcount distribution',
        targetEntity: 'users',
        isAnalytical: true,
        aggregations: ['COUNT', 'GROUP BY'],
        suggestedVisualization: 'table'
      };
    }

    if (q.includes('user') || q.includes('employee')) {
      return {
        sql: `SELECT username, display_name, email, is_active, user_category, raw_user->>'department' AS department FROM oracle_raw_users ORDER BY display_name ASC LIMIT 50;`,
        parameters: [],
        explanation: 'Enterprise users and department assignments',
        targetEntity: 'users',
        isAnalytical: false,
        aggregations: [],
        suggestedVisualization: 'table'
      };
    }

    // 4. Advanced Controls / Incidents
    if (q.includes('control') && (q.includes('how many') || q.includes('total') || q.includes('count') || q.includes('summary report') || q.includes('number of'))) {
      return {
        sql: `SELECT count(*) AS total_controls FROM oracle_raw_controls;`,
        parameters: [],
        explanation: 'Total count of Advanced Controls in control summary report',
        targetEntity: 'controls',
        isAnalytical: true,
        aggregations: ['COUNT'],
        suggestedVisualization: 'table'
      };
    }

    if (q.includes('control') || q.includes('incident') || q.includes('violation')) {
      return {
        sql: `SELECT c.control_id, c.name, c.status, COALESCE(i.total_incidents, 0) AS incident_count FROM oracle_raw_controls c LEFT JOIN oracle_control_incidents i ON CAST(c.control_id AS TEXT) = CAST(i.control_id AS TEXT) ORDER BY incident_count DESC LIMIT 25;`,
        parameters: [],
        explanation: 'Advanced Controls and their recorded incident violations count',
        targetEntity: 'controls',
        isAnalytical: true,
        aggregations: ['LEFT JOIN'],
        suggestedVisualization: 'table'
      };
    }

    // Default primary table query
    const targetTable = schemaContext.selectedTables[0] || 'oracle_raw_roles';
    return {
      sql: `SELECT * FROM ${targetTable} LIMIT 25;`,
      parameters: [],
      explanation: `General records from ${targetTable}`,
      targetEntity: targetTable,
      isAnalytical: false,
      aggregations: [],
      suggestedVisualization: 'table'
    };
  }
}

export const textToSqlService = new TextToSqlService();
