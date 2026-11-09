/**
 * Spreading an invoice's income on the screen (K-16): the dialog proposes the biggest income line (lines
 * without an account count for the default income account; tax is not income), the Deferred Revenue
 * account, 12 months from the invoice's month, and sends one request; the invoice list offers
 * "Spread", and on a spread invoice shows its progress with "Undo spread"; re-posting the invoice
 * leaves the spread alone, and un-posting it is refused until the spread is undone.
 */
import './helpers/dom';
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import SpreadDialog from '../components/common/SpreadDialog';
import Sales from '../components/sales/Sales';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount } from './fixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { Invoice } from '../types';

const accounts = [
  makeChartAccount({ id: 'sales', code: '4000', name: 'Subscriptions', type: 'income', category: 'Revenue' }),
  makeChartAccount({ id: 'def', code: '2400', name: 'Deferred Revenue', type: 'liability', category: 'Current Liabilities' }),
  makeChartAccount({ id: 'ar', code: '1100', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' }),
  makeChartAccount({ id: 'bank', code: '1000', name: 'Checking', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'tax', code: '2200', name: 'Sales Tax Payable', type: 'liability', category: 'Taxes' }),
];
const invoice = {
  id: 'i1', uid: 'test-user', workspaceId: 'component-workspace', customerId: 'c1', customerName: 'Acme', number: 'INV-9', amountCents: 13200,
  status: 'sent', date: '2026-09-15', dueDate: '2026-10-15', currency: 'USD',
  items: [{ id: 'l1', description: 'Annual plan', quantity: 1, rateCents: 12000, amountCents: 12000, accountId: '' }],
} as Invoice;

describe('The spread dialog for an invoice', () => {
  beforeEach(() => {
    setComponentWorkspace('bookkeeper');
    useLedgerStore.setState({ accounts });
  });
  afterEach(() => cleanup());

  test('proposes the income without the tax over 12 months and posts it once', async () => {
    const calls = stubFetchWithBodies(200, { status: 'success', data: {} });
    let closed = 0;
    render(<SpreadDialog kind="invoice" document={invoice} onClose={() => closed++} />);
    assert.equal((screen.getByLabelText('Income account') as HTMLSelectElement).value, 'sales', 'the line has no account: the default income account');
    assert.equal((screen.getByLabelText('Deferred revenue account') as HTMLSelectElement).value, 'def');
    assert.equal((screen.getByLabelText('Amount (USD)') as HTMLInputElement).value, '120.00', 'the tax is not income');
    assert.match(document.body.textContent || '', /Invoice INV-9 to Acme: the income goes to Deferred Revenue on 2026-09-15/);
    assert.match(document.body.textContent || '', /\$10\.00 a month, 2026-09-30 to 2027-08-31\./);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Spread' })); });
    const sent = calls.filter(c => c.url.includes('/spread'));
    assert.deepEqual(sent.map(c => c.url), ['/api/v1/workspaces/component-workspace/invoices/i1/spread']);
    assert.deepEqual(sent[0].body, { revenueAccountId: 'sales', deferredAccountId: 'def', amountCents: 12000, months: 12, startMonth: '2026-09' });
    assert.equal(closed, 1);
  });

  test('without a Deferred Revenue account it says how to add one', () => {
    useLedgerStore.setState({ accounts: accounts.filter(a => a.id !== 'def') });
    stubFetchWithBodies(200, {});
    render(<SpreadDialog kind="invoice" document={invoice} onClose={() => {}} />);
    assert.equal(screen.getByRole('alert').textContent, 'Choose the Deferred Revenue account');
    assert.match(document.body.textContent || '', /No “Deferred Revenue” account yet/);
  });
});

describe('The invoice list', () => {
  beforeEach(() => {
    markComponentCollectionsLoaded('invoices', 'customers', 'payments', 'creditNotes');
  });
  afterEach(() => { cleanup(); });

  test('a sent invoice offers Spread; a spread one shows its progress and Undo; a draft offers neither', () => {
    setComponentWorkspace('owner');
    stubFetchWithBodies(200, []);
    const spread = { ...invoice, id: 'i2', number: 'INV-10', revenueSchedule: { id: 's', amountCents: 12000, months: 12, startMonth: '2026-01', revenueAccountId: 'sales', deferredAccountId: 'def', transactionIds: [], createdAt: '' } };
    useLedgerStore.setState({ accounts, customers: [{ id: 'c1', name: 'Acme' }] as never, invoices: [invoice, spread, { ...invoice, id: 'i3', number: 'INV-11', status: 'draft' }] });
    render(<Sales />);
    assert.ok(screen.getByRole('button', { name: 'Spread invoice INV-9 over months' }));
    assert.ok(screen.getByRole('button', { name: 'Undo the spread of invoice INV-10' }));
    assert.match(document.body.textContent || '', /Spread over 12 months from Jan 2026 · \d+ of 12 taken/);
    assert.equal(screen.queryByRole('button', { name: 'Spread invoice INV-11 over months' }), null);
    fireEvent.click(screen.getByRole('button', { name: 'Spread invoice INV-9 over months' }));
    assert.ok(screen.getByRole('dialog', { name: 'Spread over months' }));
  });

  test('a viewer sees no Spread', () => {
    setComponentWorkspace('viewer');
    stubFetchWithBodies(200, []);
    useLedgerStore.setState({ accounts, customers: [] as never, invoices: [invoice] });
    render(<Sales />);
    assert.equal(screen.queryByRole('button', { name: /Spread invoice/ }), null);
  });
});

describe('Re-posting a spread invoice', () => {
  const sent: Array<Array<{ metadata?: Record<string, unknown> }>> = [];
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  const capture = () => {
    sent.length = 0;
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      sent.push(JSON.parse(String(init?.body || '{}')).transactions || []);
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
  };
  const context = (transactions: unknown[]) => ({ lockDate: null, inventory: [], transactions, workspaces: [{ id: 'w1', uid: 'u1', name: 'W', currency: 'USD' }], accounts });
  const schedule = { id: 's', amountCents: 12000, months: 12, startMonth: '2026-09', revenueAccountId: 'sales', deferredAccountId: 'def', transactionIds: ['sp1'], createdAt: '' };
  const own = { id: 'own', date: '2026-09-15', status: 'completed', type: 'actual', totalAmountCents: 13200, metadata: { invoiceId: 'i1' }, lines: [{ accountId: 'ar', amountCents: 13200 }, { accountId: 'sales', amountCents: -13200 }] };
  const share = { id: 'sp1', date: '2027-08-31', status: 'completed', type: 'actual', totalAmountCents: 1000, metadata: { spreadOfInvoiceId: 'i1', prepaidScheduleId: 's', scheduled: true }, lines: [{ accountId: 'def', amountCents: 1000 }, { accountId: 'sales', amountCents: -1000 }] };

  test('an edit reverses only the invoice’s own entry; void or draft is refused until the spread is undone', async () => {
    capture();
    const { LedgerPostService } = await import('../services/LedgerPostService');
    await LedgerPostService.postInvoiceLedger('i1', { ...invoice, revenueSchedule: schedule }, 'w1', 'u1', undefined, context([own, share]) as never);
    assert.deepEqual(sent.flat().filter(t => t.metadata?.isReversal).map(t => t.metadata?.reversesTxId), ['own']);
    sent.length = 0;
    for (const status of ['void', 'draft'] as const) {
      await assert.rejects(LedgerPostService.postInvoiceLedger('i1', { ...invoice, status, revenueSchedule: schedule }, 'w1', 'u1', undefined, context([own, share]) as never), /undo the spread first/);
    }
    assert.equal(sent.length, 0);
  });
});
