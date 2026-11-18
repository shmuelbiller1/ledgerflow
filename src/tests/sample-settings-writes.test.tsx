/**
 * The sample company's settings still save in the sample company.
 *
 * These screens used `updateDoc(doc(db, 'workspaces', id), …)`, which went to Postgres when signed in **and** to the
 * sample company's own copy in a demo — one call, two worlds. Sending them to `workspace.settings` without a branch
 * would have made the demo request a server that does not have its workspace, so `saveWorkspaceSettings` keeps the
 * two apart and this suite is what says so: `fetch` throws if anything asks the server in a demo.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAuthStore } from '../stores/useAuthStore';
import { loadGuestCompany } from '../lib/guestCompany';
import { guestRows } from '../lib/db/guestDatabase';
import { saveWorkspaceSettings, saveWorkspaceAxes } from '../lib/workspaceSettingsSave';
import AppearanceSettings from '../components/platform/settings/AppearanceSettings';
import { getSupabase } from '../lib/db/client';

const realFetch = globalThis.fetch;
const initialAuth = useAuthStore.getState();

afterEach(async () => {
  cleanup();
  useAuthStore.getState().setIsGuest(false);
  useAuthStore.setState(initialAuth);
  globalThis.fetch = realFetch;
  await getSupabase().auth.dispose();
});

/** A demo tab: the sample company is loaded, and any request to the server is a failure the test will see. */
function demo() {
  useAuthStore.setState({ user: null, isGuest: false });
  useAuthStore.getState().setIsGuest(true);
  loadGuestCompany();
  globalThis.fetch = (() => { throw new Error('Sample settings must not request a server'); }) as typeof fetch;
  return guestRows('workspaces')[0].id;
}

const sampleWorkspace = () => guestRows('workspaces')[0];

test('a demo setting is written to the sample company, not to a server', async () => {
  const id = demo();
  await saveWorkspaceSettings(id, { timezone: 'Asia/Tokyo' });
  assert.equal(sampleWorkspace().data.timezone, 'Asia/Tokyo');
});

test('a demo label axis list is written the same way', async () => {
  const id = demo();
  await saveWorkspaceAxes(id, [{ id: 'property', name: 'Property', type: 'text' } as never]);
  assert.deepEqual((sampleWorkspace().data.dimensions as Array<{ id: string }>).map(d => d.id), ['property']);
});

test('the appearance screen changes the demo timezone through the same path', async () => {
  demo();
  render(<AppearanceSettings />);
  const select = screen.getByLabelText(/Workspace Timezone/) as HTMLSelectElement;
  const target = [...select.options].map(o => o.value).find(value => value !== select.value)!;
  await act(async () => { fireEvent.change(select, { target: { value: target } }); });
  await waitFor(() => assert.equal(sampleWorkspace().data.timezone, target));
});

test('a signed-in tab asks the command instead, and sends only the field it changed', async () => {
  useAuthStore.getState().setIsGuest(false);
  useAuthStore.setState({
    user: { uid: 'u1', getIdToken: async () => 'token' } as never,
    workspaces: [{ id: 'w1', uid: 'u1', name: 'Acme', currency: 'USD', roles: { u1: 'owner' } } as never],
    currentWorkspaceId: 'w1',
  });
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ status: 'success', data: { changed: ['timezone'] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  await saveWorkspaceSettings('w1', { timezone: 'Asia/Tokyo' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/v1\/commands\/workspace\.settings$/);
  assert.deepEqual(calls[0].body, { workspaceId: 'w1', input: { timezone: 'Asia/Tokyo' } });
});
