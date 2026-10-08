const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../../database/.env') });

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5433/veyra_db';

const ENCRYPTION_KEY_RAW = process.env.ORACLE_ENCRYPTION_KEY || 'default-fallback-security-key-oracle-fusion';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(ENCRYPTION_KEY_RAW).digest();

function decrypt(text) {
  if (!text) return '';
  const parts = text.split(':');
  if (parts.length !== 2) return text;
  try {
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return text;
  }
}

async function main() {
  const cfgPath = path.resolve(__dirname, '../oracle_config.json');
  if (!fs.existsSync(cfgPath)) {
    console.error('Config file not found');
    return;
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const baseUrl = cfg.oracle.baseUrl;
  const username = cfg.oracle.username;
  const password = decrypt(cfg.oracle.password);

  console.log(`[Users Sync] Connecting to Oracle at ${baseUrl} with user ${username}...`);

  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  
  // Fetch users from SCIM API
  const scimUrl = `${baseUrl}/hcmRestApi/scim/Users?count=50&startIndex=1`;
  const res = await axios.get(scimUrl, {
    headers: { Authorization: authHeader },
    timeout: 30000
  });

  const users = res.data?.Resources || [];
  console.log(`[Users Sync] Successfully fetched ${users.length} raw users from Oracle Fusion SCIM API.`);

  // Connect to DB and save
  const client = new Client({ connectionString });
  await client.connect();

  const host = new URL(baseUrl).host;
  let savedCount = 0;

  for (const user of users) {
    const uname = user.userName || user.id;
    if (!uname) continue;

    const displayName = user.displayName || `${user.name?.givenName || ''} ${user.name?.familyName || ''}`.trim() || uname;
    const email = user.emails?.find(e => e.primary)?.value || user.emails?.[0]?.value || null;
    const isActive = typeof user.active === 'boolean' ? user.active : true;
    const userCategory = user['urn:scim:schemas:extension:fa:2.0:faUser']?.userCategory || user.userCategory || null;

    const sql = `
      INSERT INTO oracle_raw_users (
        environment_host,
        username,
        display_name,
        email,
        is_active,
        user_category,
        raw_user,
        last_synced_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (environment_host, username) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        email = EXCLUDED.email,
        is_active = EXCLUDED.is_active,
        user_category = EXCLUDED.user_category,
        raw_user = EXCLUDED.raw_user,
        last_synced_at = NOW(),
        updated_at = NOW();
    `;

    await client.query(sql, [host, uname, displayName, email, isActive, userCategory, JSON.stringify(user)]);
    savedCount++;
  }

  console.log(`[Users Sync] Successfully saved ${savedCount} raw users into oracle_raw_users table!`);

  const verifyCount = await client.query('SELECT count(*) FROM oracle_raw_users WHERE environment_host = $1', [host]);
  console.log(`[Users Sync] Total in oracle_raw_users: ${verifyCount.rows[0].count}`);

  await client.end();
}

main().catch(e => {
  console.error('[Users Sync] Error:', e.message);
  process.exit(1);
});
