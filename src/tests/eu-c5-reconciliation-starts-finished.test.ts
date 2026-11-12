/**
 * EU-C5: reconciliation opens on what is done. By hand: 210 lines matched; of 10 still open, the matcher suggests a
 * match for 4 → "214 of 220 lines matched or ready to confirm — 6 need you", and the six come first in the list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { needYouFirst, reconciliationSummary } from '../lib/reconciliationSummary';

const open = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}` }));
const suggestions = new Map<string, string | undefined>([['b1', 't1'], ['b3', 't3'], ['b5', 't5'], ['b7', 't7']]);

test('EU-C5: the summary counts matched + ready, and who needs the person', () => {
  const s = reconciliationSummary(210, open.map(o => o.id), suggestions);
  assert.deepEqual([s.total, s.matched, s.ready, s.needYou], [220, 210, 4, 6]);
  assert.equal(s.text, '214 of 220 lines matched or ready to confirm — 6 need you');
  assert.equal(reconciliationSummary(3, [], new Map()).text, 'All 3 lines matched or ready to confirm');
  assert.equal(reconciliationSummary(0, ['x'], new Map()).text, '0 of 1 line matched or ready to confirm — 1 needs you');
  assert.equal(reconciliationSummary(0, [], new Map()).text, 'No bank lines yet');
});

test('EU-C5: the six that need the person come first, each group in its own order', () => {
  assert.deepEqual(needYouFirst(open, suggestions).map(o => o.id), ['b0', 'b2', 'b4', 'b6', 'b8', 'b9', 'b1', 'b3', 'b5', 'b7']);
});
