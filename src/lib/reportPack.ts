import { z } from 'zod';

export const PACK_REPORTS = {
  pl: 'Profit and loss', bs: 'Balance sheet', ar: 'Receivables aging',
  tb: 'Trial balance', cf: 'Cash flow', ap: 'Payables aging',
  budget: 'Budget vs actual', stock: 'Stock on hand by age',
} as const;
export type PackReport = keyof typeof PACK_REPORTS;
export interface PackRow { id: string; label: string; cents: number; total?: boolean }
export interface PackSection { kind: PackReport; rows: PackRow[]; warnings: string[] }
const amount = z.number().int().safe();
const accounts = z.record(z.string(), z.object({ name: z.string(), code: z.string().optional(), balance: amount }));
const group = z.object({ total: amount, accounts });
const balances = z.record(z.string(), amount);
const plSchema = z.object({ income: group, cogs: group, expense: group, grossProfit: amount, netIncome: amount });
const bsSchema = z.object({ assets: balances, liabilities: balances, equity: balances, totalAssets: amount,
  totalLiabilities: amount, totalEquity: amount, netIncome: amount, totalClaims: amount, isBalanced: z.boolean(),
  orphanedLines: z.array(z.unknown()).optional() });
const agingSchema = z.object({ current: amount, '1-30': amount, '31-60': amount, '61-90': amount, '90+': amount, total: amount });
const tbSchema = z.object({ accounts: z.array(z.object({ name: z.string(), code: z.string().optional(), debit: amount, credit: amount, netSigned: amount })), totalDebit: amount, totalCredit: amount, isBalanced: z.boolean() });
const flowGroup = z.object({ total: amount, inflow: amount, outflow: amount, items: z.array(z.object({ name: z.string(), amount })) });
const cfSchema = z.object({ operating: flowGroup, investing: flowGroup, financing: flowGroup, netChange: amount });
/** C-84: the budget screen's own answer (GET /reports/budget-vs-actual), in cents, one month */
const budgetSchema = z.array(z.object({ accountId: z.string().nullish(), accountCode: z.string().nullish(), accountName: z.string(), budget: amount, actual: amount, variance: amount, percent: z.number() }));
/** C-84: the stock screen's own answer (GET /reports/stock-aging); quantity is units, the value is money.
 *  The age buckets are carried through: "stock on hand by age" must keep which units are old. */
const ageBuckets = z.record(z.string(), z.number()).optional();
const stockSchema = z.object({ asOf: z.string(), items: z.array(z.object({
  itemName: z.string(), quantity: z.number(), valueCents: amount, unknownAge: z.number().optional(),
  buckets: ageBuckets, oldestDays: z.number().nullable().optional(), lastSold: z.string().nullable().optional(),
  daysSinceSold: z.number().nullable().optional(),
})) });
/** the bucket order the stock screen uses (src/lib/stockMoves.ts AGE_BUCKETS), for printing */
const STOCK_BUCKETS: ReadonlyArray<readonly [string, string]> = [
  ['d30', '0–30 days'], ['d90', '31–90 days'], ['d180', '91–180 days'], ['d365', '181–365 days'], ['older', 'Over a year'],
];

/** Presentation only: preserve the single-report server totals, never reconstruct financial history. */
export function packSection(kind: PackReport, input: unknown, names: Record<string, string>): PackSection {
  const rows: PackRow[] = [], warnings: string[] = [];
  const row = (label: string, cents: number, total = false) => rows.push({ id: `${rows.length}:${label}`, label, cents, total });
  if (kind === 'pl') {
    const data = plSchema.parse(input);
    for (const [key, title] of [['income', 'Income'], ['cogs', 'Cost of goods'], ['expense', 'Expenses']] as const) {
      for (const account of Object.values(data[key].accounts)) row(`${account.code ? `${account.code} · ` : ''}${account.name}`, account.balance);
      row(`Total ${title.toLowerCase()}`, data[key].total, true);
    }
    row('Gross profit', data.grossProfit, true); row('Net income', data.netIncome, true);
  } else if (kind === 'bs') {
    const data = bsSchema.parse(input);
    for (const [key, total, label] of [['assets', 'totalAssets', 'Assets'], ['liabilities', 'totalLiabilities', 'Liabilities'], ['equity', 'totalEquity', 'Equity']] as const) {
      for (const [id, cents] of Object.entries(data[key])) row(`${label} · ${names[id] || id}`, cents);
      row(`Total ${label.toLowerCase()}`, data[total], true);
    }
    row('Current earnings', data.netIncome, true); row('Total liabilities and equity including earnings', data.totalClaims, true);
    if (!data.isBalanced) warnings.push('The balance sheet is not balanced.');
    if (data.orphanedLines?.length) warnings.push(`${data.orphanedLines.length} posting lines reference missing accounts.`);
  } else if (kind === 'ar' || kind === 'ap') {
    const data = agingSchema.parse(input);
    for (const key of ['current', '1-30', '31-60', '61-90', '90+'] as const) row(key === 'current' ? 'Not overdue' : `${key} days overdue`, data[key]);
    row('Total outstanding', data.total, true);
  } else if (kind === 'tb') {
    const data = tbSchema.parse(input);
    for (const account of data.accounts) {
      const name = `${account.code ? `${account.code} · ` : ''}${account.name}`;
      row(`${name} · Debit`, account.debit); row(`${name} · Credit`, account.credit);
    }
    row('Total debit', data.totalDebit, true); row('Total credit', data.totalCredit, true);
    if (!data.isBalanced) warnings.push('The trial balance is not balanced.');
  } else if (kind === 'budget') {
    const data = budgetSchema.parse(input);
    if (!data.length) warnings.push('No budgets are set for the month of this pack, so there is nothing to compare.');
    // The service answers one row per saved budget and gives each row its account's whole monthly
    // actual, so two budgets on one account would count the same spending twice. The account is the
    // unit: its budgets add up, its actual counts once, and the variance follows from those two.
    const byAccount = new Map<string, { accountName: string; accountRef: string; budgetCents: number; actualCents: number }>();
    for (const line of data) {
      // keyed by the resolved account id: two accounts may share a name (older responses carry no id)
      const key = line.accountId || `name:${line.accountName}`;
      const account = byAccount.get(key) || { accountName: line.accountName, accountRef: line.accountCode || line.accountId || '', budgetCents: 0, actualCents: line.actual };
      account.budgetCents += line.budget;
      byAccount.set(key, account);
    }
    let budgetTotal = 0, actualTotal = 0, over = 0;
    const nameCount = new Map<string, number>();
    for (const { accountName } of byAccount.values()) nameCount.set(accountName, (nameCount.get(accountName) || 0) + 1);
    for (const { accountName: name, accountRef, ...account } of byAccount.values()) {
      // two accounts that share a name are told apart by their code (or id) so the pack never prints twin rows
      const accountName = (nameCount.get(name) || 0) > 1 && accountRef ? `${name} (${accountRef})` : name;
      const variance = account.budgetCents - account.actualCents;
      row(`${accountName} · Budget`, account.budgetCents);
      row(`${accountName} · Actual`, account.actualCents);
      row(`${accountName} · Variance`, variance);
      budgetTotal += account.budgetCents; actualTotal += account.actualCents;
      if (variance < 0) over += 1;
    }
    if (byAccount.size) {
      row('Total budget', budgetTotal, true); row('Total actual', actualTotal, true); row('Total variance', budgetTotal - actualTotal, true);
    }
    if (data.length > byAccount.size) warnings.push(`${data.length} budgets are saved across ${byAccount.size} accounts; each account’s spending is counted once.`);
    if (over) warnings.push(`${over} ${over === 1 ? 'account is' : 'accounts are'} over budget for the month.`);
  } else if (kind === 'stock') {
    const data = stockSchema.parse(input);
    if (!data.items.length) warnings.push(`No item had stock on hand at ${data.asOf}.`);
    let total = 0, undated = 0;
    for (const item of data.items) {
      row(`${item.itemName} · ${item.quantity} units`, item.valueCents);
      total += item.valueCents;
      if ((item.unknownAge || 0) > 0) undated += 1;
      // the age of the units on hand is the point of this section: keep it in the pack
      for (const [key, label] of STOCK_BUCKETS) {
        const units = item.buckets?.[key] || 0;
        if (units) row(`${item.itemName} · ${label} · ${units} units`, 0);
      }
      if ((item.unknownAge || 0) > 0) row(`${item.itemName} · age unknown (before the stock history) · ${item.unknownAge} units`, 0);
      if (item.oldestDays !== null && item.oldestDays !== undefined) row(`${item.itemName} · oldest units ${item.oldestDays} days old`, 0);
    }
    if (data.items.length) row('Total stock on hand', total, true);
    if (undated) warnings.push(`${undated} ${undated === 1 ? 'item includes units' : 'items include units'} from before the stock history began, so their age is unknown.`);
  } else {
    const data = cfSchema.parse(input);
    for (const key of ['operating', 'investing', 'financing'] as const) {
      row(`${key} inflow`, data[key].inflow); row(`${key} outflow`, data[key].outflow);
      for (const item of data[key].items) row(item.name, item.amount);
      row(`Total ${key}`, data[key].total, true);
    }
    row('Net change in cash', data.netChange, true);
  }
  return { kind, rows, warnings };
}
export function packReportUrl(kind: PackReport, workspaceId: string, startDate: string, endDate: string): string {
  const query = new URLSearchParams({ workspaceId });
  const path = { pl: 'profit-and-loss', bs: 'balance-sheet', ar: 'aging', ap: 'aging', tb: 'trial-balance', cf: 'cash-flow', budget: 'budget-vs-actual', stock: 'stock-aging' }[kind];
  if (kind === 'ar' || kind === 'ap') query.set('type', kind);
  else if (kind === 'tb') query.set('asOfDate', endDate);
  // C-84: the budget report is one month at a time, so the pack asks for the month it ends in
  else if (kind === 'budget') query.set('month', endDate.slice(0, 7));
  else if (kind === 'stock') query.set('asOf', endDate);
  else { query.set('endDate', endDate); if (kind === 'pl' || kind === 'cf') query.set('startDate', startDate); }
  return `/api/v1/reports/${path}?${query}`;
}
