import { query as dbQuery } from '../db.js';
import type { UserScopeContext } from './auditDashboardService.js';

export interface ReportQueryOptions {
  applicationScope?: string;
  scopeType?: 'GLOBAL' | 'APPLICATION' | 'USER' | 'TENANT';
  category?: string;
  reportType?: string;
  status?: 'COMPLETED' | 'PENDING' | 'FAILED' | 'READY';
  isMock?: boolean;
  limit?: number;
  offset?: number;
}

export interface ReportRecord {
  id?: string;
  reportId: string;
  reportName: string;
  reportType: string;
  category: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'READY';
  format: 'PDF' | 'EXCEL' | 'CSV' | 'JSON';
  sizeBytes?: number;
  downloadUrl?: string;
  generatedBy: string;
  userId?: string | null;
  scopeType: 'GLOBAL' | 'APPLICATION' | 'USER' | 'TENANT';
  scopeId?: string | null;
  applicationScope: string;
  isMock: boolean;
  generatedAt: string | Date;
}

export interface ReportDbQueryResult {
  success: boolean;
  count: number;
  applicationScope: string;
  reports: ReportRecord[];
}

export class ReportDbService {
  private readonly defaultAppScope = 'ORACLE_FUSION';
  private readonly authorizedAppScopes = ['ORACLE_FUSION'];

  /**
   * Enforces role and privilege authorization for Reports access (AC1, AC2).
   * Verifies AUDIT_USER is authorized solely for REPORTS and does not inherit other privileges.
   */
  public validateReportAuthorization(userContext: UserScopeContext): { authorized: boolean; reason?: string } {
    if (!userContext) {
      return { authorized: false, reason: 'Authentication required' };
    }

    const role = (userContext.role || '').toUpperCase();
    const permissions = (userContext.permissions || []).map((p) => p.toUpperCase());
    const isAdmin = userContext.isAdmin === true || role === 'SITE_ADMIN' || permissions.includes('ALL');

    if (isAdmin) {
      return { authorized: true };
    }

    // Role-based authorization: AUDIT_USER, AUDIT_SUPERVISOR, AUDIT_MANAGER are permitted to access reports
    if (role === 'AUDIT_USER' || role === 'AUDIT_SUPERVISOR' || role === 'AUDIT_MANAGER') {
      return { authorized: true };
    }

    // Privilege-based authorization
    const hasReportsPrivilege = permissions.some((p) =>
      ['REPORTS', 'REPORTS_READ', 'REPORTS_MANAGE'].includes(p)
    );

    if (hasReportsPrivilege) {
      return { authorized: true };
    }

    return {
      authorized: false,
      reason: 'Access denied. REPORTS privilege required.'
    };
  }

  /**
   * Resolves and bounds user and application scope, preventing scope bypass or parameter tampering (AC4).
   */
  public resolveAuthorizedScope(
    userContext: UserScopeContext,
    options?: ReportQueryOptions
  ): { applicationScope: string; scopeType: string; userId: string | null } {
    const role = (userContext.role || '').toUpperCase();
    const isAdmin = userContext.isAdmin === true || role === 'SITE_ADMIN';

    // Application scope: strictly bound to authorized application scopes
    let applicationScope = (options?.applicationScope || this.defaultAppScope).trim().toUpperCase();
    if (!this.authorizedAppScopes.includes(applicationScope)) {
      applicationScope = this.defaultAppScope;
    }

    // Scope type: defaults to GLOBAL
    const scopeType = options?.scopeType || 'GLOBAL';

    // User scope: non-admins cannot query reports scoped to another user
    let userId: string | null = null;
    if (userContext.userId) {
      userId = userContext.userId;
    }

    return { applicationScope, scopeType, userId };
  }

  /**
   * Queries report records from PostgreSQL veyra_report using parameterized SQL and scope filters (AC3, AC4, AC5).
   */
  public async queryReports(
    userContext: UserScopeContext,
    options?: ReportQueryOptions
  ): Promise<ReportDbQueryResult> {
    const auth = this.validateReportAuthorization(userContext);
    if (!auth.authorized) {
      throw new Error(auth.reason || 'Forbidden: Unauthorized to query report data.');
    }

    const { applicationScope, userId } = this.resolveAuthorizedScope(userContext, options);
    const isMock = options?.isMock ?? false;
    const limit = Math.min(Math.max(options?.limit || 20, 1), 100);
    const offset = Math.max(options?.offset || 0, 0);

    const res = await dbQuery(
      `SELECT id, report_id AS "reportId", report_name AS "reportName",
              report_type AS "reportType", category, status, format,
              size_bytes AS "sizeBytes", download_url AS "downloadUrl",
              generated_by AS "generatedBy", user_id AS "userId",
              scope_type AS "scopeType", scope_id AS "scopeId",
              application_scope AS "applicationScope", is_mock AS "isMock",
              generated_at AS "generatedAt"
       FROM veyra_report
       WHERE application_scope = $1
         AND is_mock = $2
         AND (
           scope_type = 'GLOBAL'
           OR (scope_type = 'APPLICATION' AND application_scope = $1)
           OR (scope_type = 'USER' AND user_id = $3::uuid)
         )
         AND ($4::varchar IS NULL OR category = $4)
         AND ($5::varchar IS NULL OR report_type = $5)
         AND ($6::varchar IS NULL OR status = $6)
       ORDER BY generated_at DESC
       LIMIT $7 OFFSET $8`,
      [
        applicationScope,
        isMock,
        userId || null,
        options?.category || null,
        options?.reportType || null,
        options?.status || null,
        limit,
        offset
      ]
    );

    const reports: ReportRecord[] = res.rows.map((row: any) => ({
      id: row.id,
      reportId: row.reportId,
      reportName: row.reportName,
      reportType: row.reportType,
      category: row.category,
      status: row.status,
      format: row.format,
      sizeBytes: Number(row.sizeBytes || 0),
      downloadUrl: row.downloadUrl,
      generatedBy: row.generatedBy,
      userId: row.userId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      applicationScope: row.applicationScope,
      isMock: row.isMock,
      generatedAt: row.generatedAt
    }));

    return {
      success: true,
      count: reports.length,
      applicationScope,
      reports
    };
  }

  /**
   * Retrieves a single report record by reportId with scope validation.
   */
  public async getReportById(
    userContext: UserScopeContext,
    reportId: string
  ): Promise<ReportRecord | null> {
    const auth = this.validateReportAuthorization(userContext);
    if (!auth.authorized) {
      throw new Error(auth.reason || 'Forbidden: Unauthorized to query report data.');
    }

    const { applicationScope, userId } = this.resolveAuthorizedScope(userContext);

    const res = await dbQuery(
      `SELECT id, report_id AS "reportId", report_name AS "reportName",
              report_type AS "reportType", category, status, format,
              size_bytes AS "sizeBytes", download_url AS "downloadUrl",
              generated_by AS "generatedBy", user_id AS "userId",
              scope_type AS "scopeType", scope_id AS "scopeId",
              application_scope AS "applicationScope", is_mock AS "isMock",
              generated_at AS "generatedAt"
       FROM veyra_report
       WHERE report_id = $1
         AND application_scope = $2
         AND (
           scope_type = 'GLOBAL'
           OR (scope_type = 'APPLICATION' AND application_scope = $2)
           OR (scope_type = 'USER' AND user_id = $3::uuid)
         )
       LIMIT 1`,
      [reportId, applicationScope, userId || null]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return {
      id: row.id,
      reportId: row.reportId,
      reportName: row.reportName,
      reportType: row.reportType,
      category: row.category,
      status: row.status,
      format: row.format,
      sizeBytes: Number(row.sizeBytes || 0),
      downloadUrl: row.downloadUrl,
      generatedBy: row.generatedBy,
      userId: row.userId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      applicationScope: row.applicationScope,
      isMock: row.isMock,
      generatedAt: row.generatedAt
    };
  }

  /**
   * Inserts a report record into PostgreSQL veyra_report using parameterized SQL.
   */
  public async createReportRecord(record: Partial<ReportRecord>): Promise<ReportRecord> {
    const res = await dbQuery(
      `INSERT INTO veyra_report (
         report_id, report_name, report_type, category, status, format,
         size_bytes, download_url, generated_by, user_id, scope_type,
         scope_id, application_scope, is_mock, generated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, report_id AS "reportId", report_name AS "reportName",
                 report_type AS "reportType", category, status, format,
                 size_bytes AS "sizeBytes", download_url AS "downloadUrl",
                 generated_by AS "generatedBy", user_id AS "userId",
                 scope_type AS "scopeType", scope_id AS "scopeId",
                 application_scope AS "applicationScope", is_mock AS "isMock",
                 generated_at AS "generatedAt"`,
      [
        record.reportId,
        record.reportName,
        record.reportType,
        record.category,
        record.status || 'COMPLETED',
        record.format || 'PDF',
        record.sizeBytes || 0,
        record.downloadUrl || null,
        record.generatedBy || 'system_scheduler',
        record.userId || null,
        record.scopeType || 'GLOBAL',
        record.scopeId || null,
        record.applicationScope || this.defaultAppScope,
        record.isMock ?? false,
        record.generatedAt ? new Date(record.generatedAt) : new Date()
      ]
    );

    const row = res.rows[0];
    return {
      id: row.id,
      reportId: row.reportId,
      reportName: row.reportName,
      reportType: row.reportType,
      category: row.category,
      status: row.status,
      format: row.format,
      sizeBytes: Number(row.sizeBytes || 0),
      downloadUrl: row.downloadUrl,
      generatedBy: row.generatedBy,
      userId: row.userId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      applicationScope: row.applicationScope,
      isMock: row.isMock,
      generatedAt: row.generatedAt
    };
  }
}

export const reportDbService = new ReportDbService();
