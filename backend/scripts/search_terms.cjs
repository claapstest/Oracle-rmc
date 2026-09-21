const fs = require('fs');
const path = require('path');

function searchDir(dir, patterns) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist' && entry.name !== 'cache') {
        results.push(...searchDir(fullPath, patterns));
      }
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') || entry.name.endsWith('.html') || entry.name.endsWith('.json') || entry.name.endsWith('.css'))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        patterns.forEach(p => {
          if (line.toLowerCase().includes(p.toLowerCase())) {
            results.push({ file: fullPath.replace(/\\/g, '/'), line: idx + 1, match: p, text: line.trim() });
          }
        });
      });
    }
  }
  return results;
}

const terms = ['Command Center', 'command center', 'Ask OracleRisk', 'Ask Oracle Risk', 'OracleRisk', 'CommandCenter'];
console.log('=== FRONTEND SEARCH ===');
const feMatches = searchDir('d:/Oracle-rmc-main/Oracle-rmc/frontend', terms);
console.log('Total frontend matches:', feMatches.length);
feMatches.forEach(m => console.log(`${m.file}:${m.line} [${m.match}] -> ${m.text.substring(0, 120)}`));

console.log('\n=== BACKEND SEARCH ===');
const beMatches = searchDir('d:/Oracle-rmc-main/Oracle-rmc/backend', terms);
console.log('Total backend matches:', beMatches.length);
beMatches.forEach(m => console.log(`${m.file}:${m.line} [${m.match}] -> ${m.text.substring(0, 120)}`));
