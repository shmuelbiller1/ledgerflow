/**
 * Agent #13 probe AF13-005, 2026-11-11: independent accounting identities on the 12-month sample
 * year. The expected figures are computed from the raw posted lines only — never by calling the
 * report function whose output is being checked.
 */
import { buildSampleBusinessYear } from '../../../src/lib/sampleBusinessYear';
import { isPostable, lineAmount } from '../../../src/lib/txFilters';
import { computeBalanceSheet, computeProfitAndLoss, computeTrialBalance } from '../../../src/server/reports/computeReports';

const fixture = buildSampleBusinessYear({ year: 2026, scale: 1 });
const { transactions, accounts, startDate, endDate } = fixture;
const posted = transactions.filter(isPostable);
const typeOf = new Map(accounts.map(a => [a.id, a.type]));

// 1. double entry on the raw data
const unbalanced = posted.filter(t => t.lines.reduce((s, l) => s + lineAmount(l, t), 0) !== 0);
console.log(`1. double entry: ${unbalanced.length} unbalanced of ${posted.length} postable entries`);

// 2. independent net income for the year: revenue credits minus expense debits, from raw lines
const inRange = posted.filter(t => t.date.slice(0, 10) >= startDate && t.date.slice(0, 10) <= endDate);
let revenue = 0, expenses = 0;
for (const t of inRange) for (const l of t.lines) {
  const type = typeOf.get(l.accountId);
  const amount = lineAmount(l, t);
  // the chart uses both `income` and `revenue` for revenue accounts (credit-nature); the first run of
  // this probe counted only `income` and looked like a defect in the report — a probe bug, not a finding
  if (type === 'income' || type === 'revenue') revenue += -amount;
  else if (type === 'expense' || type === 'cost_of_goods') expenses += amount;
}
const expectedNetIncome = revenue - expenses;

const pl = computeProfitAndLoss(accounts, transactions, startDate, endDate);
const bs = computeBalanceSheet(accounts, transactions, endDate);
const tb = computeTrialBalance(accounts, transactions, endDate);

console.log(`2. net income  independent ${expectedNetIncome}  report ${pl.netIncome}  ${expectedNetIncome === pl.netIncome ? 'agree' : 'DISAGREE'}`);
console.log(`3. trial balance debits ${tb.totalDebit} credits ${tb.totalCredit}  ${tb.isBalanced ? 'balanced' : 'DISAGREE'}  (independent sum of all lines: ${inRange.reduce((s, t) => s + t.lines.reduce((x, l) => x + lineAmount(l, t), 0), 0)})`);
console.log(`4. balance sheet assets ${bs.totalAssets} claims ${bs.totalClaims} (liab ${bs.totalLiabilities} + equity ${bs.totalEquity} + netIncome ${bs.netIncome})  ${bs.isBalanced ? 'balanced' : 'DISAGREE'}`);
console.log(`5. orphaned lines (accounts not in the chart): ${bs.orphanedLines.length}`);

// 6. opening balances: does the chart carry any?
const openings = accounts.filter(a => (a.openingBalanceCents || 0) !== 0);
console.log(`6. accounts with an opening balance: ${openings.length}`);

// 7. the month-end "Invoices and bills match the ledger" item over the whole sample year
import { findPostingMismatches } from '../../../src/lib/postingCheck';
const mismatches = findPostingMismatches({
  invoices: fixture.invoices, bills: fixture.bills, transactions: fixture.transactions, baseCurrency: fixture.workspace.currency,
});
console.log(`7. repost check on the sample year: ${mismatches.length} mismatch(es)`);
for (const m of mismatches.slice(0, 8)) console.log(`   ${m.kind} ${m.number} ${m.issue} expected=${m.expectedCents} posted=${m.postedCents}`);

// 8. balance sheet identity mid-year, not only at the year end
const mid = computeBalanceSheet(accounts, transactions, '2026-06-30');
console.log(`8. balance sheet at 2026-06-30: assets ${mid.totalAssets} claims ${mid.totalClaims} ${mid.isBalanced ? 'balanced' : 'DISAGREE'}`);
