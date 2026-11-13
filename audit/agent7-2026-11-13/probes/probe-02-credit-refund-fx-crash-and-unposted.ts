/**
 * Agent #7 Probe 02 (2026-11-13) — A7N-02
 * Proves against live PostgreSQL 16.2 (`lf_test`) two critical defects in `refundCredit` (`src/server/services/creditService.ts:385-405`):
 *   Part A: Every foreign-currency credit refund crashes with `400 LedgerDoorError: The entry total (...) does not match its lines (...)`
 *           because `refundCredit` passes `exchangeRate !== 1` on the header without setting `exchangeRate` on the lines (nor `minorUnitRate` for JPY/KWD).
 *   Part B: `refundCredit` never verifies `credit.posted === true`, allowing an unposted credit note (e.g. browser-inserted via #646)
 *           to post a real `DR Accounts Receivable / CR Cash` entry that drains Cash and fabricates A/R without an issuance entry,
 *           while omitting both `paymentAllocations` and `writeServerAuditLog`.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.SYSTEM_SALT ||= 'probe-test-salt-2026';
import { getDb } from '../../../src/server/db/firestore';
import { refundCredit } from '../../../src/server/services/creditService';
import { computeBalanceSheet } from '../../../src/server/reports/computeReports';
import type { ChartAccount, Transaction } from '../../../src/types';

async function main() {
  const db = getDb();
  const suffix = crypto.randomUUID().slice(0, 8);
  const wsId = `ws_probe02_${suffix}`;
  const uid = `u_probe02_${suffix}`;

  const cashId = `acc_cash_${suffix}`;
  const arId = `acc_ar_${suffix}`;
  const fxCreditId = `cn_fx_${suffix}`;
  const unpostedCreditId = `cn_unposted_${suffix}`;

  await db.collection('workspaces').doc(wsId).set({
    id: wsId,
    name: 'Probe 02 Credit Refund',
    uid,
    currency: 'USD',
    roles: { [uid]: 'owner' },
    defaultAccountMappings: { cash: cashId, ar: arId },
  });

  const chart: ChartAccount[] = [
    { id: cashId, workspaceId: wsId, name: 'Operating Cash', code: '1010', type: 'asset', systemRole: 'cash' } as ChartAccount,
    { id: arId, workspaceId: wsId, name: 'Accounts Receivable', code: '1100', type: 'asset', systemRole: 'ar' } as ChartAccount,
  ];
  for (const acc of chart) {
    await db.collection('chartAccounts').doc(acc.id).set(acc);
  }

  // Part A: Valid posted foreign-currency credit note (€500.00 EUR at 1.10 USD/EUR)
  await db.collection('creditNotes').doc(fxCreditId).set({
    id: fxCreditId,
    workspaceId: wsId,
    uid,
    number: 'CN-EUR-001',
    customerId: 'cust_1',
    date: '2026-10-05',
    currency: 'EUR',
    exchangeRate: 1.10,
    amountCents: 50000,
    remainingCents: 50000,
    status: 'open',
    posted: true,
    arAccountId: arId,
  });

  let fxErrorStatus = 0;
  let fxErrorMessage = '';
  try {
    await refundCredit(db, {
      workspaceId: wsId,
      uid,
      kind: 'customer',
      creditId: fxCreditId,
      amountCents: 50000,
      cashAccountId: cashId,
      date: '2026-10-10',
    });
  } catch (err) {
    fxErrorStatus = (err as { status?: number }).status || 0;
    fxErrorMessage = err instanceof Error ? err.message : String(err);
  }

  // Part B: Unposted home-currency credit note (`posted: false`) refunded for $500.00
  await db.collection('creditNotes').doc(unpostedCreditId).set({
    id: unpostedCreditId,
    workspaceId: wsId,
    uid,
    number: 'CN-UNPOSTED-001',
    customerId: 'cust_1',
    date: '2026-10-05',
    currency: 'USD',
    exchangeRate: 1,
    amountCents: 50000,
    remainingCents: 50000,
    status: 'open',
    posted: false,
    arAccountId: arId,
  });

  const unpostedRefund = await refundCredit(db, {
    workspaceId: wsId,
    uid,
    kind: 'customer',
    creditId: unpostedCreditId,
    amountCents: 50000,
    cashAccountId: cashId,
    date: '2026-10-10',
  });

  const txs = (await db.collection('transactions').where('workspaceId', '==', wsId).get())
    .docs.map(d => ({ ...d.data(), id: d.id }) as Transaction);
  const audits = (await db.collection('auditLogs').where('workspaceId', '==', wsId).get()).docs;
  const bs = computeBalanceSheet(chart, txs, '2026-10-31');

  console.log(JSON.stringify({
    probe: 'A7N-02_credit_refund_fx_crash_and_unposted_refund',
    partA_foreignCreditRefund: {
      status: fxErrorStatus,
      message: fxErrorMessage,
      crashedAsExpected: fxErrorStatus === 400 && fxErrorMessage.includes('entry total (55000) does not match its lines (50000)'),
    },
    partB_unpostedCreditRefund: {
      transactionId: unpostedRefund.transactionId,
      cashBalanceCents: bs.assets[cashId],
      fabricatedArBalanceCents: bs.assets[arId],
      auditLogCount: audits.length,
    },
  }, null, 2));

  assert.equal(fxErrorStatus, 400);
  assert.match(fxErrorMessage, /entry total \(55000\) does not match its lines \(50000\)/);
  assert.equal(bs.assets[cashId], -50000);
  assert.equal(bs.assets[arId], 50000);
  assert.equal(audits.length, 0, 'Expected missing server audit log on refundCredit');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
