/**
 * The exchange rate fills itself in on a foreign-currency bill or invoice (BA-06, I-23): the last
 * rate the workspace used for that currency at once, then today's rate from the server when it
 * answers; never a guessed number; typing your own rate stops it.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BillModal from '../components/purchases/BillModal';
import { lastUsedRate } from '../lib/exchangeRates';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { Bill, Workspace } from '../types';
import { makeChartAccount, makeVendor } from './fixtures';

test('the last rate used for a currency, newest first; 1 and other currencies ignored', () => {
  const docs = [
    { currency: 'EUR', exchangeRate: 1.05, date: '2026-01-01' },
    { currency: 'EUR', exchangeRate: 1.09, date: '2026-03-01' },
    { currency: 'EUR', exchangeRate: 1, date: '2026-04-01' },
    { currency: 'GBP', exchangeRate: 1.27, date: '2026-05-01' },
  ];
  assert.equal(lastUsedRate('EUR', docs), 1.09);
  assert.equal(lastUsedRate('JPY', docs), null);
});

describe('On a bill', () => {
  let live: number | null = 1.0823;
  const urls: string[] = [];
  beforeEach(() => {
    urls.length = 0;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      urls.push(String(url));
      if (String(url).startsWith('/api/v1/fx/rate')) {
        return live ? new Response(JSON.stringify({ rate: live }), { status: 200 }) : new Response(JSON.stringify({ error: 'down' }), { status: 503 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    useAuthStore.setState({ currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD' } as Workspace] });
    useLedgerStore.setState({ bills: [{ id: 'old', vendorId: 'v9', currency: 'EUR', exchangeRate: 1.09, date: '2026-03-01', amountCents: 1, dueDate: '2026-03-01', status: 'paid' } as Bill], transactions: [], taxRates: [] });
  });
  // EU-B3: each test opens a fresh bill; a draft typed in the previous one would be offered again
  afterEach(() => { cleanup(); localStorage.clear(); });
  const open = () => render(<BillModal isOpen onClose={() => {}} onSave={() => {}} vendors={[makeVendor({ id: 'v1', name: 'Paper Co' })]}
    accounts={[makeChartAccount({ id: 'exp', name: 'Supplies', type: 'expense' })]} />);
  const rate = () => (screen.getByLabelText('1 EUR = ? USD') as HTMLInputElement).value;

  test('switching to EUR fills today\'s rate (after the last one used) and says so', async () => {
    live = 1.0823;
    open();
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } });
    await waitFor(() => assert.equal(rate(), '1.0823'));
    assert.match(screen.getByRole('status').textContent || '', /Today's rate for EUR/);
    assert.ok(urls.some(u => u === '/api/v1/fx/rate?from=EUR&to=USD'));
  });

  test('no rate service: the last rate used stays; a typed rate is never replaced', async () => {
    live = null;
    open();
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } });
    await waitFor(() => assert.equal(rate(), '1.09'));
    assert.match(screen.getByRole('status').textContent || '', /Last rate used for EUR/);
    fireEvent.change(screen.getByLabelText('1 EUR = ? USD'), { target: { value: '1.2' } });
    live = 1.5;
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'GBP' } });
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } });
    await new Promise(r => setTimeout(r, 50));
    assert.equal(rate(), '1.2');
  });
});
