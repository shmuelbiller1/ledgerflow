import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { classifyChangedPaths, isDocsOnlyChangedPaths } from './ci-change-scope.mjs';

const M = path => ({ status:'M', path });
const D = path => ({ status:'D', path });
const A = path => ({ status:'A', path });
const cases = [
  [[M('README.md')], 'skip', true, []],
  [[M('docs/guide.md'), M('docs/flow.svg')], 'skip', true, []],
  [[M('audit/notes.md')], 'skip', true, []],
  [[M('src/tests/posting.test.ts')], 'skip', false, []],
  [[M('src/tests/report.test.tsx'), M('docs/guide.md')], 'skip', false, []],
  [[M('src/lib/compute.test.ts')], 'skip', false, []],
  [[M('src/server/utils/access.test.ts')], 'skip', false, []],
  [[M('e2e/reports.spec.ts')], 'targeted', false, ['e2e/reports.spec.ts']],
  [[A('e2e/new.spec.ts'), M('e2e/ledger.spec.ts')], 'targeted', false, ['e2e/new.spec.ts','e2e/ledger.spec.ts']],
  [[D('e2e/old.spec.ts')], 'skip', false, []],
  [[D('e2e/old.spec.ts'), M('e2e/new.spec.ts')], 'targeted', false, ['e2e/new.spec.ts']],
  [[D('src/old.ts'), A('docs/old.md')], 'full', false, []],
  [[D('e2e/old.spec.ts'), A('docs/old.md')], 'skip', false, []],
  [[M('src/App.tsx')], 'full', false, []],
  [[M('src/App.tsx'), M('docs/guide.md')], 'full', false, []],
  [[D('src/lib/postingCheck.ts')], 'full', false, []],
  [[M('src/server/routes/invoiceRoutes.ts')], 'full', false, []],
  [[M('docs/test-fixture.ts')], 'full', false, []],
  [[M('e2e/setup.ts')], 'full', false, []],
  [[M('e2e/reports.spec.ts'), M('playwright.config.ts')], 'full', false, []],
  [[M('e2e/reports.spec.ts'), M('src/lib/reportMath.ts')], 'full', false, []],
  [[M('.github/workflows/ci.yml')], 'full', false, []],
  [[M('scripts/ci-change-scope.mjs')], 'full', false, []],
  [[M('package-lock.json')], 'full', false, []],
  [[A('supabase/migrations/123.sql')], 'full', false, []],
  [[{status:'R100',path:'docs/hidden.md'}], 'full', false, []],
  [[], 'full', false, []],
];
for (const [files, mode, docs, specs] of cases) {
  test('classifies ' + (files.map(f=>f.path).join(', ') || 'no paths'), () => {
    const result = classifyChangedPaths(files);
    assert.deepEqual(result, { docs_only: docs, browser_mode: mode, targeted_specs: specs });
    assert.equal(isDocsOnlyChangedPaths(files), docs);
  });
}
test('CLI parses NUL-delimited Git change-status records', () => {
  const cli = new URL('./ci-change-scope.mjs', import.meta.url);
  for (const [files, mode, docs, specs] of cases) {
    const input = files.map(f => f.status + '\0' + f.path + '\0').join('');
    const run = spawnSync(process.execPath, [cli.pathname], { input, encoding:'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'docs_only=' + docs + '\n' +
      'browser_mode=' + mode + '\n' + 'targeted_specs=' + JSON.stringify(specs) + '\n');
  }
});
