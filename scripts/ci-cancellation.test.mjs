import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const job = name => {
  const match = workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z_]+:|$(?![\\s\\S]))`, 'm'));
  assert.ok(match, `missing ${name} job`);
  return match[1];
};

test('superseded runs do not enqueue post-cancellation gates', () => {
  for (const name of ['unit_gate', 'e2e']) {
    const config = job(name);
    assert.match(config, /^    if: \$\{\{ !cancelled\(\) \}\}$/m);
    assert.doesNotMatch(config, /^    if: always\(\)$/m);
  }
});

test('failed or skipped shards still fail the required non-cancelled gates', () => {
  const unit = job('unit_gate'), browser = job('e2e');
  assert.match(unit, /^    needs: \[changes, unit, docs_checks\]$/m);
  assert.match(unit, /UNIT_RESULT: \$\{\{ needs\.unit\.result \}\}/);
  assert.match(unit, /test "\$UNIT_RESULT" = success/);
  assert.match(unit, /npm run coverage:gate/);
  assert.match(browser, /^    needs: \[changes, e2e_shards\]$/m);
  assert.match(browser, /SHARD_RESULT: \$\{\{ needs\.e2e_shards\.result \}\}/);
  assert.match(browser, /test "\$SHARD_RESULT" = success/);
});

test('new PR and main commits cancel superseded runs, retaining checks for the latest head', () => {
  assert.match(workflow, /group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/);
  assert.match(workflow, /^  cancel-in-progress: true$/m);
});


test('browser cleanup runs after failures but not after workflow cancellation', () => {
  for (const [name, step] of [
    ['e2e_shards', 'Upload browser reports and failure diagnostics'],
    ['e2e', 'Upload combined report'],
    ['e2e', 'Say which suites a cancelled shard never reached'],
    ['e2e', 'Require every shard to succeed'],
  ]) {
    const config = job(name);
    assert.match(config, new RegExp(`- name: ${step}\\n        if: \\$\\{\\{ !cancelled\\(\\)( && needs\\.changes\\.outputs\\.docs_only != 'true')? \\}\\}`), `${name}: ${step}`);
  }
});

test('a docs-only pull request skips the long runs but still runs the tests that read a doc', () => {
  const changes = job('changes');
  assert.match(changes, /git diff --name-only -z/);
  assert.match(changes, /node scripts\/ci-change-scope\.mjs >> "\$GITHUB_OUTPUT"/);
  assert.match(changes, /"\$EVENT" != pull_request \]; then echo "docs_only=false"/);
  for (const name of ['validate', 'unit', 'build', 'timezones', 'e2e_shards']) {
    assert.match(job(name), /^    if: \$\{\{ needs\.changes\.outputs\.docs_only != 'true' \}\}$/m, name);
  }
  assert.match(job('docs_checks'), /^    if: \$\{\{ needs\.changes\.outputs\.docs_only == 'true' \}\}$/m);
  assert.match(job('unit_gate'), /if \[ "\$DOCS_ONLY" = true \]; then test "\$DOCS_RESULT" = success; else test "\$UNIT_RESULT" = success; fi/);
});
