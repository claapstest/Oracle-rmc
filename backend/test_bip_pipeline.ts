import * as xlsx from 'xlsx';
import { BipClient } from './src/oracle/bipClient.js';

async function runBipPipelineTests() {
  console.log('===========================================================');
  console.log('🧪 Starting Oracle Fusion BI Publisher Pipeline Unit Tests');
  console.log('   Feature: Access Certification On-Demand BIP Integration');
  console.log('===========================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failed++;
    }
  }

  const client = new BipClient();

  // -------------------------------------------------------------
  // Test 1: Dynamic UTC WS-Security Timestamp Generation
  // -------------------------------------------------------------
  console.log('\n[Test 1: Dynamic UTC WS-Security Timestamp]');
  const ts1 = client.generateWsSecurityTimestamp(300);
  assert(typeof ts1.created === 'string' && ts1.created.endsWith('Z'), 'Created is in ISO UTC (Zulu) format');
  assert(typeof ts1.expires === 'string' && ts1.expires.endsWith('Z'), 'Expires is in ISO UTC (Zulu) format');

  const createdTime = new Date(ts1.created).getTime();
  const expiresTime = new Date(ts1.expires).getTime();
  const diffSec = Math.round((expiresTime - createdTime) / 1000);
  assert(diffSec === 300, `Validity window is exactly 300 seconds (got: ${diffSec}s)`);

  // -------------------------------------------------------------
  // Test 2: SOAP 1.2 Envelope Construction
  // -------------------------------------------------------------
  console.log('\n[Test 2: SOAP 1.2 Envelope Structure]');
  const envelope = client.generateRunReportEnvelope();
  assert(envelope.includes('xmlns:soap="http://www.w3.org/2003/05/soap-envelope"'), 'Uses SOAP 1.2 envelope namespace');
  assert(envelope.includes('xmlns:pub="http://xmlns.oracle.com/oxp/service/PublicReportService"'), 'Uses Oracle PublicReportService namespace');
  assert(envelope.includes('<wsse:Security'), 'Contains WS-Security header');
  assert(envelope.includes('<wsse:UsernameToken'), 'Contains UsernameToken');
  assert(envelope.includes('<wsu:Created>'), 'Contains dynamic Created timestamp');
  assert(envelope.includes('<wsu:Expires>'), 'Contains dynamic Expires timestamp');
  assert(envelope.includes('<pub:reportAbsolutePath>/Custom/Claaps Access Certification.xdo</pub:reportAbsolutePath>'), 'Points to /Custom/Claaps Access Certification.xdo');
  assert(envelope.includes('<pub:attributeFormat>xlsx</pub:attributeFormat>'), 'Requests attributeFormat xlsx');
  assert(envelope.includes('<pub:sizeOfDataChunkDownload>-1</pub:sizeOfDataChunkDownload>'), 'Requests full size chunk download (-1)');

  // -------------------------------------------------------------
  // Test 3: Prefix-Independent XML Parsing & reportBytes Extraction
  // -------------------------------------------------------------
  console.log('\n[Test 3: Prefix-Independent XML Parsing]');
  // reportBytes "UEsDBAAAAAA=" is an invalid/truncated zip stream, which throws in xlsx.read
  const mockXmlWithCorruptedBytes = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://www.w3.org/2003/05/soap-envelope" xmlns:ns2="http://xmlns.oracle.com/oxp/service/PublicReportService">
  <soapenv:Header/>
  <soapenv:Body>
    <ns2:runReportResponse>
      <ns2:runReportReturn>
        <ns2:reportBytes>UEsDBAAAAAA=</ns2:reportBytes>
      </ns2:runReportReturn>
    </ns2:runReportResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  const parseResult1 = await client.parseSoapResponse(mockXmlWithCorruptedBytes);
  assert(parseResult1.success === false, 'Corrupted binary XLSX content fails gracefully without crashing');
  assert(parseResult1.message === 'Unable to retrieve Access Certification data from Oracle Fusion.', 'Returns user-friendly failure message');

  // -------------------------------------------------------------
  // Test 4: SOAP Fault Extraction (No Crash, No Credential Leaks)
  // -------------------------------------------------------------
  console.log('\n[Test 4: SOAP Fault Extraction]');
  const mockSoap12Fault = `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope">
  <env:Header/>
  <env:Body>
    <env:Fault>
      <env:Code><env:Value>env:Receiver</env:Value></env:Code>
      <env:Reason><env:Text xml:lang="en-US">Invalid report path or user unauthorized</env:Text></env:Reason>
    </env:Fault>
  </env:Body>
</env:Envelope>`;

  const faultResult = await client.parseSoapResponse(mockSoap12Fault);
  assert(faultResult.success === false, 'SOAP Fault identified correctly');
  assert(faultResult.message === 'Unable to retrieve Access Certification data from Oracle Fusion.', 'Exposes clean generic message to user without leaking credentials');

  // -------------------------------------------------------------
  // Test 5: Base64 XLSX Decoding, Header Detection & JSON Conversion
  // -------------------------------------------------------------
  console.log('\n[Test 5: Base64 XLSX Decoding & Table Extraction]');
  // Create an in-memory XLSX workbook matching the exact structure from Oracle BI Publisher
  const testAoa = [
    ['Claaps Access Certification', null, null, null, null, null, null], // Title row
    ['#', 'Certification Name', 'Type', 'Status', 'Certification Percent Complete', 'Due Date', 'Creation Date'], // Header row
    [1, 'CLAAPS_Access_Certification1', 'Standard', 'Active', '0%', '2026-10-21', '2026-09-21 12:13'],
    [2, 'CLPS_Access_Certification2', 'Standard', 'Active', '0%', '2026-09-30', '2026-09-21 14:43'],
    [3, 'FY26_QTR3_Claaps Access certification', 'Standard', 'Active', '0%', '2026-09-30', '2026-09-21 15:14'],
    [4, 'CLPS_Access_Certification3', 'Standard', 'Active', '0%', '2026-10-13', '2026-09-21 16:32'],
    [null, null, null, null, null, null, null] // Empty trailing row
  ];

  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet(testAoa);
  xlsx.utils.book_append_sheet(wb, ws, 'Report');
  const xlsxBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const xlsxBase64 = xlsxBuffer.toString('base64');

  const parsedXlsx = client.parseXlsxBase64(xlsxBase64);
  assert(parsedXlsx.success === true, 'parseXlsxBase64 returns success = true');
  assert(Array.isArray(parsedXlsx.data), 'Data is returned as an array');
  assert(parsedXlsx.data?.length === 4, `Filtered empty trailing row and parsed exactly 4 records (got: ${parsedXlsx.data?.length})`);

  const row1 = parsedXlsx.data?.[0];
  assert(row1?.certificationName === 'CLAAPS_Access_Certification1', 'Row 1 certificationName matches CLAAPS_Access_Certification1');
  assert(row1?.type === 'Standard', 'Row 1 type matches Standard');
  assert(row1?.status === 'Active', 'Row 1 status matches Active');
  assert(row1?.certificationPercentComplete === 0, 'Row 1 certificationPercentComplete normalized to 0');
  assert(row1?.dueDate === '2026-10-21', 'Row 1 dueDate matches 2026-10-21');
  assert(row1?.creationDate === '2026-09-21 12:13', 'Row 1 creationDate matches 2026-09-21 12:13');

  const row4 = parsedXlsx.data?.[3];
  assert(row4?.certificationName === 'CLPS_Access_Certification3', 'Row 4 certificationName matches CLPS_Access_Certification3');

  // -------------------------------------------------------------
  // Test 6: Empty Report Handling
  // -------------------------------------------------------------
  console.log('\n[Test 6: Empty Report Handling]');
  const emptyAoa = [
    ['Claaps Access Certification'],
    ['#', 'Certification Name', 'Type', 'Status', 'Certification Percent Complete', 'Due Date', 'Creation Date']
  ];
  const emptyWb = xlsx.utils.book_new();
  const emptyWs = xlsx.utils.aoa_to_sheet(emptyAoa);
  xlsx.utils.book_append_sheet(emptyWb, emptyWs, 'EmptyReport');
  const emptyBuffer = xlsx.write(emptyWb, { type: 'buffer', bookType: 'xlsx' });
  const emptyBase64 = emptyBuffer.toString('base64');

  const emptyResult = client.parseXlsxBase64(emptyBase64);
  assert(emptyResult.success === true, 'Empty report returns success = true');
  assert(Array.isArray(emptyResult.data) && emptyResult.data.length === 0, 'Empty report data is empty array');
  assert(emptyResult.message === 'No Access Certifications found.', 'Returns "No Access Certifications found." message');

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n===========================================================');
  console.log(`📊 Test Summary: ${passed} Passed, ${failed} Failed`);
  console.log('===========================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runBipPipelineTests().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
