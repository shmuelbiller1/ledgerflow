/**
 * A-13 + A-178 (CB-08) profitability by project, with budget vs actual cost comparison.
 *
 * Revenue: issued invoice lines labelled with a Project (their line labels, BF-09), in the base
 * currency. Cost of those lines: the cost of goods sold posted for each line
 * (`postedCogsByInvoiceLine`), or quantity × unit cost while none is posted (the same rule as
 * Sales by Item). Plus the expenses and cost-of-sales entries in the period that carry a Project
 * label (a bill's expense lines, a journal line): debit minus credit on expense and cost accounts,
 * so a reversal nets out. Entries made from invoices (`cogsForInvoiceId`) are not counted twice.
 * Unlabelled amounts are one "Unassigned" row.
 *
 * Budget vs actual (A-178): when `projects` are provided, active/completed project records carrying
 * a positive `budgetCents` (whole minor units in the base currency) attach `budgetCents`,
 * `budgetRemainingCents` (`budgetCents - costCents`, negative when over budget), and `budgetUsedPct`
 * (`costCents ÷ budgetCents × 100`, rounded to 2 decimal places). Budgeted projects appear even if
 * nothing has been billed or spent yet in the period, while unbudgeted projects and `Unassigned`
 * never have a budget invented (`null`). Whole cents; read-only; posts nothing.
 */
import type { ChartAccount, Invoice, Transaction } from '../types';
import { isPostable, isTransactionInDateRange, lineAmount } from './txFilters';
import { resolveAccountRole } from './accountUtils';
import { getLineDimension } from './dimensionUtils';
import { INVOICE_IS_ISSUED } from '../server/reports/computeReports';
import { postedCogsByInvoiceLine } from '../server/reports/itemReports';
import { toBaseCents } from '../server/reports/partyReports';
import { isOpeningBalanceDocument } from './partyOpeningBalance';

export const UNASSIGNED_PROJECT = 'Unassigned';

export interface ProjectBudgetInput {
  id?: string;
  name: string;
  budgetCents?: number;
  status?: string;
}

export interface ProjectProfitabilityRow {
  project: string;
  revenueCents: number;
  /** cost of the invoiced lines (posted cost of goods sold, or the estimate) */
  invoiceCostCents: number;
  /** labelled expenses and cost entries in the period */
  expenseCents: number;
  costCents: number;
  marginCents: number;
  /** margin as a share of revenue; null when there is no revenue (undefined percentage) */
  marginPct: number | null;
  costIsEstimate: boolean;
  /** A-178: allocated project cost budget in base minor units; null when no positive budget is set */
  budgetCents?: number | null;
  /** A-178: budgetCents - costCents (negative when over budget); null when no budget is set */
  budgetRemainingCents?: number | null;
  /** A-178: actual cost as % of budget; null when no budget is set */
  budgetUsedPct?: number | null;
}

export interface ProjectProfitabilityInput {
  invoices: Invoice[];
  transactions: Transaction[];
  accounts: ChartAccount[];
  items?: Array<{ id: string; unitCostCents: number }>;
  projects?: ProjectBudgetInput[];
  startDate?: string;
  endDate?: string;
}

function inRange(date: string | undefined, start?: string, end?: string): boolean {
  if (!date) return false;
  const day = date.slice(0, 10);
  if (start && day < start.slice(0, 10)) return false;
  if (end && day > end.slice(0, 10)) return false;
  return true;
}

const pct = (denom: number, num: number): number | null => (denom === 0 ? null : Math.round((num / denom) * 10000) / 100);

export function computeProjectProfitability(input: ProjectProfitabilityInput): ProjectProfitabilityRow[] {
  const { invoices, transactions, accounts, items = [], projects, startDate, endDate } = input;
  const itemCost = new Map(items.map(i => [i.id, i.unitCostCents]));
  const posted = postedCogsByInvoiceLine(transactions, accounts);
  type Accum = { project: string; revenueCents: number; invoiceCostCents: number; expenseCents: number; costIsEstimate: boolean };
  const rows = new Map<string, Accum>();

  const budgetByKey = new Map<string, { displayName: string; budgetCents: number }>();
  if (projects) {
    for (const p of projects) {
      const displayName = String(p.name || '').trim();
      if (!displayName || displayName.toLowerCase() === UNASSIGNED_PROJECT.toLowerCase() || p.status === 'archived') continue;
      const b = Math.round(Number(p.budgetCents) || 0);
      if (b > 0) {
        budgetByKey.set(displayName.toLowerCase(), { displayName, budgetCents: b });
        rows.set(displayName, { project: displayName, revenueCents: 0, invoiceCostCents: 0, expenseCents: 0, costIsEstimate: false });
      }
    }
  }

  const rowFor = (rawProject: string) => {
    const matched = budgetByKey.get(rawProject.toLowerCase());
    const project = matched ? matched.displayName : rawProject;
    let r = rows.get(project);
    if (!r) {
      r = { project, revenueCents: 0, invoiceCostCents: 0, expenseCents: 0, costIsEstimate: false };
      rows.set(project, r);
    }
    return r;
  };

  for (const inv of invoices) {
    if (!INVOICE_IS_ISSUED.has(inv.status) || isOpeningBalanceDocument(inv) || !inRange(inv.date, startDate, endDate)) continue;
    for (const line of inv.items || []) {
      const project = line.dimensions?.project?.trim() || UNASSIGNED_PROJECT;
      const r = rowFor(project);
      r.revenueCents += toBaseCents(line.amountCents || 0, inv.exchangeRate);
      const cost = posted.get(`${inv.id}/${line.id}`);
      if (cost !== undefined) {
        r.invoiceCostCents += cost;
      } else if (line.itemId) {
        const quantity = Number.isFinite(line.quantity) ? line.quantity : 0;
        const unitCost = line.unitCostCents ?? itemCost.get(line.itemId) ?? 0;
        r.invoiceCostCents += Math.round(quantity * unitCost);
        if (quantity !== 0 && unitCost !== 0) r.costIsEstimate = true;
      }
    }
  }

  const accountById = new Map(accounts.map(a => [a.id, a]));
  for (const tx of transactions) {
    if (!isPostable(tx) || !isTransactionInDateRange(tx, startDate, endDate)) continue;
    if (typeof tx.metadata?.cogsForInvoiceId === 'string') continue;
    for (const line of tx.lines || []) {
      const role = resolveAccountRole(accountById.get(line.accountId));
      if (role !== 'expense' && role !== 'cogs') continue;
      const project = getLineDimension(line, tx, 'project') || UNASSIGNED_PROJECT;
      rowFor(project).expenseCents += lineAmount(line, tx);
    }
  }

  return Array.from(rows.values()).map((r): ProjectProfitabilityRow => {
    const costCents = r.invoiceCostCents + r.expenseCents;
    const marginCents = r.revenueCents - costCents;
    if (!projects) {
      return { ...r, costCents, marginCents, marginPct: pct(r.revenueCents, marginCents) };
    }
    const budget = r.project === UNASSIGNED_PROJECT ? null : (budgetByKey.get(r.project.toLowerCase())?.budgetCents ?? null);
    return {
      ...r,
      costCents,
      marginCents,
      marginPct: pct(r.revenueCents, marginCents),
      budgetCents: budget,
      budgetRemainingCents: budget === null ? null : budget - costCents,
      budgetUsedPct: budget === null ? null : pct(budget, costCents),
    };
  }).sort((a, b) =>
    (a.project === UNASSIGNED_PROJECT ? 1 : 0) - (b.project === UNASSIGNED_PROJECT ? 1 : 0)
    || b.revenueCents - a.revenueCents
    || (b.budgetCents ?? 0) - (a.budgetCents ?? 0)
    || a.project.localeCompare(b.project));
}
