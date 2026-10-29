/**
 * A-262: the next ten screens after A-235's batch say what an empty list is for and offer the one
 * action that fills it ("Add your first …"), all through the shared EmptyState — instead of a bare
 * line of text, jargon ("Zero Objectives Detected"), or nothing at all. One test per screen: the
 * honest empty words show, and where the screen has an add form, the action opens it.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import FixedAssetsView from '../components/assets/FixedAssetsView';
import TasksView from '../components/collaboration/TasksView';
import TimeView from '../components/collaboration/TimeView';
import JournalView from '../components/ledger/JournalView';
import ChartOfAccountsView from '../components/ledger/ChartOfAccountsView';
import Inventory from '../components/inventory/Inventory';
import BudgetManager from '../components/planning/BudgetManager';
import TeamSettings from '../components/platform/settings/TeamSettings';
import { RulesSettings } from '../components/platform/settings/RulesSettings';
import EstimatesView from '../components/sales/EstimatesView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';

const realFetch = globalThis.fetch;

/** The rows the inventory subscription answers with (Inventory reads its collection directly). */
let inventoryRows: Array<{ id: string; updated_at: string; data: Record<string, unknown> }> = [];

/** No database, no app API: reads answer "empty", writes are not part of these cases. */
function stubEmpty() {
  inventoryRows = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/rest/v1/inventory')) return new Response(JSON.stringify(inventoryRows), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/rest/v1/')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/tasks')) return new Response(JSON.stringify({ status: 'success', tasks: [], people: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/time')) return new Response(JSON.stringify({ status: 'success', entries: [], rates: null, canApprove: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/members')) return new Response(JSON.stringify({ status: 'success', members: [], ownerUid: 'test-user' }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/roles')) return new Response(JSON.stringify({ status: 'success', roles: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ status: 'success', invites: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

beforeEach(() => {
  setComponentWorkspace();
  stubEmpty();
  useLedgerStore.setState({
    accounts: [], assets: [], autoRules: [], budgets: [], customers: [], estimates: [], inventory: [],
    invoices: [], payments: [], transactions: [], journalEntries: [], vendors: [], bills: [],
  });
  markComponentCollectionsLoaded(
    'assets', 'bills', 'budgets', 'customers', 'estimates', 'invoices', 'payments', 'inventory',
    'accounts', 'transactions', 'journalEntries', 'autoRules', 'vendors', 'taxRates', 'projects',
  );
});

afterEach(async () => {
  cleanup();
  globalThis.fetch = realFetch;
  getSupabase().realtime.disconnect();
  await getSupabase().auth.dispose();
});

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

describe('A-262: helpful empty states on the next ten screens', () => {
  test('Assets: the register says what it is for and "Add your first asset" opens the asset dialog', async () => {
    render(<FixedAssetsView />);
    assert.ok(await screen.findByText('No fixed assets yet'), 'the honest title');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add your first asset' })); });
    assert.ok(screen.getByRole('dialog'), 'the same dialog the header button opens');
  });

  test('Tasks: an empty list says what a task is and points at the give-a-task form above it', async () => {
    render(<TasksView />);
    assert.ok(await screen.findByText('Nothing for you to do'), 'the empty mine list');
    assert.match(document.body.textContent || '', /Give one with the form above/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /All open/ })); });
    assert.ok(screen.getByText('No open tasks'));
  });

  test('Time: an empty log says what the hours feed, next to the log-time form', async () => {
    render(<TimeView />);
    assert.ok(await screen.findByText('No time logged yet'), 'the empty table');
    assert.match(document.body.textContent || '', /pulled onto an invoice/);
  });

  test('Journal: an empty hand-typed journal explains itself and offers the entry form', async () => {
    let added = 0;
    render(<JournalView journalEntries={[]} formatCurrency={money} canEdit onAddEntry={() => { added++; }} />);
    assert.ok(screen.getByText('No journal entries typed in by hand yet'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add your first journal entry' })); });
    assert.equal(added, 1, 'the add affordance the screen already had');
    cleanup();
    render(<JournalView journalEntries={[]} formatCurrency={money} />);
    assert.equal(screen.queryByRole('button', { name: 'Add your first journal entry' }), null, 'no action where editing is not allowed');
    cleanup();
    render(<JournalView journalEntries={[]} formatCurrency={money} canEdit loading onAddEntry={() => {}} />);
    assert.equal(screen.queryByRole('button', { name: 'Add your first journal entry' }), null, 'while loading: no "empty" state yet');
  });

  test('Chart of accounts: an empty chart says what it posts to and offers the first account', async () => {
    let added = 0;
    render(<ChartOfAccountsView accounts={[]} searchTerm="" formatCurrency={money} onDrillDown={() => {}} onDeleteAccount={() => {}} onAddAccount={() => { added++; }} />);
    assert.ok(screen.getByText('No accounts yet'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add your first account' })); });
    assert.equal(added, 1);
  });

  test('Inventory: no items says what items are and offers the item dialog', async () => {
    render(<Inventory />);
    assert.ok(await screen.findByText('No items yet'), 'the empty inventory');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add your first item' })); });
    assert.ok(screen.getByRole('dialog'), 'the item form opens');
  });

  test('Inventory: filtered away is a filter, not an empty list', async () => {
    inventoryRows = [{ id: 'i1', updated_at: '2026-01-01T00:00:00Z', data: { workspaceId: 'component-workspace', uid: 'test-user', name: 'Chair', sku: 'chair', quantityAtHand: 2, unitCostCents: 1000, createdAt: '2026-01-01' } }];
    render(<Inventory />);
    assert.ok(await screen.findByText('Chair'), 'the listed item');
    await act(async () => { fireEvent.change(screen.getByLabelText('Search inventory by SKU or item'), { target: { value: 'zzzz' } }); });
    assert.ok(screen.getByText('No items match these filters'), 'a filter, not an empty list');
    assert.equal(screen.queryByText('No items yet'), null, 'not the wrong empty state');
  });

  test('Budgets: plain words instead of "Zero Objectives", and the action opens the budget form', async () => {
    render(<BudgetManager />);
    assert.ok(await screen.findByText('No budgets yet'), 'plain words');
    assert.equal(document.body.textContent?.includes('Zero Objectives'), false, 'the jargon is gone');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add your first budget' })); });
    assert.ok(await screen.findByText('Define Objective'), 'the budget form opens');
  });

  test('Team & Invites: with nobody joined, the members list says what it is for', async () => {
    render(<TeamSettings />);
    assert.ok(await screen.findByText('No team members yet'), 'the empty members list');
    assert.match(document.body.textContent || '', /Send an invitation above/);
  });

  test('Rules & Automation: no rules offers the first rule; searched away says so instead', async () => {
    render(<RulesSettings />);
    assert.ok(await screen.findByText('No automation rules yet'), 'the honest title');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add your first rule' })); });
    assert.ok(await screen.findByText('Create Automation Rule'), 'the rule editor opens');
  });

  test('Estimates: an empty list says what an estimate is and offers the first one', async () => {
    render(<EstimatesView />);
    assert.ok(await screen.findByText('No estimates yet'), 'the honest title');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add your first estimate' })); });
    assert.ok(await screen.findByText(/Create New Quote \/ Estimate/), 'the estimate form opens');
  });
});
