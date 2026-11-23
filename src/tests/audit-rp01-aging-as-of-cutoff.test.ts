/**
 * Audit RP-01 (reporting review, 22 Nov 2026), as acceptance tests against the migrated Postgres:
 * the dated aging snapshot reconstructs what was actually owed at the report date from dated
 * settlement events, instead of reading the documents' current state.
 *
 * Audit scenario: a $100 invoice issued 2026-01-01, due 2026-01-31, paid 2026-02-10. The aging as
 * of 2026-01-31 must still show the $100 (payment after the cutoff must not change the January
 * snapshot), a currently-open invoice dated after the cutoff must not appear in it, and a later
 * void must only unwind the snapshot from its own date onward. The real document, payment and
 * report routers run against synthetic isolated Postgres with a test-injected identity.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { auditDbValid, standardRoutes, standardAccounts, startAuditApp } from './helpers/auditTestApp';

describe('audit RP-01: aging snapshot as of a cutoff date', { skip: !auditDbValid && 'dedicated local audit database required' }, () => {
  test('payments and voids dated after the cutoff leave the historic aging alone', async () => {
    const app = await startAuditApp('rp01', standardAccounts, await standardRoutes());
    const { db, ws, id, call } = app;
    try {
      await db.collection('customers').doc('alice').set({ workspaceId: ws, name: 'Alice' });
      async function aging(asOf: string) {
        const data = await call(`/api/v1/reports/party-aging?workspaceId=${ws}&side=customer&asOfDate=${asOf}`);
        return (data.rows || []) as Array<{ partyName: string; buckets: Record<string, number>; total: number }>;
      }
      async function postInvoice(key: string, data: Record<string, unknown>) {
        await call(`/api/v1/documents/invoices/${id(key)}/post`, { workspaceId: ws, action: 'create', data: { id: id(key), workspaceId: ws, customerId: 'alice', customerName: 'Alice', number: `I-${key}`, currency: 'USD', amountPaidCents: 0, items: [{ id: `${key}-l1`, description: 'Service', quantity: 1, rateCents: 10000, amountCents: 10000, accountId: id('sales') }], ...data } });
      }

      // the audit scenario: $100 invoice issued 2026-01-01, due 2026-01-31
      await postInvoice('jan', { date: '2026-01-01', dueDate: '2026-01-31', status: 'sent', amountCents: 10000 });
      // a currently-open $100 invoice issued after the cutoff
      await postInvoice('feb', { date: '2026-02-10', dueDate: '2026-02-28', status: 'sent', amountCents: 10000 });

      // the payment settles the January invoice on 2026-02-10 — after the report date
      await call('/api/v1/payments', { workspaceId: ws, paymentDate: '2026-02-10', cashAccountId: id('cash'), customerId: 'alice', amountCents: 10000, allocations: [{ documentId: id('jan'), documentType: 'invoice', amountCents: 10000 }] });

      const january = await aging('2026-01-31');
      assert.equal(january.length, 1, JSON.stringify(january));
      assert.equal(january[0].total, 10000, 'the January snapshot keeps the $100 that was outstanding on 2026-01-31');
      assert.equal(january[0].buckets.current, 10000, 'due 2026-01-31, it sits in the current bucket on that date');

      // by 2026-02-28 the January invoice is settled; only the February invoice is open
      const february = await aging('2026-02-28');
      assert.equal(february.length, 1, JSON.stringify(february));
      assert.equal(february[0].total, 10000, JSON.stringify(february));

      // void the payment effective 2026-03-10: the January snapshot is unchanged, the
      // post-void snapshot unwinds the settlement from the void date onward
      const payments = await db.collection('payments').where('workspaceId', '==', ws).get();
      const paymentId = String(payments.docs[0]!.id);
      await call(`/api/v1/payments/${paymentId}/void`, { workspaceId: ws, date: '2026-03-10', reason: 'Synthetic later reversal' });

      const januaryAfterVoid = await aging('2026-01-31');
      assert.equal(januaryAfterVoid[0].total, 10000, 'a March void does not rewrite the January snapshot');
      const marchAfterVoid = await aging('2026-03-15');
      assert.equal(marchAfterVoid.length, 1, JSON.stringify(marchAfterVoid));
      assert.equal(marchAfterVoid[0].total, 20000, 'from the 2026-03-10 void on, the January invoice is outstanding again alongside the February one');

      console.log(JSON.stringify({ januaryTotal: january[0].total, januaryBuckets: january[0].buckets, februaryTotal: february[0].total, marchAfterVoid: marchAfterVoid.map(r => r.total) }));
    } finally {
      await app.close();
      for (const table of ['paymentAllocations', 'allocationOperations', 'idempotencyKeys', 'transactions', 'payments', 'invoices', 'chartAccounts', 'auditLogs', 'numberingSeries', 'workspaces']) {
        await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`, [ws]).catch(() => {});
      }
    }
  });
});
