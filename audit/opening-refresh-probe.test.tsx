/** Fault-injection observation of the opening refresh key, using a mocked API; no database writes. */
import '../src/tests/helpers/dom';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { useServerOpening } from '../src/hooks/useServerOpening';
import { useAuthStore } from '../src/stores/useAuthStore';
import type { Transaction } from '../src/types';

test('an edited cutoff-day entry does not refresh the opening when count and cutoff stay the same', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ accounts: { cash: calls === 1 ? 100 : 200 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  useAuthStore.setState({ currentWorkspaceId: 'opening-probe' });
  const entry = { id: 'entry', date: '2026-01-01', lines: [{ accountId: 'cash', amountCents: 100 }] } as unknown as Transaction;
  try {
    const { result, rerender } = renderHook(({ rows }) => useServerOpening(rows), { initialProps: { rows: [entry] } });
    await waitFor(() => assert.equal(result.current?.accounts.cash, 100));
    rerender({ rows: [{ ...entry, lines: [{ accountId: 'cash', amountCents: 200 }] }] });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(calls, 1);
    assert.equal(result.current?.accounts.cash, 100);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});
