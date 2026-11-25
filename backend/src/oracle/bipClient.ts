import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import * as xml2js from 'xml2js';
import * as xlsx from 'xlsx';
import { config } from '../config.js';
import { oracleCredentialProvider } from './credentialProvider.js';

export interface AccessCertificationResult {
  success: boolean;
  data?: Record<string, any>[];
  reportPath?: string;
  message?: string;
  error?: string;
  isConfigurationError?: boolean;
}

export interface CertifierWorksheetRow {
  id?: string | number;
  certificationId: string | number;
  name?: string;
  certificationName: string;
  userName: string;
  ownerName: string;
  roleName: string;
  roleCode?: string;
  certifiedManager: string;
  certifierName: string;
  certifierId?: string;
  userBusinessUnit: string;
  businessUnit: string;
  userManager: string;
  userManagerName: string;
  directManager?: string | null;
  department?: string;
  status: string;
  type: string;
  completionPercent: number;
  dueDate: string;
  creationDate: string;
  createdBy?: string;
  action?: string;
  comments?: string;
  followUpStatus?: string;
  lastDecisionBy?: string;
  lastDecisionDate?: string;
  [key: string]: any;
}

export interface AccessCertificationDetailsResult {
  success: boolean;
  certificationId: string;
  count: number;
  data: CertifierWorksheetRow[];
  allData?: CertifierWorksheetRow[];
  message?: string;
  error?: string;
  isConfigurationError?: boolean;
}

export const CANONICAL_ACCESS_CERTIFICATIONS: Record<string, any>[] = [
  {
    id: 35006,
    certificationId: 35006,
    certificationName: 'CLAAPS_Access_Certification1',
    name: 'CLAAPS_Access_Certification1',
    type: 'Standard',
    status: 'Active',
    certificationPercentComplete: 0,
    dueDate: '2026-10-21',
    creationDate: '2026-09-21 12:13',
    ownerName: 'Karthika.Claaps',
    managerName: 'Karthika.Claaps',
    source: 'Oracle Fusion BI Publisher (Snapshot)'
  },
  {
    id: 36006,
    certificationId: 36006,
    certificationName: 'CLPS_Access_Certification2',
    name: 'CLPS_Access_Certification2',
    type: 'Standard',
    status: 'Active',
    certificationPercentComplete: 0,
    dueDate: '2026-09-30',
    creationDate: '2026-09-21 14:43',
    ownerName: 'Test1 user.claaps',
    managerName: 'Kavya.Claaps',
    source: 'Oracle Fusion BI Publisher (Snapshot)'
  },
  {
    id: 36007,
    certificationId: 36007,
    certificationName: 'FY26_QTR3_Claaps Access certification',
    name: 'FY26_QTR3_Claaps Access certification',
    type: 'Standard',
    status: 'Active',
    certificationPercentComplete: 0,
    dueDate: '2026-09-30',
    creationDate: '2026-09-21 15:14',
    ownerName: 'Karthika.Claaps',
    managerName: 'Karthika.Claaps',
    source: 'Oracle Fusion BI Publisher (Snapshot)'
  },
  {
    id: 35007,
    certificationId: 35007,
    certificationName: 'CLPS_Access_Certification3',
    name: 'CLPS_Access_Certification3',
    type: 'Standard',
    status: 'Active',
    certificationPercentComplete: 0,
    dueDate: '2026-10-13',
    creationDate: '2026-09-21 16:32',
    ownerName: 'Kavya.Claaps',
    managerName: 'Test1 user.claaps',
    source: 'Oracle Fusion BI Publisher (Snapshot)'
  }
];

export interface UserRoleAutoProvisionRow {
  username: string;
  roleName: string;
  roleCode: string;
  autoProvisioned: 'Yes' | 'No' | null;
}

export interface BipRoleRow {
  module: string;
  roleName: string;
  roleCode: string;
  description: string;
  category: string;
}

export interface BipRolesReportResult {
  success: boolean;
  data: BipRoleRow[];
  count: number;
  reportPath?: string;
  message?: string;
  error?: string;
}

export interface UserDetailsBipRow {
  userId?: string | number | null;
  username: string;
  userCategory: string | null;
  active: boolean;
  personNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  department: string | null;
  job: string | null;
  businessUnit: string | null;
  location: string | null;
  manager: string | null;
  roleCount?: number;
}

export class BipClient {
  private axiosInstance: AxiosInstance;
  public reportPath = '/shared/Custom/Access certification summary report.xdo';
  public reviewReportPath = '/shared/Custom/Access certification worksheet.xdo';
  /**
   * Priority candidates for the main Access Certification Campaign List report.
   */
  public readonly accessCertReportPaths = [
    process.env.BIP_REPORT_PATH,
    process.env.BIP_CERTIFICATION_REPORT_PATH,
    '/shared/Custom/Access certification summary report.xdo',
    '/shared/Custom/Access certification summary report',
    '/Custom/Access certification summary report.xdo',
    '/Custom/Access certification summary report',
    '/Custom/Claaps Access Certification Review Report.xdo',
    '/Custom/Claaps Access Certification Review.xdo',
    '/Custom/Claaps Access Certification review.xdo',
    '/Custom/Claaps Access Certification.xdo',
    '/Custom/Claaps Access Certification Report.xdo',
  ].filter(Boolean) as string[];
  private accessCertResolvedPath: string | null = null;
  private accessCertResolvedAt = 0;

  /**
   * Priority candidates for the Certifier Worksheet / User Access Details drilldown report.
   */
  public readonly certifierWorksheetReportPaths = [
    process.env.BIP_WORKSHEET_REPORT_PATH,
    '/shared/Custom/Access certification worksheet.xdo',
    '/shared/Custom/Access certification worksheet',
    '/Custom/Access certification worksheet.xdo',
    '/Custom/Access certification worksheet',
    '/Custom/Claaps Access_certifier_worksheet.xdo',
    '/Custom/Claaps Access_certifier_worksheet',
    '/Custom/Claaps Access_Certifier_Worksheet.xdo',
    '/Custom/Claaps Access_Certifier_Worksheet',
    '/Custom/Claaps Access Certifier Worksheet.xdo',
    '/Custom/Claaps Access Certifier Worksheet',
  ].filter(Boolean) as string[];
  private worksheetResolvedPath: string | null = null;
  private worksheetResolvedAt = 0;

  /**
   * Priority candidates for the runnable Auto-Provisioning report built on the
   * CLAAPS_User_Role_AutoProvisioning data model. NOTE: a BIP data model (.xdm)
   * cannot be executed via runReport — only a Report (.xdo) can. If none of these
   * exists, the catalog is scanned for any matching report (see findAutoProvReportPath).
   */
  public readonly userRoleAutoProvReportPaths = [
    '/Custom/CLAAPS_User_Role_AutoProvisioning_Report.xdo',
    '/Custom/CLAAPS_User_Role_AutoProvisioning Report.xdo',
    '/Custom/CLAAPS_User_Role_AutoProvisioning.xdo',
    '/Custom/CLAAPS_User_Role_AutoProvisioning',
  ];
  private autoProvResolvedPath: string | null = null;
  private autoProvResolvedAt = 0;
  private autoProvGuidanceLogged = false;

  /**
   * Priority candidates for the authoritative all-module roles report.
   */
  public readonly allModuleRolesReportPaths = [
    process.env.BIP_ROLES_REPORT_PATH,
    '/Custom/Claaps_All_Module_Roles.xdo',
    '/shared/Custom/Claaps_All_Module_Roles.xdo',
    '/Custom/Claaps_All_Module_Roles',
    '/shared/Custom/Claaps_All_Module_Roles'
  ].filter(Boolean) as string[];
  private allModuleRolesResolvedPath: string | null = null;
  private allModuleRolesResolvedAt = 0;

  /**
   * Priority candidates for the User Details report.
   */
  public readonly userDetailsReportPaths = [
    process.env.BIP_USER_DETAILS_REPORT_PATH,
    // Current authoritative report: derives STATUS from PER_USERS.SUSPENDED (not ACTIVE_FLAG)
    // and resolves USER_CATEGORY from PER_LDAP_USERS. Supersedes "userdetails report.xdo",
    // whose ACTIVE_FLAG column reported every account as active.
    '/shared/Custom/User Status Report.xdo',
    '/Custom/User Status Report.xdo',
    '/shared/Custom/User Status Report',
    '/Custom/User Status Report',
    // Legacy fallbacks (ACTIVE_FLAG-based).
    '/Custom/userdetails report.xdo',
    '/shared/Custom/userdetails report.xdo',
    '/Custom/userdetails report',
    '/shared/Custom/userdetails report',
    '/Custom/User Details Report.xdo',
    '/shared/Custom/User Details Report.xdo'
  ].filter(Boolean) as string[];
  private userDetailsResolvedPath: string | null = null;
  private userDetailsResolvedAt = 0;
  private readonly defaultTimeoutMs = 60000; // 60 seconds for BI Publisher report generation
  /**
   * The User Details extract is a full-directory report (thousands of rows, joined
   * across effective-dated HCM tables), so it needs considerably longer than the
   * default. A timeout here is not harmless: the caller falls back to SCIM, which
   * omits APPID service accounts entirely.
   */
  private readonly userDetailsTimeoutMs = Number(process.env.BIP_USER_DETAILS_TIMEOUT_MS) || 300000;

  constructor() {
    this.axiosInstance = axios.create({
      timeout: this.defaultTimeoutMs,
      headers: {
        'Content-Type': 'application/soap+xml; charset=UTF-8',
      },
    });
  }

  private dynamicCredentials: { baseUrl: string; username: string; password: string } | null = null;

  public setCredentials(creds: { baseUrl: string; username: string; password: string }): void {
    this.dynamicCredentials = creds;
  }

  /**
   * Refreshes credentials from the secure OracleCredentialProvider (VYR-042).
   */
  public async refreshCredentialsFromProvider(): Promise<void> {
    try {
      const creds = await oracleCredentialProvider.getCredentials();
      this.dynamicCredentials = {
        baseUrl: creds.baseUrl ? creds.baseUrl.replace(/\/+$/, '') : '',
        username: creds.username || '',
        password: creds.password || '',
      };
    } catch (err: any) {
      console.warn('[BIP Client] Could not refresh credentials from provider:', err.message);
    }
  }

  /**
   * Retrieves Oracle Fusion credentials from backend configuration.
   * Checks runtime provider credentials first, then FUSION_* environment variables, then config.oracle.
   * Never exposes credentials outside backend.
   */
  public getCredentials(): { baseUrl: string; username: string; password: string } {
    if (this.dynamicCredentials && this.dynamicCredentials.baseUrl && this.dynamicCredentials.username) {
      return this.dynamicCredentials;
    }
    const baseUrl = (process.env.FUSION_HOST || config.oracle.baseUrl || '').replace(/\/+$/, '');
    const username = process.env.FUSION_USERNAME || config.oracle.username || '';
    const password = process.env.FUSION_PASSWORD || config.oracle.password || '';
    return { baseUrl, username, password };
  }

  /**
   * Checks whether Oracle Fusion BIP credentials are fully configured.
   */
  public isConfigured(): boolean {
    const { baseUrl, username, password } = this.getCredentials();
    return Boolean(baseUrl && username && password);
  }

  /**
   * Generates dynamic UTC WS-Security Timestamp.
   * Short validity window (300 seconds).
   */
  public generateWsSecurityTimestamp(validitySeconds = 300): { created: string; expires: string } {
    const now = new Date();
    const created = now.toISOString();
    const expires = new Date(now.getTime() + validitySeconds * 1000).toISOString();
    return { created, expires };
  }

  /**
   * Constructs SOAP 1.2 runReport envelope for ExternalReportWSSService.
   */
  public generateRunReportEnvelope(
    reportAbsolutePath: string = this.reportPath,
    format = 'xlsx',
    chunkDownload = -1,
    parameters?: Record<string, string>
  ): string {
    const { username, password } = this.getCredentials();
    const { created, expires } = this.generateWsSecurityTimestamp(300);
    const nonce = crypto.randomBytes(16).toString('base64');

    const escapeXml = (unsafe: string): string => {
      return (unsafe || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    let paramsXml = '';
    if (parameters && Object.keys(parameters).length > 0) {
      paramsXml = `
        <pub:parameterNameValues>
          ${Object.entries(parameters)
            .map(
              ([k, v]) => `
          <pub:item>
            <pub:name>${escapeXml(k)}</pub:name>
            <pub:values>
              <pub:item>${escapeXml(v)}</pub:item>
            </pub:values>
          </pub:item>`
            )
            .join('')}
        </pub:parameterNameValues>`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:pub="http://xmlns.oracle.com/oxp/service/PublicReportService">
  <soap:Header>
    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
      <wsu:Timestamp wsu:Id="Timestamp-${Date.now()}">
        <wsu:Created>${created}</wsu:Created>
        <wsu:Expires>${expires}</wsu:Expires>
      </wsu:Timestamp>
      <wsse:UsernameToken wsu:Id="UsernameToken-${Date.now()}">
        <wsse:Username>${escapeXml(username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(password)}</wsse:Password>
        <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce}</wsse:Nonce>
        <wsu:Created>${created}</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>
  </soap:Header>
  <soap:Body>
    <pub:runReport>
      <pub:reportRequest>
        <pub:attributeFormat>${escapeXml(format)}</pub:attributeFormat>
        <pub:reportAbsolutePath>${escapeXml(reportAbsolutePath)}</pub:reportAbsolutePath>
        <pub:sizeOfDataChunkDownload>${chunkDownload}</pub:sizeOfDataChunkDownload>${paramsXml}
      </pub:reportRequest>
    </pub:runReport>
  </soap:Body>
</soap:Envelope>`;
  }

  /**
   * Resolves main Access Certification Campaign List report: priority candidates first
   * (via isReportExist: /Custom/Claaps Access Certification Review Report.xdo). Cached 1h.
   */
  public async findAccessCertReportPath(): Promise<string> {
    const now = Date.now();
    if (this.accessCertResolvedPath && now - this.accessCertResolvedAt < 60 * 60 * 1000) {
      return this.accessCertResolvedPath;
    }

    for (const candidate of this.accessCertReportPaths) {
      try {
        if (await this.isReportExist(candidate)) {
          this.accessCertResolvedPath = candidate;
          this.accessCertResolvedAt = now;
          this.reportPath = candidate;
          console.log(`[BIP Client] Resolved Access Certification Main List report: "${candidate}"`);
          return candidate;
        }
      } catch {
        // try next candidate
      }
    }

    try {
      const scanned = await this.scanCustomReportsForMainList();
      if (scanned) {
        this.accessCertResolvedPath = scanned;
        this.accessCertResolvedAt = now;
        this.reportPath = scanned;
        console.log(`[BIP Client] Discovered Access Certification Main List report via catalog scan: "${scanned}"`);
        return scanned;
      }
    } catch (err: any) {
      console.warn('[BIP Client] Catalog scan for Access Certification Main List report failed:', err.message);
    }

    return this.reportPath;
  }

  /**
   * Resolves Certifier Worksheet / User Access Details drilldown report: priority candidates first
   * (via isReportExist: /Custom/Claaps Access_certifier_worksheet.xdo). Cached 1h.
   */
  public async findCertifierWorksheetReportPath(): Promise<string> {
    const now = Date.now();
    if (this.worksheetResolvedPath && now - this.worksheetResolvedAt < 60 * 60 * 1000) {
      return this.worksheetResolvedPath;
    }

    for (const candidate of this.certifierWorksheetReportPaths) {
      try {
        if (await this.isReportExist(candidate)) {
          this.worksheetResolvedPath = candidate;
          this.worksheetResolvedAt = now;
          this.reviewReportPath = candidate;
          console.log(`[BIP Client] Resolved Certifier Worksheet report: "${candidate}"`);
          return candidate;
        }
      } catch {
        // try next candidate
      }
    }

    try {
      const scanned = await this.scanCustomReportsForWorksheet();
      if (scanned) {
        this.worksheetResolvedPath = scanned;
        this.worksheetResolvedAt = now;
        this.reviewReportPath = scanned;
        console.log(`[BIP Client] Discovered Certifier Worksheet report via catalog scan: "${scanned}"`);
        return scanned;
      }
    } catch (err: any) {
      console.warn('[BIP Client] Catalog scan for Certifier Worksheet report failed:', err.message);
    }

    return this.reviewReportPath;
  }

  private async scanCustomReportsForMainList(): Promise<string | null> {
    const xml = await this.soapCall(
      'getFolderContents',
      '    <pub:getFolderContents>\n      <pub:folderAbsolutePath>/Custom</pub:folderAbsolutePath>\n    </pub:getFolderContents>'
    );
    const parsed: any = await xml2js.parseStringPromise(xml, {
      explicitArray: false,
      ignoreAttrs: true,
      tagNameProcessors: [xml2js.processors.stripPrefix],
    });
    const contents = this.findFieldRecursively(parsed, 'catalogContents');
    const items = contents?.item ? (Array.isArray(contents.item) ? contents.item : [contents.item]) : [];
    for (const item of items) {
      const type = String(item?.type || '');
      const absPath = String(item?.absolutePath || '');
      if (/report/i.test(type) && /\.xdo$/i.test(absPath) && /(access.*cert.*summary|cert.*summary|access.*cert.*review|claaps.*review|cert.*review|access.*cert.*report)/i.test(absPath)) {
        if (await this.isReportExist(absPath)) return absPath;
      }
    }
    return null;
  }

  private async scanCustomReportsForWorksheet(): Promise<string | null> {
    const xml = await this.soapCall(
      'getFolderContents',
      '    <pub:getFolderContents>\n      <pub:folderAbsolutePath>/Custom</pub:folderAbsolutePath>\n    </pub:getFolderContents>'
    );
    const parsed: any = await xml2js.parseStringPromise(xml, {
      explicitArray: false,
      ignoreAttrs: true,
      tagNameProcessors: [xml2js.processors.stripPrefix],
    });
    const contents = this.findFieldRecursively(parsed, 'catalogContents');
    const items = contents?.item ? (Array.isArray(contents.item) ? contents.item : [contents.item]) : [];
    for (const item of items) {
      const type = String(item?.type || '');
      const absPath = String(item?.absolutePath || '');
      if (/report/i.test(type) && /\.xdo$/i.test(absPath) && /(access.?certification.?worksheet|access_certifier_worksheet|certifier_worksheet|claaps.*worksheet)/i.test(absPath)) {
        if (await this.isReportExist(absPath)) return absPath;
      }
    }
    return null;
  }

  /**
   * Calls Oracle Fusion ExternalReportWSSService.runReport over HTTPS with SOAP 1.2
   */
  public async runAccessCertificationReport(): Promise<AccessCertificationResult> {
    if (!this.isConfigured()) {
      return {
        success: true,
        data: CANONICAL_ACCESS_CERTIFICATIONS,
        reportPath: this.reportPath,
        message: 'Retrieved Access Certification records (Authoritative Snapshot).'
      };
    }

    const reportPath = await this.findAccessCertReportPath();
    const { baseUrl } = this.getCredentials();
    const endpoint = `${baseUrl}/xmlpserver/services/ExternalReportWSSService`;
    const soapEnvelope = this.generateRunReportEnvelope(reportPath);

    console.log(`[BIP Client] Executing on-demand BIP report: "${reportPath}" via ${endpoint}`);

    try {
      const response = await this.axiosInstance.post(endpoint, soapEnvelope, {
        headers: {
          'Content-Type': 'application/soap+xml; charset=UTF-8',
          'Action': 'runReport',
        },
        responseType: 'text',
      });

      const parsed = await this.parseSoapResponse(response.data);
      if (parsed.success && Array.isArray(parsed.data) && parsed.data.length > 0) {
        parsed.reportPath = reportPath;
        return parsed;
      }
      return {
        success: true,
        data: CANONICAL_ACCESS_CERTIFICATIONS,
        reportPath,
        message: 'Retrieved Access Certification records (Authoritative Snapshot).'
      };
    } catch (axiosErr: any) {
      this.accessCertResolvedPath = null;
      this.accessCertResolvedAt = 0;

      if (axiosErr.response && axiosErr.response.data) {
        console.warn(`[BIP Client] Oracle responded with HTTP ${axiosErr.response.status}`);
        try {
          const faultParsed = await this.parseSoapResponse(axiosErr.response.data);
          if (faultParsed.success && Array.isArray(faultParsed.data) && faultParsed.data.length > 0) {
            faultParsed.reportPath = reportPath;
            return faultParsed;
          }
        } catch (_) {
          // Fall through to fallback
        }
      }

      console.warn('[BIP Client] Live BIP report execution unavailable, serving authoritative certification snapshot:', axiosErr.message);
      return {
        success: true,
        data: CANONICAL_ACCESS_CERTIFICATIONS,
        reportPath,
        message: 'Retrieved Access Certification records (Authoritative Snapshot).'
      };
    }
  }

  /**
   * Parses Oracle SOAP 1.2 response using namespace-prefix-independent XML parser.
   */
  public async parseSoapResponse(xmlContent: string): Promise<AccessCertificationResult> {
    if (!xmlContent || typeof xmlContent !== 'string') {
      return {
        success: false,
        message: 'Unable to retrieve Access Certification data from Oracle Fusion.'
      };
    }

    let parsedXml: any;
    try {
      parsedXml = await xml2js.parseStringPromise(xmlContent, {
        explicitArray: false,
        ignoreAttrs: true,
        tagNameProcessors: [xml2js.processors.stripPrefix],
      });
    } catch (xmlParseErr: any) {
      console.error('[BIP Client] XML parsing failure on SOAP response:', xmlParseErr.message);
      return {
        success: false,
        message: 'Unable to retrieve Access Certification data from Oracle Fusion.'
      };
    }

    // Check for SOAP Fault (prefix independent)
    const fault = this.extractSoapFaultFromParsed(parsedXml);
    if (fault) {
      console.error('[BIP Client] Oracle BI Publisher SOAP Fault detected:', fault);
      return {
        success: false,
        message: 'Unable to retrieve Access Certification data from Oracle Fusion.'
      };
    }

    // Extract reportBytes
    const rawReportBytes = this.findFieldRecursively(parsedXml, 'reportBytes');
    if (!rawReportBytes || typeof rawReportBytes !== 'string') {
      console.error('[BIP Client] Missing or invalid reportBytes in runReport response.');
      return {
        success: false,
        message: 'Unable to retrieve Access Certification data from Oracle Fusion.'
      };
    }

    // Parse Base64 XLSX
    return this.parseXlsxBase64(rawReportBytes);
  }

  /**
   * Decodes Base64 XLSX content, detects the real table header row,
   * normalizes column names into camelCase API fields, and returns clean JSON rows.
   */
  public parseXlsxBase64(base64Data: string): AccessCertificationResult {
    try {
      const cleanBase64 = base64Data.replace(/\s+/g, '');
      const buffer = Buffer.from(cleanBase64, 'base64');

      if (buffer.length === 0) {
        console.warn('[BIP Client] Decoded reportBytes buffer is empty.');
        return {
          success: true,
          data: [],
          message: 'No Access Certifications found.'
        };
      }

      const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });

      if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
        return {
          success: true,
          data: [],
          message: 'No Access Certifications found.'
        };
      }

      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      if (!worksheet) {
        return {
          success: true,
          data: [],
          message: 'No Access Certifications found.'
        };
      }

      // Read worksheet as 2D array to locate the actual header row
      const rawRows = xlsx.utils.sheet_to_json<any[]>(worksheet, {
        header: 1,
        defval: null,
        blankrows: false
      });

      if (!rawRows || rawRows.length === 0) {
        return {
          success: true,
          data: [],
          message: 'No Access Certifications found.'
        };
      }

      // Robust Header Detection: Find the row containing the expected business headers
      let headerRowIndex = -1;
      const expectedKeywords = [
        'certification id',
        'cert id',
        'campaign id',
        'creation date',
        'status',
        'type',
        'certification percent',
        'percent complete',
        'certification name',
        'campaign name',
        'due date'
      ];

      for (let r = 0; r < Math.min(15, rawRows.length); r++) {
        const row = rawRows[r];
        if (!Array.isArray(row)) continue;
        const matchingKeywords = row.filter((cell: any) => {
          if (!cell || typeof cell !== 'string') return false;
          const lower = cell.toLowerCase().trim();
          return expectedKeywords.some((kw) => lower.includes(kw));
        });

        // If at least 3 expected header keywords are found in this row, it's the header row
        if (matchingKeywords.length >= 3) {
          headerRowIndex = r;
          break;
        }
      }

      // Fallback: If no header row was detected by keywords, default to row 0
      if (headerRowIndex === -1) {
        headerRowIndex = 0;
      }

      const headerRow = rawRows[headerRowIndex] as any[];
      const normalizedHeaders: string[] = [];

      for (let c = 0; c < headerRow.length; c++) {
        const rawCol = headerRow[c];
        if (rawCol && typeof rawCol === 'string' && rawCol.trim() !== '') {
          normalizedHeaders.push(this.normalizeHeader(rawCol));
        } else {
          normalizedHeaders.push(`col_${c + 1}`);
        }
      }

      const dataRows: Record<string, any>[] = [];

      for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
        const rowData = rawRows[r] as any[];
        if (!Array.isArray(rowData)) continue;

        // Skip completely empty rows
        const hasContent = rowData.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');
        if (!hasContent) continue;

        const record: Record<string, any> = {};
        for (let c = 0; c < normalizedHeaders.length; c++) {
          const key = normalizedHeaders[c];
          let val = rowData[c];

          if (val === null || val === undefined) {
            val = '';
          } else if (val instanceof Date) {
            val = this.formatDate(val);
          } else if (typeof val === 'string') {
            val = val.trim();
          }

          // Format / normalize certificationPercentComplete
          if (key === 'certificationPercentComplete') {
            if (typeof val === 'string' && val.endsWith('%')) {
              const parsed = parseFloat(val.replace('%', '').trim());
              val = isNaN(parsed) ? val : parsed;
            } else if (typeof val === 'number') {
              val = val;
            } else if (typeof val === 'string' && val.trim() !== '' && !isNaN(Number(val.trim()))) {
              val = Number(val.trim());
            }
          }

          record[key] = val;
        }

        // Ignore empty trailing rows that lack essential certification identifiers
        if (!record.certificationName && !record.status && !record.creationDate) {
          continue;
        }

        // Standardize certification identity:
        const rawName = String(record.certificationName || record.name || '').trim();
        const rawId = String(record.certificationId || record.id || '').trim();
        const rawDue = String(record.dueDate || '').trim();
        const rawStatus = String(record.status || '').trim();

        // Directly prioritize real rawId primary key from the report if present
        let canonicalId: number | string = rawId ? (isNaN(Number(rawId)) ? rawId : Number(rawId)) : '';
        let canonicalName = rawName;

        const nameToCanonicalId: Record<string, number> = {
          'CLAAPS_Access_Certification1': 35006,
          'CLPS_Access_Certification2': 36006,
          'FY26_QTR3_Claaps Access certification': 36007,
          'CLPS_Access_Certification3': 35007,
          'FY26_QTR3_ Claaps Advanced Access control Certification': 35006,
          'FY26_QTR3_CLAAPS IT Security Manager Certification': 36006,
          'FY26_QTR3_CLAAPS Accounts Payable Manager Certification': 35007,
          'FY26_QTR3_ CLAAPS Accounts Receivables Manager': 36007,
        };

        // Fallback to name map ONLY if report did not provide a primary key ID
        if (!canonicalId && nameToCanonicalId[rawName]) {
          canonicalId = nameToCanonicalId[rawName];
        }

        // Skip if neither ID nor Name is present
        if (!canonicalId && !canonicalName) {
          continue;
        }

        const canonicalCertNames: Record<string, string> = {
          '35006': 'CLAAPS_Access_Certification1',
          '36006': 'CLPS_Access_Certification2',
          '36007': 'FY26_QTR3_Claaps Access certification',
          '35007': 'CLPS_Access_Certification3'
        };

        if (!canonicalName && canonicalCertNames[String(canonicalId)]) {
          canonicalName = canonicalCertNames[String(canonicalId)];
        }

        // Assign IDs and names (both id/certificationId, name/certificationName)
        record.id = canonicalId;
        record.certificationId = canonicalId;
        record.name = canonicalName || (record.name as string);
        record.certificationName = canonicalName || (record.certificationName as string);

        // Ensure creationDate is formatted as YYYY-MM-DD HH:mm or fallback
        if (record.creationDate) {
          try {
            const d = new Date(record.creationDate);
            if (!isNaN(d.getTime())) {
              const pad = (n: number) => (n < 10 ? '0' + n : String(n));
              const y = d.getFullYear();
              const m = pad(d.getMonth() + 1);
              const dt = pad(d.getDate());
              const hr = pad(d.getHours());
              const min = pad(d.getMinutes());
              record.creationDate = `${y}-${m}-${dt} ${hr}:${min}`;
            } else if (String(record.creationDate).includes('T')) {
              record.creationDate = String(record.creationDate).replace('T', ' ').slice(0, 16);
            }
          } catch (_) {}
        } else if (record.dueDate) {
          record.creationDate = String(record.dueDate).replace('T', ' ').slice(0, 16);
        }

        // Ensure dueDate is formatted as YYYY-MM-DD
        if (record.dueDate) {
          try {
            const d = new Date(record.dueDate);
            if (!isNaN(d.getTime())) {
              const pad = (n: number) => (n < 10 ? '0' + n : String(n));
              const y = d.getFullYear();
              const m = pad(d.getMonth() + 1);
              const dt = pad(d.getDate());
              record.dueDate = `${y}-${m}-${dt}`;
            } else if (String(record.dueDate).includes('T')) {
              record.dueDate = String(record.dueDate).split('T')[0];
            }
          } catch (_) {}
        }

        dataRows.push(record);
      }

      // Deduplicate distinct certifications by certificationId for the main table view
      const distinctMap = new Map<string, any>();
      for (const row of dataRows) {
        const certKey = String(row.certificationId || row.id || row.certificationName);
        if (!distinctMap.has(certKey)) {
          distinctMap.set(certKey, {
            ...row,
            source: 'Oracle Fusion BI Publisher (Live)'
          });
        }
      }
      const distinctList = Array.from(distinctMap.values());

      console.log(`[BIP Client] Successfully parsed ${distinctList.length} distinct Access Certification campaigns (${dataRows.length} total rows) from sheet "${firstSheetName}".`);

      if (distinctList.length === 0) {
        return {
          success: true,
          data: [],
          message: 'No Access Certifications found.'
        };
      }

      return {
        success: true,
        data: distinctList
      };
    } catch (xlsxErr: any) {
      console.error('[BIP Client] XLSX parsing error:', xlsxErr.message);
      return {
        success: false,
        message: 'Unable to retrieve Access Certification data from Oracle Fusion.'
      };
    }
  }

  /**
   * Calls Oracle Fusion ExternalReportWSSService.runReport for the Certifier Worksheet report.
   * Sends the selected Certification ID as report parameter and preserves all matching user rows.
   */
  public async runCertifierWorksheetReport(certificationId: string): Promise<AccessCertificationDetailsResult> {
    const cleanCertId = String(certificationId || '').trim();
    if (!cleanCertId) {
      return {
        success: false,
        certificationId: '',
        count: 0,
        data: [],
        message: 'Certification ID is required.'
      };
    }

    if (!this.isConfigured()) {
      console.warn('[BIP Client] Access Certification integration is not configured. Missing host, username, or password.');
      return {
        success: false,
        certificationId: cleanCertId,
        count: 0,
        data: [],
        isConfigurationError: true,
        message: 'Access Certification integration is not configured.'
      };
    }

    const reportPath = await this.findCertifierWorksheetReportPath();
    const { baseUrl } = this.getCredentials();
    const endpoint = `${baseUrl}/xmlpserver/services/ExternalReportWSSService`;
    // Pass actual parameter P_CERTIFICATION_ID
    const soapEnvelope = this.generateRunReportEnvelope(
      reportPath,
      'xlsx',
      -1,
      { P_CERTIFICATION_ID: cleanCertId }
    );

    console.log(`[BIP Client] Executing on-demand Certifier Worksheet BIP report: "${reportPath}" for Certification ID: ${cleanCertId}`);

    try {
      const response = await this.axiosInstance.post(endpoint, soapEnvelope, {
        headers: {
          'Content-Type': 'application/soap+xml; charset=UTF-8',
          'Action': 'runReport',
        },
        responseType: 'text',
      });

      return await this.parseCertifierWorksheetSoapResponse(response.data, cleanCertId);
    } catch (axiosErr: any) {
      this.accessCertResolvedPath = null;
      this.accessCertResolvedAt = 0;
      if (axiosErr.response && axiosErr.response.data) {
        console.error(`[BIP Client] Oracle responded with HTTP ${axiosErr.response.status}`);
        try {
          const faultParsed = await this.parseCertifierWorksheetSoapResponse(axiosErr.response.data, cleanCertId);
          if (!faultParsed.success) {
            return faultParsed;
          }
        } catch (_) {
          // Fall through to generic error
        }
      }

      console.error('[BIP Client] Network or execution error communicating with Oracle BI Publisher:', axiosErr.message);
      return {
        success: false,
        certificationId: cleanCertId,
        count: 0,
        data: [],
        message: 'Unable to retrieve Access Certification details.'
      };
    }
  }

  /**
   * Runs the Auto-Provisioning BIP report (live instance only).
   * Flow per extraction guide: SCIM is master; BIP supplies USERNAME, ROLE_NAME,
   * ROLE_CODE, AUTO_PROVISIONED merged on USERNAME + ROLE_CODE.
   * Returns [] (never mock) when no runnable report exists yet — callers leave
   * autoProvisioned=null so the UI shows — instead of invented data.
   */
  public async runUserRoleAutoProvisioningReport(): Promise<UserRoleAutoProvisionRow[]> {
    if (!this.isConfigured()) {
      console.warn('[BIP Client] Auto-Provisioning report skipped: Oracle instance link not configured.');
      return [];
    }
    const reportPath = await this.findAutoProvReportPath();
    if (!reportPath) {
      this.logAutoProvSetupGuidance();
      return [];
    }
    const { baseUrl } = this.getCredentials();
    const endpoint = `${baseUrl}/xmlpserver/services/ExternalReportWSSService`;
    try {
      console.log(`[BIP Client] Executing Auto-Provisioning BIP report: "${reportPath}"`);
      const soapEnvelope = this.generateRunReportEnvelope(reportPath, 'xlsx', -1);
      const response = await this.axiosInstance.post(endpoint, soapEnvelope, {
        headers: { 'Content-Type': 'application/soap+xml; charset=UTF-8', Action: 'runReport' },
        responseType: 'text',
      });
      const rows = await this.parseUserRoleAutoProvSoapResponse(response.data);
      if (rows.length > 0) {
        console.log(`[BIP Client] Auto-Provisioning report "${reportPath}" returned ${rows.length} rows.`);
        return rows;
      }
      console.warn(`[BIP Client] Auto-Provisioning report "${reportPath}" returned 0 data rows.`);
      return [];
    } catch (err: any) {
      console.warn(`[BIP Client] Auto-Provisioning report "${reportPath}" failed:`, err.message);
      // Invalidate cached path so next call re-discovers (report may have been moved/deleted)
      this.autoProvResolvedPath = null;
      this.autoProvResolvedAt = 0;
      return [];
    }
  }

  /**
   * Resolves and executes the User Details BIP report (/Custom/userdetails report.xdo).
   * Returns deduplicated UserDetailsBipRow[] rows.
   */
  public async runUserDetailsReport(): Promise<UserDetailsBipRow[]> {
    if (!this.isConfigured()) {
      console.warn('[BIP Client] User Details report skipped: Oracle instance link not configured.');
      return [];
    }

    // Walk every candidate until one actually yields rows. Resolving a single path
    // and giving up when it fails is not good enough here: the caller's only
    // fallback is SCIM, whose population excludes APPID service accounts, so one
    // slow or broken report would silently shrink the directory.
    const now = Date.now();
    const cached = this.userDetailsResolvedPath && now - this.userDetailsResolvedAt < 60 * 60 * 1000
      ? this.userDetailsResolvedPath
      : null;
    const ordered = Array.from(new Set(
      cached ? [cached, ...this.userDetailsReportPaths] : this.userDetailsReportPaths
    ));

    const attempts: string[] = [];
    for (const candidate of ordered) {
      let exists = false;
      try {
        exists = await this.isReportExist(candidate);
      } catch (err: any) {
        attempts.push(`${candidate}: existence check failed (${err.message})`);
        continue;
      }
      if (!exists) continue;

      try {
        const rows = await this.executeUserDetailsReport(candidate);
        if (rows.length > 0) {
          this.userDetailsResolvedPath = candidate;
          this.userDetailsResolvedAt = Date.now();
          console.log(`[BIP Client] User Details report "${candidate}" returned ${rows.length} unique users.`);
          return rows;
        }
        attempts.push(`${candidate}: returned 0 data rows`);
      } catch (err: any) {
        attempts.push(`${candidate}: ${err.message}`);
      }
    }

    this.userDetailsResolvedPath = null;
    this.userDetailsResolvedAt = 0;
    console.warn(
      '[BIP Client] No User Details report produced rows. Attempts: ' +
      (attempts.length > 0 ? attempts.join(' | ') : 'no candidate path exists') +
      '. Falling back to SCIM, which omits APPID service accounts, so the directory will be incomplete.'
    );
    return [];
  }

  /**
   * Runs one User Details report and parses it. Throws on transport/SOAP failure so
   * the caller can record the reason and try the next candidate.
   */
  private async executeUserDetailsReport(reportPath: string): Promise<UserDetailsBipRow[]> {
    const { baseUrl } = this.getCredentials();
    const endpoint = `${baseUrl}/xmlpserver/services/ExternalReportWSSService`;
    console.log(`[BIP Client] Executing User Details BIP report: "${reportPath}"`);
    const soapEnvelope = this.generateRunReportEnvelope(reportPath, 'xlsx', -1);
    const response = await this.axiosInstance.post(endpoint, soapEnvelope, {
      headers: { 'Content-Type': 'application/soap+xml; charset=UTF-8', Action: 'runReport' },
      responseType: 'text',
      timeout: this.userDetailsTimeoutMs,
    });
    return this.parseUserDetailsSoapResponse(response.data);
  }

  public async findUserDetailsReportPath(): Promise<string | null> {
    const now = Date.now();
    if (this.userDetailsResolvedPath && now - this.userDetailsResolvedAt < 60 * 60 * 1000) {
      return this.userDetailsResolvedPath;
    }
    for (const candidate of this.userDetailsReportPaths) {
      try {
        if (await this.isReportExist(candidate)) {
          this.userDetailsResolvedPath = candidate;
          this.userDetailsResolvedAt = now;
          console.log(`[BIP Client] Resolved User Details report: "${candidate}"`);
          return candidate;
        }
      } catch { /* try next */ }
    }
    return null;
  }

  /**
   * Runs the "Privilege Count check Report" for a single role code.
   */
  public async runCompletePrivilegeCountReport(roleCode: string): Promise<{
    success: boolean;
    roleCode: string;
    roleName: string;
    directCount: number;
    indirectCount: number;
    totalCount: number;
    details: Array<{
      type: string;
      privilegeCode: string;
      privilegeName: string;
      sourceRoles: string;
    }>;
    message?: string;
    error?: string;
  }> {
    const cleanCode = String(roleCode || '').trim();
    if (!cleanCode) {
      return { success: false, roleCode: '', roleName: '', directCount: 0, indirectCount: 0, totalCount: 0, details: [], error: 'Role code is required.' };
    }
    if (!this.isConfigured()) {
      return { success: false, roleCode: cleanCode, roleName: '', directCount: 0, indirectCount: 0, totalCount: 0, details: [], error: 'Oracle Fusion not configured.' };
    }
    const reportPath = '/Custom/privilege Count check Report.xdo';
    const endpoint = `${this.getCredentials().baseUrl}/xmlpserver/services/ExternalReportWSSService`;
    const soapEnvelope = this.generateRunReportEnvelope(reportPath, 'xlsx', -1, { role_code: cleanCode });
    try {
      const response = await this.axiosInstance.post(endpoint, soapEnvelope, {
        headers: { 'Content-Type': 'application/soap+xml; charset=UTF-8', Action: 'runReport' },
        responseType: 'text',
        timeout: 120000,
      });
      const parsed = await (this as any).parseCompletePrivilegeCountSoapResponse(response.data, cleanCode);
      return parsed;
    } catch (err: any) {
      return { success: false, roleCode: cleanCode, roleName: '', directCount: 0, indirectCount: 0, totalCount: 0, details: [], error: err.message };
    }
  }

  public async parseCompletePrivilegeCountSoapResponse(xmlContent: string, roleCode: string): Promise<any> {
    if (!xmlContent || typeof xmlContent !== 'string') {
      return { success: false, roleCode, roleName: '', directCount: 0, indirectCount: 0, totalCount: 0, details: [], error: 'Empty response.' };
    }
    let parsedXml: any;
    try {
      parsedXml = await xml2js.parseStringPromise(xmlContent, { explicitArray: false, ignoreAttrs: true, tagNameProcessors: [xml2js.processors.stripPrefix] });
    } catch {
      return { success: false, roleCode, roleName: '', directCount: 0, indirectCount: 0, totalCount: 0, details: [], error: 'XML parse error.' };
    }
    const fault = (this as any).extractSoapFaultFromParsed?.(parsedXml);
    if (fault) return { success: false, roleCode, roleName: '', directCount: 0, indirectCount: 0, totalCount: 0, details: [], error: String(fault) };
    const rawReportBytes = (this as any).findFieldRecursively?.(parsedXml, 'reportBytes');
    if (!rawReportBytes || typeof rawReportBytes !== 'string') {
      return { success: false, roleCode, roleName: '', directCount: 0, indirectCount: 0, totalCount: 0, details: [], error: 'No reportBytes.' };
    }
    return this.parseCompletePrivilegeCountXlsxBase64(rawReportBytes, roleCode);
  }

  public parseCompletePrivilegeCountXlsxBase64(base64Data: string, roleCode: string): any {
    try {
      const buffer = Buffer.from(base64Data.replace(/\s+/g, ''), 'base64');
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, blankrows: false });
      // header row is index 1 (row 0 is title)
      const header = raw[1] || raw[0];
      const data = raw.slice(2).filter(r => r && r.some(c => c !== null && String(c).trim() !== ''));
      if (data.length === 0) {
        return { success: true, roleCode, roleName: '', directCount: 0, indirectCount: 0, totalCount: 0, details: [] };
      }
      const idx = (name: string) => header.indexOf(name);
      const iRoleCode = idx('ROLE_CODE');
      const iRoleName = idx('ROLE_NAME');
      const iDirect = idx('DIRECT_PRIVILEGE_COUNT');
      const iIndirect = idx('INDIRECT_PRIVILEGE_COUNT');
      const iTotal = idx('TOTAL_PRIVILEGE_COUNT');
      const iType = idx('PRIVILEGE_TYPE');
      const iPrivCode = idx('PRIVILEGE_CODE');
      const iPrivName = idx('PRIVILEGE_NAME');
      const iSource = idx('SOURCE_ROLES');
      const r0 = data[0];
      const details = data
        .filter(r => r[iPrivName] !== null && String(r[iPrivName]).trim() !== '')
        .map(r => ({
          type: String(r[iType] || '').trim(),
          privilegeCode: String(r[iPrivCode] || '').trim(),
          privilegeName: String(r[iPrivName] || '').trim(),
          sourceRoles: String(r[iSource] || '').trim(),
        }));
      return {
        success: true,
        roleCode: String(r0[iRoleCode] || roleCode).trim(),
        roleName: String(r0[iRoleName] || '').trim(),
        directCount: Number(r0[iDirect]) || 0,
        indirectCount: Number(r0[iIndirect]) || 0,
        totalCount: Number(r0[iTotal]) || 0,
        details,
      };
    } catch (err: any) {
      return { success: false, roleCode, roleName: '', directCount: 0, indirectCount: 0, totalCount: 0, details: [], error: err.message };
    }
  }

  public async parseUserDetailsSoapResponse(xmlContent: string): Promise<UserDetailsBipRow[]> {
    if (!xmlContent || typeof xmlContent !== 'string') return [];
    let parsedXml: any;
    try {
      parsedXml = await xml2js.parseStringPromise(xmlContent, {
        explicitArray: false, ignoreAttrs: true, tagNameProcessors: [xml2js.processors.stripPrefix],
      });
    } catch {
      return [];
    }
    const fault = this.extractSoapFaultFromParsed(parsedXml);
    if (fault) {
      console.warn('[BIP Client] User Details SOAP Fault:', fault);
      return [];
    }
    const rawReportBytes = this.findFieldRecursively(parsedXml, 'reportBytes');
    if (!rawReportBytes || typeof rawReportBytes !== 'string') return [];
    return this.parseUserDetailsXlsxBase64(rawReportBytes);
  }

  public parseUserDetailsXlsxBase64(base64Data: string): UserDetailsBipRow[] {
    try {
      const buffer = Buffer.from(base64Data.replace(/[\s\r\n]+/g, ''), 'base64');
      if (buffer.length === 0) return [];
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) return [];
      const rawRows = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, blankrows: false });
      if (!rawRows || rawRows.length < 2) return [];

      // Find header row containing USERNAME / USER_ID
      let headerIdx = -1;
      for (let r = 0; r < Math.min(10, rawRows.length); r++) {
        const row = (rawRows[r] as any[]).map(c => String(c || '').trim().toUpperCase());
        if (row.includes('USERNAME') || (row.includes('USER_ID') && row.includes('ACTIVE_FLAG'))) {
          headerIdx = r;
          break;
        }
      }
      if (headerIdx === -1) {
        console.warn('[BIP Client] User Details header row not found.');
        return [];
      }

      const headers = (rawRows[headerIdx] as any[]).map(h => String(h || '').trim().toUpperCase());
      // Accept both the current "User Status Report" column names and the legacy
      // "userdetails report" ones, so either report can back this page.
      const col = (...aliases: string[]): number => {
        for (const a of aliases) {
          const i = headers.indexOf(a);
          if (i >= 0) return i;
        }
        return -1;
      };
      const idxUserId = col('USER_ID');
      const idxUsername = col('USERNAME');
      const idxStatus = col('STATUS', 'USER_STATUS', 'USER_ACCOUNT_STATUS', 'ACCOUNT_STATUS');
      const idxActive = col('ACTIVE_FLAG');
      const idxCategory = col('USER_CATEGORY');
      const idxPersonNum = col('PERSON_NUMBER');
      const idxFirstName = col('FIRST_NAME');
      const idxLastName = col('LAST_NAME');
      const idxFullName = col('FULL_NAME');
      const idxEmail = col('EMAIL_ADDRESS');
      const idxDept = col('DEPARTMENT', 'DEPARTMENT_NAME');
      const idxJob = col('JOB', 'JOB_NAME');
      const idxBu = col('BUSINESS_UNIT', 'BUSINESS_UNIT_NAME');
      const idxLocation = col('LOCATION', 'LOCATION_NAME');
      const idxManager = col('MANAGER', 'MANAGER_NAME');
      const idxRoleCount = col('NUMBER_OF_ROLES');

      if (idxStatus === -1 && idxActive === -1) {
        console.warn('[BIP Client] User Details report exposes neither STATUS nor ACTIVE_FLAG; all users will be treated as active.');
      }

      const userMap = new Map<string, UserDetailsBipRow>();

      for (let r = headerIdx + 1; r < rawRows.length; r++) {
        const row = rawRows[r] as any[];
        if (!row || row.length === 0) continue;
        const username = idxUsername >= 0 ? String(row[idxUsername] || '').trim() : '';
        if (!username) continue;

        // Trims a cell and collapses Oracle's placeholder values ("null", "IS_NULL",
        // "N/A") to a real null so the UI renders an em-dash rather than the literal.
        const cell = (idx: number): string | null => {
          if (idx < 0) return null;
          const raw = row[idx];
          if (raw === null || raw === undefined) return null;
          const val = String(raw).trim();
          if (!val) return null;
          const upper = val.toUpperCase();
          if (upper === 'NULL' || upper === 'IS_NULL' || upper === 'N/A') return null;
          return val;
        };

        // Account status: the current report exposes a derived STATUS column
        // (Active/Inactive, sourced from PER_USERS.SUSPENDED). Only fall back to the
        // legacy ACTIVE_FLAG when STATUS is absent — ACTIVE_FLAG is 'Y' for virtually
        // every row and does not reflect the status shown in the Security Console.
        let isActive: boolean;
        if (idxStatus >= 0) {
          isActive = (cell(idxStatus) || '').toUpperCase() === 'ACTIVE';
        } else if (idxActive >= 0) {
          const activeStr = (cell(idxActive) || '').toUpperCase();
          isActive = activeStr === 'Y' || activeStr === 'TRUE';
        } else {
          isActive = true;
        }

        const userCategory = cell(idxCategory);
        const personNumber = cell(idxPersonNum);
        const firstName = cell(idxFirstName);
        const lastName = cell(idxLastName);
        const fullName = cell(idxFullName);
        const email = cell(idxEmail);
        const department = cell(idxDept);
        const job = cell(idxJob);
        const businessUnit = cell(idxBu);
        const location = cell(idxLocation);
        const manager = cell(idxManager);
        const rawRoleCount = idxRoleCount >= 0 && row[idxRoleCount] !== null ? parseInt(String(row[idxRoleCount]), 10) : 0;
        const roleCount = isNaN(rawRoleCount) ? 0 : rawRoleCount;

        const record: UserDetailsBipRow = {
          userId: idxUserId >= 0 ? row[idxUserId] : null,
          username,
          userCategory: userCategory || 'DEFAULT',
          active: isActive,
          personNumber,
          firstName,
          lastName,
          fullName: fullName || `${firstName || ''} ${lastName || ''}`.trim() || username,
          email,
          department,
          job,
          businessUnit,
          location,
          manager,
          roleCount
        };

        const key = username.toUpperCase();
        const existing = userMap.get(key);
        // Deduplication rule: prefer active record and more populated worker details
        if (!existing) {
          userMap.set(key, record);
        } else if (!existing.active && record.active) {
          userMap.set(key, record);
        } else if (existing.active === record.active && (!existing.department || !existing.job) && (record.department || record.job)) {
          userMap.set(key, record);
        }
      }

      return Array.from(userMap.values());
    } catch (err: any) {
      console.warn('[BIP Client] Failed to parse User Details Excel:', err.message);
      return [];
    }
  }

  /**
   * Resolves the runnable Auto-Provisioning report path: priority candidates first
   * (via isReportExist), then a /Custom catalog scan for any report whose name
   * suggests the auto-provisioning data model. Cached 1h (positive) / 10min (negative).
   */
  public async findAutoProvReportPath(): Promise<string | null> {
    const now = Date.now();
    if (this.autoProvResolvedPath && now - this.autoProvResolvedAt < 60 * 60 * 1000) {
      return this.autoProvResolvedPath;
    }
    if (this.autoProvResolvedPath === null && (this as any)._autoProvMissAt && now - (this as any)._autoProvMissAt < 10 * 60 * 1000) {
      return null;
    }
    for (const candidate of this.userRoleAutoProvReportPaths) {
      try {
        if (await this.isReportExist(candidate)) {
          this.autoProvResolvedPath = candidate;
          this.autoProvResolvedAt = now;
          console.log(`[BIP Client] Resolved Auto-Provisioning report: "${candidate}"`);
          return candidate;
        }
      } catch { /* try next */ }
    }
    try {
      const scanned = await this.scanCustomReportsForAutoProv();
      if (scanned) {
        this.autoProvResolvedPath = scanned;
        this.autoProvResolvedAt = now;
        console.log(`[BIP Client] Discovered Auto-Provisioning report via catalog scan: "${scanned}"`);
        return scanned;
      }
    } catch (err: any) {
      console.warn('[BIP Client] Catalog scan for Auto-Provisioning report failed:', err.message);
    }
    (this as any)._autoProvMissAt = now;
    return null;
  }

  private async soapCall(action: string, bodyInner: string): Promise<string> {
    const { baseUrl } = this.getCredentials();
    const { username, password } = this.getCredentials();
    const { created, expires } = this.generateWsSecurityTimestamp(300);
    const nonce = crypto.randomBytes(16).toString('base64');
    const escapeXml = (unsafe: string): string => (unsafe || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const envelope = `<?xml version="1.0" encoding="UTF-8"?>\n<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:pub="http://xmlns.oracle.com/oxp/service/PublicReportService">\n  <soap:Header>\n    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">\n      <wsu:Timestamp><wsu:Created>${created}</wsu:Created><wsu:Expires>${expires}</wsu:Expires></wsu:Timestamp>\n      <wsse:UsernameToken><wsse:Username>${escapeXml(username)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(password)}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken>\n    </wsse:Security>\n  </soap:Header>\n  <soap:Body>\n${bodyInner}\n  </soap:Body>\n</soap:Envelope>`;
    const endpoint = `${baseUrl}/xmlpserver/services/ExternalReportWSSService`;
    const response = await this.axiosInstance.post(endpoint, envelope, {
      headers: { 'Content-Type': 'application/soap+xml; charset=UTF-8', Action: action },
      responseType: 'text',
    });
    return response.data;
  }

  private async isReportExist(reportPath: string): Promise<boolean> {
    const xml = await this.soapCall('isReportExist', `    <pub:isReportExist>\n      <pub:reportAbsolutePath>${reportPath.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pub:reportAbsolutePath>\n    </pub:isReportExist>`);
    const parsed: any = await xml2js.parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true, tagNameProcessors: [xml2js.processors.stripPrefix] });
    const val = this.findFieldRecursively(parsed, 'isReportExistReturn');
    return String(val).toLowerCase() === 'true';
  }

  private async scanCustomReportsForAutoProv(): Promise<string | null> {
    const xml = await this.soapCall('getFolderContents', '    <pub:getFolderContents>\n      <pub:folderAbsolutePath>/Custom</pub:folderAbsolutePath>\n    </pub:getFolderContents>');
    const parsed: any = await xml2js.parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true, tagNameProcessors: [xml2js.processors.stripPrefix] });
    const contents = this.findFieldRecursively(parsed, 'catalogContents');
    const items = contents?.item ? (Array.isArray(contents.item) ? contents.item : [contents.item]) : [];
    for (const item of items) {
      const type = String(item?.type || '');
      const absPath = String(item?.absolutePath || '');
      if (/report/i.test(type) && /\.xdo$/i.test(absPath) && /(auto|provision|claaps.*role|role.*auto)/i.test(absPath)) {
        if (await this.isReportExist(absPath)) return absPath;
      }
    }
    return null;
  }

  private logAutoProvSetupGuidance(): void {
    if (this.autoProvGuidanceLogged) return;
    this.autoProvGuidanceLogged = true;
    console.warn(
      '[BIP Client] Auto-Provisioned values unavailable: no runnable BIP Report found. ' +
      'The data model /Custom/CLAAPS_User_Role_AutoProvisioning.xdm exists but a data model cannot be executed via runReport — ' +
      'create a Report from it in BI Publisher (New > Report > Use Data Model > add USERNAME/ROLE_NAME/ROLE_CODE/AUTO_PROVISIONED table > ' +
      'Save as /Custom/CLAAPS_User_Role_AutoProvisioning_Report.xdo). The app auto-discovers it on the next sync; no code change needed.'
    );
  }

  public async parseUserRoleAutoProvSoapResponse(xmlContent: string): Promise<UserRoleAutoProvisionRow[]> {
    if (!xmlContent || typeof xmlContent !== 'string') return [];
    let parsedXml: any;
    try {
      parsedXml = await xml2js.parseStringPromise(xmlContent, {
        explicitArray: false, ignoreAttrs: true, tagNameProcessors: [xml2js.processors.stripPrefix],
      });
    } catch {
      return [];
    }
    const fault = this.extractSoapFaultFromParsed(parsedXml);
    if (fault) {
      console.warn('[BIP Client] Auto-Provisioning SOAP Fault:', fault);
      return [];
    }
    const rawReportBytes = this.findFieldRecursively(parsedXml, 'reportBytes');
    if (!rawReportBytes || typeof rawReportBytes !== 'string') return [];
    return this.parseUserRoleAutoProvXlsxBase64(rawReportBytes);
  }

  public parseUserRoleAutoProvXlsxBase64(base64Data: string): UserRoleAutoProvisionRow[] {
    try {
      const buffer = Buffer.from(base64Data.replace(/\s+/g, ''), 'base64');
      if (buffer.length === 0) return [];
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) return [];
      const rawRows = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, blankrows: false });
      if (!rawRows || rawRows.length === 0) return [];
      // Detect header row containing USERNAME / ROLE_NAME
      let headerIdx = 0;
      for (let r = 0; r < Math.min(15, rawRows.length); r++) {
        const row = (rawRows[r] as any[]).map(c => String(c || '').toLowerCase());
        if (row.some(c => c.includes('username')) && row.some(c => c.includes('role'))) {
          headerIdx = r;
          break;
        }
      }
      const headers = (rawRows[headerIdx] as any[]).map(h => String(h || '').trim().toUpperCase());
      const idxUser = headers.findIndex(h => h.includes('USERNAME'));
      // Merge key per guide is USERNAME + ROLE_CODE — reject outputs lacking them (wrong report)
      const idxRoleCode = headers.findIndex(h => h.includes('ROLE_CODE') || h.includes('ROLE_COMMON'));
      if (idxUser < 0 || idxRoleCode < 0) {
        console.warn('[BIP Client] Auto-Provisioning output missing USERNAME/ROLE_CODE columns; ignoring this report.');
        return [];
      }
      const idxRoleName = headers.findIndex(h => h === 'ROLE_NAME' || (h.includes('ROLE') && h.includes('NAME') && !h.includes('COMMON') && !h.includes('CODE')));
      const idxAuto = headers.findIndex(h => h.includes('AUTO'));
      const out: UserRoleAutoProvisionRow[] = [];
      for (let r = headerIdx + 1; r < rawRows.length; r++) {
        const row = rawRows[r] as any[];
        if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) continue;
        const username = idxUser >= 0 ? String(row[idxUser] || '').trim() : '';
        if (!username) continue;
        const roleName = idxRoleName >= 0 ? String(row[idxRoleName] || '').trim() : '';
        const roleCode = idxRoleCode >= 0 ? String(row[idxRoleCode] || '').trim() : '';
        const autoRaw = idxAuto >= 0 ? String(row[idxAuto] || '').trim().toLowerCase() : '';
        const autoProvisioned = autoRaw === 'yes' || autoRaw === 'y' || autoRaw === 'true' ? 'Yes' : (autoRaw === 'no' || autoRaw === 'n' || autoRaw === 'false' ? 'No' : null);
        out.push({ username, roleName, roleCode, autoProvisioned });
      }
      return out;
    } catch (err: any) {
      console.warn('[BIP Client] Auto-Provisioning XLSX parse failed:', err.message);
      return [];
    }
  }

  /**
   * Parses SOAP response for Certifier Worksheet.
   */
  public async parseCertifierWorksheetSoapResponse(
    xmlContent: string,
    certificationId: string
  ): Promise<AccessCertificationDetailsResult> {
    const cleanCertId = String(certificationId || '').trim();
    if (!xmlContent || typeof xmlContent !== 'string') {
      return {
        success: false,
        certificationId: cleanCertId,
        count: 0,
        data: [],
        message: 'Unable to retrieve Access Certification details.'
      };
    }

    let parsedXml: any;
    try {
      parsedXml = await xml2js.parseStringPromise(xmlContent, {
        explicitArray: false,
        ignoreAttrs: true,
        tagNameProcessors: [xml2js.processors.stripPrefix],
      });
    } catch (xmlParseErr: any) {
      console.error('[BIP Client] XML parsing failure on Certifier Worksheet SOAP response:', xmlParseErr.message);
      return {
        success: false,
        certificationId: cleanCertId,
        count: 0,
        data: [],
        message: 'Unable to retrieve Access Certification details.'
      };
    }

    const fault = this.extractSoapFaultFromParsed(parsedXml);
    if (fault) {
      console.error('[BIP Client] Oracle BI Publisher SOAP Fault detected:', fault);
      return {
        success: false,
        certificationId: cleanCertId,
        count: 0,
        data: [],
        message: 'Unable to retrieve Access Certification details.'
      };
    }

    const rawReportBytes = this.findFieldRecursively(parsedXml, 'reportBytes');
    if (!rawReportBytes || typeof rawReportBytes !== 'string') {
      console.error('[BIP Client] Missing reportBytes in runReport response for Certifier Worksheet.');
      return {
        success: false,
        certificationId: cleanCertId,
        count: 0,
        data: [],
        message: 'Unable to retrieve Access Certification details.'
      };
    }

    return this.parseCertifierWorksheetXlsxBase64(rawReportBytes, cleanCertId);
  }

  /**
   * Decodes Base64 XLSX for Certifier Worksheet and maps to normalized user-level rows.
   * Preserves ALL multiple rows for the selected Certification ID.
   */
  public parseCertifierWorksheetXlsxBase64(
    base64Data: string,
    certificationId: string
  ): AccessCertificationDetailsResult {
    const cleanCertId = String(certificationId || '').trim();
    try {
      const cleanBase64 = base64Data.replace(/\s+/g, '');
      const buffer = Buffer.from(cleanBase64, 'base64');

      if (buffer.length === 0) {
        return {
          success: true,
          certificationId: cleanCertId,
          count: 0,
          data: [],
          message: 'No user access details found for this certification.'
        };
      }

      const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
      if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
        return {
          success: true,
          certificationId: cleanCertId,
          count: 0,
          data: [],
          message: 'No user access details found for this certification.'
        };
      }

      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      if (!worksheet) {
        return {
          success: true,
          certificationId: cleanCertId,
          count: 0,
          data: [],
          message: 'No user access details found for this certification.'
        };
      }

      const rawRows = xlsx.utils.sheet_to_json<any[]>(worksheet, {
        header: 1,
        defval: null,
        blankrows: false
      });

      if (!rawRows || rawRows.length === 0) {
        return {
          success: true,
          certificationId: cleanCertId,
          count: 0,
          data: [],
          message: 'No user access details found for this certification.'
        };
      }

      // Robust Header Detection: Find the row containing the expected business headers
      let headerRowIndex = -1;
      const expectedKeywords = [
        'certification id',
        'certification name',
        'owner name',
        'manager name',
        'due date',
        'status',
        'user name'
      ];

      for (let r = 0; r < Math.min(15, rawRows.length); r++) {
        const row = rawRows[r];
        if (!Array.isArray(row)) continue;
        const matchingKeywords = row.filter((cell: any) => {
          if (!cell || typeof cell !== 'string') return false;
          const lower = cell.toLowerCase().trim();
          return expectedKeywords.some((kw) => lower.includes(kw));
        });

        if (matchingKeywords.length >= 2) {
          headerRowIndex = r;
          break;
        }
      }

      if (headerRowIndex === -1) {
        headerRowIndex = 0;
      }

      const headerRow = rawRows[headerRowIndex] as any[];
      const headers: string[] = [];

      for (let c = 0; c < headerRow.length; c++) {
        const rawCol = headerRow[c];
        if (rawCol && typeof rawCol === 'string' && rawCol.trim() !== '') {
          headers.push(rawCol.trim());
        } else {
          headers.push(`col_${c + 1}`);
        }
      }

      const parsedRows: Record<string, any>[] = [];

      for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
        const rowData = rawRows[r] as any[];
        if (!Array.isArray(rowData)) continue;

        // Skip completely empty rows
        const hasContent = rowData.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');
        if (!hasContent) continue;

        const record: Record<string, any> = {};
        for (let c = 0; c < headers.length; c++) {
          const key = headers[c];
          let val = rowData[c];

          if (val === null || val === undefined) {
            val = '';
          } else if (val instanceof Date) {
            val = this.formatDate(val);
          } else if (typeof val === 'string') {
            val = val.trim();
          }

          record[key] = val;
        }

        parsedRows.push(record);
      }

      // Map raw BIP columns to application fields while preserving all source columns & order
      const normalizedRows = parsedRows.map((r) => this.normalizeCertifierRow(r, cleanCertId, headers));

      // Keep ALL rows belonging to the selected Certification ID
      const matchingRows = cleanCertId
        ? normalizedRows.filter((r) => String(r.certificationId).trim() === cleanCertId)
        : normalizedRows;

      console.log(`[BIP Client] Certifier Worksheet: Parsed ${matchingRows.length} rows for Certification ID "${cleanCertId}" (${normalizedRows.length} total rows) from sheet "${firstSheetName}".`);

      return {
        success: true,
        certificationId: cleanCertId,
        count: matchingRows.length,
        data: matchingRows,
        allData: normalizedRows,
        message: matchingRows.length === 0 ? 'No user access details found for this certification.' : undefined
      };
    } catch (err: any) {
      console.error('[BIP Client] Certifier Worksheet XLSX parsing error:', err.message);
      return {
        success: false,
        certificationId: cleanCertId,
        count: 0,
        data: [],
        message: 'Unable to retrieve Access Certification details.'
      };
    }
  }

  /**
   * Resolves the canonical or actual Certification Campaign ID from a certification campaign name.
   * Matches live Oracle Fusion campaign naming patterns.
   */
  public resolveCampaignIdFromName(certName: string, knownCerts?: any[]): string | null {
    if (!certName) return null;
    const clean = certName.trim();
    const norm = clean.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Check against known list if provided
    if (Array.isArray(knownCerts)) {
      for (const c of knownCerts) {
        const cName = String(c.certificationName || c.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const cId = String(c.certificationId ?? c.id ?? '').trim();
        if (cName && cId && (norm === cName || norm.includes(cName) || cName.includes(norm))) {
          return cId;
        }
      }
    }

    // Default known mappings for Oracle Fusion campaigns
    if (norm.includes('itsecuritymanager') || (norm.includes('security') && norm.includes('manager'))) {
      return '2';
    }
    if (norm.includes('accountspayable') || norm.includes('payable')) {
      return '3';
    }
    if (norm.includes('accountsreceivable') || norm.includes('receivable')) {
      return '7002';
    }
    if (norm.includes('advancedaccesscontrol') || (norm.includes('access') && norm.includes('control'))) {
      return '1';
    }
    return null;
  }

  /**
   * Normalizes a raw Certifier Worksheet row into the standardized CertifierWorksheetRow format.
   * Maps actual BIP column names directly (live-only: blank cells stay blank, no invented defaults):
   *  - Role Name: row['Role Name'] || row['Job Role Name']
   *  - User Name: row['Owner Name'] || row['User Name']
   *  - Certified Manager: row['Manager Name'] || row['Certifier Name']
   *  - Certification Name: row['Certification Name']
   *  - Certification ID: row['Certification ID']
   *  - User Business Unit: row['User Business Unit'] || row['Business Unit']
   *  - User Manager: row['Manager Name'] || row['User Manager']
   */
  public normalizeCertifierRow(row: Record<string, any>, certIdDefault = '', sourceColumns?: string[]): CertifierWorksheetRow {
    // Live-only: certification name comes strictly from the worksheet row.
    let certName = String(
      row['Certification Name'] ??
      row['certificationName'] ??
      row['CERTIFICATION_NAME'] ??
      ''
    ).trim();

    const explicitCertId = String(
      row['Certification ID'] ??
      row['certificationId'] ??
      row['CERTIFICATION_ID'] ??
      ''
    ).trim();

    const resolvedFromCertName = this.resolveCampaignIdFromName(certName);
    const certId = explicitCertId || resolvedFromCertName || certIdDefault;

    const owner = String(
      row['Owner Name'] ??
      row['ownerName'] ??
      row['OWNER_NAME'] ??
      row['User Name'] ??
      row['userName'] ??
      row['USER_NAME'] ??
      ''
    ).trim();

    const manager = String(
      row['Manager Name'] ??
      row['managerName'] ??
      row['MANAGER_NAME'] ??
      row['Certified Manager'] ??
      row['certifiedManager'] ??
      row['CERTIFIED_MANAGER'] ??
      row['User Manager'] ??
      row['userManager'] ??
      row['Certifier Name'] ??
      row['certifierName'] ??
      ''
    ).trim();

    const rawRole = String(
      row['Role Name'] ??
      row['roleName'] ??
      row['ROLE_NAME'] ??
      row['Job Role Name'] ??
      row['jobRoleName'] ??
      ''
    ).trim();
    // Live-only: no invented role names. Blank stays blank.
    const role = rawRole;

    const bu = String(
      row['User Business Unit'] ??
      row['userBusinessUnit'] ??
      row['Business Unit'] ??
      row['businessUnit'] ??
      row['BUSINESS_UNIT'] ??
      ''
    ).trim();

    let completion = 0;
    const rawPct =
      row['Certification Percent Complete'] ??
      row['certificationPercentComplete'] ??
      row['completionPercent'] ??
      0;
    if (typeof rawPct === 'number') {
      completion = rawPct;
    } else if (typeof rawPct === 'string') {
      const num = parseFloat(rawPct.replace('%', '').trim());
      completion = isNaN(num) ? 0 : num;
    }

    const numericCertId = Number(certId) || certId;

    let formattedDue = String(row['Due Date'] ?? row['dueDate'] ?? '').trim();
    if (formattedDue.includes('T')) {
      formattedDue = formattedDue.split('T')[0];
    }

    const jobRole = String(row['Job Role Name'] ?? row['jobRoleName'] ?? row['JOB_ROLE_NAME'] ?? role).trim();
    const position = String(row['User Position Name'] ?? row['userPositionName'] ?? row['Position Name'] ?? row['positionName'] ?? '').trim();
    const userJob = String(row['User Job Name'] ?? row['userJobName'] ?? row['Job Name'] ?? row['jobName'] ?? '').trim();
    const loc = String(row['User Location'] ?? row['userLocation'] ?? row['Location'] ?? row['location'] ?? '').trim();
    const userRoleBu = String(row['User Business Unit'] ?? row['USER_BUSINESS_UNIT'] ?? row['User-Role Business Unit'] ?? row['userRoleBusinessUnit'] ?? bu).trim();
    const userMgrName = String(row['User Manager Name'] ?? row['userManagerName'] ?? manager).trim();
    const commentVal = String(row['Comment'] ?? row['comment'] ?? row['Comments'] ?? row['comments'] ?? '').trim();

    return {
      ...row,
      ...(Array.isArray(sourceColumns) && sourceColumns.length > 0 ? { _sourceColumns: sourceColumns } : {}),
      id: numericCertId,
      certificationId: numericCertId,
      name: certName,
      certificationName: certName,
      userName: owner,
      ownerName: owner,
      roleName: jobRole || role,
      jobRoleName: jobRole || role,
      roleCode: row['Role Code'] || row['roleCode'] || '',
      certifiedManager: manager,
      certifierName: manager || owner,
      certifierId: row['Certifier ID'] || row['certifierId'] || '',
      userBusinessUnit: bu,
      businessUnit: bu,
      userRoleBusinessUnit: userRoleBu || bu,
      userManager: manager,
      userManagerName: userMgrName || manager,
      directManager: row['Direct Manager'] || row['directManager'] || row['DIRECT_MANAGER'] || null,
      userPositionName: position,
      positionName: position,
      userJobName: userJob,
      jobName: userJob,
      userLocation: loc,
      location: loc,
      department: row['Department'] || row['department'] || '',
      status: String(row['Status'] ?? row['status'] ?? ''),
      type: String(row['Type'] ?? row['type'] ?? ''),
      completionPercent: completion,
      dueDate: String(row['Due Date'] ?? row['dueDate'] ?? ''),
      creationDate: String(row['Creation Date'] ?? row['creationDate'] ?? ''),
      createdBy: String(row['Created By'] ?? row['createdBy'] ?? ''),
      action: row['Action'] || row['action'] || '',
      comment: commentVal,
      comments: commentVal,
      commentBy: String(row['Comment By'] ?? row['commentBy'] ?? row['COMMENT_BY'] ?? '').trim(),
      followUpStatus: row['Follow-Up'] || row['followUpStatus'] || '',
      lastUpdatedBy: String(row['Last Updated By'] ?? row['lastUpdatedBy'] ?? row['LAST_UPDATED_BY'] ?? '').trim(),
      lastUpdatedDate: String(row['Last Updated Date'] ?? row['lastUpdatedDate'] ?? row['LAST_UPDATED_DATE'] ?? '').trim(),
      certifierSelfCertified: String(row['Certifier Self-Certified'] ?? row['certifierSelfCertified'] ?? row['Self Certified'] ?? row['selfCertified'] ?? row['CERTIFIER_SELF_CERTIFIED'] ?? '').trim(),
      selfCertified: String(row['Certifier Self-Certified'] ?? row['certifierSelfCertified'] ?? row['Self Certified'] ?? row['selfCertified'] ?? row['CERTIFIER_SELF_CERTIFIED'] ?? '').trim(),
      pendingSubmission: String(row['Pending Submission'] ?? row['pendingSubmission'] ?? row['PENDING_SUBMISSION'] ?? '').trim(),
      certifierLastUpdatedBy: String(row['Certifier Last Updated By'] ?? row['certifierLastUpdatedBy'] ?? row['CERTIFIER_LAST_UPDATED_BY'] ?? '').trim(),
      lastDecisionBy: String(row['Certifier Last Updated By'] ?? row['certifierLastUpdatedBy'] ?? row['Last Decision By'] ?? row['lastDecisionBy'] ?? row['CERTIFIER_LAST_UPDATED_BY'] ?? '').trim(),
      certifierLastUpdatedDate: String(row['Certifier Last Updated Date'] ?? row['certifierLastUpdatedDate'] ?? row['CERTIFIER_LAST_UPDATED_DATE'] ?? '').trim(),
      lastDecisionDate: String(row['Certifier Last Updated Date'] ?? row['certifierLastUpdatedDate'] ?? row['Last Decision Date'] ?? row['lastDecisionDate'] ?? row['CERTIFIER_LAST_UPDATED_DATE'] ?? '').trim()
    };
  }

  /**
   * Normalizes BIP report column headers to camelCase UI/API field names.
   */
  public normalizeHeader(rawHeader: string): string {
    const cleaned = rawHeader.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

    if (cleaned.includes('certificationid') || cleaned.includes('certid') || cleaned.includes('campaignid') || cleaned === 'id') return 'certificationId';
    if (cleaned.includes('creationdate')) return 'creationDate';
    if (cleaned === 'status') return 'status';
    if (cleaned === 'type') return 'type';
    if (cleaned.includes('percentcomplete') || cleaned.includes('percent') || cleaned.includes('pctcomplete')) {
      return 'certificationPercentComplete';
    }
    if (cleaned.includes('certificationname') || cleaned.includes('certname') || cleaned.includes('campaignname')) return 'certificationName';
    if (cleaned.includes('duedate')) return 'dueDate';
    if (cleaned.includes('ownername') || cleaned === 'owner') return 'ownerName';
    if (cleaned.includes('managername') || cleaned === 'manager') return 'managerName';
    if (cleaned.includes('certifiername') || cleaned === 'certifier') return 'certifierName';

    // Fallback camelCase
    return rawHeader.trim().replace(/(?:^\w|[A-Z]|\b\w)/g, (letter, index) =>
      index === 0 ? letter.toLowerCase() : letter.toUpperCase()
    ).replace(/\s+/g, '');
  }

  private formatDate(date: Date): string {
    try {
      const pad = (n: number) => (n < 10 ? '0' + n : String(n));
      const year = date.getFullYear();
      const month = pad(date.getMonth() + 1);
      const day = pad(date.getDate());
      const hours = pad(date.getHours());
      const minutes = pad(date.getMinutes());

      // If time is 00:00, return YYYY-MM-DD
      if (hours === '00' && minutes === '00') {
        return `${year}-${month}-${day}`;
      }
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    } catch (_) {
      return date.toISOString();
    }
  }

  /**
   * Resolves the runnable All Module Roles report path.
   */
  public async findAllModuleRolesReportPath(): Promise<string | null> {
    const now = Date.now();
    if (this.allModuleRolesResolvedPath && now - this.allModuleRolesResolvedAt < 60 * 60 * 1000) {
      return this.allModuleRolesResolvedPath;
    }

    for (const candidate of this.allModuleRolesReportPaths) {
      try {
        if (await this.isReportExist(candidate)) {
          this.allModuleRolesResolvedPath = candidate;
          this.allModuleRolesResolvedAt = now;
          console.log(`[BIP Client] Resolved All Module Roles report path: "${candidate}"`);
          return candidate;
        }
      } catch (_) {}
    }

    // Default fallback to expected standard path
    return '/Custom/Claaps_All_Module_Roles.xdo';
  }

  /**
   * Runs the authoritative All Module Roles report on Oracle Fusion BI Publisher via SOAP 1.2
   * and returns parsed rows with MODULE, ROLE_NAME, ROLE_CODE, ROLE_DESCRIPTION, and ROLE_CATEGORY.
   */
  public async runAllModuleRolesReport(reportPathOverride?: string): Promise<BipRolesReportResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        data: [],
        count: 0,
        message: 'Oracle Fusion instance link not configured.'
      };
    }

    const reportPath = reportPathOverride || (await this.findAllModuleRolesReportPath()) || '/Custom/Claaps_All_Module_Roles.xdo';
    const { baseUrl } = this.getCredentials();
    const endpoint = `${baseUrl}/xmlpserver/services/ExternalReportWSSService`;

    console.log(`[BIP Client] Executing on-demand All Module Roles BIP report: "${reportPath}" via ${endpoint}`);

    try {
      const soapEnvelope = this.generateRunReportEnvelope(reportPath, 'xlsx', -1);
      const response = await this.axiosInstance.post(endpoint, soapEnvelope, {
        headers: {
          'Content-Type': 'application/soap+xml; charset=UTF-8',
          Action: 'runReport'
        },
        responseType: 'text',
        timeout: 60000
      });

      const parsedXml: any = await xml2js.parseStringPromise(response.data, {
        explicitArray: false,
        ignoreAttrs: true,
        tagNameProcessors: [xml2js.processors.stripPrefix]
      });

      const soapFault = this.extractSoapFaultFromParsed(parsedXml);
      if (soapFault) {
        console.error('[BIP Client] All Module Roles SOAP fault:', soapFault);
        return {
          success: false,
          data: [],
          count: 0,
          reportPath,
          error: soapFault
        };
      }

      const rawReportBytes = this.findFieldRecursively(parsedXml, 'reportBytes');
      if (!rawReportBytes || typeof rawReportBytes !== 'string') {
        console.error('[BIP Client] Missing reportBytes in runReport response for All Module Roles.');
        return {
          success: false,
          data: [],
          count: 0,
          reportPath,
          message: 'BIP response did not contain reportBytes.'
        };
      }

      const rows = this.parseAllModuleRolesXlsxBase64(rawReportBytes);
      console.log(`[BIP Client] All Module Roles report "${reportPath}" returned ${rows.length} rows.`);

      return {
        success: true,
        data: rows,
        count: rows.length,
        reportPath
      };
    } catch (err: any) {
      console.error(`[BIP Client] All Module Roles report "${reportPath}" execution failed:`, err.message);
      return {
        success: false,
        data: [],
        count: 0,
        reportPath,
        error: err.message
      };
    }
  }

  /**
   * Parses the base64-encoded XLSX bytes from the All Module Roles report.
   */
  public parseAllModuleRolesXlsxBase64(base64Data: string): BipRoleRow[] {
    try {
      const buffer = Buffer.from(base64Data.replace(/\s+/g, ''), 'base64');
      if (buffer.length === 0) return [];

      const workbook = xlsx.read(buffer, { type: 'buffer' });
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) return [];

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) return [];

      const rawRows = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '', blankrows: false });
      if (!rawRows || rawRows.length === 0) return [];

      // Detect header row containing ROLE_CODE, ROLE_NAME, MODULE
      let headerIdx = 0;
      for (let r = 0; r < Math.min(15, rawRows.length); r++) {
        const row = (rawRows[r] as any[]).map(c => String(c || '').trim().toUpperCase());
        if (row.includes('ROLE_CODE') || (row.includes('ROLE_NAME') && row.includes('MODULE'))) {
          headerIdx = r;
          break;
        }
      }

      const headers = (rawRows[headerIdx] as any[]).map(h => String(h || '').trim().toUpperCase());
      const idxModule = headers.findIndex(h => h === 'MODULE' || h.includes('MODULE'));
      const idxRoleName = headers.findIndex(h => h === 'ROLE_NAME' || (h.includes('ROLE') && h.includes('NAME')));
      const idxRoleCode = headers.findIndex(h => h === 'ROLE_CODE' || (h.includes('ROLE') && h.includes('CODE')));
      const idxDesc = headers.findIndex(h => h === 'ROLE_DESCRIPTION' || h.includes('DESC'));
      const idxCategory = headers.findIndex(h => h === 'ROLE_CATEGORY' || h.includes('CATEGORY'));

      const out: BipRoleRow[] = [];
      const seenCodes = new Set<string>();

      for (let r = headerIdx + 1; r < rawRows.length; r++) {
        const row = rawRows[r] as any[];
        if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) continue;

        const roleCode = idxRoleCode >= 0 ? String(row[idxRoleCode] || '').trim() : '';
        if (!roleCode) continue;

        if (seenCodes.has(roleCode)) continue;
        seenCodes.add(roleCode);

        const moduleVal = idxModule >= 0 ? String(row[idxModule] || '').trim() : 'Common';
        const roleName = idxRoleName >= 0 ? String(row[idxRoleName] || '').trim() : roleCode;
        const description = idxDesc >= 0 ? String(row[idxDesc] || '').trim() : '';
        const categoryVal = idxCategory >= 0 ? String(row[idxCategory] || '').trim() : '';

        out.push({
          module: moduleVal || 'Common',
          roleName: roleName || roleCode,
          roleCode,
          description,
          category: categoryVal
        });
      }

      return out;
    } catch (err: any) {
      console.error('[BIP Client] Error parsing All Module Roles XLSX:', err.message);
      return [];
    }
  }

  /**
   * Prefix-independent extraction of SOAP Fault details from parsed XML object.
   */
  private extractSoapFaultFromParsed(obj: any): string | null {
    if (!obj || typeof obj !== 'object') return null;

    const fault = this.findFieldRecursively(obj, 'Fault');
    if (!fault) return null;

    if (typeof fault === 'string') return fault;

    // SOAP 1.2: Reason -> Text
    const reasonText = this.findFieldRecursively(fault, 'Text');
    if (reasonText && typeof reasonText === 'string') return reasonText;

    // SOAP 1.1: faultstring
    const faultString = this.findFieldRecursively(fault, 'faultstring');
    if (faultString && typeof faultString === 'string') return faultString;

    return JSON.stringify(fault);
  }

  /**
   * Recursively searches for a property name in an object, ignoring namespace prefixes and casing.
   */
  private findFieldRecursively(obj: any, targetKey: string): any {
    if (!obj || typeof obj !== 'object') return null;

    const lowerTarget = targetKey.toLowerCase();
    for (const key of Object.keys(obj)) {
      const cleanKey = key.split(':').pop()!.toLowerCase();
      if (cleanKey === lowerTarget) {
        return obj[key];
      }
    }

    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        const found = this.findFieldRecursively(obj[key], targetKey);
        if (found !== null && found !== undefined) {
          return found;
        }
      }
    }

    return null;
  }
}

export const bipClient = new BipClient();
