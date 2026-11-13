import React from 'react';
import { User } from 'lucide-react';
import {
  isAccessControl,
  isTransactionControl,
  formatControlTypeName,
} from './controlTypeMapping';

export interface IncidentColumnDef {
  key: string;
  label: string;
  defaultVisible: boolean;
  minWidth?: string;
  stickyLeft?: boolean;
}

export interface IncidentAttrContext {
  controlName?: string | null;
  controlType?: string | number | null;
  lastRunDate?: string | null;
  isTxControl?: boolean;
}

// Access Controls Incidents columns (Oracle Type 173)
export const ACCESS_INCIDENT_COLUMNS: IncidentColumnDef[] = [
  { key: 'resultId', label: 'Result ID', defaultVisible: true, minWidth: '140px', stickyLeft: true },
  { key: 'controlName', label: 'Control Name', defaultVisible: true, minWidth: '320px' },
  { key: 'accessPointType', label: 'Access Point Type', defaultVisible: true, minWidth: '165px' },
  { key: 'priority', label: 'Priority', defaultVisible: true, minWidth: '95px' },
  { key: 'globalUser', label: 'Global User', defaultVisible: true, minWidth: '185px' },
  { key: 'userFirstName', label: 'User First Name', defaultVisible: true, minWidth: '150px' },
  { key: 'userLastName', label: 'User Last Name', defaultVisible: true, minWidth: '150px' },
  { key: 'role', label: 'Role', defaultVisible: true, minWidth: '240px' },
  { key: 'accessEntitlement', label: 'Access Entitlement', defaultVisible: true, minWidth: '240px' },
  { key: 'accessPoint', label: 'Access Point', defaultVisible: true, minWidth: '220px' },
  { key: 'incidentInformation', label: 'Incident Information', defaultVisible: true, minWidth: '300px' },
  { key: 'conflictingRoles', label: 'Conflicting Roles', defaultVisible: true, minWidth: '240px' },
  { key: 'group', label: 'Group', defaultVisible: true, minWidth: '200px' },
  { key: 'investigator', label: 'Investigator', defaultVisible: true, minWidth: '165px' },
  { key: 'comments', label: 'Comments', defaultVisible: true, minWidth: '145px' },
  { key: 'attachments', label: 'Attachments', defaultVisible: true, minWidth: '130px' },
  { key: 'globalUserId', label: 'Global User ID', defaultVisible: true, minWidth: '145px' },
  { key: 'dataSource', label: 'Data Source', defaultVisible: true, minWidth: '145px' },
  { key: 'lastUpdatedBy', label: 'Last Updated By', defaultVisible: true, minWidth: '155px' },
  { key: 'incidentInformationCodes', label: 'Incident Information Codes', defaultVisible: true, minWidth: '260px' },
  { key: 'lastUpdatedDate', label: 'Last Updated Date', defaultVisible: true, minWidth: '150px' },
  { key: 'createdBy', label: 'Created By', defaultVisible: true, minWidth: '150px' },
  { key: 'status', label: 'Status', defaultVisible: true, minWidth: '135px' },
  { key: 'state', label: 'State', defaultVisible: true, minWidth: '155px' },
  { key: 'lastRunDate', label: 'Last Run Date', defaultVisible: true, minWidth: '140px' },
  { key: 'closedDate', label: 'Closed Date', defaultVisible: true, minWidth: '140px' },
  { key: 'creationDate', label: 'Creation Date', defaultVisible: true, minWidth: '140px' },
  { key: 'controlType', label: 'Control Type', defaultVisible: true, minWidth: '150px' },
];

// Transaction Controls Incidents columns (Oracle Type 174)
// Ordered per Transaction Control Incident specification:
// Result ID >> Control Name >> Control Type >> Status >> Grouping Value >> Creation Date >> Closed Date >> Last Run Date >> State >> Created by >> Last Updated Date >> Incident Information >> Last Updated by >> Data Source >> Investigator >> Group >> Attachments >> Comments >> Number of Occurrences
export const TRANSACTION_INCIDENT_COLUMNS: IncidentColumnDef[] = [
  { key: 'resultId', label: 'Result ID', defaultVisible: true, minWidth: '135px', stickyLeft: true },
  { key: 'controlName', label: 'Control Name', defaultVisible: true, minWidth: '300px' },
  { key: 'controlType', label: 'Control Type', defaultVisible: true, minWidth: '155px' },
  { key: 'status', label: 'Status', defaultVisible: true, minWidth: '135px' },
  { key: 'groupingValue', label: 'Grouping Value', defaultVisible: true, minWidth: '320px' },
  { key: 'creationDate', label: 'Creation Date', defaultVisible: true, minWidth: '140px' },
  { key: 'closedDate', label: 'Closed Date', defaultVisible: true, minWidth: '140px' },
  { key: 'lastRunDate', label: 'Last Run Date', defaultVisible: true, minWidth: '140px' },
  { key: 'state', label: 'State', defaultVisible: true, minWidth: '155px' },
  { key: 'createdBy', label: 'Created by', defaultVisible: true, minWidth: '150px' },
  { key: 'lastUpdatedDate', label: 'Last Updated Date', defaultVisible: true, minWidth: '155px' },
  { key: 'incidentInformation', label: 'Incident Information', defaultVisible: true, minWidth: '240px' },
  { key: 'lastUpdatedBy', label: 'Last Updated by', defaultVisible: true, minWidth: '155px' },
  { key: 'dataSource', label: 'Data Source', defaultVisible: true, minWidth: '140px' },
  { key: 'investigator', label: 'Investigator', defaultVisible: true, minWidth: '165px' },
  { key: 'group', label: 'Group', defaultVisible: true, minWidth: '260px' },
  { key: 'attachments', label: 'Attachments', defaultVisible: true, minWidth: '130px' },
  { key: 'comments', label: 'Comments', defaultVisible: true, minWidth: '140px' },
  { key: 'numberOfOccurrences', label: 'Number of Occurrences', defaultVisible: true, minWidth: '185px' },
];

export const formatOracleDateValue = (dateStr: string | null | undefined) => {
  if (!dateStr) return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not available</span>;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return String(dateStr);
  }
};

export const renderIncidentFieldVal = (val: any) => {
  if (val === null || val === undefined || val === '') {
    return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>;
  }
  return String(val);
};

export const parseGroupingValueTokens = (groupingVal: string | null | undefined) => {
  if (!groupingVal || typeof groupingVal !== 'string') {
    return { personId: null, expenseTypeId: null, amount: null, date: null, currency: null, tokens: [] as string[] };
  }
  const tokens = groupingVal.split(/\s+AND\s+/i).map(t => t.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return { personId: null, expenseTypeId: null, amount: null, date: null, currency: null, tokens: [] as string[] };
  }

  const personId: string | null = tokens[0] || null;
  const expenseTypeId: string | null = tokens[1] || null;
  let amount: string | null = tokens[2] || null;
  let date: string | null = tokens[3] || null;
  let currency: string | null = tokens[4] ? tokens[4].toUpperCase() : null;

  tokens.forEach(tok => {
    if (/^[a-zA-Z]{3}$/.test(tok)) {
      currency = tok.toUpperCase();
    } else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(tok) || /^\d{4}-\d{2}-\d{2}$/.test(tok)) {
      date = tok;
    } else if (/^\d+\.\d+$/.test(tok)) {
      amount = tok;
    }
  });

  return { personId, expenseTypeId, amount, date, currency, tokens };
};

export const getIncidentAttr = (inc: any, attr: string, ctx?: IncidentAttrContext): any => {
  if (!inc) return null;
  const raw = inc.raw || {};
  switch (attr) {
    case 'resultId':
      return inc.id || inc.IncidentId || inc.ResultId || raw.Id || raw.IncidentId || raw.ResultId || null;
    case 'globalUser':
      return inc.globalUserName || inc.globalUser || raw.GlobalUserName || raw.GlobalUser || raw.globalUserName || raw.globalUser || inc.globalUserId || raw.GlobalUserId || null;
    case 'userFirstName':
      return inc.userFirstName || raw.UserFirstName || raw.userFirstName || null;
    case 'userLastName':
      return inc.userLastName || raw.UserLastName || raw.userLastName || null;
    case 'role':
      return inc.role || raw.Role || raw.role || null;
    case 'accessEntitlement':
      return inc.accessEntitlement || inc.entitlement || raw.AccessEntitlement || raw.accessEntitlement || raw.Entitlement || raw.entitlement || null;
    case 'accessPoint':
      return inc.accessPoint || inc.accessPointName || raw.AccessPoint || raw.accessPoint || raw.AccessPointName || raw.accessPointName || null;
    case 'accessPointType':
      return inc.accessPointType || raw.AccessPointType || raw.accessPointType || null;
    case 'incidentInformation':
      return inc.incidentInformation || raw.IncidentInformation || raw.incidentInformation || raw.Description || raw.description || null;
    case 'conflictingRoles':
      return inc.conflictingRoles || raw.ConflictingRoles || raw.conflictingRoles || null;
    case 'group':
      return inc.resultGroup || raw.ResultGroup || raw.resultGroup || inc.group || raw.Group || raw.group || raw.GroupName || raw.groupName || null;
    case 'groupingValue':
      return inc.groupingValue || raw.GroupingValue || raw.groupingValue || null;
    case 'txAmount':
      return parseGroupingValueTokens(inc.groupingValue || raw.GroupingValue || raw.groupingValue).amount;
    case 'txDate':
      return parseGroupingValueTokens(inc.groupingValue || raw.GroupingValue || raw.groupingValue).date;
    case 'txCurrency':
      return parseGroupingValueTokens(inc.groupingValue || raw.GroupingValue || raw.groupingValue).currency;
    case 'txPersonId':
      return parseGroupingValueTokens(inc.groupingValue || raw.GroupingValue || raw.groupingValue).personId;
    case 'txExpenseTypeId':
      return parseGroupingValueTokens(inc.groupingValue || raw.GroupingValue || raw.groupingValue).expenseTypeId;
    case 'incidentVersion':
      return (inc.incidentVersion !== undefined && inc.incidentVersion !== null)
        ? String(inc.incidentVersion)
        : (raw.IncidentVersion !== undefined && raw.IncidentVersion !== null ? String(raw.IncidentVersion) : null);
    case 'revisionDate':
      return inc.revisionDate || raw.RevisionDate || raw.revisionDate || null;
    case 'investigator':
      return inc.investigator || inc.resultInvestigator || raw.Investigator || raw.investigator || raw.ResultInvestigator || raw.resultInvestigator || null;
    case 'comments':
      return inc.comments || raw.Comments || raw.comments || raw.IncidentComments || raw.incidentComments || null;
    case 'attachments': {
      const att = inc.attachments !== undefined && inc.attachments !== null
        ? inc.attachments
        : (raw.Attachments !== undefined && raw.Attachments !== null ? raw.Attachments : null);
      if (att === null || att === undefined) return null;
      return Array.isArray(att) ? String(att.length) : String(att);
    }
    case 'numberOfOccurrences': {
      const occ = inc.numberOfOccurrences ?? raw.NumberOfOccurrences ?? raw.numberOfOccurrences ?? raw.OccurrenceCount ?? raw.occurrenceCount ?? raw.Occurrences ?? raw.occurrences;
      return (occ !== undefined && occ !== null && occ !== '') ? String(occ) : null;
    }
    case 'globalUserId':
      return (inc.globalUserId !== undefined && inc.globalUserId !== null)
        ? String(inc.globalUserId)
        : (raw.GlobalUserId !== undefined && raw.GlobalUserId !== null ? String(raw.GlobalUserId) : null);
    case 'dataSource':
      return inc.dataSource || raw.DataSource || raw.dataSource || 'Oracle Cloud';
    case 'lastUpdatedBy':
      return inc.lastUpdatedBy || raw.LastUpdatedBy || raw.lastUpdatedBy || null;
    case 'incidentInformationCodes':
      return inc.incidentInformationCodes || raw.IncidentInformationCodes || raw.incidentInformationCodes || raw.IncidentCodes || raw.incidentCodes || null;
    case 'lastUpdatedDate':
      return inc.lastUpdateDate || inc.lastUpdatedDate || raw.LastUpdateDate || raw.lastUpdateDate || raw.LastUpdatedDate || raw.lastUpdatedDate || null;
    case 'createdBy':
      return inc.createdBy || raw.CreatedBy || raw.createdBy || null;
    case 'status':
      return inc.status || raw.Status || raw.status || raw.StatusId || null;
    case 'state':
      return inc.state || raw.State || raw.state || raw.StateCode || null;
    case 'lastRunDate':
      return inc.lastRunDate || raw.LastRunDate || raw.lastRunDate || ctx?.lastRunDate || null;
    case 'closedDate':
      return inc.closedDate || raw.ClosedDate || raw.closedDate || null;
    case 'creationDate':
      return inc.creationDate || raw.CreationDate || raw.creationDate || null;
    case 'controlType':
      return inc.controlType || raw.ControlType || raw.controlType || (ctx?.controlType ? String(ctx.controlType) : null) || (ctx?.isTxControl ? '174' : '173');
    case 'controlName':
      return inc.controlName || raw.ControlName || raw.controlName || ctx?.controlName || null;
    case 'priority':
      return inc.priority || raw.Priority || raw.priority || null;
    default:
      return null;
  }
};

export const renderPersonOrInfo = (val: string | null) => {
  if (!val) return renderIncidentFieldVal(null);
  const match = String(val).match(/^Person\.Full Name:\s*(.+)$/i);
  if (match) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', whiteSpace: 'nowrap' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            backgroundColor: 'rgba(59, 130, 246, 0.15)',
            color: '#60A5FA',
            flexShrink: 0,
          }}
        >
          <User size={12} />
        </span>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{match[1].trim()}</span>
      </div>
    );
  }
  return renderIncidentFieldVal(val);
};

export const renderSharedIncidentCell = (
  inc: any,
  colKey: string,
  options: {
    columns: IncidentColumnDef[];
    wrapText: boolean;
    context?: IncidentAttrContext;
  }
) => {
  const { columns, wrapText: isWrap, context } = options;
  const rawVal = getIncidentAttr(inc, colKey, context);

  switch (colKey) {
    case 'resultId': {
      const isSticky = Boolean(columns.find(c => c.key === colKey)?.stickyLeft);
      return (
        <td
          key={colKey}
          style={isSticky
            ? { position: 'sticky', left: 0, zIndex: 2, backgroundColor: 'var(--bg-primary)', boxShadow: '2px 0 5px rgba(0,0,0,0.1)', whiteSpace: 'nowrap' }
            : { whiteSpace: 'nowrap' }}
        >
          <span style={{ fontWeight: 600, color: 'var(--accent-gold)' }}>{rawVal || inc.id}</span>
        </td>
      );
    }

    case 'status': {
      const s = String(rawVal || 'Assigned').toUpperCase();
      let bg = 'rgba(59, 130, 246, 0.12)';
      let color = '#3B82F6';
      let border = 'rgba(59, 130, 246, 0.3)';
      let label = rawVal || 'Assigned';

      if (s.includes('REMEDIAT')) {
        bg = 'rgba(245, 158, 11, 0.12)';
        color = '#F59E0B';
        border = 'rgba(245, 158, 11, 0.3)';
        label = 'Remediate';
      } else if (s.includes('ACCEPT')) {
        bg = 'rgba(139, 92, 246, 0.12)';
        color = '#8B5CF6';
        border = 'rgba(139, 92, 246, 0.3)';
        label = 'Accepted';
      } else if (s.includes('RESOLV') || s.includes('CLOSE') || s.includes('INACTIVE')) {
        bg = 'rgba(16, 185, 129, 0.12)';
        color = '#10B981';
        border = 'rgba(16, 185, 129, 0.3)';
        label = s.includes('INACTIVE') ? String(rawVal) : 'Resolved';
      } else if (s.includes('ASSIGN')) {
        label = 'Assigned';
      }

      return (
        <td key={colKey} style={{ whiteSpace: 'nowrap' }}>
          <span
            className="badge"
            style={{
              fontSize: '0.74rem',
              fontWeight: 600,
              backgroundColor: bg,
              color,
              border: `1px solid ${border}`,
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </span>
        </td>
      );
    }

    case 'groupingValue':
      return (
        <td
          key={colKey}
          style={{
            fontSize: '0.82rem',
            minWidth: '320px',
            maxWidth: isWrap ? '650px' : '340px',
            overflow: isWrap ? 'visible' : 'hidden',
            textOverflow: isWrap ? 'clip' : 'ellipsis',
            whiteSpace: isWrap ? 'normal' : 'nowrap',
            wordBreak: 'break-word',
            lineHeight: 1.45,
          }}
          title={String(rawVal || '')}
        >
          {rawVal ? (
            <code style={{ fontSize: '0.76rem', backgroundColor: 'rgba(59, 130, 246, 0.08)', padding: '0.2rem 0.45rem', borderRadius: '4px', border: '1px solid rgba(59, 130, 246, 0.2)', color: 'var(--text-primary)' }}>
              {rawVal}
            </code>
          ) : renderIncidentFieldVal(null)}
        </td>
      );

    case 'incidentInformation':
      return (
        <td
          key={colKey}
          style={{
            fontSize: '0.85rem',
            minWidth: '240px',
            maxWidth: isWrap ? '520px' : '280px',
            overflow: isWrap ? 'visible' : 'hidden',
            textOverflow: isWrap ? 'clip' : 'ellipsis',
            whiteSpace: isWrap ? 'normal' : 'nowrap',
            wordBreak: 'break-word',
            lineHeight: 1.45,
          }}
          title={String(rawVal || '')}
        >
          {renderPersonOrInfo(rawVal)}
        </td>
      );

    case 'group':
      return (
        <td
          key={colKey}
          style={{
            fontSize: '0.85rem',
            minWidth: '240px',
            maxWidth: isWrap ? '450px' : '260px',
            overflow: isWrap ? 'visible' : 'hidden',
            textOverflow: isWrap ? 'clip' : 'ellipsis',
            whiteSpace: isWrap ? 'normal' : 'nowrap',
            wordBreak: 'break-word',
            lineHeight: 1.4,
          }}
          title={String(rawVal || '')}
        >
          {rawVal ? (
            <span
              className="badge"
              style={{
                fontSize: '0.74rem',
                fontWeight: 600,
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                color: '#34D399',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                whiteSpace: isWrap ? 'normal' : 'nowrap',
                textAlign: 'left',
              }}
            >
              {rawVal}
            </span>
          ) : renderIncidentFieldVal(null)}
        </td>
      );

    case 'state':
      return (
        <td key={colKey} style={{ whiteSpace: 'nowrap' }}>
          <span className="badge badge-gold" style={{ fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
            {rawVal || 'In Investigation'}
          </span>
        </td>
      );

    case 'priority':
      return (
        <td key={colKey} style={{ fontSize: '0.85rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
          <span className="badge" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
            {renderIncidentFieldVal(rawVal)}
          </span>
        </td>
      );

    case 'controlName':
      return (
        <td
          key={colKey}
          style={{
            fontSize: '0.85rem',
            minWidth: '300px',
            maxWidth: isWrap ? '550px' : '340px',
            overflow: isWrap ? 'visible' : 'hidden',
            textOverflow: isWrap ? 'clip' : 'ellipsis',
            whiteSpace: isWrap ? 'normal' : 'nowrap',
            wordBreak: 'break-word',
            lineHeight: 1.45,
          }}
          title={String(rawVal || '')}
        >
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {renderIncidentFieldVal(rawVal)}
          </span>
        </td>
      );

    case 'globalUser':
    case 'userFirstName':
    case 'userLastName':
    case 'createdBy':
    case 'lastUpdatedBy':
    case 'dataSource':
    case 'investigator':
      return (
        <td key={colKey} style={{ fontSize: '0.85rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }} title={String(rawVal || '')}>
          {renderIncidentFieldVal(rawVal)}
        </td>
      );

    case 'incidentVersion':
      return (
        <td key={colKey} style={{ fontSize: '0.85rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
          <span className="badge" style={{ fontSize: '0.72rem' }}>
            v{renderIncidentFieldVal(rawVal)}
          </span>
        </td>
      );

    case 'accessPointType':
      return (
        <td key={colKey} style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
          {rawVal ? (
            <span
              className="badge"
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                backgroundColor: rawVal === 'Role' ? 'rgba(139, 92, 246, 0.12)' : 'rgba(59, 130, 246, 0.12)',
                color: rawVal === 'Role' ? '#A78BFA' : '#60A5FA',
                border: rawVal === 'Role' ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid rgba(59, 130, 246, 0.3)',
              }}
            >
              {rawVal}
            </span>
          ) : renderIncidentFieldVal(null)}
        </td>
      );

    case 'role':
    case 'accessEntitlement':
    case 'accessPoint':
    case 'conflictingRoles':
      return (
        <td
          key={colKey}
          style={{
            fontSize: '0.85rem',
            minWidth: '220px',
            maxWidth: isWrap ? '400px' : '240px',
            overflow: isWrap ? 'visible' : 'hidden',
            textOverflow: isWrap ? 'clip' : 'ellipsis',
            whiteSpace: isWrap ? 'normal' : 'nowrap',
            wordBreak: 'break-word',
            lineHeight: 1.4,
          }}
          title={String(rawVal || '')}
        >
          {renderIncidentFieldVal(rawVal)}
        </td>
      );

    case 'globalUserId':
      return (
        <td key={colKey} style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
          <code>{renderIncidentFieldVal(rawVal)}</code>
        </td>
      );

    case 'incidentInformationCodes':
      return (
        <td
          key={colKey}
          style={{
            fontSize: '0.85rem',
            minWidth: '260px',
            maxWidth: isWrap ? '460px' : '260px',
            overflow: isWrap ? 'visible' : 'hidden',
            textOverflow: isWrap ? 'clip' : 'ellipsis',
            whiteSpace: isWrap ? 'normal' : 'nowrap',
            wordBreak: 'break-word',
            lineHeight: 1.4,
          }}
          title={String(rawVal || '')}
        >
          <code>{renderIncidentFieldVal(rawVal)}</code>
        </td>
      );

    case 'controlType': {
      const isMappedType = isTransactionControl(rawVal) || isAccessControl(rawVal);
      const typeText = isMappedType ? formatControlTypeName(rawVal) : rawVal;
      const isTx = isTransactionControl(rawVal);
      return (
        <td key={colKey} style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
          {typeText ? (
            <span
              className="badge"
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                backgroundColor: isTx ? 'rgba(16, 185, 129, 0.12)' : 'rgba(139, 92, 246, 0.12)',
                color: isTx ? '#34D399' : '#A78BFA',
                border: isTx ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(139, 92, 246, 0.3)',
              }}
            >
              {typeText}
            </span>
          ) : renderIncidentFieldVal(null)}
        </td>
      );
    }

    case 'numberOfOccurrences':
      return (
        <td key={colKey} style={{ fontSize: '0.85rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
          {rawVal !== null && rawVal !== undefined && rawVal !== '' ? (
            <span className="badge" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
              {rawVal}
            </span>
          ) : renderIncidentFieldVal(null)}
        </td>
      );

    case 'creationDate':
    case 'lastUpdatedDate':
    case 'revisionDate':
    case 'lastRunDate':
    case 'closedDate':
      return (
        <td key={colKey} style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {formatOracleDateValue(rawVal)}
        </td>
      );

    default:
      return (
        <td key={colKey} style={{ fontSize: '0.85rem', whiteSpace: isWrap ? 'normal' : 'nowrap' }}>
          {renderIncidentFieldVal(rawVal)}
        </td>
      );
  }
};

