/**
 * Shared fixtures for the M-21 step 2 bot-review regression suites. The round-2 and round-3 suites
 * exercise the same posting paths (bills at standard, customer returns, invoice COGS) and only differ
 * in the findings they pin down, so the scaffolding they need lives here once instead of being
 * repeated in each suite's header.
 */
import { INVOICE_COGS_TYPE } from '../../services/invoiceCogs';
import type { LedgerPostContext } from '../../services/ledgerPost/postingCore';
import type { ChartAccount, CreditNote, InventoryItem, Invoice, Transaction, Workspace } from '../../types';
import { owner } from './commandTestUtils';

export interface M21BotFixtures {
  readonly WS: string;
  readonly OWNER: string;
  /** the chart the posting paths touch: stock, cash, receivable/payable, variance, COGS, returns */
  accounts(): ChartAccount[];
  /** an item sold at a 400 standard, the sale cost the return guard is checked against */
  returnItems(): InventoryItem[];
  /** a 1-unit receipt whose standard (80) is below its actual cost (100), for the bill tests */
  billItems(): InventoryItem[];
  /** a posting context; `stock` defaults to the standard-return items */
  contextFor(standardCosting?: { enabled: boolean; varianceAccountId: string }, captured?: LedgerPostContext['capture'], stock?: InventoryItem[]): LedgerPostContext;
  /** the COGS entry a sale of `quantity` units at `unitCost` posts in the ledger */
  saleEntry(unitCost: number, quantity: number, standard?: boolean): Transaction;
  /** a 10-unit sale of Chair at 9,000 whose COGS line was posted at a 400 standard */
  invoice(): Invoice;
  /** a credit note returning all 10 units of the invoice above */
  creditNote(id: string, number: string): Partial<CreditNote>;
  /** the sum of an entry's line amounts — every posting path's entry must balance to zero */
  entryTotal(entry: { lines: Array<{ amountCents: number }> }): number;
}

/** Fixtures bound to one workspace id, so each suite keeps its own isolated workspace. */
export function m21BotFixtures(ws: string): M21BotFixtures {
  const OWNER = owner.uid;
  const fixtures: M21BotFixtures = {
    WS: ws,
    OWNER,
    accounts: () => ([
      { id: 'acc_inv', uid: OWNER, workspaceId: ws, name: 'Inventory', code: '1300', type: 'asset', category: 'Inventory', balanceCents: 0 },
      { id: 'acc_exp', uid: OWNER, workspaceId: ws, name: 'Operating Expense', code: '6000', type: 'expense', category: 'Expense', balanceCents: 0 },
      { id: 'acc_ap', uid: OWNER, workspaceId: ws, name: 'Accounts Payable', code: '2000', type: 'liability', category: 'Payables', balanceCents: 0 },
      { id: 'acc_cash', uid: OWNER, workspaceId: ws, name: 'Cash', code: '1000', type: 'asset', category: 'Cash', balanceCents: 0 },
      { id: 'acc_ppv', uid: OWNER, workspaceId: ws, name: 'Purchase Price Variance', code: '5200', type: 'expense', category: 'Expense', balanceCents: 0 },
      { id: 'acc_ar', uid: OWNER, workspaceId: ws, name: 'Accounts Receivable', code: '1100', type: 'asset', category: 'Receivables', balanceCents: 0 },
      { id: 'acc_cogs', uid: OWNER, workspaceId: ws, name: 'Cost of Goods Sold', code: '5000', type: 'expense', category: 'Expense', balanceCents: 0 },
      { id: 'acc_sr', uid: OWNER, workspaceId: ws, name: 'Sales Returns', code: '4000', type: 'income', category: 'Revenue', balanceCents: 0 },
    ]),
    returnItems: () => ([
      { id: 'chair', uid: OWNER, workspaceId: ws, name: 'Chair', sku: 'CH-1', quantityAtHand: 0, unitCostCents: 0, unitPriceCents: 30000, reorderPoint: 0, standardCostCents: 400, createdAt: '2026-01-01T00:00:00.000Z' },
    ]),
    billItems: () => ([
      { id: 'chair', uid: OWNER, workspaceId: ws, name: 'Chair', sku: 'CH-1', quantityAtHand: 0, unitCostCents: 0, unitPriceCents: 30000, reorderPoint: 0, standardCostCents: 80, createdAt: '2026-01-01T00:00:00.000Z' },
    ]),
    contextFor: (standardCosting?: { enabled: boolean; varianceAccountId: string }, captured: LedgerPostContext['capture'] = [], stock?: InventoryItem[]): LedgerPostContext => ({
      accounts: fixtures.accounts(),
      transactions: [] as Transaction[],
      workspaces: [{ id: ws, uid: OWNER, name: 'Standard Co', currency: 'USD', ...(standardCosting ? { standardCosting } : {}) } as Workspace],
      inventory: stock ?? fixtures.returnItems(),
      capture: captured,
    }),
    saleEntry: (unitCost: number, quantity: number, standard = true): Transaction => ({
      id: 'tx_sale', uid: OWNER, workspaceId: ws, date: '2026-11-01', status: 'completed' as const,
      description: 'Cost of goods sold: Chair', currency: 'USD', type: 'actual',
      totalAmountCents: unitCost * quantity,
      lines: [],
      metadata: { type: INVOICE_COGS_TYPE, invoiceId: 'inv_1', cogsForLineId: 'l1', inventoryItemId: 'chair', quantity, standard },
    } as Transaction),
    invoice: (): Invoice => ({
      id: 'inv_1', number: 'INV-1', workspaceId: ws, uid: OWNER, status: 'approved' as const, currency: 'USD',
      date: '2026-11-01', dueDate: '2026-12-01', amountCents: 90000, customerId: 'c1',
      items: [{ id: 'l1', itemId: 'chair', description: 'Chair', quantity: 10, rateCents: 9000, amountCents: 90000, accountId: '', unitCostCents: 4000 }],
    } as Invoice),
    creditNote: (id: string, number: string): Partial<CreditNote> => ({
      id, workspaceId: ws, uid: OWNER, number, invoiceId: 'inv_1', customerId: 'c1',
      date: '2026-11-20', status: 'open' as const, currency: 'USD', amountCents: 90000,
      returnedGoods: [{ invoiceLineId: 'l1', itemId: 'chair', quantity: 10 }],
    }),
    entryTotal: (entry: { lines: Array<{ amountCents: number }> }) => entry.lines.reduce((s, l) => s + l.amountCents, 0),
  };
  return fixtures;
}
