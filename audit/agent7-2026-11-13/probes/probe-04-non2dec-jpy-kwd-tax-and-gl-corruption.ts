/**
 * Agent #7 Probe 04 (2026-11-13) — A7N-04
 * Proves against live PostgreSQL 16.2 (`lf_test`) + pure tax/compliance engines that non-2-decimal
 * foreign currencies (`JPY` 0-decimal, `KWD` 3-decimal) suffer 100x / 10x miscalculations across:
 *   1. `recomputeDocumentTax` (`src/lib/taxRecompute.ts:77` + `src/server/services/taxRecomputeService.ts`) —
 *      ACTUALLY POSTS A CORRUPTED `-6,633` CENT (`-$66.33`) `tax-adjustment` ENTRY INTO THE GENERAL LEDGER
 *      on a completely valid `¥100,000 JPY` + `¥10,000` tax bill (`$67.00` USD tax)!
 *   2. `buildTaxReturn` / `computeTaxReturn` (`src/lib/taxCodes.ts:265`) & `taxByRate` (`src/lib/taxReturnDocs.ts:98`)
 *   3. `israelVatReturn` (`src/lib/tax/ilVatReturn.ts`) + `computeWorkspaceTaxReturn` (`src/server/services/taxReturnService.ts:31-38`
 *      also omits fixed-asset input VAT box `fixedAssetInputVatCents` on `vat:IL` registrations!)
 *   4. `needsAllocationNumber` (`src/lib/tax/ilAllocation.ts:30`) — misses mandatory ITA 9-digit allocation numbers on JPY B2B invoices!
 *   5. `usSalesTaxReturn` (`src/lib/tax/usSalesTaxReturn.ts:52,88`) & `usNexusWatch` (`src/lib/tax/usNexusWatch.ts:154`) —
 *      hides crossed $100k US economic nexus thresholds on JPY sales!
 *   6. `documentLine` (`src/lib/prepaidSchedule.ts:87`) — 100x understates JPY prepaid bill prefill!
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.SYSTEM_SALT ||= 'probe-test-salt-2026';
import { getDb } from '../../../src/server/db/firestore';
import { convertMinorUnits } from '../../../src/lib/currencyMinorUnits';
import { recomputeDocumentTax } from '../../../src/server/services/taxRecomputeService';
import { buildTaxReturn, taxByRate } from '../../../src/lib/taxReturnDocs';
import { israelVatReturn } from '../../../src/lib/tax/ilVatReturn';
import { computeWorkspaceTaxReturn } from '../../../src/server/services/taxReturnService';
import { allocationThresholdCents, needsAllocationNumber } from '../../../src/lib/tax/ilAllocation';
import { usSalesTaxReturn } from '../../../src/lib/tax/usSalesTaxReturn';
import { usNexusWatch } from '../../../src/lib/tax/usNexusWatch';
import { documentLine } from '../../../src/lib/prepaidSchedule';
import type { Bill, ChartAccount, Invoice } from '../../../src/types';

async function main() {
  const db = getDb();
  const suffix = crypto.randomUUID().slice(0, 8);
  const wsId = `ws_probe04_${suffix}`;
  const uid = `u_probe04_${suffix}`;

  const apId = `acc_ap_${suffix}`;
  const expId = `acc_exp_${suffix}`;
  const taxAssetId = `acc_tax_${suffix}`;
  const billId = `bill_jpy_${suffix}`;
  const billTxId = `tx_bill_jpy_${suffix}`;

  const ilProfiles = {
    books: {
      name: 'IL HQ',
      registrations: [{ kind: 'vat' as const, place: { country: 'IL' }, number: '515000000', validFrom: '2020-01-01', frequency: 'monthly' as const }],
    },
    entities: {},
  };

  await db.collection('workspaces').doc(wsId).set({
    id: wsId,
    name: 'Probe 04 Non-2-Decimal Tax & GL Corruption',
    uid,
    currency: 'USD',
    roles: { [uid]: 'owner' },
    defaultAccountMappings: { ap: apId, inputTax: taxAssetId },
    taxProfiles: ilProfiles,
  });

  const chart: ChartAccount[] = [
    { id: apId, workspaceId: wsId, name: 'Accounts Payable', code: '2000', type: 'liability', systemRole: 'ap' } as ChartAccount,
    { id: expId, workspaceId: wsId, name: 'Cloud Hosting', code: '5100', type: 'expense' } as ChartAccount,
    { id: taxAssetId, workspaceId: wsId, name: 'Input VAT Receivable', code: '1300', type: 'asset', systemRole: 'tax_receivable' } as ChartAccount,
  ];
  for (const acc of chart) {
    await db.collection('chartAccounts').doc(acc.id).set(acc);
  }

  // 1) Valid JPY bill: ¥100,000 net + ¥10,000 tax = ¥110,000 JPY at 0.0067 USD/JPY
  //    True USD amounts via convertMinorUnits: $670.00 (67000c) net + $67.00 (6700c) tax = $737.00 (73700c) A/P.
  const trueNetUsdCents = convertMinorUnits(100000, 0.0067, 'JPY', 'USD'); // 67000
  const trueTaxUsdCents = convertMinorUnits(10000, 0.0067, 'JPY', 'USD');  // 6700
  const trueTotalUsdCents = trueNetUsdCents + trueTaxUsdCents;             // 73700

  await db.collection('bills').doc(billId).set({
    id: billId,
    workspaceId: wsId,
    uid,
    number: 'BILL-JPY-001',
    vendorId: 'vend_tokyo',
    vendorName: 'Tokyo Cloud KK',
    date: '2026-10-10',
    dueDate: '2026-11-10',
    currency: 'JPY',
    exchangeRate: 0.0067,
    subtotalCents: 100000,
    taxRate: 10,
    taxCents: 10000,
    amountCents: 110000,
    status: 'pending',
    posted: true,
    fixedAsset: true,
    apAccountId: apId,
    taxAccountId: taxAssetId,
    splits: [{ accountId: expId, accountName: 'Cloud Hosting', amountCents: 100000, taxRate: 10 }],
  });

  // Properly posted GL accrual entry matching TransactionTemplates descriptions (`bill-accrual`)
  await db.collection('transactions').doc(billTxId).set({
    id: billTxId,
    workspaceId: wsId,
    uid,
    date: '2026-10-10',
    description: 'Bill BILL-JPY-001',
    status: 'completed',
    type: 'actual',
    currency: 'JPY',
    exchangeRate: 0.0067,
    totalAmountCents: trueTotalUsdCents,
    billId,
    metadata: { type: 'bill-accrual', billId },
    lines: [
      { id: 'l1', accountId: expId, accountName: 'Cloud Hosting', description: `Expense posting for Bill ${billId}`, amountCents: 100000, baseAmountCents: trueNetUsdCents },
      { id: 'l2', accountId: taxAssetId, accountName: 'Input VAT Receivable', description: `Input tax recoverable on Bill ${billId}`, amountCents: 10000, baseAmountCents: trueTaxUsdCents },
      { id: 'l3', accountId: apId, accountName: 'Accounts Payable', description: `Payable for Bill ${billId}`, amountCents: -110000, baseAmountCents: -trueTotalUsdCents },
    ],
  });

  const recomputeRes = await recomputeDocumentTax(db, {
    workspaceId: wsId,
    uid,
    apply: true,
    date: '2026-10-15',
  });

  // 2) buildTaxReturn & taxByRate on JPY & KWD invoices
  const jpyInv = {
    id: 'inv_jpy', workspaceId: wsId, number: 'INV-JPY', date: '2026-10-05', status: 'sent',
    currency: 'JPY', exchangeRate: 0.0067, subtotalCents: 100000, taxRate: 10, taxCents: 10000, amountCents: 110000,
    items: [{ description: 'SaaS', quantity: 1, unitPriceCents: 100000, amountCents: 100000, taxRate: 10 }],
    shippingAddress: { country: 'US', state: 'WA' },
  } as unknown as Invoice;

  const kwdInv = {
    id: 'inv_kwd', workspaceId: wsId, number: 'INV-KWD', date: '2026-10-05', status: 'sent',
    currency: 'KWD', exchangeRate: 3.25, subtotalCents: 100000, taxRate: 10, taxCents: 10000, amountCents: 110000,
    items: [{ description: 'Advisory', quantity: 1, unitPriceCents: 100000, amountCents: 100000, taxRate: 10 }],
  } as unknown as Invoice;

  const trJpy = buildTaxReturn({ invoices: [jpyInv], bills: [], startDate: '2026-10-01', endDate: '2026-10-31' });
  const trKwd = buildTaxReturn({ invoices: [kwdInv], bills: [], startDate: '2026-10-01', endDate: '2026-10-31' });
  const byRateJpy = taxByRate({ invoices: [jpyInv], bills: [], startDate: '2026-10-01', endDate: '2026-10-31' });

  // 3) IL VAT Return & taxReturnService vat:IL box check
  const billDoc = (await db.collection('bills').doc(billId).get()).data() as Bill;
  const ilVat = israelVatReturn({
    registration: 'vat:IL:515000000',
    profiles: ilProfiles,
    order: [],
    invoices: [],
    bills: [billDoc],
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  });
  const wsVatIl = await computeWorkspaceTaxReturn(
    db,
    wsId,
    '2026-10-01',
    '2026-10-31',
    { registration: 'vat:IL:515000000', profiles: ilProfiles, order: [] },
  );

  // 4) IL Allocation Number on ¥5,000,000 JPY B2B invoice at 0.024 ILS/JPY (= ₪120,000 ILS net > ₪5,000 Oct-2026 threshold!)
  const allocNeeded = needsAllocationNumber({
    date: '2026-10-15',
    netCents: 5_000_000,
    taxCents: 900_000,
    currency: 'JPY',
    exchangeRate: 0.024,
    buyerVatNumber: '514999999',
  });

  // 5) US Sales Tax & Economic Nexus Watch on ¥20,000,000 JPY Washington sales (= $134,000 USD > $100,000 WA nexus threshold!)
  const bigJpyWaInv = {
    ...jpyInv,
    subtotalCents: 20_000_000,
    amountCents: 20_000_000,
    taxCents: 0,
    taxRate: 0,
    items: [{ description: 'Enterprise License', quantity: 1, unitPriceCents: 20_000_000, amountCents: 20_000_000, taxRate: 0 }],
  } as unknown as Invoice;
  const nexus = usNexusWatch({ invoices: [bigJpyWaInv], customers: [], asOf: '2026-10-31' });
  const waWatch = nexus.states.find(s => s.state === 'WA');

  const waProfiles = {
    books: {
      name: 'US HQ',
      registrations: [{ kind: 'sales_tax' as const, place: { country: 'US', state: 'WA' }, number: 'WA-001', validFrom: '2020-01-01', frequency: 'monthly' as const }],
    },
    entities: {},
  };
  const usReturn = usSalesTaxReturn({
    registration: 'sales_tax:US-WA:WA-001',
    profiles: waProfiles,
    order: [],
    customers: [],
    invoices: [jpyInv],
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  });

  // 6) Prepaid schedule documentLine on JPY bill
  const prepaidPrefill = documentLine(billDoc, chart, 'expense');

  const jpyBox1 = trJpy.boxes.find(b => b.key === '1')?.cents;
  const kwdBox1 = trKwd.boxes.find(b => b.key === '1')?.cents;

  console.log(JSON.stringify({
    probe: 'A7N-04_non2dec_jpy_kwd_tax_and_gl_corruption',
    taxRecomputeGlCorruption: {
      postedTaxUsdCents: recomputeRes.differences[0]?.postedTaxCents,
      buggyExpectedTaxUsdCents: recomputeRes.differences[0]?.expectedTaxCents,
      corruptedGlAdjustmentCents: recomputeRes.differences[0]?.differenceCents,
      postedAdjustmentTxId: recomputeRes.posted[0]?.transactionId,
    },
    taxReturnAndByRate: {
      jpyBox1Cents: jpyBox1,
      jpyByRateSalesTaxCents: byRateJpy[0]?.salesTaxCents,
      jpyTrueUsdCents: 6700,
      kwdBox1Cents: kwdBox1,
      kwdTrueUsdCents: convertMinorUnits(10000, 3.25, 'KWD', 'USD'),
    },
    israelVatAndServiceMismatch: {
      trueFixedAssetInputVatUsdCents: 6700,
      buggyIlVatFixedAssetInputVatCents: ilVat.fixedAssetInputVatCents,
      wsTaxReturnHasFixedAssetBox: wsVatIl.boxes.some(b => /asset|tshumot/i.test(b.label)),
    },
    ilAllocationNumber: {
      trueNetIlsAgorot: convertMinorUnits(5_000_000, 0.024, 'JPY', 'ILS'),
      thresholdIlsAgorot: allocationThresholdCents('2026-10-15'),
      buggyNeededResult: allocNeeded,
    },
    usNexusAndSalesTax: {
      trueWaSalesUsdCents: convertMinorUnits(20_000_000, 0.0067, 'JPY', 'USD'),
      buggyWaSalesUsdCents: waWatch?.thisYear?.salesCents,
      waNexusCrossed: waWatch?.crossed,
      trueWaTaxUsdCents: 6700,
      buggyUsSalesTaxCollectedUsdCents: usReturn.taxCollectedCents,
    },
    prepaidSchedulePrefill: {
      trueExpenseUsdCents: 67000,
      buggyExpenseUsdCents: prepaidPrefill?.baseCents,
    },
  }, null, 2));

  assert.equal(recomputeRes.differences[0]?.differenceCents, -6633);
  assert.equal(recomputeRes.posted.length, 1, 'taxRecomputeService posted a corrupted -6633c adjustment to GL');
  assert.equal(jpyBox1, 67);
  assert.equal(byRateJpy[0]?.salesTaxCents, 67);
  assert.equal(kwdBox1, 32500);
  assert.equal(ilVat.fixedAssetInputVatCents, 67);
  assert.equal(allocNeeded, false, 'JPY B2B invoice falsely skipped mandatory ITA allocation number');
  assert.equal(waWatch?.crossed, false, 'JPY WA sales falsely missed $100k US economic nexus threshold');
  assert.equal(usReturn.taxCollectedCents, 67);
  assert.equal(prepaidPrefill?.baseCents, 670);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
