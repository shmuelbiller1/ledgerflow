import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TopExpensesIncomeReportView from '../components/reporting/TopExpensesIncomeReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { setLoadedAccountReportWorkspace } from './helpers/componentFixtures';
import { accounts, ledger as workedBook } from './helpers/reportLedger';
import AverageMonthlyReportView from '../components/reporting/AverageMonthlyReportView';
import IncomeBySourceReportView from '../components/reporting/IncomeBySourceReportView';
import ExpenseByCategoryReportView from '../components/reporting/ExpenseByCategoryReportView';
import { useAuthStore } from '../stores/useAuthStore';
import { makeTransaction } from './fixtures';

const ledger = [makeTransaction({ id: 'rent', date: '2026-03-01', status: 'completed', description: 'Full-history rent',
  totalAmountCents: 200_000, lines: [{ accountId: 'rent', amountCents: 200_000 }, { accountId: 'bank', amountCents: -200_000 }] })];
const realFetch = globalThis.fetch;
beforeEach(() => {
  setLoadedAccountReportWorkspace();
  useLedgerStore.setState({ accounts, transactions: ledger, bills: [], isDataTruncated: false, truncatedCollections: {} });
});
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

// The transaction list is whole; only its account (Rent) fell outside the chart cap.
// Removing that account from the local calculation silently removes the $2,000 top expense.
test('Top Line Items asks for the complete chart-backed ranking; a refusal is retryable but not exportable', async () => {
  useLedgerStore.setState({ accounts: accounts.filter(a => a.id !== 'rent'), truncatedCollections: { chartAccounts: true } });
  const pending = holdRequests();
  const requests = () => pending.map(({ url }) => url.pathname + url.search);
  render(<TopExpensesIncomeReportView selectedYear={2026} />);
  const url = '/api/v1/balances/top-lines?workspaceId=component-workspace&from=2026-01-01&to=2026-12-31&limit=25';
  await waitFor(() => assert.deepEqual(requests(), [url]));
  const exportCsv = () => screen.queryByRole('button', { name: 'Export CSV' });
  assert.equal(exportCsv(), null, 'unverified ranking must not leave as a standalone CSV');
  await act(async () => pending[0].answer(new Response('{}', { status: 503 })));
  assert.equal(exportCsv(), null);
  fireEvent.click(screen.getByRole('button', { name: 'Load the full report' }));
  await waitFor(() => assert.deepEqual(requests(), [url, url]));
  await act(async () => pending[1].answer(Response.json({
    topExpenses: [{ id: 'rent', description: 'Full-history rent', date: '2026-03-01', accountName: 'Rent', amountCents: 200_000 }], topIncome: [],
  })));
  assert.ok(screen.getByText('Full-history rent'));
  assert.ok(screen.getByText('$2,000.00'));
  assert.ok(exportCsv());
});

const reports = [
  ['Top Line Items', TopExpensesIncomeReportView, 'No expenses in this period'],
  ['Income by Source', IncomeBySourceReportView, 'No income in this period'],
  ['Expense by Category', ExpenseByCategoryReportView, 'No posted expenses in this period'],
  ['Monthly Averages', AverageMonthlyReportView, 'No income or expenses in the loaded records for this year'],
] as const;

for (const [name, View, empty] of reports) {
  test(`${name}: loading, refused read, manual retry, and a genuinely empty period`, () => {
    useLedgerStore.setState({ transactions: [] });
    useDataNeedsStore.setState({ loaded: { accounts: true, bills: true } });
    render(<View selectedYear={2026} />);
    assert.ok(!screen.queryByText(empty), 'cannot declare no activity before a snapshot');
    assert.ok(screen.getByText('Loading report records…'));
    act(() => useDataNeedsStore.getState().markFailed('transactions', 'Unavailable'));
    assert.ok(!screen.queryByText(empty));
    assert.ok(!screen.queryByText('$0.00'));
    assert.ok(!screen.queryByRole('button', { name: 'Export CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    assert.ok(screen.getByText('Loading report records…'));
    act(() => useDataNeedsStore.getState().markLoaded('transactions'));
    assert.ok(screen.getByText(empty));
  });
  test(`${name}: previously loaded figures and CSV disappear if the live chart read fails`, () => {
    useLedgerStore.setState({ transactions: workedBook });
    render(<View selectedYear={2026} />);
    assert.ok(screen.getByRole('button', { name: 'Export CSV' }));
    act(() => useDataNeedsStore.getState().markFailed('accounts', 'Read refused'));
    assert.ok(!screen.queryByRole('button', { name: 'Export CSV' }), 'loaded=true is not enough after a read failure');
    assert.ok(screen.getByRole('button', { name: 'Try again' }));
    assert.ok(!screen.queryByRole('table'));
  });
}

test('a previous workspace snapshot is not a current result even when it has both loaded flags', () => {
  useLedgerStore.setState({ transactions: workedBook });
  render(<IncomeBySourceReportView selectedYear={2026} />);
  assert.ok(screen.getByText('Acme'));
  act(() => useAuthStore.setState({ currentWorkspaceId: 'second-workspace' }));
  assert.ok(!screen.queryByText('Acme'));
  assert.ok(!screen.queryByRole('button', { name: 'Export CSV' }));
  assert.ok(screen.getByText('Loading report records…'));
});

function holdRequests() {
  const pending: Array<{ url: URL; answer: (res: Response) => void; signal?: AbortSignal | null }> = [];
  globalThis.fetch = (input, init) => new Promise<Response>(answer => {
    pending.push({ url: new URL(String(input), 'https://fixture.invalid'), answer, signal: init?.signal });
  });
  return pending;
}

const answer = (description: string) => Response.json({ topExpenses: [
  { id: 'x', description, date: '2026-03-01', accountName: 'Rent', amountCents: 200_000 },
], topIncome: [] });

test('late reads cannot restore old figures after range, chart or workspace changes', async () => {
  const pending = holdRequests();
  useLedgerStore.setState({ truncatedCollections: { chartAccounts: true } });
  const { rerender } = render(<TopExpensesIncomeReportView selectedYear={2025} />);
  await waitFor(() => assert.equal(pending.length, 1));
  rerender(<TopExpensesIncomeReportView selectedYear={2026} />);
  await waitFor(() => assert.equal(pending.length, 2));
  assert.equal(pending[1].url.searchParams.get('from'), '2026-01-01');
  assert.ok(pending[0].signal?.aborted);
  await act(async () => pending[1].answer(answer('Current period')));
  await act(async () => pending[0].answer(answer('Wrong period')));
  assert.ok(screen.getByText('Current period'));
  assert.ok(!screen.queryByText('Wrong period'));
  act(() => useLedgerStore.setState({ accounts: accounts.map(a => a.id === 'rent' ? { ...a, name: 'Lease' } : a) }));
  await waitFor(() => assert.equal(pending.length, 3));
  assert.ok(!screen.queryByText('Current period'));
  act(() => useAuthStore.setState({ currentWorkspaceId: 'new-books' }));
  await act(async () => pending[2].answer(answer('Previous books')));
  assert.ok(!screen.queryByText('Previous books'));
  assert.ok(!screen.queryByRole('button', { name: 'Export CSV' }));
  act(() => useDataNeedsStore.setState({ loadedWorkspaceId: 'new-books', loaded: { accounts: true, transactions: true } }));
  await waitFor(() => assert.equal(pending.length, 4));
  assert.equal(pending[3].url.searchParams.get('workspaceId'), 'new-books');
  await act(async () => pending[3].answer(Response.json({ topExpenses: [], topIncome: [] })));
  assert.ok(screen.getByText('No expenses in this period'));
});

for (const [name, View] of reports) {
  test(`${name}: a full read in flight is not a failed read; a partial preview has no CSV`, async () => {
    const pending = holdRequests();
    useLedgerStore.setState({ transactions: workedBook, truncatedCollections: { chartAccounts: true } });
    render(<View selectedYear={2026} />);
    await waitFor(() => assert.equal(pending.length, 1));
    assert.ok(screen.getByText('Loading report records…'));
    assert.ok(!screen.queryByRole('button', { name: 'Load the full report' }));
    assert.ok(!screen.queryByRole('table'));
    await act(async () => pending[0].answer(new Response('{}', { status: 503 })));
    assert.ok(screen.getByRole('table'), 'nonempty preview is still available with its warning');
    assert.ok(screen.getByRole('button', { name: 'Load the full report' }));
    assert.ok(!screen.queryByRole('button', { name: 'Export CSV' }));
  });
}

test('a capped all-time view has no retry that cannot succeed; dates can load the full report', async () => {
  const pending = holdRequests();
  useLedgerStore.setState({ truncatedCollections: { chartAccounts: true } });
  const { rerender } = render(<TopExpensesIncomeReportView />);
  assert.ok(screen.getByText(/Only part of the history is loaded/));
  assert.ok(!screen.queryByRole('button', { name: 'Load the full report' }));
  assert.ok(!screen.queryByRole('button', { name: 'Export CSV' }));
  assert.equal(pending.length, 0);
  rerender(<TopExpensesIncomeReportView selectedYear={2026} />);
  await waitFor(() => assert.equal(pending.length, 1));
  await act(async () => pending[0].answer(answer('Full year')));
  assert.ok(screen.getByText('Full year'));
});

test('a failed bill list does not invalidate a complete posted-expense breakdown or its CSV', () => {
  useDataNeedsStore.getState().markFailed('bills', 'Unavailable');
  render(<ExpenseByCategoryReportView selectedYear={2026} />);
  assert.ok(screen.getByRole('button', { name: 'Try again' }));
  assert.ok(screen.getByRole('table', { name: 'Expenses by category' }));
  assert.ok(screen.getByRole('button', { name: 'Export CSV' }));
});

test('an unidentified cap is not a complete history; a named unrelated cap need not fetch', async () => {
  const pending = holdRequests();
  useLedgerStore.setState({ isDataTruncated: true, truncatedCollections: { bills: true } });
  render(<AverageMonthlyReportView selectedYear={2026} />);
  assert.ok(screen.getByRole('button', { name: 'Export CSV' }));
  assert.equal(pending.length, 0);
  act(() => useLedgerStore.setState({ truncatedCollections: {} }));
  await waitFor(() => assert.equal(pending.length, 1));
  assert.ok(!screen.queryByRole('button', { name: 'Export CSV' }));
  await act(async () => pending[0].answer(Response.json({})));
  assert.ok(screen.getByRole('button', { name: 'Load the full report' }), 'HTTP 200 without a report is a refusal, not zero');
});

test('a period refused as too long points to the period control, not the same invalid retry', async () => {
  const pending = holdRequests();
  useLedgerStore.setState({ truncatedCollections: { chartAccounts: true } });
  render(<TopExpensesIncomeReportView startDate="2020-01-01" endDate="2026-12-31" />);
  await waitFor(() => assert.equal(pending.length, 1));
  await act(async () => pending[0].answer(new Response('{}', { status: 400 })));
  assert.ok(screen.getByText(/Choose a shorter period/));
  assert.ok(!screen.queryByRole('button', { name: 'Load the full report' }));
  assert.ok(!screen.queryByRole('button', { name: 'Export CSV' }));
});
