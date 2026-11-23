import axios from 'axios';
import { config } from '../src/config.js';
const base = config.oracle.baseUrl.replace(/\/+$/,'');
const user = config.oracle.username; const pass = config.oracle.password;
(async () => {
  for (const p of ['/xmlpserver/services/','/xmlpserver/services/DataModelService?wsdl','/xmlpserver/services/v2/dataModels']) {
    try {
      const r=await axios.get(base+p,{auth:{username:user,password:pass},timeout:20000,responseType:'text'});
      console.log(p, r.status, String(r.data).slice(0,200).replace(/\n/g,' '));
    } catch(e:any){ console.log(p, 'ERR', e.response?.status||e.message); }
  }
})();