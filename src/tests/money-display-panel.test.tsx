/**
 * Money display for the whole workspace (BB-05; BM-01 symbol placement, BM-02 separators, BM-03
 * accounting negatives): owners and accountants choose a number style and how negatives look; the
 * choice is saved on the workspace and every amount follows; nothing in the books changes.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MoneyDisplayPanel from '../components/platform/settings/MoneyDisplayPanel';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { formatCurrency } from '../lib/utils';
import { getSupabase } from '../lib/db/client';

afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });

test('an accountant chooses Germany and brackets: saved on the workspace, and amounts everywhere follow', async () => {
  const ws = setComponentWorkspace('accountant');
  useAuthStore.setState({ workspaces: [{ ...ws, currency: 'EUR', moneyDisplay: {} }] });
  const writes: Array<{ input?: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // the style is saved through `workspace.settings` now, so the test reads the command's input
    if (String(input).includes('/commands/workspace.settings') && typeof init?.body === 'string') writes.push(JSON.parse(init.body));
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  render(<MoneyDisplayPanel />);
  await act(async () => { fireEvent.change(screen.getByLabelText('Number style'), { target: { value: 'de-DE' } }); });
  await waitFor(() => assert.equal(writes.length, 1));
  assert.deepEqual(writes[0].input, { moneyDisplay: { locale: 'de-DE' } });
  await act(async () => { fireEvent.change(screen.getByLabelText('Negative amounts'), { target: { value: 'accounting' } }); });
  await waitFor(() => assert.equal(writes.length, 2));
  assert.deepEqual(writes[1].input, { moneyDisplay: { locale: 'de-DE', negativeStyle: 'accounting' } });
  assert.match(screen.getByTestId('money-sample').textContent || '', /^1\.234\.567,89\s€ · \(1\.234,56\s€\)$/);
  assert.match(formatCurrency(-50, 'EUR'), /^\(0,50\s€\)$/, 'amounts elsewhere follow');
});

test('a bookkeeper sees the style but cannot change it', () => {
  const ws = setComponentWorkspace('bookkeeper');
  useAuthStore.setState({ workspaces: [{ ...ws, currency: 'USD', moneyDisplay: { locale: 'en-US' } }] });
  render(<MoneyDisplayPanel />);
  assert.equal((screen.getByLabelText('Number style') as HTMLSelectElement).disabled, true);
  assert.match(screen.getByText(/Owners and accountants choose it/).textContent || '', /nothing in the books does/);
});
