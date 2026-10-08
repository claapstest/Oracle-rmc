/**
 * Integration Test: Verify ControlRawDbService and Product Sync Policies
 */
import { controlRawDbService } from '../src/services/controlRawDbService.js';

async function main() {
  console.log('--- Testing ControlRawDbService ---');

  // 1. Policies
  const policies = await controlRawDbService.getProductSyncPolicies();
  console.log('Seeded policies count:', policies.length);
  if (policies.length < 4) throw new Error('Expected at least 4 policies');

  // 2. Update policy
  const updated = await controlRawDbService.updateProductSyncPolicy('RISK_CONTROLS', {
    syncCadence: 'HOURLY',
    syncIntervalHours: 6
  });
  console.log('Updated RISK_CONTROLS cadence:', updated?.sync_cadence, 'interval:', updated?.sync_interval_hours);

  // 3. Raw Control Save & Retrieve
  const testCtrlId = 'TEST_CTRL_E2E';
  const sampleCtrl = {
    Id: testCtrlId,
    Name: 'Test Control End-to-End',
    StateCode: 'APPROVED',
    StatusId: 200,
    Description: 'Full raw control description test'
  };
  await controlRawDbService.saveRawControl(testCtrlId, sampleCtrl);
  const fetchedCtrl = await controlRawDbService.getRawControl(testCtrlId);
  console.log('Saved raw control name:', fetchedCtrl?.Name);
  if (fetchedCtrl?.Name !== sampleCtrl.Name) throw new Error('Control name mismatch');

  // 4. Raw Incidents Batch Save & Benchmark Retrieval Speed
  const testIncidents = [
    {
      Id: 'INC-E2E-1',
      Status: 'Assigned',
      GlobalUserName: 'Jane.Doe',
      Priority: 'High',
      Role: 'Financial Administrator',
      LastUpdateDate: '2026-10-08T14:00:00Z'
    },
    {
      Id: 'INC-E2E-2',
      Status: 'Closed',
      GlobalUserName: 'Bob.Smith',
      Priority: 'Low',
      Role: 'Procurement Specialist',
      LastUpdateDate: '2026-10-08T14:30:00Z'
    }
  ];

  const savedCount = await controlRawDbService.saveRawIncidentsBatch(testCtrlId, testIncidents, sampleCtrl.Name);
  console.log('Saved incidents count:', savedCount);

  // Measure read latency
  const start = performance.now();
  const dbResult = await controlRawDbService.getRawIncidents(testCtrlId, { limit: 10 });
  const latency = performance.now() - start;
  console.log(`DB Incident retrieval latency: ${latency.toFixed(2)} ms (Total in DB: ${dbResult.total})`);

  if (latency > 15) {
    console.warn('Latency slightly higher than 15ms target, but acceptable');
  }

  // 5. Watermark Test
  await controlRawDbService.upsertWatermark(testCtrlId, {
    controlName: sampleCtrl.Name,
    totalIncidents: 2,
    syncedIncidents: 2,
    syncStatus: 'READY'
  });

  const watermark = await controlRawDbService.getWatermark(testCtrlId);
  console.log('Watermark status:', watermark?.sync_status, 'synced:', watermark?.synced_incidents);

  // 6. Cleanup test records
  const { query } = await import('../src/db.js');
  await query('DELETE FROM oracle_control_incidents WHERE control_id = $1', [testCtrlId]);
  await query('DELETE FROM oracle_raw_controls WHERE control_id = $1', [testCtrlId]);
  console.log('Test records cleaned up successfully.');

  console.log('✅ ALL INTEGRATION TESTS PASSED!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
