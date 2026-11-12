// NOSONAR:S2187 — tests registered via describeSaveFailures DSL (see helpers/failureHarness.ts)
/**
 * Failure tests for the money saves on the sales side (PREV-5): an invoice (new and edited), a
 * customer credit note, a vendor credit and a payment, each through the screen that saves it, with
 * the server refusing, failing, unreachable, or slow while the user opens another workspace. The
 * cases themselves are in helpers/failureHarness.ts.
 */
import { describeSaveFailures, standardChart, WORKSPACE_A } from './helpers/failureHarness';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '../services/ledgerPost/postingKit';
import Sales from '../components/sales/Sales';
import CreditNotesView from '../components/finance/CreditNotesView';
import ReceivePaymentModal from '../components/sales/ReceivePaymentModal';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeBill, makeCustomer, makeInvoice, makeVendor } from './fixtures';

const ws = { workspaceId: WORKSPACE_A };
const value = (label: string | RegExp) => (screen.getByLabelText(label) as HTMLInputElement).value;
const type = (label: string | RegExp, text: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
const press = (text: string | RegExp) => act(async () => { fireEvent.click(screen.getByRole('button', { name: text })); });

function seedA() {
  useLedgerStore.setState({
    accounts: standardChart(),
    customers: [makeCustomer({ ...ws, id: 'c1', name: 'Acme Ltd' })],
    vendors: [makeVendor({ ...ws, id: 'v1', name: 'Paper Co' })],
    invoices: [makeInvoice({
      ...ws, id: 'a-inv', number: 'INV-7', customerId: 'c1', customerName: 'Acme Ltd', status: 'sent', date: '2026-10-01', dueDate: '2026-10-31',
      amountCents: 5000, items: [{ id: 'l1', description: 'Work', quantity: 1, rateCents: 5000, amountCents: 5000, accountId: 'sales' }],
    })],
    bills: [makeBill({ ...ws, id: 'a-bill', number: 'A-1', vendorId: 'v1', status: 'pending', amountCents: 4000, date: '2026-10-01' })],
    transactions: [],
    creditNotes: [],
    vendorCredits: [],
    payments: [],
  });
}

let paymentDialogClosed = 0;
const DRAFT_TEXT = 'Logo design, second round';

describeSaveFailures({
  name: 'invoice create (Sales screen)',
  collections: ['creditNotes', 'customers', 'invoices', 'payments'],
  async open() {
    seedA();
    render(<Sales />);
    fireEvent.click(await screen.findByText('Add Invoice'));
    type('Customer', 'Acme Ltd');
    type('Item / Description', DRAFT_TEXT);
    type(/^Rate/, '150');
  },
  save: () => act(async () => { fireEvent.click(screen.getByText('Save & Close')); }),
  draftKept() {
    assert.ok(screen.getByText('Save & Close'), 'the invoice dialog stays open');
    assert.equal(value('Customer'), 'Acme Ltd');
    assert.equal(value('Item / Description'), DRAFT_TEXT);
    assert.equal(value(/^Rate/), '150');
  },
});

describeSaveFailures({
  name: 'invoice update (Sales screen)',
  collections: ['creditNotes', 'customers', 'invoices', 'payments'],
  async open() {
    seedA();
    render(<Sales />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit invoice INV-7' }));
    type('Item / Description', DRAFT_TEXT);
    type(/^Rate/, '75');
  },
  save: () => act(async () => { fireEvent.click(screen.getByText('Save & Close')); }),
  draftKept() {
    assert.ok(screen.getByText('Edit invoice INV-7'), 'the invoice dialog stays open');
    assert.equal(value('Item / Description'), DRAFT_TEXT);
    assert.equal(value(/^Rate/), '75');
    assert.equal(useLedgerStore.getState().invoices.find(i => i.id === 'a-inv')?.amountCents, 5000, 'the saved invoice is as it was');
  },
});

describeSaveFailures({
  name: 'customer credit note (Credit notes screen)',
  collections: ['bills', 'creditNotes', 'customers', 'invoices', 'vendorCredits', 'vendors'],
  open() {
    seedA();
    render(<CreditNotesView />);
    fireEvent.click(screen.getAllByRole('button', { name: 'New Credit Note' })[0]);
    type('Select Customer', 'c1');
    type('Amount (USD)', '12.50');
  },
  save: () => press('Save & Post'),
  draftKept() {
    assert.ok(screen.getByRole('button', { name: 'Save & Post' }), 'the form stays open');
    assert.equal(value('Select Customer'), 'c1');
    assert.equal(value('Amount (USD)'), '12.50');
  },
});

describeSaveFailures({
  name: 'vendor credit (Credit notes screen)',
  collections: ['bills', 'creditNotes', 'customers', 'invoices', 'vendorCredits', 'vendors'],
  open() {
    seedA();
    render(<CreditNotesView />);
    fireEvent.click(screen.getByText('Vendor Credits (A/P)'));
    fireEvent.click(screen.getAllByRole('button', { name: 'New Vendor Credit' })[0]);
    type('Select Vendor', 'v1');
    type('Amount (USD)', '8.25');
  },
  save: () => press('Save & Post'),
  draftKept() {
    assert.ok(screen.getByRole('button', { name: 'Save & Post' }), 'the form stays open');
    assert.equal(value('Select Vendor'), 'v1');
    assert.equal(value('Amount (USD)'), '8.25');
  },
});

describeSaveFailures({
  name: 'payment received (payment dialog)',
  open() {
    seedA();
    paymentDialogClosed = 0;
    useLedgerStore.setState({ invoices: [makeInvoice({ ...ws, id: 'a-inv', number: 'INV-7', customerId: 'c1', status: 'sent', amountCents: 5000, date: '2026-10-01' })] });
    render(<ReceivePaymentModal isOpen onClose={() => { paymentDialogClosed++; }} defaultContactId="c1" defaultDocumentId="a-inv" />);
  },
  save: () => press('Record & Post Payment'),
  draftKept() {
    assert.equal(paymentDialogClosed, 0, 'the dialog stays open');
    assert.equal(value(/Amount/), '50.00');
    assert.equal(value('Allocation amount for document INV-7'), '50.00');
  },
});

describeSaveFailures({
  name: 'payment made (payment dialog)',
  open() {
    seedA();
    paymentDialogClosed = 0;
    render(<ReceivePaymentModal isOpen onClose={() => { paymentDialogClosed++; }} defaultDirection="made" defaultContactId="v1" defaultDocumentId="a-bill" />);
  },
  save: () => press('Record & Post Payment'),
  draftKept() {
    assert.equal(paymentDialogClosed, 0, 'the dialog stays open');
    assert.equal(value(/Amount/), '40.00');
  },
});

// describeSaveFailures (helpers/failureHarness.ts) registers the test bodies above.
// This describe block makes the suite visible to static analysis: SonarCloud S2187
// cannot see tests that are registered only inside the DSL helper.
describe('save failures (sales side)', () => {});

test('save-failures sales test module loads', () => {
  assert.ok(describeSaveFailures, 'describeSaveFailures is imported');
  assert.ok(standardChart, 'standardChart is imported');
  assert.ok(WORKSPACE_A, 'WORKSPACE_A is imported');
});
