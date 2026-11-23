import axios from 'axios';
import { config } from '../src/config.js';
const base = config.oracle.baseUrl.replace(/\/+$/,'');
const user = config.oracle.username; const pass = config.oracle.password;
(async () => {
  const paths = [
    '/xmlpserver/services/rest/v1/reports',
    '/xmlpserver/services/rest/v1/dataModels',
    '/xmlpserver/services/rest/v1/catalog',
    '/analytics/api/v1',
  ];
  for (const p of paths) {
    try {
      const r = await axios.get(base+p, { auth:{username:user,password:pass}, timeout:20000, validateStatus:()=>true });
      console.log(p, r.status, String(r.data).slice(0,120).replace(/\n/g,' '));
    } catch(e:any){ console.log(p, 'ERR', e.message); }
  }
})();