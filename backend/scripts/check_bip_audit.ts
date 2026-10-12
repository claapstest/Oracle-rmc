import { BipClient } from '../src/oracle/bipClient.js';
import * as xml2js from 'xml2js';

async function main() {
  const bip = new BipClient();
  const { baseUrl, username } = bip.getCredentials();
  console.log('Connected to Oracle BIP at:', baseUrl, 'User:', username);

  // Scan /Custom folder
  const xml = await (bip as any).soapCall(
    'getFolderContents',
    '    <pub:getFolderContents>\n      <pub:folderAbsolutePath>/Custom</pub:folderAbsolutePath>\n    </pub:getFolderContents>'
  );

  const parsed: any = await xml2js.parseStringPromise(xml, {
    explicitArray: false,
    ignoreAttrs: true,
    tagNameProcessors: [xml2js.processors.stripPrefix],
  });

  const contents = bip.findFieldRecursively(parsed, 'catalogContents');
  const items = contents?.item ? (Array.isArray(contents.item) ? contents.item : [contents.item]) : [];

  console.log(`Found ${items.length} items in /Custom:`);
  for (const item of items) {
    const type = item?.type || '';
    const absPath = item?.absolutePath || '';
    const name = item?.displayName || absPath.split('/').pop();
    if (/audit/i.test(name) || /audit/i.test(absPath) || /trail/i.test(name)) {
      console.log(`>>> [AUDIT MATCH] ${type}: ${absPath} (${name})`);
    } else {
      console.log(`  - [${type}] ${absPath}`);
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
