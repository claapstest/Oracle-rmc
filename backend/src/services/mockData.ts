export interface User {
  id: string;
  userName: string;
  userCategory?: string | null;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
  assignedRoles: any[]; // Role objects or names
  personId?: string | null;
  personNumber?: string | null;
  department?: string | null;
  job?: string | null;
  businessUnit?: string | null;
  location?: string | null;
  manager?: string | null;
}

export interface Role {
  id: string;
  displayName: string;
  roleCode: string;
  category: 'Job' | 'Duty' | 'Data' | 'Abstract' | 'GRC' | 'Other';
  description: string;
  members: { value: string; display: string }[];
  parentRoles: string[]; // Role codes
  childRoles: string[]; // Role codes
  privileges: { code: string; name: string; type: 'Function' | 'Data' }[];
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  username: string;
  businessObject: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'ROLE_ASSIGN' | 'ROLE_REVOKE';
  details: string;
}

export interface RiskIncident {
  id: string;
  ruleCode: string;
  ruleName: string;
  severity: 'Low' | 'Medium' | 'High';
  username: string;
  displayName: string;
  status: 'Open' | 'Under Review' | 'Resolved';
  description: string;
  detectedDate: string;
}

export interface SoDConflict {
  id: string;
  ruleCode: string;
  name: string;
  description: string;
  severity: 'Low' | 'Medium' | 'High';
  conflictingRoleA: string;
  conflictingRoleB: string;
  violatingUsersCount: number;
}

export interface AccessCertification {
  id: string;
  name: string;
  owner: string;
  status: 'Not Started' | 'In Progress' | 'Completed';
  dueDate: string;
  completionRate: number;
}

// ----------------------------------------------------
// Base Manual Records (to keep existing system queries working)
// ----------------------------------------------------

const baseUsers: User[] = [
  {
    id: "usr_jsmith",
    userName: "JSMITH",
    displayName: "John Smith",
    firstName: "John",
    lastName: "Smith",
    email: "john.smith@oracle-demo.com",
    active: true,
    assignedRoles: ["AP Manager", "IT Security Manager", "Employee"]
  },
  {
    id: "usr_ajohnson",
    userName: "AJOHNSON",
    displayName: "Alice Johnson",
    firstName: "Alice",
    lastName: "Johnson",
    email: "alice.johnson@oracle-demo.com",
    active: true,
    assignedRoles: ["Advanced Access Controls Analyst", "Employee"]
  },
  {
    id: "usr_rlee",
    userName: "RLEE",
    displayName: "Robert Lee",
    firstName: "Robert",
    lastName: "Lee",
    email: "robert.lee@oracle-demo.com",
    active: true,
    assignedRoles: ["AP Manager", "Employee"]
  },
  {
    id: "usr_sdavis",
    userName: "SDAVIS",
    displayName: "Sarah Davis",
    firstName: "Sarah",
    lastName: "Davis",
    email: "sarah.davis@oracle-demo.com",
    active: true,
    assignedRoles: ["Payroll Administrator", "Employee"]
  },
  {
    id: "usr_ewilson",
    userName: "EWILSON",
    displayName: "Emma Wilson",
    firstName: "Emma",
    lastName: "Wilson",
    email: "emma.wilson@oracle-demo.com",
    active: true,
    assignedRoles: ["Security Administrator", "IT Security Manager"]
  },
  {
    id: "usr_mbrown",
    userName: "MBROWN",
    displayName: "Michael Brown",
    firstName: "Michael",
    lastName: "Brown",
    email: "michael.brown@oracle-demo.com",
    active: false,
    assignedRoles: ["Employee"]
  },
  {
    id: "usr_kwhite",
    userName: "KWHITE",
    displayName: "Kevin White",
    firstName: "Kevin",
    lastName: "White",
    email: "kevin.white@oracle-demo.com",
    active: true,
    assignedRoles: [] // No roles assigned
  }
];

const baseRoles: Role[] = [
  {
    id: "role_ap_mgr",
    displayName: "AP Manager",
    roleCode: "ORA_AP_MANAGER",
    category: "Job",
    description: "Manages accounts payable business operations, invoice entries, payments, and approvals.",
    members: [],
    parentRoles: [],
    childRoles: [], // Will be generated (needs 17)
    privileges: [] // Will be populated with 42 recursively through its child roles
  },
  {
    id: "role_it_sec_mgr",
    displayName: "IT Security Manager",
    roleCode: "ORA_IT_SECURITY_MANAGER",
    category: "Job",
    description: "Administers application security, role provisioning, user accounts, and security consoles.",
    members: [],
    parentRoles: [],
    childRoles: ["ORA_USER_MANAGEMENT_DUTY", "ORA_SECURITY_CONSOLE_ACCESS_DUTY"],
    privileges: []
  },
  {
    id: "role_aac_analyst",
    displayName: "Advanced Access Controls Analyst",
    roleCode: "ORA_AAC_ANALYST",
    category: "GRC",
    description: "Analyzes segregation of duties (SoD) conflicts, designs transaction monitoring rules, and reviews security policies.",
    members: [],
    parentRoles: [],
    childRoles: ["ORA_GRC_CONTROL_DESIGN_DUTY"],
    privileges: []
  },
  {
    id: "role_payroll_admin",
    displayName: "Payroll Administrator",
    roleCode: "ORA_PAYROLL_ADMINISTRATOR",
    category: "Job",
    description: "Coordinates payroll processing, updates employee tax forms, and reviews wage disbursements.",
    members: [],
    parentRoles: [],
    childRoles: ["ORA_PAYROLL_PROCESSING_DUTY"],
    privileges: [
      { code: "PROCESS_PAYROLL", name: "Process Employee Payroll Payments", type: "Function" }
    ]
  },
  {
    id: "role_sec_admin",
    displayName: "Security Administrator",
    roleCode: "ORA_SECURITY_ADMINISTRATOR",
    category: "Job",
    description: "Performs low-level database security administration, audit setups, and network security profiles.",
    members: [],
    parentRoles: [],
    childRoles: [],
    privileges: [
      { code: "MANAGE_AUDIT_TRAIL", name: "Manage System Audit Trail Configuration", type: "Function" }
    ]
  },
  {
    id: "role_employee",
    displayName: "Employee",
    roleCode: "ORA_EMPLOYEE",
    category: "Abstract",
    description: "Standard abstract role granted to all employees to access personal self-service info, timesheets, and directories.",
    members: [],
    parentRoles: [],
    childRoles: [],
    privileges: [
      { code: "VIEW_PORTAL", name: "View Employee Self-Service Portal", type: "Function" }
    ]
  },
  // Base Duty Roles
  {
    id: "role_ap_inv_create_duty",
    displayName: "Accounts Payable Invoice Creation Duty",
    roleCode: "ORA_AP_INVOICE_CREATION_DUTY",
    category: "Duty",
    description: "Provides access to input and import invoices into accounts payable systems.",
    members: [],
    parentRoles: ["ORA_AP_MANAGER"],
    childRoles: [],
    privileges: [
      { code: "CREATE_PURCHASE_INVOICE", name: "Create Purchase Invoice", type: "Function" },
      { code: "MANAGE_SUPPLIERS", name: "Manage Supplier Profiles", type: "Function" }
    ]
  },
  {
    id: "role_ap_inv_approve_duty",
    displayName: "Accounts Payable Invoice Approval Duty",
    roleCode: "ORA_AP_INVOICE_APPROVAL_DUTY",
    category: "Duty",
    description: "Provides access to approve supplier invoice variances, releases, and payment entries.",
    members: [],
    parentRoles: ["ORA_AP_MANAGER"],
    childRoles: [],
    privileges: [
      { code: "APPROVE_PURCHASE_INVOICE", name: "Approve Purchase Invoice", type: "Function" }
    ]
  },
  {
    id: "role_user_mgmt_duty",
    displayName: "User Management Duty",
    roleCode: "ORA_USER_MANAGEMENT_DUTY",
    category: "Duty",
    description: "Provides ability to create users, assign roles, lock accounts, and manage passwords.",
    members: [],
    parentRoles: ["ORA_IT_SECURITY_MANAGER"],
    childRoles: [],
    privileges: [
      { code: "MANAGE_USER_ACCOUNTS", name: "Manage User Accounts", type: "Function" }
    ]
  },
  {
    id: "role_sec_console_duty",
    displayName: "Security Console Access Duty",
    roleCode: "ORA_SECURITY_CONSOLE_ACCESS_DUTY",
    category: "Duty",
    description: "Provides read and write access to the Security Console parameters and system configurations.",
    members: [],
    parentRoles: ["ORA_IT_SECURITY_MANAGER"],
    childRoles: [],
    privileges: [
      { code: "ACCESS_SECURITY_CONSOLE", name: "Access Security Console", type: "Function" }
    ]
  },
  {
    id: "role_grc_control_duty",
    displayName: "GRC Control Design Duty",
    roleCode: "ORA_GRC_CONTROL_DESIGN_DUTY",
    category: "Duty",
    description: "Provides authority to design controls, setup models, and audit risk boundaries.",
    members: [],
    parentRoles: ["ORA_AAC_ANALYST"],
    childRoles: [],
    privileges: [
      { code: "DESIGN_ACCESS_CONTROLS", name: "Design GRC Access Controls", type: "Function" },
      { code: "RUN_RISK_ANALYSIS", name: "Run GRC Risk Analysis", type: "Function" }
    ]
  }
];

// Helper names lists for random seed-generation
const firstNames = ['David', 'Sarah', 'Michael', 'James', 'Robert', 'Patricia', 'Linda', 'Barbara', 'Elizabeth', 'Jennifer', 'Maria', 'Susan', 'Margaret', 'Dorothy', 'Lisa', 'Nancy', 'Karen', 'Betty', 'Helen', 'Sandra', 'Donna', 'Carol', 'Ruth', 'Sharon', 'Michelle', 'Laura', 'Kimberly', 'Deborah', 'Jessica', 'Shirley', 'Cynthia', 'Angela', 'Melissa', 'Brenda', 'Amy', 'Anna', 'Rebecca', 'Virginia', 'Kathleen', 'Pamela', 'Martha', 'Debra', 'Amanda', 'Stephanie', 'Carolyn', 'Christine', 'Marie', 'Janet', 'Catherine'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts'];

// ----------------------------------------------------
// Database Generation Process
// ----------------------------------------------------

const generatedRoles: Role[] = [...baseRoles];
const generatedUsers: User[] = [...baseUsers];

// Targeted metrics
const TARGET_TOTAL_USERS = 1248;
const TARGET_TOTAL_ROLES = 342;

const TARGET_JOB_ROLES = 84;
const TARGET_DUTY_ROLES = 130;
const TARGET_DATA_ROLES = 76;
const TARGET_ABSTRACT_ROLES = 40;
const TARGET_GRC_ROLES = 12;

// 1. Generate Roles to match target numbers
const generateRoleCategory = (cat: 'Job' | 'Duty' | 'Data' | 'Abstract' | 'GRC', count: number) => {
  const currentCount = generatedRoles.filter(r => r.category === cat).length;
  const needed = count - currentCount;
  
  for (let i = 0; i < needed; i++) {
    const roleId = `role_${cat.toLowerCase()}_gen_${i + 1}`;
    const code = `ORA_${cat.toUpperCase()}_GEN_${i + 1}`;
    const name = `${cat} Role Level ${i + 1}`;
    
    generatedRoles.push({
      id: roleId,
      displayName: name,
      roleCode: code,
      category: cat,
      description: `Automatically generated standard ${cat.toLowerCase()} role in the Oracle system.`,
      members: [],
      parentRoles: [],
      childRoles: [],
      privileges: [
        { code: `PRIV_${cat.toUpperCase()}_${i + 1}_A`, name: `${cat} Operation ${i + 1} Access`, type: 'Function' },
        { code: `PRIV_${cat.toUpperCase()}_${i + 1}_B`, name: `${cat} Data Boundary ${i + 1} Privilege`, type: 'Data' }
      ]
    });
  }
};

generateRoleCategory('Job', TARGET_JOB_ROLES);
generateRoleCategory('Duty', TARGET_DUTY_ROLES);
generateRoleCategory('Data', TARGET_DATA_ROLES);
generateRoleCategory('Abstract', TARGET_ABSTRACT_ROLES);
generateRoleCategory('GRC', TARGET_GRC_ROLES);

// 2. Set up AP Manager specific child Duty Roles and recursive privileges
// AP Manager needs 17 Duty Roles. We have 2 base duties. We will link 15 more generated Duty Roles to AP Manager.
const apManager = generatedRoles.find(r => r.displayName === 'AP Manager')!;
const duties = generatedRoles.filter(r => r.category === 'Duty');
const apManagerDuties: string[] = [];

// Link 17 duty roles to AP Manager
for (let i = 0; i < 17; i++) {
  if (duties[i]) {
    apManagerDuties.push(duties[i].roleCode);
    // Assign back link
    if (!duties[i].parentRoles.includes('ORA_AP_MANAGER')) {
      duties[i].parentRoles.push('ORA_AP_MANAGER');
    }
  }
}
apManager.childRoles = apManagerDuties;

// Ensure AP Manager recursively inherits exactly 42 privileges.
// Let's clear its direct privileges and assign direct/child privileges to hit exactly 42.
apManager.privileges = [];
let accumulatedPrivsCount = 0;

// Set exact privileges to AP Manager's child Duty roles so they sum up to 42
for (let dCode of apManager.childRoles) {
  const duty = generatedRoles.find(r => r.roleCode === dCode)!;
  if (!duty) continue;
  
  // Assign 2 unique privileges per duty
  duty.privileges = [
    { code: `AP_PRIV_GEN_${accumulatedPrivsCount + 1}`, name: `AP Special Transaction Auth ${accumulatedPrivsCount + 1}`, type: 'Function' },
    { code: `AP_PRIV_GEN_${accumulatedPrivsCount + 2}`, name: `AP Regional Directory View ${accumulatedPrivsCount + 2}`, type: 'Data' }
  ];
  accumulatedPrivsCount += 2;
}

// Since we have 17 child duty roles, 17 * 2 = 34 inherited privileges.
// We will add 8 direct privileges to the AP Manager role itself to make 34 + 8 = exactly 42 privileges!
for (let i = 0; i < 8; i++) {
  apManager.privileges.push({
    code: `AP_DIRECT_PRIV_GEN_${i + 1}`,
    name: `AP Core Manager Control Admin Privilege ${i + 1}`,
    type: 'Function'
  });
}

// 3. Generate Users to match target of 1248
// Split of status: 1150 active, 98 inactive
const totalBase = generatedUsers.length;
const neededUsers = TARGET_TOTAL_USERS - totalBase;

// Define role-assignment pools
const jobRoles = generatedRoles.filter(r => r.category === 'Job');
const abstractRoles = generatedRoles.filter(r => r.category === 'Abstract');
const securityAdminRole = generatedRoles.find(r => r.roleCode === 'ORA_SECURITY_ADMINISTRATOR')!;
const employeeRole = generatedRoles.find(r => r.roleCode === 'ORA_EMPLOYEE')!;

// Targets for specific user categories:
// - 84 assigned to AP Manager
// - 13 with No Roles (empty assignedRoles)
// - 24 with Security Administrator role (Security Administrator)
// - 87 with Multiple Roles (more than 1 role)
// - 18 with High-Risk roles (assigned Security Administrator or IT Security Manager)

let apManagerAssignmentsCount = generatedUsers.filter(u => u.assignedRoles.includes('AP Manager')).length; // starts with base
let secAdminAssignmentsCount = generatedUsers.filter(u => u.assignedRoles.includes('Security Administrator')).length;
let multiRoleUsersCount = generatedUsers.filter(u => u.assignedRoles.length > 1).length;
let noRoleUsersCount = generatedUsers.filter(u => u.assignedRoles.length === 0).length;

// Loop to generate users
for (let i = 0; i < neededUsers; i++) {
  const firstName = firstNames[i % firstNames.length];
  const lastName = lastNames[Math.floor(i / firstNames.length) % lastNames.length];
  const randNum = 1000 + i;
  const username = `USER_${randNum}`;
  const displayName = `${firstName} ${lastName}`;
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randNum}@oracle-demo.com`;
  
  // Distribute active / inactive status (target 98 inactive)
  // Base has 1 inactive user (MBROWN). We need 97 more.
  const active = i >= 97;

  let assignedRoles: string[] = [];

  // Determine role assignment to fill user buckets
  if (apManagerAssignmentsCount < 84) {
    assignedRoles = ['AP Manager', 'Employee'];
    apManagerAssignmentsCount++;
    multiRoleUsersCount++;
  } else if (secAdminAssignmentsCount < 24) {
    assignedRoles = ['Security Administrator'];
    secAdminAssignmentsCount++;
  } else if (noRoleUsersCount < 13) {
    assignedRoles = [];
    noRoleUsersCount++;
  } else if (multiRoleUsersCount < 87) {
    // Multiple role user (e.g. employee + random Job role)
    const randomJob = jobRoles[i % jobRoles.length].displayName;
    assignedRoles = ['Employee', randomJob];
    multiRoleUsersCount++;
  } else {
    // Default standard single-role users (Employee or a random Job Role)
    if (i % 5 === 0) {
      assignedRoles = [jobRoles[i % jobRoles.length].displayName];
    } else {
      assignedRoles = ['Employee'];
    }
  }

  generatedUsers.push({
    id: `usr_gen_${randNum}`,
    userName: username,
    displayName: displayName,
    firstName: firstName,
    lastName: lastName,
    email: email,
    active: active,
    assignedRoles: assignedRoles
  });
}

// 4. Update the Role 'members' references inside each role record so they sync with the users' assignments
for (let role of generatedRoles) {
  role.members = [];
  for (let user of generatedUsers) {
    if (user.assignedRoles.includes(role.displayName)) {
      role.members.push({
        value: user.id,
        display: user.displayName
      });
    }
  }
}

// Export the generated databases
export const mockUsers: User[] = generatedUsers;
export const mockRoles: Role[] = generatedRoles;

// ----------------------------------------------------
// Audit & Risk Database Upgrades
// ----------------------------------------------------

// Scale Audit history to exactly 126 events with real-looking operations
const baseAuditTrail: AuditEvent[] = [
  {
    id: "aud_001",
    timestamp: "2026-08-11T10:00:00Z",
    username: "JSMITH",
    businessObject: "Role: AP Manager (ORA_AP_MANAGER)",
    action: "UPDATE",
    details: "Assigned child duty role Accounts Payable Invoice Approval Duty (ORA_AP_INVOICE_APPROVAL_DUTY)"
  },
  {
    id: "aud_002",
    timestamp: "2026-08-11T14:30:00Z",
    username: "EWILSON",
    businessObject: "User: RLEE",
    action: "ROLE_ASSIGN",
    details: "Assigned Job Role: AP Manager (ORA_AP_MANAGER)"
  },
  {
    id: "aud_003",
    timestamp: "2026-08-12T09:15:00Z",
    username: "EWILSON",
    businessObject: "User: KWHITE",
    action: "ROLE_REVOKE",
    details: "Revoked Abstract Role: Employee (ORA_EMPLOYEE)"
  },
  {
    id: "aud_004",
    timestamp: "2026-08-10T11:00:00Z",
    username: "JSMITH",
    businessObject: "Privilege: CREATE_PURCHASE_INVOICE",
    action: "UPDATE",
    details: "Modified data security policy boundary to restrict invoice entry to regional Cost Centers."
  },
  {
    id: "aud_005",
    timestamp: "2026-08-12T13:45:00Z",
    username: "EWILSON",
    businessObject: "User: AJOHNSON",
    action: "ROLE_ASSIGN",
    details: "Assigned GRC Role: Advanced Access Controls Analyst (ORA_AAC_ANALYST)"
  }
];

const generatedAuditEvents: AuditEvent[] = [...baseAuditTrail];
const auditActions: AuditEvent['action'][] = ['CREATE', 'UPDATE', 'DELETE', 'ROLE_ASSIGN', 'ROLE_REVOKE'];
const auditObjects = [
  'Role: AP Manager (ORA_AP_MANAGER)',
  'Role: IT Security Manager (ORA_IT_SECURITY_MANAGER)',
  'User: JSMITH',
  'User: AJOHNSON',
  'User: RLEE',
  'User: SDAVIS',
  'User: EWILSON',
  'Privilege: CREATE_PURCHASE_INVOICE',
  'Privilege: ACCESS_SECURITY_CONSOLE',
  'Security Profile: Default_Auditing_Policy'
];

for (let i = 5; i < 126; i++) {
  const daysAgo = Math.floor(i / 15);
  const hour = 8 + (i % 10);
  const minute = 10 + (i % 45);
  const timestamp = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  timestamp.setHours(hour, minute, 0, 0);

  const action = auditActions[i % auditActions.length];
  const businessObject = auditObjects[i % auditObjects.length];
  const username = i % 3 === 0 ? 'EWILSON' : (i % 3 === 1 ? 'JSMITH' : 'SYSTEM');
  
  let details = '';
  switch (action) {
    case 'CREATE':
      details = `Provisioned new security record context for ${businessObject}.`;
      break;
    case 'UPDATE':
      details = `Modified security configuration variables on ${businessObject}. Evaluated by audit rule controller.`;
      break;
    case 'DELETE':
      details = `Purged deprecated role mapping associations from ${businessObject}.`;
      break;
    case 'ROLE_ASSIGN':
      details = `Assigned security entitlement key mapping to ${businessObject}.`;
      break;
    case 'ROLE_REVOKE':
      details = `Revoked credential access keys from ${businessObject}. Access permissions removed.`;
      break;
  }

  generatedAuditEvents.push({
    id: `aud_gen_${100 + i}`,
    timestamp: timestamp.toISOString(),
    username: username,
    businessObject: businessObject,
    action: action,
    details: details
  });
}

// Sort audit events chronologically
generatedAuditEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

export const mockAuditTrail: AuditEvent[] = generatedAuditEvents;

// Base Risk & GRC Models
export const mockRiskIncidents: RiskIncident[] = [
  {
    id: "INC-1002",
    ruleCode: "SOD_AP_01",
    ruleName: "Create and Approve Invoices Violation",
    severity: "High",
    username: "JSMITH",
    displayName: "John Smith",
    status: "Open",
    description: "User JSMITH possesses both ORA_AP_INVOICE_CREATION_DUTY and ORA_AP_INVOICE_APPROVAL_DUTY, which violates corporate financial segregation policy. Transactions reviewed show user created and approved Invoice INV-88992 on 2026-08-11.",
    detectedDate: "2026-08-11T12:00:00Z"
  },
  {
    id: "INC-1003",
    ruleCode: "SOD_AP_01",
    ruleName: "Create and Approve Invoices Violation",
    severity: "High",
    username: "RLEE",
    displayName: "Robert Lee",
    status: "Under Review",
    description: "User RLEE possesses both ORA_AP_INVOICE_CREATION_DUTY and ORA_AP_INVOICE_APPROVAL_DUTY, which violates segregation of duties controls. No unauthorized transactions detected yet.",
    detectedDate: "2026-08-11T14:31:00Z"
  },
  {
    id: "INC-1004",
    ruleCode: "SEC_ADMIN_ACCESS",
    ruleName: "Administrative Access Separation",
    severity: "Medium",
    username: "JSMITH",
    displayName: "John Smith",
    status: "Open",
    description: "User JSMITH holds IT Security Manager (access console) alongside AP Manager (business operation). This creates administrative overhead risk.",
    detectedDate: "2026-08-12T01:00:00Z"
  }
];

// Append programmatically generated risk violations to reach exactly 18 users with high-risk roles
// Let's add 15 more compliance risk warnings for users with administrative roles
const highRiskUsers = generatedUsers.filter(u => u.assignedRoles.includes('Security Administrator'));
for (let i = 0; i < 15; i++) {
  const user = highRiskUsers[i % highRiskUsers.length] || generatedUsers[i + 20];
  mockRiskIncidents.push({
    id: `INC-${1005 + i}`,
    ruleCode: "SEC_ADMIN_OVERLAP",
    ruleName: "System Administrative Privilege Exposure",
    severity: "High",
    username: user.userName,
    displayName: user.displayName,
    status: i % 2 === 0 ? "Open" : "Under Review",
    description: `User ${user.userName} has been assigned higher-risk database security or audit capabilities (ORA_SECURITY_ADMINISTRATOR). Immediate access verification required.`,
    detectedDate: new Date(Date.now() - i * 60 * 60 * 1000).toISOString()
  });
}

export const mockSoDConflicts: SoDConflict[] = [
  {
    id: "sod_rule_01",
    ruleCode: "SOD_AP_01",
    name: "Accounts Payable Invoice Segregation",
    description: "Ensures the same user cannot enter invoices and approve the same invoices to prevent fraudulent payouts.",
    severity: "High",
    conflictingRoleA: "Accounts Payable Invoice Creation Duty (ORA_AP_INVOICE_CREATION_DUTY)",
    conflictingRoleB: "Accounts Payable Invoice Approval Duty (ORA_AP_INVOICE_APPROVAL_DUTY)",
    violatingUsersCount: 2
  },
  {
    id: "sod_rule_02",
    ruleCode: "SOD_SEC_01",
    name: "Security Administration vs Audit Control",
    description: "Ensures the administrator configuring the security policies cannot also modify the audit log files.",
    severity: "Medium",
    conflictingRoleA: "IT Security Manager (ORA_IT_SECURITY_MANAGER)",
    conflictingRoleB: "Security Administrator (ORA_SECURITY_ADMINISTRATOR)",
    violatingUsersCount: 1
  }
];

export const mockAccessCertifications: AccessCertification[] = [
  {
    id: "cert_01",
    name: "Q3 Financial Operations Access Review",
    owner: "Emma Wilson",
    status: "In Progress",
    dueDate: "2026-09-30",
    completionRate: 45
  },
  {
    id: "cert_02",
    name: "Annual GRC Risk Control Certification",
    owner: "Alice Johnson",
    status: "Not Started",
    dueDate: "2026-12-15",
    completionRate: 0
  }
];
