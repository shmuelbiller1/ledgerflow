/**
 * AUP-08: after "mark invoiced" fails, a remount (or reload) retries by linking the invoice already made for
 * those hours; it never makes a second one. Fault injection with a mocked server; no live database.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TimeView from '../components/collaboration/TimeView';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeCustomer } from './fixtures';
import { getSupabase } from '../lib/db/client';

afterEach(async () => { cleanup(); localStorage.clear(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('a remount after a failed time link links the same invoice instead of making a second', async t => {
  const workspace = setComponentWorkspace('owner');
  useLedgerStore.setState({ customers: [makeCustomer({ id: 'c1', name: 'Acme' })], projects: [] });
  let creates = 0;
  let links = 0;
  const linkedTo: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/time/invoiced')) { links++; linkedTo.push(JSON.parse(String(init?.body)).invoiceId); return links === 1 ? Response.json({ status: 'error', message: 'link unavailable' }, { status: 503 }) : Response.json({ status: 'success' }); }
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
  assert.equal(creates, 1, 'no second invoice-create is sent');
  assert.equal(linkedTo[1], linkedTo[0], 'the retry links the invoice made the first time');
});

test('with no note in this browser, the invoice that names these hours is found and linked', async t => {
  const workspace = setComponentWorkspace('owner');
  useLedgerStore.setState({ customers: [makeCustomer({ id: 'c1', name: 'Acme' })], projects: [] });
  let creates = 0;
  let links = 0;
  const linkedTo: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/time/invoiced')) { links++; linkedTo.push(JSON.parse(String(init?.body)).invoiceId); return links === 1 ? Response.json({ status: 'error', message: 'link unavailable' }, { status: 503 }) : Response.json({ status: 'success' }); }
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
  localStorage.clear();
  const made = linkedTo[0];
  useLedgerStore.setState({ invoices: [{ id: made, number: 'INV-1', status: 'draft', metadata: { fromTime: true, timeEntryKey: 'time-1' } } as never] });
  render(<TimeView />);
  await chooseAndBill();
  await waitFor(() => assert.equal(links, 2));
  assert.equal(creates, 1, 'no second invoice-create is sent');
  assert.equal(linkedTo[1], linkedTo[0], 'the retry links the invoice made the first time');
});
