import { stubFetch } from './helpers/dom';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { makeCustomer, makeVendor, makeInvoice, makeBill, makePayment } from './fixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import CustomerRecordPage from '../components/sales/CustomerRecordPage';
import VendorRecordPage from '../components/purchases/VendorRecordPage';
import ARAgingReportView from '../components/reporting/ARAgingReportView';
import APAgingReportView from '../components/reporting/APAgingReportView';
import StatementView from '../components/reporting/StatementView';

beforeEach(() => {
  stubFetch();
  setComponentWorkspace();
  markComponentCollectionsLoaded('customers', 'vendors', 'invoices', 'bills', 'payments');
  useLedgerStore.setState({
    customers: [makeCustomer({ name: 'לקוח Acme' })], vendors: [makeVendor({ name: 'ספק Supply' })],
    invoices: [makeInvoice({ number: 'INV-עברית', date: '2026-03-01', amountPaidCents: 2500 }), makeInvoice({ id: 'draft', status: 'draft', amountCents: 990000 }), makeInvoice({ id: 'void', status: 'void', amountCents: 880000 })],
    bills: [makeBill({ number: 'BILL-עברית', date: '2026-03-01', amountPaidCents: 2500 }), makeBill({ id: 'draft', status: 'draft', amountCents: 990000 }), makeBill({ id: 'void', status: 'void', amountCents: 880000 })],
    payments: [makePayment({ date: '2026-03-10', amountCents: 2500, reference: 'קבלה-1' }), makePayment({ id: 'made', contactId: 'vend-1', direction: 'made', date: '2026-03-10', amountCents: 2500, reference: 'תשלום-1' }), makePayment({ id: 'void', status: 'void', amountCents: 990000 })],
  });
});
// the Files panel (K-07) on contact pages opens the database client: close it so the test process ends
afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

for (const side of ['customer', 'vendor'] as const) {
  test(`${side} detail displays mixed-language identity and excludes draft/void amounts`, () => {
    let back = 0;
    const view = render(side === 'customer' ? <CustomerRecordPage customerId="cust-1" onBack={() => back++} /> : <VendorRecordPage vendorId="vend-1" onBack={() => back++} />);
    assert.ok(view.getByRole('heading', { name: side === 'customer' ? 'לקוח Acme' : 'ספק Supply' }));
    assert.match(view.getByText(side === 'customer' ? 'Outstanding Balance' : 'Outstanding Payable').parentElement!.textContent!, /\$75\.00/);
    assert.match(view.getByText(side === 'customer' ? 'Lifetime Sales' : 'Lifetime Purchases').parentElement!.textContent!, /\$100\.00/);
    assert.ok(view.getByText(side === 'customer' ? 'Ref: קבלה-1' : 'Ref: תשלום-1'));
    fireEvent.click(view.getByRole('button', { name: side === 'customer' ? 'Back to Customers' : 'Back to Vendors' }));
    assert.equal(back, 1);
  });
  test(`${side} detail provides recovery for a missing contact`, () => {
    let back = 0;
    const view = render(side === 'customer' ? <CustomerRecordPage customerId="missing" onBack={() => back++} /> : <VendorRecordPage vendorId="missing" onBack={() => back++} />);
    assert.ok(view.getByRole('heading', { name: side === 'customer' ? 'Customer not found' : 'Vendor not found' }));
    assert.ok(view.getByText('This record may have been deleted or belongs to another workspace.'));
    fireEvent.click(view.getByRole('button', { name: side === 'customer' ? 'Back to Customers' : 'Back to Vendors' }));
    assert.equal(back, 1);
  });
  test(`${side} aging searches Hebrew names, opens unpaid documents and closes the ledger`, () => {
    const view = render(side === 'customer' ? <ARAgingReportView /> : <APAgingReportView />);
    const name = side === 'customer' ? 'לקוח Acme' : 'ספק Supply';
    const row = view.getByText(name).closest('tr')!;
    assert.match(row.textContent!, /\$75\.00/);
    const search = view.getByRole('textbox');
    fireEvent.change(search, { target: { value: 'אין-התאמה' } });
    assert.equal(view.queryByText(name), null);
    assert.ok(view.getByText(/found matching criteria/));
    fireEvent.change(search, { target: { value: side === 'customer' ? 'לקוח' : 'ספק' } });
    fireEvent.click(view.getByText(name).closest('tr')!);
    assert.ok(view.getByRole('heading', { name: `Outstanding Ledger: ${name}` }));
    assert.ok(view.getByText(side === 'customer' ? '#INV-עברית' : '#BILL-עברית'));
    assert.equal(view.queryByText('#DRAFT'), null);
    fireEvent.click(view.getByRole('button', { name: 'Close' }));
    assert.equal(view.queryByRole('heading', { name: `Outstanding Ledger: ${name}` }), null);
  });
}

test('statement switches customer/vendor activity and applies the selected period', () => {
  const view = render(<StatementView startDate="2026-03-01" endDate="2026-03-31" />);
  assert.ok(view.getByText('#INV-עברית'));
  assert.ok(view.getByText('#קבלה-1'));
  assert.match(view.getByText('Ending Outstanding Balance').parentElement!.textContent!, /\$75\.00/);
  fireEvent.click(view.getByRole('button', { name: 'Vendor Statement' }));
  assert.equal(view.queryByText('#INV-עברית'), null);
  assert.ok(view.getByText('#BILL-עברית'));
  assert.ok(view.getByText('#תשלום-1'));
  fireEvent.change(view.getByLabelText('From'), { target: { value: '2026-03-11' } });
  assert.equal(view.queryByText('#BILL-עברית'), null);
  assert.equal(view.queryByText('#תשלום-1'), null);
  assert.match(view.getByText('Opening Balance').parentElement!.textContent!, /\$75\.00/);
});

test('statement with no contacts offers a clear selection instruction', () => {
  useLedgerStore.setState({ customers: [], vendors: [] });
  const view = render(<StatementView />);
  assert.ok(view.getByText('Please select a customer to view statement.'));
  assert.equal(view.queryByRole('button', { name: 'Preview PDF' }), null);
});
