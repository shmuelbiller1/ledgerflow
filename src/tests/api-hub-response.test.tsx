import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { ApiHubSandbox } from '../components/platform/ApiHubSandbox';
import { ApiHubDocGetMetrics, ApiHubDocPostTransaction } from '../components/platform/ApiHubCoreDocs';
import { ApiHubDocShiftingMetrics } from '../components/platform/ApiHubAnalysisDocs';
import { ApiHubDocPostProject } from '../components/platform/ApiHubIntegrationDocs';
import ApiHub from '../components/platform/ApiHub';
import { TransactionSchema } from '../schemas';
import { useAuthStore } from '../stores/useAuthStore';
import { toast } from 'sonner';
import { useApiHubModel } from '../components/platform/useApiHubModel';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';

beforeEach(() => setComponentWorkspace());
afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('the API sandbox preserves an HTTP refusal and never celebrates it as success', async t => {
  const success = t.mock.method(toast, 'success', () => 'success');
  const error = t.mock.method(toast, 'error', () => 'error');
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    if (String(input).startsWith('/api/v1/status?')) return new Response(JSON.stringify({ error: 'Denied' }), { status: 403 });
    return new Response('[]', { status: 200 });
  });
  const { result } = renderHook(() => useApiHubModel());
  await act(async () => { await result.current.runSandboxRequest(); });
  assert.equal(result.current.sandboxStatus, 403);
  assert.deepEqual(result.current.sandboxResult, { error: 'Denied' });
  assert.equal(success.mock.callCount(), 0);
  assert.equal(error.mock.callCount(), 1);
});

test('non-JSON refusals retain their actual HTTP status and text', async t => {
  t.mock.method(toast, 'error', () => 'error');
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => String(input).startsWith('/api/v1/status?')
    ? new Response('upstream unavailable', { status: 502 }) : new Response('[]', { status: 200 }));
  const { result } = renderHook(() => useApiHubModel());
  await act(async () => { await result.current.runSandboxRequest(); });
  assert.equal(result.current.sandboxStatus, 502);
  assert.deepEqual(result.current.sandboxResult, { responseText: 'upstream unavailable' });
});

test('a network failure is not presented as an HTTP 500', async t => {
  t.mock.method(toast, 'error', () => 'error');
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    if (String(input).startsWith('/api/v1/status?')) throw new Error('offline');
    return new Response('[]', { status: 200 });
  });
  const { result } = renderHook(() => useApiHubModel());
  await act(async () => { await result.current.runSandboxRequest(); });
  assert.equal(result.current.sandboxStatus, 0);
  assert.deepEqual(result.current.sandboxResult, { error: 'offline' });
});

test('a successful API response still displays its result and success feedback', async t => {
  const success = t.mock.method(toast, 'success', () => 'success');
  const error = t.mock.method(toast, 'error', () => 'error');
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => new Response(String(input).startsWith('/api/v1/status?') ? '{"status":"ok"}' : '[]', { status: 200 }));
  const { result } = renderHook(() => useApiHubModel());
  await act(async () => { await result.current.runSandboxRequest(); });
  assert.equal(result.current.sandboxStatus, 200);
  assert.deepEqual(result.current.sandboxResult, { status: 'ok' });
  assert.equal(success.mock.callCount(), 1);
  assert.equal(error.mock.callCount(), 0);
});

test('a response-body read failure preserves the received status', async t => {
  t.mock.method(toast, 'error', () => 'error');
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    if (String(input).startsWith('/api/v1/status?')) {
      const response = new Response('partial', { status: 503 });
      t.mock.method(response, 'text', async () => { throw new Error('connection lost reading body'); });
      return response;
    }
    return new Response('[]', { status: 200 });
  });
  const { result } = renderHook(() => useApiHubModel());
  await act(async () => { await result.current.runSandboxRequest(); });
  assert.equal(result.current.sandboxStatus, 503);
  assert.deepEqual(result.current.sandboxResult, { error: 'connection lost reading body' });
});


test('the API response panel shows refusal status without invented validation claims', async t => {
  t.mock.method(toast, 'error', () => 'error');
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => String(input).startsWith('/api/v1/status?')
    ? new Response('{"error":"Denied"}', { status: 403 }) : new Response('[]', { status: 200 }));
  function Harness() { return <ApiHubSandbox model={useApiHubModel()} />; }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Execute aperiodic API query' }));
  await waitFor(() => assert.ok(screen.getByText('Status 403')));
  assert.ok(screen.getByText(/Denied/));
  assert.equal(screen.queryByText(/Double-entry verified successfully/), null);
  assert.equal(screen.queryByText(/units computed/), null);
});

test('the playground requires a complete API credential and sends it on direct and command requests', async t => {
  const seen: Array<{ url: string; authorization: string | null }> = [];
  t.mock.method(toast, 'error', () => 'error');
  t.mock.method(toast, 'success', () => 'success');
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/v1/status?') || url.startsWith('/api/v1/commands/')) {
      seen.push({ url, authorization: new Headers(init?.headers).get('authorization') });
      return Response.json({ status: 'success', data: {} });
    }
    return Response.json([]);
  });
  const { result } = renderHook(() => useApiHubModel());
  await act(async () => { result.current.setSandboxCredType('key'); result.current.setSandboxSelectedKey('lf_id_workspace_012345'); });
  await act(async () => { await result.current.runSandboxRequest(); });
  assert.equal(seen.length, 0, 'a saved key ID is not a secret');
  await act(async () => { assert.equal(await result.current.runSandboxCommand('example.run', {}), false); });
  assert.equal(seen.length, 0, 'commands must not send an ID either');
  await act(async () => { result.current.setSandboxSelectedKey('lf_id_workspace_012345.secret'); });
  await act(async () => { await result.current.runSandboxRequest(); });
  await act(async () => { assert.equal(await result.current.runSandboxCommand('example.run', {}), true); });
  assert.deepEqual(seen.map(x => x.authorization), ['Bearer lf_id_workspace_012345.secret', 'Bearer lf_id_workspace_012345.secret']);
  assert.equal(result.current.sandboxStatus, -1, 'the shared command helper does not expose the exact 2xx code');
});

test('the API playground accepts the full secret in a password input and never renders it in code examples', async () => {
  function Harness() { return <ApiHubSandbox model={useApiHubModel()} />; }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'API Bearer Key' }));
  const input = screen.getByLabelText('Full API key (ID and secret)') as HTMLInputElement;
  assert.equal(input.type, 'password');
  fireEvent.change(input, { target: { value: 'lf_id_workspace_012345.private-secret' } });
  assert.equal(input.value, 'lf_id_workspace_012345.private-secret');
  assert.ok([...document.querySelectorAll('pre')].every(pre => !pre.textContent?.includes('private-secret')));
  fireEvent.click(screen.getByRole('button', { name: /python/i }));
  assert.ok([...document.querySelectorAll('pre')].every(pre => !pre.textContent?.includes('private-secret')));
  fireEvent.click(screen.getByRole('button', { name: /node/i }));
  assert.ok([...document.querySelectorAll('pre')].every(pre => !pre.textContent?.includes('private-secret')));
});

test('unsafe transaction forms cannot execute, even when selected programmatically', async t => {
  const writes: string[] = [];
  t.mock.method(toast, 'error', () => 'error');
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') writes.push(String(input));
    return Response.json([]);
  });
  const { result } = renderHook(() => useApiHubModel());
  for (const endpoint of ['POST_v1_transactions', 'POST_v1_transactions_bulk']) {
    await act(async () => { result.current.setSandboxEndpoint(endpoint); result.current.setFieldDryRun(true); });
    await act(async () => { await result.current.runSandboxRequest(); });
  }
  assert.deepEqual(writes, []);
});

test('ledger match refuses a developer key locally because the route requires a session', async t => {
  const calls: string[] = [];
  t.mock.method(toast, 'error', () => 'error');
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => { calls.push(String(input)); return Response.json([]); });
  const { result } = renderHook(() => useApiHubModel());
  await act(async () => { result.current.setSandboxEndpoint('POST_ledger_match'); result.current.setSandboxCredType('key'); result.current.setSandboxSelectedKey('lf_id_workspace_012345.secret'); });
  await act(async () => { await result.current.runSandboxRequest(); });
  assert.equal(calls.filter(url => url === '/api/v1/ledger/match').length, 0);
});

test('transaction documentation shows an envelope and balanced lines matching the server schema', () => {
  function Harness() { return <ApiHubDocPostTransaction model={useApiHubModel()} />; }
  const { container } = render(<Harness />);
  const body = JSON.parse(container.querySelector('pre')!.textContent!) as { transaction: { lines: Array<{ amountCents: number }> } };
  assert.equal(TransactionSchema.safeParse({ ...body.transaction, uid: 'server-user' }).success, true);
  assert.equal(body.transaction.lines.length, 2);
  assert.equal(body.transaction.lines.reduce((sum, line) => sum + line.amountCents, 0), 0);
  assert.ok(screen.getByText(/not a dry run/i));
});

test('switching workspaces discards the playground secret and result', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([]));
  const first = useAuthStore.getState().workspaces[0];
  useAuthStore.setState({ workspaces: [first, { ...first, id: 'second-workspace', name: 'Second' }] });
  render(<ApiHub />);
  fireEvent.click(screen.getByRole('button', { name: /playground sandbox/i }));
  fireEvent.click(screen.getByRole('button', { name: 'API Bearer Key' }));
  fireEvent.change(screen.getByLabelText('Full API key (ID and secret)'), { target: { value: 'lf_id_workspace_012345.secret' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: 'second-workspace' } });
  fireEvent.click(screen.getByRole('button', { name: /playground sandbox/i }));
  fireEvent.click(screen.getByRole('button', { name: 'API Bearer Key' }));
  assert.equal((screen.getByLabelText('Full API key (ID and secret)') as HTMLInputElement).value, '');
});

test('a key provision response that arrives after changing workspaces does not reveal the old secret', async t => {
  let resolveKey!: (value: Response) => void;
  const keyResponse = new Promise<Response>(resolve => { resolveKey = resolve; });
  t.mock.method(toast, 'info', () => 'info');
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => String(input) === '/api/v1/keys/provision' ? keyResponse : Response.json([]));
  const { result } = renderHook(() => useApiHubModel());
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.generateNewKey(); });
  await act(async () => { useAuthStore.setState({ currentWorkspaceId: 'second-workspace' }); });
  await act(async () => { resolveKey(Response.json({ apiKey: 'lf_id_workspace_123.oldsecret' }, { status: 201 })); await pending; });
  assert.equal(result.current.apiKey, '');
});

test('project create playground and documentation say how to retry safely with an Idempotency-Key (AUP-26)', () => {
  function Sandbox() { return <ApiHubSandbox model={useApiHubModel()} />; }
  const sandbox = render(<Sandbox />);
  fireEvent.change(screen.getByLabelText('Select API Route'), { target: { value: 'POST_v1_projects' } });
  assert.ok(screen.getByText(/a retry with the same key returns the first project/));
  sandbox.unmount();
  function Docs() { return <ApiHubDocPostProject model={useApiHubModel()} />; }
  render(<Docs />);
  assert.ok(screen.getByText(/returns the first project instead of making another\. Without the header/));
});

test('API Hub warns about non-authoritative legacy metrics and shifting assumptions', () => {
  function Sandbox() { return <ApiHubSandbox model={useApiHubModel()} />; }
  const sandbox = render(<Sandbox />);
  fireEvent.change(screen.getByLabelText('Select API Route'), { target: { value: 'GET_v1_metrics' } });
  assert.ok(screen.getByText(/Shifting metrics can include assumptions and fallback values/));
  sandbox.unmount();
  function Summary() { return <ApiHubDocGetMetrics model={useApiHubModel()} />; }
  const summary = render(<Summary />);
  assert.ok(screen.getByText(/summary can include draft and forecast entries/));
  summary.unmount();
  function Shifting() { return <ApiHubDocShiftingMetrics model={useApiHubModel()} />; }
  render(<Shifting />);
  assert.ok(screen.getByText(/Some shifting metrics use assumptions or fallback values/));
});
