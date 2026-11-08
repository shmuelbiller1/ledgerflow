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
import { addDimensionAxisInline, buildTransactionLineDimensionPatch, deriveDimensionAxisId, ensureBillDimensionNodes, ensureInvoiceDimensionNodes, ensureTransactionDimensionNodes, matchDimensionNode, normalizeDimensionsMap, normalizeDimensionInputToNodeId, registerDimensionNodeInline, renameDimensionNodeInline, type DimensionActionSession, type DimensionNodeActionAdapter } from '../lib/dimensionNodeActions';
import { LineLabels } from '../components/common/LineLabels';
import BillModal, { type BillDraft } from '../components/purchases/BillModal';
import Purchases from '../components/purchases/Purchases';
import JournalEntryModal from '../components/ledger/JournalEntryModal';
import SplitEditor from '../components/transactions/SplitEditor';
import TransactionEditModal from '../components/transactions/TransactionEditModal';
import DimensionsSettings from '../components/platform/settings/DimensionsSettings';
import { toast } from 'sonner';
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
    setNodes: next => { nodes = [...next]; },
    getWorkspaceDimensions: () => dimensions,
    setWorkspaceDimensions: (_wsId, next) => { dimensions = [...next]; },
    writeNode: async (workspaceId, node) => { writtenNodes.push({ workspaceId, node }); },
    readNode: async (workspaceId, dimensionId, nodeId) => {
      const found = nodes.find(n => n.id === nodeId && n.dimensionId === dimensionId);
      return found ? { ...found, workspaceId } : undefined;
    },
    updateNode: async (workspaceId, dimensionId, nodeId, fields) => { updatedNodes.push({ workspaceId, dimensionId, nodeId, fields }); },
    readWorkspace: async () => ({ dimensions }),
    updateWorkspace: async (workspaceId, next) => { updatedWorkspaces.push({ workspaceId, dimensions: next }); },
  };

  return {
    adapter,
    getNodes: () => nodes,
    getDimensions: () => dimensions,
    setSession: (next: DimensionActionSession | null) => { currentSession = next; },
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

  test('project label edits drop stale links and preserve same-node renames for legacy values', () => {
    const nodes: DimensionNode[] = [
      { id: 'P1', dimensionId: 'project', description: 'Renamed Alpha', aliases: ['Alpha'], status: 'active' },
      { id: 'P2', dimensionId: 'project', description: 'Internal label', status: 'active' },
    ];
    const projects = [{ id: 'proj_alpha', name: 'Alpha' }, { id: 'proj_beta', name: 'Beta' }];
    const line: TransactionLine = { accountId: 'util', amountCents: 8000, project: 'proj_alpha', dimensions: { project: 'P1' } };
    for (const value of ['Unmatched label', 'P2']) {
      const patch = buildTransactionLineDimensionPatch(line, 'project', value, nodes, projects);
      assert.notEqual(patch.project, 'proj_alpha');
      assert.equal(patch.project, value === 'P2' ? 'Internal label' : value);
      assert.equal(patch.dimensions?.project, value);
    }
    for (const dimensions of [{ project: 'P1' }, { project: 'Alpha' }, undefined]) {
      const patch = buildTransactionLineDimensionPatch({ ...line, dimensions }, 'project', 'Renamed Alpha', nodes, projects);
      assert.equal(patch.project, 'proj_alpha');
      assert.equal(patch.dimensions?.project, 'P1');
    }
    assert.equal(buildTransactionLineDimensionPatch(line, 'project', 'Beta', nodes, projects).project, 'proj_beta');
    assert.notEqual(buildTransactionLineDimensionPatch(line, 'project', '', nodes, projects).project, 'proj_alpha');
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

    // Renaming preserves remote authoritative aliases, previous description, AND concurrently registered nodes in cache
    let releaseRenameUpdate!: () => void;
    const renameGate = new Promise<void>(resolve => { releaseRenameUpdate = resolve; });
    const gatedRenameAdapter: DimensionNodeActionAdapter = {
      ...mem.adapter,
      readNode: async (wsId, dimId, nodeId) => {
        const raw = await mem.adapter.readNode(wsId, dimId, nodeId);
        return nodeId === 'P2' ? { ...(raw || {}), aliases: ['Historic', 'Beach'] } : raw;
      },
      updateNode: async (wsId, dimId, nodeId, fields) => {
        if (nodeId === 'P2') await renameGate;
        return mem.adapter.updateNode(wsId, dimId, nodeId, fields);
      },
    };
    const pendingRename = renameDimensionNodeInline('property', 'P2', 'Maui House', 'Maui Villa', gatedRenameAdapter);
    const concurrentCreated = await registerDimensionNodeInline('property', 'Oahu Cottage', [], mem.adapter);
    assert.equal(concurrentCreated.id, 'P3');
    releaseRenameUpdate();
    const renamed = await pendingRename;
    assert.equal(renamed.description, 'Maui Villa');
    assert.deepEqual(renamed.aliases, ['Historic', 'Beach', 'Maui House']);
    assert.equal(mem.getNodes().some(n => n.id === 'P3' && n.description === 'Oahu Cottage'), true);

    // Concurrent conflict is refused
    await assert.rejects(
      renameDimensionNodeInline('property', 'P2', 'Maui House', 'Stale Rename', mem.adapter),
      /changed/,
    );

    // Bookkeeper can write nodes, but cannot add workspace axes
    mem.setSession({ uid: 'u2', workspaceId: 'ws1', canWriteNodes: true, canManageAxes: false });
    const bkNode = await registerDimensionNodeInline('property', 'Haifa Flat', [], mem.adapter);
    assert.equal(bkNode.id, 'P4');
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
      const method = (init?.method || 'GET').toUpperCase();
      const parsed = init?.body ? JSON.parse(String(init.body)) : {};
      const body = (Array.isArray(parsed) ? parsed[0] : parsed) as Record<string, unknown>;
      if (url.includes('/rpc/')) {
        rpcCalls.push({ url, body });
        return new Response(JSON.stringify(null), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'POST' && /\/rest\/v1\/dimensionNodes\b/.test(url)) {
        rpcCalls.push({ url, body });
        return new Response(JSON.stringify([body]), { status: 201, headers: { 'Content-Type': 'application/json' } });
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
    const inlineInsert = rpcCalls.find(c => /\/rest\/v1\/dimensionNodes\b/.test(c.url));
    assert.ok(inlineInsert, 'expected create-only insert on dimensionNodes');
    assert.equal((inlineInsert.body.data as { id?: string; description?: string })?.id, 'P6');
    assert.equal((inlineInsert.body.data as { description?: string })?.description, 'Maui House');

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
    useLedgerStore.setState({
      projects: [
        {
          id: 'proj_solar',
          uid: 'test-user',
          workspaceId: wsId,
          name: 'Solar Roof',
          type: 'general',
          status: 'active',
          budgetCents: 25000,
          createdAt: '2026-01-01',
          dimensions: [],
        },
      ],
    });
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

    // Line 2: type a workspace Project name and save it inline as a label -> keeps real Project ID on commit
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
    assert.equal(txPost.lines[1].project, 'proj_solar', 'inline-saved Project label must retain real Project ID on commit');
  });

  test('SplitEditor displays custom workspace dimensions, preserves manual split amounts, and keeps real Project IDs', async () => {
    const tx = makeTransaction({
      id: 'tx-split',
      description: 'Shared utility bill',
      totalAmountCents: 10000,
      lines: [
        { accountId: 'util', accountName: 'Utilities', amountCents: 9000, quantity: 2, unitPriceCents: 5000 },
        { accountId: 'rent', accountName: 'Rent', amountCents: 1000 },
      ],
    });
    const splitProjects = [
      {
        id: 'proj_alpha',
        uid: 'test-user',
        workspaceId: 'ws-1',
        name: 'Alpha Tower',
        type: 'general' as const,
        status: 'active' as const,
        budgetCents: 100000,
        createdAt: '2026-01-01',
        dimensions: [],
      },
    ];
    let savedLines: TransactionLine[] = [];
    const { container } = render(
      <SplitEditor transaction={tx} accounts={accounts} projects={splitProjects} onSave={l => { savedLines = l; }} onClose={() => {}} />,
    );

    const expandButtons = container.querySelectorAll<HTMLButtonElement>('button:has(svg.lucide-layers)');
    fireEvent.click(expandButtons[0]);

    const propInput = screen.getByLabelText('Property for split line 1');
    fireEvent.change(propInput, { target: { value: 'Penthouse' } });
    fireEvent.change(screen.getByLabelText('Project for split line 1'), { target: { value: 'Alpha Tower' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save “Penthouse” as Property label/ }));
    });
    await waitFor(() => {
      assert.equal(useLedgerStore.getState().dimensionNodes.some(n => n.id === 'P6' && n.description === 'Penthouse'), true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Commit Atomic Split' }));
    assert.equal(savedLines[0].amountCents, 9000, 'changing labels must not recalculate manual amount override');
    assert.equal(savedLines[0].project, 'proj_alpha', 'selecting a workspace project preserves its real Project.id');
    assert.equal(savedLines[0].dimensions?.property, 'P6');
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

  test('TransactionEditModal only inherits the header project for lines without project labels', async () => {
    useLedgerStore.setState({ projects: [{ id: 'proj_alpha', name: 'Alpha' }] as ReturnType<typeof useLedgerStore.getState>['projects'] });
    const tx = makeTransaction({
      project: 'Alpha',
      lines: [
        { accountId: 'util', amountCents: 100, project: 'Custom label' },
        { accountId: 'util', amountCents: 100, project: 'Custom label', dimensions: { project: 'Other label' } },
        { accountId: 'util', amountCents: 100, dimensions: { project: 'Other label' } },
        { accountId: 'bank', amountCents: -300 },
      ],
    });
    let savedLines: TransactionLine[] | undefined;
    render(<TransactionEditModal isOpen transaction={tx} accounts={accounts} onClose={() => {}}
      onUpdate={(_id, updates) => { savedLines = updates.lines; }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record synchronized changes' }));
    });
    await waitFor(() => assert.ok(savedLines));
    assert.ok(savedLines);
    assert.equal(savedLines[0].project, 'Custom label');
    assert.equal(savedLines[1].project, 'Custom label');
    assert.notEqual(savedLines[2].project, 'proj_alpha');
    assert.equal(savedLines[3].project, 'proj_alpha');
  });

  test('DimensionsSettings persists new nodes, archive toggles, aliases on existing nodes, IME guards, and new axes immediately', async () => {
    render(<DimensionsSettings />);

    // IME composition Enter must not commit partial text
    const descInput = screen.getByLabelText('Display Description for new Property value');
    fireEvent.change(descInput, { target: { value: 'Harbor' } });
    await act(async () => {
      fireEvent.keyDown(descInput, { key: 'Enter', isComposing: true, keyCode: 229 });
    });
    assert.equal(rpcCalls.length, 0, 'IME composition Enter must not submit node creation');

    // Add a new Property node via ordinary Enter -> persists immediately with verified payload
    fireEvent.change(descInput, { target: { value: 'Harbor Suite' } });
    await act(async () => {
      fireEvent.keyDown(descInput, { key: 'Enter' });
    });
    await waitFor(() => {
      assert.ok(rpcCalls.some(c => /\/rest\/v1\/dimensionNodes\b/.test(c.url)));
    });
    const createdNodeWrite = rpcCalls.find(c => /\/rest\/v1\/dimensionNodes\b/.test(c.url))!;
    assert.equal((createdNodeWrite.body.data as { id?: string; description?: string; status?: string }).id, 'P6');
    assert.equal((createdNodeWrite.body.data as { description?: string }).description, 'Harbor Suite');
    assert.equal((createdNodeWrite.body.data as { status?: string }).status, 'active');
    assert.equal(useLedgerStore.getState().dimensionNodes.some(n => n.id === 'P6' && n.description === 'Harbor Suite'), true);

    // Entering an already-existing label WITH new aliases merges those aliases (deduplicating NFD/Hebrew variants)
    fireEvent.change(descInput, { target: { value: 'Harbor Suite' } });
    fireEvent.change(screen.getByLabelText('Aliases for new Property value'), {
      target: { value: 'Café, Cafe\u0301, תל אביב, תֵּל אָבִיב' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add Node to Property/ }));
    });
    await waitFor(() => {
      assert.ok(
        rpcCalls.some(
          c =>
            c.url.includes('lf_update') &&
            c.body.p_table === 'dimensionNodes' &&
            Array.isArray((c.body.p_set as { aliases?: string[] })?.aliases),
        ),
      );
    });
    assert.deepEqual(useLedgerStore.getState().dimensionNodes.find(n => n.id === 'P6')?.aliases, ['Café', 'תל אביב']);

    // Archive P5 -> persists immediately via lf_update with status: 'archived'
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Archive Property 5 Ocean Ave/ }));
    });
    await waitFor(() => {
      assert.ok(
        rpcCalls.some(
          c =>
            c.url.includes('lf_update') &&
            c.body.p_table === 'dimensionNodes' &&
            (c.body.p_set as { status?: string })?.status === 'archived',
        ),
      );
    });
    assert.equal(useLedgerStore.getState().dimensionNodes.find(n => n.id === 'P5')?.status, 'archived');

    // Add a new Dimension Axis -> persists immediately to workspaces with 'store' in p_set.dimensions
    fireEvent.click(screen.getByRole('button', { name: /Add Dimension Axis/ }));
    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Store' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Axis' }));
    });
    await waitFor(() => {
      assert.ok(rpcCalls.some(c => c.url.includes('lf_update') && c.body.p_table === 'workspaces'));
    });
    const wsUpdate = rpcCalls.find(c => c.url.includes('lf_update') && c.body.p_table === 'workspaces')!;
    const savedAxes = (wsUpdate.body.p_set as { dimensions?: DimensionDefinition[] }).dimensions || [];
    assert.equal(savedAxes.some(d => d.id === 'store' && d.name === 'Store'), true);
    assert.equal(useAuthStore.getState().getCurrentWorkspace()?.dimensions?.some(d => d.id === 'store'), true);
  });

  test('Saving multi-line documents registers new labels sequentially, preserves slash suffixes, retries ID conflicts, and keeps real Project references', async () => {
    const remoteOccupied = new Map<string, DimensionNode>([
      ['property:P7', { id: 'P7', dimensionId: 'property', description: 'Harbor Loft', status: 'active' }],
    ]);
    const h = createMemoryAdapter({
      nodes: [
        { id: 'P5', dimensionId: 'property', description: '5 Ocean Ave', status: 'active' },
        { id: 'AB1', dimensionId: 'project', description: 'A/B Testing', status: 'active' },
      ],
    });
    // Simulate a stale local cache where P7 already exists on the server for a different label
    h.adapter.createOnlyNode = async (workspaceId, node) => {
      const key = `${node.dimensionId}:${node.id}`;
      if (remoteOccupied.has(key)) return 'conflict';
      remoteOccupied.set(key, node);
      await h.adapter.writeNode(workspaceId, node);
      return 'created';
    };
    h.adapter.readNode = async (workspaceId, dimensionId, nodeId) => {
      const remote = remoteOccupied.get(`${dimensionId}:${nodeId}`);
      if (remote) return { ...remote, workspaceId };
      const local = h.adapter.getNodes().find(n => n.id === nodeId && n.dimensionId === dimensionId);
      return local ? { ...local, workspaceId } : undefined;
    };

    assert.equal(normalizeDimensionsMap(undefined, h.adapter.getNodes()), undefined);
    assert.deepEqual(normalizeDimensionsMap({ property: '5 Ocean Ave/Unit B' }, h.adapter.getNodes()), { property: 'P5/Unit B' });

    // Multi-line invoice with two distinct new labels on the same axis allocates P1 and P2 without overwriting Roof
    const savedInvoice = await ensureInvoiceDimensionNodes(
      {
        items: [
          { dimensions: { property: 'Sunset Bungalow', project: 'Roof' } },
          { dimensions: { property: 'Cliffside Villa', project: 'Pool' } },
        ],
      },
      h.adapter,
    );
    // Sunset Bungalow gets P6; Cliffside Villa hits P7 conflict ('Harbor Loft'), preserves P7, and allocates P8!
    assert.deepEqual(savedInvoice.items?.[0].dimensions, { property: 'P6', project: 'P1' });
    assert.deepEqual(savedInvoice.items?.[1].dimensions, { property: 'P8', project: 'P2' });
    assert.equal(h.adapter.getNodes().find(n => n.dimensionId === 'project' && n.id === 'P1')?.description, 'Roof');
    assert.equal(h.adapter.getNodes().find(n => n.dimensionId === 'project' && n.id === 'P2')?.description, 'Pool');
    assert.equal(h.adapter.getNodes().find(n => n.dimensionId === 'property' && n.id === 'P7')?.description, 'Harbor Loft');

    // Hierarchical paths preserve suffix text & empty segments, and whole-string slash labels stay intact
    const savedBill = await ensureBillDimensionNodes(
      {
        splits: [
          { dimensions: { property: 'Sunset Bungalow/Guest House', project: 'A/B Testing' } },
          { dimensions: { property: 'P6//Unit 2' } },
        ],
      },
      h.adapter,
    );
    assert.deepEqual(savedBill.splits?.[0].dimensions, { property: 'P6/Guest House', project: 'AB1' });
    assert.deepEqual(savedBill.splits?.[1].dimensions, { property: 'P6//Unit 2' });

    const savedTx = await ensureTransactionDimensionNodes(
      {
        lines: [
          {
            dimensions: { project: 'Q4 Audit' },
            splitAllocations: [
              { dimensions: { property: 'Mountain Cabin' }, weight: 0.5 },
              { dimensions: { property: 'Lake Cottage' }, weight: 0.5 },
            ],
          },
        ],
      },
      h.adapter,
    );
    assert.deepEqual(savedTx.lines?.[0].dimensions, { project: 'P3' });
    assert.deepEqual(savedTx.lines?.[0].splitAllocations?.[0].dimensions, { property: 'P9' });
    assert.deepEqual(savedTx.lines?.[0].splitAllocations?.[1].dimensions, { property: 'P10' });

    // JournalEntryModal commit preserves real Project ID in line.project while canonicalizing line.dimensions.project
    const wsId = useAuthStore.getState().currentWorkspaceId!;
    useLedgerStore.setState({
      projects: [{ id: 'proj_web', uid: 'test-user', workspaceId: wsId, name: 'Website Redesign', type: 'general', status: 'active', budgetCents: 50000, createdAt: '2026-01-01', dimensions: [] }],
    });
    render(<JournalEntryModal isOpen onClose={() => {}} user={{ uid: 'test-user' } as never} accounts={accounts} workspaceId={wsId} />);
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Auto-label journal' } });
    fireEvent.click(screen.getByLabelText('Show Dimensions'));
    fireEvent.change(screen.getByLabelText('Account for line 1'), { target: { value: 'util' } });
    fireEvent.change(screen.getByLabelText('Debit amount for line 1'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Property for line 1'), { target: { value: 'Tokyo Loft' } });
    fireEvent.change(screen.getByLabelText('Project for line 1'), { target: { value: 'Website Redesign' } });
    fireEvent.change(screen.getByLabelText('Account for line 2'), { target: { value: 'bank' } });
    fireEvent.change(screen.getByLabelText('Credit amount for line 2'), { target: { value: '90' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'COMMIT TO LEDGER' }));
    });
    await waitFor(() => {
      assert.ok(rpcCalls.some(c => c.url === '/api/v1/transactions'));
    });
    const tokyoNode = useLedgerStore.getState().dimensionNodes.find(n => n.description === 'Tokyo Loft');
    const webNode = useLedgerStore.getState().dimensionNodes.find(n => n.description === 'Website Redesign');
    assert.ok(tokyoNode);
    assert.ok(webNode);
    const txPost = rpcCalls.find(c => c.url === '/api/v1/transactions')!;
    const postedLines = (txPost.body.transaction as { lines: Array<{ project?: string; dimensions?: Record<string, string> }> }).lines;
    assert.equal(postedLines[0].dimensions?.property, tokyoNode.id);
    assert.equal(postedLines[0].dimensions?.project, webNode.id);
    assert.equal(postedLines[0].project, 'proj_web', 'real Project ID must be preserved on line.project');
  });

  test('Editing a bill draft while an inline label save is pending preserves intervening edits, and failed auto-registration shows a toast error', async () => {
    let releaseInsert!: () => void;
    const insertGate = new Promise<void>(resolve => {
      releaseInsert = resolve;
    });
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method || 'GET').toUpperCase() === 'POST' && /\/rest\/v1\/dimensionNodes\b/.test(url)) {
        await insertGate;
      }
      return prevFetch(input, init);
    }) as typeof fetch;

    const savedBills: BillDraft[] = [];
    const view = render(
      <BillModal
        isOpen
        onClose={() => {}}
        onSave={b => savedBills.push(b)}
        vendors={[makeVendor({ id: 'v1', name: 'City Power' })]}
        accounts={accounts}
      />,
    );

    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'v1' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Concurrent draft edit' } });
    fireEvent.change(screen.getByLabelText('Expense Account'), { target: { value: 'util' } });
    fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Labels for line 1' }));
    fireEvent.change(screen.getByLabelText('Property for line 1'), { target: { value: 'Pending Villa' } });

    // Start the inline label save while amount is 100
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Save “Pending Villa” as Property label/ }));
    });
    // Change amount to 200 while the save is still in flight
    fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '200' } });

    // Resolve the pending insert and verify amount stays 200 and Property becomes P6
    await act(async () => {
      releaseInsert();
      await insertGate;
    });
    await waitFor(() => {
      assert.equal((screen.getByLabelText('Property for line 1') as HTMLInputElement).value, 'P6');
    });
    assert.equal((screen.getByLabelText(/^Amount \(/) as HTMLInputElement).value, '200');

    await act(async () => {
      fireEvent.click(screen.getByText('Save & Close'));
    });
    await waitFor(() => assert.equal(savedBills.length, 1));
    assert.equal(savedBills[0].splits?.[0].amountCents, 20000);
    assert.equal(savedBills[0].splits?.[0].dimensions?.property, 'P6');
    view.unmount();

    // Deleting a line while its inline label save is pending must NOT overwrite the surviving line
    let releaseDeleteGate!: () => void;
    const deleteGate = new Promise<void>(resolve => {
      releaseDeleteGate = resolve;
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method || 'GET').toUpperCase() === 'POST' && /\/rest\/v1\/dimensionNodes\b/.test(url)) {
        await deleteGate;
      }
      return prevFetch(input, init);
    }) as typeof fetch;

    const deletedLineBills: BillDraft[] = [];
    const view2 = render(
      <BillModal
        isOpen
        onClose={() => {}}
        onSave={b => deletedLineBills.push(b)}
        vendors={[makeVendor({ id: 'v1', name: 'City Power' })]}
        accounts={accounts}
      />,
    );
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'v1' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Deleted row draft' } });
    fireEvent.change(screen.getByLabelText('Expense Account'), { target: { value: 'util' } });
    fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Labels for line 1' }));
    fireEvent.change(screen.getByLabelText('Property for line 1'), { target: { value: 'Alpha Delete' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add Split Expense' }));
    fireEvent.change(screen.getAllByLabelText('Description')[1], { target: { value: 'Second split' } });
    fireEvent.change(screen.getAllByLabelText('Expense Account')[1], { target: { value: 'rent' } });
    fireEvent.change(screen.getAllByLabelText(/^Amount \(/)[1], { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Labels for line 2' }));
    fireEvent.change(screen.getByLabelText('Property for line 2'), { target: { value: 'Beta Keep' } });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Save “Alpha Delete” as Property label/ }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove split line 1' }));

    await act(async () => {
      releaseDeleteGate();
      await deleteGate;
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save & Close'));
    });
    await waitFor(() => assert.equal(deletedLineBills.length, 1));
    assert.equal(deletedLineBills[0].splits?.[0].dimensions?.property, 'Beta Keep');
    view2.unmount();

    // Now verify Purchases surfaces toast.error and keeps the modal open when auto-registration fails (>200 chars)
    globalThis.fetch = prevFetch;
    useLedgerStore.setState({ vendors: [makeVendor({ id: 'v1', name: 'City Power' })] });
    const toastErrors: string[] = [];
    const origError = toast.error;
    toast.error = ((msg: unknown) => {
      toastErrors.push(String(msg));
      return '';
    }) as typeof toast.error;
    try {
      render(<Purchases />);
      fireEvent.click(await screen.findByText('Record Bill'));
      fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'v1' } });
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Overlong label bill' } });
      fireEvent.change(screen.getByLabelText('Expense Account'), { target: { value: 'util' } });
      fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '75' } });
      fireEvent.click(screen.getByRole('button', { name: 'Labels for line 1' }));
      fireEvent.change(screen.getByLabelText('Property for line 1'), { target: { value: 'X'.repeat(205) } });

      await act(async () => {
        fireEvent.click(screen.getByText('Save & Close'));
      });
      assert.ok(toastErrors.some(m => /200 characters/i.test(m)), 'expected user-facing toast error on failed label registration');
      assert.ok(screen.getByText('Save & Close'), 'bill modal stays open with draft preserved');
    } finally {
      toast.error = origError;
    }
  });
});
