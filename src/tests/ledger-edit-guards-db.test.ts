/**
 * #652 / #662 at the endpoints, against a real PostgreSQL: the generic entry routes refuse a financial
 * change to a document's own posting (status, a whole-record rewrite), refuse to reverse it, refuse to
 * un-post a posted entry in place — and still save a flag or a note on that same row, and still reverse a
 * hand-entered entry. The unit cases for the guard functions are in `ledger-edit-guards.test.ts`; this one
 * proves the routes call them, which is what the issue reported.
 * #654: a journal at a foreign rate posts and reverses back to exactly zero (books in ILS, a second workspace).
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';

const url = process.env.LF_TEST_DATABASE_URL;

describe('Entry routes vs a document entry (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_guard_${crypto.randomBytes(4).toString('hex')}`;
  const docId = `${ws}_doc`;
  const handId = `${ws}_hand`;
  const reconciledId = `${ws}_reconciled`;
  const twoStepId = `${ws}_two_step`;
  // #654: a second workspace with books in ILS, for journals at a foreign rate
  const fxWs = `${ws}_ils`;
  let db: Firestore;
  let server: Server;
  let base = '';

  const send = (method: string, path: string, body: unknown) => fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  before(async () => {
    process.env.DATABASE_URL = url;
    db = (await import('../server/db/firestore')).getDb();
    await db.collection('workspaces').doc(ws).set({
      uid: 'owner-1', name: 'Guard Co', currency: 'USD', members: ['owner-1'],
      accounts: [{ id: 'a', name: 'Cash', type: 'asset', category: 'Cash' }, { id: 'b', name: 'Sales', type: 'income', category: 'Revenue' }],
    });
    const entry = (id: string, metadata: Record<string, unknown>) => ({
      id, workspaceId: ws, uid: 'owner-1', date: '2026-10-01', description: 'Entry', status: 'completed',
      type: 'actual', totalAmountCents: 500, currency: 'USD', exchangeRate: 1,
      lines: [{ accountId: 'a', amountCents: 500 }, { accountId: 'b', amountCents: -500 }],
      ...(Object.keys(metadata).length ? { metadata } : {}),
    });
    await db.collection('transactions').doc(docId).set(entry(docId, { invoiceId: `${ws}_inv`, type: 'invoice-accrual' }));
    await db.collection('transactions').doc(handId).set(entry(handId, {}));
    await db.collection('transactions').doc(reconciledId).set({ ...entry(reconciledId, {}), status: 'reconciled' });
    await db.collection('transactions').doc(twoStepId).set(entry(twoStepId, {}));
    await db.collection('workspaces').doc(fxWs).set({ uid: 'owner-1', name: 'FX Co', currency: 'ILS', members: ['owner-1'] });
    for (const [id, name, type, category, code] of [['a', 'Bank', 'asset', 'Cash', '1000'], ['b', 'Sales', 'income', 'Revenue', '4000']]) {
      await db.collection('chartAccounts').doc(`${fxWs}_${id}`).set({ id: `${fxWs}_${id}`, workspaceId: fxWs, uid: 'owner-1', name, type, category, code });
    }
    const express = (await import('express')).default;
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: 'owner-1' }; next(); });
    app.use('/api/v1/transactions', transactionRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'auditLogs', 'chartAccounts', 'workspaces']) for (const w of [ws, fxWs]) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [w]);
    await db.terminate();
  });

  const read = async (id: string) => (await db.collection('transactions').doc(id).get()).data() as Record<string, unknown> | undefined;

  test("an invoice's entry cannot be voided, un-posted or rewritten through the entry route", async () => {
    for (const body of [{ partialUpdate: { status: 'void' } }, { partialUpdate: { status: 'failed' } }, { partialUpdate: { metadata: { invoiceId: 'other' } } }]) {
      const res = await send('PUT', `/api/v1/transactions/${docId}`, body);
      assert.equal(res.status, 409, `${JSON.stringify(body)} → ${res.status} ${await res.text()}`);
      assert.match(String(((await read(docId)) as { description: string }).description), /Entry/);
      assert.equal((await read(docId))?.status, 'completed', 'the entry is untouched');
    }
    // a line rewrite and a bare total are refused by the double-entry guard before the document guard:
    // refused either way, and the entry keeps its two lines
    for (const body of [{ partialUpdate: { lines: [] } }, { partialUpdate: { totalAmountCents: 1 } }]) {
      const res = await send('PUT', `/api/v1/transactions/${docId}`, body);
      assert.ok(res.status >= 400, `${JSON.stringify(body)} → ${res.status}`);
    }
    assert.equal(((await read(docId)) as { lines: unknown[] }).lines.length, 2);
    // Send the actual full-update request shape, not a flat payload that the
    // middleware rejects before reaching the document-posting guard.
    const rewrite = await send('PUT', `/api/v1/transactions/${docId}`, {
      transaction: { ...(await read(docId)), id: docId, description: 'Rewritten' },
    });
    assert.equal(rewrite.status, 409, await rewrite.text());
    assert.equal((await read(docId))?.description, 'Entry');
  });

  test('a flag or a note on that same row still saves: the ledger list flags any row', async () => {
    const flagged = await send('PUT', `/api/v1/transactions/${docId}`, { partialUpdate: { isFlagged: true } });
    assert.equal(flagged.status, 200, await flagged.text());
    assert.equal((await read(docId))?.isFlagged, true);
    const noted = await send('PUT', `/api/v1/transactions/${docId}`, { partialUpdate: { notes: 'Ask the customer' } });
    assert.equal(noted.status, 200, await noted.text());
    assert.equal((await read(docId))?.notes, 'Ask the customer');
    const mixed = await send('PUT', `/api/v1/transactions/${docId}`, { partialUpdate: { isFlagged: false, status: 'void' } });
    assert.equal(mixed.status, 409, 'a flag riding along with a status change is a status change');
    assert.equal((await read(docId))?.status, 'completed');
  });

  test("the invoice's entry cannot be reversed; a hand entry still can", async () => {
    const refused = await send('POST', `/api/v1/transactions/${docId}/reverse`, { workspaceId: ws, reason: 'test', reversalDate: '2026-10-02' });
    assert.equal(refused.status, 409, await refused.text());
    assert.equal((await read(docId))?.reversalEventId, undefined, 'nothing was reversed');

    const allowed = await send('POST', `/api/v1/transactions/${handId}/reverse`, { workspaceId: ws, reason: 'typo', reversalDate: '2026-10-02' });
    assert.notEqual(allowed.status, 409, `a hand entry is not held back by this guard: ${await allowed.text()}`);
  });

  test('two-step downgrade to flagged cannot bypass the posted-row guards', async () => {
    const mark = await send('PUT', `/api/v1/transactions/${twoStepId}`, { partialUpdate: { status: 'flagged' } });
    assert.equal(mark.status, 200, await mark.text());
    assert.equal((await read(twoStepId))?.status, 'flagged');
    for (const partialUpdate of [
      { status: 'void' }, { status: 'failed' },
      { deletedAt: '2026-11-13T00:00:00.000Z' },
    ]) {
      const response = await send('PUT', `/api/v1/transactions/${twoStepId}`, { partialUpdate });
      assert.equal(response.status, 409, `${JSON.stringify(partialUpdate)}: ${await response.text()}`);
      assert.equal((await read(twoStepId))?.status, 'flagged', 'the entry must stay report-postable');
      assert.equal((await read(twoStepId))?.deletedAt, undefined);
    }
    const hardDelete = await send('DELETE', `/api/v1/transactions/${twoStepId}`, {});
    // refused either by the period-lock middleware (403: only drafts can be deleted) or by the route (409)
    assert.ok([403, 409].includes(hardDelete.status), `${hardDelete.status}: ${await hardDelete.text()}`);
    assert.equal((await read(twoStepId))?.status, 'flagged', 'DELETE must not bypass the posted-row guard');
  });

  test('a posted hand entry is not un-posted in place either; a memo is fine', async () => {
    for (const partialUpdate of [
      { status: 'failed' }, { status: 'draft' }, { status: 'void' },
      { deletedAt: '2026-11-13T00:00:00.000Z' }, { isDeleted: true },
    ]) {
      const unpost = await send('PUT', `/api/v1/transactions/${handId}`, { partialUpdate });
      assert.equal(unpost.status, 409, `${JSON.stringify(partialUpdate)}: ${await unpost.text()}`);
      assert.equal((await read(handId))?.status, 'completed');
      assert.equal((await read(handId))?.deletedAt, undefined);
    }
    for (const partialUpdate of [{ status: 'failed' }, { status: 'void' }, { deletedAt: '2026-11-13T00:00:00.000Z' }]) {
      const refused = await send('PUT', `/api/v1/transactions/${reconciledId}`, { partialUpdate });
      assert.equal(refused.status, 409, `reconciled ${JSON.stringify(partialUpdate)}: ${await refused.text()}`);
      assert.equal((await read(reconciledId))?.status, 'reconciled');
    }
    assert.equal((await read(handId))?.status, 'completed');
    const memo = await send('PUT', `/api/v1/transactions/${handId}`, { partialUpdate: { memo: 'Team coffee' } });
    assert.equal(memo.status, 200, await memo.text());
    assert.equal((await read(handId))?.memo, 'Team coffee');
  });

  const lines = (r: number, a: number[]) => [{ accountId: `${fxWs}_a`, amountCents: a[0], exchangeRate: r }, { accountId: `${fxWs}_b`, amountCents: a[1], exchangeRate: r }, { accountId: `${fxWs}_b`, amountCents: a[2], exchangeRate: r }];
  const homeOf = (t: Record<string, any> | undefined, account: string) => (t?.lines || []).filter((l: any) => l.accountId === account) // eslint-disable-line @typescript-eslint/no-explicit-any
    .reduce((sum: number, l: any) => sum + (Number.isInteger(l.baseAmountCents) ? l.baseAmountCents : Math.round(l.amountCents * (l.exchangeRate ?? t?.exchangeRate ?? 1))), 0); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const [name, amounts, home] of [['24.70 / 12.35 / 12.35 (one agora to settle)', [2470, -1235, -1235], 9138], ['10.00 / 5.00 / 5.00', [1000, -500, -500], 3700]] as const) {
    test(`a USD journal at 3.7 in ILS books, ${name}: posts at ${home} and reverses back to zero`, async () => {
      const id = `${fxWs}_${amounts[0]}`;
      const created = await send('POST', '/api/v1/transactions', { transaction: { id, workspaceId: fxWs, date: '2026-10-01', description: 'FX journal', status: 'completed', type: 'actual', currency: 'USD', exchangeRate: 3.7, lines: lines(3.7, [...amounts]) } });
      assert.equal(created.status, 200, await created.text());
      const entry = await read(id);
      assert.equal(entry?.totalAmountCents, home, 'the total is the settled home-currency debits');
      assert.equal(homeOf(entry, `${fxWs}_a`) + homeOf(entry, `${fxWs}_b`), 0, 'balanced in ILS');
      const rev = await send('POST', `/api/v1/transactions/${id}/reverse`, { workspaceId: fxWs, reason: 'test', reversalDate: '2026-10-02' });
      const revText = await rev.text();
      assert.equal(rev.status, 200, revText);
      const reversal = await read(String((JSON.parse(revText) as { reversal: { id: string } }).reversal.id));
      for (const account of [`${fxWs}_a`, `${fxWs}_b`]) assert.equal(homeOf(entry, account) + homeOf(reversal, account), 0, `${account} back to 0.00`);
    });
  }
});
