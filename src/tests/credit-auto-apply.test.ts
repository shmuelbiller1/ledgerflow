/**
 * Applying open credits automatically (BE-06): oldest credit first, to the customer's (vendor's)
 * open invoices (bills) in the same currency, the one due first first; drafts, voided and paid
 * documents get nothing; one database transaction; a second run finds nothing left.
 * The database part runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { planCreditApplications } from '../server/services/creditService';
import { setCredit } from './helpers/creditFixtures';
import type { Firestore } from '../server/db/pgFirestore';

test('oldest credit first, to the invoice due first; other customers, currencies, drafts and paid ones untouched', () => {
  const credits = [
    { id: 'new', customerId: 'c1', status: 'open', amountCents: 5000, remainingCents: 5000, date: '2026-04-01', currency: 'USD' },
    { id: 'old', customerId: 'c1', status: 'partially_applied', amountCents: 9000, remainingCents: 3000, date: '2026-01-01', currency: 'USD' },
    { id: 'used', customerId: 'c1', status: 'applied', amountCents: 100, remainingCents: 0, date: '2026-01-01' },
  ];
  const invoices = [
    { id: 'A', customerId: 'c1', status: 'sent', amountCents: 4000, dueDate: '2026-06-01', currency: 'USD' },
    { id: 'B', customerId: 'c1', status: 'partially_paid', amountCents: 5000, amountPaidCents: 3000, dueDate: '2026-05-15', currency: 'USD' },
    { id: 'draft', customerId: 'c1', status: 'draft', amountCents: 999, dueDate: '2026-01-01', currency: 'USD' },
    { id: 'paid', customerId: 'c1', status: 'paid', amountCents: 999, amountPaidCents: 999, dueDate: '2026-01-01', currency: 'USD' },
    { id: 'eur', customerId: 'c1', status: 'sent', amountCents: 999, dueDate: '2026-01-01', currency: 'EUR' },
    { id: 'theirs', customerId: 'c2', status: 'sent', amountCents: 999, dueDate: '2026-01-01', currency: 'USD' },
  ];
  assert.deepEqual(planCreditApplications('customer', credits, invoices), [
    { creditId: 'old', documentId: 'B', amountCents: 2000 },
    { creditId: 'old', documentId: 'A', amountCents: 1000 },
    { creditId: 'new', documentId: 'A', amountCents: 3000 },
  ]);
  assert.deepEqual(planCreditApplications('vendor', [{ id: 'vc', vendorId: 'v1', status: 'open', amountCents: 500, date: '2026-01-01' }],
    [{ id: 'bill', vendorId: 'v1', status: 'open', amountCents: 300, dueDate: '2026-02-01' }]), [{ creditId: 'vc', documentId: 'bill', amountCents: 300 }]);
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('Auto-apply credits (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_autocredit_${crypto.randomBytes(4).toString('hex')}`;
  const id = (name: string) => `${ws}_${name}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  const run = async (uid: string, body: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/v1/payments/credits/auto-apply`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify({ workspaceId: ws, ...body }),
    });
    return { status: res.status, body: await res.json() as { data?: { applications: unknown[]; totalCents: number } } };
  };
  const get = async (coll: string, name: string) => (await db.collection(coll).doc(id(name)).get()).data() || {};

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { paymentRouter } = await import('../server/routes/paymentRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Auto credits', currency: 'USD', members: ['owner-1', 'view-1'], roles: { 'view-1': 'viewer' } });
    await setCredit(db, 'creditNotes', id('cn'), { workspaceId: ws, customerId: 'c1', number: 'CN-1', amountCents: 7000, remainingCents: 7000, date: '2026-05-01', status: 'open', currency: 'USD' });
    await setCredit(db, 'creditNotes', id('cn2'), { workspaceId: ws, customerId: 'c2', number: 'CN-2', amountCents: 500, remainingCents: 500, date: '2026-05-01', status: 'open', currency: 'USD' });
    await db.collection('invoices').doc(id('i1')).set({ workspaceId: ws, customerId: 'c1', number: 'INV-1', amountCents: 4000, status: 'sent', dueDate: '2026-06-01', currency: 'USD' });
    await db.collection('invoices').doc(id('i2')).set({ workspaceId: ws, customerId: 'c1', number: 'INV-2', amountCents: 5000, status: 'sent', dueDate: '2026-07-01', currency: 'USD' });
    await db.collection('invoices').doc(id('i3')).set({ workspaceId: ws, customerId: 'c2', number: 'INV-3', amountCents: 800, status: 'sent', dueDate: '2026-07-01', currency: 'USD' });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/payments', paymentRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['creditNotes', 'invoices', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  });

  test('a viewer cannot; one customer only when asked; then nothing is left to apply', async () => {
    assert.equal((await run('view-1', { kind: 'customer' })).status, 403);
    const res = await run('owner-1', { kind: 'customer', partyId: 'c1' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data?.totalCents, 7000);
    const i1 = await get('invoices', 'i1');
    const i2 = await get('invoices', 'i2');
    assert.deepEqual([i1.amountPaidCents, i1.settledByRecordsCents, i1.status], [4000, 4000, 'paid']);
    assert.deepEqual([i2.amountPaidCents, i2.status], [3000, 'partially_paid']);
    const cn = await get('creditNotes', 'cn');
    assert.deepEqual([cn.remainingCents, cn.status], [0, 'applied']);
    assert.equal((await get('invoices', 'i3')).amountPaidCents, undefined, 'another customer is untouched');
    const audit = await db.collection('auditLogs').where('workspaceId', '==', ws).get();
    assert.ok(audit.docs.some(d => d.data().action === 'CREDITS_AUTO_APPLIED'));

    const all = await run('owner-1', { kind: 'customer' });
    assert.equal(all.body.data?.totalCents, 500, 'only CN-2 was left, for its own customer');
    assert.equal((await get('invoices', 'i3')).amountPaidCents, 500);
    const again = await run('owner-1', { kind: 'customer' });
    assert.deepEqual(again.body.data, { applications: [], totalCents: 0, fxTransactionIds: [] });
  });
});
