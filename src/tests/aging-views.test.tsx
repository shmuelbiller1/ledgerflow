/**
 * The A/R and A/P aging screens (H-09, H-10): what is still owed per customer/vendor by days past
 * due, in the base currency, the same rule as the /aging API (L-159).
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ARAgingReportView from '../components/reporting/ARAgingReportView';
import APAgingReportView from '../components/reporting/APAgingReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';
import { addToDateISO, getLocalDateISO } from '../lib/utils';
import { makeBill, makeCustomer, makeInvoice, makeVendor } from './fixtures';

/** today minus `days`, as YYYY-MM-DD */
const ago = (days: number) => addToDateISO(getLocalDateISO(), { days: -days });
const bodyRows = (name: RegExp) => within(screen.getByRole('table', { name })).getAllByRole('row').slice(1).map(r => r.textContent || '');

describe('aging screens', () => {
  beforeEach(() => {
    stubFetch(404);
    useLedgerStore.setState({
      customers: [makeCustomer({ id: 'a', name: 'Acme' }), makeCustomer({ id: 'b', name: 'Bob' })],
      vendors: [makeVendor({ id: 'v', name: 'Power Co' })],
      invoices: [
        makeInvoice({ id: 'i1', number: 'INV-1', customerId: 'a', amountCents: 50000, date: ago(10), dueDate: ago(-20), status: 'sent' }),
        makeInvoice({ id: 'i2', number: 'INV-2', customerId: 'a', amountCents: 20000, amountPaidCents: 5000, date: ago(75), dueDate: ago(45), status: 'partially_paid' }),
        makeInvoice({ id: 'i3', number: 'INV-3', customerId: 'b', amountCents: 10000, exchangeRate: 1.1, currency: 'EUR', date: ago(150), dueDate: ago(120), status: 'overdue' }),
        makeInvoice({ id: 'i4', customerId: 'b', amountCents: 99999, status: 'paid' }),
      ],
      bills: [makeBill({ id: 'b1', vendorId: 'v', amountCents: 30000, date: ago(40), dueDate: ago(10), status: 'approved' })],
    });
  });
  afterEach(() => cleanup());

  test('A/R: buckets by due date, part-payments taken off, foreign invoices in the base currency', () => {
    render(<ARAgingReportView />);
    const [acme, bob] = bodyRows(/Receivables aging/);
    assert.match(acme, /^Acme\$500\.00-\$150\.00--\$650\.00/);   // not yet due 500; 31-60 days 150 (200 - 50 paid)
    assert.match(bob, /^Bob----\$110\.00\$110\.00/);            // EUR 100 at 1.10, 120 days overdue
    assert.match(screen.getByText('Not yet due').parentElement!.textContent || '', /\$500\.00/);
  });

  test('A/R: the details open from the row button and say how late each invoice is', () => {
    render(<ARAgingReportView />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Acme' }));
    const dialog = screen.getByRole('dialog', { name: /Acme/ });
    assert.match(dialog.textContent || '', /INV-2.*45 days overdue/);
    assert.match(dialog.textContent || '', /INV-1.*Not yet due/);
  });

  test('A/R details (N-12): add up to the row in the base currency, open each invoice, and say when the list is partial', () => {
    render(<ARAgingReportView />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Bob' }));
    const dialog = screen.getByRole('dialog', { name: /Bob/ });
    assert.match(dialog.textContent || '', /Still owed in all \(1 document, in the base currency\)\$110\.00/);
    assert.equal(within(dialog).queryByRole('status'), null);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open invoice INV-3' }));
    assert.deepEqual(useUIStore.getState().focusRecord, { type: 'invoice', id: 'i3' });
    assert.equal(screen.queryByRole('dialog', { name: /Bob/ }), null);
    useLedgerStore.setState({ truncatedCollections: { invoices: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Open Acme' }));
    assert.match(screen.getByRole('status').textContent || '', /Only part of the invoices is loaded/);
    useLedgerStore.setState({ truncatedCollections: {} });
  });

  test('A-270: a row is reachable from the keyboard, opens its detail with Enter, and gets focus back when the drawer closes', async () => {
    render(<ARAgingReportView />);
    // the row itself is in the tab order and carries its own name
    const row = screen.getByRole('row', { name: 'Open the customer aging detail for Acme' });
    assert.equal(row.getAttribute('tabindex'), '0');
    row.focus();
    assert.equal(document.activeElement, row);
    // Enter on the row opens the drawer, which takes focus
    fireEvent.keyDown(row, { key: 'Enter' });
    const dialog = screen.getByRole('dialog', { name: /Acme/ });
    assert.ok(dialog.contains(document.activeElement) || document.activeElement === dialog, 'focus moved into the drawer');
    // a drawer on the row is not reopened when Space is pressed on its own arrow's parent
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    assert.equal(screen.queryByRole('dialog', { name: /Acme/ }), null);
    // the row that opened it has focus back (the drawer never unmounts the row)
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(document.activeElement, row, 'focus returned to the row that opened the drawer');
    // and the arrow control returns focus to itself
    const arrow = screen.getByRole('button', { name: 'Open Bob' });
    arrow.focus();
    fireEvent.click(arrow);
    assert.ok(screen.getByRole('dialog', { name: /Bob/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Aging Schedule' }));
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(document.activeElement, arrow, 'focus returned to the arrow that opened the drawer');
  });

  test('A/P: bills the same way', () => {
    render(<APAgingReportView />);
    const [power] = bodyRows(/Payables aging/);
    assert.match(power, /^Power Co-\$300\.00---\$300\.00/);
  });
});
