/**
 * Cash basis (N-08): the entries the profit and loss reads when income counts when invoices are paid
 * and costs when bills are paid. As in the usual accounting software, only what goes through
 * receivables and payables changes:
 *
 * - An invoice's or bill's posting (its accrual) is left out; each payment applied to it brings in
 *   the posting's lines (other than the receivable or payable) in proportion to what was paid, on the
 *   payment's date. A partly paid invoice counts in part; an unpaid one not at all. Cash already in
 *   the posting itself (a document marked paid) counts on the document's date.
 * - Other entries on receivables or payables without cash (credit notes, write-offs, bad debts) are
 *   left out, and counted, so the report can say so. Payments not yet applied to an invoice or bill
 *   are not income or costs.
 * - Everything else (bank entries, cash sales, journals, depreciation) counts as entered.
 *
 * Receivables and payables are the trade accounts (accounts receivable and payable), not tax, wages
 * or loans that happen to be called "payable". An invoice's share paid is the payment over its
 * receivable (the posting's debits there); a bill's, over its payable (the credits there).
 *
 * Each proportion is in whole cents: the lines are rounded one by one and the rounding goes on the
 * largest line, so they add up to the paid share of the document's lines.
 */
import type { ChartAccount, Transaction } from '../../types';
import { resolveAccountRole } from '../../lib/accountUtils';
import { isPostable, lineAmount } from '../../lib/txFilters';
import { reversedTransactionIds } from '../../lib/postingCheck';
import { computeBalanceSheet, isCashFlowCashAccount } from './computeReports';
import { convertMinorUnits } from '../../lib/currencyMinorUnits';

export interface CashBasisPayment {
  id: string;
  status?: string;
  paymentDate?: string;
  date?: string;
  /** Books' major units per payment-currency major unit; matches p.currency and the document's booked rate. */
  exchangeRate?: number;
  /** BM-04: the payment's own currency (¥ has no decimals, KWD three); missing legacy data is the books' currency */
  currency?: string;
  allocations?: Array<{ documentId: string; documentType: 'invoice' | 'bill'; amountCents: number }>;
}

export interface CashBasisEntries {
  entries: Transaction[];
  /** entries on receivables or payables without cash, left out (credit notes, write-offs…) */
  leftOut: number;
}

const ACCRUAL = { 'invoice-accrual': 'invoiceId', 'bill-accrual': 'billId' } as const;
/** accounts the books call receivable or payable that are not trade accounts */
const NOT_TRADE = /tax|vat|gst|withholding|wage|salar|payroll|pension|social|interest|loan|note|dividend|employee|מס|מע"?מ|שכר|הלוואה/i;

/** These lines × share, in whole cents, adding up to the share of their sum (the rounding on the largest). */
export function shareOfLines<L extends { amountCents: number }>(lines: L[], share: number): L[] {
  if (lines.length === 0) return [];
  const out = lines.map(l => ({ ...l, amountCents: Math.round(l.amountCents * share) }));
  const target = Math.round(lines.reduce((s, l) => s + l.amountCents, 0) * share);
  const diff = target - out.reduce((s, l) => s + l.amountCents, 0);
  if (diff !== 0) {
    const largest = out.reduce((best, l, i) => (Math.abs(l.amountCents) > Math.abs(out[best].amountCents) ? i : best), 0);
    out[largest] = { ...out[largest], amountCents: out[largest].amountCents + diff };
  }
  return out;
}

export function cashBasisEntries(accounts: ChartAccount[], transactions: Transaction[], payments: CashBasisPayment[], baseCurrency = 'USD'): CashBasisEntries {
  const byId = new Map(accounts.map(a => [a.id, a]));
  const role = (id: string) => { const a = byId.get(id); return a ? resolveAccountRole(a) : 'unknown'; };
  const notTrade = (id: string) => NOT_TRADE.test(String(byId.get(id)?.name || ''));
  const onArAp = (line: { accountId: string }) => (role(line.accountId) === 'ar' || role(line.accountId) === 'ap') && !notTrade(line.accountId);
  /** what the document leaves owed: an invoice's debits on receivables, a bill's credits on payables */
  const owedOn = (lines: Array<{ accountId: string; amountCents: number }>, kind: 'invoice' | 'bill') =>
    lines.filter(onArAp).reduce((s, l) => s + (kind === 'invoice' ? Math.max(0, l.amountCents) : Math.max(0, -l.amountCents)), 0);
  const isCash = (line: { accountId: string }) => { const a = byId.get(line.accountId); return Boolean(a && isCashFlowCashAccount(a)); };
  const reversed = reversedTransactionIds(transactions);

  const entries: Transaction[] = [];
  let leftOut = 0;
  // each document's posting in force, to bring in as it is paid
  const accruals = new Map<string, Transaction>();
  for (const tx of transactions) {
    if (!isPostable(tx)) continue;
    const meta = (tx.metadata || {}) as Record<string, unknown>;
    const key = ACCRUAL[String(meta.type) as keyof typeof ACCRUAL];
    if (key && meta[key]) {
      if (reversed.has(tx.id)) continue;
      const kind = key === 'invoiceId' ? 'invoice' : 'bill';
      accruals.set(`${kind}:${String(meta[key])}`, tx);
      // cash in the posting itself (a document marked paid) counts on its own date
      // the lines are now in the books' cents at rate 1, so the accrual's own baseAmountCents is dropped:
      // `lineAmount` prefers it, and a share of these lines would then be read at the whole document's value
      const lines = (tx.lines || []).map(l => ({ ...l, amountCents: lineAmount(l, tx), baseAmountCents: undefined, exchangeRate: 1 }));
      const cash = lines.filter(isCash).reduce((s, l) => s + (kind === 'invoice' ? Math.max(0, l.amountCents) : Math.max(0, -l.amountCents)), 0);
      const owed = owedOn(lines, kind);
      // its cash lines stay (the balance sheet's bank balance), with the paid share of the rest
      if (cash > 0) entries.push({ ...tx, id: `${tx.id}:cash`, exchangeRate: 1, lines: [...lines.filter(isCash), ...shareOfLines(lines.filter(l => !onArAp(l) && !isCash(l)), cash / (cash + owed))] } as Transaction);
      continue;
    }
    const lines = tx.lines || [];
    if (lines.some(onArAp) && !lines.some(isCash) && meta.type !== 'payment-application') {
      // on receivables or payables without cash: not income or a cost until paid, which is not tracked
      // here (a reversed entry and its reversal cancel out, and are not counted as left out)
      const reversal = Boolean(meta.isReversal || meta.reversesTxId) || reversed.has(tx.id);
      if (!reversal && lines.some(l => !onArAp(l) && ['revenue', 'expense', 'cogs'].includes(role(l.accountId)))) leftOut += 1;
      continue;
    }
    entries.push(tx);
  }

  // each payment applied to a document brings in its share of that document's posting
  for (const p of payments) {
    if (p.status === 'void') continue;
    const date = String(p.paymentDate || p.date || '').slice(0, 10);
    const rate = typeof p.exchangeRate === 'number' && p.exchangeRate > 0 ? p.exchangeRate : 1;
    for (const a of p.allocations || []) {
      const accrual = accruals.get(`${a.documentType}:${a.documentId}`);
      if (!accrual || !date || !(a.amountCents > 0)) continue;
      const lines = (accrual.lines || []).map(l => ({ ...l, amountCents: lineAmount(l, accrual), baseAmountCents: undefined, exchangeRate: 1 }));
      const owed = owedOn(lines, a.documentType);
      if (owed === 0) continue;
      // BM-04 (#651): both sides of this share must be in the books' cents. The allocation is in the
      // payment's minor units, so it is converted with the rate AND the minor-unit shift; `owed` is the
      // accrual's own posting, which is already base cents. Without the shift a fully paid ¥100,000
      // invoice at 0.0067 recognised 670 of 67,000 (1% of its revenue).
      const paidBaseCents = convertMinorUnits(a.amountCents, rate, p.currency || baseCurrency, baseCurrency);
      const share = Math.min(1, paidBaseCents / owed);
      entries.push({
        ...accrual, id: `${accrual.id}:paid:${p.id}`, date, exchangeRate: 1,
        description: `${accrual.description || ''} (paid ${date})`, lines: shareOfLines(lines.filter(l => !onArAp(l) && !isCash(l)), share),
      } as Transaction);
    }
  }
  return { entries, leftOut };
}

/** The trade receivable and payable accounts (what cash basis leaves out of the balance sheet). */
export function tradeAccountIds(accounts: ChartAccount[]): Set<string> {
  return new Set(accounts.filter(a => ['ar', 'ap'].includes(resolveAccountRole(a)) && !NOT_TRADE.test(String(a.name || ''))).map(a => a.id));
}

/**
 * N-08: the balance sheet on cash basis, as of a day: the same entries as the cash-basis profit and
 * loss, without the trade receivables and payables (what customers owe and what is owed to vendors is
 * not on it), so its profit to date is the cash-basis profit. What is paid but not yet applied to an
 * invoice or bill has no income or cost to go to: it is said on a line of its own with the
 * liabilities (`notApplied`), so the sheet still balances. Books that don't balance on accrual basis
 * are shown as they are, without that line.
 */
export function cashBasisBalanceSheet(accounts: ChartAccount[], transactions: Transaction[], payments: CashBasisPayment[], endDate?: string, baseCurrency = 'USD') {
  const accrual = computeBalanceSheet(accounts, transactions, endDate);
  const { entries, leftOut } = cashBasisEntries(accounts, transactions, payments, baseCurrency);
  const trade = tradeAccountIds(accounts);
  const kept = accounts.filter(a => !trade.has(a.id));
  const without = entries.map(t => ({ ...t, lines: (t.lines || []).filter(l => !trade.has(l.accountId)) }));
  const bs = computeBalanceSheet(kept, without, endDate);
  const notApplied = accrual.isBalanced ? bs.totalAssets - bs.totalClaims : 0;
  return {
    ...bs, orphanedLines: [], basis: 'cash' as const, leftOut, notApplied,
    totalLiabilities: bs.totalLiabilities + notApplied, totalClaims: bs.totalClaims + notApplied,
    isBalanced: bs.isBalanced || (accrual.isBalanced && bs.totalAssets === bs.totalClaims + notApplied),
  };
}
