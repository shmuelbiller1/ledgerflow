import { Transaction, ChartAccount } from '../types';
import { isPostable, isExpenseAccount, isRevenueAccount, lineAmount, isTransactionInDateRange, isTransferTransaction } from './txFilters';
import { calculateDocumentTax, calculateDocumentNet, calculateAmountDue } from './documentMath';

export { calculateDocumentTax, calculateDocumentNet, calculateAmountDue };

export interface CategoryExpenseBreakdown {
  category: string;
  totalAmountCents: number;
  transactionCount: number;
  percentage: number;
}

export interface IncomeBySourceBreakdown {
  source: string;
  totalAmountCents: number;
  transactionCount: number;
  percentage: number;
}

export interface TopLineItem {
  id: string;
  date: string;
  description: string;
  payee?: string;
  category?: string;
  accountName: string;
  amountCents: number;
}

export interface MonthlyAverageSummary {
  year: number;
  monthlyAverageExpenseCents: number;
  monthlyAverageIncomeCents: number;
  monthlyData: Array<{
    month: number;
    monthName: string;
    expenseCents: number;
    incomeCents: number;
    isExpenseAnomaly: boolean;
    isIncomeAnomaly: boolean;
  }>;
}

export interface TagBreakdown {
  tag: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  count: number;
}

/**
 * Entries that cancel out: every reversal and the entry it reverses. Lists of single items (top
 * expenses) leave both out; totals simply add every line with its sign, so a reversal cancels
 * what it reverses and a refund reduces the total (L-157).
 */
function reversalPairIds(transactions: Transaction[]): Set<string> {
  const ids = new Set<string>();
  for (const tx of transactions) {
    const reversed = tx.metadata?.reversesTxId || tx.metadata?.reversedTransactionId;
    if (tx.metadata?.isReversal && typeof reversed === 'string') {
      ids.add(tx.id);
      ids.add(reversed);
    }
  }
  return ids;
}

export function computeExpenseByCategory(
  accounts: ChartAccount[],
  transactions: Transaction[],
  startDate?: string,
  endDate?: string
): CategoryExpenseBreakdown[] {
  const accountMap = new Map(accounts.map(a => [a.id, a]));
  const catTotals: Record<string, { total: number; count: number }> = {};
  const paired = reversalPairIds(transactions);
  let grandTotal = 0;

  for (const tx of transactions) {
    if (!isPostable(tx) || isTransferTransaction(tx)) continue;
    if (!isTransactionInDateRange(tx, startDate, endDate)) continue;

    tx.lines?.forEach(line => {
      if (line.isTransfer) return;
      const acc = accountMap.get(line.accountId);
      const isExp = isExpenseAccount(acc);

      if (isExp) {
        const amt = lineAmount(line, tx);
        if (!amt) return;
        const cat = line.category || acc?.category || acc?.name || 'General Expense';
        if (!catTotals[cat]) catTotals[cat] = { total: 0, count: 0 };
        catTotals[cat].total += amt;
        if (!paired.has(tx.id)) catTotals[cat].count += 1;
        grandTotal += amt;
      }
    });
  }

  return Object.entries(catTotals)
    .filter(([, data]) => data.total !== 0)
    .map(([category, data]) => ({
      category,
      totalAmountCents: data.total,
      transactionCount: data.count,
      percentage: grandTotal > 0 ? (data.total / grandTotal) * 100 : 0
    }))
    .sort((a, b) => b.totalAmountCents - a.totalAmountCents);
}

export function computeIncomeBySource(
  accounts: ChartAccount[],
  transactions: Transaction[],
  startDate?: string,
  endDate?: string
): IncomeBySourceBreakdown[] {
  const accountMap = new Map(accounts.map(a => [a.id, a]));
  const sourceTotals: Record<string, { total: number; count: number }> = {};
  const paired = reversalPairIds(transactions);
  let grandTotal = 0;

  for (const tx of transactions) {
    if (!isPostable(tx) || isTransferTransaction(tx)) continue;
    if (!isTransactionInDateRange(tx, startDate, endDate)) continue;

    tx.lines?.forEach(line => {
      if (line.isTransfer) return;
      const acc = accountMap.get(line.accountId);
      const isRev = isRevenueAccount(acc);

      if (isRev) {
        const amt = -lineAmount(line, tx);
        if (!amt) return;
        const source = tx.payee || line.description || acc?.name || 'Direct Revenue';
        if (!sourceTotals[source]) sourceTotals[source] = { total: 0, count: 0 };
        sourceTotals[source].total += amt;
        if (!paired.has(tx.id)) sourceTotals[source].count += 1;
        grandTotal += amt;
      }
    });
  }

  return Object.entries(sourceTotals)
    .filter(([, data]) => data.total !== 0)
    .map(([source, data]) => ({
      source,
      totalAmountCents: data.total,
      transactionCount: data.count,
      percentage: grandTotal > 0 ? (data.total / grandTotal) * 100 : 0
    }))
    .sort((a, b) => b.totalAmountCents - a.totalAmountCents);
}

export function computeTopExpensesAndIncome(
  accounts: ChartAccount[],
  transactions: Transaction[],
  limit = 20,
  startDate?: string,
  endDate?: string
): { topExpenses: TopLineItem[]; topIncome: TopLineItem[] } {
  const accountMap = new Map(accounts.map(a => [a.id, a]));
  const expenses: TopLineItem[] = [];
  const income: TopLineItem[] = [];
  const paired = reversalPairIds(transactions);

  for (const tx of transactions) {
    if (!isPostable(tx) || isTransferTransaction(tx) || paired.has(tx.id)) continue;
    if (!isTransactionInDateRange(tx, startDate, endDate)) continue;

    tx.lines?.forEach(line => {
      if (line.isTransfer) return;
      const acc = accountMap.get(line.accountId);
      const amt = lineAmount(line, tx);

      if (isExpenseAccount(acc) && amt > 0) {
        expenses.push({
          id: `${tx.id}-${line.accountId}`,
          date: tx.date,
          description: tx.description || line.description || 'Expense',
          payee: tx.payee,
          category: line.category || acc?.category,
          accountName: line.accountName || acc?.name || 'Expense Account',
          amountCents: amt
        });
      } else if (isRevenueAccount(acc) && amt < 0) {
        income.push({
          id: `${tx.id}-${line.accountId}`,
          date: tx.date,
          description: tx.description || line.description || 'Revenue',
          payee: tx.payee,
          category: line.category || acc?.category,
          accountName: line.accountName || acc?.name || 'Revenue Account',
          amountCents: -amt
        });
      }
    });
  }

  expenses.sort((a, b) => b.amountCents - a.amountCents);
  income.sort((a, b) => b.amountCents - a.amountCents);

  return {
    topExpenses: expenses.slice(0, limit),
    topIncome: income.slice(0, limit)
  };
}

export function computeMonthlyAverages(
  accounts: ChartAccount[],
  transactions: Transaction[],
  year: number
): MonthlyAverageSummary {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const accountMap = new Map(accounts.map(a => [a.id, a]));

  const monthlyTotals = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    monthName: monthNames[i],
    expenseCents: 0,
    incomeCents: 0,
    isExpenseAnomaly: false,
    isIncomeAnomaly: false
  }));

  for (const tx of transactions) {
    if (!isPostable(tx) || isTransferTransaction(tx)) continue;
    const dateStr = typeof tx.date === 'string' ? tx.date : '';
    if (dateStr.length < 7) continue;

    const txYear = Number.parseInt(dateStr.slice(0, 4), 10);
    const txMonth = Number.parseInt(dateStr.slice(5, 7), 10);

    if (txYear !== year || Number.isNaN(txMonth) || txMonth < 1 || txMonth > 12) continue;

    const targetMonth = monthlyTotals[txMonth - 1];

    tx.lines?.forEach(line => {
      if (line.isTransfer) return;
      const acc = accountMap.get(line.accountId);
      const amt = lineAmount(line, tx);

      if (isExpenseAccount(acc)) {
        targetMonth.expenseCents += amt;
      } else if (isRevenueAccount(acc)) {
        targetMonth.incomeCents += -amt;
      }
    });
  }

  const activeExpenseMonths = monthlyTotals.filter(m => m.expenseCents !== 0);
  const activeIncomeMonths = monthlyTotals.filter(m => m.incomeCents !== 0);

  const avgExpense = activeExpenseMonths.length > 0
    ? Math.round(activeExpenseMonths.reduce((sum, m) => sum + m.expenseCents, 0) / activeExpenseMonths.length)
    : 0;

  const avgIncome = activeIncomeMonths.length > 0
    ? Math.round(activeIncomeMonths.reduce((sum, m) => sum + m.incomeCents, 0) / activeIncomeMonths.length)
    : 0;

  // Anomaly detection: > 50% deviation from average
  monthlyTotals.forEach(m => {
    if (avgExpense > 0 && m.expenseCents > avgExpense * 1.5) {
      m.isExpenseAnomaly = true;
    }
    if (avgIncome > 0 && m.incomeCents > avgIncome * 1.5) {
      m.isIncomeAnomaly = true;
    }
  });

  return {
    year,
    monthlyAverageExpenseCents: avgExpense,
    monthlyAverageIncomeCents: avgIncome,
    monthlyData: monthlyTotals
  };
}

export function computeTagReport(
  accounts: ChartAccount[],
  transactions: Transaction[],
  startDate?: string,
  endDate?: string
): TagBreakdown[] {
  const accountMap = new Map(accounts.map(a => [a.id, a]));
  const tagMap: Record<string, { income: number; expense: number; count: number }> = {};
  const paired = reversalPairIds(transactions);

  for (const tx of transactions) {
    if (!isPostable(tx) || isTransferTransaction(tx)) continue;
    if (!isTransactionInDateRange(tx, startDate, endDate)) continue;

    const txTags = tx.tags || [];

    tx.lines?.forEach(line => {
      if (line.isTransfer) return;
      const acc = accountMap.get(line.accountId);
      const amt = lineAmount(line, tx);
      const lineTags = Array.from(new Set([...txTags, ...(line.tags || [])]));

      if (lineTags.length === 0) return;

      lineTags.forEach(tag => {
        if (!tagMap[tag]) tagMap[tag] = { income: 0, expense: 0, count: 0 };
        if (!paired.has(tx.id)) tagMap[tag].count += 1;

        if (isExpenseAccount(acc)) {
          tagMap[tag].expense += amt;
        } else if (isRevenueAccount(acc)) {
          tagMap[tag].income += -amt;
        }
      });
    });
  }

  return Object.entries(tagMap)
    .map(([tag, data]) => ({
      tag,
      incomeCents: data.income,
      expenseCents: data.expense,
      netCents: data.income - data.expense,
      count: data.count
    }))
    .sort((a, b) => b.expenseCents + b.incomeCents - (a.expenseCents + a.incomeCents));
}

export interface DocumentTaxReport {
  taxableSalesCents: number;
  taxCollectedCents: number;
  taxablePurchasesCents: number;
  taxPaidCents: number;
  netTaxLiabilityCents: number;
}

export function computeDocumentTaxReport(
  invoices: Array<{ date: string; status: string; amountCents?: number; taxRate?: number; taxAmountCents?: number; salesTaxCents?: number; taxInclusive?: boolean }>,
  bills: Array<{ date?: string; issueDate?: string; status: string; amountCents?: number; taxRate?: number; taxAmountCents?: number; taxInclusive?: boolean }>,
  startDate?: string,
  endDate?: string
): DocumentTaxReport {
  const start = startDate || "1900-01-01";
  const end = endDate || "2099-12-31";
  let taxableSalesCents = 0;
  let taxCollectedCents = 0;
  let taxablePurchasesCents = 0;
  let taxPaidCents = 0;

  for (const inv of invoices) {
    if (inv.date >= start && inv.date <= end && ['sent', 'paid', 'approved', 'partially_paid'].includes(inv.status)) {
      const tax = calculateDocumentTax(inv);
      const net = calculateDocumentNet(inv);
      taxableSalesCents += net;
      taxCollectedCents += tax;
    }
  }

  for (const b of bills) {
    const bDate = b.date || b.issueDate || '';
    if (bDate >= start && bDate <= end && ['sent', 'paid', 'approved', 'partially_paid'].includes(b.status)) {
      const tax = calculateDocumentTax(b);
      const net = calculateDocumentNet(b);
      taxablePurchasesCents += net;
      taxPaidCents += tax;
    }
  }

  return {
    taxableSalesCents,
    taxCollectedCents,
    taxablePurchasesCents,
    taxPaidCents,
    netTaxLiabilityCents: taxCollectedCents - taxPaidCents
  };
}

export function computeDocumentBalances(
  documents: Array<{ amountCents?: number; amountPaidCents?: number }>
): { totalAmountCents: number; totalPaidCents: number; totalDueCents: number } {
  let totalAmountCents = 0;
  let totalPaidCents = 0;
  let totalDueCents = 0;

  for (const doc of documents) {
    const total = doc.amountCents || 0;
    const paid = doc.amountPaidCents || 0;
    const due = calculateAmountDue(doc);
    totalAmountCents += total;
    totalPaidCents += paid;
    totalDueCents += due;
  }

  return { totalAmountCents, totalPaidCents, totalDueCents };
}
