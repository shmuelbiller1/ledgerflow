import type { ChartAccount, InventoryItem, Invoice, Transaction } from '../../types';
import { isPostable, isTransactionInDateRange, lineAmount } from '../../lib/txFilters';
import { resolveAccountRole } from '../../lib/accountUtils';
import { INVOICE_IS_ISSUED } from './computeReports';
import { toBaseCents } from './partyReports';
import { isOpeningBalanceDocument } from '../../lib/partyOpeningBalance';

/** Invoice lines that have no inventory item are grouped under this key. */
export const NO_ITEM_KEY = '__no_item__';

export interface SalesByItemRow {
  key: string;
  itemId?: string;
  name: string;
  sku: string;
  quantity: number;
  salesCents: number;
  costCents: number;
  marginCents: number;
  /** Margin as a percentage of sales; null when there were no sales. */
  marginPct: number | null;
  /** True when at least part of the cost is estimated (no cost of goods sold posted yet). */
  costIsEstimate: boolean;
}

export interface SalesByItemReport {
  rows: SalesByItemRow[];
  totals: Omit<SalesByItemRow, 'key' | 'itemId' | 'name' | 'sku'>;
}

export interface SalesByItemInput {
  invoices: Invoice[];
  items: Pick<InventoryItem, 'id' | 'name' | 'sku' | 'unitCostCents'>[];
  transactions: Transaction[];
  accounts: ChartAccount[];
  startDate?: string;
  endDate?: string;
  /** workspace currency for converting each document's own minor units */
  baseCurrency?: string;
}

function marginPct(salesCents: number, marginCents: number): number | null {
  return salesCents > 0 ? (marginCents / salesCents) * 100 : null;
}

function inDocumentRange(date: string | undefined, start?: string, end?: string): boolean {
  if (!start && !end) return true;
  return isTransactionInDateRange({ date: date || '' }, start, end);
}

/**
 * Cost of goods sold actually posted per invoice line, keyed `${invoiceId}/${lineId}`.
 * Postings are the ledger transactions written by POST /api/v1/inventory/cogs with
 * metadata.cogsForInvoiceId / cogsForLineId. A posting that was later reversed does not
 * count (and neither does its reversal), so the line falls back to an estimate.
 */
export function postedCogsByInvoiceLine(transactions: Transaction[], accounts: ChartAccount[]): Map<string, number> {
  const accountById = new Map(accounts.map(a => [a.id, a]));
  const reversed = new Set<string>();
  for (const tx of transactions) {
    const target = tx.metadata?.reversesTxId;
    if (typeof target === 'string' && isPostable(tx)) reversed.add(target);
  }
  const posted = new Map<string, number>();
  for (const tx of transactions) {
    const invoiceId = tx.metadata?.cogsForInvoiceId;
    const lineId = tx.metadata?.cogsForLineId;
    if (typeof invoiceId !== 'string' || typeof lineId !== 'string') continue;
    if (!isPostable(tx) || reversed.has(tx.id) || tx.metadata?.reversesTxId) continue;
    const cost = (tx.lines || [])
      .filter(l => resolveAccountRole(accountById.get(l.accountId)) === 'cogs')
      .reduce((sum, l) => sum + lineAmount(l, tx), 0);
    const key = `${invoiceId}/${lineId}`;
    posted.set(key, (posted.get(key) || 0) + cost);
  }
  return posted;
}

/**
 * Sales by Item: quantity, sales (in the base currency), cost and margin per inventory item
 * for issued invoices dated in the range. Drafts, voided and cancelled invoices are ignored.
 * Cost is the cost of goods sold posted for the line; when none is posted yet it is
 * estimated as quantity × unit cost and the row is marked `costIsEstimate`.
 */
export function computeSalesByItem(input: SalesByItemInput): SalesByItemReport {
  const { invoices, items, transactions, accounts, startDate, endDate, baseCurrency = 'USD' } = input;
  const itemById = new Map(items.map(i => [i.id, i]));
  const posted = postedCogsByInvoiceLine(transactions, accounts);
  const rows = new Map<string, SalesByItemRow>();

  for (const inv of invoices) {
    if (!INVOICE_IS_ISSUED.has(inv.status)) continue;
    if (!inDocumentRange(inv.date, startDate, endDate)) continue;
    // a customer's opening balance (BA-02) is money owed from before, not a sale
    if (isOpeningBalanceDocument(inv)) continue;

    for (const line of inv.items || []) {
      const item = line.itemId ? itemById.get(line.itemId) : undefined;
      const key = line.itemId || NO_ITEM_KEY;
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          itemId: line.itemId,
          name: line.itemId ? (item?.name || line.description || 'Deleted item') : 'No item',
          sku: item?.sku || '',
          quantity: 0, salesCents: 0, costCents: 0, marginCents: 0, marginPct: null, costIsEstimate: false,
        };
        rows.set(key, row);
      }
      const quantity = Number.isFinite(line.quantity) ? line.quantity : 0;
      row.quantity += quantity;
      row.salesCents += toBaseCents(line.amountCents || 0, inv.exchangeRate, inv.currency, baseCurrency);

      if (!line.itemId) continue;
      const postedCost = posted.get(`${inv.id}/${line.id}`);
      if (postedCost !== undefined) {
        row.costCents += postedCost;
      } else {
        const unitCost = line.unitCostCents ?? item?.unitCostCents ?? 0;
        row.costCents += Math.round(quantity * unitCost);
        if (quantity !== 0 && unitCost !== 0) row.costIsEstimate = true;
      }
    }
  }

  const list = Array.from(rows.values()).map(r => {
    const marginCents = r.salesCents - r.costCents;
    return { ...r, marginCents, marginPct: marginPct(r.salesCents, marginCents) };
  });
  list.sort((a, b) => (a.key === NO_ITEM_KEY ? 1 : 0) - (b.key === NO_ITEM_KEY ? 1 : 0) || b.salesCents - a.salesCents || a.name.localeCompare(b.name));

  const totals = list.reduce((t, r) => ({
    quantity: t.quantity + r.quantity,
    salesCents: t.salesCents + r.salesCents,
    costCents: t.costCents + r.costCents,
    marginCents: t.marginCents + r.marginCents,
    marginPct: null,
    costIsEstimate: t.costIsEstimate || r.costIsEstimate,
  }), { quantity: 0, salesCents: 0, costCents: 0, marginCents: 0, marginPct: null as number | null, costIsEstimate: false });
  totals.marginPct = marginPct(totals.salesCents, totals.marginCents);

  return { rows: list, totals };
}

export interface JournalSheetLine {
  key: string;
  accountId: string;
  accountName: string;
  description: string;
  debitCents: number;
  creditCents: number;
}

export interface JournalSheetEntry {
  id: string;
  date: string;
  description: string;
  type: string;
  lines: JournalSheetLine[];
  debitCents: number;
  creditCents: number;
  /** Debits minus credits in the transaction's own amounts (the posting rule); 0 when balanced. */
  imbalanceCents: number;
  isBalanced: boolean;
}

export interface JournalSheet {
  entries: JournalSheetEntry[];
  totals: { debitCents: number; creditCents: number };
  unbalanced: JournalSheetEntry[];
}

/**
 * Journal Sheet: every posted transaction in the range (drafts, voided and simulated ones
 * are left out via isPostable), oldest first, with debits and credits in the base currency.
 * Balance is checked on the amounts as posted, the same rule the posting validator applies.
 */
export function computeJournalSheet(transactions: Transaction[], accounts: ChartAccount[], startDate?: string, endDate?: string): JournalSheet {
  const accountById = new Map(accounts.map(a => [a.id, a]));
  const entries = transactions
    .filter(tx => isPostable(tx) && inDocumentRange(tx.date, startDate, endDate))
    .map((tx): JournalSheetEntry => {
      let debitCents = 0;
      let creditCents = 0;
      let rawNet = 0;
      const lines = (tx.lines || []).map((line, i) => {
        const base = lineAmount(line, tx);
        rawNet += Math.round(line.amountCents || 0);
        if (base > 0) debitCents += base; else creditCents -= base;
        return {
          key: line.id || `${tx.id}-${i}`,
          accountId: line.accountId,
          accountName: accountById.get(line.accountId)?.name || line.accountName || line.accountId,
          description: line.description || '',
          debitCents: base > 0 ? base : 0,
          creditCents: base < 0 ? -base : 0,
        };
      });
      return {
        id: tx.id,
        date: (tx.date || '').slice(0, 10),
        description: tx.description || '',
        type: tx.type || '',
        lines, debitCents, creditCents,
        imbalanceCents: rawNet,
        isBalanced: rawNet === 0,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  return {
    entries,
    totals: entries.reduce((t, e) => ({ debitCents: t.debitCents + e.debitCents, creditCents: t.creditCents + e.creditCents }), { debitCents: 0, creditCents: 0 }),
    unbalanced: entries.filter(e => !e.isBalanced),
  };
}

/** Calendar-year range for the report page's year picker, used until reports receive real periods. */
export function yearRange(year?: number): { startDate?: string; endDate?: string } {
  return year ? { startDate: `${year}-01-01`, endDate: `${year}-12-31` } : {};
}

export interface InventoryValuationRow {
  itemId: string;
  name: string;
  sku: string;
  category: string;
  quantity: number;
  unitCostCents: number;
  /** quantity × unit cost (0 for negative stock, which is listed but has no value). */
  valueCents: number;
  /** Share of the total stock value, percent. */
  sharePct: number;
  belowReorder: boolean;
}

export interface InventoryValuation {
  rows: InventoryValuationRow[];
  totalValueCents: number;
  /** Balance of the Inventory account(s) in the books, base currency, up to `asOfDate`. */
  ledgerValueCents: number;
  /** Stock list value minus the books: not 0 means a purchase, count or sale is missing on one side. */
  differenceCents: number;
  negativeStockItems: number;
}

/**
 * Inventory Valuation (J-09): every item's current quantity on hand at its unit cost, compared with
 * the Inventory account balance in the books (posted entries only, lineAmount) up to `asOfDate`.
 * For historical stock-movement reconstruction as of an earlier date, see `src/lib/inventoryAsOf.ts`.
 */
export function computeInventoryValuation(
  items: Pick<InventoryItem, 'id' | 'name' | 'sku' | 'unitCostCents' | 'quantityAtHand' | 'reorderPoint' | 'category'>[],
  accounts: ChartAccount[],
  transactions: Transaction[],
  asOfDate?: string
): InventoryValuation {
  const valued = items.map(item => {
    const quantity = Number(item.quantityAtHand) || 0;
    const unitCostCents = Math.round(Number(item.unitCostCents) || 0);
    return {
      itemId: item.id,
      name: item.name || item.id,
      sku: item.sku || '',
      category: item.category || '',
      quantity,
      unitCostCents,
      valueCents: quantity > 0 ? Math.round(quantity * unitCostCents) : 0,
      sharePct: 0,
      belowReorder: quantity <= (Number(item.reorderPoint) || 0) && Number(item.reorderPoint) > 0,
    };
  });
  const totalValueCents = valued.reduce((sum, r) => sum + r.valueCents, 0);
  const rows = valued
    .map(r => ({ ...r, sharePct: totalValueCents > 0 ? Math.round((r.valueCents / totalValueCents) * 1000) / 10 : 0 }))
    .sort((a, b) => b.valueCents - a.valueCents || a.name.localeCompare(b.name));

  const inventoryAccounts = new Set(accounts.filter(a => resolveAccountRole(a) === 'inventory').map(a => a.id));
  let ledgerValueCents = 0;
  for (const tx of transactions) {
    if (!isPostable(tx) || (asOfDate && (tx.date || '') > asOfDate)) continue;
    for (const line of tx.lines || []) {
      if (inventoryAccounts.has(line.accountId)) ledgerValueCents += lineAmount(line, tx);
    }
  }
  for (const a of accounts) if (inventoryAccounts.has(a.id)) ledgerValueCents += a.openingBalanceCents || 0;

  return {
    rows,
    totalValueCents,
    ledgerValueCents,
    differenceCents: totalValueCents - ledgerValueCents,
    negativeStockItems: rows.filter(r => r.quantity < 0).length,
  };
}
