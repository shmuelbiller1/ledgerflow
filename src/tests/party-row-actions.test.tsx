/**
 * Archive, restore and delete a customer or vendor from its list (I-22): archive hides it from the
 * list (records keep it); delete asks the server first, which refuses a contact that is in use;
 * otherwise the contact leaves the list with Undo and is deleted when the time is up (BO-08).
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PartyRowActions, { ArchivedBadge, ShowArchivedToggle } from '../components/common/PartyRowActions';
import { isArchivedParty } from '../lib/contacts';
import { setUndoWindowForTests, undoDelete } from '../lib/undoableDelete';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import { makeCustomer, makeVendor } from './fixtures';
import { setComponentWorkspace } from './helpers/componentFixtures';

const acme = makeCustomer({ id: 'c1', name: 'Acme' });
const asked: string[] = [];

describe('Contact row actions', () => {
  beforeEach(() => {
    setComponentWorkspace('bookkeeper');
    useLedgerStore.setState({ customers: [acme, makeCustomer({ id: 'c2', name: 'Beta' })], vendors: [makeVendor({ id: 'v1', name: 'Paper Co' })] });
    asked.length = 0;
    window.confirm = (message?: string) => { asked.push(String(message)); return true; };
  });
  afterEach(async () => { cleanup(); setUndoWindowForTests(null); await getSupabase().auth.dispose(); });

  test('archive saves the status; an archived one can be restored', async () => {
    const calls = stubFetchWithBodies(200, {});
    render(<PartyRowActions side="customer" party={acme} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Archive Acme' })); });
    await waitFor(() => assert.ok(calls.some(c => c.url.endsWith('/api/v1/commands/customer.update'))));
    const update = calls.find(c => c.url.endsWith('/api/v1/commands/customer.update'))!.body as {
      workspaceId: string; input: { id: string; data: Record<string, unknown> };
    };
    assert.deepEqual([update.workspaceId, update.input.id, update.input.data.status], ['component-workspace', 'c1', 'inactive']);
    assert.equal('updatedAt' in update.input.data, false, 'the server owns the update timestamp');
    cleanup();
    render(<PartyRowActions side="customer" party={{ ...acme, status: 'inactive' }} />);
    assert.ok(screen.getByRole('button', { name: 'Restore Acme' }));
  });

  test('delete: the server is asked first, the contact leaves the list with Undo, and is deleted when the time is up', async () => {
    setUndoWindowForTests(30);
    const calls = stubFetchWithBodies(200, { status: 'success' });
    render(<PartyRowActions side="customer" party={acme} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete Acme' })); });
    assert.deepEqual(asked, [], 'no "cannot be undone" question any more');
    await waitFor(() => assert.deepEqual(useLedgerStore.getState().customers.map(c => c.id), ['c2']));
    assert.deepEqual([calls[0].url, calls[0].method], ['/api/v1/workspaces/component-workspace/contacts/customer/c1?check=1', 'DELETE']);
    await waitFor(() => assert.equal(calls.length, 2));
    assert.deepEqual([calls[1].url, calls[1].method], ['/api/v1/workspaces/component-workspace/contacts/customer/c1', 'DELETE']);
  });

  test('Undo puts it back where it was and nothing is deleted', async () => {
    setUndoWindowForTests(5000);
    const calls = stubFetchWithBodies(200, { status: 'success' });
    render(<PartyRowActions side="customer" party={acme} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete Acme' })); });
    await waitFor(() => assert.equal(useLedgerStore.getState().customers.length, 1));
    assert.equal(undoDelete('customers/c1'), true);
    assert.deepEqual(useLedgerStore.getState().customers.map(c => c.id), ['c1', 'c2']);
    assert.equal(calls.length, 1, 'only the check was sent');
  });

  test('a contact in use is not deleted and stays listed', async () => {
    const calls = stubFetchWithBodies(409, { message: '"Paper Co" is used by 2 bills: archive it instead (those records keep it)' });
    render(<PartyRowActions side="vendor" party={makeVendor({ id: 'v1', name: 'Paper Co' })} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete Paper Co' })); });
    await waitFor(() => assert.equal(calls.length, 1));
    assert.equal(calls[0].url, '/api/v1/workspaces/component-workspace/contacts/vendor/v1?check=1');
    assert.equal(useLedgerStore.getState().vendors.length, 1, 'still listed');
  });

  test('the list toggle and badge', () => {
    assert.equal(isArchivedParty({ status: 'inactive' }), true);
    assert.equal(isArchivedParty({ status: 'archived' }), true);
    assert.equal(isArchivedParty({ status: 'active' }), false);
    assert.equal(isArchivedParty({}), false);
    let on = false;
    const { rerender } = render(<ShowArchivedToggle count={0} on={false} onChange={v => { on = v; }} noun="vendor" />);
    assert.equal(screen.queryByRole('button'), null, 'nothing archived: no toggle');
    rerender(<ShowArchivedToggle count={3} on={false} onChange={v => { on = v; }} noun="vendor" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show archived vendors (3)' }));
    assert.equal(on, true);
    cleanup();
    render(<ArchivedBadge party={{ status: 'inactive' }} />);
    assert.ok(screen.getByText('Archived'));
  });
});
