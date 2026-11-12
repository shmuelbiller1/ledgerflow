/**
 * EU-E5: budgets by label. A budget may carry one label value (kept in its `metadata.label`, a field budgets
 * already allow — no database change). Profit by Label then shows each value's budgeted result next to its actual:
 * income budgets add, cost and expense budgets subtract, each scaled to the months the period covers (a monthly
 * budget once per month, a quarterly one a third per month, a yearly one a twelfth per month).
 */
import type { Budget, ChartAccount, DimensionNode } from '../types';
import { stableLabelValue } from './dimensionUtils';
import { isIncomeAccount } from './accountUtils';

export interface BudgetLabel { dimensionId: string; value: string }

export function budgetLabel(budget: Pick<Budget, never> & { metadata?: unknown }): BudgetLabel | null {
  const label = (budget.metadata as { label?: Partial<BudgetLabel> } | undefined)?.label;
  return label && typeof label.dimensionId === 'string' && typeof label.value === 'string' && label.dimensionId && label.value
    ? { dimensionId: label.dimensionId, value: label.value } : null;
}

/** Calendar months touched by start..end (both YYYY-MM-DD), at least 1. */
export function monthsCovered(start: string, end: string): number {
  const [y1, m1] = start.slice(0, 7).split('-').map(Number);
  const [y2, m2] = end.slice(0, 7).split('-').map(Number);
  return Math.max(1, (y2 - y1) * 12 + (m2 - m1) + 1);
}

const PER_MONTH: Record<string, number> = { monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

/**
 * The budgeted result (income − costs, integer cents) of one label value over start..end, or null when no budget
 * carries this label at all (then the report shows no budget row).
 */
export function budgetedResult(input: {
  budgets: ReadonlyArray<Budget & { metadata?: unknown }>;
  accounts: readonly ChartAccount[];
  dimensionId: string;
  value: string;
  start: string;
  end: string;
  /** the workspace's label values, so a name and an id of the same value match (stableLabelValue) */
  nodes?: readonly DimensionNode[];
}): number | null {
  const same = (a: string, b: string) => stableLabelValue(a, input.dimensionId, input.nodes) === stableLabelValue(b, input.dimensionId, input.nodes);
  const tagged = input.budgets.filter(b => budgetLabel(b)?.dimensionId === input.dimensionId);
  if (!tagged.length) return null;
  let cents = 0;
  for (const b of tagged) {
    if (!same(budgetLabel(b)?.value || '', input.value) || b.targetType !== 'account') continue;
    // only the months where the report's period and the budget's own dates overlap
    const own = b as { startDate?: string; endDate?: string };
    const from = own.startDate && own.startDate > input.start ? own.startDate : input.start;
    const to = own.endDate && own.endDate < input.end ? own.endDate : input.end;
    if (from > to) continue;
    const months = monthsCovered(from, to);
    // the account by id, else by name or code when exactly one matches (as computeBudgetActual resolves it)
    const key = String(b.targetId || '').toLocaleLowerCase();
    const matches = input.accounts.filter(a => a.id === b.targetId || a.name?.toLocaleLowerCase() === key || a.code?.toLocaleLowerCase() === key);
    const account = matches.find(a => a.id === b.targetId) || (matches.length === 1 ? matches[0] : undefined);
    const sign = isIncomeAccount(account) ? 1 : account && ['expense', 'cost_of_goods'].includes(account.type) ? -1 : 0;
    cents += sign * Math.round((b.amountCents || 0) * months * (PER_MONTH[b.period] ?? 1));
  }
  return cents;
}
