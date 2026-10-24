const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../database/.env') });

const { processUserMessage } = require('../dist/ai/orchestrator.js');

const sampleQuestions = [
  // Multi-role & Single-role & Users
  { id: 1, q: "List the user who are having multiple roles?" },
  { id: 6, q: "List the user with single role?" },
  { id: 7, q: "Display the count of user without roles?" },
  { id: 8, q: "What is the count of abstract roles?" },
  { id: 12, q: "How many changes were made to payables product in last week?" },
  { id: 16, q: "Display the audit history of product general ledger and business object accounting Calander setup from 01-09-26 to 30-09-26?" },
  { id: 17, q: "List out all the product names of audit trail?" },
  { id: 19, q: "List the user who has having high risk level roles?" },
  { id: 21, q: "List out the user having most incidents from risk management module?" },
  { id: 22, q: "List out top 10 role with most incidents from risk management dashboard?" },
  { id: 23, q: "List out the control name's with id's?" },
  { id: 24, q: "List out the Transaction control with id's?" },
  { id: 25, q: "List out the inactive controls with id's?" },
  { id: 26, q: "List out the active controls?" },
  { id: 28, q: "What is the count of assigned incident?" },
  { id: 29, q: "What is the total count of incidents for transaction controls?" },
  { id: 31, q: "Who are the user having the role IT security Manager?" },
  { id: 39, q: "Give me list of names who created the controls" },
  { id: 40, q: "List all the controls along with their control names, control id, created by,user name and creation date." },
  { id: 42, q: "Give me the list of business objects of Audit policies product" },
  { id: 44, q: "Which users had they security related information updated?" },
  { id: 45, q: "Give me the list of conflicting roles for Test1.claaps user." },
  { id: 46, q: "List all the roles with intra role conflicts" },
  { id: 48, q: "Give me the users who have product manager role" },
  { id: 51, q: "Give me count of duty role procurement contract administrator role" },
  { id: 52, q: "Give me the list of users who having business unit US1" },
  { id: 53, q: "Give me the list of user who have IT security manager and Application implementation consultant" },
  { id: 54, q: "Give me inherited roles for IT security manager" },
  { id: 55, q: "List all the roles that have access to manage invoice privilege" },
  { id: 56, q: "Give me list of all the access certifications" },
  { id: 57, q: "Give the count of closed access certifications" },
  { id: 58, q: "What are the certifications created by karthika.claaps?" },
  { id: 59, q: "Show the certifier work sheet for certification1" },
  { id: 60, q: "Give me list of user who are present in FY26_QTR3_ Claaps Advanced Access control Certification" },
  { id: 61, q: "What is the role hierarchy of account payables supervisor?" },
  { id: 62, q: "Give me the certifier name for FY26_QTR3_ Claaps Advanced Access control Certification" },
  { id: 63, q: "Give me the incident information of 4079: Sensitive Human Resource Privileges" },
  { id: 64, q: "What is the person number of akorchmar@deloitte.com?" },
  { id: 65, q: "What are the tyoes of roles present in the dashboard?" },
  { id: 66, q: "List out the duplicate user?" },
  { id: 67, q: "What are the types of status present in control?" },
  { id: 68, q: "Who are payroll access?" },
  { id: 69, q: "List out all the data roles present in dashboard?" }
];

async function run() {
  console.log(`Testing ${sampleQuestions.length} sample target questions...\n`);
  for (const item of sampleQuestions) {
    try {
      const res = await processUserMessage(item.q);
      const preview = (res.message || '').replace(/\s+/g, ' ').slice(0, 140);
      console.log(`[Q${item.id}] "${item.q}"`);
      console.log(`     Intent: ${res.intent} | Success: ${res.toolResult?.success ?? 'N/A'}`);
      console.log(`     Answer: ${preview}...`);
      console.log('------------------------------------------------------------------');
    } catch (err) {
      console.error(`[Q${item.id}] "${item.q}" -> ERROR:`, err.message);
    }
  }
  process.exit(0);
}

run();
