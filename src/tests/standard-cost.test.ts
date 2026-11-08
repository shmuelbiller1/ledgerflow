import test from 'node:test';
import assert from 'node:assert/strict';
import { formatVariancePct, standardCostReport, validStandardCost } from '../lib/standardCost';

/** M-21 step 1: the standard-cost variance, worked by hand. */
const item = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id, quantityAtHand: 10, unitCostCents: 1200, ...over });

test('variance per unit, as a share and on the stock on hand', () => {
  const r = standardCostReport([
    item('bolts', { standardCostCents: 1000 }),                       // 12.00 vs 10.00 × 10 → +20.00
    item('nuts', { standardCostCents: 1500, quantityAtHand: 4 }),     // 12.00 vs 15.00 × 4  → −12.00
    item('washers'),                                                   // no standard
  ]);
  assert.deepEqual(r.rows.map(x => [x.itemId, x.varianceUnitCents, x.varianceValueCents]), [['bolts', 200, 2000], ['nuts', -300, -1200]]);
  assert.equal(r.rows[0].variancePct, 0.2);
  assert.equal(r.rows[1].variancePct, -0.2);
  assert.equal(r.withoutStandard, 1);
  assert.equal(r.totalVarianceCents, 800);
});

test('services, bundles and negative stock', () => {
  const r = standardCostReport([
    item('svc', { itemType: 'service', standardCostCents: 100 }),
    item('kit', { bundleParts: [{ itemId: 'bolts', quantity: 2 }], standardCostCents: 100 }),
    item('short', { standardCostCents: 1000, quantityAtHand: -3 }),
    item('free', { standardCostCents: 0, unitCostCents: 50 }),
  ]);
  assert.deepEqual(r.rows.map(x => x.itemId), ['free', 'short']);
  assert.equal(r.rows.find(x => x.itemId === 'short')!.varianceValueCents, 0, 'negative stock counts as 0 units');
  assert.equal(r.rows.find(x => x.itemId === 'free')!.variancePct, null);
  assert.equal(r.withoutStandard, 0);
});

test('only whole, non-negative cents are a standard cost', () => {
  assert.equal(validStandardCost(0), 0);
  assert.equal(validStandardCost(1999), 1999);
  for (const bad of [-1, 1.5, '100', null, undefined, NaN]) assert.equal(validStandardCost(bad), null);
  assert.equal(formatVariancePct(0.125), '+12.5 %');
  assert.equal(formatVariancePct(-0.03), '−3.0 %');
  assert.equal(formatVariancePct(0), '0.0 %');
  assert.equal(formatVariancePct(null), '—');
});
