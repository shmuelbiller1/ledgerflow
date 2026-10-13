import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import Dashboard from '../components/Dashboard';
import { useAuthStore } from '../stores/useAuthStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import { setComponentWorkspace } from './helpers/componentFixtures';

const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (async input => new Response(JSON.stringify(String(input).includes('/rest/v1/') ? [] : { banks: [] }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
});
// Close the database client opened by the screen so the test process can finish.
afterEach(async () => { cleanup(); globalThis.fetch = realFetch; getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('first-run decision waits for both collections from the current workspace', async () => {
  const ws = setComponentWorkspace();
  useLedgerStore.setState({ transactions: [], accounts: [] });
  useDataNeedsStore.getState().resetLoaded(ws.id);
  render(<Dashboard />);

  assert.match(screen.getByRole('status').textContent || '', /Loading your books/);
  assert.equal(screen.queryByText('Set up your books'), null);

  await act(async () => { useDataNeedsStore.getState().markLoaded('transactions'); });
  assert.match(screen.getByRole('status').textContent || '', /Loading your books/,
    'an empty transaction snapshot alone does not establish that setup is needed');

  await act(async () => { useDataNeedsStore.getState().markLoaded('accounts'); });
  assert.ok(screen.getByRole('heading', { name: 'Set up your books' }));

  // A workspace switch clears the ledger cache synchronously, before the new load effect.
  const next = { ...ws, id: 'other-books', name: 'Other books' };
  await act(async () => { useAuthStore.getState().setWorkspaces([ws, next]); useAuthStore.getState().setCurrentWorkspaceId(next.id); });
  assert.match(screen.getByRole('status').textContent || '', /Loading your books/,
    'ready flags from previous books must never choose a setup screen');
  await act(async () => { useDataNeedsStore.getState().resetLoaded(next.id); });
  await act(async () => { useDataNeedsStore.getState().markLoaded('transactions'); useDataNeedsStore.getState().markLoaded('accounts'); });
  assert.ok(screen.getByRole('heading', { name: 'Set up your books' }));
});

test('a previously completed empty workspace stays a dashboard, not first-time onboarding', async () => {
  const ws = setComponentWorkspace();
  useAuthStore.getState().setWorkspaces([{ ...ws, setupCompletedAt: '2026-10-11T12:00:00Z' }]);
  useLedgerStore.setState({ transactions: [], accounts: [] });
  useDataNeedsStore.getState().resetLoaded(ws.id);
  render(<Dashboard />);

  assert.match(screen.getByRole('status').textContent || '', /Loading your books/);
  await act(async () => { useDataNeedsStore.getState().markLoaded('transactions'); useDataNeedsStore.getState().markLoaded('accounts'); });
  assert.ok(screen.getByRole('region', { name: 'Dashboard widgets' }));
  assert.equal(screen.queryByText('Set up your books'), null);
  assert.equal(screen.queryByText('Your Ledger is Ready.'), null);
});

test('a failed core collection shows a retry instruction rather than guessing new books', async () => {
  const ws = setComponentWorkspace();
  useLedgerStore.setState({ transactions: [], accounts: [] });
  useDataNeedsStore.getState().resetLoaded(ws.id);
  render(<Dashboard />);
  await act(async () => { useDataNeedsStore.getState().markFailed('transactions', 'offline'); });
  assert.match(screen.getByRole('alert').textContent || '', /Could not load your books/);
  assert.equal(screen.queryByText('Set up your books'), null);
});
