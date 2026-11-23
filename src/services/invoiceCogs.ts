import type { ChartAccount, InventoryItem, Invoice, TransactionLine } from '../types';

/** metadata.type of the cost-of-goods-sold entry posted for one invoice line. */
export const INVOICE_COGS_TYPE = 'invoice-cogs-auto';

export const COGS_ACCOUNTS_MISSING =
  'Add an Inventory account and a Cost of Goods Sold account to record the cost of items sold.';

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
  items: Pick<InventoryItem, 'id' | 'name' | 'unitCostCents' | 'unitCostMicroCents'>[];
}

/** INV-01: the cost of a line that sells a known-cost item and computes to zero (a genuine free or gift). */
export const COGS_ZERO_COST =
  'The item is on this invoice at no cost, so no cost of goods was posted; the stock was still shipped.';

/** INV-01: the cost of a line is not on the invoice yet and not known on the item either. */
export const COGS_COST_UNKNOWN =
  'The cost of goods sold could not be determined: the item has no cost recorded. Add the item cost on Inventory, save the invoice again, or post the cost of goods manually.';

/**
 * The cost-of-goods-sold entries for an invoice: one per line that sells an inventory item with a
 * known unit cost (DR Cost of Goods Sold, CR Inventory, quantity × unit cost in the base currency;
 * the invoice's exchange rate does not apply to inventory cost). The server lowers the item's stock
 * when it records the entry and raises it back when the entry is reversed.
 *
 * A zero cost and an unknown cost are not the same (INV-01): a line that sells an item whose cost is
 * genuinely zero (or waived on the line) still ships stock, so it gets a zero-value entry that moves
 * it out — without accounts nothing moves and the invoice is flagged. When the cost is unknown, no
 * entry is posted and the invoice is flagged for review; the caller ships the stock separately.
 * Missing accounts never block the invoice: nothing is posted and `pendingReason` says why.
 */
export function planInvoiceCogs(input: InvoiceCogsInput): InvoiceCogsPlan {
  const { invoiceId, invoice, date, uid, workspaceId, baseCurrency, inventoryAccount, cogsAccount } = input;
  const itemById = new Map(input.items.map(i => [i.id, i]));
  const lines = (invoice.items || []).flatMap(line => {
    if (!line.itemId || !line.id) return [];
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return [];
    const explicit = line.unitCostCents;
    const itemCost = itemById.get(line.itemId)?.unitCostCents;
    const costKnown = Number.isFinite(explicit) || Number.isFinite(itemCost);
    // INV-02: the exact average (unitCostMicroCents, in millionths of a cent) is what the cost is
    // computed from, so a fractional average does not round away cents across a whole lot
    const microOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);
    // INV-02: an explicit line cost (unitCostCents or unitCostMicroCents) takes precedence over the
    // item's average — convert it to micro-cents before falling back to either item cost field.
    const microCents = microOf(line.unitCostMicroCents)
      ?? (Number.isFinite(explicit) ? Math.round((explicit as number) * 1_000_000) : undefined)
      ?? microOf(itemById.get(line.itemId)?.unitCostMicroCents);
    const unitCostMicro = microCents ?? Math.round((explicit ?? itemCost ?? 0) * 1_000_000);
    return [{ line, itemId: line.itemId, lineId: line.id, quantity, costKnown, costCents: Math.round((quantity * unitCostMicro) / 1_000_000) }];
  });

  // a line ships stock when its cost is known (zero-cost items still leave the shelf); an unknown
  // cost ships nothing and flags the invoice for review
  const shippable = lines.filter(c => c.costKnown);
  const pendingReason = lines.some(c => !c.costKnown) ? COGS_COST_UNKNOWN : undefined;

  // missing accounts never block the invoice: nothing posts and the reason says why (only when the
  // invoice actually sells stock — a service-only invoice has nothing that needs them)
  if (!inventoryAccount || !cogsAccount) {
    return { entries: [], ...(lines.length > 0 ? { pendingReason: COGS_ACCOUNTS_MISSING } : {}) };
  }
  if (shippable.length === 0) return { entries: [], pendingReason };

  const now = new Date().toISOString();
  const entries = shippable.map(({ line, itemId, lineId, quantity, costCents }): CogsEntry => {
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
      metadata: { invoiceId, type: INVOICE_COGS_TYPE, cogsForInvoiceId: invoiceId, cogsForLineId: lineId, inventoryItemId: itemId, quantity, ...(line.dimensions?.location ? { locationId: line.dimensions.location } : {}), ...(invoice.customerId ? { customerId: invoice.customerId } : {}) },
      lines: [
        // the invoice line's labels (BF-09) go with its cost, so margin by project or location adds up
        { accountId: cogsAccount.id, accountName: cogsAccount.name, amountCents: costCents, debitCents: costCents, creditCents: 0, description: `Cost of ${name}`, ...(line.dimensions ? { dimensions: line.dimensions } : {}) },
        { accountId: inventoryAccount.id, accountName: inventoryAccount.name, amountCents: -costCents, debitCents: 0, creditCents: costCents, description: `Inventory out: ${name}` },
      ],
    };
  });
  return { entries };
}
