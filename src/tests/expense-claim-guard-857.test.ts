/** #857: a submitted expense claim changes only by an allowed approve/reject, on every server path. */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Firestore } from '../server/db/pgFirestore';
import { BulkRefusal } from '../server/services/ledgerBulkCommit';
import { commitPreparedDocumentPost, prepareDocumentPost } from '../server/services/documentPostService';
import { claimDecision } from '../lib/expenseClaims';

const url = process.env.LF_TEST_DATABASE_URL;

describe('#857 submitted expense claims', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const tag = crypto.randomBytes(4).toString('hex');
  const ws = `ws_857_${tag}`;
  const owner = `u_own_${tag}`, acc = `u_acc_${tag}`, acc2 = `u_acc2_${tag}`, book = `u_book_${tag}`;
  const id = (k: string) => `${ws}_${k}`;
  let db: Firestore;
  const user = (uid: string) => ({ uid, email: `${uid}@test.local` });
  const claimBillDoc = (submittedBy: string) => ({
    workspaceId: ws, vendorId: id('v'), vendorName: 'Dana', number: 'EXP-1', date: '2026-06-10', dueDate: '2026-06-10',
    status: 'draft', currency: 'USD', exchangeRate: 1, amountCents: 12_000,
    items: [{ id: 'l1', description: 'Taxi', quantity: 1, unitPriceCents: 12_000, amountCents: 12_000, accountId: id('exp') }],
    metadata: { expenseClaim: { state: 'submitted', submittedBy, submittedAt: '2026-06-10T00:00:00Z' } },
  });
  const refused = (status: number) => (e: unknown) => e instanceof BulkRefusal && e.status === status;
  const update = (uid: string, docId: string, data: Record<string, unknown>) =>
    prepareDocumentPost(db, user(uid), { collection: 'bills', docId, workspaceId: ws, action: 'update', data });

  before(async () => {
    process.env.DATABASE_URL = url!;
    db = new Firestore({ connectionString: url, max: 2 });
    await db.collection('workspaces').doc(ws).set({
      uid: owner, name: 'Claims', currency: 'USD', timezone: 'UTC', members: [owner, acc, acc2, book],
      roles: { [owner]: 'owner', [acc]: 'accountant', [acc2]: 'accountant', [book]: 'bookkeeper' },
      defaultAccountMappings: { ap: id('ap'), expense: id('exp'), cash: id('cash') },
    });
    for (const [k, name, type, code, category] of [['ap', 'Accounts Payable', 'liability', '2000', 'Payables'], ['exp', 'Travel', 'expense', '6000', 'Operating'], ['cash', 'Checking Bank', 'asset', '1000', 'Cash']] as const) {
      await db.collection('chartAccounts').doc(id(k)).set({ workspaceId: ws, name, type, code, category });
    }
    await db.collection('bills').doc(id('b1')).set(claimBillDoc(acc));
  });

  after(async () => {
    for (const table of ['transactions', 'bills', 'chartAccounts', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => undefined);
    }
    await db.terminate();
  });

  test('an ordinary edit, a status flip or a forged claim value is refused', async () => {
    await assert.rejects(update(owner, id('b1'), { amountCents: 1 }), refused(409));
    await assert.rejects(update(book, id('b1'), { status: 'approved' }), refused(409));
    const bill = (await db.collection('bills').doc(id('b1')).get()).data() as never;
    // a decision plus a sneaked-in field is still an edit
    await assert.rejects(update(owner, id('b1'), { ...claimDecision(bill, true, owner, 'now'), amountCents: 1 }), refused(409));
  });

  test('the decision checks the actor: no bookkeeper, no self-approval by the submitting accountant', async () => {
    const bill = (await db.collection('bills').doc(id('b1')).get()).data() as never;
    await assert.rejects(update(book, id('b1'), claimDecision(bill, true, book, 'now')), refused(403));
    await assert.rejects(update(acc, id('b1'), claimDecision(bill, true, acc, 'now')), refused(403));
    await assert.rejects(prepareDocumentPost(db, user(book), { collection: 'bills', docId: id('b1'), workspaceId: ws, action: 'delete', data: {} }), refused(403));
  });

  test('another accountant approves; after that the claim is an ordinary bill again', async () => {
    const bill = (await db.collection('bills').doc(id('b1')).get()).data() as never;
    const prepared = await update(acc2, id('b1'), claimDecision(bill, true, acc2, new Date().toISOString()));
    await commitPreparedDocumentPost(db, user(acc2), prepared);
    const saved = (await db.collection('bills').doc(id('b1')).get()).data()!;
    assert.equal(saved.status, 'approved');
    assert.equal((saved.metadata as { expenseClaim: { state: string } }).expenseClaim.state, 'approved');
  });

  test('the server writes the decision record: who decided is the caller, and nothing else in the claim changes', async () => {
    await db.collection('bills').doc(id('b3')).set(claimBillDoc(acc));
    const bill = (await db.collection('bills').doc(id('b3')).get()).data() as never;
    const forged = claimDecision(bill, false, owner, new Date().toISOString(), 'no receipt');
    const meta = forged.metadata as { expenseClaim: Record<string, unknown>; memo?: string };
    meta.expenseClaim.submittedBy = owner;
    meta.memo = 'rewritten';
    const prepared = await update(acc2, id('b3'), forged);
    await commitPreparedDocumentPost(db, user(acc2), prepared);
    const saved = (await db.collection('bills').doc(id('b3')).get()).data()!;
    const claim = (saved.metadata as { expenseClaim: Record<string, unknown>; memo?: string });
    assert.equal(claim.expenseClaim.decidedBy, acc2, 'the caller decided, whatever the body said');
    assert.equal(claim.expenseClaim.submittedBy, acc, 'the submitter is the stored one');
    assert.equal(claim.expenseClaim.reason, 'no receipt');
    assert.equal(claim.memo, undefined, 'other metadata is not rewritten by a decision');
  });

  test('the submitter may withdraw (delete) their own claim', async () => {
    await db.collection('bills').doc(id('b2')).set(claimBillDoc(book));
    await prepareDocumentPost(db, user(book), { collection: 'bills', docId: id('b2'), workspaceId: ws, action: 'delete', data: {} });
  });
});
