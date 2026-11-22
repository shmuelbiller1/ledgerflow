/** #924: a project's split rules are typed, each share is in (0, 100], and together they cannot exceed 100%. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectSchema } from '../schemas';
import { clampPercentWidth } from '../lib/percentBar';

const base = ProjectSchema.shape;
const rules = base.splitRules;

test('valid split rules pass, and no rules at all still pass', () => {
  assert.equal(rules.safeParse([{ partnerId: 'p1', percentage: 60 }, { partnerId: 'p2', partnerName: 'Dana', percentage: 40 }]).success, true);
  assert.equal(rules.safeParse(undefined).success, true);
});

test('a negative, zero, over-100 or non-numeric share is refused', () => {
  for (const percentage of [-10, 0, 120, Number.NaN, '50' as unknown as number]) {
    assert.equal(rules.safeParse([{ partnerId: 'p1', percentage }]).success, false, String(percentage));
  }
  assert.equal(rules.safeParse([{ percentage: 50 }]).success, false, 'a share names its partner');
});

test('shares that add up to more than 100% are refused', () => {
  const result = rules.safeParse([{ partnerId: 'p1', percentage: 70 }, { partnerId: 'p2', percentage: 50 }]);
  assert.equal(result.success, false);
  assert.match(JSON.stringify(result.error?.issues), /more than 100%/);
});

test('the bar is clamped whatever is stored', () => {
  assert.equal(clampPercentWidth(-20), 0);
  assert.equal(clampPercentWidth(140), 100);
});
