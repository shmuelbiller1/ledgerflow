import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { docReadingTests, referencesDocumentation, stringLiterals, EXCLUDED } from './ci-doc-tests.mjs';

const script = fileURLToPath(new URL('./ci-doc-tests.mjs', import.meta.url));

test('the selection is the unit tests that name a document, not the ones that mention one', () => {
  const selected = docReadingTests();
  assert.ok(selected.length > 0, 'a docs-only run must not be empty');
  assert.deepEqual(selected, [...selected].sort(), 'stable order (the workflow prints it)');
  for (const file of selected) assert.ok(!EXCLUDED.includes(file), `${file} is excluded on purpose`);

  // Pinned: a documentation change must start these. Adding a doc-reading test updates this list
  // (and only this list), so a silently dropped test cannot hide behind a green run.
  assert.deepEqual(selected, [
    'src/tests/ai8-onboarding-help.test.tsx',
    'src/tests/capabilities-guard.test.ts',
    'src/tests/help-pages-coverage.test.ts',
    'src/tests/release-gate-table.test.ts',
    'src/tests/rule-pack-diff.test.ts',
    'src/tests/stage6-footprint-optimization.test.ts',
    'src/tests/vercel-ignore-boundary.test.ts',
  ]);
});

test('a document mentioned only in a comment does not start a test', () => {
  // Measured 15 Nov 2026: the shell grep selected these 11 files for a docs-only run and every one
  // of them reads no document (most are LF_TEST_DATABASE_URL suites that skip without a database).
  for (const file of [
    'src/tests/eg1-stock-cost-repost.test.ts',
    'src/tests/eg3-period-closing.test.ts',
    'src/tests/main-path.test.ts',
    'src/tests/l123-step4-open-years.test.tsx',
    'src/tests/theme-contrast-pairs.test.ts',
  ]) {
    const text = readFileSync(file, 'utf8');
    assert.equal(referencesDocumentation(file, text), false, `${file} reads no document`);
  }
});

test('the folder form the old shell search missed now counts', () => {
  const cases = [
    // The failure this replaces: `grep -E "docs/"` cannot see a path assembled from parts.
    [`${"import fs from 'node:fs';"}`, "fs.readFileSync(path.join('docs', 'TRACKER.md'), 'utf8')", true],
    ["fs.readFileSync('docs/CAPABILITIES.md')", null, true],
    ["fs.readFileSync('../audit/FINAL.md')", null, true],
    ['const page = `docs/help/${slug}.md`;', null, true],
    ["fs.readFileSync('CURRENT_WORK.md')", null, true],
    // Not documents: a route, a dependency manifest, an ordinary comment, a source file.
    ["const route = '/api/v1/audit/jobs/job_1';", null, false],
    ["const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));", null, false],
    ['// the plan is docs/PLAN.md, read by a human', null, false],
    ["import { scan } from '../../scripts/bug-patterns';", null, false],
  ];
  for (const [line, second, expected] of cases) {
    const text = second ? `${line}\n${second}\n` : `${line}\n`;
    assert.equal(referencesDocumentation('src/tests/example.test.ts', text), expected, text.trim());
  }
});

test('comments are not literals', () => {
  const literals = stringLiterals('x.ts', "/* docs/PLAN.md */\n// docs/TRACKER.md\nconst a = 'docs/PLAN.md';\n");
  assert.deepEqual(literals, ['docs/PLAN.md']);
});

test('the CLI prints exactly the selection and refuses an empty one', () => {
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.stdout.trim().split('\n'), docReadingTests());

  const json = spawnSync(process.execPath, [script, '--json'], { encoding: 'utf8' });
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), docReadingTests());
});

test('the docs-only job runs the script instead of a copied text search', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const match = workflow.match(/^  docs_checks:\n([\s\S]*?)(?=^  [a-z_]+:|$(?![\s\S]))/m);
  assert.ok(match, 'missing docs_checks job');
  const job = match[1];
  // One source of truth for "which tests read a doc". The previous inline grep is gone.
  assert.match(job, /node scripts\/ci-doc-tests\.mjs/);
  assert.doesNotMatch(job, /grep -lE "docs\//, 'the pasted grep is replaced by the script');
  // The rest of the suite forces exit because a leaked handle otherwise holds the job to its
  // 15-minute timeout after every test passed.
  assert.match(job, /--test-force-exit/);
});
