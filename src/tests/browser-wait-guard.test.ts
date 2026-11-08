/**
 * A browser test may not wait for an animation without a deadline.
 *
 * `page.waitForFunction(fn, arg, options)` takes its options third. Passing `{ timeout }` second
 * makes it the *argument*, so the call falls back to the 30-second default and, whenever the
 * condition is false (a screen with a looping animation never reports zero animations), each call
 * costs the whole default. Twenty-three call sites written that way made one browser shard take 45
 * minutes while the other four finished in five, and the failure looked like "the suite is slow"
 * rather than "these calls are wrong".
 *
 * The rule: e2e specs wait for animations through `settleAnimations(page, ms)` from
 * `e2e/support/a11yGate.ts`, and a hand-written `waitForFunction` must pass `undefined` for the
 * argument when it passes options.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { filesIn } from './helpers/repoScan';

const SPECS = filesIn('e2e').filter(file => file.endsWith('.spec.ts'));
const WAIT = /waitForFunction\(\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>[^,]*,\s*(\{[^}]*\})/g;

describe('browser animation waits', () => {
  test('no spec passes an options object where the argument belongs', () => {
    const offenders: string[] = [];
    for (const file of SPECS) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(WAIT)) {
        if (!/timeout/.test(match[1])) continue;
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${file}:${line} passes ${match[1]} as the argument; options are the third parameter`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  test('a screen that keeps animating cannot stall a spec', () => {
    const gate = fs.readFileSync('e2e/support/a11yGate.ts', 'utf8');
    const helper = gate.slice(gate.indexOf('export async function settleAnimations'));
    // Settling must be bounded: the wait gives up at the deadline and the spec carries on.
    assert.match(helper, /undefined,\s*\{ timeout/, 'settleAnimations passes its options third');
    assert.match(helper, /\.catch\(\(\) => undefined\)/, 'settleAnimations never throws on a slow screen');
  });

  test('a spec that calls settleAnimations imports it', () => {
    const missing = SPECS.filter(file => {
      const source = fs.readFileSync(file, 'utf8');
      return /settleAnimations\(/.test(source) && !/import\s*\{[^}]*settleAnimations/.test(source);
    });
    assert.deepEqual(missing, [], 'these specs call settleAnimations without importing it');
  });

  test('the specs use the helper rather than their own copy of the wait', () => {
    const handwritten = SPECS.filter(file => /getAnimations\(\)\.length === 0/.test(fs.readFileSync(file, 'utf8')));
    assert.deepEqual(handwritten, [], 'these specs should call settleAnimations from e2e/support/a11yGate');
  });
});
