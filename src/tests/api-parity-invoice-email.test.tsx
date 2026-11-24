import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InvoiceEmailDialog from '../components/sales/InvoiceEmailDialog';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';
import type { Invoice } from '../types';

const invoice = (id: string) => ({ id, uid: 'test-user', workspaceId: 'component-workspace', number: id, amountCents: 5000, status: 'sent' } as Invoice);
beforeEach(() => { setComponentWorkspace(); markComponentCollectionsLoaded('customers'); });
afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('invoice send-log refusal is visible and retry retrieves the actual log', async t => {
  const calls: { url: string; options?: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
    calls.push({ url: String(input), options });
    if (calls.length === 1) return Response.json({ message: 'Access denied' }, { status: 403 });
    return Response.json({ status: 'success', events: [{ event: 'sent', recipient: 'customer@example.test', timestamp: '2026-11-23T12:00:00Z' }] });
  });
  render(<InvoiceEmailDialog invoice={invoice('inv 1')} onClose={() => {}} />);
  assert.match((await screen.findByRole('alert')).textContent || '', /Access denied/);
  assert.equal(screen.queryByText('None yet.'), null);
  assert.equal(calls[0].url, '/api/v1/workspaces/component-workspace/emails/log/inv%201');
  assert.equal((calls[0].options?.headers as Record<string, string>).Authorization, 'Bearer test-token');
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading send log' }));
  assert.ok(await screen.findByText(/Sent · customer@example.test/));
  assert.equal(calls.length, 2);
});

test('malformed successful send-log response is not described as an empty log', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'success' }));
  render(<InvoiceEmailDialog invoice={invoice('i2')} onClose={() => {}} />);
  assert.match((await screen.findByRole('alert')).textContent || '', /invalid send log/);
  assert.equal(screen.queryByText('None yet.'), null);
});

test('an obsolete invoice log response cannot overwrite the current invoice log', async t => {
  let resolveFirst!: (response: Response) => void;
  const first = new Promise<Response>(resolve => { resolveFirst = resolve; });
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => String(input).endsWith('/i1') ? first : Response.json({ events: [] }));
  const view = render(<InvoiceEmailDialog invoice={invoice('i1')} onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText('Loading…')));
  view.rerender(<InvoiceEmailDialog invoice={invoice('i2')} onClose={() => {}} />);
  await screen.findByText('None yet.');
  await act(async () => { resolveFirst(Response.json({ events: [{ event: 'sent', recipient: 'old@example.test', timestamp: '2026-11-23' }] })); await first; });
  assert.equal(screen.queryByText(/old@example.test/), null);
  assert.ok(screen.getByText('None yet.'));
});
