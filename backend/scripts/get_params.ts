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

const reportPath = '/~test1.claaps/Test13 report.xdo';
(async () => {
  const body = `    <pub:getReportParameters>\n      <pub:reportRequest>\n        <pub:reportAbsolutePath>${reportPath.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pub:reportAbsolutePath>\n      </pub:reportRequest>\n    </pub:getReportParameters>`;
  try {
    const endpoint = `${baseUrl}/xmlpserver/services/ExternalReportWSSService`;
    const res = await axios.post(endpoint, envelope(body), {
      headers: { 'Content-Type': 'application/soap+xml; charset=UTF-8', Action: 'getReportParameters' },
      responseType: 'text',
      timeout: 120000,
    });
    fs.writeFileSync('D:/Oracle-rmc-main - Standard/Oracle-rmc/scratch/test13_params.xml', res.data);
    console.log(res.data.slice(0,4000));
  } catch (e:any) {
    console.log('ERR', e.message);
    if (e.response?.data) console.log(String(e.response.data).slice(0,1000));
  }
})();