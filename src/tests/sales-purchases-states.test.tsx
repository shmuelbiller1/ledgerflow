import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

test('a refused vendor.create command keeps the vendor form draft open', async () => {
  markComponentCollectionsLoaded('bills', 'recurring', 'vendors');
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    calls.push({ url, body });
    return Response.json({ message: 'Vendor create refused' }, { status: 403 });
  }) as typeof fetch;
  render(<Purchases />);
  fireEvent.click(screen.getByRole('button', { name: 'Vendors (0)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add first vendor' }));
  const name = screen.getByLabelText('Vendor Name') as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'Retain this vendor' } });
  await act(async () => { fireEvent.submit(name.closest('form')!); });
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(calls[0].url, '/api/v1/commands/vendor.create');
  assert.ok(screen.getByRole('dialog', { name: 'Add Vendor' }));
  assert.equal((screen.getByLabelText('Vendor Name') as HTMLInputElement).value, 'Retain this vendor');
});
