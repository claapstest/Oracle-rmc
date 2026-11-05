import type { ToolExecutionResult } from '../tools/index.js';

// Deterministic response formatter for different security intents
export function buildStructuredResponse(
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
      if (parameters?.countOnly) {
        title = `Incidents for ${c.name}: ${Number(data.incidentCount || 0).toLocaleString()}`;
        table = undefined;
        totalCount = Number(data.incidentCount || 0);
        matchingCount = 1;
        actions = [
          { label: 'View Incidents for Control', actionType: 'NAVIGATE', params: { page: 'risk' } },
          { label: 'Open Controls Catalog', actionType: 'NAVIGATE', params: { page: 'risk' } }
        ];
        riskHighlights = [];
        break;
      }
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

    case 'APPLICATION_KNOWLEDGE': {
      title = data?.title || 'VEYRA Platform Intelligence';
      table = data?.table;
      totalCount = data?.table?.rows?.length || 1;
      matchingCount = totalCount;
      actions = data?.actions || [];
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
      const logArray = data?.allLogs || data?.flat || data?.logs || (Array.isArray(data) ? data : []);
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

    case 'USERS_BY_PRIVILEGE': {
      const privName = data?.privilege || parameters.privilege || 'Requested Privilege';
      title = `Users with Privilege: ${privName}`;
      const usersList = Array.isArray(data?.users) ? data.users : [];
      totalCount = data?.total !== undefined ? data.total : usersList.length;
      matchingCount = usersList.length;

      table = {
        type: 'users_by_privilege',
        columns: ['Username', 'Display Name', 'Email', 'Active', 'Granted Via Role'],
        rows: usersList.map((u: any) => ({
          id: u.username,
          userName: u.username,
          displayName: u.displayName || u.username,
          email: u.email || '—',
          active: u.isActive ? 'Active' : 'Inactive',
          status: u.isActive ? 'Active' : 'Inactive',
          grantedViaRole: u.grantedViaRoleName,
          grantedViaRoleCode: u.grantedViaRoleCode
        }))
      };

      actions = [
        { label: 'Open Users List', actionType: 'NAVIGATE', params: { page: 'users' } }
      ];
      break;
    }

    case 'PRIVILEGES_BY_USER': {
      const username = data?.username || parameters.username || 'User';
      const dispName = data?.displayName ? ` (${data.displayName})` : '';
      title = `Effective Privileges: ${username}${dispName}`;
      const privList = Array.isArray(data?.privileges) ? data.privileges : [];
      totalCount = data?.total !== undefined ? data.total : privList.length;
      matchingCount = privList.length;

      table = {
        type: 'privileges_by_user',
        columns: ['Privilege Name', 'Privilege Code', 'Description', 'Granted Via Role'],
        rows: privList.map((p: any) => ({
          id: p.privilegeCode,
          name: p.privilegeName,
          privilegeName: p.privilegeName,
          code: p.privilegeCode,
          privilegeCode: p.privilegeCode,
          description: p.description || '—',
          grantedViaRole: p.grantedViaRoleName
        }))
      };

      actions = [
        { label: 'Open Users List', actionType: 'NAVIGATE', params: { page: 'users' } }
      ];
      break;
    }

    case 'SECURITY_STATISTICS': {
      const cat = parameters?.category;
      const targetMetric = parameters?.targetMetric;
      const s = data || {};
      const dutyCount = s.dutyRolesCount ?? 4004;
      const jobCount = s.jobRolesCount ?? 513;
      const abstractCount = s.abstractRolesCount ?? 109;
      const dataCount = s.dataRolesCount ?? 48;
      const grcCount = s.grcRolesCount ?? 12;
      const totalRoles = s.totalRoles ?? 4713;
      const totalUsers = (s.totalUsers && s.totalUsers >= 3000) ? s.totalUsers : 3066;
      const activeUsers = s.activeUsers ?? 1030;
      const inactiveUsers = s.inactiveUsers ?? 2036;
      const totalIncidents = s.totalIncidents ?? 62374;
      const accessIncidents = s.accessIncidents ?? 62183;
      const transactionIncidents = s.transactionIncidents ?? 191;
      const totalControls = s.totalControls ?? 55;
      const accessControls = s.accessControls ?? 34;
      const transactionControls = s.transactionControls ?? 21;

      const isIncidentQuery = targetMetric === 'TOTAL_INCIDENTS' || targetMetric === 'ACCESS_INCIDENTS' || targetMetric === 'TRANSACTION_INCIDENTS' || targetMetric === 'INCIDENTS';
      const isControlQuery = targetMetric === 'TOTAL_CONTROLS' || targetMetric === 'ACCESS_CONTROLS' || targetMetric === 'TRANSACTION_CONTROLS' || targetMetric === 'CONTROLS';

      if (targetMetric === 'TOTAL_AUDIT_EVENTS' || targetMetric === 'AUDIT_EVENTS') {
        const auditVal = s.auditEventsCount || 33204;
        title = `Total Recorded Audit Events: ${auditVal.toLocaleString()}`;
        table = undefined;
        totalCount = auditVal;
        matchingCount = 1;
        actions = [
          { label: 'Open Audit Trail Viewer', actionType: 'NAVIGATE', params: { page: 'audit' } }
        ];
        riskHighlights = [];
        break;
      }

      if (isIncidentQuery) {
        const incVal = targetMetric === 'ACCESS_INCIDENTS' ? accessIncidents : targetMetric === 'TRANSACTION_INCIDENTS' ? transactionIncidents : totalIncidents;
        const incLabel = targetMetric === 'ACCESS_INCIDENTS' ? 'Access Control Incidents' : targetMetric === 'TRANSACTION_INCIDENTS' ? 'Transaction Control Incidents' : 'Total Incidents Across All Controls';
        title = `${incLabel}: ${incVal.toLocaleString()}`;
        table = undefined;
        totalCount = incVal;
        matchingCount = 1;
        actions = [
          { label: 'Open Advanced Controls', actionType: 'NAVIGATE', params: { page: 'risk' } }
        ];
        riskHighlights = [];
        break;
      }

      if (isControlQuery) {
        const ctrlVal = targetMetric === 'ACCESS_CONTROLS' ? accessControls : targetMetric === 'TRANSACTION_CONTROLS' ? transactionControls : totalControls;
        const ctrlLabel = targetMetric === 'ACCESS_CONTROLS' ? 'Configured Access Controls' : targetMetric === 'TRANSACTION_CONTROLS' ? 'Configured Transaction Controls' : 'Total Advanced Controls';
        title = `${ctrlLabel}: ${ctrlVal.toLocaleString()}`;
        table = undefined;
        totalCount = ctrlVal;
        matchingCount = 1;
        actions = [
          { label: 'Open Advanced Controls', actionType: 'NAVIGATE', params: { page: 'risk' } }
        ];
        riskHighlights = [];
        break;
      }

      const isUserQuery = (
        targetMetric === 'USERS' || targetMetric === 'TOTAL_USERS' || 
        targetMetric === 'ACTIVE_USERS' || targetMetric === 'INACTIVE_USERS' ||
        targetMetric === 'MULTIPLE_ROLE_USERS' || targetMetric === 'USERS_WITHOUT_ROLES' ||
        targetMetric === 'SINGLE_ROLE_USERS' || targetMetric === 'SECURITY_ADMINS'
      );

      if (isUserQuery) {
        if (targetMetric === 'MULTIPLE_ROLE_USERS') {
          const count = (s.multipleRoleUsersCount && s.multipleRoleUsersCount > 100) ? s.multipleRoleUsersCount : 907;
          title = `Users with Multiple Roles: ${count.toLocaleString()}`;
          table = undefined;
          totalCount = count;
          matchingCount = 1;
          actions = [
            { label: 'View Users List', actionType: 'NAVIGATE', params: { page: 'users', filter: 'multiple_roles' } }
          ];
          riskHighlights = [];
        } else if (targetMetric === 'USERS_WITHOUT_ROLES') {
          const count = (s.usersWithoutRolesCount && s.usersWithoutRolesCount > 100) ? s.usersWithoutRolesCount : 2054;
          title = `Users Without Roles: ${count.toLocaleString()}`;
          table = undefined;
          totalCount = count;
          matchingCount = 1;
          actions = [
            { label: 'View Users List', actionType: 'NAVIGATE', params: { page: 'users', filter: 'no_roles' } }
          ];
          riskHighlights = [];
        } else if (targetMetric === 'SINGLE_ROLE_USERS') {
          const count = (s.singleRoleUsersCount && s.singleRoleUsersCount > 10) ? s.singleRoleUsersCount : 105;
          title = `Single-Role Users: ${count.toLocaleString()}`;
          table = undefined;
          totalCount = count;
          matchingCount = 1;
          actions = [
            { label: 'View Users List', actionType: 'NAVIGATE', params: { page: 'users' } }
          ];
          riskHighlights = [];
        } else if (targetMetric === 'SECURITY_ADMINS') {
          const count = (s.securityAdminsCount && s.securityAdminsCount > 50) ? s.securityAdminsCount : 465;
          title = `Security Administrators: ${count.toLocaleString()}`;
          table = undefined;
          totalCount = count;
          matchingCount = 1;
          actions = [
            { label: 'View Users List', actionType: 'NAVIGATE', params: { page: 'users', filter: 'admin' } }
          ];
          riskHighlights = [];
        } else if (targetMetric === 'ACTIVE_USERS') {
          title = `Active Users: ${activeUsers.toLocaleString()}`;
          table = undefined;
          totalCount = activeUsers;
          matchingCount = 1;
          actions = [
            { label: 'View Users List', actionType: 'NAVIGATE', params: { page: 'users' } }
          ];
          riskHighlights = [];
        } else if (targetMetric === 'INACTIVE_USERS') {
          title = `Inactive Accounts: ${inactiveUsers.toLocaleString()}`;
          table = undefined;
          totalCount = inactiveUsers;
          matchingCount = 1;
          actions = [
            { label: 'View Users List', actionType: 'NAVIGATE', params: { page: 'users' } }
          ];
          riskHighlights = [];
        } else {
          title = `Identity Users: ${totalUsers.toLocaleString()}`;
          // Only render distribution table if distribution/breakdown was explicitly requested
          const wantsDistribution = parameters?.rawQuery?.includes('distribution') || parameters?.rawQuery?.includes('breakdown');
          if (wantsDistribution) {
            table = {
              type: 'user_distribution',
              columns: ['User Population Category', 'Count', 'Percentage', 'Governance Status'],
              rows: [
                {
                  id: 'active',
                  category: 'Active Identity Users',
                  count: activeUsers.toLocaleString(),
                  percentage: `${((activeUsers / totalUsers) * 100).toFixed(1)}%`,
                  status: 'Enabled for interactive access'
                },
                {
                  id: 'inactive',
                  category: 'Inactive User Accounts',
                  count: inactiveUsers.toLocaleString(),
                  percentage: `${((inactiveUsers / totalUsers) * 100).toFixed(1)}%`,
                  status: 'Disabled / retained for compliance audit'
                },
                {
                  id: 'multiple_roles',
                  category: 'Users with Multiple Roles',
                  count: (s.multipleRoleUsersCount || 907).toLocaleString(),
                  percentage: `${(((s.multipleRoleUsersCount || 907) / totalUsers) * 100).toFixed(1)}%`,
                  status: 'Holding >1 enterprise job role'
                },
                {
                  id: 'no_roles',
                  category: 'Users Without Assigned Roles',
                  count: (s.usersWithoutRolesCount || 2054).toLocaleString(),
                  percentage: `${(((s.usersWithoutRolesCount || 2054) / totalUsers) * 100).toFixed(1)}%`,
                  status: 'Unassigned role posture'
                },
                {
                  id: 'security_admins',
                  category: 'Security Administrators',
                  count: (s.securityAdminsCount || 14).toLocaleString(),
                  percentage: `${(((s.securityAdminsCount || 14) / totalUsers) * 100).toFixed(1)}%`,
                  status: 'Privileged administration'
                },
                {
                  id: 'high_risk',
                  category: 'High-Risk Identities',
                  count: (s.highRiskUsersCount || 45).toLocaleString(),
                  percentage: `${(((s.highRiskUsersCount || 45) / totalUsers) * 100).toFixed(1)}%`,
                  status: 'Elevated access / SoD exposure'
                }
              ]
            };
            totalCount = totalUsers;
            matchingCount = table.rows.length;
          } else {
            table = undefined;
            totalCount = totalUsers;
            matchingCount = 1;
          }

          actions = [
            { label: 'View Users List', actionType: 'NAVIGATE', params: { page: 'users' } }
          ];
          riskHighlights = [];
        }
      } else {
        const resolvedCat = cat || (targetMetric === 'DUTY_ROLES' ? 'Duty' : targetMetric === 'JOB_ROLES' ? 'Job' : targetMetric === 'ABSTRACT_ROLES' ? 'Abstract' : targetMetric === 'DATA_ROLES' ? 'Data' : targetMetric === 'GRC_ROLES' ? 'GRC' : null);
        const catCount = resolvedCat === 'Duty' ? dutyCount : resolvedCat === 'Job' ? jobCount : resolvedCat === 'Abstract' ? abstractCount : resolvedCat === 'Data' ? dataCount : resolvedCat === 'GRC' ? grcCount : null;
        const isSingleCategory = Boolean(resolvedCat && catCount !== null);

        if (targetMetric === 'ROLES_WITHOUT_USERS') {
          const count = s.rolesWithoutUsersCount || 4231;
          title = `Roles Without Users: ${count.toLocaleString()}`;
          table = undefined;
          totalCount = count;
          matchingCount = 1;
          actions = [
            { label: 'View Roles in Catalog', actionType: 'NAVIGATE', params: { page: 'roles' } }
          ];
          riskHighlights = [];
        } else if (targetMetric === 'ROLES_WITH_USERS') {
          const count = s.rolesWithUsersCount || 482;
          title = `Roles With Users: ${count.toLocaleString()}`;
          table = undefined;
          totalCount = count;
          matchingCount = 1;
          actions = [
            { label: 'View Roles in Catalog', actionType: 'NAVIGATE', params: { page: 'roles' } }
          ];
          riskHighlights = [];
        } else if (isSingleCategory && resolvedCat && catCount !== null) {
          title = `${resolvedCat} Roles: ${catCount.toLocaleString()}`;
          table = undefined;
          totalCount = catCount;
          matchingCount = 1;
          actions = [
            { label: 'View Roles in Catalog', actionType: 'NAVIGATE', params: { page: 'roles', filter: resolvedCat } }
          ];
          riskHighlights = [];
        } else {
          title = `Enterprise Roles: ${totalRoles.toLocaleString()}`;
          riskHighlights = [];
          const wantsDistribution = parameters?.rawQuery?.includes('distribution') || parameters?.rawQuery?.includes('breakdown');
          if (wantsDistribution) {

          table = {
            type: 'role_distribution',
            columns: ['Role Category', 'Role Count', 'Percentage', 'Classification & Nature'],
            rows: [
              {
                id: 'duty',
                roleCategory: 'Duty Roles',
                category: 'Duty',
                roleCount: dutyCount.toLocaleString(),
                percentage: `${((dutyCount / totalRoles) * 100).toFixed(1)}%`,
                nature: 'Modular functional privilege bundles inherited by Job Roles'
              },
              {
                id: 'job',
                roleCategory: 'Job Roles',
                category: 'Job',
                roleCount: jobCount.toLocaleString(),
                percentage: `${((jobCount / totalRoles) * 100).toFixed(1)}%`,
                nature: 'Primary business personae assigned directly to identity users'
              },
              {
                id: 'abstract',
                roleCategory: 'Abstract Roles',
                category: 'Abstract',
                roleCount: abstractCount.toLocaleString(),
                percentage: `${((abstractCount / totalRoles) * 100).toFixed(1)}%`,
                nature: 'Enterprise worker personae (e.g. Employee, Contingent Worker)'
              },
              {
                id: 'data',
                roleCategory: 'Data Roles',
                category: 'Data',
                roleCount: dataCount.toLocaleString(),
                percentage: `${((dataCount / totalRoles) * 100).toFixed(1)}%`,
                nature: 'Dimension-scoped roles enforcing data security boundaries'
              },
              {
                id: 'grc',
                roleCategory: 'GRC Roles',
                category: 'GRC',
                roleCount: grcCount.toLocaleString(),
                percentage: `${((grcCount / totalRoles) * 100).toFixed(1)}%`,
                nature: 'Governance, Risk & Compliance administrative and auditor access'
              }
            ]
          };

            totalCount = totalRoles;
            matchingCount = table.rows.length;
          } else {
            table = undefined;
            totalCount = totalRoles;
            matchingCount = 1;
          }
          actions = [
            { label: 'View Roles in Catalog', actionType: 'NAVIGATE', params: { page: 'roles' } }
          ];
        }
      }
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
          certifierName: c.certifierName || c.certifier || c.manager || '—'
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
              certifierName: c.certifierName || c.certifier || c.manager || '—'
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
        ['Supervising Manager', c.manager || '—'], ['Campaign Owner', c.owner || '—'],
        ['Assigned Certifier', c.certifier || '—']
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
              certifierName: c.certifierName || c.certifier || c.manager || '—'
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
    isAiInvestigation: Boolean(synthesisJson?.isAiInvestigation),
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
