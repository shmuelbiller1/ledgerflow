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
  assert.match(unit, /^    needs: unit$/m);
  assert.match(unit, /UNIT_RESULT: \$\{\{ needs\.unit\.result \}\}/);
  assert.match(unit, /test "\$UNIT_RESULT" = success/);
  assert.match(unit, /npm run coverage:gate/);
  assert.match(browser, /^    needs: e2e_shards$/m);
  assert.match(browser, /SHARD_RESULT: \$\{\{ needs\.e2e_shards\.result \}\}/);
  assert.match(browser, /test "\$SHARD_RESULT" = success/);
});

test('new PR commits cancel older runs without cancelling main-branch runs', () => {
  assert.match(workflow, /group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}-\$\{\{ github\.ref == 'refs\/heads\/main' && github\.sha \|\| 'latest' \}\}/);
  assert.match(workflow, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/);
});
