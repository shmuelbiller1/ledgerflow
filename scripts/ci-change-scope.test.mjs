import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { classifyChangedPaths, isDocsOnlyChangedPaths, planJobs, formatPlan } from './ci-change-scope.mjs';

const M = path => ({ status:'M', path });
const D = path => ({ status:'D', path });
const A = path => ({ status:'A', path });
// [files, browser_mode, docs_only, targeted_specs, build_mode]
const cases = [
  [[M('README.md')], 'skip', true, [], 'skip'],
  [[M('docs/guide.md'), M('docs/flow.svg')], 'skip', true, [], 'skip'],
  [[M('audit/notes.md')], 'skip', true, [], 'skip'],
  // Generated documentation artifacts are documentation: both trees are excluded from the
  // deployment (.vercelignore `/docs/`, `/audit/`), so they cannot reach a bundle or a browser.
  [[M('docs/CODE_ATLAS.jsonl')], 'skip', true, [], 'skip'],
  [[M('docs/eval/rule-pack-snapshots/2026-11-15.json')], 'skip', true, [], 'skip'],
  [[M('docs/verification/images/d85/before-dashboard-1280-light.png')], 'skip', true, [], 'skip'],
  [[M('audit/COMPLETE_FILE_INVENTORY.csv')], 'skip', true, [], 'skip'],
  // Code-like files inside the documentation trees are linted, so they still run every code job.
  [[M('docs/archive/audit/agent7-probes/y35-fuzz.ts')], 'full', false, [], 'full'],
  [[M('audit/agent11/probes/j2-qbo-wizard-csv.ts')], 'full', false, [], 'full'],
  [[M('src/tests/posting.test.ts')], 'skip', false, [], 'skip'],
  [[M('src/tests/report.test.tsx'), M('docs/guide.md')], 'skip', false, [], 'skip'],
  [[M('src/lib/compute.test.ts')], 'skip', false, [], 'skip'],
  [[M('src/server/utils/access.test.ts')], 'skip', false, [], 'skip'],
  [[M('e2e/reports.spec.ts')], 'targeted', false, ['e2e/reports.spec.ts'], 'skip'],
  [[A('e2e/new.spec.ts'), M('e2e/ledger.spec.ts')], 'targeted', false, ['e2e/new.spec.ts','e2e/ledger.spec.ts'], 'skip'],
  [[D('e2e/old.spec.ts')], 'skip', false, [], 'skip'],
  [[D('e2e/old.spec.ts'), M('e2e/new.spec.ts')], 'targeted', false, ['e2e/new.spec.ts'], 'skip'],
  // A screenshot baseline is verified by the browser suite, not by the bundle build.
  [[M('e2e/__screenshots__/dashboard-1280-light-chromium-linux.png')], 'full', false, [], 'skip'],
  [[D('src/old.ts'), A('docs/old.md')], 'full', false, [], 'full'],
  [[D('e2e/old.spec.ts'), A('docs/old.md')], 'skip', false, [], 'skip'],
  [[M('src/App.tsx')], 'full', false, [], 'full'],
  [[M('src/App.tsx'), M('docs/guide.md')], 'full', false, [], 'full'],
  [[D('src/lib/postingCheck.ts')], 'full', false, [], 'full'],
  [[M('src/server/routes/invoiceRoutes.ts')], 'full', false, [], 'full'],
  [[M('docs/test-fixture.ts')], 'full', false, [], 'full'],
  [[M('e2e/setup.ts')], 'full', false, [], 'full'],
  [[M('e2e/reports.spec.ts'), M('playwright.config.ts')], 'full', false, [], 'full'],
  [[M('e2e/reports.spec.ts'), M('src/lib/reportMath.ts')], 'full', false, [], 'full'],
  [[M('.github/workflows/ci.yml')], 'full', false, [], 'full'],
  [[M('scripts/ci-change-scope.mjs')], 'full', false, [], 'full'],
  [[M('package-lock.json')], 'full', false, [], 'full'],
  [[A('supabase/migrations/123.sql')], 'full', false, [], 'full'],
  [[{status:'R100',path:'docs/hidden.md'}], 'full', false, [], 'full'],
  [[], 'full', false, [], 'full'],
];
for (const [files, mode, docs, specs, build] of cases) {
  test('classifies ' + (files.map(f=>f.path).join(', ') || 'no paths'), () => {
    const result = classifyChangedPaths(files);
    assert.deepEqual(result, { docs_only: docs, browser_mode: mode, targeted_specs: specs, build_mode: build });
    assert.equal(isDocsOnlyChangedPaths(files), docs);
  });
}
test('CLI parses NUL-delimited Git change-status records', () => {
  const cli = new URL('./ci-change-scope.mjs', import.meta.url);
  for (const [files, mode, docs, specs, build] of cases) {
    const input = files.map(f => f.status + '\0' + f.path + '\0').join('');
    const run = spawnSync(process.execPath, [cli.pathname], { input, encoding:'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'docs_only=' + docs + '\n' +
      'browser_mode=' + mode + '\n' + 'targeted_specs=' + JSON.stringify(specs) + '\n' +
      'build_mode=' + build + '\n');
  }
});

test('the classifier imports nothing, because the changes job does not install dependencies', () => {
  // `changes` is the only job with no `npm ci` before it: it decides what the other jobs are, so it
  // cannot depend on anything they install. A single `import ts from 'typescript'` here fails every
  // pull request in the repository with ERR_MODULE_NOT_FOUND.
  const source = readFileSync(new URL('./ci-change-scope.mjs', import.meta.url), 'utf8');
  const specifiers = [...source.matchAll(/^import\s[^\n]*?from\s+'([^']+)'/gm)].map(match => match[1]);
  assert.ok(specifiers.length > 0, 'found the imports');
  for (const specifier of specifiers) {
    assert.match(specifier, /^node:/, `${specifier} is not a Node built-in`);
  }
});

test('the documented job plan is the job list of the workflow', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const jobs = new Set([...workflow.matchAll(/^ {2}([a-z0-9_]+):$/gm)].map(match => match[1]));
  for (const step of planJobs(classifyChangedPaths([M('src/App.tsx')]))) {
    for (const job of step.jobs) assert.ok(jobs.has(job), `plan names ${job}, which is not a job in ci.yml`);
  }
});

test('the plan answers "what runs for this change" without reading the YAML', () => {
  const runs = files => new Set(planJobs(classifyChangedPaths(files))
    .filter(step => step.runs).flatMap(step => step.jobs));
  const docs = runs([M('docs/PLAN.md')]);
  assert.deepEqual([...docs].sort(), ['changes', 'docs_checks', 'e2e']);
  const unitOnly = runs([M('src/tests/posting.test.ts')]);
  assert.deepEqual([...unitOnly].sort(), ['changes', 'e2e', 'timezones', 'unit', 'unit_gate', 'validate']);
  const specOnly = runs([M('e2e/reports.spec.ts')]);
  assert.deepEqual([...specOnly].sort(), ['changes', 'e2e', 'e2e_targeted', 'timezones', 'unit', 'unit_gate', 'validate']);
  const source = runs([M('src/App.tsx')]);
  for (const job of ['build', 'e2e_shards', 'unit', 'timezones', 'validate']) assert.ok(source.has(job), job);
  const text = formatPlan(classifyChangedPaths([M('src/App.tsx')]));
  assert.match(text, /^RUN {2}build: /m);
  assert.match(text, /^skip docs_checks: /m);
});

test('a spec-only change keeps the unit suite, because a unit test reads every spec', () => {
  // src/tests/browser-wait-guard.test.ts walks e2e/*.spec.ts, so "only specs changed" is not a
  // reason to skip the unit suite. Only the production build is skipped.
  const runs = new Set(planJobs(classifyChangedPaths([M('e2e/reports.spec.ts')]))
    .filter(step => step.runs).flatMap(step => step.jobs));
  assert.ok(runs.has('unit'), 'the unit suite must run for a spec change');
  assert.ok(!runs.has('build'), 'a spec is not a bundle input');
});
