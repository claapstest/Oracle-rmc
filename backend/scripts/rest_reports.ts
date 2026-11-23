import axios from 'axios';
import { config } from '../src/config.js';
const base = config.oracle.baseUrl.replace(/\/+$/,'');
const user = config.oracle.username; const pass = config.oracle.password;
(async () => {
  const url = base + '/xmlpserver/services/rest/v1/reports/~test1.claaps/Test13%20report.xdo';
  try {
    const r = await axios.get(url, { auth:{username:user,password:pass}, timeout:20000, validateStatus:()=>true });
    console.log('GET', r.status, String(r.data).slice(0,500));
  } catch(e:any){ console.log('ERR', e.message); }
  // try run
  try {
    const r2 = await axios.post(url, { attributeFormat:'xlsx' }, { auth:{username:user,password:pass}, timeout:30000, validateStatus:()=>true, responseType:'text' });
    console.log('POST', r2.status, String(r2.data).slice(0,500));
  } catch(e:any){ console.log('ERR2', e.message); }
})();