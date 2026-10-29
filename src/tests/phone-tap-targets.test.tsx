/**
 * A-233: the controls inside the Customers and Vendors lists are 44 px targets at 390 px.
 *
 * The two lists are sub-tabs of Sales and Purchases, so they are not on the screens the visual
 * references photograph — a phone tap target there can only be checked by rendering the row.
 * jsdom has no layout, so the class is the contract: `min-h-11` and `min-w-11` are Tailwind's 44 px.
 */
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
import { makeCustomer, makeVendor } from './fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';

const realFetch = globalThis.fetch;

beforeEach(() => {
  setComponentWorkspace();
  stubFetch(404);
  useLedgerStore.setState({
    accounts: [], bills: [], creditNotes: [], customers: [makeCustomer({ id: 'c1', name: 'Acme' })],
    inventory: [], invoices: [], payments: [], recurring: [], taxRates: [], vendors: [makeVendor({ id: 'v1', name: 'Parts Ltd' })],
  });
});
afterEach(async () => { cleanup(); globalThis.fetch = realFetch; await getSupabase().auth.dispose(); });

function assert44(what: string, element: Element | null, { width = true } = {}) {
  assert.ok(element, `${what} is on the screen`);
  const classes = element!.className;
  assert.match(classes, /\bmin-h-11\b/, `${what} is at least 44 px tall`);
  if (width) assert.match(classes, /\bmin-w-11\b/, `${what} is at least 44 px wide`);
}

test('a customer row at 390 px: the row actions and the inline "Enter Invoice" are 44 px', () => {
  markComponentCollectionsLoaded('creditNotes', 'customers', 'invoices', 'payments');
  render(<Sales />);
  fireEvent.click(screen.getByRole('button', { name: 'Customers & Clients' }));
  assert.ok(screen.getByText('Acme'), 'the seeded customer is listed');
  assert44('Archive Acme', screen.getByRole('button', { name: 'Archive Acme' }));
  assert44('Delete Acme', screen.getByRole('button', { name: 'Delete Acme' }));
  assert44('Enter Invoice', document.querySelector('button[title="Enter Invoice"]'));
  assert44('the payment-reminders toggle', screen.getByTitle('Automatic payment reminders (Settings → Emails & Reminders)'), { width: false });
});

test('a vendor row at 390 px: the row actions are 44 px', () => {
  markComponentCollectionsLoaded('bills', 'recurring', 'vendors');
  render(<Purchases />);
  fireEvent.click(screen.getByRole('button', { name: /^Vendors/ }));
  assert.ok(screen.getByText('Parts Ltd'), 'the seeded vendor is listed');
  assert44('Archive Parts Ltd', screen.getByRole('button', { name: 'Archive Parts Ltd' }));
  assert44('Delete Parts Ltd', screen.getByRole('button', { name: 'Delete Parts Ltd' }));
});
