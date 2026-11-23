/**
 * Audit RP-05 (reporting review, 22 Nov 2026), as an acceptance test: a later payment void must
 * not retroactively remove prior-period cash-basis revenue. The audit worked case: post a $100
 * invoice on 2026-02-01, receive $100 on 2026-02-10 (February cash-basis income $100), then void
 * and reverse the payment effective 2026-03-10. The February report must still show $100 — the
 * reversal is a March event; the March report is where the settlement is unwound.
 *
 * The real document, payment, void and report routers run against synthetic isolated Postgres
 * with a test-injected identity, like the audit's diagnostic.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { auditDbValid, standardAccounts, standardRoutes, startAuditApp } from './helpers/auditTestApp';

describe('audit RP-05: a later payment void leaves the prior cash-basis period alone', { skip: !auditDbValid && 'dedicated local audit database required' }, () => {
  test('the February P&L is unchanged by a March void', async () => {
    const app = await startAuditApp('rp05', standardAccounts, await standardRoutes());
    try {
      const { ws, id, call } = app;
      const report = (start: string, end: string, read: number) =>
        call(`/api/v1/reports/profit-and-loss?workspaceId=${ws}&startDate=${start}&endDate=${end}&basis=cash&_read=${read}`) as Promise<{ income: { total: number }; expense: { total: number }; netIncome: number }>;

      // $100 invoice posted 2026-02-01, paid 2026-02-10
      await call(`/api/v1/documents/invoices/${id('invoice')}/post`, {
        workspaceId: ws, action: 'create',
        data: {
          id: id('invoice'), workspaceId: ws, number: 'INV-1', customerId: 'alice', customerName: 'Alice', date: '2026-02-01', dueDate: '2026-03-01',
          status: 'sent', currency: 'USD', amountCents: 10000, amountPaidCents: 0,
          items: [{ id: 'l1', description: 'Service', quantity: 1, rateCents: 10000, amountCents: 10000, accountId: id('sales') }],
        },
      });
      const pay = await call('/api/v1/payments', {
        workspaceId: ws, paymentDate: '2026-02-10', cashAccountId: id('cash'), customerId: 'alice',
        amountCents: 10000, allocations: [{ documentId: id('invoice'), documentType: 'invoice', amountCents: 10000 }],
      });
      const feb = await report('2026-02-01', '2026-02-28', 1);
      assert.equal(feb.income.total, 10000, 'February carries the $100 receipt');

      // void the payment effective 2026-03-10
      const paymentId = (pay as { data?: { paymentId?: string }; paymentId?: string }).data?.paymentId || (pay as { paymentId?: string }).paymentId;
      await call(`/api/v1/payments/${paymentId}/void`, { workspaceId: ws, date: '2026-03-10', reason: 'Synthetic later void' });
      const febAfter = await report('2026-02-01', '2026-02-28', 2);
      assert.equal(febAfter.income.total, 10000, 'the March void does not rewrite February');
      const mar = await report('2026-03-01', '2026-03-31', 2);
      assert.equal(mar.income.total, -10000, 'March carries the unwind');
    } finally {
      await app.close();
    }
  });
});
