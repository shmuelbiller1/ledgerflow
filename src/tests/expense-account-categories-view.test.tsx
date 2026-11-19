import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ExpenseBillCategories from '../components/reporting/ExpenseBillCategories';
import ExpenseByCategoryReportView from '../components/reporting/ExpenseByCategoryReportView';
import { makeBill, makeChartAccount } from './fixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { setComponentWorkspace } from './helpers/componentFixtures';

const originalAuth = useAuthStore.getState();
const originalLedger = useLedgerStore.getState();
const originalNeeds = useDataNeedsStore.getState();
afterEach(() => {
  cleanup();
  useLedgerStore.setState(originalLedger, true);
  useAuthStore.setState(originalAuth, true);
  useDataNeedsStore.setState(originalNeeds, true);
});

const accounts = [
  makeChartAccount({ id: 'a1', workspaceId: 'component-workspace', name: 'Office supplies', code: '6100', type: 'expense' }),
  makeChartAccount({ id: 'a2', workspaceId: 'component-workspace', name: 'Postage', code: '6200', type: 'expense' }),
];
const bills = [
  makeBill({ id: 'b1', workspaceId: 'component-workspace', number: 'ABC-1', vendorName: 'Office Supplier', date: '2026-04-02',
    splits: [{ accountId: 'a1', amountCents: 3000 }, { accountId: 'a2', amountCents: 2000 }] }),
  makeBill({ id: 'b2', workspaceId: 'component-workspace', number: 'ABC-2', vendorName: 'Paper Shop', date: '2026-04-04',
    splits: [{ accountId: 'a1', amountCents: 9000 }] }),
  makeBill({ id: 'b3', workspaceId: 'component-workspace', number: 'UNC-3', vendorName: 'Unassigned Shop', date: '2026-04-05' }),
];

test('E-22 categories can filter bill list and expose original document amounts without modifying source', () => {
  render(<ExpenseBillCategories accounts={accounts} bills={bills} workspaceId="component-workspace"
    currency="USD" startDate="2026-01-01" endDate="2026-12-31" loading={false} incomplete={false} />);
  assert.ok(screen.getByText('Matching bills (3)'));
  fireEvent.click(screen.getByRole('button', { name: 'Show category list (2)' }));
  assert.ok(screen.getByText('Account number'));
  assert.ok(screen.getByText('6100'));
  fireEvent.change(screen.getByLabelText('Filter bills by expense category'), { target: { value: 'a2' } });
  assert.ok(screen.getByText('Matching bills (1)'));
  assert.ok(screen.getByText('ABC-1'));
  assert.equal(screen.queryByText('ABC-2'), null);
  fireEvent.change(screen.getByLabelText('Filter bills by expense category'), { target: { value: '__no_expense_account__' } });
  assert.ok(screen.getByText('Matching bills (1)'));
  assert.ok(screen.getByText('UNC-3'));
  assert.equal(screen.queryByText('ABC-1'), null);
});

test('E-22 category panel states when browser history is incomplete', () => {
  render(<ExpenseBillCategories accounts={accounts} bills={[]} workspaceId="component-workspace" currency="USD"
    loading incomplete />);
  assert.match(screen.getByRole('status').textContent || '', /may be incomplete/);
  assert.ok(screen.getByText('Loading bill records…'));
});

test('E-22 filter is reachable on the existing Expenses by Category report screen', () => {
  setComponentWorkspace();
  useLedgerStore.setState({ accounts, bills, transactions: [] });
  useDataNeedsStore.setState({ loaded: { accounts: true, bills: true }, loadedWorkspaceId: 'component-workspace', failed: {} });
  render(<ExpenseByCategoryReportView selectedYear={2026} />);
  assert.ok(screen.getByLabelText('Expense account categories and bills'));
  fireEvent.change(screen.getByLabelText('Filter bills by expense category'), { target: { value: 'a2' } });
  assert.ok(screen.getByText('Matching bills (1)'));
  assert.ok(screen.getByText('ABC-1'));
});
