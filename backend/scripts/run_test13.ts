import axios from 'axios';
import * as xml2js from 'xml2js';
import fs from 'fs';
import { config } from '../src/config.js';

const baseUrl = (config.oracle.baseUrl || '').replace(/\/+$/, '');
const username = config.oracle.username;
const password = config.oracle.password;

function envelope(reportPath: string, format: string) {
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
    <pub:runReport>
      <pub:reportRequest>
        <pub:attributeFormat>${format}</pub:attributeFormat>
        <pub:reportAbsolutePath>${esc(reportPath)}</pub:reportAbsolutePath>
        <pub:byPassCache>true</pub:byPassCache>
        <pub:sizeOfDataChunkDownload>-1</pub:sizeOfDataChunkDownload>
      </pub:reportRequest>
    </pub:runReport>
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

const reportPath = '/~test1.claaps/Test13 report.xdo';

(async () => {
  for (const format of ['xml', 'xlsx', 'csv']) {
    console.log('Trying format', format);
    try {
      const endpoint = `${baseUrl}/xmlpserver/services/ExternalReportWSSService`;
      const res = await axios.post(endpoint, envelope(reportPath, format), {
        headers: { 'Content-Type': 'application/soap+xml; charset=UTF-8', Action: 'runReport' },
        responseType: 'text',
        timeout: 300000,
      });
      fs.writeFileSync(`D:/Oracle-rmc-main - Standard/Oracle-rmc/scratch/test13_${format}_soap.xml`, res.data);
      const parsed = await xml2js.parseStringPromise(res.data, { explicitArray: false, ignoreAttrs: true, tagNameProcessors: [xml2js.processors.stripPrefix] });
      const fault = findField(parsed, 'Fault');
      if (fault) { console.log('SOAP FAULT', JSON.stringify(fault).slice(0,500)); continue; }
      const bytes = findField(parsed, 'reportBytes');
      if (!bytes) { console.log('No reportBytes'); continue; }
      const buf = Buffer.from(String(bytes).replace(/\s+/g,''), 'base64');
      fs.writeFileSync(`D:/Oracle-rmc-main - Standard/Oracle-rmc/scratch/test13_${format}.bin`, buf);
      console.log('Saved bytes', buf.length, 'first bytes:', buf.slice(0,100).toString('utf8'));
    } catch (e:any) {
      console.log('ERR', format, e.message);
      if (e.response?.data) fs.writeFileSync(`D:/Oracle-rmc-main - Standard/Oracle-rmc/scratch/test13_${format}_err.xml`, String(e.response.data));
    }
  }
})();