# Oracle Fusion Security Assistant - API Mapping Document

This document maps representational business questions to NLU intents, controlled backend tools, Oracle Fusion Cloud REST API endpoints, and their integration status.

---

## Mapped & Active APIs (SCIM & Audit Service)

These queries are fully operational and query live Oracle Fusion API endpoints in **ORACLE_FUSION** mode, and draw from mock databases in **DEMO** mode.

| Business Question | NLU Intent | Backend Tool | Oracle Fusion Endpoint | Integration Status |
| :--- | :--- | :--- | :--- | :--- |
| *Who has the Advanced Access Controls Analyst role?* | `USERS_BY_ROLE` | `getUsersByRole(roleName)` | GET `/hcmRestApi/scim/Roles?filter=displayName eq "<roleName>"` | **Active** (Extracts from SCIM role members) |
| *Which roles are assigned to user JSMITH?* | `ROLES_BY_USER` | `getUser(userId)` | GET `/hcmRestApi/scim/Users/{userId}` | **Active** (Parses `roles` array in SCIM user response) |
| *List all users with the AP Manager role.* | `USERS_BY_ROLE` | `getUsersByRole(roleName)` | GET `/hcmRestApi/scim/Roles?filter=displayName eq "<roleName>"` | **Active** (Extracts members list) |
| *Search for user John.* | `LIST_USERS` | `getUsers(filterText)` | GET `/hcmRestApi/scim/Users?filter=...` | **Active** (Filters displayNames co input) |
| *Show audit history for user JSMITH.* | `AUDIT_HISTORY` | `getAuditHistory(username)` | POST `/fscmRestApi/fndAuditRESTService/audittrail/getaudithistory` | **Active** (Queries FSCM Audit History) |
| *Who modified a security role yesterday?* | `AUDIT_HISTORY` | `getAuditHistory()` | POST `/fscmRestApi/fndAuditRESTService/audittrail/getaudithistory` | **Active** (Queries logs with action filters) |
| *How many users / roles are in the system?* | `SECURITY_STATISTICS` | `getSecurityStatistics()` | GET SCIM `/Users` + `/Roles` count queries | **Active** (Displays totals on dashboard) |

---

## GRC & Security Console Integrations (Awaiting Client Configuration)

These capabilities are fully built out in the React Frontend and backend service stubs. In **Demo Mode**, they serve high-fidelity interactive trees and data. In **Oracle Fusion Mode**, they display detailed warning cards explaining the configuration dependency.

| Business Question | NLU Intent | Backend Tool | Proposed Oracle Endpoint / Method | Integration Status |
| :--- | :--- | :--- | :--- | :--- |
| *Show the complete hierarchy of role AP Manager.* | `ROLE_HIERARCHY` | `getRoleHierarchy(roleName)` | Oracle Security Console Service or custom BI Publisher report model | **Placeholder Alert** (SCIM Roles endpoint lacks tree resolution) |
| *Show privileges assigned to role AP Manager.* | `ROLE_PRIVILEGES` | `getPrivilegesForRole(roleName)` | Security Console SOAP / REST Web Service (`/hcmRestApi/resources/11.13.18.05/roles`) | **Placeholder Alert** (Requires custom data privilege mappings) |
| *Who has Accounts Payable access?* | `USER_ACCESS` | `getUsersByAccess(action)` | GRC Security Access Review APIs or BI Publisher extraction model | **Placeholder Alert** (Needs privilege hierarchy expansion client) |
| *Who can approve invoices?* | `USER_ACCESS` | `getUsersByAccess(action)` | GRC Transactions review model | **Placeholder Alert** (Needs privilege expansion) |
| *Show Segregation of Duties conflicts.* | `RISK_INFORMATION` | `getSoDConflicts()` | Oracle Risk Management Cloud Cloud REST APIs | **Placeholder Alert** (Requires GRC module licensing) |
| *Show compliance incidents / certifications.* | `RISK_INFORMATION` | `getRiskIncidents()` | Oracle Access Certification API | **Placeholder Alert** (Requires GRC module licensing) |
