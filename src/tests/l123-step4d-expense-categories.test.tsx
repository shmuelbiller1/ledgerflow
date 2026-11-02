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
 */
import { stubFetch } from './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { setComponentWorkspace } from './helpers/componentFixtures';
import ExpenseByCategoryReportView from '../components/reporting/ExpenseByCategoryReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { formatCurrency, workspaceYearMonth } from '../lib/utils';
import { computeExpenseByCategory, type CategoryExpenseBreakdown } from '../lib/reportGenerators';
import { openingCutoff } from '../lib/serverBalances';
import type { ChartAccount, Transaction } from '../types';
import type { Firestore } from '../server/db/pgFirestore';

const Y = workspaceYearMonth().year;
const from = `${Y}-01-01`, to = `${Y}-12-31`;
const chart = (ws: string): ChartAccount[] => [
  { id: `${ws}_cash`, workspaceId: ws, uid: 'owner-1', code: '1000', name: 'Cash', type: 'asset', category: 'Cash' } as ChartAccount,
  { id: `${ws}_sales`, workspaceId: ws, uid: 'owner-1', code: '4000', name: 'Sales', type: 'income', category: 'Sales' } as ChartAccount,
  { id: `${ws}_rent`, workspaceId: ws, uid: 'owner-1', code: '6000', name: 'Rent', type: 'expense', category: 'Rent' } as ChartAccount,
  { id: `${ws}_fuel`, workspaceId: ws, uid: 'owner-1', code: '6100', name: 'Fuel', type: 'expense', category: 'Fuel' } as ChartAccount,
];
const LINES: Array<[string, Array<[string, number]>]> = [
  ['01-05', [['rent', 900], ['cash', -900]]],
  ['01-12', [['cash', 1500], ['sales', -1500]]],
  ['02-03', [['fuel', 300], ['cash', -300]]],
  ['02-10', [['rent', 700], ['cash', -700]]],
  ['03-01', [['cash', 800], ['sales', -800]]],
  ['03-15', [['fuel', 200], ['cash', -200]]],
  ['04-02', [['cash', 300], ['fuel', -300]]],
];
const entries = (ws: string): Transaction[] => LINES.map(([day, lines], k) => ({
  id: `${ws}_e${k + 1}`, workspaceId: ws, uid: 'owner-1', date: `${Y}-${day}`, description: `E${k + 1}`,
  totalAmountCents: Math.max(...lines.map(([, c]) => Math.abs(c))), currency: 'USD', status: 'completed', type: 'journal',
  ...(k === 6 ? { metadata: { isReversal: true, reversesTxId: `${ws}_e3` } } : {}),
  lines: lines.map(([a, amountCents]) => ({ accountId: `${ws}_${a}`, amountCents, ...(k === 0 && a === 'rent' ? { category: 'Office' } : {}) })),
}) as Transaction);
const loadedOf = (all: Transaction[]) => all.slice(3);
const brief = (rows: CategoryExpenseBreakdown[]) => rows.map(r => `${r.category} ${r.totalAmountCents} ${r.transactionCount} ${r.percentage.toFixed(1)}`);
const TRUTH = ['Office 900 1 50.0', 'Rent 700 1 38.9', 'Fuel 200 1 11.1'];

describe('L-123 step 4d: expense by category (no database)', () => {
  const ws = 'component-workspace';
  const all = entries(ws), loaded = loadedOf(all), accounts = chart(ws);
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('every entry gives the hand-worked breakdown; the loaded four do not', () => {
    assert.equal(openingCutoff(loaded), `${Y}-02-10`);
    assert.deepEqual(brief(computeExpenseByCategory(accounts, all, from, to)), TRUTH);
    assert.deepEqual(brief(computeExpenseByCategory(accounts, loaded, from, to)), ['Rent 700 1 116.7', 'Fuel -100 1 -16.7']);
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
    cleanup();

    stubFetch(500);
    render(<ExpenseByCategoryReportView selectedYear={Y} />);
    await waitFor(() => assert.match(screen.getByTestId('expense-category-source').textContent || '', /loaded entries only/));
    assert.ok(!table().includes('Office'));
    assert.ok(table().includes(formatCurrency(700)));
  });
});

const url = process.env.LF_TEST_DATABASE_URL;
const OWNER = 'owner-1';

describe('L-123 step 4d: GET /api/v1/balances/expense-by-category', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  let db: Firestore;
  let server: Server;
  let base = '';
  const realFetch = globalThis.fetch;
  const ws = `ws_l123g_${crypto.randomBytes(4).toString('hex')}`;
  const get = async (q: Record<string, string>, uid = OWNER) => {
    const res = await realFetch(`${base}/api/v1/balances/expense-by-category?${new URLSearchParams(q)}`, { headers: { 'x-test-uid': uid } });
    return { status: res.status, body: await res.json() as { categories: CategoryExpenseBreakdown[]; entriesRead: number } };
  };

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    const app = express();
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/balances', (await import('../server/routes/balanceRoutes')).balanceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: 'L-123 step 4d', currency: 'USD', timezone: 'UTC', members: [OWNER] });
    await db.pool.query(`insert into public."chartAccounts" (id, data) select a->>'id', a from jsonb_array_elements($1::jsonb) a`, [JSON.stringify(chart(ws))]);
    await db.pool.query(`insert into public.transactions (id, data) select t->>'id', t from jsonb_array_elements($1::jsonb) t`, [JSON.stringify(entries(ws))]);
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'chartAccounts', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
    const { getSupabase } = await import('../lib/db/client');
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
    await db.terminate();
  });

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
});
