/**
 * R-7 on the two statements: with a comparison on, the profit & loss offers "Why did net profit
 * change?" and the balance sheet offers "What moved" beside each section total — and each opens the
 * accounts behind the difference, worked out from the figures already on the screen.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ProfitAndLossView from '../components/ledger/ProfitAndLossView';
import BalanceSheetView from '../components/ledger/BalanceSheetView';
import { makeChartAccount, makeTransaction } from './fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';

const accounts = [
  makeChartAccount({ id: 'income-a', code: '4000', name: 'Sales', type: 'income', category: 'Revenue' }),
  makeChartAccount({ id: 'expense-a', code: '5000', name: 'Rent', type: 'expense', category: 'Expenses' }),
  makeChartAccount({ id: 'cash', code: '1000', name: 'Bank', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'payable', code: '2000', name: 'Supplier', type: 'liability', category: 'Payables' }),
];
const transactions = [
  // March: 1,000 income, 300 rent
  makeTransaction({ id: 'm-sale', workspaceId: 'component-workspace', date: '2026-03-02', lines: [{ accountId: 'income-a', amountCents: -100_000 }, { accountId: 'cash', amountCents: 100_000 }] }),
  makeTransaction({ id: 'm-rent', workspaceId: 'component-workspace', date: '2026-03-15', lines: [{ accountId: 'expense-a', amountCents: 30_000 }, { accountId: 'cash', amountCents: -30_000 }] }),
  // February: 600 income, 100 rent
  makeTransaction({ id: 'f-sale', workspaceId: 'component-workspace', date: '2026-02-02', lines: [{ accountId: 'income-a', amountCents: -60_000 }, { accountId: 'cash', amountCents: 60_000 }] }),
  makeTransaction({ id: 'f-rent', workspaceId: 'component-workspace', date: '2026-02-15', lines: [{ accountId: 'expense-a', amountCents: 10_000 }, { accountId: 'cash', amountCents: -10_000 }] }),
  // a bill in March raises the payable: the balance sheet movement
  makeTransaction({ id: 'm-bill', workspaceId: 'component-workspace', date: '2026-03-20', lines: [{ accountId: 'expense-a', amountCents: 5_000 }, { accountId: 'payable', amountCents: -5_000 }] }),
];

beforeEach(() => {
  globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
  markComponentCollectionsLoaded('transactions', 'accounts', 'journalEntries', 'invoices', 'bills', 'payments', 'recurring', 'projects', 'budgets');
  setComponentWorkspace('owner');
  useLedgerStore.setState({ transactions, accounts });
});
afterEach(() => cleanup());

describe('the profit & loss offers the change', () => {
  test('the button appears with a previous-period comparison and opens the accounts behind the move', async () => {
    render(<ProfitAndLossView startDate="2026-03-01" endDate="2026-03-31" compareStartDate="2026-02-01" compareEndDate="2026-02-28" />);
    await act(async () => {});
    const button = await screen.findByRole('button', { name: 'Why did net profit change?' });
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    await act(async () => { fireEvent.click(button); });
    const panel = document.querySelector('[data-statement-change-panel]');
    assert.ok(panel, 'the panel is on screen');
    const text = panel!.textContent || '';
    // net profit: March 1,000 − 300 = 700; February 600 − 100 = 500; change +200
    assert.match(text, /Sales/);
    assert.match(text, /Rent/);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    // the biggest share first: income moved +400 against the rent's −200
    const table = screen.getByRole('table', { name: /Accounts behind the change/i });
    const names = Array.from(table.querySelectorAll('tbody tr th')).map(cell => (cell.textContent || '').trim());
    assert.equal(names.length, 2);
    assert.match(names[0], /Sales/);
    assert.match(names[1], /Rent/);
  });

  test('without a comparison there is nothing to explain, so no button is offered', async () => {
    render(<ProfitAndLossView startDate="2026-03-01" endDate="2026-03-31" />);
    await act(async () => {});
    assert.equal(screen.queryByRole('button', { name: 'Why did net profit change?' }), null);
  });
});

describe('the balance sheet offers what moved', () => {
  test('each section total opens the accounts behind its movement between the two dates', async () => {
    render(<BalanceSheetView accounts={accounts} formatCurrency={c => `$${(c / 100).toFixed(2)}`} asOfDate="2026-03-31" compareEndDate="2026-02-28" />);
    await act(async () => {});
    const assetsButton = await screen.findByRole('button', { name: 'What moved in total assets' });
    await act(async () => { fireEvent.click(assetsButton); });
    const panel = document.querySelector('[data-statement-change-panel]');
    assert.ok(panel, 'the panel is on screen');
    // Bank: 60,000 − 10,000 in February leaves 50,000; March adds 100,000 − 30,000 − 5,000 = 65,000
    // so the movement is +65,000 — one row, the bank account
    assert.match(panel!.textContent || '', /Bank/);
    assert.equal(screen.getByRole('button', { name: 'What moved in total assets' }).getAttribute('aria-expanded'), 'true');
  });

  test('the liabilities total offers the same, and names the payable that moved', async () => {
    render(<BalanceSheetView accounts={accounts} formatCurrency={c => String(c)} asOfDate="2026-03-31" compareEndDate="2026-02-28" />);
    await act(async () => {});
    const liabilitiesButton = await screen.findByRole('button', { name: 'What moved in total liabilities' });
    await act(async () => { fireEvent.click(liabilitiesButton); });
    const panel = document.querySelector('[data-statement-change-panel]');
    assert.ok(panel);
    assert.match(panel!.textContent || '', /Supplier/);
  });
});
