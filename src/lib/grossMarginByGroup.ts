/**
 * A-193: gross margin by item group over time. Read-only: each month's figures are the Sales by
 * Item report's own (`computeSalesByItem` — issued invoices only, sales in the base currency at
 * each invoice's own rate, cost is the cost of goods sold posted for the line or an estimate from
 * the recorded unit cost, marked as such), with the items then rolled up into the group recorded
 * on each item (`category`). A line with no item keeps Sales by Item's "No item" row; an item with
 * no recorded group is "No group recorded"; a line whose item was deleted keeps its own group name
 * unavailable and is shown the same way. Nothing is converted beyond what Sales by Item already
 * does, and nothing posts.
 */
import type { ChartAccount, InventoryItem, Invoice, Transaction } from '../types';
import { computeSalesByItem, NO_ITEM_KEY } from '../server/reports/itemReports';

export const NO_GROUP_NAME = 'No group recorded';
export const NO_ITEM_NAME = 'No item';

export interface GroupMonth {
  /** YYYY-MM */
  month: string;
  salesCents: number;
  costCents: number;
  marginCents: number;
  /** margin as a percentage of sales; null when the group sold nothing that month */
  marginPct: number | null;
  /** part of the cost is estimated from recorded unit costs (Sales by Item's own mark) */
  costIsEstimate: boolean;
}

export interface GroupMarginRow {
  group: string;
  months: GroupMonth[];
  salesCents: number;
  costCents: number;
  marginCents: number;
  marginPct: number | null;
  costIsEstimate: boolean;
}

/** First and last day of a YYYY-MM month (pure calendar maths, no time zone involved). */
export function monthRange(month: string): { startDate: string; endDate: string } {
  const [year, m] = month.split('-').map(Number);
  const last = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return { startDate: `${month}-01`, endDate: `${month}-${String(last).padStart(2, '0')}` };
}

/** The YYYY-MM months between two months, both ends included (never more than 36). */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [year, month] = first.split('-').map(Number);
  const [endYear, endMonth] = last.split('-').map(Number);
  while ((year < endYear || (year === endYear && month <= endMonth)) && out.length < 36) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

const pct = (salesCents: number, marginCents: number): number | null =>
  salesCents > 0 ? (marginCents / salesCents) * 100 : null;

export function grossMarginByItemGroup(input: {
  invoices: Invoice[];
  items: InventoryItem[];
  transactions: Transaction[];
  accounts: ChartAccount[];
  baseCurrency?: string;
  /** YYYY-MM months to show, in order (kept to at most 36) */
  months: string[];
}): { months: string[]; rows: GroupMarginRow[]; totals: GroupMonth[] } {
  const { invoices, items, transactions, accounts, baseCurrency } = input;
  const months = input.months.filter(m => /^\d{4}-\d{2}$/.test(m)).slice(0, 36);
  const groupOf = new Map(items.map(item => [item.id, (item.category || '').trim()]));

  const byGroup = new Map<string, GroupMarginRow>();
  const rowFor = (group: string): GroupMarginRow => {
    const found = byGroup.get(group);
    if (found) return found;
    const row: GroupMarginRow = {
      group,
      months: months.map(month => ({ month, salesCents: 0, costCents: 0, marginCents: 0, marginPct: null, costIsEstimate: false })),
      salesCents: 0, costCents: 0, marginCents: 0, marginPct: null, costIsEstimate: false,
    };
    byGroup.set(group, row);
    return row;
  };

  months.forEach((month, index) => {
    const { startDate, endDate } = monthRange(month);
    const { rows } = computeSalesByItem({ invoices, items, transactions, accounts, baseCurrency, startDate, endDate });
    for (const itemRow of rows) {
      const group = itemRow.key === NO_ITEM_KEY || !itemRow.itemId
        ? NO_ITEM_NAME
        : groupOf.get(itemRow.itemId) || NO_GROUP_NAME;
      const cell = rowFor(group).months[index];
      cell.salesCents += itemRow.salesCents;
      cell.costCents += itemRow.costCents;
      cell.costIsEstimate = cell.costIsEstimate || itemRow.costIsEstimate;
    }
  });

  const totals: GroupMonth[] = months.map(month => ({ month, salesCents: 0, costCents: 0, marginCents: 0, marginPct: null, costIsEstimate: false }));
  const rows = [...byGroup.values()];
  for (const row of rows) {
    row.months.forEach((cell, index) => {
      cell.marginCents = cell.salesCents - cell.costCents;
      cell.marginPct = pct(cell.salesCents, cell.marginCents);
      row.salesCents += cell.salesCents;
      row.costCents += cell.costCents;
      row.costIsEstimate = row.costIsEstimate || cell.costIsEstimate;
      totals[index].salesCents += cell.salesCents;
      totals[index].costCents += cell.costCents;
      totals[index].costIsEstimate = totals[index].costIsEstimate || cell.costIsEstimate;
    });
    row.marginCents = row.salesCents - row.costCents;
    row.marginPct = pct(row.salesCents, row.marginCents);
  }
  for (const total of totals) {
    total.marginCents = total.salesCents - total.costCents;
    total.marginPct = pct(total.salesCents, total.marginCents);
  }
  // groups that sold nothing in the whole span leave the table; "No item" and ungrouped go last
  const tail = (name: string) => (name === NO_ITEM_NAME ? 2 : name === NO_GROUP_NAME ? 1 : 0);
  return {
    months,
    rows: rows
      .filter(row => row.months.some(m => m.salesCents !== 0 || m.costCents !== 0))
      .sort((a, b) => tail(a.group) - tail(b.group) || b.salesCents - a.salesCents || a.group.localeCompare(b.group)),
    totals,
  };
}

export function groupMarginCsvHeaders(months: string[]): string[] {
  return ['Item group', ...months.flatMap(m => [`${m} sales (minor units)`, `${m} cost (minor units)`, `${m} margin (minor units)`, `${m} margin %`]),
    'Total sales (minor units)', 'Total cost (minor units)', 'Total margin (minor units)', 'Total margin %', 'Cost partly estimated'];
}

export function groupMarginCsvRows(rows: readonly GroupMarginRow[]): Array<Array<string | number>> {
  return rows.map(row => [
    row.group,
    ...row.months.flatMap(m => [m.salesCents, m.costCents, m.marginCents, m.marginPct === null ? '' : m.marginPct.toFixed(2)]),
    row.salesCents, row.costCents, row.marginCents, row.marginPct === null ? '' : row.marginPct.toFixed(2),
    row.costIsEstimate ? 'Yes' : 'No',
  ]);
}
