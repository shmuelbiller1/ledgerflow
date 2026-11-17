/**
 * Deliveries (BF-08 step 2, src/lib/deliveries.ts): in a workspace where stock leaves with
 * deliveries, delivering items from an order lowers their stock and books the cost of the units
 * that left, in one database transaction. One cost entry per order line ('delivery-cogs-auto', DR
 * Cost of Goods Sold, CR Inventory at the item's cost), with ids made from the delivery id, so a
 * retried request finds its entries and changes nothing. Never more than is left to deliver of a
 * line. Undoing a delivery reverses its entries and puts the units back (cogsStockService.ts moves
 * the stock both ways and keeps the history). Owners, accountants and bookkeepers; audited.
 *
 * The setting itself (`goodsLeaveWith`) is the owner's, on Inventory. Going back to "the invoice
 * ships the goods" is refused while an order is part-way (delivered but not fully invoiced, or the
 * other way round), so no unit leaves twice or never.
 */
import { FieldValue } from '../db/firestore';
import { ledgerCreate, ledgerMark } from './ledgerDoor';
import type { Firestore, Transaction as DbTransaction } from '../db/firestore';
import { assertPeriodOpen, validateWorkspaceAccounts } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { workspaceRole } from '../../lib/periodLock';
import { isPostable } from '../../lib/txFilters';
import { isOrder, orderProgress } from '../../lib/salesOrders';
import { DELIVERY_COGS_TYPE, DELIVERY_RETURN_TYPE, deliveredByLine, deliveredUnitCost, deliveryEntryId, deliveryLines, deliveryProblem, goodsLeaveWith, liveDeliveryEntries, orderDeliveries, returnProblem, type GoodsLeaveWith } from '../../lib/deliveries';
import type { Estimate, Invoice, Transaction } from '../../types';
import { prepareStockMoves } from './cogsStockService';
import { writeServerAuditLog } from './auditLogService';

export class DeliveryError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'DeliveryError';
  }
}

const DELIVERY_ROLES = ['owner', 'accountant', 'bookkeeper'];

export interface DeliveryInput {
  workspaceId: string;
  uid: string;
  email?: string;
  orderId: string;
  deliveryId: string;
  date: string;
  lines: Array<{ position: number; quantity: number }>;
  inventoryAccountId: string;
  cogsAccountId: string;
  /** W-01: where the units leave from (a Location label value) */
  locationId?: string;
  note?: string;
}

/** The order's delivery entries and their reversals. */
const orderEntries = async (db: Firestore, t: DbTransaction, workspaceId: string, orderId: string) => {
  const mine = (await t.get(db.collection('transactions').where('workspaceId', '==', workspaceId).where('metadata.orderId', '==', orderId))).docs
    .map(d => ({ ...d.data(), id: d.id }) as Transaction);
  const ids = mine.map(e => e.id);
  const reversals: Transaction[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const snap = await t.get(db.collection('transactions').where('workspaceId', '==', workspaceId).where('metadata.reversesTxId', 'in', ids.slice(i, i + 200)));
    reversals.push(...snap.docs.map(d => ({ ...d.data(), id: d.id }) as Transaction));
  }
  return [...mine, ...reversals];
};

export interface DeliveryAccounts {
  inventoryAcc: { id: string; name: string };
  cogsAcc: { id: string; name: string };
}

/** The checks and account reads ahead of the write (read-only). */
export async function prepareDeliverOrder(db: Firestore, input: DeliveryInput): Promise<DeliveryAccounts> {
  await assertPeriodOpen(db, input.workspaceId, input.date, input.uid);
  const accounts = await validateWorkspaceAccounts(db, input.workspaceId, [input.inventoryAccountId, input.cogsAccountId]);
  const inventoryAcc = accounts.get(input.inventoryAccountId);
  const cogsAcc = accounts.get(input.cogsAccountId);
  if (!inventoryAcc || !cogsAcc || input.inventoryAccountId === input.cogsAccountId) throw new DeliveryError(400, 'Choose the Inventory and Cost of Goods Sold accounts of this workspace');
  return { inventoryAcc: { id: inventoryAcc.id, name: inventoryAcc.name }, cogsAcc: { id: cogsAcc.id, name: cogsAcc.name } };
}

export async function deliverOrder(db: Firestore, input: DeliveryInput) {
  const prepared = await prepareDeliverOrder(db, input);
  return db.runTransaction(t => deliverOrderInTransaction(db, t, input, prepared));
}

/** The write, inside a transaction the caller owns. */
export async function deliverOrderInTransaction(db: Firestore, t: DbTransaction, input: DeliveryInput, prepared: DeliveryAccounts) {
  const { inventoryAcc, cogsAcc } = prepared;
  {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new DeliveryError(404, 'Workspace not found');
    if (!DELIVERY_ROLES.includes(workspaceRole(workspace, input.uid))) throw new DeliveryError(403, 'Only owners, accountants and bookkeepers deliver goods');
    if (goodsLeaveWith(workspace) !== 'delivery') throw new DeliveryError(409, 'In this workspace the invoice ships the goods. An owner can choose deliveries on Inventory.');
    const orderSnap = await t.get(db.collection('estimates').doc(input.orderId));
    const order = orderSnap.exists ? ({ ...orderSnap.data(), id: orderSnap.id } as Estimate) : null;
    if (!order || order.workspaceId !== input.workspaceId) throw new DeliveryError(404, 'Order not found');
    if (!isOrder(order)) throw new DeliveryError(409, 'Deliver from an order: the customer has not accepted this quote yet');

    // a retried request: its entries are there, nothing more to do
    const sending = input.lines.filter(l => l.quantity > 0);
    const ids = sending.map(l => deliveryEntryId(input.deliveryId, l.position));
    const already = ids.length ? (await t.getAll(...ids.map(id => db.collection('transactions').doc(id)))).filter(s => s.exists) : [];
    if (already.length > 0) return { deliveryId: input.deliveryId, transactionIds: already.map(s => s.id), warnings: [] as string[], repeated: true };

    const entries = await orderEntries(db, t, input.workspaceId, input.orderId);
    const lines = deliveryLines(order, deliveredByLine(entries, input.orderId));
    const problem = deliveryProblem(lines, input.lines);
    if (problem) throw new DeliveryError(400, problem);

    const items = await t.getAll(...sending.map(l => db.collection('inventory').doc(lines.find(x => x.position === l.position)!.itemId)));
    const now = new Date().toISOString();
    const posted: Transaction[] = [];
    for (const [n, l] of sending.entries()) {
      const line = lines.find(x => x.position === l.position)!;
      const item = items[n].exists ? items[n].data() : undefined;
      if (!item || item.workspaceId !== input.workspaceId) throw new DeliveryError(404, `${line.description || 'An item'} is not in this workspace's stock`);
      const unitCost = Number(item.unitCostCents) || 0;
      const costCents = Math.round(l.quantity * unitCost);
      if (costCents <= 0) throw new DeliveryError(400, `${item.name || line.description} has no cost: set its unit cost on Inventory first`);
      const name = String(item.name || line.description || 'item');
      posted.push(await TransactionValidator.validateAndPrepare({
        id: deliveryEntryId(input.deliveryId, l.position),
        workspaceId: input.workspaceId,
        uid: input.uid,
        date: input.date,
        description: `Delivered: ${name} × ${l.quantity} (order ${order.number || order.id})`,
        totalAmountCents: costCents,
        currency: String(workspace.currency || 'USD'),
        exchangeRate: 1,
        status: 'completed',
        type: 'actual',
        createdAt: now,
        metadata: {
          type: DELIVERY_COGS_TYPE, orderId: order.id, orderLine: l.position, deliveryId: input.deliveryId,
          customerId: order.customerId || null, inventoryItemId: line.itemId, quantity: l.quantity,
          ...(input.locationId ? { locationId: input.locationId } : {}), ...(input.note ? { note: input.note } : {}),
        },
        lines: [
          { accountId: cogsAcc.id, accountName: cogsAcc.name, amountCents: costCents, debitCents: costCents, creditCents: 0, description: `Cost of ${name}`, ...(input.locationId ? { dimensions: { location: input.locationId } } : {}) },
          { accountId: inventoryAcc.id, accountName: inventoryAcc.name, amountCents: -costCents, debitCents: 0, creditCents: costCents, description: `Inventory out: ${name}` },
        ],
      } as unknown as Transaction, { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t));
    }
    const stock = await prepareStockMoves(db, t, input.workspaceId, posted as unknown as Parameters<typeof prepareStockMoves>[3]);

    stock.apply();
    for (const tx of posted) ledgerCreate(t, db.collection('transactions').doc(tx.id), { ...tx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'GOODS_DELIVERED', entityType: 'estimates', entityId: order.id,
      details: { description: `Delivered from order ${order.number || order.id}: ${sending.map(l => `${lines.find(x => x.position === l.position)!.description || 'item'} × ${l.quantity}`).join(', ')}` },
    }, { db, tx: t });
    return { deliveryId: input.deliveryId, transactionIds: posted.map(tx => tx.id), warnings: stock.warnings, repeated: false };
  }
}

/** Undo a delivery: its entries are reversed (dated like the delivery while that month is open) and the units come back. */
export interface UndoDeliveryInput { workspaceId: string; uid: string; email?: string; orderId: string; deliveryId: string; date: string }

export async function prepareUndoDelivery(db: Firestore, input: UndoDeliveryInput): Promise<void> {
  await assertPeriodOpen(db, input.workspaceId, input.date, input.uid);
}

export async function undoDelivery(db: Firestore, input: UndoDeliveryInput) {
  await prepareUndoDelivery(db, input);
  return db.runTransaction(t => undoDeliveryInTransaction(db, t, input));
}

/** The write, inside a transaction the caller owns. */
export async function undoDeliveryInTransaction(db: Firestore, t: DbTransaction, input: UndoDeliveryInput) {
  {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new DeliveryError(404, 'Workspace not found');
    if (!DELIVERY_ROLES.includes(workspaceRole(workspace, input.uid))) throw new DeliveryError(403, 'Only owners, accountants and bookkeepers undo deliveries');
    const entries = await orderEntries(db, t, input.workspaceId, input.orderId);
    const delivery = orderDeliveries(entries, input.orderId).find(d => d.deliveryId === input.deliveryId);
    if (!delivery) throw new DeliveryError(404, 'That delivery is not on this order, or it was undone already');
    // goods already came back from this order: undoing a whole delivery would put them back twice
    if (liveDeliveryEntries(entries, input.orderId, DELIVERY_RETURN_TYPE).length > 0) {
      throw new DeliveryError(409, 'Goods from this order already came back, so a delivery can no longer be undone whole: record what else came back instead.');
    }
    const originals = delivery.lines.map(l => entries.find(e => e.id === l.entryId)!);
    const now = new Date().toISOString();
    const reversals: Transaction[] = [];
    for (const original of originals) {
      reversals.push(await TransactionValidator.validateAndPrepare({
        id: `${original.id}_undo`,
        workspaceId: input.workspaceId,
        uid: input.uid,
        date: input.date,
        description: `Delivery undone: ${original.description || ''}`.trim(),
        totalAmountCents: original.totalAmountCents,
        currency: original.currency,
        exchangeRate: 1,
        status: 'completed',
        type: 'actual',
        createdAt: now,
        metadata: { isReversal: true, reversesTxId: original.id, orderId: input.orderId, deliveryId: input.deliveryId },
        lines: (original.lines || []).map(l => ({ ...l, amountCents: -l.amountCents, debitCents: l.creditCents || 0, creditCents: l.debitCents || 0 })),
      } as unknown as Transaction, { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t));
    }
    const stock = await prepareStockMoves(db, t, input.workspaceId, reversals as unknown as Parameters<typeof prepareStockMoves>[3]);
    stock.apply();
    for (const tx of reversals) ledgerCreate(t, db.collection('transactions').doc(tx.id), { ...tx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    for (const original of originals) ledgerMark(t, db.collection('transactions').doc(original.id), { reversalEventId: `${original.id}_undo`, updatedAt: FieldValue.serverTimestamp() });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'DELIVERY_UNDONE', entityType: 'estimates', entityId: input.orderId,
      details: { description: `Delivery of ${delivery.date} undone: ${delivery.lines.map(l => `× ${l.quantity}`).join(', ')}` },
    }, { db, tx: t });
    return { deliveryId: input.deliveryId, reversed: reversals.map(r => r.id) };
  }
}

/**
 * Goods that came back after a delivery (BF-08): stock comes back in and the cost of goods sold is
 * taken back at what the deliveries of that line booked, never more than was delivered and kept.
 * One entry per order line ('delivery-return-auto'), ids from the return id: a retry changes
 * nothing. The money owed back to the customer is a credit note, made apart.
 */
export interface ReturnDeliveredInput {
  workspaceId: string; uid: string; email?: string; orderId: string; returnId: string; date: string;
  lines: Array<{ position: number; quantity: number }>; inventoryAccountId: string; cogsAccountId: string; note?: string;
}

/** The checks and account reads ahead of the write (read-only). */
export async function prepareReturnDelivered(db: Firestore, input: ReturnDeliveredInput): Promise<DeliveryAccounts> {
  await assertPeriodOpen(db, input.workspaceId, input.date, input.uid);
  const accounts = await validateWorkspaceAccounts(db, input.workspaceId, [input.inventoryAccountId, input.cogsAccountId]);
  const inventoryAcc = accounts.get(input.inventoryAccountId);
  const cogsAcc = accounts.get(input.cogsAccountId);
  if (!inventoryAcc || !cogsAcc || input.inventoryAccountId === input.cogsAccountId) throw new DeliveryError(400, 'Choose the Inventory and Cost of Goods Sold accounts of this workspace');
  return { inventoryAcc: { id: inventoryAcc.id, name: inventoryAcc.name }, cogsAcc: { id: cogsAcc.id, name: cogsAcc.name } };
}

export async function returnDelivered(db: Firestore, input: ReturnDeliveredInput) {
  const prepared = await prepareReturnDelivered(db, input);
  return db.runTransaction(t => returnDeliveredInTransaction(db, t, input, prepared));
}

/** The write, inside a transaction the caller owns. */
export async function returnDeliveredInTransaction(db: Firestore, t: DbTransaction, input: ReturnDeliveredInput, prepared: DeliveryAccounts) {
  const { inventoryAcc, cogsAcc } = prepared;
  {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new DeliveryError(404, 'Workspace not found');
    if (!DELIVERY_ROLES.includes(workspaceRole(workspace, input.uid))) throw new DeliveryError(403, 'Only owners, accountants and bookkeepers record goods coming back');
    const orderSnap = await t.get(db.collection('estimates').doc(input.orderId));
    const order = orderSnap.exists ? ({ ...orderSnap.data(), id: orderSnap.id } as Estimate) : null;
    if (!order || order.workspaceId !== input.workspaceId) throw new DeliveryError(404, 'Order not found');

    const sending = input.lines.filter(l => l.quantity > 0);
    const ids = sending.map(l => `${input.returnId}_${l.position}`);
    const already = ids.length ? (await t.getAll(...ids.map(id => db.collection('transactions').doc(id)))).filter(s => s.exists) : [];
    if (already.length > 0) return { returnId: input.returnId, transactionIds: already.map(s => s.id), repeated: true };

    const entries = await orderEntries(db, t, input.workspaceId, input.orderId);
    const lines = deliveryLines(order, deliveredByLine(entries, input.orderId));
    const problem = returnProblem(lines, input.lines);
    if (problem) throw new DeliveryError(400, problem);
    const unitCost = deliveredUnitCost(entries, input.orderId);
    const now = new Date().toISOString();
    const posted: Transaction[] = [];
    for (const l of sending) {
      const line = lines.find(x => x.position === l.position)!;
      const costCents = Math.round(l.quantity * (unitCost.get(l.position) || 0));
      if (costCents <= 0) throw new DeliveryError(400, `${line.description || 'An item'}: its delivery booked no cost to take back`);
      const name = line.description || 'item';
      posted.push(await TransactionValidator.validateAndPrepare({
        id: `${input.returnId}_${l.position}`, workspaceId: input.workspaceId, uid: input.uid, date: input.date,
        description: `Came back: ${name} × ${l.quantity} (order ${order.number || order.id})`,
        totalAmountCents: costCents, currency: String(workspace.currency || 'USD'), exchangeRate: 1, status: 'completed', type: 'actual', createdAt: now,
        metadata: {
          type: DELIVERY_RETURN_TYPE, orderId: order.id, orderLine: l.position, returnId: input.returnId, deliveryId: input.returnId,
          customerId: order.customerId || null, inventoryItemId: line.itemId, quantity: l.quantity, ...(input.note ? { note: input.note } : {}),
        },
        lines: [
          { accountId: inventoryAcc.id, accountName: inventoryAcc.name, amountCents: costCents, debitCents: costCents, creditCents: 0, description: `Inventory back: ${name}` },
          { accountId: cogsAcc.id, accountName: cogsAcc.name, amountCents: -costCents, debitCents: 0, creditCents: costCents, description: `Cost of ${name} taken back` },
        ],
      } as unknown as Transaction, { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t));
    }
    const stock = await prepareStockMoves(db, t, input.workspaceId, posted as unknown as Parameters<typeof prepareStockMoves>[3]);
    stock.apply();
    for (const tx of posted) ledgerCreate(t, db.collection('transactions').doc(tx.id), { ...tx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'GOODS_RETURNED', entityType: 'estimates', entityId: order.id,
      details: { description: `Came back from order ${order.number || order.id}: ${sending.map(l => `${lines.find(x => x.position === l.position)!.description || 'item'} × ${l.quantity}`).join(', ')}` },
    }, { db, tx: t });
    return { returnId: input.returnId, transactionIds: posted.map(tx => tx.id), repeated: false };
  }
}

/**
 * The owner chooses when stock leaves. Back to "the invoice" is refused while an order is part-way:
 * units delivered that are not invoiced, or invoiced that are not delivered.
 */
export interface GoodsLeaveWithInput { workspaceId: string; uid: string; email?: string; value: GoodsLeaveWith }

export async function setGoodsLeaveWith(db: Firestore, input: GoodsLeaveWithInput) {
  return db.runTransaction(t => setGoodsLeaveWithInTransaction(db, t, input));
}

/** The write, inside a transaction the caller owns. */
export async function setGoodsLeaveWithInTransaction(db: Firestore, t: DbTransaction, input: GoodsLeaveWithInput) {
  {
    const ref = db.collection('workspaces').doc(input.workspaceId);
    const workspace = (await t.get(ref)).data();
    if (!workspace) throw new DeliveryError(404, 'Workspace not found');
    if (workspaceRole(workspace, input.uid) !== 'owner') throw new DeliveryError(403, 'Only owners choose when stock leaves');
    if (input.value === 'invoice' && goodsLeaveWith(workspace) === 'delivery') {
      const delivered = (await t.get(db.collection('transactions').where('workspaceId', '==', input.workspaceId).where('metadata.type', '==', DELIVERY_COGS_TYPE))).docs
        .map(d => ({ ...d.data(), id: d.id }) as Transaction).filter(isPostable);
      for (const orderId of new Set(delivered.map(e => String(e.metadata?.orderId)))) {
        const entries = await orderEntries(db, t, input.workspaceId, orderId);
        const done = deliveredByLine(entries, orderId);
        if (done.size === 0) continue;
        const orderSnap = await t.get(db.collection('estimates').doc(orderId));
        const order = { ...orderSnap.data(), id: orderId } as Estimate;
        const invoices = (await t.get(db.collection('invoices').where('workspaceId', '==', input.workspaceId).where('metadata.convertedFromEstimateId', '==', orderId))).docs
          .map(d => ({ ...d.data(), id: d.id }) as Invoice);
        const fullyDelivered = deliveryLines(order, done).every(l => l.left === 0);
        if (!fullyDelivered || orderProgress(order, invoices).leftCents > 0) {
          throw new DeliveryError(409, `Order ${order.number || orderId} is part-way (delivered and invoiced differ): finish it, or undo its deliveries, before invoices ship the goods again.`);
        }
      }
    }
    t.update(ref, { goodsLeaveWith: input.value, updatedAt: new Date().toISOString() });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'STOCK_POLICY_SET', entityType: 'workspaces', entityId: input.workspaceId,
      details: { description: input.value === 'delivery' ? 'Stock now leaves with deliveries (invoices book no cost of goods)' : 'Stock leaves with the invoice again' },
    }, { db, tx: t });
    return { goodsLeaveWith: input.value };
  }
}
