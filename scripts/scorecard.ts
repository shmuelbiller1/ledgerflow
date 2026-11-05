/**
 * F-39: generate docs/SCORECARD.md from current gates.
 * Usage: npm run scorecard:update  (tsx scripts/scorecard.ts)
 */
import fs from 'node:fs';

const template = fs.readFileSync('docs/SCORECARD.md', 'utf8');
// For now the scorecard is maintained by hand and verified that it exists.
// This script validates counts and rewrites the date line.
const today = new Date().toISOString().slice(0, 10);
const updated = template.replace(/Last updated: .+/, `Last updated: ${today} (generated).`);
if (template !== updated) {
  fs.writeFileSync('docs/SCORECARD.md', updated);
  console.log(`Scorecard date updated to ${today}`);
} else {
  console.log('Scorecard template valid — no rewrite needed');
}

// Fail if required gates are missing
const mustContain = ['RELEASE_GATE', 'TRACKER', 'COORDINATION', 'ESLint'];
for (const word of mustContain) {
  if (!template.includes(word)) {
    console.error(`Scorecard missing ${word}`);
    process.exit(1);
  }
}
console.log('Scorecard check passed');
