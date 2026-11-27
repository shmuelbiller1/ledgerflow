// Real /api/v1/payments and /api/v1/payments/:id/void routes on isolated Postgres + Form 856 report/exports.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { form856Rows, form856Summary } from '../../src/lib/tax/form856';
import { form856ReviewExport, type Form856ReviewPayment } from '../../src/lib/tax/form856ReviewExport';
import { form856AuthorityPayees } from '../../src/lib/tax/form856AuthorityCsv';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

test('Form 856 includes voided withholding payments in totals, permanently blocks CSV export after a void, and drops 0%-certificate vendor payments', { skip: !valid && 'dedicated local audit database required' }, async () => {
  process.env.DATABASE_URL = url;
  const express = (await import('express')).default;
  const { getDb } = await import('../../src/server/db/firestore');
  const { paymentRouter } = await import('../../src/server/routes/paymentRoutes');
  const db = getDb();
  const ws = `ws_audit_f856_${crypto.randomBytes(5).toString('hex')}`;
  const id = (s: string) => `${ws}_${s}`;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as never as { user: { uid: string; email: string } }).user = { uid: 'audit-owner', email: 'audit@example.test' };
    next();
  });
  app.use('/api/v1/payments', paymentRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    await db.collection('workspaces').doc(ws).set({ uid: 'audit-owner', members: ['audit-owner'], name: 'Synthetic Tel Aviv Books', currency: 'ILS', timezone: 'UTC' });
    await db.collection('vendors').doc(id('v1')).set({ workspaceId: ws, name: 'Haifa Consulting Ltd', taxId: '512345678' });
    await db.collection('vendors').doc(id('v2')).set({ workspaceId: ws, name: 'Exempt Cert Supplier Ltd', taxId: '518765432' });
    for (const [key, name, type, category] of [
      ['bank', 'Bank Leumi', 'asset', 'Cash'],
      ['ap', 'Accounts Payable', 'liability', 'Payables'],
      ['wht', 'Tax Withheld at Source', 'liability', 'Current Liabilities'],
    ]) {
      await db.collection('chartAccounts').doc(id(key)).set({ workspaceId: ws, name, type, category });
    }

    async function call(path: string, body: unknown, op: string) {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-operation-id': `${ws}_${op}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      assert.equal(res.status, 200, JSON.stringify(data));
      return data;
    }

    // 1. Record ₪10,000 vendor payment with ₪3,000 withheld, then VOID it:
    const p1 = await call('/api/v1/payments', {
      workspaceId: ws, vendorId: id('v1'), entityName: 'Haifa Consulting Ltd',
      paymentDate: '2026-03-10', amountCents: 1_000_000, cashAccountId: id('bank'), offsetAccountId: id('ap'),
      withheldCents: 300_000, withholdingRatePercent: 30, withholdingCertificate: 'CERT-ERR', allocations: [],
    }, 'p1') as { paymentId?: string; data?: { paymentId?: string } };
    const p1Id = p1.data?.paymentId || p1.paymentId;
    await call(`/api/v1/payments/${p1Id}/void`, { workspaceId: ws, date: '2026-03-10', reason: 'Duplicate payment' }, 'v1');

    // 2. Record real ₪5,000 vendor payment with ₪1,500 withheld:
    await call('/api/v1/payments', {
      workspaceId: ws, vendorId: id('v1'), entityName: 'Haifa Consulting Ltd',
      paymentDate: '2026-03-11', amountCents: 500_000, cashAccountId: id('bank'), offsetAccountId: id('ap'),
      withheldCents: 150_000, withholdingRatePercent: 30, withholdingCertificate: 'CERT-OK', allocations: [],
    }, 'p2');

    // 3. Record ₪8,000 vendor payment under a valid 0% withholding exemption certificate:
    await call('/api/v1/payments', {
      workspaceId: ws, vendorId: id('v2'), entityName: 'Exempt Cert Supplier Ltd',
      paymentDate: '2026-03-12', amountCents: 800_000, cashAccountId: id('bank'), offsetAccountId: id('ap'),
      withheldCents: 0, withholdingRatePercent: 0, withholdingCertificate: 'EXEMPT-2026', allocations: [],
    }, 'p3');

    const payments = (await db.collection('payments').where('workspaceId', '==', ws).get()).docs.map(d => ({
      ...d.data(), id: d.id, contactTaxId: d.data().vendorId === id('v1') ? '512345678' : '518765432',
    })) as Form856ReviewPayment[];

    const rows = form856Rows(payments, '2026');
    const summary = form856Summary(rows);
    const worksheet = form856ReviewExport(payments, '2026', 'ILS');
    const authority = form856AuthorityPayees(payments, '2026');

    // Expected live withholding summary: ₪5,000 paid (plus ₪8,000 0%-cert vendor if tracked), ₪1,500 withheld, CSV exportable.
    // Actual: voided ₪10,000/₪3,000 payment is included in summary (₪15,000 paid, ₪4,500 withheld) and authority payees,
    // worksheet.canDownloadForReview is permanently false due to the voided payment, and 0%-cert vendor v2 is omitted!
    assert.equal(summary.paidCents, 1_500_000);
    assert.equal(summary.withheldCents, 450_000);
    assert.equal(worksheet.canDownloadForReview, false);
    assert.match(worksheet.blockers[0] || '', /void/i);
    assert.equal(authority.payees[0].paymentsCents, 1_500_000);
    assert.equal(authority.payees[0].taxWithheldCents, 450_000);
    assert.equal(rows.some(r => r.contactId === id('v2')), false);

    // Also verify VAT-subtraction defect on baseCents / effectiveRatePercent (3% of ₪210,600 incl. ₪30,600 VAT = ₪6,318):
    const vatSample = form856Rows([{
      id: 'vat-p', date: '2026-04-01', direction: 'made', contactId: 'v-vat', contactName: 'Amir Ltd',
      amountCents: 21_060_000, vatCents: 3_060_000, withheldCents: 631_800, withholdingRatePercent: 3, withholdingCertificate: 'C-3',
    }], '2026')[0];
    assert.equal(vatSample.effectiveRatePercent, 3.51); // 631,800 / 18,000,000 = 3.51% instead of 3.00% on 21,060,000!

    console.log(JSON.stringify({
      summaryPaidCents: summary.paidCents,
      summaryWithheldCents: summary.withheldCents,
      expectedLiveWithheldCents: 150_000,
      canDownloadAfterVoid: worksheet.canDownloadForReview,
      zeroPercentCertVendorIncluded: rows.some(r => r.contactId === id('v2')),
      vatSampleReportedEffectiveRate: vatSample.effectiveRatePercent,
    }));
  } finally {
    await new Promise<void>(r => server.close(() => r()));
    for (const table of ['paymentAllocations', 'payments', 'transactions', 'vendors', 'chartAccounts', 'auditLogs', 'idempotencyKeys', 'numberingSeries', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`, [ws]).catch(() => {});
    }
    await db.terminate();
  }
});
