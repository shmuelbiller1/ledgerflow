import { calculateNetIncome, isPostable, isRevenueAccount, isExpenseAccount, lineAmount, isTransactionInDateRange } from "../../lib/txFilters";
import { isUndepositedFundsAccount, openingDebitCents, resolveAccountRole } from "../../lib/accountUtils";
import type { Invoice, Bill, Payment, Customer, Vendor, Transaction, ChartAccount, TransactionLine, CreditNote, VendorCredit } from "../../types";
import { INVOICE_IS_ISSUED, BILL_IS_ISSUED } from "./partyReports";

export { INVOICE_IS_ISSUED, BILL_IS_ISSUED };

export function computeProfitAndLoss(accounts: ChartAccount[], transactions: Transaction[], startDate?: string, endDate?: string) {
  const start = startDate || "1970-01-01";
  const end = endDate || "2099-12-31";
  const pl: {
    income: { total: number; accounts: Record<string, { name: string; code?: string; balance: number; parentId?: string }> };
    cogs: { total: number; accounts: Record<string, { name: string; code?: string; balance: number; parentId?: string }> };
    expense: { total: number; accounts: Record<string, { name: string; code?: string; balance: number; parentId?: string }> };
    grossProfit: number;
    netIncome: number;
  } = {
    income: { total: 0, accounts: {} },
    cogs: { total: 0, accounts: {} },
    expense: { total: 0, accounts: {} },
    grossProfit: 0,
    netIncome: 0
  };
  accounts.forEach((acc) => {
    const isCogs = acc.type === 'cost_of_goods' || acc.category === 'COGS' || acc.category === 'Direct Costs' || resolveAccountRole(acc) === 'cogs';
    if (isRevenueAccount(acc)) {
      pl.income.accounts[acc.id] = { name: acc.name, code: acc.code, balance: 0, parentId: acc.parentId };
    } else if (isCogs) {
      pl.cogs.accounts[acc.id] = { name: acc.name, code: acc.code, balance: 0, parentId: acc.parentId };
    } else if (isExpenseAccount(acc)) {
      pl.expense.accounts[acc.id] = { name: acc.name, code: acc.code, balance: 0, parentId: acc.parentId };
    }
  });
  for (const tx of transactions) {
    if (!isPostable(tx)) continue;
    if (!isTransactionInDateRange(tx, start, end)) continue;
    tx.lines?.forEach((line: TransactionLine) => {
      const amount = lineAmount(line, tx);
      if (pl.income.accounts[line.accountId]) {
        const val = -amount; 
        pl.income.accounts[line.accountId].balance += val;
        pl.income.total += val;
      } else if (pl.cogs.accounts[line.accountId]) {
        const val = amount;
        pl.cogs.accounts[line.accountId].balance += val;
        pl.cogs.total += val;
      } else if (pl.expense.accounts[line.accountId]) {
        const val = amount;
        pl.expense.accounts[line.accountId].balance += val;
        pl.expense.total += val;
      }
    });
  }
  const totals = calculateNetIncome(transactions, accounts, start, end);
  pl.grossProfit = totals.grossProfit;
  pl.netIncome = totals.netIncome;
  pl.income.total = totals.income;
  pl.cogs.total = totals.cogs;
  pl.expense.total = totals.expense;
  return pl;
}

/**
 * L-123: what the entries before the ones given add to each account, debit positive, base-currency cents (a
 * balance snapshot plus the entries after it, `balancesAsOf`). Only accounts of the chart: a caller with lines on
 * other accounts reads every entry instead, so the orphaned lines stay listed.
 */
export type OpeningCents = Record<string, number>;

/** The profit those balances carry, by today's chart (the profit and loss's own reading, calculateNetIncome). */
export function openingNetIncome(accounts: ChartAccount[], opening: OpeningCents): number {
  const lines = Object.entries(opening).map(([accountId, cents]) => ({ accountId, amountCents: cents, baseAmountCents: cents }));
  return calculateNetIncome([{ id: 'opening', date: '1970-01-01', status: 'completed', lines } as unknown as Transaction], accounts, '1970-01-01', '2099-12-31').netIncome;
}

export function computeBalanceSheet(accounts: ChartAccount[], transactions: Transaction[], endDate?: string, opening?: OpeningCents) {
  const end = endDate || "2099-12-31";

  const balances: Record<string, number> = {};
  accounts.forEach((acc) => {
    // N-13: kept in the account's own direction; the books are debit-positive
    balances[acc.id] = openingDebitCents(acc) + (opening?.[acc.id] || 0);
  });

  const orphanedLines: Array<{ accountId: string; transactionId?: string; date?: string; amountCents: number }> = [];

  for (const tx of transactions) {
    if (!isPostable(tx)) continue;
    if (!isTransactionInDateRange(tx, undefined, end)) continue;
    tx.lines?.forEach((line: TransactionLine) => {
      if (balances[line.accountId] !== undefined) {
        balances[line.accountId] += lineAmount(line, tx);
      } else {
        orphanedLines.push({
          accountId: line.accountId,
          transactionId: tx.id,
          date: tx.date,
          amountCents: lineAmount(line, tx)
        });
      }
    });
  }

  const netIncome = calculateNetIncome(transactions, accounts, "1970-01-01", end).netIncome + (opening ? openingNetIncome(accounts, opening) : 0);

  const assets: Record<string, number> = {};
  const liabilities: Record<string, number> = {};
  const equity: Record<string, number> = {};

  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;

  accounts.forEach((acc) => {
    const bal = balances[acc.id] || 0;
    if (acc.type === 'asset') {
      assets[acc.id] = bal;
      totalAssets += bal;
    } else if (acc.type === 'liability') {
      const val = -bal;
      liabilities[acc.id] = val;
      totalLiabilities += val;
    } else if (acc.type === 'equity') {
      const val = -bal;
      equity[acc.id] = val;
      totalEquity += val;
    }
  });

  // totalEquity stays equity-accounts-only, matching BalanceSheetView.tsx:182
  const totalClaims = totalLiabilities + totalEquity + netIncome;
  const isBalanced = totalAssets === totalClaims;

  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    netIncome,
    totalClaims,
    isBalanced,
    orphanedLines
  };
}

/** L-123: the trial balance's opening, gross: each account's debits and credits (both positive) before the entries given. */
export interface OpeningGross { debits: OpeningCents; credits: OpeningCents }

export function computeTrialBalance(accounts: ChartAccount[], transactions: Transaction[], asOfDate?: string, opening?: OpeningGross) {
  const trialBalance: Record<string, { name: string; code?: string; type: string; debit: number; credit: number; netSigned: number }> = {};
  accounts.forEach((acc) => {
    // N-13: the opening balance is in the account's own direction (netSigned's sign); debit and credit are the books'
    const openingSigned = acc.openingBalanceCents || 0;
    const asDebit = openingDebitCents(acc);
    trialBalance[acc.id] = {
      name: acc.name,
      code: acc.code,
      type: acc.type,
      debit: asDebit > 0 ? asDebit : 0,
      credit: asDebit < 0 ? Math.abs(asDebit) : 0,
      netSigned: openingSigned
    };
    if (opening) {
      const [debit, credit] = [opening.debits[acc.id] || 0, opening.credits[acc.id] || 0];
      const isDebitNature = ['asset', 'expense', 'cost_of_goods'].includes(acc.type);
      trialBalance[acc.id].debit += debit;
      trialBalance[acc.id].credit += credit;
      trialBalance[acc.id].netSigned += isDebitNature ? debit - credit : credit - debit;
    }
  });
  for (const tx of transactions) {
    if (!isPostable(tx)) continue;
    if (asOfDate && !isTransactionInDateRange(tx, undefined, asOfDate)) continue;
    tx.lines?.forEach((line: TransactionLine) => {
      const amount = lineAmount(line, tx);
      if (trialBalance[line.accountId]) {
        const isDebitNature = ['asset', 'expense', 'cost_of_goods'].includes(trialBalance[line.accountId].type);
        if (amount > 0) {
          trialBalance[line.accountId].debit += amount;
        } else {
          trialBalance[line.accountId].credit += Math.abs(amount);
        }
        trialBalance[line.accountId].netSigned += (isDebitNature ? amount : -amount);
      }
    });
  }
  const totalDebit = Object.values(trialBalance).reduce((sum, acc) => sum + acc.debit, 0);
  const totalCredit = Object.values(trialBalance).reduce((sum, acc) => sum + acc.credit, 0);
  const accountsArray = Object.entries(trialBalance).map(([id, acc]) => ({
    id,
    name: acc.name,
    code: acc.code,
    type: acc.type,
    debit: acc.debit,
    credit: acc.credit,
    netSigned: acc.netSigned
  }));
  return { accounts: accountsArray, totalDebit, totalCredit, isBalanced: totalDebit === totalCredit };
}

/** Bank and cash accounts for the cash flow statement, including money received but not yet deposited. */
export function isCashFlowCashAccount(acc: ChartAccount): boolean {
  return resolveAccountRole(acc) === 'cash' || isUndepositedFundsAccount(acc) || (acc.type === 'asset' && Boolean(acc.code?.startsWith('10')));
}

const INVESTING_ASSET = /fixed|equipment|property|vehicle|machinery|furniture|building|land|investment|depreciation|intangible/;
const FINANCING_LIABILITY = /long[- ]?term|loan|mortgage|note[s]? payable|bond|debt|lease liabilit/;

/** Where the other side of a cash entry belongs: equity and long-term debt are financing, fixed
 * assets and investments investing, everything else (income, costs, receivables, payables,
 * inventory, tax, short-term balances) operating. */
export function cashFlowSection(acc: ChartAccount): 'operating' | 'investing' | 'financing' {
  const text = `${acc.category || ''} ${acc.subtype || ''} ${acc.name || ''}`.toLowerCase();
  if (acc.type === 'equity') return 'financing';
  if (acc.type === 'liability' && FINANCING_LIABILITY.test(text)) return 'financing';
  if (acc.type === 'asset' && INVESTING_ASSET.test(text)) return 'investing';
  return 'operating';
}

/**
 * Cash flow statement, direct method: every posted entry that moves a bank/cash account, split by
 * what the money was for (the entry's other lines, cashFlowSection), in the base currency. Net
 * change is therefore the change in cash over the period; transfers between cash accounts and
 * entries without cash (accruals, depreciation) don't count. One function for the server report and
 * the Cash Flow screen: the server used to take only income, expense, receivables and payables
 * lines from every entry, so tax, inventory and the like were missing and its total didn't match
 * the cash at the bank.
 */
export function computeCashFlow(accounts: ChartAccount[], transactions: Transaction[], startDate?: string, endDate?: string) {
  const start = startDate ? String(startDate) : "1970-01-01";
  const end = endDate ? String(endDate) : "2099-12-31";
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const cashFlow = {
    operating: { total: 0, inflow: 0, outflow: 0, items: [] as { name: string; amount: number }[] },
    investing: { total: 0, inflow: 0, outflow: 0, items: [] as { name: string; amount: number }[] },
    financing: { total: 0, inflow: 0, outflow: 0, items: [] as { name: string; amount: number }[] },
    netChange: 0
  };

  transactions.forEach((tx) => {
    if (!isPostable(tx) || !isTransactionInDateRange(tx, start, end)) return;
    const lines = tx.lines || [];
    const isCash = (line: TransactionLine) => {
      const acc = byId.get(line.accountId);
      return Boolean(acc && isCashFlowCashAccount(acc));
    };
    if (!lines.some(isCash)) return;

    lines.forEach((line: TransactionLine) => {
      const acc = byId.get(line.accountId);
      if (!acc || isCashFlowCashAccount(acc)) return;
      const delta = -lineAmount(line, tx); // a credit elsewhere is money in
      if (delta === 0) return;
      const section = cashFlow[cashFlowSection(acc)];
      section.total += delta;
      if (delta > 0) section.inflow += delta;
      else section.outflow += -delta;
      if (section !== cashFlow.operating) section.items.push({ name: tx.description, amount: delta });
    });
  });

  cashFlow.netChange = cashFlow.operating.total + cashFlow.investing.total + cashFlow.financing.total;

  return cashFlow;
}

export function computeGeneralLedger(accounts: ChartAccount[], transactions: Transaction[], startDate?: string, endDate?: string, targetAccountId?: string, opening?: OpeningCents) {
  const start = startDate || "1970-01-01";
  const end = endDate || "2099-12-31";

  const targetAccounts = targetAccountId
    ? accounts.filter((a) => a.id === targetAccountId)
    : accounts;

  const resultAccounts = targetAccounts.map((acc) => {
    let openingBalanceCents = acc.openingBalanceCents || 0;
    const isDebitNature = ['asset', 'expense', 'cost_of_goods'].includes(acc.type);
    // L-123: the entries before the period, summed already (the transactions given then start at the period)
    if (opening) openingBalanceCents += isDebitNature ? (opening[acc.id] || 0) : -(opening[acc.id] || 0);

    // Compute prior period postings
    transactions.forEach((tx) => {
      if (!isPostable(tx)) return;
      if (tx.date && tx.date < start) {
        tx.lines?.forEach((line: TransactionLine) => {
          if (line.accountId === acc.id) {
            const amt = lineAmount(line, tx);
            openingBalanceCents += isDebitNature ? amt : -amt;
          }
        });
      }
    });

    const periodTxs = transactions.filter((tx) => {
      if (!isPostable(tx)) return false;
      return isTransactionInDateRange(tx, start, end);
    }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    let runningBalanceCents = openingBalanceCents;
    let periodDebitsCents = 0;
    let periodCreditsCents = 0;
    const entries: {
      transactionId: string;
      date: string;
      description: string;
      reference: string;
      debitCents: number;
      creditCents: number;
      runningBalanceCents: number;
    }[] = [];

    periodTxs.forEach((tx) => {
      tx.lines?.forEach((line: TransactionLine) => {
        if (line.accountId === acc.id) {
          const amt = lineAmount(line, tx);
          const debitCents = amt > 0 ? amt : 0;
          const creditCents = amt < 0 ? Math.abs(amt) : 0;

          periodDebitsCents += debitCents;
          periodCreditsCents += creditCents;

          const netEffect = isDebitNature ? amt : -amt;
          runningBalanceCents += netEffect;

          entries.push({
            transactionId: tx.id || '',
            date: tx.date || '',
            description: tx.description || '',
            reference: line.description || '',
            debitCents,
            creditCents,
            runningBalanceCents
          });
        }
      });
    });

    return {
      accountId: acc.id,
      accountCode: acc.code || '',
      accountName: acc.name,
      type: acc.type,
      category: acc.category || '',
      openingBalanceCents,
      periodDebitsCents,
      periodCreditsCents,
      endingBalanceCents: runningBalanceCents,
      entries
    };
  });

  return {
    startDate: start,
    endDate: end,
    accounts: resultAccounts
  };
}

export function computeStatement(
  contact: Customer | Vendor | undefined | null,
  invoices: Invoice[],
  bills: Bill[],
  payments: Payment[],
  startDate: string,
  endDate: string,
  type: 'customer' | 'vendor',
  /** credit notes (customer) or vendor credits (vendor); each counts less what was refunded (L-160) */
  credits: Array<CreditNote | VendorCredit> = []
) {
  const start = startDate || "1970-01-01";
  const end = endDate || "2099-12-31";

  const contactId = contact?.id || '';
  const isCustomer = type === 'customer';

  // Build prior balance
  let openingBalanceCents = 0;

  if (isCustomer) {
    invoices.filter((inv) => inv.customerId === contactId && (inv.date || '') < start && INVOICE_IS_ISSUED.has(inv.status)).forEach((inv) => {
      openingBalanceCents += (inv.amountCents || 0);
    });
    payments.filter((p) => p.contactId === contactId && (p.date || '') < start && p.direction === 'received' && p.status === 'posted').forEach((p) => {
      openingBalanceCents -= (p.amountCents || 0);
    });
  } else {
    bills.filter((b) => b.vendorId === contactId && (b.date || b.issueDate || '') < start && BILL_IS_ISSUED.has(b.status)).forEach((b) => {
      openingBalanceCents += (b.amountCents || 0);
    });
    payments.filter((p) => p.contactId === contactId && (p.date || '') < start && p.direction === 'made' && p.status === 'posted').forEach((p) => {
      openingBalanceCents -= (p.amountCents || 0);
    });
  }

  const contactCredits = credits.filter(c => (isCustomer ? (c as CreditNote).customerId : (c as VendorCredit).vendorId) === contactId && c.status !== 'void' && c.status !== 'draft');
  const creditNet = (c: CreditNote | VendorCredit) => (c.amountCents || 0) - (c.refundedCents || 0);
  contactCredits.filter(c => (c.date || '') < start).forEach(c => { openingBalanceCents -= creditNet(c); });

  // Activity stream in range
  const activityItems: {
    id: string;
    date: string;
    type: string;
    reference: string;
    amountCents: number;
    creditCents: number;
    debitCents: number;
  }[] = [];

  if (isCustomer) {
    invoices.filter((inv) => inv.customerId === contactId && (inv.date || '') >= start && (inv.date || '') <= end && INVOICE_IS_ISSUED.has(inv.status)).forEach((inv) => {
      activityItems.push({
        id: inv.id,
        date: inv.date || '',
        type: 'Invoice',
        reference: inv.number || inv.id,
        amountCents: (inv.amountCents || 0),
        creditCents: 0,
        debitCents: (inv.amountCents || 0)
      });
    });
    payments.filter((p) => p.contactId === contactId && (p.date || '') >= start && (p.date || '') <= end && p.direction === 'received' && p.status === 'posted').forEach((p) => {
      activityItems.push({
        id: p.id,
        date: p.date || '',
        type: 'Payment',
        reference: p.reference || p.id,
        amountCents: -(p.amountCents || 0),
        creditCents: (p.amountCents || 0),
        debitCents: 0
      });
    });
  } else {
    bills.filter((b) => b.vendorId === contactId && (b.date || b.issueDate || '') >= start && (b.date || b.issueDate || '') <= end && BILL_IS_ISSUED.has(b.status)).forEach((b) => {
      activityItems.push({
        id: b.id,
        date: b.date || b.issueDate || '',
        type: 'Bill',
        reference: b.number || b.id,
        amountCents: (b.amountCents || 0),
        creditCents: 0,
        debitCents: (b.amountCents || 0)
      });
    });
    payments.filter((p) => p.contactId === contactId && (p.date || '') >= start && (p.date || '') <= end && p.direction === 'made' && p.status === 'posted').forEach((p) => {
      activityItems.push({
        id: p.id,
        date: p.date || '',
        type: 'Payment',
        reference: p.reference || p.id,
        amountCents: -(p.amountCents || 0),
        creditCents: (p.amountCents || 0),
        debitCents: 0
      });
    });
  }

  contactCredits.filter(c => (c.date || '') >= start && (c.date || '') <= end).forEach(c => {
    const net = creditNet(c);
    activityItems.push({
      id: c.id,
      date: c.date || '',
      type: `${isCustomer ? 'Credit note' : 'Vendor credit'}${net === 0 ? ' (refunded)' : (c.refundedCents || 0) > 0 ? ' (part refunded)' : ''}`,
      reference: c.number || c.id,
      amountCents: net === 0 ? 0 : -net,
      creditCents: net,
      debitCents: 0
    });
  });

  // AUD-01: one order whatever order the rows were read in (the screen's store, the server's query): by date, then
  // documents before payments before credits, then reference (one fixed locale, so a browser and the server set to
  // other languages agree) and id — so each row's running balance is the same
  const rank = (t: string) => (t === 'Invoice' || t === 'Bill' ? 0 : t === 'Payment' ? 1 : 2);
  activityItems.sort((a, b) => (a.date || '').localeCompare(b.date || '') || rank(a.type) - rank(b.type) || a.reference.localeCompare(b.reference, 'en', { numeric: true }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let runningBalanceCents = openingBalanceCents;
  const entries = activityItems.map(item => {
    runningBalanceCents += item.amountCents;
    return {
      ...item,
      runningBalanceCents
    };
  });

  return {
    contactId,
    contactName: contact?.name || 'Contact',
    type,
    startDate: start,
    endDate: end,
    openingBalanceCents,
    endingBalanceCents: runningBalanceCents,
    entries
  };
}

export {
  toBaseCents,
  computeCustomerBalanceSummary,
  computeVendorBalanceSummary,
  computeTransactionsByCustomer,
  computeTransactionsByVendor,
  computeContactBalanceSummary
} from "./partyReports";
export type {
  CustomerBalanceSummaryRow,
  VendorBalanceSummaryRow,
  PartyTransactionRow,
  ContactBalanceSummaryRow
} from "./partyReports";
