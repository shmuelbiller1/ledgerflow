import { ledgerWrite } from './ledgerDoor';
import { FieldValue } from '../db/firestore';
import type { Firestore } from '../db/firestore';
import { assertPeriodOpen, validateWorkspaceAccounts } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import type { ValidationContext } from '../../kernel/validation/TransactionValidator';
import { stockMovesReady, writeStockMoves } from './stockMoveService';
import { revaluationValueCents } from '../../lib/inventoryAccounts';
import { resolveAccountRole } from '../../lib/accountUtils';
import { isCashAccount } from '../../lib/txFilters';
import { formatTzDate } from '../../lib/calendarDate';
import type { ChartAccount } from '../../types';

type WorkspaceData = ValidationContext['wsData'] & { currency?: string; timezone?: string };

/**
 * ISS-130 (GitHub #130): changing the unit cost of stock on hand is a revaluation. The stock's value moves from
 * quantity × old cost to quantity × new cost, and that difference is posted to the Inventory account against an
 * offset account (a revaluation gain or loss, or cost of goods sold) in the same database transaction that changes
 * the cost, so the stock list and the books cannot drift apart. The open-period check, the workspace's own
 * accounts, the item's own workspace and a request id (a retry finds the entry already made and changes nothing)
 * are all checked here. A browser can no longer change the cost of stock on hand directly (migration
 * 20261020120000_inventory_cost_server_only.sql); with nothing on hand the cost is only a template and stays
 * editable. Earlier sales keep the cost they were posted at: nothing posted before is touched. To undo a
 * revaluation, revalue back to the earlier cost (the trail keeps both entries).
 */

export class StockRevaluationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'StockRevaluationError';
  }
}

export interface StockRevaluationInput {
  workspaceId: string;
  user: { uid: string; admin?: boolean };
  wsData: WorkspaceData;
  date: string;
  itemId: string;
  newUnitCostCents: number;
  inventoryAccountId: string;
  offsetAccountId: string;
  reason: string;
  /** chosen by the caller once per revaluation; a retry with the same id returns the first result */
  requestId: string;
}

export interface StockRevaluationResult {
  transactionId: string | null;
  itemId: string;
  name: string;
  quantity: number;
  oldUnitCostCents: number;
  newUnitCostCents: number;
  /** the change in the Inventory account (positive: the stock is worth more) */
  valueCents: number;
  /** true when this request had already been applied: nothing was changed again */
  replayed: boolean;
}

/**
 * #259 review: a revaluation entry moves together with its item's cost and stock history, so the generic edit, void,
 * delete and Reverse & Correct paths refuse it (each would change the books and leave the cost as it is). The undo
 * is another revaluation back to the earlier cost. Returns the refusal, or null for any other entry.
 */
export function revaluationEntryLock(entry: { metadata?: Record<string, unknown> } | undefined | null): string | null {
  // EG-1 review: a repost correction moves with its item's cost and its cost-repost stock move in the same way
  if (entry?.metadata?.type === 'repost-cogs-adjust') {
    const name = String(entry.metadata.itemName || entry.metadata.itemId || 'the item');
    return `This entry corrects the cost of ${name} after a backdated change (repost). It is undone only with the entry it corrects (edit or void that document); changing, voiding, deleting or reversing it here would leave the stock history and the books apart.`;
  }
  // EG-6: a landed cost moves with its items' cost and its landed-cost stock moves; its own undo reverses both
  if (entry?.metadata?.type === 'landed-cost' || entry?.metadata?.type === 'landed-cost-undo') {
    return entry.metadata.type === 'landed-cost'
      ? 'This entry is a landed cost. Undo it with its own undo (POST /api/v1/inventory/landed-cost/<entry>/undo, or Landed cost → Undo), which reverses the entry and its stock moves together; changing, voiding, deleting or reversing it here would leave the items\' cost out of step with the books.'
      : 'This entry undoes a landed cost, together with its stock moves. It cannot be changed, voided, deleted or reversed here; land the cost again instead.';
  }
  if (entry?.metadata?.type !== 'stock-revaluation') return null;
  const item = String(entry.metadata.itemName || entry.metadata.itemId || 'the item');
  return `This entry is a stock revaluation of ${item}. To undo it, revalue ${item} back to its earlier cost (Inventory → Revalue cost); changing, voiding, deleting or reversing the entry here would leave the item's cost out of step with the books.`;
}

/** The entry id for a request: the same request always names the same entry. */
export const revaluationEntryId = (requestId: string) => `stock-revaluation-${requestId}`;

export async function revalueStock(db: Firestore, input: StockRevaluationInput): Promise<StockRevaluationResult> {
  const { workspaceId, date } = input;
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.requestId)) throw new StockRevaluationError(400, 'A revaluation needs a request id (8–80 letters, digits, - or _)');
  if (!Number.isInteger(input.newUnitCostCents) || input.newUnitCostCents < 0) throw new StockRevaluationError(400, 'The new cost must be whole cents, zero or more');
  if (!input.reason.trim()) throw new StockRevaluationError(400, 'Say why the cost changes');
  if (input.inventoryAccountId === input.offsetAccountId) throw new StockRevaluationError(400, 'Choose an offset account other than the Inventory account');
  await assertPeriodOpen(db, workspaceId, date, input.user.uid);
  const accounts = await validateWorkspaceAccounts(db, workspaceId, [input.inventoryAccountId, input.offsetAccountId]);
  const inventoryAcc = accounts.get(input.inventoryAccountId);
  const offsetAcc = accounts.get(input.offsetAccountId);
  if (!inventoryAcc || !offsetAcc) throw new StockRevaluationError(400, 'Choose accounts from this workspace');
  // #259 review: the stock leg is an Inventory account, and the difference goes to neither Inventory nor cash
  if (resolveAccountRole(inventoryAcc as unknown as ChartAccount) !== 'inventory') throw new StockRevaluationError(400, `${inventoryAcc.name} is not an Inventory account`);
  if (resolveAccountRole(offsetAcc as unknown as ChartAccount) === 'inventory') throw new StockRevaluationError(400, 'The difference cannot go to an Inventory account: choose a revaluation gain or loss, or cost of goods sold');
  if (isCashAccount(offsetAcc as unknown as ChartAccount)) throw new StockRevaluationError(400, 'The difference cannot go to a bank or cash account: no money moves in a revaluation');
  // #259 review: the new cost takes effect now, so the entry cannot be dated after today
  const today = formatTzDate(new Date(), typeof input.wsData?.timezone === 'string' ? input.wsData.timezone : 'UTC');
  if (date > today) throw new StockRevaluationError(400, `A revaluation cannot be dated after today (${today}): the new cost applies from now`);
  const currency = String(input.wsData?.currency || 'USD');
  await stockMovesReady(db);
  const entryRef = db.collection('transactions').doc(revaluationEntryId(input.requestId));
  const itemRef = db.collection('inventory').doc(input.itemId);

  return db.runTransaction(async t => {
    // a retry: the entry exists already, so report it and change nothing
    const earlier = await t.get(entryRef);
    if (earlier.exists) {
      const tx = earlier.data() || {};
      if (tx.workspaceId !== workspaceId) throw new StockRevaluationError(409, 'This request id was used elsewhere; send a new one');
      const m = (tx.metadata || {}) as Record<string, unknown>;
      return {
        transactionId: entryRef.id, itemId: String(m.itemId || input.itemId), name: String(m.itemName || ''), quantity: Number(m.quantity) || 0,
        oldUnitCostCents: Number(m.oldUnitCostCents) || 0, newUnitCostCents: Number(m.newUnitCostCents) || 0, valueCents: Number(m.valueCents) || 0, replayed: true,
      };
    }
    const snap = await t.get(itemRef);
    const item = snap.exists ? snap.data() || {} : null;
    // another workspace's item answers like a missing one
    if (!item || item.workspaceId !== workspaceId) throw new StockRevaluationError(404, `Item ${input.itemId} not found`);
    const name = String(item.name || input.itemId);
    const quantity = Number(item.quantityAtHand) || 0;
    if (quantity <= 0) throw new StockRevaluationError(400, `${name} has no stock on hand: change its cost on the item itself, nothing is revalued`);
    const oldUnitCostCents = Math.round(Number(item.unitCostCents) || 0);
    if (oldUnitCostCents === input.newUnitCostCents) throw new StockRevaluationError(400, `${name} already costs that`);
    const valueCents = revaluationValueCents(quantity, oldUnitCostCents, input.newUnitCostCents);
    // #259 review: a change too small to move the stock's value by a cent posts nothing and records nothing to
    // replay, so it is refused rather than changing the cost without an entry
    if (valueCents === 0) throw new StockRevaluationError(400, `Changing ${name} from ${oldUnitCostCents} to ${input.newUnitCostCents} cents on ${quantity} units moves its value by less than a cent: nothing is revalued`);
    // #259 review: the quantity revalued is today's, so the entry may not be dated before a later stock change
    const later = (await t.get(db.collection('stockMoves').where('workspaceId', '==', workspaceId).where('itemId', '==', input.itemId))).docs
      .map(d => String(d.data().date || '').slice(0, 10)).filter(d => d > date).sort();
    if (later.length) throw new StockRevaluationError(400, `${name}'s stock changed on ${later[later.length - 1]}, after ${date}: date the revaluation on or after that day, so it revalues the stock on hand then`);

    const lines = [
      { id: 'line-1', accountId: inventoryAcc.id, accountName: inventoryAcc.name, amountCents: valueCents, description: `${name}: ${quantity} at ${oldUnitCostCents} → ${input.newUnitCostCents} cents` },
      { id: 'line-2', accountId: offsetAcc.id, accountName: offsetAcc.name, amountCents: -valueCents, description: `Stock revaluation: ${input.reason.trim()}` },
    ];
    const tx = await TransactionValidator.validateAndPrepare({
      id: entryRef.id,
      workspaceId,
      uid: input.user.uid,
      date,
      description: `Stock revaluation: ${name}`,
      totalAmountCents: Math.abs(valueCents),
      currency,
      type: 'journal',
      status: 'approved',
      createdAt: new Date().toISOString(),
      metadata: {
        type: 'stock-revaluation', reason: input.reason.trim(), requestId: input.requestId,
        itemId: input.itemId, itemName: name, quantity, oldUnitCostCents, newUnitCostCents: input.newUnitCostCents, valueCents,
      },
      lines,
    }, { workspaceId, user: input.user, wsData: input.wsData }, undefined, t);
    const transactionId = tx.id;
    await ledgerWrite(t, entryRef, { ...tx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    t.update(itemRef, { unitCostCents: input.newUnitCostCents, updatedAt: FieldValue.serverTimestamp() });
    // W-02: the history keeps the change of value (no units move), so a past valuation includes it on its date
    writeStockMoves(db, t, [{
      workspaceId, itemId: input.itemId, itemName: name, date, kind: 'revaluation',
      quantity: 0, quantityBefore: quantity, quantityAfter: quantity,
      unitCostCents: input.newUnitCostCents, valueCents, transactionId, documentType: 'adjustment' as const, uid: input.user.uid,
    }]);
    return { transactionId, itemId: input.itemId, name, quantity, oldUnitCostCents, newUnitCostCents: input.newUnitCostCents, valueCents, replayed: false };
  });
}
