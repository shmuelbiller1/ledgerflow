/**
 * Agent #7 Probe 01 (2026-11-13) — A7N-01
 * Proves against live PostgreSQL 16.2 (`lf_test`) the architectural mismatch between
 * `TransactionValidator.validateAndPrepare` (`src/kernel/validation/TransactionValidator.ts:82`) and
 * `checkLedgerEntry` (`src/server/services/ledgerDoor.ts:39-44`):
 *   - `TransactionValidator.validateAndPrepare` converts `totalAmountCents` to HOME currency (`115000` USD cents),
 *   - `checkLedgerEntry` (`ledgerDoor.ts:39-44`) compares `totalAmountCents` against raw `line.amountCents`
 *     in FOREIGN currency (`100000` EUR cents).
 *   Result: `voidPayment` (`src/server/services/paymentVoidService.ts:159`) CRASHES with
 *   `400 LedgerDoorError: The entry total (115000) does not match its lines (100000)` on EVERY
 *   foreign-currency `standalone-payment` (both header `exchangeRate !== 1` and line `exchangeRate !== 1`),
 *   leaving foreign-currency standalone payments PERMANENTLY UNVOIDABLE!
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.SYSTEM_SALT ||= 'probe-test-salt-2026';
import { getDb } from '../../../src/server/db/firestore';
import { TransactionValidator } from '../../../src/kernel/validation/TransactionValidator';
import { voidPayment } from '../../../src/server/services/paymentVoidService';
import type { ChartAccount } from '../../../src/types';

async function main() {
  const db = getDb();
  const suffix = crypto.randomUUID().slice(0, 8);
  const wsId = `ws_probe01_${suffix}`;
  const uid = `u_probe01_${suffix}`;

  const cashId = `acc_cash_${suffix}`;
  const arId = `acc_ar_${suffix}`;
  const payHeaderFxId = `pay_hfx_${suffix}`;
  const payLineFxId = `pay_lfx_${suffix}`;

  const wsData = {
    id: wsId,
    name: 'Probe 01 FX Standalone Payment Void Crash',
    uid,
    currency: 'USD',
    roles: { [uid]: 'owner' },
    defaultAccountMappings: { cash: cashId, ar: arId },
  };
  await db.collection('workspaces').doc(wsId).set(wsData);

  const chart: ChartAccount[] = [
    { id: cashId, workspaceId: wsId, name: 'Operating Cash', code: '1010', type: 'asset', systemRole: 'cash' } as ChartAccount,
    { id: arId, workspaceId: wsId, name: 'Accounts Receivable', code: '1100', type: 'asset', systemRole: 'ar' } as ChartAccount,
  ];
  for (const acc of chart) {
    await db.collection('chartAccounts').doc(acc.id).set(acc);
  }

  // Case 1: Header FX standalone-payment (`currency: 'EUR', exchangeRate: 1.15`) -> voidPayment crashes 400!
  await db.collection('payments').doc(payHeaderFxId).set({
    id: payHeaderFxId, workspaceId: wsId, uid, number: 'PAY-HFX', direction: 'received', status: 'posted',
    date: '2026-10-10', amountCents: 100000, currency: 'EUR', exchangeRate: 1.15,
    depositAccountId: cashId, unappliedCents: 100000, allocations: [],
  });
  const txHeaderFx = await TransactionValidator.validateAndPrepare({
    id: `tx_hfx_${suffix}`, workspaceId: wsId, uid, date: '2026-10-10', description: 'Header FX Payment',
    status: 'completed', type: 'actual', currency: 'EUR', exchangeRate: 1.15, totalAmountCents: 100000,
    metadata: { paymentId: payHeaderFxId, direction: 'received', type: 'standalone-payment' },
    lines: [
      { id: 'l1', accountId: cashId, accountName: 'Operating Cash', amountCents: 100000, exchangeRate: 1.15 },
      { id: 'l2', accountId: arId, accountName: 'Accounts Receivable', amountCents: -100000, exchangeRate: 1.15 },
    ],
  }, { workspaceId: wsId, user: { uid }, wsData });
  await db.collection('transactions').doc(txHeaderFx.id).set(txHeaderFx);

  let headerFxVoidStatus = 0;
  let headerFxVoidMsg = '';
  try {
    await voidPayment(db, { workspaceId: wsId, uid, paymentId: payHeaderFxId, date: '2026-10-12' });
  } catch (err) {
    headerFxVoidStatus = (err as { status?: number }).status || 0;
    headerFxVoidMsg = err instanceof Error ? err.message : String(err);
  }

  // Case 2: Line FX standalone-payment (`currency: 'USD', exchangeRate: 1`, lines `exchangeRate: 1.15`) -> ALSO crashes 400!
  await db.collection('payments').doc(payLineFxId).set({
    id: payLineFxId, workspaceId: wsId, uid, number: 'PAY-LFX', direction: 'received', status: 'posted',
    date: '2026-10-10', amountCents: 100000, currency: 'EUR', exchangeRate: 1.15,
    depositAccountId: cashId, unappliedCents: 100000, allocations: [],
  });
  const txLineFx = await TransactionValidator.validateAndPrepare({
    id: `tx_lfx_${suffix}`, workspaceId: wsId, uid, date: '2026-10-10', description: 'Line FX Payment',
    status: 'completed', type: 'actual', currency: 'USD', exchangeRate: 1, totalAmountCents: 100000,
    metadata: { paymentId: payLineFxId, direction: 'received', type: 'standalone-payment' },
    lines: [
      { id: 'l1', accountId: cashId, accountName: 'Operating Cash', amountCents: 100000, exchangeRate: 1.15 },
      { id: 'l2', accountId: arId, accountName: 'Accounts Receivable', amountCents: -100000, exchangeRate: 1.15 },
    ],
  }, { workspaceId: wsId, user: { uid }, wsData });
  await db.collection('transactions').doc(txLineFx.id).set(txLineFx);

  let lineFxVoidStatus = 0;
  let lineFxVoidMsg = '';
  try {
    await voidPayment(db, { workspaceId: wsId, uid, paymentId: payLineFxId, date: '2026-10-12' });
  } catch (err) {
    lineFxVoidStatus = (err as { status?: number }).status || 0;
    lineFxVoidMsg = err instanceof Error ? err.message : String(err);
  }

  const stillPostedHeader = (await db.collection('payments').doc(payHeaderFxId).get()).data()?.status;
  const stillPostedLine = (await db.collection('payments').doc(payLineFxId).get()).data()?.status;

  console.log(JSON.stringify({
    probe: 'A7N-01_ledgerDoor_fx_rejection_blocks_voidPayment',
    headerFxVoid: { status: headerFxVoidStatus, message: headerFxVoidMsg, paymentStatusAfter: stillPostedHeader },
    lineFxVoid: { status: lineFxVoidStatus, message: lineFxVoidMsg, paymentStatusAfter: stillPostedLine },
  }, null, 2));

  assert.equal(headerFxVoidStatus, 400);
  assert.match(headerFxVoidMsg, /entry total \(115000\) does not match its lines \(100000\)/);
  assert.equal(lineFxVoidStatus, 400);
  assert.match(lineFxVoidMsg, /entry total \(115000\) does not match its lines \(100000\)/);
  assert.equal(stillPostedHeader, 'posted');
  assert.equal(stillPostedLine, 'posted');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
