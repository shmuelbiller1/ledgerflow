/**
 * Milestone billing (V-09): a schedule on a sales order that adds up to 100% at most; the next one
 * not invoiced; due ones; in the order's Invoice dialog, setting the schedule, invoicing the next
 * milestone (its percentage) and marking it invoiced.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { dueMilestones, milestonesProblem, nextMilestone, type Milestone } from '../lib/milestones';
import OrderInvoiceDialog from '../components/sales/OrderInvoiceDialog';
import { orderProgress, type OrderPart } from '../lib/salesOrders';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';
import type { Estimate } from '../types';

const ms = (fields: Partial<Milestone>): Milestone => ({ id: 'm', label: 'Halfway', percent: 40, ...fields });

describe('The schedule', () => {
  test('what it needs; the next one; the due ones', () => {
    assert.equal(milestonesProblem([ms({ id: 'a', label: 'Signing', percent: 30 }), ms({ id: 'b' }), ms({ id: 'c', label: 'End', percent: 30 })]), null);
    assert.match(String(milestonesProblem([ms({ percent: 60 }), ms({ id: 'b', percent: 50 })])), /110%/);
    assert.match(String(milestonesProblem([ms({ label: ' ' })])), /name/);
    assert.match(String(milestonesProblem([ms({ percent: 0 })])), /above 0/);
    const list = [ms({ id: 'a', invoicedAt: '2026-10-01' }), ms({ id: 'b', due: '2026-10-05' }), ms({ id: 'c', due: '2026-12-01' })];
    assert.equal(nextMilestone(list)?.id, 'b');
    assert.deepEqual(dueMilestones(list, '2026-10-10').map(m => m.id), ['b']);
  });
});

describe('On screen', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('set the milestones, invoice the next one, and it is marked invoiced', async () => {
    setComponentWorkspace('owner');
    const estimate = { id: 'est1', number: 'EST-1', customerId: 'c1', customerName: 'Acme', status: 'accepted', orderedAt: '2026-10-01', amountCents: 100000, date: '2026-10-01', lines: [{ description: 'Kitchen', quantity: 1, unitPriceCents: 100000, amountCents: 100000 }] } as unknown as Estimate;
    const writes: Array<{ input?: { id?: string; milestones?: Milestone[] } }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      // the schedule is part of the quote's terms, so it goes through estimate.save
      if (String(input).includes('/commands/estimate.save') && typeof init?.body === 'string') writes.push(JSON.parse(init.body));
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const parts: OrderPart[] = [];
    render(<OrderInvoiceDialog estimate={estimate} progress={orderProgress(estimate, [])} currency="USD" onCreate={async p => { parts.push(p); }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set milestones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a milestone' }));
    fireEvent.change(screen.getByLabelText('Milestone 1 name'), { target: { value: 'Signing' } });
    fireEvent.change(screen.getByLabelText('Milestone 1 percentage'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a milestone' }));
    fireEvent.change(screen.getByLabelText('Milestone 2 name'), { target: { value: 'The rest' } });
    fireEvent.change(screen.getByLabelText('Milestone 2 percentage'), { target: { value: '80' } });
    assert.match(screen.getByRole('status').textContent || '', /110%/);
    fireEvent.change(screen.getByLabelText('Milestone 2 percentage'), { target: { value: '70' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save milestones' })); });
    await waitFor(() => assert.equal(writes.length, 1));
    assert.deepEqual((writes[0].input?.milestones || []).map(m => [m.label, m.percent]), [['Signing', 30], ['The rest', 70]]);
    fireEvent.click(screen.getByRole('button', { name: /Invoice the next milestone: Signing \(30%\)/ }));
    assert.equal((screen.getByLabelText('Percentage of the order') as HTMLInputElement).value, '30');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Create .*300\.00 invoice/ })); });
    assert.deepEqual(parts, [{ mode: 'percent', percent: 30 }]);
    await waitFor(() => assert.equal(writes.length, 2));
    const marked = writes[1].input?.milestones as Milestone[];
    assert.ok(marked[0].invoicedAt, 'Signing is invoiced');
    assert.equal(marked[1].invoicedAt, undefined);
  });
});
