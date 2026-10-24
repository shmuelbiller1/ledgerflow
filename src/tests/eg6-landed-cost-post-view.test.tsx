/**
 * EG-6 on screen: the landed cost preview becomes preview → post for owners and accountants. "Review what will post"
 * asks the server for a dry run and shows the entry and the new unit costs; "Post landed cost" sends the same
 * allocation without dryRun. Viewers see the preview only. Figures: Bill 1 (10 chairs @ 50.00, 10 tables @ 150.00),
 * freight 200.00 by value → chairs +50.00 (55.00 a unit), tables +150.00 (165.00 a unit).
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import LandedCostPreviewReportView from '../components/reporting/LandedCostPreviewReportView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import type { Bill, ChartAccount, InventoryItem } from '../types';

const W = 'component-workspace';
const items = [
  { id: 'chair', uid: 'u1', workspaceId: W, name: 'Chair', sku: 'CH', unitPriceCents: 9000, unitCostCents: 5000, quantityAtHand: 10, reorderPoint: 0, createdAt: '2026-01-01' },
  { id: 'table', uid: 'u1', workspaceId: W, name: 'Table', sku: 'TB', unitPriceCents: 30000, unitCostCents: 15000, quantityAtHand: 10, reorderPoint: 0, createdAt: '2026-01-01' },
] as InventoryItem[];
const bills = [
  { id: 'bill-1', uid: 'u1', workspaceId: W, number: 'B-1', vendorId: 'v', vendorName: 'Supplier', date: '2026-10-01', dueDate: '2026-10-31', status: 'approved', currency: 'USD', amountCents: 200000,
    splits: [{ accountId: 'inv', itemId: 'chair', quantity: 10, amountCents: 50000 }, { accountId: 'inv', itemId: 'table', quantity: 10, amountCents: 150000 }] },
  { id: 'frt-1', uid: 'u1', workspaceId: W, number: 'F-1', vendorId: 'v2', vendorName: 'Haulier', date: '2026-10-02', dueDate: '2026-10-31', status: 'approved', currency: 'USD', amountCents: 20000,
    splits: [{ accountId: 'freight', description: 'Freight', amountCents: 20000 }] },
] as Bill[];
const accounts = [{ id: 'inv', workspaceId: W, name: 'Inventory', code: '1300' }, { id: 'freight', workspaceId: W, name: 'Freight in', code: '5100' }] as ChartAccount[];
const HASH = 'a'.repeat(32);
const plan = (dryRun: boolean, planHash = HASH) => ({
  status: 'ok', entryId: 'landed-cost-bill-frt-1-0-0', date: '2026-10-23', movedToOpenDay: false, chargeCents: 20000, posted: !dryRun, replayed: false, dryRun, planHash,
  lines: [
    { key: 'bill-1:0', itemName: 'Chair', quantity: 10, allocatedCents: 5000, inventoryCents: 5000, cogsCents: 0, unitCostBeforeCents: 5000, unitCostAfterCents: 5500 },
    { key: 'bill-1:1', itemName: 'Table', quantity: 10, allocatedCents: 15000, inventoryCents: 15000, cogsCents: 0, unitCostBeforeCents: 15000, unitCostAfterCents: 16500 },
  ],
  entryLines: [
    { accountId: 'inv', accountName: 'Inventory', amountCents: 5000, description: 'Chair: landed cost' },
    { accountId: 'inv', accountName: 'Inventory', amountCents: 15000, description: 'Table: landed cost' },
    { accountId: 'freight', accountName: 'Freight in', amountCents: -20000, description: 'Freight (bill F-1)' },
  ],
});

describe('EG-6 landed cost: preview → post on screen', () => {
  let sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  /** answers the next post (not a dry run) with this, once */
  let nextPost: Response | null = null;
  beforeEach(() => {
    sent = [];
    nextPost = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      sent.push({ url: String(input), body });
      if (String(input).endsWith('/undo')) return new Response(JSON.stringify({ status: 'ok', entryId: 'landed-cost-bill-frt-1-0-0', undoEntryId: 'landed-cost-bill-frt-1-0-0-undo', date: '2026-10-23', replayed: false }), { status: 200 });
      if (!body.dryRun && nextPost) { const r = nextPost; nextPost = null; return r; }
      return new Response(JSON.stringify(plan(Boolean(body.dryRun))), { status: 200 });
    }) as typeof fetch;
    markComponentCollectionsLoaded('bills', 'inventory', 'vendors');
    useDataNeedsStore.setState({ failed: {} as never });
    useLedgerStore.setState({ bills, inventory: items, vendors: [], accounts, truncatedCollections: {} });
  });
  afterEach(() => cleanup());

  test('an owner reviews what will post, then posts it', async () => {
    setComponentWorkspace('owner');
    render(<LandedCostPreviewReportView />);
    const panel = screen.getByRole('region', { name: 'Post landed cost' });
    assert.match((within(panel).getByLabelText('Charge to land') as HTMLSelectElement).value, /frt-1#0/);
    const post = within(panel).getByRole('button', { name: 'Post landed cost' }) as HTMLButtonElement;
    assert.equal(post.disabled, true, 'nothing to post before the review');
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Review what will post' })); });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, '/api/v1/inventory/landed-cost');
    assert.deepEqual([sent[0].body.dryRun, sent[0].body.basis, sent[0].body.receiptBillIds, sent[0].body.charge], [true, 'value', ['bill-1'], { kind: 'bill', billId: 'frt-1', line: 0 }]);
    const text = panel.textContent || '';
    assert.match(text, /Will post on 2026-10-23/);
    assert.match(text, /Freight in.*-\$200\.00|Freight in.*−\$200\.00|Freight in.*\(\$200\.00\)/);
    assert.match(text, /Chair: \+\$50\.00, unit cost \$50\.00 → \$55\.00/);
    assert.match(text, /Table: \+\$150\.00, unit cost \$150\.00 → \$165\.00/);
    await act(async () => { fireEvent.click(post); });
    assert.equal(sent.length, 2);
    assert.equal(sent[1].body.dryRun, false);
    assert.equal(sent[1].body.expectedPlanHash, HASH, 'posts exactly the reviewed plan');
    assert.match(screen.getByRole('status').textContent || '', /Posted landed-cost-bill-frt-1-0-0 on 2026-10-23/);
    assert.equal((within(panel).getByRole('button', { name: 'Post landed cost' }) as HTMLButtonElement).disabled, true, 'posted once');
    // review finding: an Undo action, through the undo route
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Undo landed cost' })); });
    assert.equal(sent[2].url, '/api/v1/inventory/landed-cost/landed-cost-bill-frt-1-0-0/undo');
    assert.deepEqual(sent[2].body, { workspaceId: W });
    assert.match(screen.getByRole('status').textContent || '', /Undone: landed-cost-bill-frt-1-0-0-undo/);
    assert.equal(within(panel).queryByRole('button', { name: 'Undo landed cost' }), null);
  });

  test('a plan that changed since the review is shown again, not posted', async () => {
    setComponentWorkspace('accountant');
    render(<LandedCostPreviewReportView />);
    const panel = screen.getByRole('region', { name: 'Post landed cost' });
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Review what will post' })); });
    const changed = { ...plan(true, 'b'.repeat(32)), lines: plan(true).lines.map(l => (l.itemName === 'Chair' ? { ...l, unitCostAfterCents: 5600 } : l)) };
    nextPost = new Response(JSON.stringify({ error: 'What would post has changed since it was reviewed', plan: changed }), { status: 409 });
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Post landed cost' })); });
    assert.match(screen.getByRole('status').textContent || '', /changed since it was reviewed/);
    assert.match(panel.textContent || '', /Will post on/);
    assert.match(panel.textContent || '', /\$50\.00 → \$56\.00/, 'the new plan is on screen');
    assert.equal(within(panel).queryByRole('button', { name: 'Undo landed cost' }), null, 'nothing posted');
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Post landed cost' })); });
    assert.equal(sent[sent.length - 1].body.expectedPlanHash, 'b'.repeat(32), 'the next post confirms the new plan');
  });

  test('switching workspace resets the panel and ignores an answer for the old one', async () => {
    setComponentWorkspace('owner');
    let release: (r: Response) => void = () => {};
    globalThis.fetch = (() => new Promise<Response>(resolve => { release = resolve; })) as typeof fetch;
    render(<LandedCostPreviewReportView />);
    await act(async () => { fireEvent.click(within(screen.getByRole('region', { name: 'Post landed cost' })).getByRole('button', { name: 'Review what will post' })); });
    await act(async () => {
      const ws = useAuthStore.getState().workspaces[0];
      useAuthStore.setState({ workspaces: [ws, { ...ws, id: 'other-workspace' }], currentWorkspaceId: 'other-workspace' });
    });
    await act(async () => { release(new Response(JSON.stringify(plan(true)), { status: 200 })); });
    assert.doesNotMatch(document.body.textContent || '', /Will post on/, 'the old workspace\'s plan is not shown');
  });

  test('a viewer sees the preview only', () => {
    setComponentWorkspace('viewer');
    render(<LandedCostPreviewReportView />);
    assert.equal(screen.queryByRole('region', { name: 'Post landed cost' }), null);
    assert.equal(sent.length, 0);
  });
});
