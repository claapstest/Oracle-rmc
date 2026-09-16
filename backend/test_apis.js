import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') }); // load from project root

console.log('Testing New Test Credentials...');
console.log('Base URL:', process.env.ORACLE_FUSION_BASE_URL);

async function testOracleWithUserAndUrl(username, password, path) {
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  try {
    const url = `${process.env.ORACLE_FUSION_BASE_URL}${path}`;
    console.log(`Connecting to: ${url} as ${username}...`);
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      },
      timeout: 15000
    });
    console.log(`SUCCESS for ${username} on ${path}! Status:`, response.status);
    return true;
  } catch (error) {
    if (error.response) {
      console.error(`ERROR for ${username} on ${path}: Status: ${error.response.status}`);
    } else {
      console.error(`ERROR for ${username} on ${path}:`, error.message);
    }
    return false;
  }
}

async function testOracle() {
  const password = '12345678';
  const username = 'User1.claaps';
  const paths = [
    '/hcmRestApi/scim/Users?count=1',
    '/hcmRestApi/resources/11.13.18.05/',
    '/fscmRestApi/resources/11.13.18.05/'
  ];
  for (const path of paths) {
    await testOracleWithUserAndUrl(username, password, path);
  }
}

testOracle();
