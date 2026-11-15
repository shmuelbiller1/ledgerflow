import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importEdges } from './import-edges.mjs';
import { isUnitTestPath, classifyChangedPaths, BUNDLE_INVARIANT_TESTS } from './ci-change-scope.mjs';

/**
 * Evidence for the `build_mode` output in `.github/workflows/ci.yml`:
 *
 *   a change to a documentation file, a unit test, a browser spec or a screenshot cannot change
 *   dist/ or build/, so those changes skip the "Production build" job.
 *
 * That is only true while the two bundles are built from files that never reach a test or a doc.
 * This walks the actual entry graphs (the Vite client from `src/main.tsx`, the Express server from
 * `server.ts`) and fails if any reachable module is a test, a spec, or a document. If it ever is,
 * the job that builds the bundle DOES depend on those files and `build_mode` must go back to
 * always.
 *
 * The other two tests here answer the mirror question — is there a test file that no CI job would
 * ever run? — because a test that runs nowhere is the same defect as a change that runs no test.
 */

const ROOT = process.cwd();
const ENTRIES = ['src/main.tsx', 'server.ts'];
const CANDIDATE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'];
const NOT_A_BUNDLE_INPUT = [
  [/\.(?:test|spec)\.[cm]?[jt]sx?$/i, 'a test or browser spec'],
  [/^(?:e2e|src\/tests|docs|audit)\//, 'a test or documentation tree'],
  [/\.(?:md|mdx|txt|rst|csv|jsonl|png|jpe?g|svg|webp|pdf)$/i, 'a document or an image'],
];

function resolveLocal(fromFile, specifier) {
  const clean = specifier.split('?')[0].split('#')[0];
  if (!clean.startsWith('.')) return null; // a package, or an import.meta.glob pattern
  const base = path.resolve(ROOT, path.dirname(fromFile), clean);
  const candidates = [
    base,
    ...CANDIDATE_EXTENSIONS.map(extension => base + extension),
    ...CANDIDATE_EXTENSIONS.map(extension => path.join(base, 'index' + extension)),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(ROOT, candidate).split(path.sep).join('/');
    }
  }
  return null;
}

/** Every module reachable from the bundles' entry points. */
export function bundleInputs() {
  const visited = new Set();
  const queue = [...ENTRIES];
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    if (!/\.[cm]?[jt]sx?$/.test(current)) continue;
    for (const specifier of importEdges(current, fs.readFileSync(path.join(ROOT, current), 'utf8'))) {
      const resolved = resolveLocal(current, specifier);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return [...visited].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(relative, found);
    else if (entry.isFile()) found.push(relative);
  }
  return found;
}

test('the production bundles are reachable from their two entry points', () => {
  const inputs = bundleInputs();
  assert.ok(inputs.length > 500, `expected a real bundle graph, found ${inputs.length} modules`);
  for (const entry of ENTRIES) assert.ok(inputs.includes(entry), `${entry} is in the graph`);
});

test('no bundle input is a test, a spec, or a document (so those changes cannot change the build)', () => {
  const offenders = [];
  for (const file of bundleInputs()) {
    for (const [pattern, label] of NOT_A_BUNDLE_INPUT) {
      if (pattern.test(file)) offenders.push(`${file} (${label})`);
    }
  }
  assert.deepEqual(offenders, [], 'a bundle input now depends on test or documentation files: '
    + 'the production build must run for those changes again (docs/CI_STRATEGY.md "What a change runs")');
});

test('every unit test under src is one the classifier counts as a unit test', () => {
  // src/tests/test-discovery-guard.test.ts already proves that `npm test` runs every test file;
  // this is the other half of that contract: a test the classifier does not recognise is routed as
  // application code, so its own change starts the full matrix instead of the unit jobs alone.
  const onDisk = walk('src').filter(file => /\.test\.[jt]sx?$/.test(file));
  assert.ok(onDisk.length > 1000, `expected the unit suite on disk, found ${onDisk.length} files`);
  assert.deepEqual(onDisk.filter(file => !isUnitTestPath(file)), [],
    'these test files are not recognised as unit tests: widen isUnitTestPath in scripts/ci-change-scope.mjs '
    + 'and the npm-script globs together');
});

test('every script test is named by the validate job', () => {
  const onDisk = fs.readdirSync(path.join(ROOT, 'scripts')).filter(name => name.endsWith('.test.mjs')).sort();
  assert.ok(onDisk.length > 0);
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const named = new Set([...workflow.matchAll(/scripts\/([\w.-]+\.test\.mjs)/g)].map(match => match[1]));
  assert.deepEqual(onDisk.filter(name => !named.has(name)), [],
    'these script tests run in no CI job: add them to the `node --test scripts/...` steps in ci.yml');
});

test('the classifier builds for exactly the tests that assert on the built artifacts', () => {
  // `test:bundle` is the only place those assertions run: the unit shards have no dist/.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const named = [...pkg.scripts['test:bundle'].matchAll(/src\/[\w./-]+\.test\.ts/g)]
    .map(match => match[0]).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual([...BUNDLE_INVARIANT_TESTS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), named,
    'BUNDLE_INVARIANT_TESTS must stay equal to the files `npm run test:bundle` runs');
  for (const file of named) {
    assert.equal(classifyChangedPaths([{ status: 'M', path: file }]).build_mode, 'full', file);
  }
});
