import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DashboardWidgets from '../components/dashboard/DashboardWidgets';
import Reports from '../components/reporting/Reports';
import TransactionEditModal from '../components/transactions/TransactionEditModal';
import { createEntryActions } from '../hooks/transactionActions/entryActions';
import { exportPlToExcel } from '../lib/plExport';
import { createWorkbook } from '../lib/excelExport';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';
import { getSupabase } from '../lib/db/client';
import type { ChartAccount, Transaction, TransactionLine } from '../types';

const realFetch = globalThis.fetch;

afterEach(async () => {
  cleanup();
  globalThis.fetch = realFetch;
  window.history.replaceState(null, '', '/');
  await getSupabase().auth.dispose();
});

const chartAccounts: ChartAccount[] = [
  { id: 'acc_exp', uid: 'u_1', workspaceId: 'component-workspace', name: 'Cloud Hosting', code: '5100', type: 'expense', balanceCents: 0 } as ChartAccount,
  { id: 'acc_bank', uid: 'u_1', workspaceId: 'component-workspace', name: 'Operating Bank', code: '1000', type: 'asset', systemRole: 'cash', balanceCents: 0 } as unknown as ChartAccount,
  { id: 'acc_rev', uid: 'u_1', workspaceId: 'component-workspace', name: 'SaaS Revenue', code: '4000', type: 'income', balanceCents: 0 } as ChartAccount,
];

test('F-1: DashboardWidgets report links navigate in-SPA without document reload and sync Reports custom period', async () => {
  const ws = setComponentWorkspace('owner');
  useAuthStore.setState({ workspaces: [{ ...ws, currency: 'ILS' }] });
  markComponentCollectionsLoaded('transactions', 'accounts', 'invoices', 'bills', 'customers', 'vendors');
  useLedgerStore.setState({
    accounts: chartAccounts,
    transactions: [{
      id: 'tx_rev_1',
      workspaceId: ws.id,
      date: '2025-11-15',
      description: 'November SaaS Invoice',
      status: 'completed',
      type: 'actual',
      totalAmountCents: 25000,
      lines: [
        { accountId: 'acc_bank', accountName: 'Operating Bank', amountCents: 25000 },
        { accountId: 'acc_rev', accountName: 'SaaS Revenue', amountCents: -25000 },
      ],
    } as Transaction],
    invoices: [],
    bills: [],
    customers: [],
    vendors: [],
    truncatedCollections: {},
  });
  localStorage.clear();
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('/profit-and-loss')) return new Response(JSON.stringify({}), { status: 404 });
    return new Response(JSON.stringify({ banks: [], years: [2025, 2026], rows: [] }), { status: 200 });
  }) as typeof fetch;

  render(
    <>
      <DashboardWidgets />
      <Reports />
    </>,
  );

  fireEvent.change(screen.getByLabelText(/dashboard date range/i), { target: { value: 'custom' } });
  fireEvent.change(screen.getByLabelText('Dashboard from'), { target: { value: '2025-11-01' } });
  fireEvent.change(screen.getByLabelText('Dashboard to'), { target: { value: '2025-11-30' } });

  const revenueCard = screen.getByRole('article', { name: 'Revenue' });
  const revenueLink = within(revenueCard).getByRole('link');
  const clickEvent = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  await act(async () => {
    revenueLink.dispatchEvent(clickEvent);
  });

  assert.equal(clickEvent.defaultPrevented, true, 'primary click must stay inside the SPA instead of reloading index.html');
  assert.equal(useUIStore.getState().activeTab, 'reports');
  assert.equal(useUIStore.getState().activeReportTab, 'pnl');
  assert.match(window.location.search, /report=pnl/);
  assert.match(window.location.search, /start(?:Date)?=2025-11-01/);
  assert.match(window.location.search, /end(?:Date)?=2025-11-30/);
  await waitFor(() => {
    assert.match(screen.getByTestId('reports-heading').textContent || '', /Custom range/);
  });
});

test('plExport formats 0-decimal JPY and 3-decimal KWD amounts with ISO 4217 minor units instead of hardcoded /100', async () => {
  const ws = setComponentWorkspace('owner');
  const createdUrls: string[] = [];
  const origCreateObjectURL = window.URL.createObjectURL;
  const origRevokeObjectURL = window.URL.revokeObjectURL;
  let capturedBlob: Blob | undefined;
  window.URL.createObjectURL = ((blob: Blob) => {
    capturedBlob = blob;
    const u = 'blob:test-pl-export';
    createdUrls.push(u);
    return u;
  }) as typeof window.URL.createObjectURL;
  window.URL.revokeObjectURL = (() => {}) as typeof window.URL.revokeObjectURL;

  try {
    useAuthStore.setState({ workspaces: [{ ...ws, currency: 'JPY' }] });
    await exportPlToExcel({
      data: {
        income: { total: 100000, accounts: { rev: { name: 'Tokyo Revenue', balance: 100000 } } },
        expense: { total: 40000, accounts: { exp: { name: 'Tokyo Hosting', balance: 40000 } } },
        netIncome: 60000,
      },
      prevData: null,
      isComparative: false,
      labels: { title: 'Profit & Loss', revenueStreams: 'Revenue', expenseClusters: 'Expenses', netLabel: 'Net Income', exportName: 'PL' },
      start: '2026-10-01',
      end: '2026-10-31',
      cash: false,
    });
    assert.ok(capturedBlob);
    const wbJpy = await createWorkbook();
    await wbJpy.xlsx.load(await capturedBlob.arrayBuffer());
    const sheetJpy = wbJpy.worksheets[0];
    assert.equal(sheetJpy.getCell('B10').value, 100000, 'JPY 0-decimal export must write 100000 yen, not 1000');

    useAuthStore.setState({ workspaces: [{ ...ws, currency: 'KWD' }] });
    await exportPlToExcel({
      data: {
        income: { total: 50000, accounts: { rev: { name: 'Kuwait Advisory', balance: 50000 } } },
        expense: { total: 0, accounts: {} },
        netIncome: 50000,
      },
      prevData: null,
      isComparative: false,
      labels: { title: 'Profit & Loss', revenueStreams: 'Revenue', expenseClusters: 'Expenses', netLabel: 'Net Income', exportName: 'PL' },
      start: '2026-10-01',
      end: '2026-10-31',
      cash: false,
    });
    const wbKwd = await createWorkbook();
    await wbKwd.xlsx.load(await capturedBlob!.arrayBuffer());
    assert.equal(wbKwd.worksheets[0].getCell('B10').value, 50, 'KWD 3-decimal export must write 50.000 dinars, not 500');
    assert.equal(createdUrls.length, 2);
  } finally {
    window.URL.createObjectURL = origCreateObjectURL;
    window.URL.revokeObjectURL = origRevokeObjectURL;
  }
});

test('TransactionEditModal respects workspace baseCurrency, shows balanced journal total, syncs FX line rates, and guards document entries', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ links: [], questions: [] }), { status: 200 })) as typeof fetch;
  const ws = setComponentWorkspace('owner');
  useAuthStore.setState({ workspaces: [{ ...ws, currency: 'ILS' }] });
  useLedgerStore.setState({ baseCurrency: 'ILS', accounts: chartAccounts, transactions: [] });

  const ilsTx: Transaction = {
    id: 'tx_ils_1',
    workspaceId: ws.id,
    date: '2026-10-12',
    description: 'Tel Aviv Hosting',
    status: 'completed',
    type: 'actual',
    currency: 'ILS',
    totalAmountCents: 50000,
    lines: [
      { accountId: 'acc_exp', accountName: 'Cloud Hosting', amountCents: 50000 },
      { accountId: 'acc_bank', accountName: 'Operating Bank', amountCents: -50000 },
    ],
  } as Transaction;

  let savedUpdates: Partial<Transaction> | undefined;
  const view = render(
    <TransactionEditModal
      isOpen
      transaction={ilsTx}
      accounts={chartAccounts}
      onClose={() => {}}
      onUpdate={(_id, updates) => {
        savedUpdates = updates;
        return false; // Simulate server rejection -> modal must not close
      }}
    />,
  );

  // 1) Home currency ILS must NOT show foreign FX panel initially
  assert.equal(screen.queryByLabelText(/Historical Exchange Rate Offset/i), null);
  // 2) Balanced journal (+50000 / -50000) must display 500.00 total, not 0.00
  assert.match(document.body.textContent || '', /500\.00/);
  // 3) Unreconciled entry must NOT offer manual 'reconciled' status option
  const statusSelect = screen.getByLabelText('Process Status') as HTMLSelectElement;
  assert.equal(Array.from(statusSelect.options).some(o => o.value === 'reconciled'), false);

  // 4) Switching currency to USD in an ILS workspace reveals FX rate panel (1 USD = ILS) and syncs line exchangeRate
  fireEvent.change(screen.getByLabelText('Currency Context'), { target: { value: 'USD' } });
  const rateInput = screen.getByLabelText(/Historical Exchange Rate Offset \(1 USD = ILS\)/i);
  fireEvent.change(rateInput, { target: { value: '3.75' } });

  let closed = false;
  view.rerender(
    <TransactionEditModal
      isOpen
      transaction={ilsTx}
      accounts={chartAccounts}
      onClose={() => { closed = true; }}
      onUpdate={(_id, updates) => {
        savedUpdates = updates;
        return false;
      }}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Record synchronized changes' }));
  });
  assert.equal(closed, false, 'modal stays open when onUpdate returns false');
  assert.equal(savedUpdates?.exchangeRate, 3.75);
  assert.equal(savedUpdates?.lines?.[0]?.exchangeRate, 3.75);
  assert.equal(savedUpdates?.lines?.[1]?.exchangeRate, 3.75);

  // 5) Document-backed entry shows guard banner and disables write button
  view.rerender(
    <TransactionEditModal
      isOpen
      transaction={{ ...ilsTx, invoiceId: 'inv_locked_1' } as Transaction}
      accounts={chartAccounts}
      onClose={() => {}}
      onUpdate={() => {}}
    />,
  );
  assert.ok(screen.getByText('This entry belongs to a document'));
  assert.equal((screen.getByRole('button', { name: 'Record synchronized changes' }) as HTMLButtonElement).disabled, true);
});

test('entryActions: handleDuplicateTransaction strips document/reconcile/reversal metadata and handleToggleFlag checks res.ok', async () => {
  const sourceTx: Transaction = {
    id: 'tx_doc_rec_1',
    workspaceId: 'ws_1',
    date: '2026-09-01',
    description: 'Invoice Posting',
    status: 'reconciled',
    type: 'reversal',
    invoiceId: 'inv_99',
    isCleared: true,
    isFlagged: false,
    reversalEventId: 'rev_99',
    updatedAt: '2026-09-01T00:00:00.000Z',
    metadata: { type: 'invoice-posting', invoiceId: 'inv_99' },
    totalAmountCents: 10000,
    lines: [
      { id: 'l1', accountId: 'acc_bank', accountName: 'Operating Bank', amountCents: 10000, baseAmountCents: 10000 },
      { id: 'l2', accountId: 'acc_rev', accountName: 'SaaS Revenue', amountCents: -10000, baseAmountCents: -10000 },
    ],
  } as unknown as Transaction;

  useAuthStore.setState({ currentWorkspaceId: 'ws_1' });
  useLedgerStore.setState({ transactions: [sourceTx], accounts: chartAccounts });

  const postedBodies: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = init?.body ? JSON.parse(String(init.body)) : {};
    postedBodies.push({ url: String(url), body: parsed });
    if (String(url).endsWith('/tx_doc_rec_1')) {
      return new Response(JSON.stringify({ error: 'version_conflict' }), { status: 409 });
    }
    return new Response(JSON.stringify({ status: 'success', data: { id: 'tx_copy_1' } }), { status: 201 });
  }) as typeof fetch;

  const actions = createEntryActions(
    {
      user: { uid: 'u_1', getIdToken: async () => 'tok' } as never,
      currentWorkspaceId: 'ws_1',
      setTransactions: (next: Transaction[]) => useLedgerStore.setState({ transactions: next }),
      accounts: chartAccounts,
      setIsSyncing: () => {},
      recordAudit: async () => {},
      isPeriodLocked: () => false,
    } as never,
    {
      recordRulePattern: async () => {},
      balanceTransactionLines: (lines: TransactionLine[]) => lines,
    } as never,
    { handleAddRule: async () => {} } as never,
  );

  await actions.handleToggleFlag('tx_doc_rec_1');
  assert.equal(postedBodies[0].body.expectedUpdatedAt, '2026-09-01T00:00:00.000Z');
  assert.equal(useLedgerStore.getState().transactions[0].isFlagged, false, 'rejected 409 flag toggle must not mutate store');

  await actions.handleDuplicateTransaction('tx_doc_rec_1');
  const dupPayload = postedBodies[1]?.body?.transaction as Record<string, unknown>;
  assert.ok(dupPayload);
  assert.equal(dupPayload.invoiceId, undefined);
  assert.equal(dupPayload.metadata, undefined);
  assert.equal(dupPayload.reversalEventId, undefined);
  assert.equal(dupPayload.isCleared, undefined);
  assert.equal(dupPayload.status, 'completed');
  assert.equal(dupPayload.type, 'actual');
  assert.equal((dupPayload.lines as Array<Record<string, unknown>>)[0].baseAmountCents, undefined);
});
