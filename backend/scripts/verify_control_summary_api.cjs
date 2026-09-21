const http = require('http');

async function test() {
  try {
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo.user@claaps.com', password: 'demo@123' })
    });
    const { token } = await loginRes.json();
    console.log('Login successful, token acquired.');

    const res = await fetch('http://localhost:5000/api/risk/reports/control-summary', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    console.log('Success:', data.success);
    console.log('SummaryStatus:', data.summaryStatus);
    console.log('TotalControls:', data.totalControls);
    console.log('ActiveControls:', data.activeControls);
    console.log('ControlsWithIncidents:', data.controlsWithIncidents);
    console.log('ScannedControlsCount:', data.scannedControlsCount);
    console.log('DataSource:', data.dataSource);
    console.log('CalculatedAt:', data.calculatedAt);

    const targets = ['113308', '114281', '114285', '114305', '114313', '114269'];
    console.log('\n--- TARGET CONTROLS AUDIT (Requirement 24) ---');
    targets.forEach(id => {
      const c = (data.controls || []).find(x => x.controlId === id);
      if (c) {
        console.log(`Control ${id}:`);
        console.log(`  Name: ${c.controlName}`);
        console.log(`  Status: ${c.status}`);
        console.log(`  State: ${c.state}`);
        console.log(`  Type Code: ${c.controlTypeCode} | Type Name: ${c.controlTypeName}`);
        console.log(`  Total Incidents: ${c.totalIncidentCount}`);
        console.log(`  Assigned/In Rem: ${c.assignedOrInRemediationCount}`);
        console.log(`  Accepted: ${c.acceptedCount}`);
        console.log(`  Closed/Resolved: ${c.closedOrResolvedCount}`);
        console.log(`  Counts Status: ${c.countsStatus}`);
        console.log(`  Scheduled By: ${c.scheduledBy}`);
        console.log(`  Last Run By: ${c.lastRunBy}`);
        console.log(`  Last Run Date: ${c.lastRunDate}`);
        console.log(`  Notes: ${c.calculationNotes}`);
      } else {
        console.log(`Control ${id}: NOT FOUND`);
      }
    });

    console.log('\n=== Single Probe Test on Control 113308 (0 incidents) ===');
    const probeRes = await fetch('http://localhost:5000/api/risk/reports/control-summary/113308', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const probeData = await probeRes.json();
    console.log('Probe 113308 result:', probeData);

  } catch (err) {
    console.error('Error during test:', err);
  }
}

test();
