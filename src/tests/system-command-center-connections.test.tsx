import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SystemCommandCenter from '../components/platform/SystemCommandCenter';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';

beforeEach(() => setComponentWorkspace());
afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

const tenant = { id: 'workspace-1', name: 'Example', plan: 'pro', concurrentUserLimit: 50, activeUserCount: 1, seatCount: 1, maxSeats: 3, computeCreditBalance: 900, apiQuotaTotalCentsUsed: 0, apiQuotaMonthlyLimitCents: 0, creditCostMultiplier: 1, quotaCentsMultiplier: 1, bypassBilling: false, customKeyCreditCharge: 10, customKeyCentsCharge: 0, txCount: 0, requestCount: 0, errorCount: 0 };

test('admin reads use authenticated routes; unsafe workspace actions stay disabled even after a successful telemetry response', async t => {
  const calls: { url: string; options?: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input); calls.push({ url, options });
    if (url === '/api/v1/admin/telemetry') return Response.json({ status: 'success', tenants: [tenant], liveLogs: [] });
    if (url === '/api/v1/admin/users') return Response.json({ status: 'success', users: [] });
    if (url === '/api/v1/admin/global-config') return new Response('refused', { status: 403 });
    return new Response('unexpected', { status: 500 });
  });
  render(<SystemCommandCenter />);
  await waitFor(() => assert.ok(screen.getByText('Example')));
  assert.ok(calls.some(call => call.url === '/api/v1/admin/users'));
  const telemetryCall = calls.find(call => call.url === '/api/v1/admin/telemetry');
  assert.equal((telemetryCall?.options?.headers as Record<string, string>).Authorization, 'Bearer test-token');
  assert.equal((screen.getByRole('button', { name: 'Sync to All Workspaces' }) as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByRole('button', { name: 'Save baseline pricing' }) as HTMLButtonElement).disabled, true);
  fireEvent.click(screen.getByText('Example'));
  fireEvent.submit(screen.getByRole('button', { name: 'Save baseline pricing' }).closest('form')!);
  assert.equal(calls.filter(call => call.options?.method === 'PUT').length, 0);
  assert.ok(screen.getByText(/at most 100 workspaces/));
});

test('telemetry refusal is visible instead of an empty successful workspace list', async t => {
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => String(input) === '/api/v1/admin/telemetry'
    ? new Response('denied', { status: 403 }) : Response.json({ status: 'success', users: [] }));
  render(<SystemCommandCenter />);
  await waitFor(() => assert.ok(screen.getByText('Admin telemetry returned HTTP 403.')));
  assert.equal(screen.queryByText('No workspaces detected on server'), null);
});

test('global config saves the server response data without copying server metadata into the next strict PUT', async t => {
  const config = { creditCostMultiplier: 1, quotaCentsMultiplier: 1, bypassBilling: false, customKeyCreditCharge: 10, customKeyCentsCharge: 0, maxRegistrationLimit: 100, freeWorkspaceTxCap: 100 };
  const payloads: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    if (url === '/api/v1/admin/telemetry') return Response.json({ status: 'success', tenants: [], liveLogs: [] });
    if (url === '/api/v1/admin/users') return Response.json({ status: 'success', users: [] });
    if (url === '/api/v1/admin/global-config' && options?.method === 'PUT') {
      payloads.push(JSON.parse(String(options.body)));
      return Response.json({ status: 'success', data: { ...config, updatedAt: 'server timestamp' } });
    }
    return Response.json({ status: 'success', globalAdminConfig: { ...config, updatedAt: 'old timestamp' } });
  });
  render(<SystemCommandCenter />);
  await waitFor(() => assert.equal((screen.getByRole('button', { name: 'Save baseline pricing' }) as HTMLButtonElement).disabled, false));
  fireEvent.submit(screen.getByRole('button', { name: 'Save baseline pricing' }).closest('form')!);
  await waitFor(() => assert.equal(payloads.length, 1));
  await waitFor(() => assert.equal((screen.getByRole('button', { name: 'Save baseline pricing' }) as HTMLButtonElement).disabled, false));
  fireEvent.submit(screen.getByRole('button', { name: 'Save baseline pricing' }).closest('form')!);
  await waitFor(() => assert.equal(payloads.length, 2));
  assert.deepEqual(payloads, [config, config]);
});

test('admin users refusal is reported rather than presented as an empty directory', async t => {
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    if (String(input) === '/api/v1/admin/telemetry') return Response.json({ status: 'success', tenants: [], liveLogs: [] });
    if (String(input) === '/api/v1/admin/users') return new Response('denied', { status: 403 });
    return new Response('denied', { status: 403 });
  });
  render(<SystemCommandCenter />);
  fireEvent.click(await screen.findByRole('button', { name: /deep user matrix/i }));
  await waitFor(() => assert.ok(screen.getByText('Admin users returned HTTP 403.')));
  assert.equal(screen.queryByText('No user records yet'), null);
});

test('AUP-04: a telemetry failure refuses only the Workspaces tab; Users and the other tabs stay reachable', async t => {
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    if (String(input) === '/api/v1/admin/telemetry') return new Response('denied', { status: 503 });
    if (String(input) === '/api/v1/admin/users') return Response.json({ status: 'success', users: [] });
    return Response.json({ status: 'success' });
  });
  render(<SystemCommandCenter />);
  // the Workspaces tab says why it has nothing, and the tab bar is still there
  await waitFor(() => assert.ok(screen.getByText('Admin telemetry returned HTTP 503.')));
  assert.ok(screen.getByRole('button', { name: /institutional audit trail/i }));
  assert.ok(screen.getByRole('button', { name: /site lexicon control/i }));
  // the Users tab works without telemetry (it has its own endpoint)
  fireEvent.click(screen.getByRole('button', { name: /deep user matrix/i }));
  await waitFor(() => assert.equal(screen.queryByText('Admin telemetry returned HTTP 503.'), null), undefined);
  await waitFor(() => assert.ok(screen.getByText(/No user records yet/i)));
  // ...and going back to Workspaces still shows the refusal, not an empty list
  fireEvent.click(screen.getByRole('button', { name: /workspaces & tenants/i }));
  await waitFor(() => assert.ok(screen.getByText('Admin telemetry returned HTTP 503.')));
  assert.equal(screen.queryByText('No workspaces detected on server'), null);
});

test('AUP-04: while telemetry is still loading (even if it never answers), the tab bar is there and other tabs work', async t => {
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    if (String(input) === '/api/v1/admin/telemetry') return new Promise<Response>(() => {}); // a hung request
    if (String(input) === '/api/v1/admin/users') return Response.json({ status: 'success', users: [] });
    return Response.json({ status: 'success' });
  });
  render(<SystemCommandCenter />);
  // first render: the spinner is inside the Workspaces tab, the tab bar is already shown
  assert.ok(screen.getByText(/Hooking operational datastream/));
  fireEvent.click(screen.getByRole('button', { name: /deep user matrix/i }));
  await waitFor(() => assert.ok(screen.getByText(/No user records yet/i)));
  assert.equal(screen.queryByText(/Hooking operational datastream/), null, 'the spinner belongs to the Workspaces tab only');
  fireEvent.click(screen.getByRole('button', { name: /workspaces & tenants/i }));
  assert.ok(screen.getByText(/Hooking operational datastream/));
});
