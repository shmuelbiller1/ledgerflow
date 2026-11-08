/**
 * End-to-end multi-dimension label workflow across Settings and Transaction Entry forms:
 * - Creating new label nodes inline on Invoices/Bills (LineLabels), Journal Entries, SplitEditor, and TransactionEditModal
 * - Renaming existing label nodes inline (preserving old names in aliases, without submitting enclosing forms or closing dialogs)
 * - Adding new dimension axes inline for owners/accountants (matching workspaces RLS) while bookkeepers create/rename nodes
 * - Immediate persistence in Settings → Dimensions (add node, archive/unarchive, aliases, add axis)
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  addDimensionAxisInline,
  deriveDimensionAxisId,
  ensureBillDimensionNodes,
  ensureInvoiceDimensionNodes,
  ensureTransactionDimensionNodes,
  matchDimensionNode,
  normalizeDimensionsMap,
  normalizeDimensionInputToNodeId,
  registerDimensionNodeInline,
  renameDimensionNodeInline,
  type DimensionActionSession,
  type DimensionNodeActionAdapter,
} from '../lib/dimensionNodeActions';
import { LineLabels } from '../components/common/LineLabels';
import BillModal, { type BillDraft } from '../components/purchases/BillModal';
import JournalEntryModal from '../components/ledger/JournalEntryModal';
import SplitEditor from '../components/transactions/SplitEditor';
import TransactionEditModal from '../components/transactions/TransactionEditModal';
import DimensionsSettings from '../components/platform/settings/DimensionsSettings';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount, makeTransaction, makeVendor } from './fixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { DimensionDefinition, DimensionNode, TransactionLine } from '../types';

const realFetch = globalThis.fetch;

const checking = makeChartAccount({ id: 'bank', code: '1000', name: 'Checking', type: 'asset', category: 'Cash' });
const ap = makeChartAccount({ id: 'ap', code: '2000', name: 'Accounts Payable', type: 'liability', category: 'Payables' });
const utilities = makeChartAccount({ id: 'util', code: '6200', name: 'Utilities', type: 'expense', category: 'Operating' });
const rent = makeChartAccount({ id: 'rent', code: '6300', name: 'Rent', type: 'expense', category: 'Operating' });
const accounts = [checking, ap, utilities, rent];

const baseDimensions: DimensionDefinition[] = [
  { id: 'category', name: 'Category', systemDefault: true, sortOrder: 0 },
  { id: 'property', name: 'Property', sortOrder: 1 },
  { id: 'project', name: 'Project', sortOrder: 2 },
];

function createMemoryAdapter(initial?: {
  session?: DimensionActionSession | null;
  nodes?: DimensionNode[];
  dimensions?: DimensionDefinition[];
}) {
  let currentSession: DimensionActionSession | null =
    initial && 'session' in initial
      ? initial.session ?? null
      : { uid: 'u1', workspaceId: 'ws1', canWriteNodes: true, canManageAxes: true };
  let nodes: DimensionNode[] = [...(initial?.nodes || [])];
  let dimensions: DimensionDefinition[] = [...(initial?.dimensions || baseDimensions)];
  const writtenNodes: Array<{ workspaceId: string; node: DimensionNode }> = [];
  const updatedNodes: Array<{ workspaceId: string; dimensionId: string; nodeId: string; fields: Record<string, unknown> }> = [];
  const updatedWorkspaces: Array<{ workspaceId: string; dimensions: DimensionDefinition[] }> = [];

  const adapter: DimensionNodeActionAdapter = {
    session: () => currentSession,
    getNodes: () => nodes,
    setNodes: next => {
      nodes = [...next];
    },
    getWorkspaceDimensions: () => dimensions,
    setWorkspaceDimensions: (_wsId, next) => {
      dimensions = [...next];
    },
    writeNode: async (workspaceId, node) => {
      writtenNodes.push({ workspaceId, node });
    },
    readNode: async (workspaceId, dimensionId, nodeId) => {
      const found = nodes.find(n => n.id === nodeId && n.dimensionId === dimensionId);
      return found ? { ...found, workspaceId } : undefined;
    },
    updateNode: async (workspaceId, dimensionId, nodeId, fields) => {
      updatedNodes.push({ workspaceId, dimensionId, nodeId, fields });
    },
    readWorkspace: async () => ({ dimensions }),
    updateWorkspace: async (workspaceId, next) => {
      updatedWorkspaces.push({ workspaceId, dimensions: next });
    },
  };

  return {
    adapter,
    getNodes: () => nodes,
    getDimensions: () => dimensions,
    setSession: (next: DimensionActionSession | null) => {
      currentSession = next;
    },
    writtenNodes,
    updatedNodes,
    updatedWorkspaces,
  };
}

describe('Pure dimension helpers & scoped adapter actions', () => {
  test('matches by ID, description, alias, and mixed Hebrew/English Unicode; normalizes hierarchical paths', () => {
    const nodes: DimensionNode[] = [
      { id: 'P5', dimensionId: 'property', description: '5 Ocean Ave', aliases: ['Ocean House'], status: 'active' },
      { id: 'P6', dimensionId: 'property', description: 'דירה 4 תל אביב', aliases: ['TLV Apt'], status: 'active' },
    ];
    assert.equal(matchDimensionNode(nodes, 'property', 'p5')?.id, 'P5');
    assert.equal(matchDimensionNode(nodes, 'property', '5 Ocean Ave')?.id, 'P5');
    assert.equal(matchDimensionNode(nodes, 'property', 'ocean house')?.id, 'P5');
    assert.equal(matchDimensionNode(nodes, 'property', 'דירה 4 תל אביב')?.id, 'P6');
    assert.equal(matchDimensionNode(nodes, 'property', 'Unassigned'), undefined);

    assert.equal(normalizeDimensionInputToNodeId(nodes, 'property', '5 Ocean Ave'), 'P5');
    assert.equal(normalizeDimensionInputToNodeId(nodes, 'property', 'Ocean House/Unit B'), 'P5/Unit B');
    assert.equal(normalizeDimensionInputToNodeId(nodes, 'property', 'Maui Villa'), 'Maui Villa');
  });

  test('derives clean unique axis IDs for English and Hebrew display names', () => {
    assert.equal(deriveDimensionAxisId('Cost Center', baseDimensions), 'cost_center');
    assert.equal(deriveDimensionAxisId('Property', baseDimensions), 'property_1');
    assert.equal(deriveDimensionAxisId('נכס מניב', baseDimensions), 'dim_1');
    assert.throws(() => deriveDimensionAxisId('Dup', baseDimensions, 'property'), /already exists/);
  });

  test('registers new nodes, reactivates archived ones, renames with alias history, and guards roles & workspace switches', async () => {
    const mem = createMemoryAdapter({
      nodes: [{ id: 'P1', dimensionId: 'property', description: 'Old Loft', status: 'archived' }],
    });

    // Reactivating archived node keeps its P1 code instead of minting a duplicate
    const reactivated = await registerDimensionNodeInline('property', 'Old Loft', [], mem.adapter);
    assert.equal(reactivated.id, 'P1');
    assert.equal(reactivated.status, 'active');
    assert.equal(mem.updatedNodes.length, 1);

    // Minting a brand-new node gets P2
    const created = await registerDimensionNodeInline('property', 'Maui House', ['Beach'], mem.adapter);
    assert.equal(created.id, 'P2');
    assert.equal(created.description, 'Maui House');
    assert.deepEqual(created.aliases, ['Beach']);
    assert.equal(mem.writtenNodes.length, 1);

    // Renaming preserves previous description in aliases
    const renamed = await renameDimensionNodeInline('property', 'P2', 'Maui House', 'Maui Villa', mem.adapter);
    assert.equal(renamed.description, 'Maui Villa');
    assert.deepEqual(renamed.aliases, ['Beach', 'Maui House']);

    // Concurrent conflict is refused
    await assert.rejects(
      renameDimensionNodeInline('property', 'P2', 'Maui House', 'Stale Rename', mem.adapter),
      /changed/,
    );

    // Bookkeeper can write nodes, but cannot add workspace axes
    mem.setSession({ uid: 'u2', workspaceId: 'ws1', canWriteNodes: true, canManageAxes: false });
    const bkNode = await registerDimensionNodeInline('property', 'Haifa Flat', [], mem.adapter);
    assert.equal(bkNode.id, 'P3');
    await assert.rejects(addDimensionAxisInline('Vehicle', undefined, mem.adapter), /owners and accountants/);

    // Owner/accountant can add a new axis, preserving existing axes
    mem.setSession({ uid: 'u1', workspaceId: 'ws1', canWriteNodes: true, canManageAxes: true });
    const axis = await addDimensionAxisInline('Vehicle', undefined, mem.adapter);
    assert.equal(axis.id, 'vehicle');
    assert.equal(mem.getDimensions().some(d => d.id === 'vehicle'), true);

    // Workspace switch during write aborts store mutation
    const switchingAdapter: DimensionNodeActionAdapter = {
      ...mem.adapter,
      writeNode: async () => {
        mem.setSession({ uid: 'u1', workspaceId: 'other-ws', canWriteNodes: true, canManageAxes: true });
      },
    };
    await assert.rejects(registerDimensionNodeInline('property', 'Cross Ws', [], switchingAdapter), /Workspace/);
    assert.equal(mem.getNodes().some(n => n.description === 'Cross Ws'), false);
  });
});

describe('Inline label creation, renaming, and new dimensions across transaction forms', () => {
  let rpcCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

  beforeEach(() => {
    rpcCalls = [];
    const ws = setComponentWorkspace('owner');
    ws.dimensions = baseDimensions.map(d => ({ ...d }));
    useAuthStore.setState({ currentWorkspaceId: ws.id, workspaces: [ws] });
    useLedgerStore.setState({
      accounts,
      baseCurrency: 'USD',
      dimensionNodes: [{ id: 'P5', dimensionId: 'property', description: '5 Ocean Ave', status: 'active' }],
      bills: [],
      invoices: [],
      transactions: [],
      taxRates: [],
      lockDate: null,
      lockException: null,
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (url.includes('/rpc/')) {
        rpcCalls.push({ url, body });
        return new Response(JSON.stringify(null), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/dimensionNodes?') && url.includes('P5')) {
        const current = useLedgerStore.getState().dimensionNodes.find(n => n.id === 'P5');
        return new Response(
          JSON.stringify([{ id: `${ws.id}_property_P5`, workspace_id: ws.id, data: { ...current, workspaceId: ws.id } }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/workspaces?')) {
        const currentWs = useAuthStore.getState().getCurrentWorkspace();
        return new Response(
          JSON.stringify([{ id: ws.id, data: { ...currentWs } }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/v1/transactions')) {
        rpcCalls.push({ url, body });
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  });

  afterEach(async () => {
    cleanup();
    globalThis.fetch = realFetch;
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
  });

  test('BillModal / LineLabels: create a new label, rename an existing label with Enter without submitting, and add a new dimension', async () => {
    const savedBills: BillDraft[] = [];
    let closed = false;
    render(
      <BillModal
        isOpen
        onClose={() => {
          closed = true;
        }}
        onSave={b => savedBills.push(b)}
        vendors={[makeVendor({ id: 'v1', name: 'City Power' })]}
        accounts={accounts}
      />,
    );

    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'v1' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Water & Power' } });
    fireEvent.change(screen.getByLabelText('Expense Account'), { target: { value: 'util' } });
    fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '250' } });

    // Open Labels on line 1 and type a brand-new Property label
    fireEvent.click(screen.getByRole('button', { name: 'Labels for line 1' }));
    const propInput = screen.getByLabelText('Property for line 1');
    fireEvent.change(propInput, { target: { value: 'Maui House' } });

    // Save "Maui House" inline -> mints P6, writes to dimensionNodes, selects P6 on the line
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save “Maui House” as Property label/ }));
    });
    await waitFor(() => {
      assert.equal(useLedgerStore.getState().dimensionNodes.some(n => n.id === 'P6' && n.description === 'Maui House'), true);
    });
    assert.equal((screen.getByLabelText('Property for line 1') as HTMLInputElement).value, 'P6');
    assert.ok(rpcCalls.some(c => c.url.includes('lf_set') && c.body.p_table === 'dimensionNodes'));

    // Rename P5 ("5 Ocean Ave" -> "5 Ocean Blvd") using Enter; parent dialog stays open and unsaved
    fireEvent.change(propInput, { target: { value: 'P5' } });
    fireEvent.click(screen.getByRole('button', { name: /Rename Property label 5 Ocean Ave/ }));
    const renameInput = screen.getByLabelText(/New name for Property label 5 Ocean Ave/);
    // Escape cancels without closing BillModal
    act(() => {
      fireEvent.keyDown(renameInput, { key: 'Escape' });
    });
    assert.equal(closed, false, 'Escape inside inline rename must not close BillModal');

    // Open rename again and press Enter to commit
    fireEvent.click(screen.getByRole('button', { name: /Rename Property label 5 Ocean Ave/ }));
    const renameInput2 = screen.getByLabelText(/New name for Property label 5 Ocean Ave/);
    fireEvent.change(renameInput2, { target: { value: '5 Ocean Blvd' } });
    await act(async () => {
      fireEvent.keyDown(renameInput2, { key: 'Enter' });
    });
    await waitFor(() => {
      assert.equal(useLedgerStore.getState().dimensionNodes.find(n => n.id === 'P5')?.description, '5 Ocean Blvd');
    });
    assert.equal(savedBills.length, 0, 'Enter inside inline rename must not submit BillModal');
    assert.match(screen.getByRole('button', { name: /Labels for line 1/ }).textContent || '', /Property 5 Ocean Blvd/);

    // Add a brand-new dimension ("Vehicle") inline without leaving the bill
    fireEvent.click(screen.getByRole('button', { name: 'New dimension' }));
    const newDimInput = screen.getByLabelText('New dimension name');
    fireEvent.change(newDimInput, { target: { value: 'Vehicle' } });
    await act(async () => {
      fireEvent.keyDown(newDimInput, { key: 'Enter' });
    });
    await waitFor(() => {
      assert.ok(screen.getByLabelText('Vehicle for line 1'));
    });

    // Save the bill and confirm the line labels are persisted cleanly
    await act(async () => {
      fireEvent.click(screen.getByText('Save & Close'));
    });
    await waitFor(() => assert.equal(savedBills.length, 1));
    assert.deepEqual(savedBills[0].splits?.[0].dimensions, { property: 'P5' });
  });

  test('viewer sees read-only labels without inline create/rename/new-dimension controls; bookkeeper can create labels but not axes', () => {
    const bk = setComponentWorkspace('bookkeeper');
    bk.dimensions = baseDimensions.map(d => ({ ...d }));
    useAuthStore.setState({ currentWorkspaceId: bk.id, workspaces: [bk] });
    const view = render(<LineLabels value={{ property: 'New Spot' }} lineNumber={1} accountId="util" date="2026-05-10" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Labels for line 1/ }));
    assert.ok(screen.getByRole('button', { name: /Save “New Spot” as Property label/ }));
    assert.equal(screen.queryByRole('button', { name: 'New dimension' }), null, 'bookkeeper cannot mutate workspaces.dimensions');

    view.unmount();
    const viewer = setComponentWorkspace('viewer');
    viewer.dimensions = baseDimensions.map(d => ({ ...d }));
    useAuthStore.setState({ currentWorkspaceId: viewer.id, workspaces: [viewer] });
    render(<LineLabels value={{ property: 'New Spot' }} lineNumber={1} accountId="util" date="2026-05-10" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Labels for line 1/ }));
    assert.equal(screen.queryByRole('button', { name: /Save “New Spot”/ }), null);
    assert.equal(screen.queryByRole('button', { name: 'New dimension' }), null);
  });

  test('JournalEntryModal offers datalist suggestions, creates new labels inline, and normalizes descriptions to node IDs on commit', async () => {
    const wsId = useAuthStore.getState().currentWorkspaceId!;
    render(
      <JournalEntryModal
        isOpen
        onClose={() => {}}
        user={{ uid: 'test-user' } as never}
        accounts={accounts}
        workspaceId={wsId}
      />,
    );

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Accrual by property' } });
    fireEvent.click(screen.getByLabelText('Show Dimensions'));

    // Datalist options for registered nodes exist on Journal Entry dimension inputs
    assert.ok(document.querySelector('#je-dim-list-property-0 option[value="P5"]'));

    // Line 1: type human description of existing P5 ("5 Ocean Ave") -> normalized to P5 on commit
    fireEvent.change(screen.getByLabelText('Account for line 1'), { target: { value: 'util' } });
    fireEvent.change(screen.getByLabelText('Debit amount for line 1'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Property for line 1'), { target: { value: '5 Ocean Ave' } });

    // Line 2: type a brand-new project label and save it inline without submitting the journal form
    fireEvent.change(screen.getByLabelText('Account for line 2'), { target: { value: 'bank' } });
    fireEvent.change(screen.getByLabelText('Credit amount for line 2'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Project for line 2'), { target: { value: 'Solar Roof' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save “Solar Roof” as Project label/ }));
    });
    await waitFor(() => {
      assert.equal(useLedgerStore.getState().dimensionNodes.some(n => n.id === 'P1' && n.dimensionId === 'project'), true);
    });
    assert.equal(rpcCalls.some(c => c.url === '/api/v1/transactions'), false, 'saving label inline did not submit journal form');

    // Commit the journal entry
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'COMMIT TO LEDGER' }));
    });
    await waitFor(() => assert.ok(rpcCalls.some(c => c.url === '/api/v1/transactions')));
    const txPost = rpcCalls.find(c => c.url === '/api/v1/transactions')!.body.transaction as { lines: TransactionLine[] };
    assert.deepEqual(txPost.lines[0].dimensions, { property: 'P5' });
    assert.deepEqual(txPost.lines[1].dimensions, { project: 'P1' });
  });

  test('SplitEditor displays custom workspace dimensions and saves new labels inline', async () => {
    const tx = makeTransaction({
      id: 'tx-split',
      description: 'Shared utility bill',
      totalAmountCents: 10000,
      lines: [
        { accountId: 'util', accountName: 'Utilities', amountCents: 6000 },
        { accountId: 'rent', accountName: 'Rent', amountCents: 4000 },
      ],
    });
    let savedLines: TransactionLine[] = [];
    const { container } = render(
      <SplitEditor transaction={tx} accounts={accounts} projects={[]} onSave={l => { savedLines = l; }} onClose={() => {}} />,
    );

    const expandButtons = container.querySelectorAll<HTMLButtonElement>('button:has(svg.lucide-layers)');
    fireEvent.click(expandButtons[0]);

    const propInput = screen.getByLabelText('Property for split line 1');
    fireEvent.change(propInput, { target: { value: 'Penthouse' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save “Penthouse” as Property label/ }));
    });
    await waitFor(() => {
      assert.equal(useLedgerStore.getState().dimensionNodes.some(n => n.id === 'P6' && n.description === 'Penthouse'), true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Commit Atomic Split' }));
    assert.deepEqual(savedLines[0].dimensions, { property: 'P6' });
  });

  test('TransactionEditModal saves new inline labels on open entries and hides write actions when locked', async () => {
    const tx = makeTransaction({
      id: 'tx-edit',
      date: '2026-06-15',
      description: 'Cleaning service',
      totalAmountCents: 8000,
      lines: [
        { accountId: 'util', accountName: 'Utilities', amountCents: 8000 },
        { accountId: 'bank', accountName: 'Checking', amountCents: -8000 },
      ],
    });
    let updatedLines: TransactionLine[] | undefined;
    const view = render(
      <TransactionEditModal
        isOpen
        transaction={tx}
        accounts={accounts}
        lockDate="2026-05-31"
        onClose={() => {}}
        onUpdate={(_id, updates) => {
          updatedLines = updates.lines;
        }}
      />,
    );

    const propInput = screen.getByLabelText('Property for line 1');
    fireEvent.change(propInput, { target: { value: 'Garden Unit' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save “Garden Unit” as Property label/ }));
    });
    await waitFor(() => {
      assert.equal(useLedgerStore.getState().dimensionNodes.some(n => n.id === 'P6' && n.description === 'Garden Unit'), true);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record synchronized changes' }));
    });
    await waitFor(() => assert.ok(updatedLines));
    assert.deepEqual(updatedLines?.[0].dimensions, { property: 'P6' });

    // Locked period hides New dimension and inline label save buttons
    view.unmount();
    render(
      <TransactionEditModal
        isOpen
        transaction={{ ...tx, lines: [{ accountId: 'util', accountName: 'Utilities', amountCents: 8000, dimensions: { property: 'P5' } }, tx.lines[1]] }}
        accounts={accounts}
        lockDate="2026-07-01"
        onClose={() => {}}
        onUpdate={() => {}}
      />,
    );
    assert.equal(screen.queryByRole('button', { name: 'New dimension' }), null);
    assert.equal(screen.queryByRole('button', { name: /Rename Property label/ }), null);
  });

  test('DimensionsSettings persists new nodes, archive toggles, and new axes immediately without waiting for bottom save', async () => {
    render(<DimensionsSettings />);

    // Add a new Property node via Enter -> persists immediately to dimensionNodes
    const descInput = screen.getByLabelText('Display Description for new Property value');
    fireEvent.change(descInput, { target: { value: 'Harbor Suite' } });
    await act(async () => {
      fireEvent.keyDown(descInput, { key: 'Enter' });
    });
    await waitFor(() => {
      assert.ok(rpcCalls.some(c => c.url.includes('lf_set') && c.body.p_table === 'dimensionNodes'));
    });
    assert.equal(useLedgerStore.getState().dimensionNodes.some(n => n.id === 'P6' && n.description === 'Harbor Suite'), true);

    // Archive P5 -> persists immediately via lf_update
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Archive Property 5 Ocean Ave/ }));
    });
    await waitFor(() => {
      assert.ok(rpcCalls.some(c => c.url.includes('lf_update') && c.body.p_table === 'dimensionNodes'));
    });
    assert.equal(useLedgerStore.getState().dimensionNodes.find(n => n.id === 'P5')?.status, 'archived');

    // Add a new Dimension Axis -> persists immediately to workspaces
    fireEvent.click(screen.getByRole('button', { name: /Add Dimension Axis/ }));
    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Store' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Axis' }));
    });
    await waitFor(() => {
      assert.ok(rpcCalls.some(c => c.url.includes('lf_update') && c.body.p_table === 'workspaces'));
    });
    assert.equal(useAuthStore.getState().getCurrentWorkspace()?.dimensions?.some(d => d.id === 'store'), true);
  });

  test('Saving an Invoice, Bill, Transaction, or Journal Entry auto-registers newly typed dimension labels via findOrCreateDimensionNode', async () => {
    const h = createMemoryAdapter({
      nodes: [
        { id: 'P5', dimensionId: 'property', description: '5 Ocean Ave', status: 'active' },
        { id: 'PRJ1', dimensionId: 'project', description: 'Website Launch', status: 'active' },
      ],
    });
    assert.equal(normalizeDimensionsMap(undefined, h.adapter.getNodes()), undefined);
    assert.deepEqual(normalizeDimensionsMap({ property: '5 Ocean Ave' }, h.adapter.getNodes()), { property: 'P5' });

    const savedInvoice = await ensureInvoiceDimensionNodes(
      { items: [{ dimensions: { property: 'Sunset Bungalow', project: 'Website Launch' } }] },
      h.adapter,
    );
    assert.deepEqual(savedInvoice.items?.[0].dimensions, { property: 'P6', project: 'PRJ1' });
    assert.equal(h.adapter.getNodes().some(n => n.id === 'P6' && n.description === 'Sunset Bungalow'), true);

    const savedBill = await ensureBillDimensionNodes(
      { splits: [{ dimensions: { property: 'Sunset Bungalow / Guest House' } }] },
      h.adapter,
    );
    assert.deepEqual(savedBill.splits?.[0].dimensions, { property: 'P6/P7' });

    const savedTx = await ensureTransactionDimensionNodes(
      {
        lines: [
          {
            dimensions: { project: 'Q4 Audit' },
            splitAllocations: [{ dimensions: { property: 'Mountain Cabin' }, weight: 1 }],
          },
        ],
      },
      h.adapter,
    );
    assert.deepEqual(savedTx.lines?.[0].dimensions, { project: 'P1' });
    assert.deepEqual(savedTx.lines?.[0].splitAllocations?.[0].dimensions, { property: 'P8' });

    // JournalEntryModal commit without clicking the inline "+ Save" button still auto-registers the label
    const wsId = useAuthStore.getState().currentWorkspaceId!;
    render(
      <JournalEntryModal
        isOpen
        onClose={() => {}}
        user={{ uid: 'test-user' } as never}
        accounts={accounts}
        workspaceId={wsId}
      />,
    );
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Auto-label journal' } });
    fireEvent.click(screen.getByLabelText('Show Dimensions'));
    fireEvent.change(screen.getByLabelText('Account for line 1'), { target: { value: 'util' } });
    fireEvent.change(screen.getByLabelText('Debit amount for line 1'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Property for line 1'), { target: { value: 'Tokyo Loft' } });
    fireEvent.change(screen.getByLabelText('Account for line 2'), { target: { value: 'bank' } });
    fireEvent.change(screen.getByLabelText('Credit amount for line 2'), { target: { value: '90' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'COMMIT TO LEDGER' }));
    });
    await waitFor(() => {
      assert.ok(rpcCalls.some(c => c.url === '/api/v1/transactions'));
    });
    const tokyoNode = useLedgerStore.getState().dimensionNodes.find(n => n.description === 'Tokyo Loft');
    assert.ok(tokyoNode, 'Tokyo Loft should be auto-registered in dimensionNodes on journal save');
    const txPost = rpcCalls.find(c => c.url === '/api/v1/transactions')!;
    const postedLines = (txPost.body.transaction as { lines: Array<{ dimensions?: Record<string, string> }> }).lines;
    assert.equal(postedLines[0].dimensions?.property, tokyoNode.id);
  });
});
