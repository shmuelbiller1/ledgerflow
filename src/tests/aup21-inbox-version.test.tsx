/** AUP-21: Inbox filing sends each entry's version and never patches books switched to meanwhile. Mocked API; no real writes. */
import './helpers/dom';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InboxView from '../components/ledger/InboxView';
import { makeTransaction } from './fixtures';
import { expenseAccounts } from './helpers/expenseAccounts';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';

after(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('Inbox filing sends the entry version and does not patch a switched cache with the same ID', async t => {
  const ws = setComponentWorkspace('owner');
  markComponentCollectionsLoaded('transactions', 'accounts');
  const accounts = expenseAccounts('fuel', 'hosting', 'meals');
  const transaction = (id: string, workspaceId: string, status: string, accountId: string) => makeTransaction({
    id, workspaceId, status: status as 'completed' | 'draft', date: '2026-11-10', description: 'Acme Hosting', payee: 'Acme Hosting', totalAmountCents: 4000,
    updatedAt: '2026-11-12T00:00:00.000Z', lines: [{ accountId, amountCents: 4000 }, { accountId: 'bank', amountCents: -4000 }],
  });
  useLedgerStore.setState({ accounts, transactions: [1, 2, 3, 4].map(i => transaction(`h${i}`, ws.id, 'completed', 'hosting')).concat(transaction('shared-id', ws.id, 'draft', 'uncategorized')) });
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  let payload: { updates: Array<{ id: string; expectedUpdatedAt?: string }> } | undefined;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/transactions/batch')) {
      payload = JSON.parse(String(init?.body)) as typeof payload;
      return pending;
    }
    return Response.json({}, { status: 500 });
  });
  render(<InboxView />);
  await screen.findByText('same as the last 4 times → Hosting');
  fireEvent.click(screen.getByRole('button', { name: 'Accept all with a rule or history' }));
  await waitFor(() => assert.ok(payload));
  assert.equal(payload!.updates[0].expectedUpdatedAt, '2026-11-12T00:00:00.000Z', 'the update names the version it was made from');
  const other = transaction('shared-id', 'other-workspace', 'draft', 'meals');
  await act(async () => {
    useAuthStore.setState({ currentWorkspaceId: 'other-workspace', workspaces: [{ ...ws, id: 'other-workspace' }] });
    useLedgerStore.setState({ transactions: [other] });
  });
  await act(async () => { finish(Response.json({ status: 'ok' })); await pending; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(useLedgerStore.getState().transactions[0].lines?.[0].accountId, 'meals', 'the other books keep their own entry');
});
