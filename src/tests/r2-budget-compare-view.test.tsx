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
    assert.match(salesRow!.textContent || '', new RegExp(formatCurrency(1_000_000).replace(/[.$]/g, '\\$&')));
    assert.match(salesRow!.textContent || '', new RegExp(formatCurrency(1_200_000).replace(/[.$]/g, '\\$&')));
  });
});
