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
  test('the address comes from the manifest, so a screen never types it', async () => {
    const calls = answers(200, { status: 'success', data: { id: 'c1' } });
    const { result } = renderHook(() => useCommand('customer.create'));
    await act(async () => { await result.current.run({ customer: { name: 'Acme' } }); });
    assert.equal(calls[0].url, '/api/v1/commands/customer.create');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { input: { customer: { name: 'Acme' } } });
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
