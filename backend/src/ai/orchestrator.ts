import axios from 'axios';
import { config } from '../config.js';
import { TOOLS_REGISTRY, ToolExecutionResult } from '../tools/index.js';
import { oracleService } from '../services/oracleService.js';
import { auditProductCatalogService } from '../services/auditProductCatalogService.js';

export interface AIResponse {
  message: string;
  intent: string;
  parameters: any;
  toolResult: ToolExecutionResult | null;
  structuredData?: any;
  aiExplanation?: string;
}

// Structured output interface
interface IntentExtraction {
  intent: string;
  parameters: Record<string, any>;
  explanation: string;
}

// Fallback Regex/Keyword-based NLU Parser
function fallbackNLU(message: string, context?: any): IntentExtraction {
  let clean = message.toLowerCase().trim();

  // If there's context and the user uses relative pronouns, map them to make parsing easy:
  if (context && context.entityName) {
    const entityNameLower = context.entityName.toLowerCase();
    if (context.entityType === 'ROLE') {
      clean = clean
        .replace(/\bthis role\b/g, entityNameLower)
        .replace(/\bthese roles\b/g, entityNameLower)
        .replace(/\bthe role\b/g, entityNameLower)
        .replace(/\bit\b/g, entityNameLower);
    } else if (context.entityType === 'USER') {
      const usernameLower = (context.entityId || context.entityName).toLowerCase();
      clean = clean
        .replace(/\bthis user\b/g, usernameLower)
        .replace(/\bthe user\b/g, usernameLower)
        .replace(/\bhim\b/g, usernameLower)
        .replace(/\bher\b/g, usernameLower)
        .replace(/\bthem\b/g, usernameLower)
        .replace(/\btheir\b/g, usernameLower)
        .replace(/\bthey\b/g, usernameLower);
    } else if (context.entityType === 'PRIVILEGE') {
      const privLower = (context.entityName || context.entityId).toLowerCase();
      clean = clean
        .replace(/\bthis privilege\b/g, privLower)
        .replace(/\bthe privilege\b/g, privLower)
        .replace(/\bit\b/g, privLower);
    }
  }

  // 1. Statistics & Dashboard
  if (
    clean.includes('statistics') || 
    clean.includes('dashboard') || 
    (clean.includes('how many') && (clean.includes('users') || clean.includes('roles') || clean.includes('privileges'))) ||
    clean.includes('total number') ||
    clean.includes('distribution')
  ) {
    return {
      intent: 'SECURITY_STATISTICS',
      parameters: {},
      explanation: 'Detected request for security statistics and totals.'
    };
  }

  // 1b. Advanced Controls & Control Incidents
  if (
    clean.includes('hsdl') ||
    clean.includes('spreadsheets templates') ||
    clean.includes('4096') ||
    clean.includes('4078') ||
    clean.includes('114281') ||
    clean.includes('114269') ||
    clean.includes('114313') ||
    (clean.includes('control') && (clean.includes('detail') || clean.includes('incident') || clean.includes('show') || clean.includes('find') || clean.includes('what is') || clean.includes('tell me about') || clean.includes('under'))) ||
    ((clean.includes('incident') || clean.includes('incidents')) && (clean.includes('for') || clean.includes('of') || clean.includes('in') || clean.includes('under') || clean.includes('show') || clean.includes('list') || clean.includes('how many')))
  ) {
    let controlQuery = '';
    const numMatch = clean.match(/\b(\d{4,6})\b/);
    if (numMatch && numMatch[1]) {
      controlQuery = numMatch[1];
    } else {
      const matchDetailsOf = clean.match(/(?:details\s+(?:of|for)|incidents?\s+(?:for|of|in|under)|show\s+(?:details\s+of\s+)?(?:control\s+)?|about\s+control\s+)(.+)/i);
      if (matchDetailsOf && matchDetailsOf[1]) {
        controlQuery = matchDetailsOf[1].trim();
      } else if (clean.includes('hsdl')) {
        controlQuery = 'Manage HSDL Spreadsheets Templates and Load Data using HSDL';
      } else {
        controlQuery = '4096';
      }
    }

    controlQuery = controlQuery.replace(/[\?\.\!]$/, '').trim();

    return {
      intent: 'ADVANCED_CONTROLS',
      parameters: { controlName: controlQuery, keyword: controlQuery, controlId: controlQuery },
      explanation: `Detected request for Advanced Control details and incidents matching "${controlQuery}".`
    };
  }

  // 2. Risk & SoD
  if (
    clean.includes('risk') || 
    clean.includes('sod') || 
    clean.includes('segregation of duties') || 
    clean.includes('conflict') || 
    clean.includes('incident') || 
    clean.includes('certification')
  ) {
    return {
      intent: 'RISK_INFORMATION',
      parameters: {},
      explanation: 'Detected request for GRC risk, incidents, or segregation of duties information.'
    };
  }

  // 3. Audit History
  if (
    clean.includes('audit') ||
    clean.includes('history') ||
    clean.includes('who modified') ||
    clean.includes('who changed') ||
    clean.includes('yesterday') ||
    clean.includes('audit trail')
  ) {
    let username = '';
    const userMatch = clean.match(/(?:for\s+user|by\s+user|user|username)\s+([a-zA-Z0-9_]+)/i);
    if (userMatch && userMatch[1]) {
      username = userMatch[1].toUpperCase();
    } else if (context && context.entityType === 'USER' && context.entityId) {
      username = context.entityId.toUpperCase();
    }

    // Resolve Product from natural language against authoritative catalog
    let detectedProduct: string | undefined = undefined;
    let detectedBO: string | undefined = undefined;

    if (clean.includes('hcm common architecture')) {
      detectedProduct = 'HCM Common Architecture';
      detectedBO = 'Configure HCM Data Loader Parameters';
    } else if (clean.includes('hcm') || clean.includes('global human resources') || clean.includes('human resources') || clean.includes('person')) {
      detectedProduct = 'Global Human Resources';
      detectedBO = 'Person';
    } else {
      const resolvedProduct = auditProductCatalogService.resolveProduct(clean);
      detectedProduct = resolvedProduct?.productName || resolvedProduct?.displayName;
      if (resolvedProduct && resolvedProduct.businessObjects) {
        for (const bo of resolvedProduct.businessObjects) {
          if (clean.includes(bo.displayName.toLowerCase()) || bo.aliases?.some(a => clean.includes(a.toLowerCase()))) {
            detectedBO = bo.displayName;
            break;
          }
        }
      }
    }

    // Default overrides for common keywords
    if (!detectedProduct && clean.includes('opss')) {
      detectedProduct = 'Oracle Platform Security Services';
    } else if (!detectedProduct && clean.includes('gl')) {
      detectedProduct = 'General Ledger';
    }

    return {
      intent: 'AUDIT_HISTORY',
      parameters: {
        ...(detectedProduct ? { product: detectedProduct } : {}),
        ...(detectedBO ? { businessObjectType: detectedBO } : {}),
        ...(username ? { username } : {})
      },
      explanation: `Detected audit search${detectedProduct ? ` for product "${detectedProduct}"` : ''}${detectedBO ? ` and business object "${detectedBO}"` : ''}${username ? ` filtered by user "${username}"` : ''}.`
    };
  }

  // 4. Role Hierarchy
  if (clean.includes('hierarchy') || clean.includes('tree') || clean.includes('parent') || clean.includes('child')) {
    let roleName = 'AP Manager'; // default
    if (context && context.entityType === 'ROLE' && context.entityName) {
      roleName = context.entityName;
    } else if (clean.includes('analyst') || clean.includes('controls')) roleName = 'Advanced Access Controls Analyst';
    else if (clean.includes('security manager') || clean.includes('it security')) roleName = 'IT Security Manager';
    else if (clean.includes('payroll')) roleName = 'Payroll Administrator';
    
    return {
      intent: 'ROLE_HIERARCHY',
      parameters: { roleName },
      explanation: `Detected request for Role Hierarchy for "${roleName}".`
    };
  }

  // 5a. Reverse Privilege -> Roles (Which roles have privilege X / What roles are associated with X / Show me roles for X)
  if (clean.includes('this privilege') || clean.includes('for this privilege') || clean.includes('who has this privilege')) {
    const ctxPriv = context?.privilegeName || context?.entityName || '';
    return {
      intent: 'ROLES_BY_PRIVILEGE',
      parameters: { privilegeName: ctxPriv },
      explanation: 'Detected request for roles associated with active privilege context.'
    };
  }

  const rolesByPrivMatch = 
    clean.match(/(?:give\s+me\s+(?:the\s+)?roles?\s+(?:which|that)?\s*(?:have|grant)|which\s+roles?\s+(?:have|grant|contain)|what\s+roles?\s+(?:have|grant|contain)|what\s+roles?\s+are\s+associated\s+with|which\s+roles?\s+are\s+associated\s+with|roles?\s+associated\s+with|roles?\s+(?:which|that)\s+have|roles?\s+with|which\s+roles?\s+contain|roles?\s+containing|roles?\s+granting|show\s+(?:me\s+)?(?:the\s+)?roles?\s+(?:for|associated\s+with|with|having)|who\s+has\s+(?:the\s+)?privilege)\s+(?:the\s+)?(?:privilege\s+)?([^?.,;:]+)/i) ||
    clean.match(/(?:roles?\s+with|roles?\s+having|roles?\s+containing)\s+["']?([^"']+)["']?\s+privilege/i) ||
    clean.match(/(?:show\s+me\s+roles\s+for|roles\s+for)\s+([a-zA-Z0-9_]+)/i);

  if (rolesByPrivMatch && rolesByPrivMatch[1]) {
    const rawPriv = rolesByPrivMatch[1].replace(/["'<>]/g, '').trim();
    if (rawPriv.length > 0) {
      return {
        intent: 'ROLES_BY_PRIVILEGE',
        parameters: { privilegeName: rawPriv },
        explanation: `Detected request for roles granting privilege "${rawPriv}".`
      };
    }
  }

  if ((clean.includes('roles') || clean.includes('role')) && clean.includes('privilege') && (clean.includes('which') || clean.includes('what') || clean.includes('give me') || clean.includes('show'))) {
    const privSubMatch = clean.match(/privilege\s+["']?([^"']+)["']?/i);
    if (privSubMatch && privSubMatch[1]) {
      const rawPriv = privSubMatch[1].replace(/["'<>?]/g, '').trim();
      if (rawPriv && !rawPriv.startsWith('does') && !rawPriv.startsWith('of') && !rawPriv.startsWith('for')) {
        return {
          intent: 'ROLES_BY_PRIVILEGE',
          parameters: { privilegeName: rawPriv },
          explanation: `Detected reverse lookup for roles with privilege "${rawPriv}".`
        };
      }
    }
  }

  // 5b. Role -> Privileges & Access
  if (clean.includes('privilege') || clean.includes('policies') || clean.includes('can access security console')) {
    let roleName = 'AP Manager'; // default
    const matchRoleAfter = clean.match(/(?:does|what\s+privileges?\s+does|which\s+privileges?\s+does)\s+([a-zA-Z0-9_\.@\-\s]+?)\s+(?:have|has)/i);
    const matchRoleOf = clean.match(/(?:privileges?\s+(?:of|for)|privileges?\s+assigned\s+to)\s+([a-zA-Z0-9_\.@\-\s]+?)(?:\s+have|\s+has|\?|$)/i);

    if (matchRoleAfter && matchRoleAfter[1]) {
      roleName = matchRoleAfter[1].trim();
    } else if (matchRoleOf && matchRoleOf[1]) {
      roleName = matchRoleOf[1].trim();
    } else if (context && context.entityType === 'ROLE' && context.entityName) {
      roleName = context.entityName;
    } else if (clean.includes('accounts payable manager')) roleName = 'Accounts Payable Manager';
    else if (clean.includes('analyst') || clean.includes('controls')) roleName = 'Advanced Access Controls Analyst';
    else if (clean.includes('security manager') || clean.includes('it security')) roleName = 'IT Security Manager';
    else if (clean.includes('payroll')) roleName = 'Payroll Administrator';
    else if (clean.includes('employee')) roleName = 'Employee';

    return {
      intent: 'ROLE_PRIVILEGES',
      parameters: { roleName },
      explanation: `Detected request for privileges assigned to "${roleName}".`
    };
  }

  // 6. User Access check (Who has access to X)
  if (clean.includes('who has access') || clean.includes('who can create') || clean.includes('who can approve') || clean.includes('who can manage') || clean.includes('who has payroll')) {
    let access = 'Accounts Payable';
    if (clean.includes('invoice') && clean.includes('create')) access = 'Create Purchase Invoice';
    else if (clean.includes('invoice') && clean.includes('approve')) access = 'Approve Purchase Invoice';
    else if (clean.includes('supplier')) access = 'Manage Supplier Profiles';
    else if (clean.includes('payroll')) access = 'Process Employee Payroll Payments';
    else if (clean.includes('security console')) access = 'Access Security Console';

    return {
      intent: 'USER_ACCESS',
      parameters: { privilegeOrAccess: access },
      explanation: `Checking which users possess access privileges for "${access}".`
    };
  }

  // 7. Users by Role (Who has role X)
  if (clean.includes('who has') && clean.includes('role')) {
    let roleName = 'Advanced Access Controls Analyst';
    if (context && context.entityType === 'ROLE' && context.entityName) {
      roleName = context.entityName;
    } else if (clean.includes('ap manager') || clean.includes('payables')) roleName = 'AP Manager';
    else if (clean.includes('it security')) roleName = 'IT Security Manager';
    else if (clean.includes('payroll')) roleName = 'Payroll Administrator';
    else if (clean.includes('employee')) roleName = 'Employee';
    else if (clean.includes('security administrator')) roleName = 'Security Administrator';

    return {
      intent: 'USERS_BY_ROLE',
      parameters: { roleName },
      explanation: `Extracting users assigned to the "${roleName}" role.`
    };
  }

  // 8. Roles assigned to User (What roles are assigned to X, Does user X have Abstract Roles, etc.)
  if ((clean.includes('roles') || clean.includes('role')) && (clean.includes('assigned') || clean.includes('for') || clean.includes('of') || clean.includes('does') || clean.includes('which') || clean.includes('what') || clean.includes('show') || clean.includes('list') || clean.includes('have') || clean.includes('has')) && (clean.includes('user') || clean.includes('have') || clean.includes('has') || clean.includes('.') || clean.includes('_') || (context && context.entityType === 'USER'))) {
    let userId = '';
    
    // Attempt to extract username dynamically
    const matchUserKeyword = clean.match(/\b(?:user|username)\s+([a-zA-Z0-9_\.@\-]+)/);
    const matchAssignedTo = clean.match(/(?:assigned\s+to|assigned\s+for|for|of|to)\s+(?:user\s+)?([a-zA-Z0-9_\.@\-]+)/);
    const matchDoes = clean.match(/(?:does|what\s+roles?\s+does|which\s+roles?\s+does)\s+(?:user\s+)?([a-zA-Z0-9_\.@\-\s]+?)\s+(?:have|has)/);
    const matchWho = clean.match(/(?:who\s+is|show\s+user|details\s+for)\s+([a-zA-Z0-9_\.@\-\s]+)/);

    if (matchUserKeyword && matchUserKeyword[1]) {
      userId = matchUserKeyword[1].trim();
    } else if (matchAssignedTo && matchAssignedTo[1]) {
      userId = matchAssignedTo[1].trim();
    } else if (matchDoes && matchDoes[1]) {
      userId = matchDoes[1].trim();
    } else if (matchWho && matchWho[1]) {
      userId = matchWho[1].trim();
    } else if (context && context.entityType === 'USER' && context.entityId) {
      userId = context.entityId;
    } else {
      const stopWords = new Set(['which', 'what', 'roles', 'role', 'assigned', 'user', 'users', 'have', 'does', 'about', 'details', 'show', 'list']);
      const words = clean.split(/\s+/);
      const possibleUser = words.find(w => !stopWords.has(w) && (w.includes('.') || w.includes('_') || w.length > 4));
      if (possibleUser) {
        userId = possibleUser.replace(/[^a-zA-Z0-9_\.@\-]/g, '');
      } else {
        userId = 'JSMITH'; // default fallback
      }
    }

    let roleCategory: string | undefined = undefined;
    if (clean.includes('duty')) roleCategory = 'DUTY';
    else if (clean.includes('abstract')) roleCategory = 'ABSTRACT';
    else if (clean.includes('job role') || clean.includes('job roles') || clean.includes('job')) roleCategory = 'JOB';
    else if (clean.includes('data role') || clean.includes('data roles') || clean.includes('data')) roleCategory = 'DATA';
    else if (clean.includes('grc')) roleCategory = 'GRC';

    const params: any = { userId };
    if (roleCategory) params.roleCategory = roleCategory;

    return {
      intent: 'ROLES_BY_USER',
      parameters: params,
      explanation: `Listing ${roleCategory ? `${roleCategory} ` : ''}roles assigned to user "${userId}".`
    };
  }

  // 9. Single User Detail
  if (clean.includes('who is') || clean.includes('show user') || clean.includes('user details') || clean.includes('profile')) {
    let userId = '';
    const matchWho = clean.match(/(?:who\s+is|show\s+user|details\s+for|profile\s+of|profile\s+for)\s+([a-zA-Z0-9_\.@\-\s]+)/);
    if (matchWho && matchWho[1]) {
      userId = matchWho[1].trim();
    } else if (context && context.entityType === 'USER' && context.entityId) {
      userId = context.entityId;
    } else {
      const words = clean.split(/\s+/);
      const possibleUser = words.find(w => w.includes('.') || w.includes('_'));
      if (possibleUser) {
        userId = possibleUser.replace(/[^a-zA-Z0-9_\.@\-]/g, '');
      } else {
        userId = 'JSMITH';
      }
    }
    return {
      intent: 'GET_USER',
      parameters: { userId },
      explanation: `Retrieving user details for "${userId}".`
    };
  }

  // 10. Role search by keyword
  if (clean.includes('search') || clean.includes('find role') || clean.includes('containing') || clean.includes('roles related')) {
    let keyword = '';
    const kwMatch = clean.match(/(?:containing|keyword|search|for|related to)\s+["']?([a-zA-Z0-9_\s]+)["']?/);
    if (kwMatch && kwMatch[1]) {
      keyword = kwMatch[1].trim();
    } else {
      keyword = 'Manager';
    }
    return {
      intent: 'ROLE_SEARCH',
      parameters: { keyword },
      explanation: `Searching roles matching the keyword "${keyword}".`
    };
  }

  // 11. List Users
  if (
    (clean.includes('list') && clean.includes('users')) ||
    (clean.includes('users') && (clean.includes('multiple') || clean.includes('no') || clean.includes('without') || clean.includes('admin') || clean.includes('high risk') || clean.includes('high-risk')))
  ) {
    let filterType = 'NONE';
    if (clean.includes('multiple') || clean.includes('more than one')) filterType = 'MULTIPLE_ROLES';
    else if (clean.includes('no') || clean.includes('without')) filterType = 'NO_ROLES';
    else if (clean.includes('admin')) filterType = 'ADMIN_ROLES';
    else if (clean.includes('high risk') || clean.includes('high-risk')) filterType = 'HIGH_RISK';

    return {
      intent: 'LIST_USERS',
      parameters: { filterType },
      explanation: `Listing users filtered by "${filterType}".`
    };
  }

  // 12. List Roles
  if (clean.includes('list') && clean.includes('roles')) {
    return {
      intent: 'LIST_ROLES',
      parameters: {},
      explanation: 'Listing all security roles in the environment.'
    };
  }

  // 13. Advanced Access Requests
  if (clean.includes('access request') || clean.includes('access requests') || clean.includes('pending request') || (clean.includes('request') && (clean.includes('violation') || clean.includes('risk')))) {
    let user = '';
    const userMatch = clean.match(/(?:for|of|by)\s+([a-zA-Z0-9_\.@\-\s]+)/);
    if (userMatch && userMatch[1] && !userMatch[1].includes('violation') && !userMatch[1].includes('risk')) {
      user = userMatch[1].trim();
    }
    return {
      intent: 'ACCESS_REQUESTS',
      parameters: { user },
      explanation: 'Retrieving Advanced Access Requests from Oracle Fusion Risk Management.'
    };
  }

  // 14. Advanced Controls
  if (clean.includes('advanced control') || clean.includes('advanced controls') || clean.includes('security control') || clean.includes('security controls') || clean.includes('list controls')) {
    return {
      intent: 'ADVANCED_CONTROLS',
      parameters: {},
      explanation: 'Listing Advanced Access Controls from Oracle Fusion Risk Management.'
    };
  }

  // Default Fallback
  return {
    intent: 'UNKNOWN',
    parameters: {},
    explanation: 'Unable to confidently classify intent. Defaulting to general conversation.'
  };
}

// Generate Fallback Text Explanations
function generateFallbackExplanation(intent: string, parameters: any, toolResult: ToolExecutionResult): string {
  if (toolResult.integrationRequired) {
    return `### Oracle Fusion API Integration Required\n\nThis query requires live GRC (Governance, Risk, and Compliance) or security console details. The following integration is required:\n\n* **Required Service**: ${toolResult.error || 'Oracle Access / Risk Management API'}\n* **Status**: Placeholder setup; awaiting endpoint mapping.`;
  }

  if (!toolResult.success) {
    if (intent === 'ROLES_BY_PRIVILEGE') {
      const priv = parameters.privilegeName || '';
      return toolResult.data?.message || toolResult.error || `No matching privilege "${priv}" was found in the synchronized OTBI dataset.`;
    }
    if (toolResult.data?.ambiguous && Array.isArray(toolResult.data.matches)) {
      return `Which role did you mean? Multiple Oracle security roles match your query "**${parameters.roleName || ''}**". Please select one below to inspect privileges:\n\n` +
        toolResult.data.matches.map((m: any, idx: number) => `${idx + 1}. **${m.roleName}** (\`${m.roleCode}\`)`).join('\n');
    }
    return `Failed to execute the security operation. Details: ${toolResult.error || toolResult.data?.message || 'Role not found'}`;
  }

  const data = toolResult.data;
  
  switch (intent) {
    case 'SECURITY_STATISTICS':
      return `Here are the security statistics for the **${toolResult.dataSource}** environment:
* There are **${data.totalUsers}** users registered, with **${data.activeUsers}** active and **${data.inactiveUsers}** inactive.
* A total of **${data.totalRoles}** roles are configured: **${data.jobRolesCount}** Job Roles, **${data.dutyRolesCount}** Duty Roles, **${data.dataRolesCount}** Data Roles, **${data.abstractRolesCount}** Abstract Roles, and **${data.grcRolesCount}** GRC-specific Roles.
* **${data.auditEventsCount}** audit events are recorded in the history log.
* There are **${data.riskIncidentsCount}** active security or Segregation of Duties (SoD) incidents requiring review.`;
      
    case 'USERS_BY_ROLE': {
      const roleName = parameters.roleName || 'Advanced Access Controls Analyst';
      const userList = Array.isArray(data?.users) ? data.users : (Array.isArray(data) ? data : []);
      const count = data?.totalMatching !== undefined ? data.totalMatching : userList.length;
      if (count === 0) {
        return `No users are currently assigned to the **${roleName}** role in ${toolResult.dataSource}.`;
      }
      return `**${count} users** currently have the **${roleName}** role. Browse through all assigned users in the table below.`;
    }
      
    case 'ROLES_BY_USER':
    case 'GET_USER': {
      if (!data || data.message) {
        return `User **${parameters.userId}** was not found in ${toolResult.dataSource}.`;
      }
      const roleCount = data.assignedRoles?.length || 0;
      return `Security Roles — **${data.displayName}**\n\n**${data.displayName}** (${data.userName}) is **${data.active ? 'Active' : 'Inactive'}** and has **${roleCount}** active assigned security roles.`;
    }

    case 'LIST_USERS': {
      const uList = data?.users || (Array.isArray(data) ? data : []);
      const total = data?.totalMatching || uList.length;
      if (parameters.filterType === 'MULTIPLE_ROLES') {
        return `Found **${total} users** with multiple active role assignments in ${toolResult.dataSource}. Multiple role assignments serve as an access indicator that may warrant review for privilege accumulation or Segregation of Duties (SoD) boundaries.`;
      }
      return `Retrieved **${total} users** from ${toolResult.dataSource}. Use pagination to browse through all accounts.`;
    }

    case 'LIST_ROLES':
    case 'ROLE_SEARCH': {
      const kw = parameters.keyword || '';
      const rList = data?.roles || (Array.isArray(data) ? data : []);
      const total = data?.totalResults || rList.length;
      return `Found **${total} roles**${kw ? ` matching keyword "${kw}"` : ''} in ${toolResult.dataSource}. Showing page results below.`;
    }

    case 'AUDIT_HISTORY': {
      if (!toolResult.success) {
        if (toolResult.error && toolResult.error.includes('has not been configured yet')) {
          return toolResult.error;
        }
        if (toolResult.error && toolResult.error.includes('is not recognized')) {
          return toolResult.error;
        }
        return `Unable to retrieve audit history from Oracle Fusion: ${toolResult.error || 'Unknown error'}`;
      }
      const logs = data?.logs || (Array.isArray(data) ? data : []);
      const pName = data?.productDisplayName || parameters.product || 'Oracle Fusion';
      const boName = data?.businessObjectDisplayName || parameters.businessObjectType;
      const userFilter = parameters.username || '';
      if (!logs || logs.length === 0) {
        return `No audit records were found for **${pName}**${boName ? ` (${boName})` : ''}${userFilter ? ` for user ${userFilter}` : ''} in the log.`;
      }
      return `Retrieved **${logs.length}** audit record(s) from **${toolResult.dataSource}** for **${pName}**${boName ? ` (${boName})` : ''}${userFilter ? ` filtered by user "${userFilter}"` : ''}.`;
    }

    case 'ROLE_HIERARCHY':
      return `Showing hierarchy tree for role **${data.roleName}** (${data.roleCode}). It inherits **${data.hierarchy?.children?.length || 0}** direct duty or access roles, routing privileges down to standard employees.`;

    case 'ROLE_PRIVILEGES':
      return `Role **${data.roleName}** possesses **${data.privileges?.length || 0}** access privileges, allowing operations such as: ${data.privileges.slice(0, 3).map((p: any) => p.name).join(', ')}.`;

    case 'ROLES_BY_PRIVILEGE': {
      const privName = data?.privilegeName || parameters.privilegeName || 'the requested privilege';
      const privCode = data?.privilegeCode ? ` (${data.privilegeCode})` : '';
      const count = data?.count !== undefined ? data.count : (Array.isArray(data?.roles) ? data.roles.length : 0);

      if (data?.matchType === 'AMBIGUOUS' && Array.isArray(data?.possibleMatches)) {
        const suggestions = data.possibleMatches.map((m: any) => `* **${m.privilegeName}** (\`${m.privilegeCode}\`) - ${m.roleCount} role(s)`).join('\n');
        return `Multiple privileges matched "${privName}". Please clarify which privilege you would like to inspect:\n\n${suggestions}`;
      }

      if (count === 0) {
        return data?.message || `No security roles in the synchronized OTBI catalog were found for privilege **${privName}**.`;
      }

      const roleRows = (data.roles || []).map((r: any) => `| ${r.roleName} | ${r.roleCode} |`).join('\n');
      return `Privilege: ${privName}\n\n| Role Name | Role Code |\n|-----------|-----------|\n${roleRows}`;
    }

    case 'USER_ACCESS':
      const access = parameters.privilegeOrAccess;
      return `The privilege **${data.roleName}** allows access to operations matching "${access}". In the current environment, users possessing this privilege inherit it through active role hierarchies.`;

    case 'RISK_INFORMATION':
      return `Security Risk Overview:
* **Segregation of Duties (SoD)**: Active rules enforce policy boundaries (e.g., separating invoice entry from invoice approval).
* **Current status**: We have detected open conflicts related to users with overlapping credentials. Check the Risk page for details.`;

    case 'ACCESS_REQUESTS':
      const reqList = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
      const totalViolations = reqList.reduce((acc: number, r: any) => acc + (r.violationCount || 0), 0);
      return `Found **${reqList.length}** Advanced Access Request(s) in Oracle Fusion (${toolResult.dataSource}).
* **Total Policy Violations Detected**: ${totalViolations}
* **Pending/New Requests**: ${reqList.filter((r: any) => r.status === 'NEW').length}
* **Approved Requests**: ${reqList.filter((r: any) => r.status === 'APPROVED').length}
You can review the full request details and risk flags in the table below or via the Risk Management dashboard.`;

    case 'ADVANCED_CONTROLS': {
      if (data?.notFound) {
        return `The control "${data.query || parameters.controlName || parameters.controlId || 'requested'}" could not be located in the authoritative Oracle Fusion Advanced Controls catalog.`;
      }

      if (data?.control) {
        const ctrl = data.control;
        const incCount = data.incidentCount !== undefined ? data.incidentCount : (ctrl.incidentCount || 0);
        let answer = `Control:\n**${ctrl.name}**\n\nControl ID:\n\`${ctrl.id}\`\n\nStatus:\n**${ctrl.status}**\n\nState:\n**${ctrl.state}**\n\nIncident Count:\n**${incCount.toLocaleString()}** (Authoritative Oracle Fusion Data)\n\n`;

        if (data.cacheStatus === 'SYNCING') {
          const fetched = data.fetchedCount || 0;
          const total = data.totalCount || incCount;
          answer += `*Incident Synchronization*: **SYNCING IN PROGRESS** (${fetched.toLocaleString()} / ${total ? total.toLocaleString() : '...'} incidents retrieved so far from Oracle Fusion).\n\nYou can monitor live progress on the Risk Management Controls page.`;
          return answer;
        }

        if (incCount === 0) {
          answer += `No incidents found for this control.`;
        } else if (Array.isArray(data.incidents) && data.incidents.length > 0) {
          answer += `### Detected Incidents Summary (Showing ${Math.min(data.incidents.length, 5)} of ${incCount.toLocaleString()})\n`;
          data.incidents.slice(0, 5).forEach((inc: any) => {
            const u = inc.globalUserName || inc.globalUserId || 'Unassigned User';
            const r = inc.role ? ` (Role: ${inc.role})` : '';
            const prio = inc.priority ? ` - Priority: \`${inc.priority}\`` : '';
            const st = inc.status ? `, Status: \`${inc.status}\`` : '';
            const desc = inc.incidentInformation ? `\n  *Violation:* ${inc.incidentInformation}` : '';
            answer += `* **Incident #${inc.id}**: User **${u}**${r}${prio}${st}${desc}\n`;
          });
          if (incCount > 5) {
            answer += `\n*...and ${(incCount - 5).toLocaleString()} additional incident(s). View the complete incident ledger and export options in the Risk Management Controls Catalog.*`;
          }
        }
        return answer;
      }

      const ctrlList = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
      return `Oracle Fusion Advanced Access Controls catalog (${toolResult.dataSource}) contains **${ctrlList.length}** configured control(s). Automated control analysis and continuous monitoring policies can be reviewed in the Risk module.`;
    }

    default:
      return `Retrieved data matching your request from the ${toolResult.dataSource}. Please review the table below for the structured values.`;
  }
}

export async function processUserMessage(message: string, context?: any): Promise<AIResponse> {
  let intentData: IntentExtraction = { intent: 'UNKNOWN', parameters: {}, explanation: '' };
  let errorMsg = '';

  const contextPrompt = context ? `
Active Entity Context:
- Active Page View: ${context.currentView || 'N/A'}
- Entity Type: ${context.entityType || 'N/A'}
- Entity ID/Username: ${context.entityId || 'N/A'}
- Entity Name/Display Name: ${context.entityName || 'N/A'}

The user may refer to this entity implicitly (e.g. "who has this role?", "what are its privileges?", "show their audit history", "explain this role").
Based on this context, map those pronouns to the current entity:
- If the entity is a ROLE and name is "${context.entityName}", then "this role" or "it" refers to "${context.entityName}". Map it to USERS_BY_ROLE with parameters {"roleName": "${context.entityName}"} or ROLE_PRIVILEGES with parameters {"roleName": "${context.entityName}"}.
- If the entity is a USER and username/id is "${context.entityId}", then "this user" or "their" refers to "${context.entityId}". Map it to ROLES_BY_USER / GET_USER with parameters {"userId": "${context.entityId}"} or AUDIT_HISTORY with parameters {"username": "${context.entityId}"}.
` : '';

async function callGroqCompletions(payload: any): Promise<any> {
  const originalModel = payload.model;
  // Normalize gpt-oss-20b / gpt-oss-120b values from UI
  if (payload.model === 'gpt-oss-20b') {
    payload.model = 'openai/gpt-oss-20b';
  } else if (payload.model === 'gpt-oss-120b') {
    payload.model = 'openai/gpt-oss-120b';
  }

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.groqApiKey}`
        }
      }
    );
    return response;
  } catch (err: any) {
    const isModelNotFoundError = 
      err.response?.status === 404 || 
      err.response?.data?.error?.code === 'model_not_found' ||
      (err.response?.data?.error?.message && err.response.data.error.message.includes('does not exist'));

    if (isModelNotFoundError && payload.model !== 'openai/gpt-oss-20b') {
      console.warn(`[Groq Warning] Model ${originalModel} (resolved to ${payload.model}) not found/accessible. Retrying with self-healing fallback model: openai/gpt-oss-20b`);
      const retryPayload = { ...payload, model: 'openai/gpt-oss-20b' };
      return await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        retryPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.groqApiKey}`
          }
        }
      );
    }
    throw err;
  }
}

  // Step 1: NLU Intent Detection (Gemini vs Fallback)
  if (config.groqApiKey) {
    try {
      const response = await callGroqCompletions({
        model: config.groqModel,
        messages: [
          {
            role: 'system',
            content: `You are the NLU intent classification engine for an Oracle Fusion Security Assistant. 
Analyze the user query and output a strict JSON object mapping to:
{
  "intent": "LIST_USERS" | "GET_USER" | "LIST_ROLES" | "GET_ROLE" | "USERS_BY_ROLE" | "ROLES_BY_USER" | "ROLE_SEARCH" | "ROLE_DETAILS" | "ROLE_HIERARCHY" | "ROLE_PRIVILEGES" | "ROLES_BY_PRIVILEGE" | "USER_ACCESS" | "AUDIT_HISTORY" | "SECURITY_STATISTICS" | "RISK_INFORMATION" | "ACCESS_REQUESTS" | "ADVANCED_CONTROLS" | "UNKNOWN",
  "parameters": {
    "roleName": "Extracted role display name or code (string, optional)",
    "privilegeName": "Extracted privilege name for reverse lookup (e.g. 'Maintain Supplier Contact', 'Create Purchase Order') (string, optional)",
    "userId": "Extracted user identifier like JSMITH or HCM_IMPL (string, optional)",
    "username": "Extracted audit username (string, optional)",
    "keyword": "Keyword for search (string, optional)",
    "action": "Audit action: CREATE, UPDATE, DELETE, etc. (string, optional)",
    "privilegeOrAccess": "Function name / privilege check: invoice creation, Accounts Payable (string, optional)",
    "filterType": "For LIST_USERS, extract: 'MULTIPLE_ROLES' (if query asks for users with multiple/more than one role), 'NO_ROLES' (if users without roles), 'ADMIN_ROLES' (if security admins), 'HIGH_RISK' (if high-risk access), or 'NONE' (string, optional)",
    "roleCategory": "When query asks for specific role type assigned to a user (e.g. 'Duty Roles', 'Abstract Roles', 'Job Roles', 'Data Roles'), extract: 'DUTY', 'ABSTRACT', 'JOB', 'DATA', or omit/'ALL' for general role queries (string, optional)",
    "controlName": "Extracted control name or rule number like '4096: Manage HSDL...' or '4096' or 'Manage HSDL' (string, optional)",
    "controlId": "Extracted numerical control ID like '114281' (string, optional)"
  },
  "explanation": "Brief rationale for this mapping"
}

Intent definitions:
- LIST_USERS: List or show all users.
- GET_USER: Details about a specific user by username/id (e.g. "Who is John Smith" or "who is JSMITH").
- LIST_ROLES: Display all roles in the environment.
- GET_ROLE / ROLE_DETAILS: Search details of a specific role by name.
- USERS_BY_ROLE: Find who has a specific role (e.g. "Who has the Advanced Access Controls Analyst role?").
- ROLES_BY_USER: Show what roles are assigned to a specific user (e.g. "which roles are assigned to JSMITH?").
- ROLE_SEARCH: Find roles matching keywords (e.g. "find roles containing Manager").
- ROLE_HIERARCHY: Show role children, parent, and hierarchy.
- ROLE_PRIVILEGES: Show privileges assigned to a role.
- ROLES_BY_PRIVILEGE: Find which roles grant or have a specific privilege (e.g. "Which roles have privilege Maintain Supplier Contact?", "Can you give me the roles which have privilege Create Purchase Order?").
- USER_ACCESS: Find who can perform an action / has privilege (e.g. "Who has payroll access?", "Who can create invoices?").
- AUDIT_HISTORY: Show audit trail (who modified role, who assigned role).
- SECURITY_STATISTICS: Count of users, roles, statistics, dashboard cards.
- RISK_INFORMATION: Incidents, Access certifications, Segregation of Duties conflicts.
- ACCESS_REQUESTS: Advanced access requests list and approvals.
- ADVANCED_CONTROLS: Show advanced controls catalog, control details, or control violation incidents (e.g. "Show me details of 4096: Manage HSDL Spreadsheets Templates and Load Data using HSDL", "Show incidents for Manage HSDL Spreadsheets...", "Show incidents for 4096", "Show details of control 114281").
- UNKNOWN: Generic conversations or queries outside security boundaries.

${contextPrompt}

Only output valid JSON matching the schema. Do not include markdown formatting or wrapper around the JSON response.`
          },
          {
            role: 'user',
            content: message
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      });
      
      const text = response.data.choices[0].message.content;
      const parsed = JSON.parse(text) as IntentExtraction;
      if (parsed && parsed.intent) {
        intentData = parsed;
      }
    } catch (err: any) {
      console.warn('[Groq NLU Error] Falling back to rule-based engine:', err.message || err);
      intentData = fallbackNLU(message, context);
      errorMsg = (err as Error).message;
    }
  } else {
    // No Gemini key, use standard fallback NLU
    intentData = fallbackNLU(message, context);
  }

  // Authoritative Audit Trail catalog resolution guard for AUDIT_HISTORY intent
  if (intentData.intent === 'AUDIT_HISTORY') {
    const clean = message.toLowerCase();
    if (clean.includes('hcm common architecture')) {
      intentData.parameters.product = 'HCM Common Architecture';
      intentData.parameters.businessObjectType = 'Configure HCM Data Loader Parameters';
    } else if (clean.includes('hcm') || clean.includes('global human resources') || clean.includes('human resources') || clean.includes('person')) {
      intentData.parameters.product = 'Global Human Resources';
      intentData.parameters.businessObjectType = 'Person';
    } else {
      if (!intentData.parameters.product) {
        const resolved = auditProductCatalogService.resolveProduct(clean);
        if (resolved) {
          intentData.parameters.product = resolved.productName || resolved.displayName;
        }
      }
      if (intentData.parameters.product) {
        const resolved = auditProductCatalogService.resolveProduct(intentData.parameters.product);
        if (resolved && !intentData.parameters.businessObjectType && resolved.businessObjects) {
          for (const bo of resolved.businessObjects) {
            if (clean.includes(bo.displayName.toLowerCase()) || bo.aliases?.some(a => clean.includes(a.toLowerCase()))) {
              intentData.parameters.businessObjectType = bo.displayName;
              break;
            }
          }
        }
      }
    }
  }

  // Step 2: Execute Controlled Tool Operation
  let toolResult: ToolExecutionResult | null = null;
  const toolFunction = TOOLS_REGISTRY[intentData.intent];

  if (toolFunction) {
    try {
      toolResult = await toolFunction(intentData.parameters);
    } catch (err) {
      toolResult = {
        tool: intentData.intent,
        parameters: intentData.parameters,
        dataSource: oracleService.getModeInfo().dataSource,
        timestamp: new Date().toISOString(),
        success: false,
        error: (err as Error).message
      };
    }
  }

  // Step 3: Generate Natural Language Answer
  let businessFriendlyAnswer = '';
  let synthesisJson: any = null;

  if (intentData.intent === 'AUDIT_HISTORY' && !toolResult?.success) {
    businessFriendlyAnswer = toolResult?.error || 'Unable to retrieve audit history from Oracle Fusion.';
    synthesisJson = {
      summary: businessFriendlyAnswer,
      keyFindings: [],
      riskHighlights: []
    };
  } else if (intentData.intent === 'AUDIT_HISTORY' && toolResult?.success) {
    businessFriendlyAnswer = generateFallbackExplanation(intentData.intent, intentData.parameters, toolResult);
    synthesisJson = {
      summary: businessFriendlyAnswer,
      keyFindings: [],
      riskHighlights: []
    };
  } else if (intentData.intent === 'SECURITY_STATISTICS' && toolResult && toolResult.success) {
    const s = toolResult.data || {};
    synthesisJson = {
      summary: `There are ${s.totalUsers || 0} configured identity users (${s.activeUsers || 0} active, ${s.inactiveUsers || 0} inactive) and ${s.totalRoles || 0} active security roles configured in ${toolResult.dataSource}.`,
      keyFindings: [
        `Job Roles comprise the vast majority of assignments (${s.jobRolesCount || 0} roles).`,
        `Role Landscape: ${s.dataRolesCount || 0} Data Roles, ${s.abstractRolesCount || 0} Abstract Roles, ${s.dutyRolesCount || 0} Duty Roles, and ${s.grcRolesCount || 0} GRC Roles.`,
        `System audit trail tracks real-time account and role membership modifications.`
      ],
      riskHighlights: []
    };
    businessFriendlyAnswer = synthesisJson.summary;
  } else if (toolResult && toolResult.success && toolResult.data?.filteredRoleCategory && (!toolResult.data.hasMatchingRoles || !toolResult.data.assignedRoles || toolResult.data.assignedRoles.length === 0)) {
    // Deterministic response for zero matching roles of a requested category
    const catName = toolResult.data.filteredRoleCategory.charAt(0) + toolResult.data.filteredRoleCategory.slice(1).toLowerCase();
    const uName = toolResult.data.displayName || toolResult.data.userName || intentData.parameters.userId || 'User';
    const originalCount = toolResult.data.totalAssignedRolesCount ?? 0;
    
    synthesisJson = {
      summary: `No matching roles found.\nUser ${uName} does not have any assigned ${catName} Roles.`,
      keyFindings: [
        `User ${uName} has ${originalCount} total assigned role(s) in the system.`,
        `Zero (0) assigned roles match the requested ${catName} Role category.`
      ],
      riskHighlights: []
    };
    businessFriendlyAnswer = synthesisJson.summary;
  } else if (config.groqApiKey && toolResult && toolResult.success && !toolResult.integrationRequired) {
    try {
      // Prevent 413 Payload Too Large errors by truncating large arrays in the prompt
      let dataForPrompt = toolResult.data;
      let isTruncated = false;
      let totalCount = 0;
      let arrayToProcess = null;
      let isUsersObject = false;

      if (dataForPrompt && typeof dataForPrompt === 'object' && Array.isArray(dataForPrompt.users)) {
        arrayToProcess = dataForPrompt.users;
        isUsersObject = true;
      } else if (Array.isArray(dataForPrompt)) {
        arrayToProcess = dataForPrompt;
      }

      if (arrayToProcess) {
        totalCount = arrayToProcess.length;
        let processedArray = arrayToProcess.map((item: any) => {
          if (item && typeof item === 'object') {
            const stripped: any = {};
            if (item.id !== undefined) stripped.id = item.id;
            if (item.userName !== undefined) stripped.userName = item.userName;
            if (item.displayName !== undefined) stripped.displayName = item.displayName;
            if (item.active !== undefined) stripped.active = item.active;
            if (item.roleCode !== undefined) stripped.roleCode = item.roleCode;
            if (item.category !== undefined) stripped.category = item.category;
            if (item.roleCount !== undefined) stripped.roleCount = item.roleCount;
            if (item.riskLevel !== undefined) stripped.riskLevel = item.riskLevel;
            if (item.recommendation !== undefined) stripped.recommendation = item.recommendation;
            if (item.assignedRoles !== undefined) {
              stripped.assignedRolesCount = Array.isArray(item.assignedRoles) ? item.assignedRoles.length : 0;
              stripped.assignedRolesSample = Array.isArray(item.assignedRoles) ? item.assignedRoles.slice(0, 2) : [];
            }
            return stripped;
          }
          return item;
        });

        if (totalCount > 10) {
          processedArray = processedArray.slice(0, 10);
          isTruncated = true;
        }

        if (isUsersObject) {
          dataForPrompt = {
            ...dataForPrompt,
            users: processedArray
          };
        } else {
          dataForPrompt = processedArray;
        }
      }

      const response = await callGroqCompletions({
        model: config.groqModel,
        messages: [
          {
            role: 'system',
            content: `You are the Oracle Fusion Security & Risk Intelligence Assistant.
Analyze the user query and the structured data output. Output a strict JSON object matching this schema:
{
  "summary": "One or two sentences executive summary directly answering the question.",
  "keyFindings": ["Up to 3-5 useful security findings, facts, or insights based strictly on the data."],
  "riskHighlights": ["Any security risks or attention highlights. Leave empty array if none."]
}

COMPLIANCE & RISK CLASSIFICATION RULES:
- Multiple role assignments are standard in enterprise environments and serve as an access indicator or review point, NOT an automatic security violation.
- Distinguish between: (1) Multiple role assignments = risk/access indicator, (2) Elevated role count (>15) = elevated review priority, (3) Sensitive admin roles = potential high risk, (4) Confirmed SoD violations = confirmed risk.
- NEVER make unsupported claims such as "all users are high risk", "urgent need to reduce roles", or "significant privilege abuse" unless verified by actual Oracle SoD conflict data.
- When answering queries about users with multiple roles, frame risk notes as helpful indicators/recommendations: "RISK INDICATOR: X users have multiple role assignments. Multiple roles can increase privilege accumulation and may create excessive-access or Segregation-of-Duties risks. Review users with unusually high role counts or sensitive role combinations."
- Focus only on high-level interpretation, metrics, and warnings. Do NOT list out names of assigned roles in the summary or findings, as they are already displayed in structured cards below your text response. Avoid repeating numbers or duplication. Produce a concise, high-level executive summary and key insights only. Do NOT output any markdown tables, bulleted lists of raw data, HTML, or raw record output.
- For ROLES_BY_PRIVILEGE queries: If 1 or more roles have the privilege, begin your summary directly with "${toolResult.data?.count || 0} roles have this privilege." If 0 roles have the privilege, state clearly: "No security roles in the current catalog contain the privilege ${toolResult.data?.privilegeName || ''}."
${toolResult.data?.filteredRoleCategory ? `- SPECIFIC ROLE CATEGORY REQUEST: The user specifically requested "${toolResult.data.filteredRoleCategory} Roles". The structured data contains ONLY matching ${toolResult.data.filteredRoleCategory} Roles. In your summary and findings, confirm that the user has these matching ${toolResult.data.filteredRoleCategory} Roles and highlight them.` : ''}`
          },
          {
            role: 'user',
            content: `The user asked: "${message}"
${context ? `Active context: ${JSON.stringify(context)}` : ''}

We executed the backend tool "${toolResult.tool}" on the datasource "${toolResult.dataSource}".
The tool returned the following structured data:
${JSON.stringify(dataForPrompt, null, 2)}
${isTruncated ? `\n(Note: The data list above was truncated to the first 10 items out of ${totalCount} total items for context efficiency.)` : ''}

CRITICAL USER PROFILE INFO (if applicable):
${(toolResult.tool === 'getUser' || toolResult.tool === 'getRolesForUser') && toolResult.data ? `User name: ${toolResult.data.displayName}, Unique Assigned Roles Count: ${Array.isArray(toolResult.data.assignedRoles) ? toolResult.data.assignedRoles.length : 0}` : ''}`
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      });
      
      const content = response.data.choices[0].message.content;
      synthesisJson = JSON.parse(content);
      if (intentData.intent === 'ROLES_BY_PRIVILEGE' && toolResult?.data?.success) {
        businessFriendlyAnswer = generateFallbackExplanation(intentData.intent, intentData.parameters, toolResult);
      } else if (intentData.intent === 'AUDIT_HISTORY') {
        businessFriendlyAnswer = generateFallbackExplanation(intentData.intent, intentData.parameters, toolResult);
      } else if (intentData.intent === 'ADVANCED_CONTROLS' && toolResult?.data?.control) {
        businessFriendlyAnswer = generateFallbackExplanation(intentData.intent, intentData.parameters, toolResult);
      } else {
        businessFriendlyAnswer = synthesisJson.summary || '';
      }
    } catch (err: any) {
      console.warn('[Groq Synthesis Error] Generating fallback response:', err.message || err);
      businessFriendlyAnswer = generateFallbackExplanation(intentData.intent, intentData.parameters, toolResult);
      synthesisJson = {
        summary: businessFriendlyAnswer,
        keyFindings: [],
        riskHighlights: []
      };
    }
  } else if (toolResult) {
    if (toolResult.ambiguous) {
      businessFriendlyAnswer = toolResult.data?.message || 'Multiple matching items found. Please select which one you want to inspect.';
      synthesisJson = {
        summary: businessFriendlyAnswer,
        keyFindings: [],
        riskHighlights: []
      };
    } else {
      businessFriendlyAnswer = generateFallbackExplanation(intentData.intent, intentData.parameters, toolResult);
      synthesisJson = {
        summary: businessFriendlyAnswer,
        keyFindings: [],
        riskHighlights: []
      };
    }
  } else {
    businessFriendlyAnswer = `I couldn't map your question to a specific security database query.
    
I can help you answer questions about:
* **Users & Roles**: "Who has the Advanced Access Controls Analyst role?", "Which roles are assigned to JSMITH?"
* **Privileges**: "What privileges does AP Manager have?", "Who has payroll access?"
* **Audits**: "Who modified this role?", "Show audit logs for user RLEE"
* **GRC / Risk**: "Show Segregation of Duties conflicts", "List active security incidents"

Please try rephrasing your question or navigating to the pages in the sidebar to browse details directly.`;
  }

  return {
    message: businessFriendlyAnswer,
    intent: intentData.intent,
    parameters: intentData.parameters,
    toolResult,
    structuredData: toolResult && (toolResult.success || toolResult.ambiguous) && !toolResult.integrationRequired
      ? buildStructuredResponse(intentData.intent, intentData.parameters, toolResult, synthesisJson)
      : undefined,
    aiExplanation: intentData.explanation
  };
}

// Deterministic response formatter for different security intents
function buildStructuredResponse(
  intent: string,
  parameters: any,
  toolResult: ToolExecutionResult,
  synthesisJson: any
): any {
  const data = toolResult.data;
  const source = toolResult.dataSource;
  const timestamp = new Date(toolResult.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const summary = synthesisJson?.summary || `Retrieved security data from the ${source}.`;
  const keyFindings = synthesisJson?.keyFindings || [];
  let riskHighlights: string[] = synthesisJson?.riskHighlights || [];

  let title = 'Security Details';
  let table: any = undefined;
  let actions: any[] = [];
  let totalCount = Array.isArray(data) ? data.length : 1;
  let matchingCount = totalCount;

  switch (intent) {
    case 'LIST_USERS': {
      const filterType = parameters.filterType || 'NONE';
      title = filterType === 'MULTIPLE_ROLES' ? 'Users with Multiple Roles' :
              filterType === 'NO_ROLES' ? 'Users Without Roles' :
              filterType === 'ADMIN_ROLES' ? 'Security Administrators' :
              filterType === 'HIGH_RISK' ? 'High-Risk Access Accounts' : 'Registered Application Users';

      const userArray = data?.users || (Array.isArray(data) ? data : []);
      totalCount = data?.totalAnalyzed || userArray.length;
      matchingCount = data?.totalMatching || userArray.length;

      table = {
        type: 'users',
        columns: ['Display Name', 'Username', 'Status', 'Assigned Roles', 'Risk Level', 'Actions'],
        rows: userArray.map((u: any) => ({
          id: u.userName,
          displayName: u.displayName,
          userName: u.userName,
          active: u.active,
          roleCount: u.roleCount !== undefined ? u.roleCount : (u.assignedRoles?.length || 0),
          riskLevel: u.riskLevel || 'Low',
          recommendation: u.recommendation || 'View Details'
        }))
      };

      if (filterType === 'MULTIPLE_ROLES') {
        const hasIndicator = riskHighlights.some((r: string) => r.toLowerCase().includes('multiple role') || r.toLowerCase().includes('risk indicator'));
        if (!hasIndicator) {
          riskHighlights = [
            `RISK INDICATOR: ${matchingCount} users have multiple role assignments. Multiple roles can increase privilege accumulation and may create excessive-access or Segregation-of-Duties risks. Review users with unusually high role counts or sensitive role combinations.`,
            ...riskHighlights
          ];
        }
      }

      actions = [
        { label: 'Explore Users List', actionType: 'NAVIGATE', params: { page: 'users', filter: filterType } }
      ];
      break;
    }

    case 'USERS_BY_ROLE': {
      const roleName = parameters.roleName || 'Advanced Access Controls Analyst';
      title = `Assigned Members: ${roleName}`;
      const memberArray = Array.isArray(data?.users) ? data.users : (Array.isArray(data) ? data : []);
      totalCount = data?.totalMatching !== undefined ? data.totalMatching : memberArray.length;
      matchingCount = totalCount;
      table = {
        type: 'users',
        columns: ['Display Name', 'Username', 'Status', 'Assigned Roles', 'Risk Level', 'Actions'],
        rows: memberArray.map((u: any) => ({
          id: u.userName,
          displayName: u.displayName,
          userName: u.userName,
          active: u.active,
          roleCount: u.roleCount !== undefined ? u.roleCount : (u.assignedRoles?.length || 0),
          riskLevel: u.riskLevel || 'Low',
          recommendation: 'View Details'
        }))
      };
      actions = [
        { label: 'Open Roles Catalog', actionType: 'NAVIGATE', params: { page: 'roles' } }
      ];
      break;
    }

    case 'ROLES_BY_USER':
    case 'GET_USER': {
      const targetUser = data?.displayName ? data : null;
      if (targetUser) {
        const catFilter = targetUser.filteredRoleCategory;
        const catName = catFilter ? catFilter.charAt(0) + catFilter.slice(1).toLowerCase() : '';
        title = catFilter
          ? `Assigned ${catName} Roles: ${targetUser.displayName}`
          : `Security Profile: ${targetUser.displayName}`;

        table = {
          type: 'general',
          columns: ['Attribute', 'Value'],
          rows: [
            { id: '1', attribute: 'Display Name', value: targetUser.displayName },
            { id: '2', attribute: 'Username', value: targetUser.userName },
            { id: '3', attribute: 'Status', value: targetUser.active ? 'Active' : 'Inactive' },
            { 
              id: '4', 
              attribute: catFilter ? `${catName} Roles Configured` : 'Roles Configured', 
              value: catFilter
                ? `${targetUser.assignedRoles?.length || 0} active ${catName.toLowerCase()} role(s) assigned`
                : `${targetUser.assignedRoles?.length || 0} active roles assigned` 
            }
          ]
        };
        actions = [
          { 
            label: 'Deep Investigation Workspace', 
            actionType: 'INVESTIGATE', 
            params: { 
              type: 'user', 
              id: targetUser.userName, 
              name: targetUser.displayName,
              initialTab: intent === 'ROLES_BY_USER' ? 'ROLES' : 'OVERVIEW'
            } 
          }
        ];
      }
      break;
    }

    case 'LIST_ROLES':
    case 'ROLE_SEARCH':
    case 'GET_ROLE':
    case 'ROLE_DETAILS': {
      const kw = parameters.keyword || parameters.roleName || '';
      title = kw ? `Security Roles: "${kw}"` : 'Security Roles Catalog';
      const roleArray = Array.isArray(data?.roles) ? data.roles : (Array.isArray(data) ? data : []);
      totalCount = data?.totalResults !== undefined ? data.totalResults : roleArray.length;
      matchingCount = roleArray.length;
      table = {
        type: 'roles',
        columns: ['Role Name', 'Role Code', 'Category', 'Actions'],
        rows: roleArray.map((r: any) => ({
          id: r.roleCode,
          displayName: r.displayName,
          roleCode: r.roleCode,
          category: r.category
        }))
      };
      actions = [
        { label: 'Open Roles Catalog', actionType: 'NAVIGATE', params: { page: 'roles' } }
      ];
      break;
    }

    case 'AUDIT_HISTORY': {
      const pName = data?.productDisplayName || parameters.product || 'Oracle Fusion';
      const boName = data?.businessObjectDisplayName || parameters.businessObjectType;
      title = `Oracle Fusion Audit Trail: ${pName}${boName ? ` (${boName})` : ''}`;
      const logArray = data?.logs || (Array.isArray(data) ? data : []);
      totalCount = data?.totalRecords !== undefined ? data.totalRecords : logArray.length;
      matchingCount = logArray.length;
      table = {
        type: 'audit',
        columns: ['TIMESTAMP', 'USER', 'EVENT', 'BUSINESS OBJECT', 'IDENTIFIER', 'DETAILS'],
        rows: logArray.map((a: any) => ({
          id: a.id || a.timestamp,
          timestamp: a.timestamp,
          username: a.username,
          event: a.event,
          businessObject: a.businessObject,
          identifier: a.identifier,
          details: a.details
        }))
      };
      actions = [
        { label: 'Open Audit Trail Viewer', actionType: 'NAVIGATE', params: { page: 'audit' } }
      ];
      break;
    }

    case 'ROLE_HIERARCHY': {
      title = `Hierarchy: ${data.roleName || parameters.roleName}`;
      actions = [
        { 
          label: 'Deep Investigation Workspace', 
          actionType: 'INVESTIGATE', 
          params: { 
            type: 'role', 
            id: data.roleCode || parameters.roleName, 
            name: data.roleName || parameters.roleName,
            initialTab: 'HIERARCHY'
          } 
        }
      ];
      break;
    }

    case 'ROLE_PRIVILEGES': {
      if (data?.ambiguous && Array.isArray(data.matches)) {
        title = `Select Role: "${parameters.roleName}"`;
        actions = data.matches.map((m: any) => ({
          label: m.roleName,
          actionType: 'PROMPT',
          params: { query: `show privileges of ${m.roleName}` }
        }));
        table = {
          type: 'roles',
          columns: ['Role Name', 'Role Code', 'Category'],
          rows: data.matches.map((m: any) => ({
            id: m.roleCode,
            displayName: m.roleName,
            roleCode: m.roleCode,
            category: m.category
          }))
        };
        break;
      }
      title = `Privilege Entitlements: ${data.roleName || parameters.roleName}`;
      const privArray = Array.isArray(data.privileges) ? data.privileges : [];
      table = {
        type: 'privileges',
        columns: ['Privilege Name', 'Code', 'Inherited From'],
        rows: privArray.map((p: any) => ({
          id: p.code,
          name: p.name,
          code: p.code,
          inheritedFrom: p.inheritedFrom
        }))
      };
      actions = [
        { 
          label: 'Deep Investigation Workspace', 
          actionType: 'INVESTIGATE', 
          params: { 
            type: 'role', 
            id: data.roleCode || parameters.roleName, 
            name: data.roleName || parameters.roleName,
            initialTab: 'PRIVILEGES'
          } 
        }
      ];
      break;
    }

    case 'ROLES_BY_PRIVILEGE': {
      const privName = data?.privilegeName || parameters.privilegeName || 'Requested Privilege';
      const privCode = data?.privilegeCode ? ` (${data.privilegeCode})` : '';
      title = `Roles with Privilege: ${privName}${privCode}`;
      const rolesList = Array.isArray(data?.roles) ? data.roles : [];
      totalCount = data?.count !== undefined ? data.count : rolesList.length;
      matchingCount = totalCount;

      table = {
        type: 'roles_by_privilege',
        columns: ['Role Name', 'Role Code'],
        rows: rolesList.map((r: any) => ({
          id: r.roleCode,
          displayName: r.roleName,
          roleName: r.roleName,
          roleCode: r.roleCode
        }))
      };

      const syncMeta = data?.metadata;
      if (syncMeta) {
        riskHighlights = [
          `Data Source: ${syncMeta.dataSource || 'OTBI'} Analysis (/shared/Custom/CLAAPS privilege_Role_mapping).`,
          `Last Synced: ${syncMeta.lastSuccessfulSync ? new Date(syncMeta.lastSuccessfulSync).toLocaleString() : 'Live'} (${syncMeta.totalMappingRows} total mappings indexed).`
        ];
      }

      actions = [
        { label: 'Open Roles Catalog', actionType: 'NAVIGATE', params: { page: 'roles' } }
      ];
      break;
    }

    case 'SECURITY_STATISTICS': {
      title = 'Security Statistics Overview';
      actions = [
        { label: 'Open Overview Dashboard', actionType: 'NAVIGATE', params: { page: 'overview' } }
      ];
      break;
    }

    case 'RISK_INFORMATION': {
      title = 'GRC Risk Management Overview';
      actions = [
        { label: 'Open GRC Risk Page', actionType: 'NAVIGATE', params: { page: 'risk' } }
      ];
      break;
    }

    case 'ADVANCED_CONTROLS': {
      if (data?.control) {
        const ctrl = data.control;
        title = `Control: ${ctrl.name}`;
        const incList = Array.isArray(data.incidents) ? data.incidents : [];
        totalCount = incList.length;
        matchingCount = incList.length;
        if (incList.length > 0) {
          table = {
            type: 'control_incidents',
            columns: ['Incident ID', 'User', 'Role', 'Status', 'State', 'Priority'],
            rows: incList.map((inc: any) => ({
              id: inc.id,
              user: inc.globalUserName || inc.globalUserId || 'N/A',
              role: inc.role || 'N/A',
              status: inc.status || 'N/A',
              state: inc.state || 'N/A',
              priority: inc.priority || 'N/A'
            }))
          };
        }
        actions = [
          { label: 'Open Controls Catalog', actionType: 'NAVIGATE', params: { page: 'risk' } }
        ];
      } else {
        title = 'Oracle Advanced Controls Catalog';
        const ctrlList = Array.isArray(data?.items) ? data.items : [];
        totalCount = ctrlList.length;
        matchingCount = ctrlList.length;
        table = {
          type: 'controls',
          columns: ['Control ID', 'Control Name', 'Status', 'State'],
          rows: ctrlList.map((c: any) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            state: c.state || c.stateCode
          }))
        };
        actions = [
          { label: 'Open Controls Catalog', actionType: 'NAVIGATE', params: { page: 'risk' } }
        ];
      }
      break;
    }
  }

  return {
    title,
    summary,
    keyFindings,
    riskHighlights,
    table,
    actions,
    briefingRaw: data?.briefingRaw || null,
    role: data?.role || null,
    user: (intent === 'GET_USER' || intent === 'ROLES_BY_USER') && data?.displayName ? data : null,
    metadata: {
      source,
      retrievedAt: timestamp,
      totalCount,
      matchingCount
    }
  };
}
