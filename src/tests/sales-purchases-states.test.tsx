import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import Sales from '../components/sales/Sales';
import Purchases from '../components/purchases/Purchases';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { getSupabase } from '../lib/db/client';
import { stubFetch } from './helpers/dom';
import { makeBill, makeInvoice } from './fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';

const realFetch = globalThis.fetch;

beforeEach(() => {
  setComponentWorkspace();
  stubFetch(404);
  useLedgerStore.setState({
    accounts: [], bills: [], creditNotes: [], customers: [], inventory: [], invoices: [], payments: [], recurring: [], taxRates: [], vendors: [],
  });
});
afterEach(async () => { cleanup(); globalThis.fetch = realFetch; await getSupabase().auth.dispose(); });

test('empty invoices offer a working first-invoice action', () => {
  markComponentCollectionsLoaded('creditNotes', 'customers', 'invoices', 'payments');
  render(<Sales />);
  assert.ok(screen.getByText('No invoices yet'));
  fireEvent.click(screen.getByRole('button', { name: 'Create invoice' }));
  assert.ok(screen.getByRole('dialog'));
});

test('empty customers replace the misleading offline message with a working add-customer action', () => {
  markComponentCollectionsLoaded('creditNotes', 'customers', 'invoices', 'payments');
  render(<Sales />);
  fireEvent.click(screen.getByRole('button', { name: 'Customers & Clients' }));
  assert.ok(screen.getByText('No customers yet'));
  assert.equal(screen.queryByText('Supplier Registry Offline'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Add first customer' }));
  assert.ok(screen.getByRole('dialog'));
});

test('empty bills offer a working first-bill action', () => {
  markComponentCollectionsLoaded('bills', 'recurring', 'vendors');
  render(<Purchases />);
  assert.ok(screen.getByText('No bills yet'));
  fireEvent.click(screen.getByRole('button', { name: 'Record first bill' }));
  assert.ok(screen.getByRole('dialog'));
});

test('invoice and customer lists distinguish a failed read from loading and retry the failed collections', () => {
  useDataNeedsStore.setState({ loaded: {}, failed: { invoices: 'network down', customers: 'network down', vendors: 'unrelated' } });
  render(<Sales />);
  assert.ok(screen.getByRole('alert').textContent?.includes('Couldn’t load all data for invoices'));
  assert.equal(screen.queryByText('No invoices yet'), null);
  assert.equal(screen.queryByText('Loading invoices…'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Customers & Clients' }));
  assert.ok(screen.getByRole('alert').textContent?.includes('Couldn’t load all data for customers'));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  assert.deepEqual(useDataNeedsStore.getState().failed, { vendors: 'unrelated' });
  assert.ok(screen.getByText('Loading customers…'));
});

test('bill and vendor lists expose retry even if a previously loaded collection later fails', () => {
  markComponentCollectionsLoaded('bills', 'vendors', 'recurring');
  useDataNeedsStore.getState().markFailed('bills', 'connection lost');
  render(<Purchases />);
  assert.ok(screen.getByRole('alert').textContent?.includes('Couldn’t load all data for bills'));
  assert.equal(screen.queryByText('No bills yet'), null);
  fireEvent.click(screen.getByRole('button', { name: /Vendors \(0\)/ }));
  assert.ok(screen.getByRole('alert').textContent?.includes('Couldn’t load all data for vendors'));
  assert.equal(screen.queryByText('No vendors yet'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  assert.equal(useDataNeedsStore.getState().failed.bills, undefined);
  assert.ok(screen.getByText('Loading vendors…'));
  act(() => useDataNeedsStore.getState().markLoaded('bills'));
  assert.ok(screen.getByText('No vendors yet'));
});


test('stale cached invoice and bill rows do not show list totals until the failed read succeeds', () => {
  markComponentCollectionsLoaded('creditNotes', 'customers', 'invoices', 'payments');
  useLedgerStore.setState({ invoices: [makeInvoice({ status: 'sent', amountCents: 10000 })] });
  useDataNeedsStore.getState().markFailed('invoices', 'connection lost');
  const sales = render(<Sales />);
  assert.equal(screen.queryByRole('row', { name: 'Totals in USD' }), null);
  act(() => useDataNeedsStore.getState().markLoaded('invoices'));
  assert.ok(screen.getByRole('row', { name: 'Totals in USD' }));
  sales.unmount();

  markComponentCollectionsLoaded('bills', 'vendors', 'recurring');
  useLedgerStore.setState({ bills: [makeBill({ status: 'unpaid', amountCents: 20000 })] });
  useDataNeedsStore.getState().markFailed('bills', 'connection lost');
  render(<Purchases />);
  assert.equal(screen.queryByRole('row', { name: 'Totals in USD' }), null);
  act(() => useDataNeedsStore.getState().markLoaded('bills'));
  assert.ok(screen.getByRole('row', { name: 'Totals in USD' }));
});
