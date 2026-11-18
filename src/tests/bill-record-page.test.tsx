import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import BillRecordPage from '../components/purchases/BillRecordPage';
import Purchases from '../components/purchases/Purchases';
import Sales from '../components/sales/Sales';
import { offeredSteps } from '../hooks/useCommand';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useUIStore } from '../stores/useUIStore';
import { getSupabase } from '../lib/db/client';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { makeBill, makeCustomer, makePayment, makeVendor } from './fixtures';
import { stubFetch } from './helpers/dom';
import type { Bill } from '../types';

const realFetch = globalThis.fetch;
const vendor = makeVendor({ id: 'vendor-1', name: 'נייר Paper Co', workspaceId: 'component-workspace' });
const currentBill = (overrides: Partial<Bill> = {}) => makeBill({
  id: 'bill-1', number: 'B-24', vendorId: vendor.id, vendorName: vendor.name,
  date: '2026-10-02', dueDate: '2026-11-02', amountCents: 12000,
  currency: 'USD', status: 'approved', workspaceId: 'component-workspace',
  splits: [{ amountCents: 12000, accountId: 'exp-1', description: 'Paper' }],
  ...overrides,
});

beforeEach(() => {
  stubFetch(404);
  const missingApi = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith('/next-number') ? Promise.resolve(Response.json({ number: 'B-25' })) : missingApi(input, init)) as typeof fetch;
  setComponentWorkspace();
  useUIStore.setState({ language: 'en', activeTab: 'purchases', focusRecord: null, newRecord: null });
  window.history.replaceState(null, '', '#purchases');
  markComponentCollectionsLoaded('accounts', 'auditLogs', 'bills', 'creditNotes', 'customers', 'invoices', 'inventory', 'payments', 'recurring', 'taxRates', 'vendors');
  useLedgerStore.setState({
    bills: [currentBill()], vendors: [vendor], customers: [], invoices: [], payments: [],
    auditLogs: [], accounts: [], inventory: [], recurring: [], taxRates: [], creditNotes: [],
  });
});
afterEach(async () => {
  cleanup();
  window.history.replaceState(null, '', '#purchases');
  globalThis.fetch = realFetch;
  await getSupabase().auth.dispose();
});

function mountRecord() {
  const selected: string[] = [];
  const view = render(<BillRecordPage billId="bill-1" onBack={() => selected.push('back')}
    onEdit={() => selected.push('edit')} onPay={() => selected.push('pay')}
    onPreviewPdf={() => selected.push('pdf')} onVoid={() => selected.push('void')}
    onOpenVendor={id => selected.push(id)} onApproveClaim={() => selected.push('approve')} />);
  return { selected, view };
}

function progressStep() {
  const progress = screen.queryByRole('navigation', { name: 'Record progress' });
  return progress?.querySelector('[aria-current="step"]')?.textContent || null;
}

describe('BillRecordPage on the shared record shell', () => {
  test('approved part-paid bill offers only the manifest payment action and links its real records', () => {
    const payment = makePayment({ id: 'pay-1', direction: 'made', contactId: vendor.id, reference: 'WIRE-123', amountCents: 10000,
      allocations: [{ documentType: 'bill', documentId: 'bill-1', amountCents: 3000 },
        { documentType: 'bill', documentId: 'other', amountCents: 7000 }], workspaceId: 'component-workspace' });
    const voidPayment = makePayment({ ...payment, id: 'pay-void', status: 'void', reference: 'VOID-WIRE' });
    const otherPayment = makePayment({ ...payment, id: 'pay-other', allocations: [{ documentType: 'bill', documentId: 'other', amountCents: 3000 }] });
    useLedgerStore.setState({ bills: [currentBill({ amountPaidCents: 3000 })], payments: [payment, voidPayment, otherPayment] });
    const { selected } = mountRecord();
    assert.ok(screen.getByRole('heading', { name: 'Bill B-24', level: 1 }));
    assert.match(progressStep() || '', /Approved/);
    assert.match(within(screen.getByRole('region', { name: 'Related records' })).getByText('Payments (1)').textContent || '', /1/);
    assert.ok(screen.getByText('WIRE-123'));
    assert.match(screen.getByText('WIRE-123').closest('li')?.textContent || '', /\$30\.00/);
    assert.doesNotMatch(screen.getByText('WIRE-123').closest('li')?.textContent || '', /\$100\.00/, 'only the bill allocation is shown');
    assert.equal(screen.queryByText('VOID-WIRE'), null);
    assert.match(screen.getByText('Still due').parentElement?.textContent || '', /\$90\.00/);
    const paymentLabel = offeredSteps('bill.update').find(step => step.command === 'payment.receive')?.label;
    assert.ok(paymentLabel);
    fireEvent.click(screen.getByRole('button', { name: paymentLabel }));
    assert.deepEqual(selected, ['pay']);
    fireEvent.click(screen.getByRole('button', { name: vendor.name }));
    assert.deepEqual(selected, ['pay', vendor.id]);
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    assert.deepEqual(selected, ['pay', vendor.id, 'pdf']);
  });

  test('draft and pending bills review in the existing editor before payment can be offered', () => {
    const { selected } = mountRecord();
    act(() => { useLedgerStore.setState({ bills: [currentBill({ status: 'draft' })] }); });
    assert.match(progressStep() || '', /Entered/);
    assert.equal(screen.queryByRole('button', { name: 'Pay this bill' }), null);
    fireEvent.click(screen.getByRole('button', { name: 'Review and approve' }));
    assert.deepEqual(selected, ['edit']);
    act(() => { useLedgerStore.setState({ bills: [currentBill({ status: 'pending' })] }); });
    assert.match(progressStep() || '', /Approved/);
    assert.ok(screen.getByRole('button', { name: 'Review and approve' }));
  });

  test('settled or void bills show zero still due and cannot offer another payment', () => {
    mountRecord();
    act(() => { useLedgerStore.setState({ bills: [currentBill({ status: 'paid', amountPaidCents: 0 })] }); });
    assert.match(progressStep() || '', /Paid/);
    assert.equal(screen.queryByRole('button', { name: 'Pay this bill' }), null);
    assert.match(screen.getByText('Still due').parentElement?.textContent || '', /\$0\.00/);
    act(() => { useLedgerStore.setState({ bills: [currentBill({ status: 'void' })] }); });
    assert.equal(screen.queryByRole('navigation', { name: 'Record progress' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Pay this bill' }), null);
    assert.match(screen.getByText('Still due').parentElement?.textContent || '', /\$0\.00/);
    assert.match(screen.getByText('Paid').parentElement?.textContent || '', /\$0\.00/);
  });

  test('claim approvals follow the existing approver role, with no payment before approval', () => {
    const claim = { state: 'submitted' as const, submittedBy: 'claimant', submittedAt: '2026-10-02T00:00:00Z' };
    useLedgerStore.setState({ bills: [currentBill({ status: 'draft', metadata: { expenseClaim: claim } })] });
    const { selected } = mountRecord();
    for (const label of ['Pay this bill', 'Edit bill', 'Edit lines & tax', 'Void']) {
      assert.equal(screen.queryByRole('button', { name: label }), null, `${label} must not bypass claim approval`);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Approve claim' }));
    assert.deepEqual(selected, ['approve']);
    cleanup();
    setComponentWorkspace('bookkeeper');
    mountRecord();
    assert.equal(screen.queryByRole('button', { name: 'Approve claim' }), null);
    assert.match(screen.getByRole('status').textContent || '', /Only owners and accountants approve/);
    cleanup();
    setComponentWorkspace('accountant');
    useLedgerStore.setState({ bills: [currentBill({ status: 'draft', metadata: { expenseClaim: { ...claim, submittedBy: 'test-user' } } })] });
    mountRecord();
    assert.equal(screen.queryByRole('button', { name: 'Approve claim' }), null, 'accountants cannot approve their own claim');
  });

  test('viewers can see the page and PDF, but no edit, void or payment controls', () => {
    setComponentWorkspace('viewer');
    mountRecord();
    assert.ok(screen.getByRole('heading', { name: 'Bill B-24' }));
    assert.ok(screen.getByRole('button', { name: 'Preview PDF' }));
    assert.equal(screen.queryByRole('button', { name: 'Pay this bill' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Edit bill' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Void' }), null);
  });

  test('a failed bill load offers retry instead of claiming the record is absent', () => {
    useLedgerStore.setState({ bills: [] });
    useDataNeedsStore.setState(s => ({ loaded: { ...s.loaded, bills: false }, failed: { bills: 'Offline' } }));
    mountRecord();
    assert.ok(screen.getByRole('heading', { name: 'Bill unavailable' }));
    assert.match(screen.getByRole('status').textContent || '', /Couldn't load bills.*Offline/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    assert.ok(screen.getByText('Loading bill…'));
    assert.equal(useDataNeedsStore.getState().failed.bills, undefined);
  });

  test('a missing bill gives a working recovery action', () => {
    const { view, selected } = mountRecord();
    view.rerender(<BillRecordPage billId="deleted" onBack={() => selected.push('back')}
      onEdit={() => {}} onPay={() => {}} onPreviewPdf={() => {}} onVoid={() => {}}
      onOpenVendor={() => {}} onApproveClaim={() => {}} />);
    assert.ok(screen.getByRole('heading', { name: 'Bill not found' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to bills' }));
    assert.deepEqual(selected, ['back']);
  });
});

test('Purchases opens a bill from its list, retains the editor and returns focus to its row', async () => {
  const view = render(<Purchases />);
  const opener = screen.getByRole('button', { name: 'Open bill B-24' });
  opener.focus();
  await act(async () => { fireEvent.click(opener); });
  assert.ok(screen.getByRole('heading', { name: 'Bill B-24' }));
  assert.equal(useUIStore.getState().focusRecord?.id, 'bill-1');
  assert.equal(window.location.hash, '#purchases/bill/bill-1');
  fireEvent.click(screen.getByRole('button', { name: 'Edit bill' }));
  assert.ok(screen.getByRole('dialog', { name: 'Edit bill B-24' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Edit bill B-24' }), null));
  fireEvent.click(screen.getByRole('button', { name: 'Back to bills' }));
  await waitFor(() => assert.equal(document.activeElement?.getAttribute('aria-label'), 'Open bill B-24'));
  assert.equal(useUIStore.getState().focusRecord, null);
  assert.equal(window.location.hash, '#purchases');
  view.unmount();
});

test('Purchases only offers Pay in the bill row after approval, with a vendor and an amount due', () => {
  const claim = { state: 'submitted' as const, submittedBy: 'claimant', submittedAt: '2026-10-02T00:00:00Z' };
  act(() => useLedgerStore.setState({ bills: [
    currentBill({ id: 'draft', number: 'D-1', status: 'draft' }),
    currentBill({ id: 'waiting', number: 'W-1', status: 'pending' }),
    currentBill({ id: 'claim', number: 'C-1', status: 'draft', metadata: { expenseClaim: claim } }),
    currentBill({ id: 'no-vendor', number: 'N-1', vendorId: '' }),
    currentBill({ id: 'settled', number: 'S-1', amountPaidCents: 12000 }),
    currentBill({ id: 'approved', number: 'A-1' }),
  ] }));
  render(<Purchases />);
  const payFor = (number: string) => {
    const row = screen.getByRole('button', { name: `Open bill ${number}` }).closest('tr');
    assert.ok(row, `${number} has a list row`);
    return within(row).queryByRole('button', { name: 'Pay' });
  };
  for (const number of ['D-1', 'W-1', 'C-1', 'N-1', 'S-1']) {
    assert.equal(payFor(number), null, `${number} cannot be paid`);
  }
  const claimRow = screen.getByRole('button', { name: 'Open bill C-1' }).closest('tr')!;
  assert.equal(within(claimRow).queryByRole('button', { name: 'Edit bill C-1' }), null);
  assert.equal(within(claimRow).queryByRole('button', { name: 'Void' }), null);
  assert.equal(within(claimRow).queryByRole('button', { name: 'Delete draft bill C-1' }), null);
  assert.ok(payFor('A-1'), 'an approved bill with an amount due offers Pay');
});

test('Purchases leaves viewers a readable list without create or payment buttons', () => {
  setComponentWorkspace('viewer');
  render(<Purchases />);
  assert.ok(screen.getByRole('button', { name: 'Open bill B-24' }));
  assert.equal(screen.queryByRole('button', { name: 'Record Bill' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Pay' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Edit bill B-24' }), null);
});

test('party record next-step actions open the existing forms with the correct party selected', () => {
  useLedgerStore.setState({ customers: [makeCustomer({ id: 'cust-1', name: 'Acme', workspaceId: 'component-workspace' })] });
  const sales = render(<Sales />);
  fireEvent.click(screen.getByRole('button', { name: 'Customers' }));
  fireEvent.click(screen.getByRole('button', { name: 'View customer Acme' }));
  assert.ok(screen.getByRole('heading', { name: 'Acme', level: 1 }));
  const invoiceLabel = offeredSteps('customer.update').find(step => step.command === 'invoice.create')?.label;
  assert.ok(invoiceLabel);
  fireEvent.click(screen.getByRole('button', { name: invoiceLabel }));
  assert.ok(screen.getByRole('dialog', { name: /New Invoice/i }));
  assert.equal((screen.getByLabelText('Customer') as HTMLInputElement).value, 'Acme');
  sales.unmount();

  const purchases = render(<Purchases />);
  fireEvent.click(screen.getByRole('button', { name: /Vendors \(1\)/ }));
  fireEvent.click(screen.getByRole('button', { name: `View vendor ${vendor.name}` }));
  assert.ok(screen.getByRole('heading', { name: vendor.name, level: 1 }));
  const billLabel = offeredSteps('vendor.update').find(step => step.command === 'bill.create')?.label;
  assert.ok(billLabel);
  fireEvent.click(screen.getByRole('button', { name: billLabel }));
  assert.ok(screen.getByRole('dialog', { name: 'Record New Bill' }));
  assert.equal((screen.getByLabelText('Vendor') as HTMLSelectElement).value, vendor.id);
  purchases.unmount();
});
