/**
 * The payment dialog (H-03): it offers only what the server accepts (issued documents of that
 * customer or vendor, for what is still owed), spreads a payment over them oldest first, and sends
 * the server exactly the amounts shown. A refusal is shown and the dialog stays open.
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReceivePaymentModal from '../components/sales/ReceivePaymentModal';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { Workspace } from '../types';
import { makeBill, makeChartAccount, makeCustomer, makeInvoice, makeVendor } from './fixtures';

const user = { uid: 'u1', email: 'a@b.test', getIdToken: async () => 'token' };

function seed() {
  useAuthStore.setState({ user: user as never, currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD' } as Workspace] });
  useLedgerStore.setState({
    accounts: [makeChartAccount({ id: 'bank', name: 'Checking', type: 'asset', category: 'Cash' })],
    customers: [makeCustomer({ id: 'c1', name: 'Acme Ltd' }), makeCustomer({ id: 'c2', name: 'Other' })],
    vendors: [makeVendor({ id: 'v1', name: 'Paper Co' })],
    invoices: [
      // newest first, as the store keeps them
      makeInvoice({ id: 'i2', number: 'INV-2', customerId: 'c1', status: 'partial' as never, amountCents: 10000, amountPaidCents: 2000, date: '2026-09-01' }),
      makeInvoice({ id: 'i1', number: 'INV-1', customerId: 'c1', status: 'sent', amountCents: 10000, date: '2026-08-01' }),
      makeInvoice({ id: 'i3', number: 'INV-3', customerId: 'c1', status: 'draft', amountCents: 5000 }),
      makeInvoice({ id: 'i4', number: 'INV-4', customerId: 'c1', status: 'void', amountCents: 5000 }),
      makeInvoice({ id: 'i5', number: 'INV-5', customerId: 'c2', status: 'sent', amountCents: 5000 }),
    ],
    bills: [makeBill({ id: 'b1', number: 'A-1', vendorId: 'v1', status: 'pending', amountCents: 4000 })],
  });
}

const click = (text: string) => act(async () => { fireEvent.click(screen.getByText(text)); });

describe('Payment dialog', () => {
  beforeEach(seed);
  afterEach(() => cleanup());

  test('a customer payment is spread over that customer\'s open invoices, oldest first', async () => {
    const calls = stubFetchWithBodies(200, { status: 'success' });
    let closed = 0;
    render(<ReceivePaymentModal isOpen onClose={() => { closed++; }} />);
    fireEvent.change(screen.getByLabelText(/^Customer/), { target: { value: 'c1' } });
    const row = (n: string) => screen.queryByLabelText(`Allocation amount for document ${n}`);
    assert.ok(row('INV-1') && row('INV-2'));
    assert.equal(row('INV-3'), null, 'drafts can\'t be paid');
    assert.equal(row('INV-4'), null, 'void invoices can\'t be paid');
    assert.equal(row('INV-5'), null, 'another customer\'s invoice');
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '150' } });
    await click('Apply to oldest first');
    await click('Record & Post Payment');
    await waitFor(() => assert.equal(closed, 1));
    const post = calls.find(c => c.url === '/api/v1/payments');
    assert.ok(post, 'posted to the server');
    const body = post.body as Record<string, unknown>;
    assert.equal(body.amountCents, 15000);
    assert.equal(body.customerId, 'c1');
    assert.equal(body.cashAccountId, 'bank');
    assert.deepEqual(body.allocations, [
      { documentId: 'i1', documentType: 'invoice', amountCents: 10000 },
      { documentId: 'i2', documentType: 'invoice', amountCents: 5000 },
    ]);
  });

  test('opened from an invoice: the amount still owed is filled in', async () => {
    stubFetchWithBodies(200, {});
    render(<ReceivePaymentModal isOpen onClose={() => {}} defaultContactId="c1" defaultDocumentId="i2" />);
    await waitFor(() => assert.equal((screen.getByLabelText(/Amount/) as HTMLInputElement).value, '80.00'));
    assert.equal((screen.getByLabelText('Allocation amount for document INV-2') as HTMLInputElement).value, '80.00');
  });

  test('a vendor payment lists that vendor\'s bills; a refusal keeps the dialog open', async () => {
    const calls = stubFetchWithBodies(400, { status: 'error', message: 'This period is locked' });
    let closed = 0;
    render(<ReceivePaymentModal isOpen onClose={() => { closed++; }} defaultDirection="made" defaultContactId="v1" defaultDocumentId="b1" />);
    await waitFor(() => assert.equal((screen.getByLabelText(/Amount/) as HTMLInputElement).value, '40.00'));
    await click('Record & Post Payment');
    await waitFor(() => assert.ok(calls.some(c => c.url === '/api/v1/payments')));
    const body = calls.find(c => c.url === '/api/v1/payments')!.body as Record<string, unknown>;
    assert.equal(body.vendorId, 'v1');
    assert.deepEqual(body.allocations, [{ documentId: 'b1', documentType: 'bill', amountCents: 4000 }]);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(closed, 0);
  });
});

describe('Paying a foreign-currency invoice (L-192)', () => {
  beforeEach(() => {
    seed();
    useLedgerStore.setState({ invoices: [makeInvoice({ id: 'e1', number: 'EUR-1', customerId: 'c1', status: 'sent', amountCents: 10000, currency: 'EUR', exchangeRate: 1.1, date: '2026-09-01' })] });
  });
  afterEach(() => cleanup());

  test('amounts in the invoice\'s currency, the day\'s rate filled from the rate service, the difference shown and sent', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: JSON.parse(String(init?.body || '{}')) });
      if (url.includes('/fx/rate')) return new Response(JSON.stringify({ rate: 1.15 }), { status: 200 });
      return new Response(JSON.stringify({ status: 'success' }), { status: 200 });
    }) as typeof fetch;
    let closed = 0;
    render(<ReceivePaymentModal isOpen onClose={() => { closed++; }} defaultContactId="c1" defaultDocumentId="e1" />);
    await waitFor(() => assert.ok(screen.getByLabelText('Payment Amount (EUR) *')));
    await waitFor(() => assert.equal((screen.getByLabelText('USD for 1 EUR on the payment day') as HTMLInputElement).value, '1.15'));
    assert.match(screen.getByText(/Arrives as/).textContent || '', /Arrives as \$115\.00; exchange gain \$5\.00 against the document's rate \(1\.1\)/);
    await click('Record & Post Payment');
    await waitFor(() => assert.equal(closed, 1));
    const body = calls.find(c => c.url === '/api/v1/payments')!.body;
    assert.deepEqual([body.amountCents, body.paymentExchangeRate], [10000, 1.15]);
  });

  test('without a rate it is booked at the invoice\'s rate, and says so', async () => {
    stubFetchWithBodies(503, {});
    render(<ReceivePaymentModal isOpen onClose={() => {}} defaultContactId="c1" defaultDocumentId="e1" />);
    await waitFor(() => assert.ok(screen.getByText(/Without it, the payment is booked at the document's rate \(1\.1\)/)));
  });
});

describe('Payment dialog: an answer that cannot be read (#939)', () => {
  beforeEach(seed);
  afterEach(() => cleanup());
  const open = (onClose: () => void) => render(<ReceivePaymentModal isOpen onClose={onClose} defaultContactId="c1" defaultDocumentId="i2" />);

  test('a 2xx with a cut-off body is a recorded payment: the dialog closes instead of asking for a second one', async () => {
    let posts = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/payments') posts++;
      return new Response('{"status":"success","data":', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    let closed = 0;
    open(() => { closed++; });
    await waitFor(() => assert.equal((screen.getByLabelText(/Amount/) as HTMLInputElement).value, '80.00'));
    await click('Record & Post Payment');
    await waitFor(() => assert.equal(closed, 1));
    assert.equal(posts, 1);
  });

  test('no answer at all keeps the dialog, and pressing Record again replays the same operation id', async () => {
    const ids: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/payments') {
        ids.push(new Headers(init?.headers).get('x-operation-id') || '');
        throw new TypeError('Failed to fetch');
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    let closed = 0;
    open(() => { closed++; });
    await waitFor(() => assert.equal((screen.getByLabelText(/Amount/) as HTMLInputElement).value, '80.00'));
    await click('Record & Post Payment');
    await waitFor(() => assert.equal(ids.length, 1));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(closed, 0, 'an unknown outcome is not reported as saved');
    await click('Record & Post Payment');
    await waitFor(() => assert.equal(ids.length, 2));
    assert.ok(ids[0]);
    assert.equal(ids[1], ids[0], 'a retry cannot post a second payment');
  });
});
