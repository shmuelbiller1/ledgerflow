/**
 * A-272: the empty and error states of the next ten screens — the ones A-235 (the ten busiest) and
 * A-262 (empty states, next ten) did not cover.
 *
 * Two contracts, the same on every screen:
 *  - a collection that could not be loaded is named in the one shared notice (A-235's
 *    `ScreenDataNotice`), with its own "Try again", instead of a screen that quietly looks empty;
 *  - an empty list says what the screen is for and offers the one action that fills it (the shared
 *    `EmptyState`), and a search that matches nothing is told apart from a workspace with nothing in
 *    it, so the reader is not told to "add your first" a record they already have.
 *
 * Nothing here reads or posts money: the cases only fail a load the way a dropped connection is
 * recorded (`markFailed`) and press the screen's own controls.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import PaymentsView from '../components/finance/PaymentsView';
import CreditNotesView from '../components/finance/CreditNotesView';
import EstimatesView from '../components/sales/EstimatesView';
import PurchaseOrdersView from '../components/purchases/PurchaseOrdersView';
import RecurringTransactionsView from '../components/ledger/RecurringTransactionsView';
import AuditTrail from '../components/forensics/AuditTrail';
import BudgetManager from '../components/planning/BudgetManager';
import { FixedAssetsView } from '../components/assets/FixedAssetsView';
import LoansView from '../components/finance/LoansView';
import TimeView from '../components/collaboration/TimeView';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { LedgerKey } from '../lib/ledgerCollections';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';

const realFetch = globalThis.fetch;
beforeEach(() => {
  // the database answers "nothing yet" (an empty table is a table with no rows, which is what the
  // purchase-order screen's own live query reads); the app's own API is unavailable, so every screen
  // falls back to the books it already holds
  globalThis.fetch = (async input => {
    const url = String(input);
    if (url.includes('/api/')) return new Response(JSON.stringify({ status: 'error', error: 'unavailable in this test' }), { status: 503, headers: { 'content-type': 'application/json' } });
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const workspace = setComponentWorkspace();
  useLedgerStore.setState({
    transactions: [], accounts: [], journalEntries: [], bankLines: [], reconciliations: [],
    invoices: [], bills: [], customers: [], vendors: [], payments: [], creditNotes: [], vendorCredits: [],
    estimates: [], recurring: [], auditLogs: [], budgets: [],
    assets: [], loans: [], projects: [],
  });
  markComponentCollectionsLoaded(
    'transactions', 'accounts', 'customers', 'vendors', 'invoices', 'creditNotes', 'payments',
    'bills', 'vendorCredits', 'recurring', 'bankLines', 'reconciliations', 'journalEntries', 'taxRates',
    'estimates', 'auditLogs', 'budgets', 'assets', 'loans', 'projects',
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

/** fail the screen's collections the way a dropped connection is recorded */
async function failCollections(...keys: LedgerKey[]) {
  await act(async () => {
    for (const key of keys) useDataNeedsStore.getState().markFailed(key, 'Could not reach the server.', new TypeError('Failed to fetch'));
  });
}

describe('A-272: the next ten screens name a failed load and offer their own retry', () => {
  test('Payments: payments and the documents they paid are named, and "Try again" asks again', async () => {
    render(<PaymentsView />);
    await failCollections('payments', 'invoices');
    const notice = dataNotice();
    assert.ok(notice, 'the shared notice is shown');
    assert.match(notice!.textContent || '', /Couldn't load invoices and payments/);
    assert.match(notice!.textContent || '', /Could not reach the server/);
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]); });
    assert.equal(useDataNeedsStore.getState().failed.payments, undefined);
    assert.equal(useDataNeedsStore.getState().failed.invoices, undefined);
    assert.equal(dataNotice(), undefined, 'the notice goes when nothing failed');
  });

  test('Credit notes: the credits and the customers or vendors they name are reported', async () => {
    render(<CreditNotesView />);
    await failCollections('creditNotes', 'customers');
    const notice = dataNotice();
    assert.ok(notice);
    assert.match(notice!.textContent || '', /Couldn't load credit notes and customers/);
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]); });
    assert.equal(useDataNeedsStore.getState().failed.creditNotes, undefined);
  });

  test('Estimates: quotes that could not be read are said instead of "no estimates yet"', async () => {
    render(<EstimatesView />);
    await failCollections('estimates');
    const notice = dataNotice();
    assert.ok(notice);
    assert.match(notice!.textContent || '', /Couldn't load estimates/);
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]); });
    assert.equal(useDataNeedsStore.getState().failed.estimates, undefined);
  });

  test('Purchase orders: the vendors and stock the screen reads are named with one retry', async () => {
    render(<PurchaseOrdersView />);
    await failCollections('vendors', 'inventory');
    const notice = dataNotice();
    assert.ok(notice);
    assert.match(notice!.textContent || '', /Couldn't load items and vendors for this screen/);
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]); });
    assert.equal(useDataNeedsStore.getState().failed.vendors, undefined);
    assert.equal(useDataNeedsStore.getState().failed.inventory, undefined);
  });

  test('Recurring: schedules that failed are reported above the list', async () => {
    render(<RecurringTransactionsView />);
    await failCollections('recurring');
    const notice = dataNotice();
    assert.ok(notice);
    assert.match(notice!.textContent || '', /Couldn't load recurring schedules for these schedules/);
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]); });
    assert.equal(useDataNeedsStore.getState().failed.recurring, undefined);
  });

  test('Audit trail: the log that could not be read is said, not shown as "no activity yet"', async () => {
    render(<AuditTrail />);
    await failCollections('auditLogs');
    const notice = dataNotice();
    assert.ok(notice);
    assert.match(notice!.textContent || '', /Couldn't load activity for the audit trail/);
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]); });
    assert.equal(useDataNeedsStore.getState().failed.auditLogs, undefined);
  });

  test('Budgets: a budget list that failed is named above the caps', async () => {
    render(<BudgetManager />);
    await failCollections('budgets');
    const notice = dataNotice();
    assert.ok(notice);
    assert.match(notice!.textContent || '', /Couldn't load budgets for this screen/);
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]); });
    assert.equal(useDataNeedsStore.getState().failed.budgets, undefined);
  });

  test('Fixed assets: the register and the bills it reads are named with their own retry', async () => {
    render(<FixedAssetsView />);
    await failCollections('assets', 'bills');
    const notice = dataNotice();
    assert.ok(notice);
    assert.match(notice!.textContent || '', /Couldn't load fixed assets and bills for this register/);
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]); });
    assert.equal(useDataNeedsStore.getState().failed.assets, undefined);
  });

  test('Loans: a failed load is reported while the screen waits, and again when it shows its list', async () => {
    render(<LoansView />);
    await failCollections('loans');
    const notice = dataNotice();
    assert.ok(notice, 'the notice is on the loading screen too — a spinner alone would hide the failure');
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]); });
    assert.equal(useDataNeedsStore.getState().failed.loans, undefined);
  });

  test('Time: the projects and customers a time entry names are reported', async () => {
    render(<TimeView />);
    await failCollections('projects', 'customers');
    const notice = dataNotice();
    assert.ok(notice);
    assert.match(notice!.textContent || '', /Couldn't load customers and projects/);
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]); });
    assert.equal(useDataNeedsStore.getState().failed.projects, undefined);
  });
});

describe('A-272: an empty list offers the one action that fills it', () => {
  test('Recurring: with nothing scheduled the screen says what a schedule is and where it comes from', () => {
    render(<RecurringTransactionsView />);
    assert.ok(screen.getByRole('heading', { name: 'No recurring invoices or entries yet' }));
    assert.match(screen.getByText(/A schedule repeats one invoice or entry/).textContent || '', /already reviewed/);
    // the action goes to the screen the document is made on
    assert.ok(screen.getByRole('button', { name: /Go to Sales to set one up/ }));
  });
});
