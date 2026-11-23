import axios from 'axios';
import fs from 'fs';
import { config } from '../src/config.js';
const baseUrl = (config.oracle.baseUrl || '').replace(/\/+$/, '');
const username = config.oracle.username;
const password = config.oracle.password;
(async () => {
  const res = await axios.get(`${baseUrl}/xmlpserver/services/ExternalReportWSSService?wsdl`, {
    auth: { username, password },
    responseType: 'text',
    timeout: 60000,
  });
  fs.writeFileSync('D:/Oracle-rmc-main - Standard/Oracle-rmc/scratch/bip.wsdl', res.data);
  console.log('size', res.data.length);
})();