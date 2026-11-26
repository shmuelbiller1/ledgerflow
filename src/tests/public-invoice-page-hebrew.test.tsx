import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import PublicInvoicePage from '../components/sales/PublicInvoicePage';
import { makeInvoice } from './fixtures';

const invoice = { ...makeInvoice({ number: 'INV-42', customerName: 'לקוח Acme', date: '2026-03-01', currency: 'USD', paymentToken: 'public-test', metadata: { memo: 'עיצוב Design — ירושלים' } }), remainingBalanceCents: 7500, payOnline: true };
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); });

test('public invoice displays mixed-language data and uses the server balance for the payment request', async () => {
  window.history.replaceState({}, '', '/i/public-test');
  const calls = stubFetchWithBodies(200, { invoice });
  const view = render(<PublicInvoicePage />);
  await waitFor(() => assert.ok(view.getByRole('heading', { name: 'Invoice INV-42' })));
  assert.ok(view.getByText('לקוח Acme'));
  assert.ok(view.getByText('עיצוב Design — ירושלים'));
  assert.ok(calls.some(call => call.url === '/api/v1/invoices/public/public-test'));
  fireEvent.click(view.getByRole('button', { name: 'Pay $75.00' }));
  await waitFor(() => assert.ok(calls.some(call => call.url === '/api/v1/invoices/public/public-test/pay' && call.method === 'POST')));
  await waitFor(() => assert.ok(view.getByRole('button', { name: 'Pay $75.00' })));
});

test('paid public invoice shows Paid and provides no payment action', async () => {
  window.history.replaceState({}, '', '/i/public-test');
  stubFetchWithBodies(200, { invoice: { ...invoice, status: 'paid', remainingBalanceCents: 0 } });
  const view = render(<PublicInvoicePage />);
  await waitFor(() => assert.ok(view.getByText('Paid')));
  assert.equal(view.queryByRole('button', { name: /^Pay / }), null);
});

test('invalid public invoice link reports the error without fetching', async () => {
  window.history.replaceState({}, '', '/');
  const calls = stubFetchWithBodies(200, {});
  const view = render(<PublicInvoicePage />);
  await waitFor(() => assert.ok(view.getByText('Invalid invoice link')));
  assert.equal(calls.length, 0);
});
