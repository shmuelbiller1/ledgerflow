/**
 * A-235: the ten busiest screens say when their data could not be loaded, in one shared notice,
 * with one "Try again" — never an empty screen that looks like a real answer.
 *
 * Every case fails the network the way the app records it (src/stores/useDataNeedsStore.ts
 * `markFailed`, which useLedgerData calls when a subscription cannot be read), then checks the
 * screen in front of the reader: the sentence names what failed, the button asks for it again and
 * the failure is cleared so the subscription starts over.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Dashboard from '../components/Dashboard';
import Sales from '../components/sales/Sales';
import Purchases from '../components/purchases/Purchases';
import Banking from '../components/banking/Banking';
import Reconciliation from '../components/ledger/Reconciliation';
import ProfitAndLossView from '../components/ledger/ProfitAndLossView';
import BalanceSheetView from '../components/ledger/BalanceSheetView';
import TrialBalanceView from '../components/ledger/TrialBalanceView';
import TaxManager from '../components/finance/TaxManager';
import Settings from '../components/platform/Settings';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { LedgerKey } from '../lib/ledgerCollections';
import { formatCurrency } from '../lib/utils';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { buildSampleBusinessYear } from '../lib/sampleBusinessYear';
import { makeInvoice } from './fixtures';

const realFetch = globalThis.fetch;
beforeEach(() => {
  // the database answers "nothing yet"; the app's own API is not what these cases are about, so it
  // is unavailable and every screen falls back to the books it already holds
  globalThis.fetch = (async input => {
    const url = String(input);
    if (url.includes('/rest/v1/')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/api/')) return new Response(JSON.stringify({ status: 'error', error: 'unavailable in this test' }), { status: 503, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ banks: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const workspace = setComponentWorkspace();
  // an open workspace with nothing in it yet: the screens below then show their own empty state,
  // and the only thing each test adds is the failure
  useLedgerStore.setState({
    transactions: [], accounts: [], journalEntries: [], bankLines: [], reconciliations: [],
  });
  useDataNeedsStore.setState({ loadedWorkspaceId: workspace.id });
  markComponentCollectionsLoaded(
    'transactions', 'accounts', 'customers', 'vendors', 'invoices', 'creditNotes', 'payments',
    'bills', 'vendorCredits', 'recurring', 'bankLines', 'reconciliations', 'journalEntries', 'taxRates',
  );
  useDataNeedsStore.setState({ loadedWorkspaceId: workspace.id });
});
afterEach(async () => {
  cleanup();
  globalThis.fetch = realFetch;
  getSupabase().realtime.disconnect();
  await getSupabase().auth.dispose();
});

/** the shared notice (a polite status: the global data bar is the alert), whatever else is on the page */
function dataNotice(): HTMLElement | undefined {
  return screen.queryAllByRole('status').find(el => el.matches('[data-screen-data-notice]'));
}

/** a real year of books for the three report screens (their statement renderer reads a full model) */
function seedSampleYear() {
  const fixture = buildSampleBusinessYear({ year: 2026, scale: 1 });
  useAuthStore.setState({ currentWorkspaceId: fixture.workspace.id, workspaces: [fixture.workspace] });
  useLedgerStore.setState({
    transactions: fixture.transactions,
    accounts: fixture.accounts,
    journalEntries: [],
  });
  markComponentCollectionsLoaded('transactions', 'accounts', 'journalEntries');
  useDataNeedsStore.setState({ loadedWorkspaceId: fixture.workspace.id });
  return fixture;
}

/** fail the screen's collections the way a dropped connection is recorded */
async function failCollections(...keys: LedgerKey[]) {
  await act(async () => {
    for (const key of keys) useDataNeedsStore.getState().markFailed(key, 'Could not reach the server.', new TypeError('Failed to fetch'));
  });
}

describe('A-235: every busiest screen reports a failed load with one shared retry', () => {
  test('Overview (Dashboard): a failed core collection shows the retry instead of guessing new books', async () => {
    // the first-load guard: this workspace's snapshots have not both arrived
    useDataNeedsStore.getState().resetLoaded(useAuthStore.getState().currentWorkspaceId || undefined);
    render(<Dashboard />);
    await failCollections('transactions');
    const alert = screen.getByRole('alert');
    assert.match(alert.textContent || '', /Could not load your books/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    assert.equal(useDataNeedsStore.getState().failed.transactions, undefined);
  });

  test('Sales: invoices that could not be loaded are named, and "Try again" asks for them again', async () => {
    render(<Sales />);
    await failCollections('invoices', 'customers');
    const notice = dataNotice();
    assert.ok(notice, 'the shared notice is shown');
    assert.match(notice!.textContent || '', /Couldn't load customers and invoices/);
    assert.match(notice!.textContent || '', /Could not reach the server/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    assert.equal(useDataNeedsStore.getState().failed.invoices, undefined);
    assert.equal(useDataNeedsStore.getState().failed.customers, undefined);
    assert.equal(dataNotice(), undefined, 'the notice goes when nothing failed');
  });

  test('Purchases: bills and vendors that did not arrive are named with their own retry', async () => {
    render(<Purchases />);
    await failCollections('bills', 'vendors');
    const notice = dataNotice();
    assert.ok(notice);
    assert.match(notice!.textContent || '', /Couldn't load bills and vendors/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    assert.equal(useDataNeedsStore.getState().failed.bills, undefined);
    assert.equal(useDataNeedsStore.getState().failed.vendors, undefined);
  });

  test('Banking: a chart of accounts that could not be read keeps its own retry', async () => {
    render(<Banking />);
    await failCollections('accounts');
    const alert = [...screen.queryAllByRole('alert'), ...screen.queryAllByRole('status')].find(el => /couldn't load your bank accounts/i.test(el.textContent || ''));
    assert.ok(alert, 'the bank accounts panel says the chart of accounts could not be read');
    await act(async () => { fireEvent.click(within(alert!).getByRole('button', { name: 'Try again' })); });
    assert.equal(useDataNeedsStore.getState().failed.accounts, undefined);
  });

  test('Reconcile: entries, bank lines or saved matches that failed are named above the screen', async () => {
    render(<Reconciliation />);
    await failCollections('bankLines');
    const notice = dataNotice();
    assert.ok(notice);
    assert.match(notice!.textContent || '', /Couldn't load bank lines/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    assert.equal(useDataNeedsStore.getState().failed.bankLines, undefined);
  });

  test('Profit and loss: the report says entries could not be loaded rather than showing an empty year', async () => {
    seedSampleYear();
    render(<ProfitAndLossView startDate="2026-01-01" endDate="2026-12-31" />);
    await failCollections('transactions');
    const notice = dataNotice();
    assert.ok(notice);
    assert.match(notice!.textContent || '', /Couldn't load entries for this report/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    assert.equal(useDataNeedsStore.getState().failed.transactions, undefined);
  });

  test('Balance sheet: the same notice when a report read fails', async () => {
    const fixture = seedSampleYear();
    render(<BalanceSheetView accounts={fixture.accounts} formatCurrency={formatCurrency} asOfDate="2026-12-31" />);
    await failCollections('accounts');
    const notice = dataNotice();
    assert.ok(notice);
    assert.match(notice!.textContent || '', /Couldn't load accounts for this report/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    assert.equal(useDataNeedsStore.getState().failed.accounts, undefined);
  });

  test('Trial balance: the same notice, and the screen still opens its own controls', async () => {
    const fixture = seedSampleYear();
    render(<TrialBalanceView accounts={fixture.accounts} formatCurrency={formatCurrency} onDrillDown={() => {}} />);
    await failCollections('journalEntries');
    const notice = dataNotice();
    assert.ok(notice);
    assert.match(notice!.textContent || '', /Couldn't load journal entries/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    assert.equal(useDataNeedsStore.getState().failed.journalEntries, undefined);
  });

  test('Taxes: entries or tax codes that failed are said before the figures are read', async () => {
    render(<TaxManager />);
    await failCollections('taxRates');
    const notice = dataNotice();
    assert.ok(notice);
    assert.match(notice!.textContent || '', /Couldn't load tax codes/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    assert.equal(useDataNeedsStore.getState().failed.taxRates, undefined);
  });

  test('Settings: a failed chart of accounts is reported above the settings panels', async () => {
    render(<Settings />);
    await failCollections('accounts');
    const notice = dataNotice();
    assert.ok(notice);
    assert.match(notice!.textContent || '', /Couldn't load accounts for settings that read your books/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    assert.equal(useDataNeedsStore.getState().failed.accounts, undefined);
  });

  test('A-257: after "Try again" the list reads loading until the fresh data arrives — not the stale empty list', async () => {
    render(<Sales />);
    // invoices had loaded earlier in the session, then the live read failed
    await failCollections('invoices');
    assert.match(dataNotice()!.textContent || '', /Couldn't load invoices/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    assert.equal(useDataNeedsStore.getState().failed.invoices, undefined, 'the failure is cleared so the subscription starts over');
    assert.equal(useDataNeedsStore.getState().loaded.invoices, false, 'the collection is loading again');
    assert.ok(screen.getByText('Loading invoices…'), 'the screen shows loading, not "No invoices yet"');
    assert.equal(dataNotice(), undefined, 'the notice is gone: the retry is in flight');
    // the fresh snapshot arrives (useLedgerData markLoaded)
    await act(async () => { useDataNeedsStore.getState().markLoaded('invoices'); });
    assert.equal(screen.queryByText('Loading invoices…'), null, 'loading ends when the new data is here');
    assert.match(screen.getByText('No invoices yet').textContent || '', /No invoices yet/, 'and the empty state is honest again');
  });

  test('A-257: a retry with rows on screen keeps the rows and says the refresh is in flight', async () => {
    // an invoice already read this session — retrying must not blank the list (CodeRabbit #440)
    await act(async () => {
      useLedgerStore.getState().setInvoices([makeInvoice({ id: 'inv-1', number: 'INV-1', status: 'sent' })]);
    });
    render(<Sales />);
    assert.equal(screen.queryByRole('status'), null, 'no refresh note while nothing is reloading');
    await failCollections('invoices');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    assert.equal(useDataNeedsStore.getState().loaded.invoices, false, 'the collection is loading again');
    assert.ok(screen.getByRole('status'), 'the refresh note is announced while the rows stay');
    assert.ok(screen.getByText('INV-1'), 'the already-read invoice stays on screen during the retry');
    await act(async () => { useDataNeedsStore.getState().markLoaded('invoices'); });
    assert.equal(screen.queryByRole('status'), null, 'the refresh note goes when the new data is here');
  });

  test('a dropped connection keeps the reader on the screen: the loading state is not mistaken for "nothing here"', async () => {
    useDataNeedsStore.setState({ loaded: { transactions: true, accounts: true }, failed: {} });
    render(<Sales />);
    await act(async () => {
      // what useLedgerData records for a network failure: a message, and a bounded retry plan
      useDataNeedsStore.getState().markFailed('invoices', 'Could not reach the server.', new TypeError('Failed to fetch'));
    });
    const trouble = useDataNeedsStore.getState().trouble.invoices;
    assert.ok(trouble, 'a retry plan is recorded for a connection failure');
    assert.equal(trouble!.kind, 'transient');
    assert.ok((trouble!.attempts || 0) >= 1);
    assert.match(dataNotice()!.textContent || '', /Couldn't load invoices/);
  });
});
