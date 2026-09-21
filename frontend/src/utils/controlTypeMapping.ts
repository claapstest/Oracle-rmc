/**
 * Oracle Fusion Advanced Controls Type Mapping
 * 
 * Verified Product Rule:
 *   Oracle Type 173 -> "Access Control"
 *   Oracle Type 174 -> "Transaction Control"
 *   Unexpected Type -> "Other"
 * 
 * IMPORTANT:
 * - The original numeric code (e.g. 173, 174) is preserved internally.
 * - Do NOT display "Type 173" or "Type 174" as the primary user-facing label.
 * - Unknown codes must display "Other" without silent reclassification.
 */

export type ControlDomain = 'ACCESS' | 'TRANSACTION' | 'OTHER';

export function isAccessControl(type: any): boolean {
  if (type === 173 || type === '173') return true;
  return false;
}

export function isTransactionControl(type: any): boolean {
  if (type === 174 || type === '174') return true;
  return false;
}

export function getControlDomain(type: any): ControlDomain {
  if (isAccessControl(type)) return 'ACCESS';
  if (isTransactionControl(type)) return 'TRANSACTION';
  return 'OTHER';
}

/**
 * Returns primary user-facing label:
 * - "Access Control" (for 173)
 * - "Transaction Control" (for 174)
 * - "Other" (for any unexpected code or null/undefined)
 */
export function formatControlTypeName(type: any): string {
  const domain = getControlDomain(type);
  if (domain === 'ACCESS') return 'Access Control';
  if (domain === 'TRANSACTION') return 'Transaction Control';
  return 'Other';
}

/**
 * Returns secondary technical Oracle metadata badge label.
 * Example: "Oracle Type: 173" or "Oracle Type: 174"
 */
export function formatSecondaryTypeBadge(type: any): string {
  if (type !== null && type !== undefined && String(type).trim() !== '') {
    return `Oracle Type: ${type}`;
  }
  return 'Oracle Type: N/A';
}
