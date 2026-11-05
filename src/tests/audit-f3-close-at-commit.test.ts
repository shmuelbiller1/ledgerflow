/**
 * Audit F3 (independent readiness audit, 5 Nov 2026), as safety tests against migrated Postgres: a journal entry
 * prepared before the month is hard-closed must not be written after the close. The real create, full-update and
 * delete handlers of /api/v1/transactions are called (their middleware has already passed), and another user
 * closes 2026-11 (lockDate 2026-11-30) between the preparation and the save's own transaction. Each save is refused
 * and the ledger is left as it was. With no close in between, the same create goes through.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { getDb } from '../server/db/firestore';
import { registerTransactionCrudRoutes } from '../server/routes/transactions/crudRoutes';

const url = process.env.LF_TEST_DATABASE_URL;
type Handler = (req: unknown, res: unknown) => Promise<unknown>;

function handlerFor(method: 'post' | 'put' | 'delete', path: string): Handler {
  const router = express.Router();
  registerTransactionCrudRoutes(router);
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> } }> })
    .stack.find(l => l.route?.path === path && l.route?.methods?.[method]);
  return layer!.route!.stack.at(-1)!.handle;
}

function response() {
  const out = { status: 200, body: undefined as unknown };
  const res = { status(n: number) { out.status = n; return res; }, json(b: unknown) { out.body = b; return res; }, setHeader() { return res; }, set() { return res; }, header() { return undefined; } };
  return { out, res };
}

describe('audit F3: a close between preparation and the save', { skip: !url }, () => {
  async function isolated(run: (ws: string, accounts: string[]) => Promise<void>) {
    process.env.DATABASE_URL = url;
    const db = getDb();
    const ws = `auditf3_${crypto.randomUUID()}`;
    const original = db.runTransaction.bind(db);
    try {
      await db.collection('workspaces').doc(ws).set({ uid: 'owner', members: ['owner'], roles: {}, currency: 'USD' });
      await db.collection('chartAccounts').doc(`${ws}_cash`).set({ workspaceId: ws, name: 'Cash', type: 'asset', category: 'Cash' });
      await db.collection('chartAccounts').doc(`${ws}_ar`).set({ workspaceId: ws, name: 'Accounts Receivable', type: 'asset', category: 'Receivables' });
      await run(ws, [`${ws}_cash`, `${ws}_ar`]);
    } finally {
      db.runTransaction = original;
      for (const table of await db.tables()) await db.pool.query(`delete from public."${table.replaceAll('"', '""')}" where data->>'workspaceId' = $1`, [ws]);
      await db.collection('workspaces').doc(ws).delete();
    }
  }
  const closeBeforeTheSave = (ws: string) => {
    const db = getDb();
    const original = db.runTransaction.bind(db);
    db.runTransaction = (async (fn: never, options: never) => {
      await db.collection('workspaces').doc(ws).update({ lockDate: '2026-11-30' });
      return original(fn, options);
    }) as typeof db.runTransaction;
  };
  const entry = (ws: string, accounts: string[], extra: Record<string, unknown> = {}) => ({ workspaceId: ws, date: '2026-11-01', status: 'completed', currency: 'USD',
    lines: [{ accountId: accounts[0], amountCents: 100 }, { accountId: accounts[1], amountCents: -100 }], ...extra });
  const count = async (ws: string) => (await getDb().collection('transactions').where('workspaceId', '==', ws).get()).size;
  const req = (body: unknown, extra: Record<string, unknown> = {}) => ({ body, headers: {}, header: () => undefined, params: {}, query: {}, user: { uid: 'owner' }, ...extra });

  test('with no close in between, the create goes through', async () => {
    await isolated(async (ws, accounts) => {
      const { out, res } = response();
      await handlerFor('post', '/')(req({ transaction: entry(ws, accounts) }), res);
      assert.equal(out.status, 200, JSON.stringify(out.body));
      assert.equal(await count(ws), 1);
    });
  });

  test('create: refused with 400 when the month is closed before the save; nothing written', async () => {
    await isolated(async (ws, accounts) => {
      closeBeforeTheSave(ws);
      const { out, res } = response();
      await handlerFor('post', '/')(req({ transaction: entry(ws, accounts) }), res);
      assert.equal(out.status, 400, JSON.stringify(out.body));
      assert.equal(await count(ws), 0);
    });
  });

  test('full update: refused when the month is closed before the save; the entry is unchanged', async () => {
    await isolated(async (ws, accounts) => {
      const id = `${ws}_e`;
      await getDb().collection('transactions').doc(id).set({ ...entry(ws, accounts), id, uid: 'owner', totalAmountCents: 100 });
      closeBeforeTheSave(ws);
      const { out, res } = response();
      await handlerFor('put', '/:id')(req({ transaction: entry(ws, accounts, { id, description: 'changed' }) }, { params: { id } }), res);
      assert.equal(out.status, 400, JSON.stringify(out.body));
      assert.equal((await getDb().collection('transactions').doc(id).get()).data()?.description, undefined);
    });
  });

  test('delete: refused when the month is closed before the delete; the entry stays', async () => {
    await isolated(async (ws, accounts) => {
      const id = `${ws}_e`;
      await getDb().collection('transactions').doc(id).set({ ...entry(ws, accounts), id, uid: 'owner', totalAmountCents: 100 });
      closeBeforeTheSave(ws);
      const { out, res } = response();
      await handlerFor('delete', '/:id')(req({}, { params: { id }, query: { workspaceId: ws } }), res);
      assert.equal(out.status, 400, JSON.stringify(out.body));
      assert.equal(await count(ws), 1);
    });
  });
});
