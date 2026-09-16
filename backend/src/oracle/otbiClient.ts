import axios, { AxiosInstance } from 'axios';
import { config } from '../config.js';

export interface RawOtbiPrivilegeRoleRow {
  privilegeName: string;
  privilegeCode: string;
  roleName: string;
  roleCode: string;
}

export interface OtbiQueryResult {
  success: boolean;
  rows: RawOtbiPrivilegeRoleRow[];
  totalRawRows: number;
  pagesFetched: number;
  queryId?: string;
  finished: boolean;
  durationMs: number;
  error?: string;
}

export class OtbiClient {
  private axiosInstance: AxiosInstance;
  private readonly defaultTimeoutMs = 120000; // 2 minutes for large datasets
  public readonly reportPath = '/shared/Custom/CLAAPS privilege_Role_mapping';

  constructor() {
    this.axiosInstance = axios.create({
      timeout: this.defaultTimeoutMs,
      headers: {
        'Content-Type': 'text/xml;charset=UTF-8'
      }
    });
  }

  private getBaseUrl(): string {
    const url = config.oracle.baseUrl || 'https://fa-euth-dev58-saasfademo1.ds-fa.oraclepdemos.com';
    return url.replace(/\/+$/, '');
  }

  /**
   * Generates SOAP Envelope for SAWSessionService.logon
   */
  public generateLogonEnvelope(username: string, password: string): string {
    return `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v6="urn://oracle.bi.webservices/v6">
  <soapenv:Header/>
  <soapenv:Body>
    <v6:logon>
      <v6:name>${this.escapeXml(username)}</v6:name>
      <v6:password>${this.escapeXml(password)}</v6:password>
    </v6:logon>
  </soapenv:Body>
</soapenv:Envelope>
    `.trim();
  }

  /**
   * Generates SOAP Envelope for XmlViewService.executeXMLQuery
   */
  public generateExecuteQueryEnvelope(reportPath: string, sessionId: string, maxRowsPerPage = 50000): string {
    return `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v6="urn://oracle.bi.webservices/v6">
  <soapenv:Header/>
  <soapenv:Body>
    <v6:executeXMLQuery>
      <v6:report>
        <v6:reportPath>${this.escapeXml(reportPath)}</v6:reportPath>
      </v6:report>
      <v6:outputFormat></v6:outputFormat>
      <v6:executionOptions>
        <v6:async>false</v6:async>
        <v6:maxRowsPerPage>${maxRowsPerPage}</v6:maxRowsPerPage>
        <v6:refresh>true</v6:refresh>
        <v6:presentationInfo>true</v6:presentationInfo>
      </v6:executionOptions>
      <v6:sessionID>${this.escapeXml(sessionId)}</v6:sessionID>
    </v6:executeXMLQuery>
  </soapenv:Body>
</soapenv:Envelope>
    `.trim();
  }

  /**
   * Generates SOAP Envelope for XmlViewService.fetchNext (Pagination)
   */
  public generateFetchNextEnvelope(queryId: string, sessionId: string): string {
    return `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v6="urn://oracle.bi.webservices/v6">
  <soapenv:Header/>
  <soapenv:Body>
    <v6:fetchNext>
      <v6:queryID>${this.escapeXml(queryId)}</v6:queryID>
      <v6:sessionID>${this.escapeXml(sessionId)}</v6:sessionID>
    </v6:fetchNext>
  </soapenv:Body>
</soapenv:Envelope>
    `.trim();
  }

  /**
   * Generates SOAP Envelope for SAWSessionService.logoff
   */
  public generateLogoffEnvelope(sessionId: string): string {
    return `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v6="urn://oracle.bi.webservices/v6">
  <soapenv:Header/>
  <soapenv:Body>
    <v6:logoff>
      <v6:sessionID>${this.escapeXml(sessionId)}</v6:sessionID>
    </v6:logoff>
  </soapenv:Body>
</soapenv:Envelope>
    `.trim();
  }

  /**
   * Authenticates with OTBI and securely returns the sessionID.
   */
  public async logon(): Promise<string> {
    const baseUrl = this.getBaseUrl();
    const endpoint = `${baseUrl}/analytics-ws/saw.dll?SoapImpl=nQSessionService`;
    const username = config.oracle.username || 'sep1.sep1';
    const password = config.oracle.password;

    if (!username || !password) {
      throw new Error('[OTBI Client] Missing Oracle credentials for OTBI authentication.');
    }

    const envelope = this.generateLogonEnvelope(username, password);
    console.log(`[OTBI Client] Authenticating user "${username}" against SAWSessionService...`);

    const response = await this.axiosInstance.post(endpoint, envelope, {
      headers: { 'SOAPAction': '#logon' }
    });

    const sessionMatch = response.data.match(/<(?:\w+:)?sessionID[^>]*>([^<]+)<\/(?:\w+:)?sessionID>/i);
    const sessionId = sessionMatch ? sessionMatch[1].trim() : null;

    if (!sessionId) {
      const faultMatch = response.data.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
      const fault = faultMatch ? faultMatch[1].trim() : 'Unknown authentication failure';
      throw new Error(`[OTBI Client] Failed to obtain OTBI session ID: ${fault}`);
    }

    // Security: never log full sessionId
    console.log(`[OTBI Client] Authentication successful. Session established (ID prefix: ${sessionId.substring(0, 6)}...).`);
    return sessionId;
  }

  /**
   * Terminates the OTBI session.
   */
  public async logoff(sessionId: string): Promise<void> {
    if (!sessionId) return;
    try {
      const baseUrl = this.getBaseUrl();
      const endpoint = `${baseUrl}/analytics-ws/saw.dll?SoapImpl=nQSessionService`;
      const envelope = this.generateLogoffEnvelope(sessionId);

      await this.axiosInstance.post(endpoint, envelope, {
        headers: { 'SOAPAction': '#logoff' },
        timeout: 15000
      });
      console.log(`[OTBI Client] Session closed successfully.`);
    } catch (err: any) {
      console.warn(`[OTBI Client] Warning: Session logoff encountered:`, err.message);
    }
  }

  /**
   * Fetches the complete Analysis result set from OTBI, paging through all rows until complete.
   */
  public async fetchCompleteAnalysis(reportPath = this.reportPath): Promise<OtbiQueryResult> {
    const startTime = Date.now();
    let sessionId = '';
    const allRows: RawOtbiPrivilegeRoleRow[] = [];
    let pagesFetched = 0;
    let queryId: string | undefined;
    let isFinished = false;

    try {
      sessionId = await this.logon();
      const baseUrl = this.getBaseUrl();
      const queryEndpoint = `${baseUrl}/analytics-ws/saw.dll?SoapImpl=xmlViewService`;

      console.log(`[OTBI Client] Executing analysis "${reportPath}" via XmlViewService...`);
      const initialEnvelope = this.generateExecuteQueryEnvelope(reportPath, sessionId);

      const res = await this.axiosInstance.post(queryEndpoint, initialEnvelope, {
        headers: { 'SOAPAction': '#executeXMLQuery' }
      });

      pagesFetched++;
      const { rows, finished, returnedQueryId } = this.parseXmlQueryResponse(res.data);
      allRows.push(...rows);
      isFinished = finished;
      queryId = returnedQueryId;

      console.log(`[OTBI Client] Page ${pagesFetched}: retrieved ${rows.length} rows (finished=${finished}, queryID=${queryId}).`);

      // Pagination loop: Continue calling fetchNext until finished === true
      const maxPages = 50; // Safeguard against infinite loop
      while (!isFinished && queryId && pagesFetched < maxPages) {
        console.log(`[OTBI Client] Fetching next page (page ${pagesFetched + 1}) for queryID ${queryId}...`);
        const fetchNextEnvelope = this.generateFetchNextEnvelope(queryId, sessionId);

        const pageRes = await this.axiosInstance.post(queryEndpoint, fetchNextEnvelope, {
          headers: { 'SOAPAction': '#fetchNext' }
        });

        pagesFetched++;
        const pageResult = this.parseXmlQueryResponse(pageRes.data);
        allRows.push(...pageResult.rows);
        isFinished = pageResult.finished;
        console.log(`[OTBI Client] Page ${pagesFetched}: retrieved ${pageResult.rows.length} rows (total cumulative: ${allRows.length}, finished=${isFinished}).`);

        if (pageResult.rows.length === 0) {
          console.log(`[OTBI Client] No more rows returned in page ${pagesFetched}. Ending pagination.`);
          break;
        }
      }

      const durationMs = Date.now() - startTime;
      console.log(`[OTBI Client] Completed analysis fetch: ${allRows.length} total rows retrieved in ${pagesFetched} page(s) (${durationMs}ms).`);

      return {
        success: true,
        rows: allRows,
        totalRawRows: allRows.length,
        pagesFetched,
        queryId,
        finished: isFinished,
        durationMs
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      console.error(`[OTBI Client] Failed to fetch OTBI analysis:`, err.message);
      return {
        success: false,
        rows: allRows,
        totalRawRows: allRows.length,
        pagesFetched,
        queryId,
        finished: isFinished,
        durationMs,
        error: err.message
      };
    } finally {
      if (sessionId) {
        await this.logoff(sessionId);
      }
    }
  }

  /**
   * Parses XML response returned by executeXMLQuery or fetchNext.
   * Extracts Column0 (Priv Name), Column1 (Priv Code), Column2 (Role Name), Column3 (Role Code).
   */
  public parseXmlQueryResponse(xmlData: string): {
    rows: RawOtbiPrivilegeRoleRow[];
    finished: boolean;
    returnedQueryId?: string;
  } {
    const finishedMatch = xmlData.match(/<(?:\w+:)?finished[^>]*>([^<]+)<\/(?:\w+:)?finished>/i);
    const finished = finishedMatch ? finishedMatch[1].trim().toLowerCase() === 'true' : true;

    const queryIdMatch = xmlData.match(/<(?:\w+:)?queryID[^>]*>([^<]+)<\/(?:\w+:)?queryID>/i);
    const returnedQueryId = queryIdMatch ? queryIdMatch[1].trim() : undefined;

    const rows: RawOtbiPrivilegeRoleRow[] = [];

    // Rows can be in standard XML or entity-encoded &lt;Row&gt;...&lt;/Row&gt;
    const rowRegex = /<Row>([\s\S]*?)<\/Row>|&lt;Row&gt;([\s\S]*?)&lt;\/Row&gt;/gi;
    const col0Regex = /(?:<Column0>|&lt;Column0&gt;)([\s\S]*?)(?:<\/Column0>|&lt;\/Column0&gt;)/i;
    const col1Regex = /(?:<Column1>|&lt;Column1&gt;)([\s\S]*?)(?:<\/Column1>|&lt;\/Column1&gt;)/i;
    const col2Regex = /(?:<Column2>|&lt;Column2&gt;)([\s\S]*?)(?:<\/Column2>|&lt;\/Column2&gt;)/i;
    const col3Regex = /(?:<Column3>|&lt;Column3&gt;)([\s\S]*?)(?:<\/Column3>|&lt;\/Column3&gt;)/i;

    let match;
    while ((match = rowRegex.exec(xmlData)) !== null) {
      const rowContent = match[1] || match[2];
      const c0Match = rowContent.match(col0Regex);
      const c1Match = rowContent.match(col1Regex);
      const c2Match = rowContent.match(col2Regex);
      const c3Match = rowContent.match(col3Regex);

      const privilegeName = this.decodeXmlEntities((c0Match ? c0Match[1] : '').trim());
      const privilegeCode = this.decodeXmlEntities((c1Match ? c1Match[1] : '').trim());
      const roleName = this.decodeXmlEntities((c2Match ? c2Match[1] : '').trim());
      const roleCode = this.decodeXmlEntities((c3Match ? c3Match[1] : '').trim());

      rows.push({
        privilegeName,
        privilegeCode,
        roleName,
        roleCode
      });
    }

    return {
      rows,
      finished,
      returnedQueryId
    };
  }

  private escapeXml(unsafe: string): string {
    return (unsafe || '').replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }

  private decodeXmlEntities(encoded: string): string {
    return (encoded || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, '\'');
  }
}

export const otbiClient = new OtbiClient();
