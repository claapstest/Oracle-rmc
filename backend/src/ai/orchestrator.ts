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

  // -1. Access Certification intents (live Oracle BIP data). First: the 'certif'
  // root never overlaps user/role/privilege/audit matchers. Incident-flavored
  // questions without worksheet context fall through to the controls block.
  if (clean.includes('certif') && !(/\bincidents?\b/.test(clean) && !clean.includes('worksheet'))) {
    const stripPunct = (s: string) => s.replace(/[\?\.\!,;:\(\)"']+$/g, '').replace(/^["']+/, '').trim();

    const certIdKw = clean.match(/(?:certification|cert)\s+#?(?:id\s+)?(\d{1,7})\b/);
    const certIdBare = clean.match(/\b(\d{5,7})\b/);
    const certId = (certIdKw && certIdKw[1]) || (certIdBare && certIdBare[1]) || '';
    const quoted = clean.match(/"([^"]{2,80})"/);
    const underName = clean.match(/\b([A-Za-z0-9]*_[A-Za-z0-9_]+)\b/);
    const certName = (quoted && stripPunct(quoted[1])) || (underName && underName[1]) || '';

    const emailM = clean.match(/\b([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})\b/);
    let username = emailM ? emailM[1] : '';
    if (!username) {
      const um = clean.match(/(?:\buser\s+|\busername\s+|\bfor\s+|\bby\s+)([a-z0-9_\.\@\-]+)/);
      const stopU = new Set(['certification', 'cert', 'worksheet', 'role', 'roles', 'status', 'the', 'all', 'show', 'list', 'being', 'under', 'with', 'and']);
      if (um && um[1]) {
        const tok = stripPunct(um[1]).split(/\s+/)[0] || '';
        if (tok && !stopU.has(tok) && (tok.includes('.') || tok.includes('_') || tok.includes('@'))) username = tok;
      }
    }

    let role = '';
    const roleCodeM = clean.match(/\b(ORA_[A-Z0-9_]+)\b/);
    const roleCode = roleCodeM ? roleCodeM[1] : '';
    if (!roleCode) {
      const rm = clean.match(/roles?\s+(?:being\s+certified\s+(?:for\s+)?|for\s+|of\s+)?([a-zA-Z][^'"]*)/);
      if (rm && rm[1]) {
        let v = stripPunct(rm[1].split(/\s+(?:was|were|during|in|under|for|with|and|or)\b.*$/)[0]);
        v = stripPunct(v.replace(/^(for|of|being|user|certified|in)\s+/i, '').replace(/\s+(being|certified|for|user|with|and|status|state|all|show|list)\b.*$/i, ''));
        if (v && !/^(all|any|assigned|show|list|being|certified|user)$/i.test(v)) role = v;
      }
    }

    let manager = '';
    const mgrM = clean.match(/(?:under\s+)?manager\s+([a-z0-9._@\-' ]+?)(?:\s+who|\?|$)/) || clean.match(/(?:employees?|users?)\s+under\s+([a-z0-9._@\-']+)/);
    if (mgrM && mgrM[1]) {
      const v = stripPunct(mgrM[1]).split(/\s+/).slice(0, 2).join(' ');
      if (v && !/^(all|any|name)$/i.test(v)) manager = v;
    }

    let businessUnit = '';
    const buM = clean.match(/business unit\s+([a-z0-9][^?.,;]*)/i) || clean.match(/for the\s+['"]?([a-z0-9][^?.,;]*?)['"]?\s+business unit/i);
    if (buM && buM[1]) {
      const v = stripPunct(buM[1].split(/\s+who\s+/i)[0]);
      if (v) businessUnit = v;
    }

    let location = '';
    const locM = clean.match(/location\s+([a-z0-9][^?.,;]*)/i);
    if (locM && locM[1]) {
      const v = stripPunct(locM[1]);
      if (v) location = v;
    }

    let action = '';
    if (clean.includes('remove access')) action = 'REMOVE';
    else if (clean.includes('keep access')) action = 'KEEP';
    else if (clean.includes('revok')) action = 'REVOKED';
    else if (clean.includes('approv')) action = 'APPROVED';
    else if (/been certified|have been certified/.test(clean)) action = 'CERTIFIED';
    else if (clean.includes('pending')) action = 'PENDING';

    let dueMonth = '';
    const monthMap: Record<string, string> = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
    const dmM = clean.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})/);
    if (dmM) dueMonth = `${dmM[2]}-${monthMap[dmM[1]]}`;

    let campStatus = '';
    if (clean.includes('in progress')) campStatus = 'In Progress';
    else if (clean.includes('completed')) campStatus = 'Completed';
    else if (clean.includes('closed')) campStatus = 'Closed';
    else if (clean.includes('active')) campStatus = 'Active';

    let aggregate = '';
    if (/which users and roles|users and roles are included|roles are included/.test(clean)) aggregate = 'users-roles';
    else if (/most.*business unit|business units.*most|most users/.test(clean) && /business unit/.test(clean)) aggregate = 'units';
    else if (/most.*location|locations.*most/.test(clean)) aggregate = 'locations';

    const hasRowSignal = username !== '' || role !== '' || roleCode !== '' || manager !== '' ||
      businessUnit !== '' || location !== '' || action !== '' || aggregate !== '' ||
      clean.includes('worksheet') || clean.includes('line item');
    const hasCertRef = certId !== '' || certName !== '';

    // A. Worksheet drill-down / row-level questions
    if (hasRowSignal) {
      const params: any = {};
      if (certId) params.certificationId = certId;
      if (certName) params.certificationName = certName;
      if (username) params.username = username;
      if (role) params.role = role;
      if (roleCode) params.roleCode = roleCode;
      if (manager) params.manager = manager;
      if (businessUnit) params.businessUnit = businessUnit;
      if (location) params.location = location;
      if (action) params.action = action;
      if (aggregate) params.aggregate = aggregate;
      const limM = clean.match(/(?:top|first)\s+(\d{1,2})\b/);
      params.limit = limM ? Math.min(Math.max(parseInt(limM[1], 10), 1), 50) : 25;
      return {
        intent: 'CERTIFIER_WORKSHEET',
        parameters: params,
        explanation: 'Detected request for certifier worksheet line items.'
      };
    }

    // B. Single certification header questions
    const headerAttrs = clean.includes('owner') || clean.includes('owns') || clean.includes('due') ||
      clean.includes('status') || clean.includes('percent') || clean.includes('completion') ||
      clean.includes('type') || clean.includes('creation') || clean.includes('manager') ||
      clean.includes('find') || clean.includes('show');
    if (hasCertRef && (headerAttrs || clean.includes('certification'))) {
      // "Show the certifier worksheet details for certification 35006" stays a worksheet ask
      if (clean.includes('worksheet')) {
        return {
          intent: 'CERTIFIER_WORKSHEET',
          parameters: { ...(certId ? { certificationId: certId } : {}), ...(certName ? { certificationName: certName } : {}), limit: 25 },
          explanation: 'Detected request for a full certifier worksheet.'
        };
      }
      const params: any = {};
      if (certId) params.certificationId = certId;
      if (certName) params.certificationName = certName;
      return {
        intent: 'CERTIFICATION_DETAILS',
        parameters: params,
        explanation: 'Detected request for a specific access certification record.'
      };
    }

    // C. Certification listings
    if (clean.includes('list') || clean.includes('show') || clean.includes('all') || campStatus !== '' || dueMonth !== '') {
      const params: any = {};
      if (campStatus) params.status = campStatus;
      if (dueMonth) params.dueMonth = dueMonth;
      return {
        intent: 'CERTIFICATIONS_LIST',
        parameters: params,
        explanation: 'Detected request to list access certifications.'
      };
    }

    // D. Certification counts overview
    return {
      intent: 'CERTIFICATIONS_OVERVIEW',
      parameters: {},
      explanation: 'Detected request for access certification population counts.'
    };
  }

  // 0. Controls & Incidents conversational intents (live Oracle Fusion data).
  // Placed first so control/incident questions never fall into generic buckets.
  // Role-subject guard: role names like "Access Controls Analyst" contain the
  // substring "control" but are not control questions; role-listing questions
  // ("which roles...", "roles with...") are not incident listings either.
  // (Inline boolean gates only — no new blocks, by design.)
  const isRoleSubjectQuestion = /access controls analyst|who has .*\broles?\b|roles? .* assigned|role hierarchy|which roles|roles with|roles having|roles containing/.test(clean);
  {
    const hasControlWord = !isRoleSubjectQuestion && (clean.includes('control') || clean.includes('controls') || clean.includes('algorithm'));
    const hasIncidentWord = clean.includes('incident') || clean.includes('incidents');
    const stripPunct = (s: string) => s.replace(/[\?\.\!,;:\(\)"']+$/g, '').replace(/^["']+/, '').trim();

    if (hasControlWord || hasIncidentWord) {
      const incidentIdMatch = clean.match(/\b(\d{3,7}:\d+)\b/);
      const cleanNoInc = clean.replace(/\b\d{3,7}:\d+\b/g, ' ');
      const controlNumMatch = cleanNoInc.match(/\b(\d{4,6})\b/);
      const quotedMatch = clean.match(/"([^"]{2,80})"/);

      const extractControlName = (): string => {
        if (quotedMatch && quotedMatch[1]) return stripPunct(quotedMatch[1]);
        const m = cleanNoInc.match(/controls?\s+(?:id\s+|number\s+|#)?([a-z0-9][a-z0-9\s&'\-\.]*)/);
        if (m && m[1]) {
          return stripPunct(m[1].replace(/\s+(details?|incidents?|information|info|status|state|description|enforcement|job|history|control|controls)$/, ''));
        }
        return '';
      };

      const extractUsername = (): string => {
        const email = clean.match(/\b([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})\b/);
        if (email) return email[1];
        const m = clean.match(/(?:\buser\s+|\busername\s+|\bfor\s+|\bby\s+)([a-z0-9_\.\@\-]+)/);
        if (m && m[1]) {
          const stop = new Set(['control', 'controls', 'incident', 'incidents', 'role', 'roles', 'status', 'state', 'for', 'with', 'and', 'the', 'all', 'show', 'list']);
          const tok = stripPunct(m[1]).split(/\s+/)[0] || '';
          if (tok && !stop.has(tok) && (tok.includes('.') || tok.includes('_') || tok.includes('@'))) return tok;
        }
        return '';
      };

      const stripTrailingFilters = (s: string): string => stripPunct(
        s.replace(/\s+(with|and|status|state|priority|high|medium|low|for|in|of|show|list|control|controls|incident|incidents|\?)$/g, '')
      );

      const extractRole = (): string => {
        const m = clean.match(/roles?\s+(?:for\s+|of\s+|with\s+)?([a-zA-Z][a-zA-Z0-9 _&'\-]*)/);
        if (m && m[1]) {
          let v = stripTrailingFilters(m[1]);
          v = v.replace(/^(for|of|with)\s+/i, '').trim();
          if (v && !/^(all|any|assigned|show|list)$/i.test(v)) return v;
        }
        return '';
      };

      const extractAccessPoint = (): string => {
        const m = clean.match(/access\s*points?\s+([a-zA-Z][a-zA-Z0-9 _>\-&'\-]*)/);
        if (m && m[1]) {
          const v = stripTrailingFilters(m[1]);
          if (v) return v;
        }
        return '';
      };

      const extractLifecycleStatus = (): string => {
        const m = clean.match(/status\s+([a-z_\-]+)/);
        const raw = (m && m[1] ? m[1] : clean).toLowerCase();
        if (raw.includes('in-remediation') || raw.includes('in remediation') || raw.includes('remediat')) return 'REMEDIATE';
        if (raw.includes('assign')) return 'ASSIGNED';
        if (raw.includes('accept')) return 'ACCEPTED';
        if (raw.includes('clos') || raw.includes('resolv')) return 'RESOLVED';
        return '';
      };

      const extractState = (): string => {
        const m = clean.match(/state\s+([a-z_]+)/);
        return m && m[1] ? m[1].toUpperCase() : '';
      };

      const extractPriority = (): string => {
        const m = clean.match(/priority\s*(high|medium|low|\d)/);
        if (m && m[1]) return /^\d$/.test(m[1]) ? m[1] : m[1].toUpperCase();
        const b = clean.match(/\b(high|medium|low)[\s\-]*priority\b/);
        return b && b[1] ? b[1].toUpperCase() : '';
      };

      const extractLimit = (): number | undefined => {
        const m = clean.match(/(?:top|first)\s+(\d{1,2})\b/);
        if (m && m[1]) return Math.min(Math.max(parseInt(m[1], 10), 1), 50);
        return undefined;
      };

      // 0a. Single incident details: "details of incident 11067:1"
      if (incidentIdMatch && incidentIdMatch[1]) {
        return {
          intent: 'INCIDENT_DETAILS',
          parameters: { incidentId: incidentIdMatch[1] },
          explanation: `Detected request for incident details "${incidentIdMatch[1]}".`
        };
      }

      // 0b. Incident listing / counting with filters.
      // "Most/highest incidents" without a specific control means rank controls.
      if (!incidentIdMatch && !controlNumMatch && !quotedMatch &&
        /most|highest/.test(clean) && hasControlWord && hasIncidentWord) {
        const lim = extractLimit();
        return {
          intent: 'CONTROLS_LIST',
          parameters: { top: true, limit: lim || 10 },
          explanation: 'Detected request to rank controls by incident count.'
        };
      }
      const userF = extractUsername();
      const roleF = extractRole();
      const apF = extractAccessPoint();
      const statusF = extractLifecycleStatus();
      const stateF = extractState();
      const prioF = extractPriority();
      const wantsIncidents = !isRoleSubjectQuestion && hasIncidentWord && (
        controlNumMatch || quotedMatch || /control\b/.test(clean) ||
        userF || roleF || apF || statusF || stateF || prioF ||
        clean.includes('how many') || clean.includes('count') || clean.includes('number of') ||
        clean.includes('show') || clean.includes('list') || clean.includes('find') || clean.includes('which')
      );
      if (wantsIncidents) {
        const params: any = {};
        const cName = extractControlName();
        if (controlNumMatch && controlNumMatch[1]) {
          // Numeric control ID is authoritative; ignore name fragments.
          params.controlId = controlNumMatch[1];
        } else if (cName && !/^\d{4,6}$/.test(cName)) {
          params.controlName = cName;
        }
        if (userF) params.username = userF;
        if (roleF) params.role = roleF;
        if (apF) params.accessPoint = apF;
        if (statusF) params.status = statusF;
        if (stateF) params.state = stateF;
        if (prioF) params.priority = prioF;
        const lim = extractLimit();
        params.limit = lim || ((clean.includes('how many') || clean.includes('count')) ? 5 : 25);
        return {
          intent: 'INCIDENTS_LIST',
          parameters: params,
          explanation: 'Detected request for Oracle Fusion control incidents with filters.'
        };
      }

      // 0c. Single control details (by id/name, or attribute questions)
      // Skipped for audit-language questions (attribute changes, trails) so
      // they reach the audit vault intent below instead of control details.
      // Generic attribute phrases ("description ...", "status ...") are also
      // not control names — those belong to audit as well.
      const isAuditLanguage = /attribute|changed|modified|\baudit\b|history|old value|new value|who\s+(last\s+)?updated|updated\s+by/.test(clean);
      const detailVerbs = clean.includes('detail') || clean.includes('description') || clean.includes('enforcement') ||
        clean.includes('last run') || clean.includes('last updated') || clean.includes('created') ||
        clean.includes('scheduled') || clean.includes('job') || clean.includes('who') ||
        clean.includes('show') || clean.includes('find') || clean.includes('tell me') || clean.includes('what is');
      const cNameOnly = extractControlName();
      const genericAttrName = !!cNameOnly && /^(description|status|priority|attributes?|name|job|enforcement|control description)\b/i.test(cNameOnly);
      if (!isAuditLanguage && !genericAttrName && ((controlNumMatch && controlNumMatch[1]) || (quotedMatch && quotedMatch[1]) || (hasControlWord && (detailVerbs || cNameOnly)))) {
        const params: any = {};
        if (controlNumMatch && controlNumMatch[1]) {
          // Numeric control ID is authoritative; ignore name fragments.
          params.controlId = controlNumMatch[1];
        } else if (cNameOnly && !/^\d{4,6}$/.test(cNameOnly)) {
          params.controlName = cNameOnly;
        } else if (quotedMatch && quotedMatch[1]) {
          params.controlName = stripPunct(quotedMatch[1]);
        }
        if (!params.controlId && !params.controlName) {
          // Fall through to list/overview below
        } else {
          return {
            intent: 'CONTROL_DETAILS',
            parameters: params,
            explanation: 'Detected request for a specific Oracle Fusion control record.'
          };
        }
      }

      // 0d. Control listing (active/inactive, access/transaction, top, search)
      // Skipped for audit-language questions for the same reason as 0c above.
      const listVerbs = clean.includes('list') || clean.includes('show') || clean.includes('find') ||
        clean.includes('active') || clean.includes('inactive') || clean.includes('most') ||
        clean.includes('highest') || clean.includes('top') || clean.includes('which');
      if (!isAuditLanguage && hasControlWord && (listVerbs || controlNumMatch)) {
        const params: any = {};
        if (clean.includes('inactive')) params.status = 'INACTIVE';
        else if (clean.includes('active')) params.status = 'ACTIVE';
        if (clean.includes('transaction')) params.type = 'TRANSACTION';
        else if (/\baccess\b/.test(clean)) params.type = 'ACCESS';
        if (clean.includes('most') || clean.includes('highest') || clean.includes('top')) params.top = true;
        const lim = extractLimit();
        params.limit = lim || 25;
        const sName = extractControlName();
        if (sName && !/^\d{4,6}$/.test(sName) && !clean.includes('active') && !clean.includes('inactive')) params.search = sName;
        return {
          intent: 'CONTROLS_LIST',
          parameters: params,
          explanation: 'Detected request to list Oracle Fusion Advanced Controls with filters.'
        };
      }

      // 0e. Control counts overview ("how many access/transaction controls")
      if (!isAuditLanguage && hasControlWord && (clean.includes('how many') || clean.includes('count') || clean.includes('number of') || clean.includes('total'))) {
        return {
          intent: 'CONTROLS_OVERVIEW',
          parameters: {},
          explanation: 'Detected request for Advanced Controls population counts.'
        };
      }
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

  // 1b. Advanced Controls & Control Incidents (skipped for audit-language
  // questions so attribute/trail queries reach the audit vault intent)
  const isAuditLanguage = /attribute|changed|modified|\baudit\b|history|old value|new value|who\s+(last\s+)?updated|updated\s+by/.test(clean);
  if (
    !isAuditLanguage && (
    clean.includes('hsdl') ||
    clean.includes('spreadsheets templates') ||
    clean.includes('4096') ||
    clean.includes('4078') ||
    clean.includes('114281') ||
    clean.includes('114269') ||
    clean.includes('114313') ||
    (clean.includes('control') && (clean.includes('detail') || clean.includes('incident') || clean.includes('show') || clean.includes('find') || clean.includes('what is') || clean.includes('tell me about') || clean.includes('under'))) ||
    ((clean.includes('incident') || clean.includes('incidents')) && (clean.includes('for') || clean.includes('of') || clean.includes('in') || clean.includes('under') || clean.includes('show') || clean.includes('list') || clean.includes('how many')))
  )) {
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

  // 2. Risk & SoD (skipped for audit-language questions so vault queries win)
  if (
    !isAuditLanguage && (
    clean.includes('risk') ||
    clean.includes('sod') ||
    clean.includes('segregation of duties') ||
    clean.includes('conflict') ||
    clean.includes('incident') ||
    clean.includes('certification')
  )) {
    return {
      intent: 'RISK_INFORMATION',
      parameters: {},
      explanation: 'Detected request for GRC risk, incidents, or segregation of duties information.'
    };
  }

  // 3. Audit History (upgraded vault: 9-column attribute-level schema, 2025-present)
  const hasEmail = /\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b/.test(clean);
  const hasAuditActionWords = /performed by|actions|activity|made|changes/.test(clean);
  if (
    clean.includes('audit') ||
    clean.includes('history') ||
    clean.includes('who modified') ||
    clean.includes('who changed') ||
    clean.includes('yesterday') ||
    clean.includes('audit trail') ||
    clean.includes('modified') ||
    clean.includes('updat') ||
    /\bchang(e|es|ed|ing)?\b/.test(clean) ||
    clean.includes('attribute') ||
    clean.includes('old value') ||
    clean.includes('new value') ||
    clean.includes('insert') ||
    clean.includes('delet') ||
    (hasEmail && hasAuditActionWords && !/\broles?\b/.test(clean))
  ) {
    // User ID (internal username/email) is strictly separate from display name.
    let username = '';
    let userId = '';
    const emailM = clean.match(/\b([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})\b/);
    if (emailM && emailM[1]) {
      userId = emailM[1];
    } else {
      const userMatch = clean.match(/(?:for\s+user|by\s+user|user|username)\s+['"]?([a-zA-Z0-9_\.@\-]+)/i);
      if (userMatch && userMatch[1]) {
        username = userMatch[1].toUpperCase();
      } else if (context && context.entityType === 'USER' && context.entityId) {
        username = context.entityId.toUpperCase();
      }
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
    } else if (clean.includes('racm') || clean.includes('risks and controls') || clean.includes('risk management')) {
      detectedProduct = 'Risks and Controls';
    } else if (clean.includes('general ledger') || /\bgl\b/.test(clean)) {
      detectedProduct = 'General Ledger';
    } else if (clean.includes('payables') || /\bap\b/.test(clean)) {
      detectedProduct = 'Payables';
    } else if (clean.includes('receivables') || /\bar\b/.test(clean)) {
      detectedProduct = 'Receivables';
    } else if (clean.includes('inventory')) {
      detectedProduct = 'Inventory Management';
    } else if (/control\s+(\d{3,7}|'[^']+'|"[^"]+")/.test(clean)) {
      // Control-entity audit questions default to the RACM product catalog.
      detectedProduct = 'Risks and Controls';
      detectedBO = 'Advanced Controls';
    } else if (clean.includes('advanced controls') || clean.includes('access controls')) {
      detectedProduct = 'Risks and Controls';
    } else if (/control|investigator/.test(clean)) {
      // Control-flavored attribute questions default to the RACM catalog.
      detectedProduct = 'Risks and Controls';
      detectedBO = 'Advanced Controls';
    } else if (/product|module|oracle|fusion|ledger|payable|receiv|inventory|risk|human|resource|audit|opss|hcm/.test(clean)) {
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
    }

    // Known business-object aliases when the catalog loop misses them
    if (detectedProduct && !detectedBO) {
      const boAliases: Record<string, string[]> = {
        'Risks and Controls': ['advanced controls', 'access controls', 'models', 'controls'],
        'General Ledger': ['period details', 'journal batch', 'journal', 'ledger'],
        'Payables': ['invoice', 'invoices'],
        'Receivables': ['receipts', 'transactions'],
        'Global Human Resources': ['document records', 'person']
      };
      const aliases = boAliases[detectedProduct] || [];
      for (const a of aliases) {
        if (clean.includes(a)) {
          detectedBO = a.replace(/\b\w/g, c => c.toUpperCase());
          break;
        }
      }
    }

    // Action synonyms -> canonical event families. Both insert- and delete-side
    // words together means no action narrowing (return everything).
    let detectedAction: string | undefined = undefined;
    const hasInsert = clean.includes('insert') || clean.includes('creat');
    const hasDelete = clean.includes('delet') || clean.includes('remov') || clean.includes('revok');
    const hasUpdate = clean.includes('updat') || clean.includes('modif') || clean.includes('chang');
    if ((hasInsert ? 1 : 0) + (hasDelete ? 1 : 0) + (hasUpdate ? 1 : 0) === 1) {
      if (hasInsert) detectedAction = 'INSERT';
      else if (hasDelete) detectedAction = 'DELETE';
      else detectedAction = 'UPDATE';
    }

    // Attribute-level filters: explicit "attribute X" or known attribute phrases
    const attrHits: string[] = [];
    const attrM = clean.match(/attributes?\s+(?:of\s+)?([a-z][a-z ]+)/);
    if (attrM && attrM[1]) {
      let v = attrM[1].trim().split(/\s+/).slice(0, 4).join(' ');
      v = v.replace(/^(of|the|control|controls)\b\s*/i, '').trim();
      v = v.replace(/\s+(were|was|that|which|made|to|recently|for)$/i, '').trim();
      if (v && !/^\d/.test(v) && !/\b(all|were|was|that|which|made|recently|changes?|control|controls|of|the|to)\b/i.test(v)) attrHits.push(v);
    }
    for (const known of ['result investigator', 'control description', 'status', 'priority', 'name']) {
      if (clean.includes(known) && !attrHits.some(h => h.includes(known) || known.includes(h))) attrHits.push(known);
    }
    // "status or priority" style questions: keep both sides of the 'or'
    const orAttrM = clean.match(/(status|priority|name)\s+or\s+(status|priority|name)/);
    if (orAttrM) {
      for (const side of [orAttrM[1], orAttrM[2]]) {
        if (!attrHits.includes(side)) attrHits.push(side);
      }
    }
    const detectedAttribute = attrHits.length > 0 ? [...new Set(attrHits)].join('|') : undefined;

    // New-value assertions: "Status was changed to ACTIVE"
    let detectedNewValue: string | undefined = undefined;
    const nvM = clean.match(/(?:changed|updated|set)\s+to\s+([A-Za-z0-9_]+)/);
    if (nvM && nvM[1] && !/^(active|inactive)$/i.test(nvM[1])) {
      detectedNewValue = nvM[1];
    } else if (nvM && nvM[1]) {
      detectedNewValue = nvM[1].toUpperCase();
    }

    // Entity scoping: control IDs, quoted names (non-user tokens only — a
    // quoted username/email belongs to the user filter, not the entity).
    let detectedEntity: string | undefined = undefined;
    const ctrlIdM = clean.match(/control\s+(\d{3,7})\b/);
    const quotedM = clean.match(/"([^"]{2,80})"/) || clean.match(/'([^']{2,80})'/);
    if (ctrlIdM && ctrlIdM[1]) detectedEntity = ctrlIdM[1];
    else if (quotedM && quotedM[1] && !/^(active|inactive)$/i.test(quotedM[1])) {
      const tok = quotedM[1].trim();
      const looksLikeUser = tok.includes('@') || (/^[a-z0-9._\-]+$/i.test(tok) && tok.includes('.'));
      if (!looksLikeUser) detectedEntity = tok;
    }

    // Date handling: year comparison, single year, explicit range, this week, recent
    let yearCompare = false;
    let fromDate: string | undefined = undefined;
    let toDate: string | undefined = undefined;
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (/2025\s+vs\.?\s+2026|2026\s+vs\.?\s+2025|compare.*2025.*2026/.test(clean)) {
      yearCompare = true;
    } else {
      const isoM = clean.match(/from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2}|now|today|present)/);
      if (isoM) {
        fromDate = isoM[1];
        toDate = /^\d{4}-\d{2}-\d{2}$/.test(isoM[2]) ? isoM[2] : fmt(new Date());
      } else {
        const txtM = clean.match(/from\s+(.+?)\s+to\s+(now|today|present)/);
        if (txtM) {
          const f = new Date(txtM[1].trim());
          if (!isNaN(f.getTime())) {
            fromDate = fmt(f);
            toDate = fmt(new Date());
          }
        }
      }
      if (!fromDate) {
        const yearM = clean.match(/\b(20\d{2})\b/);
        if (yearM && yearM[1] && !clean.includes('audit trail')) {
          fromDate = `${yearM[1]}-01-01`;
          toDate = `${yearM[1]}-12-31`;
        } else {
          const monthM = clean.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})/);
          if (monthM) {
            const mi = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf(monthM[1]) + 1;
            const lastDay = new Date(Number(monthM[2]), mi, 0).getDate();
            fromDate = `${monthM[2]}-${String(mi).padStart(2, '0')}-01`;
            toDate = `${monthM[2]}-${String(mi).padStart(2, '0')}-${lastDay}`;
          } else if (clean.includes('this week')) {
            const now = new Date();
            const monday = new Date(now);
            monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
            fromDate = fmt(monday);
            toDate = fmt(now);
          } else if (clean.includes('recent') || clean.includes('recently') || clean.includes('latest')) {
            const d = new Date();
            d.setDate(d.getDate() - 30);
            fromDate = fmt(d);
          }
        }
      }
    }

    return {
      intent: 'AUDIT_HISTORY',
      parameters: {
        ...(detectedProduct ? { product: detectedProduct } : {}),
        ...(detectedBO ? { businessObjectType: detectedBO } : {}),
        ...(username ? { username } : {}),
        ...(userId ? { userId } : {}),
        ...(detectedAction ? { action: detectedAction } : {}),
        ...(detectedAttribute ? { attribute: detectedAttribute } : {}),
        ...(detectedEntity ? { entity: detectedEntity } : {}),
        ...(detectedNewValue ? { newValue: detectedNewValue } : {}),
        ...(yearCompare ? { yearCompare: true } : {}),
        ...(fromDate ? { fromDate } : {}),
        ...(toDate ? { toDate } : {})
      },
      explanation: `Detected audit search${detectedProduct ? ` for product "${detectedProduct}"` : ''}${detectedBO ? ` and business object "${detectedBO}"` : ''}${username ? ` filtered by user "${username}"` : ''}${userId ? ` filtered by user ID "${userId}"` : ''}.`
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

  // 7. Users by Role (Who has role X / Users with role X / Users containing both role X and Y)
  if (
    (clean.includes('who has') && clean.includes('role')) ||
    (clean.includes('users') && (clean.includes('role') || clean.includes('roles')) && !clean.includes('no role') && !clean.includes('without role'))
  ) {
    const detectedRoles: string[] = [];
    if (clean.includes('ap manager') || clean.includes('accounts payable manager') || clean.includes('payables')) detectedRoles.push('AP Manager');
    if (clean.includes('it security') || clean.includes('security administrator') || clean.includes('security manager')) detectedRoles.push('IT Security Manager');
    if (clean.includes('payroll')) detectedRoles.push('Payroll Administrator');
    if (clean.includes('employee')) detectedRoles.push('Employee');
    if (clean.includes('controls analyst') || clean.includes('advanced access controls')) detectedRoles.push('Advanced Access Controls Analyst');

    const quotedRoles = clean.match(/["']([^"']+)["']/g);
    if (quotedRoles) {
      for (const qr of quotedRoles) {
        const val = qr.replace(/["']/g, '').trim();
        if (val && !detectedRoles.includes(val)) detectedRoles.push(val);
      }
    }

    const uniqueRoles = [...new Set(detectedRoles)];
    if (uniqueRoles.length > 1) {
      return {
        intent: 'USERS_BY_ROLE',
        parameters: { roles: uniqueRoles, matchMode: 'AND' },
        explanation: `Extracting users assigned to all specified roles: ${uniqueRoles.join(' and ')}.`
      };
    } else if (uniqueRoles.length === 1) {
      return {
        intent: 'USERS_BY_ROLE',
        parameters: { roleName: uniqueRoles[0] },
        explanation: `Extracting users assigned to the "${uniqueRoles[0]}" role.`
      };
    }

    let roleName = context && context.entityType === 'ROLE' && context.entityName ? context.entityName : 'Advanced Access Controls Analyst';
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
      if (data?.yearCompare) {
        return `Audit events for **${data.product || 'Oracle Fusion'}**: **${data.y2025.total.toLocaleString()}** in 2025 vs **${data.y2026.total.toLocaleString()}** in ${new Date().getFullYear()} (${data.y2026.dataSource}).`;
      }
      const logs = data?.logs || (Array.isArray(data) ? data : []);
      const pName = data?.productDisplayName || parameters.product || 'Oracle Fusion';
      const boName = data?.businessObjectDisplayName || parameters.businessObjectType;
      const whoFilter = parameters.username || parameters.userId || '';
      const extraFilters = [
        parameters.attribute ? `attribute "${parameters.attribute}"` : '',
        parameters.entity ? `entity "${parameters.entity}"` : '',
        parameters.newValue ? `new value "${parameters.newValue}"` : ''
      ].filter(Boolean).join(', ');
      const range = data?.dateRange ? ` (${data.dateRange.fromDate} to ${data.dateRange.toDate})` : '';
      if (!logs || logs.length === 0) {
        const total = data?.authoritativeTotal || 0;
        const scopedNote = total > 0 ? ` (${total} record(s) are in scope but were excluded by the active filters)` : ` (${total} record(s) in scope)`;
        return `No audit records matched **${pName}**${boName ? ` (${boName})` : ''}${whoFilter ? ` for "${whoFilter}"` : ''}${extraFilters ? ` with ${extraFilters}` : ''}${range} in ${toolResult.dataSource}${scopedNote}. Try expanding the date range, checking the username spelling, or asking across all products.`;
      }
      const total = data?.authoritativeTotal ?? data?.totalMatching ?? logs.length;
      return `Retrieved **${logs.length}** audit change record(s) (of **${Number(total).toLocaleString()}** matching) from **${toolResult.dataSource}** for **${pName}**${boName ? ` (${boName})` : ''}${whoFilter ? ` filtered by "${whoFilter}"` : ''}${extraFilters ? ` with ${extraFilters}` : ''}${range}.`;
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

    case 'CONTROLS_OVERVIEW': {
      return `Oracle Fusion Advanced Controls population (${toolResult.dataSource}):
* **Access Controls:** ${data.accessControls.toLocaleString()}
* **Transaction Controls:** ${data.transactionControls.toLocaleString()}
* **Active:** ${data.activeControls.toLocaleString()} · **Inactive:** ${data.inactiveControls.toLocaleString()}
* **Total incidents across ${data.totalControls.toLocaleString()} controls:** ${data.totalIncidents.toLocaleString()}`;
    }

    case 'CONTROLS_LIST': {
      if (data.totalMatching === 0) {
        return `No controls matched the requested filters in ${toolResult.dataSource}. Try broadening the status, type, or search term.`;
      }
      return `Found **${data.totalMatching.toLocaleString()}** matching control(s) out of **${data.totalControls.toLocaleString()}** in ${toolResult.dataSource}. Showing ${data.returned} below.`;
    }

    case 'CONTROL_DETAILS': {
      if (data?.notFound) {
        return data.message || `Control "${parameters.controlId || parameters.controlName || 'requested'}" was not found in ${toolResult.dataSource}.`;
      }
      const c = data.control;
      return `**${c.name}** (\`${c.control}\`)
* Type: **${c.type}** · Status: **${c.status}** · State: **${c.state}**
* Incidents: **${(data.incidentCount || 0).toLocaleString()}**
${c.description ? `* Description: ${c.description}\n` : ''}${c.enforcement ? `* Enforcement: ${c.enforcement}\n` : ''}* Last run: **${c.lastRun || '—'}** · Last updated: **${c.lastUpdated || '—'}**
* Created by **${c.createdBy || '—'}**${c.creationDate ? ` on ${c.creationDate}` : ''} · Scheduled by **${c.scheduledBy || '—'}**`;
    }

    case 'INCIDENTS_LIST': {
      if (data?.notFound) {
        return data.message || `No incidents could be retrieved for the requested scope in ${toolResult.dataSource}.`;
      }
      if (data.totalMatching === 0) {
        return `No incidents matched the requested filters for **${data.scopeLabel}** in ${toolResult.dataSource}.`;
      }
      const extra = data.priorityNote ? `\n*Note: ${data.priorityNote}*` : '';
      return `**${data.totalMatching.toLocaleString()}** matching incident(s) for **${data.scopeLabel}** (authoritative total: ${data.authoritativeTotal.toLocaleString()}). Showing page ${data.page} (${data.returned} rows).${extra}`;
    }

    case 'INCIDENT_DETAILS': {
      if (data?.notFound) {
        return data.message || `Incident "${parameters.incidentId || 'requested'}" was not found in ${toolResult.dataSource}.`;
      }
      const i = data.incident;
      return `**Incident ${i.incident}** — ${i.controlName || i.control}
* User: **${i.user || '—'}** · Role: **${i.role || '—'}** · Priority: **${i.priority ?? '—'}**
* Status: **${i.status || '—'}** · State: **${i.state || '—'}**
${i.info ? `* Violation: ${i.info}\n` : ''}${i.conflictingRoles ? `* Conflicting roles: ${i.conflictingRoles}\n` : ''}* Created: ${i.created || '—'}${i.closed ? ` · Closed: ${i.closed}` : ''}`;
    }

    case 'CERTIFICATIONS_OVERVIEW': {
      const parts = Object.entries(data.byStatus || {}).map(([s, n]) => `${s}: ${n}`);
      return `Oracle Fusion access certifications (${toolResult.dataSource}):
* **Total:** ${data.total}
* By status — ${parts.length > 0 ? parts.join(' · ') : 'no status data'}
* Due in October 2026: **${data.dueOct2026}**${data.avgComplete !== null && data.avgComplete !== undefined ? `\n* Average completion: **${data.avgComplete}%**` : ''}`;
    }

    case 'CERTIFICATIONS_LIST': {
      if (data.totalMatching === 0) {
        return `No access certifications matched the requested filters in ${toolResult.dataSource}.`;
      }
      return `Found **${data.totalMatching}** certification(s) out of **${data.total}** in ${toolResult.dataSource}.`;
    }

    case 'CERTIFICATION_DETAILS': {
      if (data?.notFound) return data.message;
      if (data?.ambiguous) {
        return `${data.message} ${data.matches.map((m: any) => `**${m.name}** (\`${m.certificate}\`)`).join(', ')}.`;
      }
      const c = data.certification;
      return `**${c.name}** (\`${c.certificate}\`)
* Type: **${c.type || '—'}** · Status: **${c.status || '—'}** · Completion: **${c.complete !== null && c.complete !== undefined ? `${c.complete}%` : '—'}**
* Due: **${c.due || '—'}** · Created: **${c.created || '—'}**
* Owner: **${c.owner || '—'}** · Manager: **${c.manager || '—'}**`;
    }

    case 'CERTIFIER_WORKSHEET': {
      if (data?.notFound) return data.message;
      if (data?.ambiguous) {
        return `${data.message} ${data.matches.map((m: any) => `**${m.name}** (\`${m.certificate}\`)`).join(', ')}.`;
      }
      if (data.totalMatching === 0) {
        return `No worksheet lines matched the requested filters for **${data.scopeLabel}** in ${toolResult.dataSource}.`;
      }
      let extra = '';
      if (data.userCount !== undefined) {
        extra += `\n* Distinct users: **${data.userCount}** · Distinct roles: **${data.roleCount}**`;
      }
      if (Array.isArray(data.ranking) && data.ranking.length > 0) {
        const top = data.ranking.slice(0, 3).map((r: any) => `${r.name} (${r.count})`).join(', ');
        extra += `\n* Top rows: ${top}`;
      }
      const certs = (data.certificationsQueried || []).map((c: any) => `\`${c.certificate}\``).join(', ');
      return `**${data.totalMatching.toLocaleString()}** matching worksheet line(s) across ${data.certificationsQueried?.length || 0} certification(s) (${certs}) out of **${(data.totalRows || 0).toLocaleString()}** total lines. Showing ${data.returned}.${extra}`;
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
  "intent": "LIST_USERS" | "GET_USER" | "LIST_ROLES" | "GET_ROLE" | "USERS_BY_ROLE" | "ROLES_BY_USER" | "ROLE_SEARCH" | "ROLE_DETAILS" | "ROLE_HIERARCHY" | "ROLE_PRIVILEGES" | "ROLES_BY_PRIVILEGE" | "USER_ACCESS" | "AUDIT_HISTORY" | "SECURITY_STATISTICS" | "RISK_INFORMATION" | "ACCESS_REQUESTS" | "ADVANCED_CONTROLS" | "CONTROLS_OVERVIEW" | "CONTROLS_LIST" | "CONTROL_DETAILS" | "INCIDENTS_LIST" | "INCIDENT_DETAILS" | "CERTIFICATIONS_OVERVIEW" | "CERTIFICATIONS_LIST" | "CERTIFICATION_DETAILS" | "CERTIFIER_WORKSHEET" | "UNKNOWN",
  "parameters": {
    "roles": "Array of role names if multiple roles specified, e.g. ['IT Security Manager', 'AP Manager'] (array of strings, optional)",
    "roleName": "Extracted role display name or code (string, optional)",
    "matchMode": "'AND' if users must have all/both roles, or 'OR' (string, optional)",
    "privilegeName": "Extracted privilege name for reverse lookup (e.g. 'Maintain Supplier Contact', 'Create Purchase Order') (string, optional)",
    "userId": "Extracted user identifier like JSMITH or HCM_IMPL (string, optional)",
    "username": "Extracted audit username (string, optional)",
    "keyword": "Keyword for search (string, optional)",
    "action": "Audit action: CREATE, UPDATE, DELETE, etc. (string, optional)",
    "attribute": "Audit attribute filter, '|' separated for several (e.g. 'Status|Priority') (string, optional)",
    "entity": "Audit entity scope: control ID or quoted name (string, optional)",
    "newValue": "Required new/changed-to value filter (string, optional)",
    "yearCompare": "true for 2025-vs-current-year totals comparison (boolean, optional)",
    "fromDate": "Audit range start YYYY-MM-DD (string, optional)",
    "toDate": "Audit range end YYYY-MM-DD (string, optional)",
    "privilegeOrAccess": "Function name / privilege check: invoice creation, Accounts Payable (string, optional)",
    "filterType": "For LIST_USERS, extract: 'MULTIPLE_ROLES' (if query asks for users with multiple/more than one role), 'NO_ROLES' (if users without roles), 'ADMIN_ROLES' (if security admins), 'HIGH_RISK' (if high-risk access), or 'NONE' (string, optional)",
    "roleCategory": "When query asks for specific role type assigned to a user (e.g. 'Duty Roles', 'Abstract Roles', 'Job Roles', 'Data Roles'), extract: 'DUTY', 'ABSTRACT', 'JOB', 'DATA', or omit/'ALL' for general role queries (string, optional)",
    "controlName": "Extracted control name or rule number like '4096: Manage HSDL...' or '4096' or 'Manage HSDL' (string, optional)",
    "controlId": "Extracted numerical control ID like '114281' (string, optional)",
    "incidentId": "Incident ID like '11067:1' (string, optional)",
    "role": "Role name for incident filtering (string, optional)",
    "accessPoint": "Access point name for incident filtering (string, optional)",
    "status": "Lifecycle filter: ASSIGNED, ACCEPTED, REMEDIATE, RESOLVED, ACTIVE, or INACTIVE (string, optional)",
    "state": "Incident state like IN_INVESTIGATION (string, optional)",
    "priority": "HIGH, MEDIUM, LOW, or numeric (string, optional)",
    "type": "Control type filter: ACCESS or TRANSACTION (string, optional)",
    "top": "true when asking for highest/most incidents (boolean, optional)",
    "limit": "Max rows for listings, 1-50 (number, optional)",
    "page": "Page number for incident listings (number, optional)",
    "search": "Free-text control search (string, optional)",
    "certificationId": "Access certification ID like '35006' (string, optional)",
    "certificationName": "Access certification name (string, optional)",
    "roleCode": "Oracle role code like 'ORA_AP_...' (string, optional)",
    "manager": "Manager name for worksheet filtering (string, optional)",
    "businessUnit": "Business unit for worksheet filtering (string, optional)",
    "location": "Location for worksheet filtering (string, optional)",
    "action": "Worksheet action: APPROVED, CERTIFIED, REVOKED, PENDING, KEEP, REMOVE (string, optional)",
    "dueMonth": "Certification due month YYYY-MM (string, optional)",
    "aggregate": "users-roles, units, or locations rollups (string, optional)"
  },
  "explanation": "Brief rationale for this mapping"
}

Intent definitions:
- LIST_USERS: List or show all users.
- GET_USER: Details about a specific user by username/id (e.g. "Who is John Smith" or "who is JSMITH").
- LIST_ROLES: Display all roles in the environment.
- GET_ROLE / ROLE_DETAILS: Search details of a specific role by name.
- USERS_BY_ROLE: Find who has specific role(s) (e.g. "Who has the Advanced Access Controls Analyst role?", "Which users have both IT Security Manager and Accounts Payable Manager?", "users containing two roles X and Y"). Use "roles": ["Role 1", "Role 2"] with "matchMode": "AND" for multiple roles.
- ROLES_BY_USER: Show what roles are assigned to a specific user (e.g. "which roles are assigned to JSMITH?").
- ROLE_SEARCH: Find roles matching keywords (e.g. "find roles containing Manager").
- ROLE_HIERARCHY: Show role children, parent, and hierarchy.
- ROLE_PRIVILEGES: Show privileges assigned to a role.
- ROLES_BY_PRIVILEGE: Find which roles grant or have a specific privilege (e.g. "Which roles have privilege Maintain Supplier Contact?", "Can you give me the roles which have privilege Create Purchase Order?").
- USER_ACCESS: Find who can perform an action / has privilege (e.g. "Who has payroll access?", "Who can create invoices?").
 - AUDIT_HISTORY: Show audit trail across products and years — who changed what, attribute old/new values, inserts/deletes (e.g. "Who modified this role?", "Show recent audit activity for Advanced Controls", "Which attributes of control 31004 were modified?", "Show all inserts this week").
- SECURITY_STATISTICS: Count of users, roles, statistics, dashboard cards.
- RISK_INFORMATION: Incidents, Access certifications, Segregation of Duties conflicts.
- ACCESS_REQUESTS: Advanced access requests list and approvals.
- ADVANCED_CONTROLS: Show advanced controls catalog, control details, or control violation incidents (e.g. "Show me details of 4096: Manage HSDL Spreadsheets Templates and Load Data using HSDL", "Show incidents for Manage HSDL Spreadsheets...", "Show incidents for 4096", "Show details of control 114281").
- CONTROLS_OVERVIEW: Control population counts (e.g. "How many access controls and transaction controls are available?").
- CONTROLS_LIST: Filtered control listings — active/inactive, access/transaction, most incidents, search (e.g. "Show all active controls", "Which controls have the most incidents?").
- CONTROL_DETAILS: Full record of one control by id or name — description, enforcement, last run/update, created/updated by (e.g. "Find control 11065", "When was control 11065 last run?").
- INCIDENTS_LIST: Filtered incident listings — by control, user, role, access point, status, state, priority (e.g. "Show incidents for control 11065", "How many incidents does control 11065 have?", "Show incidents for user X", "Show incidents with status ASSIGNED", "Show high priority incidents").
- INCIDENT_DETAILS: Full record of one incident by id like "11067:1" (e.g. "Show details of incident 11067:1", "Explain the conflicting roles in incident 11067:1").
- CERTIFICATIONS_OVERVIEW: Access certification population counts and statuses (e.g. "How many access certifications are currently active?").
- CERTIFICATIONS_LIST: Filtered certification listings — status, due month, search (e.g. "List all access certifications and their due dates", "Which certifications have a due date in October 2026?").
- CERTIFICATION_DETAILS: One certification header by id or name — owner, manager, due, status, completion (e.g. "Find certification with ID 35006", "Who owns the certification 'CLAAPS_Access_Certification1'?").
- CERTIFIER_WORKSHEET: Worksheet line items filtered by certification, user, role, manager, business unit, location, action — plus users/roles/BU/location rollups (e.g. "Show the certifier worksheet details for certification 35006", "Show all roles being certified for user 'Karthika.Claaps'", "Are there any users whose role access was revoked?").
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
      // Only fuzzy-match the catalog when the question actually names
      // something product-like; otherwise resolveProduct() latches onto
      // substrings (e.g. "AI" inside "Sai.claaps") and poisons the query.
      if (!intentData.parameters.product && /product|module|oracle|fusion|ledger|payable|receiv|inventory|risk|human|resource|audit|opss|hcm/.test(clean)) {
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
      const roleName = 
        data?.roleName || 
        (Array.isArray(parameters?.roles) && parameters.roles.length > 0
          ? parameters.roles.join(parameters.matchMode === 'OR' ? ' OR ' : ' AND ')
          : parameters?.roleName) || 
        'Role';
      const isMulti = (Array.isArray(data?.roles) && data.roles.length > 1) || (Array.isArray(parameters?.roles) && parameters.roles.length > 1);
      title = isMulti ? `Assigned Members: ${roleName}` : `Assigned Members: ${roleName}`;
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

    case 'CONTROLS_OVERVIEW': {
      title = 'Advanced Controls Overview';
      table = {
        type: 'general',
        columns: ['Metric', 'Value'],
        rows: [
          { id: 'm1', attribute: 'Access Controls', value: String(data.accessControls) },
          { id: 'm2', attribute: 'Transaction Controls', value: String(data.transactionControls) },
          { id: 'm3', attribute: 'Active Controls', value: String(data.activeControls) },
          { id: 'm4', attribute: 'Inactive Controls', value: String(data.inactiveControls) },
          { id: 'm5', attribute: 'Total Controls', value: String(data.totalControls) },
          { id: 'm6', attribute: 'Total Incidents', value: Number(data.totalIncidents).toLocaleString() }
        ]
      };
      totalCount = 6;
      matchingCount = 6;
      actions = [
        { label: 'Open Controls Catalog', actionType: 'NAVIGATE', params: { page: 'risk' } }
      ];
      break;
    }

    case 'CONTROLS_LIST': {
      title = `Controls (${(data.totalMatching || 0).toLocaleString()} matching)`;
      const cList = Array.isArray(data?.controls) ? data.controls : [];
      totalCount = data?.totalControls ?? cList.length;
      matchingCount = data?.totalMatching ?? cList.length;
      table = {
        type: 'controls',
        columns: ['Control', 'Name', 'Type', 'Status', 'State', 'Incidents'],
        rows: cList.map((c: any) => ({
          id: c.control,
          control: c.control,
          name: c.name,
          type: c.type,
          status: c.status,
          state: c.state,
          incidents: (c.incidents || 0).toLocaleString()
        }))
      };
      actions = [
        { label: 'Open Controls Catalog', actionType: 'NAVIGATE', params: { page: 'risk' } }
      ];
      break;
    }

    case 'CONTROL_DETAILS': {
      if (data?.notFound) {
        title = 'Control Not Found';
        break;
      }
      const c = data.control;
      title = `Control: ${c.name}`;
      const attrRows: any[] = [
        ['Control ID', c.control], ['Control Name', c.name], ['Type', c.type],
        ['Status', c.status], ['State', c.state],
        ['Total Incidents', Number(data.incidentCount || 0).toLocaleString()],
        ['Description', c.description || '—'], ['Enforcement Type', c.enforcement || '—'],
        ['Last Run', c.lastRun || '—'], ['Last Updated', c.lastUpdated || '—'],
        ['Latest Job ID', c.latestJob !== null && c.latestJob !== undefined ? String(c.latestJob) : '—'],
        ['Created By', c.createdBy || '—'], ['Creation Date', c.creationDate || '—'],
        ['Last Updated By', c.lastUpdatedBy || '—'], ['Scheduled By', c.scheduledBy || '—']
      ];
      table = {
        type: 'general',
        columns: ['Attribute', 'Value'],
        rows: attrRows.map(([attribute, value], i) => ({ id: `a${i}`, attribute, value }))
      };
      totalCount = attrRows.length;
      matchingCount = attrRows.length;
      actions = [
        { label: 'Open Controls Catalog', actionType: 'NAVIGATE', params: { page: 'risk' } }
      ];
      break;
    }

    case 'INCIDENTS_LIST': {
      title = `Incidents — ${data.scopeLabel || 'requested scope'} (${(data.totalMatching || 0).toLocaleString()} matching)`;
      const iList = Array.isArray(data?.incidents) ? data.incidents : [];
      totalCount = data?.authoritativeTotal ?? data?.totalMatching ?? iList.length;
      matchingCount = data?.totalMatching ?? iList.length;
      table = {
        type: 'control_incidents',
        columns: ['Incident', 'Control', 'User', 'Role', 'AccessPoint', 'Status', 'State', 'Priority'],
        rows: iList.map((inc: any) => ({
          id: inc.incident,
          incident: inc.incident,
          control: inc.control,
          user: inc.user || '—',
          role: inc.role || '—',
          accesspoint: inc.accessPoint || '—',
          status: inc.status || '—',
          state: inc.state || '—',
          priority: inc.priority !== null && inc.priority !== undefined ? String(inc.priority) : '—'
        }))
      };
      actions = [
        { label: 'Open Incidents Report', actionType: 'NAVIGATE', params: { page: 'reports' } }
      ];
      break;
    }

    case 'INCIDENT_DETAILS': {
      if (data?.notFound) {
        title = 'Incident Not Found';
        break;
      }
      const i = data.incident;
      title = `Incident: ${i.incident}`;
      const iRows: any[] = [
        ['Incident ID', i.incident], ['Control ID', i.control], ['Control Name', i.controlName || '—'],
        ['Priority', i.priority !== null && i.priority !== undefined ? String(i.priority) : '—'],
        ['User', i.user || '—'], ['User ID', i.userId || '—'],
        ['First Name', i.userFirst || '—'], ['Last Name', i.userLast || '—'],
        ['Role', i.role || '—'], ['Conflicting Roles', i.conflictingRoles || '—'],
        ['Access Point', i.accessPoint || '—'], ['Access Point Type', i.accessPointType || '—'],
        ['Entitlement', i.entitlement || '—'], ['Incident Information', i.info || '—'],
        ['Status', i.status || '—'], ['State', i.state || '—'],
        ['Created Date', i.created || '—'], ['Created By', i.createdBy || '—'],
        ['Last Updated', i.updated || '—'], ['Last Updated By', i.updatedBy || '—'],
        ['Closed Date', i.closed || '—'], ['Investigator', i.investigator || '—']
      ];
      table = {
        type: 'general',
        columns: ['Attribute', 'Value'],
        rows: iRows.map(([attribute, value], idx) => ({ id: `i${idx}`, attribute, value }))
      };
      totalCount = iRows.length;
      matchingCount = iRows.length;
      actions = [
        { label: 'Open Incidents Report', actionType: 'NAVIGATE', params: { page: 'reports' } }
      ];
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
      totalCount = data?.authoritativeTotal ?? data?.totalRecords ?? logArray.length;
      matchingCount = data?.totalMatching ?? logArray.length;
      table = {
        type: 'audit_vault',
        columns: ['Date', 'User', 'UserId', 'Event', 'Object', 'Description', 'Attribute', 'Old', 'New'],
        rows: logArray.map((a: any, idx: number) => ({
          id: a.id || `aud_${idx}`,
          date: a.date || a.timestamp || '—',
          user: a.user || a.username || '—',
          userid: a.userid || a.userInternalName || '—',
          event: a.event || a.action || '—',
          object: a.object || a.businessObject || '—',
          description: a.description || a.details || a.identifier || '—',
          attribute: a.attribute || '—',
          old: a.old ?? a.oldValue ?? '—',
          new: a.new ?? a.newValue ?? '—'
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
      totalCount = data?.summary?.totalPrivileges ?? privArray.length;
      matchingCount = privArray.length;
      table = {
        type: 'privileges',
        columns: ['Privilege Name', 'Code', 'Inherited From'],
        rows: privArray.map((p: any) => ({
          id: p.code,
          name: p.name || p.code,
          privilegeName: p.name || p.code,
          code: p.code,
          inheritedFrom: p.inheritedFrom || data.roleName || parameters.roleName || 'Direct'
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
    case 'CERTIFICATIONS_OVERVIEW': {
      title = 'Access Certifications Overview';
      const overRows: any[] = [
        ['Total Certifications', String(data.total)],
        ...Object.entries(data.byStatus || {}).map(([s, n]) => [`Status: ${s}`, String(n)]),
        ['Due in October 2026', String(data.dueOct2026)]
      ];
      if (data.avgComplete !== null && data.avgComplete !== undefined) {
        overRows.push(['Average Completion', `${data.avgComplete}%`]);
      }
      table = {
        type: 'general',
        columns: ['Metric', 'Value'],
        rows: overRows.map(([attribute, value], i) => ({ id: `c${i}`, attribute, value }))
      };
      totalCount = overRows.length;
      matchingCount = overRows.length;
      actions = [
        { label: 'Open Access Certificates', actionType: 'NAVIGATE', params: { page: 'risk' } }
      ];
      break;
    }

    case 'CERTIFICATIONS_LIST': {
      const cl = Array.isArray(data?.certifications) ? data.certifications : [];
      title = `Access Certifications (${cl.length} matching)`;
      totalCount = data?.total ?? cl.length;
      matchingCount = data?.totalMatching ?? cl.length;
      table = {
        type: 'access_certifications',
        columns: ['ID', 'Certification Name', 'Type', 'Status', '% Complete', 'Due Date', 'Owner'],
        rows: cl.map((c: any) => ({
          id: String(c.certificate || c.id || ''),
          certificationId: String(c.certificate || c.id || ''),
          certificate: String(c.certificate || c.id || ''),
          certificationName: c.name || c.certificationName || '',
          name: c.name || c.certificationName || '',
          type: c.type || 'Standard',
          status: c.status || 'Active',
          percentComplete: c.complete !== null && c.complete !== undefined ? c.complete : 0,
          complete: c.complete !== null && c.complete !== undefined ? `${c.complete}%` : '—',
          dueDate: c.due || c.dueDate || '—',
          due: c.due || c.dueDate || '—',
          owner: c.owner || '—',
          certifierName: c.owner || c.manager || '—'
        }))
      };
      actions = [
        { label: 'Open Access Certificates', actionType: 'NAVIGATE', params: { page: 'risk-certificates' } }
      ];
      break;
    }

    case 'CERTIFICATION_DETAILS': {
      if (data?.notFound || data?.ambiguous) {
        title = data?.ambiguous ? 'Multiple Certifications Match' : 'Certification Not Found';
        const amb = Array.isArray(data?.matches) ? data.matches : [];
        if (amb.length > 0) {
          table = {
            type: 'access_certifications',
            columns: ['ID', 'Certification Name', 'Type', 'Status', '% Complete', 'Due Date', 'Owner'],
            rows: amb.map((c: any) => ({
              id: String(c.certificate || c.id || ''),
              certificationId: String(c.certificate || c.id || ''),
              certificate: String(c.certificate || c.id || ''),
              certificationName: c.name || c.certificationName || '',
              name: c.name || c.certificationName || '',
              type: c.type || 'Standard',
              status: c.status || 'Active',
              percentComplete: c.complete !== null && c.complete !== undefined ? c.complete : 0,
              complete: c.complete !== null && c.complete !== undefined ? `${c.complete}%` : '—',
              dueDate: c.due || c.dueDate || '—',
              due: c.due || c.dueDate || '—',
              owner: c.owner || '—',
              certifierName: c.owner || c.manager || '—'
            }))
          };
        }
        break;
      }
      const c = data.certification;
      title = `Certification: ${c.name}`;
      const cRows: any[] = [
        ['Certification ID', c.certificate], ['Certification Name', c.name],
        ['Type', c.type || '—'], ['Status', c.status || '—'],
        ['Completion', c.complete !== null && c.complete !== undefined ? `${c.complete}%` : '—'],
        ['Due Date', c.due || '—'], ['Creation Date', c.created || '—'],
        ['Owner', c.owner || '—'], ['Manager', c.manager || '—']
      ];
      table = {
        type: 'general',
        columns: ['Attribute', 'Value'],
        rows: cRows.map(([attribute, value], i) => ({ id: `c${i}`, attribute, value }))
      };
      totalCount = cRows.length;
      matchingCount = cRows.length;
      actions = [
        { label: 'Open Access Certificates', actionType: 'NAVIGATE', params: { page: 'risk-certificates' } }
      ];
      break;
    }

    case 'CERTIFIER_WORKSHEET': {
      if (data?.notFound || data?.ambiguous) {
        title = data?.ambiguous ? 'Multiple Certifications Match' : 'No Worksheet Lines Found';
        const amb = Array.isArray(data?.matches) ? data.matches : [];
        if (amb.length > 0) {
          table = {
            type: 'access_certifications',
            columns: ['ID', 'Certification Name', 'Type', 'Status', '% Complete', 'Due Date', 'Owner'],
            rows: amb.map((c: any) => ({
              id: String(c.certificate || c.id || ''),
              certificationId: String(c.certificate || c.id || ''),
              certificate: String(c.certificate || c.id || ''),
              certificationName: c.name || c.certificationName || '',
              name: c.name || c.certificationName || '',
              type: c.type || 'Standard',
              status: c.status || 'Active',
              percentComplete: c.complete !== null && c.complete !== undefined ? c.complete : 0,
              complete: c.complete !== null && c.complete !== undefined ? `${c.complete}%` : '—',
              dueDate: c.due || c.dueDate || '—',
              due: c.due || c.dueDate || '—',
              owner: c.owner || '—',
              certifierName: c.owner || c.manager || '—'
            }))
          };
        }
        break;
      }
      title = `Certifier Worksheet — ${data.scopeLabel} (${(data.totalMatching || 0).toLocaleString()} matching)`;
      const wRows = Array.isArray(data?.rows) ? data.rows : [];
      totalCount = data?.totalRows ?? wRows.length;
      matchingCount = data?.totalMatching ?? wRows.length;
      table = {
        type: 'certifier_worksheet',
        columns: ['User Name', 'Role Name', 'Role Code', 'Direct Manager', 'Business Unit', 'Action'],
        rows: wRows.map((r: any, idx: number) => ({
          id: `${r.certificate || 'row'}-${idx}`,
          certificate: r.certificate || '—',
          certificationId: r.certificate || '—',
          userName: r.user || r.userName || '—',
          user: r.user || r.userName || '—',
          roleName: r.role || r.roleName || '—',
          role: r.role || r.roleName || '—',
          roleCode: r.roleCode || '—',
          code: r.roleCode || '—',
          directManager: r.manager || r.directManager || '—',
          manager: r.manager || r.directManager || '—',
          businessUnit: r.unit || r.businessUnit || '—',
          unit: r.unit || r.businessUnit || '—',
          action: r.action || 'Pending',
          comments: r.comments || '—'
        }))
      };
      actions = [
        { label: 'Open Access Certificates', actionType: 'NAVIGATE', params: { page: 'risk-certificates' } }
      ];
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
    role: data?.role || (data?.roleName ? { name: data.roleName, code: data.roleCode || '', category: data.category || 'Job' } : null),
    privilegeSummary: data?.summary || null,
    summaryMeta: data?.summary || null,
    user: (intent === 'GET_USER' || intent === 'ROLES_BY_USER') && data?.displayName ? data : null,
    metadata: {
      source,
      retrievedAt: timestamp,
      totalCount,
      matchingCount
    }
  };
}
