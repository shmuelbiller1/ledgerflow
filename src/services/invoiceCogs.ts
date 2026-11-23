import { validStandardCost } from '../lib/standardCostSettings';
import type { ChartAccount, InventoryItem, Invoice, TransactionLine } from '../types';

/** metadata.type of the cost-of-goods-sold entry posted for one invoice line. */
export const INVOICE_COGS_TYPE = 'invoice-cogs-auto';

export const COGS_ACCOUNTS_MISSING =
  'Add an Inventory account and a Cost of Goods Sold account to record the cost of items sold.';

/** INV-01: the cost of a line is not on the invoice yet and not known on the item either. */
export const COGS_COST_UNKNOWN =
  'The cost of goods sold could not be determined: the item has no cost recorded. Add the item cost on Inventory, save the invoice again, or post the cost of goods manually.';

export interface CogsEntry {
  uid: string;
  workspaceId: string;
  date: string;
  description: string;
  totalAmountCents: number;
  currency: string;
  exchangeRate: number;
  status: 'completed';
  type: 'actual';
  createdAt: string;
  metadata: {
    invoiceId: string;
    type: typeof INVOICE_COGS_TYPE;
    cogsForInvoiceId: string;
    cogsForLineId: string;
    inventoryItemId: string;
    quantity: number;
    /** M-21 step 2: the cost was the item's standard, not its moving average */
    standard?: boolean;
    /** M-21 step 2: the standard the cost was posted at (so a repost keeps the original basis) */
    standardCostCents?: number;
    /** M-21 step 2: the units covered by the recorded basis (the whole quantity when no later edit
     * added units at the then-current standard) */
    standardQty?: number;
    /** M-21 step 2: every historical cost cohort of the line, oldest first, as posted (each with the
     * standard it was posted at and how many units it covers) — the accumulated basis a later repost
     * keeps, so an amended sale remembers every standard its units were already posted at */
    standards?: Array<{ standardCostCents: number; quantity: number }>;
    /** W-01: the invoice line's Location label, where the units left from */
    locationId?: string;
    /** DIM-2 phase 3: the customer the units went to */
    customerId?: string;
  };
  lines: TransactionLine[];
}

export interface InvoiceCogsPlan {
  entries: CogsEntry[];
  /** Set when some item lines have a cost but it could not be posted; the invoice is flagged. */
  pendingReason?: string;
}

export interface InvoiceCogsInput {
  invoiceId: string;
  invoice: Partial<Invoice>;
  date: string;
  uid: string;
  workspaceId: string;
  /** The workspace (base) currency: inventory is valued in it. */
  baseCurrency: string;
  inventoryAccount?: Pick<ChartAccount, 'id' | 'name'>;
  cogsAccount?: Pick<ChartAccount, 'id' | 'name'>;
  items: Pick<InventoryItem, 'id' | 'name' | 'unitCostCents' | 'unitCostMicroCents' | 'standardCostCents'>[];
  /** M-21 step 2: the workspace posts at standard, so the cost of goods relieves stock at the item's standard */
  postAtStandard?: boolean;
  /** M-21 step 2: the historical basis each existing sale line was already posted at (lineId → the
   * item it was posted for plus the cohorts of standard-and-quantity, oldest first), so an edit/repost
   * of an unchanged sale line keeps its original carrying basis instead of repricing it at the item's
   * current standard — and a line re-pointed at a different item does not inherit that basis */
  originalStandards?: Map<string, { itemId: string; cohorts: Array<{ standardCostCents: number; quantity: number }> }>;
}

/**
 * The cost-of-goods-sold entries for an invoice: one per line that sells an inventory item
 * with a known unit cost (DR Cost of Goods Sold, CR Inventory, quantity × unit cost in the base
 * currency; the invoice's exchange rate does not apply to inventory cost). The server lowers the
 * item's stock when it records the entry and raises it back when the entry is reversed.
 * Missing accounts never block the invoice: nothing is posted and `pendingReason` says why.
 */
export function planInvoiceCogs(input: InvoiceCogsInput): InvoiceCogsPlan {
  const { invoiceId, invoice, date, uid, workspaceId, baseCurrency, inventoryAccount, cogsAccount } = input;
  const itemById = new Map(input.items.map(i => [i.id, i]));
  const costed = (invoice.items || []).flatMap(line => {
    if (!line.itemId || !line.id) return [];
    const quantity = Number(line.quantity);
    // M-21 step 2: with the workspace posting at standard, the cost of goods is quantity × the item's
    // standard; without it (or with no standard), the moving average as before. An existing sale line
    // being reposted keeps the historical basis it was already posted at: each recorded cohort is
    // valued at its own standard (consumed oldest first), and only units a later edit added are valued
    // at the item's current standard — so amending a sale after a standard change does not reprice the
    // units it was already posted for, and a second amendment keeps the basis of the first as well.
    const recordedEntry = input.originalStandards?.get(line.id);
    // the recorded basis is only the line's own: a line whose item was replaced keeps the new item's
    // basis and never inherits the previous item's carrying value
    const cohorts = recordedEntry && recordedEntry.itemId === line.itemId ? recordedEntry.cohorts : undefined;
    let remaining = quantity;
    let historicalCost = 0;
    const atHistoricalCohorts: Array<{ standardCostCents: number; quantity: number }> = [];
    for (const cohort of cohorts || []) {
      if (validStandardCost(cohort.standardCostCents) === null || !Number.isFinite(cohort.quantity) || cohort.quantity <= 0) continue;
      const take = Math.min(remaining, Math.max(0, cohort.quantity));
      if (take <= 0) continue;
      historicalCost += Math.round(take * (cohort.standardCostCents as number));
      remaining -= take;
      atHistoricalCohorts.push({ standardCostCents: cohort.standardCostCents, quantity: take });
    }
    const atHistorical = quantity - remaining;
    const atCurrent = remaining;
    const currentBasis = input.postAtStandard ? validStandardCost(itemById.get(line.itemId)?.standardCostCents) : null;
    const currentUnitCost = atCurrent > 0 ? (currentBasis ?? line.unitCostCents ?? itemById.get(line.itemId)?.unitCostCents ?? 0) : 0;
    const currentCost = Math.round(atCurrent * currentUnitCost);
    const costCents = historicalCost + currentCost;
    const standard = atHistorical > 0 ? (atHistoricalCohorts[0]?.standardCostCents ?? null) : currentBasis;
    // a line is costed when either its historical units or its current-basis units carry a cost
    if (!Number.isFinite(quantity) || quantity <= 0) return [];
    if (atHistorical <= 0 && (!Number.isFinite(currentUnitCost) || currentUnitCost <= 0)) return [];
    // a recorded basis only exists for lines that already had a cost-of-goods entry; a fresh sale has
    // no historical basis, and its whole quantity is at the current standard (no cohort markers)
    const hasHistoricalBasis = recordedEntry !== undefined && cohorts !== undefined && cohorts.length > 0;
    // the cohorts the entry records are the whole basis the next repost sees: the historical ones plus
    // the cohort the units added by this posting were just priced at (the current standard)
    const recordedCohorts = atCurrent > 0 && currentBasis !== null
      ? [...atHistoricalCohorts, { standardCostCents: currentBasis, quantity: atCurrent }]
      : atHistoricalCohorts;
    return [{ line, itemId: line.itemId, lineId: line.id, quantity, costCents, atHistorical, hasHistoricalBasis, cohorts: recordedCohorts, standard: standard !== null, standardCost: standard }];
  }).filter(c => c.costCents > 0);

  if (costed.length === 0) return { entries: [] };
  if (!inventoryAccount || !cogsAccount) return { entries: [], pendingReason: COGS_ACCOUNTS_MISSING };

  const now = new Date().toISOString();
  const entries = costed.map(({ line, itemId, lineId, quantity, costCents, atHistorical, hasHistoricalBasis, cohorts, standardCost }): CogsEntry => {
    const name = itemById.get(itemId)?.name || line.description || 'item';
    return {
      uid,
      workspaceId,
      date,
      description: `Cost of goods sold: ${name} × ${quantity} (Invoice ${invoice.number || invoiceId})`,
      totalAmountCents: costCents,
      currency: baseCurrency,
      exchangeRate: 1,
      status: 'completed',
      type: 'actual',
      createdAt: now,
      metadata: { invoiceId, type: INVOICE_COGS_TYPE, cogsForInvoiceId: invoiceId, cogsForLineId: lineId, inventoryItemId: itemId, quantity, ...(standardCost !== null ? { standard: true, standardCostCents: standardCost, ...(hasHistoricalBasis && atHistorical < quantity ? { standardQty: atHistorical } : {}) } : {}), ...(hasHistoricalBasis ? { standards: cohorts } : {}), ...(line.dimensions?.location ? { locationId: line.dimensions.location } : {}), ...(invoice.customerId ? { customerId: invoice.customerId } : {}) },
      lines: [
        // the invoice line's labels (BF-09) go with its cost, so margin by project or location adds up
        { accountId: cogsAccount.id, accountName: cogsAccount.name, amountCents: costCents, debitCents: costCents, creditCents: 0, description: `Cost of ${name}`, ...(line.dimensions ? { dimensions: line.dimensions } : {}) },
        { accountId: inventoryAccount.id, accountName: inventoryAccount.name, amountCents: -costCents, debitCents: 0, creditCents: costCents, description: `Inventory out: ${name}` },
      ],
    };
  });
  return { entries };
}
