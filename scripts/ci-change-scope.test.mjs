import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { isDocsOnlyChangedPaths } from './ci-change-scope.mjs';

const cases = [
  [['README.md'], true],
  [['docs/guide.md', 'docs/flow.svg'], true],
  [['audit/notes.md'], true],
  [['src/App.tsx'], false],
  [['src/App.tsx', 'docs/guide.md'], false],
  [['docs/test-fixture.ts'], false],
  [['.github/workflows/ci.yml'], false],
  [['package-lock.json'], false],
  [['supabase/migrations/123.sql'], false],
  [[], false],
];

for (const [files, expected] of cases) {
  test('classifies ' + (files.join(', ') || 'no files') + ' as docs_only=' + expected, () => {
    assert.equal(isDocsOnlyChangedPaths(files), expected);
  });
}

test('CLI emits the GitHub job-output boolean for NUL-delimited Git paths', () => {
  const cli = new URL('./ci-change-scope.mjs', import.meta.url);
  for (const [files, expected] of cases) {
    const input = files.length ? files.join('\0') + '\0' : '';
    const output = spawnSync(process.execPath, [cli.pathname], { input, encoding: 'utf8' });
    assert.equal(output.status, 0, output.stderr);
    assert.equal(output.stdout, 'docs_only=' + expected + '\n');
  }
});
