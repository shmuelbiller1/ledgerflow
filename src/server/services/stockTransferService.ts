/**
 * Moving stock between locations (W-01): units of an item go from one location to another. The
 * item's quantity on hand and the books do not change (the same Inventory account holds both), so
 * nothing is posted; the history records the pair (moved out, moved in) with the quantity before and
 * after unchanged in total. More than is at the "from" location is refused; so is a date in a closed
 * period. Owners, accountants and bookkeepers; audited.
 */
import type { Firestore, Transaction } from '../db/firestore';
import { assertPeriodOpen } from '../db/firestore';
import { stockByLocation, transferProblem, type StockMove } from '../../lib/stockMoves';
import { stockMovesReady, writeStockMoves } from './stockMoveService';
import { writeServerAuditLog } from './auditLogService';
import { StockAdjustmentError } from './stockAdjustmentService';

export interface StockTransferInput {
  workspaceId: string; uid: string; email?: string; itemId: string; from: string; to: string; quantity: number; date: string; note?: string;
}

/** The period and stock-history checks ahead of the write (read-only). */
export async function prepareTransferStock(db: Firestore, input: StockTransferInput): Promise<void> {
  await assertPeriodOpen(db, input.workspaceId, input.date, input.uid);
  // locations are known only from the stock history (W-02)
  if (!(await stockMovesReady(db))) throw new StockAdjustmentError(503, 'Stock locations need the stock history, which this server does not have yet. Ask the owner to apply the stock-moves database update.');
}

export async function transferStock(db: Firestore, input: StockTransferInput) {
  await prepareTransferStock(db, input);
  return db.runTransaction(t => transferStockInTransaction(db, t, input));
}

/** The write, inside a transaction the caller owns: the two history rows, no posting. */
export async function transferStockInTransaction(db: Firestore, t: Transaction, input: StockTransferInput) {
  {
    const snap = await t.get(db.collection('inventory').doc(input.itemId));
    const item = snap.exists ? snap.data() : undefined;
    if (!item || item.workspaceId !== input.workspaceId) throw new StockAdjustmentError(404, `Item ${input.itemId} not found`);
    const history = (await t.get(db.collection('stockMoves').where('workspaceId', '==', input.workspaceId).where('itemId', '==', input.itemId))).docs.map(d => d.data() as StockMove);
    // an item without a history keeps all its stock at no location
    const at = history.length ? stockByLocation(history) : new Map([['', Number(item.quantityAtHand) || 0]]);
    const problem = transferProblem(input, at);
    if (problem) throw new StockAdjustmentError(400, problem);
    const total = Number(item.quantityAtHand) || 0;
    const unitCostCents = Number(item.unitCostCents) || 0;
    const valueCents = Math.round(input.quantity * unitCostCents);
    const common = { workspaceId: input.workspaceId, itemId: input.itemId, itemName: String(item.name || ''), date: input.date, unitCostCents, transactionId: null, uid: input.uid };
    writeStockMoves(db, t, [
      { ...common, kind: 'transfer-out', quantity: -input.quantity, quantityBefore: total, quantityAfter: total - input.quantity, valueCents: -valueCents, ...(input.from ? { locationId: input.from } : {}) },
      { ...common, kind: 'transfer-in', quantity: input.quantity, quantityBefore: total - input.quantity, quantityAfter: total, valueCents, ...(input.to ? { locationId: input.to } : {}) },
    ]);
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'STOCK_MOVED', entityType: 'inventory', entityId: input.itemId,
      details: { description: `Moved ${input.quantity} of ${item.name || input.itemId} from ${input.from || 'no location'} to ${input.to || 'no location'}${input.note ? `: ${input.note}` : ''}` },
    }, { db, tx: t });
    return { moved: input.quantity, from: input.from, to: input.to };
  }
}
