import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  const { rerender } = render(<Sales />);
  const salesRegion = screen.getByText('חשבוניות ששלחת והכספים שהלקוחות חייבים לך.').closest('[dir="rtl"]');
  assert.ok(salesRegion);
  assert.equal(salesRegion?.getAttribute('lang'), 'he');
  assert.ok(screen.getByRole('heading', { name: 'מכירות' }));
  assert.ok(screen.getByRole('button', { name: 'חשבוניות' }));
  assert.ok(screen.getByRole('button', { name: 'לקוחות' }));
  assert.ok(screen.getByRole('button', { name: 'הוספת חשבונית' }));
  assert.ok(screen.getByText('לתשלום ב־30 הימים הקרובים'));
  // U-3: when empty, column headers and tools stay hidden behind EmptyState.
  assert.equal(screen.queryAllByRole('columnheader').length, 0);
  assert.ok(screen.getByRole('heading', { name: 'אין עדיין חשבוניות' }));

  fireEvent.click(screen.getByRole('button', { name: 'לקוחות' }));
  assert.equal(screen.queryAllByRole('columnheader').length, 0);
  assert.ok(screen.getByRole('heading', { name: 'אין עדיין לקוחות' }));

  // When data exists, Hebrew RTL column headers render for both invoices and customers.
  useLedgerStore.setState({
    invoices: [{
      id: 'inv-he-1', uid: 'u1', workspaceId: 'component-workspace', customerId: 'cust-he-1',
      customerName: 'לקוח א', number: '1001', amountCents: 10000, date: '2026-10-01', dueDate: '2026-10-30', status: 'sent',
    }],
    customers: [{
      id: 'cust-he-1', uid: 'u1', workspaceId: 'component-workspace', name: 'לקוח א', status: 'active', balanceCents: 10000,
    }],
  });
  rerender(<Sales />);
  fireEvent.click(screen.getByRole('button', { name: 'חשבוניות' }));
  assert.ok(screen.getByRole('columnheader', { name: 'מספר' }));
  assert.ok(screen.getByRole('columnheader', { name: 'לקוח' }));
  assert.ok(screen.getByRole('columnheader', { name: 'מצב' }));
  fireEvent.click(screen.getByRole('button', { name: 'לקוחות' }));
  assert.ok(screen.getByRole('columnheader', { name: 'פרטי לקוח' }));
  assert.ok(screen.getByRole('columnheader', { name: 'פרטי קשר' }));
  assert.ok(screen.getByRole('columnheader', { name: 'יתרת לקוחות נטו' }));
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

/*
 * A-259 as a component contract: Escape must return focus to the row button that opened the dialog.
 *
 * The grid used to hand React a rebuilt `cell` function on every render, which React reads as a new element
 * type: the row's buttons were remounted (the action button a dialog had recorded was gone), so `useDialog`'s
 * restore found a disconnected node and focus fell to the body. These two legs keep the row node stable.
 */
async function escapeReturnsFocusToRow(renderScreen: () => void, rowName: string) {
  renderScreen();
  const opener = screen.getByRole('button', { name: rowName });
  opener.focus();
  assert.equal(document.activeElement, opener, 'the row button holds focus');
  await act(async () => { opener.click(); await Promise.resolve(); });
  const dialog = await screen.findByRole('dialog');
  assert.ok(dialog.contains(document.activeElement), 'focus moved into the dialog');
  assert.ok(opener.isConnected, 'the row button is still the node the dialog must return to');
  await act(async () => {
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();
  });
  assert.equal(screen.queryByRole('dialog'), null, 'Escape closed the dialog');
  assert.equal(document.activeElement, opener, 'focus returned to the row button that opened the dialog');
}

test('A-259 Sales: Escape returns focus to the invoice row button', async () => {
  markComponentCollectionsLoaded('creditNotes', 'customers', 'invoices', 'payments');
  useLedgerStore.setState({
    customers: [{ id: 'cust-1', uid: 'u1', workspaceId: 'component-workspace', name: 'Acme Corp', status: 'active' }],
    invoices: [{
      id: 'inv-1001', uid: 'u1', workspaceId: 'component-workspace', customerId: 'cust-1', customerName: 'Acme Corp',
      number: '1001', amountCents: 118000, date: '2026-09-05', dueDate: '2026-10-05', status: 'sent',
    }],
  });
  await escapeReturnsFocusToRow(() => render(<Sales />), 'Edit invoice 1001');
});

test('A-259 Purchases: Escape returns focus to the bill row button', async () => {
  markComponentCollectionsLoaded('accounts', 'bills', 'recurring', 'vendors');
  useLedgerStore.setState({
    accounts: [{ id: 'exp-5000', uid: 'u1', workspaceId: 'component-workspace', code: '5000', name: 'Office costs', type: 'expense', category: 'Expenses', balanceCents: 0 }],
    vendors: [{ id: 'vendor-parts', uid: 'u1', workspaceId: 'component-workspace', name: 'Parts Ltd', status: 'active', category: 'Supplies' }],
    bills: [{
      id: 'bill-2001', uid: 'u1', workspaceId: 'component-workspace', number: '2001', vendorId: 'vendor-parts', vendorName: 'Parts Ltd',
      status: 'pending', date: '2026-09-08', dueDate: '2026-09-20', amountCents: 42000, amountPaidCents: 0, currency: 'USD',
      splits: [{ amountCents: 42000, accountId: 'exp-5000', description: 'Widgets' }],
    }],
  });
  await escapeReturnsFocusToRow(() => render(<Purchases />), 'Edit bill 2001');
});
