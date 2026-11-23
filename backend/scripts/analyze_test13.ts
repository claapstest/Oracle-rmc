import * as xlsx from 'xlsx';
import fs from 'fs';
const buf = fs.readFileSync('D:/Oracle-rmc-main - Standard/Oracle-rmc/scratch/test13_xlsx.bin');
const wb = xlsx.read(buf, { type: 'buffer' });
const sheet = wb.Sheets[wb.SheetNames[0]];
const raw = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, blankrows: false });
const header = raw[1];
const data = raw.slice(2).filter(r => r && r.some(c => c !== null && String(c).trim() !== ''));
console.log('data rows', data.length);
const idx = (name: string) => header.indexOf(name);
const iRoleCode = idx('ROLE_CODE');
const iRoleName = idx('ROLE_NAME');
const iInhCode = idx('INHERITED_ROLE_CODE');
const iInhName = idx('INHERITED_ROLE_NAME');
const iPrivName = idx('PRIVILEGE_NAME');
console.log('header', header);
// distinct inherited roles
const inhRoles = new Map<string, string>();
const privs = new Set<string>();
const rowsByInh = new Map<string, Set<string>>();
for (const r of data) {
  const inhCode = String(r[iInhCode] ?? '').trim();
  const inhName = String(r[iInhName] ?? '').trim();
  const priv = String(r[iPrivName] ?? '').trim();
  if (inhCode) inhRoles.set(inhCode, inhName);
  if (priv) privs.add(priv);
  if (!rowsByInh.has(inhCode)) rowsByInh.set(inhCode, new Set());
  if (priv) rowsByInh.get(inhCode)!.add(priv);
}
console.log('distinct inherited roles', inhRoles.size);
console.log('distinct privileges', privs.size);
console.log('inherited roles list:');
for (const [code, name] of inhRoles) {
  console.log(`  ${code} | ${name} | privileges: ${rowsByInh.get(code)?.size || 0}`);
}
// direct vs inherited: direct role is the top role itself
const topRoleName = String(data[0][iRoleName]).trim();
const topRoleCode = String(data[0][iRoleCode]).trim();
console.log('top role', topRoleCode, topRoleName);
// direct privileges: inherited role == top role
const directPrivs = new Set<string>();
const inheritedPrivs = new Set<string>();
const inheritedFrom = new Map<string, Set<string>>(); // priv -> set of inherited role names
for (const r of data) {
  const inhCode = String(r[iInhCode] ?? '').trim();
  const inhName = String(r[iInhName] ?? '').trim();
  const priv = String(r[iPrivName] ?? '').trim();
  if (!priv) continue;
  if (inhCode === topRoleCode) {
    directPrivs.add(priv);
  } else {
    inheritedPrivs.add(priv);
    if (!inheritedFrom.has(priv)) inheritedFrom.set(priv, new Set());
    inheritedFrom.get(priv)!.add(inhName);
  }
}
console.log('direct privileges (unique)', directPrivs.size);
console.log('inherited privileges (unique, excluding direct)', inheritedPrivs.size);
console.log('total unique privileges', privs.size);
console.log('privileges that are both direct and inherited:', Array.from(privs).filter(p=>directPrivs.has(p)&&inheritedPrivs.has(p)).length);
// Save summary
const summary = {
  topRoleCode,
  topRoleName,
  dataRows: data.length,
  distinctInheritedRoles: inhRoles.size,
  distinctPrivileges: privs.size,
  directPrivileges: directPrivs.size,
  inheritedPrivilegesUnique: inheritedPrivs.size,
  inheritedRoles: Array.from(inhRoles.entries()).map(([code,name])=>({code,name,privilegeCount: rowsByInh.get(code)?.size||0})),
  privileges: Array.from(privs).sort(),
  directPrivilegeList: Array.from(directPrivs).sort(),
  inheritedPrivilegeList: Array.from(inheritedPrivs).sort(),
  inheritedFrom: Object.fromEntries(Array.from(inheritedFrom.entries()).map(([p,s])=>[p, Array.from(s)]))
};
fs.writeFileSync('D:/Oracle-rmc-main - Standard/Oracle-rmc/scratch/test13_summary.json', JSON.stringify(summary, null, 2));
console.log('summary saved');
