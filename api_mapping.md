# Oracle Fusion Security & Risk Intelligence - API Mapping Document

This document maps VEYRA business capabilities to the Oracle Fusion Cloud REST API endpoints used to serve them, and their integration status. All data access is deterministic and served directly by the backend API.

---

## Mapped & Active APIs (SCIM & Audit Service)

These queries are fully operational and query live Oracle Fusion API endpoints in **ORACLE_FUSION** mode, and draw from mock databases in **DEMO** mode.

| Business Capability | Oracle Fusion Endpoint | Integration Status |
| :--- | :--- | :--- |
| Users assigned to a role | GET `/hcmRestApi/scim/Roles?filter=displayName eq "<roleName>"` | **Active** (Extracts from SCIM role members) |
| Roles assigned to a user | GET `/hcmRestApi/scim/Users/{userId}` | **Active** (Parses `roles` array in SCIM user response) |
| User directory search | GET `/hcmRestApi/scim/Users?filter=...` | **Active** (Filters displayNames on input) |
| Audit history for a user | POST `/fscmRestApi/fndAuditRESTService/audittrail/getaudithistory` | **Active** (Queries FSCM Audit History) |
| Audit history by action/time | POST `/fscmRestApi/fndAuditRESTService/audittrail/getaudithistory` | **Active** (Queries logs with action filters) |
| Security statistics (user/role totals) | GET SCIM `/Users` + `/Roles` count queries | **Active** (Displays totals on dashboard) |

---

## GRC & Security Console Integrations (Awaiting Client Configuration)

These capabilities are fully built out in the React Frontend and backend service stubs. In **Demo Mode**, they serve high-fidelity interactive trees and data. In **Oracle Fusion Mode**, they display detailed warning cards explaining the configuration dependency.

| Business Capability | Proposed Oracle Endpoint / Method | Integration Status |
| :--- | :--- | :--- |
| Role hierarchy | Oracle Security Console Service or custom BI Publisher report model | **Placeholder Alert** (SCIM Roles endpoint lacks tree resolution) |
| Role privileges | Security Console SOAP / REST Web Service (`/hcmRestApi/resources/11.13.18.05/roles`) | **Placeholder Alert** (Requires custom data privilege mappings) |
| Users with a business capability | GRC Security Access Review APIs or BI Publisher extraction model | **Placeholder Alert** (Needs privilege hierarchy expansion client) |
| Users who can approve invoices | GRC Transactions review model | **Placeholder Alert** (Needs privilege expansion) |
| Segregation of Duties conflicts | Oracle Risk Management Cloud REST APIs | **Placeholder Alert** (Requires GRC module licensing) |
| Compliance incidents / certifications | Oracle Access Certification API | **Placeholder Alert** (Requires GRC module licensing) |
