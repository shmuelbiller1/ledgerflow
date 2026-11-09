import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Sales from '../components/sales/Sales';
import Purchases from '../components/purchases/Purchases';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import { stubFetch } from './helpers/dom';
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
  fireEvent.click(screen.getByRole('button', { name: 'Customers' }));
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
