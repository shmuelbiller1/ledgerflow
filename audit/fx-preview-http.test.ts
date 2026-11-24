/** FX preview local HTTP and worked figures; no rate provider is contacted. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from '../src/tests/helpers/liveApiServer';
const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('FX preview via real application', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const owner = randomUUID(), book = randomUUID(), stranger = randomUUID(), users = [owner, book, stranger], ws = `ws_fx_http_${randomUUID()}`;
  let db: Awaited<ReturnType<(typeof import('../src/server/db/firestore'))['getDb']>>;
  let server: Server | undefined, base = '', tokens: string[] = [], env: Record<string, string | undefined> = {};
  before(async () => {
    env = useLiveApiEnv('fx-preview-http');
    const [{ getDb }, { createApp }] = await Promise.all([import('../src/server/db/firestore'), import('../server')]); db = getDb();
    for (const uid of users) await db.pool.query("insert into auth.users (id,email,email_confirmed_at,raw_app_meta_data) values ($1::uuid,$2,now(),'{}'::jsonb)", [uid, `${uid}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ uid: owner, name: 'FX HTTP', currency: 'USD', members: [owner, book], roles: { [owner]: 'owner', [book]: 'bookkeeper' } });
    for (const [key, name, type, category] of [['ar', 'Accounts Receivable', 'asset', 'Receivables'], ['ap', 'Accounts Payable', 'liability', 'Payables'], ['fx', 'Unrealized FX Gain/Loss', 'income', 'Revenue']]) await db.collection('chartAccounts').doc(`${ws}_${key}`).set({ workspaceId: ws, name, type, category });
    for (const [id, amountPaidCents] of [['full', 0], ['half', 50000]] as const) await db.collection('invoices').doc(`${ws}_${id}`).set({ workspaceId: ws, customerName: 'Acme', number: id, status: 'sent', currency: 'EUR', exchangeRate: 1.08, amountCents: 100000, amountPaidCents, date: '2026-01-01', dueDate: '2026-12-01' });
    await db.collection('bills').doc(`${ws}_bill`).set({ workspaceId: ws, vendorName: 'Globex', number: 'bill', status: 'pending', currency: 'GBP', exchangeRate: 1.1, amountCents: 50000, date: '2026-01-01', dueDate: '2026-12-01' });
    tokens = await Promise.all(users.map(uid => signTestJwt({ uid, email: `${uid}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } })));
    ({ server, base } = await listenOnRandomPort(await createApp()));
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      for (const table of ['transactions', 'invoices', 'bills', 'chartAccounts', 'auditLogs', 'idempotencyKeys']) await db.pool.query(`delete from public."${table}" where workspace_id = $1`, [ws]);
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = any($1::text[])', [users]);
      await db.pool.query('delete from auth.users where id = any($1::uuid[])', [users]);
    }
    restoreEnv(env);
  });
  it('previews balanced receivable, payable and gain/loss movements without writing', async () => {
    const path = '/api/v1/transactions/revaluation/preview';
    const body = { workspaceId: ws, date: '2026-10-31', rates: { EUR: 1.2, GBP: 1.5 } };
    const result = await callApi(base, 'POST', path, { token: tokens[0], body });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    const plan = result.json as { posted: boolean; documentCount: number; lines: Array<{ accountId: string; amountCents: number }> };
    assert.equal(plan.posted, false); assert.equal(plan.documentCount, 3);
    assert.equal(plan.lines.find(line => line.accountId === `${ws}_ar`)?.amountCents, 18000);
    assert.equal(plan.lines.find(line => line.accountId === `${ws}_ap`)?.amountCents, -20000);
    assert.equal(plan.lines.find(line => line.accountId === `${ws}_fx`)?.amountCents, 2000);
    assert.equal(plan.lines.reduce((sum, line) => sum + line.amountCents, 0), 0);
    assert.equal((await db.collection('transactions').where('workspaceId', '==', ws).get()).size, 0);
    assert.equal((await callApi(base, 'POST', path, { token: tokens[1], body })).status, 403);
    assert.equal((await callApi(base, 'POST', path, { token: tokens[2], body })).status, 403);
    assert.equal((await callApi(base, 'POST', path, { body })).status, 401);
  });
  it('OBSERVATION: undo after a past reversal changes an earlier as-of balance', async () => {
    const body = { workspaceId: ws, date: '2026-10-31', rates: { EUR: 1.2, GBP: 1.5 } };
    const path = '/api/v1/transactions/revaluation';
    const run = await callApi(base, 'POST', `${path}/run`, { token: tokens[0], body });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    const result = run.json as { posted: boolean; transactionId: string; reversalTransactionId: string };
    assert.ok(result.posted && result.transactionId && result.reversalTransactionId);
    const original = (await db.collection('transactions').doc(result.transactionId).get()).data()!;
    const scheduled = (await db.collection('transactions').doc(result.reversalTransactionId).get()).data()!;
    type Line = { accountId: string; amountCents: number };
    assert.deepEqual((scheduled.lines as Line[]).map(l => [l.accountId, l.amountCents]), (original.lines as Line[]).map(l => [l.accountId, -l.amountCents]));
    assert.equal((await callApi(base, 'POST', `${path}/run`, { token: tokens[0], body })).status, 409);
    assert.equal((await callApi(base, 'POST', `${path}/undo`, { token: tokens[1], body: { workspaceId: ws, date: body.date } })).status, 403);
    const balancePath = `/api/v1/balances?workspaceId=${ws}&asOf=2026-11-15`;
    const beforeUndo = await callApi(base, 'GET', balancePath, { token: tokens[0] });
    assert.equal(beforeUndo.status, 200, JSON.stringify(beforeUndo.json));
    const undo = await callApi(base, 'POST', `${path}/undo`, { token: tokens[0], body: { workspaceId: ws, date: body.date } });
    assert.equal(undo.status, 200, JSON.stringify(undo.json));
    const undoResult = undo.json as { transactionId: string; reversesTxId: string };
    assert.equal(undoResult.reversesTxId, result.transactionId);
    const reversal = (await db.collection('transactions').doc(undoResult.transactionId).get()).data()!;
    assert.deepEqual((reversal.lines as Line[]).map(l => [l.accountId, l.amountCents]), (original.lines as Line[]).map(l => [l.accountId, -l.amountCents]));
    assert.equal((await db.collection('transactions').doc(result.reversalTransactionId).get()).data()?.status, 'void');
    // Observation, not a desired regression: a past as-of balance changes after today's undo.
    const afterUndo = await callApi(base, 'GET', balancePath, { token: tokens[0] });
    assert.equal(afterUndo.status, 200, JSON.stringify(afterUndo.json));
    const beforeAccounts = (beforeUndo.json as { accounts: Record<string, number> }).accounts;
    const afterAccounts = (afterUndo.json as { accounts: Record<string, number> }).accounts;
    assert.equal(beforeAccounts[`${ws}_ar`] || 0, 0);
    assert.equal(afterAccounts[`${ws}_ar`] || 0, 18000);
    assert.equal((await callApi(base, 'POST', `${path}/undo`, { token: tokens[0], body: { workspaceId: ws, date: body.date } })).status, 409);
  });
});
