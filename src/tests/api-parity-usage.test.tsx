import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import UsagePanel from '../components/platform/settings/UsagePanel';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';

const usage = (plan: string) => ({ plan, unlimited: false, seats: { used: 1, limit: 5 }, storageMb: { used: 2, limit: 100 } });
beforeEach(() => setComponentWorkspace('owner'));
afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('failed or malformed usage is shown as an error and retry reloads', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return Response.json({ status: 'success', usage: { plan: 'free' } });
    if (calls === 2) return Response.json({ message: 'unavailable' }, { status: 503 });
    return Response.json({ status: 'success', usage: usage('free') });
  });
  render(<UsagePanel />);
  assert.match((await screen.findByRole('alert')).textContent || '', /invalid usage/);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading usage' }));
  assert.match((await screen.findByRole('alert')).textContent || '', /Could not load usage/);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading usage' }));
  assert.ok(await screen.findByText('Usage on the Free plan'));
});

test('switching workspaces hides the old usage immediately and ignores a late response', async t => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    if (requests === 1) return Response.json({ status: 'success', usage: usage('growth') });
    if (requests === 2) return pending;
    return Response.json({ status: 'success', usage: usage('free') });
  });
  render(<UsagePanel />);
  await screen.findByText('Usage on the Growth plan');
  const workspace = useAuthStore.getState().getCurrentWorkspace()!;
  act(() => useAuthStore.setState({ currentWorkspaceId: 'w2', workspaces: [{ ...workspace, id: 'w2' }] }));
  assert.equal(screen.queryByText('Usage on the Growth plan'), null);
  await waitFor(() => assert.equal(requests, 2));
  act(() => useAuthStore.setState({ currentWorkspaceId: 'w3', workspaces: [{ ...workspace, id: 'w3' }] }));
  await screen.findByText('Usage on the Free plan');
  await act(async () => { finish(Response.json({ status: 'success', usage: usage('pro') })); await pending; });
  assert.equal(screen.queryByText('Usage on the Pro plan'), null);
  assert.ok(screen.getByText('Usage on the Free plan'));
});
