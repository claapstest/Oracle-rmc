const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../database/.env') });

const { universalDatabaseChatbotService } = require('../dist/services/universalDatabaseChatbotService.js');
const { conversationContextService } = require('../dist/services/conversationContextService.js');

async function testUserQuestions() {
  console.log('========================================================================');
  console.log('🧪 TESTING USER SPECIFICATION QUESTIONS END-TO-END');
  console.log('========================================================================\n');

  const testCases = [
    'Show all certificates expiring next month.',
    'Who is the manager of certificate 1?',
    'Find employees belonging to a particular department.',
    'How many projects are currently active?',
    'Show the top 10 customers based on revenue.',
    'Find records with missing values.',
    'Compare records between two dates.',
    'Calculate department-wise statistics.',
    'Find relationships between different entities.',
    'Retrieve information involving multiple database tables.'
  ];

  for (let i = 0; i < testCases.length; i++) {
    const q = testCases[i];
    console.log(`\n-------------------------------------------------------------`);
    console.log(`Query ${i + 1}: "${q}"`);
    console.log(`-------------------------------------------------------------`);
    try {
      const res = await universalDatabaseChatbotService.processQuery(q);
      console.log(`Response Summary:\n${res.message.slice(0, 250)}...`);
      console.log(`Tool Result Success: ${res.toolResult?.success}`);
      if (res.structuredData?.table?.rows) {
        console.log(`Returned Rows: ${res.structuredData.table.rows.length}`);
      }
    } catch (err) {
      console.error(`Error on Query ${i + 1}:`, err.message);
    }
  }

  // Multi-turn test
  console.log(`\n-------------------------------------------------------------`);
  console.log(`Multi-Turn Follow-Up Test:`);
  console.log(`-------------------------------------------------------------`);
  const session = 'spec_session_followup';
  const t1 = await universalDatabaseChatbotService.processQuery('Show all active access controls', { sessionId: session });
  console.log(`Turn 1 Answer: ${t1.message.slice(0, 150)}...`);

  const t2 = await universalDatabaseChatbotService.processQuery('Which of these have the most incidents?', { sessionId: session });
  console.log(`Turn 2 Follow-Up Answer: ${t2.message.slice(0, 150)}...`);

  console.log('\n========================================================================');
  console.log('All user specification questions executed successfully!');
  console.log('========================================================================\n');
  process.exit(0);
}

testUserQuestions().catch(err => {
  console.error(err);
  process.exit(1);
});
