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

const answer = (body: Record<string, unknown>) => (async () => new Response(JSON.stringify({ status: 'success', ...body }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

test('AUP-31: a scan that could not judge says so, and is not shown as clean', async () => {
  globalThis.fetch = answer({ anomalies: [], currency: 'USD', skipped: 'too_few_entries', scanned: 3, sampleLimit: 200, sampleCapped: false });
  render(<ForensicAudit />);
  assert.match((await screen.findByText(/Not enough posted entries to judge/)).textContent || '', /not a clean result/);
  assert.equal(screen.queryByText(/No outliers/), null);
});

test('AUP-31: no variation is also not a clean result', async () => {
  globalThis.fetch = answer({ anomalies: [], currency: 'USD', skipped: 'no_variation', scanned: 6, sampleLimit: 200, sampleCapped: false });
  render(<ForensicAudit />);
  await screen.findByText(/nothing to compare/);
  assert.equal(screen.queryByText(/No outliers/), null);
});

test('AUP-31: with the book currency the amount is money, the sample is described, and the count is shown', async () => {
  globalThis.fetch = answer({ anomalies: [{ id: 'o', description: 'Large charge', amountCents: 12345, reason: 'Statistically anomalous amount (Z-Score > 2.5)' }], currency: 'EUR', skipped: null, scanned: 40, sampleLimit: 200, sampleCapped: true });
  render(<ForensicAudit />);
  await screen.findByText('Large charge');
  assert.equal(screen.queryByText(/currency not supplied/), null);
  assert.ok(screen.getByText(/€123\.45|EUR\s?123\.45/), 'formatted in the book currency');
  assert.ok(screen.getByText(/newest 200 posted entries, in EUR/));
  assert.ok(screen.getByText('Limited sample'), 'capped: still says it is a slice');
});

test('AUP-31: an uncapped clean scan reports how many entries it covered and drops the "limited" badge', async () => {
  globalThis.fetch = answer({ anomalies: [], currency: 'USD', skipped: null, scanned: 40, sampleLimit: 200, sampleCapped: false });
  render(<ForensicAudit />);
  await screen.findByText('No outliers among the 40 entries scanned.');
  assert.equal(screen.queryByText('Limited sample'), null);
  // the header names what was really covered, not "the newest 200"
  assert.ok(screen.getByText('Server scan: all 40 posted entries with an amount, in USD.'));
  assert.equal(screen.queryByText(/newest 200/), null);
});

test('AUP-31: malformed extra fields are ignored, not shown', async () => {
  globalThis.fetch = answer({ anomalies: [], currency: 'not a currency', skipped: 'bogus', scanned: 'many', sampleCapped: 'yes' });
  render(<ForensicAudit />);
  await screen.findByText(/No outliers were returned for this limited sample/);
});
