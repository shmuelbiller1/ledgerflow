import { inlineEditName } from './helpers/inlineEditName';
/** Chart of accounts, edit in place (I-22): name, code (unique; system accounts keep theirs), category. */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChartOfAccountsView from '../components/ledger/ChartOfAccountsView';
import { getSupabase } from '../lib/db/client';
import { makeChartAccount } from './fixtures';
import { setComponentWorkspace } from './helpers/componentFixtures';

const accounts = [
  makeChartAccount({ id: 'cash', code: '1000', name: 'Cash', type: 'asset', category: 'Current Assets', isSystem: true }),
  makeChartAccount({ id: 'rent', code: '6100', name: 'Rent', type: 'expense', category: 'Operating' }),
];
const view = () => render(<ChartOfAccountsView accounts={accounts} searchTerm="" formatCurrency={c => String(c)} onDrillDown={() => {}} onDeleteAccount={() => {}} />);

beforeEach(() => setComponentWorkspace('owner'));
afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });

test('rename an account in place', async () => {
  const calls = stubFetchWithBodies(200, null);
  view();
  fireEvent.click(screen.getByRole('button', { name: inlineEditName('Edit Name of Rent') }));
  fireEvent.change(screen.getByLabelText('Name of Rent'), { target: { value: 'Office rent' } });
  await act(async () => { fireEvent.keyDown(screen.getByLabelText('Name of Rent'), { key: 'Enter' }); });
  await waitFor(() => assert.ok(calls.some(c => c.url.includes('/commands/chartaccount.update'))));
  const body = calls.find(c => c.url.includes('/commands/chartaccount.update'))!.body as { input: { id: string; name?: string } };
  assert.deepEqual([body.input.id, body.input.name], ['rent', 'Office rent']);
});

test('a code already used is refused; a system account keeps its code; viewers only read', async () => {
  const calls = stubFetchWithBodies(200, null);
  view();
  assert.equal(screen.queryByRole('button', { name: inlineEditName('Edit Code of Cash') }), null, 'system account code is fixed');
  fireEvent.click(screen.getByRole('button', { name: inlineEditName('Edit Code of Rent') }));
  fireEvent.change(screen.getByLabelText('Code of Rent'), { target: { value: '1000' } });
  await act(async () => { fireEvent.keyDown(screen.getByLabelText('Code of Rent'), { key: 'Enter' }); });
  assert.match(screen.getByRole('alert').textContent || '', /1000 is already used/);
  assert.equal(calls.filter(c => c.url.includes('/rpc/')).length, 0);
  cleanup();
  setComponentWorkspace('viewer');
  view();
  assert.equal(screen.queryByRole('button', { name: /^Edit / }), null);
  assert.ok(screen.getByText('Rent'));
});

test('archived accounts are hidden until asked; archive and restore from the row menu; viewers have no menu', async () => {
  const calls = stubFetchWithBodies(200, null);
  const withOld = [...accounts, makeChartAccount({ id: 'old', code: '6900', name: 'Old supplies', type: 'expense', isArchived: true, isActive: false })];
  render(<ChartOfAccountsView accounts={withOld} searchTerm="" formatCurrency={c => String(c)} onDrillDown={() => {}} onDeleteAccount={() => {}} />);
  assert.equal(screen.queryByText('Old supplies'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Show archived accounts (1)' }));
  assert.ok(screen.getByRole('button', { name: inlineEditName('Edit Name of Old supplies') }));
  assert.ok(screen.getByText('Archived'));
  fireEvent.click(screen.getByRole('button', { name: 'Account options for Old supplies' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore' })); });
  await waitFor(() => assert.equal(calls.filter(c => c.url.includes('/commands/chartaccount.update')).length, 1));
  // one `archived` flag, because the command derives isArchived/isActive together
  const restore = calls.find(c => c.url.includes('/commands/chartaccount.update'))!.body as { input: { id: string; archived?: boolean } };
  assert.deepEqual([restore.input.id, restore.input.archived], ['old', false]);
  fireEvent.click(screen.getByRole('button', { name: 'Account options for Rent' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Archive' })); });
  await waitFor(() => assert.equal(calls.filter(c => c.url.includes('/commands/chartaccount.update')).length, 2));
  const archive = calls.filter(c => c.url.includes('/commands/chartaccount.update'))[1].body as { input: { id: string; archived?: boolean } };
  assert.deepEqual([archive.input.id, archive.input.archived], ['rent', true]);
  cleanup();
  setComponentWorkspace('viewer');
  render(<ChartOfAccountsView accounts={withOld} searchTerm="" formatCurrency={c => String(c)} onDrillDown={() => {}} onDeleteAccount={() => {}} />);
  assert.equal(screen.queryByRole('button', { name: /Account options/ }), null);
});
