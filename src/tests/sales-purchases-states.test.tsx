import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Sales from '../components/sales/Sales';
import Purchases from '../components/purchases/Purchases';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';
import { getSupabase } from '../lib/db/client';
import { stubFetch } from './helpers/dom';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';

const realFetch = globalThis.fetch;

beforeEach(() => {
  useUIStore.setState({ language: 'en' });
  setComponentWorkspace();
  stubFetch(404);
  useLedgerStore.setState({
    accounts: [], bills: [], creditNotes: [], customers: [], inventory: [], invoices: [], payments: [], recurring: [], taxRates: [], vendors: [],
  });
});
afterEach(async () => { cleanup(); globalThis.fetch = realFetch; await getSupabase().auth.dispose(); });

test('Sales primary screen controls render the selected Hebrew language and RTL direction', () => {
  useUIStore.setState({ language: 'he' });
  markComponentCollectionsLoaded('creditNotes', 'customers', 'invoices', 'payments');
  render(<Sales />);
  const salesRegion = screen.getByText('חשבוניות ששלחת והכספים שהלקוחות חייבים לך.').closest('[dir="rtl"]');
  assert.ok(salesRegion);
  assert.equal(salesRegion?.getAttribute('lang'), 'he');
  assert.ok(screen.getByRole('heading', { name: 'מכירות' }));
  assert.ok(screen.getByRole('button', { name: 'חשבוניות' }));
  assert.ok(screen.getByRole('button', { name: 'לקוחות' }));
  assert.ok(screen.getByRole('button', { name: 'הוספת חשבונית' }));
  assert.ok(screen.getByText('לתשלום ב־30 הימים הקרובים'));
  assert.ok(screen.getByRole('columnheader', { name: 'מספר' }));
  assert.ok(screen.getByRole('columnheader', { name: 'לקוח' }));
  assert.ok(screen.getByRole('columnheader', { name: 'מצב' }));
  fireEvent.click(screen.getByRole('button', { name: 'לקוחות' }));
  assert.ok(screen.getByRole('columnheader', { name: 'פרטי לקוח' }));
  assert.ok(screen.getByRole('columnheader', { name: 'פרטי קשר' }));
  assert.ok(screen.getByRole('columnheader', { name: 'יתרת לקוחות נטו' }));
  assert.ok(screen.getByRole('heading', { name: 'אין עדיין לקוחות' }));
});

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
