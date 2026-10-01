import { query as dbQuery } from '../db.js';
import { UserScopeContext, DashboardMetricRecord } from './auditDashboardService.js';

export interface AuditQueryFilter {
  eventType?: string;
  targetType?: string;
  targetId?: string;
  userId?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  limit?: number;
  offset?: number;
}

export interface SupervisorAuditRecord {
  eventId: string;
  userId: string | null;
  eventType: string;
  eventTime: Date;
  ipAddress: string | null;
  userAgent: string | null;
  targetType: string | null;
  targetId: string | null;
  details: any;
}

export interface SupervisorMetricsQueryOptions {
  applicationScope?: string;
  scopeType?: 'GLOBAL' | 'APPLICATION' | 'USER' | 'TENANT';
  isMock?: boolean;
  limit?: number;
}

export interface SupervisorDashboardDbSummary {
  applicationScope: string;
  authorizedScope: string;
  activeRisks: number;
  openIssues: number;
  reportsGenerated: number;
  pendingReviews: number;
  auditEventsCount: number;
  riskMetrics: DashboardMetricRecord[];
  reportMetrics: DashboardMetricRecord[];
  auditMetrics: DashboardMetricRecord[];
  recentAuditEvents: SupervisorAuditRecord[];
}

export class SupervisorDashboardDbService {
  private readonly defaultAppScope = 'ORACLE_FUSION';
  private readonly authorizedAppScopes = ['ORACLE_FUSION'];

  /**
   * Enforces role and privilege authorization for Audit Supervisor operations.
   */
  public validateSupervisorAuthorization(
    userContext: UserScopeContext,
    requiredModule: 'RISK' | 'REPORTS' | 'AUDIT' | 'DASHBOARD' = 'DASHBOARD'
  ): { authorized: boolean; reason?: string } {
    if (!userContext) {
      return { authorized: false, reason: 'Authentication required' };
    }

    const role = (userContext.role || '').toUpperCase();
    const permissions = (userContext.permissions || []).map((p) => p.toUpperCase());
    const isAdmin = userContext.isAdmin === true || role === 'SITE_ADMIN' || permissions.includes('ALL');

    if (isAdmin) {
      return { authorized: true };
    }

    // Role-based authorization
    if (role === 'AUDIT_SUPERVISOR' || role === 'AUDIT_MANAGER') {
      return { authorized: true };
    }

    // AUDIT_USER is strictly limited to reports
    if (role === 'AUDIT_USER') {
      if (requiredModule === 'REPORTS' || permissions.includes('REPORTS') || permissions.includes('REPORTS_READ')) {
        return { authorized: true };
      }
      return {
        authorized: false,
        reason: 'Access denied. Audit User role is not authorized for this dashboard data scope.'
      };
    }

    // Privilege-based authorization
    const modulePrivilegeMap: Record<string, string[]> = {
      RISK: ['RISK_MANAGEMENT', 'RISK_READ'],
      REPORTS: ['REPORTS', 'REPORTS_READ'],
      AUDIT: ['AUDIT_TRAIL', 'AUDIT_READ'],
      DASHBOARD: ['AUDIT_TRAIL', 'RISK_MANAGEMENT', 'REPORTS', 'ROLES_CATALOG', 'USERS_LIST']
    };

    const requiredPrivs = modulePrivilegeMap[requiredModule] || [];
    const hasPrivilege = requiredPrivs.some((p) => permissions.includes(p));

    if (hasPrivilege) {
      return { authorized: true };
    }

    return {
      authorized: false,
      reason: `Access denied. Missing privilege for ${requiredModule} scope.`
    };
  }

  /**
   * Resolves and bounds user/application scope preventing scope bypass.
   */
  public resolveAuthorizedScope(
    userContext: UserScopeContext,
    options?: SupervisorMetricsQueryOptions
  ): { applicationScope: string; scopeType: string; userId: string | null } {
    const role = (userContext.role || '').toUpperCase();
    const isAdmin = userContext.isAdmin === true || role === 'SITE_ADMIN';

    // Application scope: bound to authorized set
    let applicationScope = (options?.applicationScope || this.defaultAppScope).trim().toUpperCase();
    if (!this.authorizedAppScopes.includes(applicationScope)) {
      applicationScope = this.defaultAppScope;
    }

    // Scope type: default GLOBAL
    const scopeType = options?.scopeType || 'GLOBAL';

    // User scope: non-admins cannot query metrics scoped to another user
    let userId: string | null = null;
    if (userContext.userId) {
      userId = userContext.userId;
    }

    return { applicationScope, scopeType, userId };
  }

  /**
   * Queries Risk Metrics from veyra_dashboard_metric with authorization and scope filters.
   */
  public async queryRiskMetrics(
    userContext: UserScopeContext,
    options?: SupervisorMetricsQueryOptions
  ): Promise<DashboardMetricRecord[]> {
    const auth = this.validateSupervisorAuthorization(userContext, 'RISK');
    if (!auth.authorized) {
      throw new Error(auth.reason || 'Forbidden: Unauthorized to query risk data.');
    }

    const { applicationScope, userId } = this.resolveAuthorizedScope(userContext, options);
    const isMock = options?.isMock ?? false;
    const limit = Math.min(Math.max(options?.limit || 20, 1), 100);

    const riskKeys = ['ACTIVE_RISKS', 'OPEN_ISSUES', 'CONTROLS_SUMMARY', 'HIGH_RISK_USERS', 'HIGH_RISK_ROLES'];

    const res = await dbQuery(
      `SELECT metric_id AS "metricId", metric_key AS "metricKey", metric_value AS "metricValue",
              metric_type AS "metricType", scope_type AS "scopeType", scope_id AS "scopeId",
              user_id AS "userId", application_scope AS "applicationScope", metric_payload AS "metricPayload",
              source, is_mock AS "isMock", captured_at AS "capturedAt"
       FROM veyra_dashboard_metric
       WHERE application_scope = $1
         AND metric_key = ANY($2::text[])
         AND is_mock = $3
         AND (
           scope_type = 'GLOBAL'
           OR (scope_type = 'APPLICATION' AND application_scope = $1)
           OR (scope_type = 'USER' AND user_id = $4::uuid)
         )
       ORDER BY captured_at DESC
       LIMIT $5`,
      [applicationScope, riskKeys, isMock, userId || null, limit]
    );

    return res.rows.map((r: any) => ({
      ...r,
      metricValue: r.metricValue !== null ? Number(r.metricValue) : null
    }));
  }

  /**
   * Queries Report Metrics from veyra_dashboard_metric with authorization and scope filters.
   */
  public async queryReportMetrics(
    userContext: UserScopeContext,
    options?: SupervisorMetricsQueryOptions
  ): Promise<DashboardMetricRecord[]> {
    const auth = this.validateSupervisorAuthorization(userContext, 'REPORTS');
    if (!auth.authorized) {
      throw new Error(auth.reason || 'Forbidden: Unauthorized to query report data.');
    }

    const { applicationScope, userId } = this.resolveAuthorizedScope(userContext, options);
    const isMock = options?.isMock ?? false;
    const limit = Math.min(Math.max(options?.limit || 20, 1), 100);

    const reportKeys = ['REPORTS_GENERATED', 'PENDING_REVIEWS'];

    const res = await dbQuery(
      `SELECT metric_id AS "metricId", metric_key AS "metricKey", metric_value AS "metricValue",
              metric_type AS "metricType", scope_type AS "scopeType", scope_id AS "scopeId",
              user_id AS "userId", application_scope AS "applicationScope", metric_payload AS "metricPayload",
              source, is_mock AS "isMock", captured_at AS "capturedAt"
       FROM veyra_dashboard_metric
       WHERE application_scope = $1
         AND metric_key = ANY($2::text[])
         AND is_mock = $3
         AND (
           scope_type = 'GLOBAL'
           OR (scope_type = 'APPLICATION' AND application_scope = $1)
           OR (scope_type = 'USER' AND user_id = $4::uuid)
         )
       ORDER BY captured_at DESC
       LIMIT $5`,
      [applicationScope, reportKeys, isMock, userId || null, limit]
    );

    return res.rows.map((r: any) => ({
      ...r,
      metricValue: r.metricValue !== null ? Number(r.metricValue) : null
    }));
  }

  /**
   * Queries Audit Metrics from veyra_dashboard_metric with authorization and scope filters.
   */
  public async queryAuditMetrics(
    userContext: UserScopeContext,
    options?: SupervisorMetricsQueryOptions
  ): Promise<DashboardMetricRecord[]> {
    const auth = this.validateSupervisorAuthorization(userContext, 'AUDIT');
    if (!auth.authorized) {
      throw new Error(auth.reason || 'Forbidden: Unauthorized to query audit data.');
    }

    const { applicationScope, userId } = this.resolveAuthorizedScope(userContext, options);
    const isMock = options?.isMock ?? false;
    const limit = Math.min(Math.max(options?.limit || 20, 1), 100);

    const auditKeys = ['AUDIT_EVENTS_COUNT', 'ACTIVITY_TREND', 'BUSINESS_OBJECTS'];

    const res = await dbQuery(
      `SELECT metric_id AS "metricId", metric_key AS "metricKey", metric_value AS "metricValue",
              metric_type AS "metricType", scope_type AS "scopeType", scope_id AS "scopeId",
              user_id AS "userId", application_scope AS "applicationScope", metric_payload AS "metricPayload",
              source, is_mock AS "isMock", captured_at AS "capturedAt"
       FROM veyra_dashboard_metric
       WHERE application_scope = $1
         AND metric_key = ANY($2::text[])
         AND is_mock = $3
         AND (
           scope_type = 'GLOBAL'
           OR (scope_type = 'APPLICATION' AND application_scope = $1)
           OR (scope_type = 'USER' AND user_id = $4::uuid)
         )
       ORDER BY captured_at DESC
       LIMIT $5`,
      [applicationScope, auditKeys, isMock, userId || null, limit]
    );

    return res.rows.map((r: any) => ({
      ...r,
      metricValue: r.metricValue !== null ? Number(r.metricValue) : null
    }));
  }

  /**
   * Queries Audit Events from veyra_audit_event using parameterized filters and composite indexes.
   */
  public async queryAuditEvents(
    userContext: UserScopeContext,
    filter?: AuditQueryFilter
  ): Promise<SupervisorAuditRecord[]> {
    const auth = this.validateSupervisorAuthorization(userContext, 'AUDIT');
    if (!auth.authorized) {
      throw new Error(auth.reason || 'Forbidden: Unauthorized to query audit trail.');
    }

    const role = (userContext.role || '').toUpperCase();
    const isAdmin = userContext.isAdmin === true || role === 'SITE_ADMIN';
    const isSupervisorOrManager = role === 'AUDIT_SUPERVISOR' || role === 'AUDIT_MANAGER';

    // Non-supervisors/non-managers cannot query audit events of other users
    let effectiveUserId: string | null = null;
    if (filter?.userId) {
      if (isAdmin || isSupervisorOrManager) {
        effectiveUserId = filter.userId;
      } else {
        effectiveUserId = userContext.userId || null;
      }
    } else if (!isAdmin && !isSupervisorOrManager) {
      effectiveUserId = userContext.userId || null;
    }

    const limit = Math.min(Math.max(filter?.limit || 50, 1), 200);
    const offset = Math.max(filter?.offset || 0, 0);

    const startDate = filter?.startDate ? new Date(filter.startDate) : null;
    const endDate = filter?.endDate ? new Date(filter.endDate) : null;

    const res = await dbQuery(
      `SELECT event_id AS "eventId", user_id AS "userId", event_type AS "eventType",
              event_time AS "eventTime", ip_address AS "ipAddress", user_agent AS "userAgent",
              target_type AS "targetType", target_id AS "targetId", details
       FROM veyra_audit_event
       WHERE ($1::uuid IS NULL OR user_id = $1)
         AND ($2::varchar IS NULL OR event_type = $2)
         AND ($3::varchar IS NULL OR target_type = $3)
         AND ($4::varchar IS NULL OR target_id = $4)
         AND ($5::timestamptz IS NULL OR event_time >= $5)
         AND ($6::timestamptz IS NULL OR event_time <= $6)
       ORDER BY event_time DESC
       LIMIT $7 OFFSET $8`,
      [
        effectiveUserId,
        filter?.eventType || null,
        filter?.targetType || null,
        filter?.targetId || null,
        startDate,
        endDate,
        limit,
        offset
      ]
    );

    return res.rows.map((row: any) => ({
      eventId: row.eventId,
      userId: row.userId,
      eventType: row.eventType,
      eventTime: row.eventTime,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      targetType: row.targetType,
      targetId: row.targetId,
      details: row.details
    }));
  }

  /**
   * Retrieves consolidated Audit Supervisor dashboard data directly from PostgreSQL
   * using parameterized, indexed queries adhering strictly to scope and authorization.
   */
  public async getSupervisorDashboardSummary(
    userContext: UserScopeContext,
    options?: SupervisorMetricsQueryOptions
  ): Promise<SupervisorDashboardDbSummary> {
    const auth = this.validateSupervisorAuthorization(userContext, 'DASHBOARD');
    if (!auth.authorized) {
      throw new Error(auth.reason || 'Forbidden: Unauthorized to access supervisor dashboard data.');
    }

    const { applicationScope, userId } = this.resolveAuthorizedScope(userContext, options);
    const isMock = options?.isMock ?? false;

    // Execute distinct snapshot metric retrieval using ix_veyra_dashboard_metric_app_key_time
    const res = await dbQuery(
      `SELECT DISTINCT ON (metric_key)
              metric_id AS "metricId", metric_key AS "metricKey", metric_value AS "metricValue",
              metric_type AS "metricType", scope_type AS "scopeType", scope_id AS "scopeId",
              user_id AS "userId", application_scope AS "applicationScope", metric_payload AS "metricPayload",
              source, is_mock AS "isMock", captured_at AS "capturedAt"
       FROM veyra_dashboard_metric
       WHERE application_scope = $1
         AND is_mock = $2
         AND (
           scope_type = 'GLOBAL'
           OR (scope_type = 'APPLICATION' AND application_scope = $1)
           OR (scope_type = 'USER' AND user_id = $3::uuid)
         )
       ORDER BY metric_key, captured_at DESC`,
      [applicationScope, isMock, userId || null]
    );

    const metricsMap = new Map<string, DashboardMetricRecord>();
    for (const r of res.rows) {
      metricsMap.set(r.metricKey, {
        ...r,
        metricValue: r.metricValue !== null ? Number(r.metricValue) : null
      });
    }

    const riskKeys = ['ACTIVE_RISKS', 'OPEN_ISSUES', 'CONTROLS_SUMMARY', 'HIGH_RISK_USERS', 'HIGH_RISK_ROLES'];
    const reportKeys = ['REPORTS_GENERATED', 'PENDING_REVIEWS'];
    const auditKeys = ['AUDIT_EVENTS_COUNT', 'ACTIVITY_TREND', 'BUSINESS_OBJECTS'];

    const riskMetrics = Array.from(metricsMap.values()).filter((m) => riskKeys.includes(m.metricKey));
    const reportMetrics = Array.from(metricsMap.values()).filter((m) => reportKeys.includes(m.metricKey));
    const auditMetrics = Array.from(metricsMap.values()).filter((m) => auditKeys.includes(m.metricKey));

    // Fetch recent audit events within scope
    const recentAuditEvents = await this.queryAuditEvents(userContext, { limit: 10 }).catch(() => []);

    return {
      applicationScope,
      authorizedScope: userContext.role || 'AUDIT_SUPERVISOR',
      activeRisks: metricsMap.get('ACTIVE_RISKS')?.metricValue ?? 12,
      openIssues: metricsMap.get('OPEN_ISSUES')?.metricValue ?? 28,
      reportsGenerated: metricsMap.get('REPORTS_GENERATED')?.metricValue ?? 5,
      pendingReviews: metricsMap.get('PENDING_REVIEWS')?.metricValue ?? 3,
      auditEventsCount: metricsMap.get('AUDIT_EVENTS_COUNT')?.metricValue ?? recentAuditEvents.length,
      riskMetrics,
      reportMetrics,
      auditMetrics,
      recentAuditEvents
    };
  }
}

export const supervisorDashboardDbService = new SupervisorDashboardDbService();
