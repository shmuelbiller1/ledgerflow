import type { AccountingPeriod, Transaction, TransactionLine, ChartAccount } from '../types';

/**
 * Checks if a transaction is a simulation/ghost transaction created for scenario forecasting
 */
export function isSimulationTransaction(t: Transaction): boolean {
  if (!t) return false;
  return Boolean(
    t.metadata?.isGhost || 
    t.type === 'forecast' || 
    (typeof t.id === 'string' && t.id.startsWith('ghost-')) || 
    t.workspaceId === 'simulation' ||
    t.workspaceId === 'ghost-workspace'
  );
}

/** isPostable options: include simulations; skip entries inside these closed periods. */
export interface PostableOptions {
  includeSimulations?: boolean;
  periods?: Array<Pick<AccountingPeriod, 'status' | 'startDate' | 'endDate'>>;
}

/** Statuses of an invoice or bill that is not owed (cancelled ones too, as the server services treat them). */
const CLOSED_DOCUMENT_STATUSES = new Set(['paid', 'void', 'draft', 'rejected', 'cancelled']);

/**
 * Predicate to determine if a transaction is postable / active
 * Filters out void, failed, draft, soft-deleted, and by default simulation/ghost transactions.
 */
export function isPostable(t: Transaction): boolean;
export function isPostable(t: Transaction, options: PostableOptions): boolean;
export function isPostable(t: Transaction, options?: PostableOptions): boolean {
  if (!t) return false;
  if (t.status === 'void' || t.status === 'failed' || t.status === 'draft' || t.deletedAt) {
    return false;
  }
  // A year-end closing entry from before CA-07 (revenue and expenses moved to retained earnings):
  // the balance sheet carries past profit in retained earnings by itself, so counting it would show
  // the closed year's profit and loss as zero. Closing a year no longer posts one.
  if ((t.metadata as { isYearEndClose?: unknown } | undefined)?.isYearEndClose === true) return false;
  const includeSimulations = Boolean(options?.includeSimulations);
  if (!includeSimulations && isSimulationTransaction(t)) {
    return false;
  }

  // Period Lock Check
  if (options?.periods && isPeriodLocked(t.date, options.periods)) {
    return false;
  }

  return true;
}

/**
 * Normalizes a ledger date to its calendar-day representation. Transactions may
 * be stored as either `YYYY-MM-DD` or a full ISO timestamp, while report
 * controls use date-only values. Comparing those strings directly excludes
 * timestamped transactions that occur on an inclusive end date.
 */
export function transactionDate(t: Pick<Transaction, 'date'>): string {
  return typeof t.date === 'string' ? t.date.slice(0, 10) : '';
}

/** Returns true when a transaction falls within an inclusive calendar-date range. */
export function isTransactionInDateRange(t: Pick<Transaction, 'date'>, start?: string, end?: string): boolean {
  const date = transactionDate(t);
  if (!date) return false;
  const startDate = typeof start === 'string' ? start.slice(0, 10) : undefined;
  const endDate = typeof end === 'string' ? end.slice(0, 10) : undefined;
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

/**
 * Checks if a date falls within any closed accounting period.
 */
export function isPeriodLocked(date: string, periods: Array<Pick<AccountingPeriod, 'status' | 'startDate' | 'endDate'>>): boolean {
  if (!date || !Array.isArray(periods)) return false;
  const d = date.slice(0, 10);
  return periods.some(p => 
    p.status === 'closed' && 
    d >= p.startDate.slice(0, 10) && 
    d <= p.endDate.slice(0, 10)
  );
}

/**
 * Calculates the base-currency amount in cents for a line item,
 * incorporating line or transaction-level FX exchange rates.
 */
export function lineAmount(l: TransactionLine, t?: Transaction): number {
  if (!l) return 0;
  if (Number.isInteger(l.baseAmountCents)) return l.baseAmountCents as number;
  const raw = l.amountCents || 0;
  const rate = l.exchangeRate ?? t?.exchangeRate ?? 1;
  return Math.round(raw * rate);
}

/**
 * BUG-07: an entry in a foreign currency must balance in the home currency too. Converting each line
 * on its own can leave a cent or two over (rounding): those are put on the largest line and every
 * line's home amount is written down (`baseAmountCents`), so reports read exactly what balanced.
 * Lines at different rates must balance by themselves (an exchange gain/loss line), else refused (INT-5).
 */
export function settleHomeCurrency(t: Pick<Transaction, 'lines' | 'exchangeRate'>): void {
  const lines = t.lines || [];
  const rateOf = (l: TransactionLine) => l.exchangeRate ?? t.exchangeRate ?? 1;
  if (lines.length === 0 || lines.every(l => rateOf(l) === 1)) return;
  const base = lines.map(l => Math.round((l.amountCents || 0) * rateOf(l)));
  const residual = base.reduce((a, b) => a + b, 0);
  if (residual === 0) return;
  // INT-5, the rule: only rounding at ONE rate is settled here (at most a cent per line). Foreign lines
  // at different rates must balance in the home currency by themselves — normally through an explicit
  // exchange gain/loss line (rate 1) — otherwise the entry is refused, however small the gap.
  const foreignRates = new Set(lines.filter(l => rateOf(l) !== 1).map(rateOf));
  if (foreignRates.size > 1 || Math.abs(residual) > lines.length) {
    throw new Error(`Validation Failed: the lines balance in the foreign currency but differ by ${residual} cents in the home currency (different rates) — add an exchange-difference line`);
  }
  let largest = 0;
  base.forEach((b, i) => { if (Math.abs(b) > Math.abs(base[largest])) largest = i; });
  base[largest] -= residual;
  lines.forEach((l, i) => { l.baseAmountCents = base[i]; });
}

/**
 * Checks if an account is an income/revenue account
 */
export function isRevenueAccount(account?: ChartAccount): boolean {
  if (!account) return false;
  const type = (account.type || '').toLowerCase();
  return type === 'revenue' || type === 'income';
}

/**
 * Checks if an account is an expense/cost-of-goods account
 */
export function isExpenseAccount(account?: ChartAccount): boolean {
  if (!account) return false;
  const type = (account.type || '').toLowerCase();
  return type === 'expense' || type === 'cost_of_goods' || type === 'cogs';
}

/**
 * Checks if an account is a cash or cash equivalent asset
 */
export function isCashAccount(account?: ChartAccount): boolean {
  if (!account) return false;
  const category = (account.category || '').toLowerCase();
  const subType = (account.subtype || (account as ChartAccount & { subType?: string }).subType || '').toLowerCase();
  const name = (account.name || '').toLowerCase();
  const role = (account.role || '').toLowerCase();
  return (
    role === 'cash' ||
    category.includes('cash') ||
    category.includes('bank') ||
    subType.includes('cash') ||
    subType.includes('bank') ||
    subType.includes('checking') ||
    subType.includes('savings') ||
    name.includes('checking') ||
    name.includes('savings') ||
    name.includes('operating cash') ||
    name.includes('petty cash') ||
    name.includes('cash') ||
    name.includes('bank')
  );
}

/**
 * Checks if a transaction represents an internal account transfer
 */
export function isTransferTransaction(tx: Transaction): boolean {
  if (!tx) return false;
  if (tx.isTransfer) return true;
  if (tx.metadata?.isTransfer) return true;
  if (tx.lines && tx.lines.length >= 2 && tx.lines.every(l => l.isTransfer)) return true;
  return false;
}

/**
 * Determines whether a transaction is predominantly an Income transaction
 */
export function isIncomeTransaction(tx: Transaction, accountMap?: Map<string, ChartAccount>): boolean {
  if (!isPostable(tx)) return false;
  if (isTransferTransaction(tx)) return false;
  if (tx.type === 'income') return true;
  if (tx.type === 'expense') return false;
  
  // If lines are present, check if any line credits a revenue account
  if (Array.isArray(tx.lines) && tx.lines.length > 0) {
    for (const line of tx.lines) {
      if (line.isTransfer) continue;
      const acc = accountMap?.get(line.accountId);
      if (acc && isRevenueAccount(acc) && line.amountCents < 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Determines whether a transaction is predominantly an Expense transaction
 */
export function isExpenseTransaction(tx: Transaction, accountMap?: Map<string, ChartAccount>): boolean {
  if (!isPostable(tx)) return false;
  if (isTransferTransaction(tx)) return false;
  if (tx.type === 'expense') return true;
  if (tx.type === 'income') return false;
  
  if (Array.isArray(tx.lines) && tx.lines.length > 0) {
    for (const line of tx.lines) {
      if (line.isTransfer) continue;
      const acc = accountMap?.get(line.accountId);
      if (acc && isExpenseAccount(acc) && line.amountCents > 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Determines whether a transaction represents an outflow / expense
 */
export function isOutflow(t: Transaction, accounts?: ChartAccount[] | Map<string, ChartAccount>): boolean {
  if (!isPostable(t)) return false;
  if (isTransferTransaction(t)) return false;
  if (t.type === 'expense' || (t.type as string) === 'cost_of_goods') return true;
  if (t.type === 'income' || (t.type as string) === 'revenue') return false;
  
  const map = Array.isArray(accounts) 
    ? new Map(accounts.map(a => [a.id, a])) 
    : accounts;
    
  if (t.lines && t.lines.length > 0) {
    const hasExpenseLine = t.lines.some(l => {
      if (l.isTransfer) return false;
      const acc = map?.get(l.accountId);
      return acc ? isExpenseAccount(acc) : false;
    });
    if (hasExpenseLine) return true;
  }
  return false;
}

/**
 * Determines whether a transaction represents an inflow / income
 */
export function isInflow(t: Transaction, accounts?: ChartAccount[] | Map<string, ChartAccount>): boolean {
  if (!isPostable(t)) return false;
  if (t.type === 'income' || (t.type as string) === 'revenue') return true;
  if (t.type === 'expense' || (t.type as string) === 'cost_of_goods') return false;
  
  const map = Array.isArray(accounts) 
    ? new Map(accounts.map(a => [a.id, a])) 
    : accounts;
    
  if (t.lines && t.lines.length > 0) {
    return t.lines.some(l => {
      const acc = map?.get(l.accountId);
      return acc ? (isRevenueAccount(acc) && (l.amountCents || 0) < 0) : false;
    });
  }
  return false;
}

/**
 * Calculates the net income-statement impact (Inflow - Outflow) of a transaction.
 * This is the canonical way to determine the "value" of a transaction for reports.
 * Returns (Sum of Revenue credits) - (Sum of Expense/COGS debits).
 */
export function calculateTransactionImpact(t: Transaction, accountMap?: Map<string, ChartAccount>): number {
  if (!isPostable(t)) return 0;
  let impact = 0;
  const lines = t.lines || [];
  
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const acc = accountMap?.get(l.accountId);
    const amt = lineAmount(l, t);
    
    if (isRevenueAccount(acc)) {
      impact -= amt; // Revenue is credit (negative), so subtract to get positive impact
    } else if (isExpenseAccount(acc)) {
      impact -= amt; // Expense is debit (positive), so subtract to get negative impact
    }
  }
  
  return impact;
}

/**
 * Predicate to determine if an invoice is open/unpaid
 */
export function isOpenInvoice(item: { status?: string } | null | undefined): boolean {
  if (!item) return false;
  return !CLOSED_DOCUMENT_STATUSES.has(item.status || '');
}

/**
 * Predicate to determine if a bill is open/unpaid
 */
export function isOpenBill(item: { status?: string } | null | undefined): boolean {
  if (!item) return false;
  return !CLOSED_DOCUMENT_STATUSES.has(item.status || '');
}

/**
 * Running total of the entries' effect in date order (the transaction list's running balance):
 * income adds, expenses subtract (calculateTransactionImpact). `chronological` is already sorted.
 */
export function runningBalances(chronological: Transaction[], accountMap: Map<string, ChartAccount>): Map<string, number> {
  const out = new Map<string, number>();
  let sum = 0;
  for (const t of chronological) {
    sum += calculateTransactionImpact(t, accountMap);
    out.set(t.id, sum);
  }
  return out;
}

/** The accounts whose lines make the earnings (calculateNetIncome): income, revenue, cost of goods and expenses. */
export function isEarningsAccount(acc: Pick<ChartAccount, 'type' | 'category' | 'role'>): boolean {
  return acc.type === 'income' || acc.type === 'revenue' || acc.type === 'expense' || acc.type === 'cost_of_goods'
    || acc.category === 'COGS' || acc.category === 'Direct Costs' || acc.role === 'cogs';
}

/**
 * Pure math P&L & Net Income calculator
 */
export function calculateNetIncome(
  transactions: Transaction[],
  accounts: ChartAccount[],
  startDate?: string,
  endDate?: string
): { income: number; cogs: number; expense: number; grossProfit: number; netIncome: number } {
  const start = startDate || "1970-01-01";
  const end = endDate || "2099-12-31";

  let income = 0;
  let cogs = 0;
  let expense = 0;

  const accountMap = new Map<string, ChartAccount>();
  for (let i = 0; i < accounts.length; i++) {
    accountMap.set(accounts[i].id, accounts[i]);
  }

  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];
    if (!isPostable(t)) continue;
    if (!isTransactionInDateRange(t, start, end)) continue;

    const lines = t.lines || [];
    for (let j = 0; j < lines.length; j++) {
      const l = lines[j];
      const acc = accountMap.get(l.accountId);
      if (!acc) continue;

      const amt = lineAmount(l, t);

      const isCogs = acc.type === 'cost_of_goods' || acc.category === 'COGS' || acc.category === 'Direct Costs' || acc.role === 'cogs';

      if (acc.type === 'income' || acc.type === 'revenue') {
        income += -amt;
      } else if (isCogs) {
        cogs += amt;
      } else if (acc.type === 'expense') {
        expense += amt;
      }
    }
  }

  const grossProfit = income - cogs;
  const netIncome = grossProfit - expense;

  return { income, cogs, expense, grossProfit, netIncome };
}

/**
 * Computes the absolute total of a transaction (sum of all positive line amounts).
 * This replaces scattered manual absolute-total calculation loops across the codebase.
 */
export function getAbsoluteTotal(tx: Transaction): number {
  if (!tx || !Array.isArray(tx.lines)) return 0;
  return tx.lines
    .filter(l => (l.amountCents || 0) > 0)
    .reduce((sum, l) => sum + lineAmount(l, tx), 0);
}

/**
 * An entry's size in the base currency: its debit lines converted with lineAmount, or its total
 * times its rate when it has no lines (totalAmountCents is in the entry's own currency).
 */
export function baseAbsoluteTotal(tx: Transaction): number {
  if (!tx) return 0;
  return Array.isArray(tx.lines) && tx.lines.length > 0
    ? getAbsoluteTotal(tx)
    : Math.round(Math.abs(tx.totalAmountCents || 0) * (tx.exchangeRate ?? 1));
}

/**
 * Computes filtered inflow and outflow totals across a set of transactions.
 * Excludes void, draft, and soft-deleted transactions via isPostable,
 * and applies multi-currency exchange rates via lineAmount.
 */
export function calculateFilteredTotals(
  transactions: Transaction[],
  accounts?: ChartAccount[] | Map<string, ChartAccount>
): { inflowCents: number; outflowCents: number; totalExposure: number; postableCount: number } {
  let inflowCents = 0;
  let outflowCents = 0;
  let totalExposure = 0;
  let postableCount = 0;

  const accountMap = Array.isArray(accounts)
    ? new Map(accounts.map(a => [a.id, a]))
    : accounts;

  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];
    if (!isPostable(t)) continue;
    postableCount++;
    totalExposure += baseAbsoluteTotal(t);

    // BUG-01: when the lines' accounts are known, count by the side each income/expense line is on —
    // income credited or expense credited back is money in; expense debited or income debited back
    // (a reversal, a refund) is money out. A sale and its exact reversal: 1,000 in and 1,000 out.
    const incomeOrExpense = accountMap && t.lines?.length
      ? t.lines.filter(l => { const acc = accountMap.get(l.accountId); return !l.isTransfer && acc && (isRevenueAccount(acc) || isExpenseAccount(acc)); })
      : [];
    if (incomeOrExpense.length > 0) {
      for (const l of incomeOrExpense) {
        const amt = lineAmount(l, t);
        if (amt < 0) inflowCents += -amt; else outflowCents += amt;
      }
      continue;
    }

    if (t.type === 'income' || isInflow(t, accountMap)) {
      const amt = t.lines && t.lines.length > 0
        ? t.lines.filter(l => (l.amountCents || 0) > 0).reduce((s, l) => s + lineAmount(l, t), 0)
        : Math.round(Math.abs(t.totalAmountCents || 0) * (t.exchangeRate ?? 1));
      inflowCents += amt;
    } else if (t.type === 'expense' || isOutflow(t, accountMap)) {
      const amt = t.lines && t.lines.length > 0
        ? t.lines.filter(l => (l.amountCents || 0) > 0).reduce((s, l) => s + lineAmount(l, t), 0)
        : Math.round(Math.abs(t.totalAmountCents || 0) * (t.exchangeRate ?? 1));
      outflowCents += amt;
    } else if (t.lines && t.lines.length > 0) {
      let handled = false;
      for (const l of t.lines) {
        const acc = accountMap?.get(l.accountId);
        const amt = lineAmount(l, t);
        if (acc && isRevenueAccount(acc)) {
          inflowCents += Math.abs(amt);
          handled = true;
        } else if (acc && isExpenseAccount(acc)) {
          outflowCents += Math.abs(amt);
          handled = true;
        }
      }
      // No income or expense line (a payment received or made, a transfer, a balance-sheet journal):
      // count only the money that entered or left the bank/cash accounts. It used to add every such
      // entry to the outflow, so a customer's payment showed as money going out.
      if (!handled && !isTransferTransaction(t)) {
        let cashNet = 0;
        for (const l of t.lines) {
          if (isCashAccount(accountMap?.get(l.accountId))) cashNet += lineAmount(l, t);
        }
        if (cashNet > 0) inflowCents += cashNet;
        else if (cashNet < 0) outflowCents += -cashNet;
      }
    } else {
      const amt = Math.round(Math.abs(t.totalAmountCents || 0) * (t.exchangeRate ?? 1));
      outflowCents += amt;
    }
  }

  return { inflowCents, outflowCents, totalExposure, postableCount };
}


