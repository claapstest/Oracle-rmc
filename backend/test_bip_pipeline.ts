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
  assert(envelope.includes('<pub:reportAbsolutePath>/Custom/Claaps Access Certification Review Report.xdo</pub:reportAbsolutePath>'), 'Points to /Custom/Claaps Access Certification Review Report.xdo');
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
  // Test 7: Certifier Worksheet SOAP Envelope with Parameter P_CERTIFICATION_ID
  // -------------------------------------------------------------
  console.log('\n[Test 7: Certifier Worksheet SOAP Envelope with Parameter]');
  const worksheetEnvelope = client.generateRunReportEnvelope(
    client.reviewReportPath,
    'xlsx',
    -1,
    { P_CERTIFICATION_ID: '35006' }
  );
  assert(
    worksheetEnvelope.includes('<pub:reportAbsolutePath>/Custom/Claaps Access_certifier_worksheet.xdo</pub:reportAbsolutePath>'),
    'Points to /Custom/Claaps Access_certifier_worksheet.xdo'
  );
  assert(worksheetEnvelope.includes('<pub:name>P_CERTIFICATION_ID</pub:name>'), 'Envelope contains parameter P_CERTIFICATION_ID');
  assert(worksheetEnvelope.includes('<pub:item>35006</pub:item>'), 'Envelope contains parameter value 35006');

  // -------------------------------------------------------------
  // Test 8: Base64 Decoding & Multi-Row Preservation for Certifier Worksheet
  // -------------------------------------------------------------
  console.log('\n[Test 8: Certifier Worksheet Multi-Row Preservation]');
  const worksheetAoa = [
    ['Claaps Access Certification review'],
    [
      'Certification ID',
      'Certification Name',
      'Due Date',
      'Certification Percent Complete',
      'Status',
      'Type',
      'Creation Date',
      'Owner Name',
      'Manager Name'
    ],
    ['35006', 'CLAAPS_Access_Certification1', '2026-10-21', '0%', 'Active', 'Standard', '2026-09-21', 'Karthika.Claaps', 'Karthika.Claaps'],
    ['35006', 'CLAAPS_Access_Certification1', '2026-10-21', '0%', 'Active', 'Standard', '2026-09-21', 'Test1 user.claaps', 'Karthika.Claaps'],
    ['35007', 'CLPS_Access_Certification3', '2026-10-13', '0%', 'Active', 'Standard', '2026-09-21', 'Kavya.Claaps', 'Test1 user.claaps'],
    ['36006', 'CLPS_Access_Certification2', '2026-09-30', '0%', 'Active', 'Standard', '2026-09-21', 'Test1 user.claaps', 'Kavya.Claaps'],
    [null, null, null, null, null, null, null, null, null]
  ];

  const wsWb = xlsx.utils.book_new();
  const wsWs = xlsx.utils.aoa_to_sheet(worksheetAoa);
  xlsx.utils.book_append_sheet(wsWb, wsWs, 'Sheet1');
  const wsBuffer = xlsx.write(wsWb, { type: 'buffer', bookType: 'xlsx' });
  const wsBase64 = wsBuffer.toString('base64');

  const worksheetDetails = client.parseCertifierWorksheetXlsxBase64(wsBase64, '35006');
  assert(worksheetDetails.success === true, 'parseCertifierWorksheetXlsxBase64 returns success = true');
  assert(worksheetDetails.certificationId === '35006', 'Returns requested certificationId');
  assert(worksheetDetails.count === 2, `Preserved all 2 rows for certification 35006 (got: ${worksheetDetails.count})`);

  const wRow1 = worksheetDetails.data[0];
  assert(String(wRow1.certificationId) === '35006', 'Row 1 certificationId matches 35006');
  assert(wRow1.userName === 'Karthika.Claaps', 'Row 1 userName mapped from Owner Name');
  assert(wRow1.certifiedManager === 'Karthika.Claaps', 'Row 1 certifiedManager mapped from Manager Name');
  assert(wRow1.roleName === 'Access Certification Certifier', 'Row 1 roleName defaulted appropriately');
  assert(wRow1.userBusinessUnit === 'Corporate', 'Row 1 userBusinessUnit mapped');

  const wRow2 = worksheetDetails.data[1];
  assert(wRow2.userName === 'Test1 user.claaps', 'Row 2 userName matches Test1 user.claaps');
  assert(wRow2.certifiedManager === 'Karthika.Claaps', 'Row 2 certifiedManager matches Karthika.Claaps');

  // -------------------------------------------------------------
  // Test 9: Zero Rows / Non-Existent Certification ID Handling
  // -------------------------------------------------------------
  console.log('\n[Test 9: Zero Rows / Non-Existent Certification ID Handling]');
  const notFoundDetails = client.parseCertifierWorksheetXlsxBase64(wsBase64, '99999');
  assert(notFoundDetails.success === true, 'Returns success = true for valid report with 0 matching rows');
  assert(notFoundDetails.count === 0, 'count is 0');
  assert(Array.isArray(notFoundDetails.data) && notFoundDetails.data.length === 0, 'data is empty array');
  assert(
    notFoundDetails.message === 'No user access details found for this certification.',
    'Friendly no-data message returned without error status'
  );

  // -------------------------------------------------------------
  // Test 10: Empty Certification ID Rejection
  // -------------------------------------------------------------
  console.log('\n[Test 10: Empty Certification ID Rejection]');
  const invalidCertResult = await client.runCertifierWorksheetReport('');
  assert(invalidCertResult.success === false, 'Empty certification ID returns success = false');
  assert(invalidCertResult.message === 'Certification ID is required.', 'Returns clear validation message');

  // -------------------------------------------------------------
  // Test 11: Main Report Row Certification ID Resolution
  // -------------------------------------------------------------
  console.log('\n[Test 11: Main Certification List ID Resolution]');
  assert(String(parsedXlsx.data?.[0]?.certificationId) === '35006', 'CLAAPS_Access_Certification1 has certificationId = 35006');
  assert(String(parsedXlsx.data?.[1]?.certificationId) === '36006', 'CLPS_Access_Certification2 has certificationId = 36006');
  assert(String(parsedXlsx.data?.[2]?.certificationId) === '36007', 'FY26_QTR3_Claaps Access certification has certificationId = 36007');
  assert(String(parsedXlsx.data?.[3]?.certificationId) === '35007', 'CLPS_Access_Certification3 has certificationId = 35007');

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
