/** AUP-22: an edit to an entry dated on the opening day re-reads the server's opening. Mocked API; no database. */
import './helpers/dom';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { useServerOpening } from '../hooks/useServerOpening';
import { useAuthStore } from '../stores/useAuthStore';
import type { Transaction } from '../types';

test('an edited cutoff-day entry refreshes the opening even when count and cutoff stay the same', async () => {
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
    await waitFor(() => assert.equal(result.current?.accounts.cash, 200));
    assert.equal(calls, 2);
    // an entry after the opening day is summed locally: no further read
    rerender({ rows: [{ ...entry, lines: [{ accountId: 'cash', amountCents: 200 }] }, { id: 'later', date: '2026-02-01', lines: [] } as unknown as Transaction] });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(calls, 3, 'a new entry changes the count, which re-reads as before');
    rerender({ rows: [{ ...entry, lines: [{ accountId: 'cash', amountCents: 200 }] }, { id: 'later', date: '2026-02-01', lines: [{ accountId: 'cash', amountCents: 5 }] } as unknown as Transaction] });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(calls, 3, 'editing an entry after the opening day does not re-read');
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});
