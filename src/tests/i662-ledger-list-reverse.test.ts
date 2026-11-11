/**
 * #662: the ledger list's "Reverse transaction" button never un-posts an entry in place. A hand journal gets a
 * reversing entry (POST /transactions/:id/reverse, dated today); an invoice's or payment's entry is refused with a
 * pointer to its document, and nothing is sent. Before: PUT { partialUpdate: { status: 'failed', deletedAt } }.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createEntryActions } from '../hooks/transactionActions/entryActions';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { makeTransaction } from './fixtures';
import { getSupabase } from '../lib/db/client';
import { getLocalDateISO } from '../lib/utils';

const realFetch = globalThis.fetch;
afterEach(async () => { globalThis.fetch = realFetch; await getSupabase().auth.dispose(); });

const actions = () => createEntryActions({
  user: { uid: 'u1', getIdToken: async () => 't' }, currentWorkspaceId: 'A', accounts: [],
  setTransactions: useLedgerStore.getState().setTransactions, setIsSyncing: () => {}, recordAudit: async () => {}, isPeriodLocked: () => false,
} as never, { recordRulePattern: async () => {}, balanceTransactionLines: (l: unknown) => l } as never, { handleAddRule: async () => {} } as never);

function capture(reply: object = { reversal: { id: 'rev1', workspaceId: 'A', type: 'reversal' } }) {
  const sent: Array<{ url: string; method?: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), method: init?.method, body: JSON.parse(String(init?.body || '{}')) });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  return sent;
}

test('#662: a hand journal is reversed by a reversing entry dated today, not un-posted', async () => {
  useAuthStore.setState({ currentWorkspaceId: 'A' });
  useLedgerStore.setState({ transactions: [makeTransaction({ id: 'j1', workspaceId: 'A', metadata: {} })] });
  const sent = capture();
  await actions().handleVoidTransaction('j1');
  assert.deepEqual(sent.map(s => [s.method, s.url]), [['POST', '/api/v1/transactions/j1/reverse']]);
  assert.equal(sent[0].body.reversalDate, getLocalDateISO());
  assert.equal(sent.some(s => 'partialUpdate' in s.body), false, 'no in-place status change');
  const list = useLedgerStore.getState().transactions;
  assert.deepEqual(list.map(t => t.id).sort(), ['j1', 'rev1'], 'the reversal is added; the original stays');
  assert.equal(list.find(t => t.id === 'j1')?.reversalEventId, 'rev1');
});

test("#662: an invoice's or a payment's entry is refused and nothing is sent", async () => {
  useAuthStore.setState({ currentWorkspaceId: 'A' });
  useLedgerStore.setState({ transactions: [
    makeTransaction({ id: 'inv', workspaceId: 'A', metadata: { invoiceId: 'INV-9' } }),
    makeTransaction({ id: 'pay', workspaceId: 'A', metadata: { paymentId: 'PMT-1' } }),
  ] });
  const sent = capture();
  await actions().handleVoidTransaction('inv');
  await actions().handleVoidTransaction('pay');
  assert.deepEqual(sent, []);
  assert.deepEqual(useLedgerStore.getState().transactions.map(t => [t.id, t.reversalEventId]), [['inv', undefined], ['pay', undefined]]);
});
