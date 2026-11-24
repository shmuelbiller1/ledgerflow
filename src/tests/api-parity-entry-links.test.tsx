import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EntryLinks from '../components/transactions/EntryLinks';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeTransaction } from './fixtures';
import { getSupabase } from '../lib/db/client';

beforeEach(() => {
  setComponentWorkspace('bookkeeper');
  useLedgerStore.setState({ transactions: [makeTransaction({ id: 'a', date: '2026-01-01' }), makeTransaction({ id: 'b', date: '2026-01-02' })] });
});
afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('a failed read is not shown as zero links, blocks writes, and can be retried', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? Response.json({ message: 'unavailable' }, { status: 503 }) : Response.json({ status: 'success', links: [] }));
  render(<EntryLinks transactionId="a" />);
  await screen.findByRole('alert');
  assert.match(screen.getByRole('alert').textContent || '', /Could not load/);
  assert.equal((screen.getByRole('button', { name: 'Link another entry' }) as HTMLButtonElement).disabled, true);
  assert.equal(screen.queryByText('Linked entries (0)'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading linked entries' }));
  await waitFor(() => assert.equal((screen.getByRole('button', { name: 'Link another entry' }) as HTMLButtonElement).disabled, false));
  assert.match(screen.getByText(/Linked entries/).textContent || '', /\(0\)/);
});

test('malformed lists are errors even for a viewer', async t => {
  setComponentWorkspace('viewer');
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'success', links: [{ id: 'bad', a: 'other', b: 'unknown' }] }));
  render(<EntryLinks transactionId="a" />);
  assert.match((await screen.findByRole('alert')).textContent || '', /invalid link list/);
});

test('a pending link cannot be submitted twice and an uncertain failure requires a reload', async t => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>(r => { resolve = r; });
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') { posts++; return pending; }
    return Response.json({ status: 'success', links: [] });
  });
  render(<EntryLinks transactionId="a" />);
  await waitFor(() => assert.equal((screen.getByRole('button', { name: 'Link another entry' }) as HTMLButtonElement).disabled, false));
  fireEvent.click(screen.getByRole('button', { name: 'Link another entry' }));
  fireEvent.change(screen.getByLabelText('Entry'), { target: { value: 'b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Link' }));
  fireEvent.click(screen.getByRole('button', { name: 'Link' }));
  await waitFor(() => assert.equal(posts, 1));
  await act(async () => { resolve(Response.json({ status: 'success' })); await pending; });
  assert.match((await screen.findByRole('alert')).textContent || '', /Reload before trying again/);
  assert.equal((screen.getByRole('button', { name: 'Link' }) as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByLabelText('Entry') as HTMLSelectElement).value, 'b');
});

test('a late read and draft from another transaction do not leak into the current one', async t => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>(r => { resolve = r; });
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => String(input).includes('transactionId=a') ? pending : Response.json({ status: 'success', links: [] }));
  const view = render(<EntryLinks transactionId="a" />);
  view.rerender(<EntryLinks transactionId="b" />);
  await waitFor(() => assert.match(screen.getByText(/Linked entries/).textContent || '', /\(0\)/));
  await act(async () => { resolve(Response.json({ status: 'success', links: [{ id: 'l', a: 'a', b: 'b' }] })); await pending; });
  assert.match(screen.getByText(/Linked entries/).textContent || '', /\(0\)/);
});
