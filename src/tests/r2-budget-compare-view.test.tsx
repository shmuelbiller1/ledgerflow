/**
 * R-2 on the screen: the profit & loss, with "Comparison" on and "Compare to: Budget", shows the budget beside the
 * actual figures. March 2026: Sales actual 10,000.00 against a 12,000.00 monthly budget; Rent actual 4,000.00
 * against 3,500.00. The comparison column is headed "Budget", and per-month columns say the budget is for the whole
 * period.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ProfitAndLossView from '../components/ledger/ProfitAndLossView';
import { makeChartAccount, makeTransaction } from './fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { formatCurrency } from '../lib/utils';
import type { Budget } from '../types';

const accounts = [
  makeChartAccount({ id: 'sales', code: '4000', name: 'Sales', type: 'income', category: 'Revenue', balanceCents: 0 }),
  makeChartAccount({ id: 'rent', code: '5000', name: 'Rent', type: 'expense', category: 'Expenses', balanceCents: 0 }),
  makeChartAccount({ id: 'cash', code: '1000', name: 'Bank', type: 'asset', category: 'Cash', balanceCents: 0 }),
];
const transactions = [
  makeTransaction({ id: 'sale', workspaceId: 'component-workspace', date: '2026-03-02', lines: [{ accountId: 'sales', amountCents: -1_000_000 }, { accountId: 'cash', amountCents: 1_000_000 }] }),
  makeTransaction({ id: 'rent', workspaceId: 'component-workspace', date: '2026-03-15', lines: [{ accountId: 'rent', amountCents: 400_000 }, { accountId: 'cash', amountCents: -400_000 }] }),
];
const budgets = [
  { id: 'b1', uid: 'u', targetId: 'sales', targetType: 'account', period: 'monthly', amountCents: 1_200_000, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'b2', uid: 'u', targetId: 'rent', targetType: 'account', period: 'monthly', amountCents: 350_000, createdAt: '2026-01-01T00:00:00Z' },
] as Budget[];

beforeEach(() => {
  globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
  markComponentCollectionsLoaded('transactions', 'accounts', 'journalEntries', 'invoices', 'bills', 'payments', 'recurring', 'projects', 'budgets');
  setComponentWorkspace('owner');
  useLedgerStore.setState({ transactions, accounts, budgets });
});
afterEach(() => { cleanup(); useLedgerStore.setState({ budgets: [] }); });

describe('R-2: the P&L compared to the budget', () => {
  test('the comparison column is the budget for the period', async () => {
    render(<ProfitAndLossView startDate="2026-03-01" endDate="2026-03-31" />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByLabelText('Comparative Mode')); });
    await act(async () => { fireEvent.change(screen.getByLabelText('Compare to'), { target: { value: 'budget' } }); });
    const table = screen.getByRole('region', { name: /period table/i });
    assert.ok(within(table).getByRole('columnheader', { name: 'Budget' }));
    const salesRow = within(table).getAllByRole('row').find(r => /Sales/.test(r.textContent || '') && /4000/.test(r.textContent || ''));
    assert.ok(salesRow, 'a Sales row');
    const text = salesRow!.textContent || '';
    assert.ok(text.includes(formatCurrency(1_000_000)), `actual 10,000.00 in ${text}`);
    assert.ok(text.includes(formatCurrency(1_200_000)), `budget 12,000.00 in ${text}`);
  });
});

describe('R-2: the KPI cards name what they compare to', () => {
  // income, expense and net cards each carry a labelled badge
  const badges = () => (document.body.textContent || '').match(/% vs (Budget|Prior)/g) || [];
  test('"vs Budget" on the cards when comparing to the budget', async () => {
    render(<ProfitAndLossView startDate="2026-03-01" endDate="2026-03-31" />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByLabelText('Comparative Mode')); });
    await act(async () => { fireEvent.change(screen.getByLabelText('Compare to'), { target: { value: 'budget' } }); });
    // actual 10,000 vs budget 12,000 income = -16.7%; 4,000 vs 3,500 rent = +14.3%
    assert.deepEqual(badges(), ['% vs Budget', '% vs Budget', '% vs Budget']);
    // net 6,000 vs budget 8,500 = -29.4%
    assert.match(document.body.textContent || '', /-29\.4% vs Budget/);
    assert.match(document.body.textContent || '', /-16\.7% vs Budget/);
    assert.match(document.body.textContent || '', /14\.3% vs Budget/);
  });
  test('"vs Prior" on the cards when comparing to the previous period', async () => {
    useLedgerStore.setState({ transactions: [...transactions,
      makeTransaction({ id: 'febsale', workspaceId: 'component-workspace', date: '2026-02-10', lines: [{ accountId: 'sales', amountCents: -800_000 }, { accountId: 'cash', amountCents: 800_000 }] }),
      makeTransaction({ id: 'febrent', workspaceId: 'component-workspace', date: '2026-02-15', lines: [{ accountId: 'rent', amountCents: 400_000 }, { accountId: 'cash', amountCents: -400_000 }] }),
    ] });
    render(<ProfitAndLossView startDate="2026-03-01" endDate="2026-03-31" />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByLabelText('Comparative Mode')); });
    // 10,000 vs February 8,000 income = +25.0%; rent 4,000 both months = 0.0%
    assert.deepEqual(badges(), ['% vs Prior', '% vs Prior', '% vs Prior']);
    // net 6,000 vs February 4,000 = +50.0%
    assert.match(document.body.textContent || '', /50\.0% vs Prior/);
    assert.match(document.body.textContent || '', /25\.0% vs Prior/);
  });
});
