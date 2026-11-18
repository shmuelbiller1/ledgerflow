import { inlineEditName } from './helpers/inlineEditName';
/**
 * The Recurring screen: pause/resume and delete, and edit in place (I-22) — a schedule's name,
 * how often it runs, and its next date (not before its last run; the day of the month follows).
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RecurringTransactionsView from '../components/ledger/RecurringTransactionsView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import type { RecurringTransaction } from '../types';

const rent = { id: 'r1', workspaceId: 'component-workspace', description: 'Office rent', payee: 'Landlord', type: 'bill', frequency: 'monthly',
  nextOccurrence: '2026-11-01', lastOccurrence: '2026-10-01', anchorDay: 1, isActive: true, amountCents: 120000 } as unknown as RecurringTransaction;
/** An ordinary record is saved by naming `record.save`; the patch rides in `input.data`. */
const updates = (calls: Array<{ url: string; body?: unknown }>) =>
  calls.filter(c => c.url.includes('/commands/record.save'))
    .map(c => (c.body as { input: { data: Record<string, unknown> } }).input.data);
const edit = async (label: string, value: string) => {
  fireEvent.click(screen.getByRole('button', { name: inlineEditName(`Edit ${label}`) }));
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  await act(async () => { fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' }); });
};

beforeEach(() => {
  setComponentWorkspace('bookkeeper');
  markComponentCollectionsLoaded('recurring');
  useLedgerStore.setState({ recurring: [rent] });
});
afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });

test('rename, change how often, move the next date (the day of the month follows)', async () => {
  const calls = stubFetchWithBodies(200, null);
  render(<RecurringTransactionsView />);
  assert.ok(screen.getByLabelText('Bill'));
  await edit('Name of schedule Office rent', 'Rent – Main St');
  await waitFor(() => assert.equal(updates(calls).length, 1));
  assert.equal(updates(calls)[0].description, 'Rent – Main St');
  await edit('How often Office rent runs', 'quarterly');
  await waitFor(() => assert.equal(updates(calls).length, 2));
  assert.equal(updates(calls)[1].frequency, 'quarterly');
  await edit('Next date of Office rent', '2026-11-15');
  await waitFor(() => assert.equal(updates(calls).length, 3));
  assert.deepEqual([updates(calls)[2].nextOccurrence, updates(calls)[2].anchorDay], ['2026-11-15', 15]);
});

test('a next date on or before the last run is refused; viewers only read', async () => {
  const calls = stubFetchWithBodies(200, null);
  render(<RecurringTransactionsView />);
  await edit('Next date of Office rent', '2026-09-30');
  assert.match(screen.getByRole('alert').textContent || '', /After the last run \(2026-10-01\)/);
  assert.equal(updates(calls).length, 0);
  cleanup();
  setComponentWorkspace('viewer');
  render(<RecurringTransactionsView />);
  assert.equal(screen.queryByRole('button', { name: /^Edit / }), null);
});
