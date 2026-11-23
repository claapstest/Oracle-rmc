import axios from 'axios';
import * as xml2js from 'xml2js';
import fs from 'fs';
import { config } from '../src/config.js';

const baseUrl = (config.oracle.baseUrl || '').replace(/\/+$/, '');
const username = config.oracle.username;
const password = config.oracle.password;

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

function findField(obj: any, field: string): any {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, field)) return obj[field];
  for (const k of Object.keys(obj)) {
    const v = findField(obj[k], field);
    if (v !== undefined) return v;
  }
  return undefined;
}

const dmPath = '/~test1.claaps/test13 Dm.xdm';
(async () => {
  const body = `    <pub:downloadReportObject>\n      <pub:reportAbsolutePath>${dmPath.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pub:reportAbsolutePath>\n    </pub:downloadReportObject>`;
  try {
    const endpoint = `${baseUrl}/xmlpserver/services/ExternalReportWSSService`;
    const res = await axios.post(endpoint, envelope(body), {
      headers: { 'Content-Type': 'application/soap+xml; charset=UTF-8', Action: 'downloadReportObject' },
      responseType: 'text',
      timeout: 300000,
    });
    fs.writeFileSync('D:/Oracle-rmc-main - Standard/Oracle-rmc/scratch/test13_dm_download_soap.xml', res.data);
    const parsed = await xml2js.parseStringPromise(res.data, { explicitArray: false, ignoreAttrs: true, tagNameProcessors: [xml2js.processors.stripPrefix] });
    const bytes = findField(parsed, 'downloadReportObjectReturn');
    if (typeof bytes === 'string') {
      const buf = Buffer.from(bytes.replace(/\s+/g,''), 'base64');
      fs.writeFileSync('D:/Oracle-rmc-main - Standard/Oracle-rmc/scratch/test13_dm.xdm', buf);
      console.log('saved dm bytes', buf.length);
      console.log(buf.toString('utf8').slice(0,2000));
    } else {
      console.log('no bytes', typeof bytes);
    }
  } catch (e:any) {
    console.log('ERR', e.message);
    if (e.response?.data) console.log(String(e.response.data).slice(0,500));
  }
})();