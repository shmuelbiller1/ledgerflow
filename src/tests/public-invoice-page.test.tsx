/**
 * The page a customer opens from an invoice link (H-23): what is due after deposit and payments,
 * the Pay button asks the server for a checkout page, a paid invoice has no Pay button, a bad link
 * says so.
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PublicInvoicePage from '../components/sales/PublicInvoicePage';
import { makeInvoice } from './fixtures';

const open = (path: string) => window.history.pushState({}, '', path);

describe('public invoice page', () => {
  afterEach(() => cleanup());

  test('shows the total, the deposit, what was paid and what is still due, in the invoice currency', async () => {
    stubFetchWithBodies(200, { invoice: { ...makeInvoice({ number: 'INV-7', amountCents: 50000, depositCents: 10000, amountPaidCents: 15000, currency: 'EUR', dueDate: '2026-11-01', status: 'partially_paid', paymentToken: 'tok' }), payOnline: true } });
    open('/i/tok');
    render(<PublicInvoicePage />);
    await waitFor(() => screen.getByRole('heading', { name: 'Invoice INV-7' }));
    const text = document.body.textContent || '';
    assert.match(text, /€500\.00/);
    assert.match(text, /Deposit received: −€100\.00/);
    assert.match(text, /Paid: −€150\.00/);
    assert.match(text, /Amount due €250\.00/);
    assert.ok(screen.getByRole('button', { name: 'Pay €250.00' }));
  });

  test('Pay asks the server for the checkout page', async () => {
    const calls = stubFetchWithBodies(200, { invoice: { ...makeInvoice({ number: 'INV-8', amountCents: 10000, status: 'sent', paymentToken: 'tok2' }), payOnline: true } });
    open('/i/tok2');
    render(<PublicInvoicePage />);
    const pay = await waitFor(() => screen.getByRole('button', { name: /^Pay / }));
    await act(async () => { fireEvent.click(pay); });
    await waitFor(() => assert.ok(calls.some(c => c.method === 'POST')));
    assert.match(calls.find(c => c.method === 'POST')!.url, /\/api\/v1\/invoices\/public\/tok2\/pay$/);
  });

  test('a paid invoice has no Pay button', async () => {
    stubFetchWithBodies(200, { invoice: makeInvoice({ number: 'INV-9', amountCents: 10000, amountPaidCents: 10000, status: 'paid', paymentToken: 't' }) });
    open('/i/t');
    render(<PublicInvoicePage />);
    await waitFor(() => screen.getByRole('heading', { name: 'Invoice INV-9' }));
    assert.equal(screen.queryByRole('button', { name: /^Pay / }), null);
  });

  test('a link that does not work says so', async () => {
    stubFetchWithBodies(404, { error: 'Invoice not found' });
    open('/i/nope');
    render(<PublicInvoicePage />);
    await waitFor(() => screen.getByRole('heading', { name: 'Unable to Load Invoice' }));
    assert.ok(screen.getByText('Invoice not found'));
  });
});

describe('public invoice page: online payment needs the business\'s own Stripe account', () => {
  afterEach(() => cleanup());

  test('not connected: no Pay or bank-transfer button, and the page says how to pay', async () => {
    stubFetchWithBodies(200, { invoice: { ...makeInvoice({ number: 'INV-10', amountCents: 10000, currency: 'USD', status: 'sent', paymentToken: 'tok3' }), payOnline: false } });
    open('/i/tok3');
    render(<PublicInvoicePage />);
    await waitFor(() => screen.getByRole('heading', { name: 'Invoice INV-10' }));
    assert.equal(screen.queryByRole('button', { name: /^Pay / }), null);
    assert.equal(screen.queryByRole('button', { name: /Bank transfer/ }), null);
    assert.match(screen.getByRole('status').textContent || '', /Online payment isn't set up/);
  });

  test('an answer without payOnline (an older server) fails closed: no Pay button', async () => {
    stubFetchWithBodies(200, { invoice: makeInvoice({ number: 'INV-11', amountCents: 10000, status: 'sent', paymentToken: 'tok4' }) });
    open('/i/tok4');
    render(<PublicInvoicePage />);
    await waitFor(() => screen.getByRole('heading', { name: 'Invoice INV-11' }));
    assert.equal(screen.queryByRole('button', { name: /^Pay / }), null);
  });
});
