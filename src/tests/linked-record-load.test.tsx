import './helpers/dom';
import React from 'react';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import InvoiceRecordPage from '../components/sales/InvoiceRecordPage';
import BillRecordPage from '../components/purchases/BillRecordPage';
import TransactionGrid from '../components/ledger/TransactionGrid';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';
import { setComponentWorkspace } from './helpers/componentFixtures';
import type { LedgerKey } from '../lib/ledgerCollections';
import { makeTransaction } from './fixtures';

const retry = useDataNeedsStore.getState().retry;
const noop = () => {};
const id = 'linked-record';
const pages = {
  invoice: <InvoiceRecordPage invoiceId={id} onBack={noop} onEdit={noop} onSendEmail={noop}
    onReceivePayment={noop} onPreviewPdf={noop} onDownloadPdf={noop} onVoid={noop} onOpenCustomer={noop} />,
  bill: <BillRecordPage billId={id} onBack={noop} onEdit={noop} onPay={noop} onPreviewPdf={noop}
    onVoid={noop} onOpenVendor={noop} onApproveClaim={noop} />,
  transaction: <TransactionGrid />,
};

const cases = [
  ['invoice', 'invoices', 'invoices'],
  ['bill', 'bills', 'bills'],
  ['transaction', 'transactions', 'entries'],
] as const;
afterEach(() => {
  cleanup();
  useUIStore.setState({ focusRecord: null });
  useDataNeedsStore.setState({ retry, loaded: {}, failed: {} });
});

for (const [kind, key, label] of cases) {
  test(`linked ${kind} distinguishes loading, failed read, retry and a missing record`, () => {
    setComponentWorkspace();
    useLedgerStore.setState({ invoices: [], bills: [], transactions: [] });
    if (kind === 'transaction') useUIStore.setState({ focusRecord: { type: kind, id } });
    const attempted: LedgerKey[] = [];
    useDataNeedsStore.setState({ loaded: {}, failed: {}, retry: collection => {
      attempted.push(collection);
      useDataNeedsStore.setState({ failed: { auditLogs: 'Audit history unavailable' } });
    } });
    render(pages[kind]);
    assert.ok(screen.getByText(`Loading ${kind}…`).closest('[role="status"]'));
    if (kind === 'transaction') assert.ok(screen.getByRole('dialog', { name: 'Transaction' }));
    act(() => useDataNeedsStore.setState({ failed: { [key]: 'Service unavailable', auditLogs: 'Audit history unavailable' } }));
    assert.ok(screen.getByText(new RegExp(`Couldn't load ${label}`)));
    assert.equal(screen.queryByText(/not found/i), null);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    assert.deepEqual(attempted, [key], 'an unrelated collection error does not receive the retry');
    assert.ok(screen.getByText(`Loading ${kind}…`).closest('[role="status"]'));
    act(() => useDataNeedsStore.setState({ loaded: { [key]: true } }));
    assert.ok(screen.getByRole('heading', { name: new RegExp(`^${kind} not found$`, 'i') }));
    assert.equal(screen.queryByRole('button', { name: 'Try again' }), null);
  });
}

test('transaction retry, follow-on links and reopening use the correct editor draft', async t => {
  const workspace = setComponentWorkspace();
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.match(url, /\/entry-links\?transactionId=/);
    return Response.json({ links: [] });
  });
  const linked = { type: 'transaction', id } as const;
  const tx = makeTransaction({ id, workspaceId: workspace.id, description: 'Linked ledger entry' });
  const neighbor = makeTransaction({ id: 'other-entry', workspaceId: workspace.id, description: 'Another ledger entry' });
  useLedgerStore.setState({ transactions: [] });
  useUIStore.setState({ focusRecord: linked, activeTab: 'transactions' });
  useDataNeedsStore.setState({ loaded: {}, failed: { transactions: 'Service unavailable' }, retry: () => {
    useDataNeedsStore.setState({ loaded: { transactions: true }, failed: {} });
    useLedgerStore.setState({ transactions: [tx, neighbor] });
  } });
  render(<TransactionGrid />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
  const editor = () => screen.getByRole('dialog', { name: 'Edit Ledger Entry details' });
  const description = () => (screen.getByLabelText('Description', { exact: true }) as HTMLInputElement).value;
  assert.equal(screen.getAllByRole('dialog').length, 1);
  assert.equal(description(), tx.description);
  const otherLink = { type: 'transaction', id: neighbor.id } as const;
  await act(async () => useUIStore.getState().openRecord(otherLink));
  assert.equal(description(), neighbor.description);
  fireEvent.keyDown(editor(), { key: 'Escape' });
  assert.equal(screen.queryByRole('dialog'), null);
  assert.equal(useUIStore.getState().focusRecord, null);
  await act(async () => useUIStore.getState().openRecord(linked));
  assert.ok(editor());
  assert.equal(description(), tx.description);
});
