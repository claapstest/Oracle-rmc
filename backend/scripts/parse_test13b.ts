import * as xlsx from 'xlsx';
import fs from 'fs';
const buf = fs.readFileSync('D:/Oracle-rmc-main - Standard/Oracle-rmc/scratch/test13_xlsx.bin');
const wb = xlsx.read(buf, { type: 'buffer' });
const sheet = wb.Sheets[wb.SheetNames[0]];
const raw = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, blankrows: false });
console.log('raw rows', raw.length);
for (let i=0;i<Math.min(8,raw.length);i++) console.log(i, JSON.stringify(raw[i]));
fs.writeFileSync('D:/Oracle-rmc-main - Standard/Oracle-rmc/scratch/test13_raw.json', JSON.stringify(raw, null, 2));
