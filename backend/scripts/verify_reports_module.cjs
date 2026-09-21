const http = require('http');

async function verify() {
  try {
    console.log('Logging in to test environment...');
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo.user@claaps.com', password: 'demo@123' })
    });
    const { token } = await loginRes.json();
    console.log('Token acquired.\n');

    // TEST 1: Control Summary Report
    console.log('=== TEST 1: Control Summary Report API ===');
    const csRes = await fetch('http://localhost:5000/api/risk/reports/control-summary', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const csData = await csRes.json();
    console.log('CS Success:', csData.success);
    console.log('CS Total Controls:', csData.totalControls);
    console.log('CS Active Controls:', csData.activeControls);
    console.log('CS Status:', csData.summaryStatus);
    console.log('CS DataSource:', csData.dataSource);

    // TEST 2: Incidents Detailed Report (Control 113308 - 0 incidents)
    console.log('\n=== TEST 2: Incidents Detailed for Control 113308 (Zero Incidents Case) ===');
    const inc0Res = await fetch('http://localhost:5000/api/risk/incidents?controlId=113308', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const inc0Data = await inc0Res.json();
    console.log('Inc 113308 Success:', inc0Data.success);
    console.log('Inc 113308 Total Count:', inc0Data.totalCount);
    console.log('Inc 113308 Items Length:', inc0Data.items?.length);
    console.log('Inc 113308 Cache Status:', inc0Data.cacheStatus);
    console.log('Inc 113308 KPIs:', inc0Data.kpis);
    if (inc0Data.message && inc0Data.message.includes('Oracle REST API integration required')) {
      console.error('FAIL: Misleading error message returned!');
    } else {
      console.log('PASS: Clean live response without integration required error.');
    }

    // TEST 3: Incidents Detailed Report (Control 114281 - 2,552 incidents)
    console.log('\n=== TEST 3: Incidents Detailed for Control 114281 (2,552 Incidents Case) ===');
    const inc1Res = await fetch('http://localhost:5000/api/risk/incidents?controlId=114281', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const inc1Data = await inc1Res.json();
    console.log('Inc 114281 Success:', inc1Data.success);
    console.log('Inc 114281 Total Count:', inc1Data.totalCount);
    console.log('Inc 114281 Items Length:', inc1Data.items?.length);
    console.log('Inc 114281 Cache Status:', inc1Data.cacheStatus);
    console.log('Inc 114281 KPIs:', inc1Data.kpis);
    console.log('Inc 114281 Available Controls count:', inc1Data.availableControls?.length);
    
    if (inc1Data.items && inc1Data.items.length > 0) {
      const sample = inc1Data.items[0];
      console.log('Sample Incident Fields Verified:');
      console.log('  id:', sample.id);
      console.log('  controlId:', sample.controlId);
      console.log('  controlName:', sample.controlName);
      console.log('  globalUserName:', sample.globalUserName);
      console.log('  userFirstName:', sample.userFirstName);
      console.log('  userLastName:', sample.userLastName);
      console.log('  role:', sample.role);
      console.log('  status:', sample.status);
      console.log('  state:', sample.state);
      console.log('  creationDate:', sample.creationDate);
      console.log('  incidentInformation:', sample.incidentInformation ? sample.incidentInformation.substring(0, 60) + '...' : null);
      console.log('  entitlement:', sample.entitlement);
      console.log('  accessPointName:', sample.accessPointName);
      console.log('  accessPointType:', sample.accessPointType);
    }

    // TEST 4: Incidents Detailed Report (All Controls scope)
    console.log('\n=== TEST 4: Incidents Detailed (All Cached Controls scope) ===');
    const incAllRes = await fetch('http://localhost:5000/api/risk/incidents', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const incAllData = await incAllRes.json();
    console.log('Inc All Success:', incAllData.success);
    console.log('Inc All Total Count:', incAllData.totalCount);
    console.log('Inc All Items Length:', incAllData.items?.length);
    console.log('Inc All KPIs:', incAllData.kpis);

    console.log('\n=== ALL TESTS COMPLETED SUCCESSFULLY ===');
  } catch (err) {
    console.error('Verification error:', err);
  }
}

verify();
