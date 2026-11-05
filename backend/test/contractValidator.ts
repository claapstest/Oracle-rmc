/**
 * Ask VEYRA Contract Validator & Assertion Utility
 * Story: VEYRA-101.5
 * 
 * Enforces compile-time interfaces and runtime schema invariants for POST /api/chat
 * according to the specifications established in VEYRA-101.2 and VEYRA-101.3.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates that an object conforms strictly to the AIResponse contract.
 */
export function validateAIResponse(data: any): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Response body must be a non-null object'] };
  }

  // 1. message (Required string)
  if (typeof data.message !== 'string') {
    errors.push(`Field "message" is required and must be a string, got ${typeof data.message}`);
  }

  // 2. intent (Required string)
  if (typeof data.intent !== 'string' || !data.intent.trim()) {
    errors.push(`Field "intent" is required and must be a non-empty string, got ${typeof data.intent}`);
  }

  // 3. parameters (Required object)
  if (!data.parameters || typeof data.parameters !== 'object') {
    errors.push(`Field "parameters" is required and must be an object, got ${typeof data.parameters}`);
  }

  // 4. toolResult (Nullable, but required key in AIResponse contract)
  if (!('toolResult' in data)) {
    errors.push(`Field "toolResult" is a mandatory property on AIResponse (can be null, but must be present)`);
  } else if (data.toolResult !== null) {
    const trErrors = validateToolExecutionResult(data.toolResult);
    errors.push(...trErrors);
  }

  // 5. structuredData (Optional object)
  if ('structuredData' in data && data.structuredData !== undefined) {
    if (typeof data.structuredData !== 'object' || data.structuredData === null) {
      errors.push(`Field "structuredData" when present must be a non-null object`);
    } else {
      const sd = data.structuredData;
      if (typeof sd.title !== 'string') errors.push('structuredData.title must be a string');
      if (typeof sd.summary !== 'string') errors.push('structuredData.summary must be a string');
      if (!Array.isArray(sd.keyFindings)) errors.push('structuredData.keyFindings must be an array');
      if (!Array.isArray(sd.riskHighlights)) errors.push('structuredData.riskHighlights must be an array');
      if (sd.table && typeof sd.table !== 'object') errors.push('structuredData.table must be an object if present');
      if (!Array.isArray(sd.actions)) errors.push('structuredData.actions must be an array');
    }
  }

  // 6. aiExplanation (Optional string)
  if ('aiExplanation' in data && data.aiExplanation !== undefined) {
    if (typeof data.aiExplanation !== 'string') {
      errors.push(`Field "aiExplanation" when present must be a string`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates that an object conforms to the ToolExecutionResult contract.
 */
export function validateToolExecutionResult(tr: any): string[] {
  const errors: string[] = [];
  if (!tr || typeof tr !== 'object') {
    return ['toolResult must be a non-null object'];
  }

  if (typeof tr.tool !== 'string') errors.push(`toolResult.tool must be a string, got ${typeof tr.tool}`);
  if (!('parameters' in tr)) errors.push('toolResult.parameters is required');
  if (typeof tr.dataSource !== 'string') errors.push(`toolResult.dataSource must be a string, got ${typeof tr.dataSource}`);
  if (typeof tr.timestamp !== 'string') errors.push(`toolResult.timestamp must be a string, got ${typeof tr.timestamp}`);
  if (typeof tr.success !== 'boolean') errors.push(`toolResult.success must be a boolean, got ${typeof tr.success}`);

  if ('integrationRequired' in tr && typeof tr.integrationRequired !== 'boolean') {
    errors.push('toolResult.integrationRequired must be boolean if present');
  }
  if ('ambiguous' in tr && typeof tr.ambiguous !== 'boolean') {
    errors.push('toolResult.ambiguous must be boolean if present');
  }

  return errors;
}

/**
 * Validates error response payloads according to HTTP status code specifications.
 */
export function validateErrorResponse(status: number, body: any, expectedType?: string): ValidationResult {
  const errors: string[] = [];
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: [`HTTP ${status} response body must be a non-null object`] };
  }

  switch (status) {
    case 400:
      if (body.error !== 'Message is required') {
        errors.push(`Expected 400 error: "Message is required", got: "${body.error}"`);
      }
      break;

    case 401:
      if (expectedType === 'MISSING_HEADER' || expectedType === 'MALFORMED_HEADER') {
        if (body.success !== false) errors.push('Expected 401 success: false');
        if (body.message !== 'Authentication required. Missing or malformed token.') {
          errors.push(`Expected message: "Authentication required. Missing or malformed token.", got: "${body.message}"`);
        }
        if ('code' in body) errors.push('Missing/malformed header 401 must NOT have "code" field');
      } else if (expectedType === 'EMPTY_TOKEN') {
        if (body.success !== false) errors.push('Expected 401 success: false');
        // On the wire, HTTP header parsers strip trailing whitespace so 'Bearer ' arrives as 'Bearer'.
        // Route returns either 'Authentication required. Missing or malformed token.' or code: 'INVALID_TOKEN'.
        if (body.code && body.code !== 'INVALID_TOKEN') {
          errors.push(`Expected code to be "INVALID_TOKEN" if present, got "${body.code}"`);
        }
        if (!body.message?.includes('Authentication required')) {
          errors.push(`Expected message to contain "Authentication required", got "${body.message}"`);
        }
      } else if (expectedType === 'UNKNOWN_TOKEN') {
        if (body.success !== false) errors.push('Expected 401 success: false');
        if (body.code !== 'SESSION_NOT_FOUND') errors.push(`Expected code: "SESSION_NOT_FOUND", got "${body.code}"`);
      } else if (expectedType === 'EXPIRED_SESSION') {
        if (body.code !== 'SESSION_EXPIRED') errors.push(`Expected code: "SESSION_EXPIRED", got "${body.code}"`);
        if (body.message !== 'Your session has expired. Please log in again.') {
          errors.push(`Expected message: "Your session has expired. Please log in again.", got "${body.message}"`);
        }
        if ('success' in body) {
          errors.push('SESSION_EXPIRED 401 body should NOT contain "success" property (as verified in 101.3)');
        }
      }
      break;

    case 403:
      if (body.success !== false) errors.push('Expected 403 success: false');
      if (body.code !== 'FORBIDDEN') errors.push(`Expected 403 code: "FORBIDDEN", got: "${body.code}"`);
      if (expectedType === 'AUDIT_SUPERVISOR') {
        if (!body.message?.includes('Audit Supervisor does not have privilege')) {
          errors.push(`Expected supervisor denial message, got: "${body.message}"`);
        }
      } else {
        if (!body.message?.includes('Ask Veyra privileges required')) {
          errors.push(`Expected Ask Veyra privilege message, got: "${body.message}"`);
        }
      }
      break;

    case 500:
      if (body.error !== 'AI Orchestration failed') {
        errors.push(`Expected 500 error: "AI Orchestration failed", got: "${body.error}"`);
      }
      if (typeof body.details !== 'string') {
        errors.push(`Expected 500 details to be a string, got ${typeof body.details}`);
      }
      break;
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Loads a JSON fixture by relative or absolute path.
 */
export function loadFixture(relativePath: string): any {
  const fullPath = path.isAbsolute(relativePath)
    ? relativePath
    : path.resolve(__dirname, 'fixtures/chat', relativePath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
}
