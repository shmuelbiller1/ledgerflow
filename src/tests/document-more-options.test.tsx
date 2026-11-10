import { stubFetch } from './helpers/dom';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import DocumentMoreOptions from '../components/common/DocumentMoreOptions';
import InvoiceModal from '../components/sales/InvoiceModal';
import BillModal from '../components/purchases/BillModal';
import { hasInvoiceOptions, hasBillOptions } from '../lib/documentOptions';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { Invoice } from '../types';

beforeEach(() => {
  stubFetch(404); localStorage.clear();
  useAuthStore.setState({ user: { uid: 'person-a' } as never, currentWorkspaceId: 'options-book', workspaces: [{ id: 'options-book', currency: 'USD' } as never] });
  useLedgerStore.setState({ inventory: [], invoices: [], bills: [], taxRates: [] });
});
afterEach(cleanup);

const extras = { attachments: 0 };
const field = <input aria-label="Optional field" defaultValue="Kept while collapsed" />;

test('standard generated defaults stay short; meaningful optional invoice values expand', () => {
  assert.equal(hasInvoiceOptions({ number: 'INV-123', status: 'pending', type: 'standard', paymentTerms: 'due_on_receipt', currency: 'USD', exchangeRate: 1 }, 'USD', extras), false);
  for (const invoice of [
    { retainageCents: 500 }, { depositCents: 1000 }, { discountCents: 10 },
    { type: 'recurring' }, { type: 'progress' }, { progressPercentage: 20 },
    { milestone: 'Stage two' }, { paymentTerms: 'net_30' }, { currency: 'EUR' },
    { exchangeRate: 1.2 }, { status: 'sent' }, { recurringInterval: 'monthly' },
  ] satisfies Partial<Invoice>[]) assert.equal(hasInvoiceOptions(invoice, 'USD', extras), true, JSON.stringify(invoice));
  for (const extra of [{ memo: 'Note' }, { terms: 'Terms' }, { emailSubject: 'Invoice attached' }, { attachments: 1 }]) {
    assert.equal(hasInvoiceOptions({}, 'USD', { ...extras, ...extra }), true);
  }
});

test('bill defaults stay short; currency, repeat, memo and files are not hidden', () => {
  assert.equal(hasBillOptions({ number: 'BILL-123', status: 'pending', currency: 'USD', exchangeRate: 1 }, 'USD', { ...extras, repeat: '' }), false);
  assert.equal(hasBillOptions({ currency: 'EUR' }, 'USD', { ...extras, repeat: '' }), true);
  assert.equal(hasBillOptions({}, 'USD', { ...extras, repeat: 'monthly' }), true);
  assert.equal(hasBillOptions({}, 'USD', { ...extras, repeat: '', memo: 'Note' }), true);
  assert.equal(hasBillOptions({}, 'USD', { attachments: 1, repeat: '' }), true);
});

test('display preference is remembered per person and form, without unmounting fields', () => {
  const props = { kind: 'invoice' as const, documentKey: 'new', hasValues: false };
  const view = render(<DocumentMoreOptions {...props}>{field}</DocumentMoreOptions>);
  const details = () => view.container.querySelector('details')!;
  assert.equal(details().open, false);
  fireEvent.click(view.getByText('More options'));
  assert.equal(details().open, true);
  fireEvent.change(view.getByLabelText('Optional field'), { target: { value: 'Typed draft' } });
  fireEvent.click(view.getByText('More options'));
  assert.equal((view.getByLabelText('Optional field') as HTMLInputElement).value, 'Typed draft');
  fireEvent.click(view.getByText('More options'));
  view.rerender(<DocumentMoreOptions {...props} documentKey="another">{field}</DocumentMoreOptions>);
  assert.equal(details().open, true);
  view.rerender(<DocumentMoreOptions {...props} kind="bill">{field}</DocumentMoreOptions>);
  assert.equal(details().open, false);
  act(() => useAuthStore.setState({ user: { uid: 'person-b' } as never }));
  view.rerender(<DocumentMoreOptions {...props}>{field}</DocumentMoreOptions>);
  assert.equal(details().open, false);
});

test('populated options auto-open without replacing the remembered preference', () => {
  const props = { kind: 'invoice' as const, documentKey: 'new', hasValues: false };
  const view = render(<DocumentMoreOptions {...props}>{field}</DocumentMoreOptions>);
  view.rerender(<DocumentMoreOptions {...props} hasValues>{field}</DocumentMoreOptions>);
  assert.equal(view.container.querySelector('details')!.open, true);
  assert.equal(localStorage.getItem('lf_document_more_options:person-a:invoice'), null);
  fireEvent.click(view.getByText('More options'));
  assert.equal(view.container.querySelector('details')!.open, false, 'a person may still collapse populated options');
  view.rerender(<DocumentMoreOptions {...props} documentKey="other" hasValues>{field}</DocumentMoreOptions>);
  assert.equal(view.container.querySelector('details')!.open, true, 'another populated document must reveal its values');
});

test('native validation reveals a collapsed option before focus, without persisting auto-open', () => {
  const view = render(<DocumentMoreOptions kind="invoice" documentKey="new" hasValues={false}><input required aria-label="Required option" /></DocumentMoreOptions>);
  fireEvent.invalid(view.getByLabelText('Required option'));
  assert.equal(view.container.querySelector('details')!.open, true);
  assert.equal(localStorage.getItem('lf_document_more_options:person-a:invoice'), null);
});

for (const value of [{ retainageCents: 500 }, { depositCents: 1000 }]) {
  test(`invoice with ${Object.keys(value)[0]} opens More options`, () => {
    const view = render(<InvoiceModal isOpen onClose={() => {}} onSave={() => {}} customers={[]} accounts={[]} initialInvoice={{ id: 'saved-invoice', ...value }} />);
    assert.equal(view.container.querySelector('details')!.open, true);
    assert.ok(view.getByLabelText(Object.hasOwn(value, 'retainageCents') ? 'Retainage (USD)' : 'Deposit (USD)'));
  });
}

test('a new invoice and bill retain every optional field in the collapsed DOM', () => {
  const invoice = render(<InvoiceModal isOpen onClose={() => {}} onSave={() => {}} customers={[]} accounts={[]} />);
  assert.equal(invoice.container.querySelector('details')!.open, false);
  for (const label of ['Invoice Number', 'Status', 'Invoice Type', 'Payment Terms', 'Deposit (USD)', 'Retainage (USD)', 'Currency', 'Exchange Rate', 'Customer Memo', 'Terms & Conditions', 'Email Subject']) assert.ok(invoice.getByLabelText(label));
  invoice.unmount();
  const bill = render(<BillModal isOpen onClose={() => {}} onSave={() => {}} vendors={[]} accounts={[]} />);
  assert.equal(bill.container.querySelector('details')!.open, false);
  for (const label of ['Bill Number', 'Status', 'Currency', 'Repeat', 'Internal Memo']) assert.ok(bill.getByLabelText(label));
});

test('editing a bill reveals and retains its saved internal memo', () => {
  const view = render(<BillModal isOpen onClose={() => {}} onSave={() => {}} vendors={[]} accounts={[]} initialBill={{ id: 'saved-bill', metadata: { memo: 'An existing note' } }} />);
  assert.equal(view.container.querySelector('details')!.open, true);
  assert.equal((view.getByLabelText('Internal Memo') as HTMLTextAreaElement).value, 'An existing note');
});
