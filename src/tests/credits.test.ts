/**
 * Credit notes / vendor credits after issue (src/server/services/creditService.ts via
 * POST /api/v1/payments/credits/apply|refund), and the rule that an invoice's own posting
 * never records cash that a payment record or a credit already settled.
 * The database part runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { cashPostedWithDocumentCents } from '../lib/documentMath';
import { setCredit } from './helpers/creditFixtures';
import type { Firestore } from '../server/db/pgFirestore';

describe('Cash posted with an invoice', () => {
  test('"mark as paid" with no recorded amount counts as paid in full', () => {
    assert.equal(cashPostedWithDocumentCents({ status: 'paid', amountCents: 5000 }), 5000);
  });
  test('amounts settled by payment records or credits are not posted again', () => {
    assert.equal(cashPostedWithDocumentCents({ status: 'paid', amountCents: 5000, amountPaidCents: 5000, settledByRecordsCents: 5000 }), 0);
    assert.equal(cashPostedWithDocumentCents({ status: 'partially_paid', amountCents: 5000, amountPaidCents: 3000, settledByRecordsCents: 1000 }), 2000);
  });
  test('unpaid documents post no cash', () => {
    assert.equal(cashPostedWithDocumentCents({ status: 'sent', amountCents: 5000, amountPaidCents: 5000 }), 0);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('Credits: apply and refund', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const suffix = crypto.randomBytes(4).toString('hex');
  const ws = `ws_credit_${suffix}`;
  const id = (name: string) => `${ws}_${name}`;
  let server: Server;
  let base = '';
  let db: Firestore;

  const call = async (uid: string, action: 'apply' | 'refund', body: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/v1/payments/credits/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': uid },
      body: JSON.stringify({ workspaceId: ws, ...body }),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const get = async (coll: string, name: string) => (await db.collection(coll).doc(id(name)).get()).data() || {};

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { paymentRouter } = await import('../server/routes/paymentRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Credits', currency: 'USD', members: ['owner-1', 'view-1'], roles: { 'view-1': 'viewer' } });
    const account = (name: string, data: Record<string, unknown>) => db.collection('chartAccounts').doc(id(name)).set({ workspaceId: ws, ...data });
    await account('cash', { name: 'Checking', type: 'asset', category: 'Cash', code: '1000' });
    await account('ar', { name: 'Accounts Receivable', type: 'asset', category: 'Receivables', code: '1100' });
    await account('ap', { name: 'Accounts Payable', type: 'liability', category: 'Payables', code: '2000' });
    await setCredit(db, 'creditNotes', id('cn'), { workspaceId: ws, customerId: 'c1', customerName: 'Acme', number: 'CN-1', amountCents: 10000, remainingCents: 10000, date: '2026-05-01', status: 'open', currency: 'USD' });
    await setCredit(db, 'vendorCredits', id('vc'), { workspaceId: ws, vendorId: 'v1', vendorName: 'Supply', number: 'VC-1', amountCents: 4000, remainingCents: 4000, date: '2026-05-01', status: 'open', currency: 'USD' });
    await db.collection('invoices').doc(id('inv')).set({ workspaceId: ws, customerId: 'c1', number: 'INV-1', amountCents: 6000, amountPaidCents: 0, status: 'sent', dueDate: '2026-06-01', currency: 'USD' });
    await db.collection('invoices').doc(id('other')).set({ workspaceId: ws, customerId: 'c2', number: 'INV-2', amountCents: 6000, status: 'sent', dueDate: '2026-06-01', currency: 'USD' });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/payments', paymentRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'creditNotes', 'vendorCredits', 'invoices', 'chartAccounts', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  });

  test('a viewer cannot use credits', async () => {
    assert.equal((await call('view-1', 'apply', { kind: 'customer', creditId: id('cn'), documentId: id('inv'), amountCents: 100 })).status, 403);
  });

  test('applying settles the invoice and lowers the credit, with no ledger entry', async () => {
    const res = await call('owner-1', 'apply', { kind: 'customer', creditId: id('cn'), documentId: id('inv'), amountCents: 6000 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const inv = await get('invoices', 'inv');
    assert.equal(inv.amountPaidCents, 6000);
    assert.equal(inv.settledByRecordsCents, 6000);
    assert.equal(inv.status, 'paid');
    const cn = await get('creditNotes', 'cn');
    assert.equal(cn.remainingCents, 4000);
    assert.equal(cn.status, 'partially_applied');
    const posted = (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.filter(d => !String(d.id).endsWith('_posting'));
    assert.equal(posted.length, 0, 'no entry besides the credits\' own postings');
    // Re-posting the invoice later must not record this as cash
    assert.equal(cashPostedWithDocumentCents(inv), 0);
  });

  test('#646: a credit with no entry in the books, or larger than its entry, is neither applied nor refunded', async () => {
    // written straight into the database (as a browser could), never issued: no entry
    await db.collection('creditNotes').doc(id('forged')).set({ workspaceId: ws, customerId: 'c1', customerName: 'Acme', number: 'CN-X', amountCents: 900000, remainingCents: 900000, date: '2026-05-01', status: 'open', currency: 'USD' });
    const applied = await call('owner-1', 'apply', { kind: 'customer', creditId: id('forged'), documentId: id('other'), amountCents: 100 });
    assert.equal(applied.status, 409, JSON.stringify(applied.body));
    assert.match(String(applied.body.error || applied.body.message), /no entry in the books/);
    const refunded = await call('owner-1', 'refund', { kind: 'customer', creditId: id('forged'), amountCents: 30000, cashAccountId: id('cash'), date: '2026-05-02' });
    assert.equal(refunded.status, 409, JSON.stringify(refunded.body));
    assert.equal((await get('creditNotes', 'forged')).remainingCents, 900000, 'untouched');
    // a posted 40.00 credit whose amount was raised to 4,000.00 afterwards
    await setCredit(db, 'creditNotes', id('raised'), { workspaceId: ws, customerId: 'c1', number: 'CN-R', amountCents: 4000, remainingCents: 4000, date: '2026-05-01', status: 'open', currency: 'USD' });
    await db.collection('creditNotes').doc(id('raised')).update({ amountCents: 400000, remainingCents: 400000 });
    const raised = await call('owner-1', 'refund', { kind: 'customer', creditId: id('raised'), amountCents: 300000, cashAccountId: id('cash'), date: '2026-05-02' });
    assert.equal(raised.status, 409, JSON.stringify(raised.body));
    assert.match(String(raised.body.error || raised.body.message), /larger than its entry/);
  });

  test('#646 review: only a postable issuance entry counts, and a stock-return entry does not add to it', async () => {
    // a draft issuance is not in the books
    await db.collection('creditNotes').doc(id('draftbacked')).set({ workspaceId: ws, customerId: 'c1', number: 'CN-D', amountCents: 5000, remainingCents: 5000, date: '2026-05-01', status: 'open', currency: 'USD' });
    await db.collection('transactions').doc(id('draftbacked_posting')).set({ id: id('draftbacked_posting'), workspaceId: ws, uid: 'owner-1', date: '2026-05-01', description: 'Draft', status: 'draft', type: 'actual',
      currency: 'USD', exchangeRate: 1, totalAmountCents: 5000, lines: [{ accountId: id('cash'), amountCents: 5000 }, { accountId: id('cash'), amountCents: -5000 }], metadata: { creditNoteId: id('draftbacked'), type: 'credit-note-issuance' } });
    const draft = await call('owner-1', 'refund', { kind: 'customer', creditId: id('draftbacked'), amountCents: 100, cashAccountId: id('cash'), date: '2026-05-02' });
    assert.equal(draft.status, 409, 'a draft issuance has no accounting effect');
    // a stock entry tagged with the credit's id does not count toward its amount
    await setCredit(db, 'creditNotes', id('withstock'), { workspaceId: ws, customerId: 'c1', number: 'CN-S', amountCents: 10000, remainingCents: 10000, date: '2026-05-01', status: 'open', currency: 'USD' });
    await db.collection('transactions').doc(id('withstock_cogs')).set({ id: id('withstock_cogs'), workspaceId: ws, uid: 'owner-1', date: '2026-05-01', description: 'Returned goods', status: 'completed', type: 'actual',
      currency: 'USD', exchangeRate: 1, totalAmountCents: 5000, lines: [{ accountId: id('cash'), amountCents: 5000 }, { accountId: id('cash'), amountCents: -5000 }], metadata: { creditNoteId: id('withstock'), type: 'sales-return-stock' } });
    await db.collection('creditNotes').doc(id('withstock')).update({ amountCents: 15000, remainingCents: 15000 });
    const raised = await call('owner-1', 'refund', { kind: 'customer', creditId: id('withstock'), amountCents: 15000, cashAccountId: id('cash'), date: '2026-05-02' });
    assert.equal(raised.status, 409, 'the stock entry does not make the raised credit look posted');
  });

  test('refused: another customer, more than is left, a paid invoice', async () => {
    assert.equal((await call('owner-1', 'apply', { kind: 'customer', creditId: id('cn'), documentId: id('other'), amountCents: 100 })).status, 400);
    assert.equal((await call('owner-1', 'apply', { kind: 'customer', creditId: id('cn'), documentId: id('inv'), amountCents: 100 })).status, 409);
    assert.equal((await call('owner-1', 'refund', { kind: 'customer', creditId: id('cn'), amountCents: 4001, cashAccountId: id('cash'), date: '2026-05-02' })).status, 400);
  });

  test('customer refund: DR receivables, CR cash, credit used up', async () => {
    const res = await call('owner-1', 'refund', { kind: 'customer', creditId: id('cn'), amountCents: 4000, cashAccountId: id('cash'), date: '2026-05-02' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const tx = (await db.collection('transactions').doc(String((res.body.data as Record<string, unknown>).transactionId)).get()).data();
    assert.deepEqual(tx?.lines.map((l: { accountId: string; amountCents: number }) => [l.accountId, l.amountCents]), [[id('ar'), 4000], [id('cash'), -4000]]);
    assert.equal(tx?.metadata.refundOfCreditId, id('cn'));
    const cn = await get('creditNotes', 'cn');
    assert.equal(cn.remainingCents, 0);
    assert.equal(cn.status, 'applied');
    assert.equal(cn.refundedCents, 4000); // statements and balance summaries count the credit less this (L-160)
    assert.equal((await call('owner-1', 'refund', { kind: 'customer', creditId: id('cn'), amountCents: 1, cashAccountId: id('cash'), date: '2026-05-02' })).status, 409);
  });

  test('vendor refund: DR cash, CR payables; the cash account must be a bank/cash account', async () => {
    assert.equal((await call('owner-1', 'refund', { kind: 'vendor', creditId: id('vc'), amountCents: 1000, cashAccountId: id('ar'), date: '2026-05-02' })).status, 400);
    const res = await call('owner-1', 'refund', { kind: 'vendor', creditId: id('vc'), amountCents: 1500, cashAccountId: id('cash'), date: '2026-05-03' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const tx = (await db.collection('transactions').doc(String((res.body.data as Record<string, unknown>).transactionId)).get()).data();
    assert.deepEqual(tx?.lines.map((l: { accountId: string; amountCents: number }) => [l.accountId, l.amountCents]), [[id('cash'), 1500], [id('ap'), -1500]]);
    assert.equal((await get('vendorCredits', 'vc')).remainingCents, 2500);
  });
});
