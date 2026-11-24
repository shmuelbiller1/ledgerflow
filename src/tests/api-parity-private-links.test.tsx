import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import CustomerPortalLink from '../components/sales/CustomerPortalLink';
import { EstimateSignLink } from '../components/sales/EstimateSignLink';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makeCustomer } from './fixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';

beforeEach(() => setComponentWorkspace());
afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('portal success without a token never creates a fake undefined link', async t => {
  const acme = makeCustomer({ id: 'c1', name: 'Acme' });
  useLedgerStore.setState({ customers: [acme] });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'success' }));
  const error = t.mock.method(toast, 'error');
  render(<CustomerPortalLink customer={acme} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make a portal link' })); });
  await waitFor(() => assert.ok(error.mock.calls.some(call => String(call.arguments[0]).includes('returned no link'))));
  assert.equal(useLedgerStore.getState().customers[0].portalToken, undefined);
  assert.equal(screen.queryByLabelText('Portal link'), null);
});

test('signing success without a token never displays a fake link', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'success' }));
  const error = t.mock.method(toast, 'error');
  render(<EstimateSignLink workspaceId="component-workspace" estimate={{ id: 'e1' }} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ask the customer to sign estimate e1' })); });
  await waitFor(() => assert.ok(error.mock.calls.some(call => String(call.arguments[0]).includes('returned no link'))));
  assert.equal(screen.queryByLabelText('Signing link'), null);
});

test('without clipboard support the signing link is available but never claimed copied', async t => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  t.after(() => { if (original) Object.defineProperty(navigator, 'clipboard', original); else Reflect.deleteProperty(navigator, 'clipboard'); });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'success', token: 'sign-token' }));
  const success = t.mock.method(toast, 'success');
  render(<EstimateSignLink workspaceId="component-workspace" estimate={{ id: 'e1' }} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ask the customer to sign estimate e1' })); });
  assert.match((screen.getByLabelText('Signing link') as HTMLInputElement).value, /\/e\/sign-token$/);
  assert.ok(success.mock.calls.some(call => String(call.arguments[0]).includes('copy it below')));
  assert.equal(success.mock.calls.some(call => String(call.arguments[0]).includes('link copied')), false);
});

test('the portal link is not claimed copied when clipboard is unavailable', async t => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  t.after(() => { if (original) Object.defineProperty(navigator, 'clipboard', original); else Reflect.deleteProperty(navigator, 'clipboard'); });
  const acme = makeCustomer({ id: 'c1', name: 'Acme' });
  useLedgerStore.setState({ customers: [acme] });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'success', token: 'cp_token' }));
  const success = t.mock.method(toast, 'success');
  render(<CustomerPortalLink customer={acme} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make a portal link' })); });
  assert.equal(useLedgerStore.getState().customers[0].portalToken, 'cp_token');
  assert.ok(success.mock.calls.some(call => String(call.arguments[0]).includes('copy it below')));
  assert.equal(success.mock.calls.some(call => String(call.arguments[0]).includes('made and copied')), false);
});

test('a late portal creation cannot write a token into a different workspace cache', async t => {
  const acme = makeCustomer({ id: 'c1', name: 'Acme' });
  useLedgerStore.setState({ customers: [acme] });
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  let started = false;
  t.mock.method(globalThis, 'fetch', async () => { started = true; return pending; });
  render(<CustomerPortalLink customer={acme} />);
  fireEvent.click(screen.getByRole('button', { name: 'Make a portal link' }));
  await waitFor(() => assert.equal(started, true));
  const first = useAuthStore.getState().getCurrentWorkspace()!;
  await act(async () => { useAuthStore.setState({ currentWorkspaceId: 'other-workspace', workspaces: [{ ...first, id: 'other-workspace' }] }); });
  await act(async () => { finish(Response.json({ status: 'success', token: 'old-token' })); await pending; });
  assert.equal(useLedgerStore.getState().customers[0].portalToken, undefined);
});

test('a signing link is hidden when the estimate changes', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'success', token: 'sign-token' }));
  const view = render(<EstimateSignLink workspaceId="component-workspace" estimate={{ id: 'e1' }} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ask the customer to sign estimate e1' })); });
  assert.ok(screen.getByLabelText('Signing link'));
  view.rerender(<EstimateSignLink workspaceId="component-workspace" estimate={{ id: 'e2' }} />);
  assert.equal(screen.queryByLabelText('Signing link'), null);
});

test('a late signing response for an old estimate is neither displayed nor copied', async t => {
  let finish!: (response: Response) => void;
  const request = new Promise<Response>(resolve => { finish = resolve; });
  let started = false;
  t.mock.method(globalThis, 'fetch', async () => { started = true; return request; });
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  let copies = 0;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { copies++; } } });
  t.after(() => { if (original) Object.defineProperty(navigator, 'clipboard', original); else Reflect.deleteProperty(navigator, 'clipboard'); });
  const view = render(<EstimateSignLink workspaceId="component-workspace" estimate={{ id: 'old' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ask the customer to sign estimate old' }));
  await waitFor(() => assert.equal(started, true));
  view.rerender(<EstimateSignLink workspaceId="component-workspace" estimate={{ id: 'new' }} />);
  await act(async () => { finish(Response.json({ status: 'success', token: 'old-token' })); await request; });
  assert.equal(screen.queryByLabelText('Signing link'), null);
  assert.equal(copies, 0);
});

test('a late portal response for another customer is neither copied nor placed in the cache', async t => {
  let finish!: (response: Response) => void;
  const request = new Promise<Response>(resolve => { finish = resolve; });
  let started = false;
  t.mock.method(globalThis, 'fetch', async () => { started = true; return request; });
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  let copies = 0;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { copies++; } } });
  t.after(() => { if (original) Object.defineProperty(navigator, 'clipboard', original); else Reflect.deleteProperty(navigator, 'clipboard'); });
  const first = makeCustomer({ id: 'first', name: 'First' });
  const second = makeCustomer({ id: 'second', name: 'Second' });
  useLedgerStore.setState({ customers: [first, second] });
  const view = render(<CustomerPortalLink customer={first} />);
  fireEvent.click(screen.getByRole('button', { name: 'Make a portal link' }));
  await waitFor(() => assert.equal(started, true));
  view.rerender(<CustomerPortalLink customer={second} />);
  await act(async () => { finish(Response.json({ status: 'success', token: 'old-token' })); await request; });
  assert.equal(useLedgerStore.getState().customers[0].portalToken, undefined);
  assert.equal(screen.queryByLabelText('Portal link'), null);
  assert.equal(copies, 0);
});

test('an uncertain portal revoke does not leave the old link presented as usable', async t => {
  const customer = makeCustomer({ id: 'c1', name: 'Acme', portalToken: 'old-token' });
  useLedgerStore.setState({ customers: [customer] });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'unavailable' }, { status: 503 }));
  render(<CustomerPortalLink customer={customer} />);
  assert.match((screen.getByLabelText('Portal link') as HTMLInputElement).value, /old-token/);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn off' })); });
  assert.equal(screen.queryByLabelText('Portal link'), null);
  assert.match(screen.getByRole('alert').textContent || '', /Could not confirm the link's current state/);
  assert.equal(screen.queryByRole('button', { name: 'Make a portal link' }), null);
});
