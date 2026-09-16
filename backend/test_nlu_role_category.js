import dotenv from 'dotenv';
dotenv.config({ path: 'd:/New_Project - Copy/.env' });

const GROQ_API_KEY = process.env.GROQ_API_KEY;

async function testQuery(message) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      messages: [
        {
          role: 'system',
          content: `You are the NLU intent classification engine for an Oracle Fusion Security Assistant. 
Analyze the user query and output a strict JSON object mapping to:
{
  "intent": "LIST_USERS" | "GET_USER" | "LIST_ROLES" | "GET_ROLE" | "USERS_BY_ROLE" | "ROLES_BY_USER" | "ROLE_SEARCH" | "ROLE_DETAILS" | "ROLE_HIERARCHY" | "ROLE_PRIVILEGES" | "USER_ACCESS" | "AUDIT_HISTORY" | "SECURITY_STATISTICS" | "RISK_INFORMATION" | "ACCESS_REQUESTS" | "ADVANCED_CONTROLS" | "UNKNOWN",
  "parameters": {
    "roleName": "Extracted role display name or code (string, optional)",
    "userId": "Extracted user identifier like JSMITH or HCM_IMPL (string, optional)",
    "username": "Extracted audit username (string, optional)",
    "keyword": "Keyword for search (string, optional)",
    "action": "Audit action: CREATE, UPDATE, DELETE, etc. (string, optional)",
    "privilegeOrAccess": "Function name / privilege check: invoice creation, Accounts Payable (string, optional)",
    "filterType": "For LIST_USERS: 'MULTIPLE_ROLES', 'NO_ROLES', 'ADMIN_ROLES', 'HIGH_RISK', 'NONE'",
    "roleCategory": "When query asks for specific role type assigned to a user (e.g. 'Duty Roles', 'Abstract Roles', 'Job Roles', 'Data Roles'), extract: 'DUTY', 'ABSTRACT', 'JOB', 'DATA', or 'ALL' for general role queries (string, optional)"
  },
  "explanation": "Brief rationale"
}
Only output valid JSON.`
        },
        { role: 'user', content: message }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1
    })
  });
  const data = await res.json();
  console.log(`\nQuery: "${message}"`);
  console.log("Result:", data.choices[0].message.content);
}

async function run() {
  await testQuery("Does user HCM_IMPL have any Abstract Roles?");
  await testQuery("Which Duty Roles does user HCM_IMPL have?");
  await testQuery("Which roles are assigned to user HCM_IMPL?");
  await testQuery("What Job Roles does user JSMITH have?");
  await testQuery("Show Data Roles for user FIN_IMPL");
}

run();
