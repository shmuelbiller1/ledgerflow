/**
 * The invoice dialog (H-01): what it saves is what the customer is billed. Lines, tax on top or
 * included, the total and the tax are saved explicitly (taxVersion 2); editing keeps the number
 * and the saved memo; nothing is saved without a customer.
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InvoiceModal from '../components/sales/InvoiceModal';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { Invoice, Workspace } from '../types';
import { makeChartAccount, makeCustomer } from './fixtures';

const customers = [makeCustomer({ id: 'c1', name: 'Acme Ltd' })];
const accounts = [makeChartAccount({ id: 'rev', name: 'Sales', type: 'income' })];

function setup(initialInvoice?: Partial<Invoice>) {
  const saved: Partial<Invoice>[] = [];
  render(<InvoiceModal isOpen onClose={() => {}} onSave={inv => { saved.push(inv); }} customers={customers} accounts={accounts} initialInvoice={initialInvoice} />);
  return saved;
}
const input = (label: RegExp | string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe('Invoice dialog', () => {
  beforeEach(() => {
    stubFetch(404);
    useAuthStore.setState({ currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD' } as Workspace] });
    useLedgerStore.setState({
      inventory: [],
      taxRates: [{ id: 'gst', uid: 'u', workspaceId: 'w1', name: 'GST', rate: 10, type: 'Sales', createdAt: '2026-01-01' }],
    });
  });
  // the Files panel (K-07) opens the database client: close it so the test process ends
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('two lines with 10% tax on top: the customer owes the lines plus the tax', async () => {
    const saved = setup();
    type(input('Customer'), 'Acme Ltd');
    type(input('Item / Description'), 'Design');
    type(input('Qty'), '2');
    type(input(/^Rate/), '150');
    type(screen.getByLabelText('Income Account'), 'Sales');
    fireEvent.click(screen.getByText('Add Item'));
    type(screen.getAllByLabelText('Item / Description')[1], 'Hosting');
    type(screen.getAllByLabelText(/^Rate/)[1], '49.99');
    fireEvent.change(screen.getByLabelText('Tax'), { target: { value: 'gst' } });

    const totals = screen.getByLabelText('Invoice totals');
    assert.match(totals.textContent || '', /\$349\.99/);
    assert.match(totals.textContent || '', /GST 10%\$35\.00/);

    await act(async () => { fireEvent.click(screen.getByText('Save Draft')); });
    await waitFor(() => assert.equal(saved.length, 1));
    const inv = saved[0];
    assert.equal(inv.status, 'draft');
    assert.equal(inv.customerId, 'c1');
    assert.equal(inv.lineSumCents, 34999);
    assert.equal(inv.taxAmountCents, 3500);
    assert.equal(inv.amountCents, 38499);
    assert.equal(inv.taxVersion, 2);
    assert.equal(inv.taxInclusive, true);
    assert.equal(inv.pricesIncludeTax, false);
    assert.equal(inv.currency, 'USD');
    assert.equal(inv.taxCodeId, 'gst');
    assert.deepEqual(inv.items?.map(i => [i.description, i.quantity, i.rateCents, i.amountCents, i.accountId]),
      [['Design', 2, 15000, 30000, 'rev'], ['Hosting', 1, 4999, 4999, '']]);
    assert.ok(!('totalCents' in inv), 'no stray totalCents field');
  });

  test('prices that include tax: the total is the lines, the tax is the part inside them', async () => {
    const saved = setup();
    type(input('Customer'), 'Acme Ltd');
    type(input('Item / Description'), 'Consulting');
    type(input(/^Rate/), '110');
    fireEvent.change(screen.getByLabelText('Tax'), { target: { value: 'gst' } });
    fireEvent.click(screen.getByLabelText('Prices include tax'));
    await act(async () => { fireEvent.click(screen.getByText('Save Draft')); });
    await waitFor(() => assert.equal(saved.length, 1));
    assert.equal(saved[0].amountCents, 11000);
    assert.equal(saved[0].taxAmountCents, 1000);
    assert.equal(saved[0].pricesIncludeTax, true);
  });

  test('editing keeps the number, the memo and the terms', async () => {
    const saved = setup({
      id: 'inv1', number: 'INV-7', customerId: 'c1', customerName: 'Acme Ltd', status: 'sent', date: '2026-09-01', dueDate: '2026-09-30',
      items: [{ id: 'l1', description: 'Work', quantity: 1, rateCents: 5000, amountCents: 5000, accountId: 'rev' }],
      metadata: { memo: 'Thanks!', terms: 'Net 30' },
    });
    assert.ok(screen.getByText('Edit invoice INV-7'));
    assert.equal((screen.getByLabelText('Customer Memo') as HTMLTextAreaElement).value, 'Thanks!');
    await act(async () => { fireEvent.click(screen.getByText('Save Draft')); });
    await waitFor(() => assert.equal(saved.length, 1));
    assert.equal(saved[0].id, 'inv1');
    assert.equal(saved[0].number, 'INV-7');
    assert.equal(saved[0].metadata?.memo, 'Thanks!');
    assert.equal(saved[0].metadata?.terms, 'Net 30');
    assert.equal(saved[0].amountCents, 5000);
  });

  test('a new invoice in a euro workspace is in euros; nothing is saved without a customer', async () => {
    useAuthStore.setState({ workspaces: [{ id: 'w1', name: 'W', currency: 'EUR' } as Workspace] });
    const saved = setup();
    assert.equal((screen.getByLabelText('Currency') as HTMLSelectElement).value, 'EUR');
    await act(async () => { fireEvent.click(screen.getByText('Save Draft')); });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(saved.length, 0);
  });

  test('the due date follows the terms and the invoice date; a customer brings their usual terms (L-186, I-23)', () => {
    useLedgerStore.setState({ invoices: [
      { id: 'old', customerId: 'c1', date: '2026-01-10', paymentTerms: 'net_15', status: 'paid', amountCents: 100 } as Invoice,
      { id: 'newer', customerId: 'c1', date: '2026-03-10', paymentTerms: 'net_60', status: 'sent', amountCents: 100 } as Invoice,
    ] });
    setup();
    type(input('Invoice Date'), '2026-05-01');
    type(screen.getByLabelText('Payment Terms'), 'net_30');
    assert.equal(input('Due Date').value, '2026-05-31');
    type(input('Invoice Date'), '2026-06-01');
    assert.equal(input('Due Date').value, '2026-07-01', 'moves with the date');
    type(input('Customer'), 'Acme Ltd');
    assert.equal((screen.getByLabelText('Payment Terms') as HTMLSelectElement).value, 'net_60', 'the terms of their latest invoice');
    assert.equal(input('Due Date').value, '2026-07-31');
  });

  test('all save actions report required fields under their input and retain the draft', async () => {
    const saved = setup();
    for (const action of ['Save Draft', 'Save & Close', 'Send Invoice']) {
      await act(async () => { fireEvent.click(screen.getByText(action)); });
      assert.equal(saved.length, 0);
      assert.equal(input('Customer').getAttribute('aria-invalid'), 'true');
      assert.ok(document.getElementById('inv-customer-error')?.textContent);
    }
    type(input('Customer'), 'Acme Ltd');
    assert.equal(document.getElementById('inv-customer-error'), null);
    type(input('Invoice Number'), '');
    await act(async () => { fireEvent.click(screen.getByText('Save Draft')); });
    assert.equal(saved.length, 0);
    assert.equal(input('Invoice Number').getAttribute('aria-invalid'), 'true');
    assert.equal(input('Customer').value, 'Acme Ltd');
  });

  test('a deposit error is associated with its field, keeps its help and focuses the correction', async () => {
    const saved = setup();
    type(input('Customer'), 'Acme Ltd');
    type(input(/^Deposit/), '1');
    await act(async () => { fireEvent.click(screen.getByText('Save Draft')); });
    assert.equal(saved.length, 0);
    assert.equal(input(/^Deposit/).getAttribute('aria-describedby'), 'inv-deposit-help inv-deposit-error');
    assert.equal(document.activeElement, input(/^Deposit/));
    assert.equal(document.getElementById('inv-deposit-error')?.textContent, "The deposit can't be more than the invoice total");
    type(input(/^Deposit/), '0');
    assert.equal(document.getElementById('inv-deposit-error'), null);
    await act(async () => { fireEvent.click(screen.getByText('Save Draft')); });
    assert.equal(saved.length, 1);
  });

  test('closing with unsaved changes asks first; untouched, it just closes (I-07)', () => {
    let closed = 0;
    const asked: string[] = [];
    let answer = false;
    window.confirm = (message?: string) => { asked.push(String(message)); return answer; };
    render(<InvoiceModal isOpen onClose={() => { closed++; }} onSave={() => {}} customers={customers} accounts={accounts} />);
    fireEvent.click(screen.getByText('Cancel'));
    assert.equal(closed, 1, 'nothing typed: closes without asking');
    assert.equal(asked.length, 0);
    type(input('Customer'), 'Acme Ltd');
    fireEvent.click(screen.getByText('Cancel'));
    assert.equal(closed, 1, 'kept open when the answer is no');
    assert.match(asked[0], /Discard your changes to this invoice/);
    answer = true;
    fireEvent.click(screen.getByLabelText('Close'));
    assert.equal(closed, 2);
  });
});
