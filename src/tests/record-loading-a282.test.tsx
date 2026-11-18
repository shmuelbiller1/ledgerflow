import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import InvoiceRecordPage from '../components/sales/InvoiceRecordPage';
import BillRecordPage from '../components/purchases/BillRecordPage';
import TransactionGrid from '../components/ledger/TransactionGrid';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useUIStore } from '../stores/useUIStore';
import { getSupabase } from '../lib/db/client';
import { makeBill, makeInvoice, makeTransaction } from './fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { stubFetch } from './helpers/dom';

const originalFetch = globalThis.fetch;
const invoice = makeInvoice({ id: 'linked-invoice', number: 'INV-42', workspaceId: 'component-workspace' });
const bill = makeBill({ id: 'linked-bill', number: 'B-42', workspaceId: 'component-workspace' });
const transaction = makeTransaction({ id: 'linked-entry', description: 'Ledger link', workspaceId: 'component-workspace',
  lines: [{ accountId: 'cash', amountCents: 1000 }, { accountId: 'income', amountCents: -1000 }], totalAmountCents: 1000 });

beforeEach(() => {
  setComponentWorkspace();
  useUIStore.setState({ language: 'en', focusRecord: null, activeTab: 'transactions', filterCriteria: null });
  window.history.replaceState(null, '', '#transactions');
  markComponentCollectionsLoaded('accounts', 'auditLogs', 'customers', 'payments', 'vendors');
  useLedgerStore.setState({ accounts: [], auditLogs: [], customers: [], payments: [], vendors: [],
    invoices: [], bills: [], transactions: [], truncatedCollections: {} });
  stubFetch(404);
});
afterEach(async () => {
  cleanup();
  window.history.replaceState(null, '', '#transactions');
  globalThis.fetch = originalFetch;
  await getSupabase().auth.dispose();
});

const invoicePage = (onBack = () => {}) => <InvoiceRecordPage invoiceId={invoice.id} onBack={onBack}
  onEdit={() => {}} onSendEmail={() => {}} onReceivePayment={() => {}}
  onPreviewPdf={() => {}} onDownloadPdf={() => {}} onVoid={() => {}} onOpenCustomer={() => {}} />;
const billPage = () => <BillRecordPage billId={bill.id} onBack={() => {}}
  onEdit={() => {}} onPay={() => {}} onPreviewPdf={() => {}} onVoid={() => {}}
  onOpenVendor={() => {}} onApproveClaim={() => {}} />;

test('A-282 invoice: loading → failed (not absent) → retry/loading → record', () => {
  render(invoicePage());
  assert.ok(screen.getByText('Loading invoice…'));
  assert.equal(screen.queryByRole('heading', { name: 'Invoice not found' }), null);
  act(() => useDataNeedsStore.getState().markFailed('invoices', 'Offline'));
  assert.ok(screen.getByRole('heading', { name: 'Invoice unavailable' }));
  assert.match(screen.getByRole('status').textContent || '', /Couldn't load invoices.*Offline/);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  assert.equal(useDataNeedsStore.getState().loaded.invoices, false);
  assert.ok(screen.getByText('Loading invoice…'));
  act(() => { useLedgerStore.setState({ invoices: [invoice] }); useDataNeedsStore.getState().markLoaded('invoices'); });
  assert.ok(screen.getByRole('heading', { name: 'Invoice INV-42' }));
});

test('A-282 invoice: a related collection failure stays visible on an already loaded record', () => {
  markComponentCollectionsLoaded('auditLogs', 'customers', 'invoices', 'payments', 'transactions');
  useLedgerStore.setState({ invoices: [invoice] });
  render(invoicePage());
  act(() => useDataNeedsStore.getState().markFailed('payments', 'Timed out'));
  assert.ok(screen.getByRole('heading', { name: 'Invoice INV-42' }));
  assert.match(screen.getByRole('status').textContent || '', /Couldn't load payments.*Timed out/);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  assert.equal(useDataNeedsStore.getState().loaded.payments, false);
});

test('A-282 bill: loading → failed → retry/loading → record', () => {
  render(billPage());
  assert.ok(screen.getByText('Loading bill…'));
  act(() => useDataNeedsStore.getState().markFailed('bills', 'Connection refused'));
  assert.ok(screen.getByRole('heading', { name: 'Bill unavailable' }));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  assert.ok(screen.getByText('Loading bill…'));
  act(() => { useLedgerStore.setState({ bills: [bill] }); useDataNeedsStore.getState().markLoaded('bills'); });
  assert.ok(screen.getByRole('heading', { name: 'Bill B-42' }));
});

test('A-282 transaction link: loading → failed → retry/loading → loaded detail; closing allows reopening the same link', () => {
  render(<TransactionGrid />);
  act(() => useUIStore.getState().openRecord({ type: 'transaction', id: transaction.id }));
  let dialog = screen.getByRole('dialog', { name: 'Loading transaction' });
  assert.ok(within(dialog).getByText('Loading transaction…'));
  assert.ok(dialog.contains(document.activeElement), 'focus enters the record panel while loading');
  act(() => useDataNeedsStore.getState().markFailed('transactions', 'Offline'));
  dialog = screen.getByRole('dialog', { name: 'Transaction unavailable' });
  assert.match(within(dialog).getByRole('status').textContent || '', /Couldn't load entries.*Offline/);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
  assert.equal(useDataNeedsStore.getState().loaded.transactions, false);
  dialog = screen.getByRole('dialog', { name: 'Loading transaction' });
  assert.ok(dialog.contains(document.activeElement), 'retry keeps keyboard focus in the panel');
  act(() => { useLedgerStore.setState({ transactions: [transaction] }); useDataNeedsStore.getState().markLoaded('transactions'); });
  dialog = screen.getByRole('dialog', { name: 'Edit Ledger Entry details' });
  fireEvent.keyDown(dialog, { key: 'Escape' });
  assert.equal(screen.queryByRole('dialog'), null);
  assert.equal(useUIStore.getState().focusRecord, null);
  act(() => useUIStore.getState().openRecord({ type: 'transaction', id: transaction.id }));
  assert.ok(screen.getByRole('dialog', { name: 'Edit Ledger Entry details' }));
});

test('A-282 transaction link: successful but missing is not confused with a failed read or a capped list', () => {
  markComponentCollectionsLoaded('transactions');
  render(<TransactionGrid />);
  act(() => useUIStore.getState().openRecord({ type: 'transaction', id: 'not-here' }));
  let dialog = screen.getByRole('dialog', { name: 'Transaction not found' });
  assert.equal(within(dialog).queryByRole('button', { name: 'Try again' }), null);
  act(() => useLedgerStore.setState({ truncatedCollections: { transactions: true } }));
  dialog = screen.getByRole('dialog', { name: 'Transaction not in loaded entries' });
  assert.match(dialog.textContent || '', /Only part of the ledger is loaded/);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  assert.equal(useUIStore.getState().focusRecord, null);
});
