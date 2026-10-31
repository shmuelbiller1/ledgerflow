import type { Firestore } from '../db/firestore';
import type { ChartAccount, Transaction } from '../../types';
import { balancesAsOf, sumEntries } from './balanceService';
import { budgetMonthAmount, type SavedBudget } from '../../lib/budgetActual';
import { budgetPeriodMonths } from '../../lib/bookAlerts';
import { transactionDate } from '../../lib/txFilters';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';

/**
 * EG-4: the budget check when entries post (a bill, an expense, a journal: POST /transactions, /transactions/bulk and
 * /documents/:type/:id/post). For every account budget (Budgets → BudgetManager: targetType 'account', targetId the
 * account's id, name or code) on an expense or cost-of-goods account the request posts to, over the budget period
 * that holds the entry's date (budgetPeriodMonths, as the S-10 alert): actual = the account's movement over the whole
 * period from balancesAsOf (end of period minus the day before it starts, base currency, debit positive), plus this
 * request's net on the account (a bill's update reverses its old entry in the same request, so only the change
 * counts). Over the budget, and this request adds to it: a warning. The workspace's `budgetControl` decides:
 * 'warn' (the default) answers `budgetWarnings` and posts; 'block' refuses (409 with the first warning's words);
 * 'off' checks nothing. Only an owner changes it (PUT /workspaces/:id/budget-control; not in lf_rules allowed_keys).
 * The actual is read outside the save's transaction: two saves at the same moment may both pass a block.
 */
export type BudgetControl = 'off' | 'warn' | 'block';
export const BUDGET_CONTROLS: BudgetControl[] = ['off', 'warn', 'block'];

export interface BudgetWarning {
  budgetId: string;
  accountId: string;
  accountName: string;
  startDate: string;
  endDate: string;
  budgetCents: number;
  actualCents: number;
  thisCents: number;
  totalCents: number;
  overCents: number;
  message: string;
}

export class BudgetBlocked extends Error {
  constructor(readonly warnings: BudgetWarning[]) {
    super(warnings[0].message);
    this.name = 'BudgetBlocked';
  }
}

export function budgetControlOf(workspace: Record<string, unknown> | undefined): BudgetControl {
  const value = workspace?.budgetControl;
  return BUDGET_CONTROLS.includes(value as BudgetControl) ? value as BudgetControl : 'warn';
}

const DAY = 86_400_000;
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
/** the last day of a YYYY-MM month: the day before the next month's first */
const monthEnd = (month: string) => {
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  return shift(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
};

/**
 * The warnings for these entries (empty when nothing goes over or the workspace's control is 'off'). Reads through the
 * pool, so it is called BEFORE the save's database transaction (a transaction holds a connection: reading through
 * the pool inside it can wait forever on a pool of one); the save then applies `enforceBudgetControl` inside.
 */
export async function budgetWarningsFor(db: Firestore, workspaceId: string, workspace: Record<string, unknown> | undefined, entries: Transaction[]): Promise<BudgetWarning[]> {
  if (budgetControlOf(workspace) === 'off' || entries.length === 0) return [];
  const budgets = (await db.collection('budgets').where('workspaceId', '==', workspaceId).get()).docs
    .map(d => ({ ...d.data(), id: d.id }) as SavedBudget)
    .filter(b => b.targetType === 'account' && typeof b.targetId === 'string');
  if (budgets.length === 0) return [];
  const touched = new Set(entries.flatMap(tx => (tx.lines || []).map(l => l?.accountId)).filter(Boolean));
  const accounts = (await db.collection('chartAccounts').where('workspaceId', '==', workspaceId).get()).docs
    .map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
  const currency = String(workspace?.currency || 'USD');
  const balances = new Map<string, Promise<Record<string, number>>>();
  const balanceAt = (date: string) => {
    if (!balances.has(date)) balances.set(date, balancesAsOf(db, workspaceId, date).then(b => b.accounts));
    return balances.get(date)!;
  };
  const warnings: BudgetWarning[] = [];
  for (const budget of budgets) {
    const target = budget.targetId.toLocaleLowerCase();
    const matches = accounts.filter(a => a.id === budget.targetId || (a.name || '').toLocaleLowerCase() === target || a.code?.toLocaleLowerCase() === target);
    const account = matches.find(a => a.id === budget.targetId) || (matches.length === 1 ? matches[0] : undefined);
    if (!account || !touched.has(account.id) || !['expense', 'cost_of_goods'].includes(account.type)) continue;
    const months = new Set(entries.filter(tx => (tx.lines || []).some(l => l?.accountId === account.id)).map(tx => transactionDate(tx).slice(0, 7)).filter(Boolean));
    const seen = new Set<string>();
    for (const month of months) {
      const span = budgetPeriodMonths(budget, month);
      if (!span || seen.has(span[0])) continue;
      seen.add(span[0]);
      const budgetCents = span.reduce((sum, m) => sum + budgetMonthAmount(budget, m), 0);
      if (budgetCents <= 0) continue;
      const startDate = `${span[0]}-01`, endDate = monthEnd(span[span.length - 1]);
      const inPeriod = entries.filter(tx => { const d = transactionDate(tx); return d >= startDate && d <= endDate; });
      const thisCents = sumEntries(inPeriod).accounts[account.id] || 0;
      if (thisCents <= 0) continue;
      const [end, before] = await Promise.all([balanceAt(endDate), balanceAt(shift(startDate, -1))]);
      const actualCents = (end[account.id] || 0) - (before[account.id] || 0);
      const totalCents = actualCents + thisCents;
      if (totalCents <= budgetCents) continue;
      const money = (c: number) => formatCurrency(c, currency);
      warnings.push({
        budgetId: budget.id, accountId: account.id, accountName: account.name, startDate, endDate,
        budgetCents, actualCents, thisCents, totalCents, overCents: totalCents - budgetCents,
        message: `Over the budget for ${account.name} (${startDate} to ${endDate}): budget ${money(budgetCents)}, spent ${money(actualCents)}, this ${money(thisCents)} → ${money(totalCents)}, ${money(totalCents - budgetCents)} over`,
      });
    }
  }
  return warnings;
}

/** Inside the save, with the workspace as the save read it: 'block' refuses (BudgetBlocked), 'off' drops them, 'warn' keeps them. */
export function enforceBudgetControl(workspace: Record<string, unknown> | undefined, warnings: BudgetWarning[]): BudgetWarning[] {
  const control = budgetControlOf(workspace);
  if (control === 'off') return [];
  if (control === 'block' && warnings.length > 0) throw new BudgetBlocked(warnings);
  return warnings;
}
