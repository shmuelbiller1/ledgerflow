import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Only inert documentation assets can bypass application validation.
const staticDoc = path => /\.md$/i.test(path) || /^docs\/.+\.(?:txt|rst|png|jpe?g|gif|svg|webp|pdf)$/i.test(path);

// Restrict these exceptions to files already covered by the ordinary Node unit-test globs.
// Shared fixtures, test setup, configurations, scripts and application source require full E2E.
const unitTest = path => /^(?:src\/tests\/[^/]+\.test\.tsx?|src\/lib\/[^/]+\.test\.ts|src\/server\/utils\/[^/]+\.test\.ts)$/.test(path);
const browserSpec = path => /^e2e\/(?:[^/]+\/)*[^/]+\.spec\.tsx?$/.test(path);

export function classifyChangedPaths(files) {
  if (!Array.isArray(files)) throw new TypeError('expected an array of changed paths');
  const valid = files.length > 0 && files.every(p => typeof p === 'string' && !!p.trim());
  const docsOnly = valid && files.every(staticDoc);
  const unitOnly = valid && files.some(unitTest) && files.every(p => staticDoc(p) || unitTest(p));
  const specs = files.filter(p => typeof p === 'string' && browserSpec(p));
  const specOnly = valid && specs.length > 0 && files.every(p => staticDoc(p) || unitTest(p) || browserSpec(p));
  return {
    docs_only: docsOnly,
    browser_mode: docsOnly || unitOnly ? 'skip' : specOnly ? 'targeted' : 'full',
    targeted_specs: specOnly ? specs : [],
  };
}

export const isDocsOnlyChangedPaths = files => classifyChangedPaths(files).docs_only;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const paths = Buffer.concat(chunks).toString('utf8').split('\0').filter(Boolean);
  const decision = classifyChangedPaths(paths);
  process.stdout.write('docs_only=' + decision.docs_only + '\n');
  process.stdout.write('browser_mode=' + decision.browser_mode + '\n');
  process.stdout.write('targeted_specs=' + JSON.stringify(decision.targeted_specs) + '\n');
}
