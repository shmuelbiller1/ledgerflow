/**
 * AUP-34: a revaluation whose scheduled next-day reversal has already taken effect is fully reversed.
 * Undoing it must be refused, and earlier as-of balances must not change (the audit's probe,
 * audit/fx-preview-http.test.ts, recorded the opposite: +18000 cents on 15 November after an undo).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from './helpers/liveApiServer';

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('AUP-34: undoing a revaluation after its reversal took effect', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const owner = randomUUID(), ws = `ws_aup34_${randomUUID()}`;
  let db: Awaited<ReturnType<(typeof import('../server/db/firestore'))['getDb']>>;
  let server: Server | undefined, base = '', token = '', env: Record<string, string | undefined> = {};
  before(async () => {
    env = useLiveApiEnv('aup34-fx-undo');
    const [{ getDb }, { createApp }] = await Promise.all([import('../server/db/firestore'), import('../../server')]); db = getDb();
    await db.pool.query("insert into auth.users (id,email,email_confirmed_at,raw_app_meta_data) values ($1::uuid,$2,now(),'{}'::jsonb)", [owner, `${owner}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ uid: owner, name: 'AUP-34', currency: 'USD', members: [owner], roles: { [owner]: 'owner' } });
    for (const [key, name, type, category] of [['ar', 'Accounts Receivable', 'asset', 'Receivables'], ['ap', 'Accounts Payable', 'liability', 'Payables'], ['fx', 'Unrealized FX Gain/Loss', 'income', 'Revenue']]) {
      await db.collection('chartAccounts').doc(`${ws}_${key}`).set({ workspaceId: ws, name, type, category });
    }
    await db.collection('invoices').doc(`${ws}_inv`).set({ workspaceId: ws, customerName: 'Acme', number: 'inv', status: 'sent', currency: 'EUR', exchangeRate: 1.08, amountCents: 100000, amountPaidCents: 0, date: '2026-01-01', dueDate: '2026-12-01' });
    token = await signTestJwt({ uid: owner, email: `${owner}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } });
    ({ server, base } = await listenOnRandomPort(await createApp()));
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      for (const table of ['transactions', 'invoices', 'chartAccounts', 'auditLogs', 'idempotencyKeys']) await db.pool.query(`delete from public."${table}" where workspace_id = $1`, [ws]);
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = $1', [owner]);
      await db.pool.query('delete from auth.users where id = $1::uuid', [owner]);
    }
    restoreEnv(env);
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
