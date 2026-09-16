(async () => {
  try {
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo.user@claaps.com', password: 'demo@123' })
    });
    const loginData = await loginRes.json();
    const token = loginData.token;

    console.log('=== TEST 1: Controls Catalog Endpoint ===');
    const ctrlRes = await fetch('http://localhost:5000/api/risk/controls', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const ctrlData = await ctrlRes.json();
    console.log('Status:', ctrlRes.status, 'Success:', ctrlData.success, 'Total Controls:', ctrlData.totalCount, 'Items Count:', ctrlData.items?.length);
    console.log('Counts object:', ctrlData.counts);
    console.log('Sample item [0]:', { id: ctrlData.items[0].id, name: ctrlData.items[0].name, status: ctrlData.items[0].status, state: ctrlData.items[0].state });

    console.log('\n=== TEST 2: Select Control 114281 ===');
    const det1 = await (await fetch('http://localhost:5000/api/risk/controls/114281', {
      headers: { 'Authorization': 'Bearer ' + token }
    })).json();
    console.log('Success:', det1.success);
    console.log('Control ID:', det1.control?.id);
    console.log('Control Name:', det1.control?.name);
    console.log('Control Status:', det1.control?.status);
    console.log('Control State:', det1.control?.state);
    console.log('Control Incidents length:', det1.control?.incidents?.length);
    console.log('Incident Count:', det1.incidentCount);
    console.log('Sample incident [0]:', det1.control?.incidents?.[0]);

    console.log('\n=== TEST 3: Select Control 114269 (Zero Incidents Case) ===');
    const det2 = await (await fetch('http://localhost:5000/api/risk/controls/114269', {
      headers: { 'Authorization': 'Bearer ' + token }
    })).json();
    console.log('Success:', det2.success);
    console.log('Control ID:', det2.control?.id);
    console.log('Incident Count:', det2.incidentCount);
    console.log('Incidents length:', det2.control?.incidents?.length);

    console.log('\n=== TEST 4 & 5: Search / Resolution in Catalog ===');
    const foundById = ctrlData.items.find(c => c.id === '114281');
    const foundByName = ctrlData.items.find(c => c.name.toLowerCase().includes('manage hsdl'));
    console.log('Found by ID 114281:', foundById ? foundById.name : 'None');
    console.log('Found by Name "Manage HSDL":', foundByName ? foundByName.id : 'None');

    console.log('\n=== TEST 6: Chatbot Intent with Control Name ===');
    const chat1 = await (await fetch('http://localhost:5000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ message: 'Show me details of Manage HSDL Spreadsheets Templates and Load Data using HSDL' })
    })).json();
    console.log('Chat 1 Title:', chat1.structuredData?.title);
    console.log('Chat 1 Response:\n' + chat1.message);

    console.log('\n=== TEST 7: Chatbot Intent with Number 4096 ===');
    const chat2 = await (await fetch('http://localhost:5000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ message: 'Show incidents for 4096' })
    })).json();
    console.log('Chat 2 Title:', chat2.structuredData?.title);
    console.log('Chat 2 Response:\n' + chat2.message);

    console.log('\n=== TEST 8: Other Tabs Isolation (Tab 1 & Tab 3) ===');
    const tab1 = await (await fetch('http://localhost:5000/api/risk/access-requests', {
      headers: { 'Authorization': 'Bearer ' + token }
    })).json();
    console.log('Tab 1 Access Requests Success:', tab1.success, 'Count:', tab1.items?.length);

    const tab3 = await (await fetch('http://localhost:5000/api/risk/capabilities', {
      headers: { 'Authorization': 'Bearer ' + token }
    })).json();
    console.log('Tab 3 Capabilities Success:', tab3.success, 'Capabilities:', Object.keys(tab3.capabilities || {}));

  } catch(e) {
    console.error('Test Error:', e);
  }
})();
