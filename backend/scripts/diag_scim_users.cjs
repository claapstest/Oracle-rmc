const path = require('path');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../../database/.env') });

const ENCRYPTION_KEY = crypto.createHash('sha256')
  .update(process.env.ORACLE_ENCRYPTION_KEY || 'default-fallback-security-key-oracle-fusion')
  .digest();

function decrypt(text) {
  if (!text) return '';
  const parts = text.split(':');
  if (parts.length !== 2) return text;
  try {
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let d = decipher.update(encryptedText, undefined, 'utf8');
    d += decipher.final('utf8');
    return d;
  } catch (_) {
    return text;
  }
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../oracle_config.json'), 'utf8'));
  const auth = 'Basic ' + Buffer.from(`${cfg.oracle.username}:${decrypt(cfg.oracle.password)}`).toString('base64');
  const base = cfg.oracle.baseUrl;

  const tests = [
    { label: 'no filter count=500 startIndex=2501', q: { count: 500, startIndex: 2501 } },
    { label: 'no filter count=500 startIndex=3001', q: { count: 500, startIndex: 3001 } },
    { label: 'filter a count=500 startIndex=501', q: { count: 500, startIndex: 501, filter: 'userName co "a" or displayName co "a"' } },
    { label: 'filter a count=500 startIndex=1001', q: { count: 500, startIndex: 1001, filter: 'userName co "a" or displayName co "a"' } },
    { label: 'filter a count=1000 startIndex=1', q: { count: 1000, startIndex: 1, filter: 'userName co "a" or displayName co "a"' } },
    { label: 'filter z count=1000 startIndex=1', q: { count: 1000, startIndex: 1, filter: 'userName co "z" or displayName co "z"' } },
    { label: 'filter z count=1000 startIndex=101', q: { count: 1000, startIndex: 101, filter: 'userName co "z" or displayName co "z"' } },
    { label: 'filter active eq false count=1000 startIndex=1', q: { count: 1000, startIndex: 1, filter: 'active eq false' } },
    { label: 'filter active eq false count=1000 startIndex=1001', q: { count: 1000, startIndex: 1001, filter: 'active eq false' } },
  ];

  for (const t of tests) {
    try {
      const res = await axios.get(`${base}/hcmRestApi/scim/Users`, { headers: { Authorization: auth }, params: t.q, timeout: 120000 });
      const d = res.data || {};
      const n = (d.Resources || []).length;
      const first = (d.Resources || [])[0]?.userName;
      const last = (d.Resources || [])[n - 1]?.userName;
      console.log(`${t.label} -> items=${n} totalResults=${d.totalResults} startIndex=${d.startIndex} itemsPerPage=${d.itemsPerPage} first=${first} last=${last}`);
    } catch (e) {
      console.log(`${t.label} -> ERROR ${e.response?.status} ${JSON.stringify(e.response?.data || e.message)}`);
    }
  }
}

main();
