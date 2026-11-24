import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WatchingPanel from '../components/collaboration/WatchingPanel';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';
import { useAuthStore } from '../stores/useAuthStore';

beforeEach(() => setComponentWorkspace());
afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('failed watch-list load is not an empty list and can be retried', async t => {
  const calls: { url: string; options?: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
    calls.push({ url: String(input), options });
    if (calls.length === 1) return Response.json({ message: 'Temporarily unavailable' }, { status: 503 });
    return Response.json({ watches: [] });
  });
  render(<WatchingPanel />);
  fireEvent.click(screen.getByText(/Records I watch/));
  assert.match((await screen.findByRole('alert')).textContent || '', /Temporarily unavailable/);
  assert.ok(screen.getByText('Records I watch (unavailable)'));
  assert.equal(screen.queryByText('You are not watching anything.'), null);
  assert.equal((screen.getByRole('button', { name: 'Watch it' }) as HTMLButtonElement).disabled, true);
  assert.equal(calls[0].url, '/api/v1/workspaces/component-workspace/tasks/watching');
  assert.equal((calls[0].options?.headers as Record<string, string>).Authorization, 'Bearer test-token');
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading watched records' }));
  assert.ok(await screen.findByText('You are not watching anything.'));
  assert.equal(calls.length, 2);
});

test('malformed watch-list success is shown as an error', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'success' }));
  render(<WatchingPanel />);
  fireEvent.click(screen.getByText(/Records I watch/));
  assert.match((await screen.findByRole('alert')).textContent || '', /invalid watch list/);
  assert.equal(screen.queryByText('You are not watching anything.'), null);
});

test('a late response from the old workspace cannot replace the current watch list', async t => {
  let resolveOld!: (response: Response) => void;
  const old = new Promise<Response>(resolve => { resolveOld = resolve; });
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = String(input); calls.push(url);
    return url.includes('/component-workspace/') ? old : Response.json({ watches: [] });
  });
  render(<WatchingPanel />);
  fireEvent.click(screen.getByText(/Records I watch/));
  await waitFor(() => assert.equal(calls.length, 1));
  const first = useAuthStore.getState().getCurrentWorkspace()!;
  await act(async () => { useAuthStore.setState({ currentWorkspaceId: 'other-workspace', workspaces: [{ ...first, id: 'other-workspace' }] }); });
  await screen.findByText('You are not watching anything.');
  await act(async () => {
    resolveOld(Response.json({ watches: [{ id: 'old', record: { type: 'bill', id: 'b', label: 'Old workspace bill' } }] }));
    await old;
  });
  assert.equal(screen.queryByText('Old workspace bill'), null);
  assert.ok(screen.getByText('You are not watching anything.'));
});
