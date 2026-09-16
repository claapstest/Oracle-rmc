import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const ENCRYPTION_KEY_RAW = process.env.ORACLE_ENCRYPTION_KEY || 'default-fallback-security-key-oracle-fusion';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(ENCRYPTION_KEY_RAW).digest();
const ALGORITHM = 'aes-256-cbc';

function decrypt(text) {
  if (!text) return '';
  const parts = text.split(':');
  if (parts.length !== 2) return text;
  try {
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return text;
  }
}

const configPath = path.join(__dirname, 'oracle_config.json');
const persisted = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const baseUrl = persisted.oracle.baseUrl;
const username = persisted.oracle.username;
const password = decrypt(persisted.oracle.password);
const auth = Buffer.from(`${username}:${password}`).toString('base64');

async function testRoleMembers() {
  try {
    console.log('Querying Roles...');
    const rolesRes = await axios.get(`${baseUrl}/hcmRestApi/scim/Roles?count=20`, {
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    });
    const rolesWithMembers = rolesRes.data.Resources?.filter(r => r.members && r.members.length > 0) || [];
    console.log(`Found ${rolesWithMembers.length} roles with members.`);
    if (rolesWithMembers.length > 0) {
      console.log('Role name:', rolesWithMembers[0].displayName);
      console.log('Role Code:', rolesWithMembers[0].roleCode);
      console.log('Members sample:', JSON.stringify(rolesWithMembers[0].members.slice(0, 5), null, 2));
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testRoleMembers();
