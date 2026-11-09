// VYR-007: verify the AI-free branch carries no AI secrets or AI configuration.
// Static checks only: no server, no database, no credentials required.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const AI_VARS = /\b(TOGETHER_API_KEY|TOGETHER_MODEL|GROQ_API_KEY|GROQ_MODEL|LLM_ENDPOINT|GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)\b/;

// 1. .env.example provisions no AI credentials
const envExample = read('.env.example');
assert(!AI_VARS.test(envExample), '.env.example must not define AI credentials or model settings');

// 2. Runtime config reads no AI environment variables
const configSource = read('backend/src/config.ts');
assert(!AI_VARS.test(configSource), 'config.ts must not read AI environment variables');
assert(!/togetherApiKey|togetherModel|groqApiKey|groqModel|llmEndpoint/.test(configSource),
  'config.ts must not expose AI config fields');

// 3. No AI configuration leaks through API responses
const apiSource = read('backend/src/routes/api.ts');
assert(!/hasGeminiKey|groqModel|togetherModel/.test(apiSource),
  'api.ts must not return AI configuration fields');

// 4. Logs/startup mention no AI provider requirement
const indexSource = read('backend/src/index.ts');
assert(!/TOGETHER_API_KEY|GROQ_API_KEY|GEMINI_API_KEY|Primary AI Query Engine/.test(indexSource),
  'index.ts must not require AI credentials at startup');

// 5. No AI provider calls remain in backend or frontend source
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  if (entry.name === 'node_modules' || entry.name === 'dist') return [];
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});
const sourceFiles = [...walk(path.join(repoRoot, 'backend/src')), ...walk(path.join(repoRoot, 'frontend/src'))]
  .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f));
const aiCallPattern = /api\.together\.xyz|api\.groq\.com|generativelanguage\.googleapis\.com|api\.openai\.com|api\.anthropic\.com/;
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, 'utf8');
  assert(!aiCallPattern.test(text), `AI provider endpoint referenced in ${path.relative(repoRoot, file)}`);
}

console.log('VYR-007 checks passed: no AI secrets, AI config fields, API exposure, or provider endpoints remain.');
