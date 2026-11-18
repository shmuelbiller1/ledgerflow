/**
 * Purchase requisitions (K-23): a bookkeeper's purchase order is a request ("Send for approval") that
 * waits until an owner or accountant approves it (a normal order) or declines it (cancelled, with the
 * reason); nobody approves their own request except the owner; nothing is received or billed while it
 * waits.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PurchaseOrdersView from '../components/purchases/PurchaseOrdersView';
import { orderDecision, orderDecisionProblem, orderNeedsApproval } from '../lib/purchaseOrders';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { PurchaseOrder, Vendor } from '../types';

const request = (uid: string): PurchaseOrder => ({
  id: 'po9', uid, workspaceId: 'component-workspace', poNumber: 'PO-2026-009', vendorId: 'paper', vendorName: 'Paper Co', status: 'pending_approval',
  approvalStatus: 'pending', issueDate: '2026-10-01', totalAmountCents: 12000, currency: 'USD', createdAt: '2026-10-01T00:00:00Z',
  items: [{ id: 'l', description: 'Chairs', quantity: 2, unitPriceCents: 6000, totalCents: 12000, receivedQuantity: 0 }],
} as PurchaseOrder);

describe('The rules', () => {
  test('who asks, who decides', () => {
    assert.deepEqual(['owner', 'accountant', 'bookkeeper'].map(orderNeedsApproval), [false, false, true]);
    assert.equal(orderDecisionProblem(request('u-book'), 'accountant', 'u-acc'), null);
    assert.equal(orderDecisionProblem(request('u-acc'), 'accountant', 'u-acc'), 'Someone else must approve your own request');
    assert.equal(orderDecisionProblem(request('u-own'), 'owner', 'u-own'), null);
    assert.equal(orderDecisionProblem(request('u-x'), 'bookkeeper', 'u-book'), 'Waiting for an owner or accountant');
    assert.equal(orderDecisionProblem({ ...request('u-x'), status: 'approved' }, 'owner', 'u-own'), 'Not waiting for approval');
  });

  test('approve makes it an order; decline cancels it with the reason', () => {
    assert.deepEqual(orderDecision(true, 'u-acc', 'T'), { status: 'approved', approvalStatus: 'approved', approvedBy: 'u-acc', approvedAt: 'T' });
    assert.deepEqual(orderDecision(false, 'u-acc', 'T', 'Too expensive'), { status: 'cancelled', approvalStatus: 'rejected', approvedBy: 'u-acc', approvedAt: 'T', notes: 'Declined: Too expensive' });
  });
});

describe('On the purchase orders screen', () => {
  let writes: { fn: string; body: Record<string, unknown> }[] = [];
  let orders: PurchaseOrder[] = [];
  beforeEach(() => {
    writes = [];
    markComponentCollectionsLoaded('bills', 'vendors');
    useLedgerStore.setState({ bills: [], vendors: [{ id: 'paper', name: 'Paper Co' }] as Vendor[], accounts: [] });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const rpc = url.match(/\/rpc\/(lf_\w+)/);
      if (rpc) { writes.push({ fn: rpc[1], body: JSON.parse(String(init?.body || '{}')) }); return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } }); }
      // an order is an ordinary record: its saves name `record.save`, and the fields ride in `input.data`
      if (url.includes('/commands/record.')) {
        const { input: sent } = JSON.parse(String(init?.body || '{}')) as { input: { collection: string; id: string; data?: Record<string, unknown> } };
        writes.push({ fn: url.split('/commands/')[1], body: { p_table: sent.collection, p_id: sent.id, p_set: sent.data || {} } });
        return new Response(JSON.stringify({ ok: true, data: { collection: sent.collection, id: sent.id, created: false, updatedAt: new Date().toISOString() } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/purchaseOrders')) return new Response(JSON.stringify(orders.map(po => ({ id: po.id, data: po, updated_at: po.createdAt }))), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });
  const saved = () => writes.map(w => (w.body.p_set || w.body.p_data) as Record<string, unknown> | undefined).filter(Boolean) as Record<string, unknown>[];

  test('a bookkeeper sends a new order for approval', async () => {
    orders = [];
    setComponentWorkspace('bookkeeper');
    render(<PurchaseOrdersView />);
    fireEvent.click(await screen.findByRole('button', { name: /New purchase order/ }));
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'paper' } });
    fireEvent.change(screen.getByLabelText('Item 1 description'), { target: { value: 'Chairs' } });
    fireEvent.change(screen.getByLabelText('Item 1 quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Item 1 unit price'), { target: { value: '60' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send for approval' })); });
    await waitFor(() => assert.ok(saved().some(d => d.poNumber)));
    const po = saved().find(d => d.poNumber)!;
    assert.deepEqual([po.status, po.approvalStatus, po.totalAmountCents], ['pending_approval', 'pending', 12000]);
  });

  test('an accountant approves a waiting request; nothing can be received or billed before that', async () => {
    orders = [request('u-book')];
    setComponentWorkspace('accountant');
    render(<PurchaseOrdersView />);
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Approve PO-2026-009' })));
    assert.equal(screen.queryByRole('button', { name: 'Receive goods' }), null);
    assert.equal(screen.queryByRole('button', { name: /Create bill/ }), null);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve PO-2026-009' })); });
    await waitFor(() => assert.ok(saved().some(d => d.approvalStatus === 'approved')));
    const decision = saved().find(d => d.approvalStatus === 'approved')!;
    assert.deepEqual([decision.status, decision.approvedBy], ['approved', 'test-user']);
  });

  test('declining asks why; the requester (not owner) only sees it waiting', async () => {
    orders = [request('u-book')];
    setComponentWorkspace('owner');
    render(<PurchaseOrdersView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decline PO-2026-009' }));
    fireEvent.change(screen.getByLabelText('Why is it declined?'), { target: { value: 'Too expensive' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Decline' })); });
    await waitFor(() => assert.ok(saved().some(d => d.approvalStatus === 'rejected')));
    assert.equal(saved().find(d => d.approvalStatus === 'rejected')!.notes, 'Declined: Too expensive');
    cleanup();
    orders = [request('test-user')];
    setComponentWorkspace('accountant');
    render(<PurchaseOrdersView />);
    await waitFor(() => assert.match(document.body.textContent || '', /Someone else must approve your own request/));
    assert.equal(screen.queryByRole('button', { name: 'Approve PO-2026-009' }), null);
  });
});
