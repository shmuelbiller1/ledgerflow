/**
 * Prompt 2, part 3 — one way to act. `runCommand` sends the request; `useCommand(name)` is the half a
 * screen uses: it knows the address from the generated manifest, refuses to send twice, and turns a
 * refusal into the sentence the command itself offers instead of "that did not work".
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { useCommand } from '../hooks/useCommand';
import { COMMAND_MANIFEST } from '../lib/commands.generated';
import { useAuthStore } from '../stores/useAuthStore';

/**
 * A workspace this person owns, which is what every real screen has behind it: `useCurrentRole` reads
 * the session, and with no workspace it answers "viewer" — correctly, because there is nothing to act
 * on. A test that skipped this would only ever be exercising the refusal path.
 */
const WORKSPACE = 'ws-test';
const OWNER = { uid: 'owner-uid', email: 'owner@example.test', displayName: 'Owner' };
function signedInAsOwner() {
  useAuthStore.setState({
    user: OWNER as never,
    currentWorkspaceId: WORKSPACE,
    workspaces: [{ id: WORKSPACE, uid: OWNER.uid, name: 'Test Books', members: [OWNER.uid] }] as never,
  });
}

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function answers(status: number, body: unknown, onCall?: (url: string, init: RequestInit) => void) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    onCall?.(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

describe('useCommand(name) is how a screen acts', () => {
  test.beforeEach(() => signedInAsOwner());
  test('the address comes from the manifest, so a screen never types it', async () => {
    const calls = answers(200, { status: 'success', data: { id: 'c1' } });
    const { result } = renderHook(() => useCommand('customer.create'));
    await act(async () => { await result.current.run({ customer: { name: 'Acme' } }); });
    assert.equal(calls[0].url, '/api/v1/commands/customer.create');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { workspaceId: WORKSPACE, input: { customer: { name: 'Acme' } } });
  });

  test('a refusal reads as the command’s own sentence and the next step it offers', async () => {
    // the manifest carries, per refusal code, what it means and what to do next; a dead end that only
    // says "that did not work" is the thing this replaces
    answers(409, { status: 'error', code: 'CONFLICT', message: 'The customer changed.' });
    const { result } = renderHook(() => useCommand('customer.update'));
    await act(async () => { await result.current.run({ customer: { id: 'c1' } }); });
    await waitFor(() => assert.ok(result.current.refusal));
    assert.equal(result.current.refusal?.code, 'CONFLICT');
    assert.equal(result.current.refusal?.message, 'The customer changed.');
    assert.ok(result.current.refusal?.next, 'a refusal that has an offered next step shows it');
  });

  test('the next step offered comes from the command, and is a command that exists', () => {
  // A screen must not invent a workflow. `invoice.create` declares "Record a payment"; the hook hands
  // it back as a command name, so the screen can look it up and check the role before offering it.
  const { result } = renderHook(() => useCommand('invoice.create'));
  assert.deepEqual(result.current.next, [{ command: 'payment.receive', label: 'Record a payment' }]);
  // and the offered command is real: it is in the same manifest the address comes from
  assert.ok(COMMAND_MANIFEST.some(command => command.name === result.current.next[0].command));
  // a command that declares nothing offers nothing, rather than a guessed step
  const none = renderHook(() => useCommand('invoice.delete'));
  assert.deepEqual(none.result.current.next, []);
});

test('a role that cannot run the command is told so before a request is made', async () => {
  // The manifest carries the roles, so the answer is known without filling in a form and waiting for
  // the server to refuse. Nothing is sent at all.
  const calls = answers(200, {});
  useAuthStore.setState({ currentWorkspaceId: WORKSPACE, user: { uid: 'viewer-uid', email: 'v@example.test' } as never });
  useAuthStore.setState({
    workspaces: [{ id: WORKSPACE, uid: OWNER.uid, name: 'Test Books', members: [OWNER.uid], roles: { 'viewer-uid': 'viewer' } }] as never,
  });
  const { result } = renderHook(() => useCommand('invoice.delete'));
  await act(async () => { await result.current.run({ id: 'inv-1' }); });
  assert.equal(calls.length, 0, 'a refused role never reaches the network');
  assert.equal(result.current.refusal?.code, 'ROLE_REQUIRED');
  assert.match(result.current.refusal?.message || '', /role cannot do that/);
  assert.ok(result.current.refusal?.next, 'and says who can');
});

test('a request that never reached the server says so, rather than blaming a code', async () => {
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const { result } = renderHook(() => useCommand('invoice.create'));
    await act(async () => { await result.current.run({ invoice: {} }); });
    await waitFor(() => assert.ok(result.current.refusal));
    assert.match(result.current.refusal?.message || '', /connection|network|did not work/i);
    assert.equal(result.current.refusal?.code, undefined);
  });

  test('a second press while the first is in flight does not send the command twice', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(url);
      await gate;
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
    const { result } = renderHook(() => useCommand('payment.receive'));
    await act(async () => {
      const first = result.current.run({ payment: {} });
      const second = result.current.run({ payment: {} });
      release?.();
      await Promise.all([first, second]);
    });
    assert.equal(calls.length, 1, 'one intent, one request');
  });

  test('an unknown command name fails loudly instead of requesting a made-up address', () => {
    assert.throws(() => renderHook(() => useCommand('invented.command')), /not a registered command/);
  });
});
