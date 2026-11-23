/**
 * Audit RP-08 (reporting review, 22 Nov 2026), as an acceptance test: the cash-basis P&L follows
 * its stated payment-date rule, not an accrual deferral schedule. The audit worked case: a $100
 * service invoice issued 2026-02-01 and fully paid 2026-02-10 shows $100 of February cash-basis
 * income. After spreading that same $100 over March and April, the February cash-basis P&L must
 * still show $100 — the later noncash schedule installments move no cash and must not silently
 * override the declared rule. The real document, payment, spread and report routers run against
 * synthetic isolated Postgres with a test-injected identity.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { auditDbValid, startAuditApp, type ChartAcc } from './helpers/auditTestApp';

const accounts: ChartAcc[] = [
  { key: 'ar', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' },
  { key: 'cash', name: 'Cash', type: 'asset', category: 'Cash' },
  { key: 'sales', name: 'Sales', type: 'revenue', category: 'Revenue' },
  { key: 'deferred', name: 'Deferred Revenue', type: 'liability', category: 'Current Liabilities' },
];

async function routes(): Promise<Array<[string, unknown]>> {
  const { documentPostRouter } = await import('../server/routes/documentPostRoutes');
  const { revenueSpreadRouter } = await import('../server/routes/prepaidRoutes');
  const { paymentRouter } = await import('../server/routes/paymentRoutes');
  const { reportRouter } = await import('../server/routes/reportRoutes');
  return [
    ['/api/v1/documents', documentPostRouter],
    ['/api/v1/workspaces/:workspaceId/invoices', revenueSpreadRouter],
    ['/api/v1/payments', paymentRouter],
    ['/api/v1/reports', reportRouter],
  ];
}

describe('audit RP-08: a deferral schedule does not override the cash-basis payment-date rule', { skip: !auditDbValid && 'dedicated local audit database required' }, () => {
  test('spreading a paid invoice leaves the February cash-basis income alone', async () => {
    const app = await startAuditApp('rp08', accounts, await routes());
    const { ws, id, call, db } = app;
    try {
      const report = (start: string, end: string, nonce: string) =>
        call(`/api/v1/reports/profit-and-loss?workspaceId=${ws}&startDate=${start}&endDate=${end}&basis=cash&_read=${nonce}`) as Promise<{ income: { total: number }; netIncome: number }>;

      await call(`/api/v1/documents/invoices/${id('invoice')}/post`, {
        workspaceId: ws, action: 'create',
        data: {
          id: id('invoice'), workspaceId: ws, customerId: 'c', customerName: 'Customer', number: 'I-1',
          date: '2026-02-01', dueDate: '2026-03-01', status: 'sent', currency: 'USD', amountCents: 10000,
          items: [{ id: 'l1', description: 'Service', quantity: 1, rateCents: 10000, amountCents: 10000, accountId: id('sales') }],
        },
      });
      await call('/api/v1/payments', {
        workspaceId: ws, paymentDate: '2026-02-10', customerId: 'c', cashAccountId: id('cash'),
        amountCents: 10000, allocations: [{ documentId: id('invoice'), documentType: 'invoice', amountCents: 10000 }],
      });

      const prior = await report('2026-02-01', '2026-02-28', '1');
      assert.equal(prior.income.total, 10000, 'with no schedule, the paid invoice is February cash-basis income');

      await call(`/api/v1/workspaces/${ws}/invoices/${id('invoice')}/spread`, {
        revenueAccountId: id('sales'), deferredAccountId: id('deferred'), amountCents: 10000, months: 2, startMonth: '2026-03',
      });

      const feb = await report('2026-02-01', '2026-02-28', '2');
      assert.equal(feb.income.total, 10000, 'the payment on 2026-02-10 is still February income: the deferral schedule is noncash');
      const mar = await report('2026-03-01', '2026-03-31', '3');
      assert.equal(mar.income.total, 0, 'no cash was received in March: the schedule installments do not create income');
      const apr = await report('2026-04-01', '2026-04-30', '4');
      assert.equal(apr.income.total, 0, 'no cash was received in April');
      const total = await report('2026-02-01', '2026-04-30', '5');
      assert.equal(total.income.total, 10000, 'the total recognizes the cash actually received, once');

      console.log(JSON.stringify({ beforeSpreadFeb: prior.income.total, afterSpreadFeb: feb.income.total, march: mar.income.total, april: apr.income.total, total: total.income.total }));
    } finally {
      await app.close();
      for (const table of ['paymentAllocations', 'allocationOperations', 'transactions', 'payments', 'invoices', 'chartAccounts', 'auditLogs', 'idempotencyKeys', 'numberingSeries', 'workspaces']) {
        await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`, [ws]).catch(() => {});
      }
    }
  });
});
