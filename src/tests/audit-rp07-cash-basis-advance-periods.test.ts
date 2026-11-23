/**
 * Audit RP-07 (reporting review, 22 Nov 2026), as acceptance tests: the monthly cash-basis P&Ls
 * add up to their combined total for an advance applied to a later invoice. The audit worked
 * case: a $100 unapplied customer advance received 2026-02-10, a $100 invoice issued 2026-03-01,
 * the advance applied 2026-03-10. The February report shows $0, the March report $100, and the
 * two-month total $100 — under any consistent recognition policy the disjoint figures reconcile
 * to their union. The real document, payment and report routers run against synthetic isolated
 * Postgres with a test-injected identity.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { auditDbValid, standardRoutes, startAuditApp, type ChartAcc } from './helpers/auditTestApp';

const accounts: ChartAcc[] = [
  { key: 'ar', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' },
  { key: 'sales', name: 'Sales', type: 'revenue', category: 'Revenue' },
  { key: 'cash', name: 'Cash', type: 'asset', category: 'Cash', role: 'cash' },
  { key: 'dep', name: 'Customer Deposits', type: 'liability', category: 'Current Liabilities' },
];

describe('audit RP-07: an advance applied to a later invoice lands in the application period', { skip: !auditDbValid && 'dedicated local audit database required' }, () => {
  test('the monthly cash-basis P&Ls add up to the combined P&L', async () => {
    const app = await startAuditApp('rp07', accounts, await standardRoutes());
    const { ws, id, call, db } = app;
    try {
      const report = (start: string, end: string, read: number) =>
        call(`/api/v1/reports/profit-and-loss?workspaceId=${ws}&startDate=${start}&endDate=${end}&basis=cash&_read=${read}`) as Promise<{ income: { total: number }; netIncome: number }>;

      // $100 unapplied advance received 2026-02-10
      const advance = await call('/api/v1/payments', {
        workspaceId: ws, paymentDate: '2026-02-10', cashAccountId: id('cash'), customerId: 'c', amountCents: 10000, allocations: [],
      });
      // $100 invoice issued 2026-03-01
      await call(`/api/v1/documents/invoices/${id('invoice')}/post`, {
        workspaceId: ws, action: 'create',
        data: {
          id: id('invoice'), workspaceId: ws, customerId: 'c', customerName: 'Customer', number: 'I-1',
          date: '2026-03-01', dueDate: '2026-03-31', status: 'sent', currency: 'USD', amountCents: 10000, amountPaidCents: 0,
          items: [{ id: 'l1', description: 'Service', quantity: 1, rateCents: 10000, amountCents: 10000, accountId: id('sales') }],
        },
      });
      // the advance applied to the invoice on 2026-03-10
      await call(`/api/v1/payments/${(advance as { data: { paymentId: string } }).data.paymentId}/apply`, {
        workspaceId: ws, date: '2026-03-10', allocations: [{ documentId: id('invoice'), documentType: 'invoice', amountCents: 10000 }],
      });

      const feb = await report('2026-02-01', '2026-02-28', 1);
      const mar = await report('2026-03-01', '2026-03-31', 2);
      const total = await report('2026-02-01', '2026-03-31', 3);

      assert.equal(feb.income.total, 0, 'the advance is not revenue while it is unapplied');
      assert.equal(mar.income.total, 10000, 'the application on 2026-03-10 recognizes the invoice in March');
      assert.equal(total.income.total, 10000, 'the disjoint monthly figures add up to their union');
      assert.equal(feb.income.total + mar.income.total, total.income.total);
      assert.equal(total.netIncome, 10000);

      console.log(JSON.stringify({ february: feb.income.total, march: mar.income.total, combined: total.income.total }));
    } finally {
      await app.close();
      for (const table of ['paymentAllocations', 'allocationOperations', 'idempotencyKeys', 'transactions', 'payments', 'invoices', 'chartAccounts', 'auditLogs', 'numberingSeries', 'workspaces']) {
        await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`, [ws]).catch(() => {});
      }
    }
  });
});
