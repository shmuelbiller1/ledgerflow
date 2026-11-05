/**
 * The plain-language parsers: search phrases ("over 500 in march 2026") and quick entries
 * ("spent 28.99 on coffee"). Amounts are whole cents (they used to come out as 2898.9999…) and
 * a typed date never rolls into the next month (L-176).
 */
import test, { afterEach, beforeEach, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IntentResolver } from '../lib/intentResolver';
import type { AutoRule } from '../types';

describe('Search phrases', () => {
  test('amounts: above, below, ranges, thousands', () => {
    assert.equal(IntentResolver.resolve('payments > 500').minAmountCents, 50000);
    assert.equal(IntentResolver.resolve('payments < 19.99').maxAmountCents, 1999);
    assert.equal(IntentResolver.resolve('spending over 1,250.50').minAmountCents, 125050);
    assert.equal(IntentResolver.resolve('bills under 80').maxAmountCents, 8000);
    assert.deepEqual(
      (({ minAmountCents, maxAmountCents }) => ({ minAmountCents, maxAmountCents }))(IntentResolver.resolve('between 100 and 250.75')),
      { minAmountCents: 10000, maxAmountCents: 25075 });
    assert.equal(IntentResolver.resolve('deals above 5 thousand').minAmountCents, 500000);
    assert.equal(IntentResolver.resolve('around 40').minAmountCents, undefined, '"around" sets neither bound');
  });

  test('dates: a month and year, a year, an explicit range', () => {
    const march = IntentResolver.resolve('rent in march 2026');
    assert.deepEqual([march.startDate, march.endDate], ['2026-03-01', '2026-03-31']);
    const feb = IntentResolver.resolve('feb 2028');
    assert.deepEqual([feb.startDate, feb.endDate], ['2028-02-01', '2028-02-29'], 'leap year');
    const year = IntentResolver.resolve('everything 2025');
    assert.deepEqual([year.startDate, year.endDate], ['2025-01-01', '2025-12-31']);
    const range = IntentResolver.resolve('2026-01-05 to 2026-02-10');
    assert.deepEqual([range.startDate, range.endDate], ['2026-01-05', '2026-02-10']);
  });

  test('categories and projects by name or a word of the name; audit words', () => {
    const r = IntentResolver.resolve('advertising costs for apollo launch', ['Office', 'Advertising Spend'], ['Apollo Launch']);
    assert.equal(r.category, 'Advertising Spend');
    assert.equal(r.project, 'Apollo Launch');
    assert.equal(IntentResolver.resolve('show me unbalanced entries').isAuditQuery, true);
    assert.equal(IntentResolver.resolve('coffee').isAuditQuery, undefined);
  });
});

describe('Quick entries', () => {
  beforeEach(() => mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 31, 12) }));
  afterEach(() => mock.timers.reset());

  test('relative dates follow today', () => {
    const r = IntentResolver.resolve('this month');
    assert.deepEqual([r.startDate, r.endDate], ['2026-10-01', '2026-10-31']);
    const last = IntentResolver.resolve('last month');
    assert.deepEqual([last.startDate, last.endDate], ['2026-09-01', '2026-09-30']);
    assert.equal(IntentResolver.resolve('ytd').startDate, '2026-01-01');
    assert.equal(IntentResolver.resolve('last 7 days').startDate, '2026-10-24');
    assert.equal(IntentResolver.resolve('last 30 days').startDate, '2026-10-01');
  });

  test('amounts are whole cents; spending is negative, money received positive', () => {
    const [coffee] = IntentResolver.resolveEntry('spent 28.99 on coffee') || [];
    assert.equal(coffee.amountCents, -2899);
    assert.ok(Number.isInteger(coffee.amountCents));
    assert.equal(coffee.description, 'Coffee');
    assert.equal(coffee.date, '2026-10-31');
    const [sale] = IntentResolver.resolveEntry('received 1.5k from acme sale') || [];
    assert.equal(sale.amountCents, 150000);
    const [suffix] = IntentResolver.resolveEntry('hosting 0.29') || [];
    assert.equal(suffix.amountCents, -29);
    assert.equal(suffix.dimensions.category, 'Infrastructure');
  });

  test('a typed date stays in its month, even on the 31st', () => {
    const [entry] = IntentResolver.resolveEntry('paid 45 for uber 3rd feb') || [];
    assert.equal(entry.date, '2026-02-03');
    assert.equal(entry.dimensions.category, 'Travel');
    const [y] = IntentResolver.resolveEntry('spent 12 on lunch yesterday') || [];
    assert.equal(y.date, '2026-10-30');
  });

  test('splits: one total, a line per part, in whole cents', () => {
    const [split] = IntentResolver.resolveEntry('Walmart $100.10 ($40.05 groceries, $60.05 electronics)') || [];
    assert.equal(split.amountCents, -10010);
    assert.deepEqual(split.lines, [{ accountName: 'Groceries', amountCents: 4005 }, { accountName: 'Electronics', amountCents: 6005 }]);
  });

  test('rules, remembered descriptions and account names pick the category', () => {
    const rules = [{ id: 'r', uid: 'u', condition: { vendor: 'github' }, action: { targetCategory: 'Software' } } as AutoRule];
    const [byRule] = IntentResolver.resolveEntry('paid 7 github', { rules }) || [];
    assert.deepEqual([byRule.dimensions.category, byRule.isLearned], ['Software', true]);
    const [byCache] = IntentResolver.resolveEntry('spent 20 at corner deli', { ruleCache: { 'corner deli': { accountName: 'Meals' } } }) || [];
    assert.equal(byCache.dimensions.category, 'Meals');
    const [byAccount] = IntentResolver.resolveEntry('spent 300 on office supplies', { accounts: ['Office Supplies', { name: 'Rent' }] }) || [];
    assert.deepEqual([byAccount.dimensions.category, byAccount.isLearned], ['Office Supplies', false]);
    assert.equal(IntentResolver.resolveEntry('no amount here'), null);
    assert.equal(IntentResolver.resolveEntry('spent 5 on tea\n\nspent 6 on cake')?.length, 2);
  });
});

test('S8786: input with a line over 500 characters is left whole to the fallback parser', () => {
  const long = `bought ${'x'.repeat(560)} 40`;
  assert.equal(IntentResolver.resolveEntry(`tea 5\n${long}`), null);
  assert.ok(IntentResolver.resolveEntry('tea 5'));
});
