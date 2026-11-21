/**
 * G-19 (#893) through a real save: a bill over the limit, saved by the documents route into a
 * disposable database, is decided only by another owner or accountant; the stored record names them.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Server } from 'node:http';
import { startDocumentRoutes } from './helpers/documentRouteServer';

const url = process.env.LF_TEST_DATABASE_URL;

describe('G-19: bill approval through the documents route', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_g19_${crypto.randomBytes(4).toString('hex')}`;
  const OWNER = 'owner-g19';
  const ACC = 'acc-g19';
  const BOOK = 'book-g19';
  let db: import('../server/db/pgFirestore').Firestore;
  let server: Server;
  let send: Awaited<ReturnType<typeof startDocumentRoutes>>['post'];
  const accounts = [
    { id: `${ws}_bank`, name: 'Bank', type: 'asset', category: 'Cash', code: '1000' },
    { id: `${ws}_ap`, name: 'Accounts Payable', type: 'liability', category: 'Payables', code: '2000' },
    { id: `${ws}_vatin`, name: 'VAT Receivable', type: 'asset', category: 'Tax', code: '1300' },
    { id: `${ws}_supplies`, name: 'Office Supplies', type: 'expense', code: '6000' },
  ].map(a => ({ ...a, workspaceId: ws }));
  const bill = (id: string, amountCents: number, status: string) => ({
    id, workspaceId: ws, number: `B-${id.slice(-2)}`, vendorName: 'Paper Co', vendorId: 'v1', date: '2026-10-21', dueDate: '2026-11-20', status, currency: 'USD',
    amountCents, items: [{ id: 'b1', description: 'Paper', quantity: 1, rateCents: amountCents, amountCents, accountId: `${ws}_supplies` }],
  });
  const post = (uid: string, id: string, action: 'create' | 'update', data: Record<string, unknown>) => send(uid, 'bills', id, { workspaceId: ws, action, data });
  const stored = async (id: string) => (await db.collection('bills').doc(id).get()).data() as { status: string; metadata?: { approval?: Record<string, unknown> } };

  before(async () => {
    process.env.DATABASE_URL = url;
    db = (await import('../server/db/firestore')).getDb() as unknown as typeof db;
    await db.collection('workspaces').doc(ws).set({
      id: ws, uid: OWNER, name: 'G-19', currency: 'USD', timezone: 'UTC', members: [OWNER, ACC, BOOK],
      roles: { [OWNER]: 'owner', [ACC]: 'accountant', [BOOK]: 'bookkeeper' },
      defaultAccountMappings: { ap: `${ws}_ap` },
    });
    for (const a of accounts) await db.collection('chartAccounts').doc(a.id).set(a);
    ({ server, post: send } = await startDocumentRoutes());
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'bills', 'chartAccounts', 'idempotencyKeys', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
    await db.terminate();
  });

  test('held by a bookkeeper; the bookkeeper and the enterer are refused; the owner approves', async () => {
    const id = `${ws}_b1`;
    assert.equal((await post(BOOK, id, 'create', bill(id, 600000, 'pending'))).status, 200);
    assert.equal((await stored(id)).metadata?.approval?.requestedBy, BOOK);
    assert.equal((await post(BOOK, id, 'update', bill(id, 600000, 'approved'))).status, 403);
    assert.equal((await stored(id)).status, 'pending');
    const ok = await post(OWNER, id, 'update', bill(id, 600000, 'approved'));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const after = await stored(id);
    assert.equal(after.status, 'approved');
    assert.equal(after.metadata?.approval?.decidedBy, OWNER);
  });

  test('an accountant saving their own bill straight to approved is held; approving it themselves is refused', async () => {
    const id = `${ws}_b2`;
    assert.equal((await post(ACC, id, 'create', bill(id, 600000, 'approved'))).status, 200);
    assert.equal((await stored(id)).status, 'pending');
    assert.equal((await post(ACC, id, 'update', bill(id, 600000, 'approved'))).status, 403);
    assert.equal((await post(OWNER, id, 'update', bill(id, 600000, 'rejected'))).status, 200);
    assert.equal((await stored(id)).metadata?.approval?.state, 'rejected');
    // sent again: the stored record keeps nothing of the rejection (saves deep-merge nested maps)
    assert.equal((await post(ACC, id, 'update', bill(id, 600000, 'pending'))).status, 200);
    const again = (await stored(id)).metadata?.approval;
    assert.equal(again?.state, 'awaiting');
    assert.equal(again?.decidedBy ?? null, null);
  });

  test('a forged approval record in the request is ignored', async () => {
    const id = `${ws}_b3`;
    const forged = { ...bill(id, 600000, 'pending'), metadata: { approval: { state: 'awaiting', requestedBy: OWNER } } };
    assert.equal((await post(ACC, id, 'create', forged)).status, 200);
    assert.equal((await stored(id)).metadata?.approval?.requestedBy, ACC);
  });

  test('USD control below the limit: a bookkeeper saves it approved', async () => {
    const id = `${ws}_b4`;
    const r = await post(BOOK, id, "create", bill(id, 4250, "approved")); assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await stored(id)).status, 'approved');
  });
});
