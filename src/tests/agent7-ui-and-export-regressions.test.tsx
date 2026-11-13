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


test('TransactionEditModal preserves per-line FX rates and precomputed home amounts on metadata-only save', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ links: [], questions: [] }), { status: 200 })) as typeof fetch;
  const ws = setComponentWorkspace('owner');
  useAuthStore.setState({ workspaces: [{ ...ws, currency: 'ILS' }] });
  useLedgerStore.setState({ baseCurrency: 'ILS', accounts: chartAccounts, transactions: [] });

  const fxTx: Transaction = {
    id: 'tx_fx_manual', workspaceId: ws.id, date: '2026-10-12', description: 'Manual FX journal',
    status: 'completed', type: 'actual', currency: 'USD', originalCurrency: 'USD',
    exchangeRate: 3.75, totalAmountCents: 11000,
    lines: [
      { accountId: 'acc_exp', accountName: 'Cloud Hosting', amountCents: 10000, exchangeRate: 3.75, baseAmountCents: 37500 },
      { accountId: 'acc_bank', accountName: 'Operating Bank', amountCents: -10000, exchangeRate: 3.75, baseAmountCents: -37500 },
      { accountId: 'acc_exp', accountName: 'Cloud Hosting', amountCents: 1000, exchangeRate: 1, baseAmountCents: 1000 },
      { accountId: 'acc_bank', accountName: 'Operating Bank', amountCents: -1000, exchangeRate: 1, baseAmountCents: -1000 },
    ],
  } as Transaction;
  let saved: Partial<Transaction> | undefined;
  const view = render(
    <TransactionEditModal
      isOpen transaction={fxTx} accounts={chartAccounts} onClose={() => {}}
      onUpdate={(_id, updates) => { saved = updates; return false; }}
    />,
  );
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Corrected memo only' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Record synchronized changes' }));
  });
  assert.equal(saved?.description, 'Corrected memo only');
  assert.deepEqual(saved?.lines?.map(l => l.exchangeRate), [3.75, 3.75, 1, 1]);
  assert.deepEqual(saved?.lines?.map(l => l.baseAmountCents), [37500, -37500, 1000, -1000],
    'metadata edit must not recalculate explicit home amounts or the FX difference lines');

  // When journal amounts change, the validator must never see a partial set of
  // stale home amounts: clear all base values and recompute all four together.
  fireEvent.change(screen.getByLabelText('Amount for line 1'), { target: { value: '110.00' } });
  fireEvent.change(screen.getByLabelText('Amount for line 2'), { target: { value: '-110.00' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Record synchronized changes' }));
  });
  assert.ok(saved?.lines?.every(l => l.baseAmountCents === undefined));
  assert.deepEqual(saved?.lines?.map(l => l.exchangeRate), [3.75, 3.75, 1, 1]);

  // Header changes must propagate to lines using the previous header rate,
  // but not to rate-1 exchange-difference lines.
  fireEvent.change(screen.getByLabelText(/Historical Exchange Rate Offset/i), { target: { value: '4.00' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Record synchronized changes' }));
  });
  assert.equal(saved?.exchangeRate, 4);
  assert.deepEqual(saved?.lines?.map(l => l.exchangeRate), [4, 4, 1, 1]);
  assert.ok(saved?.lines?.every(l => l.baseAmountCents === undefined));
  view.unmount();
});

test('TransactionEditModal never double-converts home-native FX journal amounts', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ links: [], questions: [] }), { status: 200 })) as typeof fetch;
  const ws = setComponentWorkspace('owner');
  useAuthStore.setState({ workspaces: [{ ...ws, currency: 'ILS' }] });
  useLedgerStore.setState({ baseCurrency: 'ILS', accounts: chartAccounts, transactions: [] });
  // JournalEntryModal converts the foreign input before posting, so both
  // amountCents and baseAmountCents are already home-currency figures.
  const tx = {
    id: 'tx_home_native_fx', workspaceId: ws.id, date: '2026-10-12',
    description: 'Preconverted journal', status: 'completed', type: 'journal',
    currency: 'ILS', originalCurrency: 'USD', exchangeRate: 1.65,
    totalAmountCents: 16500,
    lines: [
      { accountId: 'acc_exp', amountCents: 16500, baseAmountCents: 16500 },
      { accountId: 'acc_bank', amountCents: -16500, baseAmountCents: -16500 },
    ],
  } as Transaction;
  let saved: Partial<Transaction> | undefined;
  let writes = 0;
  render(
    <TransactionEditModal isOpen transaction={tx} accounts={chartAccounts} onClose={() => {}}
      onUpdate={(_id, updates) => { saved = updates; writes++; return false; }} />,
  );
  fireEvent.change(screen.getByLabelText('Amount for line 1'), { target: { value: '170.00' } });
  fireEvent.change(screen.getByLabelText('Amount for line 2'), { target: { value: '-170.00' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Record synchronized changes' }));
  });
  assert.equal(writes, 1);
  assert.equal(saved?.currency, 'ILS', 'home-native journal must remain denominated in books currency');
  assert.equal(saved?.originalCurrency, 'USD', 'retain the historical foreign-currency reference');
  assert.deepEqual(saved?.lines?.map(l => l.amountCents), [17000, -17000]);
  assert.deepEqual(saved?.lines?.map(l => l.baseAmountCents), [17000, -17000]);
  assert.deepEqual(saved?.lines?.map(l => l.exchangeRate), [undefined, undefined],
    'a home-native line must never be multiplied by the header rate again');

  fireEvent.change(screen.getByLabelText(/Historical Exchange Rate Offset/i), { target: { value: '1.75' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Record synchronized changes' }));
  });
  assert.equal(writes, 1, 'changing foreign FX basis without original foreign amounts must be refused');
});

test('entryActions: a successful flag toggle never invents updatedAt when the server omits it', async () => {
  const originalUpdatedAt = '2026-09-01T00:00:00.000Z';
  const serverUpdatedAt = '2026-11-13T16:00:00.000Z';
  const tx = {
    id: 'tx_flagged', workspaceId: 'ws_1', date: '2026-09-01', description: 'Manual journal',
    status: 'completed', type: 'actual', updatedAt: originalUpdatedAt, isFlagged: false,
    lines: [
      { accountId: 'acc_bank', amountCents: 1000 },
      { accountId: 'acc_rev', amountCents: -1000 },
    ],
  } as Transaction;
  useAuthStore.setState({ currentWorkspaceId: 'ws_1' });
  useLedgerStore.setState({ transactions: [tx], accounts: chartAccounts });
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (requests.length === 1) {
      // Realtime delivered the actual timestamp before the HTTP response.
      useLedgerStore.setState({
        transactions: useLedgerStore.getState().transactions.map(t =>
          t.id === tx.id ? { ...t, updatedAt: serverUpdatedAt, isFlagged: true } : t),
      });
    }
    return new Response(JSON.stringify({ status: 'ok', transactionId: tx.id }), { status: 200 });
  }) as typeof fetch;
  const actions = createEntryActions(
    {
      user: { uid: 'u_1', getIdToken: async () => 'tok' } as never,
      currentWorkspaceId: 'ws_1',
      setTransactions: (next: Transaction[]) => useLedgerStore.setState({ transactions: next }),
      accounts: chartAccounts, setIsSyncing: () => {}, recordAudit: async () => {},
      isPeriodLocked: () => false,
    } as never,
    { recordRulePattern: async () => {}, balanceTransactionLines: (lines: TransactionLine[]) => lines } as never,
    { handleAddRule: async () => {} } as never,
  );
  await actions.handleToggleFlag(tx.id);
  assert.equal(requests[0].expectedUpdatedAt, originalUpdatedAt);
  assert.deepEqual(requests[0].partialUpdate, { isFlagged: true });
  assert.equal(useLedgerStore.getState().transactions[0].updatedAt, serverUpdatedAt);
  assert.equal(useLedgerStore.getState().transactions[0].isFlagged, true);
  // No realtime notification for the second toggle: the browser must fetch
  // the committed transaction version before allowing the next journal edit.
  const refetchedUpdatedAt = '2026-11-13T16:00:03.000Z';
  const supabase = getSupabase() as unknown as { from: (table: string) => unknown };
  const originalFrom = supabase.from;
  supabase.from = ((table: string) => {
    if (table !== 'transactions') return originalFrom.call(supabase, table);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: tx.id, data: { ...tx, updatedAt: refetchedUpdatedAt, isFlagged: false } },
            error: null,
          }),
        }),
      }),
    };
  }) as typeof supabase.from;
  try {
    await actions.handleToggleFlag(tx.id);
    assert.equal(requests[1].expectedUpdatedAt, serverUpdatedAt,
      'the second toggle must use the timestamp supplied by realtime');
    assert.equal(useLedgerStore.getState().transactions[0].updatedAt, refetchedUpdatedAt,
      'when realtime lags, refresh the actual server version before the next edit');
    assert.equal(useLedgerStore.getState().transactions[0].isFlagged, false);
  } finally {
    supabase.from = originalFrom;
  }
});

test('entryActions: full journal edit uses the persisted version, never the echoed request timestamp', async () => {
  const oldVersion = '2026-09-01T00:00:00.000Z';
  const persistedVersion = '2026-11-13T16:10:00.000Z';
  const tx = {
    id: 'tx_manual_version', workspaceId: 'ws_1', date: '2026-09-01',
    description: 'Original memo', type: 'actual', status: 'completed',
    updatedAt: oldVersion, totalAmountCents: 5000,
    lines: [
      { accountId: 'acc_bank', amountCents: 5000 },
      { accountId: 'acc_rev', amountCents: -5000 },
    ],
  } as Transaction;
  useAuthStore.setState({ currentWorkspaceId: 'ws_1' });
  useLedgerStore.setState({ transactions: [tx], accounts: chartAccounts });
  const supabase = getSupabase() as unknown as { from: (table: string) => unknown };
  const originalFrom = supabase.from;
  supabase.from = ((table: string) => {
    if (table !== 'transactions') return originalFrom.call(supabase, table);
    return {
      select: () => ({ eq: () => ({
        maybeSingle: async () => ({
          data: { id: tx.id, data: { ...tx, description: 'Updated memo', updatedAt: persistedVersion } },
          error: null,
        }),
      }) }),
    };
  }) as typeof supabase.from;
  let echoedVersion: string | undefined;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.match(String(url), /\/api\/v1\/transactions\/tx_manual_version/);
    const request = JSON.parse(String(init?.body)) as { transaction: Transaction; expectedUpdatedAt: string };
    assert.equal(request.expectedUpdatedAt, oldVersion);
    echoedVersion = request.transaction.updatedAt;
    return new Response(JSON.stringify({ status: 'ok', transactionId: tx.id, data: request.transaction }), { status: 200 });
  }) as typeof fetch;
  try {
    const actions = createEntryActions(
      {
        user: { uid: 'u_1', getIdToken: async () => 'tok' } as never,
        currentWorkspaceId: 'ws_1',
        setTransactions: (next: Transaction[]) => useLedgerStore.setState({ transactions: next }),
        accounts: chartAccounts, setIsSyncing: () => {}, recordAudit: async () => {},
        isPeriodLocked: () => false,
      } as never,
      { recordRulePattern: async () => {}, balanceTransactionLines: (lines: TransactionLine[]) => lines } as never,
      { handleAddRule: async () => {} } as never,
    );
    const success = await actions.handleUpdateTransaction(tx.id, { description: 'Updated memo' });
    assert.equal(success, true);
    assert.ok(echoedVersion && echoedVersion !== persistedVersion);
    assert.equal(useLedgerStore.getState().transactions[0].updatedAt, persistedVersion,
      'the response echoes the browser version, but the cache must use the real stored version');
  } finally {
    supabase.from = originalFrom;
  }
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
    currency: 'USD', originalCurrency: 'USD', exchangeRate: 1.65,
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
  assert.equal((dupPayload.lines as Array<Record<string, unknown>>)[0].baseAmountCents, 10000,
    'copying unchanged FX journal figures must preserve explicit home amounts');
  assert.equal(dupPayload.exchangeRate, 1.65);
});
