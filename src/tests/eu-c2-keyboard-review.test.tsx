/**
 * EU-C2: guesses reviewed from the keyboard. Two guesses, Corner Cafe (Meals) and Deli (Meals): J moves from the
 * first to the second, K back; A on the first accepts it — one batch save with Meals — and focus moves on.
 */
import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { makeTransaction } from './fixtures';
import { expenseAccounts } from './helpers/expenseAccounts';
import InboxView from '../components/ledger/InboxView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';

const accounts = expenseAccounts('meals');
const guess = (id: string, description: string) => makeTransaction({
  id, workspaceId: 'component-workspace', date: '2026-11-10', description, payee: description, status: 'draft', totalAmountCents: 1500,
  lines: [{ accountId: 'meals', amountCents: 1500 }, { accountId: 'bank', amountCents: -1500 }],
});
const realFetch = globalThis.fetch;
let sent: Array<{ url: string; body: { updates?: Array<{ id: string; data: { lines: Array<{ accountId: string }> } }> } }> = [];
beforeEach(() => {
  sent = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) });
    return new Response('{}', { status: String(url).includes('/transactions/batch') ? 200 : 500 });
  }) as typeof fetch;
  setComponentWorkspace('owner');
  markComponentCollectionsLoaded('transactions', 'accounts');
  useLedgerStore.setState({ accounts, transactions: [guess('cafe', 'Corner Cafe'), guess('deli', 'Deli')] });
});
afterEach(() => { cleanup(); globalThis.fetch = realFetch; useLedgerStore.setState({ transactions: [] }); });

test('EU-C2: J and K move between guesses; A accepts the focused one and moves on', async () => {
  render(<InboxView />);
  const rows = screen.getAllByRole('option');
  assert.equal(rows.length, 2);
  rows[0].focus();
  fireEvent.keyDown(rows[0], { key: 'j' });
  assert.equal(document.activeElement, rows[1]);
  fireEvent.keyDown(rows[1], { key: 'k' });
  assert.equal(document.activeElement, rows[0]);
  await act(async () => { fireEvent.keyDown(rows[0], { key: 'a' }); });
  const batch = sent.find(s => s.url.includes('/transactions/batch'));
  assert.ok(batch, 'saved');
  assert.deepEqual(batch!.body.updates!.map(u => u.id), ['cafe']);
  assert.ok(batch!.body.updates![0].data.lines.some(l => l.accountId === 'meals'));
});

test('EU-C2: keys typed with Ctrl, or inside the "Always do this" box, do nothing', async () => {
  render(<InboxView />);
  const rows = screen.getAllByRole('option');
  await act(async () => { fireEvent.keyDown(rows[0], { key: 'a', ctrlKey: true }); });
  const box = rows[0].querySelector('input');
  if (box) await act(async () => { fireEvent.keyDown(box, { key: 'a' }); });
  assert.equal(sent.filter(s => s.url.includes('/transactions/batch')).length, 0);
});

test('EU-C2: a held A (key repeat), or A again while the save is on its way, accepts once', async () => {
  let finish!: () => void;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) });
    if (String(url).includes('/transactions/batch')) await new Promise<void>(r => { finish = r; });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  useLedgerStore.setState({ transactions: [guess('cafe', 'Corner Cafe')] });
  render(<InboxView />);
  const [row] = screen.getAllByRole('option');
  await act(async () => { fireEvent.keyDown(row, { key: 'a' }); });
  await act(async () => { fireEvent.keyDown(row, { key: 'a', repeat: true }); });
  await act(async () => { fireEvent.keyDown(row, { key: 'a' }); });
  assert.equal(sent.filter(s => s.url.includes('/transactions/batch')).length, 1);
  await act(async () => { finish(); });
});
