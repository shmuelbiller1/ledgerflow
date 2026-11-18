/**
 * A customer's and a vendor's page (H-05, H-06): the money cards are what is still owed (after
 * deposits and payments, base currency), overdue by due date, and each document shows its own
 * open amount in its own currency.
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import CustomerRecordPage from '../components/sales/CustomerRecordPage';
import VendorRecordPage from '../components/purchases/VendorRecordPage';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { addToDateISO, getLocalDateISO } from '../lib/utils';
import { makeBill, makeCustomer, makeInvoice, makePayment, makeVendor } from './fixtures';

const ago = (days: number) => addToDateISO(getLocalDateISO(), { days: -days });
const card = (label: RegExp) => screen.getByText(label).parentElement!.textContent || '';

describe('party pages', () => {
  beforeEach(() => {
    stubFetch(404);
    useLedgerStore.setState({
      customers: [makeCustomer({ id: 'c1', name: 'Acme' })],
      vendors: [makeVendor({ id: 'v1', name: 'Power Co' })],
      invoices: [
        makeInvoice({ id: 'i1', number: 'INV-1', customerId: 'c1', amountCents: 50000, depositCents: 10000, date: ago(5), dueDate: ago(-25), status: 'sent' }),
        makeInvoice({ id: 'i2', number: 'INV-2', customerId: 'c1', amountCents: 10000, exchangeRate: 1.1, currency: 'EUR', date: ago(60), dueDate: ago(30), status: 'overdue' }),
        makeInvoice({ id: 'i3', number: 'INV-3', customerId: 'c1', amountCents: 77700, status: 'cancelled' }),
      ],
      bills: [makeBill({ id: 'b1', number: 'B-1', vendorId: 'v1', amountCents: 30000, amountPaidCents: 10000, date: ago(40), dueDate: ago(10), status: 'partially_paid' })],
      payments: [makePayment({ id: 'p1', contactId: 'c1', direction: 'received', status: 'posted', amountCents: 20000, date: ago(3) })],
    });
  });
  afterEach(() => cleanup());

  test('customer: still owed after the deposit, the EUR invoice in the base currency, overdue by due date', () => {
    render(<CustomerRecordPage customerId="c1" onBack={() => {}} />);
    assert.match(card(/Outstanding Balance/), /\$510\.00/);   // 400 + 110
    assert.match(card(/Overdue/), /\$110\.00/);
    const inv2 = screen.getByText('#INV-2').closest('div[class*="flex items-center justify-between"]')!;
    assert.match(inv2.textContent || '', /Open: €100\.00/);
  });

  test('vendor: what is still owed on a part-paid bill', () => {
    render(<VendorRecordPage vendorId="v1" onBack={() => {}} />);
    assert.match(card(/Outstanding Payable/), /\$200\.00/);
    assert.match(card(/Overdue Balance/), /\$200\.00/);
  });

  test('customer wrapper keeps its own heading, documents and back navigation', () => {
    let backs = 0;
    render(<CustomerRecordPage customerId="c1" onBack={() => { backs += 1; }} />);
    assert.ok(screen.getByRole('heading', { name: 'Acme', level: 1 }));
    assert.ok(screen.getByRole('heading', { name: 'Invoices (3)' }));
    assert.ok(screen.getByRole('button', { name: 'Tax certificates' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Customers' }));
    assert.equal(backs, 1);
  });

  test('a contact deep link waits for its on-demand data before saying not found', () => {
    setComponentWorkspace();
    useLedgerStore.setState({ customers: [] });
    markComponentCollectionsLoaded('bills', 'invoices', 'payments', 'vendors');
    const view = render(<CustomerRecordPage customerId="old" onBack={() => {}} />);
    assert.ok(screen.getByText('Loading customer…'));
    assert.equal(screen.queryByRole('heading', { name: 'Customer not found' }), null);
    act(() => markComponentCollectionsLoaded('bills', 'customers', 'invoices', 'payments', 'vendors'));
    assert.ok(screen.getByRole('heading', { name: 'Customer not found' }));
    view.unmount();
  });

  test('a failed contact load offers a retry and does not call it not found', () => {
    setComponentWorkspace();
    useLedgerStore.setState({ vendors: [] });
    markComponentCollectionsLoaded('bills', 'customers', 'invoices', 'payments');
    useDataNeedsStore.setState(s => ({ failed: { vendors: 'Offline' }, loaded: { ...s.loaded, vendors: false } }));
    render(<VendorRecordPage vendorId="v1" onBack={() => {}} />);
    assert.ok(screen.getByRole('heading', { name: 'Vendor unavailable' }));
    assert.match(screen.getByRole('status').textContent || '', /Couldn't load vendors.*Offline/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    assert.ok(screen.getByText('Loading vendor…'));
    act(() => markComponentCollectionsLoaded('bills', 'customers', 'invoices', 'payments', 'vendors'));
  });

  test('vendor wrapper keeps its own heading, documents and back navigation', () => {
    let backs = 0;
    render(<VendorRecordPage vendorId="v1" onBack={() => { backs += 1; }} />);
    assert.ok(screen.getByRole('heading', { name: 'Power Co', level: 1 }));
    assert.ok(screen.getByRole('heading', { name: 'Bills (1)' }));
    assert.ok(screen.getByRole('button', { name: 'Tax records' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Vendors' }));
    assert.equal(backs, 1);
  });
});
