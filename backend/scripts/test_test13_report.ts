import axios from 'axios';
import * as xml2js from 'xml2js';
import { config } from '../src/config.js';

config; // ensure loadPersistedConfig

const baseUrl = (config.oracle.baseUrl || '').replace(/\/+$/, '');
const username = config.oracle.username;
const password = config.oracle.password;
console.log('baseUrl', baseUrl, 'user', username);

function envelope(bodyInner: string) {
  const created = new Date().toISOString();
  const expires = new Date(Date.now() + 300000).toISOString();
  const nonce = Buffer.from(Math.random().toString()).toString('base64');
  const esc = (s: string) => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:pub="http://xmlns.oracle.com/oxp/service/PublicReportService">
  <soap:Header>
    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
      <wsu:Timestamp wsu:Id="Timestamp-${Date.now()}">
        <wsu:Created>${created}</wsu:Created>
        <wsu:Expires>${expires}</wsu:Expires>
      </wsu:Timestamp>
      <wsse:UsernameToken wsu:Id="UsernameToken-${Date.now()}">
        <wsse:Username>${esc(username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${esc(password)}</wsse:Password>
        <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce}</wsse:Nonce>
        <wsu:Created>${created}</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>
  </soap:Header>
  <soap:Body>
${bodyInner}
  </soap:Body>
</soap:Envelope>`;
}

async function soapCall(action: string, bodyInner: string): Promise<string> {
  const endpoint = `${baseUrl}/xmlpserver/services/ExternalReportWSSService`;
  const res = await axios.post(endpoint, envelope(bodyInner), {
    headers: { 'Content-Type': 'application/soap+xml; charset=UTF-8', Action: action },
    responseType: 'text',
    timeout: 60000,
  });
  return res.data;
}

function findField(obj: any, field: string): any {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, field)) return obj[field];
  for (const k of Object.keys(obj)) {
    const v = findField(obj[k], field);
    if (v !== undefined) return v;
  }
  return undefined;
}

async function isReportExist(p: string): Promise<boolean> {
  const xml = await soapCall('isReportExist', `    <pub:isReportExist>\n      <pub:reportAbsolutePath>${p.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pub:reportAbsolutePath>\n    </pub:isReportExist>`);
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true, tagNameProcessors: [xml2js.processors.stripPrefix] });
  const val = findField(parsed, 'isReportExistReturn');
  return String(val).toLowerCase() === 'true';
}

const candidates = [
  '/My Folders/Test13 report',
  '/My Folders/Test13 report.xdo',
  '/My Folders/Test13_report.xdo',
  '/My Folders/Test13Report.xdo',
  '/My Folders/Test13.xdo',
];

(async () => {
  for (const c of candidates) {
    try {
      const exists = await isReportExist(c);
      console.log(JSON.stringify({ path: c, exists }));
    } catch (e: any) {
      console.log(JSON.stringify({ path: c, error: e.message }));
    }
  }
})();