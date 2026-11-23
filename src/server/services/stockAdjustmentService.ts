import { ledgerWrite } from './ledgerDoor';
import Decimal from 'decimal.js';
import { FieldValue } from '../db/firestore';
import type { Firestore, Transaction } from '../db/firestore';
import { assertPeriodOpen, validateWorkspaceAccounts } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import type { ValidationContext } from '../../kernel/validation/TransactionValidator';
import { stockMovesReady, writeStockMoves } from './stockMoveService';
import { stockByLocation, type StockMove } from '../../lib/stockMoves';
import { isStandardizing, validStandardCost } from '../../lib/standardCostSettings';

type WorkspaceData = ValidationContext['wsData'] & { currency?: string };

/**
 * Changing stock with the books (K-13 BA-04 W-04 W-05): every change of an item's quantity on hand
 * posts the same value to the Inventory account against an offset account (a variance / shrinkage
 * expense for losses and counts, equity for opening stock, cash or payables for a purchase), and
 * both are written in one database transaction. A stock count adjusts many items in one entry.
 * Quantities never go below zero; values are in the workspace currency at each item's cost.
 */

export class StockAdjustmentError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'StockAdjustmentError';
  }
}

export interface StockChange {
  itemId: string;
  /** Units added (positive) or removed (negative); for a count, computed from the counted quantity. */
  quantityChange?: number;
  /** Count only: the quantity found. */
  counted?: number;
  /** Cost per unit for added stock (a purchase); otherwise the item's own cost. */
  unitCostCents?: number;
}

export interface StockAdjustmentInput {
  workspaceId: string;
  user: { uid: string; admin?: boolean };
  wsData: WorkspaceData;
  date: string;
  inventoryAccountId: string;
  offsetAccountId: string;
  /** purchase recalculates the average cost; opening, adjustment and count keep it. */
  kind: 'purchase' | 'opening' | 'adjustment' | 'count';
  reason?: string;
  changes: StockChange[];
  /** W-01: where the change happened (a Location label value); none = no location */
  locationId?: string;
}

export interface StockAdjustmentResult {
  transactionId: string | null;
  valueCents: number;
  items: Array<{ itemId: string; name: string; before: number; after: number; valueCents: number; unitCostCents: number }>;
}

const KIND_LABEL = { purchase: 'Stock purchase', opening: 'Opening stock', adjustment: 'Stock adjustment', count: 'Stock count' } as const;

export interface StockAdjustmentAccounts {
  inventoryAcc: { id: string; name: string };
  offsetAcc: { id: string; name: string };
  currency: string;
  /** W-02: whether the stock history is set up (a count at a location needs it). */
  historyKept: boolean;
}

/** The checks and reads ahead of the write (read-only); the command runner and `adjustStock` share them. */
export async function prepareAdjustStock(db: Firestore, input: StockAdjustmentInput): Promise<StockAdjustmentAccounts> {
  const { workspaceId, date } = input;
  if (input.inventoryAccountId === input.offsetAccountId) throw new StockAdjustmentError(400, 'Choose an offset account other than the Inventory account');
  await assertPeriodOpen(db, workspaceId, date, input.user.uid);
  const accounts = await validateWorkspaceAccounts(db, workspaceId, [input.inventoryAccountId, input.offsetAccountId]);
  const inventoryAcc = accounts.get(input.inventoryAccountId);
  const offsetAcc = accounts.get(input.offsetAccountId);
  if (!inventoryAcc || !offsetAcc) throw new StockAdjustmentError(400, 'Choose accounts from this workspace');
  return {
    inventoryAcc: { id: inventoryAcc.id, name: inventoryAcc.name },
    offsetAcc: { id: offsetAcc.id, name: offsetAcc.name },
    currency: String(input.wsData?.currency || 'USD'),
    historyKept: await stockMovesReady(db),
  };
}

export async function adjustStock(db: Firestore, input: StockAdjustmentInput): Promise<StockAdjustmentResult> {
  const prepared = await prepareAdjustStock(db, input);
  return db.runTransaction(t => adjustStockInTransaction(db, t, input, prepared));
}

/** The write, inside a transaction the caller owns: quantities, the entry and the history together. */
export async function adjustStockInTransaction(db: Firestore, t: Transaction, input: StockAdjustmentInput, prepared: StockAdjustmentAccounts): Promise<StockAdjustmentResult> {
  const { workspaceId, date, kind } = input;
  const { inventoryAcc, offsetAcc, currency, historyKept } = prepared;
  // M-21 step 2: while the workspace posts at the standard, the stock is carried at quantity × standard in the
  // books, so an adjust/count/manual-purchase that posts Inventory at the item's actual cost (unitCostCents)
  // would leave the account out of step with the standard-valued stock. These paths were not converted to the
  // standard basis, so they are refused for standard items until they are.
  const ws = (await t.get(db.collection('workspaces').doc(workspaceId))).data() as Record<string, unknown> | undefined;
  const standardizing = isStandardizing(ws);
  {
    const refs = input.changes.map(c => db.collection('inventory').doc(c.itemId));
    const snaps = await Promise.all(refs.map(r => t.get(r)));
    // W-01: a count at one location is compared with what is there, not with the item's total
    const atLocation = new Map<string, number>();
    if (kind === 'count' && input.locationId && historyKept) {
      for (const change of input.changes) {
        const history = (await t.get(db.collection('stockMoves').where('workspaceId', '==', workspaceId).where('itemId', '==', change.itemId))).docs.map(d => d.data() as StockMove);
        atLocation.set(change.itemId, stockByLocation(history).get(input.locationId) || 0);
      }
    }
    const moves: StockAdjustmentResult['items'] = [];
    const updates: Array<{ ref: typeof refs[number]; data: Record<string, unknown> }> = [];

    input.changes.forEach((change, i) => {
      const snap = snaps[i];
      const item = snap.exists ? snap.data() || {} : null;
      // another workspace's item answers like a missing one
      if (!item || item.workspaceId !== workspaceId) throw new StockAdjustmentError(404, `Item ${change.itemId} not found`);
      // M-21 step 2: refuse standard items while the workspace posts at the standard (see above)
      if (standardizing && validStandardCost(item.standardCostCents) !== null) {
        throw new StockAdjustmentError(409, `${item.name || change.itemId} is valued at its standard cost and this workspace posts at the standard. Stock counts, adjustments and manual purchases post at the standard carrying basis (with the variance to the variance account), which is not supported yet: turn standard-cost posting off, or change the item's standard to none.`);
      }
      const before = new Decimal(Number(item.quantityAtHand) || 0);
      const countedFrom = kind === 'count' && input.locationId ? new Decimal(atLocation.get(change.itemId) || 0) : before;
      const delta = kind === 'count' ? new Decimal(Number(change.counted)).minus(countedFrom) : new Decimal(Number(change.quantityChange) || 0);
      if (delta.isZero()) return;
      const after = before.plus(delta);
      if (after.lt(0)) throw new StockAdjustmentError(400, `${item.name || change.itemId}: only ${before.toNumber()} on hand, cannot remove ${delta.abs().toNumber()}`);
      const itemCost = new Decimal(Number(item.unitCostCents) || 0);
      const unitCost = kind === 'purchase' && change.unitCostCents !== undefined ? new Decimal(change.unitCostCents) : itemCost;
      if (unitCost.lte(0) && kind !== 'count') throw new StockAdjustmentError(400, `${item.name || change.itemId} has no cost; set its unit cost first`);
      const valueCents = delta.mul(unitCost).round().toNumber();
      const data: Record<string, unknown> = { quantityAtHand: after.toNumber(), updatedAt: FieldValue.serverTimestamp() };
      if (kind === 'purchase' && delta.gt(0)) {
        // weighted average cost of what is on hand after the purchase
        const average = before.mul(itemCost).plus(delta.mul(unitCost)).div(after).round().toNumber();
        data.unitCostCents = average;
      }
      moves.push({ itemId: change.itemId, name: String(item.name || change.itemId), before: before.toNumber(), after: after.toNumber(), valueCents, unitCostCents: unitCost.toNumber() });
      updates.push({ ref: refs[i], data });
    });

    if (moves.length === 0) throw new StockAdjustmentError(400, 'Nothing to change: the quantities are already right');
    const valueCents = moves.reduce((s, m) => s + m.valueCents, 0);
    let transactionId: string | null = null;

    if (moves.some(m => m.valueCents !== 0)) {
      const label = KIND_LABEL[kind];
      const lines = moves.filter(m => m.valueCents !== 0).map((m, n) => ({
        id: `line-${n + 1}`,
        accountId: inventoryAcc.id,
        accountName: inventoryAcc.name,
        amountCents: m.valueCents,
        description: `${m.name}: ${m.before} → ${m.after}`,
      }));
      lines.push({ id: `line-${lines.length + 1}`, accountId: offsetAcc.id, accountName: offsetAcc.name, amountCents: -valueCents, description: input.reason ? `${label}: ${input.reason}` : label });
      const tx = await TransactionValidator.validateAndPrepare({
        id: db.collection('transactions').doc().id,
        workspaceId,
        uid: input.user.uid,
        date,
        description: moves.length === 1 ? `${label}: ${moves[0].name} (${moves[0].after - moves[0].before > 0 ? '+' : ''}${moves[0].after - moves[0].before})` : `${label}: ${moves.length} items`,
        totalAmountCents: Math.abs(valueCents),
        currency,
        type: 'journal',
        status: 'approved',
        createdAt: new Date().toISOString(),
        metadata: { type: `stock-${kind}`, reason: input.reason || null, items: moves.map(m => ({ itemId: m.itemId, before: m.before, after: m.after })) },
        lines,
      }, { workspaceId, user: input.user, wsData: input.wsData }, undefined, t);
      transactionId = tx.id;
      await ledgerWrite(t, db.collection('transactions').doc(tx.id), { ...tx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    }
    for (const u of updates) t.update(u.ref, u.data);
    // W-02: the history of each item changed, with the entry it belongs to
    writeStockMoves(db, t, moves.map(m => ({
      workspaceId, itemId: m.itemId, itemName: m.name, date, kind,
      quantity: Number(new Decimal(m.after).minus(m.before)), quantityBefore: m.before, quantityAfter: m.after,
      unitCostCents: m.unitCostCents, valueCents: m.valueCents, transactionId, documentType: 'adjustment' as const,
      uid: input.user.uid, ...(input.locationId ? { locationId: input.locationId } : {}),
      // DIM-2 phase 3: why, as written with the adjustment
      ...(typeof input.reason === 'string' && input.reason.trim() ? { purpose: input.reason.trim().slice(0, 200) } : {}),
    })));
    return { transactionId, valueCents, items: moves };
  }
}
