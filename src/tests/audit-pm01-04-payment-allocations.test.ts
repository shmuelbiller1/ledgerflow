/**
 * PM-01–04 regression (audit PR #1002, PAYMENTS-REVIEW): payment allocations must be
 * internally consistent and clear the control accounts the documents were booked against.
 *
 *   PM-01  a payment's own party must own every document it settles (Alice's receipt must not
 *          extinguish Bob's invoice);
 *   PM-02  one payment settles one kind of document — invoices and bills mixed in a single
 *          request posted one side's control account for both;
 *   PM-03  a cancelled (or rejected) document carries no accrual, so settling it created an
 *          unsupported control-account credit;
 *   PM-04  a document with retainage books two control accounts (trade A/R plus retainage
 *          receivable): the payment's offset must clear both, or the accounts keep equal and
 *          opposite false balances after the invoice is fully paid.
 *
 * The audit diagnostics asserted the defective outcomes; these tests assert the corrected ones.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const url = process.env.LF_TEST_DATABASE_URL;

async function withApp(run: (db: import('../server/db/firestore').Firestore, base: string, ws: string, id: (s: string) => string) => Promise<void>) {
  process.env.DATABASE_URL = url;
  const express = (await import('express')).default;
  const { getDb } = await import('../server/db/firestore');
  const { documentPostRouter } = await import('../server/routes/documentPostRoutes');
  const { paymentRouter } = await import('../server/routes/paymentRoutes');
  const db = getDb();
  const ws = `ws_auditpm_${crypto.randomBytes(5).toString('hex')}`;
  const id = (s: string) => `${ws}_${s}`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as never as { user: { uid: string } }).user = { uid: 'audit-owner' }; next(); });
  app.use('/api/v1/documents', documentPostRouter);
  app.use('/api/v1/payments', paymentRouter);
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await db.collection('workspaces').doc(ws).set({
      uid: 'audit-owner', members: ['audit-owner'], name: 'Synthetic PM', currency: 'USD',
      timezone: 'UTC', defaultAccountMappings: { ar: id('ar'), ap: id('ap') },
    });
    for (const [key, name, type, category, role] of [
      ['ar', 'Accounts Receivable', 'asset', 'Receivables', ''],
      ['ret', 'Retainage Receivable', 'asset', 'Receivables', ''],
      ['ap', 'Accounts Payable', 'liability', 'Payables', ''],
      ['sales', 'Sales', 'revenue', 'Revenue', ''],
      ['expense', 'Expense', 'expense', 'Expense', ''],
      ['cash', 'Cash', 'asset', 'Cash', 'cash'],
    ] as const) {
      await db.collection('chartAccounts').doc(id(key)).set({ workspaceId: ws, name, type, category, ...(role ? { role } : {}) });
    }
    await run(db, base, ws, id);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
    for (const table of ['paymentAllocations', 'allocationOperations', 'idempotencyKeys', 'transactions', 'payments', 'invoices', 'bills', 'chartAccounts', 'auditLogs', 'numberingSeries', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  }
}

const post = (base: string, path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async res => ({ status: res.status, body: await res.json() as Record<string, unknown> }));

const postDoc = async (base: string, ws: string, id: (s: string) => string, collection: 'invoices' | 'bills', key: string, data: Record<string, unknown>) => {
  const res = await post(base, `/api/v1/documents/${collection}/${id(key)}/post`, {
    workspaceId: ws, action: 'create',
    data: { id: id(key), workspaceId: ws, uid: 'audit-owner', ...data },
  });
  assert.equal(res.status, 200, `posting ${collection} ${key}: ${JSON.stringify(res.body)}`);
};

describe('audit PM-01–04: payment allocations', { skip: !url && 'needs LF_TEST_DATABASE_URL' }, () => {
  test('PM-01/02/03: wrong party, mixed document kinds and cancelled documents are refused', async () => {
    await withApp(async (db, base, ws, id) => {
      await postDoc(base, ws, id, 'invoices', 'invoice_bob', {
        number: 'INV-B', customerId: 'bob', customerName: 'Bob', date: '2026-05-01', dueDate: '2026-06-01',
        status: 'sent', currency: 'USD', amountCents: 10000, amountPaidCents: 0,
        items: [{ id: 'l1', description: 'Service', quantity: 1, rateCents: 10000, amountCents: 10000, accountId: id('sales') }],
      });
      await postDoc(base, ws, id, 'invoices', 'invoice_carol', {
        number: 'INV-C', customerId: 'carol', customerName: 'Carol', date: '2026-05-01', dueDate: '2026-06-01',
        status: 'sent', currency: 'USD', amountCents: 10000, amountPaidCents: 0,
        items: [{ id: 'l1', description: 'Service', quantity: 1, rateCents: 10000, amountCents: 10000, accountId: id('sales') }],
      });
      await postDoc(base, ws, id, 'bills', 'bill_david', {
        number: 'B-1', vendorId: 'david', vendorName: 'David', date: '2026-05-01', dueDate: '2026-06-01',
        status: 'approved', currency: 'USD', amountCents: 10000, amountPaidCents: 0,
        splits: [{ description: 'Expense', amountCents: 10000, accountId: id('expense') }],
      });
      await postDoc(base, ws, id, 'invoices', 'invoice_cancelled', {
        number: 'INV-X', customerId: 'alice', customerName: 'Alice', date: '2026-05-01', dueDate: '2026-06-01',
        status: 'cancelled', currency: 'USD', amountCents: 10000, amountPaidCents: 0,
        items: [{ id: 'l1', description: 'Cancelled service', quantity: 1, rateCents: 10000, amountCents: 10000, accountId: id('sales') }],
      });
      const common = { workspaceId: ws, paymentDate: '2026-05-15', cashAccountId: id('cash'), customerId: 'alice' };

      // PM-01: Alice's receipt must not settle Bob's invoice
      const wrong = await post(base, '/api/v1/payments', { ...common, amountCents: 10000, allocations: [{ documentId: id('invoice_bob'), documentType: 'invoice', amountCents: 10000 }] });
      assert.equal(wrong.status, 400, JSON.stringify(wrong.body));
      assert.equal((await db.collection('invoices').doc(id('invoice_bob')).get()).data()?.amountPaidCents, 0, "Bob's invoice stays untouched");

      // PM-02: one payment cannot settle an invoice and a bill
      const mixed = await post(base, '/api/v1/payments', { ...common, amountCents: 20000, allocations: [
        { documentId: id('invoice_carol'), documentType: 'invoice', amountCents: 10000 },
        { documentId: id('bill_david'), documentType: 'bill', amountCents: 10000 },
      ] });
      assert.equal(mixed.status, 400, JSON.stringify(mixed.body));
      assert.equal((await db.collection('invoices').doc(id('invoice_carol')).get()).data()?.amountPaidCents, 0);
      assert.equal((await db.collection('bills').doc(id('bill_david')).get()).data()?.amountPaidCents, 0);

      // PM-03: a cancelled invoice has no accrual to settle
      const cancelled = await post(base, '/api/v1/payments', { ...common, amountCents: 10000, allocations: [{ documentId: id('invoice_cancelled'), documentType: 'invoice', amountCents: 10000 }] });
      assert.equal(cancelled.status, 400, JSON.stringify(cancelled.body));
      const cancelledDoc = (await db.collection('invoices').doc(id('invoice_cancelled')).get()).data()!;
      assert.equal(cancelledDoc.amountPaidCents, 0, 'the cancelled invoice is not converted into a paid one');
      assert.equal(cancelledDoc.status, 'cancelled');
      assert.equal((await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.length, 3, 'only the three document accruals were posted');
    });
  });

  test('PM-04: a payment clears the trade receivable and the retainage receivable it was booked against', async () => {
    await withApp(async (db, base, ws, id) => {
      await postDoc(base, ws, id, 'invoices', 'invoice', {
        number: 'I-1', customerId: 'c', customerName: 'Customer', date: '2026-02-01', dueDate: '2026-03-01',
        status: 'sent', currency: 'USD', amountCents: 10000, amountPaidCents: 0, retainageCents: 1000,
        items: [{ id: 'l1', description: 'Contract work', quantity: 1, rateCents: 10000, amountCents: 10000, accountId: id('sales') }],
      });
      const pay = (amountCents: number, paymentDate: string) =>
        post(base, '/api/v1/payments', {
          workspaceId: ws, paymentDate, cashAccountId: id('cash'), customerId: 'c', amountCents,
          allocations: [{ documentId: id('invoice'), documentType: 'invoice', amountCents }],
        });
      const first = await pay(9000, '2026-02-10');
      assert.equal(first.status, 200, JSON.stringify(first.body));
      const second = await pay(1000, '2026-03-10');
      assert.equal(second.status, 200, JSON.stringify(second.body));

      const txs = (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.map(d => d.data());
      const balance = (s: string) => txs.flatMap(t => (t.lines || []) as Array<{ accountId: string; amountCents: number }>)
        .filter(l => l.accountId === id(s)).reduce((a, l) => a + l.amountCents, 0);
      const invoice = (await db.collection('invoices').doc(id('invoice')).get()).data()!;
      assert.equal(invoice.status, 'paid');
      assert.equal(invoice.amountPaidCents, 10000);
      assert.deepEqual([balance('cash'), balance('ar'), balance('ret'), balance('sales')], [10000, 0, 0, -10000],
        'both receivables clear to zero once the invoice is fully paid');
    });
  });
});
