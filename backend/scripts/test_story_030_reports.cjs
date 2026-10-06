const http = require('http');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 5104;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function makeRequest(method, path, body = null, token = null, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = { 'Content-Type': 'application/json', ...customHeaders };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const data = body ? JSON.stringify(body) : null;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {
          parsed = raw;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed,
          raw
        });
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('  VY-STRY-30: VEYRA Reports APIs (AC1 — AC11) Test Suite');
  console.log('================================================================\n');

  process.env.PORT = String(TEST_PORT);
  process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES = '5';
  process.env.ORACLE_BASE_URL = '';
  process.env.NODE_ENV = 'test';

  const express = require('express');
  const cors = require('cors');

  const distApi = path.join(__dirname, '../dist/routes/api.js');
  if (!fs.existsSync(distApi)) {
    console.error('Build output dist/routes/api.js not found! Please run npm run build first.');
    process.exit(1);
  }

  const { apiRouter } = require(distApi);
  const distAuth = path.join(__dirname, '../dist/services/authService.js');
  const { authService } = require(distAuth);
  authService._clearActiveSessions();

  const distReportDb = path.join(__dirname, '../dist/services/reportDbService.js');
  const { reportDbService } = require(distReportDb);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use('/api', apiRouter);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(TEST_PORT, resolve));
  console.log(`[Test Server] Running on http://127.0.0.1:${TEST_PORT}\n`);

  let testsPassed = 0;
  let testsFailed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      testsPassed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      testsFailed++;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // Setup Authenticated Test Sessions
    // -------------------------------------------------------------------------
    console.log('--- Step 0: Setup Authenticated Test Sessions ---');

    // 1. Site Admin
    const adminLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@admin.com',
      password: 'Admin@123'
    });
    const adminToken = adminLogin.data.token;
    assert(adminLogin.status === 200 && adminToken, 'Site Admin logged in successfully');

    // 2. Audit User 1 (reports-only)
    const auditUser1Login = await makeRequest('POST', '/api/auth/login', {
      email: 'audit.user@claaps.com',
      password: 'Password@123'
    });
    const auditUser1Token = auditUser1Login.data.token;
    assert(auditUser1Login.status === 200 && auditUser1Token, 'Audit User 1 logged in successfully');

    // 3. Audit Supervisor
    const supLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'supervisor.user@claaps.com',
      password: 'Password@123'
    });
    const supToken = supLogin.data.token;
    assert(supLogin.status === 200 && supToken, 'Audit Supervisor logged in successfully');

    // 4. Audit Manager
    const mgrLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'akash.meesarapu@claaps.com',
      password: 'Password@123'
    });
    const mgrToken = mgrLogin.data.token;
    assert(mgrLogin.status === 200 && mgrToken, 'Audit Manager logged in successfully');

    // 5. Create a restricted user WITHOUT REPORTS privilege for testing AC2
    const unprivilegedToken = authService.createSession({
      id: 'usr_no_reports_999',
      userId: 'usr_no_reports_999',
      email: 'no.reports@claaps.com',
      displayName: 'No Reports User',
      role: 'CUSTOM_OPERATOR',
      permissions: ['USERS_LIST'],
      isAdmin: false
    });
    assert(unprivilegedToken, 'Unprivileged user session created for RBAC testing');

    // 6. Create Audit User 2 for testing cross-user tampering protection (AC9)
    const auditUser2Token = authService.createSession({
      id: 'usr_audit_user_2_888',
      userId: 'usr_audit_user_2_888',
      email: 'audit.user2@claaps.com',
      displayName: 'Audit User Two',
      role: 'AUDIT_USER',
      permissions: ['REPORTS', 'REPORTS_READ'],
      isAdmin: false
    });
    assert(auditUser2Token, 'Audit User 2 session created for cross-user isolation testing');

    // -------------------------------------------------------------------------
    // AC1 — Authentication Enforcement Tests
    // -------------------------------------------------------------------------
    console.log('\n--- AC1: Authentication Enforcement Tests ---');

    const unauthGetReports = await makeRequest('GET', '/api/reports');
    assert(unauthGetReports.status === 401, 'GET /api/reports without token returns 401 Unauthorized (AC1)');

    const unauthGetReportById = await makeRequest('GET', '/api/reports/rep_role_hier_001');
    assert(unauthGetReportById.status === 401, 'GET /api/reports/:id without token returns 401 Unauthorized (AC1)');

    const unauthPostReport = await makeRequest('POST', '/api/reports', { reportType: 'USER_ACCESS' });
    assert(unauthPostReport.status === 401, 'POST /api/reports without token returns 401 Unauthorized (AC1)');

    const unauthDownload = await makeRequest('GET', '/api/reports/rep_role_hier_001/download');
    assert(unauthDownload.status === 401, 'GET /api/reports/:id/download without token returns 401 Unauthorized (AC1)');

    const invalidTokenRes = await makeRequest('GET', '/api/reports', null, 'invalid_token_xyz_999');
    assert(invalidTokenRes.status === 401, 'GET /api/reports with invalid token returns 401 Unauthorized (AC1)');

    // -------------------------------------------------------------------------
    // AC2 — Authorization & Privilege Validation Tests
    // -------------------------------------------------------------------------
    console.log('\n--- AC2: Authorization & Privilege Validation Tests ---');

    // Unprivileged user should be denied 403
    const unprivGet = await makeRequest('GET', '/api/reports', null, unprivilegedToken);
    assert(unprivGet.status === 403, 'User without REPORTS privilege gets 403 Forbidden on GET /api/reports (AC2)');

    const unprivPost = await makeRequest('POST', '/api/reports', { reportType: 'USER_ACCESS' }, unprivilegedToken);
    assert(unprivPost.status === 403, 'User without REPORTS privilege gets 403 Forbidden on POST /api/reports (AC2)');

    const unprivDownload = await makeRequest('GET', '/api/reports/rep_role_hier_001/download', null, unprivilegedToken);
    assert(unprivDownload.status === 403, 'User without REPORTS privilege gets 403 Forbidden on GET /api/reports/:id/download (AC2)');

    // Authorized roles/users should succeed 200
    const auditUserGet = await makeRequest('GET', '/api/reports', null, auditUser1Token);
    assert(auditUserGet.status === 200, 'Audit User gets 200 OK on GET /api/reports (AC2)');
    assert(auditUserGet.data.success === true, 'GET /api/reports response has success: true');

    const supGet = await makeRequest('GET', '/api/reports', null, supToken);
    assert(supGet.status === 200, 'Audit Supervisor gets 200 OK on GET /api/reports (AC2)');

    const mgrGet = await makeRequest('GET', '/api/reports', null, mgrToken);
    assert(mgrGet.status === 200, 'Audit Manager gets 200 OK on GET /api/reports (AC2)');

    const adminGet = await makeRequest('GET', '/api/reports', null, adminToken);
    assert(adminGet.status === 200, 'Site Admin gets 200 OK on GET /api/reports (AC2)');

    // -------------------------------------------------------------------------
    // AC3 & AC7 — Retrieval, Scope & Pagination Tests
    // -------------------------------------------------------------------------
    console.log('\n--- AC3 & AC7: Role-Aware Data & Pagination Tests ---');

    const listRes = await makeRequest('GET', '/api/reports?page=1&pageSize=3', null, auditUser1Token);
    assert(listRes.status === 200, 'Paginated GET /api/reports returns 200 OK (AC7)');
    assert(Array.isArray(listRes.data.reports), 'listRes.data.reports is an array');
    assert(Array.isArray(listRes.data.data), 'listRes.data.data is an array (compatibility alias)');
    assert(typeof listRes.data.total === 'number' && listRes.data.total > 0, `Total reports count returned: ${listRes.data.total}`);
    assert(listRes.data.page === 1, 'Page number is 1');
    assert(listRes.data.pageSize === 3, 'Page size is 3');
    assert(listRes.data.count <= 3, `Count (${listRes.data.count}) matches pageSize limit`);
    assert(typeof listRes.data.totalPages === 'number', `Total pages calculated: ${listRes.data.totalPages}`);
    assert(listRes.data.applicationScope === 'ORACLE_FUSION', 'Application scope bound to ORACLE_FUSION (AC3)');

    // Next page pagination
    const page2Res = await makeRequest('GET', '/api/reports?page=2&pageSize=2', null, auditUser1Token);
    assert(page2Res.status === 200, 'Page 2 retrieval returns 200 OK (AC7)');
    assert(page2Res.data.page === 2, 'Page 2 returns page: 2');

    // -------------------------------------------------------------------------
    // AC4 — Search Functionality Tests
    // -------------------------------------------------------------------------
    console.log('\n--- AC4: Report Search Tests ---');

    const searchRes = await makeRequest('GET', '/api/reports?search=Hierarchy', null, auditUser1Token);
    assert(searchRes.status === 200, 'Search query ?search=Hierarchy returns 200 OK (AC4)');
    assert(searchRes.data.reports.length > 0, 'Search returned matching reports');
    assert(searchRes.data.reports.every(r =>
      r.reportName.toLowerCase().includes('hierarchy') ||
      r.category.toLowerCase().includes('hierarchy') ||
      r.reportType.toLowerCase().includes('hierarchy')
    ), 'All search results contain search term (AC4)');

    const searchQRes = await makeRequest('GET', '/api/reports?q=SoD', null, auditUser1Token);
    assert(searchQRes.status === 200, 'Search query ?q=SoD returns 200 OK (AC4)');
    assert(searchQRes.data.reports.some(r => r.reportType.includes('SOD') || r.reportName.includes('SoD')), 'Found SoD report via ?q=');

    // -------------------------------------------------------------------------
    // AC5 — Category Filtering Tests
    // -------------------------------------------------------------------------
    console.log('\n--- AC5: Category Filtering Tests ---');

    const catRes = await makeRequest('GET', '/api/reports?category=Segregation of Duties (SoD)', null, auditUser1Token);
    assert(catRes.status === 200, 'Category filter returns 200 OK (AC5)');
    assert(catRes.data.reports.length > 0, 'Found reports in category "Segregation of Duties (SoD)"');
    assert(catRes.data.reports.every(r => r.category.includes('Segregation of Duties') || r.category === 'Segregation of Duties (SoD)'), 'All results belong to filtered category');

    const catCodeRes = await makeRequest('GET', '/api/reports?category=SOD', null, auditUser1Token);
    assert(catCodeRes.status === 200, 'Category alias ?category=SOD returns 200 OK (AC5)');
    assert(catCodeRes.data.reports.length > 0, 'Category alias matched SoD reports');

    // -------------------------------------------------------------------------
    // AC6 — Date Range Filtering Tests
    // -------------------------------------------------------------------------
    console.log('\n--- AC6: Date Range Filtering Tests ---');

    const rangeDaysRes = await makeRequest('GET', '/api/reports?rangeDays=30', null, auditUser1Token);
    assert(rangeDaysRes.status === 200, 'Filter ?rangeDays=30 returns 200 OK (AC6)');
    assert(rangeDaysRes.data.reports.length > 0, 'Reports returned for 30 day range');

    const dateRes = await makeRequest('GET', '/api/reports?startDate=2026-01-01&endDate=2026-12-31', null, auditUser1Token);
    assert(dateRes.status === 200, 'Filter with startDate and endDate returns 200 OK (AC6)');

    // -------------------------------------------------------------------------
    // AC8 — Report Generation Validation & Execution Tests
    // -------------------------------------------------------------------------
    console.log('\n--- AC8: Report Generation Tests ---');

    // Missing reportType -> 400
    const missingTypeRes = await makeRequest('POST', '/api/reports', {}, auditUser1Token);
    assert(missingTypeRes.status === 400, 'POST /api/reports without reportType returns 400 Bad Request (AC8, AC11)');
    assert(missingTypeRes.data.code === 'INVALID_PARAMETERS', 'Error code is INVALID_PARAMETERS');

    // Malformed parameters -> 400
    const badParamsRes = await makeRequest('POST', '/api/reports', {
      reportType: 'USER_ACCESS',
      parameters: 'not_an_object'
    }, auditUser1Token);
    assert(badParamsRes.status === 400, 'POST /api/reports with non-object parameters returns 400 Bad Request (AC8, AC11)');

    // Invalid format -> 400
    const badFormatRes = await makeRequest('POST', '/api/reports', {
      reportType: 'USER_ACCESS',
      format: 'INVALID_FORMAT_XYZ'
    }, auditUser1Token);
    assert(badFormatRes.status === 400, 'POST /api/reports with invalid format returns 400 Bad Request (AC8, AC11)');

    // Valid report generation by Audit User 1 (creates a USER-scoped report)
    const genRes = await makeRequest('POST', '/api/reports', {
      reportType: 'SOD_CONFLICTS',
      reportName: 'Audit User 1 Custom SoD Report',
      format: 'CSV',
      parameters: { severity: 'HIGH', department: 'FINANCE' },
      scopeType: 'USER'
    }, auditUser1Token);

    assert(genRes.status === 201, 'POST /api/reports returns 201 Created (AC8)');
    assert(genRes.data.success === true, 'Generation response has success: true');
    const createdReport = genRes.data.report;
    assert(createdReport && createdReport.reportId, `Report generated with ID: ${createdReport?.reportId}`);
    assert(createdReport.reportType === 'SOD_CONFLICTS', 'Generated report type is SOD_CONFLICTS');
    assert(createdReport.status === 'COMPLETED' || createdReport.status === 'READY', `Report status is ${createdReport.status}`);
    assert(createdReport.format === 'CSV', 'Report format is CSV');
    assert(typeof createdReport.sizeBytes === 'number' && createdReport.sizeBytes > 0, `Report sizeBytes calculated: ${createdReport.sizeBytes}`);
    assert(createdReport.downloadUrl.includes('/download'), 'downloadUrl points to download endpoint');

    // -------------------------------------------------------------------------
    // GET /api/reports/:id Single Report Lookup Tests
    // -------------------------------------------------------------------------
    console.log('\n--- GET /api/reports/:id Single Report Lookup Tests ---');

    const getSingleRes = await makeRequest('GET', `/api/reports/${createdReport.reportId}`, null, auditUser1Token);
    assert(getSingleRes.status === 200, 'GET /api/reports/:id returns 200 OK');
    assert(getSingleRes.data.report.reportId === createdReport.reportId, 'Report details matched requested ID');

    // Non-existent report -> 404
    const notFoundRes = await makeRequest('GET', '/api/reports/rep_non_existent_999999', null, auditUser1Token);
    assert(notFoundRes.status === 404, 'GET /api/reports/:id for non-existent report returns 404 Not Found (AC11)');
    assert(notFoundRes.data.code === 'NOT_FOUND', 'Error code is NOT_FOUND');

    // -------------------------------------------------------------------------
    // AC9 — Download & Anti-Tampering Authorization Tests
    // -------------------------------------------------------------------------
    console.log('\n--- AC9: Download & Cross-User Anti-Tampering Protection Tests ---');

    // 1. Download global report by Audit User 1
    const downloadGlobalRes = await makeRequest('GET', '/api/reports/rep_role_hier_001/download', null, auditUser1Token);
    assert(downloadGlobalRes.status === 200, 'GET /api/reports/:id/download for GLOBAL report returns 200 OK (AC9)');
    assert(downloadGlobalRes.headers['content-disposition']?.includes('attachment'), 'Content-Disposition header includes attachment');
    assert(downloadGlobalRes.raw && downloadGlobalRes.raw.length > 0, 'Report content is non-empty');

    // 2. Download with JSON mode
    const downloadJsonRes = await makeRequest('GET', '/api/reports/rep_role_hier_001/download?json=true', null, auditUser1Token);
    assert(downloadJsonRes.status === 200, 'GET /api/reports/:id/download?json=true returns 200 OK');
    assert(downloadJsonRes.data.success === true, 'JSON download response has success: true');
    assert(typeof downloadJsonRes.data.content === 'string', 'JSON download contains content string');

    // 3. Download own USER-scoped report by Audit User 1
    const downloadOwnRes = await makeRequest('GET', `/api/reports/${createdReport.reportId}/download`, null, auditUser1Token);
    assert(downloadOwnRes.status === 200, 'Owner can download their own USER-scoped report (AC9)');

    // 4. CRITICAL ANTI-TAMPERING TEST (AC9):
    // Audit User 2 attempts to download Audit User 1's USER-scoped report by tampering with ID
    const tamperRes = await makeRequest('GET', `/api/reports/${createdReport.reportId}/download`, null, auditUser2Token);
    assert(
      tamperRes.status === 403 || tamperRes.status === 404,
      `Cross-user ID tampering denied with ${tamperRes.status} (Forbidden/Not Found) (AC9)`
    );
    if (tamperRes.status === 403) {
      assert(tamperRes.data.code === 'FORBIDDEN', 'Tampering error code is FORBIDDEN');
    }

    // 5. Site Admin CAN download any report (Administrative Override)
    const adminDownloadRes = await makeRequest('GET', `/api/reports/${createdReport.reportId}/download`, null, adminToken);
    assert(adminDownloadRes.status === 200, 'Site Admin authorized to download report across scopes (AC3, AC9)');

    // -------------------------------------------------------------------------
    // AC10 — Audit Logging Tests
    // -------------------------------------------------------------------------
    console.log('\n--- AC10: Audit Trail Logging Tests ---');

    const auditLogPath = path.join(__dirname, '../oracle_audit.log');
    assert(fs.existsSync(auditLogPath), 'oracle_audit.log file exists');
    const logContent = fs.readFileSync(auditLogPath, 'utf8');

    assert(logContent.includes('REPORT_GENERATION'), 'Audit log contains REPORT_GENERATION event (AC10)');
    assert(logContent.includes('REPORT_DOWNLOAD'), 'Audit log contains REPORT_DOWNLOAD event (AC10)');
    assert(logContent.includes('REPORT_QUERY'), 'Audit log contains REPORT_QUERY event (AC10)');

    // -------------------------------------------------------------------------
    // AC11 — Comprehensive Controlled Error Handling Tests
    // -------------------------------------------------------------------------
    console.log('\n--- AC11: Controlled Application Error Handling Tests ---');

    // 1. Report not found on download
    const downloadNotFound = await makeRequest('GET', '/api/reports/rep_fake_id_12345/download', null, auditUser1Token);
    assert(downloadNotFound.status === 404, 'Download non-existent report returns 404 NOT_FOUND (AC11)');
    assert(downloadNotFound.data.code === 'NOT_FOUND', 'Response code is NOT_FOUND');

    // 2. Report not found on single detail
    const detailNotFound = await makeRequest('GET', '/api/reports/rep_fake_id_12345', null, auditUser1Token);
    assert(detailNotFound.status === 404, 'Detail non-existent report returns 404 NOT_FOUND (AC11)');

    // 3. Unauthorized access
    assert(unprivGet.status === 403 && unprivGet.data.code === 'FORBIDDEN', 'Unauthorized access returns structured 403 FORBIDDEN (AC11)');

    // 4. Invalid parameters
    assert(missingTypeRes.status === 400 && missingTypeRes.data.code === 'INVALID_PARAMETERS', 'Invalid parameters return structured 400 INVALID_PARAMETERS (AC11)');

    console.log('\n================================================================');
    console.log(`  TEST RESULTS: ${testsPassed} Passed, ${testsFailed} Failed`);
    console.log('================================================================\n');

    if (testsFailed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Unhandled test execution error:', err);
    process.exit(1);
  } finally {
    server.close();
  }
}

runTests();
