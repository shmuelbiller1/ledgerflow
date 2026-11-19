import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { clampPercentWidth } from '../lib/percentBar';

/**
 * The #909 class, guarded for good.
 *
 * A decorative track drawn as `style={{ width: `${share}%` }}` breaks in three ordinary ways:
 * a refund or negative net makes the share negative, a >100 % share overflows the track, and a
 * division by a zero total (or a missing value) makes it `NaN`. A browser *drops* an invalid width
 * declaration and the block falls back to `auto`, so the bar fills the whole track while the
 * number beside it says something else — the Reader sees the opposite of the truth. `Math.max(0,
 * Math.min(100, NaN))` is still `NaN`, so the clamp alone is not enough; the value must be finite
 * before it is clamped, which is what `clampPercentWidth` does.
 *
 * This test fails when a new percentage width is written without that helper, so a screen added
 * later cannot quietly bring the bug back.
 */

const COMPONENTS = path.join(process.cwd(), 'src/components');

/** Every `.tsx` under src/components, except test files. */
function componentFiles(dir: string = COMPONENTS): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...componentFiles(full));
    else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) found.push(full);
  }
  return found;
}

/** `${...}%` inside an inline style width/animate width. */
const PERCENT_WIDTH = /width:\s*`\$\{([^}]*)\}%`/g;

describe('#909/#924 decorative percentage bars', () => {
  it('returns the value unchanged inside the track', () => {
    // An ordinary contribution keeps its exact proportion — the fix must not round or re-scale it.
    assert.equal(clampPercentWidth(0), 0);
    assert.equal(clampPercentWidth(12.5), 12.5);
    assert.equal(clampPercentWidth(100), 100);
  });

  it('floors a negative share at an empty track instead of letting it fill', () => {
    // Issue #909's measured case: Rent 119.1 % and a rebate of −19.1 % both painted 96 of 96 px.
    assert.equal(clampPercentWidth(-19.1), 0);
    assert.equal(clampPercentWidth(-0.0001), 0);
  });

  it('caps a share above 100 so it fills exactly one track', () => {
    assert.equal(clampPercentWidth(119.1), 100);
    assert.equal(clampPercentWidth(1e9), 100);
  });

  it('turns a non-finite value into an empty track, never into NaN', () => {
    // NaN and Infinity are the two values a browser refuses; `Math.max(0, Math.min(100, NaN))` is
    // NaN, so this is the case the earlier clamp missed.
    for (const value of [NaN, Infinity, -Infinity, undefined, null, '', 'not a number']) {
      const clamped = clampPercentWidth(value);
      assert.equal(clamped, 0, `${String(value)} must clamp to 0, got ${clamped}`);
      assert.ok(Number.isFinite(clamped));
    }
    // A numeric string from the database/import path still works.
    assert.equal(clampPercentWidth('42.5'), 42.5);
  });

  it('honours an explicit range', () => {
    assert.equal(clampPercentWidth(150, 0, 360), 150);
    assert.equal(clampPercentWidth(400, 0, 360), 360);
    assert.equal(clampPercentWidth(-10, 0, 360), 0);
    assert.equal(clampPercentWidth(NaN, 10, 360), 10);
  });

  it('every percentage width in src/components goes through the clamp', () => {
    const offenders: string[] = [];
    for (const file of componentFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(PERCENT_WIDTH)) {
        const expression = match[1];
        if (!expression.includes('clampPercentWidth(') && !expression.includes('percentWidthStyle(')) {
          const line = source.slice(0, match.index).split('\n').length;
          offenders.push(`${path.relative(process.cwd(), file)}:${line} — width: \`\${${expression}}%\``);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Percentage bars must use clampPercentWidth/percentWidthStyle from src/lib/percentBar.ts ` +
        `(a negative or NaN width is dropped by the browser and the bar fills its track — issue #909):\n${offenders.join('\n')}`,
    );
  });

  it('the scanner would catch a regression (it is not vacuous)', () => {
    // Prove the pattern really matches the shape the fix replaced, so a new unclamped bar fails.
    const sample = 'style={{ width: `${Math.min(100, share)}%` }}';
    const matches = [...sample.matchAll(PERCENT_WIDTH)];
    assert.equal(matches.length, 1);
    assert.equal(matches[0][1].includes('clampPercentWidth('), false);
    // …and stays quiet once it is clamped.
    const fixed = 'style={percentWidthStyle(share)}';
    assert.equal([...fixed.matchAll(PERCENT_WIDTH)].length, 0);
  });
});
