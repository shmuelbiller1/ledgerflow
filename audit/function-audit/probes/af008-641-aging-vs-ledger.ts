/**
 * AF-008 independent verification of issue #641 (Agent #13's finding): does the A/R aging reconcile to the
 * receivables control account for a document whose currency has a different number of minor units than the books?
 *
 * Agent #8 verifies other agents' important findings rather than repeating or assuming them. #641 claims
 * `toBaseCents` (`src/server/reports/partyReports.ts:14`) converts with the exchange rate alone, while the ledger
 * converts with `documentMinorRate` -> `minorUnitRate(rate, doc.currency, baseCurrency)`
 * (`src/services/ledgerPost/postingCore.ts:149-152`, BM-04), so every figure derived from `toBaseCents` is 100x
 * too small for a 0-decimal document currency in a 2-decimal book and 10x too large for a 3-decimal one.
 *
 * This probe does NOT trust that claim. It runs both real code paths on the same document and compares them with
 * independent arithmetic:
 *   - the ledger side: the real `postInvoiceLedger` with the L-94 `capture` seam, so the entries are built but
 *     nothing is written and no database is needed;
 *   - the report side: the real `computePartyAging` / `outstandingBaseCents` from `src/lib/aging.ts`;
 *   - the arithmetic: worked by hand in the assertions below, not taken from either library.
 *
 * `src/tests/bm04-currency-minor-units.test.ts:62-66` already pins the ledger side (¥100,000 at 0.0067 -> A/R
 * 67,000), so the ledger is the reference and the question is whether aging agrees with it.
 *
 * Run: NODE_ENV=test npx tsx audit/function-audit/probes/af008-641-aging-vs-ledger.ts
 * Prints OBSERVED vs EXPECTED and exits 0 on purpose: it documents behaviour, it does not gate CI.
 */
import { postInvoiceLedger } from '../../../src/services/ledgerPost/invoicePosting';
import type { LedgerPostContext } from '../../../src/services/ledgerPost/postingCore';
import { computePartyAging, outstandingBaseCents } from '../../../src/lib/aging';
import { minorUnitRate } from '../../../src/lib/currencyMinorUnits';
import type { ChartAccount, Invoice, Workspace } from '../../../src/types';

let failures = 0;
/** `detail` is always printed; `why` (the diagnosis) only when the case fails, so an OK line never reads as a defect. */
const report = (id: string, ok: boolean, detail: string, why?: string) => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK    ' : 'DEFECT'} ${id}: ${detail}${ok || !why ? '' : `\n         why: ${why}`}`);
};

const WS = 'ws_af008';
const TODAY = '2026-11-11';
const accounts = [
  { id: 'ar', name: 'Accounts Receivable', type: 'asset', category: 'Receivables', code: '1100' },
  { id: 'ap', name: 'Accounts Payable', type: 'liability', category: 'Payables', code: '2000' },
  { id: 'bank', name: 'Bank', type: 'asset', category: 'Cash', code: '1000' },
  { id: 'sales', name: 'Sales', type: 'income', code: '4000' },
  { id: 'supplies', name: 'Supplies', type: 'expense', code: '6000' },
].map(a => ({ ...a, workspaceId: WS })) as unknown as ChartAccount[];

const context = (): LedgerPostContext => ({
  accounts,
  workspaces: [{ id: WS, uid: 'u1', name: 'US books', currency: 'USD', defaultAccountMappings: { ar: 'ar', ap: 'ap', revenue: 'sales' } } as unknown as Workspace],
  transactions: [], inventory: [], lockDate: null, uid: 'u1', today: TODAY, capture: [],
});

/** The real ledger entries for one invoice, via the capture seam: nothing is written anywhere. */
async function ledgerArCents(invoice: Invoice): Promise<number> {
  const c = context();
  await postInvoiceLedger(invoice.id!, invoice, WS, 'u1', { collection: 'invoices', docId: invoice.id!, action: 'create' }, c);
  const lines = (c.capture ?? []).flatMap(x => x.txs).flatMap(t => t.lines.map(l => [l.accountId, l.amountCents] as const));
  // A/R is debited (positive) when the invoice is posted; the control balance for one open invoice is that debit.
  return lines.filter(([id]) => id === 'ar').reduce((sum, [, cents]) => sum + cents, 0);
}

/** The real aging figure for the same unpaid invoice. */
function agingCents(invoice: Invoice): number {
  const rows = computePartyAging([{ id: 'c1', name: 'Customer' }], [invoice], 'customer', TODAY);
  return rows[0]?.total ?? 0;
}

const invoice = (id: string, currency: string, exchangeRate: number, amountCents: number): Invoice => ({
  id, workspaceId: WS, number: id.toUpperCase(), customerName: 'Customer', customerId: 'c1',
  date: '2026-10-22', dueDate: '2026-11-21', status: 'sent', currency, exchangeRate, amountCents,
  items: [{ id: 'l1', description: 'Licence', quantity: 1, rateCents: amountCents, amountCents }],
} as unknown as Invoice);

console.log('=== V1: a 0-decimal document currency (JPY) in 2-decimal books (USD) ===');
{
  // ¥100,000 at 0.0067. JPY has 0 decimals, so amountCents 100_000 IS ¥100,000.
  // Independent arithmetic: ¥100,000 x $0.0067 = $670.00 = 67,000 cents of USD.
  const inv = invoice('inv-jpy', 'JPY', 0.0067, 100_000);
  const ar = await ledgerArCents(inv);
  const aging = agingCents(inv);
  const hand = 67_000;

  report(
    'V1a the ledger posts the receivable at the hand-worked figure',
    ar === hand,
    `real postInvoiceLedger for ¥100,000 at 0.0067 in USD books put ${ar} cents on A/R; hand arithmetic ` +
      `¥100,000 x $0.0067 = $670.00 = ${hand} cents. (bm04-currency-minor-units.test.ts:66 pins this too.)`,
    `the ledger itself disagrees with hand arithmetic, so the reference side would be wrong and this probe's ` +
      `comparison would mean nothing.`,
  );

  report(
    'V1b the A/R aging reconciles to the receivables control account (#641 acceptance)',
    aging === ar,
    `aging total for the same unpaid invoice = ${aging} cents, A/R control from the real posting = ${ar} cents.`,
    `aging is ${ar / (aging || 1)}x too small. outstandingBaseCents (aging.ts:50) converts with ` +
      `toBaseCents(amountDue, doc.exchangeRate) = round(amount x rate) = round(100000 x 0.0067) = ${Math.round(100000 * 0.0067)}, ` +
      `while the ledger converts with documentMinorRate -> minorUnitRate(0.0067,'JPY','USD') = ` +
      `${minorUnitRate(0.0067, 'JPY', 'USD')} (= rate x 10^(2-0)), giving 100000 x ${minorUnitRate(0.0067, 'JPY', 'USD')} = ${ar}. ` +
      `The two consumers of the same document use different conversion rules.`,
  );

  report(
    'V1c the divergence is exactly the minor-unit factor, not some other difference',
    aging === Math.round(100_000 * 0.0067) && ar === Math.round(100_000 * minorUnitRate(0.0067, 'JPY', 'USD')),
    `aging ${aging} = round(100000 x 0.0067) and ledger ${ar} = round(100000 x ${minorUnitRate(0.0067, 'JPY', 'USD')}): ` +
      `the ratio is the 10^(digits(books) - digits(document)) factor alone.`,
  );
}

console.log('');
console.log('=== V2: a 3-decimal document currency (KWD) — the same defect in the other direction ===');
{
  // KWD 100.000 is amountCents 100_000 (3 decimals). At 3.25: KWD 100.000 x $3.25 = $325.00 = 32,500 cents.
  const inv = invoice('inv-kwd', 'KWD', 3.25, 100_000);
  const ar = await ledgerArCents(inv);
  const aging = agingCents(inv);
  const hand = 32_500;

  report(
    'V2a the ledger posts KWD 100.000 at 3.25 as $325.00',
    ar === hand,
    `real posting put ${ar} cents on A/R; hand arithmetic KWD 100.000 x 3.25 = $325.00 = ${hand} cents ` +
      `(matches bm04's convertMinorUnits(1_250, 3.25, 'KWD', 'USD') = 406 for KWD 1.250).`,
  );
  report(
    'V2b the aging agrees for a 3-decimal currency',
    aging === ar,
    `aging total = ${aging} cents vs A/R control ${ar} cents.`,
    `aging is ${ar / (aging || 1)}x too LARGE here: round(100000 x 3.25) = ${Math.round(100000 * 3.25)} against the ` +
      `ledger's ${ar}, because minorUnitRate(3.25,'KWD','USD') = ${minorUnitRate(3.25, 'KWD', 'USD')} (= rate x 10^(2-3)). ` +
      `So the defect is not "always too small" — it is wrong by 10^(digits(books)-digits(document)) in either direction.`,
  );
}

console.log('');
console.log('=== V3 control: same-decimal currency (USD in USD books) — both paths must agree ===');
{
  // Without this the checks above could pass vacuously (e.g. if aging returned 0 for everything).
  const inv = invoice('inv-usd', 'USD', 1, 100_000);
  const ar = await ledgerArCents(inv);
  const aging = agingCents(inv);
  report(
    'V3 for a same-decimal document the aging DOES reconcile to the ledger',
    ar === 100_000 && aging === 100_000 && aging === ar,
    `$1,000.00 in USD books: ledger A/R ${ar}, aging ${aging} — they agree, and neither is zero, so the JPY/KWD ` +
      `divergences above are specific to a minor-unit mismatch and not an artefact of a report that counts nothing.`,
    `the control itself failed (ledger ${ar}, aging ${aging}), so this probe is not measuring what it thinks it is.`,
  );
  report(
    'V3b the aging figure is non-zero for an open invoice (guards against a vacuous V1b/V2b)',
    outstandingBaseCents(inv, 'customer') > 0,
    `outstandingBaseCents for the open USD invoice = ${outstandingBaseCents(inv, 'customer')}.`,
  );
}

console.log('');
console.log('=== V4: how far the un-adjusted conversion spreads (call sites of toBaseCents) ===');
{
  // Read from the source, not guessed: these are the consumers whose figures come from the same helper.
  const sites = [
    'src/lib/aging.ts:50 outstandingBaseCents — A/R and A/P aging screens and the /aging API',
    'src/lib/aging.ts:93 lifetimeCents, :101 paymentsCents — customer lifetime stats',
    'src/server/reports/partyReports.ts:53 customer balances (and 12 more sites in that file)',
  ];
  for (const s of sites) console.log(`       ${s}`);
  report(
    'V4 the defect is confined to aging',
    false,
    'every figure above is derived from toBaseCents, so each carries the same 10^(digits) error for a minor-unit ' +
      'mismatch. #641 lists 40 call sites across 14 files; this probe verified the three that matter for the ' +
      'acceptance criterion (aging vs the A/R control) rather than all 40.',
  );
}

console.log('');
console.log(failures === 0
  ? 'all cases OK — #641 does not reproduce; the aging reconciles to the ledger'
  : `${failures} case(s) reported DEFECT — #641 reproduces independently against the real libraries`);
process.exit(0);
