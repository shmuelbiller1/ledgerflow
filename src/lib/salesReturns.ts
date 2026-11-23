/**
 * Sales returns (BF-06): goods a customer sends back, on the credit note for them. A credit note
 * linked to an invoice may list, for each stock line of that invoice, how many came back. Posting
 * puts those units back into stock at the cost they left at (the invoice line's own cost-of-goods-
 * sold entry), once: DR Inventory, CR Cost of goods sold. A line can't take back more than was sold
 * on it, less what earlier returns took back; the server checks that again
 * (src/server/services/cogsStockService.ts), records each return in the stock history, and voiding
 * or editing the credit note reverses its returns like any other entry.
 */
import type { CreditNote, Invoice, Transaction, TransactionLine } from '../types';
import { INVOICE_COGS_TYPE } from '../services/invoiceCogs';
import { isPostable } from './txFilters';

export const SALES_RETURN_TYPE = 'credit-return-auto';

export interface ReturnedGoods {
  /** the invoice line the goods were sold on */
  invoiceLineId: string;
  itemId: string;
  quantity: number;
}

export interface ReturnableLine {
  invoiceLineId: string;
  itemId: string;
  description: string;
  sold: number;
  returned: number;
  returnable: number;
  /** the cost per unit when it left stock, in home-currency cents */
  unitCostCents: number;
  /** the sale's total cost of goods, in home-currency cents (unitCostCents is rounded from it) */
  saleTotalCents?: number;
  /** M-21 step 2: the sale was posted at the item's standard cost (not the moving average) */
  saleStandard?: boolean;
  /** the price per unit on the invoice, in the invoice's currency */
  unitPriceCents: number;
  /** W-01: where the units left from; they come back there */
  locationId?: string;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Entries still in force: postable, not a reversal, not reversed by another entry of the ledger. */
function inForce(entries: Transaction[], ledger: Transaction[]): Transaction[] {
  // a reversal need not name the invoice (a voided credit note's reversal names only the credit note)
  const reversed = new Set(ledger.map(t => t.metadata?.reversesTxId).filter(Boolean));
  return entries.filter(t => isPostable(t) && !t.metadata?.isReversal && !t.reversalEventId && !reversed.has(t.id));
}

/**
 * The lines of an invoice whose goods left stock (they have a cost-of-goods-sold entry), with what
 * was sold, what earlier returns took back, and what can still come back. `ledger` holds the entries
 * of this invoice (its cost-of-goods-sold entries and the returns against it, with their reversals).
 */
export function returnableLines(invoice: Pick<Invoice, 'id' | 'items'>, ledger: Transaction[], exceptCreditNoteId?: string): ReturnableLine[] {
  const entries = inForce(ledger.filter(t => t.metadata?.invoiceId === invoice.id), ledger);
  return (invoice.items || []).flatMap(line => {
    if (!line.itemId || !line.id) return [];
    const sale = entries.find(t => t.metadata?.type === INVOICE_COGS_TYPE && t.metadata?.cogsForLineId === line.id);
    if (!sale) return [];
    const sold = Number(sale.metadata?.quantity) || 0;
    if (sold <= 0) return [];
    const returned = round6(entries
      .filter(t => t.metadata?.type === SALES_RETURN_TYPE && t.metadata?.returnForLineId === line.id && t.metadata?.creditNoteId !== exceptCreditNoteId)
      .reduce((s, t) => s + (Number(t.metadata?.quantity) || 0), 0));
    return [{
      invoiceLineId: line.id, itemId: line.itemId, description: line.description || '',
      sold, returned, returnable: Math.max(0, round6(sold - returned)),
      unitCostCents: Math.round(Math.abs(Number(sale.totalAmountCents) || 0) / sold),
      saleTotalCents: Math.abs(Number(sale.totalAmountCents) || 0),
      unitPriceCents: Number(line.rateCents) || 0,
      ...(sale.metadata?.standard === true ? { saleStandard: true } : {}),
      ...(typeof sale.metadata?.locationId === 'string' && sale.metadata.locationId ? { locationId: sale.metadata.locationId } : {}),
    }];
  });
}

/** Why these returned goods can't be recorded, or null. */
export function returnProblem(goods: ReturnedGoods[], lines: ReturnableLine[]): string | null {
  for (const g of goods) {
    const line = lines.find(l => l.invoiceLineId === g.invoiceLineId);
    if (!line || line.itemId !== g.itemId) return 'Goods can be returned only from the stock lines of the credited invoice';
    if (!Number.isFinite(g.quantity) || g.quantity < 0 || round6(g.quantity) !== g.quantity) return `Enter how many of ${line.description || 'the item'} came back`;
    if (g.quantity > line.returnable) return `Only ${line.returnable} of ${line.description || 'the item'} can come back (${line.sold} sold, ${line.returned} already returned)`;
  }
  return null;
}

/** The entries a credit note's returned goods post: stock back in at the cost it left at. */
export function planReturnEntries(input: {
  creditNote: Pick<CreditNote, 'id' | 'number' | 'invoiceId' | 'date'> & { returnedGoods?: ReturnedGoods[]; customerId?: string };
  lines: ReturnableLine[];
  uid: string;
  workspaceId: string;
  baseCurrency: string;
  inventoryAccount: { id: string; name: string };
  cogsAccount: { id: string; name: string };
}): Array<Omit<Transaction, 'id'>> {
  const { creditNote, lines } = input;
  return (creditNote.returnedGoods || []).flatMap(g => {
    const line = lines.find(l => l.invoiceLineId === g.invoiceLineId);
    if (!line || !(g.quantity > 0)) return [];
    const cents = Math.round(g.quantity * line.unitCostCents);
    if (cents <= 0) return [];
    const name = line.description || 'item';
    const entryLines: TransactionLine[] = [
      { accountId: input.inventoryAccount.id, accountName: input.inventoryAccount.name, amountCents: cents, debitCents: cents, creditCents: 0, description: `Returned to stock: ${name}` },
      { accountId: input.cogsAccount.id, accountName: input.cogsAccount.name, amountCents: -cents, debitCents: 0, creditCents: cents, description: `Cost of ${name} returned` },
    ];
    return [{
      uid: input.uid, workspaceId: input.workspaceId, date: creditNote.date,
      description: `Goods returned: ${name} × ${g.quantity} (Credit note ${creditNote.number || creditNote.id})`,
      totalAmountCents: cents, currency: input.baseCurrency, exchangeRate: 1, status: 'completed', type: 'actual', createdAt: new Date().toISOString(),
      metadata: { type: SALES_RETURN_TYPE, creditNoteId: creditNote.id, invoiceId: creditNote.invoiceId, returnForLineId: g.invoiceLineId, inventoryItemId: g.itemId, quantity: g.quantity, ...(line.saleStandard ? { standard: true } : {}), ...(line.locationId ? { locationId: line.locationId } : {}), ...(creditNote.customerId ? { customerId: creditNote.customerId } : {}) },
      lines: entryLines,
    } as Omit<Transaction, 'id'>];
  });
}
