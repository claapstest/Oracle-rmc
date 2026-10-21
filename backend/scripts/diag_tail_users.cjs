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
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let d = decipher.update(Buffer.from(parts[1], 'hex'), undefined, 'utf8');
    d += decipher.final('utf8');
    return d;
  } catch (_) {
    return text;
  }
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../oracle_config.json'), 'utf8'));
  const auth = 'Basic ' + Buffer.from(`${cfg.oracle.username}:${decrypt(cfg.oracle.password)}`).toString('base64');
  const res = await axios.get(`${cfg.oracle.baseUrl}/hcmRestApi/scim/Users`, {
    headers: { Authorization: auth },
    params: { count: 500, startIndex: 3001 },
    timeout: 120000,
  });
  const items = res.data?.Resources || [];
  console.log(`tail count=${items.length}`);
  for (const u of items) {
    console.log(`${u.active ? 'A' : 'I'}\t${u.userName}`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
