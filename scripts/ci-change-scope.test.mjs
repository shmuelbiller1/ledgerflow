import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { classifyChangedPaths, isDocsOnlyChangedPaths } from './ci-change-scope.mjs';

const cases = [
  [['README.md'], 'skip', true],
  [['docs/guide.md', 'docs/flow.svg'], 'skip', true],
  [['audit/notes.md'], 'skip', true],
  [['src/tests/posting-precision.test.ts'], 'skip', false],
  [['src/tests/report-ui.test.tsx','docs/guide.md'], 'skip', false],
  [['src/lib/compute.test.ts'], 'skip', false],
  [['src/server/utils/access.test.ts'], 'skip', false],
  [['e2e/reports.spec.ts'], 'targeted', false],
  [['e2e/reports.spec.ts','e2e/ledger.spec.ts'], 'targeted', false],
  [['e2e/reports.spec.ts','src/tests/compute.test.ts'], 'targeted', false],
  [['src/App.tsx'], 'full', false],
  [['src/App.tsx','docs/guide.md'], 'full', false],
  [['src/lib/postingCheck.ts'], 'full', false],
  [['src/server/routes/invoiceRoutes.ts'], 'full', false],
  [['docs/test-fixture.ts'], 'full', false],
  [['e2e/setup.ts'], 'full', false],
  [['e2e/reports.spec.ts','playwright.config.ts'], 'full', false],
  [['e2e/reports.spec.ts','src/lib/reportMath.ts'], 'full', false],
  [['.github/workflows/ci.yml'], 'full', false],
  [['scripts/ci-change-scope.mjs'], 'full', false],
  [['package-lock.json'], 'full', false],
  [['supabase/migrations/123.sql'], 'full', false],
  [[], 'full', false],
];
for (const [files, mode, docs] of cases) {
  test('classifies ' + (files.join(', ') || 'no paths') + ' as ' + mode, () => {
    const result = classifyChangedPaths(files);
    assert.equal(result.browser_mode, mode);
    assert.equal(result.docs_only, docs);
    assert.equal(isDocsOnlyChangedPaths(files), docs);
    assert.deepEqual(result.targeted_specs, mode === 'targeted' ? files.filter(p => p.endsWith('.spec.ts')) : []);
  });
}
test('NUL-delimited CLI produces safe GitHub action outputs for each scope', () => {
  const script = new URL('./ci-change-scope.mjs', import.meta.url);
  for (const [files, mode, docs] of cases) {
    const input = files.length ? files.join('\0') + '\0' : '';
    const result = spawnSync(process.execPath, [script.pathname], { input, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const target = classifyChangedPaths(files).targeted_specs;
    assert.equal(result.stdout, 'docs_only=' + docs + '\n' +
      'browser_mode=' + mode + '\n' + 'targeted_specs=' + JSON.stringify(target) + '\n');
  }
});
