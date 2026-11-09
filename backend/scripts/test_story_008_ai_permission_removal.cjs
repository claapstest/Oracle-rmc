// VYR-008: verify the AI-free branch has no AI-only permissions or AI config references.
// Static checks only: no server, no database, no credentials required.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const section = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end));

// 1. RBAC seed defines no AI privilege or role mapping
const seed = read('database/src/seeds/rbac_seed.ts');
const privileges = section(seed, 'export const PRIVILEGES_DATA', 'export const ROLE_PRIVILEGE_MAPPINGS');
const mappings = section(seed, 'export const ROLE_PRIVILEGE_MAPPINGS', 'export const BOOTSTRAP_USER');
assert(!/ASK_VEYRA|AI_ASSISTANT/.test(privileges), 'RBAC seed must not define AI privileges');
assert(!/ASK_VEYRA|AI_ASSISTANT/.test(mappings), 'RBAC seed must not map AI privileges to roles');

// 2. Non-AI roles and privileges are preserved
for (const code of ['USERS_LIST', 'ROLES_CATALOG', 'AUDIT_TRAIL', 'RISK_MANAGEMENT', 'REPORTS', 'USER_MANAGEMENT', 'ORACLE_INTEGRATION', 'ORACLE_API_CONSOLE']) {
  assert(privileges.includes(`'${code}'`), `RBAC seed must keep privilege ${code}`);
}
for (const code of ['SITE_ADMIN', 'AUDIT_MANAGER', 'AUDIT_SUPERVISOR', 'AUDIT_USER']) {
  assert(seed.includes(`'${code}'`), `RBAC seed must keep role ${code}`);
}

// 3. No AI model/config seed remains in migrations
const migrations = fs.readdirSync(path.join(repoRoot, 'database/migrations'))
  .filter((f) => f.endsWith('.cjs'))
  .map((f) => [f, read(`database/migrations/${f}`)]);
const AI_CONFIG = /groqModel|llama-3\.3|gpt-oss|gemini|together\.xyz/i;
for (const [file, text] of migrations) {
  assert(!AI_CONFIG.test(text), `AI config reference in database/migrations/${file}`);
}

// 4. Dashboard scoping exposes no AI module or AI access flag
const dashboard = read('backend/src/services/auditDashboardService.ts');
assert(!/authorizedModules[^\n]*AI_ASSISTANT/.test(dashboard), 'authorizedModules must not include AI_ASSISTANT');
assert(!/hasAskVeyraAccess:\s*true/.test(dashboard), 'hasAskVeyraAccess must never be true');
assert(!/\baskVeyra:\s*true/.test(dashboard), 'features.askVeyra must never be true');

// 5. Frontend authorization defines no assistant/AI page permission
const authorization = read('frontend/src/utils/authorization.ts');
assert(!/^\s*(assistant|ai)\s*:/m.test(authorization), 'PAGE_PRIVILEGES must not define an assistant/AI page');

// 6. API documentation describes no NLU, chatbot, or LLM integration
const apiDoc = read('api_mapping.md');
assert(!/\bNLU\b|chatbot|LLM|groq|gemini|together/i.test(apiDoc), 'api_mapping.md must not describe AI integration');

console.log('VYR-008 checks passed: no AI permissions, AI config seeds, AI dashboard modules, or AI API docs remain.');
