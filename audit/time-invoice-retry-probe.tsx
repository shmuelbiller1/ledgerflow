/** Audit probe EXPECTS the currently unsafe behavior; not a regression test for the desired fix.
 * Fault injection records accepted write requests in a mock; no live accounting database is used. */
import '../src/tests/helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TimeView from '../src/components/collaboration/TimeView';
import { setComponentWorkspace } from '../src/tests/helpers/componentFixtures';
import { useLedgerStore } from '../src/stores/useLedgerStore';
import { makeCustomer } from '../src/tests/fixtures';
import { getSupabase } from '../src/lib/db/client';

afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('audit reproduction: remount after a failed time link can issue a second invoice-create request', async t => {
  const workspace = setComponentWorkspace('owner');
  useLedgerStore.setState({ customers: [makeCustomer({ id: 'c1', name: 'Acme' })], projects: [] });
  let creates = 0;
  let links = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/time/invoiced')) { links++; return Response.json({ status: 'error', message: 'link unavailable' }, { status: 503 }); }
    if (url.endsWith('/time')) return Response.json({ status: 'success', entries: [{ id: 'time-1', kind: 'timeEntry', workspaceId: workspace.id, person: 'test-user', date: '2026-10-05', minutes: 60, description: 'Design', billable: true, customerId: 'c1', status: 'approved', createdAt: '2026-10-05T10:00:00Z' }], rates: { customers: { c1: 10000 } }, canApprove: true });
    if (url.endsWith('/next-number')) return Response.json({ number: `INV-${creates + 1}` });
    if (url.endsWith('/commands/invoice.create')) { creates++; return Response.json({ status: 'success', data: {} }); }
    if (init?.method === 'POST') return Response.json({ status: 'success' });
    return Response.json([]);
  });
  const chooseAndBill = async () => {
    const bill = await screen.findByRole('region', { name: 'Bill approved time' });
    fireEvent.change(within(bill).getByLabelText('Customer'), { target: { value: 'c1' } });
    fireEvent.click(within(bill).getByRole('button', { name: 'Make a draft invoice' }));
  };
  const first = render(<TimeView />);
  await chooseAndBill();
  await waitFor(() => assert.equal(links, 1));
  assert.equal(creates, 1);
  first.unmount();
  render(<TimeView />);
  await chooseAndBill();
  await waitFor(() => assert.equal(links, 2));
  assert.equal(creates, 2, 'second create is sent because retry state was only held in component memory');
});
