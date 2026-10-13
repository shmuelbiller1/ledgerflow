import test from 'node:test';
import assert from 'node:assert/strict';
import { packSection, packReportUrl } from '../lib/reportPack';
import { computeProfitAndLoss, computeBalanceSheet, computeTrialBalance, computeCashFlow } from '../server/reports/computeReports';
import { makeChartAccount, makeTransaction } from './fixtures';
const accounts = [makeChartAccount({ id: 'cash', name: 'בנק Bank' }), makeChartAccount({ id: 'income', type: 'income', category: 'Revenue', name: 'מכירות Sales' })];
const transactions = [makeTransaction({ date: '2026-01-15', lines: [{ accountId: 'cash', amountCents: 12345 }, { accountId: 'income', amountCents: -12345 }] }), makeTransaction({ id: 'outside', date: '2026-02-01', lines: [{ accountId: 'cash', amountCents: 100 }, { accountId: 'income', amountCents: -100 }] })];
const start = '2026-01-01', end = '2026-01-31';
const names = Object.fromEntries(accounts.map(a => [a.id, a.name]));
test('pack totals equal the existing single statements with period boundaries and mixed Hebrew names', () => {
  const pl = computeProfitAndLoss(accounts, transactions, start, end);
  assert.equal(pl.netIncome, 12345);
  const profit = packSection('pl', pl, names);
  assert.equal(profit.rows.find(r => r.label === 'Net income')?.cents, pl.netIncome);
  assert.equal(profit.rows.find(r => r.label.includes('מכירות Sales'))?.cents, 12345);
  const bs = computeBalanceSheet(accounts, transactions, end);
  const balance = packSection('bs', bs, names);
  assert.equal(balance.rows.find(r => r.label === 'Total assets')?.cents, bs.totalAssets);
  assert.equal(balance.rows.at(-1)?.cents, bs.totalClaims);
  assert.ok(balance.rows.some(r => r.label.includes('בנק Bank')));
  const tb = computeTrialBalance(accounts, transactions, end);
  const trial = packSection('tb', tb, names);
  assert.equal(trial.rows.at(-2)?.cents, tb.totalDebit); assert.equal(trial.rows.at(-1)?.cents, tb.totalCredit);
  const cf = computeCashFlow(accounts, transactions, start, end);
  assert.equal(packSection('cf', cf, names).rows.at(-1)?.cents, cf.netChange);
});
test('current aging keeps the server buckets and exact total; never sends historical dates', () => {
  const data = { current: 100, '1-30': 200, '31-60': 300, '61-90': 400, '90+': 500, total: 1500 };
  for (const kind of ['ar', 'ap'] as const) {
    assert.deepEqual(packSection(kind, data, {}).rows.map(r => r.cents), [100, 200, 300, 400, 500, 1500]);
    const url = new URL(packReportUrl(kind, 'ws שלום', start, end), 'http://test');
    assert.equal(url.searchParams.get('workspaceId'), 'ws שלום'); assert.equal(url.searchParams.get('type'), kind);
    assert.equal(url.searchParams.has('endDate'), false); assert.equal(url.searchParams.has('startDate'), false);
  }
  assert.equal(new URL(packReportUrl('tb', 'ws', start, end), 'http://test').searchParams.get('asOfDate'), end);
});
test('incomplete or non-finite report payloads refuse printing rather than filling totals with zero', () => {
  assert.throws(() => packSection('ar', { total: 0 }, {}));
  assert.throws(() => packSection('pl', { ...computeProfitAndLoss([], []), netIncome: NaN }, {}));
  const bs = computeBalanceSheet([], []);
  assert.deepEqual(packSection('bs', { ...bs, isBalanced: false, orphanedLines: [{}] }, {}).warnings, ['The balance sheet is not balanced.', '1 posting lines reference missing accounts.']);
});
