import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TopExpensesIncomeReportView from '../components/reporting/TopExpensesIncomeReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { accounts } from './helpers/reportLedger';

import { makeTransaction } from './fixtures';

const ledger = [makeTransaction({ id: 'rent', date: '2026-03-01', status: 'completed', description: 'Full-history rent',
  totalAmountCents: 200_000, lines: [{ accountId: 'rent', amountCents: 200_000 }, { accountId: 'bank', amountCents: -200_000 }] })];
const realFetch = globalThis.fetch;
beforeEach(() => {
  const ws = setComponentWorkspace();
  useDataNeedsStore.setState({ loadedWorkspaceId: ws.id, loaded: { accounts: true, transactions: true, bills: true }, failed: {} });
  useLedgerStore.setState({ accounts, transactions: ledger, bills: [], truncatedCollections: {} });
});
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

// The transaction list is whole; only its account (Rent) fell outside the chart cap.
// Removing that account from the local calculation silently removes the $2,000 top expense.
test('Top Line Items asks for the complete chart-backed ranking; a refusal is retryable but not exportable', async () => {
  useLedgerStore.setState({ accounts: accounts.filter(a => a.id !== 'rent'), truncatedCollections: { chartAccounts: true } });
  const requests: string[] = [];
  const responses: Array<(value: Response) => void> = [];
  globalThis.fetch = async input => {
    requests.push(String(input));
    return new Promise<Response>(resolve => responses.push(resolve));
  };
  render(<TopExpensesIncomeReportView selectedYear={2026} />);
  const url = '/api/v1/balances/top-lines?workspaceId=component-workspace&from=2026-01-01&to=2026-12-31&limit=25';
  await waitFor(() => assert.deepEqual(requests, [url]));
  const exportCsv = () => screen.queryByRole('button', { name: 'Export CSV' });
  assert.equal(exportCsv(), null, 'unverified ranking must not leave as a standalone CSV');
  await act(async () => responses[0](new Response('{}', { status: 503 })));
  assert.equal(exportCsv(), null);
  fireEvent.click(screen.getByRole('button', { name: 'Load the full report' }));
  await waitFor(() => assert.deepEqual(requests, [url, url]));
  await act(async () => responses[1](Response.json({
    topExpenses: [{ id: 'rent', description: 'Full-history rent', date: '2026-03-01', accountName: 'Rent', amountCents: 200_000 }], topIncome: [],
  })));
  assert.ok(screen.getByText('Full-history rent'));
  assert.ok(screen.getByText('$2,000.00'));
  assert.ok(exportCsv());
});
