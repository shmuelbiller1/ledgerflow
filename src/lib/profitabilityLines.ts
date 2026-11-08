/**
 * Profitability (A-13, A-178, CB-08) by customer, item or project: revenue, cost, gross margin and margin %, plus the
 * project cost budget when grouped by project. One calculation for the screen (over the loaded lists) and the server
 * (L-123 step 4i, over every invoice and entry of the period).
 */
import { customerGrossProfit } from './customerGrossProfit';
import { computeProjectProfitability, type ProjectProfitabilityInput } from './projectProfitability';
import { computeSalesByItem } from '../server/reports/itemReports';
import type { ChartAccount, Customer, DimensionNode, InventoryItem, Invoice, Transaction } from '../types';

export type ProfitabilityBy = 'customer' | 'item' | 'project';
export const PROFITABILITY_BY: readonly ProfitabilityBy[] = ['customer', 'item', 'project'];

export interface ProfitabilityLine {
  label: string;
  revenueCents: number;
  costCents: number;
  marginCents: number;
  marginPct: number | null;
  estimate: boolean;
  budgetCents?: number | null;
  budgetRemainingCents?: number | null;
  budgetUsedPct?: number | null;
}

export interface ProfitabilityInput {
  customers: Customer[];
  invoices: Invoice[];
  items: InventoryItem[];
  transactions: Transaction[];
  accounts: ChartAccount[];
  projects: NonNullable<ProjectProfitabilityInput['projects']>;
  dimensionNodes?: DimensionNode[];
  startDate?: string;
  endDate?: string;
}

export function profitabilityLines(by: ProfitabilityBy, input: ProfitabilityInput): ProfitabilityLine[] {
  const { customers, invoices, items, transactions, accounts, projects, dimensionNodes, startDate, endDate } = input;
  const range = { startDate, endDate };
  if (by === 'customer') {
    return customerGrossProfit({ customers, invoices, items, transactions, accounts, ...range })
      .map(r => ({ label: r.name, revenueCents: r.salesCents, costCents: r.costCents, marginCents: r.marginCents, marginPct: r.marginPct, estimate: r.costIsEstimate }));
  }
  if (by === 'item') {
    return computeSalesByItem({ invoices, items, transactions, accounts, ...range }).rows
      .map(r => ({ label: r.name, revenueCents: r.salesCents, costCents: r.costCents, marginCents: r.marginCents, marginPct: r.marginPct, estimate: r.costIsEstimate }));
  }
  return computeProjectProfitability({ invoices, transactions, accounts, items, projects, dimensionNodes, ...range }).map(r => ({
    label: r.project, revenueCents: r.revenueCents, costCents: r.costCents, marginCents: r.marginCents, marginPct: r.marginPct,
    estimate: r.costIsEstimate, budgetCents: r.budgetCents, budgetRemainingCents: r.budgetRemainingCents, budgetUsedPct: r.budgetUsedPct,
  }));
}
