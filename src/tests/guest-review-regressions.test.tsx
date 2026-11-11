import './helpers/dom';
import React from 'react';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { loadGuestCompany, replaceGuestCompany } from '../lib/guestCompany';
import { endGuestDatabase, startGuestDatabase, initializeGuestDatabase, guestSession, guestReady, guestRows, writeGuestBatch } from '../lib/db/guestDatabase';
import { readGuestStages, saveGuestStages, saveGuestAlerts } from '../lib/guestSettings';
import { saveGuestNumbering, allocateGuestNumber } from '../lib/guestNumbering';
import { saveWorkspacePriceLists } from '../services/workspacePriceLists';
import { deleteWithUndo, undoDelete, isDeletePending } from '../lib/undoableDelete';
import GuestCountrySamplePicker from '../components/support/GuestCountrySamplePicker';
import InventoryItemDialog from '../components/inventory/InventoryItemDialog';

const initial = useAuthStore.getState();
afterEach(() => { cleanup(); useAuthStore.getState().setIsGuest(false); useAuthStore.setState(initial); endGuestDatabase(); sessionStorage.clear(); });
function sample() { useAuthStore.setState({ user: null, isGuest: false }); useAuthStore.getState().setIsGuest(true); loadGuestCompany(); }

test('blocked sessionStorage removal cannot interrupt guest exit or retain local listeners', () => {
  sample();
  const storage = Object.getPrototypeOf(sessionStorage);
  const remove = storage.removeItem;
  storage.removeItem = () => { throw new Error('blocked'); };
  try { useAuthStore.getState().setIsGuest(false); } finally { storage.removeItem = remove; }
  assert.equal(useAuthStore.getState().isGuest, false);
  assert.equal(useAuthStore.getState().currentWorkspaceId, null);
  assert.equal(guestReady(), false);
  assert.equal(useLedgerStore.getState().invoices.length, 0);
});

test('malformed stored table maps and records are rejected in favor of the seed', () => {
  for (const customers of [null, [], 'bad', { c: null }, { c: [] }, { c: { workspaceId: 'other' } }]) {
    endGuestDatabase();
    sessionStorage.setItem('ledgerflow_sample_company_v1', JSON.stringify({ workspaces: { guest: { id: 'guest' } }, customers }));
    startGuestDatabase();
    initializeGuestDatabase({ workspaces: { guest: { id: 'guest' } }, customers: { valid: { name: 'Seed customer' } } });
    assert.equal(guestRows('customers')[0].data.name, 'Seed customer');
  }
});

test('invalid persisted stage sets safely read as empty; valid stages survive', () => {
  sample();
  writeGuestBatch([{ op: 'set', table: 'documents', id: 'guest_stageSets', data: { workspaceId: 'guest', sets: { invoice: 'Checked' } } }], guestSession()!);
  assert.deepEqual(readGuestStages('guest', 'invoice').stages, []);
  saveGuestStages('guest', { invoice: ['Checked'] });
  assert.deepEqual(readGuestStages('guest', 'invoice').stages, ['Checked']);
});

test('country replacement discards saved workspace settings and sample document counters', async () => {
  sample();
  saveGuestAlerts('guest', { closeReminderDay: 9 });
  await saveWorkspacePriceLists('guest', [{ name: 'Old sample list', discountPercent: 10 }]);
  saveGuestNumbering('guest', 'invoice', { prefix: 'OLD-', nextNumber: 99, padding: 4 });
  replaceGuestCompany({ currency: 'ILS', accounts: [], customers: [], vendors: [], invoices: [], bills: [], transactions: [] }, 'Empty sample');
  const workspace = guestRows('workspaces')[0].data;
  assert.equal(workspace.id, 'guest'); assert.equal(workspace.uid, 'owner-sample');
  assert.equal(workspace.currency, 'ILS'); assert.equal(workspace.name, 'Empty sample');
  assert.equal(workspace.priceLists, undefined); assert.equal(workspace.alerts, undefined);
  assert.equal(allocateGuestNumber('guest', 'invoice'), 'SAMPLE-INVOICE-0001');
});

test('numbering rejects the safe-integer boundary and refuses a corrupt/exhausted allocation without writing', () => {
  sample();
  assert.throws(() => saveGuestNumbering('guest', 'invoice', { prefix: 'X-', nextNumber: Number.MAX_SAFE_INTEGER, padding: 4 }), /positive/);
  writeGuestBatch([{ op: 'set', table: 'sampleCounters', id: 'invoice', data: { workspaceId: 'guest', next: Number.MAX_SAFE_INTEGER } }], guestSession()!);
  const before = guestRows('sampleCounters');
  assert.throws(() => allocateGuestNumber('guest', 'invoice'), /exhausted/);
  assert.deepEqual(guestRows('sampleCounters'), before);
});

test('pending sample deletes and stale Undo cannot reach a later session; active Undo still restores', async () => {
  sample();
  const calls: string[] = [];
  const schedule = (key: string) => deleteWithUndo({ key, label: 'Sample item', hide: () => calls.push('hide'), restore: () => calls.push('restore'), commit: async () => { calls.push('commit'); }, windowMs: 20 });
  schedule('sample/active'); assert.equal(undoDelete('sample/active'), true);
  schedule('sample/stale'); schedule('sample/expired');
  useAuthStore.getState().setIsGuest(false); sample();
  assert.equal(undoDelete('sample/stale'), false);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.deepEqual(calls, ['hide', 'restore', 'hide', 'hide']);
  assert.equal(isDeletePending('sample/expired'), false);
});

test('country and reset handlers replace prior success with a storage refusal message and leave records untouched', () => {
  sample(); render(<GuestCountrySamplePicker />);
  fireEvent.click(screen.getByRole('button', { name: 'Clear to empty books' }));
  assert.match(screen.getByRole('status').textContent || '', /Cleared/);
  const before = guestRows('workspaces');
  const storage = Object.getPrototypeOf(sessionStorage);
  const set = storage.setItem;
  storage.setItem = () => { throw new Error('Quota exceeded'); };
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Reset to starter demo' }));
    assert.match(screen.getByRole('status').textContent || '', /Could not reset.*Quota exceeded/);
    fireEvent.click(screen.getByRole('button', { name: /Load United States 1-year sample/ }));
    assert.match(screen.getByRole('status').textContent || '', /Could not load.*Quota exceeded/);
    assert.deepEqual(guestRows('workspaces'), before);
  } finally { storage.setItem = set; }
});

test('sample item metadata creation stays enabled while opening quantity is explicitly unavailable', () => {
  sample();
  render(<InventoryItemDialog open editingItem={null} categories={[]} canChangeStock stockActionsAvailable={false} onClose={() => {}} onSubmit={event => event.preventDefault()} onAdjust={() => { throw new Error('Unavailable'); }} />);
  assert.equal((screen.getByLabelText('Opening stock') as HTMLInputElement).disabled, true);
  assert.equal((screen.getByLabelText('Item Name') as HTMLInputElement).disabled, false);
  assert.ok(screen.getByText(/Opening stock needs a signed-in workspace/));
});

test('unchanged invoice builders persist edit and deletion reversals with the local document atomically', async () => {
  const { withSamplePosting } = await import('../lib/guestPosting');
  const { postInvoiceLedger } = await import('../services/ledgerPost/invoicePosting');
  const { deletePostings } = await import('../services/ledgerPost/deletePostings');
  const { publishGuestCompany } = await import('../lib/guestCompany');
  sample();
  const session = guestSession();
  const id = 'review-posted-invoice';
  const invoice = { workspaceId: 'guest', uid: 'owner-sample', number: 'REVIEW-1', date: '2026-12-31', status: 'pending' as const, amountCents: 1000, currency: 'USD' };
  const context = () => ({ accounts: useLedgerStore.getState().accounts, transactions: useLedgerStore.getState().transactions, workspaces: useAuthStore.getState().workspaces, inventory: [], uid: 'owner-sample', today: '2026-12-31' });
  await withSamplePosting('guest', session, capture => postInvoiceLedger(id, invoice, 'guest', 'owner-sample', { collection: 'invoices', docId: id, action: 'create', data: invoice }, { ...context(), ...capture }));
  publishGuestCompany();
  const entries = () => guestRows('transactions').filter(row => (row.data.metadata as { invoiceId?: string })?.invoiceId === id);
  const original = entries(); assert.equal(original.length, 1);
  const edited = { ...invoice, amountCents: 2500 };
  await withSamplePosting('guest', session, capture => postInvoiceLedger(id, edited, 'guest', 'owner-sample', { collection: 'invoices', docId: id, action: 'update', data: edited }, { ...context(), ...capture }));
  publishGuestCompany();
  assert.equal(guestRows('invoices').find(row => row.id === id)?.data.amountCents, 2500);
  assert.equal(entries().length, 3);
  const reverse = entries().find(row => (row.data.metadata as { reversesTxId?: string }).reversesTxId === original[0].id)!;
  assert.ok(reverse);
  const amounts = (row: typeof reverse) => (row.data.lines as Array<{ amountCents: number }>).map(line => line.amountCents);
  assert.deepEqual(amounts(reverse), amounts(original[0]).map(amount => -amount));
  await withSamplePosting('guest', session, capture => deletePostings(id, 'invoiceId', 'guest', { collection: 'invoices', docId: id, action: 'delete' }, { ...context(), ...capture }));
  assert.equal(guestRows('invoices').some(row => row.id === id), false);
  assert.equal(entries().length, 4, 'only the active replacement posting is reversed on deletion');
  for (const row of entries()) assert.equal(amounts(row).reduce((sum, amount) => sum + amount, 0), 0);
});


test('project creation without a workspace keeps its draft and refuses success', async () => {
  const { default: Projects } = await import('../components/projects/Projects');
  const { setComponentWorkspace, markComponentCollectionsLoaded } = await import('./helpers/componentFixtures');
  const { toast } = await import('sonner');
  setComponentWorkspace();
  useAuthStore.setState({ currentWorkspaceId: null });
  markComponentCollectionsLoaded('bills', 'budgets', 'vendors');
  useLedgerStore.setState({ projects: [], transactions: [], bills: [], vendors: [], budgets: [], accounts: [] });
  const errors: unknown[] = [], successes: unknown[] = [];
  const error = toast.error, success = toast.success;
  toast.error = ((message: unknown) => { errors.push(message); return 'error'; }) as typeof toast.error;
  toast.success = ((message: unknown) => { successes.push(message); return 'success'; }) as typeof toast.success;
  try {
    render(<Projects />);
    fireEvent.click(screen.getByRole('button', { name: 'Initialize Project' }));
    fireEvent.change(screen.getByLabelText('Protocol Name'), { target: { value: 'Retained project draft' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'INITIALIZE PROTOCOL' })); });
    assert.equal((screen.getByLabelText('Protocol Name') as HTMLInputElement).value, 'Retained project draft');
    assert.equal(screen.getAllByRole('dialog').length, 1);
    assert.deepEqual(errors, ['Failed to initialize project']);
    assert.deepEqual(successes, []);
    assert.equal(useLedgerStore.getState().projects.length, 0);
  } finally { toast.error = error; toast.success = success; }
});

test('sample estimates refuse server-only deposit and signature actions while signed-in owner retains them', async () => {
  const { default: EstimatesView } = await import('../components/sales/EstimatesView');
  const { markComponentCollectionsLoaded, setComponentWorkspace } = await import('./helpers/componentFixtures');
  sample();
  markComponentCollectionsLoaded('customers', 'estimates', 'payments', 'invoices');
  useLedgerStore.setState({ estimates: [{ id: 'review-estimate', uid: 'owner-sample', workspaceId: 'guest', customerId: 'customer', customerName: 'Sample customer', number: 'REVIEW-1', amountCents: 12345, date: '2026-10-01', status: 'sent', lines: [], createdAt: '2026-10-01T00:00:00Z' }] });
  render(<EstimatesView />);
  const deposit = screen.getByRole('button', { name: 'Take a deposit for estimate REVIEW-1' });
  assert.equal((deposit as HTMLButtonElement).disabled, true);
  fireEvent.click(deposit);
  assert.equal(screen.queryByRole('dialog'), null);
  assert.equal(screen.queryByRole('button', { name: /Ask the customer to sign/ }), null);
  cleanup();
  setComponentWorkspace();
  render(<EstimatesView />);
  await waitFor(() => assert.equal((screen.getByRole('button', { name: 'Take a deposit for estimate REVIEW-1' }) as HTMLButtonElement).disabled, false));
  assert.ok(screen.getByRole('button', { name: /Ask the customer to sign/ }));
});
