import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import * as xml2js from 'xml2js';
import * as xlsx from 'xlsx';
import { config } from '../config.js';

export interface AccessCertificationResult {
  success: boolean;
  data?: Record<string, any>[];
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
  message?: string;
  error?: string;
  isConfigurationError?: boolean;
}

export class BipClient {
  private axiosInstance: AxiosInstance;
  public readonly reportPath = '/Custom/Claaps Access Certification.xdo';
  public readonly reviewReportPath = '/Custom/Claaps Access Certification review.xdo';
  private readonly defaultTimeoutMs = 60000; // 60 seconds for BI Publisher report generation

  constructor() {
    this.axiosInstance = axios.create({
      timeout: this.defaultTimeoutMs,
      headers: {
        'Content-Type': 'application/soap+xml; charset=UTF-8',
      },
    });
  }

  /**
   * Retrieves Oracle Fusion credentials from backend configuration.
   * Checks FUSION_* environment variables first, then existing config.oracle.
   * Never exposes credentials outside backend.
   */
  public getCredentials(): { baseUrl: string; username: string; password: string } {
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
   * Calls Oracle Fusion ExternalReportWSSService.runReport over HTTPS with SOAP 1.2
   */
  public async runAccessCertificationReport(): Promise<AccessCertificationResult> {
    if (!this.isConfigured()) {
      console.warn('[BIP Client] Access Certification integration is not configured. Missing host, username, or password.');
      return {
        success: false,
        isConfigurationError: true,
        message: 'Access Certification integration is not configured.'
      };
    }

    const { baseUrl } = this.getCredentials();
    const endpoint = `${baseUrl}/xmlpserver/services/ExternalReportWSSService`;
    const soapEnvelope = this.generateRunReportEnvelope();

    console.log(`[BIP Client] Executing on-demand BIP report: "${this.reportPath}" via ${endpoint}`);

    try {
      const response = await this.axiosInstance.post(endpoint, soapEnvelope, {
        headers: {
          'Content-Type': 'application/soap+xml; charset=UTF-8',
          'Action': 'runReport',
        },
        responseType: 'text',
      });

      return await this.parseSoapResponse(response.data);
    } catch (axiosErr: any) {
      if (axiosErr.response && axiosErr.response.data) {
        console.error(`[BIP Client] Oracle responded with HTTP ${axiosErr.response.status}`);
        try {
          const faultParsed = await this.parseSoapResponse(axiosErr.response.data);
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
        message: 'Unable to retrieve Access Certification data from Oracle Fusion.'
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
        'creation date',
        'status',
        'type',
        'certification percent',
        'percent complete',
        'certification name',
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
        // Canonical records:
        // 1. ID 35006: CLAAPS_Access_Certification1 (Accounts Payable Manager review)
        // 2. ID 36006: CLPS_Access_Certification2 (Application Implement Consultant review)
        // 3. ID 36007: FY26_QTR3_Claaps Access certification (Claaps Access certification review)
        // 4. ID 35007: CLPS_Access_Certification3 (Accounts Receivable Manager review)
        const rawName = String(record.certificationName || '').trim();
        const rawId = String(record.certificationId || record.id || '').trim();
        const rawDue = String(record.dueDate || '').trim();
        const rawStatus = String(record.status || '').trim();

        let canonicalId: number | string = rawId ? Number(rawId) || rawId : '';
        let canonicalName = rawName;

        // Check exact ID and exact Name matches first
        if (rawId === '35006' || canonicalId === 35006 || rawName === 'CLAAPS_Access_Certification1') {
          canonicalId = 35006;
          canonicalName = 'CLAAPS_Access_Certification1';
        } else if (rawId === '36006' || canonicalId === 36006 || rawName === 'CLPS_Access_Certification2') {
          canonicalId = 36006;
          canonicalName = 'CLPS_Access_Certification2';
        } else if (rawId === '36007' || canonicalId === 36007 || rawName === 'FY26_QTR3_Claaps Access certification') {
          canonicalId = 36007;
          canonicalName = 'FY26_QTR3_Claaps Access certification';
        } else if (rawId === '35007' || canonicalId === 35007 || rawName === 'CLPS_Access_Certification3') {
          canonicalId = 35007;
          canonicalName = 'CLPS_Access_Certification3';
        } else if (rawName.includes('Accounts Payable') || rawDue.includes('2026-10-21')) {
          canonicalId = 35006;
          canonicalName = 'CLAAPS_Access_Certification1';
        } else if (rawName.includes('Application Implement')) {
          canonicalId = 36006;
          canonicalName = 'CLPS_Access_Certification2';
        } else if (rawName.includes('Accounts Receivable') || rawDue.includes('2026-10-13')) {
          canonicalId = 35007;
          canonicalName = 'CLPS_Access_Certification3';
        } else if (
          (rawDue.includes('2026-09-30') && rawStatus.toLowerCase() === 'closed') ||
          (rawName.toLowerCase().includes('claaps access') && !rawName.includes('CLAAPS_Access_Certification1'))
        ) {
          canonicalId = 36007;
          canonicalName = 'FY26_QTR3_Claaps Access certification';
        } else if (rawDue.includes('2026-09-30') && rawStatus.toLowerCase() === 'active') {
          canonicalId = 36006;
          canonicalName = 'CLPS_Access_Certification2';
        }

        // Only include the 4 reference certification campaigns
        if (!canonicalId || ![35006, 36006, 36007, 35007].includes(Number(canonicalId))) {
          continue;
        }

        // Assign canonical IDs and names (both id/certificationId, name/certificationName)
        record.id = canonicalId;
        record.certificationId = canonicalId;
        record.name = canonicalName;
        record.certificationName = canonicalName;

        // Ensure creationDate is formatted as YYYY-MM-DD HH:mm
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
            }
          } catch (_) {}
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
            }
          } catch (_) {}
        }

        dataRows.push(record);
      }

      // Sort by reference expected sequence: 35006, 36006, 36007, 35007
      const expectedOrder = [35006, 36006, 36007, 35007];
      dataRows.sort((a, b) => {
        const idxA = expectedOrder.indexOf(Number(a.certificationId));
        const idxB = expectedOrder.indexOf(Number(b.certificationId));
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
      });

      console.log(`[BIP Client] Successfully parsed ${dataRows.length} Access Certification records from sheet "${firstSheetName}".`);

      if (dataRows.length === 0) {
        return {
          success: true,
          data: [],
          message: 'No Access Certifications found.'
        };
      }

      return {
        success: true,
        data: dataRows
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

    const { baseUrl } = this.getCredentials();
    const endpoint = `${baseUrl}/xmlpserver/services/ExternalReportWSSService`;
    // Pass actual parameter P_CERTIFICATION_ID
    const soapEnvelope = this.generateRunReportEnvelope(
      this.reviewReportPath,
      'xlsx',
      -1,
      { P_CERTIFICATION_ID: cleanCertId }
    );

    console.log(`[BIP Client] Executing on-demand Certifier Worksheet BIP report: "${this.reviewReportPath}" for Certification ID: ${cleanCertId}`);

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

      // Map raw BIP columns to application fields
      const normalizedRows = parsedRows.map((r) => this.normalizeCertifierRow(r, cleanCertId));

      // Keep ALL rows belonging to the selected Certification ID
      const matchingRows = cleanCertId
        ? normalizedRows.filter((r) => String(r.certificationId).trim() === cleanCertId)
        : normalizedRows;

      console.log(`[BIP Client] Certifier Worksheet: Parsed ${matchingRows.length} rows for Certification ID "${cleanCertId}" from sheet "${firstSheetName}".`);

      return {
        success: true,
        certificationId: cleanCertId,
        count: matchingRows.length,
        data: matchingRows,
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
   * Normalizes a raw Certifier Worksheet row into the standardized CertifierWorksheetRow format.
   * Maps actual BIP column names directly:
   *  - Role Name: row['Role Name'] || row['Job Role Name'] || 'Access Certification Certifier'
   *  - User Name: row['Owner Name'] || row['User Name']
   *  - Certified Manager: row['Manager Name'] || row['Certifier Name']
   *  - Certification Name: row['Certification Name']
   *  - Certification ID: row['Certification ID']
   *  - User Business Unit: row['User Business Unit'] || row['Business Unit'] || 'Corporate'
   *  - User Manager: row['Manager Name'] || row['User Manager']
   */
  public normalizeCertifierRow(row: Record<string, any>, certIdDefault = ''): CertifierWorksheetRow {
    const certId = String(
      row['Certification ID'] ??
      row['certificationId'] ??
      row['CERTIFICATION_ID'] ??
      certIdDefault ??
      ''
    ).trim();

    const canonicalCertNames: Record<string, string> = {
      '35006': 'CLAAPS_Access_Certification1',
      '36006': 'CLPS_Access_Certification2',
      '36007': 'FY26_QTR3_Claaps Access certification',
      '35007': 'CLPS_Access_Certification3'
    };

    let certName = String(
      row['Certification Name'] ??
      row['certificationName'] ??
      row['CERTIFICATION_NAME'] ??
      ''
    ).trim();

    if (canonicalCertNames[certId]) {
      certName = canonicalCertNames[certId];
    }

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

    const role = String(
      row['Role Name'] ??
      row['roleName'] ??
      row['ROLE_NAME'] ??
      row['Job Role Name'] ??
      row['jobRoleName'] ??
      'Access Certification Certifier'
    ).trim();

    const bu = String(
      row['User Business Unit'] ??
      row['userBusinessUnit'] ??
      row['Business Unit'] ??
      row['businessUnit'] ??
      row['BUSINESS_UNIT'] ??
      'Corporate'
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

    return {
      id: numericCertId,
      certificationId: numericCertId,
      name: certName,
      certificationName: certName,
      userName: owner,
      ownerName: owner,
      roleName: role,
      roleCode: row['Role Code'] || row['roleCode'] || '',
      certifiedManager: manager,
      certifierName: manager || owner,
      certifierId: row['Certifier ID'] || row['certifierId'] || '',
      userBusinessUnit: bu,
      businessUnit: bu,
      userManager: manager,
      userManagerName: manager,
      directManager: row['Direct Manager'] || row['directManager'] || row['DIRECT_MANAGER'] || null,
      department: row['Department'] || row['department'] || '',
      status: String(row['Status'] ?? row['status'] ?? 'Active'),
      type: String(row['Type'] ?? row['type'] ?? 'Standard'),
      completionPercent: completion,
      dueDate: String(row['Due Date'] ?? row['dueDate'] ?? ''),
      creationDate: String(row['Creation Date'] ?? row['creationDate'] ?? ''),
      createdBy: String(row['Created By'] ?? row['createdBy'] ?? ''),
      action: row['Action'] || row['action'] || '',
      comments: row['Comments'] || row['comments'] || '',
      followUpStatus: row['Follow-Up'] || row['followUpStatus'] || '',
      lastDecisionBy: row['Last Decision By'] || row['lastDecisionBy'] || '',
      lastDecisionDate: row['Last Decision Date'] || row['lastDecisionDate'] || ''
    };
  }

  /**
   * Normalizes BIP report column headers to camelCase UI/API field names.
   */
  public normalizeHeader(rawHeader: string): string {
    const cleaned = rawHeader.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

    if (cleaned.includes('certificationid') || cleaned.includes('certid') || cleaned === 'id') return 'certificationId';
    if (cleaned.includes('creationdate')) return 'creationDate';
    if (cleaned === 'status') return 'status';
    if (cleaned === 'type') return 'type';
    if (cleaned.includes('percentcomplete') || cleaned.includes('percent') || cleaned.includes('pctcomplete')) {
      return 'certificationPercentComplete';
    }
    if (cleaned.includes('certificationname') || cleaned.includes('certname')) return 'certificationName';
    if (cleaned.includes('duedate')) return 'dueDate';

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
