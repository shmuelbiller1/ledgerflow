/**
 * Agent #7 probe A7-02 (review-only; changes nothing).
 *
 * Claim under test: "a reversal is the exact negation of an already-balanced entry" (docs/DEEP_CODE_AUDIT.md,
 * audit/function-audit/AF-002). True in the entry's own currency. Is it true in the HOME currency, which is what every
 * report reads (lib/txFilters.ts lineAmount)?
 *
 * The probe uses the real functions in the real order of TransactionValidator.validateAndPrepare:
 *   TransactionSchema.parse  ->  DoubleEntryValidator  ->  settleHomeCurrency  ->  lineAmount (reports)
 * for an entry and for its reversal built by TransactionTemplates.buildReversalLines (used by invoice, bill, credit and
 * payment re-posting, document deletion and POST /transactions/:id/reverse).
 *
 * Expected for a correct system: for every account, home(original) + home(reversal) = 0.
 *
 * SCOPE (corrected 11 Nov after running the routes, probe a7-02b): this file shows the arithmetic of the two functions
 * only. It does NOT happen to invoices, bills, credits or payments: those are stored in the home currency at rate 1
 * (postingCore inBaseCurrency), so their reversals are exact. For an entry whose lines carry a foreign rate, the real
 * route never gets this far today: POST /transactions/:id/reverse refuses the reversal with a 400 (a7-02b). The
 * residue below is what a fix of that refusal would produce unless buildReversalLines also negates `baseAmountCents`.
 *
 * Run:  npx tsx audit/agent7-2026-11-11/probes/a7-02-fx-reversal-residue.ts
 */
import { TransactionSchema } from '../../../src/schemas';
import { DoubleEntryValidator } from '../../../src/kernel/validation/DoubleEntryValidator';
import { TransactionTemplates } from '../../../src/kernel/templates/TransactionTemplates';
import { lineAmount, settleHomeCurrency } from '../../../src/lib/txFilters';
import type { Transaction, TransactionLine } from '../../../src/types';

/** What the server stores for an entry: schema, balance check, home-currency settlement (validateAndPrepare steps). */
function prepared(lines: TransactionLine[], rate: number): Transaction {
  const parsed = TransactionSchema.parse({
    uid: 'u', workspaceId: 'w', date: '2026-07-01', description: 'probe', currency: 'EUR', exchangeRate: rate, status: 'completed', type: 'journal', lines,
  }) as unknown as Transaction;
  DoubleEntryValidator.validateJournalEntry(parsed);
  settleHomeCurrency(parsed);
  return parsed;
}
const home = (t: Transaction) => t.lines.map(l => lineAmount(l, t));

function reverseOf(original: Transaction, rate: number): Transaction {
  return prepared(TransactionTemplates.buildReversalLines(original.lines, original.description), rate);
}

function show(label: string, amounts: number[], rate: number) {
  const lines = amounts.map((amountCents, i) => ({ accountId: `acct-${i + 1}`, amountCents, exchangeRate: rate }));
  const original = prepared(lines, rate);
  const reversal = reverseOf(original, rate);
  const h1 = home(original), h2 = home(reversal);
  const net = h1.map((v, i) => v + h2[i]);
  console.log(`${label}\n  entry (foreign cents) ${JSON.stringify(amounts)} at rate ${rate}`);
  console.log(`  original in home currency: ${JSON.stringify(h1)} (sum ${h1.reduce((a, b) => a + b, 0)})`);
  console.log(`  reversal in home currency: ${JSON.stringify(h2)} (sum ${h2.reduce((a, b) => a + b, 0)})`);
  console.log(`  left in each account after the reversal: ${JSON.stringify(net)}  ${net.every(v => v === 0) ? 'OK' : 'DEFECT: not zero'}`);
  return net;
}

// 1. a worked example: an invoice of 300.00 EUR (two revenue lines of 150.00) at 1.11
//    by hand: 150.00 x 1.11 = 166.50 exactly (a half cent), 300.00 x 1.11 = 333.00
show('Example 1 — two revenue lines of 150.00 and a receivable of 300.00, rate 1.11', [30000, -15000, -15000].map(c => c / 100), 1.11);
// 2. the same shape in whole cents, as a foreign invoice would post it: receivable debit, two revenue credits
show('Example 2 — receivable 3.00, revenue 1.50 + 1.50, rate 1.11', [300, -150, -150], 1.11);
// 3. an ILS book with a USD invoice at 3.7: 12.35 + 12.35 = 24.70
show('Example 3 — receivable 24.70, revenue 12.35 + 12.35, rate 3.7', [2470, -1235, -1235], 3.7);

// 4. how often: every two-line-revenue invoice with line amounts 0.01 … 50.00 at a few ordinary rates
for (const rate of [1.1, 1.11, 1.25, 3.7, 3.65, 0.85, 1.0842, 3.652]) {
  let entries = 0, broken = 0, worst = 0;
  for (let a = 1; a <= 5000; a += 7) {
    for (let b = 1; b <= 5000; b += 211) {
      const lines = [a + b, -a, -b].map((amountCents, i) => ({ accountId: `acct-${i + 1}`, amountCents, exchangeRate: rate }));
      const original = prepared(lines, rate);
      const reversal = reverseOf(original, rate);
      const h1 = home(original), h2 = home(reversal);
      const net = h1.map((v, i) => v + h2[i]);
      entries++;
      if (net.some(v => v !== 0)) { broken++; worst = Math.max(worst, ...net.map(Math.abs)); }
    }
  }
  console.log(`rate ${String(rate).padEnd(6)}: ${broken} of ${entries} entries leave cents behind after their reversal (${(100 * broken / entries).toFixed(2)}%), worst ${worst} cent(s) in one account`);
}
