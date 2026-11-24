import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OpeningDocumentsDialog from '../components/common/OpeningDocumentsDialog';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });
const paste = 'Acme Ltd\tINV-1\t2026-08-14\t2026-09-13\t10.00';
const success = { status: 'success', openTotalCents: 1000, created: [], rows: [{ line: 2, contactName: 'Acme Ltd', number: 'INV-1', date: '2026-08-14', dueDate: '2026-09-13', currency: 'USD', amountCents: 1000, openCents: 1000, problem: null }] };
function switchWorkspace() {
  const ws = useAuthStore.getState().workspaces[0];
  act(() => useAuthStore.setState({ currentWorkspaceId: 'other-books', workspaces: [ws, { ...ws, id: 'other-books', name: 'Other books' }] }));
}

test('a preview from one workspace cannot authorize a confirm in another', async () => {
  setComponentWorkspace();
  const calls: string[] = [];
  globalThis.fetch = (async input => { calls.push(String(input)); return Response.json(success); }) as typeof fetch;
  render(<OpeningDocumentsDialog side="customer" onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText('Paste the invoices'), { target: { value: paste } });
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
  await screen.findByRole('button', { name: 'Add 1 opening invoice' });
  switchWorkspace();
  const add = screen.queryByRole('button', { name: 'Add 1 opening invoice' });
  assert.ok(!add || (add as HTMLButtonElement).disabled);
  assert.equal(calls.filter(path => path.includes('/confirm')).length, 0);
});

test('a late preview from old books does not appear after a workspace switch', async () => {
  setComponentWorkspace();
  let resolve!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>(r => { resolve = r; })) as typeof fetch;
  render(<OpeningDocumentsDialog side="customer" onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText('Paste the invoices'), { target: { value: paste } });
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
  await waitFor(() => assert.ok(resolve));
  switchWorkspace();
  await act(async () => { resolve(Response.json(success)); });
  assert.equal(screen.queryByRole('table'), null);
});

test('a renewed sign-in invalidates a preview even for the same account', async () => {
  setComponentWorkspace();
  globalThis.fetch = (async () => Response.json(success)) as typeof fetch;
  render(<OpeningDocumentsDialog side="customer" onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText('Paste the invoices'), { target: { value: paste } });
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
  await screen.findByRole('button', { name: 'Add 1 opening invoice' });
  await act(async () => { useAuthStore.getState().setUser(useAuthStore.getState().user); });
  assert.equal(screen.queryByRole('table'), null);
});

test('changing document side invalidates the previous preview', async () => {
  setComponentWorkspace();
  globalThis.fetch = (async () => Response.json(success)) as typeof fetch;
  const view = render(<OpeningDocumentsDialog side="customer" onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText('Paste the invoices'), { target: { value: paste } });
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
  await screen.findByRole('button', { name: 'Add 1 opening invoice' });
  view.rerender(<OpeningDocumentsDialog side="vendor" onClose={() => {}} />);
  assert.equal(screen.queryByRole('table'), null);
  assert.equal((screen.getByRole('button', { name: 'Add 0 opening bills' }) as HTMLButtonElement).disabled, true);
});

test('a late confirm after a workspace switch does not close the new dialog', async () => {
  setComponentWorkspace();
  let resolve!: (response: Response) => void, closed = 0;
  globalThis.fetch = (async input => String(input).includes('/preview') ? Response.json(success) : new Promise<Response>(r => { resolve = r; })) as typeof fetch;
  render(<OpeningDocumentsDialog side="customer" onClose={() => { closed++; }} />);
  fireEvent.change(screen.getByLabelText('Paste the invoices'), { target: { value: paste } });
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add 1 opening invoice' }));
  await waitFor(() => assert.ok(resolve));
  switchWorkspace();
  await act(async () => { resolve(Response.json({ ...success, created: ['a'] })); });
  assert.equal(closed, 0);
});
