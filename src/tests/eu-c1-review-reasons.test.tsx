/**
 * EU-C1: the review list says why it suggests an account instead of inventing 92% or 75%.
 * By hand: a rule "Shell → Fuel"; "Acme Hosting" filed to Hosting 4 times before, never changed; "Corner Cafe" with
 * Meals on its line and no rule or history; "Mystery" with nothing. "Accept all with a rule or history" files Shell
 * to Fuel and Acme to Hosting — each to its own account — and leaves the guess and the unknown alone.
 */
import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { reviewReason } from '../lib/reviewReason';
import { makeChartAccount, makeTransaction } from './fixtures';
import InboxView from '../components/ledger/InboxView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { AutoRule } from '../types';

const accounts = [
  makeChartAccount({ id: 'bank', code: '1000', name: 'Bank', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'fuel', code: '6100', name: 'Fuel', type: 'expense', category: 'Expenses' }),
  makeChartAccount({ id: 'hosting', code: '6200', name: 'Hosting', type: 'expense', category: 'Expenses' }),
  makeChartAccount({ id: 'meals', code: '6300', name: 'Meals', type: 'expense', category: 'Expenses' }),
];
const shellRule = { id: 'r1', uid: 'u', name: 'Shell', condition: { descriptionContains: 'shell' }, action: { targetCategory: 'Fuel', targetAccountId: 'fuel' }, isActive: true } as unknown as AutoRule;
const pending = (id: string, description: string, accountId = 'uncategorized') => makeTransaction({
  id, workspaceId: 'component-workspace', date: '2026-11-10', description, payee: description, status: 'draft', totalAmountCents: 4000,
  lines: [{ accountId, amountCents: 4000 }, { accountId: 'bank', amountCents: -4000 }],
});

test('EU-C1: rule, history, guess and nothing, each said in words', () => {
  const rule = reviewReason({ tx: pending('a', 'SHELL 0042'), rules: [shellRule], accounts });
  assert.deepEqual([rule.kind, rule.accountId], ['rule', 'fuel']);
  assert.match(rule.text, /rule: Shell → Fuel/);
  const history = reviewReason({ tx: pending('b', 'Acme Hosting'), rules: [shellRule], accounts, calibration: { sampleSize: 4, unchangedCount: 4, suggestedAccountId: 'hosting' } });
  assert.deepEqual([history.kind, history.text], ['history', 'same as the last 4 times → Hosting']);
  const changedOnce = reviewReason({ tx: pending('b', 'Acme Hosting'), rules: [], accounts, calibration: { sampleSize: 4, unchangedCount: 3, suggestedAccountId: 'hosting' } });
  assert.equal(changedOnce.kind, 'none', 'history that was changed once is not history to trust');
  const guess = reviewReason({ tx: pending('c', 'Corner Cafe', 'meals'), rules: [shellRule], accounts });
  assert.deepEqual([guess.kind, guess.text], ['guess', 'guess → Meals']);
  assert.equal(reviewReason({ tx: pending('d', 'Mystery'), rules: [], accounts }).kind, 'none');
  for (const r of [rule, history, guess]) assert.doesNotMatch(r.text, /%/);
});

const posted = (n: number) => makeTransaction({
  id: `h${n}`, workspaceId: 'component-workspace', date: `2026-10-0${n}`, description: 'Acme Hosting', payee: 'Acme Hosting', status: 'completed', totalAmountCents: 4000,
  lines: [{ accountId: 'hosting', accountName: 'Hosting', amountCents: 4000 }, { accountId: 'bank', accountName: 'Bank', amountCents: -4000 }],
});

let sent: Array<{ url: string; body: { updates?: Array<{ id: string; data: { lines: Array<{ accountId: string }> } }> } }> = [];
beforeEach(() => {
  sent = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) });
    return new Response('{}', { status: String(url).includes('/transactions/batch') ? 200 : 500 });
  }) as typeof fetch;
  setComponentWorkspace('owner');
  markComponentCollectionsLoaded('transactions', 'accounts');
  useLedgerStore.setState({ accounts, transactions: [posted(1), posted(2), posted(3), posted(4), pending('acme', 'Acme Hosting'), pending('cafe', 'Corner Cafe', 'meals'), pending('mystery', 'Mystery')] });
});
afterEach(() => { cleanup(); useLedgerStore.setState({ transactions: [] }); });

test('EU-C1: the screen shows reasons, no percentages, and accepts each with its own account', async () => {
  render(<InboxView />);
  await act(async () => {});
  assert.ok(screen.getByText('same as the last 4 times → Hosting'));
  assert.ok(screen.getByText('guess → Meals'));
  assert.equal(document.body.textContent?.includes('Software / SaaS'), false);
  assert.doesNotMatch(document.body.textContent || '', /\b(92|75|45|99)%/);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Accept all with a rule or history' })); });
  const batch = sent.find(s => s.url.includes('/transactions/batch'));
  assert.ok(batch, 'one batch save');
  assert.deepEqual(batch!.body.updates!.map(u => [u.id, u.data.lines[0].accountId]), [['acme', 'hosting']], 'only the line backed by history, to its own account');
});
