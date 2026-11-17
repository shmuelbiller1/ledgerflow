import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translate } from '../server/reports/groupReport';

// A7N-10 (Agent #7, #760): a member's figures are minor units of its own currency, while rates are quoted per major
// unit, so translating a yen or dinar member must shift by the currencies' decimals.
const figures = {
  income: 1_000_000, cogs: 0, grossProfit: 1_000_000, expense: 0, netIncome: 1_000_000,
  totalAssets: 1_000_000, totalLiabilities: 0, totalEquity: 1_000_000, equityAccounts: 0, earlierProfit: 0,
};
const at = (rate: number) => ({ closing: rate, average: rate, historical: rate });

test('a yen member into a dollar report: ¥1,000,000 at 0.0067 is $6,700.00', () => {
  const r = translate(figures, at(0.0067), 'JPY', 'USD');
  assert.equal(r.netIncome, 670_000);
  assert.equal(r.totalAssets, 670_000);
});

test('a dinar member (3 decimals): KWD 1,000.000 at 3.25 is $3,250.00', () => {
  assert.equal(translate(figures, at(3.25), 'KWD', 'USD').netIncome, 325_000);
});

test('the same currency is unchanged', () => {
  assert.equal(translate(figures, at(1), 'USD', 'USD').netIncome, 1_000_000);
});
