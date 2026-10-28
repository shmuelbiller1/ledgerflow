/**
 * Profit by label (CB-25): each value of a label, and the lines without one, with the profit and loss
 * calculated per value; the columns add back to the profit and loss of the period; lines are read the
 * way the drill-down's label filter reads them; the screen asks the server and opens the entries
 * behind a figure with the label in the request.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { profitByLabel } from '../server/reports/byLabel';
import { computeProfitAndLoss } from '../server/reports/computeReports';
import LabelProfitReportView from '../components/reporting/LabelProfitReportView';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount } from './fixtures';
import { getSupabase } from '../lib/db/client';
import type { Transaction } from '../types';

const accounts = [
  makeChartAccount({ id: 'cash', name: 'Cash', type: 'asset' }),
  makeChartAccount({ id: 'rent-in', name: 'Rent received', type: 'income', code: '4000' }),
  makeChartAccount({ id: 'repairs', name: 'Repairs', type: 'expense', code: '6100' }),
  makeChartAccount({ id: 'fees', name: 'Bank fees', type: 'expense', code: '6900' }),
];
const tx = (id: string, date: string, lines: Transaction['lines'], extra: Partial<Transaction> = {}) => ({ id, workspaceId: 'w', date, description: id, status: 'completed', type: 'actual', lines, ...extra }) as Transaction;
const transactions: Transaction[] = [
  // one rent payment for two properties, split by line
  tx('rent', '2026-03-01', [{ accountId: 'cash', amountCents: 300000 }, { accountId: 'rent-in', amountCents: -200000, dimensions: { property: 'P5' } }, { accountId: 'rent-in', amountCents: -100000, dimensions: { property: 'P6' } }] as never),
  // a repair labelled on the entry
  tx('repair', '2026-03-05', [{ accountId: 'repairs', amountCents: 45000 }, { accountId: 'cash', amountCents: -45000 }] as never, { dimensions: { property: 'P6' } } as never),
  // a bank fee with no label
  tx('fee', '2026-03-09', [{ accountId: 'fees', amountCents: 1500 }, { accountId: 'cash', amountCents: -1500 }] as never),
  tx('outside', '2026-05-01', [{ accountId: 'fees', amountCents: 999 }, { accountId: 'cash', amountCents: -999 }] as never),
  tx('draft', '2026-03-10', [{ accountId: 'repairs', amountCents: 7777, dimensions: { property: 'P5' } }, { accountId: 'cash', amountCents: -7777 }] as never, { status: 'draft' } as never),
];

describe('Profit by label', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('each value and the unassigned lines, adding back to the profit and loss of the period', () => {
    const r = profitByLabel(accounts, transactions, 'property', '2026-03-01', '2026-03-31');
    assert.deepEqual(r.columns.map(c => [c.value, c.income, c.expense, c.netIncome, c.accounts]), [
      ['P5', 200000, 0, 200000, { 'rent-in': 200000 }],
      ['P6', 100000, 45000, 55000, { 'rent-in': 100000, repairs: 45000 }],
      ['Unassigned', 0, 1500, -1500, { fees: 1500 }],
    ], 'the draft and the entry outside the period are left out');
    const pl = computeProfitAndLoss(accounts, transactions, '2026-03-01', '2026-03-31');
    assert.deepEqual([r.total.income, r.total.expense, r.total.netIncome], [pl.income.total, pl.expense.total, pl.netIncome]);
    for (const k of ['income', 'cogs', 'expense', 'netIncome'] as const) assert.equal(r.columns.reduce((s, c) => s + c[k], 0), r.total[k], k);
    assert.deepEqual(r.rows.map(x => [x.section, x.code, x.name]), [['income', '4000', 'Rent received'], ['expense', '6100', 'Repairs'], ['expense', '6900', 'Bank fees']]);
    assert.deepEqual(profitByLabel(accounts, transactions, 'property', '2027-01-01', '2027-12-31').columns, []);
  });

  test('on screen: a label and a period are asked for; a figure opens its entries for that value', async () => {
    const ws = setComponentWorkspace('owner');
    useAuthStore.setState({ workspaces: [{ ...ws, currency: 'USD', dimensions: [{ id: 'property', name: 'Property' }] }] });
    useLedgerStore.setState({ dimensionNodes: [{ id: 'P5', dimensionId: 'property', description: 'Property 5' }] as never });
    const report = profitByLabel(accounts, transactions, 'property', '2026-03-01', '2026-03-31');
    const asked: string[] = [];
    let explainBody: { accountIds?: string[]; labelDimension?: string; labelValue?: string } = {};
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      asked.push(url);
      if (url.startsWith('/api/v1/reports/explain') && typeof init?.body === 'string') explainBody = JSON.parse(init.body);
      const body = url.startsWith('/api/v1/reports/explain') ? { lines: [], totalCents: -200000, entries: 1 } : report;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    render(<LabelProfitReportView />);
    await waitFor(() => assert.ok(screen.getByRole('columnheader', { name: 'Property 5' })));
    const first = new URLSearchParams(asked[0].split('?')[1]);
    assert.equal(first.get('dimensionId'), 'property');
    assert.ok(screen.getByRole('columnheader', { name: 'Unassigned' }));
    assert.match(screen.getByRole('rowheader', { name: 'Net income' }).parentElement!.textContent || '', /\$2,000\.00\$550\.00-\$15\.00\$2,535\.00/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Rent received for Property 5: open the entries/ })); });
    await waitFor(() => assert.ok(asked.some(u => u.startsWith('/api/v1/reports/explain'))));
    assert.deepEqual([explainBody.accountIds, explainBody.labelDimension, explainBody.labelValue], [['rent-in'], 'property', 'P5']);
  });

  test('no labels yet: says where to add one, and asks nothing', async () => {
    const ws = setComponentWorkspace('owner');
    useAuthStore.setState({ workspaces: [{ ...ws, dimensions: [] }] });
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => { asked.push(String(input)); return new Response('{}'); }) as typeof fetch;
    render(<LabelProfitReportView />);
    assert.ok(screen.getByText(/No labels yet/));
    assert.equal(asked.filter(u => u.includes('by-label')).length, 0);
  });
});
