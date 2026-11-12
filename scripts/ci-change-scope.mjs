import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const staticDoc = p => /\.md$/i.test(p) || /^docs\/.+\.(?:txt|rst|png|jpe?g|gif|svg|webp|pdf)$/i.test(p);
const unitTest = p => /^(?:src\/tests\/[^/]+\.test\.tsx?|src\/lib\/[^/]+\.test\.ts|src\/server\/utils\/[^/]+\.test\.ts)$/.test(p);
const browserSpec = p => /^e2e\/(?:[^/]+\/)*[^/]+\.spec\.tsx?$/.test(p);

const normalize = x => typeof x === 'string' ? { status: 'M', path: x } : x;
export function classifyChangedPaths(changes) {
  if (!Array.isArray(changes)) throw new TypeError('expected an array of changes');
  const files = changes.map(normalize);
  if (!files.length || !files.every(f => f && typeof f.path === 'string' && f.path.trim()
      && typeof f.status === 'string' && /^[AMDTUXB]$/.test(f.status))) {
    return { docs_only: false, browser_mode: 'full', targeted_specs: [] };
  }
  const docsOnly = files.every(f => staticDoc(f.path));
  const unitOnly = files.some(f => unitTest(f.path)) &&
    files.every(f => staticDoc(f.path) || unitTest(f.path));
  const touchedSpecs = files.some(f => browserSpec(f.path));
  const specsOnly = touchedSpecs &&
    files.every(f => staticDoc(f.path) || unitTest(f.path) || browserSpec(f.path));
  const presentSpecs = files.filter(f => f.status !== 'D' && browserSpec(f.path)).map(f => f.path);
  return {
    docs_only: docsOnly,
    browser_mode: docsOnly || unitOnly || (specsOnly && !presentSpecs.length) ? 'skip'
      : specsOnly ? 'targeted' : 'full',
    targeted_specs: specsOnly ? presentSpecs : [],
  };
}
export const isDocsOnlyChangedPaths = files => classifyChangedPaths(files).docs_only;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  // git diff --name-status --no-renames -z emits STATUS NUL PATH NUL records.
  const parts = Buffer.concat(chunks).toString('utf8').split('\0');
  if (parts.at(-1) === '') parts.pop();
  if (parts.length % 2 !== 0) throw new Error('Invalid Git status record');
  const changes = [];
  for (let i = 0; i < parts.length; i += 2) changes.push({ status: parts[i], path: parts[i + 1] });
  const scope = classifyChangedPaths(changes);
  process.stdout.write('docs_only=' + scope.docs_only + '\n');
  process.stdout.write('browser_mode=' + scope.browser_mode + '\n');
  process.stdout.write('targeted_specs=' + JSON.stringify(scope.targeted_specs) + '\n');
}
