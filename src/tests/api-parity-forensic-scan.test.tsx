import './helpers/dom';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import ForensicAudit from '../components/forensics/ForensicAudit';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makeTransaction } from './fixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.ResizeObserver = window.ResizeObserver;
  setComponentWorkspace();
  useLedgerStore.setState({ transactions: Array.from({ length: 7 }, (_, i) => makeTransaction({ id: `t${i}` })), accounts: [] });
});
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

test('renders the actual API shape without inventing score, date or currency', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'success', anomalies: [{ id: 'outlier', description: 'Large charge', amountCents: 12345, reason: 'Statistically anomalous amount (Z-Score > 2.5)' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  render(<ForensicAudit />);
  assert.ok(await screen.findByText('Large charge'));
  assert.ok(screen.getByText('12,345 minor units (currency not supplied)'));
  assert.ok(screen.getByText(/at most 200 entries/));
  assert.equal(screen.queryByText(/No outliers were returned/), null);
});

test('failure and malformed success are not reported as a clean scan', async () => {
  for (const response of [new Response('{}', { status: 500 }), new Response('{"anomalies":[{}]}', { status: 200 })]) {
    globalThis.fetch = (async () => response) as typeof fetch;
    render(<ForensicAudit />);
    assert.match((await screen.findByRole('alert')).textContent || '', /unavailable/i);
    assert.equal(screen.queryByText(/No outliers were returned/), null);
    cleanup();
  }
});

test('an old workspace response cannot appear after switching scope', async () => {
  let resolveFirst!: (response: Response) => void;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.workspaceId === 'component-workspace') return await new Promise<Response>(resolve => { resolveFirst = resolve; });
    return new Response(JSON.stringify({ anomalies: [] }), { status: 200 });
  }) as typeof fetch;
  render(<ForensicAudit />);
  await waitFor(() => assert.ok(resolveFirst));
  act(() => useAuthStore.setState({ currentWorkspaceId: 'other-workspace' }));
  await screen.findByText(/No outliers were returned/);
  await act(async () => resolveFirst(new Response(JSON.stringify({ anomalies: [{ id: 'a', description: 'Old private result', amountCents: 1, reason: 'outlier' }] }), { status: 200 })));
  assert.equal(screen.queryByText('Old private result'), null);
});
