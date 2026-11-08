/**
 * Sonar S2871: every `.sort()` on strings now names its order. `byCodeUnit` must give exactly the order a plain
 * `.sort()` gave, so no list, checksum or key changes order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { byCodeUnit } from '../lib/codeUnitOrder';

test('byCodeUnit keeps the default string order (upper case before lower, digits before letters, code units not locale)', () => {
  const input = ['b', 'B', 'a', '10', '9', '2026-11-01', '2026-02-28', 'é', 'z', ''];
  // worked by hand from UTF-16 code units: '' < '1'(49) < '2' < '9'(57) < 'B'(66) < 'a'(97) < 'b' < 'z'(122) < 'é'(233)
  assert.deepEqual([...input].sort(byCodeUnit), ['', '10', '2026-02-28', '2026-11-01', '9', 'B', 'a', 'b', 'z', 'é']);
  assert.deepEqual([...input].sort(byCodeUnit), [...input].sort());
  assert.equal(byCodeUnit('USD', 'USD'), 0);
});
