/**
 * L-123 step 4d: "Expense Breakdown by Category" (ExpenseByCategoryReportView) reads the breakdown from the server
 * (GET /api/v1/balances/expense-by-category, src/hooks/useServerExpenseByCategory.ts) when the loaded list is capped
 * and the range reaches the oldest loaded day: a category can be set on one line, so per-account sums cannot give it.
 *
 * Hand-worked case (cents), year Y = this year. Accounts: Cash (asset), Sales (income), Rent and Fuel (expenses).
 *   E1 Y-01-05  Rent +900 (the line's own category "Office") / Cash −900
 *   E2 Y-01-12  Cash +1,500 / Sales −1,500
 *   E3 Y-02-03  Fuel +300 / Cash −300
 *   E4 Y-02-10  Rent +700 / Cash −700
 *   E5 Y-03-01  Cash +800 / Sales −800
 *   E6 Y-03-15  Fuel +200 / Cash −200
 *   E7 Y-04-02  Cash +300 / Fuel −300, a reversal of E3 (metadata.isReversal, reversesTxId E3)
 * Loaded (the newest four, capped): E4…E7; oldest loaded day Y-02-10.
 * Every entry, year Y: Office 900 (1 entry) · Rent 700 (1) · Fuel 300 + 200 − 300 = 200 (1: E3 and E7 cancel, so
 *   neither is counted); total 1,800, shares 50.0 % · 38.9 % · 11.1 %.
 * The loaded four alone: Rent 700 (1) · Fuel 200 − 300 = −100 (1: E6; E3 is not loaded), so the loaded total is
 *   wrong as well as short: 600.
 * Range Y-01-01…Y-03-31 on the server: E7 (April) is still read, so E3 is still left out of the count, but its −300 is
 *   outside the range: Office 900 (1) · Fuel 500 (1) · Rent 700 (1), total 2,100.
 *
 * L-123 step 4e: "Income by Source & Customer" (IncomeBySourceReportView, GET /api/v1/balances/income-by-source) in the
 * same way; a source is the entry's payee, else the line's description, else the account. E2's Sales line is described
 * "Acme". Every entry: Acme 1,500 (1) · Sales 800 (1), total 2,300, shares 65.2 % · 34.8 %. The loaded four alone:
 * Sales 800 (1) only — Acme is missing.
 */
import { stubFetch } from './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import { Y, from, to, chart, entries as ledger, loadedOf, balanceRouteHarness } from './helpers/l123RangeLedger';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { setComponentWorkspace } from './helpers/componentFixtures';
import ExpenseByCategoryReportView from '../components/reporting/ExpenseByCategoryReportView';
import IncomeBySourceReportView from '../components/reporting/IncomeBySourceReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { formatCurrency } from '../lib/utils';
import { computeExpenseByCategory, computeIncomeBySource, type CategoryExpenseBreakdown, type IncomeBySourceBreakdown } from '../lib/reportGenerators';
import { openingCutoff } from '../lib/serverBalances';
// E1's Rent line carries its own category; E2's Sales line is described "Acme"
const entries = (ws: string) => ledger(ws, (k, account) => {
  if (k === 0 && account === 'rent') return { category: 'Office' };
  return k === 1 && account === 'sales' ? { description: 'Acme' } : {};
});

const brief = (rows: CategoryExpenseBreakdown[]) => rows.map(r => `${r.category} ${r.totalAmountCents} ${r.transactionCount} ${r.percentage.toFixed(1)}`);
const TRUTH = ['Office 900 1 50.0', 'Rent 700 1 38.9', 'Fuel 200 1 11.1'];
const briefIncome = (rows: IncomeBySourceBreakdown[]) => rows.map(r => `${r.source} ${r.totalAmountCents} ${r.transactionCount} ${r.percentage.toFixed(1)}`);
const TRUTH_INCOME = ['Acme 1500 1 65.2', 'Sales 800 1 34.8'];

describe('L-123 step 4d: expense by category (no database)', () => {
  const ws = 'component-workspace';
  const all = entries(ws), loaded = loadedOf(all), accounts = chart(ws);
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('every entry gives the hand-worked breakdown; the loaded four do not', () => {
    assert.equal(openingCutoff(loaded), `${Y}-02-10`);
    assert.deepEqual(brief(computeExpenseByCategory(accounts, all, from, to)), TRUTH);
    assert.deepEqual(brief(computeExpenseByCategory(accounts, loaded, from, to)), ['Rent 700 1 116.7', 'Fuel -100 1 -16.7']);
    assert.deepEqual(briefIncome(computeIncomeBySource(accounts, all, from, to)), TRUTH_INCOME);
    assert.deepEqual(briefIncome(computeIncomeBySource(accounts, loaded, from, to)), ['Sales 800 1 100.0']);
  });

  test('a source or category named "__proto__" is an ordinary row and leaves Object.prototype alone (CodeRabbit on #496)', () => {
    const odd = ledger(ws, (k, account) => {
      if (k === 1 && account === 'sales') return { description: '__proto__' };
      return k === 0 && account === 'rent' ? { category: '__proto__' } : {};
    });
    assert.deepEqual(briefIncome(computeIncomeBySource(accounts, odd, from, to)), ['__proto__ 1500 1 65.2', 'Sales 800 1 34.8']);
    assert.deepEqual(brief(computeExpenseByCategory(accounts, odd, from, to)), ['__proto__ 900 1 50.0', 'Rent 700 1 38.9', 'Fuel 200 1 11.1']);
    assert.equal(({} as Record<string, unknown>).total, undefined);
    assert.equal(({} as Record<string, unknown>).count, undefined);
  });

  test('income by source on screen: no request when not capped; every entry\'s sources when capped; a note when it fails', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ accounts, transactions: loaded, truncatedCollections: {} } as never);
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      const q = new URL(String(input), 'http://x').searchParams;
      const sources = computeIncomeBySource(accounts, all, q.get('from')!, q.get('to')!);
      return new Response(JSON.stringify({ status: 'success', sources }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const table = () => document.querySelector('#income-by-source-report table')?.textContent || '';
    render(<IncomeBySourceReportView selectedYear={Y} />);
    assert.ok(table().includes(formatCurrency(800)) && !table().includes('Acme'));
    assert.equal(screen.queryByTestId('income-source-source'), null);
    assert.equal(urls.length, 0, 'not capped: no request');
    cleanup();

    useLedgerStore.setState({ truncatedCollections: { transactions: true } });
    render(<IncomeBySourceReportView selectedYear={Y} />);
    await waitFor(() => assert.ok(table().includes('Acme'), table()), { timeout: 5000 });
    assert.deepEqual(urls, [`/api/v1/balances/income-by-source?workspaceId=${ws}&from=${from}&to=${to}`]);
    assert.ok(document.body.textContent!.includes(formatCurrency(2300)), 'the header total is every entry\'s');
    assert.match(screen.getByTestId('income-source-source').textContent || '', /read from every entry on the server/);
    cleanup();

    stubFetch(500);
    render(<IncomeBySourceReportView selectedYear={Y} />);
    await waitFor(() => assert.match(screen.getByTestId('income-source-source').textContent || '', /loaded entries only/));
    assert.ok(!table().includes('Acme'));
  });

  test('screen: no request when not capped; the server\'s totals when capped; the loaded totals with a note when it fails', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ accounts, transactions: loaded, bills: [], truncatedCollections: {} } as never);
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      const q = new URL(String(input), 'http://x').searchParams;
      if (!String(input).includes('/expense-by-category')) return new Response('{}', { status: 404 });
      const categories = computeExpenseByCategory(accounts, all, q.get('from')!, q.get('to')!);
      return new Response(JSON.stringify({ status: 'success', categories }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const table = () => document.querySelector('#expense-by-category-report table')?.textContent || '';
    render(<ExpenseByCategoryReportView selectedYear={Y} />);
    assert.ok(table().includes(formatCurrency(700)));
    assert.ok(!table().includes('Office'));
    assert.equal(screen.queryByTestId('expense-category-source'), null);
    assert.equal(urls.filter(u => u.includes('/expense-by-category')).length, 0, 'not capped: no request');
    cleanup();

    useLedgerStore.setState({ truncatedCollections: { transactions: true } });
    render(<ExpenseByCategoryReportView selectedYear={Y} />);
    await waitFor(() => assert.ok(table().includes('Office'), table()), { timeout: 5000 });
    assert.ok(urls.includes(`/api/v1/balances/expense-by-category?workspaceId=${ws}&from=${from}&to=${to}`), urls.join('\n'));
    assert.ok(table().includes(formatCurrency(900)) && table().includes(formatCurrency(200)));
    assert.ok(document.body.textContent!.includes(formatCurrency(1800)), 'the header total is every entry\'s');
    assert.match(screen.getByTestId('expense-category-source').textContent || '', /read from every entry on the server/);
    // an account renamed in its category asks the server again (Codex on #495): Fuel's category becomes "Travel"
    const asked = urls.length;
    accounts[3] = { ...accounts[3], category: 'Travel' };
    useLedgerStore.setState({ accounts: [...accounts] });
    await waitFor(() => assert.ok(table().includes('Travel'), table()), { timeout: 5000 });
    assert.ok(urls.length > asked, 'the server is asked again');
    accounts[3] = { ...accounts[3], category: 'Fuel' };
    useLedgerStore.setState({ accounts: [...accounts] });
    await waitFor(() => assert.ok(table().includes('Fuel'), table()), { timeout: 5000 });
    cleanup();

    // only the chart of accounts capped, Fuel not loaded: the loaded entries alone would leave Fuel out, so the server is asked
    useLedgerStore.setState({ accounts: accounts.filter(a => a.name !== 'Fuel'), truncatedCollections: { chartAccounts: true } });
    const before = urls.length;
    render(<ExpenseByCategoryReportView selectedYear={Y} />);
    await waitFor(() => assert.ok(table().includes('Office'), table()), { timeout: 5000 });
    assert.ok(urls.length > before && urls.at(-1)!.includes('/expense-by-category'), 'a capped chart of accounts asks the server');
    cleanup();
    useLedgerStore.setState({ accounts, truncatedCollections: { transactions: true } });

    stubFetch(500);
    render(<ExpenseByCategoryReportView selectedYear={Y} />);
    await waitFor(() => assert.match(screen.getByTestId('expense-category-source').textContent || '', /loaded entries only/));
    assert.ok(!table().includes('Office'));
    assert.ok(table().includes(formatCurrency(700)));
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 4d: GET /api/v1/balances/expense-by-category', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const db = balanceRouteHarness(url, 'l123g', w => ({ accounts: chart(w), entries: entries(w) }));
  const ws = db.ws;
  const get = (q: Record<string, string>, uid?: string) => db.get<{ categories: CategoryExpenseBreakdown[]; entriesRead: number }>('expense-by-category', q, uid);
  before(() => db.start());
  after(() => db.stop());

  test('every entry of the range: the hand-worked breakdown, not the loaded four\'s; a reversal after the range counts; members only', async () => {
    const year = await get({ workspaceId: ws, from, to });
    assert.equal(year.status, 200);
    assert.equal(year.body.entriesRead, 7);
    assert.deepEqual(brief(year.body.categories), TRUTH);
    const q1 = await get({ workspaceId: ws, from, to: `${Y}-03-31` });
    assert.deepEqual(brief(q1.body.categories), ['Office 900 1 42.9', 'Rent 700 1 33.3', 'Fuel 500 1 23.8'], 'E7 (April) is outside the sums but still takes E3 out of the count');
    assert.equal(q1.body.entriesRead, 7);
    assert.equal((await get({ workspaceId: ws, from, to }, 'stranger')).status, 403);
    assert.equal((await get({ workspaceId: ws, from: to, to: from })).status, 400);
    assert.equal((await get({ workspaceId: ws, from: '2010-01-01', to })).status, 400, 'more than three years');
    assert.equal((await get({ workspaceId: 'ws_missing_l123g', from, to })).status, 404);
  });

  test('income by source: every entry\'s sources, members only', async () => {
    const getIncome = (q: Record<string, string>, uid?: string) => db.get<{ sources: IncomeBySourceBreakdown[]; entriesRead: number }>('income-by-source', q, uid);
    const year = await getIncome({ workspaceId: ws, from, to });
    assert.equal(year.status, 200);
    assert.deepEqual(briefIncome(year.body.sources), TRUTH_INCOME);
    assert.equal(year.body.entriesRead, 7);
    assert.equal((await getIncome({ workspaceId: ws, from, to }, 'stranger')).status, 403);
    assert.equal((await getIncome({ workspaceId: ws, from: to, to: from })).status, 400);
  });
});
