/**
 * G-19 (#893) on the payment side, against a disposable database: a bill over the approval limit that is
 * still held cannot be paid, either by a payment made against it or by applying an unapplied payment later.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { BILL_PAID_BEFORE_APPROVAL } from '../server/services/billApprovalGuard';

describe('G-19: paying a held bill', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_g19p_${crypto.randomBytes(4).toString('hex')}`;
  const id = (s: string) => `${ws}_${s}`;
  let db: import('../server/db/pgFirestore').Firestore;
  let svc: typeof import('../server/services/paymentService');

  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    svc = await import('../server/services/paymentService');
    db = (await import('../server/db/firestore')).getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'G19P', currency: 'USD', members: ['owner-1'] });
    const account = (key: string, name: string, type: string, category = '') => db.collection('chartAccounts').doc(id(key)).set({ workspaceId: ws, uid: 'owner-1', name, type, category });
    await account('bank', 'Bank', 'asset', 'Cash');
    await account('ap', 'Accounts Payable', 'liability', 'Payables');
    const bill = (key: string, status: string) => db.collection('bills').doc(id(key)).set({
      workspaceId: ws, uid: 'owner-1', vendorId: 'v1', vendorName: 'Supplier', number: key, date: '2026-10-01', status, amountCents: 600000, amountPaidCents: 0, apAccountId: id('ap'),
    });
    await bill('HELD', 'pending');
    await bill('OK', 'approved');
  });
  after(async () => {
    for (const table of ['paymentAllocations', 'allocationOperations', 'idempotencyKeys', 'transactions', 'payments', 'bills', 'chartAccounts', 'auditLogs', 'numberingSeries', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => undefined);
    }
    await db.terminate();
  });

  const pay = (allocations: Array<{ documentId: string; documentType: 'bill'; amountCents: number }>, amountCents: number) => svc.createPaymentAtomic(db, {
    workspaceId: ws, uid: 'owner-1', paymentDate: '2026-10-10', amountCents, cashAccountId: id('bank'), vendorId: 'v1', entityName: 'Supplier', allocations,
  });

  test('a payment made against a held $6,000 bill is refused; the approved one is paid', async () => {
    await assert.rejects(pay([{ documentId: id('HELD'), documentType: 'bill', amountCents: 600000 }], 600000), { message: BILL_PAID_BEFORE_APPROVAL });
    assert.equal((await db.collection('bills').doc(id('HELD')).get()).data()?.amountPaidCents, 0);
    await pay([{ documentId: id('OK'), documentType: 'bill', amountCents: 100000 }], 100000);
    assert.equal((await db.collection('bills').doc(id('OK')).get()).data()?.amountPaidCents, 100000);
  });

  test('an unapplied payment applied later to the held bill is refused with 409', async () => {
    const advance = await pay([], 200000);
    await assert.rejects(svc.applyUnappliedPayment(db, {
      workspaceId: ws, uid: 'owner-1', paymentId: advance.paymentId, date: '2026-10-11', allocations: [{ documentId: id('HELD'), documentType: 'bill', amountCents: 100000 }],
    }), (err: Error & { status?: number }) => err.status === 409 && err.message === BILL_PAID_BEFORE_APPROVAL);
    assert.equal((await db.collection('bills').doc(id('HELD')).get()).data()?.amountPaidCents, 0);
  });
});
