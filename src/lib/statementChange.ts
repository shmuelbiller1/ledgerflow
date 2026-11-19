import type { ChartAccount } from '../types';
import type { ExplainFilter, ExplainLine } from '../server/reports/explain';
import type { ReportPeriod, StatementData } from './reportColumns';
import { isEarningsAccount, isTransactionInDateRange } from './txFilters';
import { byCodeUnit } from './codeUnitOrder';

export interface ChangeGroup { ids: string[]; sign: 1 | -1; activityOnly?: Set<string> }

/** Use the statement's own account sections (from the whole chart, not just rows with a balance).
 * Equity/claims include current earnings; those accounts contribute activity, not an opening balance. */
export function statementChangeGroups(chartSections: StatementData, accounts: ChartAccount[]): Record<string, ChangeGroup> {
  if ('income' in chartSections) {
    const income = Object.keys(chartSections.income.accounts), cogs = Object.keys(chartSections.cogs.accounts), expense = Object.keys(chartSections.expense.accounts);
    return { 'total:income': { ids: income, sign: -1 }, 'total:cogs': { ids: cogs, sign: 1 }, 'total:expense': { ids: expense, sign: 1 },
      'total:grossProfit': { ids: [...income, ...cogs], sign: -1 }, 'total:netIncome': { ids: [...income, ...cogs, ...expense], sign: -1 } };
  }
  const assets = Object.keys(chartSections.assets), liabilities = Object.keys(chartSections.liabilities), equity = Object.keys(chartSections.equity);
  const earnings = accounts.filter(isEarningsAccount).map(a => a.id);
  const activityOnly = new Set(earnings);
  return { 'total:assets': { ids: assets, sign: 1 }, 'total:liabilities': { ids: liabilities, sign: -1 },
    'total:retainedEarnings': { ids: earnings, sign: -1, activityOnly }, 'total:equity': { ids: [...equity, ...earnings], sign: -1, activityOnly },
    'total:claims': { ids: [...liabilities, ...equity, ...earnings], sign: -1, activityOnly } };
}

/** One read for both periods: no changes between two reads can masquerade as a movement. */
export function changeFilter(group: ChangeGroup, asOf: boolean, now: ReportPeriod, prior: ReportPeriod, label?: ExplainFilter['label']): ExplainFilter {
  return { accountIds: [...new Set(group.ids)], ...(!asOf && { startDate: now.startDate < prior.startDate ? now.startDate : prior.startDate }),
    endDate: now.endDate > prior.endDate ? now.endDate : prior.endDate, ...(label && { label }) };
}

type Line = Pick<ExplainLine, 'transactionId' | 'accountId' | 'date' | 'description' | 'amountCents' | 'opening'>;
interface Contribution { id: string; date: string; description: string; change: number }

/** Attribute current minus prior, not the sum of transaction face values. Lines in both periods
 * cancel (especially opening balances on the balance sheet). Multiple lines of one entry net once.
 * Fail closed unless BOTH sets of lines agree with the amounts already shown by the statement. */
export function changeContributions(lines: readonly Line[], group: ChangeGroup, asOf: boolean,
  now: ReportPeriod, prior: ReportPeriod, expectedNow: number, expectedPrior: number): Contribution[] | null {
  const accounts = new Set(group.ids);
  const entries = new Map<string, Contribution>();
  let current = 0, previous = 0;
  for (const line of lines) {
    if (!line || !Number.isSafeInteger(line.amountCents) || !accounts.has(line.accountId)) return null;
    if (!line.opening && (typeof line.transactionId !== 'string' || !line.transactionId || typeof line.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(line.date))) return null;
    if (line.opening && group.activityOnly?.has(line.accountId)) continue;
    const inPeriod = (p: ReportPeriod) => line.opening ? asOf : isTransactionInDateRange(line, asOf ? undefined : p.startDate, p.endDate);
    const amount = line.amountCents * group.sign;
    const a = inPeriod(now) ? amount : 0, b = inPeriod(prior) ? amount : 0;
    current += a;
    previous += b;
    if (a === b) continue;
    if (!line.transactionId) return null;
    const entry = entries.get(line.transactionId) ?? { id: line.transactionId, date: line.date, description: line.description || line.transactionId, change: 0 };
    entry.change += a - b;
    entries.set(entry.id, entry);
  }
  if (current !== expectedNow || previous !== expectedPrior) return null;
  return [...entries.values()].filter(e => e.change !== 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || byCodeUnit(a.id, b.id));
}
