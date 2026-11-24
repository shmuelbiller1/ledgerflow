import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlaidConnectButton from '../components/finance/PlaidConnectButton';
import { auth } from '../firebase';
import { getSupabase } from '../lib/db/client';
import { useAuthStore } from '../stores/useAuthStore';
import { setComponentWorkspace } from './helpers/componentFixtures';

const originalFetch = globalThis.fetch;
afterEach(async () => {
  cleanup(); globalThis.fetch = originalFetch;
  getSupabase().realtime.disconnect(); await getSupabase().auth.dispose();
});

test('an unmounted reconnect never requests a link token after delayed authentication', async () => {
  setComponentWorkspace('bookkeeper');
  const previousUser = auth.currentUser;
  let finish!: (value: string) => void;
  let tokenRequested = false;
  auth.currentUser = { ...useAuthStore.getState().user!, getIdToken: () => {
    tokenRequested = true;
    return new Promise<string>(resolve => { finish = resolve; });
  } };
  const calls: string[] = [];
  globalThis.fetch = async input => { calls.push(String(input)); return new Response('{}'); };
  try {
    const view = render(<PlaidConnectButton bankId="existing-bank" />);
    assert.equal(tokenRequested, false, 'nothing is requested before the button is pressed');
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect bank' }));
    assert.equal(tokenRequested, true);
    view.unmount();
    await act(async () => { finish('delayed-token'); });
    assert.deepEqual(calls, [], 'obsolete authentication must not start a request');
  } finally { auth.currentUser = previousUser; }
});

test('changing workspace aborts an in-flight link request and requests only the new scope', async () => {
  setComponentWorkspace();
  const calls: { body: Record<string, unknown>; signal: AbortSignal }[] = [];
  globalThis.fetch = async (_input, init) => {
    calls.push({ body: JSON.parse(String(init?.body)), signal: init!.signal! });
    return new Promise<Response>(() => {});
  };
  const view = render(<PlaidConnectButton bankId="existing-bank" />);
  await act(async () => { await Promise.resolve(); });
  assert.equal(calls.length, 0, 'no link token (and no Plaid script) until the button is pressed');
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect bank' }));
  await act(async () => { await Promise.resolve(); });
  assert.equal(calls.length, 1);
  await act(async () => { useAuthStore.setState({ currentWorkspaceId: 'next-workspace' }); });
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(calls[1].body, { workspaceId: 'next-workspace', bankId: 'existing-bank' });
  view.unmount();
  assert.equal(calls[1].signal.aborted, true);
});

test('a malformed successful link-token response ends loading rather than waiting forever', async () => {
  setComponentWorkspace();
  globalThis.fetch = async () => new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } });
  render(<PlaidConnectButton />);
  fireEvent.click(screen.getByRole('button', { name: 'Connect Bank' }));
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Connect Bank' }).hasAttribute('disabled'), false));
});

test('a stale Plaid success callback cannot exchange a token after the workspace changes', async () => {
  setComponentWorkspace();
  const script = document.createElement('script');
  script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
  document.body.appendChild(script);
  let success: ((token: string, metadata: { institution: { name: string } }) => void) | undefined;
  const plaidWindow = window as unknown as { Plaid?: unknown };
  const priorPlaid = plaidWindow.Plaid;
  plaidWindow.Plaid = { create: (options: { onSuccess: typeof success }) => {
    if (!success) success = options.onSuccess;
    return { open() {}, exit() {}, destroy() {} };
  } };
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ path: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ link_token: 'link-token', success: true }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    render(<PlaidConnectButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Bank' }));
    await waitFor(() => assert.ok(success));
    await act(async () => { useAuthStore.setState({ currentWorkspaceId: 'another-workspace' }); });
    await act(async () => { success!('public-token', { institution: { name: 'Test bank' } }); await Promise.resolve(); });
    assert.ok(!calls.some(c => c.path.endsWith('/exchange_public_token')), 'old Link must not connect a bank after the user switches workspaces');
  } finally {
    cleanup(); script.remove(); plaidWindow.Plaid = priorPlaid;
  }
});

test('duplicate callbacks are suppressed and an in-flight old-workspace response cannot refresh the new view', async () => {
  setComponentWorkspace();
  const script = document.createElement('script');
  script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
  document.body.appendChild(script);
  let success: ((token: string, metadata: { institution: { name: string } }) => void) | undefined;
  const plaidWindow = window as unknown as { Plaid?: unknown };
  const priorPlaid = plaidWindow.Plaid;
  plaidWindow.Plaid = { create: (options: { onSuccess: typeof success }) => {
    if (!success) success = options.onSuccess;
    return { open() {}, exit() {}, destroy() {} };
  } };
  let finish!: (r: Response) => void;
  let exchanges = 0;
  let signal: AbortSignal | undefined;
  let refreshed = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/exchange_public_token')) {
      exchanges++;
      signal = init?.signal ?? undefined;
      return new Promise<Response>(resolve => { finish = resolve; });
    }
    return new Response(JSON.stringify({ link_token: 'link-token' }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    render(<PlaidConnectButton onSuccessSync={() => { refreshed++; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Bank' }));
    await waitFor(() => assert.ok(success));
    await act(async () => { success!('public-token', { institution: { name: 'Test' } }); success!('public-token', { institution: { name: 'Test' } }); await Promise.resolve(); });
    await waitFor(() => assert.equal(exchanges, 1));
    await act(async () => { useAuthStore.setState({ currentWorkspaceId: 'other' }); });
    assert.equal(signal?.aborted, true);
    await act(async () => { finish(new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } })); });
    assert.equal(refreshed, 0);
  } finally {
    cleanup(); script.remove(); plaidWindow.Plaid = priorPlaid;
  }
});

test('a current Plaid success exchanges once and refreshes the connection list', async () => {
  setComponentWorkspace();
  const script = document.createElement('script');
  script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
  document.body.appendChild(script);
  let success: ((token: string, metadata: { institution: { name: string } }) => void) | undefined;
  const plaidWindow = window as unknown as { Plaid?: unknown };
  const priorPlaid = plaidWindow.Plaid;
  plaidWindow.Plaid = { create: (options: { onSuccess: typeof success }) => {
    success = options.onSuccess;
    return { open() {}, exit() {}, destroy() {} };
  } };
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  let refreshed = 0;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    calls.push({ path, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(path.endsWith('/create_link_token') ? { link_token: 'link-token' } : { success: true, bankId: 'bank-1' }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    render(<PlaidConnectButton onSuccessSync={() => { refreshed++; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Bank' }));
    await waitFor(() => assert.ok(success));
    await act(async () => { success!('public-token', { institution: { name: 'Test bank' } }); });
    await waitFor(() => assert.equal(refreshed, 1));
    const exchanges = calls.filter(c => c.path.endsWith('/exchange_public_token'));
    assert.equal(exchanges.length, 1);
    assert.deepEqual(exchanges[0].body, { workspaceId: 'component-workspace', public_token: 'public-token', institutionName: 'Test bank' });
    assert.equal(screen.getByRole('button', { name: 'Connect Bank' }).hasAttribute('disabled'), false);
  } finally {
    cleanup(); script.remove(); plaidWindow.Plaid = priorPlaid;
  }
});
