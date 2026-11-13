import type { ChartAccount } from '../types';
import { resolveAccountRole } from './accountUtils';
import { budgetMonthAmount, type SavedBudget } from './budgetActual';
import { splitReportPeriods } from './reportColumns';
import { budgetLabel } from './budgetByLabel';

/** A P&L line and section, the shape the profit-and-loss report holds. */
interface BudgetLine { name: string; code?: string; balance: number; parentId?: string }
interface BudgetSection { total: number; accounts: Record<string, BudgetLine> }
export interface BudgetPL { income: BudgetSection; cogs: BudgetSection; expense: BudgetSection; grossProfit: number; netIncome: number }

/** The account a saved budget names (by id, or by a name or code only one account has), or undefined. */
export function budgetAccount(budget: SavedBudget, accounts: ChartAccount[]): ChartAccount | undefined {
  if (budget.targetType !== 'account' || typeof budget.targetId !== 'string') return undefined;
  const target = budget.targetId.toLocaleLowerCase();
  const byId = accounts.find(a => a.id === budget.targetId);
  if (byId) return byId;
  const named = accounts.filter(a => a.name.toLocaleLowerCase() === target || a.code?.toLocaleLowerCase() === target);
  return named.length === 1 ? named[0] : undefined;
}

const isCogs = (a: ChartAccount) => a.type === 'cost_of_goods' || a.category === 'COGS' || a.category === 'Direct Costs' || resolveAccountRole(a) === 'cogs';

/**
 * R-2: the P&L the budgets plan for `start`…`end` — each income, cost-of-sales and expense account's budgeted cents
 * over the months of the period (budgetMonthAmount: quarter and year amounts spread evenly), in the report's own
 * shape and signs (income and costs as positive amounts), so the P&L can show "budget" beside "actual". Budgets on a
 * project or a category, or on a balance-sheet account, have no P&L line and are left out.
 */
export function budgetPL(budgets: SavedBudget[], accounts: ChartAccount[], start: string, end: string): BudgetPL {
  const pl: BudgetPL = { income: { total: 0, accounts: {} }, cogs: { total: 0, accounts: {} }, expense: { total: 0, accounts: {} }, grossProfit: 0, netIncome: 0 };
  const months = splitReportPeriods(start, end, 'months').map(m => m.startDate.slice(0, 7));
  for (const budget of budgets) {
    // EU-E5: label budgets belong to one label only; Profit by Label compares them.
    if (budgetLabel(budget)) continue;
    const account = budgetAccount(budget, accounts);
    if (!account) continue;
    const section = account.type === 'income' || account.type === 'revenue' ? pl.income
      : isCogs(account) ? pl.cogs
        : account.type === 'expense' ? pl.expense : null;
    if (!section) continue;
    const cents = months.reduce((sum, month) => sum + budgetMonthAmount(budget, month), 0);
    const line = section.accounts[account.id] ||= { name: account.name, code: account.code, balance: 0, parentId: account.parentId };
    line.balance += cents;
    section.total += cents;
  }
  pl.grossProfit = pl.income.total - pl.cogs.total;
  pl.netIncome = pl.grossProfit - pl.expense.total;
  return pl;
}
