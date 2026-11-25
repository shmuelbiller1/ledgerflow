/**
 * AUP-34: a revaluation whose scheduled next-day reversal has already taken effect is fully reversed.
 * Undoing it must be refused, and earlier as-of balances must not change (the audit's probe,
 * audit/fx-preview-http.test.ts, recorded the opposite: +18000 cents on 15 November after an undo).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { callApi, startOwnerApp } from './helpers/liveApiServer';

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('AUP-34: undoing a revaluation after its reversal took effect', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const ws = `ws_aup34_${randomUUID()}`;
  let app!: Awaited<ReturnType<typeof startOwnerApp>>;
  let db: typeof app.db, base = '', token = '';
  before(async () => {
    app = await startOwnerApp('aup34-fx-undo', ws);
    ({ db, base, token } = app);
    for (const [key, name, type, category] of [['ar', 'Accounts Receivable', 'asset', 'Receivables'], ['ap', 'Accounts Payable', 'liability', 'Payables'], ['fx', 'Unrealized FX Gain/Loss', 'income', 'Revenue']]) {
      await db.collection('chartAccounts').doc(`${ws}_${key}`).set({ workspaceId: ws, name, type, category });
    }
    await db.collection('invoices').doc(`${ws}_inv`).set({ workspaceId: ws, customerName: 'Acme', number: 'inv', status: 'sent', currency: 'EUR', exchangeRate: 1.08, amountCents: 100000, amountPaidCents: 0, date: '2026-01-01', dueDate: '2026-12-01' });
  });
  after(async () => {
    if (db) for (const table of ['transactions', 'invoices', 'chartAccounts', 'auditLogs', 'idempotencyKeys']) await db.pool.query(`delete from public."${table}" where workspace_id = $1`, [ws]);
    await app?.stop();
  });

  it('refuses the undo, keeps the reversal, and leaves the earlier as-of balance alone', async () => {
    const path = '/api/v1/transactions/revaluation';
    const date = '2026-10-31';
    const run = await callApi(base, 'POST', `${path}/run`, { token, body: { workspaceId: ws, date, rates: { EUR: 1.2 } } });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    const { reversalTransactionId } = run.json as { reversalTransactionId: string };
    const balancePath = `/api/v1/balances?workspaceId=${ws}&asOf=2026-11-15`;
    const before = (await callApi(base, 'GET', balancePath, { token })).json as { accounts: Record<string, number> };
    assert.equal(before.accounts[`${ws}_ar`] || 0, 0, 'the 1 November reversal has already cancelled the revaluation');

    const undo = await callApi(base, 'POST', `${path}/undo`, { token, body: { workspaceId: ws, date } });
    assert.equal(undo.status, 409, JSON.stringify(undo.json));
    assert.match(JSON.stringify(undo.json), /already reversed itself on 2026-11-01/);

    assert.equal((await db.collection('transactions').doc(reversalTransactionId).get()).data()?.status, 'completed', 'the reversal stays in the books');
    const after = (await callApi(base, 'GET', balancePath, { token })).json as { accounts: Record<string, number> };
    assert.deepEqual(after.accounts, before.accounts, 'no earlier as-of balance changes');
    const undone = (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.filter(d => String(d.data().metadata?.type) === 'fx-revaluation-reversal');
    assert.equal(undone.length, 1, 'no mirror entry was posted');
  });
});
