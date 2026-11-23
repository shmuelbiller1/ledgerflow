/**
 * Recognizing cost of goods sold by hand for units already sold (POST /api/v1/inventory/cogs):
 * the item's cost times the quantity leaves Inventory and enters Cost of Goods Sold, and the
 * quantity on hand goes down, in one database transaction. The item and its accounts are read
 * before the transaction (never more is recognized than is on hand), and the stock history keeps
 * the change with the entry it belongs to.
 */
import Decimal from 'decimal.js';
import { FieldValue } from '../db/firestore';
import type { Firestore, Transaction } from '../db/firestore';
import { validateWorkspaceAccounts } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { isStandardizing, validStandardCost } from '../../lib/standardCostSettings';
import { ledgerCreate } from './ledgerDoor';
import { stockMovesReady, writeStockMoves } from './stockMoveService';
import { writeServerAuditLog } from './auditLogService';

export class CogsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'CogsError';
  }
}

export interface CogsInput {
  workspaceId: string;
  uid: string;
  email?: string;
  admin?: boolean;
  wsData: Record<string, unknown>;
  itemId: string;
  quantitySold: number;
  inventoryAccountId: string;
  cogsAccountId: string;
  date: string;
}

export interface CogsAccounts {
  item: Record<string, unknown>;
  itemName: string;
  unitCostCents: number;
  totalCogsCents: number;
  inventoryAcc: { id: string; name: string };
  cogsAcc: { id: string; name: string };
}

export interface CogsResult {
  status: 'ok';
  message: string;
  transactionId: string;
  unitCostCents: number;
  totalCogsCents: number;
}

/** The reads and checks ahead of the write: the item, its cost, and the two accounts. */
export async function prepareCogs(db: Firestore, input: CogsInput): Promise<CogsAccounts> {
  const accounts = await validateWorkspaceAccounts(db, input.workspaceId, [input.inventoryAccountId, input.cogsAccountId]);
  const inventoryAcc = accounts.get(input.inventoryAccountId);
  const cogsAcc = accounts.get(input.cogsAccountId);
  if (!inventoryAcc || !cogsAcc) throw new CogsError(400, 'Choose accounts from this workspace');

  const itemData = (await db.collection('inventory').doc(input.itemId).get()).data();
  if (!itemData) throw new CogsError(404, `Inventory item ${input.itemId} not found.`);
  // fail-closed ownership check: another workspace's item answers like a missing one
  if (!itemData.workspaceId || itemData.workspaceId !== input.workspaceId) {
    throw new CogsError(403, 'Security Violation: Item not found in workspace.');
  }
  if (typeof itemData.unitCostCents !== 'number' || itemData.unitCostCents <= 0) {
    throw new CogsError(400, `Inventory item ${input.itemId} has no valid unitCostCents configured.`);
  }
  // M-21 step 2: while the workspace posts at the standard, the stock is carried at quantity × standard in
  // the books, so recognizing COGS at the item's actual cost (unitCostCents) would leave Inventory out of
  // step. This manual path was not converted to the standard basis, so it is refused for standard items.
  const ws = (await db.collection('workspaces').doc(input.workspaceId).get()).data() as Record<string, unknown> | undefined;
  if (isStandardizing(ws) && validStandardCost(itemData.standardCostCents) !== null) {
    throw new CogsError(409, `${itemData.name || input.itemId} is valued at its standard cost and this workspace posts at the standard. Recognizing cost of goods by hand posts at the standard carrying basis (with the variance to the variance account), which is not supported yet: turn standard-cost posting off, or change the item's standard to none.`);
  }
  // #76: Decimal for COGS precision
  const totalCogsCents = new Decimal(itemData.unitCostCents).mul(input.quantitySold).round().toNumber();
  return {
    item: itemData,
    itemName: String(itemData.name || itemData.sku || input.itemId),
    unitCostCents: itemData.unitCostCents,
    totalCogsCents,
    inventoryAcc: { id: inventoryAcc.id, name: inventoryAcc.name },
    cogsAcc: { id: cogsAcc.id, name: cogsAcc.name },
  };
}

/** The write, inside a transaction the caller owns. */
export async function cogsInTransaction(db: Firestore, t: Transaction, input: CogsInput, prepared: CogsAccounts): Promise<CogsResult> {
  const { workspaceId, itemId, quantitySold, date } = input;
  const { itemName, inventoryAcc, cogsAcc } = prepared;

  // re-fetch the item inside the transaction, for race-condition safety
  const currentItemData = (await t.get(db.collection('inventory').doc(itemId))).data();
  const currentQty = typeof currentItemData?.quantityAtHand === 'number' ? currentItemData.quantityAtHand : 0;
  if (quantitySold > currentQty) {
    // the legacy route answered a plain error here, which the handler turned into 400
    throw new CogsError(400, `Insufficient inventory stock. Requested ${quantitySold}, available ${currentQty}.`);
  }

  const validatedTx = await TransactionValidator.validateAndPrepare({
    id: db.collection('transactions').doc().id,
    workspaceId,
    uid: input.uid,
    date,
    description: `Inventory COGS Recognition: ${itemName} (Qty: ${quantitySold})`,
    totalAmountCents: prepared.totalCogsCents,
    currency: String(input.wsData?.currency || 'USD'),
    type: 'journal',
    status: 'approved',
    isCleared: true,
    createdAt: new Date().toISOString(),
    lines: [
      { id: 'line-1', accountId: cogsAcc.id, accountName: cogsAcc.name, amountCents: prepared.totalCogsCents, description: `Recognize COGS for ${quantitySold} units of ${itemName}` },
      { id: 'line-2', accountId: inventoryAcc.id, accountName: inventoryAcc.name, amountCents: -prepared.totalCogsCents, description: `Reduce inventory asset for ${quantitySold} units of ${itemName}` },
    ],
  }, { workspaceId, user: { uid: input.uid, admin: input.admin }, wsData: input.wsData }, undefined, t);

  await stockMovesReady(db);
  const txRef = db.collection('transactions').doc(validatedTx.id);
  ledgerCreate(t, txRef, { ...validatedTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });

  t.update(db.collection('inventory').doc(itemId), {
    quantityAtHand: FieldValue.increment(-quantitySold),
    updatedAt: FieldValue.serverTimestamp(),
  });
  // W-02: the change in the item's stock history
  writeStockMoves(db, t, [{
    workspaceId, itemId, itemName, date, kind: 'manual-cogs',
    quantity: -quantitySold, quantityBefore: currentQty, quantityAfter: currentQty - quantitySold,
    unitCostCents: prepared.unitCostCents, valueCents: -prepared.totalCogsCents, transactionId: validatedTx.id, uid: input.uid,
  }]);
  await writeServerAuditLog({
    workspaceId,
    uid: input.uid,
    email: input.email,
    action: 'INVENTORY_COGS_RECORDED',
    entityType: 'inventory',
    entityId: String(itemId),
    details: {
      description: `Recorded COGS for ${quantitySold} units of ${itemName} (${prepared.totalCogsCents} cents) on ${date}`,
      itemId,
      quantitySold,
      unitCostCents: prepared.unitCostCents,
      totalCogsCents: prepared.totalCogsCents,
      transactionId: validatedTx.id,
      date,
    },
  }, { db, tx: t });

  return {
    status: 'ok',
    message: 'Inventory COGS recorded successfully.',
    transactionId: validatedTx.id,
    unitCostCents: prepared.unitCostCents,
    totalCogsCents: prepared.totalCogsCents,
  };
}
