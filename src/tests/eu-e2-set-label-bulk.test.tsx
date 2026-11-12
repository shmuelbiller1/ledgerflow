/**
 * EU-E2: "Set label" on a selection puts one label value on every selected entry and on its category lines — the
 * bank line keeps its own — in one batch save, and Undo puts back exactly what was there.
 * By hand: two fuel entries of 40.00 (Fuel 4000 / Bank -4000); Property = Maui on both.
 */
import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { testEntryActions } from './helpers/entryActions';
import SelectionBar from '../components/transactions/SelectionBar';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { makeTransaction } from './fixtures';
import { expenseAccounts } from './helpers/expenseAccounts';
import { getSupabase } from '../lib/db/client';

const accounts = expenseAccounts('fuel');
const fuel = (id: string) => makeTransaction({ id, workspaceId: 'A', description: 'Shell', totalAmountCents: 4000, dimensions: { class: 'ops' },
  lines: [{ accountId: 'fuel', amountCents: 4000 }, { accountId: 'bank', amountCents: -4000 }] });

const realFetch = globalThis.fetch;
const realSuccess = toast.success;
let sent: Array<{ updates: Array<{ id: string; data: { dimensions?: Record<string, string>; lines?: Array<{ accountId: string; dimensions?: Record<string, string> }> } }> }> = [];
let undo: (() => Promise<void>) | undefined;
beforeEach(() => {
  sent = []; undo = undefined;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body || '{}'))); return new Response('{}', { status: 200 }); }) as typeof fetch;
  (toast as { success: unknown }).success = (_m: unknown, opts?: { action?: { onClick: () => Promise<void> } }) => { undo = opts?.action?.onClick; return 1; };
  useAuthStore.setState({ currentWorkspaceId: 'A' });
  useLedgerStore.setState({ accounts, transactions: [fuel('t1'), fuel('t2')], dimensionNodes: [{ id: 'maui', dimensionId: 'property', description: 'Maui house' }] });
});
afterEach(async () => { cleanup(); globalThis.fetch = realFetch; (toast as { success: unknown }).success = realSuccess; await getSupabase().auth.dispose(); });

const actions = () => testEntryActions('A', accounts);

test('EU-E2: Property = Maui on both entries and their fuel lines; the bank lines keep theirs; Undo restores', async () => {
  await actions().handleBulkUpdate(['t1', 't2'], { labels: { property: 'maui' } });
  const batch = sent.find(b => b.updates);
  assert.ok(batch);
  for (const u of batch!.updates) {
    assert.deepEqual(u.data.dimensions, { class: 'ops', property: 'maui' }, 'the entry keeps its other labels');
    assert.deepEqual(u.data.lines!.map(l => [l.accountId, l.dimensions?.property]), [['fuel', 'maui'], ['bank', undefined]]);
  }
  assert.deepEqual(useLedgerStore.getState().transactions.map(t => t.dimensions?.property), ['maui', 'maui']);
  assert.ok(undo, 'the toast offers Undo');
  await undo!();
  assert.deepEqual(useLedgerStore.getState().transactions.map(t => t.dimensions), [{ class: 'ops' }, { class: 'ops' }]);
});

test('EU-E2: the selection bar sends the chosen label and the value picked by its description', () => {
  useAuthStore.setState({ currentWorkspaceId: 'A', workspaces: [{ id: 'A', name: 'A', dimensions: [{ id: 'category', name: 'Category' }, { id: 'property', name: 'Property' }] }] as never });
  const calls: unknown[] = [];
  render(<SelectionBar selectedCount={2} totalAmount={8000} avgAmount={4000} onCopy={() => {}} onClear={() => {}} onBulkUpdate={u => calls.push(u)} accounts={accounts} formatCurrency={c => String(c)} />);
  fireEvent.change(screen.getByLabelText('Set label'), { target: { value: 'Maui house' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set' }));
  assert.deepEqual(calls, [{ labels: { property: 'maui' } }]);
});
