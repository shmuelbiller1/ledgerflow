import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardPeriod, validDashboardPeriod, dashboardComparison, dashboardAging, dashboardLayout, DASHBOARD_WIDGETS } from '../lib/dashboardOverview';
import { reportStateFromParams, reportStateToParams } from '../lib/reportPermalink';
import { makeChartAccount, makeTransaction, makeInvoice, makeBill } from './fixtures';

test('dashboard periods use fiscal quarters, leap months and reject impossible/custom reversed dates', () => {
  assert.deepEqual(dashboardPeriod('year', '2024-02-29', 4), { startDate: '2023-04-01', endDate: '2024-03-31' });
  assert.deepEqual(dashboardPeriod('quarter', '2024-02-29', 4), { startDate: '2024-01-01', endDate: '2024-03-31' });
  assert.deepEqual(dashboardPeriod('month', '2024-02-29', 4), { startDate: '2024-02-01', endDate: '2024-02-29' });
  assert.equal(validDashboardPeriod({ startDate: '2023-02-29', endDate: '2023-03-01' }), false);
  assert.equal(validDashboardPeriod({ startDate: '2024-03-02', endDate: '2024-03-01' }), false);
  assert.equal(validDashboardPeriod({ startDate: '', endDate: '2024-03-01' }), false);
});
test('dashboard figures reuse posted base-currency statements, openings, COGS and calendar comparison', () => {
  const accounts = [makeChartAccount({ id: 'cash', openingBalanceCents: 1000 }), makeChartAccount({ id: 'income', type: 'income', category: 'Revenue' }), makeChartAccount({ id: 'expense', type: 'expense', category: 'Operating Expenses' }), makeChartAccount({ id: 'cogs', type: 'cost_of_goods', category: 'COGS' }), makeChartAccount({ id: 'equity', type: 'equity', category: 'Equity', openingBalanceCents: 1000 })];
  const tx = (id: string, date: string, amount: number, accountId: string, status: 'completed' | 'draft' = 'completed') => makeTransaction({ id, date, status, lines: [{ accountId: 'cash', amountCents: amount }, { accountId, amountCents: -amount }] });
  const foreign = { ...tx('fx', '2024-02-10', 500, 'income'), exchangeRate: 2, currency: 'EUR' };
  const transactions = [tx('jan', '2024-01-31', 2000, 'income'), tx('feb', '2024-02-29', 3000, 'income'), foreign, tx('expense', '2024-02-20', -400, 'expense'), tx('cogs', '2024-02-20', -200, 'cogs'), tx('draft', '2024-02-29', 9000, 'income', 'draft'), tx('future', '2024-03-01', 8000, 'income')];
  const result = dashboardComparison(accounts, transactions, { startDate: '2024-02-01', endDate: '2024-02-29' });
  // February income 3000 + (500 × 2), expenses 400 + 200, profit 3400.
  // Closing cash 1000 opening + 2000 January + 3400 February = 6400.
  assert.equal(result.current.revenue, 4000); assert.equal(result.current.expenses, 600); assert.equal(result.current.profit, 3400); assert.equal(result.current.cash, 6400); assert.equal(result.current.balanced, true); assert.deepEqual(result.current.summary.map(row => row.cents), [6400, 0, 1000, 4000, 600]);
  assert.deepEqual(result.previousPeriod, { startDate: '2024-01-01', endDate: '2024-01-31' });
  assert.equal(result.previous.revenue, 2000); assert.equal(result.previous.cash, 3000);
  assert.equal(result.months.length, 12); assert.equal(result.months[0].label, '2023-03'); assert.equal(result.months[11].cash, 6400); assert.equal(result.months[10].revenue, 2000);
});
test('aging widgets retain unknown parties, use remaining base amounts and exclude future/draft documents', () => {
  const result = dashboardAging([{ id: 'cust-1', name: 'לקוח Mixed' }], [makeInvoice({ date: '2024-01-01', dueDate: '2024-01-31', amountCents: 10000, amountPaidCents: 2000, exchangeRate: 2 }), makeInvoice({ id: 'unknown', customerId: 'missing', date: '2024-01-01', dueDate: '2023-12-01', amountCents: 700 }), makeInvoice({ id: 'future', date: '2024-03-01', amountCents: 9000 }), makeInvoice({ id: 'draft', date: '2024-01-01', status: 'draft', amountCents: 9000 })], 'customer', '2024-02-29');
  assert.equal(result.rows.find(row => row.partyId === 'cust-1')?.buckets.d1_30, 16000);
  assert.deepEqual(result.top.map(row => [row.partyName, row.overdue]), [['לקוח Mixed', 16000], ['missing', 700]]);
  const payable = dashboardAging([{ id: 'vend-1', name: 'ספק' }], [makeBill({ date: '2024-01-01', dueDate: '2024-02-29', amountCents: 500 })], 'vendor', '2024-02-29');
  assert.equal(payable.rows[0].buckets.current, 500); assert.equal(payable.top.length, 0);
});
test('personal dashboard layout refuses foreign IDs, duplicates and malformed preferences', () => {
  const result = dashboardLayout({ order: ['cash', 'cash', 'evil', 'profit'], hidden: ['cash', 'evil', 'cash'] });
  assert.deepEqual(result.order.slice(0, 2), ['cash', 'profit']); assert.equal(result.order.length, DASHBOARD_WIDGETS.length); assert.deepEqual(result.hidden, ['cash']);
  assert.deepEqual(dashboardLayout('bad'), dashboardLayout());
});
test('custom report links round-trip exact dates without accepting invalid ranges or retaining stale custom dates', () => {
  const defaults = { report: 'pnl', year: 2024, timeframe: 'month' as const, quarter: 0, month: 1, compare: 'none' as const };
  const state = { ...defaults, startDate: '2024-02-10', endDate: '2024-02-29' };
  assert.deepEqual(reportStateFromParams(reportStateToParams(state), defaults), state);
  assert.equal(reportStateFromParams(new URLSearchParams('start=2024-02-30&end=2024-03-01'), defaults).startDate, undefined);
  assert.equal(reportStateToParams(defaults, new URLSearchParams('start=2024-02-10&end=2024-02-29')).has('start'), false);
});
