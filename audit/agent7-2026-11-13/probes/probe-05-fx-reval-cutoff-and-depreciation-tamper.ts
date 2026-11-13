/**
 * Agent #7 Probe 05 (2026-11-13) — A7N-05 & A7N-06
 * Proves against live PostgreSQL 16.2 (`lf_test`):
 *   Part A (`A7N-05`, `src/server/services/fxRevaluationService.ts:119-136, 209-225`):
 *     Running historical month-end FX revaluation (`date: '2026-09-30'`) ignores the cutoff date completely:
 *       - Skips Invoice #1 (`2026-09-15`, €1,000) because it was paid AFTER month-end (`2026-10-15`);
 *       - Revalues Bill #2 (`2026-10-20`, €2,000) back into September even though it did not exist on `2026-09-30`;
 *       - Ignores Bill #2's explicit `apAccountId` (`line 121` passes `undefined`), posting to default A/P instead!
 *   Part B (`A7N-06`, `src/server/services/depreciationService.ts` + live PG RLS on `public.assets`):
 *     An authenticated `bookkeeper` under real PostgreSQL RLS (`ROLE authenticated`) can `UPDATE public.assets`
 *     to reset `accumulatedDepreciationCents = 0, depreciatedThrough = null`, causing `runDepreciation` to
 *     DOUBLE-POST the exact same month's depreciation to the General Ledger!
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.SYSTEM_SALT ||= 'probe-test-salt-2026';
import { Pool } from 'pg';
import { getDb } from '../../../src/server/db/firestore';
import { revaluateForeignBalances } from '../../../src/server/services/fxRevaluationService';
import { runDepreciation } from '../../../src/server/services/depreciationService';
import { computeProfitAndLoss } from '../../../src/server/reports/computeReports';
import type { ChartAccount, Transaction } from '../../../src/types';

async function main() {
  const db = getDb();
  const suffix = crypto.randomUUID().slice(0, 8);
  const wsId = `ws_probe05_${suffix}`;
  const ownerUid = `owner_${suffix}`;
  const bookkeeperUid = `bk_${suffix}`;

  const arId = `acc_ar_${suffix}`;
  const apDefaultId = `acc_ap_def_${suffix}`;
  const apCustomId = `acc_ap_cust_${suffix}`;
  const fxGainLossId = `acc_unrl_fx_${suffix}`;
  const depExpId = `acc_dep_exp_${suffix}`;
  const accumDepId = `acc_accum_dep_${suffix}`;

  await db.collection('workspaces').doc(wsId).set({
    id: wsId,
    name: 'Probe 05 FX Cutoff & Depreciation Tamper',
    uid: ownerUid,
    currency: 'USD',
    roles: { [ownerUid]: 'owner', [bookkeeperUid]: 'bookkeeper' },
    defaultAccountMappings: { ar: arId, ap: apDefaultId },
  });

  const chart: ChartAccount[] = [
    { id: arId, workspaceId: wsId, name: 'Accounts Receivable', code: '1100', type: 'asset', systemRole: 'ar' } as ChartAccount,
    { id: apDefaultId, workspaceId: wsId, name: 'Accounts Payable Default', code: '2000', type: 'liability', systemRole: 'ap' } as ChartAccount,
    { id: apCustomId, workspaceId: wsId, name: 'Trade Payables Europe', code: '2010', type: 'liability', systemRole: 'ap' } as ChartAccount,
    { id: fxGainLossId, workspaceId: wsId, name: 'Unrealized FX Gain/Loss', code: '7100', type: 'expense' } as ChartAccount,
    { id: depExpId, workspaceId: wsId, name: 'Depreciation Expense', code: '6200', type: 'expense' } as ChartAccount,
    { id: accumDepId, workspaceId: wsId, name: 'Accumulated Depreciation', code: '1590', type: 'asset' } as ChartAccount,
  ];
  for (const acc of chart) {
    await db.collection('chartAccounts').doc(acc.id).set(acc);
  }

  // Invoice #1: Issued 2026-09-15 (€1,000 at 1.10), WAS open on 2026-09-30, paid later on 2026-10-15
  await db.collection('invoices').doc(`inv_sep_${suffix}`).set({
    id: `inv_sep_${suffix}`,
    workspaceId: wsId,
    uid: ownerUid,
    number: 'INV-SEP-001',
    customerId: 'cust_1',
    date: '2026-09-15',
    currency: 'EUR',
    exchangeRate: 1.10,
    amountCents: 100000,
    amountPaidCents: 100000,
    status: 'paid',
    arAccountId: arId,
    posted: true,
  });

  // Bill #2: Issued 2026-10-20 (AFTER 2026-09-30!), €2,000 at 1.10, custom apAccountId = apCustomId
  await db.collection('bills').doc(`bill_oct_${suffix}`).set({
    id: `bill_oct_${suffix}`,
    workspaceId: wsId,
    uid: ownerUid,
    number: 'BILL-OCT-002',
    vendorId: 'vend_1',
    date: '2026-10-20',
    currency: 'EUR',
    exchangeRate: 1.10,
    amountCents: 200000,
    amountPaidCents: 0,
    status: 'approved',
    apAccountId: apCustomId,
    posted: true,
  });

  const reval = await revaluateForeignBalances(db, {
    workspaceId: wsId,
    user: { uid: ownerUid, email: 'owner@test.local' },
    date: '2026-09-30',
    dryRun: true,
    rates: { EUR: 1.20 },
  });

  // Part B: Fixed asset depreciation + authenticated bookkeeper RLS tamper on `public.assets`
  const assetId = `asset_${suffix}`;
  await db.collection('assets').doc(assetId).set({
    id: assetId,
    workspaceId: wsId,
    name: 'CNC Router',
    purchaseDate: '2026-01-01',
    purchasePriceCents: 120000, // $1,200 over 1 year => $100/mo => through 2026-06 (5 full months Feb-Jun or Jan-Jun)
    salvageValueCents: 0,
    usefulLifeYears: 1,
    depreciationMethod: 'straight-line',
    status: 'active',
    expenseAccountId: depExpId,
    accumulatedAccountId: accumDepId,
    accumulatedDepreciationCents: 0,
  });

  const depRun1 = await runDepreciation(db, { workspaceId: wsId, uid: ownerUid, month: '2026-06' });

  // Direct browser/RLS client UPDATE as bookkeeper resetting accumulatedDepreciationCents -> 0!
  const pool = new Pool({ connectionString: process.env.LF_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/lf_test' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE authenticated`);
    await client.query(
      `SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: bookkeeperUid, role: 'authenticated', email: 'bk@test.local' })],
    );
    const upd = await client.query(
      `UPDATE public.assets
          SET data = jsonb_set(jsonb_set(data, '{accumulatedDepreciationCents}', '0'::jsonb), '{depreciatedThrough}', 'null'::jsonb)
        WHERE id = $1`,
      [assetId],
    );
    assert.equal(upd.rowCount, 1, 'Authenticated bookkeeper RLS UPDATE succeeded on public.assets');
    await client.query('COMMIT');
  } finally {
    client.release();
    await pool.end();
  }

  const depRun2 = await runDepreciation(db, { workspaceId: wsId, uid: ownerUid, month: '2026-06' });
  const txs = (await db.collection('transactions').where('workspaceId', '==', wsId).get())
    .docs.map(d => ({ ...d.data(), id: d.id }) as Transaction);
  const pl = computeProfitAndLoss(chart, txs, '2026-01-01', '2026-12-31');

  console.log(JSON.stringify({
    probe: 'A7N-05_fx_reval_cutoff_and_A7N-06_depreciation_tamper',
    fxRevalAsOfSep30: {
      revaluedDocIds: reval.details.map(d => ({ id: d.id, number: d.number })),
      revalLines: reval.lines.map(l => ({ accountId: l.accountId, amountCents: l.amountCents })),
      expectedSepInvoiceIncluded: false,
      futureOctBillIncludedInSepReval: reval.details.some(d => d.number === 'BILL-OCT-002'),
      billUsedDefaultApInsteadOfCustomAp: reval.lines.some(l => l.accountId === apDefaultId),
    },
    depreciationDoublePost: {
      run1TotalCents: depRun1.totalCents,
      run2TotalCents: depRun2.totalCents,
      glDepreciationExpenseCents: pl.expense.accounts[depExpId]?.balance,
    },
  }, null, 2));

  assert.equal(reval.details.some(d => d.number === 'INV-SEP-001'), false);
  assert.equal(reval.details.some(d => d.number === 'BILL-OCT-002'), true);
  assert.equal(reval.lines.some(l => l.accountId === apDefaultId), true);
  assert.equal(reval.lines.some(l => l.accountId === apCustomId), false);
  assert.ok(depRun1.totalCents > 0);
  assert.equal(depRun2.totalCents, depRun1.totalCents);
  assert.equal(pl.expense.accounts[depExpId]?.balance, depRun1.totalCents * 2, 'GL depreciation expense doubled');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
