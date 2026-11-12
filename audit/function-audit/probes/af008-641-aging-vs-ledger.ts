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
 * 67,000), so the ledger is the reference and the question is whether the consumers agree with it.
 *
 * What this probe found, in the order it was added:
 *   V1-V3  aging (issue #641's own claim) — confirmed, with a KWD case showing the error is bidirectional and a
 *          USD control showing the divergence is specific to a minor-unit mismatch.
 *   V4     how far the un-adjusted conversion spreads (41 call sites).
 *   V5     **escalation**: the FX revaluation POSTS. fxRevaluation.ts:196-197 converts un-adjusted on both sides and
 *          fxRevaluationService.ts:286-287 writes the entry and its reversal to the ledger, so a month-end
 *          revaluation run writes a balanced, audit-logged, 100x-wrong gain/loss. Reachable from
 *          FxRevaluationPanel.tsx:101 -> /api/v1/transactions/revaluation/{kind} -> periodRoutes.ts:39.
 *          This corrects #641's framing (and this agent's first reading of it) that the damage is confined to
 *          derived reports with the ledger correct.
 *   V6     **escalation**: the invoice approval LIMIT is bypassed. invoiceApproval.ts:127-135 decides whether an
 *          invoice needs approval from the same un-adjusted total, and that decision is enforced server-side at
 *          invoiceApprovalGuard.ts:47 (via ledgerBulkCommit.ts:2) and documentEmailService.ts:96. A $670.00
 *          invoice over a $500.00 limit is treated as under the limit, so no approval record is created and the
 *          send is not held. V6e/V6f are the controls that isolate the currency as the only cause.
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
    'V1c the aging uses the same minor-unit conversion as the ledger (fixed 2026-11-12: #641)',
    aging === ar && ar === Math.round(100_000 * minorUnitRate(0.0067, 'JPY', 'USD')),
    `aging ${aging} = ledger ${ar} = round(100000 x ${minorUnitRate(0.0067, 'JPY', 'USD')}) — the two consumers of the ` +
      `same document agree, so #641's 10^(digits(books) - digits(document)) divergence is gone at this pin.`,
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
  // #641's fix landed in the helper itself (toBaseCents -> convertMinorUnits with the document and base currency),
  // so every consumer listed above inherits it. Checked here rather than assumed.
  const { toBaseCents } = await import('../../../src/server/reports/partyReports');
  const helper = toBaseCents(100_000, 0.0067, 'JPY', 'USD');
  report(
    'V4 the shared helper itself now converts with the currency minor units (fixed 2026-11-12: #641)',
    helper === 67_000,
    `toBaseCents(¥100,000 at 0.0067, JPY -> USD) = ${helper} cents (correct 67,000), so every caller listed above ` +
      `carries the fix. Sites still holding their own inline conversion are outside the helper and are #651's ` +
      `case (V7/V8) — both fixed on this branch.`,
  );
}




// --------------------------------------------------------------------------------------------
// V5: does the same divergence reach a POSTED entry? #641 frames the damage as confined to derived
// reports, but `fxRevaluation.ts:196-197` converts with the same un-adjusted rate on BOTH sides,
// and `fxRevaluationService.ts:286-287` writes the resulting entry and its reversal to the ledger.
// If so, a revaluation run posts a wrong gain/loss — which is a posted figure, not a report.
// --------------------------------------------------------------------------------------------
console.log('');
console.log('=== V5: the FX revaluation run — a POSTED entry, not a report ===');
{
  const { planFxRevaluation } = await import('../../../src/lib/fxRevaluation');
  // ¥100,000 open, booked at 0.0067, today 0.0070. JPY has 0 decimals.
  // The ledger already booked this receivable at 67,000 cents (V1a above, verified by the real posting).
  const doc = {
    id: 'inv-jpy', side: 'customer' as const, status: 'sent', number: 'INV-JP1', partyName: 'Customer',
    currency: 'JPY', exchangeRate: 0.0067, amountCents: 100_000,
    accountId: 'ar', accountName: 'Accounts Receivable', accountCurrency: 'USD',
  } as never;
  const plan = planFxRevaluation([doc], () => 0.0070, { id: 'fxgl', name: 'FX Gain/Loss', accountCurrency: 'USD' } as never, 'USD');
  const d = plan.details[0];

  // Independent arithmetic. Booked value = what the ledger actually posted = ¥100,000 x 0.67 = $670.00 = 67,000.
  // Today value = ¥100,000 x 0.70 = $700.00 = 70,000. The real gain is 70,000 - 67,000 = 3,000 cents = $30.00.
  const correctBooked = Math.round(100_000 * minorUnitRate(0.0067, 'JPY', 'USD'));
  const correctToday = Math.round(100_000 * minorUnitRate(0.0070, 'JPY', 'USD'));
  const correctDelta = correctToday - correctBooked;

  report(
    'V5a the revaluation reproduces what the ledger actually booked',
    d?.bookedBaseCents === correctBooked,
    `planFxRevaluation reports bookedBaseCents = ${d?.bookedBaseCents} for the ¥100,000 invoice; the real posting ` +
      `(V1a) put ${correctBooked} cents on A/R, and hand arithmetic gives ¥100,000 x ${minorUnitRate(0.0067, 'JPY', 'USD')} = ${correctBooked}.`,
    `bookedBaseCents is ${correctBooked / (d?.bookedBaseCents || 1)}x too small: fxRevaluation.ts:196 uses ` +
      `toBaseCents(openCents, bookedRate) = round(openCents x rate), the same un-adjusted conversion as aging, so it ` +
      `does not reproduce the value the ledger holds. Its own header comment (lines 20-22) claims the booked value ` +
      `is "the same two rules the aging and the customer balances use, so this entry and the A/R report cannot ` +
      `disagree" — that is true of the reports, but both are wrong against the ledger.`,
  );

  report(
    'V5b the gain/loss it would POST is correct',
    d?.deltaCents === correctDelta,
    `deltaCents = ${d?.deltaCents} (today ${d?.todayBaseCents} - booked ${d?.bookedBaseCents}); the correct figure is ` +
      `${correctDelta} cents (today ${correctToday} - booked ${correctBooked}), i.e. $${(correctDelta / 100).toFixed(2)}.`,
    `the entry fxRevaluationService.ts:286-287 writes to the ledger would carry ${d?.deltaCents} cents instead of ` +
      `${correctDelta} — ${correctDelta / (d?.deltaCents || 1)}x too small. Both sides are wrong (line 197 is ` +
      `Math.round(openCents x todayRate), also un-adjusted), and they do NOT cancel: the booked side understates by ` +
      `the same factor as the today side, so the difference is understated by that factor too. This escalates #641 ` +
      `from "derived reports only" to "a posted entry": a revaluation run on a JPY or KRW receivable writes a wrong ` +
      `gain/loss and a wrong reversal into the general ledger.`,
  );

  // `unpriced` is a string[], not a Set (fxRevaluation.ts:101), so this is .length — an earlier draft of this
  // probe read `.size`, got undefined, and made this control print DEFECT for a probe bug rather than a code bug.
  // A control that fails for the wrong reason is worse than no control: it hides whether the case is real.
  const linesSum = plan.lines.reduce((sum, l) => sum + l.amountCents, 0);
  report(
    'V5c the plan really valued the document, and its entry is well formed (guards against a vacuous V5a/V5b)',
    Boolean(d) && plan.unpriced.length === 0 && plan.skipped.length === 0 && plan.documentCount === 1
      && plan.lines.length === 2 && linesSum === 0 && plan.netGainCents === d?.deltaCents,
    `${plan.documentCount} document valued, ${plan.unpriced.length} unpriced, ${plan.skipped.length} skipped; ` +
      `${plan.lines.length} entry lines summing to ${linesSum} (balanced double entry), netGainCents ` +
      `${plan.netGainCents} = the detail's deltaCents, debitTotalCents ${plan.debitTotalCents}. So the wrong figures ` +
      `above come from the CONVERSION, not from the document being filtered out, skipped for a missing rate, or an ` +
      `unbalanced entry — the run looks entirely healthy, which is what makes it dangerous.`,
    `this control failed, so V5a/V5b are not measuring a healthy-but-wrong run: ` +
      `unpriced ${plan.unpriced.length}, skipped ${plan.skipped.length}, lines ${plan.lines.length}, ` +
      `linesSum ${linesSum}, documentCount ${plan.documentCount}, netGainCents ${plan.netGainCents} vs deltaCents ${d?.deltaCents}.`,
  );
}

// --------------------------------------------------------------------------------------------
// V6: does the same divergence defeat an INTERNAL CONTROL? #641 frames toBaseCents as a reporting
// helper, but invoiceApproval.ts:127-135 uses it to decide whether an invoice needs approval, and
// that decision is enforced SERVER-SIDE at two points:
//   - invoiceApprovalGuard.ts:47 serverApproval -> approvalForSave -> needsApproval (wired via
//     ledgerBulkCommit.ts:2), whose own docstring (lines 15-16) promises "an invoice that starts
//     going out over the limit without a record gets one ... so leaving the field out can't skip
//     the rule";
//   - documentEmailService.ts:96 holdsSending -> approvalStatus -> needsApproval, the gate that
//     refuses to email an over-limit invoice to the customer without a signature.
// If the total is understated 100x, an over-limit invoice is treated as under the limit and both
// gates open. That is a control bypass, not a wrong report.
// --------------------------------------------------------------------------------------------
console.log('');
console.log('=== V6: the invoice approval limit — an internal control, enforced server-side ===');
{
  const { needsApproval, approvalStatus, holdsSending, approvalForSave, invoiceTotalInWorkspaceCurrency } =
    await import('../../../src/lib/invoiceApproval');

  // A $500.00 approval limit, stored as cents of the workspace currency.
  const settings = { enabled: true, thresholdCents: 50_000 };

  // ¥100,000 at 0.0067 = $670.00 — OVER the $500 limit. The ledger books it at 67,000 cents (V1a).
  const jpy = { amountCents: 100_000, exchangeRate: 0.0067, status: 'sent', currency: 'JPY' };
  // The same $670.00 expressed as a USD invoice: 67,000 cents at rate 1.
  const usd = { amountCents: 67_000, exchangeRate: 1, status: 'sent', currency: 'USD' };

  // For the EMAIL GATE the document must be issued but must NOT have gone out yet. approvalStatus
  // (invoiceApproval.ts:153-158) returns 'not_needed' whenever hasAlreadyGoneOut(doc) is true, and
  // hasAlreadyGoneOut (:139-142) is true for status 'sent' — so with 'sent' the gate reads
  // 'not_needed' for EVERY currency and the comparison measures nothing. An earlier draft of this
  // probe made that mistake; control V6e is what caught it. 'pending' is issued (it is not in
  // NOT_SENT = draft/void/cancelled) and has not gone out (no lastSentAt, no sendCount).
  const jpyUnsent = { ...jpy, status: 'pending' };
  const usdUnsent = { ...usd, status: 'pending' };

  const correctTotal = 67_000; // $670.00, established by the real posting in V1a
  report(
    'V6a the approval rule sees the invoice total the ledger actually booked',
    invoiceTotalInWorkspaceCurrency(jpy as never) === correctTotal,
    `invoiceTotalInWorkspaceCurrency for ¥100,000 at 0.0067 = ${invoiceTotalInWorkspaceCurrency(jpy as never)} cents; ` +
      `the real posting (V1a) books ${correctTotal} cents on A/R, i.e. $670.00.`,
    `the approval rule compares ${invoiceTotalInWorkspaceCurrency(jpy as never)} against the threshold instead of ` +
      `${correctTotal} — ${correctTotal / (invoiceTotalInWorkspaceCurrency(jpy as never) || 1)}x too small, the same ` +
      `un-adjusted toBaseCents conversion as aging and the revaluation.`,
  );

  report(
    'V6b a $670 invoice over a $500 approval limit REQUIRES approval',
    needsApproval(jpy as never, settings) === true,
    `needsApproval for the JPY invoice over a $500.00 limit = ${needsApproval(jpy as never, settings)}.`,
    `**internal-control bypass.** round(100000 x 0.0067) = 670 is not > 50000, so the rule decides the invoice is ` +
      `UNDER the limit when it is really $670.00 over a $500.00 limit. Note ApprovalDoc (invoiceApproval.ts:77-84) has ` +
      `NO currency field at all, so this rule structurally cannot make the minor-unit adjustment without a signature change.`,
  );

  report(
    'V6c the server-side save guard creates an approval record for it',
    approvalForSave(jpy as never, settings, { role: 'bookkeeper', uid: 'u2', now: '2026-11-11T00:00:00Z', twoPerson: false }) !== null,
    `approvalForSave (called by serverApproval, invoiceApprovalGuard.ts:47) returned ` +
      `${JSON.stringify(approvalForSave(jpy as never, settings, { role: 'bookkeeper', uid: 'u2', now: '2026-11-11T00:00:00Z', twoPerson: false } as never))}.`,
    `it returned null, so the invoice is saved with NO approval record. The guard's own docstring promises the ` +
      `opposite: "an invoice that starts going out over the limit without a record gets one ... so leaving the field ` +
      `out can't skip the rule" (invoiceApprovalGuard.ts:15-16). A 0-decimal currency does skip it, server-side.`,
  );

  report(
    'V6d the email gate HOLDS the invoice until someone signs it',
    holdsSending(jpyUnsent as never, settings) === true && approvalStatus(jpyUnsent as never, settings) === 'awaiting',
    `for the issued-but-not-yet-sent ¥100,000 invoice: holdsSending = ${holdsSending(jpyUnsent as never, settings)}, ` +
      `approvalStatus = '${approvalStatus(jpyUnsent as never, settings)}'.`,
    `documentEmailService.ts:96-103 refuses to email an invoice when holdsSending is true and the sender is not an ` +
      `approver. Here holdsSending is ${holdsSending(jpyUnsent as never, settings)} and the status is ` +
      `'${approvalStatus(jpyUnsent as never, settings)}', so **the $670.00 invoice goes straight to the customer ` +
      `with no signature** — the gate never closes, because the same understated total decided the limit did not ` +
      `apply. This is the customer-facing half of the bypass: no approval record is created (V6c) AND the send is ` +
      `not held (here).`,
  );

  const usdStamp = approvalForSave(usdUnsent as never, settings, { role: 'bookkeeper', uid: 'u2', now: '2026-11-11T00:00:00Z', twoPerson: false } as never);
  report(
    'V6e control: the SAME $670.00 as a USD invoice IS caught by every gate',
    needsApproval(usd as never, settings) === true
      && holdsSending(usdUnsent as never, settings) === true
      && approvalStatus(usdUnsent as never, settings) === 'awaiting'
      && usdStamp !== null,
    `the identical economic amount expressed in USD (67,000 cents at rate 1): needsApproval ` +
      `${needsApproval(usd as never, settings)}, holdsSending ${holdsSending(usdUnsent as never, settings)}, status ` +
      `'${approvalStatus(usdUnsent as never, settings)}', approvalForSave ` +
      `${usdStamp ? `'${usdStamp.state}'` : 'null'}. So the gates DO work and the threshold IS set up correctly — ` +
      `the ONLY difference is the document currency's minor units. This is what makes V6b-V6d a currency-dependent ` +
      `control bypass rather than a broken or disabled approval feature.`,
    `the control failed, so V6b-V6d do not isolate the currency as the cause: needsApproval ` +
      `${needsApproval(usd as never, settings)}, holdsSending ${holdsSending(usdUnsent as never, settings)}, ` +
      `status '${approvalStatus(usdUnsent as never, settings)}', approvalForSave ${JSON.stringify(usdStamp)}.`,
  );

  report(
    'V6f control: with the document ALREADY sent, the email gate reads not_needed for BOTH currencies',
    approvalStatus(usd as never, settings) === 'not_needed' && approvalStatus(jpy as never, settings) === 'not_needed',
    `status for the sent USD invoice '${approvalStatus(usd as never, settings)}' and for the sent JPY invoice ` +
      `'${approvalStatus(jpy as never, settings)}' — identical, because hasAlreadyGoneOut short-circuits the rule ` +
      `(invoiceApproval.ts:156) and BE-04 deliberately never reaches an invoice back. Recorded so nobody reads V6d ` +
      `as "the email gate is broken for everyone": it is currency-dependent only for a document that has not yet ` +
      `gone out, which is the case the gate exists for.`,
  );
}

// --------------------------------------------------------------------------------------------
// V7: a NEW defect outside #641's blast radius. #641 lists 14 files that call toBaseCents; this is
// not one of them. salesReps.ts inlines the same un-adjusted conversion on a PAYMENT's rate:
//   :153  const rate = typeof p.exchangeRate === 'number' && p.exchangeRate > 0 ? p.exchangeRate : 1;
//   :161  const paidCents = Math.round(a.amountCents * rate);
// The repository already states the correct rule for this very data, in the server's own payment
// path, and names it:
//   paymentService.ts:385-386
//   // BM-04: minor units of the payment's currency -> minor units of the books' (¥ has none, KWD three)
//   const baseAmountCents = Math.round(amountCents * minorUnitRate(paymentRate, paymentCurrency, baseCurrency));
// Same document, same exchangeRate field, two different rules — one of them named and commented.
// --------------------------------------------------------------------------------------------
console.log('');
console.log('=== V7: sales-rep commission — NOT in #641\'s blast radius, and it contradicts BM-04 ===');
{
  const { commissionLines } = await import('../../../src/lib/salesReps');
  const reps = [{ id: 'r1', name: 'Rep', commissionPercent: 10, customerIds: ['c1'] }] as never;
  const inv = (id: string, currency: string, amountCents: number) => ({
    id, workspaceId: WS, number: id, customerId: 'c1', customerName: 'Customer', status: 'sent',
    date: '2026-10-22', currency, amountCents, taxAmountCents: 0,
    items: [{ id: 'l1', description: 'Licence', quantity: 1, rateCents: amountCents, amountCents }],
  } as unknown as Invoice);
  // 2026-11-12: the payment's own currency is now part of the shape (#651 was fixed by threading it through
  // and converting with `convertMinorUnits`). A row without it keeps the old rate-only reading (legacy data).
  const pay = (id: string, exchangeRate: number, amountCents: number, documentId: string, currency?: string) => ({
    id, status: 'posted', paymentDate: '2026-11-05', exchangeRate, currency,
    allocations: [{ documentId, documentType: 'invoice', amountCents }],
  });

  // A ¥100,000 invoice ($670.00 at 0.0067) paid in full, rep on 10%.
  // Independent arithmetic: commission = 10% of $670.00 = $67.00 = 6,700 cents.
  const jpyLines = commissionLines(reps, [inv('inv-jpy', 'JPY', 100_000)], [pay('p-jpy', 0.0067, 100_000, 'inv-jpy', 'JPY')], '2026-11-01', '2026-11-30', [], 'USD');
  const jpyCommission = jpyLines.reduce((sum, l) => sum + (l.commissionCents || 0), 0);
  const correct = 6_700;

  report(
    'V7a a 10% commission on a $670.00 sale is $67.00',
    jpyCommission === correct,
    `commissionLines for a ¥100,000 invoice paid in full at 0.0067, rep at 10%: ${jpyCommission} cents ` +
      `(${jpyLines.length} line(s)); hand arithmetic 10% of $670.00 = ${correct} cents.`,
    `commission is ${correct / (jpyCommission || 1)}x too small. salesReps.ts:161 converts the allocation with ` +
      `Math.round(a.amountCents * rate) using the payment's raw exchangeRate (:153), so paidCents = ` +
      `round(100000 x 0.0067) = ${Math.round(100_000 * 0.0067)} instead of round(100000 x ` +
      `${minorUnitRate(0.0067, 'JPY', 'USD')}) = ${Math.round(100_000 * minorUnitRate(0.0067, 'JPY', 'USD'))}. ` +
      `The repository already names the correct rule for this exact field at paymentService.ts:385-386 ` +
      `("BM-04: minor units of the payment's currency -> minor units of the books' (¥ has none, KWD three)") and ` +
      `uses minorUnitRate there. **This file is not in #641's list of 14** — it inlines the conversion instead of ` +
      `calling toBaseCents, so fixing the helper will not fix it.`,
  );

  // Control: the same $670.00 as a USD payment. rate 1 needs no adjustment, so commission must be right.
  const usdLines = commissionLines(reps, [inv('inv-usd', 'USD', 67_000)], [pay('p-usd', 1, 67_000, 'inv-usd', 'USD')], '2026-11-01', '2026-11-30', [], 'USD');
  const usdCommission = usdLines.reduce((sum, l) => sum + (l.commissionCents || 0), 0);
  report(
    'V7b control: the SAME $670.00 as a USD payment earns the correct commission',
    usdCommission === correct && usdLines.length === 1,
    `USD payment of 67,000 cents at rate 1, rep at 10%: ${usdCommission} cents over ${usdLines.length} line — ` +
      `the rep, the customer match, the 10% rate, the date window and the allocation all work, and the commission ` +
      `arithmetic is right. So V7a's 67 cents is caused by the currency's minor units alone, not by a commission ` +
      `feature that is off, unmatched or zero for everyone.`,
    `the control failed (USD commission ${usdCommission} over ${usdLines.length} lines), so V7a does not isolate ` +
      `the currency as the cause.`,
  );
}

// --------------------------------------------------------------------------------------------
// V8: a second NEW defect outside #641's blast radius, and worse in kind than V7 because it MIXES
// units inside one ratio. cashBasis.ts:107 takes a PAYMENT document's exchangeRate raw, and :114
// divides by `owed`, which comes from accrual lines explicitly normalised to base cents (:85 sets
// exchangeRate: 1 on every line, and the accrual is a POSTED transaction). So the numerator is an
// un-adjusted document-currency conversion and the denominator is base currency — the two sides of
// the division are not in the same units at all. `share` is what decides how much of an invoice's
// revenue is recognised on the cash-basis report when it is paid.
// The accrual used here is a REAL posted entry built by the capture seam in V1, whose metadata
// (type 'invoice-accrual' + invoiceId, invoicePosting.ts:180-182) is exactly what cashBasis.ts:44
// keys on, so this is the production data shape, not a stand-in.
// --------------------------------------------------------------------------------------------
console.log('');
console.log('=== V8: cash-basis revenue recognition — a ratio whose two sides are in different units ===');
{
  const { cashBasisEntries } = await import('../../../src/server/reports/cashBasis');

  // Build the accrual with the real posting, so it is a genuine posted entry in base cents.
  const c = context();
  const inv = invoice('inv-jpy-cb', 'JPY', 0.0067, 100_000);
  await postInvoiceLedger(inv.id!, inv, WS, 'u1', { collection: 'invoices', docId: inv.id!, action: 'create' }, c);
  const accrual = (c.capture ?? [])[0]?.txs[0] as never;

  // The same ¥100,000 paid in full: the allocation is in the PAYMENT's own minor units.
  const payment = {
    id: 'p-jpy', status: 'posted', paymentDate: '2026-11-05', exchangeRate: 0.0067, currency: 'JPY',
    allocations: [{ documentId: 'inv-jpy-cb', documentType: 'invoice' as const, amountCents: 100_000 }],
  };

  const out = cashBasisEntries(accounts, [accrual as never], [payment], 'USD');
  const paidEntry = out.entries.find(e => String(e.id).endsWith(':paid:p-jpy'));
  const recognised = (paidEntry?.lines || []).reduce((sum, l) => sum + Math.abs(l.amountCents || 0), 0);
  // Fully paid, so the whole $670.00 of revenue must be recognised: 67,000 cents.
  const correct = 67_000;

  report(
    'V8a an invoice paid IN FULL recognises all of its revenue on the cash-basis report',
    recognised === correct,
    `cashBasisEntries recognised ${recognised} cents of revenue for a ¥100,000 invoice paid in full ` +
      `(${out.entries.length} entries, ${out.leftOut} left out); the correct figure is ${correct} cents ($670.00).`,
    `only ${((recognised / correct) * 100).toFixed(1)}% of the revenue is recognised. cashBasis.ts:114 computes ` +
      `share = min(1, (a.amountCents * rate) / owed) where the numerator is round(100000 x 0.0067) = ` +
      `${Math.round(100_000 * 0.0067)} (un-adjusted) and the denominator is the accrual's A/R in BASE cents = ` +
      `${correct}. So share = ${(Math.round(100_000 * 0.0067) / correct).toFixed(4)} instead of 1. **The two sides ` +
      `of the division are in different units** — unlike V7, this is not a consistent scaling that a later step ` +
      `could undo; it silently truncates the recognised revenue of every fully-paid foreign invoice whose currency ` +
      `has fewer decimals than the books'. Cash-basis figures feed tax, and ` +
      `CashBasisPayment.exchangeRate is documented at :33-34 as "document currency → base", which is the adjusted ` +
      `rate (0.67), while a payment document stores the FX rate (0.0067).`,
  );

  // Control: the same $670.00 as a USD invoice paid in full.
  const c2 = context();
  const invUsd = invoice('inv-usd-cb', 'USD', 1, 67_000);
  await postInvoiceLedger(invUsd.id!, invUsd, WS, 'u1', { collection: 'invoices', docId: invUsd.id!, action: 'create' }, c2);
  const accrualUsd = (c2.capture ?? [])[0]?.txs[0] as never;
  const outUsd = cashBasisEntries(accounts, [accrualUsd as never], [{
    id: 'p-usd', status: 'posted', paymentDate: '2026-11-05', exchangeRate: 1, currency: 'USD',
    allocations: [{ documentId: 'inv-usd-cb', documentType: 'invoice' as const, amountCents: 67_000 }],
  }], 'USD');
  const paidUsd = outUsd.entries.find(e => String(e.id).endsWith(':paid:p-usd'));
  const recognisedUsd = (paidUsd?.lines || []).reduce((sum, l) => sum + Math.abs(l.amountCents || 0), 0);
  report(
    'V8b control: the SAME $670.00 as a USD invoice paid in full recognises 100% of its revenue',
    recognisedUsd === correct && Boolean(paidUsd),
    `USD: recognised ${recognisedUsd} cents of ${correct} — the accrual is found, the allocation matches, the entry ` +
      `is produced and share is 1. So V8a's ${recognised} cents is caused by the currency's minor units alone, not ` +
      `by a cash-basis report that recognises nothing, cannot match an allocation, or never emits a :paid: entry.`,
    `the control failed (recognised ${recognisedUsd}, entry ${paidUsd ? 'found' : 'MISSING'}), so V8a does not ` +
      `isolate the currency as the cause.`,
  );
}

console.log('');
console.log(failures === 0
  ? 'all cases OK — #641 and #651 do not reproduce at this pin: the aging reconciles to the ledger, the shared helper converts with minor units, and commission and cash-basis revenue use it'
  : `${failures} case(s) reported DEFECT — re-read the failing cases above before quoting them`);
process.exit(0);
