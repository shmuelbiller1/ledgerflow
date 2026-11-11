/**
 * Concurrency, cache-miss, and archived-status regression coverage for inline dimension workflows:
 * - Uncached stored node IDs resolve against the authoritative remote registry instead of minting replacement IDs
 * - Automatic document normalization preserves archived node status without issuing reactivation writes
 * - Inline label create/rename completions ignore stale selection callbacks if the user changed that dimension input while pending
 * - Settings -> Dimensions refuses overlapping axis/node submissions and serializes concurrent axis writes
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  addDimensionAxisInline,
  ensureDimensionNodesInMap,
  ensureInvoiceDimensionNodes,
  type DimensionActionSession,
  type DimensionNodeActionAdapter,
} from '../lib/dimensionNodeActions';
import { computeBillRetentionReport } from '../lib/billRetention';
import BillModal from '../components/purchases/BillModal';
import DimensionsSettings from '../components/platform/settings/DimensionsSettings';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount, makeVendor } from './fixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { Bill, DimensionDefinition, DimensionNode } from '../types';

const realFetch = globalThis.fetch;

const checking = makeChartAccount({ id: 'bank', code: '1000', name: 'Checking', type: 'asset', category: 'Cash' });
const ap = makeChartAccount({ id: 'ap', code: '2000', name: 'Accounts Payable', type: 'liability', category: 'Payables' });
const utilities = makeChartAccount({ id: 'util', code: '6200', name: 'Utilities', type: 'expense', category: 'Operating' });
const accounts = [checking, ap, utilities];

describe('Dimension inline concurrency, uncached IDs, and archived-node preservation', () => {
  afterEach(async () => {
    globalThis.fetch = realFetch;
    cleanup();
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
  });

  test('resolves uncached remote node IDs without creating duplicate labels and preserves archived status during normalization', async () => {
    const remoteNodes = new Map<string, DimensionNode>([
      ['property:P5', { id: 'P5', dimensionId: 'property', description: '5 Ocean Ave', status: 'active' }],
      ['property:P9', { id: 'P9', dimensionId: 'property', description: 'Historic Annex', status: 'archived' }],
    ]);
    let localCache: DimensionNode[] = [
      { id: 'P2', dimensionId: 'property', description: 'Cached Archived Loft', status: 'archived' },
    ];
    const writes: DimensionNode[] = [];
    const updates: Array<{ nodeId: string; fields: Record<string, unknown> }> = [];
    const session: DimensionActionSession = { uid: 'u1', workspaceId: 'ws1', canWriteNodes: true, canManageAxes: true };

    const adapter: DimensionNodeActionAdapter = {
      session: () => session,
      getNodes: () => localCache,
      setNodes: next => { localCache = [...next]; },
      getWorkspaceDimensions: () => [{ id: 'property', name: 'Property', sortOrder: 1 }],
      setWorkspaceDimensions: () => {},
      writeNode: async (_ws, node) => { writes.push(node); },
      createOnlyNode: async (_ws, node) => {
        if (remoteNodes.has(`${node.dimensionId}:${node.id}`)) return 'conflict';
        writes.push(node);
        return 'created';
      },
      readNode: async (workspaceId, dimensionId, nodeId) => {
        const found = remoteNodes.get(`${dimensionId}:${nodeId}`);
        return found ? { ...found, workspaceId } : undefined;
      },
      updateNode: async (_ws, _dim, nodeId, fields) => { updates.push({ nodeId, fields }); },
      readWorkspace: async () => ({ dimensions: [] }),
      updateWorkspace: async () => {},
    };

    // Empty/incomplete cache with remote P5 and remote archived P9 + cached archived P2:
    // preserves P5, P9, and P2 without minting P1 or issuing any reactivation update!
    const normalized = await ensureInvoiceDimensionNodes(
      {
        dimensions: { property: 'P5/Suite A' },
        items: [
          { dimensions: { property: 'P5' } },
          { dimensions: { property: 'P9' } },
          { dimensions: { property: 'P2' } },
          { dimensions: { property: 'Cached Archived Loft' } },
        ],
      },
      adapter,
    );

    assert.deepEqual(normalized.dimensions, { property: 'P5/Suite A' });
    assert.deepEqual(normalized.items?.map(i => i.dimensions), [
      { property: 'P5' },
      { property: 'P9' },
      { property: 'P2' },
      { property: 'P2' },
    ]);
    assert.equal(writes.length, 0, 'must not create P1 with description P5');
    assert.equal(updates.length, 0, 'must not reactivate archived P2 or P9 during automatic normalization');
    assert.equal(localCache.find(n => n.id === 'P9')?.status, 'archived');
    assert.equal(localCache.find(n => n.id === 'P2')?.status, 'archived');

    // Also ensure direct map call resolves lowercase uncached code p5 -> P5
    const lowerMap = await ensureDimensionNodesInMap({ property: 'p5' }, adapter);
    assert.deepEqual(lowerMap, { property: 'P5' });
  });

  test('ignores inline label-save completion when the user changes that dimension value while the request is pending', async () => {
    const ws = setComponentWorkspace('owner');
    useAuthStore.setState({
      workspaces: [{
        ...ws,
        dimensions: [
          { id: 'category', name: 'Category', systemDefault: true, sortOrder: 0 },
          { id: 'property', name: 'Property', sortOrder: 1 },
        ],
      }],
    });
    useLedgerStore.setState({
      accounts,
      vendors: [makeVendor({ id: 'v1', name: 'ConEd' })],
      dimensionNodes: [],
    });

    let releaseInsert!: () => void;
    const insertGate = new Promise<void>(resolve => { releaseInsert = resolve; });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/rest/v1/dimensionNodes') && init?.method === 'POST') {
        await insertGate;
        return new Response(JSON.stringify([]), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    let savedBill: { splits?: Array<{ dimensions?: Record<string, string> }> } | undefined;
    render(
      <BillModal
        isOpen
        onClose={() => {}}
        onSave={async data => { savedBill = data as { splits?: Array<{ dimensions?: Record<string, string> }> }; }}
        accounts={accounts}
        vendors={[makeVendor({ id: 'v1', name: 'ConEd' })]}
      />,
    );

    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'v1' } });
    fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '125' } });
    fireEvent.click(screen.getByRole('button', { name: 'Labels for line 1' }));
    const propInput = screen.getByLabelText('Property for line 1') as HTMLInputElement;
    fireEvent.change(propInput, { target: { value: 'Alpha' } });

    // Start saving Alpha, then immediately change the same input to Beta while Alpha's insert is in flight
    fireEvent.click(screen.getByRole('button', { name: /Save .*Alpha.* as Property label/ }));
    fireEvent.change(propInput, { target: { value: 'Beta' } });

    await act(async () => { releaseInsert(); });
    await waitFor(() => {
      assert.ok(useLedgerStore.getState().dimensionNodes.some(n => n.description === 'Alpha'));
    });

    // Input must keep Beta rather than reverting to Alpha's node ID P1!
    assert.equal((screen.getByLabelText('Property for line 1') as HTMLInputElement).value, 'Beta');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save & Close' }));
    });
    await waitFor(() => assert.ok(savedBill));
    assert.equal(savedBill?.splits?.[0]?.dimensions?.property, 'Beta');
  });

  test('refuses overlapping axis creations in DimensionsSettings and serializes programmatic addDimensionAxisInline calls', async () => {
    // 1. Programmatic serialization check
    let storedDims: DimensionDefinition[] = [{ id: 'category', name: 'Category', systemDefault: true, sortOrder: 0 }];
    const session: DimensionActionSession = { uid: 'u1', workspaceId: 'ws1', canWriteNodes: true, canManageAxes: true };
    const adapter: DimensionNodeActionAdapter = {
      session: () => session,
      getNodes: () => [],
      setNodes: () => {},
      getWorkspaceDimensions: () => storedDims,
      setWorkspaceDimensions: (_ws, dims) => { storedDims = [...dims]; },
      writeNode: async () => {},
      readNode: async () => undefined,
      updateNode: async () => {},
      readWorkspace: async () => {
        await new Promise(r => setTimeout(r, 15));
        return { dimensions: [...storedDims] };
      },
      updateWorkspace: async (_ws, dims) => {
        await new Promise(r => setTimeout(r, 15));
        storedDims = [...dims];
      },
    };

    const [a1, a2] = await Promise.all([
      addDimensionAxisInline('Property', undefined, adapter),
      addDimensionAxisInline('Store', undefined, adapter),
    ]);
    assert.equal(a1.id, 'property');
    assert.equal(a2.id, 'store');
    assert.deepEqual(storedDims.map(d => d.id), ['category', 'property', 'store']);

    // 2. UI pending-guard check in DimensionsSettings
    const ws = setComponentWorkspace('owner');
    useAuthStore.setState({
      workspaces: [{ ...ws, dimensions: [{ id: 'category', name: 'Category', systemDefault: true, sortOrder: 0 }] }],
    });
    useLedgerStore.setState({ accounts, dimensionNodes: [] });

    let releaseUpdate!: () => void;
    const updateGate = new Promise<void>(resolve => { releaseUpdate = resolve; });
    const updateBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/rest/v1/workspaces')) {
        return new Response(
          JSON.stringify([{ id: ws.id, data: useAuthStore.getState().getCurrentWorkspace() }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('lf_update')) {
        updateBodies.push(init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {});
        await updateGate;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    render(<DimensionsSettings />);
    fireEvent.click(screen.getByRole('button', { name: /Add label/ }));
    const nameInput = screen.getByLabelText('Display Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Property' } });

    const createBtn = screen.getByRole('button', { name: 'Create label' }) as HTMLButtonElement;
    fireEvent.click(createBtn);

    await waitFor(() => assert.equal(createBtn.disabled, true));
    assert.equal(nameInput.disabled, true);

    // Clicking again while pending must not trigger a second overlapping submission
    fireEvent.click(createBtn);
    fireEvent.keyDown(nameInput, { key: 'Enter' });

    await act(async () => { releaseUpdate(); });
    await waitFor(() => {
      assert.ok(useAuthStore.getState().getCurrentWorkspace()?.dimensions?.some(d => d.id === 'property'));
    });
    assert.equal(updateBodies.length, 1);
  });

  test('computeBillRetentionReport resolves canonical project node IDs and project IDs', () => {
    const bills: Bill[] = [{
      id: 'b1',
      number: 'BILL-1',
      vendorId: 'v1',
      vendorName: 'Subcontractor',
      date: '2026-04-01',
      dueDate: '2026-05-01',
      amountCents: 100000,
      status: 'open',
      currency: 'USD',
      splits: [{ id: 's1', accountId: 'util', accountName: 'Utilities', description: 'Work', amountCents: 100000, dimensions: { project: 'P1' } }],
      metadata: { retention: { heldCents: 10000, releaseDate: '2026-06-01' } },
    } as unknown as Bill];
    const report = computeBillRetentionReport(
      bills,
      '2026-05-15',
      'USD',
      [{ id: 'P1', dimensionId: 'project', description: 'Harbor Bridge', status: 'active' }],
      [{ id: 'proj_1', name: 'Harbor Bridge' }],
    );
    assert.equal(report.rows[0].project, 'Harbor Bridge');
  });
});
