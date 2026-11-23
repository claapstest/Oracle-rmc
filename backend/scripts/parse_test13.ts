import * as xlsx from 'xlsx';
import fs from 'fs';
const buf = fs.readFileSync('D:/Oracle-rmc-main - Standard/Oracle-rmc/scratch/test13_xlsx.bin');
const wb = xlsx.read(buf, { type: 'buffer' });
console.log('sheets', wb.SheetNames);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json<any>(sheet, { defval: null });
console.log('row count', rows.length);
console.log(JSON.stringify(rows.slice(0,5), null, 2));
// Save full JSON
fs.writeFileSync('D:/Oracle-rmc-main - Standard/Oracle-rmc/scratch/test13_rows.json', JSON.stringify(rows, null, 2));
// Count distinct privileges
const privs = new Set(rows.map(r => (r.PRIVILEGE_CODE || r.privilege_code || r.PRIVILEGE_NAME)).filter(Boolean));
console.log('distinct privilege codes/names', privs.size);
// Count distinct inherited roles
const inh = new Set(rows.map(r => r.INHERITED_ROLE_CODE || r.inherited_role_code).filter(Boolean));
console.log('distinct inherited roles', inh.size);
console.log('inherited roles:', Array.from(inh));
