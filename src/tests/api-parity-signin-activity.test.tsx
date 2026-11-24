import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecentSignInsSection } from '../components/platform/settings/SecuritySettings';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';

beforeEach(() => setComponentWorkspace());
afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('failure or malformed activity is not a claim that no sign-ins exist; retry works', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return Response.json({ error: 'unavailable' }, { status: 503 });
    if (calls === 2) return Response.json({ status: 'success', loginAudits: {} });
    return Response.json({ status: 'success', loginAudits: [] });
  });
  render(<RecentSignInsSection />);
  assert.match((await screen.findByRole('alert')).textContent || '', /Could not load/);
  assert.equal(screen.queryByText('No recent authentication events returned.'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading activity' }));
  assert.match((await screen.findByRole('alert')).textContent || '', /invalid activity list/);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading activity' }));
  assert.ok(await screen.findByText('No recent authentication events returned.'));
});

test('logout and token refresh are not shown as sign-ins', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'success', loginAudits: [
    { id: 'one', event: 'login' }, { id: 'two', event: 'logout' }, { id: 'three', event: 'token_refresh' }, { id: 'four', event: 'other' },
  ] }));
  render(<RecentSignInsSection />);
  assert.ok(await screen.findByText('Signed in'));
  assert.ok(screen.getByText('Signed out'));
  assert.ok(screen.getByText('Session refreshed'));
  assert.ok(screen.getByText('Authentication event'));
});

test('another user never sees old or late activity', async t => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => { count++; return count === 1 ? pending : Response.json({ status: 'success', loginAudits: [] }); });
  render(<RecentSignInsSection />);
  await waitFor(() => assert.equal(count, 1));
  const oldUser = useAuthStore.getState().user!;
  act(() => useAuthStore.setState({ user: { ...oldUser, uid: 'other-user' } }));
  assert.ok(await screen.findByText('No recent authentication events returned.'));
  await act(async () => { finish(Response.json({ status: 'success', loginAudits: [{ id: 'old', event: 'login', ip: 'old-private-ip' }] })); await pending; });
  assert.equal(screen.queryByText(/old-private-ip/), null);
});
