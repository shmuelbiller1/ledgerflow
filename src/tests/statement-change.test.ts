/**
 * R-7: "Why did this number change?" — worked by hand, not by copying the code.
 *
 * The figures below are one month against the month before, in cents, in the statement's own sign
 * (income positive because it is a credit the report shows as positive). Every expected number was
 * added up on paper:
 *
 *   income   Sales    1,000,000 → 1,200,000   +200,000  (+200,000 net profit)
 *            Services   200,000 →   150,000    −50,000   (−50,000)
 *   cogs     Materials  300,000 →   400,000   +100,000  (−100,000)
 *   expense  Rent       100,000 →   100,000          0   (not listed)
 *            Wages      250,000 →   200,000    −50,000   (+50,000)
 *   ------------------------------------------------------------------
 *   net profit         550,000 →   650,000   +100,000  (+100,000)
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountValues,
  buildStatementChange,
  changePercent,
  movementWindow,
  type StatementSides,
} from '../lib/statementChange';

const current: StatementSides = {
  income: {
    sales: { name: 'Sales', code: '4000', balance: 1_200_000 },
    services: { name: 'Services', code: '4100', balance: 150_000 },
  },
  cogs: { materials: { name: 'Materials', code: '5000', balance: 400_000 } },
  expense: {
    rent: { name: 'Rent', code: '6000', balance: 100_000 },
    wages: { name: 'Wages', code: '6100', balance: 200_000 },
  },
};

const prior: StatementSides = {
  income: {
    sales: { name: 'Sales', code: '4000', balance: 1_000_000 },
    services: { name: 'Services', code: '4100', balance: 200_000 },
  },
  cogs: { materials: { name: 'Materials', code: '5000', balance: 300_000 } },
  expense: {
    rent: { name: 'Rent', code: '6000', balance: 100_000 },
    wages: { name: 'Wages', code: '6100', balance: 250_000 },
  },
};

const netProfitSigns = { income: 1 as const, cogs: -1 as const, expense: -1 as const };

describe('the accounts behind a change in net profit', () => {
  const change = buildStatementChange(current, prior, { signs: netProfitSigns });

  test('the three figures are the statement’s own, and the change is one minus the other', () => {
    assert.equal(change.currentTotalCents, 650_000);
    assert.equal(change.priorTotalCents, 550_000);
    assert.equal(change.changeCents, 100_000);
  });

  test('income raises net profit, cost of goods and expenses lower it', () => {
    const byId = Object.fromEntries(change.rows.map(row => [row.accountId, row]));
    assert.deepEqual(
      [byId.sales.changeCents, byId.sales.effectCents],
      [200_000, 200_000],
    );
    assert.deepEqual(
      [byId.services.changeCents, byId.services.effectCents],
      [-50_000, -50_000],
    );
    // a cost that rose 100,000 takes 100,000 off net profit
    assert.deepEqual(
      [byId.materials.changeCents, byId.materials.effectCents],
      [100_000, -100_000],
    );
    // an expense that fell 50,000 adds 50,000 back
    assert.deepEqual(
      [byId.wages.changeCents, byId.wages.effectCents],
      [-50_000, 50_000],
    );
  });

  test('the parts add up to the whole: every effect sums to the change', () => {
    const sum = change.rows.reduce((total, row) => total + row.effectCents, 0);
    assert.equal(sum, 100_000);
    assert.equal(sum, change.changeCents);
  });

  test('the biggest share is first, and a tie is broken the same way every run', () => {
    assert.deepEqual(change.rows.map(row => row.accountId), ['sales', 'materials', 'services', 'wages']);
  });

  test('an account that did not move is counted, not listed', () => {
    assert.equal(change.unchangedCount, 1);
    assert.equal(change.rows.some(row => row.accountId === 'rent'), false);
  });

  test('an account that only existed before is compared with nothing, and counted', () => {
    const withClosed = buildStatementChange(
      current,
      { ...prior, income: { ...prior.income, closed: { name: 'Closed line', code: '4200', balance: 60_000 } } },
      { signs: netProfitSigns },
    );
    const closed = withClosed.rows.find(row => row.accountId === 'closed');
    assert.ok(closed);
    assert.deepEqual([closed.currentCents, closed.priorCents, closed.changeCents], [0, 60_000, -60_000]);
    // prior net profit was 610,000 (income 1,260,000 − 400,000... see the table above with the extra
    // line): current 650,000, so the change is 40,000 and the closed line is 60,000 of it
    assert.equal(withClosed.changeCents, 40_000);
    assert.equal(withClosed.rows.reduce((total, row) => total + row.effectCents, 0), 40_000);
  });

  test('a section with no sign is counted but does not move this figure', () => {
    const balanceOnly = buildStatementChange(
      { assets: { bank: { name: 'Bank', balance: 900_000 } }, income: current.income },
      { assets: { bank: { name: 'Bank', balance: 400_000 } }, income: prior.income },
      { signs: { income: 1 } },
    );
    assert.equal(balanceOnly.rows.some(row => row.accountId === 'bank'), false);
    assert.equal(balanceOnly.unchangedCount, 1); // Bank: it changed, but assets do not count toward this figure
    assert.equal(balanceOnly.changeCents, 150_000); // income only: 1,350,000 − 1,200,000
  });

  test('a figure that did not move has no rows, and says so through the count', () => {
    const same = buildStatementChange(current, current, { signs: netProfitSigns });
    assert.deepEqual(same.rows, []);
    assert.equal(same.changeCents, 0);
    assert.equal(same.unchangedCount, 5);
  });

  test('a fraction of a cent is rounded, never carried as one', () => {
    const fractional = buildStatementChange(
      { expense: { odd: { name: 'Odd', balance: 100.6 } } },
      { expense: { odd: { name: 'Odd', balance: 99.4 } } },
      { signs: { expense: -1 } },
    );
    assert.deepEqual(
      [fractional.rows[0].currentCents, fractional.rows[0].priorCents, fractional.rows[0].changeCents],
      [101, 99, 2],
    );
    assert.equal(fractional.rows[0].effectCents, -2);
  });
});

describe('a change as a percentage', () => {
  test('is taken against the size of the figure it is compared with', () => {
    assert.equal(changePercent(500, 1_000), 50);
    assert.equal(changePercent(-250, -1_000), -25);
  });

  test('is undefined against zero, not 100%', () => {
    assert.equal(changePercent(500, 0), null);
  });
});

describe('the days whose entries are a balance sheet movement', () => {
  test('run from the day after the compared date through the later date', () => {
    assert.deepEqual(movementWindow('2025-12-31', '2026-03-31'), { start: '2026-01-01', end: '2026-03-31' });
  });

  test('follow the calendar: a leap day is a day', () => {
    assert.deepEqual(movementWindow('2024-02-28', '2024-03-01'), { start: '2024-02-29', end: '2024-03-01' });
    assert.deepEqual(movementWindow('2025-02-28', '2025-03-01'), { start: '2025-03-01', end: '2025-03-01' });
  });

  test('are not invented when the two dates are the same or in the wrong order', () => {
    assert.equal(movementWindow('2026-03-31', '2026-03-31'), null);
    assert.equal(movementWindow('2026-04-30', '2026-03-31'), null);
    assert.equal(movementWindow('', '2026-03-31'), null);
  });
});

describe('the accounts a statement section holds', () => {
  const chart = [
    { id: 'bank', name: 'Bank', code: '1000', type: 'asset' },
    { id: 'rent', name: 'Rent', code: '6000', type: 'expense' },
    { id: 'unused', name: 'Spare account', type: 'asset' },
  ];

  test('come from the chart’s own names and codes, with the report’s balances', () => {
    const values = accountValues(chart, { bank: 250_000 }, 'asset');
    assert.deepEqual(values.bank, { name: 'Bank', code: '1000', balance: 250_000 });
  });

  test('keep an account that has no balance, so "unchanged" is honest', () => {
    const values = accountValues(chart, {}, 'asset');
    assert.deepEqual(Object.keys(values).sort(), ['bank', 'unused']);
    assert.equal(values.unused.balance, 0);
  });

  test('only include their own section', () => {
    assert.equal(Object.prototype.hasOwnProperty.call(accountValues(chart, {}, 'asset'), 'rent'), false);
  });
});
