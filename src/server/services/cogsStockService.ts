import { FieldValue } from '../db/firestore';
import type { DocumentData, Firestore, Transaction as DbTransaction } from '../db/firestore';
import { INVOICE_COGS_TYPE } from '../../services/invoiceCogs';
import { SALES_RETURN_TYPE } from '../../lib/salesReturns';
import { DELIVERY_COGS_TYPE, DELIVERY_RETURN_TYPE, goodsLeaveWith } from '../../lib/deliveries';
import { isPostable } from '../../lib/txFilters';
import { BILL_ACCRUAL_TYPE } from '../../lib/billStock';
import type { Transaction } from '../../types';
import { stockMovesReady, writeStockMoves, type NewStockMove } from './stockMoveService';
import { REPOST_COGS_TYPE } from './repostMarker';

/**
 * Stock follows the ledger: a cost-of-goods-sold entry for an invoice line (metadata.type
 * 'invoice-cogs-auto') lowers the item's quantity on hand, and reversing that entry raises it
 * back. The stock change is written in the same database transaction as the ledger entries,
 * so the two can't drift apart. A ledger entry can be reversed only once. Selling more than is on
 * hand is recorded with a warning, unless an owner turned on "Refuse sales beyond stock"
 * (`refuseNegativeStock` on the workspace, W-06: stockPolicyService.ts); then it is refused and
 * nothing is written. Putting stock back (a reversal) is never refused.
 *
 * J-08: a bill's entry may carry its item lines (`metadata.stockIn`): the units come in at the value
 * the line posted to Inventory, and the item's average cost moves with them; reversing the entry
 * takes them out again.
 *
 * BF-08 step 2: in a workspace where stock leaves with deliveries (`goodsLeaveWith: 'delivery'`), a
 * delivery's cost entry ('delivery-cogs-auto', deliveryService.ts) lowers stock the same way, and an
 * invoice's cost entry is refused: the goods leave once, with the delivery.
 */

export class LedgerPostingError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'LedgerPostingError';
  }
}

interface LedgerEntry {
  id: string;
  date?: string;
  uid?: string;
  totalAmountCents?: number;
  metadata?: Record<string, unknown>;
}

/** One entry's effect on one item, in the order of the request (W-02 records each as a stock move). */
interface PendingMove {
  itemId: string;
  quantity: number;
  kind: 'sale' | 'sale-reversal' | 'return' | 'return-reversal' | 'purchase' | 'purchase-reversal' | 'purchase-return' | 'purchase-return-reversal';
  entry: LedgerEntry;
  valueCents: number;
  location?: string;
  /** DIM-2 phase 2: the document line the units came in on or went back from, and the entry that names them */
  line?: number;
  source?: LedgerEntry;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * The moving-average cost after units come in (or go back) at a value: what was on hand (never below zero) at the old
 * cost plus the value, over what is on hand after. Shared by the posting (below) and the EG-1 repost replay
 * (repostService.ts), so a replay with nothing backdated finds the very same figures.
 */
export function movingAverageCents(before: number, costCents: number, valueCents: number, after: number): number {
  return Math.round((Math.max(0, before) * costCents + valueCents) / after);
}

function cogsMove(tx: { metadata?: Record<string, unknown> }): { itemId: string; quantity: number } | null {
  const meta = tx.metadata;
  if (meta?.type !== INVOICE_COGS_TYPE && meta?.type !== DELIVERY_COGS_TYPE) return null;
  const itemId = meta.inventoryItemId;
  const quantity = Number(meta.quantity);
  if (typeof itemId !== 'string' || !itemId || !Number.isFinite(quantity) || quantity <= 0) {
    throw new LedgerPostingError(400, 'A cost of goods sold entry needs inventoryItemId and a positive quantity.');
  }
  return { itemId, quantity };
}

/** Goods a customer sent back (BF-06, src/lib/salesReturns.ts): the units come back into stock. */
function returnMove(tx: { metadata?: Record<string, unknown> }): { itemId: string; quantity: number; invoiceId: string; lineId: string } | null {
  const meta = tx.metadata;
  if (meta?.type !== SALES_RETURN_TYPE) return null;
  const quantity = Number(meta.quantity);
  if (typeof meta.inventoryItemId !== 'string' || !meta.inventoryItemId || typeof meta.invoiceId !== 'string' || typeof meta.returnForLineId !== 'string' || !Number.isFinite(quantity) || quantity <= 0) {
    throw new LedgerPostingError(400, 'A goods-returned entry needs the item, the invoice line and a positive quantity.');
  }
  return { itemId: meta.inventoryItemId, quantity, invoiceId: meta.invoiceId, lineId: meta.returnForLineId };
}

/**
 * J-08: the item lines of a bill (`metadata.stockIn` on its entry, src/lib/billStock.ts): each brings
 * units in at the value its line posted to Inventory.
 */
function billStockIn(tx: LedgerEntry): Array<{ itemId: string; quantity: number; valueCents: number; line?: number }> {
  const lines = tx.metadata?.stockIn;
  if (lines === undefined) return [];
  if (tx.metadata?.type !== BILL_ACCRUAL_TYPE || !Array.isArray(lines) || lines.length > 500) {
    throw new LedgerPostingError(400, 'Stock comes in only on a bill\'s entry, as a list of its item lines.');
  }
  return lines.map(raw => {
    const l = (raw || {}) as Record<string, unknown>;
    const quantity = Number(l.quantity);
    const valueCents = Number(l.valueCents);
    if (typeof l.itemId !== 'string' || !l.itemId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(valueCents) || valueCents < 0) {
      throw new LedgerPostingError(400, 'Each item line of a bill needs the item, a positive quantity and its value in whole cents.');
    }
    // DIM-2 phase 2: the bill's own line (src/lib/billStock.ts keeps its index), when it is a whole number
    return { itemId: l.itemId, quantity, valueCents, ...(Number.isSafeInteger(l.line) && Number(l.line) >= 0 ? { line: Number(l.line) } : {}) };
  });
}

/**
 * BF-07: the stock a vendor credit sends back (`metadata.stockOut` on its entry, src/lib/vendorReturns.ts):
 * each takes units out at the value its line took off Inventory.
 */
function vendorReturnOut(tx: LedgerEntry): Array<{ itemId: string; quantity: number; valueCents: number; line?: number }> {
  const lines = tx.metadata?.stockOut;
  if (lines === undefined) return [];
  if (tx.metadata?.type !== 'vendor-credit-issuance' || !Array.isArray(lines) || lines.length > 500) {
    throw new LedgerPostingError(400, 'Stock goes back to a vendor only on a vendor credit\'s entry, as a list of its lines.');
  }
  return lines.map(raw => {
    const l = (raw || {}) as Record<string, unknown>;
    const quantity = Number(l.quantity);
    const valueCents = Number(l.valueCents);
    if (typeof l.itemId !== 'string' || !l.itemId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(valueCents) || valueCents < 0) {
      throw new LedgerPostingError(400, 'Each line sent back to a vendor needs the item, a positive quantity and its value in whole cents.');
    }
    // DIM-2 phase 2: the line of the bill the units go back from
    return { itemId: l.itemId, quantity, valueCents, ...(Number.isSafeInteger(l.billLine) && Number(l.billLine) >= 0 ? { line: Number(l.billLine) } : {}) };
  });
}

/**
 * DIM-2 phase 2 (GitHub #132): where stock came from, kept with the move when it is received. A bill's units keep the
 * bill line they came in on and the vendor; units sent back keep the line of the bill they go back from
 * (`returnsFromBillId`) and the vendor. A reversal keeps its original's. Nothing is inferred: what the entry does not
 * name is left out.
 */
function sourceOf(p: PendingMove): { documentLine?: number; vendorId?: string; sourceBillId?: string } & ReturnType<typeof destinationOf> {
  if (!p.kind.startsWith('purchase')) return destinationOf(p);
  const meta = { ...(p.source?.metadata || {}), ...(p.entry.metadata || {}) } as Record<string, unknown>;
  const vendorId = typeof meta.vendorId === 'string' && meta.vendorId ? meta.vendorId : undefined;
  const fromBill = p.kind.startsWith('purchase-return') && typeof meta.returnsFromBillId === 'string' && meta.returnsFromBillId ? meta.returnsFromBillId : undefined;
  return { ...(p.line !== undefined ? { documentLine: p.line } : {}), ...(vendorId ? { vendorId } : {}), ...(fromBill ? { sourceBillId: fromBill } : {}) };
}

/**
 * DIM-2 phase 3: where sold units went, kept with the move: the customer, the invoice line (or the order line of a
 * delivery) and the sold line's labels (project, property, … — its location is already `locationId`). A return keeps
 * the customer and the invoice line it came back against; a reversal keeps its original's. Only what the entry (or
 * its original) names is kept.
 */
function destinationOf(p: PendingMove): { customerId?: string; documentLineId?: string; documentLine?: number; labels?: Record<string, string> } {
  const original = p.source || p.entry;
  const meta = { ...(original.metadata || {}), ...(p.entry.metadata || {}) } as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const customerId = text(meta.customerId);
  const documentLineId = text(meta.cogsForLineId) || text(meta.returnForLineId);
  const orderLine = Number.isSafeInteger(meta.orderLine) && Number(meta.orderLine) >= 0 ? Number(meta.orderLine) : undefined;
  // the labels the sold line carried, on the original entry's cost (or returned-cost) line
  const labelled = ((original as { lines?: Array<{ dimensions?: Record<string, unknown> }> }).lines || []).find(l => l.dimensions && Object.keys(l.dimensions).length);
  const labels = Object.fromEntries(Object.entries(labelled?.dimensions || {}).filter(([k, v]) => k !== 'location' && typeof v === 'string' && v));
  return {
    ...(customerId ? { customerId } : {}), ...(documentLineId ? { documentLineId } : {}), ...(orderLine !== undefined ? { documentLine: orderLine } : {}),
    ...(Object.keys(labels).length ? { labels: labels as Record<string, string> } : {}),
  };
}

/** What an entry does to stock: a sale takes units out, a return brings them back. */
function stockEffect(tx: LedgerEntry): { itemId: string; quantity: number; kind: 'sale' | 'return' } | null {
  const sale = cogsMove(tx);
  if (sale) return { itemId: sale.itemId, quantity: -sale.quantity, kind: 'sale' };
  const back = returnMove(tx);
  if (back) return { itemId: back.itemId, quantity: back.quantity, kind: 'return' };
  // BF-08: goods that came back after a delivery
  const meta = tx.metadata;
  if (meta?.type !== DELIVERY_RETURN_TYPE) return null;
  const quantity = Number(meta.quantity);
  if (typeof meta.inventoryItemId !== 'string' || !meta.inventoryItemId || !Number.isFinite(quantity) || quantity <= 0) {
    throw new LedgerPostingError(400, 'Goods coming back after a delivery need the item and a positive quantity.');
  }
  return { itemId: meta.inventoryItemId, quantity, kind: 'return' };
}

export interface PreparedStockMoves {
  /** Queue the stock writes on the transaction (call after all reads). */
  apply: () => void;
  /** Human-readable notes, e.g. stock below zero. */
  warnings: string[];
}

/**
 * Reads what the entries need and checks the reversal rules. Call inside the posting's
 * database transaction, before any write.
 */
/**
 * BF-06: a line of an invoice can't take back more than was sold on it. Counts the returns in force
 * after this request (stored ones, this request's new ones, less those this request reverses) against
 * the line's sale in force.
 */
async function checkReturns(db: Firestore, t: DbTransaction, workspaceId: string, entries: LedgerEntry[]): Promise<void> {
  const invoices = new Set(entries.map(e => returnMove(e)?.invoiceId).filter((x): x is string => Boolean(x)));
  for (const invoiceId of invoices) {
    const stored = (await t.get(db.collection('transactions').where('workspaceId', '==', workspaceId).where('metadata.invoiceId', '==', invoiceId))).docs
      .map(d => ({ ...d.data(), id: d.id }) as Transaction);
    // the reversals of those entries need not name the invoice (a voided credit note's names only the note)
    const storedIds = stored.map(e => e.id);
    const reversals: Transaction[] = [];
    for (let i = 0; i < storedIds.length; i += 200) {
      const snap = await t.get(db.collection('transactions').where('workspaceId', '==', workspaceId).where('metadata.reversesTxId', 'in', storedIds.slice(i, i + 200)));
      reversals.push(...snap.docs.map(d => ({ ...d.data(), id: d.id }) as Transaction));
    }
    const all = [...stored, ...entries.filter(e => e.metadata?.invoiceId === invoiceId) as unknown as Transaction[]];
    const reversed = new Set([...all, ...reversals, ...entries as unknown as Transaction[]].map(e => e.metadata?.reversesTxId).filter(Boolean));
    const live = all.filter(e => isPostable(e) && !e.metadata?.isReversal && !e.reversalEventId && !reversed.has(e.id));
    const lines = new Set(live.map(e => (e.metadata?.type === SALES_RETURN_TYPE ? String(e.metadata.returnForLineId) : '')).filter(Boolean));
    for (const lineId of lines) {
      const sold = live.filter(e => e.metadata?.type === INVOICE_COGS_TYPE && e.metadata?.cogsForLineId === lineId).reduce((s, e) => s + (Number(e.metadata?.quantity) || 0), 0);
      const back = live.filter(e => e.metadata?.type === SALES_RETURN_TYPE && e.metadata?.returnForLineId === lineId).reduce((s, e) => s + (Number(e.metadata?.quantity) || 0), 0);
      if (round6(back) > round6(sold)) {
        throw new LedgerPostingError(409, `Only ${sold} of that item were sold on this invoice line, and ${back} would have come back. Return at most what was sold.`);
      }
    }
  }
}

export async function prepareStockMoves(
  db: Firestore,
  t: DbTransaction,
  workspaceId: string,
  entries: LedgerEntry[]
): Promise<PreparedStockMoves> {
  await stockMovesReady(db, t);
  const deltas = new Map<string, number>();
  const add = (itemId: string, delta: number) => deltas.set(itemId, round6((deltas.get(itemId) || 0) + delta));
  const pending: PendingMove[] = [];
  // the reversal entry of each target in this request (its stock move belongs to it)
  const reversalOf = new Map(entries.filter(e => typeof e.metadata?.reversesTxId === 'string').map(e => [String(e.metadata!.reversesTxId), e]));
  // invoices whose earlier cost entry this request reverses (an edit keeps how that invoice ships)
  const reshipped = new Set<string>();
  // EG-1 review: repost corrections undone with the entry they correct (a document edited or voided)
  const repostUndo: Array<{ entry: LedgerEntry; original: LedgerEntry }> = [];
  const putBack = (target: string, original: LedgerEntry) => {
    if (original.metadata?.type === REPOST_COGS_TYPE) { repostUndo.push({ entry: reversalOf.get(target) || original, original }); return; }
    if (original.metadata?.type === INVOICE_COGS_TYPE) reshipped.add(String(original.metadata.invoiceId));
    // J-08: a bill's item lines go back out with it
    for (const line of billStockIn(original)) {
      add(line.itemId, -line.quantity);
      pending.push({ itemId: line.itemId, quantity: -line.quantity, kind: 'purchase-reversal', entry: reversalOf.get(target) || original, valueCents: -line.valueCents, location: original.metadata?.locationId as string | undefined, line: line.line, source: original });
    }
    // BF-07: stock sent back to a vendor comes back in when the credit is undone
    for (const line of vendorReturnOut(original)) {
      add(line.itemId, line.quantity);
      pending.push({ itemId: line.itemId, quantity: line.quantity, kind: 'purchase-return-reversal', entry: reversalOf.get(target) || original, valueCents: line.valueCents, location: original.metadata?.locationId as string | undefined, line: line.line, source: original });
    }
    const effect = stockEffect(original);
    if (!effect) return;
    const sign = effect.quantity > 0 ? -1 : 1;
    add(effect.itemId, -effect.quantity);
    pending.push({ itemId: effect.itemId, quantity: -effect.quantity, kind: effect.kind === 'sale' ? 'sale-reversal' : 'return-reversal', entry: reversalOf.get(target) || original, valueCents: sign * Math.abs(Number(original.totalAmountCents) || 0), location: original.metadata?.locationId as string | undefined, source: original });
  };

  for (const tx of entries) {
    for (const line of vendorReturnOut(tx)) {
      add(line.itemId, -line.quantity);
      pending.push({ itemId: line.itemId, quantity: -line.quantity, kind: 'purchase-return', entry: tx, valueCents: -line.valueCents, location: tx.metadata?.locationId as string | undefined, line: line.line, source: tx });
    }
    for (const line of billStockIn(tx)) {
      add(line.itemId, line.quantity);
      pending.push({ itemId: line.itemId, quantity: line.quantity, kind: 'purchase', entry: tx, valueCents: line.valueCents, location: tx.metadata?.locationId as string | undefined, line: line.line, source: tx });
    }
    const effect = stockEffect(tx);
    if (!effect) continue;
    add(effect.itemId, effect.quantity);
    pending.push({ itemId: effect.itemId, quantity: effect.quantity, kind: effect.kind, entry: tx, valueCents: Math.sign(effect.quantity) * Math.abs(Number(tx.totalAmountCents) || 0), location: tx.metadata?.locationId as string | undefined, source: tx });
  }
  await checkReturns(db, t, workspaceId, entries);

  // Reversals: each target once, in this workspace, not reversed before.
  const targets: string[] = [];
  for (const tx of entries) {
    const target = tx.metadata?.reversesTxId;
    if (target === undefined || target === null) continue;
    if (typeof target !== 'string' || !target) throw new LedgerPostingError(400, 'reversesTxId must be a transaction id.');
    if (targets.includes(target)) throw new LedgerPostingError(409, `Transaction ${target} is reversed twice in this request.`);
    targets.push(target);
  }
  if (targets.length > 0) {
    // an entry posted together with its own reversal (R-05: an accrual reversing next month) is in this
    // request, not in the database yet; its stock move comes back the same way
    const inRequest = new Map(entries.filter(e => e.id).map(e => [String(e.id), e]));
    for (const target of targets.filter(id => inRequest.has(id))) putBack(target, inRequest.get(target)!);
    const stored = targets.filter(id => !inRequest.has(id));
    const originals = stored.length ? await t.getAll(...stored.map(id => db.collection('transactions').doc(id))) : [];
    for (const snap of originals) {
      const data = snap.data();
      if (!snap.exists || !data) throw new LedgerPostingError(400, `Transaction ${snap.id} to reverse does not exist.`);
      if (data.workspaceId !== workspaceId) throw new LedgerPostingError(403, 'Forbidden: the transaction to reverse belongs to another workspace.');
      if (data.reversalEventId) throw new LedgerPostingError(409, `Transaction ${snap.id} was already reversed.`);
      putBack(snap.id, { ...data, id: snap.id } as LedgerEntry);
    }
    for (let i = 0; i < targets.length; i += 100) {
      const earlier = await t.get(db.collection('transactions')
        .where('workspaceId', '==', workspaceId)
        .where('metadata.reversesTxId', 'in', targets.slice(i, i + 100)));
      const live = earlier.docs.find(d => isPostable(d.data() as Transaction));
      if (live) throw new LedgerPostingError(409, `Transaction ${live.data().metadata?.reversesTxId} was already reversed.`);
    }
  }

  // a repost correction is undone only together with the entry it corrects, and its stock value goes with it
  for (const u of repostUndo) {
    if (!targets.includes(String(u.original.metadata?.correctsTxId || ''))) {
      throw new LedgerPostingError(409, `Entry ${u.original.id} corrects the cost of ${String(u.original.metadata?.itemName || 'an item')} after a backdated change; it is undone only with the entry it corrects (edit or void that document).`);
    }
  }
  const itemIds = Array.from(deltas.keys()).filter(id => deltas.get(id) !== 0);
  const warnings: string[] = [];
  const writes: { id: string; quantityAtHand: number; unitCostCents?: number }[] = [];
  const moves: NewStockMove[] = [];
  const invoiceSale = entries.some(e => e.metadata?.type === INVOICE_COGS_TYPE && !reshipped.has(String(e.metadata?.invoiceId)));
  const workspace = invoiceSale || itemIds.some(id => (deltas.get(id) || 0) < 0)
    ? (await t.get(db.collection('workspaces').doc(workspaceId))).data()
    : undefined;
  // BF-08 step 2: where deliveries ship the goods, a new invoice moves no stock (an invoice that
  // already shipped its goods, before the switch, keeps doing so when it is edited)
  if (invoiceSale && goodsLeaveWith(workspace) === 'delivery') {
    throw new LedgerPostingError(409, 'In this workspace stock leaves with deliveries, so an invoice books no cost of goods: save the invoice again (refresh first), and deliver the goods from the order.');
  }
  // W-06: selling below zero is allowed with a warning, unless an owner chose to refuse it
  const refuseBelowZero = itemIds.some(id => (deltas.get(id) || 0) < 0) && workspace?.refuseNegativeStock === true;
  if (itemIds.length > 0) {
    const items = await t.getAll(...itemIds.map(id => db.collection('inventory').doc(id)));
    for (const snap of items) {
      const item: DocumentData | undefined = snap.data();
      if (!snap.exists || !item) {
        warnings.push(`Inventory item ${snap.id} no longer exists; its stock was not changed.`);
        continue;
      }
      if (item.workspaceId !== workspaceId) throw new LedgerPostingError(403, 'Forbidden: inventory item belongs to another workspace.');
      const current = typeof item.quantityAtHand === 'number' ? item.quantityAtHand : 0;
      const delta = deltas.get(snap.id) || 0;
      const quantityAtHand = round6(current + delta);
      if (quantityAtHand < 0 && delta < 0 && refuseBelowZero) {
        throw new LedgerPostingError(409, `Only ${Math.max(0, current)} of ${item.name || snap.id} in stock, and this needs ${-delta}. Record the stock received first (Inventory → Adjust stock); an owner can allow selling below zero on Inventory.`);
      }
      if (quantityAtHand < 0) warnings.push(`Stock of ${item.name || snap.id} is now ${quantityAtHand} (below zero).`);
      // W-02: each entry's change, in order, from the quantity before
      let before = current;
      // J-08: what is bought (or a purchase undone) moves the weighted average cost of what is on hand
      let cost = Number(item.unitCostCents) || 0;
      let costChanged = false;
      // a bill edited in this request: its old units go out before its new ones come in
      const mine = pending.filter(x => x.itemId === snap.id);
      const undoFirst = (k: string) => k === 'purchase-reversal' || k === 'purchase-return-reversal';
      for (const p of [...mine.filter(x => undoFirst(x.kind)), ...mine.filter(x => !undoFirst(x.kind))]) {
        const after = round6(before + p.quantity);
        // what is bought or sent back (or either undone) moves the average cost by its own value
        if (['purchase', 'purchase-reversal', 'purchase-return', 'purchase-return-reversal'].includes(p.kind) && after > 0) {
          cost = movingAverageCents(before, cost, p.valueCents, after);
          costChanged = true;
        }
        const invoiceId = typeof p.entry.metadata?.invoiceId === 'string' ? p.entry.metadata.invoiceId : undefined;
        const creditNoteId = typeof p.entry.metadata?.creditNoteId === 'string' ? p.entry.metadata.creditNoteId : undefined;
        const deliveryId = typeof p.entry.metadata?.deliveryId === 'string' ? p.entry.metadata.deliveryId : undefined;
        const billId = typeof p.entry.metadata?.billId === 'string' ? p.entry.metadata.billId : undefined;
        const vendorCreditId = typeof p.entry.metadata?.vendorCreditId === 'string' ? p.entry.metadata.vendorCreditId : undefined;
        const document = vendorCreditId ? { documentType: 'vendor-credit' as const, documentId: vendorCreditId }
          : billId ? { documentType: 'bill' as const, documentId: billId }
          : creditNoteId ? { documentType: 'credit-note' as const, documentId: creditNoteId }
          : invoiceId ? { documentType: 'invoice' as const, documentId: invoiceId }
            : deliveryId ? { documentType: 'delivery' as const, documentId: deliveryId } : {};
        moves.push({
          workspaceId, itemId: snap.id, itemName: String(item.name || ''), date: String(p.entry.date || '').slice(0, 10), kind: p.kind,
          quantity: p.quantity, quantityBefore: before, quantityAfter: after,
          unitCostCents: Math.round(Math.abs(p.valueCents) / Math.abs(p.quantity)), valueCents: p.valueCents,
          transactionId: p.entry.id, ...document,
          // W-01: where the units left from or came back to (a reversal is where its original was)
          ...(typeof p.location === 'string' && p.location ? { locationId: p.location } : {}),
          ...sourceOf(p),
          uid: String(p.entry.uid || ''),
        });
        before = after;
      }
      writes.push({ id: snap.id, quantityAtHand, ...(costChanged ? { unitCostCents: cost } : {}) });
    }
  }

  for (const u of repostUndo) {
    const itemId = String(u.original.metadata?.itemId || '');
    const snap = await t.get(db.collection('inventory').doc(itemId));
    if (!snap.exists || snap.data()?.workspaceId !== workspaceId) continue;
    const onHand = writes.find(w => w.id === itemId)?.quantityAtHand ?? (Number(snap.data()?.quantityAtHand) || 0);
    const valueCents = -(Number(u.original.metadata?.stockValueCents) || 0);
    if (valueCents === 0) continue;
    moves.push({
      workspaceId, itemId, itemName: String(snap.data()?.name || ''), date: String(u.entry.date || '').slice(0, 10), kind: 'cost-repost',
      quantity: 0, quantityBefore: onHand, quantityAfter: onHand, unitCostCents: 0, valueCents, transactionId: u.entry.id,
      correctsTxId: String(u.original.metadata?.correctsTxId || ''), uid: String(u.entry.uid || ''),
    });
  }

  return {
    warnings,
    apply: () => {
      for (const w of writes) {
        t.update(db.collection('inventory').doc(w.id), { quantityAtHand: w.quantityAtHand, ...(w.unitCostCents !== undefined ? { unitCostCents: w.unitCostCents } : {}), updatedAt: FieldValue.serverTimestamp() });
      }
      writeStockMoves(db, t, moves);
    },
  };
}
