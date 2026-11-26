/**
 * AUP-08: after "mark invoiced" fails, a remount (or reload) retries by linking the invoice already made for
 * those hours; it never makes a second one, and it never links to an invoice voided since. Mocked server.
 */
import './helpers/dom';
import test, { afterEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TimeView from '../components/collaboration/TimeView';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeCustomer } from './fixtures';
import { getSupabase } from '../lib/db/client';

afterEach(async () => { cleanup(); localStorage.clear(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

/** One approved, billable hour for Acme; `over` lets a test change fields (e.g. mark it invoiced elsewhere). */
const approvedHour = (workspaceId: string, over: Record<string, unknown> = {}) => ({
  id: 'time-1', kind: 'timeEntry', workspaceId, person: 'test-user', date: '2026-10-05', minutes: 60,
  description: 'Design', billable: true, customerId: 'c1', status: 'approved', createdAt: '2026-10-05T10:00:00Z', ...over,
});
/** Pick the customer in the bill panel and press "Make a draft invoice". */
const billApprovedTime = async () => {
  const region = await screen.findByRole('region', { name: 'Bill approved time' });
  fireEvent.change(within(region).getByLabelText('Customer'), { target: { value: 'c1' } });
  fireEvent.click(within(region).getByRole('button', { name: 'Make a draft invoice' }));
};

/** Bills the approved hour once (the link fails), remounts with `between` applied, and bills again. */
async function failLinkThenRemount(t: TestContext, between: (firstInvoiceId: string) => void, retryAnswer?: () => Response) {
  const workspace = setComponentWorkspace('owner');
  useLedgerStore.setState({ customers: [makeCustomer({ id: 'c1', name: 'Acme' })], projects: [], invoices: [] });
  let creates = 0;
  const linkedTo: string[] = [];
  const createdIds: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/time/invoiced')) {
      linkedTo.push(JSON.parse(String(init?.body)).invoiceId);
      if (linkedTo.length === 2 && retryAnswer) return retryAnswer();
      return linkedTo.length === 1 ? Response.json({ status: 'error', message: 'link unavailable' }, { status: 503 }) : Response.json({ status: 'success' });
    }
    if (url.endsWith('/time')) return Response.json({ status: 'success', entries: [approvedHour(workspace.id)], rates: { customers: { c1: 10000 } }, canApprove: true });
    if (url.endsWith('/next-number')) return Response.json({ number: `INV-${creates + 1}` });
    if (url.endsWith('/commands/invoice.create')) { creates++; createdIds.push(JSON.parse(String(init?.body)).input.invoice.id); return Response.json({ status: 'success', data: {} }); }
    if (init?.method === 'POST') return Response.json({ status: 'success' });
    return Response.json([]);
  });
  const first = render(<TimeView />);
  await billApprovedTime();
  await waitFor(() => assert.equal(linkedTo.length, 1));
  first.unmount();
  between(createdIds[0]);
  render(<TimeView />);
  await billApprovedTime();
  await waitFor(() => assert.equal(linkedTo.length, 2));
  if (retryAnswer) {
    await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Make a draft invoice' }).hasAttribute('disabled'), false));
    await billApprovedTime();
    await waitFor(() => assert.equal(linkedTo.length, 3));
  }
  return { creates, linkedTo, createdIds };
}

test('a remount after a failed time link links the same invoice instead of making a second', async t => {
  const { creates, linkedTo } = await failLinkThenRemount(t, () => {});
  assert.equal(creates, 1, 'no second invoice-create is sent');
  assert.equal(linkedTo[1], linkedTo[0], 'the retry links the invoice made the first time');
});

test('with no note in this browser, the invoice that names these hours is found and linked', async t => {
  const { creates, linkedTo } = await failLinkThenRemount(t, made => {
    localStorage.clear();
    useLedgerStore.setState({ invoices: [{ id: made, number: 'INV-1', status: 'draft', metadata: { fromTime: true, timeEntryKey: 'time-1' } } as never] });
  });
  assert.equal(creates, 1);
  assert.equal(linkedTo[1], linkedTo[0]);
});

test('a noted invoice that was voided since is not used: a fresh one is made and linked', async t => {
  const { creates, linkedTo, createdIds } = await failLinkThenRemount(t, made => {
    useLedgerStore.setState({ invoices: [{ id: made, number: 'INV-1', status: 'void', metadata: { fromTime: true, timeEntryKey: 'time-1' } } as never] });
  });
  assert.equal(creates, 2, 'the voided draft is replaced');
  assert.equal(linkedTo[1], createdIds[1], 'the time is linked to the new invoice, never the void one');
});

test('a refusal about the time itself keeps the invoice: the next press links it again, no second invoice', async t => {
  const { creates, linkedTo } = await failLinkThenRemount(t, () => {},
    () => Response.json({ status: 'error', message: 'The 2026-10-05 entry is not approved billable time waiting for an invoice', code: 'CONFLICT' }, { status: 409 }));
  assert.equal(creates, 1, 'no orphan invoice is made');
  assert.equal(linkedTo[2], linkedTo[0]);
});

test('a refusal saying the invoice is void forgets it: the next press makes a fresh one', async t => {
  const { creates, linkedTo, createdIds } = await failLinkThenRemount(t, () => {},
    () => Response.json({ status: 'error', message: 'That invoice is void; make a new one for this time', code: 'INVOICE_VOID' }, { status: 409 }));
  assert.equal(creates, 2);
  assert.equal(linkedTo[2], createdIds[1]);
});

test('a refusal after which the time changed forgets the stale note and warns about the draft', async t => {
  const workspace = setComponentWorkspace('owner');
  useLedgerStore.setState({ customers: [makeCustomer({ id: 'c1', name: 'Acme' })], projects: [], invoices: [] });
  let links = 0, refused = false;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/time/invoiced')) {
      links++;
      if (links === 1) return Response.json({ status: 'error', message: 'link unavailable' }, { status: 503 });
      refused = true; // someone else invoiced the entry meanwhile
      return Response.json({ status: 'error', message: 'The 2026-10-05 entry is not approved billable time waiting for an invoice', code: 'CONFLICT' }, { status: 409 });
    }
    if (url.endsWith('/time')) return Response.json({ status: 'success', entries: [approvedHour(workspace.id, refused ? { status: 'invoiced', invoiceId: 'other' } : {})], rates: { customers: { c1: 10000 } }, canApprove: true });
    if (url.endsWith('/next-number')) return Response.json({ number: 'INV-1' });
    if (url.endsWith('/commands/invoice.create')) return Response.json({ status: 'success', data: {} });
    if (init?.method === 'POST') return Response.json({ status: 'success' });
    return Response.json([]);
  });
  const first = render(<TimeView />);
  await billApprovedTime();
  await waitFor(() => assert.equal(links, 1));
  assert.ok(Object.keys(JSON.parse(localStorage.getItem('lf.time.pendingInvoice') || '{}')).length === 1, 'the made draft is noted');
  first.unmount();
  render(<TimeView />);
  await billApprovedTime();
  await waitFor(() => assert.equal(links, 2));
  // the reload shows the entry invoiced elsewhere: the hours changed, so the stale note is gone
  await waitFor(() => assert.deepEqual(JSON.parse(localStorage.getItem('lf.time.pendingInvoice') || '{}'), {}));
});
